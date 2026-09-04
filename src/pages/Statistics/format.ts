/**
 * Formátovací pomůcky pro Statistiky.
 *
 * Drží se mimo komponenty, aby je mohly sdílet karty, graf i tabulka
 * (a aby `react-refresh/only-export-components` nekřičel na soubor,
 * který vyváží komponenty i funkce).
 */

/**
 * Částka bez haléřů. V kartách se haléře nehodí – jen prodlužují číslo,
 * které se v užší kartě nemá kde zalomit (Kč je za nedělitelnou mezerou).
 */
export function formatCurrencyRounded(amount: number): string {
  return new Intl.NumberFormat("cs-CZ", {
    style: "currency",
    currency: "CZK",
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(amount);
}

/** Zkrácená částka do osy grafu a popisků nad sloupci ("12 tis. Kč"). */
export function formatCurrencyCompact(amount: number): string {
  if (Math.abs(amount) < 10_000) return formatCurrencyRounded(amount);
  return new Intl.NumberFormat("cs-CZ", {
    style: "currency",
    currency: "CZK",
    notation: "compact",
    maximumFractionDigits: 1,
  }).format(amount);
}

/** Desetinné číslo česky (čárka místo tečky). */
export function cislo(n: number, desetinnych = 1): string {
  return n.toLocaleString("cs-CZ", { minimumFractionDigits: desetinnych, maximumFractionDigits: desetinnych });
}

/** Celé číslo s českými oddělovači tisíců. */
export function celeCislo(n: number): string {
  return n.toLocaleString("cs-CZ", { maximumFractionDigits: 0 });
}

/** Počet dní s českým skloňováním ("1 den", "3 dny", "5 dní", "2,5 dne"). */
export function dny(n: number): string {
  const abs = Math.abs(n);
  if (!Number.isInteger(abs)) return `${cislo(abs)} dne`;
  if (abs === 1) return "1 den";
  if (abs >= 2 && abs <= 4) return `${abs} dny`;
  return `${abs} dní`;
}

/** Zkratky měsíců do osy grafu (ICU je pro cs-CZ nemá spolehlivě stejné). */
const MONTH_ABBR = ["led", "úno", "bře", "dub", "kvě", "čvn", "čvc", "srp", "zář", "říj", "lis", "pro"];

/** "bře 26" */
export function monthLabelShort(year: number, monthIndex: number): string {
  return `${MONTH_ABBR[monthIndex] ?? ""} ${String(year).slice(2)}`;
}

/** "březen 2026" */
export function monthLabelLong(year: number, monthIndex: number): string {
  return new Date(year, monthIndex, 1).toLocaleDateString("cs-CZ", { month: "long", year: "numeric" });
}

/** Skloňování "zakázka" podle počtu. */
export function zakazky(n: number): string {
  if (n === 1) return "1 zakázka";
  if (n >= 2 && n <= 4) return `${n} zakázky`;
  return `${celeCislo(n)} zakázek`;
}
