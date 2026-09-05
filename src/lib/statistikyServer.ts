/**
 * Agregace pro Statistiky ze serveru.
 *
 * Stránka si dřív stáhla všechny zakázky servisu a sečetla je v prohlížeči.
 * Největší servis má přes 3 500 zakázek a přibývá jich skoro tisíc ročně –
 * u desetitisíce by to znamenalo megabajty JSONu na každé otevření stránky.
 * Součty proto počítá databázová funkce `statistiky_prehled` a sem chodí
 * hotová čísla.
 *
 * Když funkce není k dispozici (stará databáze, výpadek), Statistiky spadnou
 * zpět na výpočet v prohlížeči – proto tenhle modul chybu jen vyhodí a
 * nesnaží se ji zakrývat prázdnými čísly.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

export type ServerKpis = {
  totalTickets: number;
  totalRevenue: number;
  totalCosts: number;
  totalDiscounts: number;
  profit: number;
  marginPct: number;
  entriesWithoutCost: number;
  entriesMissingPurchasePrice: number;
  averageTicketPrice: number;
  averageTicketDurationDays: number;
};

export type ServerStav = { key: string; count: number };
export type ServerPocet = { name: string; count: number };

/** Řádek žebříčku marže; shodný tvar s `MarginRow` ve Statistics/margin.ts. */
export type ServerMarzeRadek = {
  key: string;
  /** U poboček a servisů chybí – název dosadí stránka, server jména nezná. */
  name?: string;
  count: number;
  revenue: number;
  cost: number;
  margin: number;
  marginPct: number;
  noCostData: boolean;
};

export type ServerMesic = { year: number; monthIndex: number; count: number; revenue: number; margin: number };

export type StatistikyPrehled = {
  kpi: ServerKpis;
  kpiPredchozi: ServerKpis;
  pocetVObdobi: number;
  pocetVeVyberu: number;
  pocetPredchozi: number;
  stavy: ServerStav[];
  topOpravy: ServerPocet[];
  topZarizeni: ServerPocet[];
  marzeOpravy: ServerMarzeRadek[];
  marzeZarizeni: ServerMarzeRadek[];
  marzePobocky: ServerMarzeRadek[];
  marzeServisy: ServerMarzeRadek[];
  mesice: ServerMesic[];
  /** Nejstarší a nejnovější zakázka v měsíční řadě – osa grafu podle nich dokreslí prázdné měsíce. */
  mesicOd: number | null;
  mesicDo: number | null;
};

/** Zúžení výběru kliknutím ve stránce; tvar odpovídá `DrillDown` ve Statistics.tsx. */
export type StatistikyDrill =
  | null
  | { type: "status"; value: string }
  | { type: "month"; year: number; month: number }
  | { type: "repair"; value: string }
  | { type: "device"; value: string };

export type StatistikyDotaz = {
  serviceIds: string[];
  /** Hranice období; null = bez omezení („Vše“). */
  od: Date | null;
  do: Date | null;
  branchId: string | null;
  drill: StatistikyDrill;
  prevOd: Date | null;
  prevDo: Date | null;
};

function cislo(v: unknown): number {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : 0;
}

function cas(v: unknown): number | null {
  if (typeof v !== "string") return null;
  const t = new Date(v).getTime();
  return Number.isNaN(t) ? null : t;
}

function kpis(raw: unknown): ServerKpis {
  const o = (raw ?? {}) as Record<string, unknown>;
  return {
    totalTickets: cislo(o.totalTickets),
    totalRevenue: cislo(o.totalRevenue),
    totalCosts: cislo(o.totalCosts),
    totalDiscounts: cislo(o.totalDiscounts),
    profit: cislo(o.profit),
    marginPct: cislo(o.marginPct),
    entriesWithoutCost: cislo(o.entriesWithoutCost),
    entriesMissingPurchasePrice: cislo(o.entriesMissingPurchasePrice),
    averageTicketPrice: cislo(o.averageTicketPrice),
    averageTicketDurationDays: cislo(o.averageTicketDurationDays),
  };
}

function pole(raw: unknown): Record<string, unknown>[] {
  return Array.isArray(raw) ? (raw as Record<string, unknown>[]) : [];
}

function marzeRadky(raw: unknown): ServerMarzeRadek[] {
  return pole(raw).map((r) => ({
    key: String(r.key ?? ""),
    name: typeof r.name === "string" ? r.name : undefined,
    count: cislo(r.count),
    revenue: cislo(r.revenue),
    cost: cislo(r.cost),
    margin: cislo(r.margin),
    marginPct: cislo(r.marginPct),
    noCostData: r.noCostData === true,
  }));
}

/**
 * Načte hotové agregace. Vyhodí, když RPC selže nebo vrátí něco jiného než
 * objekt – volající to má odchytit a spočítat čísla postaru.
 */
export async function nactiStatistiky(client: SupabaseClient, dotaz: StatistikyDotaz): Promise<StatistikyPrehled> {
  const drill = dotaz.drill;
  const { data, error } = await client.rpc("statistiky_prehled", {
    p_service_ids: dotaz.serviceIds,
    p_od: dotaz.od ? dotaz.od.toISOString() : null,
    p_do: dotaz.do ? dotaz.do.toISOString() : null,
    p_branch_id: dotaz.branchId,
    p_drill_typ: drill?.type ?? null,
    p_drill_hodnota: drill && drill.type !== "month" ? drill.value : null,
    p_drill_rok: drill?.type === "month" ? drill.year : null,
    p_drill_mesic: drill?.type === "month" ? drill.month : null,
    p_prev_od: dotaz.prevOd ? dotaz.prevOd.toISOString() : null,
    p_prev_do: dotaz.prevDo ? dotaz.prevDo.toISOString() : null,
    // Měsíce se musí řezat v čase uživatele, jinak zakázka z 1. ledna 00:30 spadne do prosince.
    p_tz: Intl.DateTimeFormat().resolvedOptions().timeZone || "Europe/Prague",
  });
  if (error) throw error;
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    throw new Error("statistiky_prehled vrátilo neočekávaná data.");
  }
  const o = data as Record<string, unknown>;
  return {
    kpi: kpis(o.kpi),
    kpiPredchozi: kpis(o.kpiPredchozi),
    pocetVObdobi: cislo(o.pocetVObdobi),
    pocetVeVyberu: cislo(o.pocetVeVyberu),
    pocetPredchozi: cislo(o.pocetPredchozi),
    stavy: pole(o.stavy).map((r) => ({ key: String(r.key ?? "unknown"), count: cislo(r.count) })),
    topOpravy: pole(o.topOpravy).map((r) => ({ name: String(r.name ?? ""), count: cislo(r.count) })),
    topZarizeni: pole(o.topZarizeni).map((r) => ({ name: String(r.name ?? ""), count: cislo(r.count) })),
    marzeOpravy: marzeRadky(o.marzeOpravy),
    marzeZarizeni: marzeRadky(o.marzeZarizeni),
    marzePobocky: marzeRadky(o.marzePobocky),
    marzeServisy: marzeRadky(o.marzeServisy),
    mesice: pole(o.mesice).map((r) => ({
      year: cislo(r.year),
      monthIndex: cislo(r.monthIndex),
      count: cislo(r.count),
      revenue: cislo(r.revenue),
      margin: cislo(r.margin),
    })),
    mesicOd: cas(o.mesicOd),
    mesicDo: cas(o.mesicDo),
  };
}
