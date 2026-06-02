/**
 * A fully working, deterministic stand-in for the real engine. It satisfies the
 * exact same `@domain` ports the production modules will implement, so the store
 * and the entire UI can be developed and demoed before a single real engine
 * module exists. Swap `createMockEngine()` for the real `Engine` wiring later;
 * nothing upstream changes.
 *
 * Quality bar: "good enough to look real", not "correct". Replace per module.
 */
import type {
  Biome,
  CellId,
  Coa,
  CoaCellStep,
  CostParams,
  Engine,
  GridBuilder,
  GridLayoutSpec,
  HexGrid,
  HexGridDto,
  MapGenConfig,
  MapGenerator,
  RiskEngine,
  RiskProfile,
  RiskType,
  RoutePlan,
  RoutePlanner,
  RouteRequest,
  TerrainField,
  TerrainSample,
  WorldExtent,
  WorldPoint,
} from '@domain';
import {
  cellRiskCost,
  clamp01,
  DEFAULT_HEX_SIZE_KM,
  movementCost,
  RISK_TYPES,
  riskCostBreakdown,
  toCellId,
  worldDistance,
} from '@domain';
import { axialNeighbors, buildHexGrid } from './hexMath';

// --- Map generation -------------------------------------------------------

/** Cheap layered-sine "noise" in [0, 1]; not real Perlin, just plausible. */
function fbm(x: number, y: number, seed: number): number {
  const s = seed * 0.001;
  let n = Math.sin(x * 0.25 + s) * Math.cos(y * 0.21 - s);
  n += 0.5 * Math.sin(x * 0.55 - s * 2 + 1.3) * Math.cos(y * 0.49 + s);
  n += 0.25 * Math.sin(x * 1.1 + s * 3) * Math.cos(y * 0.97 - s);
  return clamp01((n / 1.75) * 0.5 + 0.5);
}

function classifyBiome(elevation: number, moisture: number, town: number): Biome {
  if (town > 0.92) return 'town';
  if (moisture > 0.82 && elevation < 0.3) return 'water';
  if (elevation > 0.72) return 'mountains';
  if (moisture > 0.6) return 'woodland';
  if (moisture < 0.35) return 'savannah';
  return 'grassland';
}

export function createMockMapGenerator(): MapGenerator {
  return {
    generate(config: MapGenConfig): TerrainField {
      const { extent, seed } = config;
      return {
        extent,
        seed,
        sample(point: WorldPoint): TerrainSample {
          const elevationN = fbm(point.x, point.y, seed);
          const moistureN = fbm(point.x + 100, point.y - 100, seed + 17);
          const townN = fbm(point.x * 1.7 + 50, point.y * 1.7 + 50, seed + 91);
          const biome = classifyBiome(elevationN, moistureN, townN);
          const temperature = 30 - elevationN * 28;
          return {
            biome,
            elevation: elevationN * 2500,
            temperature,
            vegetation: clamp01(moistureN * (biome === 'savannah' ? 0.5 : 1)),
            waterProximity: clamp01(moistureN),
            banditActivity: biome === 'town' ? clamp01(0.6 + townN * 0.4) : clamp01(townN * 0.5),
          };
        },
      };
    },
  };
}

// --- Hex grid -------------------------------------------------------------

export function createMockGridBuilder(): GridBuilder {
  return {
    build(extent: WorldExtent, layout: GridLayoutSpec): HexGrid {
      return buildHexGrid(extent, {
        orientation: layout.orientation,
        size: layout.size,
        origin: layout.origin ?? { x: 0, y: 0 },
      });
    },
    sampleTerrain(grid: HexGrid, field: TerrainField): Map<CellId, TerrainSample> {
      const out = new Map<CellId, TerrainSample>();
      for (const cell of grid.cells) out.set(cell.id, field.sample(cell.center));
      return out;
    },
  };
}

// --- Risk model -----------------------------------------------------------

export function createMockRiskEngine(): RiskEngine {
  return {
    baseProfile(sample: TerrainSample): RiskProfile {
      return {
        animals: clamp01(sample.vegetation * 0.9 + (sample.biome === 'savannah' ? 0.2 : 0)),
        cold: clamp01((15 - sample.temperature) / 25),
        heat: clamp01((sample.temperature - 22) / 12),
        water: clamp01(1 - sample.waterProximity),
        thief: clamp01(sample.banditActivity),
      };
    },
  };
}

// --- Routing --------------------------------------------------------------

interface Strategy {
  label: string;
  riskScale: number;
  distScale: number;
}

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

/**
 * How hard to penalise re-using a cell already crossed by an accepted COA. Each
 * prior use multiplies that cell's entry cost by `(1 + DIVERSITY_PENALTY · uses)`,
 * fanning successive searches out into genuinely different routes.
 */
const DIVERSITY_PENALTY = 1;

/** Shared empty usage map for searches that apply no diversity penalty. */
const NO_USAGE: ReadonlyMap<CellId, number> = new Map();

function zeroRisk(): Record<RiskType, number> {
  const out = {} as Record<RiskType, number>;
  for (const r of RISK_TYPES) out[r] = 0;
  return out;
}

interface Graph {
  centerOf(id: CellId): WorldPoint | undefined;
  neighbors(id: CellId): CellId[];
  riskAt(id: CellId): RiskProfile;
}

function buildGraph(dto: HexGridDto, risk: Record<CellId, RiskProfile>): Graph {
  const center = new Map<CellId, WorldPoint>();
  const coord = new Map<CellId, { q: number; r: number }>();
  for (const c of dto.cells) {
    center.set(c.id, c.center);
    coord.set(c.id, { q: c.q, r: c.r });
  }
  return {
    centerOf: (id) => center.get(id),
    neighbors: (id) => {
      const co = coord.get(id);
      if (!co) return [];
      return axialNeighbors(co)
        .map(toCellId)
        .filter((nid) => center.has(nid));
    },
    riskAt: (id) => risk[id] ?? { animals: 0, cold: 0, heat: 0, water: 0, thief: 0 },
  };
}

/**
 * Dijkstra shortest path between two cells under the given cost params. `usage`
 * maps a cell to how many already-accepted COAs cross it; entering such a cell is
 * penalised so repeated searches discover distinct routes (k-shortest-with-diversity).
 */
function shortestPath(
  graph: Graph,
  src: CellId,
  dst: CellId,
  params: CostParams,
  usage: ReadonlyMap<CellId, number>,
): CellId[] {
  const dist = new Map<CellId, number>([[src, 0]]);
  const prev = new Map<CellId, CellId>();
  const visited = new Set<CellId>();
  const frontier = new Set<CellId>([src]);

  while (frontier.size > 0) {
    let current: CellId | undefined;
    let best = Infinity;
    for (const id of frontier) {
      const d = dist.get(id) ?? Infinity;
      if (d < best) {
        best = d;
        current = id;
      }
    }
    if (current === undefined) break;
    frontier.delete(current);
    visited.add(current);
    if (current === dst) break;

    const fromCenter = graph.centerOf(current);
    if (!fromCenter) continue;
    for (const next of graph.neighbors(current)) {
      if (visited.has(next)) continue;
      const toCenter = graph.centerOf(next);
      if (!toCenter) continue;
      const base =
        movementCost(worldDistance(fromCenter, toCenter), params) +
        cellRiskCost(graph.riskAt(next), params);
      const uses = usage.get(next) ?? 0;
      const edge = uses > 0 ? base * (1 + DIVERSITY_PENALTY * uses) : base;
      const nd = (dist.get(current) ?? Infinity) + edge;
      if (nd < (dist.get(next) ?? Infinity)) {
        dist.set(next, nd);
        prev.set(next, current);
        frontier.add(next);
      }
    }
  }

  const path: CellId[] = [];
  let node: CellId | undefined = dst;
  while (node !== undefined) {
    path.unshift(node);
    if (node === src) break;
    node = prev.get(node);
  }
  return path[0] === src ? path : [src, dst];
}

/** Walk the waypoint sequence in order, concatenating each consecutive leg. */
function pathThroughSequence(
  graph: Graph,
  sequence: readonly CellId[],
  params: CostParams,
  usage: ReadonlyMap<CellId, number> = NO_USAGE,
): CellId[] {
  const full: CellId[] = [];
  for (let i = 0; i < sequence.length - 1; i++) {
    const seg = shortestPath(graph, sequence[i]!, sequence[i + 1]!, params, usage);
    full.push(...(i === 0 ? seg : seg.slice(1)));
  }
  return full;
}

function buildCoa(id: string, label: string, path: CellId[], graph: Graph, params: CostParams): Coa {
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

/** Synchronous core of the mock planner (used by fixtures and tests). */
export function planRoutesSync(request: RouteRequest): RoutePlan {
  const graph = buildGraph(request.grid, request.risk);
  // Waypoints are visited in the exact order the analyst arranged them — the UI
  // owns the sequence (add / reorder / relocate), so the planner must not shuffle
  // them. Diversity comes from how routes path *between* consecutive waypoints.
  const sequence = request.waypoints;
  const params = request.params;
  const coaCount = Math.max(1, request.coaCount);

  const usage = new Map<CellId, number>();
  const seen = new Set<string>();
  const coas: Coa[] = [];

  // Record a path as a COA if it's a genuinely new route. Tally accepted routes'
  // cells in `usage` so later searches are pushed onto fresh ground. Every COA is
  // scored under the analyst's real params, so the charts stay consistent
  // regardless of the bias used to discover it.
  const accept = (label: string, path: CellId[]): boolean => {
    const signature = path.join('>');
    if (path.length === 0 || seen.has(signature)) return false;
    seen.add(signature);
    for (const id of path) usage.set(id, (usage.get(id) ?? 0) + 1);
    coas.push(buildCoa(`coa-${coas.length}`, label, path, graph, params));
    return true;
  };

  // 1) Bias the search three ways (favour distance / balanced / favour low risk)
  //    so the field's natural alternatives surface first, each undistorted.
  for (const strategy of STRATEGIES) {
    accept(strategy.label, pathThroughSequence(graph, sequence, scaleParams(params, strategy)));
  }

  // 2) If those biases collapsed onto the same route (common when risk varies
  //    little across the corridor), fan out: penalise the cells already in use and
  //    re-search under the real params for distinct alternatives, until we have
  //    `coaCount` of them — or no genuinely different route remains.
  for (let guard = 0; coas.length < coaCount && guard < coaCount + 2; guard++) {
    if (!accept('alt', pathThroughSequence(graph, sequence, params, usage))) break;
  }

  // Rank best-scoring first, then label by rank (the alternatives are
  // diversity-driven, so a rank reads truer than a strategy name).
  coas.sort((a, b) => a.totalCost - b.totalCost);
  coas.forEach((coa, i) => {
    coa.label = i === 0 ? 'Best route' : `Alternative ${i}`;
  });
  return {
    coas: coas.slice(0, coaCount),
    waypoints: request.waypoints,
    generatedAt: Date.now(),
  };
}

export function createMockRoutePlanner(): RoutePlanner {
  return {
    plan(request: RouteRequest): Promise<RoutePlan> {
      return Promise.resolve(planRoutesSync(request));
    },
  };
}

// --- Engine bundle --------------------------------------------------------

export function createMockEngine(): Engine {
  return {
    mapGenerator: createMockMapGenerator(),
    gridBuilder: createMockGridBuilder(),
    riskEngine: createMockRiskEngine(),
    routePlanner: createMockRoutePlanner(),
  };
}

/** Default layout used by the mock when none is supplied. */
export const MOCK_LAYOUT: GridLayoutSpec = {
  orientation: 'pointy',
  size: DEFAULT_HEX_SIZE_KM,
};
