import { describe, expect, it } from 'vitest';
import type { CellId, CostParams, HexGridDto, RiskProfile, RouteRequest } from '@domain';
import { DEFAULT_COST_PARAMS, riskCostBreakdown, RISK_TYPES, toCellId } from '@domain';
import { planRoutes } from './planner.core';
import { createRoutePlanner } from './index';
import { fixtureRequest, fixtureWaypoints } from '@/mocks/fixtures';

const SQRT3 = Math.sqrt(3);

/**
 * A controlled `cols × rows` axial patch with a high-`thief` band across the
 * middle row (leaving the top and bottom rows clear for a detour). Centres use
 * pointy-top geometry so movement costs are sane.
 */
function bandScenario(cols: number, rows: number) {
  const cells: HexGridDto['cells'] = [];
  const risk: Record<CellId, RiskProfile> = {};
  for (let r = 0; r < rows; r++) {
    for (let q = 0; q < cols; q++) {
      const id = toCellId({ q, r });
      cells.push({ id, q, r, center: { x: SQRT3 * (q + r / 2), y: 1.5 * r } });
      const inBand = r === Math.floor(rows / 2) && q >= 2 && q <= cols - 3;
      risk[id] = { animals: 0, cold: 0, heat: 0, water: 0, thief: inBand ? 1 : 0 };
    }
  }
  const grid: HexGridDto = {
    layout: { orientation: 'pointy', size: 1, origin: { x: 0, y: 0 } },
    extent: { width: SQRT3 * cols, height: 1.5 * rows },
    cells,
  };
  const mid = Math.floor(rows / 2);
  return {
    grid,
    risk,
    start: toCellId({ q: 0, r: mid }),
    end: toCellId({ q: cols - 1, r: mid }),
  };
}

/** Raw (level, not cost) exposure to one risk channel summed along a path. */
function rawExposure(
  path: readonly CellId[],
  risk: Record<CellId, RiskProfile>,
  channel: (typeof RISK_TYPES)[number],
): number {
  return path.reduce((sum, id) => sum + (risk[id]?.[channel] ?? 0), 0);
}

describe('routing core (spec)', () => {
  const plan = planRoutes(fixtureRequest);

  it('returns exactly coaCount COAs when the grid allows it', () => {
    expect(plan.coas).toHaveLength(fixtureRequest.coaCount);
  });

  it('every COA starts at the first waypoint and ends at the last', () => {
    const start = fixtureWaypoints[0];
    const end = fixtureWaypoints[fixtureWaypoints.length - 1];
    for (const coa of plan.coas) {
      expect(coa.path[0]).toBe(start);
      expect(coa.path[coa.path.length - 1]).toBe(end);
    }
  });

  it('every COA visits all waypoints in the order given (no reordering)', () => {
    // Insert a stop between the two defaults so the legs are non-trivial.
    const wps = [fixtureWaypoints[0]!, pickMiddleWaypoint(), fixtureWaypoints[1]!];
    const seqPlan = planRoutes({ ...fixtureRequest, waypoints: wps });
    for (const coa of seqPlan.coas) {
      const indices = wps.map((w) => coa.path.indexOf(w));
      expect(indices.every((i) => i >= 0)).toBe(true);
      expect(indices).toEqual([...indices].sort((x, y) => x - y));
      expect(coa.path[0]).toBe(wps[0]);
      expect(coa.path[coa.path.length - 1]).toBe(wps[2]);
    }
  });

  it('COAs are pairwise distinct paths', () => {
    const signatures = plan.coas.map((c) => c.path.join('>'));
    expect(new Set(signatures).size).toBe(signatures.length);
  });

  it('steps align 1:1 with path and sum to totalCost', () => {
    for (const coa of plan.coas) {
      expect(coa.steps).toHaveLength(coa.path.length);
      const summed = coa.steps.reduce((s, step) => s + step.stepCost, 0);
      expect(summed).toBeCloseTo(coa.totalCost, 6);
      coa.steps.forEach((step, i) => expect(step.cellId).toBe(coa.path[i]));
    }
  });

  it('per-risk costs match @domain/cost.riskCostBreakdown for the params', () => {
    const params = fixtureRequest.params;
    for (const coa of plan.coas) {
      for (const step of coa.steps) {
        const expected = riskCostBreakdown(fixtureRequest.risk[step.cellId]!, params);
        for (const r of RISK_TYPES) expect(step.perRisk[r]).toBeCloseTo(expected[r], 9);
        const riskSum = RISK_TYPES.reduce((s, r) => s + step.perRisk[r], 0);
        expect(step.stepCost).toBeCloseTo(step.movementCost + riskSum, 9);
      }
    }
  });

  it('lowering appetite for a risk steers routes away from that risk', () => {
    const { grid, risk, start, end } = bandScenario(9, 3);
    const base: RouteRequest = { grid, risk, params: DEFAULT_COST_PARAMS, waypoints: [start, end], coaCount: 1 };

    const tolerant = appetiteFor(DEFAULT_COST_PARAMS, 1); // ignore thief
    const intolerant = appetiteFor(DEFAULT_COST_PARAMS, 0); // avoid thief

    const tolerantPath = planRoutes({ ...base, params: tolerant }).coas[0]!.path;
    const intolerantPath = planRoutes({ ...base, params: intolerant }).coas[0]!.path;

    expect(rawExposure(intolerantPath, risk, 'thief')).toBeLessThan(
      rawExposure(tolerantPath, risk, 'thief'),
    );
  });

  it('is deterministic for identical requests', () => {
    const again = planRoutes(fixtureRequest);
    expect(again.coas.map((c) => c.path.join('>'))).toEqual(plan.coas.map((c) => c.path.join('>')));
  });
});

describe('routing core (impassable terrain)', () => {
  it('routes around impassable cells while still returning COAs', () => {
    const baseline = planRoutes(fixtureRequest);
    const best = baseline.coas[0]!.path;
    // Block an interior cell of the best route (not a waypoint).
    const blockable = best.slice(1, -1);
    const blocked = blockable[Math.floor(blockable.length / 2)]!;
    const plan = planRoutes({ ...fixtureRequest, impassable: [blocked] });
    expect(plan.coas.length).toBeGreaterThanOrEqual(1);
    for (const coa of plan.coas) expect(coa.path).not.toContain(blocked);
  });

  it('keeps waypoints reachable even when they sit on impassable terrain', () => {
    const start = fixtureWaypoints[0]!;
    const plan = planRoutes({ ...fixtureRequest, impassable: [start] });
    expect(plan.coas.length).toBeGreaterThanOrEqual(1);
    for (const coa of plan.coas) expect(coa.path[0]).toBe(start);
  });
});

describe('routing planner wrapper', () => {
  it('synchronous planner matches the core', async () => {
    const planner = createRoutePlanner({ useWorker: false });
    const viaPlanner = await planner.plan(fixtureRequest);
    const direct = planRoutes(fixtureRequest);
    expect(viaPlanner.coas.map((c) => c.path.join('>'))).toEqual(
      direct.coas.map((c) => c.path.join('>')),
    );
  });
});

/** A fixture cell roughly between the two default waypoints, for a 3-stop test. */
function pickMiddleWaypoint(): CellId {
  // The fixture grid centre is around (25, 15); grab a cell id near there.
  const dto = fixtureRequest.grid;
  let best = dto.cells[0]!;
  let bestDist = Infinity;
  for (const c of dto.cells) {
    const d = Math.hypot(c.center.x - 25, c.center.y - 8);
    if (d < bestDist) {
      bestDist = d;
      best = c;
    }
  }
  return best.id;
}

describe('routing core (optimise order)', () => {
  it('keeps the first waypoint fixed and reorders the rest to minimise cost', () => {
    // Create a linear grid: 0,0 -> 4,0 where a "zig-zag" ordering is suboptimal.
    const cols = 7;
    const cells: HexGridDto['cells'] = [];
    const risk: Record<CellId, RiskProfile> = {};
    for (let q = 0; q < cols; q++) {
      const id = toCellId({ q, r: 0 });
      cells.push({ id, q, r: 0, center: { x: SQRT3 * q, y: 0 } });
      risk[id] = { animals: 0, cold: 0, heat: 0, water: 0, thief: 0 };
    }
    const grid: HexGridDto = {
      layout: { orientation: 'pointy', size: 1, origin: { x: 0, y: 0 } },
      extent: { width: SQRT3 * cols, height: 3 },
      cells,
    };
    // Waypoints in a bad order: 0 -> 4 -> 2 -> 6 (zig-zag)
    const wp0 = toCellId({ q: 0, r: 0 });
    const wp2 = toCellId({ q: 2, r: 0 });
    const wp4 = toCellId({ q: 4, r: 0 });
    const wp6 = toCellId({ q: 6, r: 0 });
    const zigzag: CellId[] = [wp0, wp4, wp2, wp6];

    const ordered = planRoutes({
      grid,
      risk,
      params: DEFAULT_COST_PARAMS,
      waypoints: zigzag,
      coaCount: 1,
      optimiseOrder: false,
    });
    const optimised = planRoutes({
      grid,
      risk,
      params: DEFAULT_COST_PARAMS,
      waypoints: zigzag,
      coaCount: 1,
      optimiseOrder: true,
    });

    // The optimised route should cost less or equal (fewer redundant steps).
    expect(optimised.coas[0]!.totalCost).toBeLessThanOrEqual(ordered.coas[0]!.totalCost);
    // The first waypoint must still be the start.
    expect(optimised.coas[0]!.path[0]).toBe(wp0);
    // The optimised plan echoes the original waypoints unchanged.
    expect(optimised.waypoints).toEqual(zigzag);
  });

  it('with 2 or fewer waypoints optimiseOrder has no effect', () => {
    const a = planRoutes({ ...fixtureRequest, optimiseOrder: false });
    const b = planRoutes({ ...fixtureRequest, optimiseOrder: true });
    expect(a.coas.map((c) => c.path.join('>'))).toEqual(b.coas.map((c) => c.path.join('>')));
  });
});

function appetiteFor(params: CostParams, thiefAppetite: number): CostParams {
  return { ...params, appetite: { ...params.appetite, thief: thiefAppetite } };
}
