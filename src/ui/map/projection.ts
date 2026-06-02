import type { LatLngExpression } from 'leaflet';
import type { WorldPoint } from '@domain';

/**
 * World ↔ Leaflet projection for the fictitious map. We use `L.CRS.Simple`, so a
 * world point `(x, y)` in kilometres maps to a Leaflet `LatLng` of `[y, x]`.
 *
 * NOTE: Leaflet's screen-y increases downward; if the map renders flipped,
 * negate `y` here (and adjust the bounds in `MapView`). Owning team to finalise.
 */
export function worldToLatLng(point: WorldPoint): LatLngExpression {
  return [point.y, point.x];
}

export function worldRingToLatLng(ring: readonly WorldPoint[]): LatLngExpression[] {
  return ring.map(worldToLatLng);
}
