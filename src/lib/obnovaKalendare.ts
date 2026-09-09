/**
 * Kdy má kalendář sáhnout znovu do databáze.
 *
 * Vytažené z Calendar.tsx, protože právě tady se to jednou rozbilo a bez
 * testu se to pozná až v provozu. Kalendář se rozhodoval jen podle stáří
 * dat: co bylo starší než pět vteřin, se načetlo znovu. Jenže razítko se po
 * každém načtení posunulo, za pět vteřin bylo zase staré a hlídač běžící po
 * dvou vteřinách spustil další kolo. Kalendář tak stahoval všechny zakázky
 * a reklamace servisu pořád dokola a uživatel viděl „Načítání kalendáře…“
 * každých šest vteřin.
 *
 * Načítá se proto při návratu ke kalendáři, na zprávu z realtime, a jinak
 * jen jednou za pojistku – pro případ, že by realtime spadl a kalendář
 * zůstal otevřený.
 */

/** Po návratu ke kalendáři se načte znovu, co je starší než tohle. */
export const STARE_PO_MS = 5_000;

/**
 * Pojistka pro kalendář, který zůstane otevřený. Musí být řádově delší než
 * STARE_PO_MS, jinak je z pojistky zase smyčka.
 */
export const POJISTKA_MS = 5 * 60_000;

export type StavObnovy = {
  /** Kalendář je vidět: je to aktivní stránka a okno je v popředí. */
  videt: boolean;
  /** Byl vidět při minulé kontrole. Rozdíl proti `videt` znamená návrat. */
  bylVidet: boolean;
  /** Realtime ohlásil změnu ve chvíli, kdy kalendář nebyl vidět. */
  zastarale: boolean;
  /** Jak dlouho jsou data v paměti, v milisekundách. */
  stari: number;
  /** Načítání už běží; druhé se do něj nepouští. */
  nacita: boolean;
};

export function maSeObnovit(s: StavObnovy): boolean {
  if (!s.videt || s.nacita) return false;
  if (s.zastarale) return true;
  return s.stari > (s.bylVidet ? POJISTKA_MS : STARE_PO_MS);
}
