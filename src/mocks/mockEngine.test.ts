import { describe, expect, it } from 'vitest';
import type { Biome, TerrainSample } from '@domain';
import { BIOMES, DEFAULT_EXTENT } from '@domain';
import { createMockMapGenerator, planRoutesSync } from './mockEngine';
import { fixtureRequest, fixtureWaypoints } from './fixtures';

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

  it('returns between one and coaCount COAs', () => {
    expect(plan.coas.length).toBeGreaterThanOrEqual(1);
    expect(plan.coas.length).toBeLessThanOrEqual(fixtureRequest.coaCount);
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
});
