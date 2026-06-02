import { describe, expect, it } from 'vitest';
import { planRoutesSync } from './mockEngine';
import { fixtureRequest, fixtureWaypoints } from './fixtures';

describe('mock route planner', () => {
  const plan = planRoutesSync(fixtureRequest);

  it('returns between one and coaCount COAs', () => {
    expect(plan.coas.length).toBeGreaterThanOrEqual(1);
    expect(plan.coas.length).toBeLessThanOrEqual(fixtureRequest.coaCount);
  });

  it('routes start and end at the requested waypoints', () => {
    const start = fixtureWaypoints[0];
    const end = fixtureWaypoints[fixtureWaypoints.length - 1];
    for (const coa of plan.coas) {
      expect(coa.path[0]).toBe(start);
      expect(coa.path[coa.path.length - 1]).toBe(end);
    }
  });

  it('emits one step per cell on the path', () => {
    for (const coa of plan.coas) {
      expect(coa.steps).toHaveLength(coa.path.length);
    }
  });

  it('is deterministic for identical requests', () => {
    const again = planRoutesSync(fixtureRequest);
    const paths = (p: typeof plan) => p.coas.map((c) => c.path.join('>'));
    expect(paths(again)).toEqual(paths(plan));
  });
});
