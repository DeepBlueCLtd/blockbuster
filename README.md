# blockbuster
Travelling salesman route-finding through non-uniform space

# Objective

Playground environment to experiment with interactions and visualisations regarding choice of routes through an environment.  A hex grid will be placed over the environment, and  Travelling Salesman Problem (TSP) techniques will be applied to generating optimal routes (COAs: Courses of Action) through the environment, generating permutations of routes that that travel between two or more cells in the grid.

The cost function in each hex cell will be a compsite of a number of risks, to include:
- animals
- cold
- heat
- absence of water
- thief

## UI
The general layout will be a map control on the left, with tabs controls on the right hand side.  These tabs will be present:
- risk appetite
- COAs
 
The algorithm will generate 3 courses of action. These will be plotted as 3 vertically aligned stacked bar charts, with each bar representing the passage through a hex cell.

A ficticious underlying map will be generated, which includes woodland, towns, savannah, mountains. The map will be 50km wide by 30km tall.  The size of the hex cells will be tunable, but the default will apply a uniform grid of 100 cells.

## Interactions
Sliders will allow the user to control their risk appetite for each risk.

Each hex cell will contain a small table showing the level of each risk in that cell. The analyst will be able to override per-cell risks, with modified values shown in highlight (with ability to reset individual overrides).

# Specification & implementation

A full build spec for the initial version lives in **[`docs/spec/`](./docs/spec/README.md)**. It is written for **parallel implementation**: every module talks only through typed contracts in the shared kernel (`src/domain`, alias `@domain`), so the engine, state and UI can be built independently.

An interactive guide to the algorithms and approaches used in the project is available at **[`docs/approaches.html`](./docs/approaches.html)** — open it in a browser to explore terrain generation, hex grids, risk modelling, and route optimisation with hands-on widgets.

A **compiling scaffold** is in place: the app already runs end-to-end on a throwaway *mock engine* and *golden fixtures*, with the four real engine modules left as stubs for module owners to fill in.

- Start here: [`docs/spec/README.md`](./docs/spec/README.md) → overview → architecture → domain model → per-module specs → [work breakdown](./docs/spec/11-work-breakdown.md).

## Tech stack

TypeScript (strict) · Vite · React 19 · Leaflet (`CRS.Simple`) · Zustand · custom SVG charts · Vitest · ESLint/Prettier. Routing runs in a Web Worker. Everything is client-side — TypeScript compiled to JS in the browser, no backend.

## Getting started

```bash
npm install
npm run dev        # http://localhost:5173 — runs on the mock engine + fixtures
```

Other checks (all green on the scaffold):

```bash
npm run typecheck  # tsc --noEmit
npm run test:run   # vitest run
npm run build      # tsc --noEmit && vite build
npm run lint       # eslint .
```

## Where things live

```
src/domain/   shared kernel: types, units, ports, cost function (@domain)
src/engine/   pure engine modules (mapgen, hexgrid, risk, routing) — STUBS
src/mocks/    throwaway working engine + golden fixtures (run the app today)
src/state/    Zustand store — the only bridge between UI and engine
src/ui/       React + Leaflet map view, panels, charts, inspector
src/app/      composition root (layout, tabs, mount)
docs/spec/    the specification
```


