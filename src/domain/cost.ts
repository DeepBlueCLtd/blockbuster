import type { Km } from './units';
import type { RiskAppetite, RiskProfile, RiskType } from './risk';
import { RISK_TYPES } from './risk';
import { DEFAULT_APPETITE } from './risk';
import { clamp01 } from './units';
import type { DayNightConfig } from './journey';
import {
  SPEED_MIN_KMH,
  SPEED_MAX_KMH,
  NIGHT_START,
  NIGHT_END,
  DEEP_SLEEP_START,
  DEEP_SLEEP_END,
} from './journey';

/**
 * Parameters of the traversal cost function. This is shared kernel on purpose:
 * the routing engine and the COA charts must compute identical per-risk costs,
 * so the formula lives here and nowhere else.
 */
export interface CostParams {
  /** Per-risk tolerance from the sliders. */
  appetite: RiskAppetite;
  /** Cost added per kilometre travelled (keeps routes from wandering). */
  distanceWeightKm: number;
  /** Global multiplier on the risk term. */
  riskWeight: number;
}

export const DEFAULT_COST_PARAMS: CostParams = {
  appetite: DEFAULT_APPETITE,
  distanceWeightKm: 1,
  riskWeight: 10,
};

/**
 * How strongly a given appetite penalises a risk. Appetite 0 ⇒ full sensitivity
 * (1); appetite 1 ⇒ no sensitivity (0). Linear for v1; the curve is intentionally
 * isolated here so it can be retuned without touching callers.
 */
export function sensitivity(appetite: number): number {
  return 1 - appetite;
}

/**
 * Per-risk cost contribution for occupying a cell with the given risk profile.
 * Returned per channel so the stacked bar charts can render the breakdown.
 */
export function riskCostBreakdown(
  profile: RiskProfile,
  params: CostParams,
): Record<RiskType, number> {
  const out = {} as Record<RiskType, number>;
  for (const risk of RISK_TYPES) {
    out[risk] = profile[risk] * sensitivity(params.appetite[risk]) * params.riskWeight;
  }
  return out;
}

/** Total risk cost of occupying a cell (sum of the per-risk breakdown). */
export function cellRiskCost(profile: RiskProfile, params: CostParams): number {
  let total = 0;
  for (const risk of RISK_TYPES) {
    total += profile[risk] * sensitivity(params.appetite[risk]);
  }
  return total * params.riskWeight;
}

/** Cost of moving `distanceKm` between two cell centres. */
export function movementCost(distanceKm: Km, params: CostParams): number {
  return distanceKm * params.distanceWeightKm;
}

// Exposure curve m(v) = a/v + b for the animal/human channels: convex and
// decreasing, with m(SPEED_MIN)=1 and m(SPEED_MAX)=0.5 (halved at top speed).
// Derived from the speed bounds so it retunes automatically if they change.
const EXPOSURE_A = (0.5 * SPEED_MIN_KMH * SPEED_MAX_KMH) / (SPEED_MAX_KMH - SPEED_MIN_KMH);
const EXPOSURE_B = 1 - EXPOSURE_A / SPEED_MIN_KMH;

/**
 * Speed-dependent multiplier on a risk channel.
 *
 * Animal and human (bandit) risk are *time-in-cell exposure* risks — the longer
 * you dwell, the more exposed you are — so their multiplier follows a convex
 * `~1/speed` curve: full strength at SPEED_MIN, halved at SPEED_MAX (faster is
 * safer: less time exposed / harder to catch). Cold/wind-chill *grows* with speed,
 * so it rises linearly (×2.0 at SPEED_MAX). Heat and water are unaffected.
 *
 * The convex exposure term competing with the rising cold term is what gives a
 * cell's cost an *interior* minimum in (SPEED_MIN, SPEED_MAX). With purely linear
 * modifiers the per-cell cost is linear in speed and its minimum is always an
 * endpoint, so dynamic mode could only ever pick the slowest or fastest speed.
 * See docs/spec/05-engine-risk.md.
 */
export function speedRiskModifier(riskType: RiskType, speedKmh: number): number {
  switch (riskType) {
    case 'animals':
    case 'human':
      return EXPOSURE_A / speedKmh + EXPOSURE_B;
    case 'cold': {
      const t = (speedKmh - SPEED_MIN_KMH) / (SPEED_MAX_KMH - SPEED_MIN_KMH);
      return 1 + 1.0 * t;
    }
    default:
      return 1;
  }
}

/** Apply speed modifiers to a profile; returns a new object, clamped to [0, 1]. */
export function speedModifiedProfile(profile: RiskProfile, speedKmh: number): RiskProfile {
  const out = {} as RiskProfile;
  for (const risk of RISK_TYPES) {
    out[risk] = clamp01(profile[risk] * speedRiskModifier(risk, speedKmh));
  }
  return out;
}

/**
 * Day/night multiplier on a risk channel.
 * Night window = NIGHT_START (20:00) through NIGHT_END (06:00), wrapping midnight.
 * Animals ×0.5 at night. Human ×1.5 at night — but in **towns** it instead drops
 * to ×0.5 during the deepest-sleep window (01:00–05:00) when people are asleep;
 * away from towns the (bandit) human risk is unchanged through the night. Others
 * unchanged. `isTown` is the cell's town-ness (biome === 'town').
 */
export function dayNightModifier(riskType: RiskType, timeMinutes: number, isTown = false): number {
  const isNight = timeMinutes >= NIGHT_START || timeMinutes < NIGHT_END;
  switch (riskType) {
    case 'animals':
      return isNight ? 0.5 : 1;
    case 'human': {
      const isDeepSleep =
        isTown && timeMinutes >= DEEP_SLEEP_START && timeMinutes < DEEP_SLEEP_END;
      if (isDeepSleep) return 0.5;
      return isNight ? 1.5 : 1;
    }
    default:
      return 1;
  }
}

/**
 * Apply day/night multipliers to a profile; returns a new object, clamped to [0, 1].
 * Returns the input profile unchanged when `config.enabled` is false. `isTown`
 * gates the town-only deep-sleep human dip (see {@link dayNightModifier}).
 */
export function applyTemporalModifiers(
  profile: RiskProfile,
  timeMinutes: number,
  config: DayNightConfig,
  isTown = false,
): RiskProfile {
  if (!config.enabled) return profile;
  const out = {} as RiskProfile;
  for (const risk of RISK_TYPES) {
    out[risk] = clamp01(profile[risk] * dayNightModifier(risk, timeMinutes, isTown));
  }
  return out;
}
