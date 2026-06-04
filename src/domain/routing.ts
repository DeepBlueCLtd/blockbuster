import type { Km } from './units';
import type { CellId, HexGridDto } from './hex';
import type { RiskProfile, RiskType } from './risk';
import type { CostParams } from './cost';
import type { JourneyParams, DayNightConfig, TimeWindow } from './journey';

/**
 * Pre-computed contribution of a single temporal zone for one cell.
 * The routing worker uses these (alongside arrival time) to apply time-bounded
 * zone effects per step — structured-clone safe, no closures.
 */
export interface TemporalZoneCellEntry {
  risk: RiskType;
  /** Pre-computed: coverageFraction × zone.offset (signed). */
  contribution: number;
  startTime?: number; // minutes from midnight
  endTime?: number; // minutes from midnight
}

/**
 * Everything the routing engine needs, in structured-clone-friendly form so it
 * can be posted to the Web Worker. No closures, no class instances — plain data.
 */
export interface RouteRequest {
  grid: HexGridDto;
  /** Effective (post-override, always-active-zone) risk profile for every cell, keyed by id. */
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
  /** Departure time and speed mode for this planning run. Defaults to DEFAULT_JOURNEY_PARAMS. */
  journeyParams?: JourneyParams;
  /** Whether day/night risk modifiers are active. Defaults to DEFAULT_DAY_NIGHT. */
  dayNight?: DayNightConfig;
  /**
   * Pre-computed per-cell temporal zone contributions (coverage × offset per
   * zone–time-window). Only cells with non-zero temporal zone coverage appear.
   * Applied per step inside the worker at the cell's arrival time.
   */
  temporalZoneCells?: Record<CellId, TemporalZoneCellEntry[]>;
  /**
   * Optional earliest/latest arrival time per waypoint (parallel to `waypoints`).
   * Violations incur a soft cost penalty rather than hard blocking.
   */
  waypointWindows?: (TimeWindow | null)[];
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
  /** Absolute wall-clock time (minutes from midnight) when the group enters this cell. */
  arrivalTimeMinutes: number;
  /** Travel speed (km/h) used for this cell. */
  speedKmh: number;
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
  /** Departure time (minutes from midnight) — equals journeyParams.startTime. */
  departureTimeMinutes: number;
  /** Estimated arrival time at the final waypoint (minutes from midnight). */
  arrivalTimeMinutes: number;
  /** Arrival time at each requested waypoint, parallel to request.waypoints. */
  waypointArrivals: number[];
  /** Constant travel speed for the whole route, or null if Dynamic (varies per cell). */
  speedKmh: number | null;
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
