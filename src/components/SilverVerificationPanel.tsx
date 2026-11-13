import React, { useCallback, useEffect, useMemo, useState } from 'react';

const DEFAULT_DAEMON_URL = '';

export interface GovernorState {
  order_parameter_r: number;
  r_target: number;
  coupling_k: number;
  steering_directive: string;
}

export interface LiveSteeringState extends GovernorState {
  ok: boolean;
  phase_psi: number;
  steering_header: string;
}

export interface TelemetryPayload {
  steering_mode_honored: string;
  claim_status: 'VERIFIED' | 'HYPOTHESIS' | string;
  core_mechanism: string;
  invariants_checked: string[];
  hidden_assumptions: string[];
  falsification_test: string;
  ready_for_ledger_commit: boolean;
}

export interface DemotionProvenance {
  source_ledger?: string;
  prior_merkle_leaf?: string;
  prior_hmac_sha256?: string;
  signature_valid?: boolean;
}

export interface LedgerEnvelope {
  prompt_id: string;
  timestamp_ms: number;
  governor?: GovernorState;
  telemetry?: TelemetryPayload;
  committed: boolean;
  quarantine_reason?: string | null;
  demoted_at_ms?: number;
  demotion_provenance?: DemotionProvenance;
}

export interface SignedLedgerRecord {
  envelope?: LedgerEnvelope;
  merkle_leaf?: string;
  hmac_sha256?: string;
  _corrupt_line?: number;
  _error?: string;
  _raw?: string;
}

export interface VerificationVerdict {
  prompt_id: string;
  merkle_leaf: string;
  verified_signature: boolean;
  passed: boolean;
  demoted_to_quarantine: boolean;
  failure_reason: string | null;
  cpp_metrics?: {
    alignment_64?: boolean;
    sweep?: Array<{ param: number; R: number }>;
    unit_suite?: {
      passed: boolean;
      duration_ms: number;
      exit_code: number;
    };
  };
  timestamp_ms: number;
}

export interface SilverVerificationsState {
  ok: boolean;
  hmac_key_configured: boolean;
  counts: {
    committed: number;
    quarantined: number;
    verifications: number;
  };
  committed: SignedLedgerRecord[];
  quarantined: SignedLedgerRecord[];
  verifications: VerificationVerdict[];
  steering?: LiveSteeringState;
}

export interface VerifyRunReport {
  total_evaluated: number;
  kept_in_committed_ledger: number;
  demoted_to_quarantine: number;
  dry_run: boolean;
}

export interface IngestAuditReceipt {
  timestamp_ms: number;
  merkle_leaf_hex: string;
  hmac_sha256_hex: string;
  order_parameter_r: number;
  coupling_k: number;
  steering_directive: string;
  committed: boolean;
  quarantine_reason: string | null;
}

export interface SilverVerificationPanelProps {
  daemonBaseUrl?: string;
  unitTestArgs?: string;
  externalIngestTrigger?: { promptId: string; rawOutput: string; nonce: number } | null;
}

function truncateHash(hash?: string): string {
  if (!hash) return 'unsigned';
  if (hash.length <= 16) return hash;
  return `${hash.slice(0, 10)}…${hash.slice(-8)}`;
}

function formatTimestamp(ms?: number): string {
  if (!ms) return '—';
  return new Date(ms).toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

const VERIFIED_STDP_SAMPLE = `### Bounded STDP Phase-Locking Derivation [VERIFIED]
By clamping synaptic plasticity updates |Δw| <= 0.05 inside the 64-byte aligned SynapseState struct, phase coherence R remains bounded below 0.75 across the [1ms, 20ms] conduction delay window.

\`\`\`json
{
  "steering_mode_honored": "CRITICAL_BALANCE",
  "claim_status": "VERIFIED",
  "core_mechanism": "64-byte aligned SynapseState enforces |delta_w| <= 0.05 and monotonic spike arrival guards, stabilizing coupled Kuramoto oscillators near R = 0.48.",
  "invariants_checked": [
    "Compile-time alignof(SynapseState) == 64 cache-line boundary invariant",
    "NaN/Inf rejection and monotonic timestamp ordering in apply_stdp()"
  ],
  "hidden_assumptions": [
    "Axonal transmission delay tau remains bounded within [1ms, 20ms]"
  ],
  "falsification_test": "Sweep tau from 1ms to 20ms in synapse_stdp.hpp benchmark; if R diverges > 0.85 before tau=5ms, hypothesis fails.",
  "ready_for_ledger_commit": true
}
\`\`\``;

const HYPOTHESIS_STDP_SAMPLE = `### Uncompensated Delay Resonance [HYPOTHESIS]
Exploratory hypothesis testing whether uncompensated high-gain synaptic coupling can sustain critical balance without inhibitory damping.

\`\`\`json
{
  "steering_mode_honored": "DIVERGE_EXPLORE",
  "claim_status": "HYPOTHESIS",
  "core_mechanism": "Uncompensated dendritic delay amplification attempts phase locking across sparse long-range projections without local inhibitory feedback.",
  "invariants_checked": [
    "Compile-time alignof(SynapseState) == 64 cache-line boundary invariant"
  ],
  "hidden_assumptions": [
    "Zero local interneuron feedback delay across cortical columns"
  ],
  "falsification_test": "Sweep tau from 1ms to 20ms in synapse_stdp.hpp benchmark; if R diverges > 0.52 before tau=10ms, hypothesis fails.",
  "ready_for_ledger_commit": false
}
\`\`\``;

export const SilverVerificationPanel: React.FC<SilverVerificationPanelProps> = ({
  daemonBaseUrl = DEFAULT_DAEMON_URL,
  unitTestArgs = '--json',
  externalIngestTrigger = null,
}) => {
  const [data, setData] = useState<SilverVerificationsState | null>(null);
  const [steering, setSteering] = useState<LiveSteeringState | null>(null);
  const [activeTab, setActiveTab] = useState<'committed' | 'quarantined'>('committed');
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [runningMode, setRunningMode] = useState<'dry' | 'demote' | null>(null);
  const [isCopyingSteering, setIsCopyingSteering] = useState<boolean>(false);
  const [steeringCopied, setSteeringCopied] = useState<boolean>(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [lastReport, setLastReport] = useState<{
    allPassed: boolean;
    report: VerifyRunReport;
  } | null>(null);
  const [copiedLeaf, setCopiedLeaf] = useState<string | null>(null);

  // Quick-ingest drawer state
  const [isIngestOpen, setIsIngestOpen] = useState<boolean>(false);
  const [ingestPromptId, setIngestPromptId] = useState<string>('');
  const [ingestRawOutput, setIngestRawOutput] = useState<string>('');
  const [isIngesting, setIsIngesting] = useState<boolean>(false);
  const [lastIngestResult, setLastIngestResult] = useState<{
    promptId: string;
    receipt: IngestAuditReceipt;
  } | null>(null);

  const hasJsonBlock = useMemo(
    () => /```json\s*[\s\S]*?\s*```/.test(ingestRawOutput),
    [ingestRawOutput]
  );

  const loadState = useCallback(async () => {
    setIsLoading(true);
    setErrorMsg(null);
    try {
      const [verificationsRes, steeringRes] = await Promise.all([
        fetch(`${daemonBaseUrl}/silver-verifications`),
        fetch(`${daemonBaseUrl}/silver-steering`),
      ]);
      const verificationsJson = await verificationsRes.json();
      if (!verificationsRes.ok || !verificationsJson.ok) {
        throw new Error(verificationsJson.error || `HTTP ${verificationsRes.status}`);
      }
      setData(verificationsJson as SilverVerificationsState);

      if (steeringRes.ok) {
        const steeringJson = await steeringRes.json();
        if (steeringJson.ok) {
          setSteering(steeringJson as LiveSteeringState);
        }
      } else if (verificationsJson.steering) {
        setSteering(verificationsJson.steering as LiveSteeringState);
      }
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Failed to reach sync daemon.');
    } finally {
      setIsLoading(false);
    }
  }, [daemonBaseUrl]);

  useEffect(() => {
    void loadState();
  }, [loadState]);

  const executeIngest = useCallback(
    async (promptIdInput: string, rawTextInput: string) => {
      if (!rawTextInput.trim() || isIngesting) return;
      setIsIngesting(true);
      setErrorMsg(null);
      try {
        const res = await fetch(`${daemonBaseUrl}/silver-ingest`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            prompt_id: promptIdInput.trim() || undefined,
            raw_output: rawTextInput,
          }),
        });
        const json = await res.json();
        if (!res.ok || !json.ok) {
          throw new Error(json.error || `Ingest failed (HTTP ${res.status})`);
        }

        const receipt = json.receipt as IngestAuditReceipt;
        setLastIngestResult({
          promptId: String(json.prompt_id),
          receipt,
        });

        if (json.state) {
          const updatedState = json.state as SilverVerificationsState;
          setData(updatedState);
          if (updatedState.steering) {
            setSteering(updatedState.steering);
          }
        } else {
          await loadState();
        }

        setActiveTab(receipt.committed ? 'committed' : 'quarantined');
        setIngestPromptId('');
        setIngestRawOutput('');
      } catch (err) {
        setErrorMsg(err instanceof Error ? err.message : 'Failed to ingest derivation output.');
      } finally {
        setIsIngesting(false);
      }
    },
    [daemonBaseUrl, isIngesting, loadState]
  );

  useEffect(() => {
    if (externalIngestTrigger && externalIngestTrigger.rawOutput) {
      void executeIngest(externalIngestTrigger.promptId, externalIngestTrigger.rawOutput);
    }
  }, [externalIngestTrigger, executeIngest]);

  const handleCopySteeringHeader = async () => {
    if (isCopyingSteering) return;
    setIsCopyingSteering(true);
    setErrorMsg(null);
    try {
      const res = await fetch(`${daemonBaseUrl}/silver-steering`);
      const json = await res.json();
      if (!res.ok || !json.ok || !json.steering_header) {
        throw new Error(json.error || `Failed to fetch steering header (HTTP ${res.status})`);
      }
      const live = json as LiveSteeringState;
      setSteering(live);
      try {
        await navigator.clipboard.writeText(live.steering_header);
      } catch {
        // Fallback in headless context
      }
      setSteeringCopied(true);
      setTimeout(() => setSteeringCopied(false), 2000);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Failed to copy steering header.');
    } finally {
      setIsCopyingSteering(false);
    }
  };

  const handleIngestSubmit = async () => {
    await executeIngest(ingestPromptId, ingestRawOutput);
  };

  const handleRunVerification = async (dryRun: boolean) => {
    setRunningMode(dryRun ? 'dry' : 'demote');
    setErrorMsg(null);
    try {
      const res = await fetch(`${daemonBaseUrl}/silver-verify`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          dry_run: dryRun,
          unit_test_args: unitTestArgs,
        }),
      });
      const json = await res.json();
      if (!res.ok || !json.ok) {
        throw new Error(json.error || `Verification failed (HTTP ${res.status})`);
      }
      setLastReport({
        allPassed: Boolean(json.all_passed),
        report: json.report as VerifyRunReport,
      });
      if (json.state) {
        const updatedState = json.state as SilverVerificationsState;
        setData(updatedState);
        if (updatedState.steering) {
          setSteering(updatedState.steering);
        }
      } else {
        await loadState();
      }
      if (!dryRun && json.report?.demoted_to_quarantine > 0) {
        setActiveTab('quarantined');
      }
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Verification execution error.');
    } finally {
      setRunningMode(null);
    }
  };

  const handleCopyLeaf = async (leaf?: string) => {
    if (!leaf) return;
    try {
      await navigator.clipboard.writeText(leaf);
    } catch {
      // Clipboard fallback
    }
    setCopiedLeaf(leaf);
    setTimeout(() => setCopiedLeaf((prev) => (prev === leaf ? null : prev)), 1500);
  };

  const verdictByPrompt = useMemo(() => {
    const map = new Map<string, VerificationVerdict>();
    for (const v of data?.verifications ?? []) {
      map.set(v.prompt_id, v);
    }
    return map;
  }, [data?.verifications]);

  const records =
    activeTab === 'committed' ? (data?.committed ?? []) : (data?.quarantined ?? []);

  return (
    <section
      aria-label="Silver Epistemic Ledger and C++20 Watchdog"
      className="border border-slate-200 bg-white text-slate-900"
    >
      {/* Header & Action Controls */}
      <div className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-200 px-6 py-4">
        <div className="space-y-1">
          <div className="flex flex-wrap items-center gap-3">
            <h2 className="text-base font-semibold text-slate-900">
              05. Cryptographic Merkle/HMAC Ledger &amp; C++20 STDP Falsification Gate
            </h2>
          </div>
          <p className="text-xs text-slate-500 font-mono tabular-nums">
            <span>
              SHA-256(&quot;leaf:&quot; || rawBody) + HMAC-SHA256
            </span>
            <span className="mx-2" aria-hidden="true">·</span>
            <span>Kernel: synapse_stdp.hpp (alignas(64))</span>
            {steering && (
              <>
                <span className="mx-2" aria-hidden="true">·</span>
                <span className="text-slate-900 font-semibold">
                  R={steering.order_parameter_r.toFixed(3)} / K={steering.coupling_k.toFixed(2)} ({steering.steering_directive})
                </span>
              </>
            )}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => void handleCopySteeringHeader()}
            disabled={isCopyingSteering}
            title="Fetch live Kuramoto R, K, and steering_directive and copy prompt header"
            className="inline-flex items-center gap-1.5 border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-100 transition-colors whitespace-nowrap shrink-0"
          >
            {steeringCopied
              ? 'Copied Steering Header'
              : isCopyingSteering
              ? 'Fetching…'
              : 'Copy Steering Header'}
          </button>

          <button
            type="button"
            onClick={() => setIsIngestOpen((prev) => !prev)}
            className={`inline-flex items-center gap-1.5 border px-3 py-1.5 text-xs font-medium transition-colors whitespace-nowrap shrink-0 ${
              isIngestOpen
                ? 'border-blue-600 bg-blue-50 text-blue-800'
                : 'border-slate-300 bg-white text-slate-700 hover:bg-slate-100'
            }`}
          >
            {isIngestOpen ? 'Close Ingest' : 'Ingest Output'}
          </button>

          <button
            type="button"
            onClick={() => void loadState()}
            disabled={isLoading || runningMode !== null}
            className="inline-flex items-center gap-1.5 border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-100 disabled:opacity-50 transition-colors whitespace-nowrap shrink-0"
          >
            Refresh
          </button>

          <button
            type="button"
            onClick={() => void handleRunVerification(true)}
            disabled={runningMode !== null || !data?.hmac_key_configured}
            className="inline-flex items-center gap-1.5 border border-amber-300 bg-amber-50 px-3 py-1.5 text-xs font-semibold text-amber-900 hover:bg-amber-100 disabled:opacity-40 transition-colors whitespace-nowrap shrink-0"
          >
            {runningMode === 'dry' ? 'Running Dry-Run…' : 'Dry-Run'}
          </button>

          <button
            type="button"
            onClick={() => void handleRunVerification(false)}
            disabled={runningMode !== null || !data?.hmac_key_configured}
            className="inline-flex items-center gap-1.5 bg-blue-600 px-3.5 py-1.5 text-xs font-semibold text-white hover:bg-blue-700 disabled:opacity-40 transition-colors whitespace-nowrap shrink-0"
          >
            {runningMode === 'demote' ? 'Verifying & Demoting…' : 'Verify & Demote'}
          </button>
        </div>
      </div>

      {/* Collapsible Quick-Ingest Drawer */}
      {isIngestOpen && (
        <div className="space-y-3 border-b border-slate-200 bg-slate-50 px-6 py-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex flex-wrap items-center gap-3">
              <span className="text-xs font-semibold text-slate-900">
                Quick-Ingest Mechanistic Derivation Output
              </span>
              <span className="font-mono text-xs text-slate-600">
                {hasJsonBlock
                  ? '● ```json telemetry detected'
                  : '▲ awaiting ```json telemetry block'}
              </span>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => {
                  setIngestPromptId(`stdp-verified-${Math.floor(Date.now() / 1000) % 1000}`);
                  setIngestRawOutput(VERIFIED_STDP_SAMPLE);
                }}
                className="px-2.5 py-1 text-xs font-mono border border-slate-300 bg-white text-slate-700 hover:bg-slate-100 whitespace-nowrap shrink-0"
              >
                Load Verified Sample
              </button>
              <button
                type="button"
                onClick={() => {
                  setIngestPromptId(`thalamic-hyp-${Math.floor(Date.now() / 1000) % 1000}`);
                  setIngestRawOutput(HYPOTHESIS_STDP_SAMPLE);
                }}
                className="px-2.5 py-1 text-xs font-mono border border-slate-300 bg-white text-slate-700 hover:bg-slate-100 whitespace-nowrap shrink-0"
              >
                Load Hypothesis Sample
              </button>
              <input
                type="text"
                aria-label="Optional prompt ID"
                value={ingestPromptId}
                onChange={(e) => setIngestPromptId(e.target.value)}
                placeholder="Optional prompt_id (e.g. thalamic-delay-02)"
                className="w-60 border border-slate-300 bg-white px-2.5 py-1 font-mono text-xs text-slate-900 placeholder-slate-400 focus:border-blue-600 focus:outline-none"
              />
            </div>
          </div>

          <textarea
            rows={6}
            aria-label="Raw derivation output with trailing JSON telemetry block"
            value={ingestRawOutput}
            onChange={(e) => setIngestRawOutput(e.target.value)}
            onKeyDown={(e) => {
              if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
                e.preventDefault();
                void handleIngestSubmit();
              }
            }}
            placeholder="Paste full reasoning response here (including the trailing ```json telemetry block)… Press Cmd+Enter / Ctrl+Enter to evaluate, sign, and route."
            className="w-full border border-slate-300 bg-white p-3 font-mono text-xs leading-relaxed text-slate-900 placeholder-slate-400 focus:border-blue-600 focus:outline-none"
          />

          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="text-xs text-slate-600">
              Routes <code className="font-mono text-emerald-700">VERIFIED</code> entries with valid
              invariants to <code className="font-mono">silver_committed_ledger.jsonl</code>;
              isolates <code className="font-mono text-amber-700">HYPOTHESIS</code> entries in
              quarantine.
            </span>

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => {
                  setIngestRawOutput('');
                  setIngestPromptId('');
                }}
                disabled={isIngesting || (!ingestRawOutput && !ingestPromptId)}
                className="border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-100 disabled:opacity-40 whitespace-nowrap shrink-0"
              >
                Clear
              </button>

              <button
                type="button"
                onClick={() => void handleIngestSubmit()}
                disabled={isIngesting || !ingestRawOutput.trim() || !data?.hmac_key_configured}
                className="inline-flex items-center gap-1.5 bg-blue-600 px-3.5 py-1.5 text-xs font-semibold text-white hover:bg-blue-700 disabled:opacity-40 whitespace-nowrap shrink-0"
              >
                {isIngesting ? 'Evaluating & Signing…' : 'Evaluate, Sign & Route'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Error Banner */}
      {errorMsg && (
        <div
          role="alert"
          className="border-b border-rose-300 bg-rose-50 px-6 py-2.5 text-xs text-rose-800"
        >
          {errorMsg}
        </div>
      )}

      {/* Last Ingest Receipt Banner */}
      {lastIngestResult && (
        <div
          className={`flex flex-wrap items-center justify-between gap-2 border-b px-6 py-2.5 text-xs ${
            lastIngestResult.receipt.committed
              ? 'border-emerald-200 bg-emerald-50 text-emerald-900'
              : 'border-amber-200 bg-amber-50 text-amber-900'
          }`}
        >
          <div className="flex flex-wrap items-center gap-3 font-mono tabular-nums">
            <span className="font-semibold">
              {lastIngestResult.receipt.committed
                ? '● COMMITTED TO LEDGER'
                : '▲ ROUTED TO QUARANTINE'}
            </span>
            <span>{lastIngestResult.promptId}</span>
            <span aria-hidden="true">·</span>
            <span>
              R={lastIngestResult.receipt.order_parameter_r.toFixed(3)} (
              {lastIngestResult.receipt.steering_directive})
            </span>
            <span aria-hidden="true">·</span>
            <span>leaf:{truncateHash(lastIngestResult.receipt.merkle_leaf_hex)}</span>
            {lastIngestResult.receipt.quarantine_reason && (
              <span>— {lastIngestResult.receipt.quarantine_reason}</span>
            )}
          </div>
          <button
            type="button"
            onClick={() => setLastIngestResult(null)}
            className="text-slate-600 hover:text-slate-900 font-medium"
          >
            Dismiss
          </button>
        </div>
      )}

      {/* Last Verification Run Summary */}
      {lastReport && (
        <div
          className={`flex flex-wrap items-center justify-between gap-2 border-b px-6 py-2.5 text-xs ${
            lastReport.allPassed
              ? 'border-emerald-200 bg-emerald-50 text-emerald-900'
              : 'border-amber-200 bg-amber-50 text-amber-900'
          }`}
        >
          <div className="flex flex-wrap items-center gap-3 font-mono tabular-nums">
            <span className="font-semibold">
              {lastReport.report.dry_run ? 'DRY-RUN COMPLETE' : 'C++20 LEDGER SWEEP COMPLETE'}
            </span>
            <span aria-hidden="true">·</span>
            <span>
              Evaluated: <strong>{lastReport.report.total_evaluated}</strong>
            </span>
            <span aria-hidden="true">·</span>
            <span>
              Kept: <strong>{lastReport.report.kept_in_committed_ledger}</strong>
            </span>
            <span aria-hidden="true">·</span>
            <span>
              {lastReport.report.dry_run ? 'Would Demote:' : 'Demoted:'}{' '}
              <strong>{lastReport.report.demoted_to_quarantine}</strong>
            </span>
          </div>
          <button
            type="button"
            onClick={() => setLastReport(null)}
            className="text-slate-600 hover:text-slate-900 font-medium"
          >
            Dismiss
          </button>
        </div>
      )}

      {/* Tabs: Committed vs. Quarantined */}
      <div className="flex flex-wrap items-center justify-between border-b border-slate-200 bg-slate-50 px-6">
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => setActiveTab('committed')}
            className={`border-b-2 px-3 py-2.5 text-xs font-semibold transition-colors whitespace-nowrap shrink-0 ${
              activeTab === 'committed'
                ? 'border-blue-600 text-blue-700'
                : 'border-transparent text-slate-600 hover:text-slate-900'
            }`}
          >
            Committed Ledger ({data?.counts.committed ?? 0})
          </button>

          <button
            type="button"
            onClick={() => setActiveTab('quarantined')}
            className={`border-b-2 px-3 py-2.5 text-xs font-semibold transition-colors whitespace-nowrap shrink-0 ${
              activeTab === 'quarantined'
                ? 'border-amber-600 text-amber-800'
                : 'border-transparent text-slate-600 hover:text-slate-900'
            }`}
          >
            Quarantined Scratchpad ({data?.counts.quarantined ?? 0})
          </button>
        </div>

        <span className="font-mono text-xs text-slate-500 tabular-nums py-2">
          {data?.counts.verifications ?? 0} C++20 audit verdicts recorded
        </span>
      </div>

      {/* Entry List */}
      <div className="max-h-[34rem] divide-y divide-slate-200 overflow-y-auto">
        {isLoading && !data ? (
          <div className="p-8 text-center text-xs text-slate-500">
            Loading cryptographic ledger state…
          </div>
        ) : records.length === 0 ? (
          <div className="p-8 text-center text-xs text-slate-500">
            No entries in{' '}
            {activeTab === 'committed'
              ? 'silver_committed_ledger.jsonl'
              : 'silver_scratchpad_quarantine.jsonl'}
            .
          </div>
        ) : (
          records.map((rec, idx) => {
            if (rec._corrupt_line) {
              return (
                <div key={`corrupt-${idx}`} className="bg-rose-50 p-4 text-xs text-rose-800">
                  Corrupt JSONL line #{rec._corrupt_line}: {rec._error}
                </div>
              );
            }

            const env = rec.envelope;
            const promptId = env?.prompt_id ?? `entry-${idx + 1}`;
            const verdict = verdictByPrompt.get(promptId);
            const leaf = rec.merkle_leaf;
            const priorLeaf = env?.demotion_provenance?.prior_merkle_leaf;

            return (
              <div
                key={`${leaf ?? promptId}-${idx}`}
                className="space-y-2.5 px-6 py-4 hover:bg-slate-50"
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex flex-wrap items-center gap-2 font-mono text-xs tabular-nums">
                    <span className="font-semibold text-slate-900">{promptId}</span>

                    {env?.telemetry?.claim_status && (
                      <>
                        <span aria-hidden="true">·</span>
                        <span
                          className={`font-semibold ${
                            env.telemetry.claim_status === 'VERIFIED'
                              ? 'text-emerald-700'
                              : 'text-amber-700'
                          }`}
                        >
                          [{env.telemetry.claim_status}]
                        </span>
                      </>
                    )}

                    {env?.governor && (
                      <>
                        <span aria-hidden="true">·</span>
                        <span className="text-slate-600">
                          R={env.governor.order_parameter_r.toFixed(3)} /{' '}
                          {env.governor.steering_directive}
                        </span>
                      </>
                    )}

                    {verdict && (
                      <>
                        <span aria-hidden="true">·</span>
                        <span
                          className={`font-semibold ${
                            verdict.passed ? 'text-blue-700' : 'text-rose-700'
                          }`}
                        >
                          C++20: {verdict.passed ? 'PASS' : 'FAIL'}
                        </span>
                      </>
                    )}
                  </div>

                  <div className="flex items-center gap-3 font-mono text-xs tabular-nums">
                    <span className="text-slate-500">{formatTimestamp(env?.timestamp_ms)}</span>
                    <button
                      type="button"
                      onClick={() => void handleCopyLeaf(leaf)}
                      title={leaf ? `SHA-256("leaf:" || rawBody): ${leaf}` : 'No Merkle leaf'}
                      className="inline-flex items-center gap-1 border border-slate-300 bg-slate-50 px-2 py-0.5 text-xs text-slate-700 hover:bg-slate-100 whitespace-nowrap shrink-0"
                    >
                      <span className="text-slate-400">leaf:</span>
                      <span>{truncateHash(leaf)}</span>
                      {copiedLeaf === leaf && (
                        <span className="ml-1 text-emerald-700 font-semibold">copied</span>
                      )}
                    </button>
                  </div>
                </div>

                {env?.telemetry?.core_mechanism && (
                  <p className="text-sm leading-relaxed text-slate-800">
                    {env.telemetry.core_mechanism}
                  </p>
                )}

                {env?.telemetry?.falsification_test && (
                  <div className="border border-slate-200 bg-slate-50 px-3.5 py-2 font-mono text-xs text-slate-700">
                    <span className="mr-1.5 text-slate-500">Falsification Sweep:</span>
                    {env.telemetry.falsification_test}
                  </div>
                )}

                {(env?.quarantine_reason || verdict?.failure_reason) && (
                  <div className="flex flex-wrap items-center justify-between gap-2 border border-rose-200 bg-rose-50 px-3.5 py-2 text-xs text-rose-900">
                    <span>
                      <strong>Audit Reason:</strong>{' '}
                      {verdict?.failure_reason || env?.quarantine_reason}
                    </span>
                    {priorLeaf && (
                      <span className="font-mono text-xs text-rose-700 tabular-nums">
                        prior_leaf: {truncateHash(priorLeaf)}
                      </span>
                    )}
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>
    </section>
  );
};

export default SilverVerificationPanel;
