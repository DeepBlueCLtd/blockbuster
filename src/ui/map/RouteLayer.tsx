import { CircleMarker, Marker, Pane, Polyline, Tooltip } from 'react-leaflet';
import { divIcon } from 'leaflet';
import type { LatLngExpression, LeafletEvent, Marker as LeafletMarker } from 'leaflet';
import type { CellId, CoaCellStep } from '@domain';
import { useBlockbusterStore } from '@/state/store';
import { COA_HALO_COLOR, coaColor } from '@/ui/theme';
import { worldToLatLng } from './projection';

/** Stroke width of a COA line — the selected one is drawn thicker. */
function lineWeight(selected: boolean): number {
  return selected ? 6 : 3;
}

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

/** Find the most recent step at or before `timeMin`, returning its cell id or null. */
function positionAtTime(steps: CoaCellStep[], timeMin: number): CellId | null {
  for (let i = steps.length - 1; i >= 0; i--) {
    if ((steps[i]?.arrivalTimeMinutes ?? 0) <= timeMin) return steps[i]?.cellId ?? null;
  }
  return null;
}

/** Draws each COA as a polyline (selected one emphasised) plus draggable waypoint markers. */
export function RouteLayer() {
  const grid = useBlockbusterStore((s) => s.grid);
  const plan = useBlockbusterStore((s) => s.plan);
  const selectedCoaId = useBlockbusterStore((s) => s.selectedCoaId);
  const waypoints = useBlockbusterStore((s) => s.waypoints);
  const showRoutes = useBlockbusterStore((s) => s.showRoutes);
  const displayTime = useBlockbusterStore((s) => s.displayTime);

  if (!grid || !showRoutes) return null;

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

  // Colour each COA by its rank (best route first) and draw the selected one
  // last so its thicker line sits above the rest. A light halo under every line
  // keeps the colours legible over whatever the map shows beneath them.
  const routes = (plan?.coas ?? [])
    .map((coa, index) => {
      const inRange =
        coa.arrivalTimeMinutes > coa.departureTimeMinutes &&
        displayTime >= coa.departureTimeMinutes &&
        displayTime <= coa.arrivalTimeMinutes;
      const positionCellId = inRange ? positionAtTime(coa.steps, displayTime) : null;
      const positionCenter = positionCellId ? grid.get(positionCellId)?.center : null;
      return {
        id: coa.id,
        color: coaColor(index),
        selected: coa.id === selectedCoaId,
        points: toPoints(coa.path),
        positionLatLng: positionCenter ? worldToLatLng(positionCenter) : null,
      };
    })
    .sort((a, b) => Number(a.selected) - Number(b.selected));

  return (
    <>
      {/* Route lines and their halos live in the topmost vector pane, so the COA
          paths are never hidden by the hex shading or the risk pies. Waypoint
          markers stay in markerPane above them. */}
      <Pane name="routes" style={{ zIndex: 430 }}>
        {/* All halos first, so none is painted over a neighbouring COA's line. */}
        {routes.map((route) => (
          <Polyline
            key={`halo-${route.id}`}
            positions={route.points}
            interactive={false}
            pathOptions={{
              color: COA_HALO_COLOR,
              weight: lineWeight(route.selected) + 4,
              opacity: 0.6,
            }}
          />
        ))}
        {routes.map((route) => (
          <Polyline
            key={route.id}
            positions={route.points}
            pathOptions={{
              color: route.color,
              weight: lineWeight(route.selected),
              // Every route is fully vivid; thickness alone marks the selection.
              opacity: 1,
            }}
          />
        ))}
        {/* Current group position along each COA at displayTime. */}
        {routes.map((route) =>
          route.positionLatLng ? (
            <CircleMarker
              key={`pos-${route.id}`}
              center={route.positionLatLng}
              radius={8}
              pathOptions={{
                color: '#ffffff',
                weight: 2,
                fillColor: route.color,
                fillOpacity: 1,
              }}
            />
          ) : null,
        )}
      </Pane>

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
