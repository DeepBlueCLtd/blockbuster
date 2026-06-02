import { RISK_LABELS, RISK_TYPES } from '@domain';
import { useBlockbusterStore } from '@/state/store';
import { RISK_COLORS } from '@/ui/theme';
import { Slider } from '@/ui/components/Slider';

/** The "Risk appetite" tab: one slider per risk channel. */
export function RiskAppetitePanel() {
  const appetite = useBlockbusterStore((s) => s.costParams.appetite);
  const setAppetite = useBlockbusterStore((s) => s.setAppetite);

  return (
    <div className="panel">
      <p className="panel-hint">
        Higher appetite means you tolerate that risk more, so routes are penalised less for it.
      </p>
      {RISK_TYPES.map((risk) => (
        <Slider
          key={risk}
          label={RISK_LABELS[risk]}
          color={RISK_COLORS[risk]}
          value={appetite[risk]}
          onChange={(value) => setAppetite(risk, value)}
          hint={appetite[risk] < 0.34 ? 'Avoid' : appetite[risk] > 0.66 ? 'Tolerant' : 'Balanced'}
        />
      ))}
    </div>
  );
}
