import type {
  Biome,
  CellId,
  GridBuilder,
  GridLayoutSpec,
  HexCell,
  HexGrid,
  HexLayout,
  TerrainField,
  TerrainSample,
  WorldExtent,
  WorldPoint,
} from '@domain';
import { BIOMES, parseCellId, toCellId } from '@domain';
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
      for (const cell of grid.cells) out.set(cell.id, multiSampleTerrain(cell, field));
      return out;
    },
  };
}

/**
 * Generate the 7 sample points for a hex cell: the centre plus the midpoints
 * between the centre and each of the 6 vertices. This gives even spatial
 * coverage without over-sampling the boundary (which is shared with neighbours).
 */
function hexSamplePoints(cell: HexCell): WorldPoint[] {
  const { center, vertices } = cell;
  const points: WorldPoint[] = [center];
  for (const v of vertices) {
    points.push({ x: (center.x + v.x) / 2, y: (center.y + v.y) / 2 });
  }
  return points;
}

/**
 * Sample the terrain at multiple points within a hex cell and combine into a
 * single representative {@link TerrainSample}. Continuous attributes are
 * averaged; the biome is chosen by majority vote so a cell on the edge of a
 * town reflects its partial coverage rather than whichever biome happens to sit
 * under the centre.
 */
function multiSampleTerrain(cell: HexCell, field: TerrainField): TerrainSample {
  const points = hexSamplePoints(cell);
  const n = points.length;

  // Accumulate continuous values and count biomes.
  let elevation = 0;
  let temperature = 0;
  let vegetation = 0;
  let waterProximity = 0;
  let banditActivity = 0;
  const biomeCounts = new Map<Biome, number>();

  for (const point of points) {
    const s = field.sample(point);
    elevation += s.elevation;
    temperature += s.temperature;
    vegetation += s.vegetation;
    waterProximity += s.waterProximity;
    banditActivity += s.banditActivity;
    biomeCounts.set(s.biome, (biomeCounts.get(s.biome) ?? 0) + 1);
  }

  // Majority-vote biome: pick the most frequent; break ties by canonical order.
  let bestBiome: Biome = BIOMES[0]!;
  let bestCount = 0;
  for (const biome of BIOMES) {
    const count = biomeCounts.get(biome) ?? 0;
    if (count > bestCount) {
      bestCount = count;
      bestBiome = biome;
    }
  }

  return {
    biome: bestBiome,
    elevation: (elevation / n) as TerrainSample['elevation'],
    temperature: (temperature / n) as TerrainSample['temperature'],
    vegetation: (vegetation / n) as TerrainSample['vegetation'],
    waterProximity: (waterProximity / n) as TerrainSample['waterProximity'],
    banditActivity: (banditActivity / n) as TerrainSample['banditActivity'],
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
