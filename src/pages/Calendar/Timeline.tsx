import { useEffect, useMemo, useRef, useState, type MouseEvent } from "react";
import { createPortal } from "react-dom";
import { computeTimelineRange, formatFull, formatTime, isOverdue, type CalendarItem, type TimelineView } from "./model";

/**
 * Časová osa (Gantt).
 *
 * Pruh začíná vytvořením zakázky a končí předpokládaným termínem; když
 * termín chybí, pruh se za „teď“ vytrácí – to říká legenda nad osou,
 * dřív to musel člověk uhodnout. Zakázky po termínu mají červený rámeček.
 */

type Bar = {
  item: CalendarItem;
  start: Date;
  end: Date;
  hasUnknownEnd: boolean;
  overdue: boolean;
};

type Props = {
  /** Položky už profiltrované podle statusů. */
  items: CalendarItem[];
  view: TimelineView;
  baseDate: Date;
  now: Date;
  isNarrow: boolean;
  hasStatusFilter: boolean;
  onOpen: (item: CalendarItem) => void;
};

const DAY_MS = 86_400_000;

export function Timeline({ items, view, baseDate, now, isNarrow, hasStatusFilter, onOpen }: Props) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [hovered, setHovered] = useState<{ bar: Bar; x: number; y: number } | null>(null);

  const { rangeStart, rangeEnd } = useMemo(() => computeTimelineRange(view, baseDate), [view, baseDate]);

  const bars = useMemo((): Bar[] => {
    const nowMs = now.getTime();
    return items.map((item) => {
      const start = item.createdAt;
      let end: Date;
      let hasUnknownEnd = false;
      if (item.isFinal && item.completedAt) end = item.completedAt;
      else if (item.expectedAt) end = item.expectedAt;
      else {
        end = new Date(Math.max(start.getTime(), nowMs) + DAY_MS);
        hasUnknownEnd = true;
      }
      return { item, start, end, hasUnknownEnd, overdue: isOverdue(item, now) };
    });
  }, [items, now]);

  const visibleBars = useMemo(() => {
    const s = rangeStart.getTime();
    const e = rangeEnd.getTime();
    return bars.filter((b) => b.end.getTime() >= s && b.start.getTime() <= e);
  }, [bars, rangeStart, rangeEnd]);

  /*
   * Kolik místa zbývá časové ose po odečtení sloupce se zakázkou.
   * Měří se skutečný posuvný rám, ne okno – aplikace má na širokém displeji
   * ještě boční lištu a odsazení obsahu, takže by okno lhalo.
   */
  const [viewportW, setViewportW] = useState(0);
  useEffect(() => {
    const el = scrollRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(([entry]) => setViewportW(entry.contentRect.width));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Na telefonu ukrajoval 180px sloupec polovinu displeje.
  const leftLabelWidth = isNarrow ? 96 : 180;
  const narrowTimelineSpace = Math.max(0, viewportW - leftLabelWidth - 1);
  const totalMs = rangeEnd.getTime() - rangeStart.getTime();

  /*
   * Šířka časové osy. Týden se na telefonu vejde přesně na šířku – je to
   * nejčastější pohled a posouvat kvůli němu do strany nemá smysl. Den
   * (24 hodin) a měsíc (31 dní) se do 250 px vtěsnat nedají, tam se
   * posouvat musí.
   */
  const { timelineWidth, columnWidth } = useMemo(() => {
    if (view === "day") {
      const cw = isNarrow ? 44 : 60;
      return { timelineWidth: 24 * cw, columnWidth: cw };
    }
    if (view === "week") {
      const cw = isNarrow ? Math.max(34, Math.floor(narrowTimelineSpace / 7)) : 120;
      return { timelineWidth: 7 * cw, columnWidth: cw };
    }
    const daysInMonth = new Date(baseDate.getFullYear(), baseDate.getMonth() + 1, 0).getDate();
    const cw = isNarrow ? 26 : 36;
    return { timelineWidth: daysInMonth * cw, columnWidth: cw };
  }, [view, baseDate, isNarrow, narrowTimelineSpace]);

  const nowPositionPx =
    now >= rangeStart && now <= rangeEnd ? ((now.getTime() - rangeStart.getTime()) / totalMs) * timelineWidth : null;

  const timeHeaderCells = useMemo(() => {
    if (view === "day") {
      return Array.from({ length: 24 }, (_, i) => ({ label: `${String(i).padStart(2, "0")}:00`, left: i * columnWidth }));
    }
    if (view === "week") {
      return Array.from({ length: 7 }, (_, i) => {
        const d = new Date(rangeStart);
        d.setDate(d.getDate() + i);
        return {
          // Do úzkého sloupce se „po 31.“ nevejde – zbyde samotné číslo dne.
          label: isNarrow ? String(d.getDate()) : d.toLocaleDateString("cs-CZ", { weekday: "short", day: "numeric" }),
          left: i * columnWidth,
        };
      });
    }
    const daysInMonth = new Date(baseDate.getFullYear(), baseDate.getMonth() + 1, 0).getDate();
    return Array.from({ length: daysInMonth }, (_, i) => ({ label: String(i + 1), left: i * columnWidth }));
  }, [view, rangeStart, baseDate, columnWidth, isNarrow]);

  // Měsíc má nejvíc řádků na obrazovce – hustší rozteč ušetří posouvání.
  const rowHeight = view === "month" ? 28 : 36;
  const barHeight = view === "month" ? 20 : 24;
  const headerHeight = 44;

  return (
    <div style={{ display: "flex", flexDirection: "column", flex: 1, minHeight: 0 }}>
      {/* Legenda */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          flexWrap: "wrap",
          gap: "var(--space-1) var(--space-4)",
          padding: isNarrow ? "6px 12px" : "6px 20px",
          borderBottom: "1px solid var(--border)",
          background: "var(--panel)",
          fontSize: "var(--text-xs)",
          color: "var(--muted)",
        }}
      >
        <LegendItem swatch={<span style={{ width: 22, height: 8, borderRadius: 2, background: "var(--accent)", display: "inline-block" }} />}>
          Plný pruh = do termínu
        </LegendItem>
        <LegendItem
          swatch={
            <span
              style={{
                width: 22,
                height: 8,
                borderRadius: 2,
                display: "inline-block",
                background: "linear-gradient(to right, var(--accent), transparent)",
              }}
            />
          }
        >
          Vytrácející se = bez termínu
        </LegendItem>
        <LegendItem swatch={<span style={{ width: 22, height: 8, borderRadius: 2, boxSizing: "border-box", border: "2px solid var(--danger)", display: "inline-block" }} />}>
          Červený rámeček = po termínu
        </LegendItem>
        <LegendItem swatch={<span style={{ width: 2, height: 12, background: "var(--danger)", display: "inline-block" }} />}>
          Červená čára = teď
        </LegendItem>
      </div>

      {/* Gantt */}
      <div ref={scrollRef} style={{ flex: 1, overflow: "auto", minHeight: 0 }}>
        <div style={{ minWidth: "max-content", position: "relative" }}>
          {/* Hlavička – hodiny (den) / dny (týden, měsíc) */}
          <div
            style={{
              height: headerHeight,
              display: "flex",
              borderBottom: "1px solid var(--border)",
              background: "var(--panel-2)",
              position: "sticky",
              top: 0,
              zIndex: 2,
            }}
          >
            <div
              style={{
                width: leftLabelWidth,
                flexShrink: 0,
                display: "flex",
                alignItems: "center",
                paddingLeft: 12,
                fontWeight: 700,
                fontSize: "var(--text-xs)",
                color: "var(--muted)",
                textTransform: "uppercase",
                letterSpacing: "0.5px",
              }}
            >
              Zakázka
            </div>
            <div style={{ width: timelineWidth, flexShrink: 0, position: "relative", borderLeft: "1px solid var(--border)" }}>
              {timeHeaderCells.map((cell, i) => (
                <div
                  key={i}
                  style={{
                    position: "absolute",
                    left: cell.left,
                    width: columnWidth - 1,
                    top: 0,
                    bottom: 0,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    fontSize: "var(--text-xs)",
                    fontWeight: 600,
                    color: "var(--muted)",
                    borderRight: "1px solid var(--border)",
                  }}
                >
                  {cell.label}
                </div>
              ))}
            </div>
          </div>

          {/* Červená linka „teď“ přes hlavičku i řádky */}
          {nowPositionPx !== null && nowPositionPx >= 0 && nowPositionPx <= timelineWidth && (
            <div
              style={{
                position: "absolute",
                left: leftLabelWidth + nowPositionPx - 1,
                top: 0,
                width: 2,
                height: headerHeight + visibleBars.length * rowHeight,
                background: "var(--danger)",
                zIndex: 3,
                boxShadow: "0 0 8px rgba(239,68,68,0.6)",
                pointerEvents: "none",
              }}
              title={`Teď: ${view === "day" ? formatTime(now) : now.toLocaleDateString("cs-CZ", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}`}
            />
          )}

          {visibleBars.length === 0 ? (
            <div style={{ padding: 48, textAlign: "center", color: "var(--muted)", fontSize: "var(--text-base)" }}>
              Žádné zakázky ani reklamace v tomto období.
              {hasStatusFilter && " Zkuste změnit filtr statusů."}
            </div>
          ) : (
            visibleBars.map((bar, idx) => {
              const { item } = bar;
              const rangeStartMs = rangeStart.getTime();
              const leftPx = Math.max(0, ((bar.start.getTime() - rangeStartMs) / totalMs) * timelineWidth);
              const rightPx = Math.min(timelineWidth, ((bar.end.getTime() - rangeStartMs) / totalMs) * timelineWidth);
              const widthPx = Math.max(4, rightPx - leftPx);
              const color = item.statusBg || "var(--accent)";
              const nowInBarPx = nowPositionPx !== null ? nowPositionPx - leftPx : null;
              const barBg =
                bar.hasUnknownEnd && nowInBarPx !== null && nowInBarPx > 0 && nowInBarPx < widthPx
                  ? (() => {
                      const fadeLen = widthPx - nowInBarPx;
                      const mid = nowInBarPx + fadeLen * 0.4;
                      const soft = nowInBarPx + fadeLen * 0.75;
                      return `linear-gradient(to right, ${color} 0px, ${color} ${nowInBarPx}px, color-mix(in srgb, ${color} 60%, transparent) ${mid}px, color-mix(in srgb, ${color} 20%, transparent) ${soft}px, transparent ${widthPx}px)`;
                    })()
                  : color;
              // Do širšího pruhu se vejde i zákazník – ušetří najíždění myší.
              const barText = widthPx > 160 ? `${item.deviceLabel} · ${item.customerName}` : item.deviceLabel;
              const restShadow = bar.overdue ? "inset 0 0 0 2px var(--danger), 0 1px 3px rgba(0,0,0,0.15)" : "0 1px 3px rgba(0,0,0,0.15)";
              const hoverShadow = bar.overdue ? "inset 0 0 0 2px var(--danger), 0 2px 8px rgba(0,0,0,0.25)" : "0 2px 8px rgba(0,0,0,0.25)";

              const onEnter = (e: MouseEvent<HTMLButtonElement>) => {
                setHovered({ bar, x: e.clientX, y: e.clientY });
                e.currentTarget.style.boxShadow = hoverShadow;
                e.currentTarget.style.transform = "scaleY(1.05)";
              };
              const onMove = (e: MouseEvent<HTMLButtonElement>) => {
                setHovered((prev) => (prev ? { ...prev, x: e.clientX, y: e.clientY } : null));
              };
              const onLeave = (e: MouseEvent<HTMLButtonElement>) => {
                setHovered(null);
                e.currentTarget.style.boxShadow = restShadow;
                e.currentTarget.style.transform = "scaleY(1)";
              };

              return (
                <div
                  key={`${item.type}-${item.id}`}
                  style={{
                    height: rowHeight,
                    display: "flex",
                    alignItems: "center",
                    borderBottom: "1px solid var(--border)",
                    background: idx % 2 === 0 ? "var(--bg)" : "var(--panel)",
                  }}
                >
                  <div style={{ width: leftLabelWidth, flexShrink: 0, paddingLeft: 12, display: "flex", alignItems: "center", gap: 6, minWidth: 0 }}>
                    <span
                      style={{
                        fontWeight: 800,
                        fontSize: "var(--text-xs)",
                        color: bar.overdue ? "var(--danger-text)" : "var(--text)",
                        fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
                        whiteSpace: "nowrap",
                      }}
                    >
                      {item.code}
                    </span>
                    {item.isClaim && (
                      <span
                        title="Reklamace"
                        style={{
                          fontSize: "var(--text-xs)",
                          fontWeight: 800,
                          padding: "0 5px",
                          borderRadius: "var(--radius-2xs)",
                          background: "var(--info-soft)",
                          color: "var(--info-text)",
                          lineHeight: "16px",
                        }}
                      >
                        R
                      </span>
                    )}
                  </div>
                  <div
                    style={{
                      width: timelineWidth,
                      flexShrink: 0,
                      height: "100%",
                      position: "relative",
                      display: "flex",
                      alignItems: "center",
                      borderLeft: "1px solid var(--border)",
                    }}
                  >
                    <button
                      type="button"
                      onClick={() => onOpen(item)}
                      onMouseEnter={onEnter}
                      onMouseMove={onMove}
                      onMouseLeave={onLeave}
                      aria-label={`${item.code} – ${item.deviceLabel}${bar.overdue ? " (po termínu)" : ""}`}
                      style={{
                        position: "absolute",
                        left: leftPx,
                        width: widthPx,
                        height: barHeight,
                        borderRadius: 4,
                        border: "none",
                        background: barBg,
                        color: "white",
                        cursor: "pointer",
                        display: "flex",
                        alignItems: "center",
                        padding: "0 8px",
                        fontWeight: 600,
                        fontSize: "var(--text-xs)",
                        textAlign: "left",
                        overflow: "hidden",
                        boxShadow: restShadow,
                        transition: "box-shadow 0.15s ease, transform 0.1s ease",
                      }}
                    >
                      <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{barText}</span>
                    </button>
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>

      {/* Tooltip u kurzoru */}
      {hovered &&
        createPortal(
          <div
            style={{
              position: "fixed",
              left: Math.min(Math.max(hovered.x + 12, 12), window.innerWidth - 320),
              top: Math.min(Math.max(hovered.y + 12, 12), window.innerHeight - 220),
              zIndex: 10000,
              padding: "10px 14px",
              background: "var(--panel)",
              border: "1px solid var(--border)",
              borderRadius: 10,
              boxShadow: "0 8px 24px rgba(0,0,0,0.15)",
              fontSize: "var(--text-sm)",
              fontWeight: 500,
              color: "var(--text)",
              maxWidth: 300,
              lineHeight: 1.5,
              pointerEvents: "none",
            }}
          >
            <div style={{ fontWeight: 800, fontSize: "var(--text-base)", marginBottom: 6, display: "flex", alignItems: "center", gap: 6 }}>
              {hovered.bar.item.code}
              {hovered.bar.item.isClaim && (
                <span style={{ fontSize: "var(--text-xs)", background: "var(--info-soft)", color: "var(--info-text)", padding: "1px 5px", borderRadius: "var(--radius-2xs)" }}>
                  Reklamace
                </span>
              )}
              {hovered.bar.overdue && (
                <span style={{ fontSize: "var(--text-xs)", background: "var(--danger-soft)", color: "var(--danger-text)", padding: "1px 5px", borderRadius: "var(--radius-2xs)" }}>
                  Po termínu
                </span>
              )}
            </div>
            <div style={{ marginBottom: 2 }}><strong>Zařízení:</strong> {hovered.bar.item.deviceLabel}</div>
            {hovered.bar.item.issue !== "—" && (
              <div style={{ marginBottom: 2, color: "var(--muted)" }}><strong>Problém:</strong> {hovered.bar.item.issue}</div>
            )}
            <div style={{ marginBottom: 2 }}><strong>Zákazník:</strong> {hovered.bar.item.customerName}</div>
            <div style={{ marginBottom: 2 }}><strong>Status:</strong> {hovered.bar.item.statusLabel}</div>
            <div style={{ fontSize: "var(--text-xs)", color: "var(--muted)", marginTop: 4 }}>
              {formatFull(hovered.bar.start)} → {hovered.bar.hasUnknownEnd ? "bez termínu" : formatFull(hovered.bar.end)}
            </div>
          </div>,
          document.body
        )}
    </div>
  );
}

function LegendItem({ swatch, children }: { swatch: React.ReactNode; children: React.ReactNode }) {
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 6, whiteSpace: "nowrap" }}>
      {swatch}
      {children}
    </span>
  );
}
