import { useMemo } from 'react';
import { Pane, Polygon } from 'react-leaflet';
import { riskCostBreakdown } from '@domain';
import { selectDisplayProfile, useBlockbusterStore } from '@/state/store';
import { RISK_COLORS } from '@/ui/theme';
import { worldRingToLatLng } from './projection';
import { BAR_RADIUS_FRACTION, cellInradius, riskBarRects } from './pie';

/**
 * Optional overlay: each hex drawn as a 5-column grouped bar chart whose bar
 * heights are the *absolute* per-risk cost values (not proportions). The
 * tallest bar in each cell fills the available radius so bar heights within a
 * cell are directly comparable between risk channels.
 *
 * Non-interactive, so clicks/hover fall through to {@link HexGridLayer}.
 * Toggled by `store.showRiskBars`.
 */
export function RiskBarLayer() {
  const grid = useBlockbusterStore((s) => s.grid);
  const showRiskBars = useBlockbusterStore((s) => s.showRiskBars);
  const riskStates = useBlockbusterStore((s) => s.riskStates);
  const zoneContribution = useBlockbusterStore((s) => s.zoneContribution);
  const zones = useBlockbusterStore((s) => s.zones);
  const displayTime = useBlockbusterStore((s) => s.displayTime);
  const dayNight = useBlockbusterStore((s) => s.dayNight);
  const journeyParams = useBlockbusterStore((s) => s.journeyParams);
  const costParams = useBlockbusterStore((s) => s.costParams);
  const extent = useBlockbusterStore((s) => s.extent);
  const hexSize = useBlockbusterStore((s) => s.hexSize);

  const bars = useMemo(() => {
    if (!grid || !showRiskBars) return [];
    const profileCtx = { riskStates, zoneContribution, zones, displayTime, dayNight, journeyParams, extent, hexSize };
    return grid.cells.flatMap((cell) => {
      const eff = selectDisplayProfile(profileCtx, cell.id, cell.vertices);
      if (!eff) return [];
      const breakdown = riskCostBreakdown(eff, costParams);
      const radius = cellInradius(cell.center, cell.vertices) * BAR_RADIUS_FRACTION;
      return riskBarRects(cell.center, radius, breakdown).map((rect) => ({
        key: `${cell.id}-${rect.risk}`,
        color: RISK_COLORS[rect.risk],
        positions: worldRingToLatLng(rect.ring),
      }));
    });
  }, [grid, showRiskBars, riskStates, zoneContribution, zones, displayTime, dayNight, journeyParams, costParams, extent, hexSize]);

  if (bars.length === 0) return null;

  return (
    <Pane name="riskbars" style={{ zIndex: 421 }}>
      {bars.map((bar) => (
        <Polygon
          key={bar.key}
          positions={bar.positions}
          pathOptions={{
            stroke: true,
            color: '#ffffff',
            weight: 0.5,
            opacity: 0.7,
            fillColor: bar.color,
            fillOpacity: 0.9,
            interactive: false,
          }}
        />
      ))}
    </Pane>
  );
}
