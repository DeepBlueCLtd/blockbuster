import type { Km } from './units';
import type { CellId, HexGridDto } from './hex';
import type { RiskProfile, RiskType } from './risk';
import type { CostParams } from './cost';

/**
 * Everything the routing engine needs, in structured-clone-friendly form so it
 * can be posted to the Web Worker. No closures, no class instances — plain data.
 */
export interface RouteRequest {
  grid: HexGridDto;
  /** Effective (post-override) risk profile for every cell, keyed by id. */
  risk: Record<CellId, RiskProfile>;
  params: CostParams;
  /** Ordered list of cells the route must visit; length ≥ 2. */
  waypoints: CellId[];
  /** How many distinct COAs to return (default 3). */
  coaCount: number;
  /**
   * When true the planner keeps the first waypoint fixed as the start but is
   * free to reorder the remaining waypoints to minimise cost (a greedy
   * nearest-neighbour TSP heuristic). The UI numbering and the waypoint list
   * in the store stay unchanged — only the planning sequence is affected.
   * Default is false (visit waypoints in the order given).
   */
  optimiseOrder?: boolean;
  /**
   * Optional hard blocks: cells a route may not pass *through* (e.g. terrain the
   * model treats as untraversable). Waypoints are always reachable — if removing
   * these would strand a leg, the planner falls back to a passable route for that
   * leg. Omit (or leave empty) to keep every cell passable (the v1 default, where
   * difficult terrain is discouraged by cost rather than blocked).
   */
  impassable?: CellId[];
}

/** One cell along a COA, with the cost it contributed, split by risk channel. */
export interface CoaCellStep {
  cellId: CellId;
  /** Per-risk cost contribution at this step (drives one stacked bar). */
  perRisk: Record<RiskType, number>;
  /** Movement cost incurred entering this cell. */
  movementCost: number;
  /** Total cost contribution of this step (risk + movement). */
  stepCost: number;
}

/**
 * A Course of Action: one concrete, ordered path through the grid that visits
 * the requested waypoints, plus everything the charts and map need to render it.
 */
export interface Coa {
  id: string;
  /** Short descriptor of the strategy, e.g. "Direct", "Balanced", "Cautious". */
  label: string;
  /** Full ordered path of cell ids (includes the waypoints). */
  path: CellId[];
  /** Per-cell breakdown, aligned 1:1 with `path`. */
  steps: CoaCellStep[];
  totalCost: number;
  totalDistanceKm: Km;
  /** Aggregate exposure per risk channel across the whole route. */
  riskTotals: Record<RiskType, number>;
}

/** Result of a planning run: the COAs, best-first, plus provenance. */
export interface RoutePlan {
  coas: Coa[];
  /** Echo of the request's waypoints, for the UI to verify staleness. */
  waypoints: CellId[];
  /** `Date.now()` at completion. */
  generatedAt: number;
}

/** Messages exchanged with the routing Web Worker. */
export type RouteWorkerRequest = { type: 'plan'; id: number; request: RouteRequest };
export type RouteWorkerResponse =
  | { type: 'result'; id: number; plan: RoutePlan }
  | { type: 'error'; id: number; message: string };
