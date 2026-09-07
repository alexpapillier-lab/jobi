import { NENI_STORNO, marginPercent, ticketMargin, type CostSources, type JeStorno } from "./margin";
import type { TicketEx } from "../Orders";

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
 */

export type Kpis = {
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

/** Mapování z Orders.tsx přidává completed_at mimo typ TicketEx. */
export type TicketWithCompletion = TicketEx & { completed_at?: string | null };

export const PRAZDNE_KPI: Kpis = {
  totalTickets: 0,
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

export function computeKpis(list: TicketEx[], sources: CostSources, jeStorno: JeStorno = NENI_STORNO): Kpis {
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
    const m = ticketMargin(t, sources, jeStorno(t));
    const rev = m.revenue;
    totalRevenue += rev;
    totalCosts += m.cost;
    totalDiscounts += m.discount;
    profit += m.margin;
    entriesWithoutCost += m.entriesWithoutCost;
    entriesMissingPurchasePrice += m.entriesMissingPurchasePrice;
    if (rev > 0) paidCount += 1;

    // Průměrná doba zakázky se počítá i ze stornovaných: ta zakázka tu
    // opravdu ležela, jen se za ni nezaplatilo. Server to má stejně.
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
    // Dělení jen tam, kde je čím dělit – jinak by v prázdném servisu svítilo
    // „NaN Kč“ a „Infinity %“.
    averageTicketPrice: paidCount > 0 ? totalRevenue / paidCount : 0,
    averageTicketDurationDays: durationCount > 0 ? durationSum / durationCount : 0,
  };
}
