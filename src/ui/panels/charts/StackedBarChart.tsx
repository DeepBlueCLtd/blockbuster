import type { ReactElement } from 'react';
import type { CellId, Coa } from '@domain';
import { RISK_TYPES } from '@domain';
import { MOVEMENT_COLOR, RISK_COLORS } from '@/ui/theme';

interface Props {
  coa: Coa;
  /** Shared across all three charts so bar heights are comparable. */
  maxStepCost: number;
  selectedCellId: CellId | null;
  onHoverCell: (cellId: CellId | null) => void;
  onSelectCell: (cellId: CellId) => void;
}

const CHART_HEIGHT = 120;
const BAR_WIDTH = 26;
const BAR_GAP = 6;

/**
 * One COA as a row of stacked bars — each bar is one hex cell on the route,
 * segmented by the per-risk cost contribution plus a neutral movement segment.
 */
export function StackedBarChart({ coa, maxStepCost, selectedCellId, onHoverCell, onSelectCell }: Props) {
  const max = maxStepCost > 0 ? maxStepCost : 1;
  const width = Math.max(coa.steps.length * (BAR_WIDTH + BAR_GAP), 1);

  return (
    <svg
      className="coa-chart"
      viewBox={`0 0 ${width} ${CHART_HEIGHT}`}
      preserveAspectRatio="none"
      role="img"
      aria-label={`${coa.label} per-cell risk profile`}
    >
      {coa.steps.map((step, index) => {
        const x = index * (BAR_WIDTH + BAR_GAP);
        let y = CHART_HEIGHT;
        const segments: ReactElement[] = [];

        for (const risk of RISK_TYPES) {
          const height = (step.perRisk[risk] / max) * CHART_HEIGHT;
          if (height <= 0) continue;
          y -= height;
          segments.push(
            <rect key={risk} x={x} y={y} width={BAR_WIDTH} height={height} fill={RISK_COLORS[risk]} />,
          );
        }
        const moveHeight = (step.movementCost / max) * CHART_HEIGHT;
        if (moveHeight > 0) {
          y -= moveHeight;
          segments.push(
            <rect key="move" x={x} y={y} width={BAR_WIDTH} height={moveHeight} fill={MOVEMENT_COLOR} />,
          );
        }

        const isSelected = step.cellId === selectedCellId;
        return (
          <g
            key={`${step.cellId}-${index}`}
            className="coa-bar"
            onMouseEnter={() => onHoverCell(step.cellId)}
            onMouseLeave={() => onHoverCell(null)}
            onClick={() => onSelectCell(step.cellId)}
          >
            {segments}
            {isSelected ? (
              <rect
                x={x - 1}
                y={0}
                width={BAR_WIDTH + 2}
                height={CHART_HEIGHT}
                fill="none"
                stroke="#111"
                strokeWidth={1.5}
              />
            ) : null}
          </g>
        );
      })}
    </svg>
  );
}
