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
  mulberry32,
  RISK_TYPES,
  riskCostBreakdown,
  toCellId,
  worldDistance,
} from '@domain';
import { axialNeighbors, buildHexGrid } from './hexMath';

// --- Map generation -------------------------------------------------------
//
// The world is laid out as a handful of coherent *zones* rather than a fine
// random fuzz: a mountain range, a few towns (each wrapped in a halo of bandit
// activity) and a moisture gradient that yields a savannah belt on the dry side
// and woodland on the wet side. Risk is derived from these, so high-risk areas
// read as recognisable regions instead of speckle. Everything is a pure
// function of the seed.

/** Lattice spacing of the base noise, in km — large enough to form zones. */
const FEATURE_KM = 11;
/** Half-width of the mountain band, in km. */
const RIDGE_KM = 4.5;
/** Radius of a town's influence (its bandit halo), in km. */
const TOWN_KM = 7;
/** Highest elevation the generator emits, in metres. */
const PEAK_M = 2600;

/** 32-bit integer hash of a lattice point → [0, 1). Deterministic, no sine artefacts. */
function hashLattice(ix: number, iy: number, seed: number): number {
  let h = seed | 0;
  h = Math.imul(h ^ (ix | 0), 0x85ebca6b);
  h = Math.imul(h ^ (iy | 0), 0xc2b2ae35);
  h ^= h >>> 13;
  h = Math.imul(h, 0x27d4eb2f);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

function smoothstep(t: number): number {
  return t * t * (3 - 2 * t);
}

/** Bilinearly interpolated value noise in [0, 1] at unit lattice frequency. */
function valueNoise(x: number, y: number, seed: number): number {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  const fx = smoothstep(x - ix);
  const fy = smoothstep(y - iy);
  const v00 = hashLattice(ix, iy, seed);
  const v10 = hashLattice(ix + 1, iy, seed);
  const v01 = hashLattice(ix, iy + 1, seed);
  const v11 = hashLattice(ix + 1, iy + 1, seed);
  const top = v00 + (v10 - v00) * fx;
  const bottom = v01 + (v11 - v01) * fx;
  return top + (bottom - top) * fy;
}

/** Fractal (multi-octave) value noise in [0, 1]; coherent at the chosen scale. */
function fbm(x: number, y: number, seed: number, octaves = 4): number {
  let amp = 0.5;
  let freq = 1;
  let sum = 0;
  let norm = 0;
  for (let o = 0; o < octaves; o++) {
    sum += amp * valueNoise(x * freq, y * freq, seed + o * 1013);
    norm += amp;
    amp *= 0.5;
    freq *= 2;
  }
  return sum / norm;
}

interface Town {
  x: number;
  y: number;
}

/** Deterministic, seed-derived layout: where the towns sit and how the range runs. */
interface MapFeatures {
  towns: readonly Town[];
  /** A point on the mountain ridge line plus its unit direction. */
  ridge: { x: number; y: number; dx: number; dy: number };
  /** Unit vector along which the land dries out (towards the savannah side). */
  dry: { dx: number; dy: number };
}

function buildFeatures(extent: WorldExtent, seed: number): MapFeatures {
  const rng = mulberry32((seed ^ 0x9e3779b9) >>> 0);
  const margin = Math.min(extent.width, extent.height) * 0.14;
  const towns: Town[] = [];
  for (let i = 0; i < 3; i++) {
    towns.push({
      x: rng.range(margin, extent.width - margin),
      y: rng.range(margin, extent.height - margin),
    });
  }
  const ridgeAngle = rng.range(0, Math.PI);
  const ridge = {
    x: rng.range(extent.width * 0.3, extent.width * 0.7),
    y: rng.range(extent.height * 0.3, extent.height * 0.7),
    dx: Math.cos(ridgeAngle),
    dy: Math.sin(ridgeAngle),
  };
  const dryAngle = rng.range(0, Math.PI * 2);
  return { towns, ridge, dry: { dx: Math.cos(dryAngle), dy: Math.sin(dryAngle) } };
}

function classifyBiome(elevation: number, moisture: number, settlement: number): Biome {
  if (settlement > 0.72) return 'town';
  if (elevation > 0.64) return 'mountains';
  if (moisture > 0.72 && elevation < 0.42) return 'water';
  if (moisture > 0.55) return 'woodland';
  if (moisture < 0.4) return 'savannah';
  return 'grassland';
}

export function createMockMapGenerator(): MapGenerator {
  return {
    generate(config: MapGenConfig): TerrainField {
      const { extent, seed } = config;
      const featureKm = FEATURE_KM / (config.tuning?.featureScale ?? 1);
      const features = buildFeatures(extent, seed);
      const cx = extent.width / 2;
      const cy = extent.height / 2;
      const halfSpan = Math.max(extent.width, extent.height) / 2;

      return {
        extent,
        seed,
        sample(point: WorldPoint): TerrainSample {
          const fx = point.x / featureKm;
          const fy = point.y / featureKm;

          // Mountain range: elevation rises in a band around the ridge line.
          const perp = Math.abs(
            (point.x - features.ridge.x) * features.ridge.dy -
              (point.y - features.ridge.y) * features.ridge.dx,
          );
          const ridgeBoost = Math.exp(-((perp / RIDGE_KM) ** 2));
          const elevation = clamp01(fbm(fx, fy, seed + 11) * 0.55 + ridgeBoost * 0.7);

          // Moisture: a broad gradient (drier on one side → savannah belt) plus noise.
          const along =
            ((point.x - cx) * features.dry.dx + (point.y - cy) * features.dry.dy) / halfSpan;
          const dryness = clamp01(0.5 + 0.5 * along);
          const moisture = clamp01(fbm(fx + 5.2, fy - 3.7, seed + 71) * 0.7 + (1 - dryness) * 0.4);

          // Towns: a nearest-town falloff gives a settlement/bandit *zone*, not a point.
          let nearest = Infinity;
          for (const town of features.towns) {
            nearest = Math.min(nearest, Math.hypot(point.x - town.x, point.y - town.y));
          }
          const halo = Math.exp(-((nearest / TOWN_KM) ** 2));
          const settleNoise = fbm(fx * 1.3 + 9, fy * 1.3 - 2, seed + 131, 3);
          const settlement = clamp01(halo * 0.85 + settleNoise * 0.15);

          const biome = classifyBiome(elevation, moisture, settlement);

          // Cold up high, hot on the dry lowland side.
          const temperature = 33 - elevation * 34 + (dryness - 0.5) * 7;
          // Water is scarce on the dry side and on the peaks → high "lack of water" risk.
          const waterProximity = clamp01(moisture * 0.85 + (1 - elevation) * 0.1 - dryness * 0.2);
          let vegetation = clamp01(moisture * (1 - 0.55 * elevation));
          if (biome === 'savannah') vegetation = clamp01(vegetation * 0.6 + 0.18);
          else if (biome === 'mountains') vegetation *= 0.4;
          else if (biome === 'town') vegetation *= 0.35;
          else if (biome === 'water') vegetation *= 0.2;

          return {
            biome,
            elevation: elevation * PEAK_M,
            temperature,
            vegetation,
            waterProximity,
            banditActivity: clamp01(halo * 0.9 + settleNoise * 0.1),
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
