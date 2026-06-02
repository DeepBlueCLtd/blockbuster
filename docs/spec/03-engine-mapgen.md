# 03 · Engine — Map generation

**Port:** `MapGenerator` · **Files:** `src/engine/mapgen/` · **Reference impl:**
`createMockMapGenerator` in `src/mocks/mockEngine.ts` · **Depends on:** `@domain`
only.

## Purpose

Procedurally synthesise a deterministic, plausible landscape over the world
rectangle and expose it as a continuous `TerrainField`. This is the *source of
truth for the environment*; everything risk-related is derived from it.

## Contract

```ts
createMapGenerator(): MapGenerator
MapGenerator.generate(config: MapGenConfig): TerrainField
TerrainField.sample(point: WorldPoint): TerrainSample   // pure, continuous
```

- `generate` is keyed by `config.seed` and `config.extent`.
- `sample` returns the same value for the same point on every call.
- Output `biome ∈ Biome`; continuous attributes within documented ranges
  (`vegetation/waterProximity/banditActivity ∈ [0,1]`, sensible elevation/temp).

## Design guidance

- Use layered value/Perlin/simplex noise (seeded via `@domain` `Rng` or a hash
  of coordinates+seed). The mock uses cheap layered sines — fine to start, but a
  real noise gives nicer coherent regions (woodland clumps, mountain ranges).
- Derive attributes from a few independent noise channels: an **elevation** field
  (drives mountains, and temperature inversely), a **moisture** field (drives
  woodland/water/savannah, vegetation, waterProximity), and a **settlement**
  field (towns + banditActivity).
- Suggested biome logic: high elevation → mountains; high moisture + low
  elevation → water; rare settlement peaks → town; otherwise woodland (wet) /
  savannah (dry) / grassland (mid). Keep it tunable via `MapGenTuning`.
- Consider baking a coarse raster for fast rendering later, but the **interface
  is `sample(point)`** — keep it continuous.

## Acceptance criteria (`mapgen.test.ts`)

- Determinism: identical seed ⇒ identical field (deep-equal a sampled grid).
- Variation: different seeds ⇒ measurably different fields.
- Only emits `Biome` members; every attribute within range.
- `sample` is pure (stable across repeated calls).
- Biome mix roughly responds to `MapGenTuning.biomeBias`.

## Build in isolation

You need nothing else — input/output are `@domain` types. Snapshot a small grid
of samples for regression. The hex-grid and risk teams consume your `sample`,
but can use `createMockMapGenerator` until you land.

## Open questions

- Do towns need to be discrete points (markers) or just a biome class? v1: biome
  class is enough.
- Should water be impassable for routing, or just high "lack of water = 0" + a
  movement penalty? v1: passable; revisit with routing.
