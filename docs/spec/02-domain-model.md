# 02 · Domain model (the shared kernel)

Everything in `src/domain` (alias **`@domain`**). This is the contract every
team codes against. It is already implemented in the scaffold; this doc explains
the *why* and the invariants. **Treat the `@domain` barrel as a public API** —
add freely, change/remove with a heads-up because it ripples everywhere.

## Units & conventions (`units.ts`, `world.ts`)

- World distances are **kilometres** (`Km`). Elevation is metres, temperature °C.
- `Unit` is a scalar **contractually in `[0, 1]`** (risk levels, appetites,
  normalised attributes). Use `clamp01` at boundaries.
- The world is a flat rectangle. Origin `(0,0)` = **south-west**; `x` east, `y`
  north. Default extent **50 × 30 km** (`DEFAULT_EXTENT`).
- Renderers may flip axes for screen space — that's a view concern, not a model
  one (see [Map view](./08-ui-map-view.md)).

## Determinism (`rng.ts`)

`Rng` is a seedable PRNG (`mulberry32` provided). **No module may call
`Math.random()`** — anything stochastic takes an `Rng` so the same seed always
reproduces the same world and COAs.

## Terrain (`terrain.ts`)

- `Biome` — `woodland | town | savannah | mountains | grassland | water`.
- `TerrainSample` — continuous attributes at a point: `biome`, `elevation`,
  `temperature`, `vegetation`, `waterProximity`, `banditActivity`. Map-gen
  decides *what the world is like*; risk decides *what it costs*. This split
  keeps the two modules decoupled.
- `TerrainField` — `{ extent, seed, sample(point) }`, a **pure, continuous**
  function so the grid can sample at any resolution. `sample` must be stable.
- `MapGenConfig` / `MapGenTuning` — inputs to generation (extent, seed, optional
  knobs).

## Hex grid (`hex.ts`)

- Coordinates are **axial `(q, r)`**; cube `s = -q-r`. See Red Blob Games.
- `CellId` is a branded `"${q},${r}"` string — use `toCellId` / `parseCellId`.
- `HexLayout` = `{ orientation: 'pointy'|'flat', size (circumradius km), origin }`.
- `HexCell` = `{ id, coord, center, vertices[6] }` (geometry precomputed).
- `HexGrid` = cells + queries: `get`, `neighbors`, `distance` (hex steps),
  `pointToCell`. This is the interface every downstream module consumes.
- `HexGridDto` + `toHexGridDto` — the serialisable projection for the worker.
- Defaults: `DEFAULT_HEX_SIZE_KM ≈ 2.4` (≈100 cells over the default extent),
  `DEFAULT_CELL_COUNT = 100`.

## Risk (`risk.ts`)

- `RISK_TYPES` (stable order) `= animals, cold, heat, water, thief`; `RiskType`
  is its union; `RISK_LABELS` for UI.
- `RiskProfile = Record<RiskType, Unit>` — all five levels for a cell.
- `RiskOverrides = Partial<Record<RiskType, Unit>>` — analyst edits.
- `RiskAppetite = Record<RiskType, Unit>` — tolerance per risk (0 avoid…1
  tolerate). `DEFAULT_APPETITE` = 0.5 each.
- `CellRiskState = { cellId, base, overrides }`; `effectiveProfile` merges them
  (override wins, clamped); `overriddenRisks` lists edited channels for the
  highlight UI.

## Cost (`cost.ts`) — **the one formula everyone shares**

- `CostParams = { appetite, distanceWeightKm, riskWeight }`
  (`DEFAULT_COST_PARAMS`).
- `sensitivity(appetite) = 1 - appetite` — the isolated tuning curve.
- `riskCostBreakdown(profile, params): Record<RiskType, number>` — per-channel
  cost of occupying a cell (drives one stacked bar).
- `cellRiskCost(profile, params): number` — their sum (cell shading + routing).
- `movementCost(km, params): number` — cost of moving between two cell centres.

> Routing and charts **must** use these, never a private copy, so a chart bar
> equals the cost the planner optimised.

## Routing DTOs (`routing.ts`)

- `RouteRequest` — **serialisable**: `{ grid: HexGridDto, risk: Record<CellId,
  RiskProfile> (effective), params: CostParams, waypoints: CellId[] (≥2),
  coaCount }`.
- `CoaCellStep` — `{ cellId, perRisk, movementCost, stepCost }` (one bar).
- `Coa` — `{ id, label, path: CellId[], steps (1:1 with path), totalCost,
  totalDistanceKm, riskTotals }`.
- `RoutePlan` — `{ coas, waypoints, generatedAt }`.
- `RouteWorkerRequest` / `RouteWorkerResponse` — the worker message protocol.

## Ports (`ports.ts`) — the seams

```ts
interface MapGenerator { generate(config: MapGenConfig): TerrainField }
interface GridBuilder  {
  build(extent: WorldExtent, layout: GridLayoutSpec): HexGrid
  sampleTerrain(grid: HexGrid, field: TerrainField): Map<CellId, TerrainSample>
}
interface RiskEngine   { baseProfile(sample: TerrainSample): RiskProfile }
interface RoutePlanner { plan(request: RouteRequest): Promise<RoutePlan>; dispose?(): void }
interface Engine       { mapGenerator; gridBuilder; riskEngine; routePlanner }
```

Each engine module exports a `create*()` returning its port. `Engine` bundles
all four; the store takes one `Engine` and never sees concrete classes. The mock
(`createMockEngine`) and the real wiring (`createEngine`) are interchangeable.

## Invariants checklist (enforced by tests per module)

- Risk levels and appetites stay in `[0, 1]`.
- `parseCellId ∘ toCellId = identity`.
- `effectiveProfile` clamps and prefers overrides.
- Cost is monotonic in risk level and zero at full appetite.
- A `Coa`'s `steps` align 1:1 with `path` and sum to `totalCost`.
- Same seed ⇒ identical field, grid, risks, COAs.
