import type { CSSProperties } from 'react';
import { RISK_LABELS, RISK_TYPES, SPEED_MAX_KMH, SPEED_MIN_KMH, type RiskType } from '@domain';
import { useBlockbusterStore } from '@/state/store';
import { coaColor, RISK_COLORS } from '@/ui/theme';
import { formatTime } from '@/ui/utils/time';
import { Slider } from '@/ui/components/Slider';
import { StackedBarChart } from './charts/StackedBarChart';

/** The "COAs" tab: the risk-appetite sliders plus the per-cell cost charts. */
export function CoaPanel() {
  const plan = useBlockbusterStore((s) => s.plan);
  const planning = useBlockbusterStore((s) => s.planning);
  const selectedCoaId = useBlockbusterStore((s) => s.selectedCoaId);
  const selectCoa = useBlockbusterStore((s) => s.selectCoa);
  const hoveredCellId = useBlockbusterStore((s) => s.hoveredCellId);
  const hoverCell = useBlockbusterStore((s) => s.hoverCell);

  const hasPlan = !!plan && plan.coas.length > 0;
  // Charts draw only the risk breakdown (movement cost drives routing but is
  // deliberately not shown), so scale bars to the largest per-cell risk total.
  const maxRisk = hasPlan
    ? plan.coas.reduce(
        (outer, coa) =>
          coa.steps.reduce((inner, step) => Math.max(inner, riskTotal(step.perRisk)), outer),
        0,
      )
    : 0;

  return (
    <div className="panel coa-panel">
      <JourneySettings />
      <AppetiteSliders />
      {!hasPlan ? (
        <p className="panel-hint">
          {planning
            ? 'Planning routes…'
            : 'No routes yet. Add at least two waypoints on the Waypoints tab.'}
        </p>
      ) : (
        plan.coas.map((coa, index) => (
          <section
            key={coa.id}
            className={coa.id === selectedCoaId ? 'coa coa-selected' : 'coa'}
            style={{ '--coa-color': coaColor(index) } as CSSProperties}
            onClick={() => selectCoa(coa.id)}
          >
            <header className="coa-head">
              <span className="coa-title">{coa.label}</span>
              <span className="coa-meta">
                {coa.totalCost.toFixed(0)} cost · {coa.totalDistanceKm.toFixed(1)} km ·{' '}
                {coa.path.length} cells
              </span>
              {coa.arrivalTimeMinutes > coa.departureTimeMinutes && (
                <span className="coa-timing">
                  {formatTime(coa.departureTimeMinutes)} → {formatTime(coa.arrivalTimeMinutes)}
                  {coa.speedKmh !== null && ` · ${coa.speedKmh} km/h`}
                </span>
              )}
            </header>
            <StackedBarChart
              coa={coa}
              maxRiskCost={maxRisk}
              highlightedCellId={hoveredCellId}
              onHoverCell={hoverCell}
            />
          </section>
        ))
      )}
    </div>
  );
}

/** Total risk cost a cell contributes — the bar height the chart draws for it. */
function riskTotal(perRisk: Record<RiskType, number>): number {
  return RISK_TYPES.reduce((sum, risk) => sum + perRisk[risk], 0);
}

/** Journey-time controls: departure time, speed mode and day/night toggle. */
function JourneySettings() {
  const journeyParams = useBlockbusterStore((s) => s.journeyParams);
  const setJourneyParams = useBlockbusterStore((s) => s.setJourneyParams);
  const dayNight = useBlockbusterStore((s) => s.dayNight);
  const setDayNight = useBlockbusterStore((s) => s.setDayNight);

  return (
    <section className="journey-settings">
      <h2 className="appetite-title">Journey</h2>
      <label className="journey-field">
        Depart {formatTime(journeyParams.startTime)}
        <input
          type="range"
          min={0}
          max={1439}
          step={15}
          value={journeyParams.startTime}
          onChange={(e) => setJourneyParams({ startTime: Number(e.target.value) })}
        />
      </label>
      <label className="journey-field">
        Speed mode
        <select
          value={journeyParams.speedMode}
          onChange={(e) =>
            setJourneyParams({ speedMode: e.target.value as typeof journeyParams.speedMode })
          }
        >
          <option value="fixed">Fixed speed</option>
          <option value="optimal" disabled>
            Optimal speed
          </option>
          <option value="dynamic" disabled>
            Dynamic speed
          </option>
        </select>
      </label>
      {journeyParams.speedMode === 'fixed' && (
        <label className="journey-field">
          Speed {journeyParams.fixedSpeedKmh} km/h
          <input
            type="range"
            min={SPEED_MIN_KMH}
            max={SPEED_MAX_KMH}
            step={1}
            value={journeyParams.fixedSpeedKmh}
            onChange={(e) => setJourneyParams({ fixedSpeedKmh: Number(e.target.value) })}
          />
        </label>
      )}
      <label className="journey-field journey-checkbox">
        <input
          type="checkbox"
          checked={dayNight.enabled}
          onChange={(e) => setDayNight({ enabled: e.target.checked })}
        />
        Day/night risk variation
      </label>
    </section>
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
