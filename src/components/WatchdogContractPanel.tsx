import React, { useState } from 'react';
import { Check, Copy, ShieldAlert, ShieldCheck, ArrowUpRight, CheckCircle2 } from 'lucide-react';
import {
  formatWatchdogJsonBlock,
  validateWatchdogContract,
  type DerivationRecord,
} from '../engine/epistemicEngine';

interface WatchdogContractPanelProps {
  record: DerivationRecord;
  onRunFalsificationPass: (recordId: string) => void;
  onCommitToLedger: (recordId: string) => void;
}

export const WatchdogContractPanel: React.FC<WatchdogContractPanelProps> = ({
  record,
  onRunFalsificationPass,
  onCommitToLedger,
}) => {
  const [copied, setCopied] = useState(false);
  const [commitGateMessage, setCommitGateMessage] = useState<string | null>(null);

  const contract = record.watchdogContract;
  const audit = validateWatchdogContract(
    contract,
    record.steeringMode,
    record.previousLedgerHash
  );
  const fencedJson = formatWatchdogJsonBlock(contract);

  const handleCopyJson = async () => {
    try {
      await navigator.clipboard.writeText(fencedJson);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    }
  };

  const handleAttemptCommit = () => {
    if (!contract.ready_for_ledger_commit || contract.claim_status === 'HYPOTHESIS') {
      setCommitGateMessage(
        'Watchdog Scratchpad Isolation Gate: Unverified [HYPOTHESIS] derivations cannot be committed directly to the Epistemic Ledger. Execute the Falsification Verification Pass first to validate boundary residuals.'
      );
      return;
    }
    setCommitGateMessage(null);
    onCommitToLedger(record.id);
  };

  return (
    <section
      aria-label="Mandatory Watchdog Output Contract"
      className="bg-white border border-slate-200 p-6"
    >
      <div className="flex flex-wrap items-start justify-between gap-4 pb-4 border-b border-slate-200">
        <div>
          <h2 className="text-base font-semibold text-slate-900">
            03. Adversarial Watchdog Self-Check & Mandatory Output Contract
          </h2>
          <p className="text-xs text-slate-500 mt-1 font-mono tabular-nums">
            <span>State Digest: {audit.stateHash}</span>
            <span className="mx-2" aria-hidden="true">·</span>
            <span>Parent Hash: {record.previousLedgerHash ?? 'GENESIS_00000000'}</span>
            <span className="mx-2" aria-hidden="true">·</span>
            <span>Zone: {record.isolationZone}</span>
          </p>
        </div>

        {/* Text-First Status Indicator (Non-Hue-Only per Science Design Spec) */}
        <div className="flex items-center gap-4 text-xs font-mono">
          {record.isolationZone === 'LEDGER' ? (
            <span className="text-emerald-700 font-semibold">
              ● Verified Ledger Invariant
            </span>
          ) : contract.ready_for_ledger_commit ? (
            <span className="text-blue-700 font-semibold">
              ● Falsification Passed (Ready for Commit)
            </span>
          ) : (
            <span className="text-amber-700 font-semibold">
              ▲ Scratchpad Isolated ([HYPOTHESIS])
            </span>
          )}
        </div>
      </div>

      {/* Invariants Checked & Hidden Assumptions Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 py-5 border-b border-slate-200">
        <div>
          <h3 className="text-xs font-mono uppercase tracking-wider text-slate-500 mb-2.5">
            Invariants Checked ({contract.invariants_checked.length})
          </h3>
          <ul className="space-y-2 text-sm text-slate-800">
            {contract.invariants_checked.map((item, idx) => (
              <li key={idx} className="flex items-start gap-2 leading-relaxed">
                <span className="font-mono text-xs text-blue-600 mt-0.5 shrink-0">
                  [{idx + 1}]
                </span>
                <span>{item}</span>
              </li>
            ))}
          </ul>
        </div>

        <div>
          <h3 className="text-xs font-mono uppercase tracking-wider text-slate-500 mb-2.5">
            Explicit Hidden Assumptions ({contract.hidden_assumptions.length})
          </h3>
          <ul className="space-y-2 text-sm text-slate-800">
            {contract.hidden_assumptions.map((assumption, idx) => (
              <li key={idx} className="flex items-start gap-2 leading-relaxed">
                <span className="font-mono text-xs text-amber-700 mt-0.5 shrink-0">
                  [A{idx + 1}]
                </span>
                <span>{assumption}</span>
              </li>
            ))}
          </ul>
        </div>
      </div>

      {/* Quantitative Falsification Test */}
      <div className="py-4 border-b border-slate-200">
        <div className="flex items-center justify-between gap-2 mb-1.5">
          <h3 className="text-xs font-mono uppercase tracking-wider text-slate-500">
            Mandatory Falsification Protocol
          </h3>
          <span className="text-xs font-mono text-slate-500 tabular-nums">
            Empirical Residual: {record.empiricalDeviationPct.toFixed(2)}%
          </span>
        </div>
        <p className="text-sm text-slate-900 leading-relaxed bg-slate-50 border border-slate-200 p-3.5 font-normal">
          {contract.falsification_test}
        </p>
      </div>

      {/* Fenced JSON Output Contract & Isolation Gate Actions */}
      <div className="pt-5 grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        <div className="lg:col-span-7">
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs font-mono text-slate-500">
              Watchdog Daemon Routing Payload (Mandatory Fenced JSON Schema)
            </span>
            <button
              type="button"
              onClick={handleCopyJson}
              className="inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 rounded transition-colors whitespace-nowrap shrink-0"
            >
              {copied ? (
                <>
                  <Check className="w-3.5 h-3.5 text-emerald-600" />
                  <span>Copied JSON</span>
                </>
              ) : (
                <>
                  <Copy className="w-3.5 h-3.5" />
                  <span>Copy JSON Block</span>
                </>
              )}
            </button>
          </div>
          <pre
            data-testid="watchdog-json-contract"
            className="bg-slate-900 text-slate-100 p-4 text-xs font-mono overflow-x-auto leading-relaxed border border-slate-800"
          >
            {fencedJson}
          </pre>
        </div>

        {/* Scratchpad vs. Ledger Isolation Enforcement Panel */}
        <div className="lg:col-span-5 bg-slate-50 border border-slate-200 p-4 flex flex-col justify-between space-y-4">
          <div>
            <div className="flex items-center gap-2 text-slate-900 font-semibold text-sm">
              {record.isolationZone === 'LEDGER' ? (
                <ShieldCheck className="w-4 h-4 text-emerald-700 shrink-0" />
              ) : (
                <ShieldAlert className="w-4 h-4 text-amber-700 shrink-0" />
              )}
              <span>Scratchpad vs. Ledger Isolation Gate</span>
            </div>
            <p className="text-xs text-slate-600 mt-1.5 leading-relaxed">
              Exploratory derivations tagged <code className="font-mono">[HYPOTHESIS]</code> remain
              quarantined in the Scratchpad until boundary singularity and dimensional residuals pass
              falsification (<code className="font-mono">ready_for_ledger_commit: true</code>).
            </p>
          </div>

          <div className="space-y-1.5 text-xs font-mono border-t border-b border-slate-200 py-3">
            <div className="flex justify-between">
              <span className="text-slate-500">steering_mode_honored:</span>
              <span className="text-slate-900 font-semibold">{contract.steering_mode_honored}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-500">claim_status:</span>
              <span
                className={
                  contract.claim_status === 'VERIFIED'
                    ? 'text-emerald-700 font-semibold'
                    : 'text-amber-700 font-semibold'
                }
              >
                [{contract.claim_status}]
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-500">ready_for_ledger_commit:</span>
              <span className="text-slate-900 font-semibold">
                {String(contract.ready_for_ledger_commit)}
              </span>
            </div>
          </div>

          {commitGateMessage && (
            <div
              role="alert"
              className="p-3 bg-amber-50 border border-amber-300 text-xs text-amber-900 leading-relaxed"
            >
              {commitGateMessage}
            </div>
          )}

          <div className="flex flex-col sm:flex-row gap-2.5">
            {!contract.ready_for_ledger_commit && (
              <button
                type="button"
                onClick={() => {
                  setCommitGateMessage(null);
                  onRunFalsificationPass(record.id);
                }}
                className="flex-1 inline-flex items-center justify-center gap-1.5 px-4 py-2 text-xs font-semibold text-slate-900 bg-white border border-slate-300 hover:bg-slate-100 transition-colors whitespace-nowrap shrink-0"
              >
                <CheckCircle2 className="w-3.5 h-3.5 text-blue-600" />
                <span>Run Falsification Pass</span>
              </button>
            )}

            {record.isolationZone !== 'LEDGER' ? (
              <button
                type="button"
                onClick={handleAttemptCommit}
                className={`flex-1 inline-flex items-center justify-center gap-1.5 px-4 py-2 text-xs font-semibold transition-colors whitespace-nowrap shrink-0 ${
                  contract.ready_for_ledger_commit
                    ? 'bg-blue-600 text-white hover:bg-blue-700'
                    : 'bg-slate-200 text-slate-700 hover:bg-slate-300'
                }`}
              >
                <span>Commit to Epistemic Ledger</span>
                <ArrowUpRight className="w-3.5 h-3.5" />
              </button>
            ) : (
              <div className="w-full py-2 px-3 bg-emerald-50 border border-emerald-200 text-emerald-800 text-xs font-mono text-center">
                ✓ Committed to Immutable Epistemic Ledger
              </div>
            )}
          </div>
        </div>
      </div>
    </section>
  );
};
