/**
 * Pokladna (volitelný modul, service_settings.config.pokladna).
 *
 * Servis má jednu nebo víc pokladen (i víc na pobočce). Každý pohyb peněz
 * je řádek v pokladna_pohyby: platba za zakázku nebo fakturu, záloha, ruční
 * příjem a výdaj s volnou kategorií, vklad, výběr, odvod do banky, převod
 * mezi pokladnami a rozdíl z uzávěrky. Pohyby se nemažou – chyba se opraví
 * stornem (protizápis), takže historie sedí i zpětně.
 *
 * Stav šuplíku počítá jen hotovost. Platba kartou nebo převodem se eviduje
 * (zakázka je zaplacená, počítá se do tržby), ale stav pokladny nemění.
 *
 * Zápis jde jen přes databázové funkce pokladna_* (hlídají právo
 * can_use_pokladna, pobočku a vypnutý servis), čtení přímo z tabulek přes RLS.
 * Schéma: supabase/migrations/20261104120000_pokladna.sql.
 */
import { supabase } from "./supabaseClient";
import { hrubaCena, konecnaCena, type TypSlevy } from "./slevaZakazky";
import { jeVydanyStav } from "./recenze";

export type ZpusobPlatby = "cash" | "card" | "transfer";
export type DruhPohybu = "zakazka" | "zaloha" | "faktura" | "prijem" | "vydej" | "vklad" | "vyber" | "odvod" | "prevod" | "rozdil" | "storno";

export const ZPUSOB_TEXT: Record<ZpusobPlatby, string> = { cash: "Hotově", card: "Kartou", transfer: "Převodem" };

export const DRUH_TEXT: Record<DruhPohybu, string> = {
  zakazka: "Platba zakázky",
  zaloha: "Záloha",
  faktura: "Platba faktury",
  prijem: "Příjem",
  vydej: "Výdaj",
  vklad: "Vklad",
  vyber: "Výběr",
  odvod: "Odvod do banky",
  prevod: "Převod",
  rozdil: "Rozdíl z uzávěrky",
  storno: "Storno",
};

export type Pokladna = {
  id: string;
  serviceId: string;
  branchId: string | null;
  nazev: string;
  pocatecniStav: number;
  poradi: number;
  archivovana: boolean;
};

export type PohybPokladny = {
  id: string;
  pokladnaId: string;
  smer: "prijem" | "vydej";
  castka: number;
  zpusob: ZpusobPlatby;
  druh: DruhPohybu;
  /** U storna: druh rušeného pohybu. */
  puvodniDruh: DruhPohybu | null;
  kategorie: string | null;
  popis: string | null;
  ticketId: string | null;
  invoiceId: string | null;
  zaokrouhleni: number;
  prevodId: string | null;
  stornoId: string | null;
  uzaverkaId: string | null;
  createdAt: string;
  createdBy: string | null;
};

export type StavPokladny = { pokladnaId: string; stav: number; posledniUzaverkaAt: string | null; hotovostniOdUzaverky: number };

export type Uzaverka = {
  id: string;
  pokladnaId: string;
  ocekavano: number;
  napocitano: number;
  rozdil: number;
  platidla: Record<string, number> | null;
  poznamka: string | null;
  createdAt: string;
  createdBy: string | null;
};

// ---------------------------------------------------------------------------
// Nastavení
// ---------------------------------------------------------------------------

export type NastaveniPokladny = {
  zapnuto: boolean;
  /** Stav zakázky po zaplacení: klíč stavu, "" = neměnit, null = vybrat sám (Vydáno). */
  stavPoPlatbe: string | null;
  /** Hotovost na celé koruny (zákon o oběhu bankovek a mincí). */
  zaokrouhlovat: boolean;
  /** Od kdy pokladna běží (YYYY-MM-DD) – starší vydané zakázky se nehlásí jako nezaplacené. */
  od: string | null;
  /** Na Dnes hlásit vydané a nezaplacené zakázky a chybějící uzávěrku. */
  upozorneni: boolean;
};

export function normalizujNastaveniPokladny(config: Record<string, unknown> | null | undefined): NastaveniPokladny {
  const c = config ?? {};
  const stav = c.pokladna_stav_po_platbe;
  const od = c.pokladna_od;
  return {
    zapnuto: c.pokladna === true,
    stavPoPlatbe: typeof stav === "string" ? stav : null,
    zaokrouhlovat: c.pokladna_zaokrouhlovat !== false,
    od: typeof od === "string" && /^\d{4}-\d{2}-\d{2}$/.test(od) ? od : null,
    upozorneni: c.pokladna_upozorneni !== false,
  };
}

type StavProVydani = { key: string; label: string; isFinal: boolean };

/** Výchozí stav „vydáno“: první koncový stav, který není storno ani vrácení bez opravy. */
export function vychoziStavVydani(stavy: readonly StavProVydani[]): string | null {
  return stavy.find((s) => jeVydanyStav(s.key, s.label, s.isFinal))?.key ?? null;
}

/** Na jaký stav zakázku po zaplacení přepnout; null = neměnit. */
export function stavPoZaplaceni(n: Pick<NastaveniPokladny, "stavPoPlatbe">, stavy: readonly StavProVydani[]): string | null {
  if (n.stavPoPlatbe === "") return null;
  if (n.stavPoPlatbe && stavy.some((s) => s.key === n.stavPoPlatbe)) return n.stavPoPlatbe;
  return vychoziStavVydani(stavy);
}

// ---------------------------------------------------------------------------
// Čísla
// ---------------------------------------------------------------------------

const naHalere = (n: number) => Math.round(n * 100) / 100;

/**
 * Hotovost se platí na celé koruny. 1 249,50 → 1 250 (zaokrouhlení +0,50),
 * 1 249,49 → 1 249 (−0,49). Kartou a převodem se platí přesně.
 */
export function zaokrouhliHotovost(castka: number): { castka: number; zaokrouhleni: number } {
  const presne = naHalere(castka);
  const cela = Math.round(presne + 1e-9);
  return { castka: cela, zaokrouhleni: naHalere(cela - presne) };
}

/** Bankovky a mince v oběhu (Kč), od největší. */
export const PLATIDLA = [5000, 2000, 1000, 500, 200, 100, 50, 20, 10, 5, 2, 1] as const;

export function soucetPlatidel(pocty: Record<string, number | string | null | undefined>): number {
  let s = 0;
  for (const h of PLATIDLA) {
    const n = Math.floor(Number(pocty[String(h)]) || 0);
    if (n > 0) s += n * h;
  }
  return s;
}

/** Kolik vrátit: zákazník dal `dal`, platí `castka`. null = dal málo nebo nic. */
export function kolikVratit(castka: number, dal: number | null): number | null {
  if (dal === null || !Number.isFinite(dal) || dal < castka) return null;
  return naHalere(dal - castka);
}

/** Text částky z pole: „1 250,50“ i „1250.5“ → 1250.5; nesmysl → null. */
export function ctiCastku(text: string): number | null {
  const t = text.replace(/\s|Kč/gi, "").replace(",", ".");
  if (!t) return null;
  const n = Number(t);
  return Number.isFinite(n) && n > 0 && n < 10_000_000 ? naHalere(n) : null;
}

export function znamenko(p: Pick<PohybPokladny, "smer">): 1 | -1 {
  return p.smer === "prijem" ? 1 : -1;
}

const TRZBA: ReadonlySet<DruhPohybu> = new Set(["zakazka", "zaloha", "faktura", "prijem"]);

/** Čím pohyb je pro součty: storno se počítá k druhu, který ruší. */
function ucetniDruh(p: Pick<PohybPokladny, "druh" | "puvodniDruh">): DruhPohybu | null {
  return p.druh === "storno" ? p.puvodniDruh : p.druh;
}

export type SouhrnPohybu = {
  /** Tržba (platby, zálohy, ruční příjmy) podle způsobu platby. */
  trzba: Record<ZpusobPlatby, number>;
  trzbaCelkem: number;
  vydaje: number;
  /** Změna hotovosti v šuplíku za období (všechno v hotovosti). */
  zmenaHotovosti: number;
  plateb: number;
};

export function souhrnPohybu(pohyby: readonly PohybPokladny[]): SouhrnPohybu {
  const trzba: Record<ZpusobPlatby, number> = { cash: 0, card: 0, transfer: 0 };
  let vydaje = 0;
  let zmenaHotovosti = 0;
  let plateb = 0;
  for (const p of pohyby) {
    const z = znamenko(p) * p.castka;
    if (p.zpusob === "cash") zmenaHotovosti += z;
    const druh = ucetniDruh(p);
    if (!druh) continue;
    if (TRZBA.has(druh)) {
      trzba[p.zpusob] += z;
      if (p.druh !== "storno") plateb += 1;
    } else if (druh === "vydej") {
      vydaje -= z;
    }
  }
  const r = (n: number) => naHalere(n);
  return {
    trzba: { cash: r(trzba.cash), card: r(trzba.card), transfer: r(trzba.transfer) },
    trzbaCelkem: r(trzba.cash + trzba.card + trzba.transfer),
    vydaje: r(vydaje),
    zmenaHotovosti: r(zmenaHotovosti),
    plateb,
  };
}

/** Id pohybů, které už někdo stornoval. */
export function stornovane(pohyby: readonly PohybPokladny[]): Set<string> {
  return new Set(pohyby.filter((p) => p.stornoId).map((p) => p.stornoId!));
}

export type DenPokladny = { den: string; trzba: number; hotove: number; kartou: number; vydaje: number };

function mistniDen(iso: string): string {
  const d = new Date(iso);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** Tržba a výdaje po dnech (místní čas), od nejnovějšího. */
export function poDnech(pohyby: readonly PohybPokladny[]): DenPokladny[] {
  const dny = new Map<string, PohybPokladny[]>();
  for (const p of pohyby) {
    const d = mistniDen(p.createdAt);
    const seznam = dny.get(d) ?? [];
    seznam.push(p);
    dny.set(d, seznam);
  }
  return [...dny.entries()]
    .map(([den, xs]) => {
      const s = souhrnPohybu(xs);
      return { den, trzba: s.trzbaCelkem, hotove: s.trzba.cash, kartou: s.trzba.card, vydaje: s.vydaje };
    })
    .sort((a, b) => b.den.localeCompare(a.den));
}

/** Kategorie k nabídce: naposledy použité nahoře, pak výchozí. */
export const VYCHOZI_KATEGORIE_VYDAJU = ["Díly", "Poštovné", "Kancelář", "Úklid", "Občerstvení", "Doprava"];
export const VYCHOZI_KATEGORIE_PRIJMU = ["Prodej příslušenství", "Drobný prodej", "Ostatní"];

export function kategorieKNabidce(pohyby: readonly PohybPokladny[], druh: "prijem" | "vydej", max = 10): string[] {
  const out: string[] = [];
  const videno = new Set<string>();
  const pridej = (k: string | null) => {
    const t = (k ?? "").trim();
    if (!t || videno.has(t.toLowerCase())) return;
    videno.add(t.toLowerCase());
    out.push(t);
  };
  const serazene = [...pohyby].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  for (const p of serazene) if (p.druh === druh) pridej(p.kategorie);
  for (const k of druh === "vydej" ? VYCHOZI_KATEGORIE_VYDAJU : VYCHOZI_KATEGORIE_PRIJMU) pridej(k);
  return out.slice(0, max);
}

// ---------------------------------------------------------------------------
// K zaplacení
// ---------------------------------------------------------------------------

export type KZaplaceni = {
  /** Klíč do seznamu: zakázka, nebo faktura bez zakázky / souhrnná. */
  klic: string;
  ticketId: string | null;
  invoiceId: string | null;
  kod: string;
  nazev: string;
  zakaznik: string;
  stav: string | null;
  branchId: string | null;
  celkem: number;
  zaplaceno: number;
  zbyva: number;
};

export type ZakazkaProPokladnu = {
  id: string;
  code: string | null;
  title: string | null;
  customerName: string | null;
  status: string | null;
  branchId: string | null;
  performedRepairs: Array<{ price?: number | null }> | null;
  discountType: TypSlevy;
  discountValue: number | null;
};

export type FakturaProPokladnu = { id: string; number: string; total: number; status: string; customerName: string | null; branchId: string | null; ticketIds: string[] };

/** Cena zakázky po slevě – stejný vzorec jako karta zakázky a provize. */
export function cenaZakazky(t: Pick<ZakazkaProPokladnu, "performedRepairs" | "discountType" | "discountValue">): number {
  return konecnaCena(hrubaCena(t.performedRepairs), t.discountType, t.discountValue);
}

/** Zaplaceno na zakázku (platby a zálohy mínus storna), podle pohybů. */
export function zaplacenoPodleZakazek(pohyby: readonly Pick<PohybPokladny, "ticketId" | "smer" | "castka" | "zaokrouhleni" | "druh" | "puvodniDruh">[]): Map<string, number> {
  const m = new Map<string, number>();
  for (const p of pohyby) {
    if (!p.ticketId) continue;
    const druh = ucetniDruh(p);
    if (druh !== "zakazka" && druh !== "zaloha" && druh !== "faktura") continue;
    // Zaokrouhlení není platba za zakázku: 1 250 zaplaceno za 1 249,50.
    const v = (p.smer === "prijem" ? 1 : -1) * (p.castka - p.zaokrouhleni);
    m.set(p.ticketId, naHalere((m.get(p.ticketId) ?? 0) + v));
  }
  return m;
}

/**
 * Co se dá zaplatit: zakázky připravené k vydání (bez faktury nebo s vlastní
 * nezaplacenou fakturou) a nezaplacené faktury bez zakázky nebo souhrnné.
 * Zakázka, kterou kryje souhrnná faktura, se platí přes fakturu.
 */
export function sestavKZaplaceni(
  zakazky: readonly ZakazkaProPokladnu[],
  faktury: readonly FakturaProPokladnu[],
  zaplaceno: ReadonlyMap<string, number>,
): KZaplaceni[] {
  const fakturaZakazky = new Map<string, FakturaProPokladnu>();
  for (const f of faktury) for (const t of f.ticketIds) fakturaZakazky.set(t, f);
  const out: KZaplaceni[] = [];
  const uzVZakazce = new Set<string>();
  for (const t of zakazky) {
    const f = fakturaZakazky.get(t.id);
    if (f && f.status === "paid") continue;
    if (f && f.ticketIds.length > 1) continue;
    const celkem = f ? naHalere(Number(f.total) || 0) : cenaZakazky(t);
    const z = zaplaceno.get(t.id) ?? 0;
    const zbyva = naHalere(celkem - z);
    if (f) uzVZakazce.add(f.id);
    if (celkem > 0 && zbyva <= 0) continue;
    out.push({
      klic: `t:${t.id}`,
      ticketId: t.id,
      invoiceId: f?.id ?? null,
      kod: t.code ?? "",
      nazev: t.title?.trim() || "Zakázka",
      zakaznik: t.customerName ?? "",
      stav: t.status,
      branchId: t.branchId,
      celkem,
      zaplaceno: z,
      zbyva: Math.max(0, zbyva),
    });
  }
  for (const f of faktury) {
    if (f.status === "paid" || uzVZakazce.has(f.id)) continue;
    if (f.ticketIds.length === 1) continue;
    out.push({
      klic: `f:${f.id}`,
      ticketId: null,
      invoiceId: f.id,
      kod: f.number,
      nazev: f.ticketIds.length > 1 ? `Souhrnná faktura (${f.ticketIds.length} zakázky)` : "Faktura",
      zakaznik: f.customerName ?? "",
      stav: null,
      branchId: f.branchId,
      celkem: naHalere(Number(f.total) || 0),
      zaplaceno: 0,
      zbyva: naHalere(Number(f.total) || 0),
    });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Export
// ---------------------------------------------------------------------------

const csvBunka = (v: string | number) => {
  const s = typeof v === "number" ? v.toFixed(2).replace(".", ",") : v;
  return /[";\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

/** CSV pro účetní (středníky, čárka v číslech, BOM kvůli Excelu). */
export function csvPohybu(
  pohyby: readonly PohybPokladny[],
  nazevPokladny: (id: string) => string,
  jmeno: (userId: string | null) => string,
  kodZakazky: (ticketId: string) => string,
): string {
  const hlavicka = ["Datum", "Čas", "Pokladna", "Druh", "Kategorie", "Popis", "Zakázka", "Způsob", "Příjem", "Výdaj", "Zaokrouhlení", "Zapsal"];
  const radky = [...pohyby]
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
    .map((p) => {
      const d = new Date(p.createdAt);
      const druh = p.druh === "storno" && p.puvodniDruh ? `Storno – ${DRUH_TEXT[p.puvodniDruh]}` : DRUH_TEXT[p.druh];
      return [
        d.toLocaleDateString("cs-CZ"),
        d.toLocaleTimeString("cs-CZ", { hour: "2-digit", minute: "2-digit" }),
        nazevPokladny(p.pokladnaId),
        druh,
        p.kategorie ?? "",
        p.popis ?? "",
        p.ticketId ? kodZakazky(p.ticketId) : "",
        ZPUSOB_TEXT[p.zpusob],
        p.smer === "prijem" ? p.castka : "",
        p.smer === "vydej" ? p.castka : "",
        p.zaokrouhleni || "",
        jmeno(p.createdBy),
      ].map((v) => csvBunka(v as string | number)).join(";");
    });
  return "﻿" + [hlavicka.join(";"), ...radky].join("\r\n");
}

// ---------------------------------------------------------------------------
// Databáze
// ---------------------------------------------------------------------------

const str = (v: unknown): string => (typeof v === "string" ? v : "");
const strN = (v: unknown): string | null => (typeof v === "string" && v ? v : null);
const num = (v: unknown): number => Number(v) || 0;
const DRUHY: ReadonlySet<string> = new Set(Object.keys(DRUH_TEXT));
const druh = (v: unknown): DruhPohybu | null => (typeof v === "string" && DRUHY.has(v) ? (v as DruhPohybu) : null);
const zpusob = (v: unknown): ZpusobPlatby => (v === "card" || v === "transfer" ? v : "cash");

export function mapPokladna(r: Record<string, unknown>): Pokladna {
  return {
    id: str(r.id),
    serviceId: str(r.service_id),
    branchId: strN(r.branch_id),
    nazev: str(r.nazev) || "Pokladna",
    pocatecniStav: num(r.pocatecni_stav),
    poradi: num(r.poradi),
    archivovana: !!r.archivovana_at,
  };
}

export function mapPohyb(r: Record<string, unknown>): PohybPokladny {
  return {
    id: str(r.id),
    pokladnaId: str(r.pokladna_id),
    smer: r.smer === "vydej" ? "vydej" : "prijem",
    castka: num(r.castka),
    zpusob: zpusob(r.zpusob),
    druh: druh(r.druh) ?? "prijem",
    puvodniDruh: druh(r.puvodni_druh),
    kategorie: strN(r.kategorie),
    popis: strN(r.popis),
    ticketId: strN(r.ticket_id),
    invoiceId: strN(r.invoice_id),
    zaokrouhleni: num(r.zaokrouhleni),
    prevodId: strN(r.prevod_id),
    stornoId: strN(r.storno_id),
    uzaverkaId: strN(r.uzaverka_id),
    createdAt: str(r.created_at),
    createdBy: strN(r.created_by),
  };
}

function mapUzaverka(r: Record<string, unknown>): Uzaverka {
  return {
    id: str(r.id),
    pokladnaId: str(r.pokladna_id),
    ocekavano: num(r.ocekavano),
    napocitano: num(r.napocitano),
    rozdil: num(r.rozdil),
    platidla: r.platidla && typeof r.platidla === "object" ? (r.platidla as Record<string, number>) : null,
    poznamka: strN(r.poznamka),
    createdAt: str(r.created_at),
    createdBy: strN(r.created_by),
  };
}

// deno-lint-ignore no-explicit-any
const db = () => supabase as any;

function chyba(e: unknown, vychozi: string): Error {
  const m = (e as { message?: unknown } | null)?.message;
  return new Error(typeof m === "string" && m ? m : vychozi);
}

export async function nactiPokladny(serviceId: string): Promise<Pokladna[]> {
  if (!supabase) return [];
  const { data, error } = await db().from("pokladny").select("*").eq("service_id", serviceId).order("poradi").order("created_at");
  if (error) throw chyba(error, "Pokladny se nepodařilo načíst.");
  return ((data ?? []) as Record<string, unknown>[]).map(mapPokladna);
}

export async function nactiStavy(serviceId: string): Promise<Map<string, StavPokladny>> {
  if (!supabase) return new Map();
  const { data, error } = await db().rpc("pokladna_stavy", { p_service_id: serviceId });
  if (error) throw chyba(error, "Stav pokladen se nepodařilo načíst.");
  return new Map(
    ((data ?? []) as Record<string, unknown>[]).map((r) => [
      str(r.pokladna_id),
      { pokladnaId: str(r.pokladna_id), stav: num(r.stav), posledniUzaverkaAt: strN(r.posledni_uzaverka_at), hotovostniOdUzaverky: num(r.hotovostni_od_uzaverky) },
    ]),
  );
}

export async function nactiPohyby(serviceId: string, v: { od: Date; do?: Date; pokladnaIds?: string[] }): Promise<PohybPokladny[]> {
  if (!supabase) return [];
  const out: PohybPokladny[] = [];
  // Stránkování po 1000 (strop PostgREST).
  for (let from = 0; from < 50_000; from += 1000) {
    let q = db().from("pokladna_pohyby").select("*").eq("service_id", serviceId).gte("created_at", v.od.toISOString());
    if (v.do) q = q.lt("created_at", v.do.toISOString());
    if (v.pokladnaIds) q = q.in("pokladna_id", v.pokladnaIds.length ? v.pokladnaIds : ["00000000-0000-0000-0000-000000000000"]);
    const { data, error } = await q.order("created_at", { ascending: false }).order("id").range(from, from + 999);
    if (error) throw chyba(error, "Pohyby se nepodařilo načíst.");
    const radky = (data ?? []) as Record<string, unknown>[];
    out.push(...radky.map(mapPohyb));
    if (radky.length < 1000) break;
  }
  return out;
}

export async function nactiUzaverky(pokladnaId: string, limit = 30): Promise<Uzaverka[]> {
  if (!supabase) return [];
  const { data, error } = await db().from("pokladna_uzaverky").select("*").eq("pokladna_id", pokladnaId).order("created_at", { ascending: false }).limit(limit);
  if (error) throw chyba(error, "Uzávěrky se nepodařilo načíst.");
  return ((data ?? []) as Record<string, unknown>[]).map(mapUzaverka);
}

async function rpc<T>(nazev: string, args: Record<string, unknown>, vychozi: string): Promise<T> {
  if (!supabase) throw new Error("Není připojení k databázi.");
  const { data, error } = await db().rpc(nazev, args);
  if (error) throw chyba(error, vychozi);
  return data as T;
}

export async function ulozPokladnu(v: { id: string | null; serviceId: string; nazev: string; branchId: string | null; pocatecniStav: number; poradi?: number | null; archivovat?: boolean }): Promise<Pokladna> {
  const r = await rpc<Record<string, unknown>>("pokladna_uloz", {
    p_id: v.id, p_service_id: v.serviceId, p_nazev: v.nazev, p_branch_id: v.branchId, p_pocatecni_stav: v.pocatecniStav, p_poradi: v.poradi ?? null, p_archivovat: !!v.archivovat,
  }, "Pokladnu se nepodařilo uložit.");
  return mapPokladna(r);
}

export async function zapisPohyb(v: { pokladnaId: string; druh: "prijem" | "vydej" | "vklad" | "vyber" | "odvod"; castka: number; zpusob?: ZpusobPlatby; kategorie?: string | null; popis?: string | null }): Promise<PohybPokladny> {
  const r = await rpc<Record<string, unknown>>("pokladna_zapis", {
    p_pokladna_id: v.pokladnaId, p_druh: v.druh, p_castka: v.castka, p_zpusob: v.zpusob ?? "cash", p_kategorie: v.kategorie ?? null, p_popis: v.popis ?? null,
  }, "Pohyb se nepodařilo zapsat.");
  return mapPohyb(r);
}

export async function zaplatit(v: { pokladnaId: string; druh: "zakazka" | "zaloha" | "faktura"; castka: number; zpusob: ZpusobPlatby; ticketId?: string | null; invoiceId?: string | null; zaokrouhleni?: number; popis?: string | null }): Promise<PohybPokladny> {
  const r = await rpc<Record<string, unknown>>("pokladna_zaplatit", {
    p_pokladna_id: v.pokladnaId, p_druh: v.druh, p_castka: v.castka, p_zpusob: v.zpusob, p_ticket_id: v.ticketId ?? null, p_invoice_id: v.invoiceId ?? null, p_zaokrouhleni: v.zaokrouhleni ?? 0, p_popis: v.popis ?? null,
  }, "Platbu se nepodařilo zapsat.");
  return mapPohyb(r);
}

export async function prevest(v: { z: string; do: string; castka: number; popis?: string | null }): Promise<void> {
  await rpc("pokladna_prevod", { p_z: v.z, p_do: v.do, p_castka: v.castka, p_popis: v.popis ?? null }, "Převod se nepodařilo zapsat.");
}

export async function stornovat(pohybId: string, duvod?: string | null): Promise<void> {
  await rpc("pokladna_storno", { p_pohyb_id: pohybId, p_duvod: duvod ?? null }, "Storno se nepodařilo zapsat.");
}

export async function uzavrit(v: { pokladnaId: string; napocitano: number; platidla?: Record<string, number> | null; poznamka?: string | null }): Promise<Uzaverka> {
  const r = await rpc<Record<string, unknown>>("pokladna_uzavrit", {
    p_pokladna_id: v.pokladnaId, p_napocitano: v.napocitano, p_platidla: v.platidla ?? null, p_poznamka: v.poznamka ?? null,
  }, "Uzávěrku se nepodařilo uložit.");
  return mapUzaverka(r);
}

const SLOUPCE_ZAKAZKY = "id, code, title, customer_name, status, branch_id, performed_repairs, discount_type, discount_value";

function mapZakazka(r: Record<string, unknown>): ZakazkaProPokladnu {
  return {
    id: str(r.id),
    code: strN(r.code),
    title: strN(r.title),
    customerName: strN(r.customer_name),
    status: strN(r.status),
    branchId: strN(r.branch_id),
    performedRepairs: Array.isArray(r.performed_repairs) ? (r.performed_repairs as Array<{ price?: number | null }>) : null,
    discountType: r.discount_type === "percentage" || r.discount_type === "amount" ? r.discount_type : null,
    discountValue: r.discount_value == null ? null : num(r.discount_value),
  };
}

/** Faktury k zakázkám (aktivní vazby) a nezaplacené faktury servisu. */
async function nactiFaktury(serviceId: string, ticketIds: string[], jenNezaplacene: boolean): Promise<FakturaProPokladnu[]> {
  const vazby = new Map<string, string[]>();
  const fakturyIds = new Set<string>();
  if (ticketIds.length) {
    const { data } = await db().from("invoice_tickets").select("invoice_id, ticket_id").eq("service_id", serviceId).eq("aktivni", true).in("ticket_id", ticketIds);
    for (const r of (data ?? []) as Array<{ invoice_id: string }>) fakturyIds.add(r.invoice_id);
  }
  let q = db().from("invoices").select("id, number, total, status, customer_name, branch_id, kind").eq("service_id", serviceId).is("deleted_at", null);
  q = jenNezaplacene ? q.in("status", ["issued", "sent", "overdue"]).limit(300) : q.in("id", fakturyIds.size ? [...fakturyIds] : ["00000000-0000-0000-0000-000000000000"]);
  const { data: fak, error } = await q;
  if (error) return [];
  const radky = ((fak ?? []) as Array<Record<string, unknown>>).filter((f) => !f.kind || f.kind === "invoice");
  const ids = radky.map((f) => str(f.id));
  if (ids.length) {
    const { data } = await db().from("invoice_tickets").select("invoice_id, ticket_id").eq("aktivni", true).in("invoice_id", ids);
    for (const r of (data ?? []) as Array<{ invoice_id: string; ticket_id: string }>) {
      vazby.set(r.invoice_id, [...(vazby.get(r.invoice_id) ?? []), r.ticket_id]);
    }
  }
  return radky.map((f) => ({
    id: str(f.id), number: str(f.number), total: num(f.total), status: str(f.status), customerName: strN(f.customer_name), branchId: strN(f.branch_id), ticketIds: vazby.get(str(f.id)) ?? [],
  }));
}

async function zaplacenoNaZakazky(ticketIds: string[]): Promise<Map<string, number>> {
  if (!ticketIds.length) return new Map();
  const { data } = await db().from("pokladna_pohyby").select("ticket_id, smer, castka, zaokrouhleni, druh, puvodni_druh").in("ticket_id", ticketIds);
  return zaplacenoPodleZakazek(((data ?? []) as Record<string, unknown>[]).map(mapPohyb));
}

/** Zakázky připravené k vydání a nezaplacené faktury – nabídka „K zaplacení“. */
export async function nactiKZaplaceni(serviceId: string, stavyKVydani: string[]): Promise<KZaplaceni[]> {
  if (!supabase || stavyKVydani.length === 0) return [];
  const { data, error } = await db().from("tickets").select(SLOUPCE_ZAKAZKY).eq("service_id", serviceId).is("deleted_at", null).in("status", stavyKVydani).order("updated_at", { ascending: false }).limit(300);
  if (error) throw chyba(error, "Zakázky k zaplacení se nepodařilo načíst.");
  const zakazky = ((data ?? []) as Record<string, unknown>[]).map(mapZakazka);
  const ids = zakazky.map((z) => z.id);
  const [kZakazkam, nezaplacene, zaplaceno] = await Promise.all([nactiFaktury(serviceId, ids, false), nactiFaktury(serviceId, [], true), zaplacenoNaZakazky(ids)]);
  const faktury = new Map([...nezaplacene, ...kZakazkam].map((f) => [f.id, f]));
  return sestavKZaplaceni(zakazky, [...faktury.values()], zaplaceno);
}

/** Hledání libovolné zakázky (záloha, platba zakázky v jiném stavu). */
export async function hledejZakazky(serviceId: string, dotaz: string): Promise<KZaplaceni[]> {
  const q = dotaz.trim().replace(/[%,()]/g, " ").trim();
  if (!supabase || q.length < 2) return [];
  const { data, error } = await db().from("tickets").select(SLOUPCE_ZAKAZKY).eq("service_id", serviceId).is("deleted_at", null)
    .or(`code.ilike.%${q}%,customer_name.ilike.%${q}%,customer_phone.ilike.%${q}%,title.ilike.%${q}%`)
    .order("created_at", { ascending: false }).limit(20);
  if (error) throw chyba(error, "Hledání se nepovedlo.");
  const zakazky = ((data ?? []) as Record<string, unknown>[]).map(mapZakazka);
  const ids = zakazky.map((z) => z.id);
  const [faktury, zaplaceno] = await Promise.all([nactiFaktury(serviceId, ids, false), zaplacenoNaZakazky(ids)]);
  const podleZakazky = new Map<string, FakturaProPokladnu>();
  for (const f of faktury) for (const t of f.ticketIds) podleZakazky.set(t, f);
  // Při hledání se ukáže i zaplacená zakázka – záloha nebo doplatek dávají smysl kdykoli.
  return zakazky.map((t) => {
    const f = podleZakazky.get(t.id);
    const celkem = f && f.ticketIds.length === 1 ? naHalere(f.total) : cenaZakazky(t);
    const z = zaplaceno.get(t.id) ?? 0;
    return {
      klic: `t:${t.id}`, ticketId: t.id, invoiceId: f && f.ticketIds.length === 1 && f.status !== "paid" ? f.id : null,
      kod: t.code ?? "", nazev: t.title?.trim() || "Zakázka", zakaznik: t.customerName ?? "", stav: t.status, branchId: t.branchId,
      celkem, zaplaceno: z, zbyva: Math.max(0, naHalere(celkem - z)),
    };
  });
}

/**
 * Vydané zakázky bez platby od spuštění pokladny – pro upozornění na Dnes.
 * Zaplacená = má v pokladně platbu, nebo zaplacenou fakturu.
 */
export async function nactiVydaneBezPlatby(serviceId: string, od: string, vydaneStavy: string[]): Promise<ZakazkaProPokladnu[]> {
  if (!supabase || !vydaneStavy.length) return [];
  const { data, error } = await db().from("tickets").select(SLOUPCE_ZAKAZKY).eq("service_id", serviceId).is("deleted_at", null)
    .in("status", vydaneStavy).gte("completed_at", `${od}T00:00:00`).order("completed_at", { ascending: false }).limit(200);
  if (error) return [];
  const zakazky = ((data ?? []) as Record<string, unknown>[]).map(mapZakazka).filter((t) => cenaZakazky(t) > 0);
  const ids = zakazky.map((z) => z.id);
  const [faktury, zaplaceno] = await Promise.all([nactiFaktury(serviceId, ids, false), zaplacenoNaZakazky(ids)]);
  const zaplacenaFakturou = new Set<string>();
  for (const f of faktury) if (f.status === "paid") for (const t of f.ticketIds) zaplacenaFakturou.add(t);
  return zakazky.filter((t) => !zaplacenaFakturou.has(t.id) && (zaplaceno.get(t.id) ?? 0) <= 0);
}

/**
 * Chybí uzávěrka z minulých dnů? Ano, když je v pokladně hotovostní pohyb
 * z dřívějška než dnes a po poslední uzávěrce. Dnešní tržba bez uzávěrky
 * je v pořádku – den ještě neskončil.
 */
export function chybiUzaverka(posledniUzaverkaAt: string | null, posledniHotovostPredDneskem: string | null | undefined): boolean {
  if (!posledniHotovostPredDneskem) return false;
  return !posledniUzaverkaAt || posledniHotovostPredDneskem > posledniUzaverkaAt;
}

/** Poslední hotovostní pohyb před dneškem (za 31 dní) po pokladnách. */
export async function nactiPosledniHotovostPredDneskem(serviceId: string): Promise<Map<string, string>> {
  if (!supabase) return new Map();
  const dnes = new Date();
  dnes.setHours(0, 0, 0, 0);
  const od = new Date(dnes.getTime() - 31 * 86_400_000);
  const { data } = await db().from("pokladna_pohyby").select("pokladna_id, created_at").eq("service_id", serviceId).eq("zpusob", "cash").neq("druh", "rozdil")
    .gte("created_at", od.toISOString()).lt("created_at", dnes.toISOString()).order("created_at", { ascending: false }).limit(1000);
  const m = new Map<string, string>();
  for (const r of (data ?? []) as Array<{ pokladna_id: string; created_at: string }>) if (!m.has(r.pokladna_id)) m.set(r.pokladna_id, r.created_at);
  return m;
}

export function subscribePokladna(serviceId: string, onChange: () => void): () => void {
  if (!supabase) return () => {};
  const client = supabase;
  const kanal = client
    .channel(`pokladna:${serviceId}:${Math.random().toString(36).slice(2, 8)}`)
    .on("postgres_changes", { event: "*", schema: "public", table: "pokladna_pohyby", filter: `service_id=eq.${serviceId}` }, () => onChange())
    .on("postgres_changes", { event: "*", schema: "public", table: "pokladny", filter: `service_id=eq.${serviceId}` }, () => onChange())
    .subscribe();
  return () => { void client.removeChannel(kanal); };
}
