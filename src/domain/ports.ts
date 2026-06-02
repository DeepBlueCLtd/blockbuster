import type { CellId, HexGrid, HexLayout } from './hex';
import type { WorldExtent } from './world';
import type { MapGenConfig, TerrainField, TerrainSample } from './terrain';
import type { RiskProfile } from './risk';
import type { RouteRequest, RoutePlan } from './routing';

/**
 * The seams between the engine modules and the rest of the app. Every concrete
 * module implements exactly one of these ports; the store depends only on the
 * ports, never on the implementations. This is what lets the modules be built
 * (and mocked) independently and in parallel.
 */

/** Procedurally builds a deterministic terrain field. (Map Generation module.) */
export interface MapGenerator {
  generate(config: MapGenConfig): TerrainField;
}

/** Builds a hex grid over an extent and samples terrain into cells. (Hex Grid module.) */
export interface GridBuilder {
  build(extent: WorldExtent, layout: GridLayoutSpec): HexGrid;
  sampleTerrain(grid: HexGrid, field: TerrainField): Map<CellId, TerrainSample>;
}

/** Layout spec accepted by {@link GridBuilder.build}; origin defaults to (0,0). */
export type GridLayoutSpec = Pick<HexLayout, 'orientation' | 'size'> &
  Partial<Pick<HexLayout, 'origin'>>;

/** Maps a terrain sample to baseline risk levels. (Risk model module.) */
export interface RiskEngine {
  baseProfile(sample: TerrainSample): RiskProfile;
}

/**
 * Plans COAs. Async because the reference implementation runs in a Web Worker;
 * a synchronous main-thread implementation can resolve immediately.
 * (Routing module.)
 */
export interface RoutePlanner {
  plan(request: RouteRequest): Promise<RoutePlan>;
  /** Release any worker/resources. */
  dispose?(): void;
}

/** Bundle of every engine port, injected into the store as one unit. */
export interface Engine {
  mapGenerator: MapGenerator;
  gridBuilder: GridBuilder;
  riskEngine: RiskEngine;
  routePlanner: RoutePlanner;
}
