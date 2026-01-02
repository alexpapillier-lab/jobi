import { useMemo, useState, useRef, useEffect, useLayoutEffect } from "react";
import { createPortal } from "react-dom";
import { MOCK_TICKETS, type Ticket } from "../mock/tickets";

const TICKETS_STORAGE_KEY = "jobsheet_tickets_v1";

type TicketEx = Ticket & {
  performedRepairs?: Array<{
    id: string;
    name: string;
    price?: number;
    costs?: number;
  }>;
  discountType?: "percentage" | "amount" | null;
  discountValue?: number;
};

function safeLoadTickets(): TicketEx[] {
  try {
    const raw = localStorage.getItem(TICKETS_STORAGE_KEY);
    if (!raw) return MOCK_TICKETS as TicketEx[];
    return JSON.parse(raw) as TicketEx[];
  } catch {
    return MOCK_TICKETS as TicketEx[];
  }
}

type PeriodType = "all" | "today" | "week" | "month" | "quarter" | "year" | "custom";

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

export default function Statistics() {
  const allTickets = useMemo(() => safeLoadTickets(), []);
  const [periodType, setPeriodType] = useState<PeriodType>("all");
  const [customStartDate, setCustomStartDate] = useState<string>("");
  const [customEndDate, setCustomEndDate] = useState<string>("");

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

  // Základní statistiky
  const stats = useMemo(() => {
    const totalTickets = tickets.length;
    
    // Počty podle statusu
    const byStatus: Record<string, number> = {};
    tickets.forEach((t) => {
      const status = t.status || "unknown";
      byStatus[status] = (byStatus[status] || 0) + 1;
    });

    // Finanční statistiky
    let totalRevenue = 0;
    let totalCosts = 0;
    let totalDiscounts = 0;
    const ticketPrices: number[] = [];

    tickets.forEach((t) => {
      const repairs = t.performedRepairs || [];
      const ticketPrice = repairs.reduce((sum, r) => sum + (r.price || 0), 0);
      
      // Sleva
      let discountAmount = 0;
      if (t.discountType === "percentage") {
        discountAmount = (ticketPrice * (t.discountValue || 0)) / 100;
      } else if (t.discountType === "amount") {
        discountAmount = t.discountValue || 0;
      }
      
      const finalPrice = Math.max(0, ticketPrice - discountAmount);
      totalRevenue += finalPrice;
      totalDiscounts += discountAmount;
      
      const ticketCosts = repairs.reduce((sum, r) => sum + (r.costs || 0), 0);
      totalCosts += ticketCosts;
      
      if (finalPrice > 0) {
        ticketPrices.push(finalPrice);
      }
    });

    const averageTicketPrice = ticketPrices.length > 0 
      ? ticketPrices.reduce((sum, p) => sum + p, 0) / ticketPrices.length 
      : 0;

    // Nejčastější opravy
    const repairCounts: Record<string, number> = {};
    tickets.forEach((t) => {
      (t.performedRepairs || []).forEach((r) => {
        repairCounts[r.name] = (repairCounts[r.name] || 0) + 1;
      });
    });
    const topRepairs = Object.entries(repairCounts)
      .sort(([, a], [, b]) => b - a)
      .slice(0, 5)
      .map(([name, count]) => ({ name, count }));

    // Nejčastější zařízení
    const deviceCounts: Record<string, number> = {};
    tickets.forEach((t) => {
      if (t.deviceLabel) {
        deviceCounts[t.deviceLabel] = (deviceCounts[t.deviceLabel] || 0) + 1;
      }
    });
    const topDevices = Object.entries(deviceCounts)
      .sort(([, a], [, b]) => b - a)
      .slice(0, 5)
      .map(([name, count]) => ({ name, count }));

    // Statistiky podle měsíců - dynamicky podle vybraného období
    const monthlyStats: Array<{ month: string; count: number; revenue: number }> = [];
    
    if (tickets.length > 0) {
      // Najdeme rozsah dat v tickets
      const dates = tickets.map((t) => new Date(t.createdAt)).sort((a, b) => a.getTime() - b.getTime());
      const firstDate = dates[0];
      const lastDate = dates[dates.length - 1];
      
      // Počítáme měsíce v rozsahu
      const startMonth = new Date(firstDate.getFullYear(), firstDate.getMonth(), 1);
      const endMonth = new Date(lastDate.getFullYear(), lastDate.getMonth(), 1);
      
      let currentMonth = new Date(startMonth);
      while (currentMonth <= endMonth) {
        const monthLabel = currentMonth.toLocaleDateString("cs-CZ", { month: "short", year: "numeric" });
        
        const monthTickets = tickets.filter((t) => {
          const ticketDate = new Date(t.createdAt);
          return (
            ticketDate.getFullYear() === currentMonth.getFullYear() &&
            ticketDate.getMonth() === currentMonth.getMonth()
          );
        });

        const monthRevenue = monthTickets.reduce((sum, t) => {
          const repairs = t.performedRepairs || [];
          const ticketPrice = repairs.reduce((s, r) => s + (r.price || 0), 0);
          let discountAmount = 0;
          if (t.discountType === "percentage") {
            discountAmount = (ticketPrice * (t.discountValue || 0)) / 100;
          } else if (t.discountType === "amount") {
            discountAmount = t.discountValue || 0;
          }
          return sum + Math.max(0, ticketPrice - discountAmount);
        }, 0);

        monthlyStats.push({
          month: monthLabel,
          count: monthTickets.length,
          revenue: monthRevenue,
        });
        
        // Přesuneme se na další měsíc
        currentMonth = new Date(currentMonth.getFullYear(), currentMonth.getMonth() + 1, 1);
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
  }, [tickets]);

  const border = "1px solid var(--border)";

  return (
    <div
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
            Přehled zakázek, příjmů a výkonnosti
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
        
        {/* Výběr časového období */}
        <div style={{ display: "flex", flexDirection: "column", gap: 8, minWidth: 250 }}>
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

      {/* Hlavní statistiky */}
      <div style={{ display: "flex", flexWrap: "wrap", gap: 16 }}>
        <StatCard
          title="Celkem zakázek"
          value={stats.totalTickets}
          icon="📋"
        />
        <StatCard
          title="Celkový příjem"
          value={`${stats.totalRevenue.toFixed(2)} Kč`}
          icon="💰"
        />
        <StatCard
          title="Celkové náklady"
          value={`${stats.totalCosts.toFixed(2)} Kč`}
          icon="💸"
        />
        <StatCard
          title="Zisk"
          value={`${stats.profit.toFixed(2)} Kč`}
          icon="📈"
          color={stats.profit >= 0 ? "var(--accent)" : "rgba(239,68,68,0.9)"}
        />
        <StatCard
          title="Průměrná cena"
          value={`${stats.averageTicketPrice.toFixed(2)} Kč`}
          icon="📊"
        />
        <StatCard
          title="Celkové slevy"
          value={`${stats.totalDiscounts.toFixed(2)} Kč`}
          icon="🎁"
        />
      </div>

      {/* Počty podle statusu */}
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
        <h2 style={{ fontWeight: 700, fontSize: 18, color: "var(--text)", marginBottom: 16 }}>
          Zakázky podle statusu
        </h2>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(150px, 1fr))", gap: 12 }}>
          {Object.entries(stats.byStatus).map(([status, count]) => (
            <div
              key={status}
              style={{
                padding: 12,
                borderRadius: 10,
                background: "var(--panel-2)",
                border: "1px solid var(--border)",
              }}
            >
              <div style={{ fontSize: 12, color: "var(--muted)", marginBottom: 4 }}>
                {status}
              </div>
              <div style={{ fontWeight: 700, fontSize: 20, color: "var(--text)" }}>
                {count}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Nejčastější opravy a zařízení */}
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
          <h2 style={{ fontWeight: 700, fontSize: 18, color: "var(--text)", marginBottom: 16 }}>
            Nejčastější opravy
          </h2>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {stats.topRepairs.length > 0 ? (
              stats.topRepairs.map((repair, idx) => (
                <div
                  key={repair.name}
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                    padding: 10,
                    borderRadius: 8,
                    background: "var(--panel-2)",
                    border: "1px solid var(--border)",
                  }}
                >
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <span style={{ fontSize: 16 }}>{idx + 1 === 1 ? "🥇" : idx + 1 === 2 ? "🥈" : idx + 1 === 3 ? "🥉" : "•"}</span>
                    <span style={{ fontWeight: 600, color: "var(--text)" }}>{repair.name}</span>
                  </div>
                  <span style={{ fontWeight: 700, color: "var(--accent)" }}>{repair.count}x</span>
                </div>
              ))
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
          <h2 style={{ fontWeight: 700, fontSize: 18, color: "var(--text)", marginBottom: 16 }}>
            Nejčastější zařízení
          </h2>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {stats.topDevices.length > 0 ? (
              stats.topDevices.map((device, idx) => (
                <div
                  key={device.name}
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                    padding: 10,
                    borderRadius: 8,
                    background: "var(--panel-2)",
                    border: "1px solid var(--border)",
                  }}
                >
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <span style={{ fontSize: 16 }}>{idx + 1 === 1 ? "🥇" : idx + 1 === 2 ? "🥈" : idx + 1 === 3 ? "🥉" : "•"}</span>
                    <span style={{ fontWeight: 600, color: "var(--text)" }}>{device.name}</span>
                  </div>
                  <span style={{ fontWeight: 700, color: "var(--accent)" }}>{device.count}x</span>
                </div>
              ))
            ) : (
              <div style={{ color: "var(--muted)", fontSize: 14, textAlign: "center", padding: 20 }}>
                Žádná zařízení
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Měsíční statistiky */}
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
        <h2 style={{ fontWeight: 700, fontSize: 18, color: "var(--text)", marginBottom: 16 }}>
          Měsíční přehled
        </h2>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 12 }}>
          {stats.monthlyStats.map((month) => (
            <div
              key={month.month}
              style={{
                padding: 16,
                borderRadius: 10,
                background: "var(--panel-2)",
                border: "1px solid var(--border)",
              }}
            >
              <div style={{ fontSize: 12, color: "var(--muted)", marginBottom: 8 }}>
                {month.month}
              </div>
              <div style={{ fontWeight: 700, fontSize: 18, color: "var(--text)", marginBottom: 4 }}>
                {month.count} zakázek
              </div>
              <div style={{ fontSize: 14, color: "var(--accent)", fontWeight: 600 }}>
                {month.revenue.toFixed(2)} Kč
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function StatCard({
  title,
  value,
  icon,
  color,
}: {
  title: string;
  value: string | number;
  icon: string;
  color?: string;
}) {
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
    </div>
  );
}

