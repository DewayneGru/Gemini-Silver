#!/usr/bin/env python3
"""
scripts/antigravity_sync_daemon.py
Thread-safe HTTP synchronization & verification daemon for the SynapseEdge + Watchdog
architecture. Exposes GET /silver-verifications, GET /silver-steering, POST /silver-ingest,
POST /silver-verify, GET /quota-state, and POST /apply-patch.
"""

from __future__ import annotations

from dataclasses import asdict
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
import os
from pathlib import Path
import subprocess
import sys
import threading
import time
from typing import Any
from urllib.parse import urlparse

REPO_ROOT = Path(__file__).resolve().parents[1]
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))

from synapse_edge_watchdog import (  # noqa: E402
    EpistemicWatchdog,
    KuramotoGovernor,
    R_TOLERANCE,
)

SILVER_STATE_DIR = REPO_ROOT / ".silver_state"
COMMITTED_LEDGER_PATH = SILVER_STATE_DIR / "silver_committed_ledger.jsonl"
QUARANTINE_LEDGER_PATH = SILVER_STATE_DIR / "silver_scratchpad_quarantine.jsonl"
VERIFICATION_RESULTS_PATH = SILVER_STATE_DIR / "silver_verification_results.jsonl"
VERIFY_SCRIPT_PATH = REPO_ROOT / "scripts" / "verify_silver_ledger.py"

ALLOWED_COMPILERS = {"clang++", "g++"}
_SILVER_VERIFY_LOCK = threading.Lock()
_SILVER_INGEST_LOCK = threading.Lock()
_WATCHDOG_INSTANCE: EpistemicWatchdog | None = None
_FALLBACK_GOVERNOR = KuramotoGovernor()


def _read_jsonl_records(path: Path) -> list[dict[str, Any]]:
    if not path.exists():
        return []
    records: list[dict[str, Any]] = []
    for line_no, raw_line in enumerate(path.read_text(encoding="utf-8").splitlines(), start=1):
        stripped = raw_line.strip()
        if not stripped:
            continue
        try:
            records.append(json.loads(stripped))
        except json.JSONDecodeError as exc:
            records.append({"_corrupt_line": line_no, "_error": str(exc), "_raw": stripped})
    return records


def _get_watchdog() -> EpistemicWatchdog:
    global _WATCHDOG_INSTANCE
    raw_key = os.environ.get("SYNAPSE_HMAC_KEY", "")
    if not raw_key:
        raise RuntimeError("SYNAPSE_HMAC_KEY is not set in the sync daemon environment.")
    key_bytes = raw_key.encode("utf-8")
    if _WATCHDOG_INSTANCE is None or _WATCHDOG_INSTANCE.signing_key != key_bytes:
        _WATCHDOG_INSTANCE = EpistemicWatchdog(state_dir=SILVER_STATE_DIR, signing_key=key_bytes)
    return _WATCHDOG_INSTANCE


def _get_active_governor() -> KuramotoGovernor:
    """Returns the persistent watchdog governor (initializing watchdog if HMAC key is set)."""
    if os.environ.get("SYNAPSE_HMAC_KEY"):
        return _get_watchdog().governor
    return _FALLBACK_GOVERNOR


def get_silver_steering_state() -> dict[str, Any]:
    """
    Reads live Kuramoto order parameter R, coupling K, and active steering_directive
    without mutating oscillator phases, and formats a paste-ready AI Studio header.
    """
    with _SILVER_INGEST_LOCK:
        gov = _get_active_governor()
        r_curr, psi = gov.order_parameter()
        k_curr = gov.k
        r_target = gov.r_target

    if r_curr > r_target + R_TOLERANCE:
        directive = "DIVERGE_EXPLORE"
    elif r_curr < r_target - R_TOLERANCE:
        directive = "CONVERGE_SYNTHESIZE"
    else:
        directive = "CRITICAL_BALANCE"

    committed_count = len(_read_jsonl_records(COMMITTED_LEDGER_PATH))
    quarantined_count = len(_read_jsonl_records(QUARANTINE_LEDGER_PATH))

    steering_header = (
        "[SYNAPSE_EDGE_STEERING]\n"
        f"order_parameter_r: {r_curr:.6f} (target: {r_target:.2f})\n"
        f"coupling_k: {k_curr:.6f}\n"
        f"steering_directive: {directive}\n"
        f"ledger_state: {committed_count} verified committed | {quarantined_count} quarantined\n"
        "instruction: Honor steering_directive above and append the mandatory trailing ```json telemetry block.\n"
        "[/SYNAPSE_EDGE_STEERING]\n"
    )

    return {
        "ok": True,
        "order_parameter_r": round(r_curr, 6),
        "r_target": r_target,
        "coupling_k": round(k_curr, 6),
        "phase_psi": round(psi, 6),
        "steering_directive": directive,
        "steering_header": steering_header,
    }


def get_silver_verifications_state() -> dict[str, Any]:
    committed = _read_jsonl_records(COMMITTED_LEDGER_PATH)
    quarantined = _read_jsonl_records(QUARANTINE_LEDGER_PATH)
    verifications = _read_jsonl_records(VERIFICATION_RESULTS_PATH)
    return {
        "ok": True,
        "hmac_key_configured": bool(os.environ.get("SYNAPSE_HMAC_KEY")),
        "counts": {
            "committed": len(committed),
            "quarantined": len(quarantined),
            "verifications": len(verifications),
        },
        "committed": committed,
        "quarantined": quarantined,
        "verifications": verifications,
        "steering": get_silver_steering_state(),
    }


def ingest_silver_output(payload: dict[str, Any]) -> tuple[int, dict[str, Any]]:
    raw_output = str(payload.get("raw_output") or payload.get("content") or "").strip()
    if not raw_output:
        return 400, {"ok": False, "error": "Missing raw model output text."}

    prompt_id = str(payload.get("prompt_id") or "").strip() or f"silver-{int(time.time())}"

    with _SILVER_INGEST_LOCK:
        try:
            watchdog = _get_watchdog()
        except RuntimeError as exc:
            return 400, {"ok": False, "error": str(exc)}

        try:
            receipt = watchdog.evaluate_and_route(prompt_id=prompt_id, raw_model_output=raw_output)
        except (ValueError, json.JSONDecodeError) as exc:
            return 422, {
                "ok": False,
                "error": f"Telemetry extraction failed: {exc}",
            }

        return 200, {
            "ok": True,
            "prompt_id": prompt_id,
            "receipt": asdict(receipt),
            "state": get_silver_verifications_state(),
        }


def trigger_silver_verification(options: dict[str, Any]) -> tuple[int, dict[str, Any]]:
    if not os.environ.get("SYNAPSE_HMAC_KEY"):
        return 400, {
            "ok": False,
            "error": "SYNAPSE_HMAC_KEY is not set in the sync daemon environment.",
        }

    if not VERIFY_SCRIPT_PATH.exists():
        return 500, {
            "ok": False,
            "error": f"Verification harness not found at {VERIFY_SCRIPT_PATH}",
        }

    compiler = str(options.get("compiler", "clang++")).strip()
    if compiler not in ALLOWED_COMPILERS:
        return 400, {
            "ok": False,
            "error": f"Unsupported compiler '{compiler}'. Allowed: {sorted(ALLOWED_COMPILERS)}",
        }

    cmd = [
        sys.executable,
        str(VERIFY_SCRIPT_PATH),
        "--ledger",
        str(COMMITTED_LEDGER_PATH),
        "--quarantine",
        str(QUARANTINE_LEDGER_PATH),
        "--header",
        str(REPO_ROOT / "synapse_stdp.hpp"),
        "--unit-test-src",
        str(REPO_ROOT / "tests" / "test_synapse_stdp.cpp"),
        "--out",
        str(VERIFICATION_RESULTS_PATH),
        "--compiler",
        compiler,
    ]

    if options.get("dry_run") is True:
        cmd.append("--dry-run")

    unit_test_args = str(options.get("unit_test_args", "")).strip()
    if unit_test_args:
        cmd.append(f"--unit-test-args={unit_test_args}")

    with _SILVER_VERIFY_LOCK:
        try:
            proc = subprocess.run(
                cmd,
                cwd=REPO_ROOT,
                capture_output=True,
                text=True,
                timeout=60,
            )
        except subprocess.TimeoutExpired:
            return 504, {"ok": False, "error": "verify_silver_ledger.py timed out after 60s."}

        stdout_text = proc.stdout.strip()
        stderr_text = proc.stderr.strip()

        try:
            report = json.loads(stdout_text) if stdout_text else None
        except json.JSONDecodeError:
            report = None

        if report is None:
            return 422, {
                "ok": False,
                "exit_code": proc.returncode,
                "error": stderr_text or stdout_text or "Verification harness failed without JSON report.",
            }

        return 200, {
            "ok": True,
            "all_passed": proc.returncode == 0,
            "exit_code": proc.returncode,
            "report": report,
            "state": get_silver_verifications_state(),
        }


class AntigravitySyncHandler(BaseHTTPRequestHandler):
    def _send_json(self, status_code: int, payload: dict[str, Any]) -> None:
        body = json.dumps(payload).encode("utf-8")
        self.send_response(status_code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.end_headers()
        self.wfile.write(body)

    def do_OPTIONS(self) -> None:
        self._send_json(204, {})

    def do_GET(self) -> None:
        route = urlparse(self.path).path
        if route == "/quota-state":
            self._send_json(200, {"ok": True, "status": "nominal", "r_target": 0.48})
            return
        if route == "/silver-verifications":
            self._send_json(200, get_silver_verifications_state())
            return
        if route == "/silver-steering":
            self._send_json(200, get_silver_steering_state())
            return
        self._send_json(404, {"ok": False, "error": "Not found"})

    def do_POST(self) -> None:
        route = urlparse(self.path).path
        content_length = int(self.headers.get("Content-Length", 0))
        payload: dict[str, Any] = {}

        if content_length > 0:
            try:
                raw_body = self.rfile.read(content_length).decode("utf-8")
                payload = json.loads(raw_body)
            except (UnicodeDecodeError, json.JSONDecodeError) as exc:
                self._send_json(400, {"ok": False, "error": f"Invalid JSON payload: {exc}"})
                return

        if route == "/silver-ingest":
            status_code, response_body = ingest_silver_output(payload)
            self._send_json(status_code, response_body)
            return

        if route == "/silver-verify":
            status_code, response_body = trigger_silver_verification(payload)
            self._send_json(status_code, response_body)
            return

        self._send_json(404, {"ok": False, "error": "Not found"})


def main() -> int:
    port = int(os.environ.get("ANTIGRAVITY_DAEMON_PORT", "8765"))
    server = ThreadingHTTPServer(("127.0.0.1", port), AntigravitySyncHandler)
    print(f"Antigravity sync daemon listening on http://127.0.0.1:{port}")
    server.serve_forever()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
