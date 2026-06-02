/**
 * Pure hex geometry for the Hex Grid module — pointy- and flat-top axial maths
 * from Red Blob Games (https://www.redblobgames.com/grids/hexagons/), hardened
 * and kept self-contained: this file imports only `@domain` types, never the
 * throwaway `src/mocks/hexMath` scaffold, so the module honours the engine
 * dependency rule (engine/* → @domain only).
 */
import type { Axial, HexLayout, Km, WorldExtent, WorldPoint } from '@domain';
import { DEFAULT_CELL_COUNT } from '@domain';

const SQRT3 = Math.sqrt(3);

/**
 * The six axial neighbour offsets, ordered so successive entries are adjacent
 * around a cell (used for both topology and, by extension, render ordering).
 */
export const AXIAL_DIRECTIONS: readonly Axial[] = [
  { q: 1, r: 0 },
  { q: 1, r: -1 },
  { q: 0, r: -1 },
  { q: -1, r: 0 },
  { q: -1, r: 1 },
  { q: 0, r: 1 },
];

/** Axial coordinate → world-space centre, for the given layout. */
export function axialToWorld(coord: Axial, layout: HexLayout): WorldPoint {
  const { size, origin, orientation } = layout;
  if (orientation === 'pointy') {
    return {
      x: origin.x + size * SQRT3 * (coord.q + coord.r / 2),
      y: origin.y + size * 1.5 * coord.r,
    };
  }
  return {
    x: origin.x + size * 1.5 * coord.q,
    y: origin.y + size * SQRT3 * (coord.r + coord.q / 2),
  };
}

/** World point → the axial coordinate of the hex whose interior contains it. */
export function worldToAxial(point: WorldPoint, layout: HexLayout): Axial {
  const { size, origin, orientation } = layout;
  const px = (point.x - origin.x) / size;
  const py = (point.y - origin.y) / size;
  let q: number;
  let r: number;
  if (orientation === 'pointy') {
    q = (SQRT3 / 3) * px - (1 / 3) * py;
    r = (2 / 3) * py;
  } else {
    q = (2 / 3) * px;
    r = (-1 / 3) * px + (SQRT3 / 3) * py;
  }
  return roundAxial(q, r);
}

/** Round fractional axial/cube coordinates to the nearest valid hex. */
export function roundAxial(qf: number, rf: number): Axial {
  const sf = -qf - rf;
  let q = Math.round(qf);
  let r = Math.round(rf);
  const s = Math.round(sf);
  const dq = Math.abs(q - qf);
  const dr = Math.abs(r - rf);
  const ds = Math.abs(s - sf);
  // Re-derive whichever coordinate drifted most, keeping q + r + s === 0.
  if (dq > dr && dq > ds) q = -r - s;
  else if (dr > ds) r = -q - s;
  return { q, r };
}

/** The six world-space polygon vertices of the cell centred at `center`. */
export function hexCorners(center: WorldPoint, layout: HexLayout): WorldPoint[] {
  // Pointy-top hexes have a vertex at the top (−90°) reached by stepping from the
  // −30° start; flat-top hexes start at 0°.
  const startDeg = layout.orientation === 'pointy' ? -30 : 0;
  const corners: WorldPoint[] = [];
  for (let i = 0; i < 6; i++) {
    const angle = ((startDeg + 60 * i) * Math.PI) / 180;
    corners.push({
      x: center.x + layout.size * Math.cos(angle),
      y: center.y + layout.size * Math.sin(angle),
    });
  }
  return corners;
}

/** Hex (cube) distance in steps between two axial coordinates. */
export function axialDistance(a: Axial, b: Axial): number {
  return (Math.abs(a.q - b.q) + Math.abs(a.q + a.r - b.q - b.r) + Math.abs(a.r - b.r)) / 2;
}

/** The six axial neighbours of a coordinate (no grid clipping). */
export function axialNeighbors(coord: Axial): Axial[] {
  return AXIAL_DIRECTIONS.map((d) => ({ q: coord.q + d.q, r: coord.r + d.r }));
}

/**
 * Circumradius (centre-to-vertex, km) that tiles `extent` with roughly
 * `targetCount` regular hexes. Inverts the regular-hexagon area
 * `A = (3√3 / 2)·size²`, so `size = √(2·A_cell / (3√3))` where
 * `A_cell = extent area / count`. Orientation-independent (area is). This is how
 * the "tunable size, default ≈100 cells" requirement is met.
 */
export function hexSizeForCellCount(
  extent: WorldExtent,
  targetCount: number = DEFAULT_CELL_COUNT,
): Km {
  const area = extent.width * extent.height;
  const perCell = area / Math.max(1, targetCount);
  return Math.sqrt((2 * perCell) / (3 * SQRT3));
}
