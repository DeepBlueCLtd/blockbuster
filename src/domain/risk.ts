import type { Unit } from './units';
import { clamp01 } from './units';
import type { CellId } from './hex';

/**
 * The five risk channels from the brief. Order is stable and is the canonical
 * order for charts, legends and serialised records.
 */
export const RISK_TYPES = ['animals', 'cold', 'heat', 'water', 'thief'] as const;
export type RiskType = (typeof RISK_TYPES)[number];

/** Human-readable labels for UI. */
export const RISK_LABELS: Record<RiskType, string> = {
  animals: 'Animals',
  cold: 'Cold',
  heat: 'Heat',
  water: 'Lack of water',
  thief: 'Thieves',
};

/** A complete set of risk levels (each 0…1) for one cell. */
export type RiskProfile = Record<RiskType, Unit>;

/** A sparse set of analyst overrides for a cell; absent keys fall back to base. */
export type RiskOverrides = Partial<Record<RiskType, Unit>>;

/**
 * The analyst's appetite per risk, 0 (intolerant — penalise heavily) … 1
 * (tolerant — barely penalise). Controlled by the sliders.
 */
export type RiskAppetite = Record<RiskType, Unit>;

/** Per-cell risk state: model output plus any analyst edits. */
export interface CellRiskState {
  cellId: CellId;
  /** Levels derived from terrain by the Risk model. */
  base: RiskProfile;
  /** Analyst overrides; takes precedence over `base` where present. */
  overrides: RiskOverrides;
}

/** Build a profile from a constant value (handy for tests/fixtures). */
export function uniformProfile(value: Unit): RiskProfile {
  return { animals: value, cold: value, heat: value, water: value, thief: value };
}

/** Merge base levels with overrides to get the levels actually used for costing. */
export function effectiveProfile(state: CellRiskState): RiskProfile {
  const out = { ...state.base };
  for (const risk of RISK_TYPES) {
    const override = state.overrides[risk];
    if (override !== undefined) out[risk] = clamp01(override);
  }
  return out;
}

/** Which channels of a cell have been overridden (for the highlight UI). */
export function overriddenRisks(state: CellRiskState): RiskType[] {
  return RISK_TYPES.filter((risk) => state.overrides[risk] !== undefined);
}

/** Neutral appetite (0.5 across the board) used as the default slider position. */
export const DEFAULT_APPETITE: RiskAppetite = uniformProfile(0.5);
