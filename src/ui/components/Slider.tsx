interface SliderProps {
  label: string;
  value: number;
  onChange: (value: number) => void;
  min?: number;
  max?: number;
  step?: number;
  hint?: string;
}

export function Slider({ label, value, onChange, min = 0, max = 1, step = 0.05, hint }: SliderProps) {
  return (
    <label className="slider">
      <span className="slider-row">
        <span className="slider-label">{label}</span>
        <span className="slider-value">{value.toFixed(2)}</span>
      </span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(event) => onChange(Number(event.target.value))}
      />
      {hint ? <span className="slider-hint">{hint}</span> : null}
    </label>
  );
}
