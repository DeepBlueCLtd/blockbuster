/**
 * Primitive measurement aliases used across the domain.
 *
 * These are nominal-by-convention only (they are all `number` at runtime), but
 * naming them keeps function signatures self-documenting and makes the intended
 * units unambiguous at the module seams.
 */

/** Distance expressed in kilometres — the canonical world unit. */
export type Km = number;

/** Distance expressed in metres (used for elevation). */
export type Metres = number;

/** Temperature in degrees Celsius. */
export type Celsius = number;

/** A normalised scalar constrained, by contract, to the inclusive range [0, 1]. */
export type Unit = number;

/** Clamp a number into the inclusive [min, max] range. */
export function clamp(value: number, min: number, max: number): number {
  return value < min ? min : value > max ? max : value;
}

/** Clamp into the [0, 1] range used by {@link Unit} values. */
export function clamp01(value: number): Unit {
  return clamp(value, 0, 1);
}
