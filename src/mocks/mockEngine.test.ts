import { describe, expect, it } from 'vitest';
import type { Biome, CellId, TerrainSample, WorldPoint } from '@domain';
import { BIOMES, DEFAULT_EXTENT, worldDistance } from '@domain';
import { createMockMapGenerator, planRoutesSync } from './mockEngine';
import { fixtureGrid, fixtureRequest, fixtureWaypoints } from './fixtures';

/** Id of the fixture cell whose centre is nearest `target`. */
function cellNear(target: WorldPoint): CellId {
  let best = fixtureGrid.cells[0]!;
  let bestDist = Infinity;
  for (const cell of fixtureGrid.cells) {
    const d = worldDistance(cell.center, target);
    if (d < bestDist) {
      bestDist = d;
      best = cell;
    }
  }
  return best.id;
}

describe('mock map generator', () => {
  const generator = createMockMapGenerator();

  /** Sample the field on a 1 km lattice over the default world. */
  function sampleGrid(seed: number): TerrainSample[][] {
    const field = generator.generate({ extent: DEFAULT_EXTENT, seed });
    const rows: TerrainSample[][] = [];
    for (let y = 0.5; y < DEFAULT_EXTENT.height; y += 1) {
      const row: TerrainSample[] = [];
      for (let x = 0.5; x < DEFAULT_EXTENT.width; x += 1) {
        row.push(field.sample({ x, y }));
      }
      rows.push(row);
    }
    return rows;
  }

  it('only emits known biomes with attributes in range', () => {
    for (const row of sampleGrid(1337)) {
      for (const sample of row) {
        expect(BIOMES).toContain(sample.biome);
        for (const unit of [sample.vegetation, sample.waterProximity, sample.banditActivity]) {
          expect(unit).toBeGreaterThanOrEqual(0);
          expect(unit).toBeLessThanOrEqual(1);
        }
        expect(sample.elevation).toBeGreaterThanOrEqual(0);
        expect(sample.temperature).toBeGreaterThan(-40);
        expect(sample.temperature).toBeLessThan(60);
      }
    }
  });

  it('is a pure function of the seed (deterministic)', () => {
    const a = createMockMapGenerator().generate({ extent: DEFAULT_EXTENT, seed: 7 });
    const b = createMockMapGenerator().generate({ extent: DEFAULT_EXTENT, seed: 7 });
    const point = { x: 12.3, y: 7.1 };
    expect(a.sample(point)).toEqual(b.sample(point));
    expect(a.sample(point)).toEqual(a.sample(point));
  });

  it('lays out coherent zones rather than per-cell speckle', () => {
    let same = 0;
    let total = 0;
    for (const row of sampleGrid(1337)) {
      for (let i = 1; i < row.length; i++) {
        total++;
        if (row[i]!.biome === row[i - 1]!.biome) same++;
      }
    }
    // Adjacent 1 km samples should usually share a biome — i.e. real regions.
    expect(same / total).toBeGreaterThan(0.7);
  });

  it('contains the named zones (towns, mountains) plus variety', () => {
    const present = new Set<Biome>();
    for (const row of sampleGrid(1337)) for (const sample of row) present.add(sample.biome);
    expect(present.has('town')).toBe(true);
    expect(present.has('mountains')).toBe(true);
    expect(present.size).toBeGreaterThanOrEqual(4);
  });
});

describe('mock route planner', () => {
  const plan = planRoutesSync(fixtureRequest);

  it('returns coaCount distinct COAs, best-scoring first', () => {
    // The grid easily permits several routes, so the planner must not collapse to
    // a single COA — it should surface the full set of best-scoring alternatives.
    expect(plan.coas.length).toBe(fixtureRequest.coaCount);
    const signatures = plan.coas.map((c) => c.path.join('>'));
    expect(new Set(signatures).size).toBe(plan.coas.length); // pairwise distinct
    const costs = plan.coas.map((c) => c.totalCost);
    expect([...costs].sort((a, b) => a - b)).toEqual(costs); // sorted best-first
  });

  it('routes start and end at the requested waypoints', () => {
    const start = fixtureWaypoints[0];
    const end = fixtureWaypoints[fixtureWaypoints.length - 1];
    for (const coa of plan.coas) {
      expect(coa.path[0]).toBe(start);
      expect(coa.path[coa.path.length - 1]).toBe(end);
    }
  });

  it('emits one step per cell on the path', () => {
    for (const coa of plan.coas) {
      expect(coa.steps).toHaveLength(coa.path.length);
    }
  });

  it('is deterministic for identical requests', () => {
    const again = planRoutesSync(fixtureRequest);
    const paths = (p: typeof plan) => p.coas.map((c) => c.path.join('>'));
    expect(paths(again)).toEqual(paths(plan));
  });

  it('visits waypoints in the given sequence, not a reordered one', () => {
    // C sits much closer to A than B does, so a nearest-neighbour reorder would
    // visit A → C → B. The planner must instead honour the requested order A → B → C.
    const a = cellNear({ x: 5, y: 5 });
    const b = cellNear({ x: 45, y: 25 });
    const c = cellNear({ x: 5, y: 25 });
    expect(new Set([a, b, c]).size).toBe(3);

    const seqPlan = planRoutesSync({ ...fixtureRequest, waypoints: [a, b, c] });
    expect(seqPlan.coas.length).toBeGreaterThanOrEqual(1);
    for (const coa of seqPlan.coas) {
      expect(coa.path[0]).toBe(a);
      expect(coa.path[coa.path.length - 1]).toBe(c);
      const ia = coa.path.indexOf(a);
      const ib = coa.path.indexOf(b);
      const ic = coa.path.indexOf(c);
      expect(ia).toBeGreaterThanOrEqual(0);
      expect(ib).toBeGreaterThan(ia);
      expect(ic).toBeGreaterThan(ib);
    }
  });
});
