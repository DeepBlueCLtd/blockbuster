import { cycloneEyeAt } from '@domain';
import { useBlockbusterStore } from '@/state/store';
import { formatTime } from '@/ui/utils/time';
import { WIND_ARROW_COLOR } from '@/ui/theme';

/**
 * Key to the wind overlay: what the arrows mean and how the route chevrons read.
 * Shown whenever the wind overlay is on; notes when the cyclone is inactive at
 * the current display time so an empty map reads as "no wind yet", not a bug.
 */
export function WindLegend() {
  const showWind = useBlockbusterStore((s) => s.showWind);
  const cyclone = useBlockbusterStore((s) => s.cyclone);
  const displayTime = useBlockbusterStore((s) => s.displayTime);
  if (!showWind || !cyclone) return null;

  const active = cycloneEyeAt(cyclone, displayTime) !== null;

  return (
    <div className="map-legend map-legend--wind">
      <span className="legend-item">
        <i className="wind-glyph" style={{ color: WIND_ARROW_COLOR }}>
          ➔
        </i>
        Wind direction
      </span>
      <span className="legend-item">
        <i style={{ background: '#2e7d32' }} /> Tailwind (helps)
      </span>
      <span className="legend-item">
        <i style={{ background: '#c62828' }} /> Headwind (hinders)
      </span>
      {!active && (
        <span className="legend-item">cyclone inactive at {formatTime(displayTime)}</span>
      )}
    </div>
  );
}
