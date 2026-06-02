import type { Km } from './units';

/**
 * The world is a flat rectangle measured in kilometres. The origin (0, 0) is the
 * south-west corner; `x` increases east, `y` increases north. Renderers are free
 * to flip axes for screen space — see the Map View module spec.
 */
export interface WorldPoint {
  x: Km;
  y: Km;
}

/** Width/height of the world rectangle in kilometres. */
export interface WorldExtent {
  width: Km;
  height: Km;
}

/** Axis-aligned bounds in world space. */
export interface WorldBounds {
  min: WorldPoint;
  max: WorldPoint;
}

/** Default play area from the product brief: 50 km wide × 30 km tall. */
export const DEFAULT_EXTENT: WorldExtent = { width: 50, height: 30 };

export function extentToBounds(
  extent: WorldExtent,
  origin: WorldPoint = { x: 0, y: 0 },
): WorldBounds {
  return {
    min: { x: origin.x, y: origin.y },
    max: { x: origin.x + extent.width, y: origin.y + extent.height },
  };
}

/** Euclidean distance between two world points, in kilometres. */
export function worldDistance(a: WorldPoint, b: WorldPoint): Km {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return Math.hypot(dx, dy);
}
