import type { RiskEngine, RiskProfile, TerrainSample } from '@domain';

/**
 * RISK MODEL MODULE — owner-implemented.
 *
 * Map a {@link TerrainSample} to baseline {@link RiskProfile} levels (each 0…1)
 * for the five channels. The cost function itself lives in the shared kernel
 * (`@domain/cost`); this module only produces the *levels*. See
 * docs/spec/05-engine-risk.md. Working stand-in: `createMockRiskEngine`.
 */
export function createRiskEngine(): RiskEngine {
  return {
    baseProfile(_sample: TerrainSample): RiskProfile {
      throw new Error('risk: not implemented — see docs/spec/05-engine-risk.md');
    },
  };
}
