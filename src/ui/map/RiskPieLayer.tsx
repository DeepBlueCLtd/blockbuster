import { useMemo } from 'react';
import { Polygon } from 'react-leaflet';
import { effectiveProfile, riskCostBreakdown } from '@domain';
import { useBlockbusterStore } from '@/state/store';
import { RISK_COLORS } from '@/ui/theme';
import { worldRingToLatLng } from './projection';
import { cellInradius, PIE_RADIUS_FRACTION, riskPieSlices } from './pie';

/**
 * Optional overlay: each hex drawn as a pie whose slices are the per-risk shares
 * of that cell's cost. The breakdown comes from `riskCostBreakdown`, so the
 * slices re-proportion live as the appetite sliders move. Non-interactive, so
 * clicks/hover fall through to {@link HexGridLayer} beneath. Toggled by
 * `store.showRiskPies`.
 */
export function RiskPieLayer() {
  const grid = useBlockbusterStore((s) => s.grid);
  const showRiskPies = useBlockbusterStore((s) => s.showRiskPies);
  const riskStates = useBlockbusterStore((s) => s.riskStates);
  const costParams = useBlockbusterStore((s) => s.costParams);

  const pies = useMemo(() => {
    if (!grid || !showRiskPies) return [];
    return grid.cells.flatMap((cell) => {
      const state = riskStates.get(cell.id);
      if (!state) return [];
      const breakdown = riskCostBreakdown(effectiveProfile(state), costParams);
      const radius = cellInradius(cell.center, cell.vertices) * PIE_RADIUS_FRACTION;
      return riskPieSlices(cell.center, radius, breakdown).map((slice) => ({
        key: `${cell.id}-${slice.risk}`,
        color: RISK_COLORS[slice.risk],
        positions: worldRingToLatLng(slice.ring),
      }));
    });
  }, [grid, showRiskPies, riskStates, costParams]);

  if (pies.length === 0) return null;

  return (
    <>
      {pies.map((pie) => (
        <Polygon
          key={pie.key}
          positions={pie.positions}
          pathOptions={{
            stroke: true,
            color: '#ffffff',
            weight: 0.5,
            opacity: 0.7,
            fillColor: pie.color,
            fillOpacity: 0.9,
            interactive: false,
          }}
        />
      ))}
    </>
  );
}
