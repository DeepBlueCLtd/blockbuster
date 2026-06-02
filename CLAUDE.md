# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

Blockbuster is a **client-side TypeScript playground** for travelling-salesman
route-finding through non-uniform space: a hex grid is laid over a fictitious
50 km × 30 km landscape, each cell gets a composite **risk cost**, and the app
proposes **3 diverse Courses of Action (COAs)** between chosen waypoint cells.
Everything runs in the browser — no backend.

The full build spec lives in **`docs/spec/`** (read `docs/spec/README.md` first).
It is the authoritative reference for behaviour and acceptance criteria; consult
the relevant `docs/spec/NN-*.md` before implementing an engine module.

## Commands

```bash
npm install          # required first; node >= 20
npm run dev          # Vite dev server → http://localhost:5173
npm run typecheck    # tsc --noEmit (strict)
npm run lint         # eslint .
npm test             # vitest (watch)
npm run test:run     # vitest run (one-shot, use in CI/checks)
npm run build        # tsc --noEmit && vite build
npm run format       # prettier --write over src + docs
```

Run a single test file or filter by name:

```bash
npx vitest run src/engine/risk/risk.test.ts
npx vitest run -t "name of the test"
```

**There is no PR check workflow** — CI only deploys (see below), so run
`typecheck` + `lint` + `test:run` + `build` locally before pushing; they are all
expected to stay green.

## Mock engine vs. real engine — important

The app **runs today on a mock**. The four real engine modules under
`src/engine/*` (`mapgen`, `hexgrid`, `risk`, `routing`) are **stubs whose
`create*()` factories throw `"not implemented"`**. The working implementations
live in `src/mocks/mockEngine.ts`, with deterministic golden fixtures in
`src/mocks/fixtures.ts`.

- `src/state/store.ts` wires the app singleton to `createMockEngine()`.
- Switching to the real engine is a **one-line change**: `createMockEngine()` →
  `createEngine()` (from `src/engine`). During transition, compose a hybrid,
  e.g. `{ ...createMockEngine(), gridBuilder: createGridBuilder() }`, to adopt
  finished modules one at a time.
- The mock is the **executable reference**: a real module is "done" when dropping
  its `create*()` into `createEngine()` makes the app behave identically or
  better. Each engine module ships a `*.test.ts` with acceptance criteria as
  `it.todo` — turn those green as you build.

## Architecture — the rules that matter

The whole design exists to let modules be built and tested in isolation. Honour
these invariants; breaking them defeats the point.

1. **The shared kernel is `src/domain` (alias `@domain`).** It holds only types,
   units and the module-boundary **ports** — no meaningful behaviour.
   **Everything imports from `@domain`; `@domain` imports nothing from `src`.**
   Treat the `@domain` barrel (`src/domain/index.ts`) as a public API: additive
   changes only, announce edits to existing types.

2. **Each engine module implements exactly one port** (`src/domain/ports.ts`:
   `MapGenerator`, `GridBuilder`, `RiskEngine`, `RoutePlanner`). Engine code is
   pure, deterministic, framework-free — **no DOM, no React, no `Math.random()`**
   (seed via `src/domain/rng.ts`). The four engine modules **must not import each
   other**; they meet only through `@domain` types, which is why they parallelize.

3. **The UI never imports the engine.** UI ↔ engine traffic goes through the
   **Zustand store** (`src/state/store.ts`), which depends on the engine only via
   the injected `Engine` port. The store owns the world, controls and routing
   output and is the *only* thing both UI and engine touch. UI components
   subscribe to **narrow selectors** (`useBlockbusterStore(s => s.x)`).

4. **The cost function is shared kernel** (`src/domain/cost.ts`). The routing
   worker and the COA stacked-bar charts both call `riskCostBreakdown` /
   `cellRiskCost`, so every chart segment is exactly a per-risk cost the planner
   optimised. **Never duplicate the cost formula** — there must be no private
   copy. The optimised total also includes a per-step **movement cost**
   (`movementCost`) — a constant per hex step that keeps the three COAs distinct
   by trading distance against risk — but the charts **deliberately omit it**:
   being constant per cell it adds no per-cell signal and would read as a stray
   non-risk colour, so the bars show the risk breakdown only.

5. **Routing runs in a Web Worker** (`src/engine/routing/worker.ts`), so its
   request/response must be **plain structured-clone-friendly data** — no
   closures, no class instances. `HexGrid` (which has methods) is projected to
   `HexGridDto` via `toHexGridDto` before sending; the worker reconstructs costs
   from the per-cell `RiskProfile` + `CostParams`. Messages are typed
   (`RouteWorkerRequest` / `RouteWorkerResponse`). `createRoutePlanner({
   useWorker: false })` runs the same `planRoutes` core synchronously for tests.

Dependency DAG (no cycles): `domain → (nothing)`; `engine/* → domain`;
`mocks → domain`; `state → domain + an injected Engine`; `ui/* → domain, state`;
`app/* → domain, state, ui`.

### Data flow (one cycle)

`regenerate(seed)` → `MapGenerator.generate` → `GridBuilder.build` +
`sampleTerrain` → `RiskEngine.baseProfile` per cell → store holds
`CellRiskState { base, overrides }`. User edits (appetite slider / cell override /
waypoints) → store recomputes effective profiles + `CostParams` → **debounced
~150 ms** call to `RoutePlanner.plan` → `RoutePlan { coas }`. Replans are
**stale-guarded**: a result whose waypoints no longer match live state is
dropped. Determinism is a hard requirement — same seed + inputs ⇒ same output.

## Conventions

- TypeScript is **strict** with extras on: `noUncheckedIndexedAccess`,
  `exactOptionalPropertyTypes`, `noUnusedLocals/Parameters`,
  `verbatimModuleSyntax` (use `import type` for type-only imports). Prefix
  intentionally-unused vars with `_`.
- Aliases: `@` → `src`, `@domain` → `src/domain`.
- Prettier: single quotes, trailing commas, semicolons, width 100.
- Tests are colocated `*.test.ts(x)`, run under Vitest + jsdom with globals and
  Testing Library (`src/setupTests.ts`); fixtures under `src/mocks/`.

## Deployment

Two GitHub Actions workflows publish to the `gh-pages` branch:
`deploy.yml` builds `main` to the site root; `pr-preview.yml` builds each PR to
`pr-preview/pr-<number>/` and comments a preview link. The Vite `base` is `'./'`
so the same build works at the root and under a PR sub-path.
