# 07 · State store

**Files:** `src/state/{store,types}.ts` · **Depends on:** `@domain` + an injected
`Engine` · **Consumed by:** all UI.

## Purpose

The single source of truth and the only meeting point of UI and engine. Holds the
generated world, the analyst's controls, and the routing output; exposes actions
that orchestrate the engine and keep everything consistent.

## Shape

`BlockbusterState` (`types.ts`) — config (`seed`, `extent`, `hexSize`), derived
world (`grid`, `terrain`, `riskStates`), controls (`costParams`, `waypoints`),
output (`plan`, `planning`, `planError`), and view/selection (`selectedCellId`,
`selectedCoaId`, `hoveredCellId`, `activeTab`, `displayRisk`).

## Actions (already implemented against the mock)

| Action | Effect |
|--------|--------|
| `regenerate(seed?)` | Rebuild map→grid→terrain→risk; keep valid waypoints (else seed two); re-plan |
| `setHexSize(km)` | Change cell size and regenerate |
| `setAppetite(risk, v)` | Update `costParams.appetite`; debounced re-plan |
| `setOverride(cell, risk, v)` | Set a per-cell override; debounced re-plan |
| `resetOverride(cell, risk?)` | Clear one or all overrides for a cell; re-plan |
| `toggleWaypoint(cell)` | Add/remove a waypoint; re-plan when ≥2 |
| `clearWaypoints()` | Drop all waypoints and the plan |
| `replan()` | Build `RouteRequest` (effective risks + `toHexGridDto`) and call the planner |
| `selectCell / selectCoa / hoverCell` | View state for cross-highlighting |
| `setActiveTab / setDisplayRisk` | Right-panel tab; map shading channel |

## Key behaviours

- **Factory + singleton:** `createBlockbusterStore(engine)` for tests (inject a
  fake `Engine`); `useBlockbusterStore` is the app instance wired to
  `createMockEngine()`. **Switching to the real engine is one line here.**
- **Debounce + stale-guard `replan`:** edits coalesce (~150 ms); a returned plan
  whose `waypoints` no longer match live state is discarded.
- **Effective risks:** `replan` sends `effectiveProfile(state)` per cell, so
  overrides are reflected in routing.
- **Selectors:** `selectEffectiveProfile`, `selectCellCost` (composite cost for
  shading) are pure and reusable; add more here rather than computing in
  components.

## Acceptance criteria

- After `regenerate`, `grid`/`terrain`/`riskStates` are populated and a `plan`
  with ≤3 COAs exists (two default waypoints).
- `setOverride` then `replan` changes the effective risk used by routing.
- Rapid `setAppetite` calls collapse into a single re-plan.
- Stale plans never overwrite fresher state.
- Store actions are stable identities (safe in React deps).

## Build in isolation

The store is done for the mock; treat this as the integration contract. UI teams
depend only on this shape. When the real engine lands, swap `createMockEngine()`
→ `createEngine()` and re-run the store tests + the app.

## Notes / options

- v1 keeps `terrain`/`riskStates` as `Map`s replaced immutably on edit — fine at
  ~100 cells. If cell counts grow, consider structural sharing or normalising.
- Persistence (URL/localStorage of seed + appetite + overrides + waypoints) is a
  natural later add; the state is already serialisable-ish (Maps aside).
