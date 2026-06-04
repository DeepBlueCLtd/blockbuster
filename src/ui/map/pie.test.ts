import { describe, expect, it } from 'vitest';
import type { RiskType, WorldPoint } from '@domain';
import {
  cellInradius,
  riskBarRects,
  riskPieSlices,
  riskShares,
  riskStackRects,
  sliceRing,
} from './pie';

const noRisk: Record<RiskType, number> = { animals: 0, cold: 0, heat: 0, water: 0, human: 0 };

describe('riskShares', () => {
  it('returns no shares when the total cost is zero', () => {
    expect(riskShares(noRisk)).toEqual([]);
  });

  it('normalises contributions to fractions that sum to 1', () => {
    const shares = riskShares({ ...noRisk, heat: 3, water: 1 });
    expect(shares.map((s) => s.risk)).toEqual(['heat', 'water']);
    expect(shares.map((s) => s.fraction)).toEqual([0.75, 0.25]);
  });

  it('keeps the canonical risk order and skips zero channels', () => {
    const shares = riskShares({ ...noRisk, human: 2, animals: 2 });
    expect(shares.map((s) => s.risk)).toEqual(['animals', 'human']);
  });

  it('ignores negative contributions', () => {
    expect(riskShares({ ...noRisk, heat: 1, cold: -5 }).map((s) => s.risk)).toEqual(['heat']);
  });
});

describe('sliceRing', () => {
  const center: WorldPoint = { x: 10, y: 5 };

  it('starts at the centre and traces points on the circle of the given radius', () => {
    const ring = sliceRing(center, 2, 0, Math.PI / 2);
    expect(ring[0]).toEqual(center);
    for (const p of ring.slice(1)) {
      expect(Math.hypot(p.x - center.x, p.y - center.y)).toBeCloseTo(2, 6);
    }
  });
});

describe('riskPieSlices', () => {
  const center: WorldPoint = { x: 0, y: 0 };

  it('produces one wedge per contributing risk, in canonical order', () => {
    const slices = riskPieSlices(center, 1, { ...noRisk, heat: 1, cold: 1 });
    expect(slices.map((s) => s.risk)).toEqual(['cold', 'heat']);
  });

  it('produces nothing for a zero-risk cell', () => {
    expect(riskPieSlices(center, 1, noRisk)).toEqual([]);
  });
});

describe('cellInradius', () => {
  it('measures the centre-to-edge distance of a regular hexagon', () => {
    const verts: WorldPoint[] = Array.from({ length: 6 }, (_, i) => {
      const a = (Math.PI / 3) * i + Math.PI / 6;
      return { x: Math.cos(a), y: Math.sin(a) };
    });
    // For a regular hexagon the apothem is circumradius · cos(30°).
    expect(cellInradius({ x: 0, y: 0 }, verts)).toBeCloseTo(Math.cos(Math.PI / 6), 6);
  });
});

describe('riskBarRects', () => {
  const center: WorldPoint = { x: 10, y: 10 };

  it('produces nothing for a zero-risk cell', () => {
    expect(riskBarRects(center, 1, noRisk)).toEqual([]);
  });

  it('produces one rect per contributing risk', () => {
    const rects = riskBarRects(center, 2, { ...noRisk, heat: 3, cold: 1 });
    expect(rects.map((r) => r.risk)).toEqual(['cold', 'heat']);
  });

  it('each rect is a closed 4-point polygon', () => {
    const rects = riskBarRects(center, 2, { ...noRisk, animals: 5 });
    expect(rects).toHaveLength(1);
    expect(rects[0]!.ring).toHaveLength(4);
  });

  it('tallest bar height equals the radius', () => {
    const rects = riskBarRects(center, 2, { ...noRisk, heat: 3, cold: 1 });
    const heatRect = rects.find((r) => r.risk === 'heat')!;
    const height = heatRect.ring[2]!.y - heatRect.ring[0]!.y;
    expect(height).toBeCloseTo(2, 6); // radius
  });
});

describe('riskStackRects', () => {
  const center: WorldPoint = { x: 10, y: 10 };

  it('produces nothing for a zero-risk cell', () => {
    expect(riskStackRects(center, 1, noRisk)).toEqual([]);
  });

  it('stacks segments in canonical risk order', () => {
    const rects = riskStackRects(center, 2, { ...noRisk, human: 1, animals: 1 });
    expect(rects.map((r) => r.risk)).toEqual(['animals', 'human']);
  });

  it('each segment top equals the next segment bottom', () => {
    const rects = riskStackRects(center, 4, { ...noRisk, cold: 2, heat: 3 });
    expect(rects).toHaveLength(2);
    // cold segment top should equal heat segment bottom
    expect(rects[0]!.ring[2]!.y).toBeCloseTo(rects[1]!.ring[0]!.y, 6);
  });

  it('total stack height equals radius when no maxTotal given', () => {
    const rects = riskStackRects(center, 4, { ...noRisk, cold: 2, heat: 3 });
    const bottom = rects[0]!.ring[0]!.y;
    const top = rects[rects.length - 1]!.ring[2]!.y;
    expect(top - bottom).toBeCloseTo(4, 6); // radius
  });

  it('scales against maxTotal when provided', () => {
    const rects = riskStackRects(center, 4, { ...noRisk, heat: 5 }, 10);
    const bottom = rects[0]!.ring[0]!.y;
    const top = rects[0]!.ring[2]!.y;
    expect(top - bottom).toBeCloseTo(2, 6); // 5/10 * radius
  });
});
