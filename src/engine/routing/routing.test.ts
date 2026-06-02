import { describe, it } from 'vitest';

describe('routing core (spec)', () => {
  it.todo('returns exactly coaCount COAs when the grid allows it');
  it.todo('every COA starts at the first waypoint and ends at the last');
  it.todo('every COA visits all waypoints in the order given (no reordering)');
  it.todo('COAs are pairwise distinct paths');
  it.todo('steps align 1:1 with path and sum to totalCost');
  it.todo('per-risk costs match @domain/cost.riskCostBreakdown for the params');
  it.todo('lowering appetite for a risk steers routes away from that risk');
});
