import { describe, expect, it } from 'vitest';
import type { Biome, TerrainSample } from '@domain';
import { BIOMES, mulberry32, RISK_TYPES } from '@domain';
import { createRiskEngine } from './index';

const engine = createRiskEngine();

/** A neutral sample; override individual attributes per assertion. */
function sample(overrides: Partial<TerrainSample> = {}): TerrainSample {
  return {
    biome: 'grassland',
    elevation: 500,
    temperature: 18,
    vegetation: 0.5,
    waterProximity: 0.5,
    banditActivity: 0.2,
    ...overrides,
  };
}

describe('risk (spec)', () => {
  it('every channel of baseProfile is within [0, 1]', () => {
    const rng = mulberry32(99);
    for (let i = 0; i < 500; i++) {
      const profile = engine.baseProfile({
        biome: BIOMES[rng.int(BIOMES.length)]!,
        elevation: rng.range(0, 3000),
        temperature: rng.range(-30, 55),
        vegetation: rng.next(),
        waterProximity: rng.next(),
        banditActivity: rng.next(),
      });
      for (const channel of RISK_TYPES) {
        expect(profile[channel]).toBeGreaterThanOrEqual(0);
        expect(profile[channel]).toBeLessThanOrEqual(1);
      }
    }
  });

  it('cold rises as temperature falls; heat rises as it climbs', () => {
    const cold = (t: number) => engine.baseProfile(sample({ temperature: t })).cold;
    const heat = (t: number) => engine.baseProfile(sample({ temperature: t })).heat;
    expect(cold(-10)).toBeGreaterThan(cold(5));
    expect(cold(5)).toBeGreaterThan(cold(15));
    expect(heat(45)).toBeGreaterThan(heat(30));
    expect(heat(30)).toBeGreaterThan(heat(20));
    // The extreme-heat spike makes each degree above the onset cost more than a
    // degree in the linear mid-range (compared below saturation).
    expect(heat(36) - heat(35)).toBeGreaterThan(heat(28) - heat(27));
  });

  it('water risk rises as waterProximity falls', () => {
    const water = (w: number) => engine.baseProfile(sample({ waterProximity: w })).water;
    expect(water(0)).toBeGreaterThan(water(0.5));
    expect(water(0.5)).toBeGreaterThan(water(1));
  });

  it('thief risk tracks banditActivity and town biome', () => {
    const thief = (b: number, biome: Biome = 'grassland') =>
      engine.baseProfile(sample({ banditActivity: b, biome })).thief;
    expect(thief(0.8)).toBeGreaterThan(thief(0.2));
    // A town bumps thief risk above the same banditActivity elsewhere.
    expect(thief(0.4, 'town')).toBeGreaterThan(thief(0.4, 'grassland'));
  });

  it('animals risk tracks vegetation', () => {
    const animals = (v: number) => engine.baseProfile(sample({ vegetation: v })).animals;
    expect(animals(0.9)).toBeGreaterThan(animals(0.4));
    expect(animals(0.4)).toBeGreaterThan(animals(0.1));
  });

  it('is a pure function of the sample', () => {
    const s = sample({ temperature: 33, vegetation: 0.7 });
    expect(engine.baseProfile(s)).toEqual(engine.baseProfile(s));
  });
});
