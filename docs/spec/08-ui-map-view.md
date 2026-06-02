# 08 · UI — Map view

**Files:** `src/ui/map/{MapView,HexGridLayer,RouteLayer,MapToolbar,projection}.tsx`
· **Stack:** React + Leaflet (`react-leaflet`) · **Depends on:** `@domain` +
store. **Never imports the engine.**

## Purpose

The left pane: render the world, the hex grid (shaded by risk), the COA routes
and waypoints, and turn map gestures into store actions.

## Why Leaflet + `CRS.Simple`

The world is a fictitious flat rectangle in kilometres, not a geographic map, so
we use `L.CRS.Simple`. A world point `(x, y)` maps to Leaflet `LatLng` `[y, x]`
via `projection.ts`. Bounds are `[[0,0],[height,width]]`. Leaflet gives pan/zoom,
layering and hit-testing for free.

> ⚠️ Orientation: Leaflet screen-y grows downward. If the map renders flipped,
> negate `y` in `worldToLatLng` and adjust bounds. Finalise this here.

## Components (scaffolded; refine)

- **`MapView`** — `MapContainer` (crs `Simple`, fitted to bounds) hosting the
  layers + the toolbar overlay.
- **`HexGridLayer`** — one `<Polygon>` per cell from `cell.vertices`, filled by
  `heatColor(intensity)` where intensity is the selected single risk or the
  normalised composite cost (`selectCellCost`). Stroke marks selection / hover /
  waypoint. Handlers: `click → selectCell`, `mouseover/out → hoverCell`.
- **`RouteLayer`** — a `<Polyline>` per COA (selected one emphasised) along cell
  centres; `<CircleMarker>` + tooltip per waypoint (Start/WPn/End).
- **`MapToolbar`** — floating controls: shade-by (composite or a single risk),
  hex-size slider, live cell count / planning indicator.

## Interactions

- Click a hex → select it (drives the Cell inspector).
- Hover a hex → cross-highlight the matching bar in the COA charts (and vice
  versa) via `hoveredCellId`.
- Add/remove waypoints from the inspector (kept out of raw map clicks to avoid
  mode confusion); the layer re-plans through the store.
- Shade-by + hex-size live-update.

## Acceptance criteria

- Renders ≈100 polygons smoothly; pan/zoom fluid.
- Shading matches the selected channel; legend/heat reads correctly.
- Selected COA is visually distinct; waypoints clearly marked in order.
- Selection/hover round-trip with the COA panel.
- No engine import; all data via store selectors.

## Build in isolation

Point the store at the mock (default) or render against `src/mocks/fixtures.ts`
directly in a stub. You can build the whole pane before any real engine exists.

## Performance notes

- At higher cell counts, consider Leaflet's canvas renderer
  (`preferCanvas`/`L.canvas`) or a single canvas overlay instead of per-cell
  SVG polygons. The `MapView` interface stays the same.
- Memoise per-cell style; avoid re-styling all cells on every hover if it bites
  (e.g. move hover highlight to a separate lightweight layer).

## Open questions

- Show the underlying terrain (biome colours) as a base layer beneath the risk
  shading toggle? Nice-to-have; `BIOME_COLORS` already exists in `theme.ts`.
- Per-cell mini risk table on the map itself (vs only in the inspector)? The brief
  mentions it; v1 puts the full table in the inspector and uses shading on the
  map. Revisit if analysts want at-a-glance tables (e.g. at high zoom).
