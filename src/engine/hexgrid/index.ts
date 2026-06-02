import type {
  CellId,
  GridBuilder,
  GridLayoutSpec,
  HexCell,
  HexGrid,
  HexLayout,
  TerrainField,
  TerrainSample,
  WorldExtent,
} from '@domain';
import { parseCellId, toCellId } from '@domain';
import { axialDistance, axialNeighbors, axialToWorld, hexCorners, worldToAxial } from './geometry';

export { hexSizeForCellCount } from './geometry';

/**
 * HEX GRID MODULE — real implementation of {@link GridBuilder}.
 *
 * Lays a hex grid over the world rectangle (keeping cells whose centre lies
 * inside it, for a clean ragged border) and samples a terrain field into the
 * cells. All hex maths lives in `./geometry`; this file owns construction,
 * indexing and the O(1)/O(6) topology queries. Pure and deterministic: geometry
 * depends only on `extent` + `layout`. See docs/spec/04-engine-hexgrid.md.
 */
export function createGridBuilder(): GridBuilder {
  return {
    build(extent: WorldExtent, layout: GridLayoutSpec): HexGrid {
      return buildHexGrid(extent, {
        orientation: layout.orientation,
        size: layout.size,
        origin: layout.origin ?? { x: 0, y: 0 },
      });
    },
    sampleTerrain(grid: HexGrid, field: TerrainField): Map<CellId, TerrainSample> {
      const out = new Map<CellId, TerrainSample>();
      for (const cell of grid.cells) out.set(cell.id, field.sample(cell.center));
      return out;
    },
  };
}

/**
 * Build a {@link HexGrid} clipped to `extent`. A cell is kept when its centre
 * lies inside `[0, width] × [0, height]`. Adjacency is precomputed once so
 * `neighbors` is a map lookup rather than a per-call recompute.
 */
export function buildHexGrid(extent: WorldExtent, layout: HexLayout): HexGrid {
  const cells: HexCell[] = [];
  const byId = new Map<CellId, HexCell>();

  // Axial bounding box from the four world corners (with a one-cell margin so the
  // ragged edge is never clipped early).
  const { minQ, maxQ, minR, maxR } = axialBounds(extent, layout);

  for (let r = minR - 1; r <= maxR + 1; r++) {
    for (let q = minQ - 1; q <= maxQ + 1; q++) {
      const coord = { q, r };
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

  // Precompute in-grid adjacency: O(6) per cell, once.
  const adjacency = new Map<CellId, CellId[]>();
  for (const cell of cells) {
    const ns: CellId[] = [];
    for (const n of axialNeighbors(cell.coord)) {
      const nid = toCellId(n);
      if (byId.has(nid)) ns.push(nid);
    }
    adjacency.set(cell.id, ns);
  }

  return {
    layout,
    extent,
    cells,
    get: (id) => byId.get(id),
    // Copy so callers can't mutate the cached adjacency list.
    neighbors: (id) => adjacency.get(id)?.slice() ?? [],
    distance: (a, b) => axialDistance(parseCellId(a), parseCellId(b)),
    pointToCell: (point) => {
      const id = toCellId(worldToAxial(point, layout));
      return byId.has(id) ? id : undefined;
    },
  };
}

/** Axial (q, r) bounding box covering the four world corners of `extent`. */
function axialBounds(
  extent: WorldExtent,
  layout: HexLayout,
): { minQ: number; maxQ: number; minR: number; maxR: number } {
  const corners = [
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
  return { minQ, maxQ, minR, maxR };
}
