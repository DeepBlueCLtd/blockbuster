/**
 * THROWAWAY SPIKE worker — builds the permanent terrain raster off the main
 * thread so revealing the Leaflet base never blocks the UI. The terrain field is
 * regenerated deterministically from `{ extent, seed }` (the engine is pure, no
 * DOM), rasterised on an OffscreenCanvas, and posted back as a PNG Blob.
 *
 * The rasterisation mirrors `src/ui/map/TerrainLayer.tsx` (kept in sync by hand
 * — this is a spike). Vite bundles it via
 * `new Worker(new URL('./terrainRaster.worker.ts', import.meta.url), { type: 'module' })`.
 */
import type { Biome, TerrainField, TerrainSample, WorldExtent } from '@domain';
import { clamp01 } from '@domain';
import { createMapGenerator } from '@/engine/mapgen';
import { BIOME_COLORS, BIOME_ICONS } from '@/ui/theme';

export interface TerrainRasterRequest {
  extent: WorldExtent;
  seed: number;
}

const PX_PER_KM = 8;
const MAX_DIM = 480;
const MAX_ELEV_M = 2600;
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

function terrainRgb(sample: TerrainSample): [number, number, number] {
  const [r, g, b] = BIOME_RGB[sample.biome];
  const shade = 1.12 - clamp01(sample.elevation / MAX_ELEV_M) * 0.34;
  return [Math.min(255, r * shade), Math.min(255, g * shade), Math.min(255, b * shade)];
}

function drawIcons(
  ctx: OffscreenCanvasRenderingContext2D,
  field: TerrainField,
  extent: WorldExtent,
  w: number,
  h: number,
): void {
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
      ctx.fillStyle = iconColorForBiome(sample.biome);
      ctx.fillText(BIOME_ICONS[sample.biome], px, py);
    }
  }
  ctx.restore();
}

async function rasterize(extent: WorldExtent, seed: number): Promise<Blob | null> {
  const field = createMapGenerator().generate({ extent, seed });
  const w = Math.max(1, Math.min(MAX_DIM, Math.round(extent.width * PX_PER_KM)));
  const h = Math.max(1, Math.min(MAX_DIM, Math.round(extent.height * PX_PER_KM)));
  const canvas = new OffscreenCanvas(w, h);
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
  drawIcons(ctx, field, extent, w, h);
  return canvas.convertToBlob({ type: 'image/png' });
}

interface WorkerScope {
  onmessage: ((event: MessageEvent<TerrainRasterRequest>) => void) | null;
  postMessage: (message: Blob) => void;
}

const ctx = self as unknown as WorkerScope;

ctx.onmessage = (event) => {
  const { extent, seed } = event.data;
  void rasterize(extent, seed)
    .then((blob) => {
      if (blob) ctx.postMessage(blob);
    })
    .catch((error) => {
      // Spike: if OffscreenCanvas/raster fails, the base just stays blank.
      console.error('terrain raster worker failed', error);
    });
};
