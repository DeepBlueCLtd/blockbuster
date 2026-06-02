import type { WorldPoint } from './world';

/** Twice the signed area (shoelace). Positive when the ring winds counter-clockwise. */
function signedArea2(ring: readonly WorldPoint[]): number {
  let sum = 0;
  const n = ring.length;
  for (let i = 0; i < n; i++) {
    const a = ring[i];
    const b = ring[(i + 1) % n];
    if (!a || !b) continue;
    sum += a.x * b.y - b.x * a.y;
  }
  return sum;
}

/** Area of a simple polygon ring in world km², independent of winding. */
export function polygonArea(ring: readonly WorldPoint[]): number {
  return Math.abs(signedArea2(ring)) / 2;
}

/** Intersection of the infinite line a→b with the segment prev→cur. */
function lineIntersect(a: WorldPoint, b: WorldPoint, prev: WorldPoint, cur: WorldPoint): WorldPoint {
  const a1 = b.y - a.y;
  const b1 = a.x - b.x;
  const c1 = a1 * a.x + b1 * a.y;
  const a2 = cur.y - prev.y;
  const b2 = prev.x - cur.x;
  const c2 = a2 * prev.x + b2 * prev.y;
  const det = a1 * b2 - a2 * b1;
  if (det === 0) return cur; // parallel — degenerate; caller tolerates
  return { x: (b2 * c1 - b1 * c2) / det, y: (a1 * c2 - a2 * c1) / det };
}

/**
 * Sutherland–Hodgman clip of `subject` (any simple polygon) by `clip`, which
 * MUST be convex. Returns the intersection polygon ring (empty if disjoint).
 */
export function clipPolygon(
  subject: readonly WorldPoint[],
  clip: readonly WorldPoint[],
): WorldPoint[] {
  if (subject.length < 3 || clip.length < 3) return [];
  // Normalise the convex clip to CCW so "inside" is the left of each directed edge.
  const ccw = signedArea2(clip) < 0 ? [...clip].reverse() : [...clip];
  let output: WorldPoint[] = [...subject];

  for (let i = 0; i < ccw.length; i++) {
    const a = ccw[i];
    const b = ccw[(i + 1) % ccw.length];
    if (!a || !b) continue;
    const input = output;
    output = [];
    const inside = (p: WorldPoint): boolean =>
      (b.x - a.x) * (p.y - a.y) - (b.y - a.y) * (p.x - a.x) >= 0;

    for (let j = 0; j < input.length; j++) {
      const cur = input[j];
      const prev = input[(j - 1 + input.length) % input.length];
      if (!cur || !prev) continue;
      const curIn = inside(cur);
      if (curIn) {
        if (!inside(prev)) output.push(lineIntersect(a, b, prev, cur));
        output.push(cur);
      } else if (inside(prev)) {
        output.push(lineIntersect(a, b, prev, cur));
      }
    }
    if (output.length === 0) return [];
  }
  return output;
}

/**
 * Fraction of a convex hex cell covered by a zone ring, in [0, 1]. Used to
 * area-weight a zone's offset for that cell.
 */
export function coverageFraction(
  hexVertices: readonly WorldPoint[],
  zoneRing: readonly WorldPoint[],
): number {
  const hexArea = polygonArea(hexVertices);
  if (hexArea <= 0) return 0;
  const clipped = clipPolygon(zoneRing, hexVertices);
  if (clipped.length < 3) return 0;
  return Math.min(1, polygonArea(clipped) / hexArea);
}
