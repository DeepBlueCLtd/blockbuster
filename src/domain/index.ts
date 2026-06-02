/**
 * The shared kernel — the single source of truth for types, units and the
 * module-boundary ports. Everything else in the app imports from here (via the
 * `@domain` alias) and nothing here imports from anywhere else in `src`.
 *
 * Stability rule: changes to this barrel ripple across every team, so treat it
 * as an API. Add freely; change/remove with a heads-up.
 */
export * from './units';
export * from './world';
export * from './rng';
export * from './terrain';
export * from './hex';
export * from './risk';
export * from './zone';
export * from './cost';
export * from './routing';
export * from './ports';
