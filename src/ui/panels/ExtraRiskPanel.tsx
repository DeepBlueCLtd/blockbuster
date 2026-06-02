import { RISK_LABELS, RISK_TYPES, ZONE_OFFSET_MAX, ZONE_OFFSET_MIN } from '@domain';
import type { RiskType } from '@domain';
import { useBlockbusterStore } from '@/state/store';
import type { DrawMode } from '@/state/types';

const TOOLS: ReadonlyArray<{ mode: Exclude<DrawMode, null>; label: string }> = [
  { mode: 'rectangle', label: 'Rectangle' },
  { mode: 'circle', label: 'Circle' },
  { mode: 'polygon', label: 'Polygon' },
];

/** Format a signed offset for display, e.g. +0.30 / -0.15. */
function fmtOffset(value: number): string {
  return `${value >= 0 ? '+' : ''}${value.toFixed(2)}`;
}

/**
 * Extra-risk tab: choose the risk a new zone targets, pick a draw tool, and edit
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
        <p className="panel-hint">No extra-risk zones yet.</p>
      ) : (
        <ul className="zone-list">
          {zones.map((zone) => (
            <li
              key={zone.id}
              className={zone.id === selectedZoneId ? 'zone-row selected' : 'zone-row'}
            >
              <button type="button" className="zone-select" onClick={() => selectZone(zone.id)}>
                <span className="zone-name">{zone.name}</span>
                <span className="zone-meta">
                  {zone.kind} · {RISK_LABELS[zone.risk]} · {fmtOffset(zone.offset)}
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
        </div>
      ) : null}
    </div>
  );
}
