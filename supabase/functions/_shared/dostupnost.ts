/**
 * Dostupnost produktu ve veřejném API.
 *
 * Režim si volí servis (services.inventory_availability_mode), ne položka:
 *
 *   hidden   – dostupnost se neposílá vůbec
 *   boolean  – jen „skladem / není skladem“ (výchozí)
 *   exact    – přesné číslo
 *
 * Výchozí je `boolean`. Přesná čísla říkají konkurenci, co a kolik máte,
 * a na webu navíc často lžou – mezi prodejem a přegenerováním stránky
 * je prodleva.
 *
 * Bez Deno API, aby to šlo testovat z vitest (viz src/lib/dostupnost.test.ts).
 */

export type RezimDostupnosti = "hidden" | "boolean" | "exact";

export const REZIMY: RezimDostupnosti[] = ["hidden", "boolean", "exact"];

/** Neznámou hodnotu z databáze bere jako `boolean`, ať se nic nerozsype. */
export function rezimDostupnosti(hodnota: unknown): RezimDostupnosti {
  return REZIMY.includes(hodnota as RezimDostupnosti)
    ? (hodnota as RezimDostupnosti)
    : "boolean";
}

/**
 * Vrací hodnotu pole `availability`, nebo undefined když se nemá posílat.
 * Volající pole vynechá – neposílá se `null`, aby web nemusel řešit rozdíl
 * mezi „nevíme“ a „není skladem“.
 */
export function dostupnost(
  stock: unknown,
  rezim: RezimDostupnosti,
): "in_stock" | "out_of_stock" | number | undefined {
  if (rezim === "hidden") return undefined;

  // Záporný sklad se v praxi objeví (ruční korekce, rozdělaná zakázka)
  // a ven jako záporné číslo nepatří.
  const kusu = Number(stock);
  const bezpecny = Number.isFinite(kusu) ? Math.max(0, Math.trunc(kusu)) : 0;

  if (rezim === "exact") return bezpecny;
  return bezpecny > 0 ? "in_stock" : "out_of_stock";
}
