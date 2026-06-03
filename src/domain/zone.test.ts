import { describe, it, expect } from 'vitest';
import type { WorldPoint } from './world';
import type { RiskZone } from './zone';
import { zoneOffsetsForCell } from './zone';
import { applyZoneOffsets, uniformProfile } from './risk';

// A square "cell" of area 4 standing in for a hex.
const cell: WorldPoint[] = [
  { x: 0, y: 0 },
  { x: 2, y: 0 },
  { x: 2, y: 2 },
  { x: 0, y: 2 },
];

function zone(over: Partial<RiskZone> = {}): RiskZone {
  return {
    id: 'z',
    name: 'z',
    risk: 'thief',
    offset: 0.4,
    kind: 'rectangle',
    ring: [
      { x: 0, y: 0 },
      { x: 2, y: 0 },
      { x: 2, y: 2 },
      { x: 0, y: 2 },
    ],
    enabled: true,
    ...over,
  };
}

describe('zone scoring', () => {
  it('applies the full offset when a zone fully covers the cell', () => {
    expect(zoneOffsetsForCell(cell, [zone({ offset: 0.4 })]).thief ?? 0).toBeCloseTo(0.4, 6);
  });

  it('area-weights a half-covering zone', () => {
    const leftHalf = zone({
      offset: 0.4,
      ring: [
        { x: 0, y: 0 },
        { x: 1, y: 0 },
        { x: 1, y: 2 },
        { x: 0, y: 2 },
      ],
    });
    expect(zoneOffsetsForCell(cell, [leftHalf]).thief ?? 0).toBeCloseTo(0.2, 6);
  });

  it('sums zones on the same channel and ignores zero-offset zones', () => {
    const offsets = zoneOffsetsForCell(cell, [
      zone({ offset: 0.3 }),
      zone({ id: 'z2', offset: -0.1 }),
      zone({ id: 'z3', offset: 0 }),
    ]);
    expect(offsets.thief ?? 0).toBeCloseTo(0.2, 6);
  });

  it('folds offsets into a profile, clamping into [0, 1]', () => {
    const p = uniformProfile(0.8);
    expect(applyZoneOffsets(p, { thief: 0.5 }).thief).toBe(1); // 0.8 + 0.5 → clamp 1
    expect(applyZoneOffsets(p, { thief: -0.95 }).thief).toBe(0); // 0.8 − 0.95 → clamp 0
    expect(applyZoneOffsets(p, { thief: -0.3 }).thief).toBeCloseTo(0.5, 6);
    expect(applyZoneOffsets(p, undefined)).toBe(p); // untouched, same reference
  });
});
