import { describe, expect, it } from 'vitest';
import type { Biome, TerrainSample } from '@domain';
import { BIOMES, DEFAULT_EXTENT, mulberry32 } from '@domain';
import { createMapGenerator } from './index';
import { fbm, perlin } from './noise';

const generator = createMapGenerator();

/** Sample the field on a 1 km lattice over the default world. */
function sampleGrid(seed: number, tuning?: Parameters<typeof generator.generate>[0]['tuning']) {
  const field = generator.generate(
    tuning ? { extent: DEFAULT_EXTENT, seed, tuning } : { extent: DEFAULT_EXTENT, seed },
  );
  const samples: TerrainSample[][] = [];
  for (let y = 0.5; y < DEFAULT_EXTENT.height; y += 1) {
    const row: TerrainSample[] = [];
    for (let x = 0.5; x < DEFAULT_EXTENT.width; x += 1) row.push(field.sample({ x, y }));
    samples.push(row);
  }
  return samples;
}

function biomeCounts(rows: TerrainSample[][]): Record<Biome, number> {
  const counts = Object.fromEntries(BIOMES.map((b) => [b, 0])) as Record<Biome, number>;
  for (const row of rows) for (const s of row) counts[s.biome]++;
  return counts;
}

describe('mapgen (spec)', () => {
  it('produces identical fields for identical seeds (determinism)', () => {
    const a = createMapGenerator().generate({ extent: DEFAULT_EXTENT, seed: 7 });
    const b = createMapGenerator().generate({ extent: DEFAULT_EXTENT, seed: 7 });
    for (const point of [
      { x: 12.3, y: 7.1 },
      { x: 40, y: 25 },
      { x: 1, y: 1 },
    ]) {
      expect(a.sample(point)).toEqual(b.sample(point));
    }
  });

  it('produces different fields for different seeds', () => {
    const a = sampleGrid(7).flat();
    const b = sampleGrid(99).flat();
    const differing = a.filter((s, i) => s.biome !== b[i]!.biome).length;
    expect(differing).toBeGreaterThan(a.length * 0.2);
  });

  it('only emits biomes from the Biome union', () => {
    for (const row of sampleGrid(1337)) for (const s of row) expect(BIOMES).toContain(s.biome);
  });

  it('keeps every continuous attribute within its documented range', () => {
    for (const row of sampleGrid(1337)) {
      for (const s of row) {
        for (const u of [s.vegetation, s.waterProximity, s.banditActivity]) {
          expect(u).toBeGreaterThanOrEqual(0);
          expect(u).toBeLessThanOrEqual(1);
        }
        expect(s.elevation).toBeGreaterThanOrEqual(0);
        expect(s.elevation).toBeLessThanOrEqual(2600);
        expect(s.temperature).toBeGreaterThan(-40);
        expect(s.temperature).toBeLessThan(60);
      }
    }
  });

  it('sample() is a pure function of the point (stable across calls)', () => {
    const field = generator.generate({ extent: DEFAULT_EXTENT, seed: 7 });
    const point = { x: 23.4, y: 11.8 };
    expect(field.sample(point)).toEqual(field.sample(point));
  });

  it('lays out coherent zones (towns + mountains) rather than speckle', () => {
    const rows = sampleGrid(1337);
    let same = 0;
    let total = 0;
    for (const row of rows) {
      for (let i = 1; i < row.length; i++) {
        total++;
        if (row[i]!.biome === row[i - 1]!.biome) same++;
      }
    }
    expect(same / total).toBeGreaterThan(0.7);
    const counts = biomeCounts(rows);
    expect(counts.town).toBeGreaterThan(0);
    expect(counts.mountains).toBeGreaterThan(0);
    expect(BIOMES.filter((b) => counts[b] > 0).length).toBeGreaterThanOrEqual(4);
  });

  it('biome mix responds to MapGenTuning.biomeBias', () => {
    const base = biomeCounts(sampleGrid(1337));
    const wooded = biomeCounts(sampleGrid(1337, { biomeBias: { woodland: 1 } }));
    const dry = biomeCounts(sampleGrid(1337, { biomeBias: { savannah: 1 } }));
    expect(wooded.woodland).toBeGreaterThan(base.woodland);
    expect(dry.savannah).toBeGreaterThan(base.savannah);
  });
});

describe('mapgen noise core', () => {
  it('stays within [0, 1] and is deterministic', () => {
    const rng = mulberry32(5);
    for (let i = 0; i < 1000; i++) {
      const x = rng.range(-50, 50);
      const y = rng.range(-50, 50);
      const p = perlin(x, y, 1234);
      const f = fbm(x, y, 1234);
      expect(p).toBeGreaterThanOrEqual(0);
      expect(p).toBeLessThanOrEqual(1);
      expect(f).toBeGreaterThanOrEqual(0);
      expect(f).toBeLessThanOrEqual(1);
      expect(perlin(x, y, 1234)).toBe(p);
    }
  });
});
