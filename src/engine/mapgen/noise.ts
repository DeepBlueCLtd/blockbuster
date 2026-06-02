/**
 * Deterministic gradient (Perlin) noise, normalised to [0, 1]. Gradient noise is
 * isotropic and free of the axis-aligned artefacts cheaper value noise shows, so
 * the generated regions read as natural blobs. Pure; imports only `@domain`.
 *
 * Reference: Perlin's "Improving Noise" (2002) — smootherstep interpolation of
 * the dot products of per-corner gradient vectors with the corner→point offset.
 */
import { clamp01 } from '@domain';

const TAU = Math.PI * 2;

/** 32-bit integer hash of a lattice point → [0, 1). Deterministic, sine-free. */
export function hashLattice(ix: number, iy: number, seed: number): number {
  let h = seed | 0;
  h = Math.imul(h ^ (ix | 0), 0x85ebca6b);
  h = Math.imul(h ^ (iy | 0), 0xc2b2ae35);
  h ^= h >>> 13;
  h = Math.imul(h, 0x27d4eb2f);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

/** Perlin's smootherstep: zero 1st and 2nd derivatives at the endpoints. */
function smootherstep(t: number): number {
  return t * t * t * (t * (t * 6 - 15) + 10);
}

/** Dot of the lattice-corner gradient with the corner→point offset. */
function dotGradient(ix: number, iy: number, x: number, y: number, seed: number): number {
  const angle = hashLattice(ix, iy, seed) * TAU;
  return Math.cos(angle) * (x - ix) + Math.sin(angle) * (y - iy);
}

/** Single-octave Perlin noise at unit lattice frequency, normalised to [0, 1]. */
export function perlin(x: number, y: number, seed: number): number {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  const fx = x - ix;
  const fy = y - iy;
  const u = smootherstep(fx);
  const v = smootherstep(fy);
  const n00 = dotGradient(ix, iy, x, y, seed);
  const n10 = dotGradient(ix + 1, iy, x, y, seed);
  const n01 = dotGradient(ix, iy + 1, x, y, seed);
  const n11 = dotGradient(ix + 1, iy + 1, x, y, seed);
  const nx0 = n00 + (n10 - n00) * u;
  const nx1 = n01 + (n11 - n01) * u;
  const n = nx0 + (nx1 - nx0) * v;
  // 2D Perlin output spans ~[-√2/2, √2/2]; rescale to [0, 1] and clamp for safety.
  return clamp01(n * 0.7071067811865476 + 0.5);
}

/** Fractal (multi-octave) Perlin noise in [0, 1]; coherent at the chosen scale. */
export function fbm(x: number, y: number, seed: number, octaves = 4): number {
  let amp = 0.5;
  let freq = 1;
  let sum = 0;
  let norm = 0;
  for (let o = 0; o < octaves; o++) {
    sum += amp * perlin(x * freq, y * freq, seed + o * 1013);
    norm += amp;
    amp *= 0.5;
    freq *= 2;
  }
  return sum / norm;
}
