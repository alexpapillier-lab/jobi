/**
 * Mapování dokladu do účetních aplikací (iDoklad, Fakturoid).
 *
 * Samostatný soubor bez Deno API a bez sítě, aby se dal ověřit z testů Jobi
 * (vitest) i bez účtu u poskytovatele – viz `src/lib/ucetnictvi.test.ts`.
 */
import { naHalere } from "./penize.ts";

export type ExportPolozka = {
  name: string;
  qty: number;
  unit: string;
  unit_price: number;
  vat_rate: number;
  sort_order: number;
};

/**
 * Sazba DPH → `VatRateType` iDokladu.
 *
 * Číselník: 0 = Reduced1, 1 = Basic, 2 = Zero, 3 = Reduced2. Konkrétní
 * procenta si k nim drží účet podle platné legislativy – od 1. 1. 2024 má
 * Česko jen 21 % (Basic) a 12 % (Reduced1), druhá snížená sazba se
 * nepoužívá.
 *
 * Mapování bylo napsané pro stav před rokem 2024 (15 % = Reduced1,
 * 10 % = Reduced2), takže 12% položka odcházela jako Reduced2. V iDokladu
 * z ní vyšla jiná daň než na dokladu, který dostal zákazník – u opravy za
 * 1 000 Kč rozdíl 20 Kč na DPH.
 */
export function sazbaIdokladu(rate: number): number {
  const r = Number(rate);
  if (!Number.isFinite(r) || r <= 0) return 2; // Zero
  if (r >= 20) return 1; // Basic (21 %)
  if (r >= 11) return 0; // Reduced1 (dnes 12 %, historicky 15 %)
  return 3; // Reduced2 (historických 10 %)
}

/** Druhy dokladů, které se do účetnictví posílat nesmí. */
export const NEEXPORTOVATELNE_DRUHY = ["credit_note", "proforma"] as const;

/**
 * Smí tenhle druh dokladu do účetnictví?
 *
 * Dobropis se skládá ze záporných množství a zálohová faktura není
 * zdanitelné plnění; obojí by se v iDokladu založilo jako běžná vydaná
 * faktura ve špatné číselné řadě a účetní by to dohledávala ručně.
 */
export function lzeExportovat(kind: string | null | undefined): boolean {
  const k = kind || "invoice";
  return !(NEEXPORTOVATELNE_DRUHY as readonly string[]).includes(k);
}

/** Název řádku, kterým se do účetnictví přenáší zaokrouhlení dokladu. */
export const RADEK_ZAOKROUHLENI = "Zaokrouhlení";

/**
 * Řádky dokladu pro export, včetně zaokrouhlení.
 *
 * Jobi tiskne celkovou částku zaokrouhlenou na celé koruny a rozdíl vykazuje
 * jako `invoices.rounding`. Do účetnictví se posílaly jen položky, takže si
 * iDoklad i Fakturoid dopočítaly nezaokrouhlený součet: doklad u zákazníka
 * zněl na 1 235 Kč, tentýž doklad v účetnictví na 1 234,50 Kč. Rozdíl jde
 * ven jako samostatný řádek s nulovou sazbou – přesně tak, jak ho ukazuje
 * vytištěná faktura. Po jeho přičtení je součet celé číslo, takže případné
 * zaokrouhlení nastavené na účtu už nemá co ubrat.
 */
export function radkyProExport(items: ExportPolozka[], rounding: number): ExportPolozka[] {
  const serazene = [...items].sort((a, b) => a.sort_order - b.sort_order);
  const r = Number(rounding);
  if (!Number.isFinite(r) || r === 0) return serazene;
  return [
    ...serazene,
    {
      name: RADEK_ZAOKROUHLENI,
      qty: 1,
      unit: "ks",
      // Tentýž vzorec jako na dokladu – jinak by v účetnictví seděl haléř jinam.
      unit_price: naHalere(r),
      vat_rate: 0,
      sort_order: (serazene[serazene.length - 1]?.sort_order ?? 0) + 1,
    },
  ];
}

/** Součet řádků bez DPH – kontrola, že se export trefil do dokladu. */
export function soucetRadku(items: ExportPolozka[]): number {
  const sum = items.reduce((s, it) => s + (Number(it.qty) || 0) * (Number(it.unit_price) || 0), 0);
  return naHalere(sum);
}
