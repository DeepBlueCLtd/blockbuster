# 04 · Engine — Hex grid

**Port:** `GridBuilder` · **Files:** `src/engine/hexgrid/` · **Reference impl:**
`src/mocks/hexMath.ts` + `createMockGridBuilder` · **Depends on:** `@domain` only.

## Purpose

Lay a hex grid over the world and sample terrain into its cells. Owns all hex
geometry and topology — the substrate the risk model and routing run on.

## Contract

```ts
createGridBuilder(): GridBuilder
GridBuilder.build(extent: WorldExtent, layout: GridLayoutSpec): HexGrid
GridBuilder.sampleTerrain(grid: HexGrid, field: TerrainField): Map<CellId, TerrainSample>
```

`HexGrid` must implement: `cells`, `get`, `neighbors`, `distance` (hex/cube
steps), `pointToCell`, plus `layout`/`extent`. `HexCell` carries `center` and 6
`vertices` in world space for rendering.

## Design guidance

- Pointy-top axial coordinates by default (matches the mock and the projection).
  Support `flat` too if cheap.
- Build by deriving an axial bounding box from the four world corners, iterating,
  and **keeping cells whose centre lies inside the extent** (clean ragged edge).
- Provide O(1) `get`, O(6) `neighbors`, O(1) `distance`, O(1) `pointToCell`
  (axial round). Index cells by id in a `Map`.
- Pixel↔hex and corner maths are standard (Red Blob Games); the mock has correct
  formulas you can lift and harden.
- Derive a default `size` from a target cell count when asked (`DEFAULT_CELL_COUNT`),
  so the "tunable size, default ≈100 cells" requirement holds.

## Acceptance criteria (`hexgrid.test.ts`)

- Default size over default extent ⇒ **≈100 cells** (e.g. 80–120).
- `neighbors` symmetric (`b ∈ neighbors(a) ⇔ a ∈ neighbors(b)`); interior cells
  have 6.
- `distance` equals cube distance and is symmetric; neighbours are distance 1.
- `pointToCell(cell.center) === cell.id` for every cell.
- All centres inside the extent; ids unique.
- Determinism: geometry depends only on `extent` + `layout`.

## Build in isolation

Pure maths against `@domain`. Use a `TerrainField` from `createMockMapGenerator`
(or a constant field) to exercise `sampleTerrain`. Performance test at a few
hundred cells.

## Open questions

- Edge cells partially outside the extent: keep (centre-in rule) or clip
  polygons? v1: keep, render may clip visually.
