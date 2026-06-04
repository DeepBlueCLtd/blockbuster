# 00 · Product overview

## 1. Problem & purpose

Analysts need to reason about **routes through a risky, non-uniform
environment**. Blockbuster is a playground for that: it overlays a hex grid on a
fictitious landscape, assigns each cell a composite **risk cost**, and applies
**Travelling Salesman Problem (TSP)** techniques to propose optimal routes —
**Courses of Action (COAs)** — between two or more chosen cells. The user steers
the outcome by adjusting their **risk appetite** and by **overriding** the risk
in individual cells, then compares the COAs the algorithm produces.

It is an experimentation environment, not a production planning tool. The goal is
to make the *interaction* and *visualisation* of route/risk trade-offs tangible.

## 2. The world

- A fictitious map, **50 km wide × 30 km tall**, generated procedurally.
- Land cover includes **woodland, towns, savannah, mountains** (plus grassland
  and water as connective terrain).
- A **hex grid** is laid over the map. Cell size is **tunable**; the default
  yields **≈100 cells**.

## 3. The five risks

Each cell carries a level (0…1) for five risk channels. Their composite, weighted
by the analyst's appetite, is the cell's **traversal cost**:

| Risk | Driven by (terrain) |
|------|---------------------|
| Animals | vegetation / savannah |
| Cold | low temperature (elevation) |
| Heat | high temperature (lowlands) |
| Lack of water | distance from water |
| Humans | banditry / proximity to towns |

The mapping terrain → risk lives in the [Risk model](./05-engine-risk.md); the
cost formula lives in the shared kernel so charts and routing agree exactly.

## 4. The interface

```
┌─────────────────────────────┬───────────────────────────┐
│                             │  Blockbuster   [Regenerate]│
│                             ├───────────────────────────┤
│                             │ [ Risk appetite | COAs ]   │  ← tabs
│        MAP (Leaflet)        │                           │
│   hex grid, shaded by risk  │  risk-appetite sliders     │
│   COA routes + waypoints    │     — or —                 │
│                             │  3 stacked-bar COA charts  │
│                             ├───────────────────────────┤
│                             │  Cell inspector (override) │
└─────────────────────────────┴───────────────────────────┘
```

- **Map (left):** the hex grid, each cell shaded by the selected risk (or the
  composite cost). The three COAs are drawn as routes; the selected one is
  emphasised. Waypoints are marked. Clicking a cell selects it.
- **Tabs (right):**
  - **Risk appetite** — one slider per risk. Higher appetite = more tolerant =
    routes are penalised less for that risk.
  - **COAs** — the algorithm produces **3** COAs, drawn as **3 vertically
    stacked, y-aligned bar charts**. Each **bar = one hex cell** on that route,
    stacked by per-risk cost contribution. Selecting a COA highlights it on the
    map; hovering a bar highlights the corresponding cell.
- **Cell inspector:** a small table of the selected cell's risks. The analyst can
  **override** any value (shown highlighted) and **reset** individual overrides
  or all of them, and add/remove the cell as a routing **waypoint**.

## 5. Core interactions (user stories)

1. *As an analyst, I adjust a risk-appetite slider and watch the COAs and their
   cost charts update.*
2. *I pick two or more cells as waypoints and get 3 distinct candidate routes.*
3. *I shade the map by a single risk to see where it concentrates.*
4. *I override a cell's risk (e.g. I have intel that a town is safe now) and
   watch routes re-plan around the change; I can reset it later.*
5. *I compare the 3 COAs' stacked-bar profiles to choose between "direct but
   risky" and "safe but long".*
6. *I tune the hex size or regenerate the map to explore different landscapes.*

## 6. v1 scope

**In scope**

- Procedural map generation (deterministic by seed).
- Hex grid (tunable size) with terrain sampling.
- Five-channel risk model + composite cost with appetite weighting.
- Per-cell overrides with highlight + reset.
- Waypoint selection (≥2) on the map.
- Routing that returns **3 diverse COAs** with per-cell cost breakdowns, running
  in a Web Worker.
- Map view (Leaflet) with risk shading, routes, waypoints, selection/hover.
- Risk-appetite panel; COA charts; cell inspector.
- Everything client-side, TypeScript → JS, no backend.

**Explicitly out of scope for v1** (designed for, not built)

- Persistence / sharing / export of scenarios.
- Multiple appetite presets saved side by side.
- Returning (closed-loop) TSP tours; v1 plans an **open** path visiting the
  waypoints in a sensible order.
- Real elevation/biome datasets — the world is fictitious.
- Mobile-optimised layout; v1 targets desktop.
- Undo/redo history.

## 7. Non-functional targets

- **Deterministic:** same seed + inputs ⇒ same map, risks and COAs.
- **Responsive:** appetite/override edits reflected within a beat; routing is
  debounced and off-thread so the UI never blocks.
- **Swappable internals:** rendering, charting and the engine sit behind
  interfaces so they can be replaced without touching callers.
- **Scale:** smooth at the default ~100 cells; usable up to a few hundred.

## 8. Glossary

- **COA (Course of Action):** one concrete route through the grid visiting the
  waypoints, with its per-cell cost breakdown.
- **TSP:** Travelling Salesman Problem — ordering the waypoints to minimise cost.
- **Risk appetite:** per-risk tolerance (0 = avoid, 1 = tolerate) set by sliders.
- **Override:** an analyst-set risk level replacing the model's value for a cell.
- **Waypoint:** a cell a route must visit.
- **Cost field:** the per-cell traversal cost derived from risks + appetite.
- **Hex / cell:** one tile of the grid; identified by axial coordinates `(q, r)`.
