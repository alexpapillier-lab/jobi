/**
 * Opravy vyloučené z provize (provize_nastaveni.vylouceny_opravy).
 *
 * Provize se platí z opravy, ne z dílu. U Dysonů jsou ale na zakázce položky
 * jako „výměna těla“ nebo „výměna baterie“, kde je skoro celá cena nákup dílu.
 * Majitel aplikace si proto u servisu vypíše slova, která se do provizního
 * základu nepočítají; zakázka se počítá dál, jen se jí základ o tyhle opravy
 * sníží.
 *
 * Zadává se to jako jedna řádka oddělená čárkami, ukládá jako text[]. Tady je
 * převod mezi obojím. Samotné porovnávání dělá SQL funkce
 * `provize_oprava_zapocitana`: hledá podřetězec bez ohledu na velikost písmen,
 * na diakritice ale záleží.
 */

/** Kolik slov má smysl držet. Delší seznam je spíš překlep než záměr. */
export const MAX_VYLOUCENYCH_OPRAV = 20;

/**
 * Z řádky od uživatele na seznam pro databázi.
 *
 * Prázdná slova vypadnou – prázdný řetězec by jako podřetězec seděl na každý
 * název a vyřadil by úplně všechno.
 */
export function seznamVyloucenych(vstup: string): string[] {
  const out: string[] = [];
  for (const kus of String(vstup ?? "").split(",")) {
    const slovo = kus.trim();
    if (!slovo) continue;
    if (out.some((x) => x.toLowerCase() === slovo.toLowerCase())) continue;
    out.push(slovo);
    if (out.length >= MAX_VYLOUCENYCH_OPRAV) break;
  }
  return out;
}

/** Zpátky do políčka. Prázdný seznam i NULL z databáze dají prázdnou řádku. */
export function textVyloucenych(seznam: readonly string[] | null | undefined): string {
  if (!Array.isArray(seznam)) return "";
  return seznam.filter((s) => typeof s === "string" && s.trim()).join(", ");
}
