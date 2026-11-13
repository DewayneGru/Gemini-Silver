#!/usr/bin/env python3
"""
scripts/antigravity_sync_daemon.py
Local multi-threaded HTTP bridge connecting Google AI Studio and
AntigravityBridgeWorkspace.tsx / SilverVerificationPanel.tsx to the local
SynapseEdge Epistemic Watchdog, C++20 verification harness, and git working tree.

Routes:
  GET  /quota-state           - Quota backoff state & local Qwen failover status
  GET  /silver-steering       - Live Kuramoto R, K, steering_directive & prompt header
  GET  /silver-verifications  - Committed ledger, quarantined scratchpad & C++20 verdicts
  POST /quota-state           - Update quota backoff state or clear pause
  POST /apply-patch           - Boundary-checked unified diff dry-run & git apply
  POST /silver-ingest         - Evaluate, sign & route Gemini 3.1 Pro outputs
  POST /silver-verify         - Execute verify_silver_ledger.py against synapse_stdp.hpp
"""

from __future__ import annotations

import argparse
from dataclasses import asdict
import json
import os
import re
import subprocess
import sys
import tempfile
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
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

QUOTA_STATE_PATH = REPO_ROOT / ".antigravity_quota_state.json"
SILVER_STATE_DIR = REPO_ROOT / ".silver_state"
COMMITTED_LEDGER_PATH = SILVER_STATE_DIR / "silver_committed_ledger.jsonl"
QUARANTINE_LEDGER_PATH = SILVER_STATE_DIR / "silver_scratchpad_quarantine.jsonl"
VERIFICATION_RESULTS_PATH = SILVER_STATE_DIR / "silver_verification_results.jsonl"
VERIFY_SCRIPT_PATH = REPO_ROOT / "scripts" / "verify_silver_ledger.py"

PROTECTED_PATCH_PATHS = {
    ".git",
    ".env",
    "src/server/security.ts",
    "src/server/telemetryGate.ts",
}
ALLOWED_COMPILERS = {"clang++", "g++"}

_SILVER_VERIFY_LOCK = threading.Lock()
_SILVER_INGEST_LOCK = threading.Lock()
_WATCHDOG_INSTANCE: EpistemicWatchdog | None = None
_FALLBACK_GOVERNOR = KuramotoGovernor()


class QuotaBackoffController:
    """
    Tracks AI Studio quota exhaustion windows and local Ollama failover readiness
    (qwen2.5-coder:7b) persisted to .antigravity_quota_state.json.
    """

    def __init__(self, state_path: Path = QUOTA_STATE_PATH) -> None:
        self.state_path = state_path
        self._lock = threading.Lock()

    def _default_state(self) -> dict[str, Any]:
        return {
            "paused": False,
            "consecutive_429s": 0,
            "retry_after_ms": 0,
            "backoff_seconds": 0,
            "primary_model": "gemini-3.1-pro-preview",
            "failover_model": "qwen2.5-coder:7b",
            "active_backend": "gemini-3.1-pro-preview",
            "last_error": None,
            "updated_at_ms": int(time.time() * 1000),
        }

    def get_state(self) -> dict[str, Any]:
        with self._lock:
            state = self._default_state()
            if self.state_path.exists():
                try:
                    loaded = json.loads(self.state_path.read_text(encoding="utf-8"))
                    if isinstance(loaded, dict):
                        state.update(loaded)
                except (OSError, json.JSONDecodeError):
                    pass

            now_ms = int(time.time() * 1000)
            retry_after_ms = int(state.get("retry_after_ms", 0))
            if state.get("paused") and retry_after_ms > 0 and now_ms >= retry_after_ms:
                state["paused"] = False
                state["active_backend"] = state.get("primary_model", "gemini-3.1-pro-preview")
                state["remaining_seconds"] = 0
                self._write_atomic(state)
            else:
                remaining = max(0, int((retry_after_ms - now_ms) / 1000)) if state.get("paused") else 0
                state["remaining_seconds"] = remaining

            return state

    def update_state(self, patch: dict[str, Any]) -> dict[str, Any]:
        current = self.get_state()
        with self._lock:
            now_ms = int(time.time() * 1000)
            if patch.get("record_429"):
                hits = int(current.get("consecutive_429s", 0)) + 1
                backoff_sec = min(3600, int(patch.get("backoff_seconds") or (30 * (2 ** (hits - 1)))))
                current["paused"] = True
                current["consecutive_429s"] = hits
                current["backoff_seconds"] = backoff_sec
                current["retry_after_ms"] = now_ms + (backoff_sec * 1000)
                current["active_backend"] = current.get("failover_model", "qwen2.5-coder:7b")
                current["last_error"] = str(patch.get("error") or "HTTP 429 quota ceiling reached")
            elif patch.get("clear_pause"):
                current["paused"] = False
                current["consecutive_429s"] = 0
                current["backoff_seconds"] = 0
                current["retry_after_ms"] = 0
                current["active_backend"] = current.get("primary_model", "gemini-3.1-pro-preview")
                current["last_error"] = None
            else:
                for key in ("paused", "backoff_seconds", "retry_after_ms", "active_backend", "last_error"):
                    if key in patch:
                        current[key] = patch[key]

            current["updated_at_ms"] = now_ms
            self._write_atomic(current)
            return current

    def _write_atomic(self, state: dict[str, Any]) -> None:
        self.state_path.parent.mkdir(parents=True, exist_ok=True)
        payload = json.dumps(state, indent=2) + "\n"
        with tempfile.NamedTemporaryFile(
            "w", dir=self.state_path.parent, delete=False, encoding="utf-8"
        ) as tmp:
            tmp.write(payload)
            tmp.flush()
            os.fsync(tmp.fileno())
            tmp_path = Path(tmp.name)
        os.replace(tmp_path, self.state_path)


QUOTA_CONTROLLER = QuotaBackoffController()


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
    if os.environ.get("SYNAPSE_HMAC_KEY"):
        return _get_watchdog().governor
    return _FALLBACK_GOVERNOR


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


def extract_unified_diff(raw_text: str) -> str:
    blocks = re.findall(r"```(?:diff|patch)?\n(.*?)```", raw_text, flags=re.DOTALL)
    diff_body = "\n".join(blocks).strip() if blocks else raw_text.strip()
    if diff_body and not diff_body.endswith("\n"):
        diff_body += "\n"
    return diff_body


def validate_and_apply_patch(raw_response: str, repo_dir: Path) -> dict[str, Any]:
    if not (repo_dir / ".git").exists():
        return {"ok": False, "error": f"No git repository initialized at {repo_dir}"}

    diff_text = extract_unified_diff(raw_response)
    if "--- " not in diff_text or "+++ " not in diff_text:
        return {"ok": False, "error": "No valid unified diff headers found in payload."}

    for line in diff_text.splitlines():
        if line.startswith(("+++ b/", "--- a/")):
            rel_path = line[6:].strip()
            if rel_path == "/dev/null":
                continue
            path_obj = Path(rel_path)
            if (
                path_obj.is_absolute()
                or ".." in path_obj.parts
                or rel_path in PROTECTED_PATCH_PATHS
                or any(part == ".git" for part in path_obj.parts)
            ):
                return {"ok": False, "error": f"Blocked protected or invalid path: {rel_path}"}

    with tempfile.NamedTemporaryFile("w", suffix=".diff", delete=False, encoding="utf-8") as tmp:
        tmp.write(diff_text)
        patch_path = Path(tmp.name)

    try:
        check = subprocess.run(
            ["git", "apply", "--check", "--recount", str(patch_path)],
            cwd=repo_dir,
            capture_output=True,
            text=True,
        )
        if check.returncode != 0:
            return {"ok": False, "error": f"Patch check failed: {check.stderr.strip()}"}

        apply_res = subprocess.run(
            ["git", "apply", "--recount", str(patch_path)],
            cwd=repo_dir,
            capture_output=True,
            text=True,
        )
        if apply_res.returncode != 0:
            return {"ok": False, "error": f"git apply failed: {apply_res.stderr.strip()}"}

        stat = subprocess.run(
            ["git", "diff", "--stat"],
            cwd=repo_dir,
            capture_output=True,
            text=True,
        )
        return {"ok": True, "stat": stat.stdout.strip()}
    finally:
        patch_path.unlink(missing_ok=True)


def ingest_silver_output(payload: dict[str, Any]) -> tuple[int, dict[str, Any]]:
    raw_output = str(payload.get("raw_output") or payload.get("content") or "").strip()
    if not raw_output:
        return 400, {"ok": False, "error": "Missing raw Gemini 3.1 Pro output text."}

    prompt_id = str(payload.get("prompt_id") or "").strip() or f"silver-{int(time.time())}"

    with _SILVER_INGEST_LOCK:
        try:
            watchdog = _get_watchdog()
        except RuntimeError as exc:
            return 400, {"ok": False, "error": str(exc)}

        try:
            receipt = watchdog.evaluate_and_route(prompt_id=prompt_id, raw_model_output=raw_output)
        except (ValueError, json.JSONDecodeError) as exc:
            return 422, {"ok": False, "error": f"Telemetry extraction failed: {exc}"}

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
    server_version = "GeminiSilverSyncDaemon/1.0"

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

    def log_message(self, format: str, *args: Any) -> None:
        ts = time.strftime("%H:%M:%S")
        sys.stderr.write(f"[{ts}] {self.address_string()} - {format % args}\n")

    def do_OPTIONS(self) -> None:
        self._send_json(204, {})

    def do_GET(self) -> None:
        route = urlparse(self.path).path
        if route == "/quota-state":
            self._send_json(200, {"ok": True, **QUOTA_CONTROLLER.get_state()})
            return
        if route == "/silver-verifications":
            self._send_json(200, get_silver_verifications_state())
            return
        if route == "/silver-steering":
            self._send_json(200, get_silver_steering_state())
            return
        self._send_json(404, {"ok": False, "error": f"Unknown GET route: {route}"})

    def do_POST(self) -> None:
        route = urlparse(self.path).path
        content_length = int(self.headers.get("Content-Length", 0))
        payload: dict[str, Any] = {}

        if content_length > 0:
            try:
                raw_body = self.rfile.read(content_length).decode("utf-8")
                parsed = json.loads(raw_body)
                if not isinstance(parsed, dict):
                    self._send_json(400, {"ok": False, "error": "JSON body must be an object."})
                    return
                payload = parsed
            except (UnicodeDecodeError, json.JSONDecodeError) as exc:
                self._send_json(400, {"ok": False, "error": f"Invalid JSON payload: {exc}"})
                return

        if route == "/quota-state":
            updated = QUOTA_CONTROLLER.update_state(payload)
            self._send_json(200, {"ok": True, **updated})
            return

        if route == "/apply-patch":
            content = str(payload.get("content", ""))
            if not content.strip():
                self._send_json(400, {"ok": False, "error": "Empty patch content."})
                return
            result = validate_and_apply_patch(content, REPO_ROOT)
            self._send_json(200 if result["ok"] else 422, result)
            return

        if route == "/silver-ingest":
            status_code, response_body = ingest_silver_output(payload)
            self._send_json(status_code, response_body)
            return

        if route == "/silver-verify":
            status_code, response_body = trigger_silver_verification(payload)
            self._send_json(status_code, response_body)
            return

        self._send_json(404, {"ok": False, "error": f"Unknown POST route: {route}"})


def main() -> int:
    parser = argparse.ArgumentParser(description="Gemini Silver local sync & epistemic verification daemon")
    parser.add_argument("--host", default="127.0.0.1", help="Bind interface (default: 127.0.0.1)")
    parser.add_argument("--port", type=int, default=8765, help="Bind port (default: 8765)")
    args = parser.parse_args()

    hmac_ready = bool(os.environ.get("SYNAPSE_HMAC_KEY"))
    server = ThreadingHTTPServer((args.host, args.port), AntigravitySyncHandler)
    print(
        f"Gemini Silver Sync Daemon listening on http://{args.host}:{args.port} "
        f"(repo={REPO_ROOT}, hmac_key_configured={hmac_ready})",
        flush=True,
    )
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nShutting down Gemini Silver Sync Daemon...", flush=True)
    finally:
        server.server_close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
