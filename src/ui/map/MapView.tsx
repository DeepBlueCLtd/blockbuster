import { MapContainer, ZoomControl } from 'react-leaflet';
import { CRS } from 'leaflet';
import type { LatLngBoundsExpression } from 'leaflet';
import { useBlockbusterStore } from '@/state/store';
import { TerrainLayer } from './TerrainLayer';
import { HexGridLayer } from './HexGridLayer';
import { RouteLayer } from './RouteLayer';
import { MapToolbar } from './MapToolbar';
import { BiomeLegend } from './BiomeLegend';
import { ExtraRiskLayer } from './extra-risk/ExtraRiskLayer';
import { ExtraRiskDraw } from './extra-risk/ExtraRiskDraw';

/**
 * The map pane. Uses `CRS.Simple` because the world is a fictitious flat
 * rectangle in kilometres, not a geographic projection.
 */
export function MapView() {
  const extent = useBlockbusterStore((s) => s.extent);
  const activeTab = useBlockbusterStore((s) => s.activeTab);
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
        zoomControl={false}
      >
        <TerrainLayer />
        <ZoomControl position="topright" />
        <HexGridLayer />
        <RouteLayer />
        <ExtraRiskLayer />
        {activeTab === 'extra' && <ExtraRiskDraw />}
      </MapContainer>
      <BiomeLegend />
    </div>
  );
}
