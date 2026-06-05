/**
 * THROWAWAY SPIKE — does temporal risk read better as a 3D z-stack or as 2D
 * small multiples? (Stakeholder's "z-axis for temporal perspective" idea, plus
 * a side-by-side comparison.) A viewer, not a feature: no editing, no routes,
 * no Leaflet.
 *
 * Faithful, not faked:
 * - The permanent **base grid** is the terrain (non-temporal) risk — the live
 *   map's `selectCellCost` basis. In the stack it is a solid overhanging slab at
 *   the bottom; in the grid it is a labelled map on its own above the hours.
 * - The hourly grids default to the **temporal Δ** (storm + day/night only,
 *   diverging scale) so they show a different source from the terrain and look
 *   unlike it; a toggle switches them to the full per-hour risk. All values come
 *   from the real `selectDisplayProfile` pipeline.
 *
 * One scene, two layouts. A `morph` value (0 = grid, 1 = stack) animates every
 * tile between its flat 6×4 slot and its stacked height, so toggling the layout
 * is a continuous transition rather than a cut.
 *
 * Delete `src/spike/`, `temporal3d.html` and the extra `vite` input to remove.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
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

const HOURS = Array.from({ length: 24 }, (_, h) => h);

// Stack: the permanent base reads as a foundation — a solid pedestal that
// overhangs the temporal stack with a clear gap to hour 0.
const BASE_OVERHANG = 1.08;
const STACK_START = 2; // hour 0 sits this many `spacing` units above the base
const STACK_CAM: readonly [number, number, number] = [62, 48, 80];

// Grid: 24 hourly maps as small multiples, with the permanent map above them.
const GRID_COLS = 6;
const GRID_ROWS = 4;
const GRID_GAP = 6; // km between tiles
const GRID_TILT = 0.25; // z-offset as a fraction of height — a gentle bird's-eye, off the gimbal

type Layout = 'stack' | 'grid';

/** What a risk cell is shaded by: the composite cost, or one channel's level. */
type ShadeBy = 'composite' | RiskType;

/**
 * What the hourly grids show:
 * - `temporal` — only the temporal contribution (storm + day/night), as a signed
 *   delta from the no-temporal baseline. Terrain and journey-speed cancel, so the
 *   hours look nothing like the permanent terrain map (the stakeholder's point).
 * - `total` — the full risk at that hour (terrain + temporal), like the live map.
 */
type HourlyMode = 'temporal' | 'total';

/** The slice of store state `selectDisplayProfile` needs, minus the time. */
type ProfileInputs = Omit<Parameters<typeof selectDisplayProfile>[0], 'displayTime'>;

interface Spotlight {
  on: boolean;
  hour: number;
  showGhosts: boolean;
}

interface BuiltLayers {
  /** Permanent (non-temporal) risk grid, drawn solid (no hex gaps). */
  base: THREE.BufferGeometry;
  /** One vertex-coloured grid per hour 0…23. */
  hours: THREE.BufferGeometry[];
}

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const smoothstep = (t: number) => {
  const x = Math.min(1, Math.max(0, t));
  return x * x * (3 - 2 * x);
};

// Orthographic projection (no perspective) so the stacked maps line up when
// viewed from above. The camera positions still frame each view; we convert the
// framing distance to an ortho `zoom` that matches the apparent size a 45° fov
// perspective camera would have shown at that distance.
const FOV = 45;
const orthoZoom = (distance: number): number => {
  const h = typeof window !== 'undefined' && window.innerHeight > 0 ? window.innerHeight : 900;
  return h / (2 * distance * Math.tan(((FOV * Math.PI) / 180) / 2));
};

const gridCellW = (e: WorldExtent) => e.width + GRID_GAP;
const gridCellH = (e: WorldExtent) => e.height + GRID_GAP;
/** Z of the permanent map, centred just north of the hourly grid. */
const baseRowZ = (e: WorldExtent) => -(GRID_ROWS / 2 + 0.5) * gridCellH(e);

/** Flat 6×4 slot (X, Z) for hour `h`, centred on the origin. */
function gridTileXZ(h: number, e: WorldExtent): readonly [number, number] {
  const col = h % GRID_COLS;
  const row = Math.floor(h / GRID_COLS);
  return [(col - (GRID_COLS - 1) / 2) * gridCellW(e), (row - (GRID_ROWS - 1) / 2) * gridCellH(e)];
}

/** Top-down camera height + target-Z that frames the grid plus the map above it. */
function gridFraming(e: WorldExtent): { height: number; targetZ: number } {
  const gridW = GRID_COLS * gridCellW(e);
  const zNorth = baseRowZ(e) - e.height / 2;
  const zSouth = ((GRID_ROWS - 1) / 2) * gridCellH(e) + e.height / 2;
  const targetZ = (zNorth + zSouth) / 2;
  const depth = zSouth - zNorth;
  const vfov = (45 * Math.PI) / 180;
  const aspect =
    typeof window !== 'undefined' && window.innerHeight > 0
      ? window.innerWidth / window.innerHeight
      : 1.6;
  const hfov = 2 * Math.atan(Math.tan(vfov / 2) * aspect);
  const height = Math.max(gridW / 2 / Math.tan(hfov / 2), depth / 2 / Math.tan(vfov / 2)) * 1.1;
  return { height, targetZ };
}

/**
 * Mirror `ui/theme.heatColor` (green 120° → red 0° as risk rises) straight to a
 * GPU colour, skipping the CSS-string round-trip. Colour management is disabled
 * in `main.tsx` so this lands on screen matching the 2D map.
 */
function heatThreeColor(t: number): THREE.Color {
  const hue = (1 - clamp01(t)) * 120;
  return new THREE.Color().setHSL(hue / 360, 0.72, 0.48);
}

// Temporal delta: the colour carries the sign (red adds risk, blue removes it)
// and the magnitude rides on per-cell ALPHA — so a "no change" cell is fully
// transparent and the non-temporal backdrop shows through, instead of a fill
// that hides it from above.
const TEMPORAL_POS = new THREE.Color(0.85, 0.1, 0.1);
const TEMPORAL_NEG = new THREE.Color(0.1, 0.4, 0.85);
const temporalColor = (t: number): THREE.Color => (t >= 0 ? TEMPORAL_POS : TEMPORAL_NEG);
const temporalAlpha = (t: number): number => Math.min(1, Math.abs(t) ** 0.75);

/** World (x, y) km → centred scene (X, Z); hours become the Y axis elsewhere. */
function worldToXZ(p: WorldPoint, ext: WorldExtent): readonly [number, number] {
  return [p.x - ext.width / 2, -(p.y - ext.height / 2)];
}

/** Pull a hex vertex toward its centre so neighbouring cells show a gap. */
function insetPoint(c: WorldPoint, v: WorldPoint, k: number): WorldPoint {
  return { x: c.x + (v.x - c.x) * k, y: c.y + (v.y - c.y) * k };
}

/**
 * The permanent, non-temporal risk for a cell — exactly the live map's
 * `selectCellCost` basis: terrain (base + overrides) folded with always-active
 * zone offsets. No journey speed, no day/night, no time-bounded/moving zones.
 */
function permanentProfile(inputs: ProfileInputs, cell: HexCell): RiskProfile | null {
  const rs = inputs.riskStates.get(cell.id);
  if (!rs) return null;
  return applyZoneOffsets(effectiveProfile(rs), inputs.zoneContribution.get(cell.id));
}

/**
 * The hour's non-temporal baseline for the delta: permanent terrain risk plus the
 * constant journey-speed modifier — i.e. `selectDisplayProfile` with the storm and
 * day/night switched off. Subtracting it from the full hour isolates the temporal
 * sources (terrain and speed cancel).
 */
function noTemporalProfile(inputs: ProfileInputs, cell: HexCell): RiskProfile | null {
  const base = permanentProfile(inputs, cell);
  if (!base) return null;
  return speedModifiedProfile(base, inputs.journeyParams.fixedSpeedKmh);
}

/** One flat, vertex-coloured grid (all cells fanned into triangles, in the X-Z plane). */
function makeGridGeometry(
  cells: readonly HexCell[],
  ext: WorldExtent,
  inset: number,
  colorAt: (cellIndex: number) => THREE.Color,
  alphaAt: (cellIndex: number) => number = () => 1,
): THREE.BufferGeometry {
  const positions: number[] = [];
  const colors: number[] = []; // RGBA — per-cell alpha drives temporal transparency
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

/**
 * Build the permanent base grid (drawn solid) plus one grid per hour (gapped).
 *
 * The permanent grid is the terrain (non-temporal) risk on a heat scale, anchored
 * to its own max — exactly the live map's `maxCost` (HexGridLayer). The hourly
 * grids are either the full risk (`total`, also heat) or, by default, the
 * **temporal delta** (`temporal`): each hour minus the no-temporal baseline, on a
 * diverging scale (red adds risk, blue removes it). The delta strips out terrain
 * and speed, so the hours show only the storm + day/night — a different source
 * from the permanent map, and visually unlike it.
 */
function buildLayers(
  cells: readonly HexCell[],
  inputs: ProfileInputs,
  shadeBy: ShadeBy,
  costParams: CostParams,
  inset: number,
  hourlyMode: HourlyMode,
): BuiltLayers {
  const n = cells.length;
  const isComposite = shadeBy === 'composite';
  const metric = (p: RiskProfile) => (isComposite ? cellRiskCost(p, costParams) : p[shadeBy]);

  // Permanent terrain risk.
  const baseVals = new Float32Array(n);
  let baseMax = 0;
  for (let ci = 0; ci < n; ci++) {
    const cell = cells[ci];
    if (!cell) continue;
    const p = permanentProfile(inputs, cell);
    if (!p) continue;
    const v = metric(p);
    baseVals[ci] = v;
    if (v > baseMax) baseMax = v;
  }
  // Single channels are already 0…1; composite divides by the base max.
  const baseNorm = isComposite ? baseMax || 1 : 1;

  // Hours: full risk, or the signed temporal delta from the no-temporal baseline.
  const hourVals = new Float32Array(HOURS.length * n);
  let maxAbsDelta = 1e-9;
  for (const h of HOURS) {
    const st = { ...inputs, displayTime: h * 60 };
    for (let ci = 0; ci < n; ci++) {
      const cell = cells[ci];
      if (!cell) continue;
      const full = selectDisplayProfile(st, cell.id, cell.vertices);
      if (!full) continue;
      if (hourlyMode === 'temporal') {
        const baseline = noTemporalProfile(inputs, cell);
        const d = baseline ? metric(full) - metric(baseline) : 0;
        hourVals[h * n + ci] = d;
        if (Math.abs(d) > maxAbsDelta) maxAbsDelta = Math.abs(d);
      } else {
        hourVals[h * n + ci] = metric(full);
      }
    }
  }

  const base = makeGridGeometry(cells, inputs.extent, 1, (ci) =>
    heatThreeColor((baseVals[ci] ?? 0) / baseNorm),
  );
  const hours = HOURS.map((h) =>
    hourlyMode === 'temporal'
      ? makeGridGeometry(
          cells,
          inputs.extent,
          inset,
          (ci) => temporalColor((hourVals[h * n + ci] ?? 0) / maxAbsDelta),
          (ci) => temporalAlpha((hourVals[h * n + ci] ?? 0) / maxAbsDelta),
        )
      : makeGridGeometry(cells, inputs.extent, inset, (ci) =>
          heatThreeColor((hourVals[h * n + ci] ?? 0) / baseNorm),
        ),
  );
  return { base, hours };
}

/** A small canvas-texture label (e.g. "06:00", "Permanent") for the grid tiles. */
function makeLabelTexture(text: string): THREE.CanvasTexture {
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
  const tex = new THREE.CanvasTexture(canvas);
  tex.anisotropy = 4;
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

  // Settle on the endpoint framing once a transition finishes (and on mount).
  // Grid sets position + target (its framing is fixed); stack sets only the
  // target so a user's orbit survives spacing tweaks.
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
      // Capture the live pose once, then ease from it to the target framing — so
      // a transition never jumps from a user-orbited angle.
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

/** Faint ground footprint + grid, fading in toward the stack. */
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

/** The whole scene, morphed between grid (morph 0) and stack (morph 1). */
function Scene({
  layers,
  extent,
  spacing,
  everyN,
  opacity,
  spotlight,
  temporal,
  showPermanent,
  showGround,
  morph,
  labels,
  baseLabel,
}: {
  layers: BuiltLayers;
  extent: WorldExtent;
  spacing: number;
  everyN: number;
  opacity: number;
  spotlight: Spotlight;
  temporal: boolean;
  showPermanent: boolean;
  showGround: boolean;
  morph: number;
  labels: (THREE.Texture | undefined)[];
  baseLabel: THREE.Texture;
}) {
  const m = smoothstep(morph);
  const baseZ = lerp(baseRowZ(extent), 0, m);
  const baseScale = lerp(1, BASE_OVERHANG, m);
  return (
    <group>
      {showGround && m > 0.15 && <GroundPlane extent={extent} opacity={0.85 * m} />}

      {/* Permanent (non-temporal) map: above the grid (morph 0) → foundation slab (morph 1). */}
      {showPermanent && (
        <group position={[0, 0, baseZ]} scale={[baseScale, 1, baseScale]}>
          <mesh geometry={layers.base}>
            <meshBasicMaterial vertexColors side={THREE.DoubleSide} />
          </mesh>
          <sprite position={[0, 2, -extent.height / 2 - 6]} scale={[26, 5, 1]}>
            <spriteMaterial map={baseLabel} transparent opacity={1 - m} depthTest={false} />
          </sprite>
        </group>
      )}

      {layers.hours.map((geo, h) => {
        const [gx, gz] = gridTileXZ(h, extent);
        const px = lerp(gx, 0, m);
        const py = lerp(0, spacing * (STACK_START + h), m);
        const pz = lerp(gz, 0, m);
        // Opacity morphs from a solid grid tile (1) to its stack value.
        const decimated = h % everyN === 0;
        let stackOp = opacity;
        let stackVisible = decimated;
        if (spotlight.on) {
          if (h === spotlight.hour) stackOp = 1;
          else stackVisible = decimated && spotlight.showGhosts;
        }
        if (!stackVisible) stackOp = 0;
        const op = lerp(1, stackOp, m);
        return (
          <group key={h} position={[px, py, pz]}>
            <mesh geometry={geo}>
              <meshBasicMaterial
                vertexColors
                transparent
                opacity={op}
                side={THREE.DoubleSide}
                depthWrite={!temporal && op >= 1}
              />
            </mesh>
            <sprite position={[0, 2, -extent.height / 2 - 2.2]} scale={[16, 4, 1]}>
              <spriteMaterial map={labels[h] ?? null} transparent opacity={1 - m} depthTest={false} />
            </sprite>
          </group>
        );
      })}
    </group>
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
  const [spacing, setSpacing] = useState(2.5);
  const [opacity, setOpacity] = useState(0.5);
  const [everyN, setEveryN] = useState(1);
  const [shadeBy, setShadeBy] = useState<ShadeBy>('composite');
  const [hourlyMode, setHourlyMode] = useState<HourlyMode>('temporal');
  const [inset, setInset] = useState(0.9);
  const [showPermanent, setShowPermanent] = useState(true);
  const [showGround, setShowGround] = useState(true);
  const [autoRotate, setAutoRotate] = useState(false);
  const [spotOn, setSpotOn] = useState(true);
  const [spotHour, setSpotHour] = useState(12);
  const [showGhosts, setShowGhosts] = useState(true);

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

  const cells = grid?.cells;

  const layers = useMemo(() => {
    if (!cells) return null;
    const inputs: ProfileInputs = {
      riskStates,
      zoneContribution,
      zones,
      dayNight,
      journeyParams,
      extent,
      hexSize,
      terrain,
    };
    return buildLayers(cells, inputs, shadeBy, costParams, inset, hourlyMode);
  }, [
    cells,
    riskStates,
    zoneContribution,
    zones,
    dayNight,
    journeyParams,
    extent,
    hexSize,
    terrain,
    shadeBy,
    costParams,
    inset,
    hourlyMode,
  ]);

  useEffect(
    () => () => {
      if (!layers) return;
      layers.base.dispose();
      layers.hours.forEach((g) => g.dispose());
    },
    [layers],
  );

  const labels = useMemo(() => HOURS.map((h) => makeLabelTexture(formatTime(h * 60))), []);
  const baseLabel = useMemo(() => makeLabelTexture('Permanent'), []);
  useEffect(
    () => () => {
      labels.forEach((t) => t.dispose());
      baseLabel.dispose();
    },
    [labels, baseLabel],
  );

  const framing = useMemo(() => gridFraming(extent), [extent]);

  if (!grid || !cells || !layers) return <div className="spike-loading">Building world…</div>;

  const spotlight: Spotlight = { on: spotOn, hour: spotHour, showGhosts };
  const stackTargetY = spacing * (STACK_START + HOURS.length - 1) * 0.5;
  const initialZoom = orthoZoom(
    Math.hypot(STACK_CAM[0], STACK_CAM[1] - stackTargetY, STACK_CAM[2]),
  );

  return (
    <div className="spike-root">
      <Canvas orthographic camera={{ position: [62, 48, 80], zoom: initialZoom, near: 0.1, far: 4000 }}>
        <color attach="background" args={['#0b0e14']} />
        <Scene
          layers={layers}
          extent={extent}
          spacing={spacing}
          everyN={everyN}
          opacity={opacity}
          spotlight={spotlight}
          temporal={hourlyMode === 'temporal'}
          showPermanent={showPermanent}
          showGround={showGround}
          morph={morph}
          labels={labels}
          baseLabel={baseLabel}
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
        <h1>Temporal risk — spike</h1>
        <p className="sub">
          {cells.length} cells · 24 hours (00:00 → 23:00). Toggle Layout to morph between the 3D
          stack and 2D small multiples.
        </p>

        <div className="spike-row">
          <span className="spike-lbl">Layout</span>
          <div className="spike-seg">
            <button
              type="button"
              className={layout === 'stack' ? 'on' : ''}
              onClick={() => setLayout('stack')}
            >
              Stack 3D
            </button>
            <button
              type="button"
              className={layout === 'grid' ? 'on' : ''}
              onClick={() => setLayout('grid')}
            >
              Grid 6×4
            </button>
          </div>
        </div>

        <div className="spike-row">
          <label htmlFor="hours">Hours show</label>
          <select
            id="hours"
            value={hourlyMode}
            onChange={(e) => setHourlyMode(e.target.value as HourlyMode)}
          >
            <option value="temporal">Temporal Δ</option>
            <option value="total">Total risk</option>
          </select>
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
          <label htmlFor="permanent">Permanent risk grid</label>
          <input
            id="permanent"
            type="checkbox"
            checked={showPermanent}
            onChange={(e) => setShowPermanent(e.target.checked)}
          />
        </div>

        {layout === 'stack' && (
          <>
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
              <label htmlFor="everyN">Show every</label>
              <select
                id="everyN"
                value={everyN}
                onChange={(e) => setEveryN(Number(e.target.value))}
              >
                <option value={1}>every hour</option>
                <option value={2}>every 2nd</option>
                <option value={3}>every 3rd</option>
                <option value={4}>every 4th</option>
                <option value={6}>every 6th</option>
              </select>
            </div>

            <div className="spike-row">
              <label htmlFor="spotOn">Spotlight one hour</label>
              <input
                id="spotOn"
                type="checkbox"
                checked={spotOn}
                onChange={(e) => setSpotOn(e.target.checked)}
              />
            </div>

            {spotOn && (
              <>
                <div className="spike-row">
                  <label htmlFor="spotHour">Hour</label>
                  <input
                    id="spotHour"
                    type="range"
                    min={0}
                    max={23}
                    step={1}
                    value={spotHour}
                    onChange={(e) => setSpotHour(Number(e.target.value))}
                  />
                  <span className="spike-val">{formatTime(spotHour * 60)}</span>
                </div>
                <div className="spike-row">
                  <label htmlFor="ghosts">Keep others (at Opacity)</label>
                  <input
                    id="ghosts"
                    type="checkbox"
                    checked={showGhosts}
                    onChange={(e) => setShowGhosts(e.target.checked)}
                  />
                </div>
              </>
            )}

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
          </>
        )}

        <p className="spike-note">
          {layout === 'stack'
            ? 'Solid slab at the bottom = permanent terrain risk; the 24 grids above are the hourly layers.'
            : 'Permanent terrain map on top; the 24 hourly maps below it (00:00 → 23:00).'}{' '}
          {hourlyMode === 'temporal' ? (
            <>
              Hours show the temporal <em>Δ</em> only (storm + day/night): red adds risk, blue
              removes it, pale = no change — so they look nothing like the terrain map.
            </>
          ) : (
            <>Hours show the full risk (terrain + temporal) on the same heat scale as the terrain map.</>
          )}
        </p>
        <p className="spike-note">
          Seeded: a storm sweeps E→W 08:00–16:00 (raises <em>cold</em>); day/night shifts{' '}
          <em>animals</em> &amp; <em>humans</em>.
        </p>
      </div>
    </div>
  );
}
