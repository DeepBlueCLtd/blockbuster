import { describe, expect, it } from 'vitest';
import type { CostParams } from './cost';
import type { RiskProfile } from './risk';
import { SPEED_MAX_KMH, SPEED_MIN_KMH } from './journey';
import { cellRiskCost, speedModifiedProfile, speedRiskModifier } from './cost';

const ZERO: RiskProfile = { animals: 0, cold: 0, heat: 0, water: 0, human: 0 };

/** Full risk sensitivity (appetite 0 everywhere) so per-channel weights are equal. */
const FULL_SENS: CostParams = {
  appetite: { animals: 0, cold: 0, heat: 0, water: 0, human: 0 },
  distanceWeightKm: 1,
  riskWeight: 10,
};

/** Speed (km/h) minimising the per-cell risk cost across a fine sweep of the range. */
function cheapestSpeed(profile: RiskProfile, params: CostParams = FULL_SENS): number {
  let best = SPEED_MIN_KMH;
  let bestCost = Infinity;
  for (let v = SPEED_MIN_KMH; v <= SPEED_MAX_KMH; v += 0.25) {
    const cost = cellRiskCost(speedModifiedProfile(profile, v), params);
    if (cost < bestCost) {
      bestCost = cost;
      best = v;
    }
  }
  return best;
}

describe('speedRiskModifier', () => {
  it('exposure channels (animals, human) are full at SPEED_MIN, halved at SPEED_MAX', () => {
    for (const r of ['animals', 'human'] as const) {
      expect(speedRiskModifier(r, SPEED_MIN_KMH)).toBeCloseTo(1, 9);
      expect(speedRiskModifier(r, SPEED_MAX_KMH)).toBeCloseTo(0.5, 9);
    }
  });

  it('cold rises with speed (×1 at SPEED_MIN, ×2 at SPEED_MAX)', () => {
    expect(speedRiskModifier('cold', SPEED_MIN_KMH)).toBeCloseTo(1, 9);
    expect(speedRiskModifier('cold', SPEED_MAX_KMH)).toBeCloseTo(2, 9);
  });

  it('heat and water are speed-independent', () => {
    const mid = (SPEED_MIN_KMH + SPEED_MAX_KMH) / 2;
    expect(speedRiskModifier('heat', mid)).toBe(1);
    expect(speedRiskModifier('water', mid)).toBe(1);
  });

  it('the exposure curve is convex: the marginal benefit of speed fades', () => {
    const dropLow = speedRiskModifier('animals', 5) - speedRiskModifier('animals', 10);
    const dropHigh = speedRiskModifier('animals', 25) - speedRiskModifier('animals', 30);
    expect(dropLow).toBeGreaterThan(0);
    expect(dropHigh).toBeGreaterThan(0);
    expect(dropLow).toBeGreaterThan(dropHigh);
  });
});

describe('per-cell cost vs. speed', () => {
  it('competing exposure + cold risk has an interior cost minimum', () => {
    const v = cheapestSpeed({ ...ZERO, human: 0.3, cold: 0.3 });
    expect(v).toBeGreaterThan(SPEED_MIN_KMH);
    expect(v).toBeLessThan(SPEED_MAX_KMH);
  });

  it('cold-only risk is cheapest at the slowest speed', () => {
    expect(cheapestSpeed({ ...ZERO, cold: 0.5 })).toBe(SPEED_MIN_KMH);
  });

  it('exposure-only risk is cheapest at the fastest speed', () => {
    expect(cheapestSpeed({ ...ZERO, human: 0.5 })).toBe(SPEED_MAX_KMH);
  });
});
