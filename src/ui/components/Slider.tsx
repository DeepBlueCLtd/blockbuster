interface SliderProps {
  label: string;
  value: number;
  onChange: (value: number) => void;
  min?: number;
  max?: number;
  step?: number;
  hint?: string;
  /** Accent colour: shown as a swatch by the label and used to tint the track. */
  color?: string;
  /** Layout. Vertical stacks value → track → label and is used in the COA appetite row. */
  orientation?: 'horizontal' | 'vertical';
}

export function Slider({
  label,
  value,
  onChange,
  min = 0,
  max = 1,
  step = 0.05,
  hint,
  color,
  orientation = 'horizontal',
}: SliderProps) {
  const swatch = color ? (
    <i className="slider-swatch" style={{ background: color }} aria-hidden="true" />
  ) : null;

  const input = (
    <input
      type="range"
      min={min}
      max={max}
      step={step}
      value={value}
      onChange={(event) => onChange(Number(event.target.value))}
      style={color ? { accentColor: color } : undefined}
    />
  );

  if (orientation === 'vertical') {
    return (
      <label className="slider slider-vertical">
        <span className="slider-value">{value.toFixed(2)}</span>
        {input}
        <span className="slider-label">
          {swatch}
          {label}
        </span>
        {hint ? <span className="slider-hint">{hint}</span> : null}
      </label>
    );
  }

  return (
    <label className="slider">
      <span className="slider-row">
        <span className="slider-label">
          {swatch}
          {label}
        </span>
        <span className="slider-value">{value.toFixed(2)}</span>
      </span>
      {input}
      {hint ? <span className="slider-hint">{hint}</span> : null}
    </label>
  );
}
