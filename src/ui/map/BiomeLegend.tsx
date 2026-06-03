import { BIOMES } from '@domain';
import { BIOME_COLORS, BIOME_ICONS, BIOME_LABELS } from '@/ui/theme';
import { useBlockbusterStore } from '@/state/store';

/** Key to the underlying terrain colours; only shown while the base map is on. */
export function BiomeLegend() {
  const showTerrain = useBlockbusterStore((s) => s.showTerrain);
  if (!showTerrain) return null;

  return (
    <div className="map-legend">
      {BIOMES.map((biome) => (
        <span key={biome} className="legend-item">
          <i style={{ background: BIOME_COLORS[biome] }} />
          <b className="legend-glyph">{BIOME_ICONS[biome]}</b>
          {BIOME_LABELS[biome]}
        </span>
      ))}
    </div>
  );
}
