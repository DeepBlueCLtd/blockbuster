import { Pane, Polygon, Polyline } from 'react-leaflet';
import type { PathOptions } from 'leaflet';
import type { WorldPoint } from '@domain';
import { cycloneEyeAt, windAt, windEffect } from '@domain';
import { useBlockbusterStore } from '@/state/store';
import { COA_HALO_COLOR, RISK_COLORS, WIND_ARROW_COLOR } from '@/ui/theme';
import { worldRingToLatLng } from './projection';

/**
 * Read-only overlay of the cyclone, in two parts so users can see both the wind
 * and what it *does*:
 *
 *  1. **The field** at the current `displayTime` — the eye, its outer reach and
 *     eyewall as rings, plus a coarse grid of arrows pointing the way the wind
 *     blows (anticlockwise), longer/brighter where it is stronger.
 *  2. **The influence on the route** — chevrons along the selected COA, coloured
 *     green where the wind is behind the group (a tailwind: faster, safer) and
 *     red where they head into it (a headwind: slower, riskier), sized by how
 *     strong that head/tail component is at the moment they pass through.
 *
 * Purely visual: non-interactive, never mutates state. Hidden when the wind
 * toggle is off or the cyclone is inactive at `displayTime`.
 */

const WIND_COLOR = RISK_COLORS.cold; // tie the wind to the cold it drives
const TAILWIND_COLOR = '#2e7d32'; // green — the wind helps here
const HEADWIND_COLOR = '#c62828'; // red — the wind fights here

/** A closed ring of `segments` points approximating a circle in world km. */
function worldCircleRing(center: WorldPoint, radiusKm: number, segments = 48): WorldPoint[] {
  const out: WorldPoint[] = [];
  for (let i = 0; i < segments; i++) {
    const a = (i / segments) * Math.PI * 2;
    out.push({ x: center.x + Math.cos(a) * radiusKm, y: center.y + Math.sin(a) * radiusKm });
  }
  return out;
}

function unit(from: WorldPoint, to: WorldPoint): WorldPoint | null {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const len = Math.hypot(dx, dy);
  return len <= 1e-9 ? null : { x: dx / len, y: dy / len };
}

/** A 5-point polyline (shaft + arrowhead) centred at `p`, pointing along `dir`. */
function arrowPoints(p: WorldPoint, dir: WorldPoint, len: number): WorldPoint[] {
  const half = len / 2;
  const head = { x: p.x + dir.x * half, y: p.y + dir.y * half };
  const tail = { x: p.x - dir.x * half, y: p.y - dir.y * half };
  const back = { x: head.x - dir.x * len * 0.45, y: head.y - dir.y * len * 0.45 };
  const perp = { x: -dir.y, y: dir.x };
  const wing = len * 0.36;
  return [
    tail,
    head,
    { x: back.x + perp.x * wing, y: back.y + perp.y * wing },
    head,
    { x: back.x - perp.x * wing, y: back.y - perp.y * wing },
  ];
}

/** A chevron "›" centred at `p`, its tip pointing along `dir`. */
function chevronPoints(p: WorldPoint, dir: WorldPoint, size: number): WorldPoint[] {
  const tip = { x: p.x + dir.x * size * 0.5, y: p.y + dir.y * size * 0.5 };
  const back = { x: p.x - dir.x * size * 0.5, y: p.y - dir.y * size * 0.5 };
  const perp = { x: -dir.y, y: dir.x };
  return [
    { x: back.x + perp.x * size * 0.6, y: back.y + perp.y * size * 0.6 },
    tip,
    { x: back.x - perp.x * size * 0.6, y: back.y - perp.y * size * 0.6 },
  ];
}

export function WindLayer() {
  const cyclone = useBlockbusterStore((s) => s.cyclone);
  const showWind = useBlockbusterStore((s) => s.showWind);
  const showRoutes = useBlockbusterStore((s) => s.showRoutes);
  const displayTime = useBlockbusterStore((s) => s.displayTime);
  const extent = useBlockbusterStore((s) => s.extent);
  const grid = useBlockbusterStore((s) => s.grid);
  const plan = useBlockbusterStore((s) => s.plan);
  const selectedCoaId = useBlockbusterStore((s) => s.selectedCoaId);

  if (!showWind || !cyclone) return null;
  const eye = cycloneEyeAt(cyclone, displayTime);
  if (!eye) return null;

  // 1) The wind field: a grid of bold direction arrows at the display time.
  const step = Math.min(5, Math.max(2.6, Math.min(extent.width, extent.height) / 10));
  const arrowLen = step * 1.05;
  const arrows: { points: WorldPoint[]; opacity: number; key: string }[] = [];
  for (let x = step / 2; x < extent.width; x += step) {
    for (let y = step / 2; y < extent.height; y += step) {
      const w = windAt(cyclone, { x, y }, displayTime);
      if (!w || w.strength < 0.06) continue;
      arrows.push({
        points: arrowPoints({ x, y }, w.dir, arrowLen * (0.6 + 0.4 * w.strength)),
        opacity: 0.8 + 0.2 * w.strength,
        key: `${x.toFixed(1)},${y.toFixed(1)}`,
      });
    }
  }

  // 2) The route influence: head/tail chevrons along the selected (else best) COA.
  // Each segment is judged by the wind the group actually meets when it gets there
  // (the step's own arrival time), so this shows the journey's real experience.
  const coa = plan?.coas.find((c) => c.id === selectedCoaId) ?? plan?.coas[0];
  const chevrons: { points: WorldPoint[]; color: string; opacity: number; key: string }[] = [];
  if (showRoutes && grid && coa) {
    for (let i = 1; i < coa.path.length; i++) {
      const from = grid.get(coa.path[i - 1]!)?.center;
      const to = grid.get(coa.path[i]!)?.center;
      const arrivalMin = coa.steps[i]?.arrivalTimeMinutes;
      if (!from || !to || arrivalMin === undefined) continue;
      const dir = unit(from, to);
      if (!dir) continue;
      const w = windAt(cyclone, to, arrivalMin);
      const influence = windEffect(dir, w).speedFactor - 1; // >0 tailwind, <0 headwind
      if (Math.abs(influence) < 0.02) continue;
      const mid = { x: (from.x + to.x) / 2, y: (from.y + to.y) / 2 };
      chevrons.push({
        points: chevronPoints(mid, dir, Math.min(extent.width, extent.height) / 18),
        color: influence > 0 ? TAILWIND_COLOR : HEADWIND_COLOR,
        opacity: Math.min(0.95, 0.45 + Math.abs(influence) * 1.4),
        key: `chev-${i}`,
      });
    }
  }

  const reach: PathOptions = {
    color: WIND_COLOR,
    weight: 1.5,
    opacity: 0.6,
    fillColor: WIND_COLOR,
    fillOpacity: 0.06,
    dashArray: '6 6',
  };
  const eyewall: PathOptions = { color: WIND_COLOR, weight: 1.5, opacity: 0.5, fill: false };
  const eyeFill: PathOptions = {
    color: WIND_COLOR,
    weight: 1,
    opacity: 0.7,
    fillColor: '#e6f7ff',
    fillOpacity: 0.5,
  };

  return (
    <>
      {/* The whole field sits in its own pane, above the terrain and hex shading,
          so the arrows are never washed out by what's beneath them. */}
      <Pane name="wind-field" style={{ zIndex: 420 }}>
        <Polygon
          positions={worldRingToLatLng(worldCircleRing(eye, cyclone.outerRadiusKm))}
          interactive={false}
          pathOptions={reach}
        />
        <Polyline
          positions={worldRingToLatLng([
            ...worldCircleRing(eye, cyclone.maxWindRadiusKm),
            worldCircleRing(eye, cyclone.maxWindRadiusKm)[0]!,
          ])}
          interactive={false}
          pathOptions={eyewall}
        />
        <Polygon
          positions={worldRingToLatLng(
            worldCircleRing(eye, Math.max(0.4, cyclone.eyeRadiusKm), 24),
          )}
          interactive={false}
          pathOptions={eyeFill}
        />
        {/* White casings first, so the bold arrow cores read on any terrain. */}
        {arrows.map((a) => (
          <Polyline
            key={`halo-${a.key}`}
            positions={worldRingToLatLng(a.points)}
            interactive={false}
            pathOptions={{
              color: COA_HALO_COLOR,
              weight: 6,
              opacity: Math.min(0.85, a.opacity),
              lineCap: 'round',
              lineJoin: 'round',
            }}
          />
        ))}
        {arrows.map((a) => (
          <Polyline
            key={a.key}
            positions={worldRingToLatLng(a.points)}
            interactive={false}
            pathOptions={{
              color: WIND_ARROW_COLOR,
              weight: 3.5,
              opacity: a.opacity,
              lineCap: 'round',
              lineJoin: 'round',
            }}
          />
        ))}
      </Pane>
      {/* Route chevrons sit in the topmost vector pane so they read over the COA line. */}
      <Pane name="wind-influence" style={{ zIndex: 440 }}>
        {chevrons.map((c) => (
          <Polyline
            key={c.key}
            positions={worldRingToLatLng(c.points)}
            interactive={false}
            pathOptions={{ color: c.color, weight: 5, opacity: c.opacity, lineCap: 'round' }}
          />
        ))}
      </Pane>
    </>
  );
}
