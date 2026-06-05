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

  it('drops zones when the seed changes but keeps them on a same-seed rebuild', () => {
    store.getState().regenerate(1);
    store.getState().addZone(makeZone('a'));

    // A same-seed rebuild (e.g. a hex-size change) keeps the basemap, so zones stay.
    store.getState().regenerate(1);
    expect(store.getState().zones).toHaveLength(1);

    // A new seed is a new basemap, so its zones no longer apply and are dropped.
    store.getState().regenerate(2);
    expect(store.getState().zones).toHaveLength(0);
    expect(store.getState().selectedZoneId).toBeNull();
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
  it('clears the COAs at once but defers the heavy rebuild to a debounce', () => {
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

      // The control reflects the new size immediately and the stale COAs are gone …
      expect(store.getState().hexSize).toBe(4);
      expect(store.getState().plan).toBeNull();
      expect(store.getState().selectedCoaId).toBeNull();
      // … but the world is not rebuilt synchronously (still the same grid object).
      expect(store.getState().grid).toBe(grid);

      // Once the slider settles, the debounce fires and rebuilds the grid larger.
      vi.advanceTimersByTime(200);
      expect(store.getState().grid).not.toBe(grid);
      expect(store.getState().grid?.cells.length).toBeLessThan(cellCount);
    } finally {
      vi.useRealTimers();
    }
  });

  it('coalesces rapid slider changes into a single rebuild at the final size', () => {
    vi.useFakeTimers();
    try {
      const store = createBlockbusterStore(createMockEngine());
      store.getState().regenerate(1);
      const grid = store.getState().grid;

      // Drag the slider across several values inside one debounce window.
      store.getState().setHexSize(3);
      vi.advanceTimersByTime(50);
      store.getState().setHexSize(3.5);
      vi.advanceTimersByTime(50);
      store.getState().setHexSize(4);
      // Each change reset the timer, so no rebuild has happened yet.
      expect(store.getState().grid).toBe(grid);

      // Only the final size rebuilds, exactly once.
      vi.advanceTimersByTime(200);
      const rebuilt = store.getState().grid;
      expect(rebuilt).not.toBe(grid);
      expect(store.getState().hexSize).toBe(4);
      vi.advanceTimersByTime(500);
      expect(store.getState().grid).toBe(rebuilt);
    } finally {
      vi.useRealTimers();
    }
  });
});
