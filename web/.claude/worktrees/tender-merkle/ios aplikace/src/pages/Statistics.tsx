import { useMemo, useState, useRef, useEffect, useLayoutEffect } from "react";
import { createPortal } from "react-dom";
import { supabase } from "../lib/supabaseClient";
import { mapSupabaseTicketToTicketEx, type TicketEx } from "./Orders";

const TICKETS_SELECT =
  "id,service_id,code,title,status,notes,customer_id,customer_name,customer_phone,customer_email,customer_address_street,customer_address_city,customer_address_zip,customer_company,customer_ico,customer_info,device_serial,device_passcode,device_condition,device_note,external_id,handoff_method,estimated_price,performed_repairs,diagnostic_text,diagnostic_photos,discount_type,discount_value,created_at,updated_at,version";

type PeriodType = "all" | "today" | "week" | "month" | "quarter" | "year" | "custom";

type DrillDown =
  | null
  | { type: "status"; value: string }
  | { type: "month"; year: number; month: number }
  | { type: "repair"; value: string }
  | { type: "device"; value: string };

// ========================
// Period Picker (custom dropdown)
// ========================
type PeriodPickerProps = {
  value: PeriodType;
  onChange: (value: PeriodType) => void;
};

function PeriodPicker({ value, onChange }: PeriodPickerProps) {
  const [open, setOpen] = useState(false);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ left: 0, top: 0, width: 0, maxHeight: 300 });

  const options: Array<{ value: PeriodType; label: string }> = [
    { value: "all", label: "Vše" },
    { value: "today", label: "Dnes" },
    { value: "week", label: "Tento týden" },
    { value: "month", label: "Tento měsíc" },
    { value: "quarter", label: "Toto čtvrtletí" },
    { value: "year", label: "Tento rok" },
    { value: "custom", label: "Vlastní rozsah" },
  ];

  const selected = options.find((o) => o.value === value) ?? options[0];

  useLayoutEffect(() => {
    if (open && buttonRef.current) {
      const rect = buttonRef.current.getBoundingClientRect();
      const viewportHeight = window.innerHeight;
      const spaceBelow = viewportHeight - rect.bottom;
      const spaceAbove = rect.top;

      const estimatedMenuHeight = 300;
      const gap = 8;
      const margin = 10;

      const openUp = spaceBelow < estimatedMenuHeight + margin && spaceAbove > spaceBelow;

      const maxHeight = Math.max(100, Math.min(400, openUp ? spaceAbove - gap - margin : spaceBelow - gap - margin));

      setPos({
        left: rect.left,
        top: openUp ? rect.top - maxHeight - gap : rect.bottom + gap,
        width: rect.width,
        maxHeight,
      });
    }
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (
        menuRef.current &&
        !menuRef.current.contains(e.target as Node) &&
        buttonRef.current &&
        !buttonRef.current.contains(e.target as Node)
      ) {
        setOpen(false);
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("mousedown", onDown);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("mousedown", onDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const menu = open ? (
    <div
      ref={menuRef}
      role="listbox"
      style={{
        position: "fixed",
        left: pos.left,
        top: pos.top,
        width: pos.width,
        borderRadius: 14,
        border: "1px solid var(--border)",
        background: "var(--panel)",
        backdropFilter: "var(--blur)",
        WebkitBackdropFilter: "var(--blur)",
        boxShadow: "0 25px 60px rgba(0,0,0,0.22)",
        padding: 6,
        zIndex: 10000,
        maxHeight: pos.maxHeight,
        overflowY: "auto",
      }}
    >
      {options.map((opt) => {
        const active = opt.value === value;
        return (
          <button
            key={opt.value}
            type="button"
            onClick={() => {
              onChange(opt.value);
              setOpen(false);
            }}
            style={{
              width: "100%",
              textAlign: "left",
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              gap: 10,
              padding: "12px 14px",
              borderRadius: 12,
              border: "none",
              background: active ? "var(--accent-soft)" : "transparent",
              cursor: "pointer",
              color: active ? "var(--accent)" : "var(--text)",
              fontFamily: "system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif",
              fontWeight: active ? 700 : 500,
              fontSize: 14,
              transition: "var(--transition-smooth)",
            }}
            onMouseEnter={(e) => {
              if (!active) e.currentTarget.style.background = "var(--panel-2)";
            }}
            onMouseLeave={(e) => {
              if (!active) e.currentTarget.style.background = "transparent";
            }}
          >
            <span>{opt.label}</span>
            {active && <span style={{ marginLeft: "auto", fontSize: 16, opacity: 0.8 }}>✓</span>}
          </button>
        );
      })}
    </div>
  ) : null;

  const border = "1px solid var(--border)";

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        onClick={() => setOpen(!open)}
        style={{
          width: "100%",
          padding: "12px 40px 12px 14px",
          borderRadius: 12,
          border: open ? "1px solid var(--accent)" : border,
          outline: "none",
          background: open ? "var(--panel-2)" : "var(--panel)",
          backdropFilter: "var(--blur)",
          WebkitBackdropFilter: "var(--blur)",
          color: "var(--text)",
          fontFamily: "system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif",
          fontWeight: 500,
          fontSize: 14,
          cursor: "pointer",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          boxShadow: open ? "0 0 0 3px var(--accent-soft)" : "var(--shadow-soft)",
          transition: "var(--transition-smooth)",
        }}
        onMouseEnter={(e) => {
          if (!open) e.currentTarget.style.borderColor = "var(--accent)";
          if (!open) e.currentTarget.style.boxShadow = "0 4px 16px var(--accent-glow)";
        }}
        onMouseLeave={(e) => {
          if (!open) e.currentTarget.style.borderColor = "var(--border)";
          if (!open) e.currentTarget.style.boxShadow = "var(--shadow-soft)";
        }}
      >
        <span>{selected.label}</span>
        <span style={{ opacity: 0.65, fontWeight: 900, fontSize: 12 }}>▾</span>
      </button>
      {open ? createPortal(menu, document.body) : null}
    </>
  );
}

function ticketRevenue(t: TicketEx): number {
  const repairs = t.performedRepairs || [];
  const ticketPrice = repairs.reduce((sum, r) => sum + (r.price || 0), 0);
  let discountAmount = 0;
  if (t.discountType === "percentage") discountAmount = (ticketPrice * (t.discountValue || 0)) / 100;
  else if (t.discountType === "amount") discountAmount = t.discountValue || 0;
  return Math.max(0, ticketPrice - discountAmount);
}

type StatisticsProps = {
  activeServiceId: string | null;
  onOpenTicket?: (ticketId: string) => void;
};

export default function Statistics({ activeServiceId, onOpenTicket }: StatisticsProps) {
  const [allTickets, setAllTickets] = useState<TicketEx[]>([]);
  const [ticketsLoading, setTicketsLoading] = useState(true);
  const [ticketsError, setTicketsError] = useState<string | null>(null);
  const [periodType, setPeriodType] = useState<PeriodType>("all");
  const [customStartDate, setCustomStartDate] = useState<string>("");
  const [customEndDate, setCustomEndDate] = useState<string>("");
  const [viewMode, setViewMode] = useState<"cards" | "table" | "charts">("cards");
  const [drillDown, setDrillDown] = useState<DrillDown>(null);
  const [compareWithPrevious, setCompareWithPrevious] = useState(false);

  useEffect(() => {
    if (!activeServiceId || !supabase) {
      setAllTickets([]);
      setTicketsLoading(false);
      setTicketsError(null);
      return;
    }
    setTicketsLoading(true);
    setTicketsError(null);
    (async () => {
      try {
        const { data, error } = await (supabase as any)
          .from("tickets")
          .select(TICKETS_SELECT)
          .eq("service_id", activeServiceId)
          .is("deleted_at", null)
          .order("created_at", { ascending: false });
        if (error) throw error;
        setAllTickets((data || []).map((row: any) => mapSupabaseTicketToTicketEx(row)));
      } catch (err) {
        setTicketsError(err instanceof Error ? err.message : "Chyba při načítání");
        setAllTickets([]);
      } finally {
        setTicketsLoading(false);
      }
    })();
  }, [activeServiceId]);

  // Filtrování tickets podle vybraného období
  const tickets = useMemo(() => {
    if (periodType === "all") return allTickets;

    const now = new Date();
    let startDate: Date;
    let endDate: Date = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59);

    switch (periodType) {
      case "today":
        startDate = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0);
        break;
      case "week":
        const dayOfWeek = now.getDay();
        const diff = now.getDate() - dayOfWeek + (dayOfWeek === 0 ? -6 : 1); // Monday
        startDate = new Date(now.getFullYear(), now.getMonth(), diff, 0, 0, 0);
        break;
      case "month":
        startDate = new Date(now.getFullYear(), now.getMonth(), 1, 0, 0, 0);
        break;
      case "quarter":
        const quarter = Math.floor(now.getMonth() / 3);
        startDate = new Date(now.getFullYear(), quarter * 3, 1, 0, 0, 0);
        break;
      case "year":
        startDate = new Date(now.getFullYear(), 0, 1, 0, 0, 0);
        break;
      case "custom":
        if (!customStartDate || !customEndDate) return allTickets;
        startDate = new Date(customStartDate);
        endDate = new Date(customEndDate);
        endDate.setHours(23, 59, 59, 999);
        break;
      default:
        return allTickets;
    }

    return allTickets.filter((t) => {
      const ticketDate = new Date(t.createdAt);
      return ticketDate >= startDate && ticketDate <= endDate;
    });
  }, [allTickets, periodType, customStartDate, customEndDate]);

  // Předchozí období (stejná délka, posunuté dozadu) pro porovnání
  const previousPeriodTickets = useMemo(() => {
    if (tickets.length === 0) return [];
    const now = new Date();
    let startPrev: Date;
    let endPrev: Date;

    if (periodType === "all" || periodType === "custom") {
      if (!customStartDate || !customEndDate) return [];
      const start = new Date(customStartDate);
      const end = new Date(customEndDate);
      const days = Math.round((end.getTime() - start.getTime()) / (24 * 60 * 60 * 1000));
      endPrev = new Date(start);
      endPrev.setDate(endPrev.getDate() - 1);
      endPrev.setHours(23, 59, 59, 999);
      startPrev = new Date(endPrev);
      startPrev.setDate(startPrev.getDate() - days);
    } else {
      switch (periodType) {
        case "today":
          startPrev = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1, 0, 0, 0);
          endPrev = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1, 23, 59, 59);
          break;
        case "week": {
          const dayOfWeek = now.getDay();
          const diff = now.getDate() - dayOfWeek + (dayOfWeek === 0 ? -6 : 1);
          const lastMonday = new Date(now.getFullYear(), now.getMonth(), diff - 7, 0, 0, 0);
          const lastSunday = new Date(lastMonday);
          lastSunday.setDate(lastSunday.getDate() + 6);
          lastSunday.setHours(23, 59, 59, 999);
          startPrev = lastMonday;
          endPrev = lastSunday;
          break;
        }
        case "month":
          startPrev = new Date(now.getFullYear(), now.getMonth() - 1, 1, 0, 0, 0);
          endPrev = new Date(now.getFullYear(), now.getMonth(), 0, 23, 59, 59);
          break;
        case "quarter": {
          const q = Math.floor(now.getMonth() / 3);
          const prevQ = q === 0 ? 3 : q - 1;
          const prevYear = q === 0 ? now.getFullYear() - 1 : now.getFullYear();
          startPrev = new Date(prevYear, prevQ * 3, 1, 0, 0, 0);
          endPrev = new Date(prevYear, prevQ * 3 + 3, 0, 23, 59, 59);
          break;
        }
        case "year":
          startPrev = new Date(now.getFullYear() - 1, 0, 1, 0, 0, 0);
          endPrev = new Date(now.getFullYear() - 1, 11, 31, 23, 59, 59);
          break;
        default:
          return [];
      }
    }

    return allTickets.filter((t) => {
      const d = new Date(t.createdAt);
      return d >= startPrev && d <= endPrev;
    });
  }, [allTickets, periodType, customStartDate, customEndDate, tickets.length]);

  // Drill-down: filtrování podle kliku na status / měsíc / opravu / zařízení
  const filteredTickets = useMemo(() => {
    if (!drillDown) return tickets;
    return tickets.filter((t) => {
      if (drillDown.type === "status") return (t.status || "unknown") === drillDown.value;
      if (drillDown.type === "month") {
        const d = new Date(t.createdAt);
        return d.getFullYear() === drillDown.year && d.getMonth() === drillDown.month;
      }
      if (drillDown.type === "repair") {
        return (t.performedRepairs || []).some((r) => r.name === drillDown.value);
      }
      if (drillDown.type === "device") return t.deviceLabel === drillDown.value;
      return true;
    });
  }, [tickets, drillDown]);

  // Základní statistiky (z filteredTickets)
  const stats = useMemo(() => {
    const list = filteredTickets;
    const totalTickets = list.length;

    const byStatus: Record<string, number> = {};
    list.forEach((t) => {
      const status = t.status || "unknown";
      byStatus[status] = (byStatus[status] || 0) + 1;
    });

    let totalRevenue = 0;
    let totalCosts = 0;
    let totalDiscounts = 0;
    const ticketPrices: number[] = [];

    list.forEach((t) => {
      const rev = ticketRevenue(t);
      totalRevenue += rev;
      const repairs = t.performedRepairs || [];
      let discountAmount = 0;
      const ticketPrice = repairs.reduce((sum, r) => sum + (r.price || 0), 0);
      if (t.discountType === "percentage") discountAmount = (ticketPrice * (t.discountValue || 0)) / 100;
      else if (t.discountType === "amount") discountAmount = t.discountValue || 0;
      totalDiscounts += discountAmount;
      totalCosts += repairs.reduce((sum, r) => sum + (r.costs || 0), 0);
      if (rev > 0) ticketPrices.push(rev);
    });

    const averageTicketPrice = ticketPrices.length > 0
      ? ticketPrices.reduce((sum, p) => sum + p, 0) / ticketPrices.length
      : 0;

    const repairCounts: Record<string, number> = {};
    list.forEach((t) => {
      (t.performedRepairs || []).forEach((r) => {
        repairCounts[r.name] = (repairCounts[r.name] || 0) + 1;
      });
    });
    const topRepairs = Object.entries(repairCounts)
      .sort(([, a], [, b]) => b - a)
      .slice(0, 5)
      .map(([name, count]) => ({ name, count }));

    const deviceCounts: Record<string, number> = {};
    list.forEach((t) => {
      if (t.deviceLabel) deviceCounts[t.deviceLabel] = (deviceCounts[t.deviceLabel] || 0) + 1;
    });
    const topDevices = Object.entries(deviceCounts)
      .sort(([, a], [, b]) => b - a)
      .slice(0, 5)
      .map(([name, count]) => ({ name, count }));

    const monthlyStats: Array<{ month: string; count: number; revenue: number; year: number; monthIndex: number }> = [];
    if (list.length > 0) {
      const dates = list.map((t) => new Date(t.createdAt)).sort((a, b) => a.getTime() - b.getTime());
      const startMonth = new Date(dates[0].getFullYear(), dates[0].getMonth(), 1);
      const endMonth = new Date(dates[dates.length - 1].getFullYear(), dates[dates.length - 1].getMonth(), 1);
      let current = new Date(startMonth);
      while (current <= endMonth) {
        const y = current.getFullYear();
        const m = current.getMonth();
        const monthTickets = list.filter((t) => {
          const d = new Date(t.createdAt);
          return d.getFullYear() === y && d.getMonth() === m;
        });
        const monthRevenue = monthTickets.reduce((s, t) => s + ticketRevenue(t), 0);
        monthlyStats.push({
          month: current.toLocaleDateString("cs-CZ", { month: "short", year: "numeric" }),
          count: monthTickets.length,
          revenue: monthRevenue,
          year: y,
          monthIndex: m,
        });
        current = new Date(y, m + 1, 1);
      }
    }

    return {
      totalTickets,
      byStatus,
      totalRevenue,
      totalCosts,
      totalDiscounts,
      profit: totalRevenue - totalCosts,
      averageTicketPrice,
      topRepairs,
      topDevices,
      monthlyStats,
    };
  }, [filteredTickets]);

  // Statistiky předchozího období (pro porovnání)
  const prevStats = useMemo(() => {
    const list = previousPeriodTickets;
    const totalTickets = list.length;
    let totalRevenue = 0;
    let totalCosts = 0;
    list.forEach((t) => {
      totalRevenue += ticketRevenue(t);
      totalCosts += (t.performedRepairs || []).reduce((s, r) => s + (r.costs || 0), 0);
    });
    const ticketPrices = list.map(ticketRevenue).filter((p) => p > 0);
    const averageTicketPrice = ticketPrices.length > 0
      ? ticketPrices.reduce((a, b) => a + b, 0) / ticketPrices.length
      : 0;
    return {
      totalTickets,
      totalRevenue,
      totalCosts,
      profit: totalRevenue - totalCosts,
      averageTicketPrice,
    };
  }, [previousPeriodTickets]);

  const border = "1px solid var(--border)";
  const maxCount = Math.max(1, ...Object.values(stats.byStatus), 1);
  const maxRevenue = Math.max(1, ...stats.monthlyStats.map((m) => m.revenue));

  if (!activeServiceId) {
    return (
      <div data-tour="statistics-main" style={{ padding: "var(--pad-24)", maxWidth: 1400, margin: "0 auto" }}>
        <div style={{ padding: 48, textAlign: "center", color: "var(--muted)", background: "var(--panel)", border, borderRadius: "var(--radius-lg)" }}>
          Vyberte servis v postranním panelu pro zobrazení statistik.
        </div>
      </div>
    );
  }

  return (
    <div
      data-tour="statistics-main"
      style={{
        padding: "var(--pad-24)",
        display: "flex",
        flexDirection: "column",
        gap: 24,
        maxWidth: 1400,
        margin: "0 auto",
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: 16 }}>
        <div>
          <h1 style={{ fontWeight: 800, fontSize: 28, color: "var(--text)", marginBottom: 8 }}>
            Statistiky
          </h1>
          <p style={{ color: "var(--muted)", fontSize: 14 }}>
            Přehled zakázek, příjmů a výkonnosti. Klikněte na grafy, karty nebo položky pro zobrazení pouze vybraných zakázek; v tabulce řádek otevře zakázku.
            {periodType !== "all" && (
              <span style={{ marginLeft: 8, fontWeight: 600 }}>
                ({(() => {
                  switch (periodType) {
                    case "today": return "Dnes";
                    case "week": return "Tento týden";
                    case "month": return "Tento měsíc";
                    case "quarter": return "Toto čtvrtletí";
                    case "year": return "Tento rok";
                    case "custom":
                      if (customStartDate && customEndDate) {
                        const start = new Date(customStartDate).toLocaleDateString("cs-CZ");
                        const end = new Date(customEndDate).toLocaleDateString("cs-CZ");
                        return `${start} - ${end}`;
                      }
                      return "Vlastní rozsah";
                    default: return "";
                  }
                })()})
              </span>
            )}
          </p>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 12, alignItems: "flex-end" }}>
          {/* Režim zobrazení */}
          <div style={{ display: "flex", gap: 6 }}>
            {(["cards", "table", "charts"] as const).map((mode) => (
              <button
                key={mode}
                type="button"
                data-tour={mode === "charts" ? "statistics-view-charts" : undefined}
                onClick={() => setViewMode(mode)}
                style={{
                  padding: "8px 14px",
                  borderRadius: 10,
                  border,
                  background: viewMode === mode ? "var(--accent-soft)" : "var(--panel)",
                  color: viewMode === mode ? "var(--accent)" : "var(--text)",
                  fontWeight: 600,
                  fontSize: 13,
                  cursor: "pointer",
                }}
              >
                {mode === "cards" ? "Karty" : mode === "table" ? "Tabulka" : "Grafy"}
              </button>
            ))}
          </div>

          {/* Porovnat s předchozím obdobím */}
          <label style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer", fontSize: 13, color: "var(--text)" }}>
            <input
              type="checkbox"
              checked={compareWithPrevious}
              onChange={(e) => setCompareWithPrevious(e.target.checked)}
              style={{ width: 18, height: 18, accentColor: "var(--accent)" }}
            />
            Porovnat s předchozím obdobím
          </label>

          {/* Výběr časového období */}
          <div style={{ display: "flex", flexDirection: "column", gap: 8, minWidth: 250 }} data-tour="statistics-period">
            <label style={{ fontSize: 12, color: "var(--muted)", fontWeight: 600 }}>
              Časové období
            </label>
            <PeriodPicker
            value={periodType}
            onChange={(newValue) => {
              setPeriodType(newValue);
              if (newValue !== "custom") {
                setCustomStartDate("");
                setCustomEndDate("");
              }
            }}
          />
          
          {periodType === "custom" && (
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              <div style={{ flex: 1, minWidth: 120 }}>
                <label style={{ fontSize: 11, color: "var(--muted)", marginBottom: 4, display: "block" }}>
                  Od
                </label>
                <input
                  type="date"
                  value={customStartDate}
                  onChange={(e) => setCustomStartDate(e.target.value)}
                  style={{
                    padding: "8px 10px",
                    borderRadius: 8,
                    border,
                    background: "var(--panel)",
                    color: "var(--text)",
                    fontSize: 13,
                    fontFamily: "system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif",
                    width: "100%",
                  }}
                />
              </div>
              <div style={{ flex: 1, minWidth: 120 }}>
                <label style={{ fontSize: 11, color: "var(--muted)", marginBottom: 4, display: "block" }}>
                  Do
                </label>
                <input
                  type="date"
                  value={customEndDate}
                  onChange={(e) => setCustomEndDate(e.target.value)}
                  style={{
                    padding: "8px 10px",
                    borderRadius: 8,
                    border,
                    background: "var(--panel)",
                    color: "var(--text)",
                    fontSize: 13,
                    fontFamily: "system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif",
                    width: "100%",
                  }}
                />
              </div>
            </div>
          )}
          </div>
        </div>
      </div>

      {/* Aktivní filtr (drill-down) – klikem na status/měsíc/opravu/zařízení */}
      {drillDown && (
        <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
          <span style={{ fontSize: 13, color: "var(--muted)" }}>Filtr:</span>
          <span
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 8,
              padding: "8px 12px",
              borderRadius: 10,
              background: "var(--accent-soft)",
              color: "var(--accent)",
              fontWeight: 600,
              fontSize: 13,
            }}
          >
            {drillDown.type === "status" && `Status: ${drillDown.value}`}
            {drillDown.type === "month" &&
              new Date(drillDown.year, drillDown.month).toLocaleDateString("cs-CZ", { month: "long", year: "numeric" })}
            {drillDown.type === "repair" && `Oprava: ${drillDown.value}`}
            {drillDown.type === "device" && `Zařízení: ${drillDown.value}`}
            <button
              type="button"
              onClick={() => setDrillDown(null)}
              style={{
                padding: 0,
                margin: 0,
                border: "none",
                background: "none",
                cursor: "pointer",
                color: "var(--accent)",
                fontSize: 16,
                lineHeight: 1,
              }}
              title="Zrušit filtr"
              aria-label="Zrušit filtr"
            >
              ×
            </button>
          </span>
          <span style={{ fontSize: 12, color: "var(--muted)" }}>
            {filteredTickets.length} zakázek
          </span>
        </div>
      )}

      {ticketsLoading && (
        <div style={{ padding: 32, textAlign: "center", color: "var(--muted)", background: "var(--panel)", border, borderRadius: "var(--radius-lg)" }}>
          Načítání zakázek…
        </div>
      )}
      {ticketsError && (
        <div style={{ padding: 24, background: "rgba(239,68,68,0.1)", border: "1px solid rgba(239,68,68,0.3)", borderRadius: "var(--radius-lg)", color: "rgba(239,68,68,0.95)" }}>
          {ticketsError}
        </div>
      )}

      {!ticketsLoading && !ticketsError && (
        <>
      {/* Hlavní statistiky */}
      <div style={{ display: viewMode === "charts" ? "none" : "flex", flexWrap: "wrap", gap: 16 }}>
        <StatCard
          title="Celkem zakázek"
          value={stats.totalTickets}
          icon="📋"
          delta={compareWithPrevious ? stats.totalTickets - prevStats.totalTickets : undefined}
          deltaLabel="vs. předch. období"
        />
        <StatCard
          title="Celkový příjem"
          value={`${stats.totalRevenue.toFixed(2)} Kč`}
          icon="💰"
          delta={compareWithPrevious && prevStats.totalRevenue > 0 ? ((stats.totalRevenue - prevStats.totalRevenue) / prevStats.totalRevenue) * 100 : undefined}
          deltaPercent
          deltaLabel="vs. předch. období"
        />
        <StatCard
          title="Celkové náklady"
          value={`${stats.totalCosts.toFixed(2)} Kč`}
          icon="💸"
          delta={compareWithPrevious && prevStats.totalCosts > 0 ? ((stats.totalCosts - prevStats.totalCosts) / prevStats.totalCosts) * 100 : undefined}
          deltaPercent
          deltaLabel="vs. předch. období"
        />
        <StatCard
          title="Zisk"
          value={`${stats.profit.toFixed(2)} Kč`}
          icon="📈"
          color={stats.profit >= 0 ? "var(--accent)" : "rgba(239,68,68,0.9)"}
          delta={compareWithPrevious ? stats.profit - prevStats.profit : undefined}
          deltaLabel="vs. předch. období"
          deltaIsCurrency
        />
        <StatCard
          title="Průměrná cena"
          value={`${stats.averageTicketPrice.toFixed(2)} Kč`}
          icon="📊"
          delta={compareWithPrevious && prevStats.averageTicketPrice > 0 ? ((stats.averageTicketPrice - prevStats.averageTicketPrice) / prevStats.averageTicketPrice) * 100 : undefined}
          deltaPercent
          deltaLabel="vs. předch. období"
        />
        <StatCard
          title="Celkové slevy"
          value={`${stats.totalDiscounts.toFixed(2)} Kč`}
          icon="🎁"
        />
      </div>

      {/* Tabulka zakázek (režim Tabulka) */}
      {viewMode === "table" && (
        <div style={{ background: "var(--panel)", border, borderRadius: "var(--radius-lg)", padding: "var(--pad-24)", boxShadow: "var(--shadow-soft)", overflowX: "auto" }}>
          <h2 style={{ fontWeight: 700, fontSize: 18, color: "var(--text)", marginBottom: 16 }}>Zakázky v období</h2>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
            <thead>
              <tr style={{ borderBottom: "2px solid var(--border)", textAlign: "left" }}>
                <th style={{ padding: "10px 12px", color: "var(--muted)", fontWeight: 600 }}>Kód</th>
                <th style={{ padding: "10px 12px", color: "var(--muted)", fontWeight: 600 }}>Datum</th>
                <th style={{ padding: "10px 12px", color: "var(--muted)", fontWeight: 600 }}>Zákazník</th>
                <th style={{ padding: "10px 12px", color: "var(--muted)", fontWeight: 600 }}>Zařízení</th>
                <th style={{ padding: "10px 12px", color: "var(--muted)", fontWeight: 600 }}>Stav</th>
                <th style={{ padding: "10px 12px", color: "var(--muted)", fontWeight: 600 }}>Příjem</th>
              </tr>
            </thead>
            <tbody>
              {filteredTickets.slice(0, 100).map((t) => {
                const finalPrice = ticketRevenue(t);
                return (
                  <tr
                    key={t.id}
                    style={{
                      borderBottom: "1px solid var(--border)",
                      cursor: onOpenTicket ? "pointer" : undefined,
                    }}
                    onClick={() => onOpenTicket?.(t.id)}
                    onMouseEnter={(e) => {
                      if (onOpenTicket) e.currentTarget.style.background = "var(--panel-2)";
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.background = "";
                    }}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        onOpenTicket?.(t.id);
                      }
                    }}
                    role={onOpenTicket ? "button" : undefined}
                    tabIndex={onOpenTicket ? 0 : undefined}
                    title={onOpenTicket ? "Otevřít zakázku" : undefined}
                  >
                    <td style={{ padding: "10px 12px", color: "var(--text)", fontFamily: "ui-monospace" }}>{t.code ?? "—"}</td>
                    <td style={{ padding: "10px 12px", color: "var(--text)" }}>{t.createdAt ? new Date(t.createdAt).toLocaleDateString("cs-CZ") : "—"}</td>
                    <td style={{ padding: "10px 12px", color: "var(--text)" }}>{t.customerName || "—"}</td>
                    <td style={{ padding: "10px 12px", color: "var(--text)" }}>{t.deviceLabel || "—"}</td>
                    <td style={{ padding: "10px 12px", color: "var(--text)" }}>{t.status || "—"}</td>
                    <td style={{ padding: "10px 12px", color: "var(--accent)", fontWeight: 600 }}>{finalPrice > 0 ? `${finalPrice.toLocaleString("cs-CZ")} Kč` : "—"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {filteredTickets.length > 100 && (
            <div style={{ marginTop: 12, fontSize: 12, color: "var(--muted)" }}>Zobrazeno 100 z {filteredTickets.length} zakázek. Kliknutím na řádek otevřete zakázku.</div>
          )}
        </div>
      )}

      {/* Grafy (režim Grafy) – klik na pruh/měsíc filtruje data */}
      {viewMode === "charts" && (
        <>
          <div style={{ background: "var(--panel)", border, borderRadius: "var(--radius-lg)", padding: "var(--pad-24)", boxShadow: "var(--shadow-soft)" }}>
            <h2 style={{ fontWeight: 700, fontSize: 18, color: "var(--text)", marginBottom: 8 }}>Zakázky podle statusu</h2>
            <p style={{ fontSize: 12, color: "var(--muted)", marginBottom: 16 }}>Klikněte na řádek pro zobrazení pouze zakázek v daném statusu.</p>
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              {Object.entries(stats.byStatus).length === 0 ? (
                <div style={{ color: "var(--muted)", fontSize: 14 }}>Žádná data</div>
              ) : (
                Object.entries(stats.byStatus).map(([status, count]) => {
                  const isActive = drillDown?.type === "status" && drillDown.value === status;
                  return (
                    <button
                      key={status}
                      type="button"
                      onClick={() => setDrillDown((prev) => (prev?.type === "status" && prev.value === status ? null : { type: "status", value: status }))}
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 12,
                        width: "100%",
                        padding: 4,
                        border: "none",
                        borderRadius: 10,
                        background: isActive ? "var(--accent-soft)" : "transparent",
                        cursor: "pointer",
                        textAlign: "left",
                      }}
                      title={`Filtrovat: ${status} (${count} zakázek)`}
                    >
                      <span style={{ minWidth: 120, fontSize: 13, color: "var(--text)" }}>{status}</span>
                      <div style={{ flex: 1, height: 28, background: "var(--panel-2)", borderRadius: 8, overflow: "hidden", display: "flex" }}>
                        <div
                          style={{
                            width: `${(count / maxCount) * 100}%`,
                            minWidth: count > 0 ? 24 : 0,
                            height: "100%",
                            background: isActive ? "var(--accent)" : "var(--accent)",
                            borderRadius: 8,
                            transition: "width 0.3s ease",
                          }}
                        />
                      </div>
                      <span style={{ fontWeight: 700, fontSize: 14, color: "var(--text)", minWidth: 36 }}>{count}</span>
                    </button>
                  );
                })
              )}
            </div>
          </div>
          <div style={{ background: "var(--panel)", border, borderRadius: "var(--radius-lg)", padding: "var(--pad-24)", boxShadow: "var(--shadow-soft)" }}>
            <h2 style={{ fontWeight: 700, fontSize: 18, color: "var(--text)", marginBottom: 8 }}>Příjem podle měsíců</h2>
            <p style={{ fontSize: 12, color: "var(--muted)", marginBottom: 16 }}>Klikněte na sloupec pro zobrazení pouze zakázek v daném měsíci.</p>
            {stats.monthlyStats.length === 0 ? (
              <div style={{ color: "var(--muted)", fontSize: 14 }}>Žádná data pro vybrané období</div>
            ) : (
              <div style={{ display: "flex", alignItems: "flex-end", gap: 8, height: 200 }}>
                {stats.monthlyStats.map((m) => {
                  const isActive = drillDown?.type === "month" && drillDown.year === m.year && drillDown.month === m.monthIndex;
                  return (
                    <button
                      key={m.month}
                      type="button"
                      onClick={() =>
                        setDrillDown((prev) =>
                          prev?.type === "month" && prev.year === m.year && prev.month === m.monthIndex ? null : { type: "month", year: m.year, month: m.monthIndex }
                        )
                      }
                      style={{
                        flex: 1,
                        display: "flex",
                        flexDirection: "column",
                        alignItems: "center",
                        gap: 6,
                        border: "none",
                        background: "transparent",
                        cursor: "pointer",
                        padding: 0,
                      }}
                      title={`${m.month}: ${m.revenue.toLocaleString("cs-CZ")} Kč (${m.count} zakázek) – klik pro filtr`}
                    >
                      <div style={{ flex: 1, width: "100%", display: "flex", alignItems: "flex-end", justifyContent: "center" }}>
                        <div
                          style={{
                            width: "80%",
                            maxWidth: 48,
                            height: `${Math.max(4, (m.revenue / maxRevenue) * 100)}%`,
                            minHeight: 8,
                            background: isActive
                              ? "linear-gradient(180deg, var(--accent), var(--accent-hover))"
                              : "linear-gradient(180deg, var(--accent), var(--accent-hover))",
                            borderRadius: "8px 8px 0 0",
                            transition: "height 0.3s ease",
                            boxShadow: isActive ? "0 0 0 2px var(--accent)" : undefined,
                          }}
                        />
                      </div>
                      <span style={{ fontSize: 11, color: "var(--muted)", whiteSpace: "nowrap", transform: "rotate(-12deg)", transformOrigin: "top center" }}>{m.month}</span>
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        </>
      )}

      {/* Počty podle statusu (režim Karty) – klik filtruje */}
      {viewMode === "cards" && (
      <div
        style={{
          background: "var(--panel)",
          backdropFilter: "var(--blur)",
          WebkitBackdropFilter: "var(--blur)",
          border,
          borderRadius: "var(--radius-lg)",
          padding: "var(--pad-24)",
          boxShadow: "var(--shadow-soft)",
        }}
      >
        <h2 style={{ fontWeight: 700, fontSize: 18, color: "var(--text)", marginBottom: 8 }}>
          Zakázky podle statusu
        </h2>
        <p style={{ fontSize: 12, color: "var(--muted)", marginBottom: 16 }}>Klikněte na kartu pro zobrazení pouze zakázek v daném statusu.</p>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(150px, 1fr))", gap: 12 }}>
          {Object.entries(stats.byStatus).map(([status, count]) => {
            const isActive = drillDown?.type === "status" && drillDown.value === status;
            return (
              <button
                key={status}
                type="button"
                onClick={() => setDrillDown((prev) => (prev?.type === "status" && prev.value === status ? null : { type: "status", value: status }))}
                style={{
                  padding: 12,
                  borderRadius: 10,
                  background: isActive ? "var(--accent-soft)" : "var(--panel-2)",
                  border: isActive ? "2px solid var(--accent)" : "1px solid var(--border)",
                  cursor: "pointer",
                  textAlign: "left",
                }}
                title={`Filtrovat: ${status}`}
              >
                <div style={{ fontSize: 12, color: "var(--muted)", marginBottom: 4 }}>{status}</div>
                <div style={{ fontWeight: 700, fontSize: 20, color: "var(--text)" }}>{count}</div>
              </button>
            );
          })}
        </div>
      </div>
      )}

      {/* Nejčastější opravy a zařízení */}
      {viewMode !== "table" && (
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(300px, 1fr))", gap: 16 }}>
        <div
          style={{
            background: "var(--panel)",
            backdropFilter: "var(--blur)",
            WebkitBackdropFilter: "var(--blur)",
            border,
            borderRadius: "var(--radius-lg)",
            padding: "var(--pad-24)",
            boxShadow: "var(--shadow-soft)",
          }}
        >
          <h2 style={{ fontWeight: 700, fontSize: 18, color: "var(--text)", marginBottom: 8 }}>
            Nejčastější opravy
          </h2>
          <p style={{ fontSize: 12, color: "var(--muted)", marginBottom: 16 }}>Klikněte pro zobrazení pouze zakázek s touto opravou.</p>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {stats.topRepairs.length > 0 ? (
              stats.topRepairs.map((repair, idx) => {
                const isActive = drillDown?.type === "repair" && drillDown.value === repair.name;
                return (
                  <button
                    key={repair.name}
                    type="button"
                    onClick={() => setDrillDown((prev) => (prev?.type === "repair" && prev.value === repair.name ? null : { type: "repair", value: repair.name }))}
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      alignItems: "center",
                      padding: 10,
                      borderRadius: 8,
                      background: isActive ? "var(--accent-soft)" : "var(--panel-2)",
                      border: isActive ? "2px solid var(--accent)" : "1px solid var(--border)",
                      cursor: "pointer",
                      textAlign: "left",
                      width: "100%",
                    }}
                    title={`Filtrovat: ${repair.name}`}
                  >
                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <span style={{ fontSize: 16 }}>{idx + 1 === 1 ? "🥇" : idx + 1 === 2 ? "🥈" : idx + 1 === 3 ? "🥉" : "•"}</span>
                      <span style={{ fontWeight: 600, color: "var(--text)" }}>{repair.name}</span>
                    </div>
                    <span style={{ fontWeight: 700, color: "var(--accent)" }}>{repair.count}x</span>
                  </button>
                );
              })
            ) : (
              <div style={{ color: "var(--muted)", fontSize: 14, textAlign: "center", padding: 20 }}>
                Žádné opravy
              </div>
            )}
          </div>
        </div>

        <div
          style={{
            background: "var(--panel)",
            backdropFilter: "var(--blur)",
            WebkitBackdropFilter: "var(--blur)",
            border,
            borderRadius: "var(--radius-lg)",
            padding: "var(--pad-24)",
            boxShadow: "var(--shadow-soft)",
          }}
        >
          <h2 style={{ fontWeight: 700, fontSize: 18, color: "var(--text)", marginBottom: 8 }}>
            Nejčastější zařízení
          </h2>
          <p style={{ fontSize: 12, color: "var(--muted)", marginBottom: 16 }}>Klikněte pro zobrazení pouze zakázek s tímto zařízením.</p>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {stats.topDevices.length > 0 ? (
              stats.topDevices.map((device, idx) => {
                const isActive = drillDown?.type === "device" && drillDown.value === device.name;
                return (
                  <button
                    key={device.name}
                    type="button"
                    onClick={() => setDrillDown((prev) => (prev?.type === "device" && prev.value === device.name ? null : { type: "device", value: device.name }))}
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      alignItems: "center",
                      padding: 10,
                      borderRadius: 8,
                      background: isActive ? "var(--accent-soft)" : "var(--panel-2)",
                      border: isActive ? "2px solid var(--accent)" : "1px solid var(--border)",
                      cursor: "pointer",
                      textAlign: "left",
                      width: "100%",
                    }}
                    title={`Filtrovat: ${device.name}`}
                  >
                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <span style={{ fontSize: 16 }}>{idx + 1 === 1 ? "🥇" : idx + 1 === 2 ? "🥈" : idx + 1 === 3 ? "🥉" : "•"}</span>
                      <span style={{ fontWeight: 600, color: "var(--text)" }}>{device.name}</span>
                    </div>
                    <span style={{ fontWeight: 700, color: "var(--accent)" }}>{device.count}x</span>
                  </button>
                );
              })
            ) : (
              <div style={{ color: "var(--muted)", fontSize: 14, textAlign: "center", padding: 20 }}>
                Žádná zařízení
              </div>
            )}
          </div>
        </div>
      </div>
      )}

      {/* Měsíční statistiky (režim Karty) – klik filtruje podle měsíce */}
      {viewMode === "cards" && (
      <div
        style={{
          background: "var(--panel)",
          backdropFilter: "var(--blur)",
          WebkitBackdropFilter: "var(--blur)",
          border,
          borderRadius: "var(--radius-lg)",
          padding: "var(--pad-24)",
          boxShadow: "var(--shadow-soft)",
        }}
      >
        <h2 style={{ fontWeight: 700, fontSize: 18, color: "var(--text)", marginBottom: 8 }}>
          Měsíční přehled
        </h2>
        <p style={{ fontSize: 12, color: "var(--muted)", marginBottom: 16 }}>Klikněte na měsíc pro zobrazení pouze zakázek v daném měsíci.</p>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 12 }}>
          {stats.monthlyStats.map((month) => {
            const isActive = drillDown?.type === "month" && drillDown.year === month.year && drillDown.month === month.monthIndex;
            return (
              <button
                key={month.month}
                type="button"
                onClick={() =>
                  setDrillDown((prev) =>
                    prev?.type === "month" && prev.year === month.year && prev.month === month.monthIndex ? null : { type: "month", year: month.year, month: month.monthIndex }
                  )
                }
                style={{
                  padding: 16,
                  borderRadius: 10,
                  background: isActive ? "var(--accent-soft)" : "var(--panel-2)",
                  border: isActive ? "2px solid var(--accent)" : "1px solid var(--border)",
                  cursor: "pointer",
                  textAlign: "left",
                }}
                title={`Filtrovat: ${month.month}`}
              >
                <div style={{ fontSize: 12, color: "var(--muted)", marginBottom: 8 }}>{month.month}</div>
                <div style={{ fontWeight: 700, fontSize: 18, color: "var(--text)", marginBottom: 4 }}>{month.count} zakázek</div>
                <div style={{ fontSize: 14, color: "var(--accent)", fontWeight: 600 }}>{month.revenue.toFixed(2)} Kč</div>
              </button>
            );
          })}
        </div>
      </div>
      )}
        </>
      )}
    </div>
  );
}

function StatCard({
  title,
  value,
  icon,
  color,
  delta,
  deltaPercent,
  deltaLabel,
  deltaIsCurrency,
}: {
  title: string;
  value: string | number;
  icon: string;
  color?: string;
  delta?: number;
  deltaPercent?: boolean;
  deltaLabel?: string;
  deltaIsCurrency?: boolean;
}) {
  const deltaStr =
    delta !== undefined && delta !== null
      ? deltaPercent
        ? `${delta >= 0 ? "+" : ""}${delta.toFixed(1)} %`
        : deltaIsCurrency
          ? `${delta >= 0 ? "+" : ""}${delta.toFixed(2)} Kč`
          : `${delta >= 0 ? "+" : ""}${delta}`
      : null;
  const deltaUp = delta !== undefined && delta > 0;
  const deltaDown = delta !== undefined && delta < 0;
  const deltaColor = deltaUp ? "var(--accent)" : deltaDown ? "rgba(239,68,68,0.9)" : "var(--muted)";

  return (
    <div
      style={{
        background: "var(--panel)",
        backdropFilter: "var(--blur)",
        WebkitBackdropFilter: "var(--blur)",
        border: "1px solid var(--border)",
        borderRadius: "var(--radius-lg)",
        padding: "var(--pad-24)",
        boxShadow: "var(--shadow-soft)",
        flex: "1 1 200px",
        minWidth: 0,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 8 }}>
        <span style={{ fontSize: 24 }}>{icon}</span>
        <div style={{ fontSize: 12, color: "var(--muted)", fontWeight: 600 }}>{title}</div>
      </div>
      <div
        style={{
          fontWeight: 800,
          fontSize: 28,
          color: color || "var(--text)",
          lineHeight: 1.2,
        }}
      >
        {value}
      </div>
      {deltaStr && deltaLabel && (
        <div style={{ marginTop: 6, fontSize: 12, color: deltaColor, fontWeight: 600 }}>
          {deltaStr} {deltaLabel}
        </div>
      )}
    </div>
  );
}

