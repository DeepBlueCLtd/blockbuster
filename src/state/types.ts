import type {
  CellId,
  CellRiskState,
  CostParams,
  DayNightConfig,
  HexGrid,
  JourneyParams,
  RiskType,
  RiskZone,
  RoutePlan,
  TerrainField,
  TerrainSample,
  TimeWindow,
  WorldExtent,
  ZoneKind,
  Km,
} from '@domain';

/** Which risk channel the map shades cells by (or a composite of all). */
export type DisplayRisk = RiskType | 'composite';

/** Right-hand tab selection. */
export type ActiveTab = 'waypoints' | 'coas' | 'extra';

/** The armed extra-risk drawing tool, or null when none is active. */
export type DrawMode = ZoneKind | null;

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
  /** Per-cell, area-weighted sum of zone offsets per channel (derived from zones + grid). */
  zoneContribution: Map<CellId, Partial<Record<RiskType, number>>>;

  // --- Analyst controls ---
  costParams: CostParams;
  waypoints: CellId[];
  /** When true the planner may reorder waypoints (after the first) to minimise cost. */
  optimiseOrder: boolean;
  /** Extra-risk zones drawn over the current basemap (cleared on regenerate). */
  zones: RiskZone[];
  /** Which risk channel a newly drawn zone targets (the Extra-risk tab dropdown). */
  zoneRiskType: RiskType;

  // --- Journey / time mechanics ---
  journeyParams: JourneyParams;
  dayNight: DayNightConfig;
  /**
   * Optional arrival time window per waypoint (parallel to `waypoints`).
   * Always the same length as `waypoints`; null means no constraint.
   */
  waypointWindows: (TimeWindow | null)[];
  /**
   * Current display time for the map overlay (minutes from midnight).
   * UI-only: changing this does NOT trigger a replan.
   */
  displayTime: number;

  // --- Routing output ---
  plan: RoutePlan | null;
  planning: boolean;
  planError: string | null;

  // --- View / selection ---
  selectedCellId: CellId | null;
  selectedCoaId: string | null;
  hoveredCellId: CellId | null;
  selectedZoneId: string | null;
  /** Currently armed extra-risk draw tool (only meaningful on the Extra-risk tab). */
  drawMode: DrawMode;
  activeTab: ActiveTab;
  displayRisk: DisplayRisk;
  /** Whether the continuous terrain base map is drawn. */
  showTerrain: boolean;
  /** Whether the hex grid (with risk shading) is drawn over the map. */
  showHexGrid: boolean;
  /** Whether each cell's per-risk cost breakdown is drawn as a pie overlay. */
  showRiskPies: boolean;
  /** Whether each cell's per-risk cost is drawn as a grouped bar chart overlay. */
  showRiskBars: boolean;
  /** Whether each cell's per-risk cost is drawn as a stacked bar overlay. */
  showRiskStacks: boolean;
  /** Whether the generated route lines and waypoint markers are drawn. */
  showRoutes: boolean;

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
  setOptimiseOrder: (optimise: boolean) => void;
  replan: () => Promise<void>;
  selectCell: (cellId: CellId | null) => void;
  selectCoa: (coaId: string | null) => void;
  hoverCell: (cellId: CellId | null) => void;
  setActiveTab: (tab: ActiveTab) => void;
  setDisplayRisk: (risk: DisplayRisk) => void;
  setShowTerrain: (show: boolean) => void;
  setShowHexGrid: (show: boolean) => void;
  setShowRiskPies: (show: boolean) => void;
  setShowRiskBars: (show: boolean) => void;
  setShowRiskStacks: (show: boolean) => void;
  setShowRoutes: (show: boolean) => void;
  // --- Journey / time mechanics ---
  setJourneyParams: (patch: Partial<JourneyParams>) => void;
  setDayNight: (config: DayNightConfig) => void;
  /** Set or clear the time window for a waypoint by index. */
  setWaypointWindow: (index: number, window: TimeWindow | null) => void;
  /** Update the map display time without triggering a replan. */
  setDisplayTime: (minutes: number) => void;

  // --- Extra-risk zones ---
  addZone: (zone: RiskZone) => void;
  updateZone: (
    id: string,
    patch: Partial<Pick<RiskZone, 'name' | 'risk' | 'offset'>> & {
      startTime?: number | null;
      endTime?: number | null;
    },
  ) => void;
  removeZone: (id: string) => void;
  selectZone: (id: string | null) => void;
  toggleZoneEnabled: (id: string) => void;
  setDrawMode: (mode: DrawMode) => void;
  setZoneRiskType: (risk: RiskType) => void;
}
