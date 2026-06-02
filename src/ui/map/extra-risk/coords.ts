import type { GeoJSONStoreFeatures } from 'terra-draw';
import type { WorldPoint, ZoneKind } from '@domain';

/**
 * Terra Draw stores geometry as GeoJSON `[lng, lat]`. The map uses
 * `L.CRS.Simple` with `worldToLatLng = [y, x]`, so a Terra Draw coordinate
 * `[lng, lat]` is exactly the world point `{ x: lng, y: lat }` in kilometres —
 * there is no projection round-trip. These helpers make that contract explicit
 * (and easy to test) so the rest of the feature never juggles raw coordinates.
 */
export function terraPositionToWorld(position: readonly number[]): WorldPoint {
  return { x: position[0] ?? 0, y: position[1] ?? 0 };
}

export function worldToTerraPosition(point: WorldPoint): [number, number] {
  return [point.x, point.y];
}

/**
 * Convert a (closed) GeoJSON ring to world points, dropping the duplicated
 * closing vertex GeoJSON requires but our model omits.
 */
export function ringToWorld(ring: readonly (readonly number[])[]): WorldPoint[] {
  const out = ring.map(terraPositionToWorld);
  const first = out[0];
  const last = out[out.length - 1];
  if (out.length > 1 && first && last && first.x === last.x && first.y === last.y) out.pop();
  return out;
}

/** Pull the outer ring out of a Terra Draw polygon feature, in world km. */
export function featureToWorldRing(feature: GeoJSONStoreFeatures): WorldPoint[] {
  const geom = feature.geometry;
  if (geom.type !== 'Polygon') return [];
  return ringToWorld(geom.coordinates[0] ?? []);
}

/** Read the originating tool from a Terra Draw feature's `mode` property. */
export function featureKind(feature: GeoJSONStoreFeatures): ZoneKind {
  const mode = feature.properties?.['mode'];
  if (mode === 'rectangle' || mode === 'circle' || mode === 'polygon') return mode;
  return 'polygon';
}

/**
 * Rebuild a clean, planar circle ring from a (possibly distorted) one. Terra
 * Draw's circle mode assumes a web-mercator map, so on `CRS.Simple` its output
 * can be slightly egg-shaped; we re-derive the centre and mean radius in world
 * km and emit a true circle so coverage and rendering are exact regardless of
 * Terra Draw's projection assumptions.
 */
export function normalizeCircleRing(ring: readonly WorldPoint[], segments = 64): WorldPoint[] {
  if (ring.length === 0) return [];
  let cx = 0;
  let cy = 0;
  for (const p of ring) {
    cx += p.x;
    cy += p.y;
  }
  cx /= ring.length;
  cy /= ring.length;
  let radius = 0;
  for (const p of ring) radius += Math.hypot(p.x - cx, p.y - cy);
  radius /= ring.length;
  const out: WorldPoint[] = [];
  for (let i = 0; i < segments; i++) {
    const a = (i / segments) * Math.PI * 2;
    out.push({ x: cx + radius * Math.cos(a), y: cy + radius * Math.sin(a) });
  }
  return out;
}
