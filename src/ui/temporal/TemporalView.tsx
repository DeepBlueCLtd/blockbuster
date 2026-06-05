/**
 * 3D temporal view — a windowed temporal stack with a vertical time-wheel.
 *
 * Opened full-viewport from the app (via the `temporalView` store flag) and read
 * purely from the live store, so it always reflects the current data source; it
 * never mutates state. `onClose` restores the default app.
 *
 * The data is sliced at a chosen interval (5 min … 3 h); a fixed **window of 20
 * layers** centred on the current slice is shown, and the wheel scrolls the
 * current time. Stack and Grid are two renderings of that same window; the wheel
 * scrolls whichever is active. Only the window (+a small buffer) is built and
 * cached — nothing computes all of the day's slices.
 *
 * Faithful, not faked: the permanent **base** is the non-temporal terrain risk
 * (the live map's selectCellCost basis), pinned beneath the stack. Each slice is
 * coloured by the real `selectDisplayProfile` pipeline; by default it shows the
 * **temporal Δ** (storm + day/night only) on a transparent background so the
 * base shows through.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import type { PointerEvent as ReactPointerEvent, RefObject } from 'react';
import * as THREE from 'three';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { MapContainer, useMap } from 'react-leaflet';
import { CRS, imageOverlay } from 'leaflet';
import type { LatLngBoundsExpression } from 'leaflet';
import type { TerrainRasterRequest } from './terrainRaster.worker';
import {
  applyZoneOffsets,
  cellRiskCost,
  clamp01,
  effectiveProfile,
  RISK_LABELS,
  RISK_TYPES,
  speedModifiedProfile,
} from '@domain';
import type {
  CostParams,
  HexCell,
  HexGrid,
  RiskProfile,
  RiskType,
  RoutePlan,
  WorldExtent,
  WorldPoint,
} from '@domain';
import { selectDisplayProfile, useBlockbusterStore } from '@/state/store';
import { formatTime } from '@/ui/utils/time';
import { coaColor } from '@/ui/theme';
import './temporal.css';

// Vertex colours reach the GPU exactly as authored, matching the 2D map.
THREE.ColorManagement.enabled = false;

const DAY_MIN = 1440;
const WINDOW = 20; // layers shown at once (= the 5×4 grid)
const BUFFER = 4; // extra slices kept cached either side of the window
const INTERVAL_OPTIONS = [5, 15, 30, 60, 180] as const;

const BASE_OVERHANG = 1.08;
const STACK_START = 2; // window's bottom layer sits this many `spacing` units above the base
const STACK_CAM: readonly [number, number, number] = [62, 48, 80];

const GRID_COLS = 5; // odd, so the current sits in a true central column
const GRID_ROWS = 4;
const GRID_GAP = 6; // km between tiles
const GRID_TILT = 0.25; // z-offset as a fraction of height — a gentle bird's-eye, off the gimbal
const FIXED_CELL = GRID_COLS + 2; // current pins to the central column (col 2), row 1
const PAN_X_GRID = 40; // shift the grid right (km) so its left column clears the control panel
const MAP_W = 900; // px width of the Leaflet map quad that lies on the base plane

const DELTA_FRAC = 0.4; // composite temporal Δ reaches full colour at this fraction of the base max

type Layout = 'stack' | 'grid';
type ShadeBy = 'composite' | RiskType;
type HourlyMode = 'temporal' | 'total';
type GridScroll = 'fixed' | 'inplace';

/** The slice of store state `selectDisplayProfile` needs, minus the time. */
type ProfileInputs = Omit<Parameters<typeof selectDisplayProfile>[0], 'displayTime'>;

interface WindowLayer {
  index: number;
  geometry: THREE.BufferGeometry;
}

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const clampN = (x: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, x));
const smoothstep = (t: number) => {
  const x = clampN(t, 0, 1);
  return x * x * (3 - 2 * x);
};

// Orthographic zoom matching a 45° fov perspective camera at the framing distance.
const FOV = 45;
const orthoZoom = (distance: number): number => {
  const h = typeof window !== 'undefined' && window.innerHeight > 0 ? window.innerHeight : 900;
  return h / (2 * distance * Math.tan(((FOV * Math.PI) / 180) / 2));
};

const gridCellW = (e: WorldExtent) => e.width + GRID_GAP;
const gridCellH = (e: WorldExtent) => e.height + GRID_GAP;
/** Z of the permanent map, centred just north of the hourly grid. */
const baseRowZ = (e: WorldExtent) => -(GRID_ROWS / 2 + 0.5) * gridCellH(e);

/** Flat 6×4 slot (X, Z) for grid `cell`, centred on the origin. */
function gridTileXZ(cell: number, e: WorldExtent): readonly [number, number] {
  const col = cell % GRID_COLS;
  const row = Math.floor(cell / GRID_COLS);
  return [(col - (GRID_COLS - 1) / 2) * gridCellW(e), (row - (GRID_ROWS - 1) / 2) * gridCellH(e)];
}

/** Top-down camera height + target-Z that frames the grid plus the map above it. */
function gridFraming(e: WorldExtent): { height: number; targetZ: number } {
  const gridW = GRID_COLS * gridCellW(e);
  const zNorth = baseRowZ(e) - e.height / 2;
  const zSouth = ((GRID_ROWS - 1) / 2) * gridCellH(e) + e.height / 2;
  const targetZ = (zNorth + zSouth) / 2;
  const depth = zSouth - zNorth;
  const vfov = (FOV * Math.PI) / 180;
  const aspect =
    typeof window !== 'undefined' && window.innerHeight > 0
      ? window.innerWidth / window.innerHeight
      : 1.6;
  const hfov = 2 * Math.atan(Math.tan(vfov / 2) * aspect);
  const height = Math.max(gridW / 2 / Math.tan(hfov / 2), depth / 2 / Math.tan(vfov / 2)) * 1.1;
  return { height, targetZ };
}

/** Mirror ui/theme.heatColor (green 120° → red 0°) straight to a GPU colour. */
function heatThreeColor(t: number): THREE.Color {
  const hue = (1 - clamp01(t)) * 120;
  return new THREE.Color().setHSL(hue / 360, 0.72, 0.48);
}

// Temporal Δ: colour carries the sign, magnitude rides on per-cell alpha so a
// "no change" cell is transparent and the backdrop shows through.
const TEMPORAL_POS = new THREE.Color(0.85, 0.1, 0.1);
const TEMPORAL_NEG = new THREE.Color(0.1, 0.4, 0.85);
const temporalColor = (t: number): THREE.Color => (t >= 0 ? TEMPORAL_POS : TEMPORAL_NEG);
const temporalAlpha = (t: number): number => Math.min(1, Math.abs(t) ** 0.75);

function worldToXZ(p: WorldPoint, ext: WorldExtent): readonly [number, number] {
  return [p.x - ext.width / 2, -(p.y - ext.height / 2)];
}
function insetPoint(c: WorldPoint, v: WorldPoint, k: number): WorldPoint {
  return { x: c.x + (v.x - c.x) * k, y: c.y + (v.y - c.y) * k };
}

/** Permanent, non-temporal terrain risk (live map's selectCellCost basis). */
function permanentProfile(inputs: ProfileInputs, cell: HexCell): RiskProfile | null {
  const rs = inputs.riskStates.get(cell.id);
  if (!rs) return null;
  return applyZoneOffsets(effectiveProfile(rs), inputs.zoneContribution.get(cell.id));
}
/** Baseline for the Δ: permanent risk + journey speed, no day/night, no storm. */
function noTemporalProfile(inputs: ProfileInputs, cell: HexCell): RiskProfile | null {
  const base = permanentProfile(inputs, cell);
  if (!base) return null;
  return speedModifiedProfile(base, inputs.journeyParams.fixedSpeedKmh);
}

/** One flat, vertex-coloured (RGBA) grid in the X-Z plane. */
function makeGridGeometry(
  cells: readonly HexCell[],
  ext: WorldExtent,
  inset: number,
  colorAt: (ci: number) => THREE.Color,
  alphaAt: (ci: number) => number = () => 1,
): THREE.BufferGeometry {
  const positions: number[] = [];
  const colors: number[] = [];
  for (let ci = 0; ci < cells.length; ci++) {
    const cell = cells[ci];
    if (!cell) continue;
    const col = colorAt(ci);
    const a = alphaAt(ci);
    const c = cell.center;
    const [cx, cz] = worldToXZ(c, ext);
    const verts = cell.vertices;
    const m = verts.length;
    for (let i = 0; i < m; i++) {
      const v1 = verts[i];
      const v2 = verts[(i + 1) % m];
      if (!v1 || !v2) continue;
      const [x1, z1] = worldToXZ(insetPoint(c, v1, inset), ext);
      const [x2, z2] = worldToXZ(insetPoint(c, v2, inset), ext);
      positions.push(cx, 0, cz, x1, 0, z1, x2, 0, z2);
      colors.push(col.r, col.g, col.b, a, col.r, col.g, col.b, a, col.r, col.g, col.b, a);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 4));
  return geo;
}

interface BaseInfo {
  geometry: THREE.BufferGeometry;
  baseNorm: number;
  deltaRef: number;
  metric: (p: RiskProfile) => number;
}

/** Permanent base geometry + the colour-scale references (lazy-friendly, no per-slice scan). */
function buildBase(
  cells: readonly HexCell[],
  inputs: ProfileInputs,
  shadeBy: ShadeBy,
  costParams: CostParams,
): BaseInfo {
  const n = cells.length;
  const isComposite = shadeBy === 'composite';
  const metric = (p: RiskProfile) => (isComposite ? cellRiskCost(p, costParams) : p[shadeBy]);
  const vals = new Float32Array(n);
  let baseMax = 0;
  for (let ci = 0; ci < n; ci++) {
    const cell = cells[ci];
    if (!cell) continue;
    const p = permanentProfile(inputs, cell);
    if (!p) continue;
    const v = metric(p);
    vals[ci] = v;
    if (v > baseMax) baseMax = v;
  }
  const baseNorm = isComposite ? baseMax || 1 : 1;
  const deltaRef = isComposite ? (baseMax || 1) * DELTA_FRAC : 0.5;
  const geometry = makeGridGeometry(cells, inputs.extent, 1, (ci) => heatThreeColor((vals[ci] ?? 0) / baseNorm));
  return { geometry, baseNorm, deltaRef, metric };
}

/** One slice's geometry at `sliceMin` (temporal Δ or total risk). */
function buildSlice(
  cells: readonly HexCell[],
  inputs: ProfileInputs,
  sliceMin: number,
  hourlyMode: HourlyMode,
  inset: number,
  info: BaseInfo,
): THREE.BufferGeometry {
  const n = cells.length;
  const vals = new Float32Array(n);
  const st = { ...inputs, displayTime: sliceMin };
  for (let ci = 0; ci < n; ci++) {
    const cell = cells[ci];
    if (!cell) continue;
    const full = selectDisplayProfile(st, cell.id, cell.vertices);
    if (!full) continue;
    if (hourlyMode === 'temporal') {
      const baseline = noTemporalProfile(inputs, cell);
      vals[ci] = baseline ? info.metric(full) - info.metric(baseline) : 0;
    } else {
      vals[ci] = info.metric(full);
    }
  }
  if (hourlyMode === 'temporal') {
    return makeGridGeometry(
      cells,
      inputs.extent,
      inset,
      (ci) => temporalColor((vals[ci] ?? 0) / info.deltaRef),
      (ci) => temporalAlpha((vals[ci] ?? 0) / info.deltaRef),
    );
  }
  return makeGridGeometry(cells, inputs.extent, inset, (ci) => heatThreeColor((vals[ci] ?? 0) / info.baseNorm));
}

/** Time-label textures, cached by the time string (limited set, no churn). */
const labelCache = new Map<string, THREE.CanvasTexture>();
function getLabel(text: string): THREE.CanvasTexture {
  let tex = labelCache.get(text);
  if (tex) return tex;
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 64;
  const ctx = canvas.getContext('2d');
  if (ctx) {
    ctx.font = 'bold 40px system-ui, sans-serif';
    ctx.fillStyle = '#e6edf3';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, 128, 34);
  }
  tex = new THREE.CanvasTexture(canvas);
  tex.anisotropy = 4;
  labelCache.set(text, tex);
  return tex;
}

/** A bold rectangular ring (band of width `t`) around the tile footprint. */
function frameBandGeometry(ext: WorldExtent, t: number): THREE.BufferGeometry {
  const w = ext.width / 2;
  const h = ext.height / 2;
  const W = w + t;
  const H = h + t;
  const y = 0.25;
  const pos: number[] = [];
  const quad = (
    ax: number,
    az: number,
    bx: number,
    bz: number,
    cx: number,
    cz: number,
    dx: number,
    dz: number,
  ) => {
    pos.push(ax, y, az, bx, y, bz, cx, y, cz, ax, y, az, cx, y, cz, dx, y, dz);
  };
  quad(-W, -H, W, -H, W, -h, -W, -h); // south
  quad(-W, h, W, h, W, H, -W, H); // north
  quad(-W, -h, -w, -h, -w, h, -W, h); // west
  quad(w, -h, W, -h, W, h, w, h); // east
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  return g;
}

/** three's OrbitControls, wrapped for R3F. Eases the camera across the morph. */
function Orbit({
  layout,
  transitioning,
  morph,
  gridCamHeight,
  gridTargetZ,
  stackTargetY,
  autoRotate,
}: {
  layout: Layout;
  transitioning: boolean;
  morph: number;
  gridCamHeight: number;
  gridTargetZ: number;
  stackTargetY: number;
  autoRotate: boolean;
}) {
  const camera = useThree((s) => s.camera);
  const gl = useThree((s) => s.gl);
  const ref = useRef<OrbitControls | null>(null);
  const fromPos = useRef(new THREE.Vector3());
  const fromTarget = useRef(new THREE.Vector3());
  const fromZoom = useRef(1);
  const startMorph = useRef(0);
  const animating = useRef(false);

  useEffect(() => {
    const controls = new OrbitControls(camera, gl.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.08;
    controls.autoRotateSpeed = 0.8;
    ref.current = controls;
    return () => controls.dispose();
  }, [camera, gl]);

  useEffect(() => {
    const controls = ref.current;
    if (!controls || transitioning) return;
    controls.enableRotate = layout === 'stack'; // grid is top-down; the stack rotates in 3D
    if (layout === 'grid') {
      camera.position.set(-PAN_X_GRID, gridCamHeight, gridTargetZ + gridCamHeight * GRID_TILT);
      controls.target.set(-PAN_X_GRID, 0, gridTargetZ);
    } else {
      controls.target.set(0, stackTargetY, 0);
    }
    controls.update();
  }, [layout, transitioning, gridCamHeight, gridTargetZ, stackTargetY, camera]);

  useFrame(() => {
    const controls = ref.current;
    if (!controls) return;
    if (transitioning) {
      if (!animating.current) {
        fromPos.current.copy(camera.position);
        fromTarget.current.copy(controls.target);
        fromZoom.current = (camera as THREE.OrthographicCamera).zoom;
        startMorph.current = morph;
        animating.current = true;
      }
      const targetMorph = layout === 'stack' ? 1 : 0;
      const denom = targetMorph - startMorph.current;
      const p = smoothstep(denom !== 0 ? (morph - startMorph.current) / denom : 1);
      const toPos =
        layout === 'stack'
          ? new THREE.Vector3(STACK_CAM[0], STACK_CAM[1], STACK_CAM[2])
          : new THREE.Vector3(-PAN_X_GRID, gridCamHeight, gridTargetZ + gridCamHeight * GRID_TILT);
      const toTarget =
        layout === 'stack'
          ? new THREE.Vector3(0, stackTargetY, 0)
          : new THREE.Vector3(-PAN_X_GRID, 0, gridTargetZ);
      camera.position.lerpVectors(fromPos.current, toPos, p);
      controls.target.lerpVectors(fromTarget.current, toTarget, p);
      const cam = camera as THREE.OrthographicCamera;
      cam.zoom = lerp(fromZoom.current, orthoZoom(toPos.distanceTo(toTarget)), p);
      cam.updateProjectionMatrix();
      controls.enabled = false;
      controls.autoRotate = false;
    } else {
      animating.current = false;
      controls.enabled = true;
      controls.autoRotate = layout === 'stack' && autoRotate;
    }
    controls.update();
  });

  return null;
}

function GroundPlane({ extent, opacity }: { extent: WorldExtent; opacity: number }) {
  return (
    <group position={[0, -1.5, 0]}>
      <mesh rotation={[-Math.PI / 2, 0, 0]}>
        <planeGeometry args={[extent.width, extent.height]} />
        <meshBasicMaterial color="#11161f" transparent opacity={opacity} side={THREE.DoubleSide} />
      </mesh>
      <gridHelper args={[Math.max(extent.width, extent.height), 12, '#2a3344', '#1b2230']} />
    </group>
  );
}

/** Adds the worker-rendered terrain image as a Leaflet overlay (no main-thread
 *  rasterisation); (re)adds it whenever the URL arrives or changes. */
function BaseTerrainOverlay({ url, extent }: { url: string | null; extent: WorldExtent }) {
  const map = useMap();
  useEffect(() => {
    if (!url) return;
    const bounds: LatLngBoundsExpression = [
      [0, 0],
      [extent.height, extent.width],
    ];
    const overlay = imageOverlay(url, bounds, { interactive: false });
    overlay.addTo(map);
    return () => {
      overlay.remove();
    };
  }, [map, url, extent]);
  return null;
}

/**
 * The live app Leaflet map, reused as the "permanent base" so the 2D base and
 * the 3D stack stay consistent. Its terrain image is generated off the main
 * thread (see terrainRaster.worker) so revealing it never blocks the UI.
 * View-only — interactions are off and it sits behind a transparent canvas.
 */
function BaseLeafletMap({ extent, terrainUrl }: { extent: WorldExtent; terrainUrl: string | null }) {
  const bounds: LatLngBoundsExpression = [
    [0, 0],
    [extent.height, extent.width],
  ];
  return (
    <MapContainer
      crs={CRS.Simple}
      bounds={bounds}
      className="temporal-leaflet"
      attributionControl={false}
      zoomControl={false}
      dragging={false}
      scrollWheelZoom={false}
      doubleClickZoom={false}
      keyboard={false}
    >
      <BaseTerrainOverlay url={terrainUrl} extent={extent} />
    </MapContainer>
  );
}

/**
 * Lays the Leaflet quad (a DOM element behind the transparent canvas) onto the
 * base ground-plane footprint, tracking the camera each frame. The camera is
 * orthographic, so the plane projects to a parallelogram — a 2D affine
 * `matrix(...)` reproduces it exactly (no perspective division needed).
 */
function MapPlaneTransform({
  extent,
  morph,
  quadH,
  quadRef,
}: {
  extent: WorldExtent;
  morph: number;
  quadH: number;
  quadRef: RefObject<HTMLDivElement | null>;
}) {
  const camera = useThree((s) => s.camera);
  const size = useThree((s) => s.size);
  const morphRef = useRef(morph);
  morphRef.current = morph;
  const tmp = useRef(new THREE.Vector3());

  useFrame(() => {
    const el = quadRef.current;
    if (!el) return;
    const m = smoothstep(morphRef.current);
    const s = lerp(1, BASE_OVERHANG, m);
    const bz = lerp(baseRowZ(extent), 0, m);
    const halfW = (extent.width / 2) * s;
    const halfH = (extent.height / 2) * s;
    const toScreen = (X: number, Z: number): readonly [number, number] => {
      const v = tmp.current.set(X, 0, Z).project(camera);
      return [(v.x * 0.5 + 0.5) * size.width, (-v.y * 0.5 + 0.5) * size.height];
    };
    const [ax, ay] = toScreen(-halfW, bz - halfH); // NW → quad top-left
    const [bx, by] = toScreen(halfW, bz - halfH); // NE → quad top-right
    const [cx, cy] = toScreen(-halfW, bz + halfH); // SW → quad bottom-left
    el.style.transform =
      `matrix(${(bx - ax) / MAP_W},${(by - ay) / MAP_W},` +
      `${(cx - ax) / quadH},${(cy - ay) / quadH},${ax},${ay})`;
    if (el.style.opacity !== '1') el.style.opacity = '1';
  });
  return null;
}

type Pt2 = readonly [number, number];

interface RoutePoly {
  color: THREE.Color;
  pts: Pt2[];
  times: number[];
  faintGeo: THREE.BufferGeometry | null;
}

/** A flat ribbon (triangle list) following `pts` in the X-Z plane at height `y`. */
function ribbonGeometry(pts: readonly Pt2[], halfWidth: number, y: number): THREE.BufferGeometry | null {
  const n = pts.length;
  if (n < 2) return null;
  const left: Pt2[] = new Array(n);
  const right: Pt2[] = new Array(n);
  for (let i = 0; i < n; i++) {
    const p = pts[i];
    const prev = pts[i - 1] ?? p;
    const next = pts[i + 1] ?? p;
    if (!p || !prev || !next) continue;
    let dx = next[0] - prev[0];
    let dz = next[1] - prev[1];
    const len = Math.hypot(dx, dz) || 1;
    dx /= len;
    dz /= len;
    const nx = -dz * halfWidth;
    const nz = dx * halfWidth;
    left[i] = [p[0] + nx, p[1] + nz];
    right[i] = [p[0] - nx, p[1] - nz];
  }
  const pos: number[] = [];
  for (let i = 0; i < n - 1; i++) {
    const l0 = left[i];
    const r0 = right[i];
    const l1 = left[i + 1];
    const r1 = right[i + 1];
    if (!l0 || !r0 || !l1 || !r1) continue;
    pos.push(l0[0], y, l0[1], r0[0], y, r0[1], r1[0], y, r1[1]);
    pos.push(l0[0], y, l0[1], r1[0], y, r1[1], l1[0], y, l1[1]);
  }
  if (pos.length === 0) return null;
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  return g;
}

/** Sub-path of `pts` whose segments are traversed within ±`win` minutes of `t`. */
function activeSubPath(pts: readonly Pt2[], times: readonly number[], t: number, win: number): Pt2[] {
  let lo = Infinity;
  let hi = -Infinity;
  for (let j = 0; j < pts.length - 1; j++) {
    const a = times[j];
    const b = times[j + 1];
    if (a === undefined || b === undefined) continue;
    if (a < t + win && b > t - win) {
      if (j < lo) lo = j;
      if (j + 1 > hi) hi = j + 1;
    }
  }
  if (lo === Infinity || hi <= lo) return [];
  return pts.slice(lo, hi + 1);
}

/** Project each COA onto base X-Z, keeping per-point arrival times for the highlight. */
function buildRoutePolys(plan: RoutePlan, grid: HexGrid, extent: WorldExtent): RoutePoly[] {
  return plan.coas.map((coa, idx) => {
    const pts: Pt2[] = [];
    const times: number[] = [];
    for (let i = 0; i < coa.path.length; i++) {
      const id = coa.path[i];
      const step = coa.steps[i];
      const cell = id != null ? grid.get(id) : undefined;
      if (!cell || !step) continue;
      const [x, z] = worldToXZ(cell.center, extent);
      pts.push([x, z]);
      times.push(step.arrivalTimeMinutes);
    }
    return {
      color: new THREE.Color(coaColor(idx)),
      pts,
      times,
      faintGeo: ribbonGeometry(pts, 0.7, 0.34),
    };
  });
}

/** The whole scene, morphed between grid (0) and stack (1), windowed on the current slice. */
function Scene({
  base,
  baseLabel,
  layers,
  extent,
  spacing,
  opacity,
  temporal,
  showPermanent,
  showGround,
  singleMap,
  morph,
  scrollCenter,
  half,
  currentSlice,
  windowStart,
  intervalMin,
  frameGeo,
  showRoutes3d,
  routePolys,
  activeRibbons,
}: {
  base: THREE.BufferGeometry;
  baseLabel: THREE.Texture;
  layers: WindowLayer[];
  extent: WorldExtent;
  spacing: number;
  opacity: number;
  temporal: boolean;
  showPermanent: boolean;
  showGround: boolean;
  singleMap: boolean;
  morph: number;
  scrollCenter: number;
  half: number;
  currentSlice: number;
  windowStart: number;
  intervalMin: number;
  frameGeo: THREE.BufferGeometry;
  showRoutes3d: boolean;
  routePolys: RoutePoly[];
  activeRibbons: Map<number, { color: THREE.Color; geo: THREE.BufferGeometry }[]>;
}) {
  const m = smoothstep(morph);
  const baseZ = lerp(baseRowZ(extent), 0, m);
  const baseScale = lerp(1, BASE_OVERHANG, m);
  return (
    <group>
      {showGround && showPermanent && m > 0.15 && <GroundPlane extent={extent} opacity={0.85 * m} />}

      {showPermanent && (
        <group position={[0, 0, baseZ]} scale={[baseScale, 1, baseScale]}>
          <mesh geometry={base}>
            <meshBasicMaterial vertexColors side={THREE.DoubleSide} />
          </mesh>
          <sprite position={[0, 2, -extent.height / 2 - 6]} scale={[26, 5, 1]}>
            <spriteMaterial map={baseLabel} transparent opacity={1 - m} depthTest={false} />
          </sprite>
        </group>
      )}

      {layers.map(({ index, geometry }) => {
        const isCurrent = index === currentSlice;
        const cell = index - windowStart;
        const gridValid = cell >= 0 && cell < GRID_COLS * GRID_ROWS;
        const [gx, gz] = gridValid ? gridTileXZ(cell, extent) : [0, 0];
        const stackY = (STACK_START + (index - scrollCenter + half)) * spacing;
        const px = lerp(gx, 0, m);
        const py = lerp(0, stackY, m);
        const pz = lerp(gz, 0, m);
        const stackOp = isCurrent ? 1 : singleMap ? 0 : opacity;
        const gridOp = gridValid ? 1 : 0;
        const op = lerp(gridOp, stackOp, m);
        if (op <= 0.002 && !isCurrent) return null;
        return (
          <group key={index} position={[px, py, pz]}>
            <mesh geometry={geometry}>
              <meshBasicMaterial
                vertexColors
                transparent
                opacity={op}
                side={THREE.DoubleSide}
                depthWrite={!temporal && op >= 1}
              />
            </mesh>
            {isCurrent && (
              <mesh geometry={frameGeo}>
                <meshBasicMaterial
                  color="#cfe0f2"
                  transparent
                  opacity={0.95}
                  side={THREE.DoubleSide}
                  depthWrite={false}
                  depthTest={false}
                />
              </mesh>
            )}
            <sprite position={[0, 2, -extent.height / 2 - 2.2]} scale={[16, 4, 1]}>
              <spriteMaterial
                map={getLabel(formatTime(index * intervalMin))}
                transparent
                opacity={(1 - m) * (gridValid ? 1 : 0)}
                depthTest={false}
              />
            </sprite>
            {showRoutes3d &&
              routePolys.map((r, ci) =>
                r.faintGeo ? (
                  <mesh key={`rf${ci}`} geometry={r.faintGeo} renderOrder={2}>
                    <meshBasicMaterial
                      color={r.color}
                      transparent
                      opacity={0.3 * (isCurrent ? 1 : 0.55)}
                      side={THREE.DoubleSide}
                      depthWrite={false}
                      depthTest={false}
                    />
                  </mesh>
                ) : null,
              )}
            {showRoutes3d &&
              (activeRibbons.get(index) ?? []).map((a, ci) => (
                <mesh key={`ra${ci}`} geometry={a.geo} renderOrder={3}>
                  <meshBasicMaterial
                    color={a.color}
                    transparent
                    opacity={0.95}
                    side={THREE.DoubleSide}
                    depthWrite={false}
                    depthTest={false}
                  />
                </mesh>
              ))}
          </group>
        );
      })}
    </group>
  );
}

/** Vertical reel with interval selector: drag/flick or mouse-wheel to scroll time. */
function TimeWheel({
  currentMin,
  setCurrentMin,
  intervalMin,
  setIntervalMin,
}: {
  currentMin: number;
  setCurrentMin: (m: number) => void;
  intervalMin: number;
  setIntervalMin: (m: number) => void;
}) {
  const maxMin = DAY_MIN - intervalMin;
  const clampMin = (mn: number) => clampN(mn, 0, maxMin);
  const PX = 44; // pixels per slice
  const drag = useRef<{ y: number; min: number; lastY: number; lastT: number; v: number } | null>(
    null,
  );
  const inertiaRaf = useRef(0);
  const curRef = useRef(currentMin);
  curRef.current = currentMin;
  const cfgRef = useRef({ interval: intervalMin, max: maxMin });
  cfgRef.current = { interval: intervalMin, max: maxMin };
  const wheelRef = useRef<HTMLDivElement | null>(null);

  const stopInertia = () => {
    if (inertiaRaf.current) {
      cancelAnimationFrame(inertiaRaf.current);
      inertiaRaf.current = 0;
    }
  };
  useEffect(() => stopInertia, []);

  const onDown = (e: ReactPointerEvent) => {
    stopInertia();
    drag.current = { y: e.clientY, min: currentMin, lastY: e.clientY, lastT: performance.now(), v: 0 };
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  };
  const onMove = (e: ReactPointerEvent) => {
    if (!drag.current) return;
    const now = performance.now();
    setCurrentMin(clampMin(drag.current.min - ((e.clientY - drag.current.y) / PX) * intervalMin));
    const dt = Math.max(1, now - drag.current.lastT);
    drag.current.v = (-(e.clientY - drag.current.lastY) / PX) * (intervalMin / dt); // min per ms
    drag.current.lastY = e.clientY;
    drag.current.lastT = now;
  };
  const onUp = () => {
    const d = drag.current;
    drag.current = null;
    if (!d) return;
    // No momentum if the pointer was held still just before release.
    let v = performance.now() - d.lastT > 80 ? 0 : d.v;
    if (Math.abs(v) <= 0.01) {
      setCurrentMin(clampMin(Math.round(curRef.current / intervalMin) * intervalMin));
      return;
    }
    let last = performance.now();
    const step = () => {
      const now = performance.now();
      const dt = now - last;
      last = now;
      let next = curRef.current + v * dt;
      let stop = false;
      if (next <= 0) {
        next = 0;
        stop = true;
      } else if (next >= maxMin) {
        next = maxMin;
        stop = true;
      }
      curRef.current = next;
      setCurrentMin(next);
      v *= Math.pow(0.94, dt / 16); // friction
      if (!stop && Math.abs(v) > 0.005) {
        inertiaRaf.current = requestAnimationFrame(step);
      } else {
        setCurrentMin(clampMin(Math.round(next / intervalMin) * intervalMin));
        inertiaRaf.current = 0;
      }
    };
    inertiaRaf.current = requestAnimationFrame(step);
  };
  // Wheel over the controller scrubs time a slice at a time; Ctrl+wheel zooms the
  // time step instead, staying on the current time. Native + non-passive so it can
  // preventDefault — which also stops page zoom and the native <select> cycling
  // when the pointer is over the interval dropdown.
  useEffect(() => {
    const el = wheelRef.current;
    if (!el) return;
    const onWheelNative = (e: WheelEvent) => {
      e.preventDefault();
      if (inertiaRaf.current) {
        cancelAnimationFrame(inertiaRaf.current);
        inertiaRaf.current = 0;
      }
      const dir = Math.sign(e.deltaY);
      if (dir === 0) return;
      if (e.ctrlKey) {
        // Zoom the step: scroll up = finer, down = coarser. The interval effect
        // re-snaps the current time, and the window tightens around it.
        const i = INTERVAL_OPTIONS.findIndex((x) => x === cfgRef.current.interval);
        const ni = clampN((i < 0 ? 1 : i) + dir, 0, INTERVAL_OPTIONS.length - 1);
        const step = INTERVAL_OPTIONS[ni];
        if (step !== undefined && step !== cfgRef.current.interval) setIntervalMin(step);
        return;
      }
      const { interval, max } = cfgRef.current;
      const slice = Math.round(curRef.current / interval);
      const next = clampN((slice + dir) * interval, 0, max);
      curRef.current = next;
      setCurrentMin(next);
    };
    el.addEventListener('wheel', onWheelNative, { passive: false });
    return () => el.removeEventListener('wheel', onWheelNative);
  }, [setCurrentMin, setIntervalMin]);

  const cur = Math.round(currentMin / intervalMin);
  const ticks: { idx: number; y: number; label: string; current: boolean }[] = [];
  for (let d = -3; d <= 3; d++) {
    const idx = cur + d;
    const mn = idx * intervalMin;
    if (mn < 0 || mn > maxMin) continue;
    ticks.push({ idx, y: (idx - currentMin / intervalMin) * PX, label: formatTime(mn), current: d === 0 });
  }
  return (
    <div className="temporal-wheel" ref={wheelRef}>
      <div className="temporal-wheel-interval">
        <span>TIME · every</span>
        <select value={intervalMin} onChange={(e) => setIntervalMin(Number(e.target.value))}>
          {INTERVAL_OPTIONS.map((iv) => (
            <option key={iv} value={iv}>
              {iv < 60 ? `${iv} min` : `${iv / 60} h`}
            </option>
          ))}
        </select>
      </div>
      <div
        className="temporal-wheel-reel"
        onPointerDown={onDown}
        onPointerMove={onMove}
        onPointerUp={onUp}
        onPointerCancel={onUp}
      >
        <div className="temporal-wheel-band" />
        {ticks.map((t) => (
          <div
            key={t.idx}
            className={t.current ? 'temporal-wheel-tick now' : 'temporal-wheel-tick'}
            style={{ transform: `translateY(calc(-50% + ${t.y}px))`, opacity: Math.max(0, 1 - Math.abs(t.y) / 120) }}
          >
            {t.label}
          </div>
        ))}
      </div>
      <div className="temporal-wheel-hint">drag ↕ or scroll · ctrl-scroll = zoom step · flick to spin</div>
    </div>
  );
}

export function TemporalView({ onClose }: { onClose?: () => void } = {}) {
  const grid = useBlockbusterStore((s) => s.grid);
  const riskStates = useBlockbusterStore((s) => s.riskStates);
  const zones = useBlockbusterStore((s) => s.zones);
  const zoneContribution = useBlockbusterStore((s) => s.zoneContribution);
  const dayNight = useBlockbusterStore((s) => s.dayNight);
  const journeyParams = useBlockbusterStore((s) => s.journeyParams);
  const extent = useBlockbusterStore((s) => s.extent);
  const hexSize = useBlockbusterStore((s) => s.hexSize);
  const costParams = useBlockbusterStore((s) => s.costParams);
  const terrain = useBlockbusterStore((s) => s.terrain);
  const plan = useBlockbusterStore((s) => s.plan);
  const seed = useBlockbusterStore((s) => s.seed);

  const [layout, setLayout] = useState<Layout>('stack');
  const [intervalMin, setIntervalMin] = useState(15);
  // Default into the journey window (default route departs 08:00, ~3 h) so the
  // per-slice route highlight is visible on load.
  const [currentMin, setCurrentMin] = useState(9 * 60);
  const [gridScroll, setGridScroll] = useState<GridScroll>('fixed');
  const [spacing, setSpacing] = useState(2.5);
  const [opacity, setOpacity] = useState(0.5);
  const [shadeBy, setShadeBy] = useState<ShadeBy>('composite');
  const [hourlyMode, setHourlyMode] = useState<HourlyMode>('temporal');
  const [inset, setInset] = useState(0.9);
  const [showPermanent, setShowPermanent] = useState(true);
  const [showGround, setShowGround] = useState(true);
  const [singleMap, setSingleMap] = useState(false);
  const [autoRotate, setAutoRotate] = useState(false);
  const [showRoutes3d, setShowRoutes3d] = useState(true);
  // Mount the Leaflet map once and keep it mounted, so its terrain raster is
  // built a single time rather than on every base-off toggle. Warm it shortly
  // after load (off the critical path) so the first reveal is instant; if the
  // base is switched off before then, mount it right away.
  const [mapMounted, setMapMounted] = useState(false);
  useEffect(() => {
    const id = setTimeout(() => setMapMounted(true), 1500);
    return () => clearTimeout(id);
  }, []);
  useEffect(() => {
    if (!showPermanent) setMapMounted(true);
  }, [showPermanent]);

  // Generate the permanent terrain raster off the main thread at app open, so
  // the heavy per-pixel field sampling never blocks the UI — the Leaflet base
  // just receives a ready image when the worker finishes.
  const [terrainUrl, setTerrainUrl] = useState<string | null>(null);
  const terrainUrlRef = useRef<string | null>(null);
  useEffect(() => {
    const worker = new Worker(new URL('./terrainRaster.worker.ts', import.meta.url), {
      type: 'module',
    });
    worker.onmessage = (e: MessageEvent<Blob>) => {
      if (terrainUrlRef.current) URL.revokeObjectURL(terrainUrlRef.current);
      const url = URL.createObjectURL(e.data);
      terrainUrlRef.current = url;
      setTerrainUrl(url);
    };
    worker.postMessage({ extent, seed } satisfies TerrainRasterRequest);
    return () => {
      worker.terminate();
      if (terrainUrlRef.current) {
        URL.revokeObjectURL(terrainUrlRef.current);
        terrainUrlRef.current = null;
      }
    };
  }, [extent, seed]);

  // Layout morph: 0 = grid, 1 = stack, animated on toggle.
  const [morph, setMorph] = useState(1);
  const [transitioning, setTransitioning] = useState(false);
  const morphRef = useRef(1);
  useEffect(() => {
    const target = layout === 'stack' ? 1 : 0;
    const from = morphRef.current;
    if (from === target) return;
    setTransitioning(true);
    const DURATION = 750;
    const start = performance.now();
    let raf = 0;
    const tick = (now: number) => {
      const k = Math.min(1, (now - start) / DURATION);
      const value = from + (target - from) * k;
      morphRef.current = value;
      setMorph(value);
      if (k < 1) raf = requestAnimationFrame(tick);
      else setTransitioning(false);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [layout]);

  // Snap the current time onto the grid when the interval changes.
  useEffect(() => {
    setCurrentMin((m) => clampN(Math.round(m / intervalMin) * intervalMin, 0, DAY_MIN - intervalMin));
  }, [intervalMin]);

  const cells = grid?.cells;

  const inputs = useMemo<ProfileInputs | null>(() => {
    if (!cells) return null;
    return { riskStates, zoneContribution, zones, dayNight, journeyParams, extent, hexSize, terrain };
  }, [cells, riskStates, zoneContribution, zones, dayNight, journeyParams, extent, hexSize, terrain]);

  const baseInfo = useMemo(
    () => (cells && inputs ? buildBase(cells, inputs, shadeBy, costParams) : null),
    [cells, inputs, shadeBy, costParams],
  );
  useEffect(() => () => baseInfo?.geometry.dispose(), [baseInfo]);

  // Windowed slice maths.
  const totalSlices = Math.round(DAY_MIN / intervalMin);
  const windowEff = Math.min(WINDOW, totalSlices);
  const half = (windowEff - 1) / 2;
  const scrollPos = clampN(currentMin / intervalMin, 0, totalSlices - 1);
  const scrollCenter = clampN(scrollPos, half, Math.max(half, totalSlices - 1 - half));
  const currentSlice = clampN(Math.round(scrollPos), 0, totalSlices - 1);
  const windowStart = clampN(
    gridScroll === 'inplace'
      ? Math.floor(currentSlice / windowEff) * windowEff // paged: highlight moves through cells
      : currentSlice - FIXED_CELL, // fixed: window follows the current, pinned at the central cell
    0,
    Math.max(0, totalSlices - windowEff),
  );

  // Lazy geometry cache: a fresh Map per build-key; disposed when the key changes.
  // A fresh geometry cache whenever anything affecting a slice's geometry changes;
  // the deps are intentional invalidation keys (not used in the factory body).
  const cache = useMemo(
    () => new Map<number, THREE.BufferGeometry>(),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [baseInfo, hourlyMode, inset, intervalMin],
  );
  useEffect(() => {
    const m = cache;
    return () => {
      for (const g of m.values()) g.dispose();
      m.clear();
    };
  }, [cache]);

  const windowLayers = useMemo<WindowLayer[]>(() => {
    if (!cells || !inputs || !baseInfo) return [];
    const out: WindowLayer[] = [];
    for (let j = 0; j < windowEff; j++) {
      const index = windowStart + j;
      let geometry = cache.get(index);
      if (!geometry) {
        geometry = buildSlice(cells, inputs, index * intervalMin, hourlyMode, inset, baseInfo);
        cache.set(index, geometry);
      }
      out.push({ index, geometry });
    }
    return out;
  }, [cache, windowStart, windowEff, cells, inputs, baseInfo, hourlyMode, inset, intervalMin]);

  // Drop slices that scrolled well outside the window.
  useEffect(() => {
    for (const [i, g] of cache) {
      if (i < windowStart - BUFFER || i >= windowStart + windowEff + BUFFER) {
        g.dispose();
        cache.delete(i);
      }
    }
  }, [cache, windowStart, windowEff]);

  // COA routes (default waypoints are seeded by regenerate). The faint full
  // route is shared across slices; the wide "previous → next step" highlight is
  // per-slice and rebuilt only when the window shifts.
  const routePolys = useMemo(
    () => (plan && grid ? buildRoutePolys(plan, grid, extent) : []),
    [plan, grid, extent],
  );
  useEffect(
    () => () => {
      for (const r of routePolys) r.faintGeo?.dispose();
    },
    [routePolys],
  );
  const activeRibbons = useMemo(() => {
    const map = new Map<number, { color: THREE.Color; geo: THREE.BufferGeometry }[]>();
    for (let j = 0; j < windowEff; j++) {
      const index = windowStart + j;
      const t = index * intervalMin;
      const arr: { color: THREE.Color; geo: THREE.BufferGeometry }[] = [];
      for (const r of routePolys) {
        const geo = ribbonGeometry(activeSubPath(r.pts, r.times, t, intervalMin), 0.6, 0.5);
        if (geo) arr.push({ color: r.color, geo });
      }
      if (arr.length) map.set(index, arr);
    }
    return map;
  }, [routePolys, windowStart, windowEff, intervalMin]);
  useEffect(
    () => () => {
      for (const arr of activeRibbons.values()) for (const a of arr) a.geo.dispose();
    },
    [activeRibbons],
  );

  const baseLabel = useMemo(() => getLabel('Permanent'), []);
  const frameGeo = useMemo(() => frameBandGeometry(extent, 2.4), [extent]);
  useEffect(() => () => frameGeo.dispose(), [frameGeo]);

  const framing = useMemo(() => gridFraming(extent), [extent]);
  const stackTargetY = (STACK_START + half) * spacing;
  const initialZoom = orthoZoom(
    Math.hypot(STACK_CAM[0], STACK_CAM[1] - stackTargetY, STACK_CAM[2]),
  );

  const mapQuadRef = useRef<HTMLDivElement>(null);
  const mapShown = !showPermanent; // base off → drop in the live Leaflet map
  const mapH = Math.round(MAP_W * (extent.height / extent.width));

  if (!grid || !cells || !baseInfo) return <div className="temporal-loading">Building world…</div>;

  return (
    <div className="temporal-root">
      {mapMounted && (
        <div
          className="temporal-map-layer"
          style={{ visibility: mapShown ? 'visible' : 'hidden' }}
        >
          <div
            className="temporal-map-quad"
            ref={mapQuadRef}
            style={{ width: MAP_W, height: mapH, opacity: 0 }}
          >
            <BaseLeafletMap extent={extent} terrainUrl={terrainUrl} />
          </div>
        </div>
      )}
      <Canvas
        orthographic
        gl={{ alpha: true }}
        style={{ position: 'absolute', inset: 0, zIndex: 1 }}
        camera={{ position: [62, 48, 80], zoom: initialZoom, near: 0.1, far: 4000 }}
      >
        <Scene
          base={baseInfo.geometry}
          baseLabel={baseLabel}
          layers={windowLayers}
          extent={extent}
          spacing={spacing}
          opacity={opacity}
          temporal={hourlyMode === 'temporal'}
          showPermanent={showPermanent}
          showGround={showGround}
          singleMap={singleMap}
          morph={morph}
          scrollCenter={scrollCenter}
          half={half}
          currentSlice={currentSlice}
          windowStart={windowStart}
          intervalMin={intervalMin}
          frameGeo={frameGeo}
          showRoutes3d={showRoutes3d}
          routePolys={routePolys}
          activeRibbons={activeRibbons}
        />
        <Orbit
          layout={layout}
          transitioning={transitioning}
          morph={morph}
          gridCamHeight={framing.height}
          gridTargetZ={framing.targetZ}
          stackTargetY={stackTargetY}
          autoRotate={autoRotate}
        />
        {mapMounted && (
          <MapPlaneTransform extent={extent} morph={morph} quadH={mapH} quadRef={mapQuadRef} />
        )}
      </Canvas>

      {onClose ? (
        <button type="button" className="temporal-close" onClick={onClose}>
          ✕ Close 3D view
        </button>
      ) : (
        <a className="temporal-close" href="index.html">
          ← Back to map
        </a>
      )}

      <div className="temporal-panel">
        <h1>Temporal risk — windowed</h1>
        <p className="sub">
          {cells.length} cells · {totalSlices} slices · {windowEff}-layer window · the wheel scrolls
          Stack or Grid
        </p>

        <div className="temporal-row">
          <span className="temporal-lbl">Layout</span>
          <div className="temporal-seg">
            <button type="button" className={layout === 'stack' ? 'on' : ''} onClick={() => setLayout('stack')}>
              Stack 3D
            </button>
            <button type="button" className={layout === 'grid' ? 'on' : ''} onClick={() => setLayout('grid')}>
              Grid 5×4
            </button>
          </div>
        </div>

        <div className="temporal-row">
          <span className="temporal-lbl">Hours show</span>
          <div className="temporal-seg">
            <button
              type="button"
              className={hourlyMode === 'temporal' ? 'on' : ''}
              onClick={() => setHourlyMode('temporal')}
            >
              Temporal Δ
            </button>
            <button
              type="button"
              className={hourlyMode === 'total' ? 'on' : ''}
              onClick={() => setHourlyMode('total')}
            >
              Total
            </button>
          </div>
        </div>

        <div className="temporal-row">
          <span className="temporal-lbl">Grid scroll</span>
          <div className="temporal-seg">
            <button
              type="button"
              className={gridScroll === 'fixed' ? 'on' : ''}
              onClick={() => setGridScroll('fixed')}
            >
              Fixed cell
            </button>
            <button
              type="button"
              className={gridScroll === 'inplace' ? 'on' : ''}
              onClick={() => setGridScroll('inplace')}
            >
              In place
            </button>
          </div>
        </div>

        <div className="temporal-row">
          <label htmlFor="shade">Shade by</label>
          <select id="shade" value={shadeBy} onChange={(e) => setShadeBy(e.target.value as ShadeBy)}>
            <option value="composite">Composite cost</option>
            {RISK_TYPES.map((r) => (
              <option key={r} value={r}>
                {RISK_LABELS[r]}
              </option>
            ))}
          </select>
        </div>

        <div className="temporal-row">
          <label htmlFor="spacing">Layer gap</label>
          <input
            id="spacing"
            type="range"
            min={0.5}
            max={6}
            step={0.1}
            value={spacing}
            onChange={(e) => setSpacing(Number(e.target.value))}
          />
          <span className="temporal-val">{spacing.toFixed(1)}</span>
        </div>

        <div className="temporal-row">
          <label htmlFor="opacity">Opacity</label>
          <input
            id="opacity"
            type="range"
            min={0.05}
            max={1}
            step={0.05}
            value={opacity}
            onChange={(e) => setOpacity(Number(e.target.value))}
          />
          <span className="temporal-val">{opacity.toFixed(2)}</span>
        </div>

        <div className="temporal-row">
          <label htmlFor="inset">Hex gap</label>
          <input
            id="inset"
            type="range"
            min={0.6}
            max={1}
            step={0.02}
            value={inset}
            onChange={(e) => setInset(Number(e.target.value))}
          />
          <span className="temporal-val">{inset.toFixed(2)}</span>
        </div>

        <div className="temporal-row">
          <label htmlFor="permanent">Permanent base</label>
          <input
            id="permanent"
            type="checkbox"
            checked={showPermanent}
            onChange={(e) => setShowPermanent(e.target.checked)}
          />
        </div>

        <div className="temporal-row">
          <label htmlFor="ground">Ground plane</label>
          <input
            id="ground"
            type="checkbox"
            checked={showGround}
            onChange={(e) => setShowGround(e.target.checked)}
          />
        </div>

        <div className="temporal-row">
          <label htmlFor="single">Single map (stack)</label>
          <input
            id="single"
            type="checkbox"
            checked={singleMap}
            onChange={(e) => setSingleMap(e.target.checked)}
          />
        </div>

        <div className="temporal-row">
          <label htmlFor="rotate">Auto-rotate (stack)</label>
          <input
            id="rotate"
            type="checkbox"
            checked={autoRotate}
            onChange={(e) => setAutoRotate(e.target.checked)}
          />
        </div>

        <div className="temporal-row">
          <label htmlFor="routes">Routes</label>
          <input
            id="routes"
            type="checkbox"
            checked={showRoutes3d}
            onChange={(e) => setShowRoutes3d(e.target.checked)}
          />
        </div>

        <p className="temporal-note">
          Only the {windowEff}-layer window (+buffer) is computed &amp; cached; slices build on the
          fly as you scroll. Permanent base anchors the colour scale and sits beneath the stack —
          switch it off to drop the live Leaflet map onto that plane.
        </p>
      </div>

      <TimeWheel
        currentMin={currentMin}
        setCurrentMin={setCurrentMin}
        intervalMin={intervalMin}
        setIntervalMin={setIntervalMin}
      />
    </div>
  );
}
