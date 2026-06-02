import type {
  CellId,
  GridBuilder,
  GridLayoutSpec,
  HexGrid,
  TerrainField,
  TerrainSample,
  WorldExtent,
} from '@domain';

/**
 * HEX GRID MODULE — owner-implemented.
 *
 * Build a {@link HexGrid} clipped to the extent and sample a terrain field into
 * its cells. Standard axial maths; see docs/spec/04-engine-hexgrid.md. A working
 * stand-in lives in `src/mocks/hexMath.ts` + `createMockGridBuilder`.
 */
export function createGridBuilder(): GridBuilder {
  return {
    build(_extent: WorldExtent, _layout: GridLayoutSpec): HexGrid {
      throw new Error('hexgrid: not implemented — see docs/spec/04-engine-hexgrid.md');
    },
    sampleTerrain(_grid: HexGrid, _field: TerrainField): Map<CellId, TerrainSample> {
      throw new Error('hexgrid: not implemented — see docs/spec/04-engine-hexgrid.md');
    },
  };
}
