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
- Non-linear curves (e.g. heat ramps sharply above 35 °C)? Fine to add; keep them
  here, not in cost.
