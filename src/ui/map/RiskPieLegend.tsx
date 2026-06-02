import { RISK_LABELS, RISK_TYPES } from '@domain';
import { RISK_COLORS } from '@/ui/theme';
import { useBlockbusterStore } from '@/state/store';

/** Key to the pie-slice colours; only shown while the risk-pies overlay is on. */
export function RiskPieLegend() {
  const showRiskPies = useBlockbusterStore((s) => s.showRiskPies);
  if (!showRiskPies) return null;

  return (
    <div className="map-legend map-legend--right">
      {RISK_TYPES.map((risk) => (
        <span key={risk} className="legend-item">
          <i style={{ background: RISK_COLORS[risk] }} />
          {RISK_LABELS[risk]}
        </span>
      ))}
    </div>
  );
}
