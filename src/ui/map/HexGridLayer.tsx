import { useMemo } from 'react';
import { Pane, Polygon } from 'react-leaflet';
import type { LeafletEventHandlerFnMap } from 'leaflet';
import { applyZoneOffsets, cellRiskCost, effectiveProfile } from '@domain';
import { useBlockbusterStore } from '@/state/store';
import { heatColor } from '@/ui/theme';
import { worldRingToLatLng } from './projection';

/** Renders the hex grid as Leaflet polygons, shaded by the active risk view. */
export function HexGridLayer() {
  const grid = useBlockbusterStore((s) => s.grid);
  const showHexGrid = useBlockbusterStore((s) => s.showHexGrid);
  const riskStates = useBlockbusterStore((s) => s.riskStates);
  const displayRisk = useBlockbusterStore((s) => s.displayRisk);
  const costParams = useBlockbusterStore((s) => s.costParams);
  const zoneContribution = useBlockbusterStore((s) => s.zoneContribution);
  const selectedCellId = useBlockbusterStore((s) => s.selectedCellId);
  const hoveredCellId = useBlockbusterStore((s) => s.hoveredCellId);
  const waypoints = useBlockbusterStore((s) => s.waypoints);
  const drawMode = useBlockbusterStore((s) => s.drawMode);
  const selectCell = useBlockbusterStore((s) => s.selectCell);
  const hoverCell = useBlockbusterStore((s) => s.hoverCell);

  const maxCost = useMemo(() => {
    let max = 1e-6;
    for (const state of riskStates.values()) {
      const eff = applyZoneOffsets(effectiveProfile(state), zoneContribution.get(state.cellId));
      max = Math.max(max, cellRiskCost(eff, costParams));
    }
    return max;
  }, [riskStates, costParams, zoneContribution]);

  if (!grid || !showHexGrid) return null;
  const waypointSet = new Set(waypoints);
  // While an extra-risk draw tool is armed, taps must not select or hover a
  // cell — on touch devices the click-through CSS (pointer-events: none) does
  // not stop the polygon's own click, so a tap would otherwise select a cell
  // instead of starting the shape. Disarming the handlers makes drawing behave
  // identically on mouse and touch; Terra Draw still receives the gesture at the
  // map-container level. See ExtraRiskDraw / app.css `.leaflet-drawing`.
  const drawing = drawMode !== null;

  // Own pane (below the pie + route panes) so the stack order survives toggling
  // the grid off and on — Leaflet otherwise paints by DOM insertion order.
  return (
    <Pane name="hexgrid" style={{ zIndex: 410 }}>
      {grid.cells.map((cell) => {
        const state = riskStates.get(cell.id);
        const eff = state
          ? applyZoneOffsets(effectiveProfile(state), zoneContribution.get(cell.id))
          : null;
        const intensity = !eff
          ? 0
          : displayRisk === 'composite'
            ? cellRiskCost(eff, costParams) / maxCost
            : eff[displayRisk];

        const isSelected = cell.id === selectedCellId;
        const isHovered = cell.id === hoveredCellId;
        const isWaypoint = waypointSet.has(cell.id);

        const handlers: LeafletEventHandlerFnMap = drawing
          ? {}
          : {
              click: () => selectCell(cell.id),
              mouseover: () => hoverCell(cell.id),
              mouseout: () => hoverCell(null),
            };

        return (
          <Polygon
            key={cell.id}
            positions={worldRingToLatLng(cell.vertices)}
            eventHandlers={handlers}
            pathOptions={{
              color: isSelected ? '#111' : isWaypoint ? '#0d47a1' : 'rgba(60,60,60,0.35)',
              weight: isSelected || isWaypoint ? 3 : isHovered ? 2 : 1,
              fillColor: heatColor(intensity),
              fillOpacity: isHovered ? 0.75 : 0.55,
            }}
          />
        );
      })}
    </Pane>
  );
}
