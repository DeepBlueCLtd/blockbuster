import type { WorldExtent, WorldPoint } from './world';
import type { RiskType } from './risk';
import { clamp } from './units';
import { coverageFraction } from './geometry';

/** How an extra-risk zone was drawn. Geometry is always stored as a world ring. */
export type ZoneKind = 'rectangle' | 'circle' | 'polygon';

/**
 * A zone whose spatial bounds move over time. Currently the only motion type is
 * `'linear-sweep'`: the band travels in a straight line from `fromX` to `toX`
 * (both in world km) over the zone's `[startTime, endTime]` window. The actual
 * ring at any time is computed by {@link ringAt} — it is never stored.
 */
export interface LinearSweepMotion {
  type: 'linear-sweep';
  /** Starting X (km, east side of the sweep). */
  fromX: number;
  /** Ending X (km, west side of the sweep). */
  toX: number;
  /** Band half-width expressed in cell-widths. */
  bandCells: number;
  /** If true the band slants toward the west (left-facing); otherwise toward the east. */
  slantLeft: boolean;
}

export type ZoneMotion = LinearSweepMotion;

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
  /**
   * Optional motion descriptor. When set, `ring` is ignored and the zone's
   * spatial bounds are computed per-time-step via {@link ringAt}. The motion
   * window must be delimited by `startTime`/`endTime`.
   */
  motion?: ZoneMotion;
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

// --- Dynamic shape computation -----------------------------------------------

/** Build the four parallelogram corners of a linear-sweep storm band centred at cx. */
function sweepRingPoints(
  cx: number,
  extent: WorldExtent,
  hexSizeKm: number,
  bandCells: number,
  slantLeft: boolean,
): WorldPoint[] {
  const { height } = extent;
  const halfW = (bandCells * hexSizeKm) / 2;
  const drift = height * Math.tan((30 * Math.PI) / 180) * (slantLeft ? -1 : 1);
  const margin = hexSizeKm;
  return [
    { x: cx - halfW, y: -margin },
    { x: cx + halfW, y: -margin },
    { x: cx + halfW + drift, y: height + margin },
    { x: cx - halfW + drift, y: height + margin },
  ];
}

/**
 * The spatial ring for a zone at the given wall-clock time. For zones without
 * motion this is just `zone.ring`. For motion zones the ring is computed from
 * the motion descriptor so it can be called once per A* step with no stored state.
 *
 * @param zone     The zone whose ring is needed.
 * @param timeMinutes  Wall-clock time in minutes from midnight.
 * @param extent   World extent (km), used by sweep motion to scale the ring.
 * @param hexSizeKm  Cell circumradius, used to set band width.
 */
export function ringAt(
  zone: RiskZone,
  timeMinutes: number,
  extent: WorldExtent,
  hexSizeKm: number,
): WorldPoint[] {
  if (!zone.motion) return zone.ring;
  const m = zone.motion;
  const s = zone.startTime ?? 0;
  const e = zone.endTime ?? 1439;
  const D = e >= s ? e - s : 1440 - s + e;
  if (D <= 0) return sweepRingPoints(m.fromX, extent, hexSizeKm, m.bandCells, m.slantLeft);
  // Elapsed minutes within the active window, clamped to [0, D].
  const elapsed =
    e >= s
      ? Math.max(0, Math.min(D, timeMinutes - s))
      : timeMinutes >= s
        ? Math.min(D, timeMinutes - s)
        : Math.min(D, 1440 - s + timeMinutes);
  const cx = m.fromX + (m.toX - m.fromX) * (elapsed / D);
  return sweepRingPoints(cx, extent, hexSizeKm, m.bandCells, m.slantLeft);
}

/**
 * Ray-casting point-in-polygon test. Used in the routing worker (which has only
 * cell centres, not full vertex arrays) to test dynamic-zone coverage cheaply.
 */
export function isPointInPolygon(point: WorldPoint, ring: readonly WorldPoint[]): boolean {
  const n = ring.length;
  if (n < 3) return false;
  let inside = false;
  const { x, y } = point;
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const xi = ring[i]!.x;
    const yi = ring[i]!.y;
    const xj = ring[j]!.x;
    const yj = ring[j]!.y;
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) {
      inside = !inside;
    }
  }
  return inside;
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
