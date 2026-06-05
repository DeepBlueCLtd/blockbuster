import { describe, it, expect } from 'vitest';
import type { Cyclone, WindVector } from './wind';
import {
  applyWindRisk,
  createDefaultCyclone,
  cycloneEyeAt,
  IDENTITY_WIND_EFFECT,
  isCycloneActiveAt,
  windAt,
  windEffect,
} from './wind';
import { uniformProfile } from './risk';

/** A stationary cyclone centred at (25, 15), active all day, peak strength. */
function stationary(over: Partial<Cyclone> = {}): Cyclone {
  return {
    id: 't',
    name: 't',
    from: { x: 25, y: 15 },
    to: { x: 25, y: 15 },
    startTime: 0,
    endTime: 1440,
    eyeRadiusKm: 1,
    maxWindRadiusKm: 5,
    outerRadiusKm: 20,
    strength: 1,
    enabled: true,
    ...over,
  };
}

describe('cycloneEyeAt', () => {
  it('lerps the eye from `from` to `to` across the active window', () => {
    const c = stationary({
      from: { x: 0, y: 0 },
      to: { x: 100, y: 50 },
      startTime: 0,
      endTime: 100,
    });
    expect(cycloneEyeAt(c, 0)).toEqual({ x: 0, y: 0 });
    expect(cycloneEyeAt(c, 50)).toEqual({ x: 50, y: 25 });
    expect(cycloneEyeAt(c, 100)).toEqual({ x: 100, y: 50 });
  });

  it('is null outside the window or when disabled', () => {
    const c = stationary({ startTime: 600, endTime: 700 });
    expect(cycloneEyeAt(c, 599)).toBeNull();
    expect(cycloneEyeAt(c, 701)).toBeNull();
    expect(cycloneEyeAt(stationary({ enabled: false }), 0)).toBeNull();
    expect(isCycloneActiveAt(c, 650)).toBe(true);
  });
});

describe('windAt — anticlockwise circulation', () => {
  const c = stationary();
  // The wind blows tangentially, +90° from the outward radius (anticlockwise):
  // east of the eye → blows north; north → west; west → south; south → east.
  it('blows north on the east side', () => {
    const w = windAt(c, { x: 35, y: 15 }, 0)!;
    expect(w.dir.x).toBeCloseTo(0, 6);
    expect(w.dir.y).toBeCloseTo(1, 6);
  });
  it('blows west on the north side', () => {
    const w = windAt(c, { x: 25, y: 25 }, 0)!;
    expect(w.dir.x).toBeCloseTo(-1, 6);
    expect(w.dir.y).toBeCloseTo(0, 6);
  });
  it('blows south on the west side', () => {
    const w = windAt(c, { x: 15, y: 15 }, 0)!;
    expect(w.dir.y).toBeCloseTo(-1, 6);
  });
  it('blows east on the south side', () => {
    const w = windAt(c, { x: 25, y: 5 }, 0)!;
    expect(w.dir.x).toBeCloseTo(1, 6);
  });
});

describe('windAt — radial strength profile', () => {
  const c = stationary();
  it('is calm (null) inside the eye and beyond the outer radius', () => {
    expect(windAt(c, { x: 25.5, y: 15 }, 0)).toBeNull(); // d < eyeRadius
    expect(windAt(c, { x: 50, y: 15 }, 0)).toBeNull(); // d > outerRadius
  });
  it('peaks at the eyewall', () => {
    const w = windAt(c, { x: 30, y: 15 }, 0)!; // d = 5 = maxWindRadius
    expect(w.strength).toBeCloseTo(1, 6);
  });
  it('decays between the eyewall and the outer radius', () => {
    const near = windAt(c, { x: 32, y: 15 }, 0)!; // d = 7
    const far = windAt(c, { x: 42, y: 15 }, 0)!; // d = 17
    expect(near.strength).toBeGreaterThan(far.strength);
    expect(far.strength).toBeGreaterThan(0);
  });
  it('is null when inactive', () => {
    expect(windAt(stationary({ enabled: false }), { x: 30, y: 15 }, 0)).toBeNull();
    expect(windAt(stationary({ startTime: 600, endTime: 700 }), { x: 30, y: 15 }, 0)).toBeNull();
  });
});

describe('windEffect — head/tail/cross rules', () => {
  // Wind blowing due north at full strength.
  const north: WindVector = { dir: { x: 0, y: 1 }, strength: 1 };

  it('tailwind (with the wind): faster, all risks down except a slight cold rise', () => {
    const e = windEffect({ x: 0, y: 1 }, north);
    expect(e.speedFactor).toBeGreaterThan(1);
    expect(e.riskMultipliers.human).toBeLessThan(1);
    expect(e.riskMultipliers.heat).toBeLessThan(1);
    expect(e.riskMultipliers.cold).toBeGreaterThan(1); // slight increase
    expect(e.riskMultipliers.cold).toBeLessThan(1.3); // ...but only slight
  });

  it('headwind (into the wind): slower, all risks up, cold most of all', () => {
    const e = windEffect({ x: 0, y: -1 }, north);
    expect(e.speedFactor).toBeLessThan(1);
    expect(e.riskMultipliers.human).toBeGreaterThan(1);
    expect(e.riskMultipliers.cold).toBeGreaterThan(e.riskMultipliers.human); // particularly cold
  });

  it('crosswind (90°): no impact', () => {
    const e = windEffect({ x: 1, y: 0 }, north);
    expect(e).toBe(IDENTITY_WIND_EFFECT);
  });

  it('builds up exponentially — half-aligned is far less than half the peak', () => {
    const peak = windEffect({ x: 0, y: -1 }, north); // a = -1
    const half = windEffect({ x: Math.sqrt(3) / 2, y: -0.5 }, north); // a = -0.5
    const peakRise = peak.riskMultipliers.human - 1;
    const halfRise = half.riskMultipliers.human - 1;
    expect(halfRise).toBeGreaterThan(0);
    expect(halfRise).toBeLessThan(peakRise * 0.5); // convex: well under half
  });

  it('scales with wind strength (weaker wind → weaker effect)', () => {
    const strong = windEffect({ x: 0, y: -1 }, { dir: { x: 0, y: 1 }, strength: 1 });
    const weak = windEffect({ x: 0, y: -1 }, { dir: { x: 0, y: 1 }, strength: 0.4 });
    expect(weak.riskMultipliers.cold - 1).toBeLessThan(strong.riskMultipliers.cold - 1);
    expect(weak.riskMultipliers.cold).toBeGreaterThan(1);
  });

  it('is identity for missing heading, missing wind, or zero strength', () => {
    expect(windEffect(null, north)).toBe(IDENTITY_WIND_EFFECT);
    expect(windEffect({ x: 0, y: 1 }, null)).toBe(IDENTITY_WIND_EFFECT);
    expect(windEffect({ x: 0, y: 1 }, { dir: { x: 0, y: 1 }, strength: 0 })).toBe(
      IDENTITY_WIND_EFFECT,
    );
  });
});

describe('applyWindRisk', () => {
  it('multiplies each channel and clamps into [0,1]', () => {
    const headwind = windEffect({ x: 0, y: -1 }, { dir: { x: 0, y: 1 }, strength: 1 });
    const out = applyWindRisk(uniformProfile(0.5), headwind);
    expect(out.cold).toBeCloseTo(1, 6); // 0.5 × 2.0 → clamped to 1
    expect(out.human).toBeCloseTo(0.8, 6); // 0.5 × 1.6
  });

  it('returns the same profile reference for the identity effect', () => {
    const p = uniformProfile(0.3);
    expect(applyWindRisk(p, IDENTITY_WIND_EFFECT)).toBe(p);
  });
});

describe('createDefaultCyclone', () => {
  it('sweeps east→west with ordered radii and the standard window', () => {
    const c = createDefaultCyclone({ width: 50, height: 30 });
    expect(c.enabled).toBe(true);
    expect(c.from.x).toBeGreaterThan(c.to.x); // east → west
    expect(c.eyeRadiusKm).toBeLessThan(c.maxWindRadiusKm);
    expect(c.maxWindRadiusKm).toBeLessThan(c.outerRadiusKm);
    expect(c.startTime).toBe(8 * 60);
    expect(c.endTime).toBe(16 * 60);
  });
});
