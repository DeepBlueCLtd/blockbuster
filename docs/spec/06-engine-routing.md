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
2. **Waypoint order — fixed by the analyst:** the route visits `waypoints` in the
   exact order given. The map/panel UI lets the analyst add, reorder and relocate
   waypoints, so the planner **must not** shuffle them (no TSP reordering). v1 plans
   an **open** path (no return to start). _(The greedy nearest-neighbour reorder the
   mock once used has been removed; if a future mode wants auto-ordering, gate it
   behind an explicit request flag rather than reordering by default.)_
3. **Diversity — 3 distinct COAs:** generate genuinely different options, e.g.
   bias the search three ways (**Direct** = favour distance, **Balanced**,
   **Cautious** = favour low risk) and/or penalise overlap with already-found
   paths (k-shortest-with-diversity). **Score every resulting path under the
   analyst's real `params`** so the charts are consistent regardless of the bias
   used to discover the path. De-duplicate identical paths.

Each `Coa.steps[i]` must equal `riskCostBreakdown(risk[path[i]], params)` plus
`movementCost` for the entering move; `totalCost` = Σ `stepCost`.

### Dynamic per-cell speed

When `journeyParams.speedMode === 'dynamic'` the planner chooses a **base travel
speed per cell** that minimises that cell's entry cost (wind then scales the
chosen base into the effective travel speed recorded on `Coa.steps[i].speedKmh`).
Because the per-cell cost is now **convex** in speed (see
[05 · Risk — speed-dependent cost](./05-engine-risk.md)), an *interior* speed can
be the cheapest. v1 finds it by evaluating the entry cost across the discrete
`CANDIDATE_SPEEDS` grid and taking the argmin — robust to the cold-clamp kinks
that can break strict unimodality, and reusing `@domain/cost` rather than a
private closed form. A finer grid, or an analytic (`dC/dv = 0`, `v* = √(A/B)`) /
ternary refinement on the convex curve, can sharpen it. Evaluate the same
speed-modified profile the charts read, so the breakdown reconciles with the
chosen speed.

> v1 only ever tested the two range endpoints `{min, max}` and kept the cheaper.
> That is provably sufficient for a *linear* cost (the optimum is always an
> endpoint), and is exactly why every recommendation came back as the slowest or
> fastest speed. The convex cost **plus an interior solve** is what lets
> intermediate speeds win — both halves are required; widening the search alone,
> or convexifying alone, does nothing.

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
  waypoints in between **in the order given** (no reordering).
- COAs are pairwise distinct paths.
- `steps` align 1:1 with `path`; Σ `stepCost` == `totalCost`; per-risk matches
  `@domain/cost`.
- Lowering appetite for a risk steers routes away from high-`that-risk` cells.
- Deterministic for identical requests; completes well under a frame budget at
  ~100–300 cells.
- **Dynamic speed:** for a cell whose convex cost minimum is interior, the chosen
  base speed is strictly between `SPEED_MIN_KMH` and `SPEED_MAX_KMH` (not pinned to
  an endpoint); endpoints appear only when the optimum genuinely clamps. Given a
  constructed convex profile with a known `v*`, the selected speed matches it
  (within the solver's tolerance/grid).
- Per-cell `speedKmh` is the speed at which `steps[i].perRisk` was computed, so the
  charts reconcile.

## Build in isolation

Use `fixtureRequest` from `src/mocks/fixtures.ts` as input. Develop `planRoutes`
with `createRoutePlanner({useWorker:false})` and unit-test the core directly;
the worker wrapper is already done and shape-tested.

## Open questions

- Impassable terrain (water/mountains) — hard block vs heavy cost? v1: heavy cost
  via the model; add a `passable` predicate later if needed.
- Closed tours (return to start) — out of scope for v1.
- Dynamic speed: v1 selects the per-cell speed by argmin over the discrete
  `CANDIDATE_SPEEDS` grid (also used by `optimal` mode) — simple, robust to the
  cold-clamp kinks, and bounds the per-cell work, but quantises recommendations to
  5 km/h. A continuous analytic/ternary solve would smooth them; revisit if the
  granularity proves too coarse.
