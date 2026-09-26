/**
 * Sloučení zakázky, která přišla z databáze (realtime, dotažení detailu),
 * s tím, co je v paměti.
 *
 * Provedené opravy, kontrola po opravě a náhradní zařízení se ukládají hned
 * po kliknutí, ne až při zavření detailu. Dokud takový zápis běží, čeká na
 * odklad, nebo selhal a čeká na uložení při zavření detailu, je verze
 * v paměti novější než ta v databázi. Když v tu chvíli kolega změní stav
 * zakázky, realtime přinese řádek s opravami o krok pozadu – a kdyby se
 * převzal celý, rezervace dílů ve skladu by zůstala na opravu, kterou
 * nikdo nevidí, a při Dokončeno by se odečetl díl navíc (chyba z 5. 9.).
 *
 * Proto se drží tři evidence podle id zakázky a jedno místo, které z nich
 * rozhodne, co z řádku z databáze převzít.
 */

/** Sloupce, které se ukládají okamžitě a při běžícím zápisu se drží místní. */
export type OkamziteSloupce = {
  performedRepairs?: unknown;
  testChecklist?: unknown;
  loaner?: unknown;
};

/** Co se o zakázce ví mimo React: běžící zápisy, odložené zápisy, neuložené opravy. */
export type EvidenceZapisu = {
  /** Kolik okamžitých zápisů zakázky zrovna běží (více kliknutí za sebou). */
  bezici: ReadonlyMap<string, number>;
  /** Zakázky s odloženým zápisem (úprava ceny čeká na sloučení do jednoho volání). */
  odlozene: { has(ticketId: string): boolean };
  /** Zakázky, kterým zápis oprav selhal a opravy čekají na uložení při zavření detailu. */
  neulozene: { has(ticketId: string): boolean };
};

/** Má zakázka rozpracovaný zápis, kvůli kterému se nesmí převzít okamžité sloupce z databáze? */
export function zapisZakazkyBezi(ticketId: string, evidence: EvidenceZapisu): boolean {
  return (
    (evidence.bezici.get(ticketId) ?? 0) > 0 ||
    evidence.odlozene.has(ticketId) ||
    evidence.neulozene.has(ticketId)
  );
}

export const VSECHNY_OKAMZITE_SLOUPCE: readonly (keyof OkamziteSloupce)[] = ["performedRepairs", "testChecklist", "loaner"];

/**
 * Řádek z databáze sloučí s místní zakázkou. Bez rozpracovaného zápisu se
 * převezme celý; jinak se z místní verze podrží okamžitě ukládané sloupce
 * (`drzet` – řádek seznamu nese jen opravy, kontrolu a zápůjčku ne, takže
 * při dotažení detailu se drží jen opravy). Bez místní verze (zakázka
 * v paměti není) se vrací řádek tak, jak přišel.
 */
export function sloucZakazkuZDb<T extends OkamziteSloupce>(
  mistni: T | undefined,
  zDb: T,
  evidence: EvidenceZapisu,
  ticketId: string,
  drzet: readonly (keyof OkamziteSloupce)[] = VSECHNY_OKAMZITE_SLOUPCE
): T {
  if (!mistni || !zapisZakazkyBezi(ticketId, evidence)) return zDb;
  const sloucena = { ...zDb };
  for (const sloupec of drzet) sloucena[sloupec] = mistni[sloupec];
  return sloucena;
}

/** Přičte běžící zápis zakázky – volá se před odesláním do databáze. */
export function zacniZapis(bezici: Map<string, number>, ticketId: string): void {
  bezici.set(ticketId, (bezici.get(ticketId) ?? 0) + 1);
}

/** Odečte běžící zápis; poslední odečet zakázku z evidence vyřadí. */
export function ukonciZapis(bezici: Map<string, number>, ticketId: string): void {
  const n = (bezici.get(ticketId) ?? 1) - 1;
  if (n <= 0) bezici.delete(ticketId);
  else bezici.set(ticketId, n);
}
