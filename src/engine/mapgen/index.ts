import type { MapGenConfig, MapGenerator, TerrainField } from '@domain';

/**
 * MAP GENERATION MODULE — owner-implemented.
 *
 * Build a deterministic {@link TerrainField} over `config.extent`, seeded by
 * `config.seed`. See docs/spec/03-engine-mapgen.md for the contract, acceptance
 * criteria and suggested noise approach. A working stand-in lives in
 * `src/mocks/mockEngine.ts` (`createMockMapGenerator`).
 */
export function createMapGenerator(): MapGenerator {
  return {
    generate(_config: MapGenConfig): TerrainField {
      throw new Error('mapgen: not implemented — see docs/spec/03-engine-mapgen.md');
    },
  };
}
