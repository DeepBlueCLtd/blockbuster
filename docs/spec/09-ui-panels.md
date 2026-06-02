# 09 · UI — Panels (risk appetite, COAs, cell inspector)

**Files:** `src/ui/panels/{RiskAppetitePanel,CoaPanel,CellInspector}.tsx`,
`src/ui/panels/charts/StackedBarChart.tsx`, `src/ui/components/{Slider,Tabs}.tsx`
· **Depends on:** `@domain` + store.

The right pane is two tabs (`Risk appetite`, `COAs`) plus an always-visible Cell
inspector beneath them. These can be built independently of each other and of the
map, all against the store/fixtures.

## Risk-appetite panel

- One `Slider` per `RISK_TYPES`, bound to `costParams.appetite[risk]`, calling
  `setAppetite`. Hint label (Avoid/Balanced/Tolerant) from the value.
- Copy: higher appetite = more tolerant ⇒ less penalised.
- **AC:** moving a slider updates shading + (debounced) re-plans; values persist
  across tab switches.

## COA panel — the 3 charts

- Reads `plan.coas` (≤3). Renders, **vertically stacked**, one `StackedBarChart`
  per COA with a header (label, total cost, distance, cell count). Empty/CTA
  state when there's no plan yet.
- **Shared y-scale:** compute the max per-cell **risk total** across *all* COAs
  and pass it to every chart so the three are **directly comparable and
  y-aligned** (the brief's requirement).
- Clicking a COA → `selectCoa` (emphasises it on the map). The colour-coded
  appetite sliders above double as the chart key — there is no separate legend.

### StackedBarChart

- SVG. **One bar per hex cell** along `coa.steps`, stacked bottom-up by
  `step.perRisk` (colours from `RISK_COLORS`) so bar height = the cell's **total
  risk cost**. Movement cost drives routing but is deliberately **not drawn** — it
  is constant per hex step, so it carries no per-cell signal.
- Hover a bar → `onHoverCell(cellId)` (cross-highlights the map); click →
  `onSelectCell`. The bar matching `selectedCellId` is outlined.
- **AC:** segment heights equal `riskCostBreakdown` for the cell; bars across the
  three charts share the y-scale; hover/selection round-trip with the map.

## Cell inspector

- For `selectedCellId`: biome/temp/elevation line + a **risk table** of the five
  channels. Each row: a slider showing the **effective** value, editing it calls
  `setOverride`; **overridden rows are highlighted** and show a **reset (↺)**
  button; a "Reset all" appears when any override exists.
- Actions: **Add/Remove waypoint** for this cell.
- Empty state prompts the user to click a hex.
- **AC:** overriding a value highlights the row, changes routing, and shows reset;
  reset restores the model value; waypoint toggle updates the map + re-plans.

## Shared components

- `Slider` — labelled range with value + optional hint.
- `Tabs` — generic, accessible (`role=tab`, `aria-selected`) tab strip.

## Charting choice & swap path

Custom SVG keeps zero dependencies and gives exact control over the
"bar = cell, y-aligned across three charts" layout. If richer interactions are
needed later, the `StackedBarChart` props are a clean seam to drop in visx/Recharts
without touching `CoaPanel`.

## Build in isolation

Everything renders from the store (mock) or directly from `fixturePlan` /
`fixtureRiskStates`. No engine, no map needed.
