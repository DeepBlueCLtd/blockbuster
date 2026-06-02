import type { Engine } from '@domain';
import { createMapGenerator } from './mapgen';
import { createGridBuilder } from './hexgrid';
import { createRiskEngine } from './risk';
import { createRoutePlanner } from './routing';

/**
 * Wires the real engine modules into a single {@link Engine}. Swap
 * `createMockEngine()` for this in `src/state/store.ts` once the modules below
 * are implemented (they currently throw "not implemented").
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
