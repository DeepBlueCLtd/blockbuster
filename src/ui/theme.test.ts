import { describe, expect, it } from 'vitest';
import { COA_COLORS, coaColor } from './theme';

describe('coaColor', () => {
  it('is deterministic — the same index always yields the same colour', () => {
    expect(coaColor(2)).toBe(coaColor(2));
  });

  it('maps each palette slot by position, best route first', () => {
    COA_COLORS.forEach((color, i) => expect(coaColor(i)).toBe(color));
  });

  it('gives every COA in a default three-COA plan a distinct colour', () => {
    const colors = [0, 1, 2].map(coaColor);
    expect(new Set(colors).size).toBe(colors.length);
  });

  it('wraps around the palette when there are more COAs than colours', () => {
    expect(coaColor(COA_COLORS.length)).toBe(coaColor(0));
    expect(coaColor(COA_COLORS.length + 1)).toBe(coaColor(1));
  });
});
