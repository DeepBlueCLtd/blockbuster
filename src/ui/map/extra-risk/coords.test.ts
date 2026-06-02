import { describe, it, expect } from 'vitest';
import { worldToLatLng } from '@/ui/map/projection';
import {
  normalizeCircleRing,
  ringToWorld,
  terraPositionToWorld,
  worldToTerraPosition,
} from './coords';

describe('Terra Draw ↔ world coordinates (CRS.Simple)', () => {
  it('maps a Terra Draw [lng, lat] to world {x: lng, y: lat}', () => {
    expect(terraPositionToWorld([12, 7])).toEqual({ x: 12, y: 7 });
  });

  it('round-trips through the map projection (worldToLatLng = [y, x])', () => {
    const world = { x: 31.5, y: 8.25 };
    const [lng, lat] = worldToTerraPosition(world); // GeoJSON order [x, y]
    // Under CRS.Simple a Terra Draw lng/lat feeds Leaflet as latLng [lat, lng],
    // which must equal worldToLatLng([y, x]) for the contract to hold.
    expect(worldToLatLng(world)).toEqual([lat, lng]);
    expect(terraPositionToWorld([lng, lat])).toEqual(world);
  });

  it('drops the duplicated closing vertex of a GeoJSON ring', () => {
    const ring = [
      [0, 0],
      [4, 0],
      [4, 3],
      [0, 3],
      [0, 0],
    ];
    expect(ringToWorld(ring)).toEqual([
      { x: 0, y: 0 },
      { x: 4, y: 0 },
      { x: 4, y: 3 },
      { x: 0, y: 3 },
    ]);
  });

  it('normalises a distorted (egg-shaped) circle into a round ring', () => {
    // An ellipse stretched on y — like a mercator-distorted circle near the top.
    const cx = 10;
    const cy = 20;
    const rx = 4;
    const ry = 5;
    const ellipse = Array.from({ length: 48 }, (_, i) => {
      const a = (i / 48) * Math.PI * 2;
      return { x: cx + rx * Math.cos(a), y: cy + ry * Math.sin(a) };
    });

    const round = normalizeCircleRing(ellipse, 64);
    const xs = round.map((p) => p.x);
    const ys = round.map((p) => p.y);
    const width = Math.max(...xs) - Math.min(...xs);
    const height = Math.max(...ys) - Math.min(...ys);

    expect(round).toHaveLength(64);
    expect(width).toBeCloseTo(height, 5); // round again: width === height
    expect((Math.max(...xs) + Math.min(...xs)) / 2).toBeCloseTo(cx, 5);
    expect((Math.max(...ys) + Math.min(...ys)) / 2).toBeCloseTo(cy, 5);
  });
});
