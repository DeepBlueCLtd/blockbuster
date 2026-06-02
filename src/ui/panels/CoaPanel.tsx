import { RISK_LABELS, RISK_TYPES } from '@domain';
import { useBlockbusterStore } from '@/state/store';
import { RISK_COLORS } from '@/ui/theme';
import { StackedBarChart } from './charts/StackedBarChart';

/** The "COAs" tab: three vertically-stacked, y-aligned per-cell cost charts. */
export function CoaPanel() {
  const plan = useBlockbusterStore((s) => s.plan);
  const planning = useBlockbusterStore((s) => s.planning);
  const selectedCoaId = useBlockbusterStore((s) => s.selectedCoaId);
  const selectCoa = useBlockbusterStore((s) => s.selectCoa);
  const selectedCellId = useBlockbusterStore((s) => s.selectedCellId);
  const hoverCell = useBlockbusterStore((s) => s.hoverCell);
  const selectCell = useBlockbusterStore((s) => s.selectCell);

  if (!plan || plan.coas.length === 0) {
    return (
      <div className="panel">
        <p className="panel-hint">
          {planning
            ? 'Planning routes…'
            : 'Select at least two cells as waypoints (via the inspector) to generate COAs.'}
        </p>
      </div>
    );
  }

  const maxStep = plan.coas.reduce(
    (outer, coa) => coa.steps.reduce((inner, step) => Math.max(inner, step.stepCost), outer),
    0,
  );

  return (
    <div className="panel coa-panel">
      <RiskLegend />
      {plan.coas.map((coa) => (
        <section
          key={coa.id}
          className={coa.id === selectedCoaId ? 'coa coa-selected' : 'coa'}
          onClick={() => selectCoa(coa.id)}
        >
          <header className="coa-head">
            <span className="coa-title">{coa.label}</span>
            <span className="coa-meta">
              {coa.totalCost.toFixed(0)} cost · {coa.totalDistanceKm.toFixed(1)} km · {coa.path.length} cells
            </span>
          </header>
          <StackedBarChart
            coa={coa}
            maxStepCost={maxStep}
            selectedCellId={selectedCellId}
            onHoverCell={hoverCell}
            onSelectCell={selectCell}
          />
        </section>
      ))}
    </div>
  );
}

function RiskLegend() {
  return (
    <div className="legend">
      {RISK_TYPES.map((risk) => (
        <span key={risk} className="legend-item">
          <i style={{ background: RISK_COLORS[risk] }} />
          {RISK_LABELS[risk]}
        </span>
      ))}
    </div>
  );
}
