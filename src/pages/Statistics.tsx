import { useCallback, useEffect, useMemo, useState } from "react";
import { Button, Card, Input, PageHeader, Pill, Segmented, Selectable, Toolbar, ToolbarSpacer } from "../components/ui";
import { SectionHeading } from "../components/SectionHeading";
import {
  ClockIcon,
  CoinsIcon,
  DeviceIcon,
  DocumentIcon,
  DownloadIcon,
  GiftIcon,
  StatusIcon,
  TrendIcon,
  WrenchIcon,
  XIcon,
} from "../components/icons";
import { supabase } from "../lib/supabaseClient";
import { fetchAllPages } from "../lib/fetchAllPages";
import { nactiStatistiky, type StatistikyPrehled } from "../lib/statistikyServer";
import { mapSupabaseTicketToTicketEx, type TicketEx } from "./Orders";
import { useStatuses } from "../state/StatusesStore";
import { KpiTile, KpiTileSkeleton } from "./Statistics/KpiTile";
import { MonthlyChart, type MonthStat } from "./Statistics/MonthlyChart";
import { RankList } from "./Statistics/RankList";
import { StatusBars } from "./Statistics/StatusBars";
import { MarginList } from "./Statistics/MarginList";
import { useBranches, filterByBranch } from "../context/BranchContext";
import { marginByBranch, marginByService, type MarginRow } from "./Statistics/margin";
import { useEntitlements } from "../hooks/useEntitlements";
import {
  EMPTY_COST_SOURCES,
  marginByDevice,
  marginByRepair,
  marginPercent,
  ticketMargin,
  type CostSources,
} from "./Statistics/margin";
import { celeCislo, cislo, dny, formatCurrencyRounded, monthLabelLong, zakazky } from "./Statistics/format";

const TICKETS_SELECT =
  "id,service_id,code,title,status,notes,customer_id,customer_name,customer_phone,customer_email,customer_address_street,customer_address_city,customer_address_zip,customer_company,customer_ico,customer_info,device_serial,device_passcode,device_condition,device_note,external_id,handoff_method,estimated_price,performed_repairs,diagnostic_text,diagnostic_photos,diagnostic_photos_before,discount_type,discount_value,created_at,completed_at,updated_at,version";

type PeriodType = "all" | "today" | "week" | "month" | "quarter" | "year" | "custom";
type ViewMode = "cards" | "table" | "charts";

type DrillDown =
  | null
  | { type: "status"; value: string }
  | { type: "month"; year: number; month: number }
  | { type: "repair"; value: string }
  | { type: "device"; value: string };

type DrillFacet = Exclude<DrillDown, null>["type"];

/** Mapování z Orders.tsx přidává completed_at mimo typ TicketEx. */
type TicketWithCompletion = TicketEx & { completed_at?: string | null };

type DateRange = { start: Date; end: Date };

const PERIOD_OPTIONS: Array<{ value: PeriodType; label: string }> = [
  { value: "today", label: "Dnes" },
  { value: "week", label: "Týden" },
  { value: "month", label: "Měsíc" },
  { value: "quarter", label: "Kvartál" },
  { value: "year", label: "Rok" },
  { value: "all", label: "Vše" },
  { value: "custom", label: "Vlastní" },
];

/** Období, pro která má smysl „předchozí období“ (stejná délka, o krok dozadu). */
const COMPARABLE_PERIODS: PeriodType[] = ["today", "week", "month", "quarter", "year"];

// ========================
// Období
// ========================

function startOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate(), 0, 0, 0, 0);
}

function endOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate(), 23, 59, 59, 999);
}

/** Pondělí týdne, do kterého spadá `d`. */
function mondayOf(d: Date): Date {
  const day = d.getDay();
  const diff = d.getDate() - day + (day === 0 ? -6 : 1);
  return new Date(d.getFullYear(), d.getMonth(), diff, 0, 0, 0, 0);
}

function periodRange(period: PeriodType, customStart: string, customEnd: string, now: Date): DateRange | null {
  switch (period) {
    case "all":
      return null;
    case "today":
      return { start: startOfDay(now), end: endOfDay(now) };
    case "week":
      return { start: mondayOf(now), end: endOfDay(now) };
    case "month":
      return { start: new Date(now.getFullYear(), now.getMonth(), 1), end: endOfDay(now) };
    case "quarter": {
      const q = Math.floor(now.getMonth() / 3);
      return { start: new Date(now.getFullYear(), q * 3, 1), end: endOfDay(now) };
    }
    case "year":
      return { start: new Date(now.getFullYear(), 0, 1), end: endOfDay(now) };
    case "custom": {
      if (!customStart || !customEnd) return null;
      const start = new Date(customStart);
      const end = new Date(customEnd);
      if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return null;
      return { start: startOfDay(start), end: endOfDay(end) };
    }
    default:
      return null;
  }
}

/** Posun o celé měsíce; den v měsíci se ořízne na poslední den cílového měsíce (31. 3. → 28. 2.). */
function shiftMonths(d: Date, months: number): Date {
  const target = new Date(d.getFullYear(), d.getMonth() + months, 1, d.getHours(), d.getMinutes(), d.getSeconds(), d.getMilliseconds());
  const lastDay = new Date(target.getFullYear(), target.getMonth() + 1, 0).getDate();
  target.setDate(Math.min(d.getDate(), lastDay));
  return target;
}

function shiftDays(d: Date, days: number): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() + days, d.getHours(), d.getMinutes(), d.getSeconds(), d.getMilliseconds());
}

/**
 * Předchozí období stejné délky – včera, minulý týden do stejného dne,
 * minulý měsíc do stejného dne… Aktuální období běží jen „do dneška“, takže
 * porovnávat ho s celým minulým měsícem by vždy vycházelo v neprospěch.
 */
function previousPeriodRange(period: PeriodType, now: Date): DateRange | null {
  const current = periodRange(period, "", "", now);
  if (!current) return null;
  switch (period) {
    case "today":
      return { start: shiftDays(current.start, -1), end: shiftDays(current.end, -1) };
    case "week":
      return { start: shiftDays(current.start, -7), end: shiftDays(current.end, -7) };
    case "month":
      return { start: shiftMonths(current.start, -1), end: shiftMonths(current.end, -1) };
    case "quarter":
      return { start: shiftMonths(current.start, -3), end: shiftMonths(current.end, -3) };
    case "year":
      return { start: shiftMonths(current.start, -12), end: shiftMonths(current.end, -12) };
    default:
      return null;
  }
}

function inRange(t: TicketEx, range: DateRange): boolean {
  const d = new Date(t.createdAt);
  return d >= range.start && d <= range.end;
}

// ========================
// Výpočty
// ========================

/**
 * Náklady a marže zakázky podle definice v `Statistics/margin.ts`:
 * náklady oprav (vlastní, jinak z ceníku) + nákupní ceny navázaných dílů.
 */
type Kpis = {
  totalTickets: number;
  totalRevenue: number;
  totalCosts: number;
  totalDiscounts: number;
  /** Marže v Kč = Σ(příjem − náklady) − slevy. */
  profit: number;
  /** Marže v % z příjmu. */
  marginPct: number;
  /** Provedené opravy bez jakéhokoli zdroje nákladů. */
  entriesWithoutCost: number;
  /** Provedené opravy, u kterých některý díl nemá nákupní cenu. */
  entriesMissingPurchasePrice: number;
  averageTicketPrice: number;
  averageTicketDurationDays: number;
};

function computeKpis(list: TicketEx[], sources: CostSources): Kpis {
  let totalRevenue = 0;
  let totalCosts = 0;
  let totalDiscounts = 0;
  let profit = 0;
  let entriesWithoutCost = 0;
  let entriesMissingPurchasePrice = 0;
  let paidCount = 0;
  let durationSum = 0;
  let durationCount = 0;

  for (const t of list) {
    const m = ticketMargin(t, sources);
    const rev = m.revenue;
    totalRevenue += rev;
    totalCosts += m.cost;
    totalDiscounts += m.discount;
    profit += m.margin;
    entriesWithoutCost += m.entriesWithoutCost;
    entriesMissingPurchasePrice += m.entriesMissingPurchasePrice;
    if (rev > 0) paidCount += 1;

    const completedAt = (t as TicketWithCompletion).completed_at;
    if (completedAt && t.createdAt) {
      const ms = new Date(completedAt).getTime() - new Date(t.createdAt).getTime();
      if (ms > 0) {
        durationSum += ms / (24 * 60 * 60 * 1000);
        durationCount += 1;
      }
    }
  }

  return {
    totalTickets: list.length,
    totalRevenue,
    totalCosts,
    totalDiscounts,
    profit,
    marginPct: marginPercent(profit, totalRevenue),
    entriesWithoutCost,
    entriesMissingPurchasePrice,
    averageTicketPrice: paidCount > 0 ? totalRevenue / paidCount : 0,
    averageTicketDurationDays: durationCount > 0 ? durationSum / durationCount : 0,
  };
}

function topCounts(counts: Record<string, number>, limit: number): Array<{ name: string; count: number }> {
  return Object.entries(counts)
    .sort(([, a], [, b]) => b - a)
    .slice(0, limit)
    .map(([name, count]) => ({ name, count }));
}

function formatDuration(days: number): string {
  if (days <= 0) return "—";
  if (days < 1) return `${Math.round(days * 24)} h`;
  return dny(Number(days.toFixed(1)));
}

/**
 * Doplní do měsíční řady prázdné měsíce.
 *
 * Osa jde od začátku období (nebo od první zakázky) po dnešek (nebo konec
 * období) – prázdné měsíce jsou informace sama o sobě a bez nich by graf
 * tvářil, že se pracovalo pořád stejně.
 */
function doplnPrazdneMesice(
  sData: MonthStat[],
  minTime: number,
  maxTime: number,
  range: DateRange | null,
  now: Date
): MonthStat[] {
  if (sData.length === 0 || !Number.isFinite(minTime)) return [];
  const byMonth = new Map(sData.map((m) => [`${m.year}-${m.monthIndex}`, m]));

  const firstData = new Date(minTime);
  const startSource = range && range.start < firstData ? range.start : firstData;
  const endCandidate = range && range.end < now ? range.end : now;
  const lastData = new Date(maxTime);
  const endSource = lastData > endCandidate ? lastData : endCandidate;

  const result: MonthStat[] = [];
  const cursor = new Date(startSource.getFullYear(), startSource.getMonth(), 1);
  const end = new Date(endSource.getFullYear(), endSource.getMonth(), 1);
  while (cursor <= end && result.length < 240) {
    const y = cursor.getFullYear();
    const m = cursor.getMonth();
    result.push(byMonth.get(`${y}-${m}`) ?? { year: y, monthIndex: m, count: 0, revenue: 0, margin: 0 });
    cursor.setMonth(m + 1);
  }
  return result;
}

function matchesDrill(t: TicketEx, d: Exclude<DrillDown, null>): boolean {
  switch (d.type) {
    case "status":
      return (t.status || "unknown") === d.value;
    case "month": {
      const date = new Date(t.createdAt);
      return date.getFullYear() === d.year && date.getMonth() === d.month;
    }
    case "repair":
      return (t.performedRepairs || []).some((r) => r.name === d.value);
    case "device":
      return t.deviceLabel === d.value;
    default:
      return true;
  }
}

/** Hodnota do CSV – středník jako oddělovač (české Excel), uvozovky podle potřeby. */
function csvCell(value: string): string {
  return /[";\r\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

// ========================
// Stránka
// ========================

type StatisticsProps = {
  activeServiceId: string | null;
  onOpenTicket?: (ticketId: string) => void;
};

export default function Statistics({ activeServiceId, onOpenTicket }: StatisticsProps) {
  const { getByKey } = useStatuses();
  /**
   * Stav v databázi je anglický klíč ("received", "ready"). Zbytek aplikace
   * ho překládá přes getByKey; tady taky, aby uživatel neviděl "received"
   * tam, kde v seznamu zakázek stojí "Přijato".
   */
  const nazevStavu = useCallback(
    (key: string) => (key === "unknown" ? "Neznámý" : getByKey(key)?.label ?? key),
    [getByKey]
  );

  const [allTickets, setAllTickets] = useState<TicketEx[]>([]);
  const [ticketsLoading, setTicketsLoading] = useState(true);
  const [ticketsError, setTicketsError] = useState<string | null>(null);
  const [reloadToken, setReloadToken] = useState(0);
  const [periodType, setPeriodType] = useState<PeriodType>("all");
  const [customStartDate, setCustomStartDate] = useState("");
  const [customEndDate, setCustomEndDate] = useState("");
  const [viewMode, setViewMode] = useState<ViewMode>("cards");
  const [drillDown, setDrillDown] = useState<DrillDown>(null);
  const [compareWithPrevious, setCompareWithPrevious] = useState(false);
  /** Ceník a nákupní ceny dílů – záložní zdroj nákladů. Při chybě zůstane prázdný. */
  const [costSources, setCostSources] = useState<CostSources>(EMPTY_COST_SOURCES);
  const [costSourcesError, setCostSourcesError] = useState<string | null>(null);
  /**
   * Konsolidované statistiky (Enterprise): čísla přes všechny servisy, které
   * uživatel spravuje, ne jen přes pobočky jednoho. Servisy si dotáhne sám –
   * stránka dostává jen ten aktivní.
   */
  const { has: maModul } = useEntitlements(activeServiceId);
  const [konsolidovane, setKonsolidovane] = useState(false);
  const [mojeServisy, setMojeServisy] = useState<Array<{ id: string; name: string }>>([]);
  /**
   * Hotové agregace ze serveru. Dokud dorazí, stránka nemusí stahovat žádnou
   * zakázku – ty se načítají jen pro tabulku a export, kde jde o jednotlivé
   * řádky, a jako záloha, když RPC selže.
   */
  const [serverStats, setServerStats] = useState<StatistikyPrehled | null>(null);
  const [serverLoading, setServerLoading] = useState(true);
  const [serverNedostupny, setServerNedostupny] = useState(false);

  useEffect(() => {
    if (!supabase || !activeServiceId) return;
    let cancelled = false;
    void (async () => {
      const { data: user } = await supabase!.auth.getUser();
      const uid = user?.user?.id;
      if (!uid) return;
      const { data: clenstvi } = await (supabase!.from("service_memberships") as any)
        .select("service_id")
        .eq("user_id", uid);
      const ids = ((clenstvi ?? []) as Array<{ service_id: string }>).map((m) => m.service_id);
      if (ids.length === 0) return;
      const { data: servisy } = await (supabase!.from("services") as any).select("id, name").in("id", ids);
      if (!cancelled && Array.isArray(servisy)) setMojeServisy(servisy.map((x: any) => ({ id: String(x.id), name: String(x.name ?? "Servis") })));
    })();
    return () => { cancelled = true; };
  }, [activeServiceId]);

  const lzeKonsolidovat = maModul("consolidated") && mojeServisy.length > 1;
  useEffect(() => { if (!lzeKonsolidovat) setKonsolidovane(false); }, [lzeKonsolidovat]);

  // Přes text, ne pole: `mojeServisy` se dotahují až po prvním vykreslení a
  // nové pole se stejnými id by jinak znovu spustilo všechna načítání.
  const klicServisu = konsolidovane
    ? [...mojeServisy.map((x) => x.id)].sort().join(",")
    : activeServiceId ?? "";
  const idsServisu = useMemo(() => (klicServisu ? klicServisu.split(",") : []), [klicServisu]);

  /**
   * Jednotlivé zakázky jsou potřeba jen pro tabulku a její export – a jako
   * záloha, když serverové agregace selžou. Pro karty a grafy se nestahují.
   */
  const potrebujeZakazky = viewMode === "table" || serverNedostupny;

  useEffect(() => {
    if (!activeServiceId || !supabase) {
      setAllTickets([]);
      setTicketsLoading(false);
      setTicketsError(null);
      return;
    }
    if (!potrebujeZakazky) {
      // Zůstat v „načítá se“: po přepnutí na tabulku se tak rovnou ukáže
      // kostra místo hlášky, že v období nejsou žádné zakázky.
      setAllTickets([]);
      setTicketsLoading(true);
      setTicketsError(null);
      return;
    }
    const client = supabase;
    let cancelled = false;
    setTicketsLoading(true);
    setTicketsError(null);
    (async () => {
      try {
        const { data, error } = await fetchAllPages((from, to) =>
          client
            .from("tickets")
            .select(TICKETS_SELECT)
            .in("service_id", idsServisu)
            .is("deleted_at", null)
            .order("created_at", { ascending: false })
            .order("id", { ascending: false })
            .range(from, to)
        );
        if (error) throw error;
        if (cancelled) return;
        setAllTickets((data || []).map((row) => mapSupabaseTicketToTicketEx(row)));
      } catch (err) {
        if (cancelled) return;
        setTicketsError(err instanceof Error ? err.message : "Zakázky se nepodařilo načíst.");
        setAllTickets([]);
      } finally {
        if (!cancelled) setTicketsLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [activeServiceId, reloadToken, idsServisu, potrebujeZakazky]);

  // Ceník oprav a nákupní ceny dílů – jednou za servis. Když se nenačtou,
  // marže se počítá jen z `costs` u provedených oprav a poznámka pod KPI to řekne.
  // Potřeba jen pro výpočet v prohlížeči; serverové agregace si ceník načtou samy.
  useEffect(() => {
    if (!activeServiceId || !supabase || !potrebujeZakazky) {
      setCostSources(EMPTY_COST_SOURCES);
      setCostSourcesError(null);
      return;
    }
    const client = supabase;
    let cancelled = false;
    (async () => {
      type ProductRow = { id: string; purchase_price: number | string | null };
      type RepairRow = { id: string; costs: number | string | null; product_ids: string[] | null };
      const [productsRes, repairsRes] = await Promise.all([
        fetchAllPages<ProductRow>((from, to) =>
          client.from("inventory_products").select("id, purchase_price").eq("service_id", activeServiceId).order("id").range(from, to)
        ),
        fetchAllPages<RepairRow>((from, to) =>
          client.from("repairs").select("id, costs, product_ids").eq("service_id", activeServiceId).order("id").range(from, to)
        ),
      ]);
      if (cancelled) return;
      const err = productsRes.error || repairsRes.error;
      if (err) {
        console.warn("[Statistics] Ceník/sklad se nenačetl, marže jen z nákladů oprav:", err);
        setCostSources(EMPTY_COST_SOURCES);
        setCostSourcesError((err as { message?: string })?.message ?? "Ceník a sklad se nepodařilo načíst.");
        return;
      }
      const purchasePrices = new Map<string, number | null>();
      for (const p of productsRes.data) {
        const n = p.purchase_price === null || p.purchase_price === undefined ? null : Number(p.purchase_price);
        purchasePrices.set(p.id, n !== null && Number.isFinite(n) ? n : null);
      }
      const repairs = new Map<string, { costs?: number; productIds?: string[] }>();
      for (const r of repairsRes.data) {
        const c = r.costs === null || r.costs === undefined ? undefined : Number(r.costs);
        repairs.set(r.id, {
          costs: c !== undefined && Number.isFinite(c) ? c : undefined,
          productIds: Array.isArray(r.product_ids) && r.product_ids.length > 0 ? r.product_ids : undefined,
        });
      }
      setCostSources({ repairs, purchasePrices });
      setCostSourcesError(null);
    })().catch((err: unknown) => {
      if (cancelled) return;
      console.warn("[Statistics] Ceník/sklad se nenačetl:", err);
      setCostSources(EMPTY_COST_SOURCES);
      setCostSourcesError(err instanceof Error ? err.message : "Ceník a sklad se nepodařilo načíst.");
    });
    return () => {
      cancelled = true;
    };
  }, [activeServiceId, reloadToken, potrebujeZakazky]);

  const compareAvailable = COMPARABLE_PERIODS.includes(periodType);
  const compareActive = compareWithPrevious && compareAvailable;

  // Hranice období počítá stránka – zná časové pásmo i to, co má uživatel
  // vybrané v liště. Server dostane hotové „od–do“.
  const obdobi = useMemo(
    () => periodRange(periodType, customStartDate, customEndDate, new Date()),
    [periodType, customStartDate, customEndDate]
  );
  const predchoziObdobi = useMemo(
    () => (compareActive ? previousPeriodRange(periodType, new Date()) : null),
    [periodType, compareActive]
  );

  // Zakázky ve vybraném období
  // Pobočka z lišty: filtr zakázek; při „Všechny pobočky“ přibude srovnání poboček.
  const { activeBranchId, isMulti: hasBranches, branches } = useBranches();

  // Agregace ze serveru. Když RPC selže (stará databáze, výpadek), stránka to
  // zapíše do konzole a spočítá čísla postaru ze stažených zakázek.
  useEffect(() => {
    if (!supabase || idsServisu.length === 0) {
      setServerStats(null);
      setServerLoading(false);
      return;
    }
    const client = supabase;
    let cancelled = false;
    setServerLoading(true);
    (async () => {
      try {
        const data = await nactiStatistiky(client, {
          serviceIds: idsServisu,
          od: obdobi?.start ?? null,
          do: obdobi?.end ?? null,
          branchId: activeBranchId,
          drill: drillDown,
          prevOd: predchoziObdobi?.start ?? null,
          prevDo: predchoziObdobi?.end ?? null,
        });
        if (cancelled) return;
        setServerStats(data);
        setServerNedostupny(false);
      } catch (err) {
        if (cancelled) return;
        console.error("[Statistics] statistiky_prehled selhalo, počítám v prohlížeči:", err);
        setServerStats(null);
        // Ať mezi selháním RPC a začátkem stahování zakázek neproblikne prázdná stránka.
        setTicketsLoading(true);
        setServerNedostupny(true);
      } finally {
        if (!cancelled) setServerLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [idsServisu, obdobi, predchoziObdobi, activeBranchId, drillDown, reloadToken]);

  const branchTickets = useMemo(() => filterByBranch(allTickets, activeBranchId), [allTickets, activeBranchId]);
  const tickets = useMemo(() => {
    if (!obdobi) return branchTickets;
    return branchTickets.filter((t) => inRange(t, obdobi));
  }, [branchTickets, obdobi]);

  // Zakázky v předchozím období (jen pro porovnání)
  const previousPeriodTickets = useMemo(() => {
    if (!predchoziObdobi) return [];
    return branchTickets.filter((t) => inRange(t, predchoziObdobi));
  }, [branchTickets, predchoziObdobi]);

  // Drill-down: kliknutím na stav / měsíc / opravu / zařízení
  const filteredTickets = useMemo(
    () => (drillDown ? tickets.filter((t) => matchesDrill(t, drillDown)) : tickets),
    [tickets, drillDown]
  );

  /**
   * Podklad pro jednotlivé „fasety“. Když je aktivní filtr podle stavu,
   * pruhy stavů se počítají ze všech zakázek období – jinak by v grafu zůstal
   * jediný pruh a nebylo by kam klikat dál. Ostatní sekce filtr respektují.
   */
  const facetTickets = useCallback(
    (facet: DrillFacet) => (drillDown && drillDown.type === facet ? tickets : filteredTickets),
    [drillDown, tickets, filteredTickets]
  );

  const kpis = useMemo(
    () => serverStats?.kpi ?? computeKpis(filteredTickets, costSources),
    [serverStats, filteredTickets, costSources]
  );
  const prevKpis = useMemo(
    () => serverStats?.kpiPredchozi ?? computeKpis(previousPeriodTickets, costSources),
    [serverStats, previousPeriodTickets, costSources]
  );

  /**
   * Načítání a chyba se hlásí jen za tu cestu, kterou se čísla opravdu berou.
   * Když serverové agregace dorazí a jsme v kartách, o žádné zakázky se
   * nečeká – a chyba jejich stahování se ani nemůže objevit.
   */
  const nacitani = serverLoading || (potrebujeZakazky && ticketsLoading);
  const chybaNacteni = potrebujeZakazky ? ticketsError : null;

  // Počty zakázek do popisků – ze serveru, jinak z toho, co je v paměti.
  const pocetVObdobi = serverStats ? serverStats.pocetVObdobi : tickets.length;
  const pocetVeVyberu = serverStats ? serverStats.pocetVeVyberu : filteredTickets.length;
  const pocetPredchozi = serverStats ? serverStats.pocetPredchozi : previousPeriodTickets.length;

  const statusItems = useMemo(() => {
    const zdroj =
      serverStats?.stavy ??
      (() => {
        const counts: Record<string, number> = {};
        for (const t of facetTickets("status")) {
          const key = t.status || "unknown";
          counts[key] = (counts[key] || 0) + 1;
        }
        return Object.entries(counts)
          .sort(([, a], [, b]) => b - a)
          .map(([key, count]) => ({ key, count }));
      })();
    return zdroj.map(({ key, count }) => ({ key, label: nazevStavu(key), count, color: getByKey(key)?.bg }));
  }, [serverStats, facetTickets, nazevStavu, getByKey]);

  const topRepairs = useMemo(() => {
    if (serverStats) return serverStats.topOpravy;
    const counts: Record<string, number> = {};
    for (const t of facetTickets("repair")) {
      for (const r of t.performedRepairs || []) counts[r.name] = (counts[r.name] || 0) + 1;
    }
    return topCounts(counts, 5);
  }, [serverStats, facetTickets]);

  const topDevices = useMemo(() => {
    if (serverStats) return serverStats.topZarizeni;
    const counts: Record<string, number> = {};
    for (const t of facetTickets("device")) {
      if (t.deviceLabel) counts[t.deviceLabel] = (counts[t.deviceLabel] || 0) + 1;
    }
    return topCounts(counts, 5);
  }, [serverStats, facetTickets]);

  const marginRepairRows = useMemo<MarginRow[]>(
    () => serverStats?.marzeOpravy.map((r) => ({ ...r, name: r.name ?? "" })) ?? marginByRepair(facetTickets("repair"), costSources),
    [serverStats, facetTickets, costSources]
  );
  const marginDeviceRows = useMemo<MarginRow[]>(
    () => serverStats?.marzeZarizeni.map((r) => ({ ...r, name: r.name ?? "" })) ?? marginByDevice(facetTickets("device"), costSources),
    [serverStats, facetTickets, costSources]
  );
  const branchNames = useMemo(() => new Map(branches.map((b) => [b.id, b.name])), [branches]);
  const jmenaServisu = useMemo(() => new Map(mojeServisy.map((x) => [x.id, x.name])), [mojeServisy]);
  const marginServiceRows = useMemo<MarginRow[]>(() => {
    if (!konsolidovane) return [];
    // Server vrací jen id servisu; jméno zná stránka ze seznamu členství.
    if (serverStats) return serverStats.marzeServisy.map((r) => ({ ...r, name: jmenaServisu.get(r.key) ?? "Servis" }));
    return marginByService(filteredTickets, costSources, (id) => jmenaServisu.get(id) ?? "Servis");
  }, [konsolidovane, serverStats, filteredTickets, costSources, jmenaServisu]);
  const marginBranchRows = useMemo<MarginRow[]>(() => {
    if (!hasBranches || activeBranchId) return [];
    if (serverStats) {
      return serverStats.marzePobocky.map((r) => ({ ...r, name: r.key ? branchNames.get(r.key) ?? "Bez pobočky" : "Bez pobočky" }));
    }
    return marginByBranch(filteredTickets, costSources, (id) => branchNames.get(id) ?? "Bez pobočky");
  }, [hasBranches, activeBranchId, serverStats, filteredTickets, costSources, branchNames]);

  const monthlyStats = useMemo<MonthStat[]>(() => {
    const now = new Date();
    if (serverStats) {
      // Server posílá jen měsíce s daty; mezery mezi nimi dokreslíme tady.
      if (serverStats.mesice.length === 0 || serverStats.mesicOd === null || serverStats.mesicDo === null) return [];
      return doplnPrazdneMesice(serverStats.mesice, serverStats.mesicOd, serverStats.mesicDo, obdobi, now);
    }

    const list = facetTickets("month");
    if (list.length === 0) return [];

    let minTime = Infinity;
    let maxTime = -Infinity;
    const byMonth = new Map<string, MonthStat>();
    for (const t of list) {
      const d = new Date(t.createdAt);
      const time = d.getTime();
      if (Number.isNaN(time)) continue;
      minTime = Math.min(minTime, time);
      maxTime = Math.max(maxTime, time);
      const key = `${d.getFullYear()}-${d.getMonth()}`;
      const entry = byMonth.get(key) ?? { year: d.getFullYear(), monthIndex: d.getMonth(), count: 0, revenue: 0, margin: 0 };
      const m = ticketMargin(t, costSources);
      entry.count += 1;
      entry.revenue += m.revenue;
      entry.margin += m.margin;
      byMonth.set(key, entry);
    }
    return doplnPrazdneMesice([...byMonth.values()], minTime, maxTime, obdobi, now);
  }, [serverStats, facetTickets, obdobi, costSources]);

  const toggleStatus = useCallback((key: string) => {
    setDrillDown((prev) => (prev?.type === "status" && prev.value === key ? null : { type: "status", value: key }));
  }, []);
  const toggleMonth = useCallback((year: number, month: number) => {
    setDrillDown((prev) =>
      prev?.type === "month" && prev.year === year && prev.month === month ? null : { type: "month", year, month }
    );
  }, []);
  const toggleRepair = useCallback((name: string) => {
    setDrillDown((prev) => (prev?.type === "repair" && prev.value === name ? null : { type: "repair", value: name }));
  }, []);
  const toggleDevice = useCallback((name: string) => {
    setDrillDown((prev) => (prev?.type === "device" && prev.value === name ? null : { type: "device", value: name }));
  }, []);

  const drillLabel = useMemo(() => {
    if (!drillDown) return null;
    switch (drillDown.type) {
      case "status":
        return `Stav: ${nazevStavu(drillDown.value)}`;
      case "month":
        return `Měsíc: ${monthLabelLong(drillDown.year, drillDown.month)}`;
      case "repair":
        return `Oprava: ${drillDown.value}`;
      case "device":
        return `Zařízení: ${drillDown.value}`;
      default:
        return null;
    }
  }, [drillDown, nazevStavu]);

  const exportCsv = useCallback(() => {
    const header = ["Kód", "Datum", "Zákazník", "Zařízení", "Stav", "Příjem (Kč)", "Náklady (Kč)", "Marže (Kč)"];
    const castka = (n: number) => n.toFixed(2).replace(".", ",");
    const rows = filteredTickets.map((t) => {
      const m = ticketMargin(t, costSources);
      return [
        t.code ?? "",
        t.createdAt ? new Date(t.createdAt).toLocaleDateString("cs-CZ") : "",
        t.customerName || "",
        t.deviceLabel || "",
        t.status ? nazevStavu(t.status) : "",
        castka(m.revenue),
        castka(m.cost),
        castka(m.margin),
      ];
    });
    // BOM, aby Excel poznal UTF-8 a nerozbil diakritiku.
    const csv = "﻿" + [header, ...rows].map((r) => r.map(csvCell).join(";")).join("\r\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `statistiky-${new Date().toISOString().slice(0, 10)}.csv`;
    a.rel = "noopener";
    document.body.appendChild(a);
    a.click();
    a.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  }, [filteredTickets, nazevStavu, costSources]);

  if (!activeServiceId) {
    return (
      <div data-tour="statistics-main" style={{ padding: "var(--pad-24)", maxWidth: 1400, margin: "0 auto" }}>
        <Card style={{ padding: "var(--space-8)", textAlign: "center", color: "var(--muted)" }}>
          Vyberte servis v postranním panelu pro zobrazení statistik.
        </Card>
      </div>
    );
  }

  const compareTitle = compareAvailable
    ? "Zobrazí u každé hodnoty změnu oproti předchozímu období stejné délky."
    : "Porovnání je dostupné pro Dnes, Týden, Měsíc, Kvartál a Rok.";

  const statusSection = (
    <Card style={{ padding: "var(--pad-24)" }}>
      <SectionHeading icon={<StatusIcon size={18} />}>Zakázky podle stavu</SectionHeading>
      <StatusBars
        items={statusItems}
        selected={drillDown?.type === "status" ? drillDown.value : null}
        onSelect={toggleStatus}
      />
    </Card>
  );

  const rankSection = (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 300px), 1fr))", gap: "var(--space-4)" }}>
      <Card style={{ padding: "var(--pad-24)" }}>
        <SectionHeading icon={<WrenchIcon size={18} />}>Nejčastější opravy</SectionHeading>
        <RankList
          items={topRepairs}
          selected={drillDown?.type === "repair" ? drillDown.value : null}
          onSelect={toggleRepair}
          emptyText="Ve vybraném období nejsou žádné provedené opravy."
          titlePrefix="Filtrovat opravu"
        />
      </Card>
      <Card style={{ padding: "var(--pad-24)" }}>
        <SectionHeading icon={<DeviceIcon size={18} />}>Nejčastější zařízení</SectionHeading>
        <RankList
          items={topDevices}
          selected={drillDown?.type === "device" ? drillDown.value : null}
          onSelect={toggleDevice}
          emptyText="Ve vybraném období nejsou žádná zařízení."
          titlePrefix="Filtrovat zařízení"
        />
      </Card>
    </div>
  );

  const marginSection = (
    <>
      {konsolidovane && (
        <Card style={{ padding: "var(--pad-24)" }}>
          <SectionHeading icon={<StatusIcon size={18} />}>Servisy vedle sebe</SectionHeading>
          <MarginList
            rows={marginServiceRows}
            limit={20}
            countLabel="Zakázek"
            selected={null}
            onSelect={() => {}}
            emptyText="Ve vybraném období nejsou žádné zakázky."
            titlePrefix="Servis"
          />
        </Card>
      )}
      {!konsolidovane && hasBranches && !activeBranchId && (
        <Card style={{ padding: "var(--pad-24)" }}>
          <SectionHeading icon={<StatusIcon size={18} />}>Pobočky vedle sebe</SectionHeading>
          <MarginList
            rows={marginBranchRows}
            limit={20}
            countLabel="Zakázek"
            selected={null}
            onSelect={() => {}}
            emptyText="Ve vybraném období nejsou žádné zakázky."
            titlePrefix="Pobočka"
          />
        </Card>
      )}
      <Card style={{ padding: "var(--pad-24)" }}>
        <SectionHeading icon={<WrenchIcon size={18} />}>Marže podle oprav</SectionHeading>
        <MarginList
          rows={marginRepairRows}
          limit={15}
          countLabel="Provedeno"
          selected={drillDown?.type === "repair" ? drillDown.value : null}
          onSelect={toggleRepair}
          emptyText="Ve vybraném období nejsou žádné provedené opravy."
          titlePrefix="Filtrovat opravu"
        />
      </Card>
      <Card style={{ padding: "var(--pad-24)" }}>
        <SectionHeading icon={<DeviceIcon size={18} />}>Marže podle zařízení</SectionHeading>
        <MarginList
          rows={marginDeviceRows}
          limit={10}
          countLabel="Zakázek"
          selected={drillDown?.type === "device" ? drillDown.value : null}
          onSelect={toggleDevice}
          emptyText="Ve vybraném období nejsou žádná zařízení."
          titlePrefix="Filtrovat zařízení"
        />
      </Card>
    </>
  );

  /**
   * Poznámka k nákladům pod KPI: co se do nich počítá a kolika opravám
   * náklady chybí. Když se ceník/sklad nenačetl, řekne to rovnou – jinak by
   * vysoká marže vypadala jako dobrá zpráva.
   */
  const costsFootnote = (() => {
    const parts: string[] = [];
    if (costSourcesError) {
      parts.push("Ceník a sklad se nepodařilo načíst – náklady jsou jen z nákladů uložených u oprav, bez nákupních cen dílů.");
    } else {
      parts.push("Náklady = náklady oprav + nákupní ceny dílů z ceníku.");
    }
    if (kpis.entriesWithoutCost > 0) {
      const n = kpis.entriesWithoutCost;
      parts.push(`U ${celeCislo(n)} ${n === 1 ? "opravy" : "oprav"} chybí náklady.`);
    } else {
      parts.push("Všechny provedené opravy mají náklady.");
    }
    if (kpis.entriesMissingPurchasePrice > 0) {
      const n = kpis.entriesMissingPurchasePrice;
      parts.push(`U ${celeCislo(n)} ${n === 1 ? "opravy" : "oprav"} nemá některý díl nákupní cenu (počítá se jako 0 Kč).`);
    }
    return parts.join(" ");
  })();

  const monthlySection = (
    <Card style={{ padding: "var(--pad-24)" }}>
      <SectionHeading icon={<TrendIcon size={18} />}>Měsíční přehled</SectionHeading>
      <MonthlyChart
        months={monthlyStats}
        selected={drillDown?.type === "month" ? { year: drillDown.year, monthIndex: drillDown.month } : null}
        onSelect={toggleMonth}
      />
    </Card>
  );

  return (
    <div
      data-tour="statistics-main"
      style={{
        padding: "var(--pad-24)",
        display: "flex",
        flexDirection: "column",
        gap: "var(--space-5)",
        maxWidth: 1400,
        margin: "0 auto",
      }}
    >
      <PageHeader title="Statistiky" subtitle="Kliknutím na stav, opravu nebo měsíc zúžíte výběr." />

      <Toolbar>
        <Segmented<ViewMode>
          ariaLabel="Režim zobrazení statistik"
          size="sm"
          value={viewMode}
          onChange={setViewMode}
          options={[
            { value: "cards", label: "Karty" },
            { value: "table", label: "Tabulka" },
            { value: "charts", label: "Grafy", dataTour: "statistics-view-charts" },
          ]}
        />

        {/* Konsolidované statistiky: čísla za všechny servisy, které spravuju. */}
        {lzeKonsolidovat && (
          <>
            <Segmented<"servis" | "vse">
              ariaLabel="Rozsah statistik"
              size="sm"
              value={konsolidovane ? "vse" : "servis"}
              onChange={(next) => setKonsolidovane(next === "vse")}
              options={[
                { value: "servis", label: "Tento servis" },
                { value: "vse", label: `Všechny servisy (${mojeServisy.length})` },
              ]}
            />
            <span aria-hidden="true" style={{ width: 1, alignSelf: "stretch", background: "var(--border)", margin: "0 var(--space-1)" }} />
          </>
        )}

        <span aria-hidden="true" style={{ width: 1, alignSelf: "stretch", background: "var(--border)", margin: "0 var(--space-1)" }} />

        <Segmented<PeriodType>
          ariaLabel="Časové období"
          dataTour="statistics-period"
          size="sm"
          value={periodType}
          onChange={(next) => {
            setPeriodType(next);
            if (next !== "custom") {
              setCustomStartDate("");
              setCustomEndDate("");
            }
          }}
          options={PERIOD_OPTIONS}
        />

        {periodType === "custom" && (
          <span style={{ display: "inline-flex", alignItems: "center", gap: "var(--space-1)" }}>
            <Input
              type="date"
              aria-label="Od"
              value={customStartDate}
              max={customEndDate || undefined}
              onChange={(e) => setCustomStartDate(e.target.value)}
              style={{ width: 150, padding: "6px var(--space-2)", fontSize: "var(--text-sm)" }}
            />
            <span style={{ color: "var(--muted)", fontSize: "var(--text-sm)" }}>–</span>
            <Input
              type="date"
              aria-label="Do"
              value={customEndDate}
              min={customStartDate || undefined}
              onChange={(e) => setCustomEndDate(e.target.value)}
              style={{ width: 150, padding: "6px var(--space-2)", fontSize: "var(--text-sm)" }}
            />
          </span>
        )}

        <span title={compareTitle} style={{ display: "inline-flex" }}>
          <Selectable
            selected={compareActive}
            disabled={!compareAvailable}
            size="sm"
            layout="row"
            onClick={() => setCompareWithPrevious((v) => !v)}
            style={{ width: "auto", borderRadius: "var(--radius-pill)", padding: "5px var(--space-3)", fontSize: "var(--text-sm)", fontWeight: 600, gap: "var(--space-1)" }}
          >
            <span
              aria-hidden="true"
              style={{
                width: 8,
                height: 8,
                borderRadius: "50%",
                background: compareActive ? "var(--accent)" : "var(--border)",
                flexShrink: 0,
              }}
            />
            Porovnat s předchozím obdobím
          </Selectable>
        </span>

        <ToolbarSpacer />

        {drillDown && drillLabel && (
          <Pill
            color="var(--accent)"
            style={{ padding: "4px var(--space-1) 4px var(--space-3)", fontSize: "var(--text-sm)", background: "var(--accent-soft)", gap: "var(--space-1)" }}
          >
            <span>{drillLabel}</span>
            <span style={{ color: "var(--muted)", fontWeight: 500 }}>· {zakazky(pocetVeVyberu)}</span>
            <button
              type="button"
              onClick={() => setDrillDown(null)}
              aria-label="Zrušit filtr"
              title="Zrušit filtr"
              style={{
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
                width: 20,
                height: 20,
                borderRadius: "50%",
                border: "none",
                background: "transparent",
                color: "inherit",
                cursor: "pointer",
                padding: 0,
                marginLeft: 2,
              }}
            >
              <XIcon size={12} />
            </button>
          </Pill>
        )}
      </Toolbar>

      {nacitani && (
        <>
          <style>{`@keyframes stats-skeleton-pulse{0%,100%{opacity:.55}50%{opacity:1}}.stats-skeleton{animation:stats-skeleton-pulse 1.4s ease-in-out infinite}`}</style>
          <div role="status" aria-live="polite" style={{ position: "absolute", width: 1, height: 1, overflow: "hidden", clip: "rect(0 0 0 0)" }}>
            Načítání zakázek…
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 250px), 1fr))", gap: "var(--space-3)" }}>
            {Array.from({ length: 8 }, (_, i) => (
              <KpiTileSkeleton key={i} />
            ))}
          </div>
          <Card aria-hidden="true" style={{ padding: "var(--pad-24)", display: "flex", flexDirection: "column", gap: "var(--space-3)" }}>
            <span className="stats-skeleton" style={{ display: "block", width: "30%", height: 16, borderRadius: "var(--radius-xs)", background: "var(--panel-2)", border: "1px solid var(--border)" }} />
            {[70, 45, 30].map((w) => (
              <span key={w} className="stats-skeleton" style={{ display: "block", width: `${w}%`, height: 22, borderRadius: "var(--radius-2xs)", background: "var(--panel-2)", border: "1px solid var(--border)" }} />
            ))}
          </Card>
        </>
      )}

      {!nacitani && chybaNacteni && (
        <Card
          role="alert"
          style={{
            padding: "var(--pad-24)",
            display: "flex",
            alignItems: "center",
            gap: "var(--space-4)",
            flexWrap: "wrap",
            borderColor: "var(--danger)",
            background: "var(--danger-soft)",
          }}
        >
          <div style={{ flex: 1, minWidth: 200 }}>
            <div style={{ fontWeight: 700, color: "var(--danger-text)", marginBottom: "var(--space-1)" }}>Statistiky se nepodařilo načíst</div>
            <div style={{ fontSize: "var(--text-base)", color: "var(--text)", overflowWrap: "anywhere" }}>{chybaNacteni}</div>
          </div>
          <Button variant="primary" size="sm" onClick={() => setReloadToken((t) => t + 1)}>
            Zkusit znovu
          </Button>
        </Card>
      )}

      {!nacitani && !chybaNacteni && (
        <>
          {/* Klíčová čísla */}
          {viewMode !== "charts" && (
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 250px), 1fr))", gap: "var(--space-3)" }}>
              <KpiTile
                title="Celkem zakázek"
                value={celeCislo(kpis.totalTickets)}
                icon={<DocumentIcon size={16} />}
                delta={compareActive ? { current: kpis.totalTickets, previous: prevKpis.totalTickets, formatAbsolute: celeCislo } : undefined}
              />
              <KpiTile
                title="Celkový příjem"
                value={formatCurrencyRounded(kpis.totalRevenue)}
                icon={<CoinsIcon size={16} />}
                delta={compareActive ? { current: kpis.totalRevenue, previous: prevKpis.totalRevenue, formatAbsolute: formatCurrencyRounded } : undefined}
              />
              <KpiTile
                title="Celkové náklady"
                value={formatCurrencyRounded(kpis.totalCosts)}
                icon={<CoinsIcon size={16} />}
                delta={compareActive ? { current: kpis.totalCosts, previous: prevKpis.totalCosts, formatAbsolute: formatCurrencyRounded, invert: true } : undefined}
              />
              <KpiTile
                title="Zisk"
                value={formatCurrencyRounded(kpis.profit)}
                icon={<TrendIcon size={16} />}
                delta={
                  compareActive
                    ? { current: kpis.profit, previous: prevKpis.profit, formatAbsolute: formatCurrencyRounded, absolute: prevKpis.profit <= 0 }
                    : undefined
                }
              />
              <KpiTile
                title="Marže"
                value={`${cislo(kpis.marginPct, Math.abs(kpis.marginPct) < 10 ? 1 : 0)} %`}
                subtitle={`${formatCurrencyRounded(kpis.profit)} z ${formatCurrencyRounded(kpis.totalRevenue)}`}
                icon={<TrendIcon size={16} />}
                delta={
                  compareActive
                    ? {
                        current: kpis.marginPct,
                        previous: prevKpis.marginPct,
                        // Rozdíl v procentních bodech, ne procento z procenta.
                        formatAbsolute: (n) => `${cislo(n, n < 10 ? 1 : 0)} p. b.`,
                        absolute: true,
                      }
                    : undefined
                }
              />
              <KpiTile
                title="Průměrná cena"
                value={formatCurrencyRounded(kpis.averageTicketPrice)}
                icon={<StatusIcon size={16} />}
                delta={compareActive ? { current: kpis.averageTicketPrice, previous: prevKpis.averageTicketPrice, formatAbsolute: formatCurrencyRounded } : undefined}
              />
              <KpiTile
                title="Celkové slevy"
                value={formatCurrencyRounded(kpis.totalDiscounts)}
                icon={<GiftIcon size={16} />}
                delta={compareActive ? { current: kpis.totalDiscounts, previous: prevKpis.totalDiscounts, formatAbsolute: formatCurrencyRounded, invert: true } : undefined}
              />
              <KpiTile
                title="Průměrná doba zakázky"
                value={formatDuration(kpis.averageTicketDurationDays)}
                icon={<ClockIcon size={16} />}
                delta={
                  compareActive && kpis.averageTicketDurationDays > 0 && prevKpis.averageTicketDurationDays > 0
                    ? {
                        current: kpis.averageTicketDurationDays,
                        previous: prevKpis.averageTicketDurationDays,
                        formatAbsolute: (n) => dny(Number(n.toFixed(1))),
                        absolute: true,
                        invert: true,
                      }
                    : undefined
                }
              />
            </div>
          )}

          {viewMode !== "charts" && (
            <div style={{ fontSize: "var(--text-sm)", color: "var(--muted)", fontVariantNumeric: "tabular-nums", marginTop: "calc(-1 * var(--space-2))" }}>
              {costsFootnote}
            </div>
          )}

          {viewMode === "cards" && (
            <>
              {statusSection}
              {rankSection}
              {marginSection}
              {monthlySection}
            </>
          )}

          {viewMode === "charts" && (
            <>
              {monthlySection}
              {statusSection}
              {rankSection}
              {marginSection}
            </>
          )}

          {viewMode === "table" && (
            <Card style={{ padding: "var(--pad-24)" }}>
              <div style={{ display: "flex", alignItems: "center", gap: "var(--space-3)", flexWrap: "wrap", marginBottom: "var(--space-3)" }}>
                <div style={{ flex: 1, minWidth: 200 }}>
                  <SectionHeading icon={<DocumentIcon size={18} />}>Zakázky v období</SectionHeading>
                  <div style={{ fontSize: "var(--text-sm)", color: "var(--muted)", marginTop: "calc(-1 * var(--space-2))" }}>
                    {zakazky(filteredTickets.length)}
                    {filteredTickets.length > 100 && " · v tabulce je prvních 100, export obsahuje všechny"}
                    {onOpenTicket && " · kliknutím na řádek otevřete zakázku"}
                  </div>
                </div>
                <Button
                  variant="soft"
                  size="sm"
                  icon={<DownloadIcon size={14} />}
                  onClick={exportCsv}
                  disabled={filteredTickets.length === 0}
                  title="Uloží zobrazené zakázky jako CSV (oddělovač středník)"
                >
                  Export CSV
                </Button>
              </div>

              {filteredTickets.length === 0 ? (
                <div style={{ color: "var(--muted)", fontSize: "var(--text-base)", padding: "var(--space-4) 0" }}>
                  Ve vybraném období nejsou žádné zakázky.
                </div>
              ) : (
                <div style={{ maxHeight: "60vh", overflow: "auto", border: "1px solid var(--border)", borderRadius: "var(--radius-sm)" }}>
                  <table style={{ width: "100%", borderCollapse: "separate", borderSpacing: 0, fontSize: "var(--text-base)" }}>
                    <thead>
                      <tr>
                        {(["Kód", "Datum", "Zákazník", "Zařízení", "Stav", "Příjem", "Náklady", "Marže"] as const).map((label, i) => (
                          <th
                            key={label}
                            scope="col"
                            style={{
                              position: "sticky",
                              top: 0,
                              zIndex: 1,
                              background: "var(--panel)",
                              backdropFilter: "var(--blur)",
                              WebkitBackdropFilter: "var(--blur)",
                              borderBottom: "1px solid var(--border)",
                              padding: "var(--space-2) var(--space-3)",
                              textAlign: i >= 5 ? "right" : "left",
                              color: "var(--muted)",
                              fontWeight: 600,
                              fontSize: "var(--text-sm)",
                              whiteSpace: "nowrap",
                            }}
                          >
                            {label}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {filteredTickets.slice(0, 100).map((t) => {
                        const m = ticketMargin(t, costSources);
                        const finalPrice = m.revenue;
                        const cell = { padding: "var(--space-2) var(--space-3)", borderBottom: "1px solid var(--border)", color: "var(--text)" } as const;
                        return (
                          <tr
                            key={t.id}
                            style={{ cursor: onOpenTicket ? "pointer" : undefined }}
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
                            <td style={{ ...cell, fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace", fontVariantNumeric: "tabular-nums" }}>{t.code ?? "—"}</td>
                            <td style={{ ...cell, fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap" }}>
                              {t.createdAt ? new Date(t.createdAt).toLocaleDateString("cs-CZ") : "—"}
                            </td>
                            <td style={cell}>{t.customerName || "—"}</td>
                            <td style={cell}>{t.deviceLabel || "—"}</td>
                            <td style={{ ...cell, whiteSpace: "nowrap" }}>
                              {t.status ? (
                                <span style={{ display: "inline-flex", alignItems: "center", gap: "var(--space-2)" }}>
                                  <span aria-hidden="true" style={{ width: 8, height: 8, borderRadius: "50%", background: getByKey(t.status)?.bg || "var(--accent)", flexShrink: 0 }} />
                                  {nazevStavu(t.status)}
                                </span>
                              ) : (
                                "—"
                              )}
                            </td>
                            <td style={{ ...cell, textAlign: "right", fontWeight: 600, fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap" }}>
                              {finalPrice > 0 ? formatCurrencyRounded(finalPrice) : "—"}
                            </td>
                            <td style={{ ...cell, textAlign: "right", fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap", color: "var(--muted)" }}>
                              {m.cost > 0 ? formatCurrencyRounded(m.cost) : "—"}
                            </td>
                            <td
                              style={{
                                ...cell,
                                textAlign: "right",
                                fontWeight: 600,
                                fontVariantNumeric: "tabular-nums",
                                whiteSpace: "nowrap",
                                color: m.margin < 0 ? "var(--danger-text)" : "var(--text)",
                              }}
                            >
                              {finalPrice > 0 || m.cost > 0 ? formatCurrencyRounded(m.margin) : "—"}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </Card>
          )}

          {/* Souhrn pod tabulkou i kartami – kolik zakázek je v aktuálním výběru */}
          {viewMode !== "table" && (
            <div style={{ fontSize: "var(--text-sm)", color: "var(--muted)", fontVariantNumeric: "tabular-nums" }}>
              {drillDown
                ? `Ve výběru je ${zakazky(pocetVeVyberu)} z ${celeCislo(pocetVObdobi)} v období.`
                : `V období je ${zakazky(pocetVObdobi)}.`}
              {compareActive && ` Předchozí období: ${zakazky(pocetPredchozi)}.`}
              {kpis.averageTicketDurationDays > 0 &&
                ` Průměrná doba zakázky vychází z dokončených zakázek (${cislo(kpis.averageTicketDurationDays)} dne).`}
            </div>
          )}
        </>
      )}
    </div>
  );
}
