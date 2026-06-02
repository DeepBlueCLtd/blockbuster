import type { Unit } from './units';

/**
 * A minimal seedable pseudo-random number generator.
 *
 * Determinism is a hard requirement of the domain: the same seed must always
 * produce the same map, the same risk field, and therefore the same COAs. Every
 * module that needs randomness must take an {@link Rng}; none may call
 * `Math.random()` directly.
 */
export interface Rng {
  /** Next value in the half-open range [0, 1). */
  next(): Unit;
  /** Integer in the half-open range [0, maxExclusive). */
  int(maxExclusive: number): number;
  /** Float in the half-open range [min, max). */
  range(min: number, max: number): number;
}

/**
 * `mulberry32` — a tiny, fast, well-distributed 32-bit generator. Good enough
 * for procedural content; not for cryptography.
 */
export function mulberry32(seed: number): Rng {
  let state = seed >>> 0;
  const next = (): Unit => {
    state = (state + 0x6d2b79f5) | 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return {
    next,
    int: (maxExclusive: number) => Math.floor(next() * maxExclusive),
    range: (min: number, max: number) => min + next() * (max - min),
  };
}
