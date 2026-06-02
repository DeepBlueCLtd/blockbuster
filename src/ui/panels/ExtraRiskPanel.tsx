import { RISK_LABELS } from '@domain';
import { useBlockbusterStore } from '@/state/store';
import type { DrawMode } from '@/state/types';

const TOOLS: ReadonlyArray<{ mode: Exclude<DrawMode, null>; label: string }> = [
  { mode: 'rectangle', label: 'Rectangle' },
  { mode: 'circle', label: 'Circle' },
  { mode: 'polygon', label: 'Polygon' },
];

/**
 * Extra-risk tab: pick a draw tool to add zones over the basemap, and review the
 * zones captured so far. (Per-zone channel/offset editing and the hex-score
 * contribution land in the next slice.)
 */
export function ExtraRiskPanel() {
  const drawMode = useBlockbusterStore((s) => s.drawMode);
  const setDrawMode = useBlockbusterStore((s) => s.setDrawMode);
  const zones = useBlockbusterStore((s) => s.zones);
  const selectedZoneId = useBlockbusterStore((s) => s.selectedZoneId);
  const selectZone = useBlockbusterStore((s) => s.selectZone);
  const removeZone = useBlockbusterStore((s) => s.removeZone);

  return (
    <div className="extra-risk">
      <p className="panel-hint">
        Pick a tool, then draw a zone on the map. For a polygon, click each point and click the
        first point again to close it.
      </p>
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
                  {zone.kind} · {RISK_LABELS[zone.risk]} · {zone.ring.length} pts
                </span>
              </button>
              <button type="button" className="link-btn" onClick={() => removeZone(zone.id)}>
                Delete
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
