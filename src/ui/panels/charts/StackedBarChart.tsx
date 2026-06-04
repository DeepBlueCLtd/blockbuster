import type { ReactElement } from 'react';
import type { CellId, Coa } from '@domain';
import { RISK_TYPES } from '@domain';
import { RISK_COLORS } from '@/ui/theme';
import { formatTime } from '@/ui/utils/time';

interface Props {
  coa: Coa;
  /** Largest per-cell risk total across all COAs, so bar heights are comparable. */
  maxRiskCost: number;
  highlightedCellId: CellId | null;
  onHoverCell: (cellId: CellId | null) => void;
  /**
   * When both are provided and `timeEnd > timeStart`, bars are placed on a shared
   * time axis: x-position = entry time, width = transit time through that cell.
   * The axis uses raw minutes (no midnight wrap) so it spans fractional days
   * correctly. Omit to fall back to equal-width mode (e.g. mock/no timing data).
   */
  timeStart?: number;
  timeEnd?: number;
}

const CHART_H = 120;
const SVG_W = 1000; // viewBox width; stretched to container by preserveAspectRatio="none"
const MIN_BAR = 6;  // minimum bar width in viewBox units

// Equal-width fallback constants
const BAR_WIDTH = 26;
const BAR_GAP = 6;

/**
 * One COA as a row of stacked bars — each bar is one hex cell, segmented by its
 * per-risk cost. In time-axis mode the bars are positioned and sized by the
 * group's actual transit time, letting all three COA charts share an x axis.
 */
export function StackedBarChart({ coa, maxRiskCost, highlightedCellId, onHoverCell, timeStart, timeEnd }: Props) {
  const max = maxRiskCost > 0 ? maxRiskCost : 1;
  const hasTimeAxis = timeStart !== undefined && timeEnd !== undefined && timeEnd > timeStart;

  if (!hasTimeAxis) {
    // --- Equal-width fallback ---
    const width = Math.max(coa.steps.length * (BAR_WIDTH + BAR_GAP), 1);
    return (
      <svg
        className="coa-chart"
        viewBox={`0 0 ${width} ${CHART_H}`}
        preserveAspectRatio="none"
        role="img"
        aria-label={`${coa.label} per-cell risk profile`}
      >
        {coa.steps.map((step, index) => {
          const x = index * (BAR_WIDTH + BAR_GAP);
          let y = CHART_H;
          const segments: ReactElement[] = [];
          for (const risk of RISK_TYPES) {
            const height = (step.perRisk[risk] / max) * CHART_H;
            if (height <= 0) continue;
            y -= height;
            segments.push(
              <rect key={risk} x={x} y={y} width={BAR_WIDTH} height={height} fill={RISK_COLORS[risk]} />,
            );
          }
          const isHighlighted = step.cellId === highlightedCellId;
          return (
            <g
              key={`${step.cellId}-${index}`}
              className="coa-bar"
              onMouseEnter={() => onHoverCell(step.cellId)}
              onMouseLeave={() => onHoverCell(null)}
              onClick={() => onHoverCell(step.cellId)}
            >
              {segments}
              {isHighlighted ? (
                <rect x={x - 1} y={0} width={BAR_WIDTH + 2} height={CHART_H}
                  fill="none" stroke="#111" strokeWidth={1.5} />
              ) : null}
            </g>
          );
        })}
      </svg>
    );
  }

  // --- Time-axis mode ---
  const duration = timeEnd! - timeStart!;

  // Bars for steps 1..n: each bar spans [steps[i-1].arrival, steps[i].arrival].
  // Step 0 is the starting cell (zero transit time) — not rendered as a bar since
  // it has no width on a time axis; its risk is small relative to transit cells.
  const bars = coa.steps.slice(1).map((step, idx) => {
    const i = idx + 1;
    const entryTime = coa.steps[i - 1]!.arrivalTimeMinutes;
    const exitTime = step.arrivalTimeMinutes;
    const x = ((entryTime - timeStart!) / duration) * SVG_W;
    const barW = Math.max(MIN_BAR, ((exitTime - entryTime) / duration) * SVG_W);

    let y = CHART_H;
    const segments: ReactElement[] = [];
    for (const risk of RISK_TYPES) {
      const height = (step.perRisk[risk] / max) * CHART_H;
      if (height <= 0) continue;
      y -= height;
      segments.push(
        <rect key={risk} x={x} y={y} width={barW} height={height} fill={RISK_COLORS[risk]} />,
      );
    }

    const isHighlighted = step.cellId === highlightedCellId;
    return (
      <g
        key={`${step.cellId}-${i}`}
        className="coa-bar"
        onMouseEnter={() => onHoverCell(step.cellId)}
        onMouseLeave={() => onHoverCell(null)}
        onClick={() => onHoverCell(step.cellId)}
      >
        {segments}
        {isHighlighted ? (
          <rect x={x - 1} y={0} width={barW + 2} height={CHART_H}
            fill="none" stroke="#111" strokeWidth={1.5} />
        ) : null}
      </g>
    );
  });

  // Dashed vertical at this COA's arrival time so you can see where it ends
  // relative to the slowest COA's arrival (which reaches the right edge).
  const arrivalX = ((coa.arrivalTimeMinutes - timeStart!) / duration) * SVG_W;

  return (
    <div className="coa-chart-timed">
      <svg
        className="coa-chart"
        viewBox={`0 0 ${SVG_W} ${CHART_H}`}
        preserveAspectRatio="none"
        role="img"
        aria-label={`${coa.label} per-cell risk profile on time axis`}
      >
        {bars}
        <line
          x1={arrivalX} y1={0} x2={arrivalX} y2={CHART_H}
          stroke="currentColor" strokeWidth={2} strokeDasharray="6 4" opacity={0.35}
        />
      </svg>
      <div className="coa-axis">
        <span>{formatTime(timeStart!)}</span>
        <span>{formatTime(timeEnd!)}</span>
      </div>
    </div>
  );
}
