import { describe, expect, it } from 'vitest';
import type { CellId, HexGrid, WorldPoint } from '@domain';
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
