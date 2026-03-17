import React, { useEffect, useRef, useState } from "react";

interface SegmentedControlProps<T extends string> {
  options: { value: T; label: string }[];
  value: T;
  onChange: (value: T) => void;
}

export function SegmentedControl<T extends string>({ options, value, onChange }: SegmentedControlProps<T>) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [pillStyle, setPillStyle] = useState<React.CSSProperties>({});

  useEffect(() => {
    if (!containerRef.current) return;
    const idx = options.findIndex((o) => o.value === value);
    const buttons = containerRef.current.querySelectorAll<HTMLButtonElement>(".sc-option");
    const btn = buttons[idx];
    if (!btn) return;
    setPillStyle({
      left: btn.offsetLeft,
      width: btn.offsetWidth,
    });
  }, [value, options]);

  return (
    <div ref={containerRef} className="sc-root">
      <div className="sc-pill" style={pillStyle} />
      {options.map((opt) => (
        <button
          key={opt.value}
          type="button"
          className={`sc-option ${opt.value === value ? "active" : ""}`}
          onClick={() => onChange(opt.value)}
        >
          {opt.label}
        </button>
      ))}
    </div>
  );
}
