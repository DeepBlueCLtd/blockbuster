# 01 · Architecture

## 1. Guiding principle — a thin shared kernel, everything else behind ports

The app is split into **independent modules** that communicate only through
**typed contracts** in the shared kernel (`src/domain`, alias `@domain`). The
kernel holds *types, units and ports* — no meaningful behaviour. This is what
lets the modules be implemented, tested and even demoed in isolation and in
parallel.

Two hard rules:

1. **Everything imports from `@domain`; `@domain` imports nothing from `src`.**
2. **The UI never imports the engine.** UI ↔ engine traffic goes through the
   **store**, which depends on the engine only via the `Engine` port. Swap the
   implementation (mock ↔ real) and nothing upstream changes.

## 2. Layers

```
            ┌──────────────────────────────────────────────┐
            │                  @domain                      │
            │  units · world · hex · terrain · risk · cost  │
            │  routing DTOs · PORTS (MapGenerator, …)        │
            └──────────────────────────────────────────────┘
                 ▲              ▲                ▲
   ┌─────────────┘      ┌───────┘                └─────────────┐
   │  ENGINE (pure)     │  STATE                  │  UI (React) │
   │  mapgen            │  store (Zustand)        │  map view   │
   │  hexgrid           │  ── depends on Engine   │  panels     │
   │  risk              │     port only           │  inspector  │
   │  routing (worker)  │                         │  app shell  │
   └────────────────────┘                         └─────────────┘
            ▲                                            │
            └───────── implements ports ◄────────────────┘
                         (mock today, real later)
```

- **Engine** (`src/engine/*`): pure, framework-free TypeScript. Deterministic.
  No DOM, no React. Each module implements one port from `@domain/ports`.
- **State** (`src/state`): a single Zustand store. Owns the world, the controls
  and the routing output; orchestrates the engine; is the only thing both UI and
  engine touch.
- **UI** (`src/ui`, `src/app`): React + Leaflet. Reads store selectors, calls
  store actions. Knows nothing about how the engine works.
- **Mocks** (`src/mocks`): throwaway implementations of every port + golden
  fixtures, so the store and UI run before the real engine exists.

## 3. Dependency DAG (who may import whom)

```
domain        →  (nothing)
engine/mapgen →  domain
engine/hexgrid→  domain
engine/risk   →  domain
engine/routing→  domain
mocks         →  domain
state/store   →  domain, (an Engine instance — mock or real, injected)
ui/*          →  domain, state
app/*         →  domain, state, ui
```

There are **no cycles**. Crucially, the four engine modules don't depend on each
other at *compile* time — they exchange data only through `@domain` types — so
they can be built simultaneously.

## 4. Data flow (one cycle)

```
regenerate(seed)
  └─ MapGenerator.generate ─► TerrainField
       └─ GridBuilder.build + sampleTerrain ─► HexGrid + per-cell TerrainSample
            └─ RiskEngine.baseProfile ─► per-cell RiskProfile (base)
                 └─ store: CellRiskState{ base, overrides:{} }

user edits appetite / overrides / waypoints
  └─ store recomputes effective profiles + CostParams
       └─ (debounced) RoutePlanner.plan(RouteRequest) ──► [Web Worker]
            └─ RoutePlan { coas: Coa[] }  ─► store.plan
                 ├─ Map view draws routes + shades cells
                 └─ COA panel renders 3 stacked-bar charts
```

The **cost function is shared kernel** (`@domain/cost`): the routing worker and
the COA charts both call `riskCostBreakdown` / `cellRiskCost`, so a bar in the
chart equals the cost the planner actually optimised. Never duplicate it.

## 5. The Web Worker boundary

Routing is the only heavy compute, so it runs in a **dedicated Web Worker** to
keep the UI responsive. Because worker messages are structured-cloned, the
request/response must be **plain serialisable data** — no closures, no class
instances, no `Map`s of functions:

- `HexGrid` (has methods) is projected to **`HexGridDto`** via `toHexGridDto`.
- The cost field is sent as data: the **effective `RiskProfile` per cell** plus
  **`CostParams`**; the worker reconstructs costs with the shared functions.
- Messages are typed: `RouteWorkerRequest` / `RouteWorkerResponse` (`@domain`).

`createRoutePlanner()` (in `engine/routing`) wraps the worker behind the
`RoutePlanner` port and matches responses to requests by id. A `useWorker:false`
option runs the same core synchronously for tests.

## 6. State management

**Zustand** — a minimal store with no provider boilerplate, which suits a
viz-heavy app where many small components subscribe to slices of one big state.

- `createBlockbusterStore(engine)` is a **factory** (tests inject a fake engine);
  `useBlockbusterStore` is the app singleton wired to the mock engine.
- Components subscribe to **narrow selectors** (`useBlockbusterStore(s => s.x)`)
  to minimise re-renders.
- Re-planning is **debounced** (≈150 ms) and **stale-guarded** (results whose
  waypoints no longer match the live state are dropped).

Swapping to the real engine is a **one-line change** in `state/store.ts`
(`createMockEngine()` → `createEngine()`), once the modules are built.

## 7. Tech stack & rationale

| Concern | Choice | Why |
|---------|--------|-----|
| Language | **TypeScript** (strict) | Contracts are the whole strategy; types enforce them |
| Build/dev | **Vite** | Fast HMR, first-class TS + Web Worker support, simple |
| UI | **React 19** | Component split maps cleanly onto parallel UI work |
| Map | **Leaflet** (`CRS.Simple`) | Pan/zoom/layers for free; `Simple` CRS fits a fictitious km map (not geographic) |
| State | **Zustand** | Tiny, selector-based, no boilerplate; engine stays framework-free |
| Charts | **Custom SVG** | Stacked bars are trivial; exact control of the "bar = cell, y-aligned" layout; zero deps |
| Tests | **Vitest** + Testing Library | Same toolchain as Vite; jsdom for components |
| Lint/format | **ESLint (flat) + Prettier** | Consistency across many contributors |

Each of map/charts/engine sits behind an interface, so these choices are
reversible without touching callers.

## 8. Repository layout

```
src/
  domain/            # @domain — the shared kernel (types, units, ports). No deps.
    units, world, rng, terrain, hex, risk, cost, routing, ports, index
  engine/            # pure, deterministic; each dir implements one port (STUBS)
    mapgen/  hexgrid/  risk/  routing/{planner.core,worker,index}  index
  mocks/             # throwaway: working port impls + golden fixtures
    hexMath, mockEngine, fixtures, index
  state/             # the Zustand store + selectors + state types
    store, types
  ui/                # React; depends on domain + state only
    components/{Slider,Tabs}
    map/{MapView,HexGridLayer,RouteLayer,MapToolbar,projection}
    panels/{RiskAppetitePanel,CoaPanel,CellInspector,charts/StackedBarChart}
    theme
  app/               # composition root: layout, tabs, mount
    App, main, app.css
docs/spec/           # this spec
```

## 9. What "done" looks like for the integration

The app already integrates end-to-end against the mock. Each real module is
"integrated" when its `create*()` factory replaces the mock in `createEngine()`
and the app behaves identically (or better) with `createEngine()` wired into the
store. The mock is the executable reference for behaviour and shape.
