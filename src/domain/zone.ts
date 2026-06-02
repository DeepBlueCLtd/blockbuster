import type { WorldPoint } from './world';
import type { RiskType } from './risk';
import { clamp } from './units';

/** How an extra-risk zone was drawn. Geometry is always stored as a world ring. */
export type ZoneKind = 'rectangle' | 'circle' | 'polygon';

/** Inclusive bounds for a zone's signed risk offset. */
export const ZONE_OFFSET_MIN = -0.5;
export const ZONE_OFFSET_MAX = 0.5;

/**
 * A user-drawn extra-risk zone laid over the current basemap. A zone nudges a
 * single risk channel for the cells it covers; the per-cell contribution is
 * `coverageFraction * offset`, summed across overlapping zones, then folded into
 * the cell's effective {@link RiskProfile} before costing (added in the scoring
 * step — this type is the shared contract).
 *
 * Geometry is an open ring in world kilometres (the closing vertex is NOT
 * duplicated). Rectangles and circles are normalised to a ring on capture so all
 * three kinds share one geometry path.
 */
export interface RiskZone {
  id: string;
  name: string;
  /** Which of the five channels this zone affects. */
  risk: RiskType;
  /** Signed offset added to `risk` for covered cells, in [ZONE_OFFSET_MIN, ZONE_OFFSET_MAX]. */
  offset: number;
  /** The tool used to draw it (for the editor/legend). */
  kind: ZoneKind;
  /** Outer ring in world km. */
  ring: WorldPoint[];
}

/** Clamp an offset into the allowed signed range. */
export function clampZoneOffset(value: number): number {
  return clamp(value, ZONE_OFFSET_MIN, ZONE_OFFSET_MAX);
}
