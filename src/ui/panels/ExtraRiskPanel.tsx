import { useState } from 'react';
import { RISK_LABELS, RISK_TYPES, ZONE_OFFSET_MAX, ZONE_OFFSET_MIN } from '@domain';
import type { RiskZone, RiskType, WorldExtent, WorldPoint } from '@domain';
import { useBlockbusterStore } from '@/state/store';
import type { DrawMode } from '@/state/types';
import { formatTime } from '@/ui/utils/time';

const TOOLS: ReadonlyArray<{ mode: Exclude<DrawMode, null>; label: string }> = [
  { mode: 'rectangle', label: 'Rectangle' },
  { mode: 'circle', label: 'Circle' },
  { mode: 'polygon', label: 'Polygon' },
];

/** Format a signed offset for display, e.g. +0.30 / -0.15. */
function fmtOffset(value: number): string {
  return `${value >= 0 ? '+' : ''}${value.toFixed(2)}`;
}

/** Number of discrete position slices used to simulate storm movement. */
const STORM_STEPS = 12;

/** 4-point parallelogram ring centred at `cx`, spanning the domain height (open ring). */
function stormStripRing(
  cx: number,
  extent: WorldExtent,
  hexSizeKm: number,
  bandCells: number,
  slantLeft: boolean,
): WorldPoint[] {
  const { height } = extent;
  const halfW = (bandCells * hexSizeKm) / 2;
  const drift = height * Math.tan((30 * Math.PI) / 180) * (slantLeft ? -1 : 1);
  const margin = hexSizeKm;
  return [
    { x: cx - halfW, y: -margin },
    { x: cx + halfW, y: -margin },
    { x: cx + halfW + drift, y: height + margin },
    { x: cx - halfW + drift, y: height + margin },
  ];
}

/**
 * Build N zones that simulate a storm band sweeping east→west across the domain.
 * Each zone covers one time slice and one horizontal position; together they give
 * the illusion of movement when the time slider is dragged.
 */
function generateMovingStorm(
  extent: WorldExtent,
  hexSizeKm: number,
  intensity: number,
  slantLeft: boolean,
  startTime: number,
  endTime: number,
): Omit<RiskZone, 'id'>[] {
  const { width } = extent;
  const bandCells = 5;
  const N = STORM_STEPS;
  // Total duration in minutes, handling midnight wrap.
  const D = endTime >= startTime ? endTime - startTime : 1440 - startTime + endTime;
  const stepDur = D / N;

  return Array.from({ length: N }, (_, i) => {
    // Centre sweeps from near east edge (i=0) to near west edge (i=N-1).
    const cx = width * (N - 0.5 - i) / N;
    const ring = stormStripRing(cx, extent, hexSizeKm, bandCells, slantLeft);
    const rawStart = startTime + i * stepDur;
    const rawEnd = startTime + (i + 1) * stepDur;
    return {
      name: `Storm ${String(i + 1).padStart(2, '0')}/${N}`,
      risk: 'cold' as RiskType,
      kind: 'polygon' as const,
      ring,
      offset: intensity,
      enabled: true,
      startTime: Math.round(rawStart) % 1440,
      endTime: Math.round(rawEnd) % 1440,
    };
  });
}

/**
 * Extra-factors tab: choose the risk a new zone targets, pick a draw tool, and edit
 * the zones drawn so far (name, risk channel, offset). The offset's effect on
 * hex scores arrives with the scoring slice; for now it drives the zone styling.
 */
export function ExtraRiskPanel() {
  const drawMode = useBlockbusterStore((s) => s.drawMode);
  const setDrawMode = useBlockbusterStore((s) => s.setDrawMode);
  const zoneRiskType = useBlockbusterStore((s) => s.zoneRiskType);
  const setZoneRiskType = useBlockbusterStore((s) => s.setZoneRiskType);
  const zones = useBlockbusterStore((s) => s.zones);
  const selectedZoneId = useBlockbusterStore((s) => s.selectedZoneId);
  const selectZone = useBlockbusterStore((s) => s.selectZone);
  const updateZone = useBlockbusterStore((s) => s.updateZone);
  const removeZone = useBlockbusterStore((s) => s.removeZone);
  const toggleZoneEnabled = useBlockbusterStore((s) => s.toggleZoneEnabled);
  const addZone = useBlockbusterStore((s) => s.addZone);
  const extent = useBlockbusterStore((s) => s.extent);
  const hexSize = useBlockbusterStore((s) => s.hexSize);

  const [showStorm, setShowStorm] = useState(false);
  const [stormIntensity, setStormIntensity] = useState(0.3);
  const [stormStart, setStormStart] = useState(8 * 60);
  const [stormEnd, setStormEnd] = useState(16 * 60);
  const [stormSlantLeft, setStormSlantLeft] = useState(true);

  const selectedZone = zones.find((z) => z.id === selectedZoneId) ?? null;

  return (
    <div className="extra-risk">
      <p className="panel-hint">
        Choose a risk, pick a tool, then draw a zone on the map. For a polygon, click each point and
        click the first point again to close it.
      </p>

      <label className="extra-field">
        <span>Risk for new zones</span>
        <select value={zoneRiskType} onChange={(e) => setZoneRiskType(e.target.value as RiskType)}>
          {RISK_TYPES.map((risk) => (
            <option key={risk} value={risk}>
              {RISK_LABELS[risk]}
            </option>
          ))}
        </select>
      </label>

      <div className="extra-tools">
        {TOOLS.map((tool) => {
          const active = drawMode === tool.mode;
          return (
            <button
              key={tool.mode}
              type="button"
              className={active ? 'tool tool-active' : 'tool'}
              aria-pressed={active}
              onClick={() => setDrawMode(active ? null : tool.mode)}
            >
              {tool.label}
            </button>
          );
        })}
      </div>

      {zones.length === 0 ? (
        <p className="panel-hint">No extra-factor zones yet.</p>
      ) : (
        <ul className="zone-list">
          {zones.map((zone) => (
            <li
              key={zone.id}
              className={zone.id === selectedZoneId ? 'zone-row selected' : 'zone-row'}
            >
              <label
                className="zone-toggle"
                title={zone.enabled ? 'Disable zone' : 'Enable zone'}
              >
                <input
                  type="checkbox"
                  checked={zone.enabled}
                  onChange={() => toggleZoneEnabled(zone.id)}
                />
              </label>
              <button type="button" className="zone-select" onClick={() => selectZone(zone.id)}>
                <span className={zone.enabled ? 'zone-name' : 'zone-name zone-disabled'}>
                  {zone.name}
                </span>
                <span className="zone-meta">
                  {zone.kind} · {RISK_LABELS[zone.risk]} · {fmtOffset(zone.offset)}
                  {zone.startTime !== undefined || zone.endTime !== undefined
                    ? ` · ${formatTime(zone.startTime ?? 0)}–${formatTime(zone.endTime ?? 1439)}`
                    : null}
                </span>
              </button>
              <button type="button" className="link-btn" onClick={() => removeZone(zone.id)}>
                Delete
              </button>
            </li>
          ))}
        </ul>
      )}

      {selectedZone ? (
        <div className="zone-editor">
          <h3>Edit zone</h3>
          <label className="extra-field">
            <span>Name</span>
            <input
              type="text"
              value={selectedZone.name}
              onChange={(e) => updateZone(selectedZone.id, { name: e.target.value })}
            />
          </label>
          <label className="extra-field">
            <span>Risk</span>
            <select
              value={selectedZone.risk}
              onChange={(e) => updateZone(selectedZone.id, { risk: e.target.value as RiskType })}
            >
              {RISK_TYPES.map((risk) => (
                <option key={risk} value={risk}>
                  {RISK_LABELS[risk]}
                </option>
              ))}
            </select>
          </label>
          <label className="extra-field">
            <span>Offset {fmtOffset(selectedZone.offset)}</span>
            <input
              type="range"
              min={ZONE_OFFSET_MIN}
              max={ZONE_OFFSET_MAX}
              step={0.05}
              value={selectedZone.offset}
              onChange={(e) => updateZone(selectedZone.id, { offset: Number(e.target.value) })}
            />
          </label>
          <details className="zone-time-window">
            <summary>Time window (optional)</summary>
            <div className="extra-field">
              <span>
                Active from{' '}
                {selectedZone.startTime !== undefined
                  ? formatTime(selectedZone.startTime)
                  : 'always'}
              </span>
              <div className="zone-time-row">
                <input
                  type="range"
                  min={0}
                  max={1439}
                  step={15}
                  value={selectedZone.startTime ?? 0}
                  disabled={selectedZone.startTime === undefined}
                  onChange={(e) =>
                    updateZone(selectedZone.id, { startTime: Number(e.target.value) })
                  }
                />
                {selectedZone.startTime !== undefined ? (
                  <button
                    type="button"
                    className="link-btn"
                    onClick={() => updateZone(selectedZone.id, { startTime: null })}
                  >
                    Clear
                  </button>
                ) : (
                  <button
                    type="button"
                    className="link-btn"
                    onClick={() => updateZone(selectedZone.id, { startTime: 0 })}
                  >
                    Set
                  </button>
                )}
              </div>
            </div>
            <div className="extra-field">
              <span>
                Active until{' '}
                {selectedZone.endTime !== undefined
                  ? formatTime(selectedZone.endTime)
                  : 'always'}
              </span>
              <div className="zone-time-row">
                <input
                  type="range"
                  min={0}
                  max={1439}
                  step={15}
                  value={selectedZone.endTime ?? 1439}
                  disabled={selectedZone.endTime === undefined}
                  onChange={(e) =>
                    updateZone(selectedZone.id, { endTime: Number(e.target.value) })
                  }
                />
                {selectedZone.endTime !== undefined ? (
                  <button
                    type="button"
                    className="link-btn"
                    onClick={() => updateZone(selectedZone.id, { endTime: null })}
                  >
                    Clear
                  </button>
                ) : (
                  <button
                    type="button"
                    className="link-btn"
                    onClick={() => updateZone(selectedZone.id, { endTime: 1439 })}
                  >
                    Set
                  </button>
                )}
              </div>
            </div>
          </details>
        </div>
      ) : null}

      <div className="storm-generator">
        <button
          type="button"
          className="link-btn"
          onClick={() => setShowStorm((v) => !v)}
        >
          {showStorm ? '▲ Cancel storm' : '▼ Generate storm band'}
        </button>
        {showStorm && (
          <div className="storm-form">
            <label className="extra-field">
              <span>Cold intensity {fmtOffset(stormIntensity)}</span>
              <input
                type="range"
                min={0.05}
                max={ZONE_OFFSET_MAX}
                step={0.05}
                value={stormIntensity}
                onChange={(e) => setStormIntensity(Number(e.target.value))}
              />
            </label>
            <label className="extra-field">
              <span>Starts {formatTime(stormStart)}</span>
              <input
                type="range"
                min={0}
                max={1439}
                step={15}
                value={stormStart}
                onChange={(e) => setStormStart(Number(e.target.value))}
              />
            </label>
            <label className="extra-field">
              <span>Ends {formatTime(stormEnd)}</span>
              <input
                type="range"
                min={0}
                max={1439}
                step={15}
                value={stormEnd}
                onChange={(e) => setStormEnd(Number(e.target.value))}
              />
            </label>
            <label className="extra-field journey-checkbox">
              <input
                type="checkbox"
                checked={stormSlantLeft}
                onChange={(e) => setStormSlantLeft(e.target.checked)}
              />
              Slant left (west-facing)
            </label>
            <button
              type="button"
              onClick={() => {
                const zones = generateMovingStorm(
                  extent,
                  hexSize,
                  stormIntensity,
                  stormSlantLeft,
                  stormStart,
                  stormEnd,
                );
                zones.forEach((z) => addZone({ id: crypto.randomUUID(), ...z }));
                setShowStorm(false);
              }}
            >
              Generate
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
