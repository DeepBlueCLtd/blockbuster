import { Polygon, Polyline } from 'react-leaflet';
import type { PathOptions } from 'leaflet';
import type { WorldPoint } from '@domain';
import { cycloneEyeAt, windAt } from '@domain';
import { useBlockbusterStore } from '@/state/store';
import { RISK_COLORS } from '@/ui/theme';
import { worldRingToLatLng } from './projection';

/**
 * Read-only overlay of the cyclone at the current `displayTime`: its outer reach,
 * eyewall and calm eye as rings, plus a coarse field of arrows showing the wind
 * direction (anticlockwise) and strength. Purely visual — it never mutates state
 * and is non-interactive, so it never steals clicks from the hex grid. Hidden
 * when the wind toggle is off or the cyclone is inactive at `displayTime`.
 */

const WIND_COLOR = RISK_COLORS.cold; // tie the wind to the cold it drives

/** A closed ring of `segments` points approximating a circle in world km. */
function worldCircleRing(center: WorldPoint, radiusKm: number, segments = 48): WorldPoint[] {
  const out: WorldPoint[] = [];
  for (let i = 0; i < segments; i++) {
    const a = (i / segments) * Math.PI * 2;
    out.push({ x: center.x + Math.cos(a) * radiusKm, y: center.y + Math.sin(a) * radiusKm });
  }
  return out;
}

/** A 5-point polyline (shaft + arrowhead) centred at `p`, pointing along `dir`. */
function arrowPoints(p: WorldPoint, dir: WorldPoint, len: number): WorldPoint[] {
  const half = len / 2;
  const head = { x: p.x + dir.x * half, y: p.y + dir.y * half };
  const tail = { x: p.x - dir.x * half, y: p.y - dir.y * half };
  const back = { x: head.x - dir.x * len * 0.4, y: head.y - dir.y * len * 0.4 };
  const perp = { x: -dir.y, y: dir.x };
  const wing = len * 0.22;
  return [
    tail,
    head,
    { x: back.x + perp.x * wing, y: back.y + perp.y * wing },
    head,
    { x: back.x - perp.x * wing, y: back.y - perp.y * wing },
  ];
}

export function WindLayer() {
  const cyclone = useBlockbusterStore((s) => s.cyclone);
  const showWind = useBlockbusterStore((s) => s.showWind);
  const displayTime = useBlockbusterStore((s) => s.displayTime);
  const extent = useBlockbusterStore((s) => s.extent);

  if (!showWind || !cyclone) return null;
  const eye = cycloneEyeAt(cyclone, displayTime);
  if (!eye) return null;

  // Coarse sample grid for the arrow field.
  const step = Math.min(6, Math.max(2.5, Math.min(extent.width, extent.height) / 12));
  const arrowLen = step * 0.8;
  const arrows: { points: WorldPoint[]; opacity: number; key: string }[] = [];
  for (let x = step / 2; x < extent.width; x += step) {
    for (let y = step / 2; y < extent.height; y += step) {
      const w = windAt(cyclone, { x, y }, displayTime);
      if (!w || w.strength < 0.08) continue;
      arrows.push({
        points: arrowPoints({ x, y }, w.dir, arrowLen * (0.45 + 0.55 * w.strength)),
        opacity: 0.25 + 0.55 * w.strength,
        key: `${x.toFixed(1)},${y.toFixed(1)}`,
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
        positions={worldRingToLatLng(worldCircleRing(eye, Math.max(0.4, cyclone.eyeRadiusKm), 24))}
        interactive={false}
        pathOptions={eyeFill}
      />
      {arrows.map((a) => (
        <Polyline
          key={a.key}
          positions={worldRingToLatLng(a.points)}
          interactive={false}
          pathOptions={{ color: WIND_COLOR, weight: 2, opacity: a.opacity }}
        />
      ))}
    </>
  );
}
