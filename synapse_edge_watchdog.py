#!/usr/bin/env python3
"""
synapse_edge_watchdog.py
Core KuramotoGovernor and EpistemicWatchdog implementation for cryptographic
Merkle/HMAC signing, phase-coupled homeostatic steering, and ledger/quarantine routing.
"""

from __future__ import annotations

import cmath
import hashlib
import hmac
import json
import math
import re
import tempfile
import time
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Any

R_TARGET = 0.48
R_TOLERANCE = 0.025


@dataclass
class AuditReceipt:
    timestamp_ms: int
    merkle_leaf_hex: str
    hmac_sha256_hex: str
    order_parameter_r: float
    coupling_k: float
    steering_directive: str
    committed: bool
    quarantine_reason: str | None


class KuramotoGovernor:
    """Maintains an ensemble of N phase oscillators regulating epistemic exploration around R_target = 0.48."""

    def __init__(self, n_oscillators: int = 32, r_target: float = R_TARGET, coupling_k: float = 2.15) -> None:
        self.n = n_oscillators
        self.r_target = r_target
        self.k = coupling_k
        self.phases = [(2.0 * math.pi * i / self.n) * 0.71 for i in range(self.n)]
        self.natural_freqs = [-0.5 + (i / max(1, self.n - 1)) for i in range(self.n)]

    def order_parameter(self) -> tuple[float, float]:
        z = sum(cmath.exp(1j * theta) for theta in self.phases) / float(self.n)
        return abs(z), cmath.phase(z)

    def current_directive(self) -> str:
        r_curr, _ = self.order_parameter()
        if r_curr > self.r_target + R_TOLERANCE:
            return "DIVERGE_EXPLORE"
        if r_curr < self.r_target - R_TOLERANCE:
            return "CONVERGE_SYNTHESIZE"
        return "CRITICAL_BALANCE"

    def step(self, dt: float = 0.05, verified_feedback: bool = True) -> tuple[float, float, str]:
        r_curr, psi = self.order_parameter()
        new_phases: list[float] = []
        for i, theta in enumerate(self.phases):
            dtheta = self.natural_freqs[i] + self.k * r_curr * math.sin(psi - theta)
            new_phases.append((theta + dtheta * dt) % (2.0 * math.pi))
        self.phases = new_phases

        # Homeostatic adaptation of coupling K toward r_target = 0.48
        err = self.r_target - r_curr
        gain = 0.18 if verified_feedback else -0.12
        self.k = max(0.35, min(4.50, self.k + gain * err))

        r_next, _ = self.order_parameter()
        return r_next, self.k, self.current_directive()


class EpistemicWatchdog:
    """Extracts trailing JSON telemetry blocks, verifies epistemic invariants, signs envelopes, and routes records."""

    def __init__(self, state_dir: Path, signing_key: bytes) -> None:
        self.state_dir = Path(state_dir)
        self.signing_key = signing_key
        self.governor = KuramotoGovernor()
        self.committed_path = self.state_dir / "silver_committed_ledger.jsonl"
        self.quarantine_path = self.state_dir / "silver_scratchpad_quarantine.jsonl"

    @staticmethod
    def extract_telemetry_json(raw_output: str) -> dict[str, Any]:
        matches = list(re.finditer(r"```json\s*([\s\S]*?)\s*```", raw_output, flags=re.IGNORECASE))
        candidate = matches[-1].group(1).strip() if matches else raw_output.strip()
        parsed = json.loads(candidate)
        if not isinstance(parsed, dict):
            raise ValueError("Telemetry block must be a JSON object.")
        return parsed

    @staticmethod
    def sign_envelope(envelope: dict[str, Any], signing_key: bytes) -> tuple[str, str]:
        raw_envelope = json.dumps(envelope, sort_keys=True, separators=(",", ":")).encode("utf-8")
        leaf_hex = hashlib.sha256(b"leaf:" + raw_envelope).hexdigest()
        mac_hex = hmac.new(signing_key, raw_envelope, hashlib.sha256).hexdigest()
        return leaf_hex, mac_hex

    @staticmethod
    def _atomic_append_jsonl(target_path: Path, record: dict[str, Any]) -> None:
        target_path.parent.mkdir(parents=True, exist_ok=True)
        existing: list[str] = []
        if target_path.exists():
            existing = [ln for ln in target_path.read_text(encoding="utf-8").splitlines() if ln.strip()]
        existing.append(json.dumps(record, separators=(",", ":")))
        payload = "\n".join(existing) + "\n"
        with tempfile.NamedTemporaryFile(
            "w", dir=target_path.parent, delete=False, encoding="utf-8"
        ) as tmp:
            tmp.write(payload)
            tmp.flush()
            tmp_path = Path(tmp.name)
        tmp_path.replace(target_path)

    def evaluate_and_route(self, prompt_id: str, raw_model_output: str) -> AuditReceipt:
        telemetry = self.extract_telemetry_json(raw_model_output)
        claim_status = str(telemetry.get("claim_status", "HYPOTHESIS")).upper()
        ready_commit = bool(telemetry.get("ready_for_ledger_commit", False))
        invariants = telemetry.get("invariants_checked", [])
        assumptions = telemetry.get("hidden_assumptions", [])
        falsification = str(telemetry.get("falsification_test", "")).strip()

        quarantine_reason: str | None = None
        if claim_status != "VERIFIED":
            quarantine_reason = "Claim status is HYPOTHESIS; isolated in exploratory scratchpad."
        elif not ready_commit:
            quarantine_reason = "ready_for_ledger_commit is false."
        elif not isinstance(invariants, list) or len(invariants) < 1:
            quarantine_reason = "Insufficient invariants_checked entries."
        elif not isinstance(assumptions, list) or len(assumptions) < 1:
            quarantine_reason = "Missing explicit hidden_assumptions."
        elif len(falsification) < 10:
            quarantine_reason = "Missing or underspecified falsification_test."

        committed = quarantine_reason is None
        r_curr, k_curr, directive = self.governor.step(verified_feedback=committed)
        ts_ms = int(time.time() * 1000)

        envelope: dict[str, Any] = {
            "prompt_id": prompt_id,
            "timestamp_ms": ts_ms,
            "governor": {
                "order_parameter_r": round(r_curr, 6),
                "r_target": self.governor.r_target,
                "coupling_k": round(k_curr, 6),
                "steering_directive": directive,
            },
            "telemetry": {
                "steering_mode_honored": str(telemetry.get("steering_mode_honored", directive)),
                "claim_status": claim_status,
                "core_mechanism": str(telemetry.get("core_mechanism", "")),
                "invariants_checked": [str(x) for x in invariants] if isinstance(invariants, list) else [],
                "hidden_assumptions": [str(x) for x in assumptions] if isinstance(assumptions, list) else [],
                "falsification_test": falsification,
                "ready_for_ledger_commit": committed,
            },
            "committed": committed,
            "quarantine_reason": quarantine_reason,
        }

        leaf_hex, mac_hex = self.sign_envelope(envelope, self.signing_key)
        signed_record = {
            "envelope": envelope,
            "merkle_leaf": leaf_hex,
            "hmac_sha256": mac_hex,
        }

        dest = self.committed_path if committed else self.quarantine_path
        self._atomic_append_jsonl(dest, signed_record)

        return AuditReceipt(
            timestamp_ms=ts_ms,
            merkle_leaf_hex=leaf_hex,
            hmac_sha256_hex=mac_hex,
            order_parameter_r=round(r_curr, 6),
            coupling_k=round(k_curr, 6),
            steering_directive=directive,
            committed=committed,
            quarantine_reason=quarantine_reason,
        )
