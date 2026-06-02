import { Polygon } from 'react-leaflet';
import type { LeafletEventHandlerFnMap, PathOptions } from 'leaflet';
import { useBlockbusterStore } from '@/state/store';
import { RISK_COLORS } from '@/ui/theme';
import { worldRingToLatLng } from '../projection';

/**
 * Read-only render of committed extra-risk zones, coloured by their channel and
 * highlighted when selected. Zones are clickable (to select) only on the
 * Extra-risk tab, so they never steal clicks from the hex grid elsewhere.
 */
export function ExtraRiskLayer() {
  const zones = useBlockbusterStore((s) => s.zones);
  const selectedZoneId = useBlockbusterStore((s) => s.selectedZoneId);
  const activeTab = useBlockbusterStore((s) => s.activeTab);
  const selectZone = useBlockbusterStore((s) => s.selectZone);
  const interactive = activeTab === 'extra';

  if (zones.length === 0) return null;

  return (
    <>
      {zones.map((zone) => {
        const selected = zone.id === selectedZoneId;
        const color = RISK_COLORS[zone.risk];
        const handlers: LeafletEventHandlerFnMap = { click: () => selectZone(zone.id) };
        const pathOptions: PathOptions = {
          color,
          weight: selected ? 3 : 2,
          fillColor: color,
          fillOpacity: zone.offset >= 0 ? 0.25 : 0.12,
          ...(selected ? {} : { dashArray: '6 4' }),
        };
        return (
          <Polygon
            key={zone.id}
            positions={worldRingToLatLng(zone.ring)}
            interactive={interactive}
            eventHandlers={handlers}
            pathOptions={pathOptions}
          />
        );
      })}
    </>
  );
}
