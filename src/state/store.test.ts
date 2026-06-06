import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { RiskZone, RoutePlan } from '@domain';
import { createMockEngine } from '@/mocks/mockEngine';
import { createBlockbusterStore, selectEffectiveProfile } from './store';

function makeZone(id: string, over: Partial<RiskZone> = {}): RiskZone {
  return {
    id,
    name: `Zone ${id}`,
    risk: 'animals',
    offset: 0,
    kind: 'rectangle',
    ring: [
      { x: 0, y: 0 },
      { x: 5, y: 0 },
      { x: 5, y: 5 },
      { x: 0, y: 5 },
    ],
    enabled: true,
    ...over,
  };
}

describe('store — extra-risk zones', () => {
  let store: ReturnType<typeof createBlockbusterStore>;
  beforeEach(() => {
    store = createBlockbusterStore(createMockEngine());
  });

  describe('store — risk chart layer exclusivity', () => {
    let store: ReturnType<typeof createBlockbusterStore>;
    beforeEach(() => {
      store = createBlockbusterStore(createMockEngine());
    });

    it('enables at most one risk chart layer at a time', () => {
      store.getState().setShowRiskPies(true);
      expect(store.getState().showRiskPies).toBe(true);
      expect(store.getState().showRiskBars).toBe(false);
      expect(store.getState().showRiskStacks).toBe(false);

      store.getState().setShowRiskBars(true);
      expect(store.getState().showRiskPies).toBe(false);
      expect(store.getState().showRiskBars).toBe(true);
      expect(store.getState().showRiskStacks).toBe(false);

      store.getState().setShowRiskStacks(true);
      expect(store.getState().showRiskPies).toBe(false);
      expect(store.getState().showRiskBars).toBe(false);
      expect(store.getState().showRiskStacks).toBe(true);
    });

    it('allows all risk chart layers to be off', () => {
      store.getState().setShowRiskPies(true);
      store.getState().setShowRiskPies(false);
      expect(store.getState().showRiskPies).toBe(false);
      expect(store.getState().showRiskBars).toBe(false);
      expect(store.getState().showRiskStacks).toBe(false);
    });
  });

  it('adds a zone and selects it', () => {
    store.getState().addZone(makeZone('a'));
    expect(store.getState().zones).toHaveLength(1);
    expect(store.getState().selectedZoneId).toBe('a');
  });

  it('updates name and risk, and clamps the offset to [-0.5, 0.5]', () => {
    store.getState().addZone(makeZone('a'));
    store.getState().updateZone('a', { name: 'Minefield', risk: 'human', offset: 0.9 });
    const zone = store.getState().zones[0];
    expect(zone?.name).toBe('Minefield');
    expect(zone?.risk).toBe('human');
    expect(zone?.offset).toBe(0.5); // clamped from 0.9
    store.getState().updateZone('a', { offset: -3 });
    expect(store.getState().zones[0]?.offset).toBe(-0.5); // clamped from -3
  });

  it('removes a zone and clears its selection', () => {
    store.getState().addZone(makeZone('a'));
    store.getState().removeZone('a');
    expect(store.getState().zones).toHaveLength(0);
    expect(store.getState().selectedZoneId).toBeNull();
  });

  it('tracks the risk channel chosen for new zones', () => {
    expect(store.getState().zoneRiskType).toBe('animals');
    store.getState().setZoneRiskType('heat');
    expect(store.getState().zoneRiskType).toBe('heat');
  });

  it('seeds a default cyclone, switched off, on every generated world (no default zones)', () => {
    store.getState().regenerate(1);
    expect(store.getState().zones).toHaveLength(0);
    const cyclone = store.getState().cyclone;
    expect(cyclone?.id).toBe('default-cyclone');
    expect(cyclone?.enabled).toBe(false); // weather is opt-in
    expect(cyclone?.outerRadiusKm).toBeGreaterThan(0);
  });

  it('toggles the cyclone (weather) on and off', () => {
    store.getState().regenerate(1);
    expect(store.getState().cyclone?.enabled).toBe(false);
    store.getState().toggleCyclone();
    expect(store.getState().cyclone?.enabled).toBe(true);
    store.getState().toggleCyclone();
    expect(store.getState().cyclone?.enabled).toBe(false);
  });

  it('enables day/night on every generated world, re-enabling it on regenerate', () => {
    expect(store.getState().dayNight.enabled).toBe(false); // default, before any build
    store.getState().regenerate(1);
    expect(store.getState().dayNight.enabled).toBe(true);
    store.getState().setDayNight({ enabled: false });
    store.getState().regenerate(2);
    expect(store.getState().dayNight.enabled).toBe(true);
  });

  it('keeps analyst zones on a same-seed rebuild and drops them on a new seed, always re-seeding the cyclone', () => {
    store.getState().regenerate(1);
    store.getState().addZone(makeZone('a'));
    expect(store.getState().zones).toHaveLength(1); // analyst zone only — no default zone

    // A same-seed rebuild (e.g. a hex-size change) keeps analyst zones and
    // re-seeds the cyclone.
    store.getState().regenerate(1);
    const sameSeed = store.getState().zones;
    expect(sameSeed).toHaveLength(1);
    expect(sameSeed.some((z) => z.id === 'a')).toBe(true);
    expect(store.getState().cyclone?.id).toBe('default-cyclone');

    // A new seed is a new basemap: analyst zones are dropped; the cyclone remains.
    store.getState().regenerate(2);
    expect(store.getState().zones).toHaveLength(0);
    expect(store.getState().cyclone?.id).toBe('default-cyclone');
    expect(store.getState().selectedZoneId).toBeNull();
  });

  it('toggles the full-viewport 3D temporal view flag', () => {
    expect(store.getState().temporalView).toBe(false);
    store.getState().setTemporalView(true);
    expect(store.getState().temporalView).toBe(true);
    store.getState().setTemporalView(false);
    expect(store.getState().temporalView).toBe(false);
  });

  it('folds an area-weighted zone offset into the effective profile', () => {
    store.getState().regenerate(1);
    const grid = store.getState().grid;
    // A central cell is fully inside the world, so a world-spanning zone covers it 100%.
    const cellId = grid?.pointToCell({ x: 25, y: 15 });
    expect(cellId).toBeDefined();
    if (!cellId) return;

    const baseHuman = selectEffectiveProfile(store.getState(), cellId)?.human ?? 0;

    // A zone covering the whole world (coverage 1 everywhere) raising human by 0.5.
    store.getState().addZone(
      makeZone('world', {
        risk: 'human',
        offset: 0.5,
        ring: [
          { x: 0, y: 0 },
          { x: 50, y: 0 },
          { x: 50, y: 30 },
          { x: 0, y: 30 },
        ],
      }),
    );

    expect(store.getState().zoneContribution.get(cellId)?.human ?? 0).toBeCloseTo(0.5, 6);
    const withZone = selectEffectiveProfile(store.getState(), cellId)?.human ?? 0;
    expect(withZone).toBeCloseTo(Math.min(1, baseHuman + 0.5), 6);
  });
});

describe('store — hex-size decoupling', () => {
  it('live-resizes the grid and clears the COAs immediately', () => {
    vi.useFakeTimers();
    try {
      const store = createBlockbusterStore(createMockEngine());
      store.getState().regenerate(1);
      const grid = store.getState().grid;
      const cellCount = grid?.cells.length ?? 0;
      expect(cellCount).toBeGreaterThan(0);

      // Pretend a worker result from a previous cycle is on screen.
      const plan: RoutePlan = { coas: [], waypoints: [], generatedAt: 0 };
      store.setState({ plan, selectedCoaId: 'coa-1' });

      store.getState().setHexSize(4);

      // The grid tracks the slider at once (live resize) and the stale COAs are gone.
      expect(store.getState().hexSize).toBe(4);
      expect(store.getState().grid).not.toBe(grid);
      expect(store.getState().grid?.cells.length).toBeLessThan(cellCount);
      expect(store.getState().plan).toBeNull();
      expect(store.getState().selectedCoaId).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it('reuses the terrain field on a hex-size change so the base map is not re-rasterised', () => {
    vi.useFakeTimers();
    try {
      const store = createBlockbusterStore(createMockEngine());
      store.getState().regenerate(1);
      const field = store.getState().field;
      expect(field).not.toBeNull();

      // A live resize rebuilds the grid but keeps the same field object, so
      // TerrainLayer's cached raster stays valid — no expensive re-rasterise.
      store.getState().setHexSize(4);
      expect(store.getState().field).toBe(field);

      // A new seed is a new world, so the field (and its raster) is rebuilt.
      store.getState().regenerate(2);
      expect(store.getState().field).not.toBe(field);
    } finally {
      vi.useRealTimers();
    }
  });

  it('rebuilds live on every step but coalesces the replan to a single run', () => {
    vi.useFakeTimers();
    try {
      const engine = createMockEngine();
      const planSpy = vi.spyOn(engine.routePlanner, 'plan');
      const store = createBlockbusterStore(engine);
      store.getState().regenerate(1);
      planSpy.mockClear(); // ignore the initial regenerate's replan

      // Drag the slider across several steps within one debounce window.
      store.getState().setHexSize(3);
      const gridA = store.getState().grid;
      store.getState().setHexSize(3.5);
      const gridB = store.getState().grid;
      store.getState().setHexSize(4);
      const gridC = store.getState().grid;

      // Each step rebuilt the grid live (distinct grids) without replanning yet.
      expect(gridA).not.toBe(gridB);
      expect(gridB).not.toBe(gridC);
      expect(planSpy).not.toHaveBeenCalled();

      // The replan fires once, after the drag settles, at the final size.
      vi.advanceTimersByTime(200);
      expect(planSpy).toHaveBeenCalledTimes(1);
      expect(store.getState().hexSize).toBe(4);
    } finally {
      vi.useRealTimers();
    }
  });
});
