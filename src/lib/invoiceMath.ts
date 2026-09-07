export type InvoiceLineItem = {
  name: string;
  qty: number;
  unit: string;
  unit_price: number;
  vat_rate: number;
};

export type ComputedLine = InvoiceLineItem & {
  line_total: number;
  line_vat: number;
};

export type InvoiceTotals = {
  subtotal: number;
  vat_amount: number;
  total: number;
  rounding: number;
  total_rounded: number;
  vat_breakdown: { rate: number; base: number; vat: number }[];
};

/**
 * Na co se zaokrouhluje celková částka dokladu.
 *
 * `koruny` – na celé jednotky měny, jak se u nás účtuje v hotovosti;
 * `halere` – vůbec, částka zůstane na setiny.
 */
export type RezimZaokrouhleni = "koruny" | "halere";

/**
 * Výchozí režim podle měny.
 *
 * Na celé jednotky se zaokrouhlují jen koruny. Faktura na 99,90 € se dřív
 * vystavila na 100,00 € s „Zaokrouhlením 0,10 €“ – v eurech se ale platí na
 * centy a zákazník dostal doklad o deset centů vyšší, než co si objednal.
 */
export function rezimProMenu(currency?: string | null): RezimZaokrouhleni {
  return ((currency || "CZK").trim().toUpperCase() || "CZK") === "CZK" ? "koruny" : "halere";
}

/**
 * Zaokrouhlení na haléře, půlka vždy od nuly (matematicky, ne bankovně).
 *
 * `Math.round` posílá půlku k plus nekonečnu, takže −0,525 skončilo na −0,52,
 * kdežto 0,525 na 0,53. Dobropis pak nevrátil přesně to, co faktura
 * naúčtovala: položka 1 ks za 2,50 Kč s 21 % dala na faktuře DPH 0,53 Kč,
 * ale na dobropisu jen −0,52 Kč, a v účetnictví zůstal haléř, který nikdo
 * nedohledá. Bankovní zaokrouhlení (půlka k sudé) tu záměrně není: české
 * účetní programy počítají matematicky a doklad by se s nimi rozcházel.
 *
 * Druhá past je plovoucí čárka: 2,675 × 100 vyjde jako 267,49999999999997,
 * takže by se zaokrouhlilo dolů. Proto se před zaokrouhlením přičte
 * relativní epsilon – na čísla, která pod půlkou opravdu jsou, nedosáhne.
 */
export function naHalere(n: number): number {
  if (!Number.isFinite(n)) return 0;
  const setiny = Math.abs(n) * 100;
  const zaokrouhleno = Math.round(setiny + setiny * Number.EPSILON) / 100;
  // Záporná nula se na dokladu tiskne jako „−0,00 Kč“; nula je nula.
  return zaokrouhleno === 0 ? 0 : n < 0 ? -zaokrouhleno : zaokrouhleno;
}

const round2 = naHalere;

export function computeLine(item: InvoiceLineItem): ComputedLine {
  const line_total = round2(item.qty * item.unit_price);
  const line_vat = round2(line_total * (item.vat_rate / 100));
  return { ...item, line_total, line_vat };
}

/**
 * Součty dokladu – jediná pravda o ceně pro aplikaci, náhled i tisk.
 *
 * `mena` určuje, jestli se celek zaokrouhluje na celé jednotky (koruny), nebo
 * zůstane na setinách; `rezim` se dá vynutit ručně (hotovost vs. převodem).
 */
export function computeTotals(
  items: InvoiceLineItem[],
  mena?: string | null,
  rezim: RezimZaokrouhleni = rezimProMenu(mena),
): InvoiceTotals {
  const lines = items.map(computeLine);

  const subtotal = round2(lines.reduce((s, l) => s + l.line_total, 0));

  const vatMap = new Map<number, { base: number; vat: number }>();
  for (const l of lines) {
    const existing = vatMap.get(l.vat_rate) ?? { base: 0, vat: 0 };
    existing.base = round2(existing.base + l.line_total);
    existing.vat = round2(existing.vat + l.line_vat);
    vatMap.set(l.vat_rate, existing);
  }
  const vat_breakdown = Array.from(vatMap.entries())
    .sort((a, b) => a[0] - b[0])
    .map(([rate, v]) => ({ rate, base: v.base, vat: v.vat }));

  const vat_amount = round2(vat_breakdown.reduce((s, v) => s + v.vat, 0));
  const total = round2(subtotal + vat_amount);

  // Symetricky k nule: dobropis −100,50 → −101, stejně jako faktura 100,50 → 101.
  // A nikdy záporná nula – dobropis na −0,40 Kč by se jinak vytiskl jako
  // „Celkem k úhradě −0,00 Kč“.
  const zaokrouhleny = rezim === "koruny" ? Math.round(Math.abs(total)) * (total < 0 ? -1 : 1) : total;
  const total_rounded = zaokrouhleny === 0 ? 0 : zaokrouhleny;
  const rounding = round2(total_rounded - total);

  return { subtotal, vat_amount, total, rounding, total_rounded, vat_breakdown };
}

/**
 * Částka v české podobě i s měnou.
 *
 * Výchozí „CZK" se uplatní i na prázdný řetězec: `Intl.NumberFormat` na
 * prázdnou měnu vyhodí `RangeError`, a protože se tudy chodí při sestavování
 * dokladu, spadlo by tím celé generování a faktura by se vůbec nevytiskla.
 */
export function formatCurrency(amount: number, currency?: string | null): string {
  const mena = (currency || "").trim() || "CZK";
  // Nečíslo by se vytisklo jako „NaN Kč“; na dokladu je poctivější nula.
  const cislo = Number.isFinite(amount) ? amount : 0;
  /* Záporná nula a zbytky pod půl haléře se tisknou jako „−0,00 Kč“ –
     doklad se znaménkem u nuly vypadá jako chyba a účetní ho vrací. */
  const v = Math.abs(cislo) < 0.005 ? 0 : cislo;
  try {
    return new Intl.NumberFormat("cs-CZ", {
      style: "currency",
      currency: mena,
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(v);
  } catch {
    // Neznámý kód měny (překlep v nastavení) nesmí shodit tisk dokladu.
    return `${new Intl.NumberFormat("cs-CZ", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(v)} ${mena}`;
  }
}

/**
 * Částka bez měny: „1 234,50“.
 *
 * Pro místa, kde si „Kč“ dopisuje text kolem – typicky šablony SMS
 * („{{total_price}} Kč“). Stejný formát jako `formatCurrency`, jen bez měny.
 */
export function castkaBezMeny(amount: number): string {
  const cislo = Number.isFinite(amount) ? amount : 0;
  const v = Math.abs(cislo) < 0.005 ? 0 : cislo;
  return new Intl.NumberFormat("cs-CZ", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(v);
}

/**
 * Prázdná položka faktury.
 *
 * Sazbu předává volající podle nastavení servisu – neplátce DPH má 0.
 * Výchozích 21 % zůstává jen jako záloha pro volání bez argumentu.
 */
export function emptyLineItem(vatRate = 21): InvoiceLineItem {
  return { name: "", qty: 1, unit: "ks", unit_price: 0, vat_rate: vatRate };
}
