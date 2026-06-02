import { RISK_LABELS, RISK_TYPES } from '@domain';
import { useBlockbusterStore } from '@/state/store';
import type { DisplayRisk } from '@/state/types';

/** Floating controls over the map: what to shade by, hex size, live stats. */
export function MapToolbar() {
  const displayRisk = useBlockbusterStore((s) => s.displayRisk);
  const setDisplayRisk = useBlockbusterStore((s) => s.setDisplayRisk);
  const hexSize = useBlockbusterStore((s) => s.hexSize);
  const setHexSize = useBlockbusterStore((s) => s.setHexSize);
  const planning = useBlockbusterStore((s) => s.planning);
  const cellCount = useBlockbusterStore((s) => s.grid?.cells.length ?? 0);

  return (
    <div className="map-toolbar">
      <label>
        Shade by{' '}
        <select
          value={displayRisk}
          onChange={(event) => setDisplayRisk(event.target.value as DisplayRisk)}
        >
          <option value="composite">Composite cost</option>
          {RISK_TYPES.map((risk) => (
            <option key={risk} value={risk}>
              {RISK_LABELS[risk]}
            </option>
          ))}
        </select>
      </label>
      <label>
        Hex {hexSize.toFixed(1)} km
        <input
          type="range"
          min={1.2}
          max={5}
          step={0.2}
          value={hexSize}
          onChange={(event) => setHexSize(Number(event.target.value))}
        />
      </label>
      <span className="map-stat">
        {cellCount} cells{planning ? ' · planning…' : ''}
      </span>
    </div>
  );
}
