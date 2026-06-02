import { create } from 'zustand';
import type { CellId, CellRiskState, Engine, HexGrid, RiskProfile, RouteRequest } from '@domain';
import {
  cellRiskCost,
  clamp01,
  DEFAULT_COST_PARAMS,
  DEFAULT_EXTENT,
  DEFAULT_HEX_SIZE_KM,
  effectiveProfile,
  RISK_TYPES,
  toHexGridDto,
} from '@domain';
import { createMockEngine } from '@/mocks/mockEngine';
import type { BlockbusterState } from './types';

/** Pick two opposite-corner cells to seed routing with something to show. */
function defaultWaypoints(grid: HexGrid): CellId[] {
  const a = grid.pointToCell({ x: grid.extent.width * 0.12, y: grid.extent.height * 0.2 });
  const b = grid.pointToCell({ x: grid.extent.width * 0.88, y: grid.extent.height * 0.8 });
  const first = grid.cells[0]?.id;
  const last = grid.cells[grid.cells.length - 1]?.id;
  const start = a ?? first;
  const end = b ?? last;
  return start && end && start !== end ? [start, end] : [];
}

/**
 * Factory so tests can spin up isolated stores with a custom or fake
 * {@link Engine}. The app uses the default singleton below.
 */
export function createBlockbusterStore(engine: Engine) {
  let replanTimer: ReturnType<typeof setTimeout> | undefined;

  return create<BlockbusterState>()((set, get) => {
    const scheduleReplan = () => {
      if (replanTimer) clearTimeout(replanTimer);
      replanTimer = setTimeout(() => void get().replan(), 150);
    };

    return {
      seed: 1,
      extent: DEFAULT_EXTENT,
      hexSize: DEFAULT_HEX_SIZE_KM,

      grid: null,
      field: null,
      terrain: new Map(),
      riskStates: new Map(),

      costParams: DEFAULT_COST_PARAMS,
      waypoints: [],

      plan: null,
      planning: false,
      planError: null,

      selectedCellId: null,
      selectedCoaId: null,
      hoveredCellId: null,
      activeTab: 'risk',
      displayRisk: 'composite',
      // Start on the underlying terrain map; the hex grid is a switchable overlay.
      showTerrain: true,
      showHexGrid: false,
      showRiskPies: false,

      regenerate: (seed) => {
        const s = get();
        const useSeed = seed ?? s.seed;
        const grid = engine.gridBuilder.build(s.extent, {
          orientation: 'pointy',
          size: s.hexSize,
        });
        const field = engine.mapGenerator.generate({ extent: s.extent, seed: useSeed });
        const terrain = engine.gridBuilder.sampleTerrain(grid, field);
        const riskStates = new Map<CellId, CellRiskState>();
        for (const cell of grid.cells) {
          const sample = terrain.get(cell.id);
          if (!sample) continue;
          riskStates.set(cell.id, {
            cellId: cell.id,
            base: engine.riskEngine.baseProfile(sample),
            overrides: {},
          });
        }
        let waypoints = s.waypoints.filter((id) => grid.get(id));
        if (waypoints.length < 2) waypoints = defaultWaypoints(grid);

        set({
          seed: useSeed,
          grid,
          field,
          terrain,
          riskStates,
          waypoints,
          selectedCellId: null,
          selectedCoaId: null,
        });
        void get().replan();
      },

      setHexSize: (size) => {
        set({ hexSize: size });
        get().regenerate();
      },

      setAppetite: (risk, value) => {
        const s = get();
        set({
          costParams: {
            ...s.costParams,
            appetite: { ...s.costParams.appetite, [risk]: clamp01(value) },
          },
        });
        scheduleReplan();
      },

      setOverride: (cellId, risk, value) => {
        const s = get();
        const state = s.riskStates.get(cellId);
        if (!state) return;
        const next = new Map(s.riskStates);
        next.set(cellId, { ...state, overrides: { ...state.overrides, [risk]: clamp01(value) } });
        set({ riskStates: next });
        scheduleReplan();
      },

      resetOverride: (cellId, risk) => {
        const s = get();
        const state = s.riskStates.get(cellId);
        if (!state) return;
        const overrides = { ...state.overrides };
        if (risk) delete overrides[risk];
        else for (const r of RISK_TYPES) delete overrides[r];
        const next = new Map(s.riskStates);
        next.set(cellId, { ...state, overrides });
        set({ riskStates: next });
        scheduleReplan();
      },

      toggleWaypoint: (cellId) => {
        const s = get();
        const exists = s.waypoints.includes(cellId);
        // Adding appends to the end of the sequence; the analyst reorders from there.
        const waypoints = exists
          ? s.waypoints.filter((id) => id !== cellId)
          : [...s.waypoints, cellId];
        set({ waypoints });
        if (waypoints.length >= 2) void get().replan();
        else set({ plan: null });
      },

      reorderWaypoint: (from, to) => {
        const s = get();
        const last = s.waypoints.length - 1;
        if (from === to || from < 0 || from > last || to < 0 || to > last) return;
        const waypoints = s.waypoints.slice();
        const [moved] = waypoints.splice(from, 1);
        if (moved === undefined) return;
        waypoints.splice(to, 0, moved);
        set({ waypoints });
        if (waypoints.length >= 2) void get().replan();
      },

      relocateWaypoint: (index, cellId) => {
        const s = get();
        if (index < 0 || index >= s.waypoints.length) return;
        // Ignore no-ops, unknown cells, and drops onto a cell that's already a waypoint.
        if (s.waypoints[index] === cellId) return;
        if (!s.grid?.get(cellId) || s.waypoints.includes(cellId)) return;
        const waypoints = s.waypoints.slice();
        waypoints[index] = cellId;
        set({ waypoints });
        if (waypoints.length >= 2) void get().replan();
      },

      clearWaypoints: () => {
        set({ waypoints: [], plan: null, selectedCoaId: null });
      },

      replan: async () => {
        const s = get();
        if (!s.grid || s.waypoints.length < 2) {
          set({ plan: null });
          return;
        }
        set({ planning: true, planError: null });
        const risk: Record<CellId, RiskProfile> = {};
        for (const [id, state] of s.riskStates) risk[id] = effectiveProfile(state);
        const request: RouteRequest = {
          grid: toHexGridDto(s.grid),
          risk,
          params: s.costParams,
          waypoints: s.waypoints,
          coaCount: 3,
        };
        try {
          const plan = await engine.routePlanner.plan(request);
          // Ignore stale results whose waypoints no longer match the live state.
          if (get().waypoints.join('>') !== request.waypoints.join('>')) return;
          set({
            plan,
            planning: false,
            selectedCoaId: plan.coas[0]?.id ?? null,
          });
        } catch (error) {
          set({
            planning: false,
            planError: error instanceof Error ? error.message : String(error),
          });
        }
      },

      // Re-selecting the currently selected cell clears the selection (toggle).
      selectCell: (cellId) =>
        set({ selectedCellId: get().selectedCellId === cellId ? null : cellId }),
      selectCoa: (coaId) => set({ selectedCoaId: coaId }),
      hoverCell: (cellId) => set({ hoveredCellId: cellId }),
      setActiveTab: (tab) => set({ activeTab: tab }),
      setDisplayRisk: (risk) => set({ displayRisk: risk }),
      setShowTerrain: (show) => set({ showTerrain: show }),
      setShowHexGrid: (show) => set({ showHexGrid: show }),
      setShowRiskPies: (show) => set({ showRiskPies: show }),
    };
  });
}

/** The app-wide store, wired to the mock engine until real modules land. */
export const useBlockbusterStore = createBlockbusterStore(createMockEngine());

// --- Selectors (pure, reusable derivations) -------------------------------

/** Effective (post-override) risk profile for a cell, or null if unknown. */
export function selectEffectiveProfile(
  state: BlockbusterState,
  cellId: CellId | null,
): RiskProfile | null {
  if (!cellId) return null;
  const risk = state.riskStates.get(cellId);
  return risk ? effectiveProfile(risk) : null;
}

/**
 * Composite traversal cost of a cell under the current appetite — used to shade
 * the map when `displayRisk === 'composite'`.
 */
export function selectCellCost(state: BlockbusterState, cellId: CellId): number {
  const risk = state.riskStates.get(cellId);
  if (!risk) return 0;
  return cellRiskCost(effectiveProfile(risk), state.costParams);
}
