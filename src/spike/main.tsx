/**
 * Entry for the throwaway 3D temporal spike (a second Vite page, `temporal3d.html`).
 * Kept separate from the real app so it can't regress it.
 *
 * It drives the *real* store: regenerate a world, then enable day/night and add
 * a default weather system (storm band) so the stacked hours carry genuine
 * temporal structure to look through. Both use the app's own actions and the
 * storm generator's default parameters (see `ExtraRiskPanel`) — nothing bespoke.
 */
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import * as THREE from 'three';
import type { RiskZone } from '@domain';
import { useBlockbusterStore } from '@/state/store';
import { TemporalSpike } from './TemporalSpike';
import 'leaflet/dist/leaflet.css';
import './spike.css';

// Vertex colours reach the GPU exactly as authored, matching the 2D map.
THREE.ColorManagement.enabled = false;

// Match the demo's default seed so the permanent map shows the same terrain
// (e.g. the two dominant towns) you see in the live 2D map.
const SEED = 1;

const store = useBlockbusterStore;
store.getState().regenerate(SEED);
store.getState().setDayNight({ enabled: true });

// Default storm band (ExtraRiskPanel's "Generate storm band" defaults): cold
// +0.30, active 08:00–16:00, sweeping E→W and slanting left.
const { extent } = store.getState();
const storm: RiskZone = {
  id: 'spike-storm',
  name: 'Storm band',
  risk: 'cold',
  kind: 'polygon',
  ring: [],
  offset: 0.3,
  enabled: true,
  startTime: 8 * 60,
  endTime: 16 * 60,
  motion: { type: 'linear-sweep', fromX: extent.width, toX: 0, bandCells: 5, slantLeft: true },
};
store.getState().addZone(storm);

const rootElement = document.getElementById('root');
if (!rootElement) throw new Error('Root element #root not found');

createRoot(rootElement).render(
  <StrictMode>
    <TemporalSpike />
  </StrictMode>,
);
