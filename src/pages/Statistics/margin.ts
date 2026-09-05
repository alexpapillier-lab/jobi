import type { TicketEx } from "../Orders";

/**
 * Výpočet marže pro Statistiky.
 *
 * Definice (držet přesně, stejně počítá i CSV a graf):
 *
 * Pro jednu provedenou opravu na zakázce:
 *   příjem  = `price ?? 0`
 *   náklady = `costs`, pokud jsou u záznamu vyplněné; jinak (záložně z ceníku)
 *             `costs` ceníkové opravy podle `repairId`
 *           + nákupní ceny navázaných dílů (`entry.productIds`, když chybí,
 *             tak `repair.productIds` z ceníku) podle `purchase_price`.
 *             Díl bez nákupní ceny se počítá jako 0 a záznam se eviduje jako
 *             „bez nákupní ceny“.
 *   Záznam „bez nákladů“ = nemá vlastní `costs`, ceník nezná jeho opravu
 *   (nebo ta nemá `costs`) a žádný navázaný díl nemá nákupní cenu.
 *
 * Marže zakázky = Σ(příjem − náklady) − sleva (sleva stejně jako
 * v `computeFinalPrice`: procenta z hrubé ceny nebo pevná částka).
 * Marže v % = marže / příjem (0, když je příjem 0).
 */

/** Ceník a sklad – zdroj záložních nákladů. Chybí-li, počítá se jen z `costs`. */
export type CostSources = {
  /** id ceníkové opravy → { costs, productIds } */
  repairs: ReadonlyMap<string, { costs?: number; productIds?: string[] }>;
  /** id produktu → nákupní cena (null = produkt existuje, ale cenu nemá) */
  purchasePrices: ReadonlyMap<string, number | null>;
};

export const EMPTY_COST_SOURCES: CostSources = { repairs: new Map(), purchasePrices: new Map() };

type PerformedEntry = NonNullable<TicketEx["performedRepairs"]>[number];

export type EntryMargin = {
  revenue: number;
  cost: number;
  /** Záznam má aspoň jeden zdroj nákladů (vlastní costs, ceník nebo díl s cenou). */
  hasCostSource: boolean;
  /** Některý navázaný díl nemá nákupní cenu (počítá se jako 0). */
  missingPurchasePrice: boolean;
};

export function entryMargin(entry: PerformedEntry, sources: CostSources): EntryMargin {
  const revenue = entry.price ?? 0;
  const catalog = entry.repairId ? sources.repairs.get(entry.repairId) : undefined;

  let cost = 0;
  let hasCostSource = false;
  let missingPurchasePrice = false;

  if (typeof entry.costs === "number") {
    cost += entry.costs;
    hasCostSource = true;
  } else if (catalog && typeof catalog.costs === "number") {
    cost += catalog.costs;
    hasCostSource = true;
  }

  const productIds = entry.productIds ?? catalog?.productIds ?? [];
  for (const id of productIds) {
    const pp = sources.purchasePrices.get(id);
    if (typeof pp === "number") {
      cost += pp;
      hasCostSource = true;
    } else {
      missingPurchasePrice = true;
    }
  }

  return { revenue, cost, hasCostSource, missingPurchasePrice };
}

export type TicketMargin = {
  /** Σ price před slevou. */
  gross: number;
  discount: number;
  /** Příjem po slevě (nikdy pod nulou – shodně s `computeFinalPrice`). */
  revenue: number;
  cost: number;
  /** Σ(příjem − náklady) − sleva. */
  margin: number;
  /** Počet záznamů bez jakéhokoli zdroje nákladů. */
  entriesWithoutCost: number;
  /** Počet záznamů, u kterých některý díl nemá nákupní cenu. */
  entriesMissingPurchasePrice: number;
};

export function ticketDiscountOf(gross: number, t: TicketEx): number {
  if (t.discountType === "percentage") return (gross * (t.discountValue || 0)) / 100;
  if (t.discountType === "amount") return t.discountValue || 0;
  return 0;
}

export function ticketMargin(t: TicketEx, sources: CostSources): TicketMargin {
  let gross = 0;
  let cost = 0;
  let entriesWithoutCost = 0;
  let entriesMissingPurchasePrice = 0;
  for (const entry of t.performedRepairs || []) {
    const m = entryMargin(entry, sources);
    gross += m.revenue;
    cost += m.cost;
    if (!m.hasCostSource) entriesWithoutCost += 1;
    if (m.missingPurchasePrice) entriesMissingPurchasePrice += 1;
  }
  const discount = ticketDiscountOf(gross, t);
  const revenue = Math.max(0, gross - discount);
  return {
    gross,
    discount,
    revenue,
    cost,
    margin: gross - cost - discount,
    entriesWithoutCost,
    entriesMissingPurchasePrice,
  };
}

/** Barva pruhu podle výše marže v %: zelená ≥ 50 %, oranžová 20–50 %, červená < 20 %. */
export function marginColor(pct: number): string {
  if (pct >= 50) return "var(--success)";
  if (pct >= 20) return "var(--warning)";
  return "var(--danger)";
}

/** Marže v procentech; 0, když není z čeho počítat. */
export function marginPercent(margin: number, revenue: number): number {
  return revenue > 0 ? (margin / revenue) * 100 : 0;
}

// ========================
// Seskupení do žebříčků
// ========================

export type MarginRow = {
  /** Klíč skupiny (repairId nebo název / označení zařízení). */
  key: string;
  name: string;
  count: number;
  revenue: number;
  cost: number;
  margin: number;
  /** % z příjmu skupiny. */
  marginPct: number;
  /** Ve skupině není žádný záznam se zdrojem nákladů. */
  noCostData: boolean;
};

function finishRow(row: Omit<MarginRow, "marginPct" | "noCostData"> & { withCost: number }): MarginRow {
  const { withCost, ...rest } = row;
  return { ...rest, marginPct: marginPercent(rest.margin, rest.revenue), noCostData: withCost === 0 };
}

/**
 * Marže podle oprav – skupina podle `repairId` (když je), jinak podle názvu.
 * Ruční opravy se stejným názvem tak spadnou k sobě; ceníková oprava drží
 * pohromadě i po přejmenování. Sleva zakázky se do řádků oprav nepromítá
 * (není jak ji rozdělit mezi opravy), proto se součty řádků liší od KPI.
 */
export function marginByRepair(tickets: TicketEx[], sources: CostSources): MarginRow[] {
  const groups = new Map<string, { name: string; count: number; revenue: number; cost: number; withCost: number }>();
  for (const t of tickets) {
    for (const entry of t.performedRepairs || []) {
      const key = entry.repairId ? `id:${entry.repairId}` : `name:${entry.name}`;
      const m = entryMargin(entry, sources);
      const g = groups.get(key) ?? { name: entry.name, count: 0, revenue: 0, cost: 0, withCost: 0 };
      g.count += 1;
      g.revenue += m.revenue;
      g.cost += m.cost;
      if (m.hasCostSource) g.withCost += 1;
      // Nejnovější zakázky jsou v seznamu první – nechat jméno z první.
      groups.set(key, g);
    }
  }
  return [...groups.entries()].map(([key, g]) => finishRow({ key, ...g, margin: g.revenue - g.cost }));
}

/**
 * Marže podle zařízení – skupina podle `deviceLabel`, marže zakázky včetně
 * slevy (tady se sleva rozdělovat nemusí, patří celé zakázce).
 */
export function marginByDevice(tickets: TicketEx[], sources: CostSources): MarginRow[] {
  const groups = new Map<string, { name: string; count: number; revenue: number; cost: number; margin: number; withCost: number }>();
  for (const t of tickets) {
    if (!t.deviceLabel) continue;
    const m = ticketMargin(t, sources);
    const g = groups.get(t.deviceLabel) ?? { name: t.deviceLabel, count: 0, revenue: 0, cost: 0, margin: 0, withCost: 0 };
    g.count += 1;
    g.revenue += m.revenue;
    g.cost += m.cost;
    g.margin += m.margin;
    const entries = (t.performedRepairs || []).length;
    if (entries - m.entriesWithoutCost > 0) g.withCost += 1;
    groups.set(t.deviceLabel, g);
  }
  return [...groups.entries()].map(([key, g]) => finishRow({ key, ...g }));
}

export type MarginSort = "margin" | "pct" | "count";

export function sortMarginRows(rows: MarginRow[], sort: MarginSort): MarginRow[] {
  const sorted = [...rows];
  switch (sort) {
    case "pct":
      // Řádky bez nákladů mají 100 % jen zdánlivě – řadit je až za ostatní.
      sorted.sort((a, b) => Number(a.noCostData) - Number(b.noCostData) || b.marginPct - a.marginPct || b.margin - a.margin);
      break;
    case "count":
      sorted.sort((a, b) => b.count - a.count || b.margin - a.margin);
      break;
    default:
      sorted.sort((a, b) => b.margin - a.margin || b.count - a.count);
  }
  return sorted;
}
