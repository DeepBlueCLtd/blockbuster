import { describe, expect, it } from 'vitest';
import {
  cellRiskCost,
  effectiveProfile,
  parseCellId,
  riskCostBreakdown,
  toCellId,
  uniformProfile,
  worldDistance,
  type CellRiskState,
  type CostParams,
} from './index';

describe('hex cell ids', () => {
  it('round-trips through toCellId/parseCellId', () => {
    const coord = { q: -3, r: 7 };
    expect(parseCellId(toCellId(coord))).toEqual(coord);
  });
});

describe('effectiveProfile', () => {
  const base: CellRiskState = {
    cellId: toCellId({ q: 0, r: 0 }),
    base: uniformProfile(0.2),
    overrides: { heat: 0.9 },
  };

  it('applies overrides over base levels', () => {
    expect(effectiveProfile(base).heat).toBe(0.9);
    expect(effectiveProfile(base).cold).toBe(0.2);
  });

  it('clamps overrides into [0, 1]', () => {
    const wild: CellRiskState = { ...base, overrides: { heat: 5 } };
    expect(effectiveProfile(wild).heat).toBe(1);
  });
});

describe('cost function', () => {
  const params: CostParams = {
    appetite: uniformProfile(0.5),
    distanceWeightKm: 1,
    riskWeight: 10,
  };

  it('zero appetite means full sensitivity; full appetite means none', () => {
    const profile = uniformProfile(1);
    const intolerant = riskCostBreakdown(profile, { ...params, appetite: uniformProfile(0) });
    const tolerant = riskCostBreakdown(profile, { ...params, appetite: uniformProfile(1) });
    expect(intolerant.heat).toBeCloseTo(10);
    expect(tolerant.heat).toBeCloseTo(0);
  });

  it('is monotonic in risk level', () => {
    const low = cellRiskCost(uniformProfile(0.2), params);
    const high = cellRiskCost(uniformProfile(0.8), params);
    expect(high).toBeGreaterThan(low);
  });
});

describe('worldDistance', () => {
  it('is Euclidean', () => {
    expect(worldDistance({ x: 0, y: 0 }, { x: 3, y: 4 })).toBe(5);
  });
});
