import type { Engine } from '@domain';
import { createMapGenerator } from './mapgen';
import { createGridBuilder } from './hexgrid';
import { createRiskEngine } from './risk';
import { createRoutePlanner } from './routing';

/**
 * Wires the real engine modules into a single {@link Engine}. This is what the
 * app uses (see `src/state/store.ts`); the mock under `src/mocks/*` is retained
 * only as the living reference and as fixture/test data.
 */
export function createEngine(): Engine {
  return {
    mapGenerator: createMapGenerator(),
    gridBuilder: createGridBuilder(),
    riskEngine: createRiskEngine(),
    routePlanner: createRoutePlanner(),
  };
}

export { createMapGenerator, createGridBuilder, createRiskEngine, createRoutePlanner };
