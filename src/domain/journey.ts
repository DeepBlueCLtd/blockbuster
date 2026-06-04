/** Journey-time parameters: when the group departs and how speed is chosen. */

export type SpeedMode = 'fixed' | 'optimal' | 'dynamic';

export interface JourneyParams {
  /** Departure time in minutes from midnight [0, 1439]. */
  startTime: number;
  speedMode: SpeedMode;
  /** km/h [SPEED_MIN_KMH, SPEED_MAX_KMH]; used when mode === 'fixed'. */
  fixedSpeedKmh: number;
}

export const DEFAULT_JOURNEY_PARAMS: JourneyParams = {
  startTime: 8 * 60,
  speedMode: 'fixed',
  fixedSpeedKmh: 15,
};

/** Toggle the built-in day/night risk modifiers (animals and human risk). */
export interface DayNightConfig {
  enabled: boolean;
}

export const DEFAULT_DAY_NIGHT: DayNightConfig = { enabled: false };

/** Optional earliest/latest arrival constraint on a waypoint (minutes from midnight). */
export interface TimeWindow {
  earliest?: number;
  latest?: number;
}

export const SPEED_MIN_KMH = 5;
export const SPEED_MAX_KMH = 30;

/** Night window: 20:00–06:00 (spans midnight). */
export const NIGHT_START = 20 * 60; // 1200
export const NIGHT_END = 6 * 60; // 360
