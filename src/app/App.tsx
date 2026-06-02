import { useEffect } from 'react';
import { useBlockbusterStore } from '@/state/store';
import { Tabs } from '@/ui/components/Tabs';
import { MapView } from '@/ui/map/MapView';
import { RiskAppetitePanel } from '@/ui/panels/RiskAppetitePanel';
import { WaypointsPanel } from '@/ui/panels/WaypointsPanel';
import { CoaPanel } from '@/ui/panels/CoaPanel';
import { CellInspector } from '@/ui/panels/CellInspector';
import type { ActiveTab } from '@/state/types';

const TABS: ReadonlyArray<{ id: ActiveTab; label: string }> = [
  { id: 'risk', label: 'Risk appetite' },
  { id: 'waypoints', label: 'Waypoints' },
  { id: 'coas', label: 'COAs' },
];

export function App() {
  const regenerate = useBlockbusterStore((s) => s.regenerate);
  const activeTab = useBlockbusterStore((s) => s.activeTab);
  const setActiveTab = useBlockbusterStore((s) => s.setActiveTab);

  // Build the initial world once on mount.
  useEffect(() => {
    regenerate();
  }, [regenerate]);

  return (
    <div className="app-shell">
      <main className="map-pane">
        <MapView />
      </main>
      <aside className="side-pane">
        <header className="side-header">
          <div>
            <h1>Blockbuster</h1>
            <p className="tagline">Route risk through non-uniform space</p>
          </div>
          <button type="button" onClick={() => regenerate(Math.floor(Math.random() * 1e9))}>
            Regenerate
          </button>
        </header>
        <Tabs tabs={TABS} active={activeTab} onChange={setActiveTab} />
        <div className="tab-body">
          {activeTab === 'risk' ? (
            <RiskAppetitePanel />
          ) : activeTab === 'waypoints' ? (
            <WaypointsPanel />
          ) : (
            <CoaPanel />
          )}
        </div>
        <CellInspector />
      </aside>
    </div>
  );
}
