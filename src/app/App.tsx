import { lazy, Suspense, useEffect } from 'react';
import { useBlockbusterStore } from '@/state/store';
import { Tabs } from '@/ui/components/Tabs';
import { MapView } from '@/ui/map/MapView';
import { WaypointsPanel } from '@/ui/panels/WaypointsPanel';
import { CoaPanel } from '@/ui/panels/CoaPanel';
import { ExtraRiskPanel } from '@/ui/panels/ExtraRiskPanel';
import { CellInspector } from '@/ui/panels/CellInspector';
import type { ActiveTab } from '@/state/types';

// The 3D view pulls in three.js + react-three-fiber (a large dependency), so it
// is code-split and only fetched when an analyst actually opens it — the default
// 2D app stays lightweight.
const TemporalView = lazy(() =>
  import('@/ui/temporal/TemporalView').then((m) => ({ default: m.TemporalView })),
);

// Risk appetite now lives at the top of the COAs tab as a row of vertical sliders.
const TABS: ReadonlyArray<{ id: ActiveTab; label: string }> = [
  { id: 'waypoints', label: 'Waypoints' },
  { id: 'extra', label: 'Extra factors' },
  { id: 'coas', label: 'COAs' },
];

export function App() {
  const regenerate = useBlockbusterStore((s) => s.regenerate);
  const activeTab = useBlockbusterStore((s) => s.activeTab);
  const setActiveTab = useBlockbusterStore((s) => s.setActiveTab);
  const temporalView = useBlockbusterStore((s) => s.temporalView);
  const setTemporalView = useBlockbusterStore((s) => s.setTemporalView);

  // Defer the initial world build so React can paint the app shell first.
  // Without this the synchronous map-gen / grid / risk scoring blocks the
  // main thread before the first frame, making the app appear to freeze.
  useEffect(() => {
    const id = setTimeout(() => regenerate(), 0);
    return () => clearTimeout(id);
  }, [regenerate]);

  // The 3D temporal view fills the whole tab using the current data source;
  // closing it restores the default app below (store state is untouched).
  if (temporalView) {
    return (
      <Suspense fallback={<div className="temporal-loading">Building 3D view…</div>}>
        <TemporalView onClose={() => setTemporalView(false)} />
      </Suspense>
    );
  }

  return (
    <div className="app-shell">
      <main className="map-pane">
        <MapView />
      </main>
      <aside className="side-pane">
        <header className="side-header">
          <div>
            <h1>Blockbuster</h1>
            <p className="tagline">
              Route risk through non-uniform space ·{' '}
              <a
                className="about-model-link"
                href="../docs/#assumptions"
                target="_blank"
                rel="noopener noreferrer"
                title="Risk scores are modelled judgements, not measurements — see Assumptions & Limitations"
              >
                About the model
              </a>
            </p>
          </div>
          <div className="side-header-actions">
            <button type="button" onClick={() => setTemporalView(true)}>
              3D temporal view
            </button>
            <button type="button" onClick={() => regenerate(Math.floor(Math.random() * 1e9))}>
              Regenerate
            </button>
          </div>
        </header>
        <Tabs tabs={TABS} active={activeTab} onChange={setActiveTab} />
        <div className="tab-body">
          {activeTab === 'waypoints' ? (
            <WaypointsPanel />
          ) : activeTab === 'coas' ? (
            <CoaPanel />
          ) : (
            <ExtraRiskPanel />
          )}
        </div>
        <CellInspector />
      </aside>
    </div>
  );
}
