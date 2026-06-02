import { MapContainer } from 'react-leaflet';
import { CRS } from 'leaflet';
import type { LatLngBoundsExpression } from 'leaflet';
import { useBlockbusterStore } from '@/state/store';
import { HexGridLayer } from './HexGridLayer';
import { RouteLayer } from './RouteLayer';
import { MapToolbar } from './MapToolbar';

/**
 * The map pane. Uses `CRS.Simple` because the world is a fictitious flat
 * rectangle in kilometres, not a geographic projection.
 */
export function MapView() {
  const extent = useBlockbusterStore((s) => s.extent);
  const bounds: LatLngBoundsExpression = [
    [0, 0],
    [extent.height, extent.width],
  ];

  return (
    <div className="map-wrap">
      <MapToolbar />
      <MapContainer
        crs={CRS.Simple}
        bounds={bounds}
        className="leaflet-root"
        minZoom={-6}
        maxZoom={6}
        zoomSnap={0.25}
        attributionControl={false}
      >
        <HexGridLayer />
        <RouteLayer />
      </MapContainer>
    </div>
  );
}
