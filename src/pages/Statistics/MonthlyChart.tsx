import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { Button, Segmented } from "../../components/ui";
import {
  celeCislo,
  formatCurrencyCompact,
  formatCurrencyRounded,
  monthLabelLong,
  monthLabelShort,
  zakazky,
} from "./format";

export type MonthStat = {
  year: number;
  monthIndex: number;
  count: number;
  revenue: number;
};

type Metric = "count" | "revenue";
type Range = "12" | "all";

const CHART_HEIGHT = 240;
const PAD_TOP = 26; // místo pro popisek hodnoty nad nejvyšším sloupcem
const PAD_BOTTOM = 30; // popisky měsíců
const MIN_SLOT = 44; // nejužší sloupec včetně mezery – pod tím se posouvá vodorovně
const AXIS_WIDTH = 56; // levá osa, když se popisky nad sloupce nevejdou
const LABEL_FONT = 11; // = --text-xs; SVG atribut neumí var(), geometrie níže s touto hodnotou počítá

/**
 * Sloupcový graf po měsících.
 *
 * Kreslí se ručně v SVG – knihovna pro jeden graf nestojí za 100 kB.
 * Šířka se měří ResizeObserverem, aby písmo zůstalo v pixelech (viewBox by
 * ho škáloval a popisky by na úzké obrazovce klesly pod čitelnou velikost).
 * Když je měsíců víc, než se vejde, graf se posouvá vodorovně.
 */
export function MonthlyChart({
  months,
  selected,
  onSelect,
}: {
  /** Chronologicky, včetně prázdných měsíců. */
  months: MonthStat[];
  selected: { year: number; monthIndex: number } | null;
  onSelect: (year: number, monthIndex: number) => void;
}) {
  const [metric, setMetric] = useState<Metric>("count");
  const [range, setRange] = useState<Range>("12");
  const [showTable, setShowTable] = useState(false);
  const [hover, setHover] = useState<number | null>(null);
  const [containerWidth, setContainerWidth] = useState(0);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = containerRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    // ResizeObserver zavolá callback hned po observe(), takže první měření
    // nepotřebuje setState přímo v efektu.
    const ro = new ResizeObserver((entries) => {
      const w = entries[0]?.contentRect.width ?? 0;
      setContainerWidth((prev) => (Math.abs(prev - w) < 1 ? prev : w));
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const visible = useMemo(
    () => (range === "12" && months.length > 12 ? months.slice(-12) : months),
    [months, range]
  );

  const valueOf = (m: MonthStat) => (metric === "count" ? m.count : m.revenue);
  const formatShort = (v: number) => (metric === "count" ? celeCislo(v) : formatCurrencyCompact(v));

  const max = Math.max(1, ...visible.map(valueOf));
  const n = visible.length;

  // Geometrie
  const availableWidth = Math.max(0, containerWidth);
  const slot = n > 0 ? Math.max(MIN_SLOT, Math.floor(availableWidth / n)) : MIN_SLOT;
  const longestLabel = Math.max(0, ...visible.map((m) => formatShort(valueOf(m)).length));
  // ~6,5 px na znak při 11 px písmu + rezerva; když se nevejde, přesuneme hodnoty na osu.
  const labelsFit = slot >= longestLabel * 6.5 + 8;
  const axisWidth = labelsFit ? 0 : AXIS_WIDTH;
  const plotSlot = n > 0 ? Math.max(MIN_SLOT, Math.floor((availableWidth - axisWidth) / n)) : MIN_SLOT;
  const svgWidth = axisWidth + plotSlot * n;
  const barWidth = Math.min(40, Math.max(12, Math.round(plotSlot * 0.62)));
  const plotHeight = CHART_HEIGHT - PAD_TOP - PAD_BOTTOM;
  const baselineY = PAD_TOP + plotHeight;

  const isSelected = (m: MonthStat) => !!selected && selected.year === m.year && selected.monthIndex === m.monthIndex;
  const selectedOutsideRange =
    !!selected && range === "12" && months.length > 12 && !visible.some(isSelected) && months.some(isSelected);

  const yTicks = labelsFit ? [] : [0, 0.5, 1].map((f) => ({ f, value: max * f }));

  if (months.length === 0) {
    return <div style={{ color: "var(--muted)", fontSize: "var(--text-base)" }}>Žádná data pro vybrané období.</div>;
  }

  const hovered = hover !== null ? visible[hover] : null;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-3)" }}>
      {/* Ovládání grafu */}
      <div style={{ display: "flex", alignItems: "center", gap: "var(--space-2)", flexWrap: "wrap" }}>
        <Segmented<Metric>
          ariaLabel="Veličina grafu"
          size="sm"
          value={metric}
          onChange={setMetric}
          options={[
            { value: "count", label: "Počet zakázek" },
            { value: "revenue", label: "Příjem" },
          ]}
        />
        {months.length > 12 && (
          <Segmented<Range>
            ariaLabel="Rozsah grafu"
            size="sm"
            value={range}
            onChange={setRange}
            options={[
              { value: "12", label: "Posledních 12 měsíců" },
              { value: "all", label: `Vše (${months.length})` },
            ]}
          />
        )}
        <span style={{ marginLeft: "auto" }}>
          <Button variant="ghost" size="sm" onClick={() => setShowTable((v) => !v)} aria-expanded={showTable}>
            {showTable ? "Skrýt tabulku" : "Zobrazit tabulku"}
          </Button>
        </span>
      </div>

      {selectedOutsideRange && (
        <div style={{ fontSize: "var(--text-sm)", color: "var(--muted)" }}>
          Vybraný měsíc leží mimo posledních 12 měsíců – přepněte na „Vše“, chcete-li ho v grafu vidět.
        </div>
      )}

      {/* Graf */}
      <div ref={containerRef} style={{ width: "100%", overflowX: "auto", overflowY: "hidden", position: "relative" }}>
        <div style={{ position: "relative", width: svgWidth || "100%" }}>
          <svg
            width={svgWidth || "100%"}
            height={CHART_HEIGHT}
            viewBox={svgWidth ? `0 0 ${svgWidth} ${CHART_HEIGHT}` : undefined}
            role="img"
            aria-label={`${metric === "count" ? "Počet zakázek" : "Příjem"} po měsících`}
            style={{ display: "block", fontFamily: "inherit", fontVariantNumeric: "tabular-nums" }}
            onMouseLeave={() => setHover(null)}
          >
            {/* Osa Y – jen když se hodnoty nevejdou nad sloupce */}
            {yTicks.map((t) => {
              const y = baselineY - t.f * plotHeight;
              return (
                <g key={t.f}>
                  <line x1={axisWidth} x2={svgWidth} y1={y} y2={y} stroke="var(--border)" strokeWidth={1} />
                  <text
                    x={axisWidth - 8}
                    y={y}
                    textAnchor="end"
                    dominantBaseline="middle"
                    fontSize={LABEL_FONT}
                    fill="var(--muted)"
                  >
                    {formatShort(t.value)}
                  </text>
                </g>
              );
            })}
            {/* Základna */}
            <line x1={axisWidth} x2={svgWidth} y1={baselineY} y2={baselineY} stroke="var(--border)" strokeWidth={1} />

            {visible.map((m, i) => {
              const v = valueOf(m);
              const h = v > 0 ? Math.max(3, Math.round((v / max) * plotHeight)) : 0;
              const cx = axisWidth + i * plotSlot + plotSlot / 2;
              const x = cx - barWidth / 2;
              const y = baselineY - h;
              const sel = isSelected(m);
              const dim = !!selected && !sel && months.some(isSelected);
              const isHover = hover === i;
              const label = monthLabelLong(m.year, m.monthIndex);
              return (
                <g
                  key={`${m.year}-${m.monthIndex}`}
                  role="button"
                  tabIndex={0}
                  aria-pressed={sel}
                  aria-label={`${label}: ${zakazky(m.count)}, ${formatCurrencyRounded(m.revenue)}. Kliknutím zúžíte výběr.`}
                  style={{ cursor: "pointer", outline: "none" }}
                  onClick={() => onSelect(m.year, m.monthIndex)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      onSelect(m.year, m.monthIndex);
                    }
                  }}
                  onMouseEnter={() => setHover(i)}
                  onFocus={() => setHover(i)}
                  onBlur={() => setHover(null)}
                >
                  {/* Neviditelná plocha na celý slot – snazší míření. */}
                  <rect x={axisWidth + i * plotSlot} y={PAD_TOP - 4} width={plotSlot} height={plotHeight + PAD_BOTTOM + 4} fill="transparent" />
                  {(isHover || sel) && (
                    <rect
                      x={axisWidth + i * plotSlot + 2}
                      y={PAD_TOP - 4}
                      width={plotSlot - 4}
                      height={plotHeight + 4}
                      rx={6}
                      fill="var(--accent-soft)"
                      opacity={sel ? 0.9 : 0.5}
                    />
                  )}
                  {h > 0 ? (
                    <rect
                      x={x}
                      y={y}
                      width={barWidth}
                      height={h}
                      rx={Math.min(6, barWidth / 3)}
                      fill="var(--accent)"
                      opacity={sel ? 1 : dim ? 0.35 : isHover ? 1 : 0.8}
                      style={{ transition: "opacity 0.15s ease" }}
                    />
                  ) : (
                    <rect x={x} y={baselineY - 2} width={barWidth} height={2} fill="var(--border)" />
                  )}
                  {labelsFit && v > 0 && (
                    <text
                      x={cx}
                      y={y - 6}
                      textAnchor="middle"
                      fontSize={LABEL_FONT}
                      fontWeight={sel ? 800 : 600}
                      fill={sel ? "var(--text)" : "var(--muted)"}
                    >
                      {formatShort(v)}
                    </text>
                  )}
                  <text
                    x={cx}
                    y={baselineY + 18}
                    textAnchor="middle"
                    fontSize={LABEL_FONT}
                    fontWeight={sel ? 800 : 500}
                    fill={sel ? "var(--text)" : "var(--muted)"}
                  >
                    {monthLabelShort(m.year, m.monthIndex)}
                  </text>
                  {sel && <rect x={x} y={baselineY - 2} width={barWidth} height={2} fill="var(--accent)" />}
                </g>
              );
            })}
          </svg>

          {/* Tooltip – HTML nad SVG, posouvá se spolu s grafem */}
          {hovered && hover !== null && (
            <div
              role="tooltip"
              style={{
                position: "absolute",
                left: Math.min(
                  Math.max(0, axisWidth + hover * plotSlot + plotSlot / 2 - 90),
                  Math.max(0, svgWidth - 180)
                ),
                top: Math.max(0, baselineY - Math.round((valueOf(hovered) / max) * plotHeight) - 62),
                width: 180,
                pointerEvents: "none",
                background: "var(--panel)",
                border: "1px solid var(--border)",
                borderRadius: "var(--radius-xs)",
                boxShadow: "var(--shadow-soft)",
                padding: "var(--space-2) var(--space-3)",
                fontSize: "var(--text-sm)",
                color: "var(--text)",
                fontVariantNumeric: "tabular-nums",
                zIndex: 2,
              }}
            >
              <div style={{ fontWeight: 700, marginBottom: 2, textTransform: "capitalize" }}>
                {monthLabelLong(hovered.year, hovered.monthIndex)}
              </div>
              <div style={{ display: "flex", justifyContent: "space-between", gap: "var(--space-2)" }}>
                <span style={{ color: "var(--muted)" }}>Zakázky</span>
                <span>{celeCislo(hovered.count)}</span>
              </div>
              <div style={{ display: "flex", justifyContent: "space-between", gap: "var(--space-2)" }}>
                <span style={{ color: "var(--muted)" }}>Příjem</span>
                <span>{formatCurrencyRounded(hovered.revenue)}</span>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Tabulka pod grafem */}
      {showTable && (
        <div style={{ overflowX: "auto" }}>
          <table
            style={{
              width: "100%",
              borderCollapse: "collapse",
              fontSize: "var(--text-base)",
              fontVariantNumeric: "tabular-nums",
            }}
          >
            <thead>
              <tr style={{ borderBottom: "1px solid var(--border)" }}>
                <th style={thStyle("left")}>Měsíc</th>
                <th style={thStyle("right")}>Zakázky</th>
                <th style={thStyle("right")}>Příjem</th>
                <th style={thStyle("right")}>Průměr na zakázku</th>
              </tr>
            </thead>
            <tbody>
              {[...visible].reverse().map((m) => {
                const sel = isSelected(m);
                return (
                  <tr
                    key={`${m.year}-${m.monthIndex}`}
                    style={{
                      borderBottom: "1px solid var(--border)",
                      background: sel ? "var(--accent-soft)" : undefined,
                      fontWeight: sel ? 700 : 400,
                    }}
                  >
                    <td style={{ ...tdStyle, textAlign: "left", textTransform: "capitalize" }}>
                      {monthLabelLong(m.year, m.monthIndex)}
                    </td>
                    <td style={{ ...tdStyle, textAlign: "right" }}>{celeCislo(m.count)}</td>
                    <td style={{ ...tdStyle, textAlign: "right" }}>{formatCurrencyRounded(m.revenue)}</td>
                    <td style={{ ...tdStyle, textAlign: "right", color: "var(--muted)" }}>
                      {m.count > 0 ? formatCurrencyRounded(m.revenue / m.count) : "—"}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function thStyle(align: "left" | "right"): CSSProperties {
  return {
    padding: "var(--space-2) var(--space-3)",
    textAlign: align,
    color: "var(--muted)",
    fontWeight: 600,
    fontSize: "var(--text-sm)",
    whiteSpace: "nowrap",
  };
}

const tdStyle: CSSProperties = {
  padding: "var(--space-2) var(--space-3)",
  color: "var(--text)",
  whiteSpace: "nowrap",
};
