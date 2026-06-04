import type { Km } from './units';
import type { RiskAppetite, RiskProfile, RiskType } from './risk';
import { RISK_TYPES } from './risk';
import { DEFAULT_APPETITE } from './risk';
import { clamp01 } from './units';
import type { DayNightConfig } from './journey';
import { SPEED_MIN_KMH, SPEED_MAX_KMH, NIGHT_START, NIGHT_END } from './journey';

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

/**
 * Speed-dependent multiplier on a risk channel.
 * Faster travel: animals ×0.5, human ×0.5 at max speed (safer — harder to catch).
 * Faster travel: cold ×2.0 at max speed (wind chill / ice vulnerability).
 * Heat and water are unaffected.
 */
export function speedRiskModifier(riskType: RiskType, speedKmh: number): number {
  const t = (speedKmh - SPEED_MIN_KMH) / (SPEED_MAX_KMH - SPEED_MIN_KMH);
  switch (riskType) {
    case 'animals':
      return 1 - 0.5 * t;
    case 'human':
      return 1 - 0.5 * t;
    case 'cold':
      return 1 + 1.0 * t;
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
 * Animals ×0.5 at night; human ×1.5 at night; others unchanged.
 */
export function dayNightModifier(riskType: RiskType, timeMinutes: number): number {
  const isNight = timeMinutes >= NIGHT_START || timeMinutes < NIGHT_END;
  switch (riskType) {
    case 'animals':
      return isNight ? 0.5 : 1;
    case 'human':
      return isNight ? 1.5 : 1;
    default:
      return 1;
  }
}

/**
 * Apply day/night multipliers to a profile; returns a new object, clamped to [0, 1].
 * Returns the input profile unchanged when `config.enabled` is false.
 */
export function applyTemporalModifiers(
  profile: RiskProfile,
  timeMinutes: number,
  config: DayNightConfig,
): RiskProfile {
  if (!config.enabled) return profile;
  const out = {} as RiskProfile;
  for (const risk of RISK_TYPES) {
    out[risk] = clamp01(profile[risk] * dayNightModifier(risk, timeMinutes));
  }
  return out;
}
