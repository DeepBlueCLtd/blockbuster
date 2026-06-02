import type {
  CellId,
  CellRiskState,
  CostParams,
  HexGrid,
  RiskType,
  RoutePlan,
  TerrainField,
  TerrainSample,
  WorldExtent,
  Km,
} from '@domain';

/** Which risk channel the map shades cells by (or a composite of all). */
export type DisplayRisk = RiskType | 'composite';

/** Right-hand tab selection. */
export type ActiveTab = 'waypoints' | 'coas';

/**
 * The complete application state plus the actions that mutate it. The store is
 * the *only* place UI and engine meet: components read this shape and call these
 * actions; nothing else in the UI imports the engine.
 */
export interface BlockbusterState {
  // --- Configuration ---
  seed: number;
  extent: WorldExtent;
  hexSize: Km;

  // --- Derived world (rebuilt on regenerate) ---
  grid: HexGrid | null;
  /** Continuous terrain function, kept so the base map can sample it at any resolution. */
  field: TerrainField | null;
  terrain: Map<CellId, TerrainSample>;
  riskStates: Map<CellId, CellRiskState>;

  // --- Analyst controls ---
  costParams: CostParams;
  waypoints: CellId[];

  // --- Routing output ---
  plan: RoutePlan | null;
  planning: boolean;
  planError: string | null;

  // --- View / selection ---
  selectedCellId: CellId | null;
  selectedCoaId: string | null;
  hoveredCellId: CellId | null;
  activeTab: ActiveTab;
  displayRisk: DisplayRisk;
  /** Whether the continuous terrain base map is drawn. */
  showTerrain: boolean;
  /** Whether the hex grid (with risk shading) is drawn over the map. */
  showHexGrid: boolean;
  /** Whether each cell's per-risk cost breakdown is drawn as a pie overlay. */
  showRiskPies: boolean;

  // --- Actions ---
  /** Build (or rebuild) the world from the current seed/extent/hexSize. */
  regenerate: (seed?: number) => void;
  setHexSize: (size: Km) => void;
  setAppetite: (risk: RiskType, value: number) => void;
  setOverride: (cellId: CellId, risk: RiskType, value: number) => void;
  resetOverride: (cellId: CellId, risk?: RiskType) => void;
  toggleWaypoint: (cellId: CellId) => void;
  /** Move the waypoint at `from` to position `to`, preserving the rest of the order. */
  reorderWaypoint: (from: number, to: number) => void;
  /** Relocate the waypoint at `index` onto a different cell, keeping its sequence position. */
  relocateWaypoint: (index: number, cellId: CellId) => void;
  clearWaypoints: () => void;
  replan: () => Promise<void>;
  selectCell: (cellId: CellId | null) => void;
  selectCoa: (coaId: string | null) => void;
  hoverCell: (cellId: CellId | null) => void;
  setActiveTab: (tab: ActiveTab) => void;
  setDisplayRisk: (risk: DisplayRisk) => void;
  setShowTerrain: (show: boolean) => void;
  setShowHexGrid: (show: boolean) => void;
  setShowRiskPies: (show: boolean) => void;
}
