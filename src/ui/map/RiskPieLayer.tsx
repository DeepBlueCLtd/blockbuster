import { useMemo } from 'react';
import { Pane, Polygon } from 'react-leaflet';
import { riskCostBreakdown } from '@domain';
import { selectDisplayProfile, useBlockbusterStore } from '@/state/store';
import { RISK_COLORS } from '@/ui/theme';
import { worldRingToLatLng } from './projection';
import { cellInradius, PIE_RADIUS_FRACTION, riskPieSlices } from './pie';

/**
 * Optional overlay: each hex drawn as a pie whose slices are the per-risk shares
 * of that cell's cost. The breakdown comes from `riskCostBreakdown` of the
 * zone-adjusted profile, so the slices re-proportion live as the appetite
 * sliders move or extra-risk zones change. Non-interactive, so clicks/hover fall
 * through to {@link HexGridLayer} beneath. Toggled by `store.showRiskPies`.
 */
export function RiskPieLayer() {
  const grid = useBlockbusterStore((s) => s.grid);
  const showRiskPies = useBlockbusterStore((s) => s.showRiskPies);
  const riskStates = useBlockbusterStore((s) => s.riskStates);
  const zoneContribution = useBlockbusterStore((s) => s.zoneContribution);
  const zones = useBlockbusterStore((s) => s.zones);
  const displayTime = useBlockbusterStore((s) => s.displayTime);
  const dayNight = useBlockbusterStore((s) => s.dayNight);
  const journeyParams = useBlockbusterStore((s) => s.journeyParams);
  const costParams = useBlockbusterStore((s) => s.costParams);

  const pies = useMemo(() => {
    if (!grid || !showRiskPies) return [];
    const profileCtx = { riskStates, zoneContribution, zones, displayTime, dayNight, journeyParams };
    return grid.cells.flatMap((cell) => {
      const eff = selectDisplayProfile(profileCtx, cell.id, cell.vertices);
      if (!eff) return [];
      const breakdown = riskCostBreakdown(eff, costParams);
      const radius = cellInradius(cell.center, cell.vertices) * PIE_RADIUS_FRACTION;
      return riskPieSlices(cell.center, radius, breakdown).map((slice) => ({
        key: `${cell.id}-${slice.risk}`,
        color: RISK_COLORS[slice.risk],
        positions: worldRingToLatLng(slice.ring),
      }));
    });
  }, [grid, showRiskPies, riskStates, zoneContribution, zones, displayTime, dayNight, journeyParams, costParams]);

  if (pies.length === 0) return null;

  // Dedicated pane above the hex grid so the pies always sit on top of the
  // shading, regardless of the order layers happen to (re)mount in.
  return (
    <Pane name="riskpies" style={{ zIndex: 420 }}>
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
    </Pane>
  );
}
