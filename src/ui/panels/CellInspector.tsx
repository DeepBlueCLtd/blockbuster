import { effectiveProfile, overriddenRisks, RISK_LABELS, RISK_TYPES } from '@domain';
import { useBlockbusterStore } from '@/state/store';

/** Per-cell risk table with inline override editing + reset. */
export function CellInspector() {
  const selectedCellId = useBlockbusterStore((s) => s.selectedCellId);
  const riskStates = useBlockbusterStore((s) => s.riskStates);
  const terrain = useBlockbusterStore((s) => s.terrain);
  const waypoints = useBlockbusterStore((s) => s.waypoints);
  const setOverride = useBlockbusterStore((s) => s.setOverride);
  const resetOverride = useBlockbusterStore((s) => s.resetOverride);
  const toggleWaypoint = useBlockbusterStore((s) => s.toggleWaypoint);
  const selectCell = useBlockbusterStore((s) => s.selectCell);

  // No selection: render nothing so the panel doesn't consume space.
  if (!selectedCellId) return null;

  const state = riskStates.get(selectedCellId);
  if (!state) return null;

  const eff = effectiveProfile(state);
  const overridden = new Set(overriddenRisks(state));
  const sample = terrain.get(selectedCellId);
  const isWaypoint = waypoints.includes(selectedCellId);

  return (
    <div className="inspector">
      <div className="inspector-header">
        <h2>Cell {selectedCellId}</h2>
        {/* Always-available deselect — handy when a waypoint marker sits on the
            cell and intercepts the toggle-click on the map. */}
        <button
          type="button"
          className="inspector-close"
          title="Close (deselect cell)"
          aria-label="Close cell editor"
          onClick={() => selectCell(null)}
        >
          ×
        </button>
      </div>
      {sample ? (
        <p className="cell-biome">
          {sample.biome} · {sample.temperature.toFixed(0)}°C · {Math.round(sample.elevation)} m
        </p>
      ) : null}
      <table className="risk-table">
        <tbody>
          {RISK_TYPES.map((risk) => {
            const isOverridden = overridden.has(risk);
            return (
              <tr key={risk} className={isOverridden ? 'overridden' : undefined}>
                <td className="risk-name">{RISK_LABELS[risk]}</td>
                <td className="risk-input">
                  <input
                    type="range"
                    min={0}
                    max={1}
                    step={0.05}
                    value={eff[risk]}
                    onChange={(event) =>
                      setOverride(selectedCellId, risk, Number(event.target.value))
                    }
                  />
                  <span className="risk-val">{eff[risk].toFixed(2)}</span>
                </td>
                <td className="risk-reset">
                  {isOverridden ? (
                    <button
                      type="button"
                      title="Reset this override"
                      onClick={() => resetOverride(selectedCellId, risk)}
                    >
                      ↺
                    </button>
                  ) : null}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <div className="inspector-actions">
        <button type="button" onClick={() => toggleWaypoint(selectedCellId)}>
          {isWaypoint ? 'Remove waypoint' : 'Add waypoint'}
        </button>
        {overridden.size > 0 ? (
          <button type="button" onClick={() => resetOverride(selectedCellId)}>
            Reset all
          </button>
        ) : null}
      </div>
    </div>
  );
}
