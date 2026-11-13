# Gemini Silver — Unified SynapseEdge & Epistemic Watchdog Architecture

**Gemini Silver** is a mechanistic reasoning, homeostatic governance, and cryptographic verification framework built to wrap **Gemini 3.1 Pro** alongside a C++20 spike-timing-dependent plasticity (`synapse_stdp.hpp`) substrate.

Rather than treating dynamical stability and security provenance as separate layers, Gemini Silver unifies **Kuramoto Phase Homeostasis** ($R_{\text{TARGET}} = 0.48$) with an **Epistemic Watchdog** and automated C++20 falsification harness. Every derivation generated in Google AI Studio is steered by live phase coherence, isolated in a quarantine scratchpad until falsification criteria are explicit, signed with raw-byte Merkle leaf commitments and constant-time HMAC-SHA256 receipts, and audited directly against compiled C++20 invariants.

---

## Repository Layout

```text
Gemini-Silver/
├── .github/
│   └── workflows/
│       └── silver-ci.yml              # C++20 compilation, STDP unit tests, and Watchdog CI
├── .gitignore                         # Excludes .silver_state/, secrets, and compiled binaries
├── README.md                          # Architecture specification and API documentation
├── GEMINI_SILVER_SYSTEM_PROMPT.md     # System Instructions for Gemini 3.1 Pro in AI Studio
├── synapse_edge_watchdog.py           # KuramotoGovernor (R_TARGET=0.48) + EpistemicWatchdog
├── synapse_stdp.hpp                   # C++20 alignas(64) bounded STDP substrate
├── tests/
│   └── test_synapse_stdp.cpp          # C++20 unit test suite for STDP invariants
├── scripts/
│   ├── verify_silver_ledger.py        # Ledger verifier, C++20 sweep runner, and atomic demoter
│   └── antigravity_sync_daemon.py     # Local multi-threaded HTTP bridge for AI Studio & UI
└── src/
    └── components/
        └── SilverVerificationPanel.tsx # React/Tailwind epistemic ledger & steering UI
```

---

## Core Subsystems

### 1. Kuramoto Homeostatic Governor ($R_{\text{TARGET}} = 0.48$)

`KuramotoGovernor` (`synapse_edge_watchdog.py`) models $N = 16$ coupled cognitive phase oscillators evolving under:

$$R e^{i\psi} = \frac{1}{N} \sum_{j=1}^{N} e^{i\theta_j}, \qquad \frac{d\theta_j}{dt} = \omega_j + K R \sin(\psi - \theta_j) + \eta_j$$

Adaptive coupling gain $K$ regulates the order parameter $R$ around the critical balance point $R_{\text{TARGET}} = 0.48 \pm 0.06$ and injects a live steering directive into the next AI Studio prompt header:

| Order Parameter Regime | Steering Directive | Operational Effect on Gemini 3.1 Pro |
| :--- | :--- | :--- |
| $R > 0.54$ | `DIVERGE_EXPLORE` | Over-converged state; forces cross-domain mechanism search and challenges hidden assumptions. |
| $0.42 \le R \le 0.54$ | `CRITICAL_BALANCE` | Edge-of-chaos synthesis; pairs novel mechanistic construction with strict boundary checks. |
| $R < 0.42$ | `CONVERGE_SYNTHESIZE` | Fragmented state; consolidates hypotheses into minimal, falsifiable mathematical models. |

### 2. Epistemic Watchdog & Two-Tier Ledger Isolation

`EpistemicWatchdog` gates every reasoning output before persistent storage:

1. **Telemetry Extraction:** Parses the mandatory trailing ````json` telemetry contract (`claim_status`, `core_mechanism`, `invariants_checked`, `hidden_assumptions`, `falsification_test`, `ready_for_ledger_commit`).
2. **Scratchpad vs. Ledger Quarantine:** Outputs marked `HYPOTHESIS`, lacking dimensional/conservation invariants, or missing a concrete falsification test are isolated in `.silver_state/silver_scratchpad_quarantine.jsonl`. Only `VERIFIED` derivations with explicit falsification criteria commit to `.silver_state/silver_committed_ledger.jsonl`.
3. **Cryptographic Provenance:** Every record envelope is canonicalized (`sort_keys=True`, compact separators) and signed using:
   - **Merkle Leaf:** $\text{SHA-256}(\texttt{"leaf:"} \parallel \text{rawBody})$
   - **Audit Receipt:** $\text{HMAC-SHA256}(K_{\text{HMAC}}, \text{rawBody})$

### 3. C++20 STDP Substrate & Automated Falsification Harness

`scripts/verify_silver_ledger.py` audits `silver_committed_ledger.jsonl` against `synapse_stdp.hpp` and `tests/test_synapse_stdp.cpp`:

- **Cryptographic Pre-Check:** Verifies every entry's Merkle leaf and HMAC-SHA256 signature in constant time (`hmac.compare_digest`) prior to execution.
- **Baseline Regression Gate:** Compiles and runs `tests/test_synapse_stdp.cpp` with `-std=c++20` before executing parameter sweeps.
- **C++20 Falsification Sweep:** Extracts sweep parameters (e.g., `Sweep tau from 1ms to 20ms ... if R diverges > 0.75 before tau=5ms`), compiles a C++20 verification driver enforcing `alignof(SynapseState) == 64`, `NaN`/`Inf` rejection, non-monotonic timestamp rejection, and $[w_{\min}, w_{\max}]$ / `max_delta_w` clamping.
- **Two-Phase Atomic Demotion:** Any entry failing signature checks, baseline unit tests, or its parameter sweep is re-signed with `committed: false` and `demotion_provenance` (`prior_merkle_leaf`, `prior_hmac_sha256`), `fsync`-written to `silver_scratchpad_quarantine.jsonl` first, and atomically pruned from `silver_committed_ledger.jsonl`.

---

## Local Sync Daemon API (`scripts/antigravity_sync_daemon.py`)

Default bind address: `http://127.0.0.1:8765` (CORS-enabled for `SilverVerificationPanel.tsx` and `AntigravityBridgeWorkspace.tsx`).

| Method | Route | Description |
| :--- | :--- | :--- |
| `GET` | `/quota-state` | Returns AI Studio quota pause status, exponential backoff state, and local `qwen2.5-coder:7b` failover readiness. |
| `GET` | `/silver-steering` | Reads live Kuramoto $R$, coupling $K$, and `steering_directive` without mutating phase state, returning a paste-ready `[SYNAPSE_EDGE_STEERING]` header. |
| `GET` | `/silver-verifications` | Returns counts and full JSON records for committed, quarantined, and C++20 verifications. |
| `POST` | `/silver-ingest` | Evaluates raw Gemini 3.1 Pro output via `EpistemicWatchdog`, advances Kuramoto phases, signs the envelope, and routes to ledger or quarantine. |
| `POST` | `/silver-verify` | Runs `scripts/verify_silver_ledger.py` (`dry_run: bool`, `compiler: "clang++" \| "g++"`) behind a thread mutex and returns the audit report + updated state. |
| `POST` | `/apply-patch` | Extracts unified git diff blocks, enforces protected-path boundaries, runs `git apply --check --recount`, and applies clean hunks to the working tree. |

---

## Quickstart

1. **Configure AI Studio:** Create a project on Gemini 3.1 Pro, paste `GEMINI_SILVER_SYSTEM_PROMPT.md` into System Instructions, and attach the codebase context bundle (`gemini_silver_context.txt`).
2. **Start the Local Sync Daemon:**
   ```bash
   export SYNAPSE_HMAC_KEY="$(openssl rand -hex 32)"
   python3 scripts/antigravity_sync_daemon.py --host 127.0.0.1 --port 8765
   ```
3. **Run the Closed-Loop Workflow:**
   - Click **Copy Steering Header** in `SilverVerificationPanel` to copy the active `[SYNAPSE_EDGE_STEERING]` directive.
   - Paste the header above your scientific prompt in AI Studio.
   - Paste the Gemini 3.1 Pro response into **Ingest Output** (`Cmd+Enter` / `Ctrl+Enter`) to sign and route the derivation.
   - Click **Verify & Demote** to compile and run `synapse_stdp.hpp` falsification checks against committed entries.
