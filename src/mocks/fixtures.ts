/**
 * Golden fixtures: a complete, realistic world + plan computed once from the
 * mock engine. UI and state teams import these to build and snapshot-test
 * against stable data without waiting on (or even knowing about) the real
 * engine modules.
 */
import type {
  CellId,
  CellRiskState,
  Coa,
  HexCell,
  HexGrid,
  RiskProfile,
  RoutePlan,
  RouteRequest,
  TerrainSample,
  WorldPoint,
} from '@domain';
import {
  DEFAULT_APPETITE,
  DEFAULT_COST_PARAMS,
  DEFAULT_DAY_NIGHT,
  DEFAULT_EXTENT,
  DEFAULT_JOURNEY_PARAMS,
  effectiveProfile,
  toHexGridDto,
  worldDistance,
} from '@domain';
import { createMockEngine, MOCK_LAYOUT, planRoutesSync } from './mockEngine';

export const FIXTURE_SEED = 1337;

function nearestCell(grid: HexGrid, target: WorldPoint): HexCell {
  let best = grid.cells[0]!;
  let bestDist = Infinity;
  for (const cell of grid.cells) {
    const d = worldDistance(cell.center, target);
    if (d < bestDist) {
      bestDist = d;
      best = cell;
    }
  }
  return best;
}

const engine = createMockEngine();

export const fixtureGrid: HexGrid = engine.gridBuilder.build(DEFAULT_EXTENT, MOCK_LAYOUT);

export const fixtureField = engine.mapGenerator.generate({
  extent: DEFAULT_EXTENT,
  seed: FIXTURE_SEED,
});

export const fixtureTerrain: Map<CellId, TerrainSample> = engine.gridBuilder.sampleTerrain(
  fixtureGrid,
  fixtureField,
);

export const fixtureRiskStates: Map<CellId, CellRiskState> = (() => {
  const states = new Map<CellId, CellRiskState>();
  for (const cell of fixtureGrid.cells) {
    const sample = fixtureTerrain.get(cell.id);
    if (!sample) continue;
    states.set(cell.id, {
      cellId: cell.id,
      base: engine.riskEngine.baseProfile(sample),
      overrides: {},
    });
  }
  return states;
})();

export const fixtureWaypoints: CellId[] = [
  nearestCell(fixtureGrid, { x: 6, y: 6 }).id,
  nearestCell(fixtureGrid, { x: 44, y: 24 }).id,
];

const fixtureRiskRecord: Record<CellId, RiskProfile> = (() => {
  const record: Record<CellId, RiskProfile> = {};
  for (const [id, state] of fixtureRiskStates) record[id] = effectiveProfile(state);
  return record;
})();

export const fixtureRequest: RouteRequest = {
  grid: toHexGridDto(fixtureGrid),
  risk: fixtureRiskRecord,
  params: DEFAULT_COST_PARAMS,
  waypoints: fixtureWaypoints,
  coaCount: 3,
  journeyParams: DEFAULT_JOURNEY_PARAMS,
  dayNight: DEFAULT_DAY_NIGHT,
  timeVaryingZones: [],
  waypointWindows: [null, null],
};

export const fixturePlan: RoutePlan = planRoutesSync(fixtureRequest);

export const fixtureAppetite = DEFAULT_APPETITE;
export const fixtureCostParams = DEFAULT_COST_PARAMS;

/** Convenience bundle of everything above. */
export const FIXTURE = {
  seed: FIXTURE_SEED,
  extent: DEFAULT_EXTENT,
  layout: MOCK_LAYOUT,
  grid: fixtureGrid,
  terrain: fixtureTerrain,
  riskStates: fixtureRiskStates,
  waypoints: fixtureWaypoints,
  appetite: fixtureAppetite,
  costParams: fixtureCostParams,
  plan: fixturePlan,
} as const;

export type { Coa };
