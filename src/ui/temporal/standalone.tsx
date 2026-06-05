/**
 * Standalone entry for the 3D temporal view (a second Vite page,
 * `temporal3d.html`). It mounts the view on its own, outside the main app shell
 * — handy for isolated or headless inspection of the WebGL render.
 *
 * It drives the *real* store: regenerating a world now seeds day/night and a
 * default storm band (see `regenerate` in the store), so the stacked hours carry
 * genuine temporal structure to look through — nothing bespoke here.
 */
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { useBlockbusterStore } from '@/state/store';
import { TemporalView } from './TemporalView';
import 'leaflet/dist/leaflet.css';

// Match the app's default seed so the standalone page shows the same terrain
// (e.g. the two dominant towns) you see in the live 2D map.
const SEED = 1;
useBlockbusterStore.getState().regenerate(SEED);

const rootElement = document.getElementById('root');
if (!rootElement) throw new Error('Root element #root not found');

createRoot(rootElement).render(
  <StrictMode>
    <TemporalView />
  </StrictMode>,
);
