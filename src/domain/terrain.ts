import type { Celsius, Metres, Unit } from './units';
import type { WorldExtent, WorldPoint } from './world';

/**
 * Coarse land-cover classification used for rendering and as an input to the
 * risk model. The brief calls out woodland, towns, savannah and mountains;
 * grassland and water are included as connective tissue.
 */
export type Biome = 'woodland' | 'town' | 'savannah' | 'mountains' | 'grassland' | 'water';

export const BIOMES: readonly Biome[] = [
  'woodland',
  'town',
  'savannah',
  'mountains',
  'grassland',
  'water',
] as const;

/**
 * Continuous environmental attributes sampled at a point. The Risk module maps
 * these to the five risk channels, so Map Generation and Risk stay decoupled:
 * map-gen decides *what the world is like*, risk decides *what that costs*.
 */
export interface TerrainSample {
  biome: Biome;
  /** Elevation above sea level. */
  elevation: Metres;
  /** Representative daytime temperature. */
  temperature: Celsius;
  /** Vegetation density, 0 (barren) … 1 (dense canopy). */
  vegetation: Unit;
  /** Availability of drinkable water, 0 (none) … 1 (abundant). */
  waterProximity: Unit;
  /** Human/banditry pressure, 0 (safe) … 1 (lawless). */
  banditActivity: Unit;
}

/**
 * A continuous, deterministic terrain function over the world rectangle.
 *
 * Implementations must be pure with respect to their seed: `sample(p)` returns
 * the same value for the same point on every call. The field is continuous so
 * the hex grid can sample it at any resolution.
 */
export interface TerrainField {
  readonly extent: WorldExtent;
  readonly seed: number;
  sample(point: WorldPoint): TerrainSample;
}

/** Configuration accepted by a {@link import('./ports').MapGenerator}. */
export interface MapGenConfig {
  extent: WorldExtent;
  seed: number;
  /** Optional knobs for tuning the generated landscape; all have sane defaults. */
  tuning?: MapGenTuning;
}

export interface MapGenTuning {
  /** Approximate fraction of the map covered by each biome (need not sum to 1). */
  biomeBias?: Partial<Record<Biome, number>>;
  /** Spatial frequency of the underlying noise; higher = smaller features. */
  featureScale?: number;
}
