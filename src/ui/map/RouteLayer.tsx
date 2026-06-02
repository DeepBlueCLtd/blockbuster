import { Marker, Polyline, Tooltip } from 'react-leaflet';
import { divIcon } from 'leaflet';
import type { LatLngExpression, LeafletEvent, Marker as LeafletMarker } from 'leaflet';
import type { CellId } from '@domain';
import { useBlockbusterStore } from '@/state/store';
import { worldToLatLng } from './projection';

/** Role label for the waypoint at `index` in a sequence of `count`. */
function roleOf(index: number, count: number): string {
  if (index === 0) return 'Start';
  if (index === count - 1) return 'End';
  return `Waypoint ${index}`;
}

/** A numbered, draggable badge for a waypoint. The number shows its visit order. */
function waypointIcon(index: number, count: number) {
  const variant = index === 0 ? 'is-start' : index === count - 1 ? 'is-end' : 'is-mid';
  return divIcon({
    className: `wp-marker ${variant}`,
    html: `<span>${index + 1}</span>`,
    iconSize: [26, 26],
    iconAnchor: [13, 13],
  });
}

/** Draws each COA as a polyline (selected one emphasised) plus draggable waypoint markers. */
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

  // Drag a waypoint onto another cell to move it, keeping its place in the sequence.
  // Read live state so the snap decision never races a stale render.
  const handleDragEnd = (index: number) => (event: LeafletEvent) => {
    const marker = event.target as LeafletMarker;
    const { lat, lng } = marker.getLatLng();
    const { grid: liveGrid, waypoints: liveWps, relocateWaypoint } = useBlockbusterStore.getState();
    const currentId = liveWps[index];
    const targetId = liveGrid?.pointToCell({ x: lng, y: lat });
    const valid = targetId != null && targetId !== currentId && !liveWps.includes(targetId);
    if (valid && targetId) relocateWaypoint(index, targetId);
    // Snap the marker to the centre of its resting cell (the new one, or back home).
    const restId = valid ? targetId : currentId;
    const center = restId ? liveGrid?.get(restId)?.center : undefined;
    if (center) marker.setLatLng([center.y, center.x]);
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
        return (
          <Marker
            key={id}
            position={worldToLatLng(center)}
            draggable
            icon={waypointIcon(index, waypoints.length)}
            eventHandlers={{ dragend: handleDragEnd(index) }}
          >
            <Tooltip direction="top">{roleOf(index, waypoints.length)}</Tooltip>
          </Marker>
        );
      })}
    </>
  );
}
