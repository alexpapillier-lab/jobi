/**
 * České státní svátky a dny pracovního klidu (zákon č. 245/2000 Sb.).
 *
 * Kvůli objednávání svozu DPD: „co nejdřív“ dřív přeskakovalo jen víkendy
 * a 16. 11. 2026 objednalo kurýra na svátek 17. 11. Bez závislostí, takže
 * to sdílí edge funkce i aplikace.
 */

/** Pevná data (MM-DD). */
const PEVNE = new Set(["01-01", "05-01", "05-08", "07-05", "07-06", "09-28", "10-28", "11-17", "12-24", "12-25", "12-26"]);

/** Velikonoční neděle (gregoriánský kalendář, anonymní algoritmus). */
export function velikonocniNedele(rok: number): Date {
  const a = rok % 19;
  const b = Math.floor(rok / 100);
  const c = rok % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const mesic = Math.floor((h + l - 7 * m + 114) / 31);
  const den = ((h + l - 7 * m + 114) % 31) + 1;
  return new Date(Date.UTC(rok, mesic - 1, den));
}

const iso = (d: Date) => d.toISOString().slice(0, 10);

/** Je den (YYYY-MM-DD) v Česku státní svátek? Včetně Velkého pátku a Velikonočního pondělí. */
export function jeStatniSvatekCz(datum: string): boolean {
  if (PEVNE.has(datum.slice(5, 10))) return true;
  const rok = Number(datum.slice(0, 4));
  if (!Number.isFinite(rok)) return false;
  const nedele = velikonocniNedele(rok);
  const patek = new Date(nedele.getTime() - 2 * 86_400_000);
  const pondeli = new Date(nedele.getTime() + 86_400_000);
  return datum === iso(patek) || datum === iso(pondeli);
}

/** Pracovní den = ne sobota, ne neděle, ne státní svátek. */
export function jePracovniDenCz(datum: string): boolean {
  const den = new Date(`${datum}T12:00:00Z`).getUTCDay();
  return den !== 0 && den !== 6 && !jeStatniSvatekCz(datum);
}
