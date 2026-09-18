/**
 * Import provizí z Google tabulky (list RAW, export do CSV) do Jobi.
 *
 * Sloupce listu RAW tak, jak je plnil Apps Script:
 *   A = číslo zakázky (doplatky jako „<číslo>-DOPLATEK“), B = cena, C = provize,
 *   D = datum zápisu, E = týden vyúčtování (např. 2026-W37, prázdné = nevyúčtováno),
 *   F = příznak („a“ = do vyúčtování nebrat), G = status.
 */
import { parseCsv } from "./csv";

export type RadekImportuProvizi = {
  id: string;
  cena: number;
  provize: number;
  datum: string | null;
  tyden: string;
  priznak: string;
  status: string;
};

/** „2 190,50 Kč“, „2190.5“, „2,190.50“ → číslo. Nečitelné = 0. */
export function cisloZTabulky(v: string | undefined): number {
  let s = (v ?? "").replace(/[\s  ]/g, "").replace(/Kč|CZK/gi, "");
  if (!s) return 0;
  const carka = s.lastIndexOf(",");
  const tecka = s.lastIndexOf(".");
  if (carka >= 0 && tecka >= 0) {
    // Poslední z nich je desetinný oddělovač, ten druhý tisícový.
    s = carka > tecka ? s.replace(/\./g, "").replace(",", ".") : s.replace(/,/g, "");
  } else if (carka >= 0) {
    s = s.replace(",", ".");
  }
  const n = Number(s);
  return Number.isFinite(n) ? n : 0;
}

/**
 * Datum z tabulky → ISO. Apps Script zapisoval „M/d/yyyy H:mm:ss“; český
 * export umí i „d.M.yyyy H:mm:ss“. Čas se bere jako místní (tabulka i
 * prohlížeč jsou v Česku).
 */
export function datumZTabulky(v: string | undefined): string | null {
  const s = (v ?? "").trim();
  if (!s) return null;
  const us = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:\s+(\d{1,2}):(\d{2})(?::(\d{2}))?)?$/);
  const cz = s.match(/^(\d{1,2})\.\s*(\d{1,2})\.\s*(\d{4})(?:\s+(\d{1,2}):(\d{2})(?::(\d{2}))?)?$/);
  let d: Date | null = null;
  if (us) d = new Date(+us[3], +us[1] - 1, +us[2], +(us[4] ?? 0), +(us[5] ?? 0), +(us[6] ?? 0));
  else if (cz) d = new Date(+cz[3], +cz[2] - 1, +cz[1], +(cz[4] ?? 0), +(cz[5] ?? 0), +(cz[6] ?? 0));
  else {
    const t = Date.parse(s);
    if (!Number.isNaN(t)) d = new Date(t);
  }
  return d && !Number.isNaN(d.getTime()) ? d.toISOString() : null;
}

/** Vypadá první buňka jako číslo zakázky (a ne jako nadpis sloupce)? */
function jeCisloZakazky(v: string | undefined): boolean {
  return /^[A-Za-z]{2,}\d{4,}/.test((v ?? "").trim());
}

export function radkyZCsv(text: string): { radky: RadekImportuProvizi[]; preskoceno: number } {
  const csv = parseCsv(text);
  // parseCsv bere první řádek jako hlavičku; když tabulka hlavičku nemá, jsou to data.
  const vse = jeCisloZakazky(csv.hlavicka[0]) ? [csv.hlavicka, ...csv.radky] : csv.radky;
  const radky: RadekImportuProvizi[] = [];
  let preskoceno = 0;
  const videno = new Set<string>();
  for (const r of vse) {
    const id = (r[0] ?? "").trim();
    if (!jeCisloZakazky(id) || videno.has(id)) {
      preskoceno++;
      continue;
    }
    videno.add(id);
    radky.push({
      id,
      cena: cisloZTabulky(r[1]),
      provize: cisloZTabulky(r[2]),
      datum: datumZTabulky(r[3]),
      tyden: (r[4] ?? "").trim(),
      priznak: (r[5] ?? "").trim(),
      status: (r[6] ?? "").trim(),
    });
  }
  return { radky, preskoceno };
}
