import { RISK_LABELS, RISK_TYPES } from '@domain';
import { useBlockbusterStore } from '@/state/store';
import type { DisplayRisk } from '@/state/types';
import { formatTime } from '@/ui/utils/time';

/** Floating controls over the map: layer toggles, what to shade by, hex size, live stats. */
export function MapToolbar() {
  const showTerrain = useBlockbusterStore((s) => s.showTerrain);
  const setShowTerrain = useBlockbusterStore((s) => s.setShowTerrain);
  const showHexGrid = useBlockbusterStore((s) => s.showHexGrid);
  const setShowHexGrid = useBlockbusterStore((s) => s.setShowHexGrid);
  const showRiskPies = useBlockbusterStore((s) => s.showRiskPies);
  const setShowRiskPies = useBlockbusterStore((s) => s.setShowRiskPies);
  const showRiskBars = useBlockbusterStore((s) => s.showRiskBars);
  const setShowRiskBars = useBlockbusterStore((s) => s.setShowRiskBars);
  const showRiskStacks = useBlockbusterStore((s) => s.showRiskStacks);
  const setShowRiskStacks = useBlockbusterStore((s) => s.setShowRiskStacks);
  const showRoutes = useBlockbusterStore((s) => s.showRoutes);
  const setShowRoutes = useBlockbusterStore((s) => s.setShowRoutes);
  const displayRisk = useBlockbusterStore((s) => s.displayRisk);
  const setDisplayRisk = useBlockbusterStore((s) => s.setDisplayRisk);
  const hexSize = useBlockbusterStore((s) => s.hexSize);
  const setHexSize = useBlockbusterStore((s) => s.setHexSize);
  const planning = useBlockbusterStore((s) => s.planning);
  const cellCount = useBlockbusterStore((s) => s.grid?.cells.length ?? 0);
  const displayTime = useBlockbusterStore((s) => s.displayTime);
  const setDisplayTime = useBlockbusterStore((s) => s.setDisplayTime);

  return (
    <div className="map-toolbar">
      <div className="map-toggles">
        <label className="toggle">
          <input
            type="checkbox"
            checked={showTerrain}
            onChange={(event) => setShowTerrain(event.target.checked)}
          />
          Base map
        </label>
        <label className="toggle">
          <input
            type="checkbox"
            checked={showHexGrid}
            onChange={(event) => setShowHexGrid(event.target.checked)}
          />
          Hex grid
        </label>
        <label className="toggle">
          <input
            type="checkbox"
            checked={showRiskPies}
            onChange={(event) => setShowRiskPies(event.target.checked)}
          />
          Risk pies
        </label>
        <label className="toggle">
          <input
            type="checkbox"
            checked={showRiskBars}
            onChange={(event) => setShowRiskBars(event.target.checked)}
          />
          Risk bars
        </label>
        <label className="toggle">
          <input
            type="checkbox"
            checked={showRiskStacks}
            onChange={(event) => setShowRiskStacks(event.target.checked)}
          />
          Risk stack
        </label>
        <label className="toggle">
          <input
            type="checkbox"
            checked={showRoutes}
            onChange={(event) => setShowRoutes(event.target.checked)}
          />
          Routes
        </label>
      </div>
      <label>
        Shade by{' '}
        <select
          value={displayRisk}
          disabled={!showHexGrid}
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
      <label>
        Time {formatTime(displayTime)}
        <input
          type="range"
          min={0}
          max={1439}
          step={15}
          value={displayTime}
          onChange={(event) => setDisplayTime(Number(event.target.value))}
        />
      </label>
      <span className="map-stat">
        {cellCount} cells{planning ? ' · planning…' : ''}
      </span>
    </div>
  );
}
