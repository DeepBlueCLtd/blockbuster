import { useBlockbusterStore } from '@/state/store';

/** Role label for a waypoint at `index` in a sequence of `count`. */
function roleOf(index: number, count: number): string {
  if (index === 0) return 'Start';
  if (index === count - 1) return 'End';
  return `Waypoint ${index}`;
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
  const selectedCellId = useBlockbusterStore((s) => s.selectedCellId);
  const optimiseOrder = useBlockbusterStore((s) => s.optimiseOrder);
  const reorderWaypoint = useBlockbusterStore((s) => s.reorderWaypoint);
  const toggleWaypoint = useBlockbusterStore((s) => s.toggleWaypoint);
  const clearWaypoints = useBlockbusterStore((s) => s.clearWaypoints);
  const setOptimiseOrder = useBlockbusterStore((s) => s.setOptimiseOrder);
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
