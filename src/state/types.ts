import type {
  CellId,
  CellRiskState,
  CostParams,
  HexGrid,
  RiskType,
  RoutePlan,
  TerrainSample,
  WorldExtent,
  Km,
} from '@domain';

/** Which risk channel the map shades cells by (or a composite of all). */
export type DisplayRisk = RiskType | 'composite';

/** Right-hand tab selection. */
export type ActiveTab = 'risk' | 'coas';

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

  // --- Actions ---
  /** Build (or rebuild) the world from the current seed/extent/hexSize. */
  regenerate: (seed?: number) => void;
  setHexSize: (size: Km) => void;
  setAppetite: (risk: RiskType, value: number) => void;
  setOverride: (cellId: CellId, risk: RiskType, value: number) => void;
  resetOverride: (cellId: CellId, risk?: RiskType) => void;
  toggleWaypoint: (cellId: CellId) => void;
  clearWaypoints: () => void;
  replan: () => Promise<void>;
  selectCell: (cellId: CellId | null) => void;
  selectCoa: (coaId: string | null) => void;
  hoverCell: (cellId: CellId | null) => void;
  setActiveTab: (tab: ActiveTab) => void;
  setDisplayRisk: (risk: DisplayRisk) => void;
}
