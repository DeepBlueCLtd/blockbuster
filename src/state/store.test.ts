import { describe, it, expect, beforeEach } from 'vitest';
import type { RiskZone } from '@domain';
import { createMockEngine } from '@/mocks/mockEngine';
import { createBlockbusterStore } from './store';

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
    ...over,
  };
}

describe('store — extra-risk zones', () => {
  let store: ReturnType<typeof createBlockbusterStore>;
  beforeEach(() => {
    store = createBlockbusterStore(createMockEngine());
  });

  it('adds a zone and selects it', () => {
    store.getState().addZone(makeZone('a'));
    expect(store.getState().zones).toHaveLength(1);
    expect(store.getState().selectedZoneId).toBe('a');
  });

  it('updates name and risk, and clamps the offset to [-0.5, 0.5]', () => {
    store.getState().addZone(makeZone('a'));
    store.getState().updateZone('a', { name: 'Minefield', risk: 'thief', offset: 0.9 });
    const zone = store.getState().zones[0];
    expect(zone?.name).toBe('Minefield');
    expect(zone?.risk).toBe('thief');
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
});
