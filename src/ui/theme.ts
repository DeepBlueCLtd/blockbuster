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

/**
 * Vivid, well-separated line colours for the COAs, indexed by their position in
 * the plan (best route first) and wrapping if more COAs ever appear than
 * colours. The hues are kept far apart so the unselected routes stay easy to
 * tell apart — selection is shown by line *thickness*, not by colour or dimming.
 * Each is paired with a light halo (see {@link COA_HALO_COLOR}) so it reads over
 * a map whose colour we don't control.
 */
export const COA_COLORS = [
  '#1565c0', // blue
  '#ef6c00', // orange
  '#d81b60', // pink
  '#2e7d32', // green
  '#6a1b9a', // purple
  '#00838f', // teal
] as const;

/** Light halo drawn under a COA line so its colour reads on any background. */
export const COA_HALO_COLOR = '#ffffff';

/** Colour for the COA at `index` in the plan (best-first), wrapping if needed. */
export function coaColor(index: number): string {
  return COA_COLORS[index % COA_COLORS.length] ?? COA_COLORS[0];
}

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
