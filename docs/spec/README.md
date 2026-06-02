# Blockbuster — Specification (v0.1)

> Travelling-salesman route-finding through non-uniform space: a browser
> playground for exploring how risk appetite shapes the best routes (COAs)
> across a hex-gridded, fictitious landscape.

This folder is the **build spec** for the initial version. It is written so the
work can be split across people/agents who build in parallel against shared,
typed contracts. A **compiling scaffold** already exists in `src/` that
implements those contracts with a throwaway mock engine, so the app runs
end-to-end today.

## Read in this order

| #  | Doc | What it covers |
|----|-----|----------------|
| 00 | [Product overview](./00-overview.md) | What we're building and why; v1 scope; glossary |
| 01 | [Architecture](./01-architecture.md) | Layers, the dependency DAG, data flow, the worker boundary, tech stack |
| 02 | [Domain model](./02-domain-model.md) | The shared kernel: units, coordinates, every type and port |
| 03 | [Engine · Map generation](./03-engine-mapgen.md) | Procedural terrain |
| 04 | [Engine · Hex grid](./04-engine-hexgrid.md) | Hex geometry + terrain sampling |
| 05 | [Engine · Risk model](./05-engine-risk.md) | Terrain → risk levels; the cost function |
| 06 | [Engine · Routing](./06-engine-routing.md) | Pathfinding, TSP ordering, 3 diverse COAs, the worker |
| 07 | [State store](./07-state-store.md) | The integration hub between UI and engine |
| 08 | [UI · Map view](./08-ui-map-view.md) | Leaflet rendering, hex overlay, interactions |
| 09 | [UI · Panels](./09-ui-panels.md) | Risk-appetite sliders, COA charts, cell inspector |
| 10 | [App shell & tooling](./10-app-shell-and-tooling.md) | Layout, build, test, CI |
| 11 | [Work breakdown](./11-work-breakdown.md) | Who can start when, milestones, fixtures, DoD |

## The one rule that makes parallel work possible

Everything depends on the **shared kernel** (`src/domain`, imported as
`@domain`). It contains only types, units and the module-boundary **ports** — no
behaviour that matters. Each engine module implements exactly one port; the UI
talks only to the **store**, never to the engine. As long as everyone honours
the port signatures in `@domain`, modules can be built, mocked and tested in
isolation. See [Architecture](./01-architecture.md).

## Status of the scaffold

- ✅ `npm install && npm run dev` runs the app with a **mock engine** + golden
  fixtures (real-looking map, risks, and 3 COAs).
- ✅ `npm run typecheck`, `npm test`, `npm run build`, `npm run lint` all pass.
- 🔨 The four engine modules under `src/engine/*` are **stubs that throw**; the
  mock under `src/mocks/*` stands in for them until they're built.
