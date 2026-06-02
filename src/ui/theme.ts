import type { Biome, RiskType } from '@domain';
import { clamp01 } from '@domain';

/** Stable per-risk colours used by charts, legends and the map. */
export const RISK_COLORS: Record<RiskType, string> = {
  animals: '#8d6e63',
  cold: '#4fc3f7',
  heat: '#ff7043',
  water: '#ffd54f',
  thief: '#7e57c2',
};

/** Neutral colour for the movement portion of a COA bar. */
export const MOVEMENT_COLOR = '#cfd8dc';

/** Fill colours when shading the map by biome. */
export const BIOME_COLORS: Record<Biome, string> = {
  woodland: '#2e7d32',
  town: '#6d4c41',
  savannah: '#c2a45a',
  mountains: '#757575',
  grassland: '#9ccc65',
  water: '#4fc3f7',
};

/** Human-readable biome names for the map legend. */
export const BIOME_LABELS: Record<Biome, string> = {
  woodland: 'Woodland',
  town: 'Town',
  savannah: 'Savannah',
  mountains: 'Mountains',
  grassland: 'Grassland',
  water: 'Water',
};

/** Map a normalised intensity (0…1) to a green→red heat colour. */
export function heatColor(t: number): string {
  const hue = (1 - clamp01(t)) * 120;
  return `hsl(${hue}, 72%, 48%)`;
}
