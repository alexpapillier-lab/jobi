/**
 * Úseky práce (stopky) – co se z nich smí počítat jako odvedený čas.
 *
 * Stopky se dají spustit a nezastavit. Úsek pak nemá konec a naivní výpočet
 * „od začátku do teď“ z něj udělá desítky nebo stovky hodin: jediné
 * zapomenuté stopky z 20. ledna udělaly v KPI techniků z 2,5 hodiny za leden
 * 282,5 hodiny. Podle toho sloupce se rozdělují prémie.
 *
 * Pravidlo je proto jedno pro celou aplikaci:
 *   • uzavřený úsek se počítá přesně (a jen tou částí, která leží v období),
 *   • neuzavřený úsek se počítá nejvýš `MAX_OTEVRENY_USEK_HODIN` – tolik
 *     trvá dlouhá směna; co je delší, nejsou hodiny práce, ale zapomenuté
 *     stopky.
 *
 * Stejné pravidlo má databázová funkce `public.statistiky_technici`
 * (konstanta `c_otevreny_strop`). Když se změní tady, musí se změnit i tam –
 * jinak bude karta zakázky říkat něco jiného než Statistiky.
 */

/** Nejdelší úsek, který se u nezastavených stopek ještě počítá jako práce. */
export const MAX_OTEVRENY_USEK_HODIN = 12;
export const MAX_OTEVRENY_USEK_SEKUND = MAX_OTEVRENY_USEK_HODIN * 3600;

export type Usek = { started_at: string; ended_at: string | null };

/** Milisekundy z hodnoty, která může být text i Date. Nesmysl vrátí null. */
function cas(v: string | number | Date | null | undefined): number | null {
  if (v === null || v === undefined) return null;
  const t = v instanceof Date ? v.getTime() : new Date(v).getTime();
  return Number.isNaN(t) ? null : t;
}

/**
 * Kolik sekund z úseku spadá do období `od`–`do` (obě hranice volitelné).
 *
 * Počítá se PŘEKRYV, ne „patří tam podle začátku“. Úsek 23:30–00:30 na
 * přelomu měsíce tak dá půl hodiny do každého z nich; kdyby se rozhodovalo
 * podle začátku, při pohledu na ten druhý měsíc by zmizel celý.
 */
export function sekundyVObdobi(
  usek: Usek,
  od: Date | number | null = null,
  doKdy: Date | number | null = null,
  ted: number = Date.now()
): number {
  const zacatek = cas(usek.started_at);
  if (zacatek === null) return 0;
  const otevreny = !usek.ended_at;
  const konec = otevreny ? ted : cas(usek.ended_at) ?? ted;

  const hraniceOd = cas(od) ?? Number.NEGATIVE_INFINITY;
  const hraniceDo = Math.min(cas(doKdy) ?? ted, ted);

  const prunikOd = Math.max(zacatek, hraniceOd);
  const prunikDo = Math.min(konec, hraniceDo);
  const sekund = Math.max(0, Math.round((prunikDo - prunikOd) / 1000));

  return otevreny ? Math.min(sekund, MAX_OTEVRENY_USEK_SEKUND) : sekund;
}

/** Součet započitatelných sekund za víc úseků. */
export function sekundyCelkem(
  useky: readonly Usek[],
  od: Date | number | null = null,
  doKdy: Date | number | null = null,
  ted: number = Date.now()
): number {
  return useky.reduce((soucet, u) => soucet + sekundyVObdobi(u, od, doKdy, ted), 0);
}

/** Je úsek zapomenutý? (běží déle, než se ještě počítá jako práce) */
export function jeZapomenuty(usek: Usek, ted: number = Date.now()): boolean {
  if (usek.ended_at) return false;
  const zacatek = cas(usek.started_at);
  return zacatek !== null && ted - zacatek > MAX_OTEVRENY_USEK_SEKUND * 1000;
}
