import { describe, expect, it } from 'vitest';
import type { CellId, CostParams, HexGridDto, RiskProfile, RouteRequest } from '@domain';
import {
  DEFAULT_COST_PARAMS,
  DEFAULT_JOURNEY_PARAMS,
  riskCostBreakdown,
  RISK_TYPES,
  speedModifiedProfile,
  toCellId,
} from '@domain';
import { planRoutes } from './planner.core';
import { createRoutePlanner } from './index';
import { fixtureRequest, fixtureWaypoints } from '@/mocks/fixtures';

const SQRT3 = Math.sqrt(3);

/**
 * A controlled `cols × rows` axial patch with a high-`human` band across the
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
      risk[id] = { animals: 0, cold: 0, heat: 0, water: 0, human: inBand ? 1 : 0 };
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
    const speedKmh = (fixtureRequest.journeyParams ?? DEFAULT_JOURNEY_PARAMS).fixedSpeedKmh;
    for (const coa of plan.coas) {
      for (const step of coa.steps) {
        // The planner applies speed modifiers before costing — match that here.
        const modifiedProfile = speedModifiedProfile(fixtureRequest.risk[step.cellId]!, speedKmh);
        const expected = riskCostBreakdown(modifiedProfile, params);
        for (const r of RISK_TYPES) expect(step.perRisk[r]).toBeCloseTo(expected[r], 9);
        const riskSum = RISK_TYPES.reduce((s, r) => s + step.perRisk[r], 0);
        expect(step.stepCost).toBeCloseTo(step.movementCost + riskSum, 9);
      }
    }
  });

  it('lowering appetite for a risk steers routes away from that risk', () => {
    const { grid, risk, start, end } = bandScenario(9, 3);
    const base: RouteRequest = {
      grid,
      risk,
      params: DEFAULT_COST_PARAMS,
      waypoints: [start, end],
      coaCount: 1,
    };

    const tolerant = appetiteFor(DEFAULT_COST_PARAMS, 1); // ignore human
    const intolerant = appetiteFor(DEFAULT_COST_PARAMS, 0); // avoid human

    const tolerantPath = planRoutes({ ...base, params: tolerant }).coas[0]!.path;
    const intolerantPath = planRoutes({ ...base, params: intolerant }).coas[0]!.path;

    expect(rawExposure(intolerantPath, risk, 'human')).toBeLessThan(
      rawExposure(tolerantPath, risk, 'human'),
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
      risk[id] = { animals: 0, cold: 0, heat: 0, water: 0, human: 0 };
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

function appetiteFor(params: CostParams, humanAppetite: number): CostParams {
  return { ...params, appetite: { ...params.appetite, human: humanAppetite } };
}

/**
 * A single east–west corridor of `n` cells at y = 0, each carrying a uniform
 * baseline of cold + human risk for the wind to act on. With no vertical
 * neighbours the only path is the straight line, so wind comparisons are
 * apples-to-apples (same path, different cost/timing).
 */
function corridorScenario(n: number) {
  const cells: HexGridDto['cells'] = [];
  const risk: Record<CellId, RiskProfile> = {};
  for (let q = 0; q < n; q++) {
    const id = toCellId({ q, r: 0 });
    cells.push({ id, q, r: 0, center: { x: SQRT3 * q, y: 0 } });
    risk[id] = { animals: 0, cold: 0.3, heat: 0, water: 0, human: 0.3 };
  }
  const grid: HexGridDto = {
    layout: { orientation: 'pointy', size: 1, origin: { x: 0, y: 0 } },
    extent: { width: SQRT3 * n, height: 3 },
    cells,
  };
  return { grid, risk, west: toCellId({ q: 0, r: 0 }), east: toCellId({ q: n - 1, r: 0 }) };
}

describe('routing core (cyclone wind)', () => {
  const scen = corridorScenario(8);
  // Eye parked due south of the corridor, so the wind blows ~due west along it:
  // travelling east is a headwind, travelling west a tailwind.
  const cyclone = {
    id: 'c',
    name: 'c',
    from: { x: SQRT3 * 4, y: -10 },
    to: { x: SQRT3 * 4, y: -10 },
    startTime: 0,
    endTime: 1440,
    eyeRadiusKm: 0.5,
    maxWindRadiusKm: 3,
    outerRadiusKm: 40,
    strength: 1,
    enabled: true,
  };

  function corridorRequest(waypoints: CellId[], withCyclone: boolean): RouteRequest {
    return {
      grid: scen.grid,
      risk: scen.risk,
      params: DEFAULT_COST_PARAMS,
      waypoints,
      coaCount: 1,
      journeyParams: { startTime: 8 * 60, speedMode: 'fixed', fixedSpeedKmh: 15 },
      dayNight: { enabled: false },
      timeVaryingZones: [],
      waypointWindows: [null, null],
      ...(withCyclone ? { cyclone } : {}),
    };
  }

  const sumRisk = (coa: { riskTotals: RiskProfile }) =>
    RISK_TYPES.reduce((s, r) => s + coa.riskTotals[r], 0);

  const eastNoWind = planRoutes(corridorRequest([scen.west, scen.east], false)).coas[0]!;
  const eastHead = planRoutes(corridorRequest([scen.west, scen.east], true)).coas[0]!;
  const westTail = planRoutes(corridorRequest([scen.east, scen.west], true)).coas[0]!;

  it('leaves the path unchanged in the corridor (only cost/timing move)', () => {
    expect(eastHead.path).toEqual(eastNoWind.path);
  });

  it('slows the group into the wind (later arrival than with no wind)', () => {
    expect(eastHead.arrivalTimeMinutes).toBeGreaterThan(eastNoWind.arrivalTimeMinutes);
  });

  it('speeds the group up with the wind (earlier arrival than with no wind)', () => {
    const westNoWind = planRoutes(corridorRequest([scen.east, scen.west], false)).coas[0]!;
    expect(westTail.arrivalTimeMinutes).toBeLessThan(westNoWind.arrivalTimeMinutes);
  });

  it('costs more heading into the wind than running with it', () => {
    expect(sumRisk(eastHead)).toBeGreaterThan(sumRisk(westTail));
    // Cold in particular is punished into the wind and eased with it.
    expect(eastHead.riskTotals.cold).toBeGreaterThan(westTail.riskTotals.cold);
    // A non-cold channel falls below its no-wind level on a tailwind.
    expect(westTail.riskTotals.human).toBeLessThan(eastNoWind.riskTotals.human);
  });
});
