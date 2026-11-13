import React, { useState } from 'react';
import { ArrowUpRight, CheckCircle2, FileCode2 } from 'lucide-react';
import type { DerivationRecord } from '../engine/epistemicEngine';

interface IsolationLedgerViewProps {
  records: DerivationRecord[];
  activeRecordId: string;
  onSelectRecord: (id: string) => void;
  onRunFalsificationPass: (id: string) => void;
  onCommitToLedger: (id: string) => void;
}

export const IsolationLedgerView: React.FC<IsolationLedgerViewProps> = ({
  records,
  activeRecordId,
  onSelectRecord,
  onRunFalsificationPass,
  onCommitToLedger,
}) => {
  const [zoneFilter, setZoneFilter] = useState<'ALL' | 'SCRATCHPAD' | 'LEDGER'>('ALL');

  const scratchpadCount = records.filter((r) => r.isolationZone === 'SCRATCHPAD').length;
  const ledgerCount = records.filter((r) => r.isolationZone === 'LEDGER').length;

  const filteredRecords = records.filter((r) => {
    if (zoneFilter === 'ALL') return true;
    return r.isolationZone === zoneFilter;
  });

  return (
    <section
      aria-label="Scratchpad vs. Epistemic Ledger Isolation Registry"
      className="bg-white border border-slate-200 p-6"
    >
      <div className="flex flex-wrap items-center justify-between gap-4 pb-4 border-b border-slate-200">
        <div>
          <h2 className="text-base font-semibold text-slate-900">
            04. Scratchpad vs. Epistemic Ledger Isolation Registry
          </h2>
          <p className="text-xs text-slate-500 mt-0.5 font-mono tabular-nums">
            <span>Total Derivations: {records.length}</span>
            <span className="mx-2" aria-hidden="true">·</span>
            <span>Quarantined Scratchpad: {scratchpadCount}</span>
            <span className="mx-2" aria-hidden="true">·</span>
            <span>Committed Ledger Invariants: {ledgerCount}</span>
          </p>
        </div>

        {/* Interactive Segmented Filter Controls */}
        <div
          role="group"
          aria-label="Filter derivations by isolation zone"
          className="flex items-center gap-1 p-1 bg-slate-100 rounded-md"
        >
          <button
            type="button"
            onClick={() => setZoneFilter('ALL')}
            className={`px-3 py-1.5 text-xs font-medium rounded transition-colors whitespace-nowrap shrink-0 ${
              zoneFilter === 'ALL'
                ? 'bg-white text-slate-900 shadow-xs'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            All Branches ({records.length})
          </button>
          <button
            type="button"
            onClick={() => setZoneFilter('SCRATCHPAD')}
            className={`px-3 py-1.5 text-xs font-medium rounded transition-colors whitespace-nowrap shrink-0 ${
              zoneFilter === 'SCRATCHPAD'
                ? 'bg-white text-slate-900 shadow-xs'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            Scratchpad [{scratchpadCount}]
          </button>
          <button
            type="button"
            onClick={() => setZoneFilter('LEDGER')}
            className={`px-3 py-1.5 text-xs font-medium rounded transition-colors whitespace-nowrap shrink-0 ${
              zoneFilter === 'LEDGER'
                ? 'bg-white text-slate-900 shadow-xs'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            Epistemic Ledger [{ledgerCount}]
          </button>
        </div>
      </div>

      {/* Registry Table */}
      <div className="overflow-x-auto mt-4">
        <table className="w-full text-left border-collapse">
          <thead>
            <tr className="border-b border-slate-200 text-[11px] font-mono uppercase text-slate-500">
              <th className="py-2.5 pr-4 font-medium">Isolation State</th>
              <th className="py-2.5 px-4 font-medium">Mechanistic Derivation & Domain</th>
              <th className="py-2.5 px-4 font-medium">Steering / R</th>
              <th className="py-2.5 px-4 font-medium">Claim Tag</th>
              <th className="py-2.5 px-4 font-medium">Watchdog Digest</th>
              <th className="py-2.5 pl-4 text-right font-medium">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-200 text-sm">
            {filteredRecords.map((rec) => {
              const isSelected = rec.id === activeRecordId;
              const isLedger = rec.isolationZone === 'LEDGER';
              return (
                <tr
                  key={rec.id}
                  className={`transition-colors ${
                    isSelected ? 'bg-blue-50/50' : 'hover:bg-slate-50'
                  }`}
                >
                  <td className="py-3.5 pr-4 font-mono text-xs whitespace-nowrap">
                    {isLedger ? (
                      <span className="text-emerald-700 font-semibold">● LEDGER_COMMITTED</span>
                    ) : (
                      <span className="text-amber-700 font-semibold">▲ SCRATCHPAD_ISOLATED</span>
                    )}
                  </td>
                  <td className="py-3.5 px-4">
                    <div className="font-semibold text-slate-900">{rec.title}</div>
                    <div className="text-xs text-slate-500 mt-0.5 flex flex-wrap items-center gap-1.5">
                      <span>{rec.domain}</span>
                      <span aria-hidden="true">·</span>
                      <span className="font-mono tabular-nums">
                        Residual: {rec.empiricalDeviationPct.toFixed(2)}%
                      </span>
                    </div>
                  </td>
                  <td className="py-3.5 px-4 font-mono text-xs tabular-nums whitespace-nowrap">
                    <div className="text-slate-900 font-medium">{rec.steeringMode}</div>
                    <div className="text-slate-500">R = {rec.orderParameterR.toFixed(2)}</div>
                  </td>
                  <td className="py-3.5 px-4 font-mono text-xs whitespace-nowrap">
                    <span
                      className={
                        rec.watchdogContract.claim_status === 'VERIFIED'
                          ? 'text-emerald-700 font-semibold'
                          : 'text-amber-700 font-semibold'
                      }
                    >
                      [{rec.watchdogContract.claim_status}]
                    </span>
                  </td>
                  <td className="py-3.5 px-4 font-mono text-xs text-slate-600 tabular-nums whitespace-nowrap">
                    <div>{rec.stateHash}</div>
                    <div className="text-[10px] text-slate-400">
                      prev: {rec.previousLedgerHash ? rec.previousLedgerHash.slice(0, 12) : 'GENESIS'}
                    </div>
                  </td>
                  <td className="py-3.5 pl-4 text-right whitespace-nowrap">
                    <div className="inline-flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => onSelectRecord(rec.id)}
                        className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-medium text-slate-700 bg-white border border-slate-300 hover:bg-slate-100 transition-colors whitespace-nowrap shrink-0"
                      >
                        <FileCode2 className="w-3.5 h-3.5" />
                        <span>{isSelected ? 'Inspecting' : 'Inspect'}</span>
                      </button>

                      {!rec.watchdogContract.ready_for_ledger_commit && (
                        <button
                          type="button"
                          onClick={() => onRunFalsificationPass(rec.id)}
                          className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-medium text-blue-700 bg-blue-50 border border-blue-200 hover:bg-blue-100 transition-colors whitespace-nowrap shrink-0"
                        >
                          <CheckCircle2 className="w-3.5 h-3.5" />
                          <span>Verify</span>
                        </button>
                      )}

                      {rec.isolationZone === 'SCRATCHPAD' &&
                        rec.watchdogContract.ready_for_ledger_commit && (
                          <button
                            type="button"
                            onClick={() => onCommitToLedger(rec.id)}
                            className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-semibold text-white bg-blue-600 hover:bg-blue-700 transition-colors whitespace-nowrap shrink-0"
                          >
                            <span>Commit</span>
                            <ArrowUpRight className="w-3.5 h-3.5" />
                          </button>
                        )}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
};
