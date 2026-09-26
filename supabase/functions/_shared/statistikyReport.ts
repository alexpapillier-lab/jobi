/**
 * Report statistik e-mailem – čistá logika bez Deno API.
 *
 * Co tu je: čtení nastavení z configu servisu, výpočet období (minulý
 * měsíc / minulý týden v čase Europe/Prague), rozhodnutí „je čas poslat“
 * a žebříčky zákazníků. Edge funkce `statistics-report-send` tohle jen
 * volá a stará se o databázi, PDF a e-mail.
 *
 * Samostatný soubor proto, aby šel otestovat z vitest
 * (`src/lib/statistikyReport.test.ts`) – termíny a hranice měsíců jsou
 * přesně ten druh věci, který se bez testu rozbije v prosinci.
 */

export type FrekvenceReportu = "mesicne" | "tydne";

export type NastaveniReportu = {
  zapnuto: boolean;
  frekvence: FrekvenceReportu;
  /** Příjemci; prázdné = report se neposílá, i když je zapnutý. */
  emaily: string[];
  /** Hodina odeslání v čase Europe/Prague (0–23). */
  hodina: number;
};

export const VYCHOZI_NASTAVENI_REPORTU: NastaveniReportu = {
  zapnuto: false,
  frekvence: "mesicne",
  emaily: [],
  hodina: 7,
};

export const MAX_PRIJEMCU = 10;
export const PASMO = "Europe/Prague";

/** Stejné pravidlo jako v aplikaci (src/lib/authChyby / formuláře): něco@něco.tld. */
export function platnyEmail(s: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(s.trim());
}

/** Ořeže, sjednotí velikost písmen, vyhodí duplicity a neplatné adresy. */
export function normalizujEmaily(list: unknown): string[] {
  if (!Array.isArray(list)) return [];
  const out: string[] = [];
  for (const raw of list) {
    if (typeof raw !== "string") continue;
    const e = raw.trim().toLowerCase();
    if (!platnyEmail(e) || out.includes(e)) continue;
    out.push(e);
    if (out.length >= MAX_PRIJEMCU) break;
  }
  return out;
}

/** Tolerantní čtení z `service_settings.config.statistiky_report`. */
export function nastaveniReportuZConfigu(raw: unknown): NastaveniReportu {
  const o = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const hodina = Number(o.hodina);
  return {
    zapnuto: o.zapnuto === true,
    frekvence: o.frekvence === "tydne" ? "tydne" : "mesicne",
    emaily: normalizujEmaily(o.emaily),
    hodina: Number.isInteger(hodina) && hodina >= 0 && hodina <= 23 ? hodina : VYCHOZI_NASTAVENI_REPORTU.hodina,
  };
}

// ---------------------------------------------------------------------------
// Čas v pásmu Europe/Prague bez knihoven
// ---------------------------------------------------------------------------

export type CastiCasu = { rok: number; mesic: number; den: number; hodina: number; minuta: number; denVTydnu: number };

/** Nástěnné hodiny v daném pásmu. `mesic` je 1–12, `denVTydnu` 1 = pondělí … 7 = neděle. */
export function castiVPasmu(d: Date, pasmo = PASMO): CastiCasu {
  const f = new Intl.DateTimeFormat("en-US", {
    timeZone: pasmo,
    year: "numeric", month: "numeric", day: "numeric",
    hour: "numeric", minute: "numeric", hourCycle: "h23", weekday: "short",
  });
  const parts: Record<string, string> = {};
  for (const p of f.formatToParts(d)) parts[p.type] = p.value;
  const dny: Record<string, number> = { Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 7 };
  return {
    rok: Number(parts.year),
    mesic: Number(parts.month),
    den: Number(parts.day),
    hodina: Number(parts.hour) % 24,
    minuta: Number(parts.minute),
    denVTydnu: dny[parts.weekday] ?? 1,
  };
}

/**
 * Okamžik, kdy v daném pásmu odbíjí půlnoc daného dne.
 *
 * Postup: vezme se UTC půlnoc, zjistí se, kolik v pásmu v tu chvíli je,
 * a o ten rozdíl se posune. Přechod na letní čas je v Praze ve 2–3 ráno,
 * půlnoci se netýká, takže jedna iterace stačí.
 */
export function pulnocVPasmu(rok: number, mesic: number, den: number, pasmo = PASMO): Date {
  const odhad = Date.UTC(rok, mesic - 1, den, 0, 0, 0);
  const c = castiVPasmu(new Date(odhad), pasmo);
  const jakoUtc = Date.UTC(c.rok, c.mesic - 1, c.den, c.hodina, c.minuta, 0);
  return new Date(odhad - (jakoUtc - odhad));
}

export type ObdobiReportu = {
  /** Začátek období (včetně). */
  od: Date;
  /** Konec období – první okamžik po něm (výlučně). Do dotazů jde `< do`. */
  do: Date;
  /** Klíč pro tlumení duplicit: „2026-08“, „2026-W36“ nebo pro aktuální období s příponou „-rozpracovano“. */
  klic: string;
  /** „Srpen 2026“ / „Týden 36 (31. 8. – 6. 9. 2026)“. */
  nazev: string;
  predchoziOd: Date;
  predchoziDo: Date;
  predchoziNazev: string;
  frekvence: FrekvenceReportu;
};

const MESICE = ["Leden", "Únor", "Březen", "Duben", "Květen", "Červen", "Červenec", "Srpen", "Září", "Říjen", "Listopad", "Prosinec"];

/** „7. 9. 2026“ v daném pásmu. */
export function datumCesky(d: Date, pasmo = PASMO): string {
  const c = castiVPasmu(d, pasmo);
  return `${c.den}. ${c.mesic}. ${c.rok}`;
}

/** Poslední den období – `do` je výlučný, tak o den zpět. */
function posledniDen(doVylucne: Date): Date {
  return new Date(doVylucne.getTime() - 24 * 3600_000);
}

/** „31. 8. – 6. 9. 2026“; přes přelom roku s rokem u obou dat. */
export function rozsahDatCesky(od: Date, doVcetne: Date, pasmo = PASMO): string {
  const a = castiVPasmu(od, pasmo);
  const b = castiVPasmu(doVcetne, pasmo);
  if (a.rok === b.rok) return `${a.den}. ${a.mesic}. – ${b.den}. ${b.mesic}. ${b.rok}`;
  return `${datumCesky(od, pasmo)} – ${datumCesky(doVcetne, pasmo)}`;
}

/** Měsíc posunutý o `delta` (může jít přes přelom roku). */
function posunMesic(rok: number, mesic: number, delta: number): { rok: number; mesic: number } {
  const idx = rok * 12 + (mesic - 1) + delta;
  return { rok: Math.floor(idx / 12), mesic: (idx % 12) + 1 };
}

/** ISO týden (pondělí–neděle) pro datum v pásmu. */
export function isoTyden(d: Date, pasmo = PASMO): { rok: number; tyden: number } {
  const c = castiVPasmu(d, pasmo);
  // Čtvrtek téhož týdne určuje rok ISO týdne.
  const ctvrtek = new Date(Date.UTC(c.rok, c.mesic - 1, c.den + (4 - c.denVTydnu)));
  const zacatekRoku = new Date(Date.UTC(ctvrtek.getUTCFullYear(), 0, 1));
  const tyden = Math.floor((ctvrtek.getTime() - zacatekRoku.getTime()) / (7 * 24 * 3600_000)) + 1;
  return { rok: ctvrtek.getUTCFullYear(), tyden };
}

function obdobiMesice(rok: number, mesic: number, pasmo: string): { od: Date; do: Date; nazev: string; klic: string } {
  const od = pulnocVPasmu(rok, mesic, 1, pasmo);
  const dalsiRok = mesic === 12 ? rok + 1 : rok;
  const dalsiMesic = mesic === 12 ? 1 : mesic + 1;
  const konec = pulnocVPasmu(dalsiRok, dalsiMesic, 1, pasmo);
  return { od, do: konec, nazev: `${MESICE[mesic - 1]} ${rok}`, klic: `${rok}-${String(mesic).padStart(2, "0")}` };
}

function obdobiTydne(pondeli: { rok: number; mesic: number; den: number }, pasmo: string): { od: Date; do: Date; nazev: string; klic: string; tyden: number } {
  const od = pulnocVPasmu(pondeli.rok, pondeli.mesic, pondeli.den, pasmo);
  const konec = new Date(od.getTime() + 7 * 24 * 3600_000 + 3600_000);
  // Přes přechod času má týden 167 nebo 169 hodin – znormalizovat na půlnoc.
  const k = castiVPasmu(konec, pasmo);
  const doVylucne = pulnocVPasmu(k.rok, k.mesic, k.den, pasmo);
  const { rok, tyden } = isoTyden(od, pasmo);
  return {
    od,
    do: doVylucne,
    nazev: `Týden ${tyden} (${rozsahDatCesky(od, posledniDen(doVylucne), pasmo)})`,
    klic: `${rok}-W${String(tyden).padStart(2, "0")}`,
    tyden,
  };
}

/** Pondělí týdne, do kterého spadá datum (v pásmu). */
function pondeliTydne(d: Date, pasmo: string): { rok: number; mesic: number; den: number } {
  const c = castiVPasmu(d, pasmo);
  const p = new Date(Date.UTC(c.rok, c.mesic - 1, c.den - (c.denVTydnu - 1)));
  return { rok: p.getUTCFullYear(), mesic: p.getUTCMonth() + 1, den: p.getUTCDate() };
}

/**
 * Období reportu podle frekvence.
 *
 * `ktere = "predchozi"` (výchozí, plánované odeslání): minulý celý měsíc /
 * minulý celý týden. `"aktualni"` (tlačítko Poslat teď): běžící měsíc nebo
 * týden od začátku do teď – klíč nese příponu, aby se nepletl s uzavřeným
 * obdobím, které přijde po jeho konci.
 */
export function obdobiReportu(
  frekvence: FrekvenceReportu,
  ted: Date,
  ktere: "predchozi" | "aktualni" = "predchozi",
  pasmo = PASMO,
): ObdobiReportu {
  const c = castiVPasmu(ted, pasmo);
  if (frekvence === "mesicne") {
    const akt = obdobiMesice(c.rok, c.mesic, pasmo);
    const m1 = posunMesic(c.rok, c.mesic, -1);
    const m2 = posunMesic(c.rok, c.mesic, -2);
    const min = obdobiMesice(m1.rok, m1.mesic, pasmo);
    const predmin = obdobiMesice(m2.rok, m2.mesic, pasmo);
    if (ktere === "aktualni") {
      return {
        od: akt.od, do: ted, klic: `${akt.klic}-rozpracovano`, nazev: `${akt.nazev} (do ${datumCesky(ted, pasmo)})`,
        predchoziOd: min.od, predchoziDo: min.do, predchoziNazev: min.nazev, frekvence,
      };
    }
    return {
      od: min.od, do: min.do, klic: min.klic, nazev: min.nazev,
      predchoziOd: predmin.od, predchoziDo: predmin.do, predchoziNazev: predmin.nazev, frekvence,
    };
  }

  const pondeli = pondeliTydne(ted, pasmo);
  const akt = obdobiTydne(pondeli, pasmo);
  const min = obdobiTydne(pondeliTydne(new Date(akt.od.getTime() - 24 * 3600_000), pasmo), pasmo);
  const predmin = obdobiTydne(pondeliTydne(new Date(min.od.getTime() - 24 * 3600_000), pasmo), pasmo);
  if (ktere === "aktualni") {
    return {
      od: akt.od, do: ted, klic: `${akt.klic}-rozpracovano`, nazev: `Týden ${akt.tyden} (${datumCesky(akt.od, pasmo)} – do ${datumCesky(ted, pasmo)})`,
      predchoziOd: min.od, predchoziDo: min.do, predchoziNazev: min.nazev, frekvence,
    };
  }
  return {
    od: min.od, do: min.do, klic: min.klic, nazev: min.nazev,
    predchoziOd: predmin.od, predchoziDo: predmin.do, predchoziNazev: predmin.nazev, frekvence,
  };
}

/**
 * Je teď chvíle na plánované odeslání?
 *
 * Měsíční report: první den v měsíci, týdenní: pondělí – od nastavené
 * hodiny dál (cron tiká každou hodinu, tlumení podle klíče období zařídí,
 * že odejde jen jednou; když odeslání selže, další hodina to zkusí znovu).
 */
export function jeCasOdeslat(nastaveni: NastaveniReportu, ted: Date, pasmo = PASMO): boolean {
  if (!nastaveni.zapnuto || nastaveni.emaily.length === 0) return false;
  const c = castiVPasmu(ted, pasmo);
  if (c.hodina < nastaveni.hodina) return false;
  return nastaveni.frekvence === "mesicne" ? c.den === 1 : c.denVTydnu === 1;
}

/** Název přílohy: „jobi-report-2026-08.pdf“. */
export function nazevSouboru(obdobi: ObdobiReportu, zkratka?: string | null): string {
  const z = (zkratka ?? "").trim().toLowerCase().replace(/[^a-z0-9]/g, "");
  return `jobi-report${z ? `-${z}` : ""}-${obdobi.klic}.pdf`;
}

// ---------------------------------------------------------------------------
// Čísla a texty
// ---------------------------------------------------------------------------

/** Změna v procentech; null, když předchozí hodnota byla nula (dělení nulou). */
export function procentniZmena(aktualni: number, predchozi: number): number | null {
  if (!Number.isFinite(aktualni) || !Number.isFinite(predchozi) || predchozi === 0) return null;
  return ((aktualni - predchozi) / Math.abs(predchozi)) * 100;
}

/** „367 478 Kč“ – celé koruny, nedělitelné mezery jako jinde v Jobi. */
export function korunyCele(n: number): string {
  const v = Number.isFinite(n) ? Math.round(n) : 0;
  return `${new Intl.NumberFormat("cs-CZ", { maximumFractionDigits: 0 }).format(v)} Kč`;
}

/** „74,7 %“ */
export function procenta(n: number, desetinna = 1): string {
  const v = Number.isFinite(n) ? n : 0;
  return `${new Intl.NumberFormat("cs-CZ", { minimumFractionDigits: desetinna, maximumFractionDigits: desetinna }).format(v)} %`;
}

/** „1 zakázka“, „3 zakázky“, „12 zakázek“ */
export function zakazkySlovy(n: number): string {
  if (n === 1) return "1 zakázka";
  if (n >= 2 && n <= 4) return `${n} zakázky`;
  return `${new Intl.NumberFormat("cs-CZ").format(n)} zakázek`;
}

/**
 * Storno – tatáž definice jako `src/lib/stornoStav.ts` a `public.stav_je_storno`.
 * Stornované zakázky se do obratu zákazníka nepočítají (peníze nepřišly),
 * do počtů ano.
 */
const STORNO_KLIC = /(cancel|storno)/iu;
const STORNO_NAZEV = /(storn|zruš|nerealiz|neopraven|odmítn)/iu;
export function jeStornoStav(klic: string | null | undefined, nazev?: string | null): boolean {
  return STORNO_KLIC.test(klic ?? "") || STORNO_NAZEV.test(nazev ?? "");
}

// ---------------------------------------------------------------------------
// Žebříčky zákazníků
// ---------------------------------------------------------------------------

export type ZakazkaProZebricek = {
  customerId: string | null;
  customerName: string | null;
  /** Konečná cena (po slevě); u storna 0. */
  prijem: number;
  /** Vydaná v reportovaném období – počítá se do obratu zákazníka. */
  vObdobi: boolean;
  /** Přijatá v posledních 12 měsících (pro „pravidelnost“). Chybí = ano. */
  v12Mesicich?: boolean;
};

export type HodnotnyZakaznik = { jmeno: string; pocet: number; obrat: number; podil: number };
export type PravidelnyZakaznik = { jmeno: string; pocetVObdobi: number; pocet12m: number; obrat: number };

function klicZakaznika(z: ZakazkaProZebricek): string | null {
  if (z.customerId) return `id:${z.customerId}`;
  const jmeno = (z.customerName ?? "").trim().toLowerCase().replace(/\s+/g, " ");
  return jmeno ? `jm:${jmeno}` : null;
}

/** Zákazníci s největším obratem v období. */
export function hodnotniZakaznici(zakazky: ZakazkaProZebricek[], limit = 5): HodnotnyZakaznik[] {
  const podle = new Map<string, HodnotnyZakaznik>();
  let celkem = 0;
  for (const z of zakazky) {
    if (!z.vObdobi) continue;
    const k = klicZakaznika(z);
    if (!k) continue;
    celkem += z.prijem;
    const r = podle.get(k) ?? { jmeno: (z.customerName ?? "").trim() || "Bez jména", pocet: 0, obrat: 0, podil: 0 };
    r.pocet += 1;
    r.obrat += z.prijem;
    podle.set(k, r);
  }
  return [...podle.values()]
    .filter((r) => r.obrat > 0)
    .sort((a, b) => b.obrat - a.obrat || b.pocet - a.pocet || a.jmeno.localeCompare(b.jmeno, "cs"))
    .slice(0, limit)
    .map((r) => ({ ...r, podil: celkem > 0 ? (r.obrat / celkem) * 100 : 0 }));
}

/**
 * Pravidelní zákazníci: aspoň 2 zakázky v období, nebo aspoň 3 za posledních
 * 12 měsíců (stejná měřítka jako v Zakázkovém listu, ať se čísla dají srovnat).
 */
export function pravidelniZakaznici(zakazky: ZakazkaProZebricek[], limit = 5): PravidelnyZakaznik[] {
  const podle = new Map<string, PravidelnyZakaznik>();
  for (const z of zakazky) {
    const k = klicZakaznika(z);
    if (!k) continue;
    const r = podle.get(k) ?? { jmeno: (z.customerName ?? "").trim() || "Bez jména", pocetVObdobi: 0, pocet12m: 0, obrat: 0 };
    if (z.v12Mesicich !== false) r.pocet12m += 1;
    if (z.vObdobi) {
      r.pocetVObdobi += 1;
      r.obrat += z.prijem;
    }
    podle.set(k, r);
  }
  return [...podle.values()]
    .filter((r) => r.pocetVObdobi >= 2 || r.pocet12m >= 3)
    .sort((a, b) => b.pocetVObdobi - a.pocetVObdobi || b.pocet12m - a.pocet12m || b.obrat - a.obrat || a.jmeno.localeCompare(b.jmeno, "cs"))
    .slice(0, limit);
}
