/**
 * THROWAWAY SPIKE — windowed temporal stack with a vertical time-wheel.
 *
 * The data is sliced at a chosen interval (5 min … 3 h); a fixed **window of 24
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
 *
 * Delete `src/spike/`, `temporal3d.html` and the extra `vite` input to remove.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import type { PointerEvent as ReactPointerEvent, WheelEvent as ReactWheelEvent } from 'react';
import * as THREE from 'three';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import {
  applyZoneOffsets,
  cellRiskCost,
  clamp01,
  effectiveProfile,
  RISK_LABELS,
  RISK_TYPES,
  speedModifiedProfile,
} from '@domain';
import type { CostParams, HexCell, RiskProfile, RiskType, WorldExtent, WorldPoint } from '@domain';
import { selectDisplayProfile, useBlockbusterStore } from '@/state/store';
import { formatTime } from '@/ui/utils/time';

const DAY_MIN = 1440;
const WINDOW = 24; // layers shown at once (= the 6×4 grid)
const BUFFER = 4; // extra slices kept cached either side of the window
const INTERVAL_OPTIONS = [5, 15, 30, 60, 180] as const;

const BASE_OVERHANG = 1.08;
const STACK_START = 2; // window's bottom layer sits this many `spacing` units above the base
const STACK_CAM: readonly [number, number, number] = [62, 48, 80];

const GRID_COLS = 6;
const GRID_ROWS = 4;
const GRID_GAP = 6; // km between tiles
const GRID_TILT = 0.25; // z-offset as a fraction of height — a gentle bird's-eye, off the gimbal
const FIXED_CELL = GRID_COLS + 3; // where the current slice pins in "fixed cell" grid scroll

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
    if (layout === 'grid') {
      camera.position.set(0, gridCamHeight, gridTargetZ + gridCamHeight * GRID_TILT);
      controls.target.set(0, 0, gridTargetZ);
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
          : new THREE.Vector3(0, gridCamHeight, gridTargetZ + gridCamHeight * GRID_TILT);
      const toTarget =
        layout === 'stack'
          ? new THREE.Vector3(0, stackTargetY, 0)
          : new THREE.Vector3(0, 0, gridTargetZ);
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
  morph,
  scrollCenter,
  half,
  currentSlice,
  windowStart,
  gridScroll,
  intervalMin,
  frameGeo,
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
  morph: number;
  scrollCenter: number;
  half: number;
  currentSlice: number;
  windowStart: number;
  gridScroll: GridScroll;
  intervalMin: number;
  frameGeo: THREE.BufferGeometry;
}) {
  const m = smoothstep(morph);
  const baseZ = lerp(baseRowZ(extent), 0, m);
  const baseScale = lerp(1, BASE_OVERHANG, m);
  return (
    <group>
      {showGround && m > 0.15 && <GroundPlane extent={extent} opacity={0.85 * m} />}

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
        const cell = gridScroll === 'fixed' ? index - currentSlice + FIXED_CELL : index - windowStart;
        const gridValid = cell >= 0 && cell < GRID_COLS * GRID_ROWS;
        const [gx, gz] = gridValid ? gridTileXZ(cell, extent) : [0, 0];
        const stackY = (STACK_START + (index - scrollCenter + half)) * spacing;
        const px = lerp(gx, 0, m);
        const py = lerp(0, stackY, m);
        const pz = lerp(gz, 0, m);
        const stackOp = isCurrent ? 1 : opacity;
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
              <lineLoop geometry={frameGeo}>
                <lineBasicMaterial color="#cfe0f2" transparent opacity={0.85} depthTest={false} />
              </lineLoop>
            )}
            <sprite position={[0, 2, -extent.height / 2 - 2.2]} scale={[16, 4, 1]}>
              <spriteMaterial
                map={getLabel(formatTime(index * intervalMin))}
                transparent
                opacity={(1 - m) * (gridValid ? 1 : 0)}
                depthTest={false}
              />
            </sprite>
          </group>
        );
      })}
    </group>
  );
}

/** Vertical reel: drag ↕ or mouse-wheel to scroll the current time. */
function TimeWheel({
  currentMin,
  setCurrentMin,
  intervalMin,
}: {
  currentMin: number;
  setCurrentMin: (m: number) => void;
  intervalMin: number;
}) {
  const drag = useRef<{ y: number; min: number } | null>(null);
  const maxMin = DAY_MIN - intervalMin;
  const clampMin = (mn: number) => clampN(mn, 0, maxMin);
  const PX = 44; // pixels per slice while dragging
  const onDown = (e: ReactPointerEvent) => {
    drag.current = { y: e.clientY, min: currentMin };
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  };
  const onMove = (e: ReactPointerEvent) => {
    if (!drag.current) return;
    const dy = e.clientY - drag.current.y;
    setCurrentMin(clampMin(drag.current.min - (dy / PX) * intervalMin));
  };
  const onUp = () => {
    if (drag.current) {
      setCurrentMin(clampMin(Math.round(currentMin / intervalMin) * intervalMin));
      drag.current = null;
    }
  };
  const onWheel = (e: ReactWheelEvent) => {
    setCurrentMin(clampMin(currentMin + Math.sign(e.deltaY) * intervalMin));
  };

  const cur = Math.round(currentMin / intervalMin);
  const ticks: { idx: number; y: number; label: string; current: boolean }[] = [];
  for (let d = -3; d <= 3; d++) {
    const idx = cur + d;
    const mn = idx * intervalMin;
    if (mn < 0 || mn > maxMin) continue;
    ticks.push({ idx, y: (idx - currentMin / intervalMin) * PX, label: formatTime(mn), current: d === 0 });
  }
  return (
    <div className="spike-wheel">
      <div className="spike-wheel-cap">TIME — drag ↕ / scroll</div>
      <div
        className="spike-wheel-reel"
        onPointerDown={onDown}
        onPointerMove={onMove}
        onPointerUp={onUp}
        onPointerCancel={onUp}
        onWheel={onWheel}
      >
        <div className="spike-wheel-band" />
        {ticks.map((t) => (
          <div
            key={t.idx}
            className={t.current ? 'spike-wheel-tick now' : 'spike-wheel-tick'}
            style={{ transform: `translateY(calc(-50% + ${t.y}px))`, opacity: Math.max(0, 1 - Math.abs(t.y) / 120) }}
          >
            {t.label}
          </div>
        ))}
      </div>
      <div className="spike-wheel-hint">scrolls Stack &amp; Grid alike</div>
    </div>
  );
}

export function TemporalSpike() {
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

  const [layout, setLayout] = useState<Layout>('stack');
  const [intervalMin, setIntervalMin] = useState(15);
  const [currentMin, setCurrentMin] = useState(12 * 60);
  const [gridScroll, setGridScroll] = useState<GridScroll>('fixed');
  const [spacing, setSpacing] = useState(2.5);
  const [opacity, setOpacity] = useState(0.5);
  const [shadeBy, setShadeBy] = useState<ShadeBy>('composite');
  const [hourlyMode, setHourlyMode] = useState<HourlyMode>('temporal');
  const [inset, setInset] = useState(0.9);
  const [showPermanent, setShowPermanent] = useState(true);
  const [showGround, setShowGround] = useState(true);
  const [autoRotate, setAutoRotate] = useState(false);

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
    currentSlice - Math.floor(windowEff / 2),
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

  const baseLabel = useMemo(() => getLabel('Permanent'), []);
  const frameGeo = useMemo(() => {
    const w = extent.width / 2;
    const h = extent.height / 2;
    const g = new THREE.BufferGeometry();
    g.setAttribute(
      'position',
      new THREE.Float32BufferAttribute([-w, 0.2, -h, w, 0.2, -h, w, 0.2, h, -w, 0.2, h], 3),
    );
    return g;
  }, [extent]);
  useEffect(() => () => frameGeo.dispose(), [frameGeo]);

  const framing = useMemo(() => gridFraming(extent), [extent]);
  const stackTargetY = (STACK_START + half) * spacing;
  const initialZoom = orthoZoom(
    Math.hypot(STACK_CAM[0], STACK_CAM[1] - stackTargetY, STACK_CAM[2]),
  );

  if (!grid || !cells || !baseInfo) return <div className="spike-loading">Building world…</div>;

  return (
    <div className="spike-root">
      <Canvas orthographic camera={{ position: [62, 48, 80], zoom: initialZoom, near: 0.1, far: 4000 }}>
        <color attach="background" args={['#0b0e14']} />
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
          morph={morph}
          scrollCenter={scrollCenter}
          half={half}
          currentSlice={currentSlice}
          windowStart={windowStart}
          gridScroll={gridScroll}
          intervalMin={intervalMin}
          frameGeo={frameGeo}
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
      </Canvas>

      <a className="spike-back" href="index.html">
        ← Back to map
      </a>

      <div className="spike-panel">
        <h1>Temporal risk — windowed</h1>
        <p className="sub">
          {cells.length} cells · {totalSlices} slices · {windowEff}-layer window · the wheel scrolls
          Stack or Grid
        </p>

        <div className="spike-row">
          <span className="spike-lbl">Layout</span>
          <div className="spike-seg">
            <button type="button" className={layout === 'stack' ? 'on' : ''} onClick={() => setLayout('stack')}>
              Stack 3D
            </button>
            <button type="button" className={layout === 'grid' ? 'on' : ''} onClick={() => setLayout('grid')}>
              Grid 6×4
            </button>
          </div>
        </div>

        <div className="spike-row">
          <label htmlFor="interval">Interval</label>
          <select id="interval" value={intervalMin} onChange={(e) => setIntervalMin(Number(e.target.value))}>
            {INTERVAL_OPTIONS.map((iv) => (
              <option key={iv} value={iv}>
                {iv < 60 ? `${iv} min` : `${iv / 60} h`}
              </option>
            ))}
          </select>
        </div>

        <div className="spike-row">
          <span className="spike-lbl">Hours show</span>
          <div className="spike-seg">
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

        <div className="spike-row">
          <span className="spike-lbl">Grid scroll</span>
          <div className="spike-seg">
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

        <div className="spike-row">
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

        <div className="spike-row">
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
          <span className="spike-val">{spacing.toFixed(1)}</span>
        </div>

        <div className="spike-row">
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
          <span className="spike-val">{opacity.toFixed(2)}</span>
        </div>

        <div className="spike-row">
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
          <span className="spike-val">{inset.toFixed(2)}</span>
        </div>

        <div className="spike-row">
          <label htmlFor="permanent">Permanent base</label>
          <input
            id="permanent"
            type="checkbox"
            checked={showPermanent}
            onChange={(e) => setShowPermanent(e.target.checked)}
          />
        </div>

        <div className="spike-row">
          <label htmlFor="ground">Ground plane</label>
          <input
            id="ground"
            type="checkbox"
            checked={showGround}
            onChange={(e) => setShowGround(e.target.checked)}
          />
        </div>

        <div className="spike-row">
          <label htmlFor="rotate">Auto-rotate</label>
          <input
            id="rotate"
            type="checkbox"
            checked={autoRotate}
            onChange={(e) => setAutoRotate(e.target.checked)}
          />
        </div>

        <p className="spike-note">
          Only the {windowEff}-layer window (+buffer) is computed &amp; cached; slices build on the
          fly as you scroll. Permanent base anchors the colour scale and sits beneath the stack.
        </p>
      </div>

      <TimeWheel currentMin={currentMin} setCurrentMin={setCurrentMin} intervalMin={intervalMin} />
    </div>
  );
}
