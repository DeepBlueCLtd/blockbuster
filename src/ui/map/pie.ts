import type { RiskType, WorldPoint } from '@domain';
import { RISK_TYPES } from '@domain';

/** Fraction of a cell's inradius the pie spans, so it sits inside the hex. */
export const PIE_RADIUS_FRACTION = 0.72;

/** Angular resolution of the wedge arcs (radians per segment, ≈15°). */
const SEGMENT_ANGLE = Math.PI / 12;

/** Pie starts at 12 o'clock and runs clockwise, like a conventional chart. */
const START_ANGLE = -Math.PI / 2;

export interface RiskShare {
  risk: RiskType;
  /** This risk's share of the cell's total cost, in [0, 1]. */
  fraction: number;
}

/**
 * Per-risk share of a cell's total cost, in canonical {@link RISK_TYPES} order,
 * skipping channels that contribute nothing. Returns `[]` when the total is zero
 * (a cell with no risk has no pie). The breakdown comes from `riskCostBreakdown`,
 * so the shares shift as the appetite sliders change — exactly like the COA bars.
 */
export function riskShares(breakdown: Record<RiskType, number>): RiskShare[] {
  let total = 0;
  for (const risk of RISK_TYPES) total += Math.max(0, breakdown[risk]);
  if (total <= 0) return [];

  const shares: RiskShare[] = [];
  for (const risk of RISK_TYPES) {
    const value = Math.max(0, breakdown[risk]);
    if (value <= 0) continue;
    shares.push({ risk, fraction: value / total });
  }
  return shares;
}

/**
 * Points of a single pie wedge as a world-space ring: the centre followed by the
 * arc from `startAngle` to `endAngle`. Leaflet closes the polygon back to the
 * centre, completing the wedge.
 */
export function sliceRing(
  center: WorldPoint,
  radius: number,
  startAngle: number,
  endAngle: number,
): WorldPoint[] {
  const span = endAngle - startAngle;
  const steps = Math.max(2, Math.ceil(Math.abs(span) / SEGMENT_ANGLE));
  const ring: WorldPoint[] = [center];
  for (let i = 0; i <= steps; i++) {
    const angle = startAngle + (span * i) / steps;
    ring.push({ x: center.x + radius * Math.cos(angle), y: center.y + radius * Math.sin(angle) });
  }
  return ring;
}

export interface PieSlice {
  risk: RiskType;
  ring: WorldPoint[];
}

/**
 * The pie wedges for one cell: one ring per contributing risk, sized by its share
 * of the cell's total cost. A (near) full-circle wedge for a single-risk cell;
 * nothing for a zero-risk cell.
 */
export function riskPieSlices(
  center: WorldPoint,
  radius: number,
  breakdown: Record<RiskType, number>,
): PieSlice[] {
  const slices: PieSlice[] = [];
  let angle = START_ANGLE;
  for (const { risk, fraction } of riskShares(breakdown)) {
    const next = angle + fraction * Math.PI * 2;
    slices.push({ risk, ring: sliceRing(center, radius, angle, next) });
    angle = next;
  }
  return slices;
}

/**
 * Inscribed radius (centre-to-edge) of a convex cell from its vertices — the
 * largest circle that fits inside the hex. Measured from the geometry so it is
 * independent of hex orientation or size.
 */
export function cellInradius(center: WorldPoint, vertices: readonly WorldPoint[]): number {
  let min = Infinity;
  for (let i = 0; i < vertices.length; i++) {
    const a = vertices[i];
    const b = vertices[(i + 1) % vertices.length];
    if (!a || !b) continue;
    const mx = (a.x + b.x) / 2;
    const my = (a.y + b.y) / 2;
    min = Math.min(min, Math.hypot(mx - center.x, my - center.y));
  }
  return Number.isFinite(min) ? min : 0;
}
