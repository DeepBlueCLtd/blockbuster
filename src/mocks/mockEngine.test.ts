import { describe, expect, it } from 'vitest';
import type { CellId, WorldPoint } from '@domain';
import { worldDistance } from '@domain';
import { planRoutesSync } from './mockEngine';
import { fixtureGrid, fixtureRequest, fixtureWaypoints } from './fixtures';

/** Id of the fixture cell whose centre is nearest `target`. */
function cellNear(target: WorldPoint): CellId {
  let best = fixtureGrid.cells[0]!;
  let bestDist = Infinity;
  for (const cell of fixtureGrid.cells) {
    const d = worldDistance(cell.center, target);
    if (d < bestDist) {
      bestDist = d;
      best = cell;
    }
  }
  return best.id;
}

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

  it('visits waypoints in the given sequence, not a reordered one', () => {
    // C sits much closer to A than B does, so a nearest-neighbour reorder would
    // visit A → C → B. The planner must instead honour the requested order A → B → C.
    const a = cellNear({ x: 5, y: 5 });
    const b = cellNear({ x: 45, y: 25 });
    const c = cellNear({ x: 5, y: 25 });
    expect(new Set([a, b, c]).size).toBe(3);

    const seqPlan = planRoutesSync({ ...fixtureRequest, waypoints: [a, b, c] });
    expect(seqPlan.coas.length).toBeGreaterThanOrEqual(1);
    for (const coa of seqPlan.coas) {
      expect(coa.path[0]).toBe(a);
      expect(coa.path[coa.path.length - 1]).toBe(c);
      const ia = coa.path.indexOf(a);
      const ib = coa.path.indexOf(b);
      const ic = coa.path.indexOf(c);
      expect(ia).toBeGreaterThanOrEqual(0);
      expect(ib).toBeGreaterThan(ia);
      expect(ic).toBeGreaterThan(ib);
    }
  });
});
