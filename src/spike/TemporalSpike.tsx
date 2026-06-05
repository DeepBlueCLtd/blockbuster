/**
 * THROWAWAY SPIKE — does a stacked 24-hour tower of hex grids actually *read*
 * when you orbit it in 3D? (Stakeholder's "z-axis for temporal perspective"
 * idea.) This is a viewer, not a feature: no editing, no routes, no Leaflet.
 *
 * It is deliberately faithful, not faked: every hex is coloured by the real
 * production pipeline — `selectDisplayProfile` (the same function the time
 * slider drives) → `cellRiskCost` — evaluated at each hour 0…23. The controls
 * expose the obvious occlusion mitigations so we can judge whether any
 * configuration is legible: layer spacing, opacity, decimation (every Nth
 * hour), a single-hour "spotlight", and shade-by-channel.
 *
 * Delete `src/spike/`, `temporal3d.html` and the extra `vite` input to remove.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { cellRiskCost, clamp01, RISK_LABELS, RISK_TYPES } from '@domain';
import type { CostParams, HexCell, RiskType, WorldExtent, WorldPoint } from '@domain';
import { selectDisplayProfile, useBlockbusterStore } from '@/state/store';
import { formatTime } from '@/ui/utils/time';

const HOURS = Array.from({ length: 24 }, (_, h) => h);

/** What a risk cell is shaded by: the composite cost, or one channel's level. */
type ShadeBy = 'composite' | RiskType;

/** The slice of store state `selectDisplayProfile` needs, minus the time. */
type ProfileInputs = Omit<Parameters<typeof selectDisplayProfile>[0], 'displayTime'>;

interface Spotlight {
  on: boolean;
  hour: number;
  ghostOpacity: number;
  showGhosts: boolean;
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

/** World (x, y) km → centred scene (X, Z); hours become the Y axis elsewhere. */
function worldToXZ(p: WorldPoint, ext: WorldExtent): readonly [number, number] {
  return [p.x - ext.width / 2, -(p.y - ext.height / 2)];
}

/** Pull a hex vertex toward its centre so neighbouring cells show a gap. */
function insetPoint(c: WorldPoint, v: WorldPoint, k: number): WorldPoint {
  return { x: c.x + (v.x - c.x) * k, y: c.y + (v.y - c.y) * k };
}

/**
 * Build one flat, vertex-coloured `BufferGeometry` per hour (all cells fanned
 * into triangles, lying in the X-Z plane at y=0). Heights are applied later via
 * each mesh's position so the spacing control stays cheap.
 */
function buildHourGeometries(
  cells: readonly HexCell[],
  inputs: ProfileInputs,
  shadeBy: ShadeBy,
  costParams: CostParams,
  inset: number,
): THREE.BufferGeometry[] {
  const ext = inputs.extent;
  const n = cells.length;

  // Pass 1 — sample the real pipeline at every hour and find the global max so
  // composite-cost colours are comparable across the whole tower.
  const values = new Float32Array(HOURS.length * n);
  let maxValue = 0;
  for (const h of HOURS) {
    const st = { ...inputs, displayTime: h * 60 };
    for (let ci = 0; ci < n; ci++) {
      const cell = cells[ci];
      if (!cell) continue;
      const profile = selectDisplayProfile(st, cell.id, cell.vertices);
      if (!profile) continue;
      const v = shadeBy === 'composite' ? cellRiskCost(profile, costParams) : profile[shadeBy];
      values[h * n + ci] = v;
      if (v > maxValue) maxValue = v;
    }
  }
  // Single channels are already 0…1; composite is normalised by the global max.
  const norm = shadeBy === 'composite' ? maxValue || 1 : 1;

  // Pass 2 — assemble geometry.
  return HOURS.map((h) => {
    const positions: number[] = [];
    const colors: number[] = [];
    for (let ci = 0; ci < n; ci++) {
      const cell = cells[ci];
      if (!cell) continue;
      const t = (values[h * n + ci] ?? 0) / norm;
      const col = heatThreeColor(t);
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
        colors.push(col.r, col.g, col.b, col.r, col.g, col.b, col.r, col.g, col.b);
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
    return geo;
  });
}

/** three's OrbitControls, wrapped for R3F (target follows the tower's mid-height). */
function Orbit({ targetY, autoRotate }: { targetY: number; autoRotate: boolean }) {
  const camera = useThree((s) => s.camera);
  const gl = useThree((s) => s.gl);
  const ref = useRef<OrbitControls | null>(null);

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
    if (controls) {
      controls.target.set(0, targetY, 0);
      controls.update();
    }
  }, [targetY]);

  useFrame(() => {
    const controls = ref.current;
    if (!controls) return;
    controls.autoRotate = autoRotate;
    controls.update();
  });

  return null;
}

/** Faint ground footprint + grid, to anchor orientation under the stack. */
function BasePlate({ extent, show }: { extent: WorldExtent; show: boolean }) {
  if (!show) return null;
  return (
    <group position={[0, -2, 0]}>
      <mesh rotation={[-Math.PI / 2, 0, 0]}>
        <planeGeometry args={[extent.width, extent.height]} />
        <meshBasicMaterial color="#11161f" transparent opacity={0.85} side={THREE.DoubleSide} />
      </mesh>
      <gridHelper args={[Math.max(extent.width, extent.height), 12, '#2a3344', '#1b2230']} />
    </group>
  );
}

function Layers({
  geometries,
  spacing,
  everyN,
  opacity,
  spotlight,
}: {
  geometries: THREE.BufferGeometry[];
  spacing: number;
  everyN: number;
  opacity: number;
  spotlight: Spotlight;
}) {
  return (
    <group>
      {geometries.map((geo, h) => {
        const decimated = h % everyN === 0;
        let op = opacity;
        let visible = decimated;
        if (spotlight.on) {
          if (h === spotlight.hour) {
            op = 1;
          } else {
            op = spotlight.ghostOpacity;
            visible = decimated && spotlight.showGhosts;
          }
        }
        if (!visible) return null;
        return (
          <mesh key={h} geometry={geo} position={[0, h * spacing, 0]}>
            <meshBasicMaterial
              vertexColors
              transparent
              opacity={op}
              side={THREE.DoubleSide}
              depthWrite={op >= 1}
            />
          </mesh>
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

  const [spacing, setSpacing] = useState(2.5);
  const [opacity, setOpacity] = useState(0.5);
  const [everyN, setEveryN] = useState(1);
  const [shadeBy, setShadeBy] = useState<ShadeBy>('composite');
  const [inset, setInset] = useState(0.9);
  const [showBase, setShowBase] = useState(true);
  const [autoRotate, setAutoRotate] = useState(false);
  const [spotOn, setSpotOn] = useState(false);
  const [spotHour, setSpotHour] = useState(13);
  const [showGhosts, setShowGhosts] = useState(true);

  const cells = grid?.cells;

  const geometries = useMemo(() => {
    if (!cells) return [];
    const inputs: ProfileInputs = {
      riskStates,
      zoneContribution,
      zones,
      dayNight,
      journeyParams,
      extent,
      hexSize,
    };
    return buildHourGeometries(cells, inputs, shadeBy, costParams, inset);
  }, [
    cells,
    riskStates,
    zoneContribution,
    zones,
    dayNight,
    journeyParams,
    extent,
    hexSize,
    shadeBy,
    costParams,
    inset,
  ]);

  // Free GPU buffers when the geometry set is rebuilt or the view unmounts.
  useEffect(() => () => geometries.forEach((g) => g.dispose()), [geometries]);

  if (!grid || !cells) return <div className="spike-loading">Building world…</div>;

  const spotlight: Spotlight = { on: spotOn, hour: spotHour, ghostOpacity: 0.04, showGhosts };
  const targetY = (HOURS.length - 1) * spacing * 0.5;

  return (
    <div className="spike-root">
      <Canvas camera={{ position: [62, 48, 80], fov: 45, far: 2000 }}>
        <color attach="background" args={['#0b0e14']} />
        <BasePlate extent={extent} show={showBase} />
        <Layers
          geometries={geometries}
          spacing={spacing}
          everyN={everyN}
          opacity={opacity}
          spotlight={spotlight}
        />
        <Orbit targetY={targetY} autoRotate={autoRotate} />
      </Canvas>

      <a className="spike-back" href="index.html">
        ← Back to map
      </a>

      <div className="spike-panel">
        <h1>3D temporal stack — spike</h1>
        <p className="sub">
          {cells.length} cells × 24 hourly grids. Height = time of day (bottom 00:00 → top 23:00).
        </p>

        <div className="spike-row">
          <label htmlFor="shade">Shade by</label>
          <select
            id="shade"
            value={shadeBy}
            onChange={(e) => setShadeBy(e.target.value as ShadeBy)}
          >
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
          <label htmlFor="everyN">Show every</label>
          <select id="everyN" value={everyN} onChange={(e) => setEveryN(Number(e.target.value))}>
            <option value={1}>every hour</option>
            <option value={2}>every 2nd</option>
            <option value={3}>every 3rd</option>
            <option value={4}>every 4th</option>
            <option value={6}>every 6th</option>
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
              <label htmlFor="ghosts">Keep others faint</label>
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
          <label htmlFor="base">Ground plane</label>
          <input
            id="base"
            type="checkbox"
            checked={showBase}
            onChange={(e) => setShowBase(e.target.checked)}
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
          Seeded scenario: a storm band sweeps E→W 08:00–16:00 (raises <em>cold</em>), and
          day/night shifts <em>animals</em> &amp; <em>humans</em> — so the tower has real temporal
          structure to look through. Drag to orbit; scroll to zoom.
        </p>
      </div>
    </div>
  );
}
