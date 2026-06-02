/**
 * Standard pointy-/flat-top hex geometry, extracted so the mock grid builder and
 * the routing mock can share it. The real `engine/hexgrid` module is free to
 * reimplement (indexed, perf-tuned) against the same `HexGrid` contract — this
 * is throwaway scaffolding that keeps the skeleton alive.
 *
 * Reference: https://www.redblobgames.com/grids/hexagons/
 */
import type { Axial, CellId, HexCell, HexGrid, HexLayout } from '@domain';
import { toCellId, parseCellId } from '@domain';
import type { WorldExtent, WorldPoint } from '@domain';

const SQRT3 = Math.sqrt(3);

const AXIAL_DIRECTIONS: readonly Axial[] = [
  { q: 1, r: 0 },
  { q: 1, r: -1 },
  { q: 0, r: -1 },
  { q: -1, r: 0 },
  { q: -1, r: 1 },
  { q: 0, r: 1 },
];

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

function roundAxial(qf: number, rf: number): Axial {
  const sf = -qf - rf;
  let q = Math.round(qf);
  let r = Math.round(rf);
  const s = Math.round(sf);
  const dq = Math.abs(q - qf);
  const dr = Math.abs(r - rf);
  const ds = Math.abs(s - sf);
  if (dq > dr && dq > ds) q = -r - s;
  else if (dr > ds) r = -q - s;
  return { q, r };
}

export function hexCorners(center: WorldPoint, layout: HexLayout): WorldPoint[] {
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

export function axialDistance(a: Axial, b: Axial): number {
  return (Math.abs(a.q - b.q) + Math.abs(a.q + a.r - b.q - b.r) + Math.abs(a.r - b.r)) / 2;
}

export function axialNeighbors(coord: Axial): Axial[] {
  return AXIAL_DIRECTIONS.map((d) => ({ q: coord.q + d.q, r: coord.r + d.r }));
}

/**
 * Build a hex grid clipped to `extent`. A cell is kept when its centre lies
 * inside the world rectangle, which gives a clean, ragged border.
 */
export function buildHexGrid(extent: WorldExtent, layout: HexLayout): HexGrid {
  const cells: HexCell[] = [];
  const byId = new Map<CellId, HexCell>();

  // Derive an axial bounding box from the four world corners, with a margin.
  const corners: WorldPoint[] = [
    { x: 0, y: 0 },
    { x: extent.width, y: 0 },
    { x: 0, y: extent.height },
    { x: extent.width, y: extent.height },
  ];
  let minQ = Infinity;
  let maxQ = -Infinity;
  let minR = Infinity;
  let maxR = -Infinity;
  for (const corner of corners) {
    const { q, r } = worldToAxial(corner, layout);
    minQ = Math.min(minQ, q);
    maxQ = Math.max(maxQ, q);
    minR = Math.min(minR, r);
    maxR = Math.max(maxR, r);
  }

  for (let r = minR - 1; r <= maxR + 1; r++) {
    for (let q = minQ - 1; q <= maxQ + 1; q++) {
      const coord: Axial = { q, r };
      const center = axialToWorld(coord, layout);
      if (center.x < 0 || center.x > extent.width || center.y < 0 || center.y > extent.height) {
        continue;
      }
      const cell: HexCell = {
        id: toCellId(coord),
        coord,
        center,
        vertices: hexCorners(center, layout),
      };
      cells.push(cell);
      byId.set(cell.id, cell);
    }
  }

  return {
    layout,
    extent,
    cells,
    get: (id) => byId.get(id),
    neighbors: (id) => {
      const cell = byId.get(id);
      if (!cell) return [];
      return axialNeighbors(cell.coord)
        .map(toCellId)
        .filter((nid) => byId.has(nid));
    },
    distance: (a, b) => axialDistance(parseCellId(a), parseCellId(b)),
    pointToCell: (point) => {
      const id = toCellId(worldToAxial(point, layout));
      return byId.has(id) ? id : undefined;
    },
  };
}
