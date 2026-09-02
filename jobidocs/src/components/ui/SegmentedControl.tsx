import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";

interface SegmentedControlProps<T extends string> {
  options: { value: T; label: string }[];
  value: T;
  onChange: (value: T) => void;
}

/**
 * Přepínač s posuvnou pilulkou pod aktivní volbou.
 *
 * POZOR na měření: pilulka je absolutně umístěná a její šířku i posun
 * počítáme z rozměrů tlačítka. Dřív se to změřilo jen při změně hodnoty,
 * takže po změně šířky kontejneru (jiná velikost okna, změna panelu,
 * dodatečné načtení fontu) zůstala pilulka na staré pozici a v původní
 * šířce – měřeno 66 px proti volbě široké 407 px.
 *
 * Protože aktivní popisek je bílý, mimo pilulku pak ležel na světlém
 * pozadí a byl NEVIDITELNÝ. Proto ResizeObserver.
 */
export function SegmentedControl<T extends string>({ options, value, onChange }: SegmentedControlProps<T>) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [pillStyle, setPillStyle] = useState<React.CSSProperties>({});

  const measure = useCallback(() => {
    const container = containerRef.current;
    if (!container) return;
    const idx = options.findIndex((o) => o.value === value);
    const btn = container.querySelectorAll<HTMLButtonElement>(".sc-option")[idx];
    if (!btn) return;
    setPillStyle({ left: btn.offsetLeft, width: btn.offsetWidth });
  }, [options, value]);

  // useLayoutEffect, ať pilulka nesedí jeden snímek na špatném místě
  useLayoutEffect(measure, [measure]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(measure);
    ro.observe(container);
    return () => ro.disconnect();
  }, [measure]);

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
