# 06 · Engine — Routing (COA generation)

**Port:** `RoutePlanner` · **Files:** `src/engine/routing/{planner.core,worker,index}.ts`
· **Reference impl:** `planRoutesSync` in `src/mocks/mockEngine.ts` · **Depends
on:** `@domain` only.

## Purpose

The heart of the app: given the grid, the (effective) risk field, the cost
params and ≥2 waypoints, produce **`coaCount` (=3) distinct, near-optimal COAs**,
each with the per-cell cost breakdown the charts render. Runs in a **Web Worker**
so the search never blocks the UI.

## Contract

```ts
// pure, worker-agnostic core — implement this:
planRoutes(request: RouteRequest): RoutePlan        // planner.core.ts
// port wrapper (provided): runs the core in a Worker, matched by id:
createRoutePlanner(opts?): RoutePlanner             // index.ts
```

`RouteRequest` is fully serialisable (`HexGridDto`, `Record<CellId,RiskProfile>`,
`CostParams`, `waypoints`, `coaCount`). Reconstruct adjacency from the DTO
(axial neighbours) and **cost cells/edges with `@domain/cost`**:
`cellRiskCost(risk[id], params)` + `movementCost(distance(centres), params)`.

## Algorithm (v1)

Three parts, all present in the mock — port and improve:

1. **Pathfinding** between consecutive waypoints: Dijkstra/A\* over the hex graph
   with edge cost = movement + entered-cell risk cost.
2. **Waypoint ordering (the TSP part):** for >2 waypoints, order them to minimise
   total cost. Mock uses greedy nearest-neighbour; upgrade to nearest-neighbour +
   2-opt for v1 quality. v1 plans an **open** path (no return to start).
3. **Diversity — 3 distinct COAs:** generate genuinely different options, e.g.
   bias the search three ways (**Direct** = favour distance, **Balanced**,
   **Cautious** = favour low risk) and/or penalise overlap with already-found
   paths (k-shortest-with-diversity). **Score every resulting path under the
   analyst's real `params`** so the charts are consistent regardless of the bias
   used to discover the path. De-duplicate identical paths.

Each `Coa.steps[i]` must equal `riskCostBreakdown(risk[path[i]], params)` plus
`movementCost` for the entering move; `totalCost` = Σ `stepCost`.

## Worker boundary

`worker.ts` receives `RouteWorkerRequest`, calls `planRoutes`, posts
`RouteWorkerResponse`. `createRoutePlanner()` lazily spawns the worker
(`new Worker(new URL('./worker.ts', import.meta.url), { type:'module' })`),
matches responses by id, and exposes `dispose()`. `createRoutePlanner({useWorker:false})`
runs the core inline for unit tests.

## Acceptance criteria (`routing.test.ts`)

- Returns exactly `coaCount` COAs when the grid permits (fewer only if truly
  fewer distinct paths exist).
- Every COA starts at the first waypoint, ends at the last, and visits all
  waypoints in between.
- COAs are pairwise distinct paths.
- `steps` align 1:1 with `path`; Σ `stepCost` == `totalCost`; per-risk matches
  `@domain/cost`.
- Lowering appetite for a risk steers routes away from high-`that-risk` cells.
- Deterministic for identical requests; completes well under a frame budget at
  ~100–300 cells.

## Build in isolation

Use `fixtureRequest` from `src/mocks/fixtures.ts` as input. Develop `planRoutes`
with `createRoutePlanner({useWorker:false})` and unit-test the core directly;
the worker wrapper is already done and shape-tested.

## Open questions

- Impassable terrain (water/mountains) — hard block vs heavy cost? v1: heavy cost
  via the model; add a `passable` predicate later if needed.
- Closed tours (return to start) — out of scope for v1.
