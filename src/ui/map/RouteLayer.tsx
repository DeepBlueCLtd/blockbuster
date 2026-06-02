import { CircleMarker, Polyline, Tooltip } from 'react-leaflet';
import type { LatLngExpression } from 'leaflet';
import type { CellId } from '@domain';
import { useBlockbusterStore } from '@/state/store';
import { worldToLatLng } from './projection';

/** Draws each COA as a polyline (selected one emphasised) plus waypoint markers. */
export function RouteLayer() {
  const grid = useBlockbusterStore((s) => s.grid);
  const plan = useBlockbusterStore((s) => s.plan);
  const selectedCoaId = useBlockbusterStore((s) => s.selectedCoaId);
  const waypoints = useBlockbusterStore((s) => s.waypoints);

  if (!grid) return null;

  const toPoints = (ids: readonly CellId[]): LatLngExpression[] => {
    const points: LatLngExpression[] = [];
    for (const id of ids) {
      const center = grid.get(id)?.center;
      if (center) points.push(worldToLatLng(center));
    }
    return points;
  };

  return (
    <>
      {plan?.coas.map((coa) => {
        const selected = coa.id === selectedCoaId;
        return (
          <Polyline
            key={coa.id}
            positions={toPoints(coa.path)}
            pathOptions={{
              color: selected ? '#1565c0' : '#90a4ae',
              weight: selected ? 5 : 2,
              opacity: selected ? 0.9 : 0.45,
            }}
          />
        );
      })}

      {waypoints.map((id, index) => {
        const center = grid.get(id)?.center;
        if (!center) return null;
        const role = index === 0 ? 'Start' : index === waypoints.length - 1 ? 'End' : `WP${index}`;
        return (
          <CircleMarker
            key={id}
            center={worldToLatLng(center)}
            radius={7}
            pathOptions={{ color: '#0d47a1', fillColor: '#fff', fillOpacity: 1, weight: 3 }}
          >
            <Tooltip direction="top">{role}</Tooltip>
          </CircleMarker>
        );
      })}
    </>
  );
}
