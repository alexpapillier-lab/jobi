/**
 * Ruční položky v Owner → Provize: částka k vyplacení navíc (předplatné, které
 * jsem zaplatil) nebo dluh (vzal jsem iPhone od servisu, −6 000). Jsou to
 * řádky provizí bez zakázky s kódem RUCNI-…; do dalšího vyúčtování jdou jako
 * ostatní, záporné snižují vyplácenou částku. Nevyúčtované jdou smazat.
 */

export const PREFIX_RUCNI = "RUCNI-";
const PREFIX_MESICNI = "MESICNI-";

/** Jedinečný kód řádku – čas v ms (kód musí být v rámci servisu unikátní). */
export function kodRucni(ted: Date = new Date()): string {
  return `${PREFIX_RUCNI}${ted.getTime()}`;
}

export function jeRucniPolozka(kod: string | null | undefined): boolean {
  return !!kod && kod.startsWith(PREFIX_RUCNI);
}

/** Řádek bez zakázky: ruční položka nebo měsíční částka. */
export function jePolozkaBezZakazky(kod: string | null | undefined): boolean {
  return jeRucniPolozka(kod) || (!!kod && kod.startsWith(PREFIX_MESICNI));
}

/** Částka z pole („6 000“, „6000,50“): kladné číslo, jinak null. Znaménko určuje tlačítko. */
export function ctiRucniCastku(text: string): number | null {
  const t = text.replace(/[\s\u00a0]|Kč/gi, "").replace(",", ".").replace(/^[+-]/, "");
  if (!/^\d*\.?\d+$/.test(t)) return null;
  const n = Math.round(Number(t) * 100) / 100;
  return n > 0 && n < 10_000_000 ? n : null;
}
