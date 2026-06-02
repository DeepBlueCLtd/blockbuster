import type { RoutePlan, RouteRequest } from '@domain';

/**
 * ROUTING CORE — owner-implemented, pure and worker-agnostic.
 *
 * Given a fully-serialised {@link RouteRequest}, return `coaCount` distinct,
 * near-optimal {@link import('@domain').Coa}s that visit the waypoints. This is
 * where pathfinding (A-star / Dijkstra over the hex graph), waypoint ordering (the
 * TSP part) and route-diversity live. It must not touch the DOM or `window` so
 * it can run inside the Web Worker. See docs/spec/06-engine-routing.md.
 *
 * A working reference implementation lives in `src/mocks/mockEngine.ts`
 * (`planRoutesSync`) — port/improve it here.
 */
export function planRoutes(_request: RouteRequest): RoutePlan {
  throw new Error('routing core: not implemented — see docs/spec/06-engine-routing.md');
}
