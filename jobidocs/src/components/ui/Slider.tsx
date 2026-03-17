import React from "react";

interface SliderProps {
  value: number;
  min: number;
  max: number;
  onChange: (value: number) => void;
  label?: string;
  unit?: string;
  step?: number;
}

export function Slider({ value, min, max, onChange, label, unit, step = 1 }: SliderProps) {
  const pct = ((value - min) / (max - min)) * 100;

  return (
    <div className="sld-root">
      {label && <span className="sld-label">{label}</span>}
      <div className="sld-track-wrap">
        <input
          type="range"
          className="sld-input"
          min={min}
          max={max}
          step={step}
          value={value}
          onChange={(e) => onChange(Number(e.target.value))}
          style={{ "--sld-pct": `${pct}%` } as React.CSSProperties}
        />
      </div>
      <span className="sld-value">{value}{unit ?? ""}</span>
    </div>
  );
}
