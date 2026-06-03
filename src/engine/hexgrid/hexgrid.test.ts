import { describe, expect, it } from 'vitest';
import type { CellId, HexGrid, TerrainField, TerrainSample, WorldPoint } from '@domain';
import { DEFAULT_CELL_COUNT, DEFAULT_EXTENT, DEFAULT_HEX_SIZE_KM, parseCellId } from '@domain';
import { createGridBuilder, hexSizeForCellCount } from './index';

const builder = createGridBuilder();

/** Cube distance derived straight from two cell ids (independent of the grid). */
function cubeDistance(a: CellId, b: CellId): number {
  const pa = parseCellId(a);
  const pb = parseCellId(b);
  return (Math.abs(pa.q - pb.q) + Math.abs(pa.q + pa.r - pb.q - pb.r) + Math.abs(pa.r - pb.r)) / 2;
}

/** The grid cell whose centre is nearest a world point (always interior-safe). */
function cellNearest(grid: HexGrid, target: WorldPoint): CellId {
  let best = grid.cells[0]!;
  let bestDist = Infinity;
  for (const cell of grid.cells) {
    const d = Math.hypot(cell.center.x - target.x, cell.center.y - target.y);
    if (d < bestDist) {
      bestDist = d;
      best = cell;
    }
  }
  return best.id;
}

describe('hexgrid (spec)', () => {
  const grid = builder.build(DEFAULT_EXTENT, { orientation: 'pointy', size: DEFAULT_HEX_SIZE_KM });

  it('default size over the default extent yields ≈100 cells', () => {
    expect(grid.cells.length).toBeGreaterThanOrEqual(80);
    expect(grid.cells.length).toBeLessThanOrEqual(120);
  });

  it('neighbors() are symmetric and number 6 in the interior', () => {
    for (const cell of grid.cells) {
      const ns = grid.neighbors(cell.id);
      expect(ns.length).toBeLessThanOrEqual(6);
      // Symmetry: b ∈ neighbors(a) ⇔ a ∈ neighbors(b).
      for (const n of ns) {
        expect(grid.neighbors(n)).toContain(cell.id);
      }
    }
    // A clearly interior cell (centre of the world) must have all six.
    const middle = cellNearest(grid, {
      x: DEFAULT_EXTENT.width / 2,
      y: DEFAULT_EXTENT.height / 2,
    });
    expect(grid.neighbors(middle)).toHaveLength(6);
  });

  it('distance() equals hex (cube) distance and neighbours are one step away', () => {
    const a = grid.cells[0]!.id;
    const b = grid.cells[grid.cells.length - 1]!.id;
    expect(grid.distance(a, b)).toBe(cubeDistance(a, b));
    expect(grid.distance(a, b)).toBe(grid.distance(b, a)); // symmetric
    expect(grid.distance(a, a)).toBe(0);
    for (const n of grid.neighbors(a)) expect(grid.distance(a, n)).toBe(1);
  });

  it('pointToCell() ∘ center is the identity for every cell', () => {
    for (const cell of grid.cells) {
      expect(grid.pointToCell(cell.center)).toBe(cell.id);
    }
  });

  it('all cell centres fall inside the extent and ids are unique', () => {
    const ids = new Set<CellId>();
    for (const cell of grid.cells) {
      expect(cell.center.x).toBeGreaterThanOrEqual(0);
      expect(cell.center.x).toBeLessThanOrEqual(DEFAULT_EXTENT.width);
      expect(cell.center.y).toBeGreaterThanOrEqual(0);
      expect(cell.center.y).toBeLessThanOrEqual(DEFAULT_EXTENT.height);
      expect(cell.vertices).toHaveLength(6);
      ids.add(cell.id);
    }
    expect(ids.size).toBe(grid.cells.length);
  });
});

describe('hexgrid (determinism & tuning)', () => {
  it('geometry depends only on extent + layout (deterministic)', () => {
    const a = createGridBuilder().build(DEFAULT_EXTENT, {
      orientation: 'pointy',
      size: DEFAULT_HEX_SIZE_KM,
    });
    const b = createGridBuilder().build(DEFAULT_EXTENT, {
      orientation: 'pointy',
      size: DEFAULT_HEX_SIZE_KM,
    });
    expect(b.cells.map((c) => c.id)).toEqual(a.cells.map((c) => c.id));
    expect(b.cells.map((c) => c.center)).toEqual(a.cells.map((c) => c.center));
  });

  it('hexSizeForCellCount derives the default size and yields ≈ target cells', () => {
    const size = hexSizeForCellCount(DEFAULT_EXTENT, DEFAULT_CELL_COUNT);
    // The published DEFAULT_HEX_SIZE_KM was chosen for ≈100 cells; the formula
    // should reproduce it closely.
    expect(size).toBeCloseTo(DEFAULT_HEX_SIZE_KM, 1);
    const grid = createGridBuilder().build(DEFAULT_EXTENT, { orientation: 'pointy', size });
    expect(grid.cells.length).toBeGreaterThanOrEqual(80);
    expect(grid.cells.length).toBeLessThanOrEqual(120);

    // Asking for far fewer / more cells moves the count the right way.
    const coarse = createGridBuilder().build(DEFAULT_EXTENT, {
      orientation: 'pointy',
      size: hexSizeForCellCount(DEFAULT_EXTENT, 40),
    });
    expect(coarse.cells.length).toBeLessThan(grid.cells.length);
  });

  it('supports flat-top orientation with the same invariants', () => {
    const grid = createGridBuilder().build(DEFAULT_EXTENT, {
      orientation: 'flat',
      size: DEFAULT_HEX_SIZE_KM,
    });
    expect(grid.cells.length).toBeGreaterThan(0);
    for (const cell of grid.cells) {
      expect(grid.pointToCell(cell.center)).toBe(cell.id);
      for (const n of grid.neighbors(cell.id)) {
        expect(grid.neighbors(n)).toContain(cell.id);
        expect(grid.distance(cell.id, n)).toBe(1);
      }
    }
  });
});

describe('hexgrid (multi-point terrain sampling)', () => {
  const grid = builder.build(DEFAULT_EXTENT, { orientation: 'pointy', size: DEFAULT_HEX_SIZE_KM });

  it('averages continuous attributes across sample points instead of centre-only', () => {
    // A terrain field where vegetation increases linearly with x.
    const field: TerrainField = {
      extent: DEFAULT_EXTENT,
      seed: 1,
      sample(point: WorldPoint): TerrainSample {
        return {
          biome: 'grassland',
          elevation: 0,
          temperature: 20,
          vegetation: point.x / DEFAULT_EXTENT.width,
          waterProximity: 0.5,
          banditActivity: 0,
        };
      },
    };

    const terrain = builder.sampleTerrain(grid, field);
    // Each cell's vegetation should be roughly equal to the average of the
    // terrain function at its 7 sample points, not just the centre value.
    for (const cell of grid.cells) {
      const sample = terrain.get(cell.id)!;
      // Compute expected average: centre + 6 midpoints to vertices.
      const pts = [
        cell.center,
        ...cell.vertices.map((v) => ({
          x: (cell.center.x + v.x) / 2,
          y: (cell.center.y + v.y) / 2,
        })),
      ];
      const expected = pts.reduce((s, p) => s + p.x / DEFAULT_EXTENT.width, 0) / pts.length;
      expect(sample.vegetation).toBeCloseTo(expected, 8);
    }
  });

  it('picks the majority biome rather than just the centre biome', () => {
    // A terrain field where the left third is town and the rest is grassland.
    const boundary = DEFAULT_EXTENT.width / 3;
    const field: TerrainField = {
      extent: DEFAULT_EXTENT,
      seed: 1,
      sample(point: WorldPoint): TerrainSample {
        return {
          biome: point.x < boundary ? 'town' : 'grassland',
          elevation: 500,
          temperature: 20,
          vegetation: 0.5,
          waterProximity: 0.5,
          banditActivity: 0,
        };
      },
    };

    const terrain = builder.sampleTerrain(grid, field);
    // A cell whose centre is just inside the boundary should be "town" only if
    // the majority of its 7 sample points fall in the town zone.
    for (const cell of grid.cells) {
      const sample = terrain.get(cell.id)!;
      const pts = [
        cell.center,
        ...cell.vertices.map((v) => ({
          x: (cell.center.x + v.x) / 2,
          y: (cell.center.y + v.y) / 2,
        })),
      ];
      const townCount = pts.filter((p) => p.x < boundary).length;
      const expected = townCount > pts.length / 2 ? 'town' : 'grassland';
      expect(sample.biome).toBe(expected);
    }
  });
});