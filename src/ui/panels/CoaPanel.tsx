import { RISK_LABELS, RISK_TYPES } from '@domain';
import { useBlockbusterStore } from '@/state/store';
import { RISK_COLORS } from '@/ui/theme';
import { Slider } from '@/ui/components/Slider';
import { StackedBarChart } from './charts/StackedBarChart';

/** The "COAs" tab: the risk-appetite sliders plus the per-cell cost charts. */
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
      <AppetiteSliders />
      {!hasPlan ? (
        <p className="panel-hint">
          {planning
            ? 'Planning routes…'
            : 'No routes yet. Add at least two waypoints on the Waypoints tab.'}
        </p>
      ) : (
        plan.coas.map((coa) => (
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
        ))
      )}
    </div>
  );
}

/**
 * One vertical slider per risk channel. Adjusting any of them re-plans the
 * routes, so the COA charts below update live. The colour-coded labels double as
 * the chart key, which is why the COAs tab no longer needs a separate legend.
 */
function AppetiteSliders() {
  const appetite = useBlockbusterStore((s) => s.costParams.appetite);
  const setAppetite = useBlockbusterStore((s) => s.setAppetite);

  return (
    <section className="appetite">
      <h2 className="appetite-title">Risk appetite</h2>
      <div className="appetite-sliders" role="group" aria-label="Risk appetite">
        {RISK_TYPES.map((risk) => (
          <Slider
            key={risk}
            orientation="vertical"
            label={RISK_LABELS[risk]}
            color={RISK_COLORS[risk]}
            value={appetite[risk]}
            onChange={(value) => setAppetite(risk, value)}
            hint={appetite[risk] < 0.34 ? 'Avoid' : appetite[risk] > 0.66 ? 'Tolerant' : 'Balanced'}
          />
        ))}
      </div>
    </section>
  );
}
