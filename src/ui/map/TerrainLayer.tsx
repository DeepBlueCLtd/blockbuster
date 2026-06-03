import { useEffect, useRef } from 'react';
import { useMap } from 'react-leaflet';
import { imageOverlay } from 'leaflet';
import type { ImageOverlay, LatLngBoundsExpression } from 'leaflet';
import type { Biome, TerrainField, TerrainSample, WorldExtent } from '@domain';
import { clamp01 } from '@domain';
import { useBlockbusterStore } from '@/state/store';
import { BIOME_COLORS, BIOME_ICONS } from '@/ui/theme';

/** Raster resolution of the base map and a cap so very large worlds stay cheap. */
const PX_PER_KM = 8;
const MAX_DIM = 480;
/** Elevation (m) that shading treats as a peak — matches the map generator. */
const MAX_ELEV_M = 2600;
/** Pixel spacing between overlaid terrain hint glyphs. */
const ICON_SPACING_PX = 30;

function hexToRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

const BIOME_RGB = Object.fromEntries(
  (Object.keys(BIOME_COLORS) as Biome[]).map((biome) => [biome, hexToRgb(BIOME_COLORS[biome])]),
) as Record<Biome, [number, number, number]>;

function hash01(seed: number, x: number, y: number): number {
  const n = Math.sin((x + 1.31) * 12.9898 + (y + 0.73) * 78.233 + seed * 0.01991) * 43758.5453;
  return n - Math.floor(n);
}

function iconColorForBiome(biome: Biome): string {
  const [r, g, b] = BIOME_RGB[biome];
  const luminance = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
  return luminance < 0.48 ? 'rgba(255, 255, 255, 0.54)' : 'rgba(20, 30, 40, 0.48)';
}

/** Biome colour with a little elevation relief so peaks read darker than valleys. */
function terrainRgb(sample: TerrainSample): [number, number, number] {
  const [r, g, b] = BIOME_RGB[sample.biome];
  const shade = 1.12 - clamp01(sample.elevation / MAX_ELEV_M) * 0.34;
  return [
    Math.min(255, r * shade),
    Math.min(255, g * shade),
    Math.min(255, b * shade),
  ];
}

function drawTerrainIcons(
  ctx: CanvasRenderingContext2D,
  field: TerrainField,
  extent: WorldExtent,
  w: number,
  h: number,
) {
  const spacing = Math.max(18, ICON_SPACING_PX);
  const jitter = spacing * 0.42;
  const iconSize = Math.max(11, Math.round(spacing * 0.48));
  const worldFromPixel = (px: number, py: number) => ({
    x: extent.width * (px / w),
    y: extent.height * (1 - py / h),
  });
  const sx = Math.ceil(w / spacing);
  const sy = Math.ceil(h / spacing);

  ctx.save();
  ctx.font = `600 ${iconSize}px system-ui, -apple-system, "Segoe UI Symbol", sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';

  for (let gy = 0; gy <= sy; gy++) {
    for (let gx = 0; gx <= sx; gx++) {
      if (hash01(field.seed + 17, gx, gy) < 0.23) continue;
      const dx = (hash01(field.seed + 29, gx, gy) - 0.5) * jitter;
      const dy = (hash01(field.seed + 41, gx, gy) - 0.5) * jitter;
      const px = (gx + 0.5) * spacing + dx;
      const py = (gy + 0.5) * spacing + dy;
      if (px < iconSize || py < iconSize || px > w - iconSize || py > h - iconSize) continue;
      const sample = field.sample(worldFromPixel(px, py));
      const icon = BIOME_ICONS[sample.biome];
      ctx.fillStyle = iconColorForBiome(sample.biome);
      ctx.fillText(icon, px, py);
    }
  }
  ctx.restore();
}

/**
 * Rasterises the terrain field to a PNG data URL. This is the expensive step —
 * one full `field.sample()` per pixel (~96k for the default world) plus a PNG
 * encode, all synchronous on the main thread — so callers cache the result and
 * only rebuild it when the field or extent actually changes.
 */
function rasterizeTerrain(field: TerrainField, extent: WorldExtent): string | null {
  const w = Math.max(1, Math.min(MAX_DIM, Math.round(extent.width * PX_PER_KM)));
  const h = Math.max(1, Math.min(MAX_DIM, Math.round(extent.height * PX_PER_KM)));
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;

  const image = ctx.createImageData(w, h);
  for (let py = 0; py < h; py++) {
    // Canvas row 0 is the north edge; world y increases northward.
    const wy = extent.height * (1 - (py + 0.5) / h);
    for (let px = 0; px < w; px++) {
      const wx = extent.width * ((px + 0.5) / w);
      const [r, g, b] = terrainRgb(field.sample({ x: wx, y: wy }));
      const i = (py * w + px) * 4;
      image.data[i] = r;
      image.data[i + 1] = g;
      image.data[i + 2] = b;
      image.data[i + 3] = 255;
    }
  }
  ctx.putImageData(image, 0, 0);
  drawTerrainIcons(ctx, field, extent, w, h);
  return canvas.toDataURL();
}

/**
 * Draws the continuous terrain field as an image overlay underneath the hex
 * grid. This is the "underlying map" you see when the grid is switched off; it
 * samples the field directly, so its detail is independent of the hex size.
 */
export function TerrainLayer() {
  const map = useMap();
  const field = useBlockbusterStore((s) => s.field);
  const extent = useBlockbusterStore((s) => s.extent);
  const showTerrain = useBlockbusterStore((s) => s.showTerrain);
  const overlayRef = useRef<ImageOverlay | null>(null);
  // Cached raster, keyed by the field + extent it was built from. Toggling the
  // base map off and on (or any re-render that leaves the field unchanged) then
  // reattaches this image instead of regenerating it.
  const rasterRef = useRef<{ field: TerrainField; extent: WorldExtent; url: string } | null>(null);

  // A dedicated pane below the vector (overlay) pane keeps terrain under the hexes.
  useEffect(() => {
    if (!map.getPane('terrain')) {
      const pane = map.createPane('terrain');
      pane.style.zIndex = '230';
      pane.style.pointerEvents = 'none';
    }
  }, [map]);

  useEffect(() => {
    overlayRef.current?.remove();
    overlayRef.current = null;
    if (!field || !showTerrain) return;

    // Reuse the cached raster unless the field/extent changed since it was built.
    const cached = rasterRef.current;
    let url = cached && cached.field === field && cached.extent === extent ? cached.url : null;
    if (url === null) {
      url = rasterizeTerrain(field, extent);
      if (url === null) return;
      rasterRef.current = { field, extent, url };
    }

    const bounds: LatLngBoundsExpression = [
      [0, 0],
      [extent.height, extent.width],
    ];
    const overlay = imageOverlay(url, bounds, {
      pane: 'terrain',
      interactive: false,
    });
    overlay.addTo(map);
    overlayRef.current = overlay;

    return () => {
      overlay.remove();
      if (overlayRef.current === overlay) overlayRef.current = null;
    };
  }, [map, field, extent, showTerrain]);

  return null;
}
