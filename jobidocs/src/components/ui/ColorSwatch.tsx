import { useRef } from "react";

interface ColorSwatchProps {
  value: string;
  onChange: (color: string) => void;
  label?: string;
}

export function ColorSwatch({ value, onChange, label }: ColorSwatchProps) {
  const inputRef = useRef<HTMLInputElement>(null);

  return (
    <div className="csw-root" onClick={() => inputRef.current?.click()}>
      <div className="csw-preview" style={{ background: value }} />
      {label && <span className="csw-label">{label}</span>}
      <span className="csw-value">{value}</span>
      <input
        ref={inputRef}
        type="color"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="csw-input"
        tabIndex={-1}
      />
    </div>
  );
}
