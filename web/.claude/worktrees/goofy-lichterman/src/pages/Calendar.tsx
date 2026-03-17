import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { supabase } from "../lib/supabaseClient";
import { useAuth } from "../auth/AuthProvider";
import { checkAchievementOnCalendarOpen } from "../lib/achievements";
import { useStatuses } from "../state/StatusesStore";
import { mapSupabaseTicketToTicketEx, type TicketEx } from "./Orders";
import type { WarrantyClaimRow } from "./Orders/hooks/useWarrantyClaims";

type CalendarView = "day" | "week" | "month";

type GanttItem = {
  type: "ticket" | "claim";
  id: string;
  code: string;
  label: string;
  deviceLabel: string;
  issue: string;
  customerName: string;
  start: Date;
  end: Date;
  meta?: { bg?: string };
  isClaim: boolean;
  /** true = nemá vyplněné předpokládané datum – pruh doprava od „teď“ zmizí (fade) */
  hasUnknownEnd: boolean;
  statusKey: string | null;
  statusLabel: string;
};

function formatCZ(d: Date): string {
  return d.toLocaleDateString("cs-CZ", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatShort(d: Date): string {
  return d.toLocaleTimeString("cs-CZ", { hour: "2-digit", minute: "2-digit" });
}

type CalendarProps = {
  activeServiceId: string | null;
  onOpenTicket: (ticketId: string) => void;
  onOpenClaim: (claimId: string) => void;
};

export default function Calendar({
  activeServiceId,
  onOpenTicket,
  onOpenClaim,
}: CalendarProps) {
  const { session } = useAuth();
  const { statuses, loading: statusesLoading, getByKey, isFinal, fallbackKey } = useStatuses();
  const statusKeysSet = useMemo(() => new Set(statuses.map((s) => s.key)), [statuses]);
  const normalizeStatus = useCallback(
    (key: string): string | null => {
      if (statusesLoading || statuses.length === 0) return null;
      return statusKeysSet.has(key) ? key : fallbackKey;
    },
    [statusKeysSet, fallbackKey, statusesLoading, statuses.length]
  );
  const [tickets, setTickets] = useState<TicketEx[]>([]);
  const [claims, setClaims] = useState<WarrantyClaimRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [view, setView] = useState<CalendarView>("week");
  /** Prázdná množina = zobrazit vše; neprázdná = filtr na vybrané statusy */
  const [selectedStatusKeys, setSelectedStatusKeys] = useState<Set<string>>(new Set());
  const [statusFilterOpen, setStatusFilterOpen] = useState(false);
  const [baseDate, setBaseDate] = useState(() => new Date());
  const [hoveredItem, setHoveredItem] = useState<{ item: GanttItem; x: number; y: number } | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const filterButtonRef = useRef<HTMLButtonElement>(null);
  const [filterDropdownRect, setFilterDropdownRect] = useState<{ top: number; left: number } | null>(null);
  const hasInitializedFilter = useRef(false);

  useEffect(() => {
    const uid = session?.user?.id;
    if (uid) checkAchievementOnCalendarOpen(uid);
  }, [session?.user?.id]);

  useEffect(() => {
    if (statuses.length > 0 && !hasInitializedFilter.current) {
      hasInitializedFilter.current = true;
      const nonFinalKeys = statuses.filter((s) => !s.isFinal).map((s) => s.key);
      if (nonFinalKeys.length > 0) {
        setSelectedStatusKeys(new Set(nonFinalKeys));
      }
    }
  }, [statuses]);

  useEffect(() => {
    if (!activeServiceId || !supabase) {
      setTickets([]);
      setClaims([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    const load = async () => {
      if (!supabase) return;
      try {
        const { data: tData, error: tErr } = await (supabase
          .from("tickets") as any)
          .select("*")
          .eq("service_id", activeServiceId)
          .is("deleted_at", null)
          .order("created_at", { ascending: false });

        if (tErr) throw tErr;

        const { data: cData, error: cErr } = await (supabase
          .from("warranty_claims") as any)
          .select("*")
          .eq("service_id", activeServiceId)
          .order("created_at", { ascending: false });

        if (cErr) throw cErr;

        setTickets((tData || []).map((r: any) => mapSupabaseTicketToTicketEx(r)));
        setClaims((cData || []) as WarrantyClaimRow[]);
      } catch (e: any) {
        setError(e?.message || "Chyba při načítání");
      } finally {
        setLoading(false);
      }
    };
    load();
  }, [activeServiceId]);

  const ganttItems = useMemo((): GanttItem[] => {
    const out: GanttItem[] = [];
    const now = new Date();

    const addTicket = (t: TicketEx) => {
      const st = normalizeStatus((t.status as string) ?? "");

      const start = new Date(t.createdAt ?? now);
      let end: Date;
      let hasUnknownEnd = false;
      const final = st !== null && isFinal(st);
      if (final && (t as any).completed_at) {
        end = new Date((t as any).completed_at);
      } else if ((t as any).expected_completion_at) {
        end = new Date((t as any).expected_completion_at);
      } else {
        end = new Date(Math.max(start.getTime(), now.getTime()) + 86400000);
        hasUnknownEnd = true;
      }
      const meta = st !== null ? getByKey(st) : null;
      out.push({
        type: "ticket",
        id: t.id!,
        code: t.code || "—",
        label: t.deviceLabel || "—",
        deviceLabel: t.deviceLabel || "—",
        issue: (t.issueShort || t.requestedRepair || "").toString().slice(0, 80) || "—",
        customerName: t.customerName || "—",
        start,
        end,
        meta: meta ? { bg: meta.bg } : undefined,
        isClaim: false,
        hasUnknownEnd,
        statusKey: st,
        statusLabel: meta?.label ?? String(t.status ?? "—"),
      });
    };

    const addClaim = (c: WarrantyClaimRow) => {
      const st = normalizeStatus((c.status as string) ?? "");

      const start = new Date(c.created_at ?? now);
      let end: Date;
      let hasUnknownEnd = false;
      const final = st !== null && isFinal(st);
      if (final && c.completed_at) {
        end = new Date(c.completed_at);
      } else if (c.expected_completion_at) {
        end = new Date(c.expected_completion_at);
      } else {
        end = new Date(Math.max(start.getTime(), now.getTime()) + 86400000);
        hasUnknownEnd = true;
      }
      const meta = st !== null ? getByKey(st) : null;
      out.push({
        type: "claim",
        id: c.id,
        code: c.code || "—",
        label: c.device_label || "—",
        deviceLabel: c.device_label || "—",
        issue: (c.notes || "").toString().slice(0, 80) || "—",
        customerName: c.customer_name || "—",
        start,
        end,
        meta: meta ? { bg: meta.bg } : undefined,
        isClaim: true,
        hasUnknownEnd,
        statusKey: st,
        statusLabel: meta?.label ?? String(c.status ?? "—"),
      });
    };

    tickets.forEach(addTicket);
    claims.forEach(addClaim);
    if (selectedStatusKeys.size > 0) {
      return out.filter((item) => item.statusKey !== null && selectedStatusKeys.has(item.statusKey));
    }
    return out;
  }, [tickets, claims, selectedStatusKeys, getByKey, isFinal, normalizeStatus]);

  const { rangeStart, rangeEnd } = useMemo(() => {
    const d = new Date(baseDate);
    d.setHours(0, 0, 0, 0);
    let start: Date;
    let end: Date;
    if (view === "day") {
      start = new Date(d);
      end = new Date(d);
      end.setDate(end.getDate() + 1);
    } else if (view === "week") {
      const day = d.getDay();
      const monday = day === 0 ? -6 : 1 - day;
      start = new Date(d);
      start.setDate(d.getDate() + monday);
      end = new Date(start);
      end.setDate(end.getDate() + 7);
    } else {
      start = new Date(d.getFullYear(), d.getMonth(), 1);
      end = new Date(d.getFullYear(), d.getMonth() + 1, 1);
    }
    return { rangeStart: start, rangeEnd: end };
  }, [baseDate, view]);

  const visibleItems = useMemo(() => {
    const rangeStartMs = rangeStart.getTime();
    const rangeEndMs = rangeEnd.getTime();
    return ganttItems.filter((item) => item.end.getTime() >= rangeStartMs && item.start.getTime() <= rangeEndMs);
  }, [ganttItems, rangeStart, rangeEnd]);

  const totalMs = rangeEnd.getTime() - rangeStart.getTime();
  const now = new Date();

  const { timelineWidth, columnWidth } = useMemo(() => {
    if (view === "day") {
      const cols = 24;
      const cw = 60;
      return { timelineWidth: cols * cw, columnWidth: cw };
    }
    if (view === "week") {
      const cols = 7;
      const cw = 120;
      return { timelineWidth: cols * cw, columnWidth: cw };
    }
    const daysInMonth = new Date(baseDate.getFullYear(), baseDate.getMonth() + 1, 0).getDate();
    const cw = 36;
    return { timelineWidth: daysInMonth * cw, columnWidth: cw };
  }, [view, baseDate]);

  const nowPositionPx =
    now >= rangeStart && now <= rangeEnd
      ? ((now.getTime() - rangeStart.getTime()) / totalMs) * timelineWidth
      : null;

  const timeHeaderCells = useMemo(() => {
    if (view === "day") {
      return Array.from({ length: 24 }, (_, i) => ({
        label: `${String(i).padStart(2, "0")}:00`,
        left: i * columnWidth,
      }));
    }
    if (view === "week") {
      return Array.from({ length: 7 }, (_, i) => {
        const d = new Date(rangeStart);
        d.setDate(d.getDate() + i);
        return {
          label: d.toLocaleDateString("cs-CZ", { weekday: "short", day: "numeric" }),
          left: i * columnWidth,
        };
      });
    }
    const daysInMonth = new Date(baseDate.getFullYear(), baseDate.getMonth() + 1, 0).getDate();
    return Array.from({ length: daysInMonth }, (_, i) => ({
      label: String(i + 1),
      left: i * columnWidth,
    }));
  }, [view, rangeStart, baseDate, columnWidth]);

  const goPrev = useCallback(() => {
    setBaseDate((d) => {
      const next = new Date(d);
      if (view === "day") next.setDate(next.getDate() - 1);
      else if (view === "week") next.setDate(next.getDate() - 7);
      else next.setMonth(next.getMonth() - 1);
      return next;
    });
  }, [view]);

  const goNext = useCallback(() => {
    setBaseDate((d) => {
      const next = new Date(d);
      if (view === "day") next.setDate(next.getDate() + 1);
      else if (view === "week") next.setDate(next.getDate() + 7);
      else next.setMonth(next.getMonth() + 1);
      return next;
    });
  }, [view]);

  const goToday = useCallback(() => {
    setBaseDate(new Date());
  }, []);

  useLayoutEffect(() => {
    if (!statusFilterOpen || !filterButtonRef.current) {
      setFilterDropdownRect(null);
      return;
    }
    const rect = filterButtonRef.current.getBoundingClientRect();
    const dropdownWidth = 220;
    let left = rect.left;
    if (left + dropdownWidth > window.innerWidth - 12) left = window.innerWidth - dropdownWidth - 12;
    if (left < 12) left = 12;
    setFilterDropdownRect({ top: rect.bottom + 6, left });
  }, [statusFilterOpen]);

  const rangeLabel = useMemo(() => {
    if (view === "day") {
      return rangeStart.toLocaleDateString("cs-CZ", {
        weekday: "long",
        day: "numeric",
        month: "long",
        year: "numeric",
      });
    }
    if (view === "week") {
      return `${rangeStart.toLocaleDateString("cs-CZ", { day: "numeric", month: "short" })} – ${new Date(rangeEnd.getTime() - 1).toLocaleDateString("cs-CZ", { day: "numeric", month: "short", year: "numeric" })}`;
    }
    return rangeStart.toLocaleDateString("cs-CZ", { month: "long", year: "numeric" });
  }, [view, rangeStart, rangeEnd]);

  if (!activeServiceId) {
    return (
      <div style={{ padding: 24, color: "var(--muted)", textAlign: "center" }}>
        Vyberte službu v postranním panelu.
      </div>
    );
  }

  if (loading) {
    return (
      <div style={{ padding: 24, color: "var(--muted)", textAlign: "center" }}>
        Načítání kalendáře…
      </div>
    );
  }

  if (error) {
    return (
      <div style={{ padding: 24, color: "var(--danger)", textAlign: "center" }}>
        {error}
      </div>
    );
  }

  const rowHeight = 36;
  const barHeight = 24;
  const headerHeight = 48;
  const leftLabelWidth = 180;

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        height: "100%",
        minHeight: 0,
        background: "var(--bg)",
        borderRadius: "var(--radius-lg)",
        overflow: "hidden",
        boxShadow: "0 4px 24px rgba(0,0,0,0.06)",
      }}
    >
      {/* Toolbar */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          flexWrap: "wrap",
          gap: 12,
          padding: "14px 20px",
          borderBottom: "1px solid var(--border)",
          background: "var(--panel)",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <button
            type="button"
            onClick={goPrev}
            style={{
              width: 36,
              height: 36,
              borderRadius: 10,
              border: "1px solid var(--border)",
              background: "var(--panel-2)",
              color: "var(--text)",
              cursor: "pointer",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: 18,
              fontWeight: 700,
            }}
          >
            ‹
          </button>
          <button
            type="button"
            onClick={goNext}
            style={{
              width: 36,
              height: 36,
              borderRadius: 10,
              border: "1px solid var(--border)",
              background: "var(--panel-2)",
              color: "var(--text)",
              cursor: "pointer",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: 18,
              fontWeight: 700,
            }}
          >
            ›
          </button>
          <button
            type="button"
            onClick={goToday}
            style={{
              padding: "8px 14px",
              borderRadius: 10,
              border: "1px solid var(--accent)",
              background: "var(--accent-soft)",
              color: "var(--accent)",
              fontWeight: 700,
              fontSize: 13,
              cursor: "pointer",
            }}
          >
            Dnes
          </button>
          <span
            style={{
              fontWeight: 800,
              fontSize: 16,
              color: "var(--text)",
              minWidth: 220,
            }}
          >
            {rangeLabel}
          </span>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          {(["day", "week", "month"] as const).map((v) => (
            <button
              key={v}
              type="button"
              onClick={() => setView(v)}
              style={{
                padding: "8px 14px",
                borderRadius: 10,
                border: view === v ? "2px solid var(--accent)" : "1px solid var(--border)",
                background: view === v ? "var(--accent-soft)" : "var(--panel)",
                color: view === v ? "var(--accent)" : "var(--text)",
                fontWeight: view === v ? 700 : 500,
                fontSize: 13,
                cursor: "pointer",
                textTransform: "capitalize",
              }}
            >
              {v === "day" ? "Den" : v === "week" ? "Týden" : "Měsíc"}
            </button>
          ))}
          <div style={{ position: "relative", marginLeft: 8 }}>
            <button
              ref={filterButtonRef}
              type="button"
              onClick={() => setStatusFilterOpen((o) => !o)}
              style={{
                padding: "8px 14px",
                borderRadius: 10,
                border: "1px solid var(--border)",
                background: statusFilterOpen ? "var(--accent-soft)" : "var(--panel)",
                color: statusFilterOpen ? "var(--accent)" : "var(--text)",
                fontWeight: 600,
                fontSize: 13,
                cursor: "pointer",
                display: "flex",
                alignItems: "center",
                gap: 6,
              }}
            >
              Filtr statusů
              {selectedStatusKeys.size > 0 && (
                <span style={{ background: "var(--accent)", color: "white", padding: "0 6px", borderRadius: 6, fontSize: 11 }}>
                  {selectedStatusKeys.size}
                </span>
              )}
            </button>
            {statusFilterOpen &&
              createPortal(
                <>
                  <div
                    role="presentation"
                    style={{ position: "fixed", inset: 0, zIndex: 9998 }}
                    onClick={() => setStatusFilterOpen(false)}
                  />
                  <div
                    style={{
                      position: "fixed",
                      top: filterDropdownRect?.top ?? 0,
                      left: filterDropdownRect?.left ?? 0,
                      zIndex: 9999,
                      minWidth: 220,
                      padding: 12,
                      background: "var(--panel)",
                      border: "1px solid var(--border)",
                      borderRadius: 12,
                      boxShadow: "0 8px 24px rgba(0,0,0,0.12)",
                    }}
                  >
                  <div style={{ fontSize: 11, fontWeight: 700, color: "var(--muted)", marginBottom: 8, textTransform: "uppercase" }}>
                    Zobrazit statusy
                  </div>
                  <div style={{ display: "flex", flexDirection: "column", gap: 4, maxHeight: 240, overflowY: "auto" }}>
                    {statuses.map((s) => {
                      const checked = selectedStatusKeys.size === 0 || selectedStatusKeys.has(s.key);
                      return (
                        <label
                          key={s.key}
                          style={{
                            display: "flex",
                            alignItems: "center",
                            gap: 8,
                            fontSize: 13,
                            color: "var(--text)",
                            cursor: "pointer",
                            padding: "4px 6px",
                            borderRadius: 6,
                          }}
                        >
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={() => {
                              if (selectedStatusKeys.size === 0) {
                                setSelectedStatusKeys(new Set(statuses.filter((x) => x.key !== s.key).map((x) => x.key)));
                              } else if (selectedStatusKeys.has(s.key)) {
                                const next = new Set(selectedStatusKeys);
                                next.delete(s.key);
                                setSelectedStatusKeys(next.size > 0 ? next : new Set());
                              } else {
                                const next = new Set(selectedStatusKeys);
                                next.add(s.key);
                                setSelectedStatusKeys(next);
                              }
                            }}
                            style={{ width: 16, height: 16 }}
                          />
                          <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
                            {s.bg && <span style={{ width: 8, height: 8, borderRadius: 4, background: s.bg }} />}
                            {s.label}
                          </span>
                        </label>
                      );
                    })}
                  </div>
                  <div style={{ display: "flex", gap: 8, marginTop: 8, paddingTop: 8, borderTop: "1px solid var(--border)" }}>
                    <button
                      type="button"
                      onClick={() => setSelectedStatusKeys(new Set())}
                      style={{
                        flex: 1,
                        padding: "6px 10px",
                        fontSize: 12,
                        fontWeight: 600,
                        cursor: "pointer",
                        border: "1px solid var(--border)",
                        borderRadius: 8,
                        background: "var(--panel-2)",
                        color: "var(--text)",
                      }}
                    >
                      Všechny
                    </button>
                    <button
                      type="button"
                      onClick={() => setSelectedStatusKeys(new Set(statuses.map((s) => s.key)))}
                      style={{
                        flex: 1,
                        padding: "6px 10px",
                        fontSize: 12,
                        fontWeight: 600,
                        cursor: "pointer",
                        border: "1px solid var(--border)",
                        borderRadius: 8,
                        background: "var(--panel-2)",
                        color: "var(--text)",
                      }}
                    >
                      Vybrat vše
                    </button>
                  </div>
                </div>
                </>,
                document.body
              )}
          </div>
        </div>
      </div>

      {/* Gantt area */}
      <div
        ref={scrollRef}
        style={{
          flex: 1,
          overflow: "auto",
          minHeight: 0,
        }}
      >
        <div
          style={{
            minWidth: "max-content",
            position: "relative",
          }}
        >
          {/* Timeline header – hodiny (den) / dny (týden/měsíc) */}
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
                fontSize: 11,
                color: "var(--muted)",
                textTransform: "uppercase",
                letterSpacing: "0.5px",
              }}
            >
              Zakázka
            </div>
            <div
              style={{
                width: timelineWidth,
                flexShrink: 0,
                position: "relative",
                borderLeft: "1px solid var(--border)",
              }}
            >
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
                    fontSize: 11,
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

          {/* Červená linka „teď“ – přes celou výšku hlavičky + řádků */}
          {nowPositionPx !== null && nowPositionPx >= 0 && nowPositionPx <= timelineWidth && (
            <div
              style={{
                position: "absolute",
                left: leftLabelWidth + nowPositionPx - 1,
                top: 0,
                width: 2,
                height: headerHeight + visibleItems.length * rowHeight,
                background: "#ef4444",
                zIndex: 3,
                boxShadow: "0 0 8px rgba(239,68,68,0.6)",
                pointerEvents: "none",
              }}
              title={`Teď: ${view === "day" ? formatShort(now) : now.toLocaleDateString("cs-CZ", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}`}
            />
          )}

          {/* Rows */}
          {visibleItems.length === 0 ? (
            <div
              style={{
                padding: 48,
                textAlign: "center",
                color: "var(--muted)",
                fontSize: 14,
              }}
            >
              Žádné zakázky ani reklamace v tomto období.
              {selectedStatusKeys.size > 0 && " Zkuste změnit filtr statusů."}
            </div>
          ) : (
            visibleItems.map((item, idx) => {
              const startMs = item.start.getTime();
              const endMs = item.end.getTime();
              const rangeStartMs = rangeStart.getTime();
              const leftPx = Math.max(0, ((startMs - rangeStartMs) / totalMs) * timelineWidth);
              const rightPx = Math.min(timelineWidth, ((endMs - rangeStartMs) / totalMs) * timelineWidth);
              const widthPx = Math.max(4, rightPx - leftPx);
              const color = item.meta?.bg || "var(--accent)";
              const nowInBarPx = nowPositionPx !== null ? nowPositionPx - leftPx : null;
              const barBg =
                item.hasUnknownEnd && nowInBarPx !== null && nowInBarPx > 0 && nowInBarPx < widthPx
                  ? (() => {
                      const fadeLen = widthPx - nowInBarPx;
                      const mid = nowInBarPx + fadeLen * 0.4;
                      const soft = nowInBarPx + fadeLen * 0.75;
                      return `linear-gradient(to right, ${color} 0px, ${color} ${nowInBarPx}px, color-mix(in srgb, ${color} 60%, transparent) ${mid}px, color-mix(in srgb, ${color} 20%, transparent) ${soft}px, transparent ${widthPx}px)`;
                    })()
                  : color;

              const handleBarMouseEnter = (e: React.MouseEvent<HTMLButtonElement>) => {
                setHoveredItem({ item, x: e.clientX, y: e.clientY });
                e.currentTarget.style.boxShadow = "0 2px 8px rgba(0,0,0,0.25)";
                e.currentTarget.style.transform = "scaleY(1.05)";
              };
              const handleBarMouseMove = (e: React.MouseEvent<HTMLButtonElement>) => {
                setHoveredItem((prev) => (prev ? { ...prev, x: e.clientX, y: e.clientY } : null));
              };
              const handleBarMouseLeave = (e: React.MouseEvent<HTMLButtonElement>) => {
                setHoveredItem(null);
                e.currentTarget.style.boxShadow = "0 1px 3px rgba(0,0,0,0.15)";
                e.currentTarget.style.transform = "scaleY(1)";
              };

              return (
                <div
                  key={`${item.type}-${item.id}-${idx}`}
                  style={{
                    height: rowHeight,
                    display: "flex",
                    alignItems: "center",
                    borderBottom: "1px solid var(--border)",
                    background: idx % 2 === 0 ? "var(--bg)" : "var(--panel)",
                  }}
                >
                  <div
                    style={{
                      width: leftLabelWidth,
                      flexShrink: 0,
                      paddingLeft: 12,
                      display: "flex",
                      alignItems: "center",
                      gap: 6,
                      minWidth: 0,
                    }}
                  >
                    <span
                      style={{
                        fontWeight: 800,
                        fontSize: 11,
                        color: "var(--text)",
                        fontFamily: "monospace",
                      }}
                    >
                      {item.code}
                    </span>
                    {item.isClaim && (
                      <span
                        style={{
                          fontSize: 9,
                          fontWeight: 900,
                          padding: "1px 4px",
                          borderRadius: 4,
                          background: "rgba(13,148,136,0.15)",
                          color: "#0f766e",
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
                      onClick={() =>
                        item.isClaim ? onOpenClaim(item.id) : onOpenTicket(item.id)
                      }
                      onMouseEnter={handleBarMouseEnter}
                      onMouseMove={handleBarMouseMove}
                      onMouseLeave={handleBarMouseLeave}
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
                        fontSize: 11,
                        textAlign: "left",
                        overflow: "hidden",
                        boxShadow: "0 1px 3px rgba(0,0,0,0.15)",
                        transition: "box-shadow 0.15s ease, transform 0.1s ease",
                      }}
                    >
                      <span
                        style={{
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                          whiteSpace: "nowrap",
                        }}
                      >
                        {item.label}
                      </span>
                    </button>
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>

      {/* Tooltip při najetí na zakázku – poblíž kurzoru myši */}
      {hoveredItem &&
        createPortal(
          <div
            style={{
              position: "fixed",
              left: Math.min(Math.max(hoveredItem.x + 12, 12), window.innerWidth - 320),
              top: Math.min(Math.max(hoveredItem.y + 12, 12), window.innerHeight - 220),
              zIndex: 10000,
              padding: "10px 14px",
              background: "var(--panel)",
              border: "1px solid var(--border)",
              borderRadius: 10,
              boxShadow: "0 8px 24px rgba(0,0,0,0.15)",
              fontSize: 12,
              fontWeight: 500,
              color: "var(--text)",
              maxWidth: 300,
              lineHeight: 1.5,
              pointerEvents: "none",
            }}
          >
            <div style={{ fontWeight: 800, fontSize: 13, marginBottom: 6, color: "var(--text)" }}>
              {hoveredItem.item.code}
              {hoveredItem.item.isClaim && (
                <span style={{ marginLeft: 6, fontSize: 9, background: "rgba(13,148,136,0.2)", color: "#0f766e", padding: "1px 4px", borderRadius: 4 }}>
                  Reklamace
                </span>
              )}
            </div>
            <div style={{ marginBottom: 2 }}><strong>Zařízení:</strong> {hoveredItem.item.deviceLabel}</div>
            {hoveredItem.item.issue !== "—" && (
              <div style={{ marginBottom: 2, color: "var(--muted)" }}><strong>Problém:</strong> {hoveredItem.item.issue}</div>
            )}
            <div style={{ marginBottom: 2 }}><strong>Zákazník:</strong> {hoveredItem.item.customerName}</div>
            <div style={{ marginBottom: 2 }}><strong>Status:</strong> {hoveredItem.item.statusLabel}</div>
            <div style={{ fontSize: 11, color: "var(--muted)", marginTop: 4 }}>
              {formatCZ(hoveredItem.item.start)} → {formatCZ(hoveredItem.item.end)}
            </div>
          </div>,
          document.body
        )}
    </div>
  );
}
