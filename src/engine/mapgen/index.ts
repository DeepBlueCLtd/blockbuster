import type {
  Biome,
  MapGenConfig,
  MapGenerator,
  TerrainField,
  TerrainSample,
  WorldExtent,
  WorldPoint,
} from '@domain';
import { BIOMES, clamp01, mulberry32 } from '@domain';
import { fbm } from './noise';

/**
 * MAP GENERATION MODULE — real implementation of {@link MapGenerator}.
 *
 * Synthesises a deterministic, plausible landscape as a continuous
 * {@link TerrainField}. The world is built from a few coherent *zones* — a
 * mountain range along a seed-chosen ridge, a handful of towns each wrapped in a
 * bandit halo, and a moisture gradient yielding a savannah belt on the dry side
 * and woodland on the wet side — layered over fractal Perlin noise so high-risk
 * areas read as recognisable regions, not speckle. Self-contained: imports only
 * `@domain` (+ the local noise core). See docs/spec/03-engine-mapgen.md.
 */

/** Lattice spacing of the base noise, in km — large enough to form zones. */
const FEATURE_KM = 11;
/** Half-width of the mountain band, in km. */
const RIDGE_KM = 4.5;
/** Radius of a town's influence (its bandit halo), in km. */
const TOWN_KM = 7;
/** Highest elevation the generator emits, in metres. */
const PEAK_M = 2600;
/** How strongly `MapGenTuning.biomeBias` shifts the biome mix. */
const BIAS_GAIN = 0.9;

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

/**
 * Classify a biome by scoring each candidate from the continuous fields and
 * taking the argmax. Scoring (rather than a threshold ladder) gives a clean,
 * monotonic response to `biomeBias`: raising a biome's bias raises its score and
 * therefore its share of the map.
 */
function classifyBiome(
  elevation: number,
  moisture: number,
  settlement: number,
  bias: Partial<Record<Biome, number>> | undefined,
): Biome {
  const scores: Record<Biome, number> = {
    town: settlement * 1.15,
    mountains: elevation * 1.1,
    water: (moisture - 0.55) * 1.6 + (0.45 - elevation) * 0.7,
    woodland: (moisture - 0.5) * 1.0,
    savannah: (0.5 - moisture) * 1.0,
    // A small constant floor so grassland wins the "neither wet nor dry, low
    // and unsettled" middle ground.
    grassland: 0.18,
  };
  if (bias) {
    for (const b of BIOMES) scores[b] += BIAS_GAIN * (bias[b] ?? 0);
  }
  let best: Biome = 'grassland';
  let bestScore = -Infinity;
  for (const b of BIOMES) {
    if (scores[b] > bestScore) {
      bestScore = scores[b];
      best = b;
    }
  }
  return best;
}

export function createMapGenerator(): MapGenerator {
  return {
    generate(config: MapGenConfig): TerrainField {
      const { extent, seed } = config;
      const bias = config.tuning?.biomeBias;
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

          const biome = classifyBiome(elevation, moisture, settlement, bias);

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
