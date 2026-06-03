import { useMemo } from 'react';
import { Pane, Polygon } from 'react-leaflet';
import { applyZoneOffsets, effectiveProfile, riskCostBreakdown, RISK_TYPES } from '@domain';
import { useBlockbusterStore } from '@/state/store';
import { RISK_COLORS } from '@/ui/theme';
import { worldRingToLatLng } from './projection';
import { BAR_RADIUS_FRACTION, cellInradius, riskStackRects } from './pie';

/**
 * Optional overlay: each hex drawn as a single stacked bar where each segment
 * is a risk channel. Heights are *absolute* cost values normalised against the
 * maximum total across all cells, so it is easy to compare overall risk between
 * cells. Segments stack bottom-to-top in canonical {@link RISK_TYPES} order.
 *
 * Non-interactive, so clicks/hover fall through to {@link HexGridLayer}.
 * Toggled by `store.showRiskStacks`.
 */
export function RiskStackLayer() {
  const grid = useBlockbusterStore((s) => s.grid);
  const showRiskStacks = useBlockbusterStore((s) => s.showRiskStacks);
  const riskStates = useBlockbusterStore((s) => s.riskStates);
  const zoneContribution = useBlockbusterStore((s) => s.zoneContribution);
  const costParams = useBlockbusterStore((s) => s.costParams);

  const stacks = useMemo(() => {
    if (!grid || !showRiskStacks) return [];

    // First pass: compute every cell's breakdown and find the global max total
    // so stack heights are comparable across the entire map.
    const cellData: Array<{
      id: string;
      center: { x: number; y: number };
      radius: number;
      breakdown: Record<string, number>;
    }> = [];
    let maxTotal = 0;

    for (const cell of grid.cells) {
      const state = riskStates.get(cell.id);
      if (!state) continue;
      const eff = applyZoneOffsets(effectiveProfile(state), zoneContribution.get(cell.id));
      const breakdown = riskCostBreakdown(eff, costParams);
      let total = 0;
      for (const risk of RISK_TYPES) total += Math.max(0, breakdown[risk]);
      if (total <= 0) continue;
      if (total > maxTotal) maxTotal = total;
      cellData.push({
        id: cell.id,
        center: cell.center,
        radius: cellInradius(cell.center, cell.vertices) * BAR_RADIUS_FRACTION,
        breakdown,
      });
    }

    // Second pass: build the rectangles using the shared maxTotal.
    return cellData.flatMap((cd) =>
      riskStackRects(cd.center, cd.radius, cd.breakdown, maxTotal).map((rect) => ({
        key: `${cd.id}-${rect.risk}`,
        color: RISK_COLORS[rect.risk],
        positions: worldRingToLatLng(rect.ring),
      })),
    );
  }, [grid, showRiskStacks, riskStates, zoneContribution, costParams]);

  if (stacks.length === 0) return null;

  return (
    <Pane name="riskstacks" style={{ zIndex: 422 }}>
      {stacks.map((seg) => (
        <Polygon
          key={seg.key}
          positions={seg.positions}
          pathOptions={{
            stroke: true,
            color: '#ffffff',
            weight: 0.5,
            opacity: 0.7,
            fillColor: seg.color,
            fillOpacity: 0.9,
            interactive: false,
          }}
        />
      ))}
    </Pane>
  );
}
