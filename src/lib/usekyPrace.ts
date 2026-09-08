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

/**
 * Kroky, po kterých se naměřený čas zaokrouhluje na hodiny k účtování
 * (Nastavení → Zakázky → Hodinová práce, `config.zaokrouhleni_prace`).
 * 0 = nezaokrouhlovat. Výchozí je čtvrthodina – tak servisy účtují ručně.
 */
export const ZAOKROUHLENI_PRACE = [
  { minut: 0, label: "Nezaokrouhlovat (na minuty)" },
  { minut: 5, label: "Každých započatých 5 minut" },
  { minut: 10, label: "Každých započatých 10 minut" },
  { minut: 15, label: "Každá započatá čtvrthodina" },
  { minut: 30, label: "Každá započatá půlhodina" },
  { minut: 60, label: "Každá započatá hodina" },
] as const;
export const VYCHOZI_ZAOKROUHLENI_PRACE = 15;

/** Nastavení z configu servisu: neznámou hodnotu nahradí výchozí čtvrthodinou. */
export function normalizujZaokrouhleni(raw: unknown): number {
  return typeof raw === "number" && ZAOKROUHLENI_PRACE.some((z) => z.minut === raw) ? raw : VYCHOZI_ZAOKROUHLENI_PRACE;
}

/**
 * Hodiny k účtování z naměřeného času: nahoru na započatý krok.
 *
 * Bez zaokrouhlení (krok 0) se hodiny berou na setiny – položka „Hodinová
 * práce“ v zakázce stejně s víc desetinnými místy nepočítá a na dokladu
 * by 1,3667 h vypadalo divně.
 */
export function hodinyKUctovani(sekund: number, krokMinut: number = VYCHOZI_ZAOKROUHLENI_PRACE): number {
  if (sekund <= 0) return 0;
  if (krokMinut <= 0) return Math.ceil(sekund / 36) / 100;
  const krokSekund = krokMinut * 60;
  // Kroky po 5 a 10 minutách nedávají „hezké“ desetiny (65 min = 1,0833 h);
  // čtyři desetinná místa stačí, aby hodiny × sazba seděly na haléř.
  return Math.round((Math.ceil(sekund / krokSekund) * krokMinut / 60) * 10000) / 10000;
}

/** Odhad ceny naměřeného času podle sazby (Kč/h), zaokrouhlený na koruny. */
export function castkaZaCas(sekund: number, sazba: number): number {
  if (sekund <= 0 || sazba <= 0) return 0;
  return Math.round((sekund / 3600) * sazba);
}

/**
 * Kdo na zakázce odpracoval nejvíc – ten se zapíše k hodinové práci jako
 * technik. Když se o zakázku dělí dva, vyhraje ten s větším podílem; jméno
 * jde v položce přepsat.
 */
export function nejvytizenejsi(useky: readonly (Usek & { user_id: string })[], ted: number = Date.now()): string | null {
  const podle = new Map<string, number>();
  for (const u of useky) podle.set(u.user_id, (podle.get(u.user_id) ?? 0) + sekundyVObdobi(u, null, null, ted));
  let nej: string | null = null;
  let max = 0;
  for (const [id, s] of podle) {
    if (s > max) { max = s; nej = id; }
  }
  return nej;
}
