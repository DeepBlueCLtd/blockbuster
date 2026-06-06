# 05 · Engine — Risk model

**Port:** `RiskEngine` · **Files:** `src/engine/risk/` · **Reference impl:**
`createMockRiskEngine` · **Depends on:** `@domain` only.

## Purpose

Map terrain to **baseline risk levels** for the five channels. Note the division
of labour: this module produces *levels* (`RiskProfile`, each 0…1); the **cost
function that turns levels + appetite into a number lives in the shared kernel**
(`@domain/cost`) so routing and charts share it. Don't reimplement cost here.

## Contract

```ts
createRiskEngine(): RiskEngine
RiskEngine.baseProfile(sample: TerrainSample): RiskProfile   // each channel ∈ [0,1]
```

Overrides, effective profiles and appetite weighting are handled upstream
(`effectiveProfile` in `@domain`, the store, and `@domain/cost`). This module is
a pure, stateless `sample → profile` mapping.

## Design guidance (starting point — tune freely)

| Channel | Suggested mapping |
|---------|-------------------|
| animals | `vegetation` (higher in woodland/savannah) |
| cold | rises as `temperature` falls (cold mountains) |
| heat | rises as `temperature` climbs (hot lowlands) |
| water | `1 - waterProximity` |
| human | `banditActivity` (peaks in/near towns) |

Clamp everything to `[0,1]`. Keep the mapping legible — analysts reason about it.
The mock encodes exactly these; treat it as the reference and refine the curves.

## Speed-dependent cost (shared kernel — `@domain/cost`)

A cell's *cost* also depends on the group's travel speed (in dynamic mode the
planner picks a speed per cell — see [06 · Routing](./06-engine-routing.md)). That
coupling lives in the shared kernel (`speedRiskModifier` / `speedModifiedProfile`
in `@domain/cost`), **not** in this module, but it is specified here because it
shapes the cost function.

**The shape matters, not just the magnitude.** For an *interior* speed ever to be
chosen, a cell's entry cost as a function of speed must be **convex with its
minimum strictly inside `(SPEED_MIN_KMH, SPEED_MAX_KMH)`**. If every
speed-dependent term is linear (or otherwise monotone) in speed, their sum is
monotone, so the cost-minimal speed is always an endpoint — the planner can only
recommend the slowest or fastest speed ("bang-bang"). v1's modifiers are all
linear, which is exactly that degenerate case, and is why dynamic recommendations
come back as `SPEED_MIN`/`SPEED_MAX` and nothing between.

Get the convex U-shape from **two competing forces**:

- **Time-in-cell exposure — slower is worse.** Risks accumulated by *being there
  longer* (animals, human/bandits) scale with dwell time, i.e. `∝ 1 / speed`. This
  replaces v1's linear "faster ⇒ safer" modifier with the convex, decreasing curve
  that actually explains it: less time exposed. Convex and decreasing in speed.
- **Speed-rising risk — faster is worse.** Risks that *grow* with speed (cold /
  wind-chill) increase in speed; linear is fine here. Increasing in speed.

Their sum is U-shaped, with interior optimum `v* = √(A/B)` (then clamp to the
range), where `A` weights the exposure force and `B` the speed-rising force. Tune
`A`/`B` so `v*` lands inside the range for typical cells; where it doesn't, the
clamp correctly returns an endpoint. Keep every channel clamped to `[0,1]` and the
function deterministic (same profile + speed ⇒ same cost). The charts read the
same `riskCostBreakdown`, so the breakdown **must** be computed at the very speed
the planner chose.

## Acceptance criteria (`risk.test.ts`)

- Every channel of `baseProfile` ∈ `[0,1]` for all plausible samples.
- Monotonic where it should be: heat ↑ with temperature, cold ↓ with temperature,
  water ↑ as `waterProximity` ↓.
- Human tracks `banditActivity` / town biome; animals track vegetation.
- Pure: same sample ⇒ same profile.

## Build in isolation

Feed hand-built `TerrainSample`s (or samples from the mock map generator). No
other module needed. Property-test the range invariant across random samples
(seeded `Rng`).

## Open questions

- Should biome directly bump a channel (e.g. town → +human) in addition to the
  continuous attributes? v1: continuous attributes are primary; a small biome
  nudge is acceptable (the mock adds a savannah→animals nudge).
- Non-linear curves (e.g. heat ramps sharply above 35 °C)? Fine to add; keep
  *terrain*→level curves here, not in cost. (The **speed**→cost convexity above is
  the deliberate exception: speed isn't a terrain attribute, so it lives in the
  cost kernel.)
- Should the exposure force feed travel *time* too (slower ⇒ longer leg), or only
  cost? v1 keeps time and the speed-modified cost separate; revisit if the two
  need to share one dwell-time term.
