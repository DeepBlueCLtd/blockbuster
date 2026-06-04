import type {
  CellId,
  Coa,
  CoaCellStep,
  CostParams,
  DayNightConfig,
  HexGridDto,
  JourneyParams,
  RiskProfile,
  RiskType,
  RiskZone,
  RoutePlan,
  RouteRequest,
  TimeWindow,
  WorldExtent,
  WorldPoint,
} from '@domain';
import {
  applyTemporalModifiers,
  applyZoneOffsets,
  cellRiskCost,
  DEFAULT_DAY_NIGHT,
  DEFAULT_JOURNEY_PARAMS,
  isPointInPolygon,
  isZoneActiveAt,
  movementCost,
  ringAt,
  RISK_TYPES,
  riskCostBreakdown,
  SPEED_MAX_KMH,
  SPEED_MIN_KMH,
  speedModifiedProfile,
  toCellId,
  worldDistance,
} from '@domain';

/**
 * ROUTING CORE — pure, worker-agnostic {@link planRoutes}.
 *
 * Reconstructs the hex graph from the serialised request and produces up to
 * `coaCount` distinct, near-optimal COAs that visit the waypoints **in the order
 * given** (the analyst owns the sequence — never reorder). Pathfinding is A* with
 * a consistent heuristic over a binary heap; diversity comes from three strategy
 * biases plus an overlap-penalised fan-out. Every COA is scored under the
 * analyst's real `params` (via `@domain/cost`, never a private copy) so the
 * charts stay consistent regardless of the bias used to discover the route.
 *
 * No DOM / `window` access, so it runs unchanged inside the Web Worker. See
 * docs/spec/06-engine-routing.md.
 */

/** The six axial neighbour offsets (own copy — routing must not import hexgrid). */
const AXIAL_DIRECTIONS: readonly [number, number][] = [
  [1, 0],
  [1, -1],
  [0, -1],
  [-1, 0],
  [-1, 1],
  [0, 1],
];

/**
 * How hard to penalise re-using a cell already crossed by an accepted COA. Each
 * prior use multiplies that cell's entry cost by `(1 + DIVERSITY_PENALTY · uses)`,
 * fanning successive searches out into genuinely different routes.
 */
const DIVERSITY_PENALTY = 1;

/** Reject a candidate COA whose Jaccard overlap with an existing one exceeds this. */
const MAX_OVERLAP = 0.8;

const NO_USAGE: ReadonlyMap<CellId, number> = new Map();
const NO_BLOCKS: ReadonlySet<CellId> = new Set();

/** Six discrete speeds tried when optimising for the best constant speed. */
const CANDIDATE_SPEEDS = [5, 10, 15, 20, 25, 30] as const;

interface Strategy {
  label: string;
  riskScale: number;
  distScale: number;
}

// Bias the search three ways so the field's natural alternatives surface first.
const STRATEGIES: readonly Strategy[] = [
  { label: 'Direct', riskScale: 0.25, distScale: 1.5 },
  { label: 'Balanced', riskScale: 1, distScale: 1 },
  { label: 'Cautious', riskScale: 2.5, distScale: 0.6 },
];

function scaleParams(base: CostParams, s: Strategy): CostParams {
  return {
    appetite: base.appetite,
    distanceWeightKm: base.distanceWeightKm * s.distScale,
    riskWeight: base.riskWeight * s.riskScale,
  };
}

function zeroRisk(): Record<RiskType, number> {
  const out = {} as Record<RiskType, number>;
  for (const r of RISK_TYPES) out[r] = 0;
  return out;
}

// --- Graph -----------------------------------------------------------------

interface Graph {
  centerOf(id: CellId): WorldPoint | undefined;
  neighbors(id: CellId): readonly CellId[];
  riskAt(id: CellId): RiskProfile;
}

const ZERO_PROFILE: RiskProfile = { animals: 0, cold: 0, heat: 0, water: 0, human: 0 };

function buildGraph(dto: HexGridDto, risk: Record<CellId, RiskProfile>): Graph {
  const center = new Map<CellId, WorldPoint>();
  const coord = new Map<CellId, { q: number; r: number }>();
  for (const c of dto.cells) {
    center.set(c.id, c.center);
    coord.set(c.id, { q: c.q, r: c.r });
  }
  // Precompute in-grid adjacency once.
  const adjacency = new Map<CellId, CellId[]>();
  for (const c of dto.cells) {
    const ns: CellId[] = [];
    for (const [dq, dr] of AXIAL_DIRECTIONS) {
      const nid = toCellId({ q: c.q + dq, r: c.r + dr });
      if (center.has(nid)) ns.push(nid);
    }
    adjacency.set(c.id, ns);
  }
  return {
    centerOf: (id) => center.get(id),
    neighbors: (id) => adjacency.get(id) ?? [],
    riskAt: (id) => risk[id] ?? ZERO_PROFILE,
  };
}

// --- Binary min-heap (lazy-deletion priority queue) ------------------------

interface HeapNode {
  key: number;
  seq: number;
  id: CellId;
}

/** Ordered by key, ties broken by insertion order for deterministic pops. */
class MinHeap {
  private readonly items: HeapNode[] = [];
  private seq = 0;

  get size(): number {
    return this.items.length;
  }

  push(key: number, id: CellId): void {
    const items = this.items;
    items.push({ key, seq: this.seq++, id });
    let i = items.length - 1;
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (precedes(items[i]!, items[parent]!)) {
        [items[i], items[parent]] = [items[parent]!, items[i]!];
        i = parent;
      } else break;
    }
  }

  pop(): CellId | undefined {
    const items = this.items;
    const top = items[0];
    if (top === undefined) return undefined;
    const last = items.pop()!;
    if (items.length > 0) {
      items[0] = last;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1;
        const r = 2 * i + 2;
        let smallest = i;
        if (l < items.length && precedes(items[l]!, items[smallest]!)) smallest = l;
        if (r < items.length && precedes(items[r]!, items[smallest]!)) smallest = r;
        if (smallest === i) break;
        [items[i], items[smallest]] = [items[smallest]!, items[i]!];
        i = smallest;
      }
    }
    return top.id;
  }
}

function precedes(a: HeapNode, b: HeapNode): boolean {
  return a.key < b.key || (a.key === b.key && a.seq < b.seq);
}

// --- Temporal context ------------------------------------------------------

/** Groups time-related inputs for A* and buildCoa so signatures stay manageable. */
interface TemporalContext {
  journeyParams: JourneyParams;
  dayNight: DayNightConfig;
  /** Zones with time bounds or motion; processed per A* step using cell centre + arrival time. */
  timeVaryingZones: RiskZone[];
  /** Domain extent, needed to compute dynamic zone rings. */
  extent: WorldExtent;
  /** Cell circumradius (km), needed to scale dynamic zone band widths. */
  hexSizeKm: number;
  waypointWindows: (TimeWindow | null)[];
  waypoints: readonly CellId[];
}

/** A no-op temporal context used in time-agnostic calls (TSP ordering etc.). */
const EMPTY_TEMPORAL: TemporalContext = {
  journeyParams: { startTime: 0, speedMode: 'fixed', fixedSpeedKmh: 15 },
  dayNight: { enabled: false },
  timeVaryingZones: [],
  extent: { width: 0, height: 0 },
  hexSizeKm: 1,
  waypointWindows: [],
  waypoints: [],
};

/**
 * Apply time-varying zone offsets to a profile. For each zone active at
 * `arrivalTimeMin`, computes the zone's ring (static or dynamic) and applies the
 * offset if the cell centre lies inside. Uses a centre-point test rather than
 * area-weighted coverage because cell vertices are not in the routing DTO.
 */
function applyTimeVaryingZones(
  profile: RiskProfile,
  cellCenter: WorldPoint | undefined,
  arrivalTimeMin: number,
  temporal: TemporalContext,
): RiskProfile {
  if (temporal.timeVaryingZones.length === 0 || !cellCenter) return profile;
  const offsets: Partial<Record<RiskType, number>> = {};
  for (const zone of temporal.timeVaryingZones) {
    if (!zone.enabled || zone.offset === 0) continue;
    if (!isZoneActiveAt(zone, arrivalTimeMin)) continue;
    const ring = ringAt(zone, arrivalTimeMin, temporal.extent, temporal.hexSizeKm);
    if (!isPointInPolygon(cellCenter, ring)) continue;
    offsets[zone.risk] = (offsets[zone.risk] ?? 0) + zone.offset;
  }
  return applyZoneOffsets(profile, offsets);
}

/** Full modifier chain: speed → day/night → time-varying zones. */
function applyAllModifiers(
  profile: RiskProfile,
  cellCenter: WorldPoint | undefined,
  arrivalTimeMin: number,
  speed: number,
  temporal: TemporalContext,
): RiskProfile {
  let p = speedModifiedProfile(profile, speed);
  p = applyTemporalModifiers(p, arrivalTimeMin, temporal.dayNight);
  p = applyTimeVaryingZones(p, cellCenter, arrivalTimeMin, temporal);
  return p;
}

/** Soft arrival-window penalty in cost units (steers A* without hard blocking). */
function windowPenalty(
  arrivalMin: number,
  window: TimeWindow | null | undefined,
  params: CostParams,
): number {
  if (!window) return 0;
  const penaltyPerMin = params.riskWeight * 0.5;
  const early = window.earliest !== undefined ? Math.max(0, window.earliest - arrivalMin) : 0;
  const late = window.latest !== undefined ? Math.max(0, arrivalMin - window.latest) : 0;
  return (early + late) * penaltyPerMin;
}

// --- Pathfinding -----------------------------------------------------------

/**
 * A* shortest path between two cells under `params`. `usage` penalises cells
 * already crossed by accepted COAs; `blocked` cells are not traversed (except the
 * destination, so a waypoint placed on blocked terrain stays reachable). The
 * heuristic — straight-line distance × distance weight — is a consistent lower
 * bound on remaining cost (risk, diversity and temporal effects only add), so no
 * node is reopened. Returns `null` if `dst` is unreachable.
 *
 * Time tracking: `legStartDistKm` is the cumulative journey distance before this
 * leg. Arrival time at each cell = startTime + (legStartDistKm + legDistKm) / speed * 60.
 */
function aStar(
  graph: Graph,
  src: CellId,
  dst: CellId,
  params: CostParams,
  usage: ReadonlyMap<CellId, number>,
  blocked: ReadonlySet<CellId>,
  temporal: TemporalContext,
  legStartDistKm: number,
  legStartTimeMin = 0,
): CellId[] | null {
  if (src === dst) return [src];
  const goalCenter = graph.centerOf(dst);
  if (!goalCenter) return null;
  const heuristic = (id: CellId): number => {
    const c = graph.centerOf(id);
    return c ? worldDistance(c, goalCenter) * params.distanceWeightKm : 0;
  };

  const isDynamic = temporal.journeyParams.speedMode === 'dynamic';
  const fixedSpeed = temporal.journeyParams.fixedSpeedKmh;

  const gScore = new Map<CellId, number>([[src, 0]]);
  const travelDistKm = new Map<CellId, number>([[src, 0]]);
  // Cumulative travel time within this leg (seconds within this A* call).
  // Distinct from distance because dynamic mode may use different speeds per cell.
  const travelTimeMin = new Map<CellId, number>([[src, 0]]);
  const prev = new Map<CellId, CellId>();
  const closed = new Set<CellId>();
  const open = new MinHeap();
  open.push(heuristic(src), src);

  // Find which waypoint index dst corresponds to (for window penalty).
  const dstWaypointIdx = temporal.waypoints.indexOf(dst);

  while (open.size > 0) {
    const current = open.pop()!;
    if (closed.has(current)) continue;
    if (current === dst) break;
    closed.add(current);
    const fromCenter = graph.centerOf(current);
    if (!fromCenter) continue;
    const gCurrent = gScore.get(current) ?? Infinity;
    const distCurrent = travelDistKm.get(current) ?? 0;
    const curTimeMin = travelTimeMin.get(current) ?? 0;

    for (const next of graph.neighbors(current)) {
      if (closed.has(next)) continue;
      if (next !== dst && blocked.has(next)) continue;
      const toCenter = graph.centerOf(next);
      if (!toCenter) continue;

      const legDistKm = worldDistance(fromCenter, toCenter);
      const newDistKm = distCurrent + legDistKm;
      const totalDistKm = legStartDistKm + newDistKm;
      const uses = usage.get(next) ?? 0;

      let edge: number;
      let arrivalMin: number;
      let newTimeMin: number;

      if (isDynamic) {
        // Try SPEED_MIN and SPEED_MAX; pick whichever gives lower entry cost.
        // Use cumulative time (not distance/speed) for accurate arrival estimate.
        let bestBase = Infinity;
        let bestArrival = 0;
        let bestSpeed = SPEED_MIN_KMH;
        for (const s of [SPEED_MIN_KMH, SPEED_MAX_KMH]) {
          const legTime = (legDistKm / s) * 60;
          const arr = temporal.journeyParams.startTime + legStartTimeMin + curTimeMin + legTime;
          const prof = applyAllModifiers(graph.riskAt(next), toCenter, arr, s, temporal);
          const base = movementCost(legDistKm, params) + cellRiskCost(prof, params);
          if (base < bestBase) {
            bestBase = base;
            bestArrival = arr;
            bestSpeed = s;
          }
        }
        arrivalMin = bestArrival;
        newTimeMin = curTimeMin + (legDistKm / bestSpeed) * 60;
        edge = uses > 0 ? bestBase * (1 + DIVERSITY_PENALTY * uses) : bestBase;
      } else {
        arrivalMin = temporal.journeyParams.startTime + (totalDistKm / fixedSpeed) * 60;
        newTimeMin = curTimeMin + (legDistKm / fixedSpeed) * 60;
        const profile = applyAllModifiers(graph.riskAt(next), toCenter, arrivalMin, fixedSpeed, temporal);
        const base = movementCost(legDistKm, params) + cellRiskCost(profile, params);
        edge = uses > 0 ? base * (1 + DIVERSITY_PENALTY * uses) : base;
      }

      // Soft window penalty when this neighbour is the destination waypoint.
      if (next === dst && dstWaypointIdx >= 0) {
        edge += windowPenalty(arrivalMin, temporal.waypointWindows[dstWaypointIdx] ?? null, params);
      }

      const tentative = gCurrent + edge;
      if (tentative < (gScore.get(next) ?? Infinity)) {
        gScore.set(next, tentative);
        travelDistKm.set(next, newDistKm);
        travelTimeMin.set(next, newTimeMin);
        prev.set(next, current);
        open.push(tentative + heuristic(next), next);
      }
    }
  }

  if (!prev.has(dst)) return null;
  const path: CellId[] = [dst];
  let node = dst;
  while (node !== src) {
    const p = prev.get(node);
    if (p === undefined) return null;
    path.push(p);
    node = p;
  }
  path.reverse();
  return path;
}

/** One leg, preferring to respect blocks but never failing to connect waypoints. */
function leg(
  graph: Graph,
  a: CellId,
  b: CellId,
  params: CostParams,
  usage: ReadonlyMap<CellId, number>,
  blocked: ReadonlySet<CellId>,
  temporal: TemporalContext,
  legStartDistKm: number,
  legStartTimeMin = 0,
): CellId[] {
  const withBlocks =
    blocked.size > 0
      ? aStar(graph, a, b, params, usage, blocked, temporal, legStartDistKm, legStartTimeMin)
      : null;
  return (
    withBlocks ??
    aStar(graph, a, b, params, usage, NO_BLOCKS, temporal, legStartDistKm, legStartTimeMin) ?? [a, b]
  );
}

/** Cumulative distance of a path in km. */
function pathDistanceKm(path: CellId[], graph: Graph): number {
  let dist = 0;
  for (let i = 1; i < path.length; i++) {
    const a = graph.centerOf(path[i - 1]!);
    const b = graph.centerOf(path[i]!);
    if (a && b) dist += worldDistance(a, b);
  }
  return dist;
}

/** Walk the waypoint sequence in order, concatenating each consecutive leg. */
function pathThroughSequence(
  graph: Graph,
  sequence: readonly CellId[],
  params: CostParams,
  usage: ReadonlyMap<CellId, number>,
  blocked: ReadonlySet<CellId>,
  temporal: TemporalContext,
): CellId[] {
  const full: CellId[] = [];
  let cumulativeDistKm = 0;
  let cumulativeTimeMin = 0;
  // Estimate per-segment speed for time tracking across legs.
  // Dynamic mode uses the midpoint of the speed range as a planning estimate;
  // the actual per-cell speeds are resolved during buildCoa.
  const speedEstKmh =
    temporal.journeyParams.speedMode === 'dynamic'
      ? (SPEED_MIN_KMH + SPEED_MAX_KMH) / 2
      : temporal.journeyParams.fixedSpeedKmh;
  for (let i = 0; i < sequence.length - 1; i++) {
    const seg = leg(
      graph,
      sequence[i]!,
      sequence[i + 1]!,
      params,
      usage,
      blocked,
      temporal,
      cumulativeDistKm,
      cumulativeTimeMin,
    );
    full.push(...(i === 0 ? seg : seg.slice(1)));
    const segDistKm = pathDistanceKm(seg, graph);
    cumulativeDistKm += segDistKm;
    cumulativeTimeMin += (segDistKm / speedEstKmh) * 60;
  }
  return full;
}

// --- COA assembly ----------------------------------------------------------

function buildCoa(
  id: string,
  label: string,
  path: CellId[],
  graph: Graph,
  params: CostParams,
  temporal: TemporalContext,
): Coa {
  const steps: CoaCellStep[] = [];
  const riskTotals = zeroRisk();
  let totalCost = 0;
  let totalDistanceKm = 0;
  // Track actual cumulative travel time so arrival times are correct even when
  // different cells use different speeds (dynamic mode).
  let cumulativeTimeMin = 0;
  const isDynamic = temporal.journeyParams.speedMode === 'dynamic';
  const fixedSpeed = temporal.journeyParams.fixedSpeedKmh;
  const waypointArrivals: number[] = new Array(temporal.waypoints.length).fill(
    temporal.journeyParams.startTime,
  ) as number[];

  path.forEach((cellId, i) => {
    let legKm = 0;
    let move = 0;
    if (i > 0) {
      const a = graph.centerOf(path[i - 1]!);
      const b = graph.centerOf(cellId);
      if (a && b) {
        legKm = worldDistance(a, b);
        totalDistanceKm += legKm;
        move = movementCost(legKm, params);
      }
    }

    // Dynamic: pick the speed that minimises entry cost at this step.
    // Use cumulative time (not total distance / speed) for accurate arrival estimate.
    const cellCenter = graph.centerOf(cellId);
    let chosenSpeed: number;
    if (isDynamic) {
      let bestCost = Infinity;
      chosenSpeed = SPEED_MIN_KMH;
      for (const s of [SPEED_MIN_KMH, SPEED_MAX_KMH]) {
        const legTime = i > 0 && legKm > 0 ? (legKm / s) * 60 : 0;
        const arr = temporal.journeyParams.startTime + cumulativeTimeMin + legTime;
        const prof = applyAllModifiers(graph.riskAt(cellId), cellCenter, arr, s, temporal);
        const cost = move + cellRiskCost(prof, params);
        if (cost < bestCost) {
          bestCost = cost;
          chosenSpeed = s;
        }
      }
    } else {
      chosenSpeed = fixedSpeed;
    }

    if (i > 0 && legKm > 0) cumulativeTimeMin += (legKm / chosenSpeed) * 60;
    const arrivalMin = temporal.journeyParams.startTime + cumulativeTimeMin;

    // Apply same modifier chain as A* for consistency.
    const profile = applyAllModifiers(graph.riskAt(cellId), cellCenter, arrivalMin, chosenSpeed, temporal);
    const perRisk = riskCostBreakdown(profile, params);

    let stepCost = move;
    for (const r of RISK_TYPES) {
      riskTotals[r] += perRisk[r];
      stepCost += perRisk[r];
    }
    totalCost += stepCost;
    steps.push({ cellId, perRisk, movementCost: move, stepCost, arrivalTimeMinutes: arrivalMin, speedKmh: chosenSpeed });

    // Record arrival time at each waypoint.
    const wpIdx = temporal.waypoints.indexOf(cellId);
    if (wpIdx >= 0) waypointArrivals[wpIdx] = arrivalMin;
  });

  const lastArrival = steps[steps.length - 1]?.arrivalTimeMinutes ?? temporal.journeyParams.startTime;

  // Auto-shift departure time to satisfy violated 'earliest' arrival constraints.
  // If any waypoint window requires arriving later than the route naturally does,
  // push the whole schedule forward so it arrives exactly at the constraint.
  // Re-runs buildCoa with the adjusted startTime so temporal modifiers (day/night,
  // moving zones) are evaluated at the correct times. The path is kept unchanged.
  let startShift = 0;
  for (let wi = 0; wi < temporal.waypointWindows.length; wi++) {
    const win = temporal.waypointWindows[wi];
    if (!win?.earliest) continue;
    const arrival = waypointArrivals[wi] ?? temporal.journeyParams.startTime;
    if (arrival < win.earliest) {
      startShift = Math.max(startShift, win.earliest - arrival);
    }
  }
  if (startShift > 0) {
    const shiftedTemporal: TemporalContext = {
      ...temporal,
      journeyParams: { ...temporal.journeyParams, startTime: temporal.journeyParams.startTime + startShift },
    };
    return buildCoa(id, label, path, graph, params, shiftedTemporal);
  }

  return {
    id,
    label,
    path,
    steps,
    totalCost,
    totalDistanceKm,
    riskTotals,
    departureTimeMinutes: temporal.journeyParams.startTime,
    arrivalTimeMinutes: lastArrival,
    waypointArrivals,
    speedKmh: isDynamic ? null : fixedSpeed,
  };
}

/** Jaccard overlap (shared / union cells) between two paths. */
function overlap(a: ReadonlySet<CellId>, b: readonly CellId[]): number {
  if (a.size === 0 || b.length === 0) return 0;
  let shared = 0;
  const bSet = new Set(b);
  for (const id of bSet) if (a.has(id)) shared++;
  return shared / (a.size + bSet.size - shared);
}

// --- Waypoint ordering (greedy nearest-neighbour TSP) ----------------------

/**
 * Cost of the shortest path between two cells under the *balanced* strategy —
 * used only for the TSP distance matrix, not for final scoring, so we skip
 * diversity and impassable concerns (those apply to the per-leg search later).
 */
function legCost(graph: Graph, a: CellId, b: CellId, params: CostParams): number {
  const path = aStar(graph, a, b, params, NO_USAGE, NO_BLOCKS, EMPTY_TEMPORAL, 0);
  if (!path) return Infinity;
  let cost = 0;
  for (let i = 1; i < path.length; i++) {
    const from = graph.centerOf(path[i - 1]!);
    const to = graph.centerOf(path[i]!);
    if (from && to) {
      cost +=
        movementCost(worldDistance(from, to), params) +
        cellRiskCost(graph.riskAt(path[i]!), params);
    }
  }
  return cost;
}

/**
 * Greedy nearest-neighbour reordering: start at the first waypoint (fixed),
 * then greedily pick the cheapest unvisited waypoint at each step.
 */
function optimiseWaypointOrder(
  graph: Graph,
  waypoints: readonly CellId[],
  params: CostParams,
): CellId[] {
  if (waypoints.length <= 2) return waypoints.slice();
  const remaining = new Set(waypoints.slice(1));
  const ordered: CellId[] = [waypoints[0]!];
  while (remaining.size > 0) {
    let best: CellId | undefined;
    let bestCost = Infinity;
    for (const candidate of remaining) {
      const c = legCost(graph, ordered[ordered.length - 1]!, candidate, params);
      if (c < bestCost) {
        bestCost = c;
        best = candidate;
      }
    }
    if (best === undefined) break;
    ordered.push(best);
    remaining.delete(best);
  }
  return ordered;
}

// --- Planning strategies ---------------------------------------------------

/**
 * Run the 3-strategy search + fan-out for a single fixed speed (or dynamic)
 * and return up to `coaCount` accepted paths. This is the inner kernel shared
 * by Fixed, Dynamic, and each speed candidate in Optimal mode.
 */
function planFixed(
  graph: Graph,
  sequence: readonly CellId[],
  params: CostParams,
  coaCount: number,
  blocked: ReadonlySet<CellId>,
  temporal: TemporalContext,
): Array<{ path: CellId[]; cells: Set<CellId> }> {
  const usage = new Map<CellId, number>();
  const seen = new Set<string>();
  const accepted: { path: CellId[]; cells: Set<CellId> }[] = [];

  const accept = (path: CellId[], enforceDistinct: boolean): boolean => {
    if (path.length === 0) return false;
    const signature = path.join('>');
    if (seen.has(signature)) return false;
    if (enforceDistinct) {
      for (const prior of accepted) {
        if (overlap(prior.cells, path) > MAX_OVERLAP) return false;
      }
    }
    seen.add(signature);
    for (const id of path) usage.set(id, (usage.get(id) ?? 0) + 1);
    accepted.push({ path, cells: new Set(path) });
    return true;
  };

  // 1) Three strategy biases.
  for (const strategy of STRATEGIES) {
    if (accepted.length >= coaCount) break;
    accept(
      pathThroughSequence(graph, sequence, scaleParams(params, strategy), NO_USAGE, blocked, temporal),
      true,
    );
  }
  // 2) Fan out under real params, penalising used cells.
  for (let guard = 0; accepted.length < coaCount && guard < coaCount + 2; guard++) {
    if (!accept(pathThroughSequence(graph, sequence, params, usage, blocked, temporal), true)) break;
  }
  // 3) Fill with relaxed distinctness if still short.
  for (let guard = 0; accepted.length < coaCount && guard < coaCount + 2; guard++) {
    if (!accept(pathThroughSequence(graph, sequence, params, usage, blocked, temporal), false)) break;
  }
  return accepted;
}

/**
 * Optimal speed: run `planFixed` for each candidate speed, collect all COAs,
 * sort cheapest-first, then deduplicate by Jaccard similarity to keep paths
 * genuinely diverse. Returns up to `coaCount` COAs, each tagged with the speed
 * that made it cheapest.
 */
function planOptimal(
  graph: Graph,
  sequence: readonly CellId[],
  params: CostParams,
  coaCount: number,
  blocked: ReadonlySet<CellId>,
  temporal: TemporalContext,
): Coa[] {
  const allCoas: Coa[] = [];
  for (const speed of CANDIDATE_SPEEDS) {
    const t: TemporalContext = {
      ...temporal,
      journeyParams: { ...temporal.journeyParams, fixedSpeedKmh: speed, speedMode: 'fixed' },
    };
    const accepted = planFixed(graph, sequence, params, coaCount, blocked, t);
    for (const { path } of accepted) {
      allCoas.push(buildCoa('tmp', 'route', path, graph, params, t));
    }
  }
  // Sort cheapest first.
  allCoas.sort((a, b) => a.totalCost - b.totalCost);
  // Deduplicate: keep a COA only if it isn't too similar to an already-accepted one.
  const result: Coa[] = [];
  const resultSets: Set<CellId>[] = [];
  for (const coa of allCoas) {
    const coaSet = new Set(coa.path);
    const tooSimilar = resultSets.some((s) => overlap(s, coa.path) > MAX_OVERLAP);
    if (!tooSimilar) {
      result.push(coa);
      resultSets.push(coaSet);
      if (result.length >= coaCount) break;
    }
  }
  return result;
}

// --- Entry point -----------------------------------------------------------

export function planRoutes(request: RouteRequest): RoutePlan {
  const graph = buildGraph(request.grid, request.risk);
  const sequence = request.optimiseOrder
    ? optimiseWaypointOrder(graph, request.waypoints, request.params)
    : request.waypoints;
  const params = request.params;
  const coaCount = Math.max(1, request.coaCount);
  const blocked: ReadonlySet<CellId> = request.impassable?.length
    ? new Set(request.impassable)
    : NO_BLOCKS;

  const temporal: TemporalContext = {
    journeyParams: request.journeyParams ?? DEFAULT_JOURNEY_PARAMS,
    dayNight: request.dayNight ?? DEFAULT_DAY_NIGHT,
    timeVaryingZones: request.timeVaryingZones ?? [],
    extent: request.grid.extent,
    hexSizeKm: request.grid.layout.size,
    waypointWindows: request.waypointWindows ?? Array<TimeWindow | null>(request.waypoints.length).fill(null),
    waypoints: request.waypoints,
  };

  let coas: Coa[];

  if (temporal.journeyParams.speedMode === 'optimal') {
    coas = planOptimal(graph, sequence, params, coaCount, blocked, temporal);
  } else {
    // Fixed or Dynamic: one planning pass with the configured temporal context.
    const accepted = planFixed(graph, sequence, params, coaCount, blocked, temporal);
    coas = accepted.map((a, i) => buildCoa(`coa-${i}`, 'route', a.path, graph, params, temporal));
    coas.sort((a, b) => a.totalCost - b.totalCost);
  }

  coas.forEach((coa, i) => {
    coa.id = `coa-${i}`;
    coa.label = i === 0 ? 'Best route' : `Alternative ${i}`;
  });

  return {
    coas: coas.slice(0, coaCount),
    waypoints: request.waypoints,
    generatedAt: Date.now(),
  };
}
