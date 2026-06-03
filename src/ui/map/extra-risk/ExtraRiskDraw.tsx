import { useEffect, useRef } from 'react';
import { useMap } from 'react-leaflet';
import * as L from 'leaflet';
import {
  TerraDraw,
  TerraDrawCircleMode,
  TerraDrawPolygonMode,
  TerraDrawRectangleMode,
} from 'terra-draw';
import type { HexColor } from 'terra-draw';
import { TerraDrawLeafletAdapter } from 'terra-draw-leaflet-adapter';
import type { ZoneKind } from '@domain';
import { useBlockbusterStore } from '@/state/store';
import { RISK_COLORS } from '@/ui/theme';
import { featureKind, featureToWorldRing, normalizeCircleRing } from './coords';

let zoneSeq = 0;

/**
 * Drives Terra Draw over the existing `CRS.Simple` map. Mounted only while the
 * Extra-risk tab is active. A draw tool is armed by `drawMode`; on finish we
 * convert the feature to a world-space ring, hand it to the store as a zone, and
 * clear it from Terra Draw — committed zones are drawn by {@link ExtraRiskLayer}.
 * When no tool is armed, Terra Draw is stopped so map clicks fall through to the
 * hex grid as before.
 */
export function ExtraRiskDraw() {
  const map = useMap();
  const drawMode = useBlockbusterStore((s) => s.drawMode);
  const zoneRiskType = useBlockbusterStore((s) => s.zoneRiskType);
  const addZone = useBlockbusterStore((s) => s.addZone);
  const drawRef = useRef<TerraDraw | null>(null);
  // Keep the latest selected risk reachable by Terra Draw's (once-created) style fns.
  const riskRef = useRef(zoneRiskType);
  riskRef.current = zoneRiskType;

  // Build the Terra Draw instance once for this map.
  useEffect(() => {
    // Style the in-progress shape in the selected risk's colour (read live, so it
    // tracks the dropdown without rebuilding the modes).
    const drawColor = (): HexColor => RISK_COLORS[riskRef.current] as HexColor;
    const styles = {
      fillColor: drawColor,
      fillOpacity: 0.2,
      outlineColor: drawColor,
      outlineWidth: 2,
    };
    const draw = new TerraDraw({
      adapter: new TerraDrawLeafletAdapter({ map, lib: L }),
      modes: [
        new TerraDrawRectangleMode({ styles }),
        // CRS.Simple is not web-mercator; we pick the planar projection (never
        // 'globe'/haversine, which blows up here) and re-round circles on finish.
        new TerraDrawCircleMode({ projection: 'web-mercator', segments: 64, styles }),
        new TerraDrawPolygonMode({ styles }),
      ],
    });

    draw.on('finish', (id) => {
      const feature = draw.getSnapshotFeature(id);
      if (!feature) return;
      const kind: ZoneKind = featureKind(feature);
      let ring = featureToWorldRing(feature);
      if (kind === 'circle') ring = normalizeCircleRing(ring);
      if (ring.length >= 3) {
        addZone({
          id: typeof id === 'string' ? id : String(id),
          name: `Zone ${++zoneSeq}`,
          // Read live so the dropdown's current choice applies to this new zone.
          risk: useBlockbusterStore.getState().zoneRiskType,
          offset: 0,
          kind,
          ring,
          enabled: true,
        });
      }
      // Geometry now lives in the store / ExtraRiskLayer; keep the tool armed.
      draw.clear();
    });

    drawRef.current = draw;
    return () => {
      if (draw.enabled) draw.stop();
      drawRef.current = null;
    };
  }, [map, addZone]);

  // Arm or disarm the active tool.
  useEffect(() => {
    const draw = drawRef.current;
    if (!draw) return;
    if (drawMode) {
      if (!draw.enabled) draw.start();
      draw.setMode(drawMode);
    } else if (draw.enabled) {
      draw.stop();
    }
  }, [drawMode]);

  // While a tool is armed, flag the map container so its vector layers (hexes,
  // zones) and markers become click-through (see app.css). Otherwise Leaflet
  // swallows the click to select a hex and Terra Draw never sees the pointer.
  useEffect(() => {
    const el = map.getContainer();
    el.classList.toggle('leaflet-drawing', drawMode !== null);
    return () => el.classList.remove('leaflet-drawing');
  }, [map, drawMode]);

  return null;
}
