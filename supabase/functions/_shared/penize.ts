/**
 * Peníze na serveru – jeden vzorec a jeden formát.
 *
 * Samostatný soubor bez Deno API, aby ho šlo pustit z testů Jobi (vitest);
 * stejně jako `ceny.ts`. Obsah musí odpovídat `src/lib/slevaZakazky.ts`
 * a `src/lib/invoiceMath.ts` – shodu hlídá `src/lib/penize.test.ts`.
 *
 * Proč vůbec: portál, automatizace i e-mail dřív každý počítal a formátoval
 * částku po svém. Zákazník tak viděl v portálu „666.6700000000001“, v SMS
 * „1 235 Kč“ a na dokladu „1 234,50 Kč“ – tři čísla za tutéž opravu.
 */

/**
 * Zaokrouhlení na haléře, půlka vždy od nuly.
 *
 * `Math.round` posílá půlku k plus nekonečnu, takže by dobropis nevrátil
 * přesně to, co faktura naúčtovala. Relativní epsilon srovnává plovoucí
 * čárku: 2,675 × 100 vyjde jako 267,49999999999997.
 */
export function naHalere(n: number): number {
  if (!Number.isFinite(n)) return 0;
  const setiny = Math.abs(n) * 100;
  const zaokrouhleno = Math.round(setiny + setiny * Number.EPSILON) / 100;
  // Záporná nula se tiskne jako „−0,00 Kč“; nula je nula.
  return zaokrouhleno === 0 ? 0 : n < 0 ? -zaokrouhleno : zaokrouhleno;
}

export type TypSlevy = "percentage" | "amount" | null | undefined;

/** Kolik se z hrubé ceny strhává. Nikdy víc, než kolik je cena. */
export function castkaSlevy(hruba: number, typ: TypSlevy, hodnota: number | null | undefined): number {
  const v = hodnota ?? 0;
  // Záporná sleva (překlep v zadání) by cenu zvyšovala – server ji dřív vzal.
  if (!typ || v <= 0 || hruba <= 0) return 0;
  const sleva = typ === "percentage" ? (hruba * v) / 100 : v;
  return Math.min(hruba, naHalere(sleva));
}

/** Kolik zákazník nakonec zaplatí. */
export function konecnaCena(hruba: number, typ: TypSlevy, hodnota: number | null | undefined): number {
  return Math.max(0, naHalere(hruba - castkaSlevy(hruba, typ, hodnota)));
}

/**
 * Konečná cena zakázky z provedených oprav.
 *
 * Hrubý součet se zaokrouhlí na haléře už tady: součet floatů umí vyrobit
 * 666,6700000000001 a takové číslo se pak posílá do JSON portálu i do QR platby.
 */
export function cenaZakazky(
  opravy: Array<{ price?: number | null }>,
  typ: TypSlevy,
  hodnota: number | null | undefined,
): number {
  const hruba = naHalere(opravy.reduce((s, r) => s + (Number(r?.price) || 0), 0));
  return konecnaCena(hruba, typ, hodnota);
}

/**
 * Částka česky i s měnou: „1 234,50 Kč“.
 *
 * Stejný výstup jako `formatCurrency` v `src/lib/invoiceMath.ts`, včetně
 * nedělitelných mezer – doklad z e-mailu se nesmí lišit od vytištěného.
 */
export function formatujCastku(amount: number, currency?: string | null): string {
  const mena = (currency || "").trim() || "CZK";
  const cislo = Number.isFinite(amount) ? amount : 0;
  const v = Math.abs(cislo) < 0.005 ? 0 : cislo;
  try {
    return new Intl.NumberFormat("cs-CZ", {
      style: "currency",
      currency: mena,
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(v);
  } catch {
    // Neznámý kód měny nesmí shodit odeslání dokladu.
    return `${new Intl.NumberFormat("cs-CZ", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(v)} ${mena}`;
  }
}

/**
 * Částka bez měny: „1 234,50“.
 *
 * Do šablon SMS a e-mailů, kde si servis „Kč“ píše sám ({{total_price}} Kč).
 * Haléře tam patří: dřív se zaokrouhlovalo na celé koruny a zákazník dostal
 * SMS na 1 235 Kč k dokladu na 1 234,50 Kč.
 */
export function castkaBezMeny(amount: number): string {
  const cislo = Number.isFinite(amount) ? amount : 0;
  const v = Math.abs(cislo) < 0.005 ? 0 : cislo;
  return new Intl.NumberFormat("cs-CZ", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(v);
}

/** Datum pro člověka: „7. 9. 2026“. Prázdné zůstane prázdné. */
export function formatujDatum(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return String(iso);
  return `${d.getDate()}. ${d.getMonth() + 1}. ${d.getFullYear()}`;
}
