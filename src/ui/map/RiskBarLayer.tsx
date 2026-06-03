import { useMemo } from 'react';
import { Pane, Polygon } from 'react-leaflet';
import { applyZoneOffsets, effectiveProfile, riskCostBreakdown } from '@domain';
import { useBlockbusterStore } from '@/state/store';
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
  const costParams = useBlockbusterStore((s) => s.costParams);

  const bars = useMemo(() => {
    if (!grid || !showRiskBars) return [];
    return grid.cells.flatMap((cell) => {
      const state = riskStates.get(cell.id);
      if (!state) return [];
      const eff = applyZoneOffsets(effectiveProfile(state), zoneContribution.get(cell.id));
      const breakdown = riskCostBreakdown(eff, costParams);
      const radius = cellInradius(cell.center, cell.vertices) * BAR_RADIUS_FRACTION;
      return riskBarRects(cell.center, radius, breakdown).map((rect) => ({
        key: `${cell.id}-${rect.risk}`,
        color: RISK_COLORS[rect.risk],
        positions: worldRingToLatLng(rect.ring),
      }));
    });
  }, [grid, showRiskBars, riskStates, zoneContribution, costParams]);

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
