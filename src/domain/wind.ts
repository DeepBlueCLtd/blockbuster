import type { WorldExtent, WorldPoint } from './world';
import type { RiskProfile, RiskType } from './risk';
import { RISK_TYPES } from './risk';
import { clamp, clamp01 } from './units';

/**
 * TEMPORAL WEATHER — a cyclone (rotating wind field) that passes through the
 * world over a time window.
 *
 * Unlike an extra-risk {@link RiskZone} — a static, per-cell scalar offset on one
 * channel — the cyclone's effect is **directional**: it depends on how the
 * group's heading relates to the local wind. So this module exposes two halves:
 *
 *  1. {@link windAt}` (cyclone, location, time)` → the wind **vector** there/then
 *     (direction + strength). The cyclone spins **anticlockwise**, so the wind at
 *     a point is tangent to the circle around the eye, rotated +90° from the
 *     outward radius.
 *  2. {@link windEffect}` (travelDir, wind)` → the per-risk multipliers and the
 *     speed factor for travelling `travelDir` through that wind. This is where
 *     the brief's rules live (head/tail/cross wind, exponential build-up).
 *
 * Pure and deterministic — no DOM, no RNG. The routing engine samples it per A*
 * step (it has the edge direction); the map's wind overlay samples {@link windAt}
 * to draw the field. Everything imports it through `@domain`.
 */

/**
 * A cyclone: a rotating wind field whose eye travels in a straight line from
 * `from` to `to` across its active `[startTime, endTime]` window (minutes from
 * midnight; the window does not wrap midnight). Wind strength follows a radial
 * profile — a calm eye, rising to a peak at the eyewall, then decaying to zero by
 * the outer radius — scaled by `strength`.
 */
export interface Cyclone {
  id: string;
  name: string;
  /** Eye position (world km) at `startTime`. */
  from: WorldPoint;
  /** Eye position (world km) at `endTime`. */
  to: WorldPoint;
  /** Active-window start, minutes from midnight. */
  startTime: number;
  /** Active-window end, minutes from midnight. */
  endTime: number;
  /** Calm-eye radius (km): wind is ~0 inside this. */
  eyeRadiusKm: number;
  /** Eyewall radius (km): wind peaks here. */
  maxWindRadiusKm: number;
  /** Outer radius (km): wind has decayed to ~0 by here. */
  outerRadiusKm: number;
  /** Peak wind strength scalar in [0, 1] (scales the whole field). */
  strength: number;
  /** Whether the cyclone contributes to risk/speed. */
  enabled: boolean;
}

/** A sampled wind: the unit direction the air blows **toward**, plus a [0,1] strength. */
export interface WindVector {
  /** Unit vector in the world frame (x east, y north) — where the wind blows to. */
  dir: WorldPoint;
  /** Wind strength at the sample point, in [0, 1]. */
  strength: number;
}

/**
 * The consequence of travelling a heading through a wind: a speed factor and a
 * per-risk multiplier. Identity (no wind / crosswind) is `speedFactor === 1` and
 * every multiplier `=== 1` — see {@link IDENTITY_WIND_EFFECT}.
 */
export interface WindEffect {
  /** Multiplier on travel speed: <1 into the wind, >1 with it, 1 across it. */
  speedFactor: number;
  /** Per-channel multiplier on the risk profile (1 = unchanged). */
  riskMultipliers: Record<RiskType, number>;
}

// --- Tunable constants -------------------------------------------------------

/**
 * Sharpness of the exponential build-up from crosswind (no effect) to a pure
 * head/tail wind (peak effect). The effect scales with `expRamp(|alignment|)`,
 * so a larger value back-loads the impact toward dead head-/tail-on.
 */
export const WIND_ALIGN_EXPONENT = 3;

/** Peak ± swing of the speed factor at full head/tail wind (before clamping). */
export const WIND_SPEED_SWING = 0.5;
/** Speed factor floor/ceil so a fierce headwind never stalls the group entirely. */
export const WIND_SPEED_FACTOR_MIN = 0.2;
export const WIND_SPEED_FACTOR_MAX = 2;

/**
 * Peak swing applied to every **non-cold** channel: headwind raises them, tailwind
 * lowers them by up to this fraction (× wind strength).
 */
export const WIND_RISK_SWING = 0.6;
/** Extra cold gain into the wind — cold rises *particularly* on a headwind. */
export const WIND_COLD_HEAD_GAIN = 1;
/** Slight cold gain with the wind — cold still nudges up even on a tailwind. */
export const WIND_COLD_TAIL_GAIN = 0.15;

/** Shared identity effect (reference-comparable so callers can skip a no-op apply). */
export const IDENTITY_WIND_EFFECT: WindEffect = {
  speedFactor: 1,
  riskMultipliers: { animals: 1, cold: 1, heat: 1, water: 1, human: 1 },
};

// --- Field sampling ----------------------------------------------------------

function smoothstep01(x: number): number {
  const t = clamp01(x);
  return t * t * (3 - 2 * t);
}

/** Radial wind-strength profile in [0,1]: calm eye → eyewall peak → outer decay. */
function radialStrength(cyclone: Cyclone, distanceKm: number): number {
  const { eyeRadiusKm, maxWindRadiusKm, outerRadiusKm } = cyclone;
  if (distanceKm <= eyeRadiusKm) return 0;
  if (distanceKm <= maxWindRadiusKm) {
    return smoothstep01((distanceKm - eyeRadiusKm) / Math.max(1e-6, maxWindRadiusKm - eyeRadiusKm));
  }
  if (distanceKm < outerRadiusKm) {
    return smoothstep01(
      (outerRadiusKm - distanceKm) / Math.max(1e-6, outerRadiusKm - maxWindRadiusKm),
    );
  }
  return 0;
}

/** Whether the cyclone is enabled and within its (non-wrapping) active window. */
export function isCycloneActiveAt(cyclone: Cyclone, timeMinutes: number): boolean {
  return cyclone.enabled && timeMinutes >= cyclone.startTime && timeMinutes <= cyclone.endTime;
}

/** The eye position at `timeMinutes`, or null when the cyclone is inactive then. */
export function cycloneEyeAt(cyclone: Cyclone, timeMinutes: number): WorldPoint | null {
  if (!isCycloneActiveAt(cyclone, timeMinutes)) return null;
  const span = cyclone.endTime - cyclone.startTime;
  const f = span > 0 ? clamp01((timeMinutes - cyclone.startTime) / span) : 0;
  return {
    x: cyclone.from.x + (cyclone.to.x - cyclone.from.x) * f,
    y: cyclone.from.y + (cyclone.to.y - cyclone.from.y) * f,
  };
}

/**
 * The wind vector at `point` and `timeMinutes`, or null when there is no wind
 * there (cyclone inactive, in the calm eye, or beyond the outer radius). The
 * direction is the anticlockwise tangent: a +90° rotation of the outward radius,
 * so circulation runs east→north→west→south around the eye.
 */
export function windAt(
  cyclone: Cyclone,
  point: WorldPoint,
  timeMinutes: number,
): WindVector | null {
  const eye = cycloneEyeAt(cyclone, timeMinutes);
  if (!eye) return null;
  const rx = point.x - eye.x;
  const ry = point.y - eye.y;
  const d = Math.hypot(rx, ry);
  if (d <= 1e-9) return null; // exact centre: direction undefined, strength ~0 anyway
  const strength = clamp01(radialStrength(cyclone, d) * cyclone.strength);
  if (strength <= 0) return null;
  // Anticlockwise: rotate the outward radius (rx, ry) by +90° → (-ry, rx).
  return { dir: { x: -ry / d, y: rx / d }, strength };
}

// --- Directional effect ------------------------------------------------------

/** Exponential build-up curve on [0,1] → [0,1]; convex, so mid-angles stay gentle. */
function expRamp(x: number): number {
  const k = WIND_ALIGN_EXPONENT;
  return (Math.exp(k * x) - 1) / (Math.exp(k) - 1);
}

/**
 * The speed factor and per-risk multipliers for travelling `travelDir` (need not
 * be unit length) through `wind`:
 *
 *  - **Headwind** (heading into the wind): speed drops; every risk rises, cold
 *    most of all.
 *  - **Tailwind** (wind behind): speed rises; every risk falls, *except* cold,
 *    which nudges slightly up.
 *  - **Crosswind** (90°): no impact.
 *  - In between, the impact builds up **exponentially** toward the head/tail peak.
 *
 * Returns {@link IDENTITY_WIND_EFFECT} when there is no usable wind or heading.
 */
export function windEffect(travelDir: WorldPoint | null, wind: WindVector | null): WindEffect {
  if (!travelDir || !wind || wind.strength <= 0) return IDENTITY_WIND_EFFECT;
  const tLen = Math.hypot(travelDir.x, travelDir.y);
  if (tLen <= 1e-9) return IDENTITY_WIND_EFFECT;

  // alignment a ∈ [-1, 1]: +1 dead tailwind, 0 crosswind, -1 dead headwind.
  const a = (travelDir.x * wind.dir.x + travelDir.y * wind.dir.y) / tLen;
  // Signed, exponentially-ramped intensity, scaled by how strong the wind is.
  const intensity = Math.sign(a) * expRamp(Math.abs(a)) * wind.strength; // ∈ [-strength, strength]
  if (intensity === 0) return IDENTITY_WIND_EFFECT;

  const speedFactor = clamp(
    1 + WIND_SPEED_SWING * intensity,
    WIND_SPEED_FACTOR_MIN,
    WIND_SPEED_FACTOR_MAX,
  );
  const head = Math.max(0, -intensity); // headwind share (>0 only into the wind)
  const tail = Math.max(0, intensity); //  tailwind share (>0 only with the wind)
  // Non-cold channels: rise into the wind, fall with it, flat across it.
  const other = 1 - WIND_RISK_SWING * intensity;
  // Cold rises on both sides — a lot into the wind, a little with it.
  const cold = 1 + WIND_COLD_HEAD_GAIN * head + WIND_COLD_TAIL_GAIN * tail;

  const riskMultipliers = {} as Record<RiskType, number>;
  for (const risk of RISK_TYPES) riskMultipliers[risk] = risk === 'cold' ? cold : other;
  return { speedFactor, riskMultipliers };
}

/** Apply a wind effect's risk multipliers to a profile, clamping back into [0,1]. */
export function applyWindRisk(profile: RiskProfile, effect: WindEffect): RiskProfile {
  if (effect === IDENTITY_WIND_EFFECT) return profile;
  const out = {} as RiskProfile;
  for (const risk of RISK_TYPES) out[risk] = clamp01(profile[risk] * effect.riskMultipliers[risk]);
  return out;
}

// --- Default world cyclone ---------------------------------------------------

/** Overrides for {@link createDefaultCyclone}. */
export interface DefaultCycloneOptions {
  id?: string;
  name?: string;
  /** Active-window start (minutes from midnight). Defaults to 08:00. */
  startTime?: number;
  /** Active-window end (minutes from midnight). Defaults to 16:00. */
  endTime?: number;
  /** Peak strength in [0,1]. Defaults to 1. */
  strength?: number;
  /** Whether the cyclone starts switched on. Defaults to true. */
  enabled?: boolean;
}

/**
 * Build the default cyclone every generated world carries: an eye that crosses
 * the map east→west (drifting gently north→south) across its active window, sized
 * so the field covers a good slice of the world as it passes. Shared by world
 * generation so the seeded default stays deterministic.
 */
export function createDefaultCyclone(
  extent: WorldExtent,
  opts: DefaultCycloneOptions = {},
): Cyclone {
  const {
    id = 'default-cyclone',
    name = 'Cyclone',
    startTime = 8 * 60,
    endTime = 16 * 60,
    strength = 1,
    enabled = true,
  } = opts;
  const minSpan = Math.min(extent.width, extent.height);
  return {
    id,
    name,
    // Enter from off-map east, exit off-map west, so it visibly sweeps through.
    from: { x: extent.width * 1.15, y: extent.height * 0.35 },
    to: { x: -extent.width * 0.15, y: extent.height * 0.65 },
    startTime,
    endTime,
    eyeRadiusKm: minSpan * 0.08,
    maxWindRadiusKm: minSpan * 0.28,
    outerRadiusKm: minSpan * 0.75,
    strength,
    enabled,
  };
}
