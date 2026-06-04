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
 *
 * When `startTime` or `endTime` are set, the zone is only active during that
 * window (minutes from midnight). This is used for time-bounded hazards like
 * storm bands. Always-active zones omit both fields.
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
  /** Optional: zone is inactive before this time (minutes from midnight). */
  startTime?: number;
  /** Optional: zone is inactive after this time (minutes from midnight). */
  endTime?: number;
}

/** Clamp an offset into the allowed signed range. */
export function clampZoneOffset(value: number): number {
  return clamp(value, ZONE_OFFSET_MIN, ZONE_OFFSET_MAX);
}

/**
 * Whether a zone's time window includes the given wall-clock time.
 * Zones with no time bounds are always active.
 * Handles wrap-around windows (e.g. 22:00–06:00 spans midnight).
 */
export function isTimeWindowActive(
  startTime: number | undefined,
  endTime: number | undefined,
  timeMinutes: number,
): boolean {
  if (startTime === undefined && endTime === undefined) return true;
  const s = startTime ?? 0;
  const e = endTime ?? 1439;
  return s <= e ? timeMinutes >= s && timeMinutes <= e : timeMinutes >= s || timeMinutes <= e;
}

/** Whether a {@link RiskZone}'s time window is active at the given time. */
export function isZoneActiveAt(zone: RiskZone, timeMinutes: number): boolean {
  return isTimeWindowActive(zone.startTime, zone.endTime, timeMinutes);
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
