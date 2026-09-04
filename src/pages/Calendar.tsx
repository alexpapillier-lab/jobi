import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Button, PageHeader, Segmented } from "../components/ui";
import { showToast } from "../components/Toast";
import { supabase } from "../lib/supabaseClient";
import { fetchAllPages } from "../lib/fetchAllPages";
import { reportError } from "../lib/reportError";
import { useStatuses } from "../state/StatusesStore";
import { useIsNarrow } from "../hooks/useIsNarrow";
import { mapSupabaseTicketToTicketEx, type TicketEx } from "./Orders";
import type { WarrantyClaimRow } from "./Orders/hooks/useWarrantyClaims";
import { Agenda } from "./Calendar/Agenda";
import { Timeline } from "./Calendar/Timeline";
import {
  addDays,
  computeTimelineRange,
  formatTimelineRangeLabel,
  isActive,
  isOverdue,
  pluralTerminy,
  readStoredMainView,
  startOfWeek,
  storeMainView,
  type CalendarItem,
  type MainView,
  type TimelineView,
} from "./Calendar/model";

/**
 * Kalendář – kontejner.
 *
 * Načte zakázky a reklamace služby, převede je na společné položky
 * (`CalendarItem`) a podle zvoleného pohledu je předá agendě nebo časové
 * ose. Sám drží jen to, co potřebují obě části: filtr statusů, „teď“
 * a zápis změněného termínu.
 */

type CalendarProps = {
  activeServiceId: string | null;
  onOpenTicket: (ticketId: string) => void;
  onOpenClaim: (claimId: string) => void;
};

function toDate(v: unknown): Date | null {
  if (typeof v !== "string" || !v) return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
}

export default function Calendar({ activeServiceId, onOpenTicket, onOpenClaim }: CalendarProps) {
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

  const [mainView, setMainViewState] = useState<MainView>(readStoredMainView);
  const setMainView = useCallback((v: MainView) => {
    setMainViewState(v);
    storeMainView(v);
  }, []);
  const [timelineView, setTimelineView] = useState<TimelineView>("week");
  const [baseDate, setBaseDate] = useState(() => new Date());

  /** Prázdná množina = zobrazit vše; neprázdná = filtr na vybrané statusy */
  const [selectedStatusKeys, setSelectedStatusKeys] = useState<Set<string>>(new Set());
  const [statusFilterOpen, setStatusFilterOpen] = useState(false);
  const filterAnchorRef = useRef<HTMLSpanElement>(null);
  const [filterDropdownRect, setFilterDropdownRect] = useState<{ top: number; left: number } | null>(null);
  const hasInitializedFilter = useRef(false);

  const isNarrow = useIsNarrow();

  // „Teď“ se obnovuje po minutě, aby „o 5 h“ a červená čára nezamrzly.
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = window.setInterval(() => setNow(new Date()), 60_000);
    return () => window.clearInterval(id);
  }, []);

  useEffect(() => {
    if (statuses.length > 0 && !hasInitializedFilter.current) {
      hasInitializedFilter.current = true;
      const nonFinalKeys = statuses.filter((s) => !s.isFinal).map((s) => s.key);
      if (nonFinalKeys.length > 0) setSelectedStatusKeys(new Set(nonFinalKeys));
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
        const { data: tData, error: tErr } = await fetchAllPages((from, to) =>
          (supabase!.from("tickets") as any)
            .select("*")
            .eq("service_id", activeServiceId)
            .is("deleted_at", null)
            .order("created_at", { ascending: false })
            .order("id", { ascending: false })
            .range(from, to)
        );
        if (tErr) throw tErr;

        const { data: cData, error: cErr } = await fetchAllPages((from, to) =>
          (supabase!.from("warranty_claims") as any)
            .select("*")
            .eq("service_id", activeServiceId)
            .order("created_at", { ascending: false })
            .order("id", { ascending: false })
            .range(from, to)
        );
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

  /* ---------- Položky ---------- */

  const allItems = useMemo((): CalendarItem[] => {
    const out: CalendarItem[] = [];
    const fallbackNow = new Date();

    for (const t of tickets) {
      const st = normalizeStatus((t.status as string) ?? "");
      const meta = st !== null ? getByKey(st) : undefined;
      out.push({
        type: "ticket",
        id: t.id,
        code: t.code || "—",
        deviceLabel: t.deviceLabel || "—",
        issue: (t.requestedRepair || t.issueShort || "").toString().slice(0, 80) || "—",
        customerName: t.customerName || "—",
        createdAt: toDate(t.createdAt) ?? fallbackNow,
        expectedAt: toDate((t as any).expected_completion_at),
        completedAt: toDate((t as any).completed_at),
        statusKey: st,
        statusLabel: meta?.label ?? String(t.status ?? "—"),
        statusBg: meta?.bg,
        isFinal: st !== null && isFinal(st),
        isClaim: false,
      });
    }

    for (const c of claims) {
      const st = normalizeStatus((c.status as string) ?? "");
      const meta = st !== null ? getByKey(st) : undefined;
      out.push({
        type: "claim",
        id: c.id,
        code: c.code || "—",
        deviceLabel: c.device_label || "—",
        issue: (c.notes || "").toString().slice(0, 80) || "—",
        customerName: c.customer_name || "—",
        createdAt: toDate(c.created_at) ?? fallbackNow,
        expectedAt: toDate(c.expected_completion_at),
        completedAt: toDate(c.completed_at),
        statusKey: st,
        statusLabel: meta?.label ?? String(c.status ?? "—"),
        statusBg: meta?.bg,
        isFinal: st !== null && isFinal(st),
        isClaim: true,
      });
    }
    return out;
  }, [tickets, claims, normalizeStatus, getByKey, isFinal]);

  const filteredItems = useMemo(() => {
    if (selectedStatusKeys.size === 0) return allItems;
    return allItems.filter((i) => i.statusKey !== null && selectedStatusKeys.has(i.statusKey));
  }, [allItems, selectedStatusKeys]);

  const subtitle = useMemo(() => {
    const weekStart = startOfWeek(now);
    const weekEnd = addDays(weekStart, 7);
    let thisWeek = 0;
    let overdue = 0;
    for (const item of filteredItems) {
      if (!isActive(item)) continue;
      if (isOverdue(item, now)) overdue += 1;
      const at = item.expectedAt;
      if (at && at >= weekStart && at < weekEnd) thisWeek += 1;
    }
    const parts = [`${pluralTerminy(thisWeek)} tento týden`];
    if (overdue > 0) parts.push(`${overdue} po termínu`);
    return parts.join(" · ");
  }, [filteredItems, now]);

  /* ---------- Změna termínu ---------- */

  const rescheduleItem = useCallback(
    async (item: CalendarItem, iso: string | null) => {
      if (!supabase || !activeServiceId) return;
      const table = item.type === "claim" ? "warranty_claims" : "tickets";

      // Optimisticky – řádek v agendě přeskočí do správné skupiny hned.
      // Původní hodnota se bere z položky, ne z updateru setState – ten
      // React spouští až při vykreslení, takže by tu ještě nebyla.
      const previous: string | null = item.expectedAt ? item.expectedAt.toISOString() : null;
      const apply = (v: string | null) => {
        if (item.type === "ticket") {
          setTickets((prev) =>
            prev.map((t) => {
              if (t.id !== item.id) return t;
              const next = { ...t } as TicketEx;
              (next as any).expected_completion_at = v;
              return next;
            })
          );
        } else {
          setClaims((prev) => prev.map((c) => (c.id === item.id ? { ...c, expected_completion_at: v } : c)));
        }
      };
      apply(iso);

      const revert = () => apply(previous);

      try {
        const { error: updErr } = await (supabase.from(table) as any)
          .update({ expected_completion_at: iso })
          .eq("id", item.id)
          .eq("service_id", activeServiceId);
        if (updErr) throw updErr;
        showToast("Termín změněn");
      } catch (e) {
        revert();
        reportError({
          code: "calendar.reschedule_failed",
          error: e,
          userMessage: "Termín se nepodařilo změnit.",
          source: "Calendar.rescheduleItem",
          serviceId: activeServiceId,
          context: { table, itemId: item.id },
        });
      }
    },
    [activeServiceId]
  );

  const openItem = useCallback(
    (item: CalendarItem) => (item.type === "claim" ? onOpenClaim(item.id) : onOpenTicket(item.id)),
    [onOpenClaim, onOpenTicket]
  );

  /* ---------- Navigace časové osy ---------- */

  const shiftBase = useCallback(
    (dir: -1 | 1) => {
      setBaseDate((d) => {
        const next = new Date(d);
        if (timelineView === "day") next.setDate(next.getDate() + dir);
        else if (timelineView === "week") next.setDate(next.getDate() + dir * 7);
        else next.setMonth(next.getMonth() + dir);
        return next;
      });
    },
    [timelineView]
  );

  const rangeLabel = useMemo(() => {
    const { rangeStart, rangeEnd } = computeTimelineRange(timelineView, baseDate);
    return formatTimelineRangeLabel(timelineView, rangeStart, rangeEnd);
  }, [timelineView, baseDate]);

  useLayoutEffect(() => {
    if (!statusFilterOpen || !filterAnchorRef.current) {
      setFilterDropdownRect(null);
      return;
    }
    const rect = filterAnchorRef.current.getBoundingClientRect();
    const dropdownWidth = 240;
    let left = rect.right - dropdownWidth;
    if (left + dropdownWidth > window.innerWidth - 12) left = window.innerWidth - dropdownWidth - 12;
    if (left < 12) left = 12;
    setFilterDropdownRect({ top: rect.bottom + 6, left });
  }, [statusFilterOpen]);

  /* ---------- Stavy stránky ---------- */

  if (!activeServiceId) {
    return <div style={{ padding: 24, color: "var(--muted)", textAlign: "center" }}>Vyberte službu v postranním panelu.</div>;
  }
  if (loading) {
    return <div style={{ padding: 24, color: "var(--muted)", textAlign: "center" }}>Načítání kalendáře…</div>;
  }
  if (error) {
    return <div style={{ padding: 24, color: "var(--danger)", textAlign: "center" }}>{error}</div>;
  }

  const hasStatusFilter = selectedStatusKeys.size > 0;

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
      {/* Hlavička + ovládání v jedné řadě */}
      <div
        style={{
          padding: isNarrow ? "12px" : "14px 20px",
          borderBottom: "1px solid var(--border)",
          background: "var(--panel)",
        }}
      >
        <PageHeader
          title="Kalendář"
          subtitle={subtitle}
          actions={
            <>
              <Segmented
                ariaLabel="Pohled"
                size="sm"
                value={mainView}
                onChange={setMainView}
                options={[
                  { value: "agenda", label: "Agenda" },
                  { value: "timeline", label: "Časová osa" },
                ]}
              />

              {mainView === "timeline" && (
                <>
                  <span style={{ display: "inline-flex", alignItems: "center", gap: "var(--space-1)" }}>
                    <Button size="sm" variant="soft" iconOnly aria-label="Předchozí období" onClick={() => shiftBase(-1)} icon={<span aria-hidden="true" style={{ fontSize: "var(--text-lg)", lineHeight: 1 }}>‹</span>} />
                    <Button size="sm" variant="soft" onClick={() => setBaseDate(new Date())}>Dnes</Button>
                    <Button size="sm" variant="soft" iconOnly aria-label="Další období" onClick={() => shiftBase(1)} icon={<span aria-hidden="true" style={{ fontSize: "var(--text-lg)", lineHeight: 1 }}>›</span>} />
                  </span>
                  <span
                    style={{
                      fontWeight: 700,
                      fontSize: "var(--text-base)",
                      color: "var(--text)",
                      // Pevná šířka na širokém displeji, aby při listování týdny neposkakovala tlačítka vedle.
                      minWidth: isNarrow ? 0 : 200,
                      whiteSpace: "nowrap",
                    }}
                  >
                    {rangeLabel}
                  </span>
                  <Segmented
                    ariaLabel="Měřítko časové osy"
                    size="sm"
                    value={timelineView}
                    onChange={setTimelineView}
                    options={[
                      { value: "day", label: "Den" },
                      { value: "week", label: "Týden" },
                      { value: "month", label: "Měsíc" },
                    ]}
                  />
                </>
              )}

              <span ref={filterAnchorRef} style={{ display: "inline-flex" }}>
              <Button
                size="sm"
                variant={statusFilterOpen ? "primary" : "soft"}
                aria-expanded={statusFilterOpen}
                aria-haspopup="dialog"
                onClick={() => setStatusFilterOpen((o) => !o)}
              >
                Filtr statusů
                {hasStatusFilter && (
                  <span
                    style={{
                      background: statusFilterOpen ? "rgba(255,255,255,0.25)" : "var(--accent)",
                      color: "white",
                      padding: "0 6px",
                      borderRadius: "var(--radius-2xs)",
                      fontSize: "var(--text-xs)",
                      lineHeight: "16px",
                    }}
                  >
                    {selectedStatusKeys.size}
                  </span>
                )}
              </Button>
              </span>
            </>
          }
        />
      </div>

      {/* Obsah */}
      {mainView === "agenda" ? (
        <div style={{ flex: 1, overflow: "auto", minHeight: 0 }}>
          <Agenda items={filteredItems} now={now} isNarrow={isNarrow} onOpen={openItem} onReschedule={rescheduleItem} />
        </div>
      ) : (
        <Timeline
          items={filteredItems}
          view={timelineView}
          baseDate={baseDate}
          now={now}
          isNarrow={isNarrow}
          hasStatusFilter={hasStatusFilter}
          onOpen={openItem}
        />
      )}

      {/* Filtr statusů */}
      {statusFilterOpen &&
        createPortal(
          <>
            <div role="presentation" style={{ position: "fixed", inset: 0, zIndex: 9998 }} onClick={() => setStatusFilterOpen(false)} />
            <div
              role="dialog"
              aria-label="Filtr statusů"
              style={{
                position: "fixed",
                top: filterDropdownRect?.top ?? 0,
                left: filterDropdownRect?.left ?? 0,
                zIndex: 9999,
                width: 240,
                padding: "var(--space-3)",
                background: "var(--panel)",
                border: "1px solid var(--border)",
                borderRadius: "var(--radius-sm)",
                boxShadow: "0 8px 24px rgba(0,0,0,0.12)",
                visibility: filterDropdownRect ? "visible" : "hidden",
              }}
            >
              <div style={{ fontSize: "var(--text-xs)", fontWeight: 700, color: "var(--muted)", marginBottom: "var(--space-2)", textTransform: "uppercase", letterSpacing: "0.04em" }}>
                Zobrazit statusy
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 2, maxHeight: 260, overflowY: "auto" }}>
                {statuses.map((s) => {
                  const checked = selectedStatusKeys.size === 0 || selectedStatusKeys.has(s.key);
                  return (
                    <label
                      key={s.key}
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: "var(--space-2)",
                        fontSize: "var(--text-base)",
                        color: "var(--text)",
                        cursor: "pointer",
                        padding: "4px 6px",
                        borderRadius: "var(--radius-2xs)",
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
              <div style={{ display: "flex", gap: "var(--space-2)", marginTop: "var(--space-2)", paddingTop: "var(--space-2)", borderTop: "1px solid var(--border)" }}>
                <Button size="sm" variant="soft" style={{ flex: 1 }} onClick={() => setSelectedStatusKeys(new Set())}>
                  Všechny
                </Button>
                <Button size="sm" variant="soft" style={{ flex: 1 }} onClick={() => setSelectedStatusKeys(new Set(statuses.map((s) => s.key)))}>
                  Vybrat vše
                </Button>
              </div>
            </div>
          </>,
          document.body
        )}
    </div>
  );
}
