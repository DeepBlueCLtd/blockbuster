import type { TimeWindow } from '@domain';
import { useBlockbusterStore } from '@/state/store';
import { formatTime } from '@/ui/utils/time';

/** Role label for a waypoint at `index` in a sequence of `count`. */
function roleOf(index: number, count: number): string {
  if (index === 0) return 'Start';
  if (index === count - 1) return 'End';
  return `Waypoint ${index}`;
}

/** Collapsible earliest/latest arrival window editor for one waypoint. */
function TimeWindowEditor({
  index: _index,
  window,
  onChange,
}: {
  index: number;
  window: TimeWindow | null;
  onChange: (w: TimeWindow | null) => void;
}) {
  const earliest = window?.earliest;
  const latest = window?.latest;

  function setEarliest(val: number | undefined) {
    const next: TimeWindow = {};
    if (val !== undefined) next.earliest = val;
    if (latest !== undefined) next.latest = latest;
    onChange(Object.keys(next).length === 0 ? null : next);
  }

  function setLatest(val: number | undefined) {
    const next: TimeWindow = {};
    if (earliest !== undefined) next.earliest = earliest;
    if (val !== undefined) next.latest = val;
    onChange(Object.keys(next).length === 0 ? null : next);
  }

  const summary = window
    ? `Window: ${earliest !== undefined ? formatTime(earliest) : 'any'}–${latest !== undefined ? formatTime(latest) : 'any'}`
    : '+ Arrival window';

  return (
    <details className="time-window" onClick={(e) => e.stopPropagation()}>
      <summary className="link-btn">{summary}</summary>
      <div className="time-window-body">
        <label className="time-window-field">
          <input
            type="checkbox"
            checked={earliest !== undefined}
            onChange={(e) => setEarliest(e.target.checked ? 8 * 60 : undefined)}
          />
          Not before {earliest !== undefined ? formatTime(earliest) : ''}
        </label>
        {earliest !== undefined && (
          <input
            type="range"
            min={0}
            max={1439}
            step={15}
            value={earliest}
            onChange={(e) => setEarliest(Number(e.target.value))}
          />
        )}
        <label className="time-window-field">
          <input
            type="checkbox"
            checked={latest !== undefined}
            onChange={(e) => setLatest(e.target.checked ? 20 * 60 : undefined)}
          />
          Not after {latest !== undefined ? formatTime(latest) : ''}
        </label>
        {latest !== undefined && (
          <input
            type="range"
            min={0}
            max={1439}
            step={15}
            value={latest}
            onChange={(e) => setLatest(Number(e.target.value))}
          />
        )}
      </div>
    </details>
  );
}

/**
 * The waypoint sequence editor. Waypoints are visited **in this order**, so the
 * analyst can move each one up/down to change the route's sequence, or remove it.
 * Adding happens from the Cell inspector; relocating happens by dragging markers
 * on the map. Reordering or relocating re-plans through the store.
 */
export function WaypointsPanel() {
  const grid = useBlockbusterStore((s) => s.grid);
  const waypoints = useBlockbusterStore((s) => s.waypoints);
  const waypointWindows = useBlockbusterStore((s) => s.waypointWindows);
  const selectedCellId = useBlockbusterStore((s) => s.selectedCellId);
  const optimiseOrder = useBlockbusterStore((s) => s.optimiseOrder);
  const reorderWaypoint = useBlockbusterStore((s) => s.reorderWaypoint);
  const toggleWaypoint = useBlockbusterStore((s) => s.toggleWaypoint);
  const clearWaypoints = useBlockbusterStore((s) => s.clearWaypoints);
  const setOptimiseOrder = useBlockbusterStore((s) => s.setOptimiseOrder);
  const setWaypointWindow = useBlockbusterStore((s) => s.setWaypointWindow);
  const selectCell = useBlockbusterStore((s) => s.selectCell);

  const last = waypoints.length - 1;

  return (
    <div className="waypoints">
      <div className="waypoints-head">
        <h3>Waypoints</h3>
        {waypoints.length > 0 ? (
          <button type="button" className="link-btn" onClick={clearWaypoints}>
            Clear
          </button>
        ) : null}
      </div>

      {waypoints.length === 0 ? (
        <p className="panel-hint">
          Click a hex on the map, then use <em>Add waypoint</em> in the inspector below.
        </p>
      ) : (
        <>
          <p className="panel-hint">
            Visited in this order. Reorder here, or drag a numbered marker on the map to move one.
            {waypoints.length >= 3 ? (
              <>
                {' '}
                Legs between consecutive waypoints are planned independently and may overlap, so
                the route can revisit cells where two legs meet.
              </>
            ) : null}
          </p>
          <label className="optimise-order-toggle">
            <input
              type="checkbox"
              checked={optimiseOrder}
              onChange={(e) => setOptimiseOrder(e.target.checked)}
            />
            Optimise order
          </label>
          <ol className="waypoint-list">
            {waypoints.map((id, index) => {
              const known = grid?.get(id) != null;
              return (
                <li
                  key={id}
                  className={id === selectedCellId ? 'waypoint-row selected' : 'waypoint-row'}
                  onClick={() => selectCell(id)}
                >
                  <span className="waypoint-badge">{index + 1}</span>
                  <span className="waypoint-label">
                    <strong>{roleOf(index, waypoints.length)}</strong>
                    <span className="waypoint-cell">{known ? `cell ${id}` : `${id} (off-grid)`}</span>
                    <TimeWindowEditor
                      index={index}
                      window={waypointWindows[index] ?? null}
                      onChange={(w) => setWaypointWindow(index, w)}
                    />
                  </span>
                  <span className="waypoint-actions">
                    <button
                      type="button"
                      title="Move earlier in the route"
                      disabled={index === 0}
                      onClick={(e) => {
                        e.stopPropagation();
                        reorderWaypoint(index, index - 1);
                      }}
                    >
                      ↑
                    </button>
                    <button
                      type="button"
                      title="Move later in the route"
                      disabled={index === last}
                      onClick={(e) => {
                        e.stopPropagation();
                        reorderWaypoint(index, index + 1);
                      }}
                    >
                      ↓
                    </button>
                    <button
                      type="button"
                      title="Remove this waypoint"
                      onClick={(e) => {
                        e.stopPropagation();
                        toggleWaypoint(id);
                      }}
                    >
                      ✕
                    </button>
                  </span>
                </li>
              );
            })}
          </ol>
          {waypoints.length < 2 ? (
            <p className="panel-hint">Add at least two waypoints to generate routes.</p>
          ) : null}
        </>
      )}
    </div>
  );
}
