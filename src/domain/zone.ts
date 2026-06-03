import type { WorldPoint } from './world';
import type { RiskType } from './risk';
import { clamp } from './units';
import { coverageFraction } from './geometry';

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
  /** Whether this zone contributes to risk scoring. Defaults to true. */
  enabled: boolean;
}

/** Clamp an offset into the allowed signed range. */
export function clampZoneOffset(value: number): number {
  return clamp(value, ZONE_OFFSET_MIN, ZONE_OFFSET_MAX);
}

/**
 * Aggregate the signed, area-weighted zone offsets for one cell: for every zone
 * overlapping the hex, add `coverageFraction * offset` to that zone's channel.
 * The result is fed to {@link applyZoneOffsets} to fold into the cell profile.
 */
export function zoneOffsetsForCell(
  hexVertices: readonly WorldPoint[],
  zones: readonly RiskZone[],
): Partial<Record<RiskType, number>> {
  const out: Partial<Record<RiskType, number>> = {};
  for (const zone of zones) {
    if (!zone.enabled || zone.offset === 0) continue;
    const coverage = coverageFraction(hexVertices, zone.ring);
    if (coverage <= 0) continue;
    out[zone.risk] = (out[zone.risk] ?? 0) + coverage * zone.offset;
  }
  return out;
}
