/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useMemo } from 'react';
import {
  Play,
  RotateCcw,
  Sliders,
  CheckCircle2,
  Download,
  Compass,
  BookOpen,
  Layers,
} from 'lucide-react';
import {
  CRITICAL_R_TARGET,
  SEED_DERIVATIONS,
  resolveSteeringMode,
  getSteeringDirectiveMeta,
  computeKuramotoTrajectory,
  computeRadarCalibration,
  synthesizeMechanisticDerivation,
  runFalsificationVerificationPass,
  type DerivationRecord,
  type SteeringMode,
} from './engine/epistemicEngine';
import { PhaseTelemetryCharts } from './components/PhaseTelemetryCharts';
import { WatchdogContractPanel } from './components/WatchdogContractPanel';
import { IsolationLedgerView } from './components/IsolationLedgerView';
import { AntigravityBridgeWorkspace } from './components/AntigravityBridgeWorkspace';
import { MechanisticChatPanel } from './components/MechanisticChatPanel';

const DOMAIN_OPTIONS = [
  'Plasma Magnetohydrodynamics',
  'Molecular Biophysics & Nonequilibrium Thermodynamics',
  'Superconducting Quantum Electrodynamics',
  'Neuromorphic Criticality & Avalanche Dynamics',
  'Inertial Fusion & Radiation Hydrodynamics',
];

export default function App() {
  const [records, setRecords] = useState<DerivationRecord[]>(SEED_DERIVATIONS);
  const [activeRecordId, setActiveRecordId] = useState<string>(SEED_DERIVATIONS[0].id);

  // Homeostatic Steering & Phase Parameters
  const [orderParameterR, setOrderParameterR] = useState<number>(SEED_DERIVATIONS[0].orderParameterR);
  const [couplingK, setCouplingK] = useState<number>(SEED_DERIVATIONS[0].couplingK);
  const [noiseSigma, setNoiseSigma] = useState<number>(SEED_DERIVATIONS[0].noiseSigma);

  // Problem Synthesis Form State
  const [problemPrompt, setProblemPrompt] = useState<string>(SEED_DERIVATIONS[0].prompt);
  const [selectedDomain, setSelectedDomain] = useState<string>(SEED_DERIVATIONS[0].domain);
  const [promptError, setPromptError] = useState<string | null>(null);
  const [isSynthesizing, setIsSynthesizing] = useState<boolean>(false);
  const [lastEngineSource, setLastEngineSource] = useState<string>('Seed Calibration Benchmark');
  const [externalIngestTrigger, setExternalIngestTrigger] = useState<{
    promptId: string;
    rawOutput: string;
    nonce: number;
  } | null>(null);

  const activeRecord = useMemo(
    () => records.find((r) => r.id === activeRecordId) || records[0],
    [records, activeRecordId]
  );

  const currentSteeringMode: SteeringMode = useMemo(
    () => resolveSteeringMode(orderParameterR),
    [orderParameterR]
  );

  const steeringMeta = useMemo(
    () => getSteeringDirectiveMeta(currentSteeringMode),
    [currentSteeringMode]
  );

  const trajectory = useMemo(
    () => computeKuramotoTrajectory(orderParameterR, couplingK, noiseSigma, 36),
    [orderParameterR, couplingK, noiseSigma]
  );

  const radarMetrics = useMemo(
    () =>
      computeRadarCalibration({
        ...activeRecord,
        orderParameterR,
        couplingK,
        noiseSigma,
      }),
    [activeRecord, orderParameterR, couplingK, noiseSigma]
  );

  const latestLedgerHash = useMemo(() => {
    const ledgerItems = records.filter((r) => r.isolationZone === 'LEDGER');
    return ledgerItems.length > 0 ? ledgerItems[0].stateHash : 'wdg_7c12a0948b11e02f';
  }, [records]);

  const handleSelectPresetRecord = (rec: DerivationRecord) => {
    setActiveRecordId(rec.id);
    setOrderParameterR(rec.orderParameterR);
    setCouplingK(rec.couplingK);
    setNoiseSigma(rec.noiseSigma);
    setProblemPrompt(rec.prompt);
    setSelectedDomain(rec.domain);
    setPromptError(null);
  };

  const handleApplySteeringPreset = (targetR: number) => {
    setOrderParameterR(targetR);
    if (targetR > 0.52) {
      setCouplingK(1.55);
      setNoiseSigma(0.22);
    } else if (targetR < 0.44) {
      setCouplingK(3.1);
      setNoiseSigma(0.08);
    } else {
      setCouplingK(2.15);
      setNoiseSigma(0.14);
    }
  };

  const handleSynthesize = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!problemPrompt.trim() || problemPrompt.trim().length < 12) {
      setPromptError(
        'Enter a mechanistic problem statement or mathematical derivation prompt (at least 12 characters).'
      );
      return;
    }
    setPromptError(null);
    setIsSynthesizing(true);

    try {
      const response = await fetch('/api/reasoning/synthesize', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          prompt: problemPrompt.trim(),
          orderParameterR,
          domain: selectedDomain,
          previousLedgerHash: latestLedgerHash,
        }),
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      const data = await response.json();
      const newRecord: DerivationRecord = {
        ...data.record,
        orderParameterR,
        couplingK,
        noiseSigma,
      };
      setRecords((prev) => [newRecord, ...prev]);
      setActiveRecordId(newRecord.id);
      setLastEngineSource(
        data.engineSource === 'gemini-4-hydrogen'
          ? 'Server-Side Mechanistic Synthesis'
          : 'First-Principles Continuum Solver'
      );
    } catch {
      const localRecord = synthesizeMechanisticDerivation(
        problemPrompt.trim(),
        orderParameterR,
        selectedDomain,
        latestLedgerHash
      );
      setRecords((prev) => [localRecord, ...prev]);
      setActiveRecordId(localRecord.id);
      setLastEngineSource('First-Principles Continuum Solver');
    } finally {
      setIsSynthesizing(false);
    }
  };

  const handleRunFalsificationPass = (recordId: string) => {
    setRecords((prev) =>
      prev.map((rec) => {
        if (rec.id !== recordId) return rec;
        return runFalsificationVerificationPass(rec, latestLedgerHash);
      })
    );
  };

  const handleCommitToLedger = (recordId: string) => {
    setRecords((prev) =>
      prev.map((rec) => {
        if (rec.id !== recordId) return rec;
        if (!rec.watchdogContract.ready_for_ledger_commit) return rec;
        return {
          ...rec,
          isolationZone: 'LEDGER',
        };
      })
    );
  };

  const handleExportActiveLedgerJson = () => {
    const payload = JSON.stringify(
      {
        architecture: 'SynapseEdge + Watchdog Mechanistic Engine',
        exportedAt: new Date().toISOString(),
        activeRecord,
      },
      null,
      2
    );
    const blob = new Blob([payload], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${activeRecord.id}-watchdog.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleStartNewDerivation = () => {
    setProblemPrompt('');
    setPromptError(null);
    const inputEl = document.getElementById('mechanistic-prompt-input');
    if (inputEl) {
      inputEl.focus();
    }
  };

  return (
    <div className="min-h-screen flex flex-col bg-slate-50 text-slate-900">
      {/* Strict 3-Zone Top Bar Contract */}
      <header className="flex items-center justify-between gap-8 px-6 py-3.5 bg-white border-b border-slate-200">
        {/* Zone 1: Single text element wordmark */}
        <a
          href="#workbench"
          className="text-lg font-bold tracking-tight text-slate-900 whitespace-nowrap shrink-0"
        >
          SynapseEdge
        </a>

        {/* Zone 2: 4 concise single-line navigation links */}
        <nav
          aria-label="Primary Workspace Navigation"
          className="hidden md:flex items-center gap-6 text-sm font-medium text-slate-600"
        >
          <a
            href="#workbench"
            className="hover:text-slate-900 hover:underline underline-offset-4 transition-colors whitespace-nowrap shrink-0"
          >
            Mechanistic Workbench
          </a>
          <a
            href="#silver-watchdog"
            className="hover:text-slate-900 hover:underline underline-offset-4 transition-colors whitespace-nowrap shrink-0"
          >
            Silver Watchdog
          </a>
          <a
            href="#reasoning-chat"
            className="hover:text-slate-900 hover:underline underline-offset-4 transition-colors whitespace-nowrap shrink-0"
          >
            Reasoning Chat
          </a>
          <a
            href="#epistemic-ledger"
            className="hover:text-slate-900 hover:underline underline-offset-4 transition-colors whitespace-nowrap shrink-0"
          >
            Epistemic Ledger
          </a>
        </nav>

        {/* Zone 3: 1 primary action */}
        <div className="flex items-center shrink-0">
          <button
            type="button"
            onClick={handleStartNewDerivation}
            className="px-4 py-2 text-xs font-semibold text-white bg-slate-900 rounded hover:bg-slate-800 transition-colors whitespace-nowrap shrink-0"
          >
            New Derivation
          </button>
        </div>
      </header>

      {/* Top Telemetry Ribbon (Per Science/Biotech Asymmetric Console Architecture) */}
      <div className="bg-slate-100 border-b border-slate-200 px-6 py-2 flex flex-wrap items-center justify-between gap-4 text-xs font-mono tabular-nums text-slate-600">
        <div className="flex flex-wrap items-center gap-3">
          <span className="font-semibold text-slate-900">
            STEERING DIRECTIVE: {currentSteeringMode} ({steeringMeta.regimeRelation})
          </span>
          <span aria-hidden="true">·</span>
          <span>ORDER PARAMETER R = {orderParameterR.toFixed(2)}</span>
          <span aria-hidden="true">·</span>
          <span>CRITICAL POINT R_c = {CRITICAL_R_TARGET.toFixed(2)}</span>
          <span aria-hidden="true">·</span>
          <span>BRANCHING: {steeringMeta.branchingFactor}</span>
        </div>
        <div className="flex items-center gap-3">
          <span>ENGINE: {lastEngineSource}</span>
          <span aria-hidden="true">·</span>
          <button
            type="button"
            onClick={handleExportActiveLedgerJson}
            className="inline-flex items-center gap-1 text-blue-700 hover:underline font-medium whitespace-nowrap shrink-0"
          >
            <Download className="w-3.5 h-3.5" />
            <span>Export State JSON</span>
          </button>
        </div>
      </div>

      {/* Main Asymmetric Split Console */}
      <main className="flex-1 max-w-[1440px] w-full mx-auto px-6 py-6 grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* Left Control & Homeostatic Steering Column (4 cols on desktop) */}
        <aside
          aria-label="Homeostatic Steering and Parameter Controls"
          className="lg:col-span-4 lg:sticky lg:top-6 space-y-6"
        >
          {/* Homeostatic Steering Mode Controller */}
          <div className="bg-white border border-slate-200 p-5 space-y-4">
            <div className="flex items-center justify-between border-b border-slate-200 pb-3">
              <div className="flex items-center gap-2">
                <Sliders className="w-4 h-4 text-blue-600 shrink-0" />
                <h2 className="text-sm font-semibold text-slate-900">
                  Homeostatic Phase Steering
                </h2>
              </div>
              <span className="text-xs font-mono text-slate-500 tabular-nums">
                R_c = 0.48
              </span>
            </div>

            {/* Primary Metric Readout */}
            <div className="bg-slate-50 border border-slate-200 p-4">
              <div className="text-[11px] font-mono uppercase tracking-wider text-slate-500">
                Kuramoto Order Parameter (R)
              </div>
              <div className="mt-1 flex items-baseline justify-between">
                <div className="text-3xl font-mono font-bold text-slate-900 tabular-nums">
                  {orderParameterR.toFixed(2)}{' '}
                  <span className="text-xs font-mono font-normal text-slate-500 ml-1">
                    coherence
                  </span>
                </div>
                <span
                  className={`text-xs font-mono font-semibold ${
                    currentSteeringMode === 'CRITICAL_BALANCE'
                      ? 'text-blue-700'
                      : currentSteeringMode === 'DIVERGE_EXPLORE'
                      ? 'text-amber-700'
                      : 'text-emerald-700'
                  }`}
                >
                  {currentSteeringMode}
                </span>
              </div>
              <p className="text-xs text-slate-600 mt-2 leading-relaxed">
                {steeringMeta.directiveSummary}
              </p>
            </div>

            {/* Steering Mode Quick-Select Buttons */}
            <div>
              <span className="block text-xs font-medium text-slate-700 mb-2">
                Homeostatic Regime Presets
              </span>
              <div className="grid grid-cols-3 gap-1.5">
                <button
                  type="button"
                  onClick={() => handleApplySteeringPreset(0.34)}
                  className={`px-2.5 py-2 text-xs font-mono border text-center transition-colors whitespace-nowrap shrink-0 ${
                    currentSteeringMode === 'CONVERGE_SYNTHESIZE'
                      ? 'bg-slate-900 text-white border-slate-900 font-semibold'
                      : 'bg-white text-slate-700 border-slate-300 hover:bg-slate-100'
                  }`}
                >
                  CONVERGE (&lt;0.48)
                </button>
                <button
                  type="button"
                  onClick={() => handleApplySteeringPreset(0.48)}
                  className={`px-2.5 py-2 text-xs font-mono border text-center transition-colors whitespace-nowrap shrink-0 ${
                    currentSteeringMode === 'CRITICAL_BALANCE'
                      ? 'bg-blue-600 text-white border-blue-600 font-semibold'
                      : 'bg-white text-slate-700 border-slate-300 hover:bg-slate-100'
                  }`}
                >
                  CRITICAL (0.48)
                </button>
                <button
                  type="button"
                  onClick={() => handleApplySteeringPreset(0.68)}
                  className={`px-2.5 py-2 text-xs font-mono border text-center transition-colors whitespace-nowrap shrink-0 ${
                    currentSteeringMode === 'DIVERGE_EXPLORE'
                      ? 'bg-slate-900 text-white border-slate-900 font-semibold'
                      : 'bg-white text-slate-700 border-slate-300 hover:bg-slate-100'
                  }`}
                >
                  DIVERGE (&gt;0.48)
                </button>
              </div>
            </div>

            {/* Continuous Parameter Scrubbers */}
            <div className="space-y-3 pt-2 border-t border-slate-200">
              <div>
                <div className="flex justify-between text-xs mb-1">
                  <label htmlFor="slider-order-r" className="font-medium text-slate-700">
                    Order Parameter R
                  </label>
                  <span className="font-mono text-slate-900 tabular-nums">
                    {orderParameterR.toFixed(2)}
                  </span>
                </div>
                <input
                  id="slider-order-r"
                  type="range"
                  min="0.10"
                  max="0.95"
                  step="0.01"
                  value={orderParameterR}
                  onChange={(e) => setOrderParameterR(parseFloat(e.target.value))}
                  className="w-full accent-blue-600 cursor-pointer"
                />
                <div className="flex justify-between text-[10px] font-mono text-slate-400 mt-0.5">
                  <span>0.10 (Fragmented)</span>
                  <span>0.48 (Critical)</span>
                  <span>0.95 (Locked)</span>
                </div>
              </div>

              <div>
                <div className="flex justify-between text-xs mb-1">
                  <label htmlFor="slider-coupling-k" className="font-medium text-slate-700">
                    Phase Coupling Strength K
                  </label>
                  <span className="font-mono text-slate-900 tabular-nums">
                    {couplingK.toFixed(2)} s⁻¹
                  </span>
                </div>
                <input
                  id="slider-coupling-k"
                  type="range"
                  min="0.50"
                  max="4.00"
                  step="0.05"
                  value={couplingK}
                  onChange={(e) => setCouplingK(parseFloat(e.target.value))}
                  className="w-full accent-blue-600 cursor-pointer"
                />
              </div>

              <div>
                <div className="flex justify-between text-xs mb-1">
                  <label htmlFor="slider-noise-sigma" className="font-medium text-slate-700">
                    Stochastic Thermal Bath σ
                  </label>
                  <span className="font-mono text-slate-900 tabular-nums">
                    {noiseSigma.toFixed(2)}
                  </span>
                </div>
                <input
                  id="slider-noise-sigma"
                  type="range"
                  min="0.02"
                  max="0.50"
                  step="0.01"
                  value={noiseSigma}
                  onChange={(e) => setNoiseSigma(parseFloat(e.target.value))}
                  className="w-full accent-blue-600 cursor-pointer"
                />
              </div>
            </div>

            <div className="pt-2 border-t border-slate-200 flex justify-between items-center">
              <span className="text-xs font-mono text-slate-500">
                {steeringMeta.dampingRegime}
              </span>
              <button
                type="button"
                onClick={() => handleApplySteeringPreset(0.48)}
                className="inline-flex items-center gap-1 text-xs font-medium text-slate-600 hover:text-slate-900 whitespace-nowrap shrink-0"
              >
                <RotateCcw className="w-3 h-3" />
                <span>Reset to R_c</span>
              </button>
            </div>
          </div>

          {/* Seed Benchmark Problem Selector */}
          <div className="bg-white border border-slate-200 p-5 space-y-3">
            <div className="flex items-center justify-between border-b border-slate-200 pb-3">
              <div className="flex items-center gap-2">
                <BookOpen className="w-4 h-4 text-blue-600 shrink-0" />
                <h2 className="text-sm font-semibold text-slate-900">
                  Reference Mechanistic Benchmarks
                </h2>
              </div>
              <span className="text-xs font-mono text-slate-400">
                {records.length} Cases
              </span>
            </div>

            <div className="space-y-2">
              {records.map((rec) => {
                const isSelected = rec.id === activeRecord.id;
                return (
                  <button
                    key={rec.id}
                    type="button"
                    onClick={() => handleSelectPresetRecord(rec)}
                    className={`w-full text-left p-3 border transition-colors ${
                      isSelected
                        ? 'bg-slate-900 text-white border-slate-900'
                        : 'bg-slate-50 text-slate-900 border-slate-200 hover:bg-slate-100'
                    }`}
                  >
                    <div className="text-xs font-semibold leading-snug">{rec.title}</div>
                    <div
                      className={`text-[11px] font-mono mt-1.5 flex flex-wrap items-center gap-1.5 tabular-nums ${
                        isSelected ? 'text-slate-300' : 'text-slate-500'
                      }`}
                    >
                      <span>R = {rec.orderParameterR.toFixed(2)}</span>
                      <span aria-hidden="true">·</span>
                      <span>[{rec.watchdogContract.claim_status}]</span>
                      <span aria-hidden="true">·</span>
                      <span>{rec.isolationZone}</span>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>
        </aside>

        {/* Main Viewport / Mechanistic Workbench Stage (8 cols on desktop) */}
        <div id="workbench" className="lg:col-span-8 space-y-6">
          {/* Mechanistic Synthesis Input Console */}
          <section
            aria-label="Mechanistic Problem Input and Synthesis"
            className="bg-white border border-slate-200 p-6"
          >
            <div className="flex flex-wrap items-center justify-between gap-2 pb-4 border-b border-slate-200">
              <div>
                <h1 className="text-lg font-bold text-slate-900 text-balance">
                  First-Principles Mechanistic Synthesis & Falsification Engine
                </h1>
                <p className="text-xs text-slate-500 mt-0.5">
                  Decompose physical or computational problems into conservation laws, dimensional
                  scaling invariants, and Watchdog-verified mechanisms.
                </p>
              </div>
              <span className="text-xs font-mono text-slate-600 tabular-nums">
                Active Mode: {currentSteeringMode}
              </span>
            </div>

            <form onSubmit={handleSynthesize} className="mt-4 space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label
                    htmlFor="domain-select"
                    className="block text-xs font-medium text-slate-700 mb-1"
                  >
                    Physical or Computational Domain
                  </label>
                  <select
                    id="domain-select"
                    value={selectedDomain}
                    onChange={(e) => setSelectedDomain(e.target.value)}
                    className="w-full px-3 py-2 text-xs font-medium bg-slate-50 border border-slate-300 text-slate-900 focus:outline-none focus:border-blue-600"
                  >
                    {DOMAIN_OPTIONS.map((dom) => (
                      <option key={dom} value={dom}>
                        {dom}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <span className="block text-xs font-medium text-slate-700 mb-1">
                    Active Homeostatic Steering Target
                  </span>
                  <div className="px-3 py-2 text-xs font-mono bg-slate-50 border border-slate-200 text-slate-800 tabular-nums">
                    {currentSteeringMode} (R = {orderParameterR.toFixed(2)})
                  </div>
                </div>
              </div>

              <div>
                <label
                  htmlFor="mechanistic-prompt-input"
                  className="block text-xs font-medium text-slate-700 mb-1"
                >
                  Mechanistic Problem Statement & Boundary Conditions
                </label>
                <textarea
                  id="mechanistic-prompt-input"
                  rows={3}
                  value={problemPrompt}
                  onChange={(e) => {
                    setProblemPrompt(e.target.value);
                    if (promptError) setPromptError(null);
                  }}
                  placeholder="Describe the physical phenomenon, governing dynamics, or engineering mechanism to derive and falsify..."
                  className="w-full p-3 text-sm bg-slate-50 border border-slate-300 text-slate-900 focus:outline-none focus:border-blue-600 leading-relaxed"
                />
                {promptError && (
                  <p role="alert" className="text-xs text-rose-600 mt-1.5 font-medium">
                    {promptError}
                  </p>
                )}
              </div>

              <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
                <div className="text-xs text-slate-500 font-mono">
                  <span>Directive: Strip to conservation laws & dimensional invariants</span>
                </div>
                <button
                  type="submit"
                  disabled={isSynthesizing}
                  className="inline-flex items-center gap-2 px-5 py-2.5 text-xs font-semibold text-white bg-blue-600 hover:bg-blue-700 disabled:opacity-60 transition-colors whitespace-nowrap shrink-0"
                >
                  <Play className="w-3.5 h-3.5" />
                  <span>
                    {isSynthesizing
                      ? 'Executing First-Principles Synthesis...'
                      : 'Run Mechanistic Synthesis'}
                  </span>
                </button>
              </div>
            </form>
          </section>

          {/* Section 01: First-Principles Decomposition & Dimensional Invariants */}
          <section
            aria-label="First-Principles Decomposition"
            className="bg-white border border-slate-200 p-6 space-y-5"
          >
            <div className="flex flex-wrap items-start justify-between gap-4 pb-4 border-b border-slate-200">
              <div>
                <h2 className="text-base font-semibold text-slate-900">
                  01. First-Principles Decomposition & Invariant Matrix
                </h2>
                <p className="text-xs text-slate-500 mt-1">
                  <span>{activeRecord.title}</span>
                  <span className="mx-2" aria-hidden="true">·</span>
                  <span>{activeRecord.domain}</span>
                </p>
              </div>
              <span className="text-xs font-mono text-slate-600 tabular-nums">
                ID: {activeRecord.id}
              </span>
            </div>

            {/* Governing Equation & Dimensional Scaling Callout */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="bg-slate-50 border border-slate-200 p-4">
                <div className="text-[11px] font-mono uppercase tracking-wider text-slate-500 mb-1.5">
                  Governing Continuum / Dynamical Operator
                </div>
                <div className="text-xs font-mono text-slate-900 font-semibold break-words leading-relaxed">
                  {activeRecord.governingEquation}
                </div>
              </div>
              <div className="bg-slate-50 border border-slate-200 p-4">
                <div className="text-[11px] font-mono uppercase tracking-wider text-slate-500 mb-1.5">
                  Dimensional & Buckingham Π Scaling Law
                </div>
                <div className="text-xs font-mono text-slate-900 font-semibold break-words leading-relaxed">
                  {activeRecord.dimensionalScalingLaw}
                </div>
              </div>
            </div>

            {/* Conservation & Boundary Invariants Table */}
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="border-b border-slate-200 text-[11px] font-mono uppercase text-slate-500">
                    <th className="py-2 pr-3 font-medium">Invariant / Conservation Law</th>
                    <th className="py-2 px-3 font-medium">Mathematical Form</th>
                    <th className="py-2 px-3 font-medium">SI Base Units</th>
                    <th className="py-2 px-3 font-medium">Boundary / Singularity Behavior</th>
                    <th className="py-2 pl-3 text-right font-medium">Epistemic Tag</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200 text-xs">
                  {activeRecord.invariants.map((inv) => (
                    <tr key={inv.id} className="hover:bg-slate-50">
                      <td className="py-3 pr-3 font-medium text-slate-900">{inv.name}</td>
                      <td className="py-3 px-3 font-mono text-slate-800">{inv.expression}</td>
                      <td className="py-3 px-3 font-mono text-slate-600 whitespace-nowrap">
                        {inv.siUnits}
                      </td>
                      <td className="py-3 px-3 text-slate-600">{inv.boundaryBehavior}</td>
                      <td className="py-3 pl-3 text-right font-mono whitespace-nowrap tabular-nums">
                        <span
                          className={
                            inv.status === 'VERIFIED'
                              ? 'text-emerald-700 font-semibold'
                              : 'text-amber-700 font-semibold'
                          }
                        >
                          [{inv.status}]
                        </span>
                        <span className="block text-[10px] text-slate-400">
                          ε = {inv.residual.toFixed(4)}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          {/* Section 02: Constructive Mechanism & Tagged Epistemic Claims */}
          <section
            aria-label="Constructive Mechanism and Epistemic Claims"
            className="bg-white border border-slate-200 p-6 space-y-4"
          >
            <div className="flex flex-wrap items-center justify-between gap-2 pb-4 border-b border-slate-200">
              <div>
                <h2 className="text-base font-semibold text-slate-900">
                  02. Constructive Mechanism & Tagged Epistemic Claims
                </h2>
                <p className="text-xs text-slate-500 mt-0.5">
                  Every claim is explicitly audited for boundary failure modes and tagged as{' '}
                  <code className="font-mono">[VERIFIED]</code> or{' '}
                  <code className="font-mono">[HYPOTHESIS]</code>.
                </p>
              </div>
              <div className="flex items-center gap-2 text-xs font-mono text-slate-600">
                <Layers className="w-3.5 h-3.5 text-blue-600" />
                <span>{activeRecord.claims.length} Mechanistic Claims</span>
              </div>
            </div>

            <div className="space-y-4">
              {activeRecord.claims.map((claim, idx) => (
                <article
                  key={claim.id}
                  className="bg-slate-50 border border-slate-200 p-4 space-y-3"
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="text-xs font-mono font-semibold text-slate-700">
                      CLAIM 0{idx + 1} · CONSTRUCTIVE DERIVATION
                    </span>
                    <span
                      className={`text-xs font-mono font-semibold ${
                        claim.tag === 'VERIFIED' ? 'text-emerald-700' : 'text-amber-700'
                      }`}
                    >
                      [{claim.tag}]
                    </span>
                  </div>

                  <p className="text-sm text-slate-900 font-medium leading-relaxed">
                    {claim.statement}
                  </p>

                  <div className="bg-white border border-slate-200 px-3.5 py-2.5 font-mono text-xs text-slate-900">
                    {claim.equation}
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-1 text-xs">
                    <div>
                      <span className="font-mono uppercase text-[10px] text-slate-500 block mb-0.5">
                        First-Principles Basis
                      </span>
                      <p className="text-slate-700 leading-relaxed">{claim.derivationNote}</p>
                    </div>
                    <div>
                      <span className="font-mono uppercase text-[10px] text-rose-700 block mb-0.5">
                        Adversarial Failure Mode / Breakdown Limit
                      </span>
                      <p className="text-slate-700 leading-relaxed">{claim.failureMode}</p>
                    </div>
                  </div>
                </article>
              ))}
            </div>
          </section>

          {/* Phase-Space & Calibration Telemetry Section */}
          <div id="phase-telemetry">
            <PhaseTelemetryCharts
              trajectory={trajectory}
              radarMetrics={radarMetrics}
              orderParameterR={orderParameterR}
              couplingK={couplingK}
              noiseSigma={noiseSigma}
            />
          </div>

          {/* Section 03: Watchdog Mandatory Output Contract */}
          <div id="watchdog-contract">
            <WatchdogContractPanel
              record={activeRecord}
              onRunFalsificationPass={handleRunFalsificationPass}
              onCommitToLedger={handleCommitToLedger}
            />
          </div>

          {/* Section 04: Silver Epistemic Ledger — C++20 Falsification, Ingest & Quarantine */}
          <div id="silver-watchdog">
            <AntigravityBridgeWorkspace
              externalIngestTrigger={externalIngestTrigger}
            />
          </div>

          {/* Section 05: Multi-Turn Mechanistic Reasoning Chat */}
          <div id="reasoning-chat">
            <MechanisticChatPanel
              orderParameterR={orderParameterR}
              steeringMode={currentSteeringMode}
              onIngestChatResponse={(promptId: string, rawOutput: string) => {
                setExternalIngestTrigger({
                  promptId,
                  rawOutput,
                  nonce: Date.now(),
                });
                const el = document.getElementById('silver-watchdog');
                if (el) {
                  el.scrollIntoView({ behavior: 'smooth', block: 'start' });
                }
              }}
            />
          </div>

          {/* Section 06: Scratchpad vs. Epistemic Ledger Isolation Registry */}
          <div id="epistemic-ledger">
            <IsolationLedgerView
              records={records}
              activeRecordId={activeRecord.id}
              onSelectRecord={(id) => {
                const found = records.find((r) => r.id === id);
                if (found) handleSelectPresetRecord(found);
              }}
              onRunFalsificationPass={handleRunFalsificationPass}
              onCommitToLedger={handleCommitToLedger}
            />
          </div>
        </div>
      </main>

      {/* Clean Minimal Footer */}
      <footer className="mt-12 bg-white border-t border-slate-200 px-6 py-4 text-xs text-slate-500 flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-2">
          <Compass className="w-3.5 h-3.5 text-slate-400" />
          <span>SynapseEdge + Watchdog Architecture — Mechanistic Reasoning & Epistemic Engine</span>
        </div>
        <div className="font-mono tabular-nums">
          <span>Conservation Parity</span>
          <span className="mx-2" aria-hidden="true">·</span>
          <span>Dimensional Homogeneity</span>
          <span className="mx-2" aria-hidden="true">·</span>
          <span>Scratchpad Isolation Enforced</span>
        </div>
      </footer>
    </div>
  );
}
