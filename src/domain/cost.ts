import type { Km } from './units';
import type { RiskAppetite, RiskProfile, RiskType } from './risk';
import { RISK_TYPES } from './risk';
import { DEFAULT_APPETITE } from './risk';

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
