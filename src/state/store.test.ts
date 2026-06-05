import { describe, it, expect, beforeEach } from 'vitest';
import type { RiskZone } from '@domain';
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

  it('seeds a default storm band on every generated world', () => {
    store.getState().regenerate(1);
    const zones = store.getState().zones;
    expect(zones).toHaveLength(1);
    expect(zones[0]?.id).toBe('default-storm');
    expect(zones[0]?.risk).toBe('cold');
    expect(zones[0]?.motion?.type).toBe('linear-sweep');
  });

  it('enables day/night on every generated world, re-enabling it on regenerate', () => {
    expect(store.getState().dayNight.enabled).toBe(false); // default, before any build
    store.getState().regenerate(1);
    expect(store.getState().dayNight.enabled).toBe(true);
    store.getState().setDayNight({ enabled: false });
    store.getState().regenerate(2);
    expect(store.getState().dayNight.enabled).toBe(true);
  });

  it('keeps analyst zones on a same-seed rebuild and drops them on a new seed, always refreshing one default storm', () => {
    store.getState().regenerate(1);
    store.getState().addZone(makeZone('a'));
    expect(store.getState().zones).toHaveLength(2); // default storm + 'a'

    // A same-seed rebuild (e.g. a hex-size change) keeps analyst zones; the
    // default storm is re-seeded, so there is still exactly one copy of it.
    store.getState().regenerate(1);
    const sameSeed = store.getState().zones;
    expect(sameSeed).toHaveLength(2);
    expect(sameSeed.filter((z) => z.id === 'default-storm')).toHaveLength(1);
    expect(sameSeed.some((z) => z.id === 'a')).toBe(true);

    // A new seed is a new basemap: analyst zones are dropped, the storm remains.
    store.getState().regenerate(2);
    const newSeed = store.getState().zones;
    expect(newSeed).toHaveLength(1);
    expect(newSeed[0]?.id).toBe('default-storm');
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
