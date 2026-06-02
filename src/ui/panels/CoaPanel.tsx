import { RISK_LABELS, RISK_TYPES } from '@domain';
import { useBlockbusterStore } from '@/state/store';
import { RISK_COLORS } from '@/ui/theme';
import { StackedBarChart } from './charts/StackedBarChart';

/** The "COAs" tab: the three per-cell cost charts for the generated routes. */
export function CoaPanel() {
  const plan = useBlockbusterStore((s) => s.plan);
  const planning = useBlockbusterStore((s) => s.planning);
  const selectedCoaId = useBlockbusterStore((s) => s.selectedCoaId);
  const selectCoa = useBlockbusterStore((s) => s.selectCoa);
  const selectedCellId = useBlockbusterStore((s) => s.selectedCellId);
  const hoverCell = useBlockbusterStore((s) => s.hoverCell);
  const selectCell = useBlockbusterStore((s) => s.selectCell);

  const hasPlan = !!plan && plan.coas.length > 0;
  const maxStep = hasPlan
    ? plan.coas.reduce(
        (outer, coa) => coa.steps.reduce((inner, step) => Math.max(inner, step.stepCost), outer),
        0,
      )
    : 0;

  return (
    <div className="panel coa-panel">
      {!hasPlan ? (
        <p className="panel-hint">
          {planning
            ? 'Planning routes…'
            : 'No routes yet. Add at least two waypoints on the Waypoints tab.'}
        </p>
      ) : (
        <>
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
                  {coa.totalCost.toFixed(0)} cost · {coa.totalDistanceKm.toFixed(1)} km ·{' '}
                  {coa.path.length} cells
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
        </>
      )}
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
