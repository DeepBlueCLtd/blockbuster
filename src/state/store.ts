import { create } from 'zustand';
import type {
  CellId,
  CellRiskState,
  Engine,
  HexGrid,
  RiskProfile,
  RiskType,
  RiskZone,
  RouteRequest,
  TimeWindow,
  WorldPoint,
} from '@domain';
import {
  applyTemporalModifiers,
  applyZoneOffsets,
  cellRiskCost,
  clamp01,
  clampZoneOffset,
  coverageFraction,
  createDefaultCyclone,
  DEFAULT_COST_PARAMS,
  DEFAULT_DAY_NIGHT,
  DEFAULT_EXTENT,
  DEFAULT_HEX_SIZE_KM,
  DEFAULT_JOURNEY_PARAMS,
  effectiveProfile,
  isZoneActiveAt,
  ringAt,
  RISK_TYPES,
  speedModifiedProfile,
  toHexGridDto,
  zoneOffsetsForCell,
} from '@domain';
import { createEngine } from '@/engine';
import type { BlockbusterState } from './types';

/**
 * Per-cell, area-weighted offsets for always-active, static zones only.
 * Zones with time bounds or motion are handled per A* step in the worker.
 */
function computeZoneContribution(
  grid: HexGrid | null,
  zones: RiskZone[],
): Map<CellId, Partial<Record<RiskType, number>>> {
  const alwaysActive = zones.filter(
    (z) => z.startTime === undefined && z.endTime === undefined && !z.motion,
  );
  const out = new Map<CellId, Partial<Record<RiskType, number>>>();
  if (!grid || alwaysActive.length === 0) return out;
  for (const cell of grid.cells) {
    const offsets = zoneOffsetsForCell(cell.vertices, alwaysActive);
    if (Object.keys(offsets).length > 0) out.set(cell.id, offsets);
  }
  return out;
}

/** Keep waypointWindows array in sync with waypoints length, preserving existing values. */
function syncWindows(windows: (TimeWindow | null)[], newLength: number): (TimeWindow | null)[] {
  if (windows.length === newLength) return windows;
  const out = windows.slice(0, newLength);
  while (out.length < newLength) out.push(null);
  return out;
}

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

    /**
     * Rebuild the derived world (grid → terrain → risk) from the current
     * seed/extent/hexSize and commit it. Pure state update — it does NOT replan,
     * so callers choose the cadence: {@link BlockbusterState.regenerate} replans
     * immediately, while a live hex-size drag rebuilds on every step and
     * debounces the (worker) replan so planning runs once the drag settles.
     */
    const rebuildWorld = (seed?: number) => {
      const s = get();
      const useSeed = seed ?? s.seed;
      const grid = engine.gridBuilder.build(s.extent, {
        orientation: 'pointy',
        size: s.hexSize,
      });
      // The terrain field depends only on seed + extent, never on hex size, so
      // reuse the existing one when neither changed. This keeps TerrainLayer's
      // cached base-map raster valid: a hex-size change must not trigger a full,
      // main-thread re-rasterise (~96k samples + PNG encode) of an unchanged world.
      const field =
        s.field && s.field.seed === useSeed && s.field.extent === s.extent
          ? s.field
          : engine.mapGenerator.generate({ extent: s.extent, seed: useSeed });
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

      // Analyst-drawn zones are pinned to the basemap they were drawn on, so they
      // are dropped when the seed changes (a new world) but kept across a same-seed
      // rebuild such as a hex-size change (the basemap is unchanged; only the grid
      // moved). The world's temporal weather is a cyclone (a rotating wind field),
      // re-seeded on every rebuild so time matters from the first frame.
      const basemapChanged = useSeed !== s.seed;
      const zones = basemapChanged ? [] : s.zones;
      const cyclone = createDefaultCyclone(s.extent);

      set({
        seed: useSeed,
        grid,
        field,
        terrain,
        riskStates,
        waypoints,
        zones,
        cyclone,
        // Day/night is part of every generated world, paired with the cyclone,
        // so time matters from the first frame (in 2D and in the 3D temporal view).
        dayNight: { ...s.dayNight, enabled: true },
        // Coverage is re-derived against the new grid (kept zones, new hex layout).
        zoneContribution: computeZoneContribution(grid, zones),
        selectedZoneId: basemapChanged ? null : s.selectedZoneId,
        selectedCellId: null,
        selectedCoaId: null,
      });
    };

    return {
      seed: 1,
      extent: DEFAULT_EXTENT,
      hexSize: DEFAULT_HEX_SIZE_KM,

      grid: null,
      field: null,
      terrain: new Map(),
      riskStates: new Map(),
      zoneContribution: new Map(),

      costParams: DEFAULT_COST_PARAMS,
      waypoints: [],
      optimiseOrder: false,
      zones: [],
      zoneRiskType: RISK_TYPES[0],
      cyclone: null,
      journeyParams: DEFAULT_JOURNEY_PARAMS,
      dayNight: DEFAULT_DAY_NIGHT,
      waypointWindows: [],
      displayTime: DEFAULT_JOURNEY_PARAMS.startTime,

      plan: null,
      planning: false,
      planError: null,

      selectedCellId: null,
      selectedCoaId: null,
      hoveredCellId: null,
      selectedZoneId: null,
      drawMode: null,
      activeTab: 'waypoints',
      displayRisk: 'composite',
      // Start on the underlying terrain map; the hex grid is a switchable overlay.
      showTerrain: true,
      showHexGrid: false,
      showRiskPies: false,
      showRiskBars: false,
      showRiskStacks: false,
      showRoutes: false,
      showWind: true,
      temporalView: false,

      regenerate: (seed) => {
        rebuildWorld(seed);
        void get().replan();
      },

      setHexSize: (size) => {
        // Live resize: rebuild the grid on every step so the hexes track the
        // slider in real time — the base-map raster is reused, so this is cheap.
        // The now-stale COAs are dropped (they'd be drawn against a grid they no
        // longer fit), and only the worker replan is debounced, so planning runs
        // once the drag settles and the recomputed COAs reappear when ready.
        set({ hexSize: size, plan: null, selectedCoaId: null });
        rebuildWorld();
        scheduleReplan();
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
        const waypoints = exists
          ? s.waypoints.filter((id) => id !== cellId)
          : [...s.waypoints, cellId];
        const waypointWindows = syncWindows(s.waypointWindows, waypoints.length);
        set({ waypoints, waypointWindows });
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
        // Mirror the same splice on windows so they stay aligned.
        const waypointWindows = s.waypointWindows.slice();
        const [movedWindow] = waypointWindows.splice(from, 1);
        waypointWindows.splice(to, 0, movedWindow ?? null);
        set({ waypoints, waypointWindows });
        if (waypoints.length >= 2) void get().replan();
      },

      relocateWaypoint: (index, cellId) => {
        const s = get();
        if (index < 0 || index >= s.waypoints.length) return;
        if (s.waypoints[index] === cellId) return;
        if (!s.grid?.get(cellId) || s.waypoints.includes(cellId)) return;
        const waypoints = s.waypoints.slice();
        waypoints[index] = cellId;
        set({ waypoints });
        if (waypoints.length >= 2) void get().replan();
      },

      clearWaypoints: () => {
        set({ waypoints: [], waypointWindows: [], plan: null, selectedCoaId: null });
      },

      setOptimiseOrder: (optimise) => {
        set({ optimiseOrder: optimise });
        if (get().waypoints.length >= 2) void get().replan();
      },

      replan: async () => {
        const s = get();
        if (!s.grid || s.waypoints.length < 2) {
          set({ plan: null });
          return;
        }
        set({ planning: true, planError: null });
        // Capture the grid we plan against; regenerate() swaps in a new grid on a
        // hex-size or seed change, so an in-flight result against the old one is stale.
        const requestGrid = s.grid;
        const risk: Record<CellId, RiskProfile> = {};
        for (const [id, state] of s.riskStates)
          risk[id] = applyZoneOffsets(effectiveProfile(state), s.zoneContribution.get(id));
        // Town cells, so the worker can apply the town-only deep-sleep human dip.
        const towns: CellId[] = [];
        for (const [id, sample] of s.terrain) if (sample.biome === 'town') towns.push(id);
        // Zones with time bounds or motion are sent raw to the worker for per-step evaluation.
        const timeVaryingZones = s.zones.filter(
          (z) => z.startTime !== undefined || z.endTime !== undefined || z.motion !== undefined,
        );
        const waypointWindows = syncWindows(s.waypointWindows, s.waypoints.length);
        const request: RouteRequest = {
          grid: toHexGridDto(s.grid),
          risk,
          towns,
          params: s.costParams,
          waypoints: s.waypoints,
          coaCount: 3,
          optimiseOrder: s.optimiseOrder,
          journeyParams: s.journeyParams,
          dayNight: s.dayNight,
          timeVaryingZones,
          waypointWindows,
          // The cyclone (rotating wind field) is evaluated per step in the worker.
          ...(s.cyclone ? { cyclone: s.cyclone } : {}),
        };
        try {
          const plan = await engine.routePlanner.plan(request);
          // Ignore stale results: the world was rebuilt (hex-size / seed change
          // swapped in a new grid) or the waypoints no longer match the live state.
          if (get().grid !== requestGrid) return;
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
      setShowRiskPies: (show) =>
        set(
          show
            ? { showRiskPies: true, showRiskBars: false, showRiskStacks: false }
            : { showRiskPies: false },
        ),
      setShowRiskBars: (show) =>
        set(
          show
            ? { showRiskPies: false, showRiskBars: true, showRiskStacks: false }
            : { showRiskBars: false },
        ),
      setShowRiskStacks: (show) =>
        set(
          show
            ? { showRiskPies: false, showRiskBars: false, showRiskStacks: true }
            : { showRiskStacks: false },
        ),
      setShowRoutes: (show) => set({ showRoutes: show }),
      setShowWind: (show) => set({ showWind: show }),
      setTemporalView: (open) => set({ temporalView: open }),

      setJourneyParams: (patch) => {
        set({ journeyParams: { ...get().journeyParams, ...patch } });
        scheduleReplan();
      },

      setDayNight: (config) => {
        set({ dayNight: config });
        scheduleReplan();
      },

      setWaypointWindow: (index, window) => {
        const s = get();
        const waypointWindows = syncWindows(s.waypointWindows, s.waypoints.length).slice();
        waypointWindows[index] = window;
        set({ waypointWindows });
        scheduleReplan();
      },

      setDisplayTime: (minutes) => {
        set({ displayTime: minutes });
        // No replan — display time is for visualization only.
      },

      addZone: (zone) => {
        const s = get();
        const zones = [...s.zones, zone];
        set({
          zones,
          selectedZoneId: zone.id,
          zoneContribution: computeZoneContribution(s.grid, zones),
        });
        scheduleReplan();
      },

      updateZone: (id, patch) => {
        const s = get();
        const zones = s.zones.map((z) => {
          if (z.id !== id) return z;
          const updated = { ...z };
          if (patch.name !== undefined) updated.name = patch.name;
          if (patch.risk !== undefined) updated.risk = patch.risk;
          if (patch.offset !== undefined) updated.offset = clampZoneOffset(patch.offset);
          // null means "remove the field"; a number sets it.
          if (patch.startTime === null) {
            delete updated.startTime;
          } else if (patch.startTime !== undefined) {
            updated.startTime = patch.startTime;
          }
          if (patch.endTime === null) {
            delete updated.endTime;
          } else if (patch.endTime !== undefined) {
            updated.endTime = patch.endTime;
          }
          return updated;
        });
        const affectsScore =
          patch.risk !== undefined ||
          patch.offset !== undefined ||
          patch.startTime !== undefined ||
          patch.endTime !== undefined;
        set(
          affectsScore
            ? { zones, zoneContribution: computeZoneContribution(s.grid, zones) }
            : { zones },
        );
        if (affectsScore) scheduleReplan();
      },

      removeZone: (id) => {
        const s = get();
        const zones = s.zones.filter((z) => z.id !== id);
        set({
          zones,
          selectedZoneId: s.selectedZoneId === id ? null : s.selectedZoneId,
          zoneContribution: computeZoneContribution(s.grid, zones),
        });
        scheduleReplan();
      },

      selectZone: (id) => set({ selectedZoneId: get().selectedZoneId === id ? null : id }),
      toggleZoneEnabled: (id) => {
        const s = get();
        const zones = s.zones.map((z) => (z.id === id ? { ...z, enabled: !z.enabled } : z));
        set({ zones, zoneContribution: computeZoneContribution(s.grid, zones) });
        scheduleReplan();
      },
      setDrawMode: (mode) => set({ drawMode: mode }),
      setZoneRiskType: (risk) => set({ zoneRiskType: risk }),

      toggleCyclone: () => {
        const s = get();
        if (!s.cyclone) return;
        set({ cyclone: { ...s.cyclone, enabled: !s.cyclone.enabled } });
        scheduleReplan();
      },
    };
  });
}

/**
 * The app-wide store, wired to the real engine. All four modules (map
 * generation, hex grid, risk model, routing) now ship under `src/engine/*`; the
 * mock remains only as the living reference and test fixture. Routing runs in a
 * Web Worker (the default of `createRoutePlanner`), so the search never blocks
 * the UI.
 */
export const useBlockbusterStore = createBlockbusterStore(createEngine());

// --- Selectors (pure, reusable derivations) -------------------------------

/**
 * Effective risk profile for a cell — base, overrides, then extra-risk zones —
 * or null if unknown. This is the profile the planner actually costs.
 */
export function selectEffectiveProfile(
  state: BlockbusterState,
  cellId: CellId | null,
): RiskProfile | null {
  if (!cellId) return null;
  const risk = state.riskStates.get(cellId);
  if (!risk) return null;
  return applyZoneOffsets(effectiveProfile(risk), state.zoneContribution.get(cellId));
}

/**
 * Composite traversal cost of a cell under the current appetite (including zone
 * offsets) — used to shade the map when `displayRisk === 'composite'`.
 */
export function selectCellCost(state: BlockbusterState, cellId: CellId): number {
  const risk = state.riskStates.get(cellId);
  if (!risk) return 0;
  const eff = applyZoneOffsets(effectiveProfile(risk), state.zoneContribution.get(cellId));
  return cellRiskCost(eff, state.costParams);
}

/**
 * Time-aware effective risk profile for a cell at `state.displayTime`.
 * Applies: always-active zone offsets → active time-varying zone offsets
 * (using area-weighted coverage fraction via `ringAt`) → day/night modifiers
 * → speed modifiers. Used by overlay layers and the inspector.
 */
export function selectDisplayProfile(
  state: Pick<
    BlockbusterState,
    | 'riskStates'
    | 'zoneContribution'
    | 'zones'
    | 'displayTime'
    | 'dayNight'
    | 'journeyParams'
    | 'extent'
    | 'hexSize'
    | 'terrain'
  >,
  cellId: CellId,
  cellVertices: readonly WorldPoint[],
): RiskProfile | null {
  const riskState = state.riskStates.get(cellId);
  if (!riskState) return null;
  let profile = applyZoneOffsets(effectiveProfile(riskState), state.zoneContribution.get(cellId));
  const timeVaryingActive = state.zones.filter(
    (z) =>
      (z.startTime !== undefined || z.endTime !== undefined || z.motion !== undefined) &&
      z.enabled &&
      isZoneActiveAt(z, state.displayTime),
  );
  if (timeVaryingActive.length > 0) {
    const offsets: Partial<Record<RiskType, number>> = {};
    for (const zone of timeVaryingActive) {
      const ring = ringAt(zone, state.displayTime, state.extent, state.hexSize);
      const coverage = coverageFraction(cellVertices, ring);
      if (coverage > 0) offsets[zone.risk] = (offsets[zone.risk] ?? 0) + coverage * zone.offset;
    }
    profile = applyZoneOffsets(profile, offsets);
  }
  const isTown = state.terrain.get(cellId)?.biome === 'town';
  profile = applyTemporalModifiers(profile, state.displayTime, state.dayNight, isTown);
  profile = speedModifiedProfile(profile, state.journeyParams.fixedSpeedKmh);
  return profile;
}
