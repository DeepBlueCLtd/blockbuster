import type { Biome, RiskEngine, RiskProfile, TerrainSample } from '@domain';
import { clamp01 } from '@domain';

/**
 * RISK MODEL MODULE — real implementation of {@link RiskEngine}.
 *
 * A pure, stateless mapping from a {@link TerrainSample} to baseline
 * {@link RiskProfile} levels (each channel ∈ [0, 1]). The *cost* of those
 * levels (appetite weighting etc.) lives in the shared kernel (`@domain/cost`)
 * and must not be duplicated here — this module only produces the levels.
 *
 * The curves are deliberately legible (analysts reason about them) and refine
 * the mock's reference table: each channel is monotonic in its primary driver,
 * heat ramps faster in extreme temperatures, and a few biomes add a small,
 * documented nudge on top of the continuous attributes. See
 * docs/spec/05-engine-risk.md.
 */

// Temperature (°C) shaping. Cold risk grows as temperature drops below COLD_ONSET;
// heat risk grows above HEAT_ONSET and accelerates past HEAT_SPIKE_ONSET.
const COLD_ONSET = 12;
const COLD_RANGE = 22;
const HEAT_ONSET = 24;
const HEAT_RANGE = 14;
const HEAT_SPIKE_ONSET = 35;
const HEAT_SPIKE_GAIN = 0.06; // extra risk per °C above the spike onset

// Small, biome-specific nudges layered on top of the continuous attributes
// (the spec explicitly allows a modest biome bump). Each is additive and
// constant per biome, so per-channel monotonicity in the driving attribute holds.
const ANIMAL_BIOME_NUDGE: Partial<Record<Biome, number>> = {
  woodland: 0.15,
  savannah: 0.2,
};
const WATER_BIOME_NUDGE: Partial<Record<Biome, number>> = {
  savannah: 0.1,
  mountains: 0.1,
};
const THIEF_TOWN_NUDGE = 0.2;

export function createRiskEngine(): RiskEngine {
  return {
    baseProfile(sample: TerrainSample): RiskProfile {
      const { temperature, vegetation, waterProximity, banditActivity, biome } = sample;

      const heatSpike =
        temperature > HEAT_SPIKE_ONSET ? (temperature - HEAT_SPIKE_ONSET) * HEAT_SPIKE_GAIN : 0;

      return {
        // Wildlife pressure follows vegetation density, with extra in wooded /
        // grazing biomes.
        animals: clamp01(vegetation * 0.9 + (ANIMAL_BIOME_NUDGE[biome] ?? 0)),
        // Cold rises as it gets colder.
        cold: clamp01((COLD_ONSET - temperature) / COLD_RANGE),
        // Heat rises as it gets hotter, then accelerates in extreme heat.
        heat: clamp01((temperature - HEAT_ONSET) / HEAT_RANGE + heatSpike),
        // Thirst risk is the lack of nearby water, drier in arid/high biomes.
        water: clamp01(1 - waterProximity + (WATER_BIOME_NUDGE[biome] ?? 0)),
        // Banditry tracks the settlement field and peaks in towns.
        thief: clamp01(banditActivity + (biome === 'town' ? THIEF_TOWN_NUDGE : 0)),
      };
    },
  };
}
