# 11 · Work breakdown & parallelization plan

The whole spec exists so this can happen: **eight workstreams, all startable on
day one**, because the contracts (`@domain`), a working **mock engine**, and
**golden fixtures** already exist. Nobody is blocked waiting for anybody.

## Workstreams & ownership

| # | Workstream | Owns (files) | Implements | Depends on |
|---|------------|--------------|-----------|------------|
| A | **Shared kernel** | `src/domain/*` | types, units, ports, cost | — (done; steward it) |
| B | Map generation | `src/engine/mapgen/*` | `MapGenerator` | A |
| C | Hex grid | `src/engine/hexgrid/*` | `GridBuilder` | A |
| D | Risk model | `src/engine/risk/*` | `RiskEngine` | A |
| E | Routing | `src/engine/routing/*` | `RoutePlanner` core | A |
| F | State store | `src/state/*` | store + selectors | A (done for mock; harden) |
| G | Map view | `src/ui/map/*` | Leaflet pane | A, F |
| H | Panels | `src/ui/panels/*`, `src/ui/components/*` | sliders, charts, inspector | A, F |
| I | App shell & tooling | `src/app/*`, root config, CI | layout, build, CI | A |

> A is the only true prerequisite, and it's already in place. B–E never import
> each other (they meet only through `@domain`), so they run fully in parallel.
> F/G/H/I build against the **mock + fixtures**, so they don't wait for B–E.

## Why nobody is blocked

1. **Contracts first, already done** — every seam is a typed port in `@domain`.
2. **Executable reference** — `src/mocks/mockEngine.ts` implements all four ports
   for real (deterministic), so the app runs today.
3. **Golden fixtures** — `src/mocks/fixtures.ts` exports a full world + 3-COA plan
   shaped exactly like production, so UI/state teams have stable data and
   snapshots without the engine.
4. **Per-module test stubs** — each engine module ships a `*.test.ts` enumerating
   acceptance criteria as `it.todo`; turn them green as you build.

## Suggested milestones

**M1 — Skeleton (reached).** App runs on the mock; typecheck/test/build/lint
green. Baseline for everyone.

**M2 — Real engine modules (B, C, D in parallel; E close behind).**
- C lands a real `GridBuilder`; F switches grid building from mock to real and
  the map shows the real grid.
- B + D land; F derives risks from real terrain.
- E lands `planRoutes`; F switches the planner to `createRoutePlanner()` (worker).
- Flip the wire in `state/store.ts`: `createMockEngine()` → `createEngine()`.
  Integrate one module at a time (you can keep the mock for the others by
  composing a hybrid `Engine` during transition).

**M3 — UI depth (G, H).** Real interactions, cross-highlighting, performance pass
on the map (canvas if needed), chart polish, inspector overrides.

**M4 — Tooling/CI (I).** GitHub Actions (lint → typecheck → test → build);
optional SessionStart hook; persistence of scenario in the URL.

## Integration points (the only places teams touch each other)

- `@domain` barrel — additive changes only; announce edits to existing types.
- `Engine` wiring in `state/store.ts` — the single mock→real switch.
- Store **selectors/actions** — the UI's whole view of the system.
- `RouteRequest`/`RoutePlan` + worker messages — the engine↔store data contract.

## Definition of done (per module)

- Implements its port/component exactly; **typecheck + lint clean**.
- Its `*.test.ts` acceptance criteria are real and **green**.
- Deterministic where the spec demands it; no `Math.random()`, no private cost
  copy, no cross-module imports outside `@domain`/store.
- For engine modules: dropping `create*()` into `createEngine()` makes the app
  behave identically to (or better than) the mock.
- For UI modules: renders from store/fixtures, no engine import, hover/selection
  round-trips intact.

## Hand-off / transition tips

- **Hybrid engine during M2:** compose `{ ...createMockEngine(), gridBuilder:
  createGridBuilder() }` to adopt finished modules one at a time.
- **Keep the mock** as the living reference and as a fallback `Engine` for demos
  and for tests that need cheap determinism.
- **Snapshot fixtures** in UI tests so chart/inspector regressions are caught
  without the engine.

## Risk register

| Risk | Mitigation |
|------|------------|
| `@domain` churn ripples everywhere | Treat as public API; additive changes; one steward (A) |
| Map perf at high cell counts | Canvas renderer behind the same `MapView`; cap default ~100 |
| Worker serialisation drift | `HexGridDto` + typed worker messages; shape tests on the mock |
| Cost drift between routing & charts | Single source in `@domain/cost`; lint against private copies |
| Leaflet y-orientation confusion | Pin it in `projection.ts` early with a visual check |
