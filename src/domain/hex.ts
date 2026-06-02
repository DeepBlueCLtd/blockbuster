import type { Km } from './units';
import type { WorldExtent, WorldPoint } from './world';

/**
 * Hex grids use axial coordinates `(q, r)`; the third cube coordinate is always
 * `s = -q - r`. See https://www.redblobgames.com/grids/hexagons/ for the maths
 * the Hex Grid module implements.
 */
export interface Axial {
  q: number;
  r: number;
}

export type HexOrientation = 'pointy' | 'flat';

/**
 * Canonical, serialisable cell identifier. Always `"${q},${r}"`. Use
 * {@link toCellId} / {@link parseCellId} rather than building the string by hand
 * so the format stays in one place.
 */
export type CellId = string & { readonly __brand: 'CellId' };

export function toCellId(coord: Axial): CellId {
  return `${coord.q},${coord.r}` as CellId;
}

export function parseCellId(id: CellId): Axial {
  const comma = id.indexOf(',');
  return { q: Number(id.slice(0, comma)), r: Number(id.slice(comma + 1)) };
}

/** Geometry of the grid: how big the hexes are and where the grid is anchored. */
export interface HexLayout {
  orientation: HexOrientation;
  /** Circumradius (centre-to-vertex) in kilometres. */
  size: Km;
  /** World-space anchor for axial (0, 0). */
  origin: WorldPoint;
}

/** A single hex cell with its precomputed world-space geometry. */
export interface HexCell {
  id: CellId;
  coord: Axial;
  center: WorldPoint;
  /** Six vertices in world space, ordered for polygon rendering. */
  vertices: readonly WorldPoint[];
}

/**
 * The grid as consumed by every downstream module. Implementations precompute
 * `cells` and expose O(1)/O(6) neighbourhood queries.
 */
export interface HexGrid {
  readonly layout: HexLayout;
  readonly extent: WorldExtent;
  readonly cells: readonly HexCell[];
  /** Look up a cell by id. */
  get(id: CellId): HexCell | undefined;
  /** The up-to-six in-grid neighbours of a cell. */
  neighbors(id: CellId): CellId[];
  /** Hex (graph) distance in steps between two cells. */
  distance(a: CellId, b: CellId): number;
  /** Which cell, if any, contains a world point. */
  pointToCell(point: WorldPoint): CellId | undefined;
}

/**
 * Flat, structured-clone-friendly projection of a {@link HexGrid} for crossing
 * the Web Worker boundary. Methods/closures cannot be cloned, so the routing
 * worker reconstructs adjacency from this DTO.
 */
export interface HexGridDto {
  layout: HexLayout;
  extent: WorldExtent;
  cells: Array<{ id: CellId; q: number; r: number; center: WorldPoint }>;
}

/** Project a live grid to its serialisable DTO (for the routing worker). */
export function toHexGridDto(grid: HexGrid): HexGridDto {
  return {
    layout: grid.layout,
    extent: grid.extent,
    cells: grid.cells.map((cell) => ({
      id: cell.id,
      q: cell.coord.q,
      r: cell.coord.r,
      center: cell.center,
    })),
  };
}

/**
 * Default hex size, chosen so the default 50 km × 30 km world yields ≈100 cells
 * (the brief's default). Area per pointy-top hex = (3√3 / 2)·size²; 1500 km² / 100
 * ⇒ ≈15 km²/cell ⇒ size ≈ 2.4 km.
 */
export const DEFAULT_HEX_SIZE_KM: Km = 2.4;

/** Target cell count used when deriving a hex size from the extent. */
export const DEFAULT_CELL_COUNT = 100;
