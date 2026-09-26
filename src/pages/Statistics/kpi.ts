import { NENI_STORNO, marginPercent, ticketMargin, type CostSources, type JeStorno } from "./margin";
import type { TicketEx } from "../Orders";
import { vObdobi, type DateRange } from "./obdobi";

/**
 * Klíčová čísla Statistik počítaná v prohlížeči.
 *
 * Normálně je posílá hotová databázová funkce `public.statistiky_prehled` –
 * největší servis má přes 3 500 zakázek a stahovat je kvůli sedmi číslům by
 * byly megabajty na každé otevření stránky. Tenhle výpočet je záloha pro
 * případ, že RPC selže (stará databáze, výpadek).
 *
 * Právě proto je vytažený sem, mimo komponentu: musí se dát otestovat, že
 * dává **stejná čísla jako server**. Kdykoli se změní jedno, musí se změnit
 * i druhé – jinak se majiteli změní tržby podle toho, jestli zrovna
 * odpovědělo RPC.
 *
 * Pravidlo období (stejné jako na serveru):
 *   - PENÍZE (příjem, náklady, slevy, zisk, marže, průměrná cena) ze zakázek
 *     VYDANÝCH v období – koncový stav a datum přepnutí do něj. Číslo za
 *     uzavřený měsíc se pak už nemění a sedí s pokladnou.
 *   - POČET zakázek ze zakázek PŘIJATÝCH v období – vytížení, ne peníze.
 *   - Průměrná doba ze zakázek UZAVŘENÝCH v období (i storno).
 *   - ROZPRACOVÁNO: otevřené zakázky bez ohledu na období, zvlášť.
 */

export type Kpis = {
  /** Zakázky přijaté v období (včetně storna a rozepsaných). */
  totalTickets: number;
  /** Zakázky vydané v období – ty, ze kterých jsou peníze. */
  issuedTickets: number;
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

/** Mapování z Orders.tsx přidává completed_at mimo typ TicketEx. */
export type TicketWithCompletion = TicketEx & { completed_at?: string | null };

export const PRAZDNE_KPI: Kpis = {
  totalTickets: 0,
  issuedTickets: 0,
  totalRevenue: 0,
  totalCosts: 0,
  totalDiscounts: 0,
  profit: 0,
  marginPct: 0,
  entriesWithoutCost: 0,
  entriesMissingPurchasePrice: 0,
  averageTicketPrice: 0,
  averageTicketDurationDays: 0,
};

/** Rozpracované zakázky: kolik jich je otevřených a co je na nich naceněno. */
export type Rozpracovano = {
  pocet: number;
  /** Otevřené zakázky, které už mají cenu. */
  nacenenych: number;
  prijem: number;
  naklad: number;
};

export const PRAZDNE_ROZPRACOVANO: Rozpracovano = { pocet: 0, nacenenych: 0, prijem: 0, naklad: 0 };

/** Je stav koncový (zakázka je vydaná / uzavřená)? Bere se ze stavů servisu. */
export type JeKoncovy = (t: TicketEx) => boolean;

/**
 * Datum vydání zakázky: přepnutí do koncového stavu. Řádek přepnutý mimo
 * aplikaci před triggerem, který completed_at plní, ho nemá – pak poslední
 * změna, ať zakázka z peněz nevypadne úplně. Stejně to dělá server.
 */
export function datumVydani(t: TicketEx, jeKoncovy: JeKoncovy): string | null {
  if (!jeKoncovy(t)) return null;
  const c = (t as TicketWithCompletion).completed_at;
  if (c) return c;
  return t.updatedAt ?? null;
}

export type ZakazkyObdobi = {
  /** Přijaté v období (created_at) – počty. */
  prijate: TicketEx[];
  /** Vydané v období (koncový stav, ne storno, datum vydání v období) – peníze. */
  vydane: TicketEx[];
  /** Uzavřené v období včetně storna – průměrná doba. */
  uzavrene: TicketEx[];
  /** Otevřené (nekoncový stav, ne storno) bez ohledu na období. */
  rozpracovane: TicketEx[];
};

/** Rozdělí zakázky na čtyři skupiny podle pravidla období. `range` null = bez omezení. */
export function rozdelPodleObdobi(tickets: TicketEx[], range: DateRange | null, jeKoncovy: JeKoncovy, jeStorno: JeStorno = NENI_STORNO): ZakazkyObdobi {
  const prijate: TicketEx[] = [];
  const vydane: TicketEx[] = [];
  const uzavrene: TicketEx[] = [];
  const rozpracovane: TicketEx[] = [];
  for (const t of tickets) {
    const storno = jeStorno(t);
    const koncovy = jeKoncovy(t);
    if (!range || vObdobi(t.createdAt, range)) prijate.push(t);
    const vydano = datumVydani(t, jeKoncovy);
    if (koncovy && vydano && (!range || vObdobi(vydano, range))) {
      uzavrene.push(t);
      if (!storno) vydane.push(t);
    }
    if (!koncovy && !storno) rozpracovane.push(t);
  }
  return { prijate, vydane, uzavrene, rozpracovane };
}

/** Průměrná doba od přijetí do vydání ve dnech; jen zakázky, kde vydání je po přijetí. */
export function prumernaDobaDny(uzavrene: TicketEx[], jeKoncovy: JeKoncovy): number {
  let sum = 0;
  let n = 0;
  for (const t of uzavrene) {
    const vydano = datumVydani(t, jeKoncovy);
    if (!vydano || !t.createdAt) continue;
    const ms = new Date(vydano).getTime() - new Date(t.createdAt).getTime();
    if (ms > 0) {
      sum += ms / (24 * 60 * 60 * 1000);
      n += 1;
    }
  }
  return n > 0 ? sum / n : 0;
}

/** Součty rozpracovaných zakázek – co je naceněné, ale ještě nevydané. */
export function spocitejRozpracovano(rozpracovane: TicketEx[], sources: CostSources): Rozpracovano {
  let nacenenych = 0;
  let prijem = 0;
  let naklad = 0;
  for (const t of rozpracovane) {
    const m = ticketMargin(t, sources, false);
    if (m.gross > 0) nacenenych += 1;
    prijem += m.revenue;
    naklad += m.cost;
  }
  return { pocet: rozpracovane.length, nacenenych, prijem, naklad };
}

/**
 * Klíčová čísla z jedné množiny zakázek: peníze i počet z téže skupiny,
 * průměrná doba z těch, které mají datum dokončení. Stavební kámen pro
 * `computeKpisObdobi`; sám o sobě odpovídá dřívějšímu „vše podle přijetí“.
 */
export function computeKpis(list: TicketEx[], sources: CostSources, jeStorno: JeStorno = NENI_STORNO): Kpis {
  let totalRevenue = 0;
  let totalCosts = 0;
  let totalDiscounts = 0;
  let profit = 0;
  let entriesWithoutCost = 0;
  let entriesMissingPurchasePrice = 0;
  let paidCount = 0;

  for (const t of list) {
    const m = ticketMargin(t, sources, jeStorno(t));
    const rev = m.revenue;
    totalRevenue += rev;
    totalCosts += m.cost;
    totalDiscounts += m.discount;
    profit += m.margin;
    entriesWithoutCost += m.entriesWithoutCost;
    entriesMissingPurchasePrice += m.entriesMissingPurchasePrice;
    if (rev > 0) paidCount += 1;
  }

  // Průměrná doba zakázky se počítá i ze stornovaných: ta zakázka tu
  // opravdu ležela, jen se za ni nezaplatilo. Server to má stejně.
  const maDokonceni: JeKoncovy = (t) => Boolean((t as TicketWithCompletion).completed_at);

  return {
    totalTickets: list.length,
    issuedTickets: list.length,
    totalRevenue,
    totalCosts,
    totalDiscounts,
    profit,
    marginPct: marginPercent(profit, totalRevenue),
    entriesWithoutCost,
    entriesMissingPurchasePrice,
    // Dělení jen tam, kde je čím dělit – jinak by v prázdném servisu svítilo
    // „NaN Kč“ a „Infinity %“.
    averageTicketPrice: paidCount > 0 ? totalRevenue / paidCount : 0,
    averageTicketDurationDays: prumernaDobaDny(list, maDokonceni),
  };
}

/**
 * Klíčová čísla podle pravidla období: peníze z vydaných, počet z přijatých,
 * doba z uzavřených. Přesně to, co vrací `statistiky_prehled`.
 */
export function computeKpisObdobi(skupiny: ZakazkyObdobi, sources: CostSources, jeKoncovy: JeKoncovy, jeStorno: JeStorno = NENI_STORNO): Kpis {
  const penize = computeKpis(skupiny.vydane, sources, jeStorno);
  return {
    ...penize,
    totalTickets: skupiny.prijate.length,
    issuedTickets: skupiny.vydane.length,
    averageTicketDurationDays: prumernaDobaDny(skupiny.uzavrene, jeKoncovy),
  };
}
