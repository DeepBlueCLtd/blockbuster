import { describe, it, expect } from 'vitest';
import type { WorldPoint } from './world';
import { coverageFraction, polygonArea } from './geometry';

/** Axis-aligned rectangle as an open ring (CCW). */
function rect(x0: number, y0: number, x1: number, y1: number): WorldPoint[] {
  return [
    { x: x0, y: y0 },
    { x: x1, y: y0 },
    { x: x1, y: y1 },
    { x: x0, y: y1 },
  ];
}

describe('geometry — polygon coverage', () => {
  it('computes polygon area', () => {
    expect(polygonArea(rect(0, 0, 2, 3))).toBe(6);
  });

  it('reports full coverage when the hex sits inside the zone', () => {
    expect(coverageFraction(rect(1, 1, 2, 2), rect(0, 0, 10, 10))).toBeCloseTo(1, 6);
  });

  it('reports half coverage when the zone covers half the hex', () => {
    // hex area 4; zone covers the left half (area 2) → 0.5
    expect(coverageFraction(rect(0, 0, 2, 2), rect(0, 0, 1, 2))).toBeCloseTo(0.5, 6);
  });

  it('reports a quarter for a covered corner', () => {
    expect(coverageFraction(rect(0, 0, 2, 2), rect(0, 0, 1, 1))).toBeCloseTo(0.25, 6);
  });

  it('reports zero when disjoint', () => {
    expect(coverageFraction(rect(0, 0, 1, 1), rect(5, 5, 6, 6))).toBe(0);
  });

  it('is winding-agnostic for the clip (hex given clockwise)', () => {
    const hexCW: WorldPoint[] = [
      { x: 0, y: 0 },
      { x: 0, y: 2 },
      { x: 2, y: 2 },
      { x: 2, y: 0 },
    ];
    expect(coverageFraction(hexCW, rect(0, 0, 1, 2))).toBeCloseTo(0.5, 6);
  });
});
