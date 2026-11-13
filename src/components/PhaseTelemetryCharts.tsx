import React, { useState } from 'react';
import {
  CRITICAL_R_TARGET,
  type PhasePoint,
  type RadarCalibrationMetric,
} from '../engine/epistemicEngine';

interface PhaseTelemetryChartsProps {
  trajectory: PhasePoint[];
  radarMetrics: RadarCalibrationMetric[];
  orderParameterR: number;
  couplingK: number;
  noiseSigma: number;
}

export const PhaseTelemetryCharts: React.FC<PhaseTelemetryChartsProps> = ({
  trajectory,
  radarMetrics,
  orderParameterR,
  couplingK,
  noiseSigma,
}) => {
  const [hoverIndex, setHoverIndex] = useState<number>(trajectory.length - 1);
  const activePoint = trajectory[Math.min(hoverIndex, trajectory.length - 1)] || trajectory[0];

  // SVG Geometry for Dual-Axis Trajectory Chart
  const width = 580;
  const height = 220;
  const padLeft = 44;
  const padRight = 20;
  const padTop = 18;
  const padBottom = 30;
  const plotW = width - padLeft - padRight;
  const plotH = height - padTop - padBottom;

  const toX = (idx: number) =>
    padLeft + (idx / Math.max(1, trajectory.length - 1)) * plotW;
  const toY = (val: number) =>
    padTop + (1 - Math.max(0, Math.min(1, val))) * plotH;

  const theoPoints = trajectory
    .map((pt, i) => `${toX(i).toFixed(1)},${toY(pt.rTheoretical).toFixed(1)}`)
    .join(' ');
  const empPoints = trajectory
    .map((pt, i) => `${toX(i).toFixed(1)},${toY(pt.rEmpirical).toFixed(1)}`)
    .join(' ');
  const empAreaPoints = `${toX(0).toFixed(1)},${(padTop + plotH).toFixed(1)} ${empPoints} ${toX(
    trajectory.length - 1
  ).toFixed(1)},${(padTop + plotH).toFixed(1)}`;

  const critY = toY(CRITICAL_R_TARGET);
  const activeX = toX(Math.min(hoverIndex, trajectory.length - 1));
  const activeY = activePoint ? toY(activePoint.rEmpirical) : critY;

  // SVG Geometry for 6-Axis Radar Calibration Chart
  const radarSize = 240;
  const cx = radarSize / 2;
  const cy = radarSize / 2;
  const maxRadius = 78;
  const levels = [0.25, 0.5, 0.75, 1.0];

  const getRadarCoord = (index: number, total: number, normalizedValue: number) => {
    const angle = (Math.PI * 2 * index) / total - Math.PI / 2;
    const r = normalizedValue * maxRadius;
    return {
      x: cx + r * Math.cos(angle),
      y: cy + r * Math.sin(angle),
      labelX: cx + (maxRadius + 24) * Math.cos(angle),
      labelY: cy + (maxRadius + 18) * Math.sin(angle),
    };
  };

  const radarPolygonPoints = radarMetrics
    .map((m, i) => {
      const pt = getRadarCoord(i, radarMetrics.length, m.value / 100);
      return `${pt.x.toFixed(1)},${pt.y.toFixed(1)}`;
    })
    .join(' ');

  const thresholdPolygonPoints = radarMetrics
    .map((m, i) => {
      const pt = getRadarCoord(i, radarMetrics.length, m.threshold / 100);
      return `${pt.x.toFixed(1)},${pt.y.toFixed(1)}`;
    })
    .join(' ');

  return (
    <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
      {/* Chart 1: Dual-Axis Phase Coherence & Criticality Trajectory */}
      <div className="lg:col-span-7 bg-white border border-slate-200 p-5 flex flex-col justify-between">
        <div className="flex flex-wrap items-baseline justify-between gap-2 pb-3 border-b border-slate-200">
          <div>
            <h3 className="text-sm font-semibold text-slate-900">
              Kuramoto Order Parameter Relaxation R(t) & Critical Threshold
            </h3>
            <p className="text-xs text-slate-500 mt-0.5 font-mono tabular-nums">
              <span>K = {couplingK.toFixed(2)} s⁻¹</span>
              <span className="mx-1.5" aria-hidden="true">·</span>
              <span>σ_noise = {noiseSigma.toFixed(2)}</span>
              <span className="mx-1.5" aria-hidden="true">·</span>
              <span>R_target = {orderParameterR.toFixed(2)}</span>
            </p>
          </div>
          <div className="flex items-center gap-4 text-xs font-mono text-slate-600">
            <span className="flex items-center gap-1.5">
              <span className="inline-block w-3 h-0.5 bg-blue-600" />
              <span>Empirical R(t)</span>
            </span>
            <span className="flex items-center gap-1.5">
              <span className="inline-block w-3 h-0.5 border-b border-dashed border-slate-500" />
              <span>Mean-Field Model</span>
            </span>
          </div>
        </div>

        <div className="relative my-3">
          <svg
            viewBox={`0 0 ${width} ${height}`}
            className="w-full h-auto cursor-crosshair select-none"
            role="img"
            aria-label="Kuramoto phase coherence trajectory chart"
            onMouseMove={(e) => {
              const rect = e.currentTarget.getBoundingClientRect();
              const relX = ((e.clientX - rect.left) / rect.width) * width;
              const ratio = Math.max(0, Math.min(1, (relX - padLeft) / plotW));
              const idx = Math.round(ratio * (trajectory.length - 1));
              setHoverIndex(idx);
            }}
          >
            {/* Horizontal grid lines */}
            {[0.0, 0.25, 0.48, 0.75, 1.0].map((val) => {
              const y = toY(val);
              const isCrit = Math.abs(val - CRITICAL_R_TARGET) < 0.001;
              return (
                <g key={val}>
                  <line
                    x1={padLeft}
                    y1={y}
                    x2={width - padRight}
                    y2={y}
                    stroke={isCrit ? '#d97706' : '#e2e8f0'}
                    strokeWidth={isCrit ? 1.2 : 1}
                    strokeDasharray={isCrit ? '4 3' : undefined}
                  />
                  <text
                    x={padLeft - 6}
                    y={y + 3}
                    textAnchor="end"
                    className={`text-[10px] font-mono ${
                      isCrit ? 'fill-amber-700 font-semibold' : 'fill-slate-400'
                    }`}
                  >
                    {val.toFixed(2)}
                  </text>
                </g>
              );
            })}

            {/* Critical R_c = 0.48 Annotation */}
            <text
              x={width - padRight - 4}
              y={critY - 5}
              textAnchor="end"
              className="text-[10px] font-mono fill-amber-700"
            >
              R_c = 0.48 (Critical Edge)
            </text>

            {/* Subtle area under empirical trajectory */}
            <polygon points={empAreaPoints} fill="rgba(37, 99, 235, 0.06)" />

            {/* Theoretical Mean-Field Curve (dashed) */}
            <polyline
              fill="none"
              stroke="#64748b"
              strokeWidth="1.5"
              strokeDasharray="4 4"
              points={theoPoints}
            />

            {/* Empirical Trajectory Curve (solid cobalt) */}
            <polyline
              fill="none"
              stroke="#2563eb"
              strokeWidth="2"
              points={empPoints}
            />

            {/* Interactive Crosshair Probe */}
            {activePoint && (
              <g>
                <line
                  x1={activeX}
                  y1={padTop}
                  x2={activeX}
                  y2={height - padBottom}
                  stroke="#94a3b8"
                  strokeWidth="1"
                  strokeDasharray="2 2"
                />
                <circle
                  cx={activeX}
                  cy={activeY}
                  r="4"
                  fill="#2563eb"
                  stroke="#ffffff"
                  strokeWidth="1.5"
                />
              </g>
            )}

            {/* X-axis labels */}
            <text
              x={padLeft}
              y={height - 8}
              className="text-[10px] font-mono fill-slate-400"
            >
              t = 0 ms
            </text>
            <text
              x={padLeft + plotW / 2}
              y={height - 8}
              textAnchor="middle"
              className="text-[10px] font-mono fill-slate-400"
            >
              Relaxation Horizon (t)
            </text>
            <text
              x={width - padRight}
              y={height - 8}
              textAnchor="end"
              className="text-[10px] font-mono fill-slate-400"
            >
              t = {(trajectory.length - 1) * 10} ms
            </text>
          </svg>
        </div>

        {/* Crosshair Readout Bar */}
        {activePoint && (
          <div className="grid grid-cols-2 sm:grid-cols-5 gap-3 pt-3 border-t border-slate-200 text-xs font-mono tabular-nums">
            <div>
              <span className="text-slate-400 block text-[10px]">PROBE STEP</span>
              <span className="text-slate-900 font-semibold">t = {activePoint.timeMs} ms</span>
            </div>
            <div>
              <span className="text-slate-400 block text-[10px]">EMPIRICAL R(t)</span>
              <span className="text-blue-600 font-semibold">{activePoint.rEmpirical.toFixed(4)}</span>
            </div>
            <div>
              <span className="text-slate-400 block text-[10px]">THEORETICAL R(t)</span>
              <span className="text-slate-700 font-semibold">{activePoint.rTheoretical.toFixed(4)}</span>
            </div>
            <div>
              <span className="text-slate-400 block text-[10px]">SUSCEPTIBILITY χ</span>
              <span className="text-slate-900 font-semibold">{activePoint.susceptibility.toFixed(3)}</span>
            </div>
            <div>
              <span className="text-slate-400 block text-[10px]">LYAPUNOV λ_max</span>
              <span
                className={`font-semibold ${
                  activePoint.lyapunovExponent > 0.05
                    ? 'text-amber-700'
                    : activePoint.lyapunovExponent < -0.05
                    ? 'text-emerald-700'
                    : 'text-blue-600'
                }`}
              >
                {activePoint.lyapunovExponent >= 0 ? '+' : ''}
                {activePoint.lyapunovExponent.toFixed(4)} s⁻¹
              </span>
            </div>
          </div>
        )}
      </div>

      {/* Chart 2: 6-Axis Spider / Radar Epistemic Invariant Calibration */}
      <div className="lg:col-span-5 bg-white border border-slate-200 p-5 flex flex-col justify-between">
        <div className="pb-3 border-b border-slate-200">
          <h3 className="text-sm font-semibold text-slate-900">
            Watchdog Invariant & Boundary Calibration
          </h3>
          <p className="text-xs text-slate-500 mt-0.5 font-mono tabular-nums">
            <span>6-Axis Parity Matrix</span>
            <span className="mx-1.5" aria-hidden="true">·</span>
            <span>Min Commit Threshold: 85%</span>
          </p>
        </div>

        <div className="flex items-center justify-center my-2">
          <svg
            viewBox={`0 0 ${radarSize} ${radarSize}`}
            className="w-56 h-56 select-none"
            role="img"
            aria-label="6-axis Watchdog invariant calibration radar chart"
          >
            {/* Concentric Polygonal Rings */}
            {levels.map((lvl) => {
              const pts = radarMetrics
                .map((_, i) => {
                  const c = getRadarCoord(i, radarMetrics.length, lvl);
                  return `${c.x.toFixed(1)},${c.y.toFixed(1)}`;
                })
                .join(' ');
              return (
                <polygon
                  key={lvl}
                  points={pts}
                  fill="none"
                  stroke="#e2e8f0"
                  strokeWidth="1"
                />
              );
            })}

            {/* Radial Axes */}
            {radarMetrics.map((m, i) => {
              const outer = getRadarCoord(i, radarMetrics.length, 1.0);
              return (
                <g key={m.shortLabel}>
                  <line
                    x1={cx}
                    y1={cy}
                    x2={outer.x}
                    y2={outer.y}
                    stroke="#cbd5e1"
                    strokeWidth="1"
                  />
                  <text
                    x={outer.labelX}
                    y={outer.labelY + 3}
                    textAnchor="middle"
                    className="text-[9px] font-mono fill-slate-600 font-medium"
                  >
                    {m.shortLabel}
                  </text>
                </g>
              );
            })}

            {/* Minimum Threshold Polygon */}
            <polygon
              points={thresholdPolygonPoints}
              fill="none"
              stroke="#94a3b8"
              strokeWidth="1"
              strokeDasharray="3 2"
            />

            {/* Active Calibration Polygon */}
            <polygon
              points={radarPolygonPoints}
              fill="rgba(37, 99, 235, 0.16)"
              stroke="#2563eb"
              strokeWidth="1.75"
            />

            {/* Vertex Points */}
            {radarMetrics.map((m, i) => {
              const pt = getRadarCoord(i, radarMetrics.length, m.value / 100);
              return (
                <circle
                  key={m.axis}
                  cx={pt.x}
                  cy={pt.y}
                  r="3"
                  fill="#2563eb"
                />
              );
            })}
          </svg>
        </div>

        <div className="grid grid-cols-3 gap-2 pt-3 border-t border-slate-200 text-xs font-mono tabular-nums">
          {radarMetrics.map((m) => (
            <div key={m.shortLabel} className="flex items-baseline justify-between gap-1">
              <span className="text-slate-500 text-[10px] truncate">{m.shortLabel}</span>
              <span
                className={`font-semibold ${
                  m.value >= m.threshold ? 'text-slate-900' : 'text-amber-700'
                }`}
              >
                {m.value}
                <span className="text-[10px] text-slate-400 ml-0.5">{m.unit}</span>
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};
