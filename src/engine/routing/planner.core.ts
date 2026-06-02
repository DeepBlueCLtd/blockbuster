import type {
  CellId,
  Coa,
  CoaCellStep,
  CostParams,
  HexGridDto,
  RiskProfile,
  RiskType,
  RoutePlan,
  RouteRequest,
  WorldPoint,
} from '@domain';
import {
  cellRiskCost,
  movementCost,
  RISK_TYPES,
  riskCostBreakdown,
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

const ZERO_PROFILE: RiskProfile = { animals: 0, cold: 0, heat: 0, water: 0, thief: 0 };

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

// --- Pathfinding -----------------------------------------------------------

/**
 * A* shortest path between two cells under `params`. `usage` penalises cells
 * already crossed by accepted COAs; `blocked` cells are not traversed (except the
 * destination, so a waypoint placed on blocked terrain stays reachable). The
 * heuristic — straight-line distance × distance weight — is a consistent lower
 * bound on remaining cost (risk and diversity only add), so no node is reopened.
 * Returns `null` if `dst` is unreachable.
 */
function aStar(
  graph: Graph,
  src: CellId,
  dst: CellId,
  params: CostParams,
  usage: ReadonlyMap<CellId, number>,
  blocked: ReadonlySet<CellId>,
): CellId[] | null {
  if (src === dst) return [src];
  const goalCenter = graph.centerOf(dst);
  if (!goalCenter) return null;
  const heuristic = (id: CellId): number => {
    const c = graph.centerOf(id);
    return c ? worldDistance(c, goalCenter) * params.distanceWeightKm : 0;
  };

  const gScore = new Map<CellId, number>([[src, 0]]);
  const prev = new Map<CellId, CellId>();
  const closed = new Set<CellId>();
  const open = new MinHeap();
  open.push(heuristic(src), src);

  while (open.size > 0) {
    const current = open.pop()!;
    if (closed.has(current)) continue;
    if (current === dst) break;
    closed.add(current);
    const fromCenter = graph.centerOf(current);
    if (!fromCenter) continue;
    const gCurrent = gScore.get(current) ?? Infinity;

    for (const next of graph.neighbors(current)) {
      if (closed.has(next)) continue;
      if (next !== dst && blocked.has(next)) continue;
      const toCenter = graph.centerOf(next);
      if (!toCenter) continue;
      const base =
        movementCost(worldDistance(fromCenter, toCenter), params) +
        cellRiskCost(graph.riskAt(next), params);
      const uses = usage.get(next) ?? 0;
      const edge = uses > 0 ? base * (1 + DIVERSITY_PENALTY * uses) : base;
      const tentative = gCurrent + edge;
      if (tentative < (gScore.get(next) ?? Infinity)) {
        gScore.set(next, tentative);
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
): CellId[] {
  const withBlocks = blocked.size > 0 ? aStar(graph, a, b, params, usage, blocked) : null;
  return withBlocks ?? aStar(graph, a, b, params, usage, NO_BLOCKS) ?? [a, b];
}

/** Walk the waypoint sequence in order, concatenating each consecutive leg. */
function pathThroughSequence(
  graph: Graph,
  sequence: readonly CellId[],
  params: CostParams,
  usage: ReadonlyMap<CellId, number>,
  blocked: ReadonlySet<CellId>,
): CellId[] {
  const full: CellId[] = [];
  for (let i = 0; i < sequence.length - 1; i++) {
    const seg = leg(graph, sequence[i]!, sequence[i + 1]!, params, usage, blocked);
    full.push(...(i === 0 ? seg : seg.slice(1)));
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
): Coa {
  const steps: CoaCellStep[] = [];
  const riskTotals = zeroRisk();
  let totalCost = 0;
  let totalDistanceKm = 0;

  path.forEach((cellId, i) => {
    const perRisk = riskCostBreakdown(graph.riskAt(cellId), params);
    let move = 0;
    if (i > 0) {
      const a = graph.centerOf(path[i - 1]!);
      const b = graph.centerOf(cellId);
      if (a && b) {
        const km = worldDistance(a, b);
        totalDistanceKm += km;
        move = movementCost(km, params);
      }
    }
    let stepCost = move;
    for (const r of RISK_TYPES) {
      riskTotals[r] += perRisk[r];
      stepCost += perRisk[r];
    }
    totalCost += stepCost;
    steps.push({ cellId, perRisk, movementCost: move, stepCost });
  });

  return { id, label, path, steps, totalCost, totalDistanceKm, riskTotals };
}

/** Jaccard overlap (shared / union cells) between two paths. */
function overlap(a: ReadonlySet<CellId>, b: readonly CellId[]): number {
  if (a.size === 0 || b.length === 0) return 0;
  let shared = 0;
  const bSet = new Set(b);
  for (const id of bSet) if (a.has(id)) shared++;
  return shared / (a.size + bSet.size - shared);
}

// --- Entry point -----------------------------------------------------------

export function planRoutes(request: RouteRequest): RoutePlan {
  const graph = buildGraph(request.grid, request.risk);
  const sequence = request.waypoints;
  const params = request.params;
  const coaCount = Math.max(1, request.coaCount);
  const blocked: ReadonlySet<CellId> = request.impassable?.length
    ? new Set(request.impassable)
    : NO_BLOCKS;

  const usage = new Map<CellId, number>();
  const seen = new Set<string>();
  const accepted: { path: CellId[]; cells: Set<CellId> }[] = [];

  /**
   * Record a path as a COA if it's new and (when `enforceDistinct`) not a
   * near-duplicate of one already accepted. Tally accepted cells in `usage` so
   * later searches are pushed onto fresh ground.
   */
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

  // 1) Three strategy biases (each scored later under the real params), preferring
  //    genuinely distinct routes.
  for (const strategy of STRATEGIES) {
    if (accepted.length >= coaCount) break;
    accept(pathThroughSequence(graph, sequence, scaleParams(params, strategy), NO_USAGE, blocked), true);
  }

  // 2) Fan out under the real params, penalising used cells, still preferring
  //    distinct routes.
  for (let guard = 0; accepted.length < coaCount && guard < coaCount + 2; guard++) {
    if (!accept(pathThroughSequence(graph, sequence, params, usage, blocked), true)) break;
  }

  // 3) Fill: if the distinctness rule left us short but more exact alternatives
  //    exist, relax to exact-dedup so we still return up to `coaCount`.
  for (let guard = 0; accepted.length < coaCount && guard < coaCount + 2; guard++) {
    if (!accept(pathThroughSequence(graph, sequence, params, usage, blocked), false)) break;
  }

  // Rank best-first under the real params, then label by rank.
  const coas: Coa[] = accepted.map((a, i) => buildCoa(`coa-${i}`, 'route', a.path, graph, params));
  coas.sort((a, b) => a.totalCost - b.totalCost);
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
