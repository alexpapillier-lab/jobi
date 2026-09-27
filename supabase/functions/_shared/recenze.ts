/**
 * Žádost o recenzi po vydání zakázky – rozhodování bez databáze.
 *
 * Sdílí ho edge funkce `automations-run` (skutečné odeslání) a aplikace
 * (karta v Nastavení → Komunikace → Automatizace, náhled a testy přes
 * `src/lib/recenze.ts`). Proto tu není nic z Dena ani z Reactu – jen čisté
 * funkce nad hodnotami, které si volající načte sám.
 *
 * Co se tu rozhoduje:
 *   - který stav je „vydáno“ (koncový, ne storno, ne vráceno bez opravy),
 *   - kdy se smí poslat (denní okno v časové zóně servisu),
 *   - jestli je zákazník kandidát (odhlášený, bez kontaktu, nedávno už
 *     žádost dostal…) a jakým kanálem mu to poslat,
 *   - jak vypadá odkaz a výchozí text.
 */

export const RECENZE_VYCHOZI = {
  /** Za kolik hodin po vydání (1 den). */
  zpozdeniHodin: 24,
  /** Denní okno odeslání v místním čase servisu: od 9:00 do 19:00. */
  oknoOd: 9,
  oknoDo: 19,
  /** Stálý zákazník s deseti zakázkami měsíčně nesmí dostat deset SMS. */
  limitDni: 90,
  casovaZona: "Europe/Prague",
  sms: "Dobrý den, děkujeme, že jste opravu svěřili {{service_name}}. Budeme moc rádi za krátké hodnocení: {{review_url}}",
  emailPredmet: "Jak jste byli spokojeni? {{service_name}}",
  emailText:
    "Dobrý den {{customer_name}},\n\nděkujeme, že jste opravu zařízení {{device_label}} svěřili nám. " +
    "Pokud jste byli spokojeni, moc nám pomůže krátké hodnocení:\n\n{{review_url}}\n\n" +
    "Děkujeme,\n{{service_name}}\n{{service_phone}}",
} as const;

/** Stavy „vráceno bez opravy“, „nevyzvednuto“ – koncové, ale bez opravy, a proto bez žádosti. */
const BEZ_OPRAVY_NAZEV = /(bez oprav|vrácen|vracen|nevyzved|neprevz|nepřevz)/iu;
const BEZ_OPRAVY_KLIC = /(return|unclaimed|no_repair|bez_oprav)/iu;
/** Stejné jako `jeStornoStav` v src/lib/stornoStav.ts a `public.stav_je_storno`. */
const STORNO_KLIC = /(cancel|storno)/iu;
const STORNO_NAZEV = /(storn|zruš|nerealiz|neopraven|odmítn)/iu;

/**
 * Je stav „vydáno“? Koncový stav, který není storno ani vrácení bez opravy.
 * Zrcadlo SQL funkce `public.stav_je_vydany` v migraci 20260927140000.
 */
export function jeVydanyStav(klic: string | null | undefined, nazev: string | null | undefined, koncovy: boolean): boolean {
  if (!koncovy) return false;
  const k = klic ?? "";
  const n = nazev ?? "";
  if (STORNO_KLIC.test(k) || STORNO_NAZEV.test(n)) return false;
  if (BEZ_OPRAVY_KLIC.test(k) || BEZ_OPRAVY_NAZEV.test(n)) return false;
  return true;
}

/**
 * Spouští stav pravidlo? Když si servis stavy vybral sám (`statusKeys`),
 * platí jeho výběr. Jinak rozhoduje `jeVydanyStav`.
 */
export function stavSpoustiRecenzi(
  klic: string,
  stavy: ReadonlyArray<{ key: string; label?: string | null; isFinal?: boolean; is_final?: boolean }>,
  statusKeys?: ReadonlyArray<string> | null,
): boolean {
  if (Array.isArray(statusKeys) && statusKeys.length > 0) return statusKeys.includes(klic);
  const s = stavy.find((x) => x.key === klic);
  if (!s) return false;
  return jeVydanyStav(s.key, s.label ?? "", s.isFinal === true || s.is_final === true);
}

/** Výchozí výběr stavů pro kartu v Nastavení. */
export function vychoziVydaneStavy(stavy: ReadonlyArray<{ key: string; label: string; isFinal: boolean }>): string[] {
  return stavy.filter((s) => jeVydanyStav(s.key, s.label, s.isFinal)).map((s) => s.key);
}

// ---------------------------------------------------------------------------
// Odkaz

/**
 * Odkaz na recenze (Google Maps „napsat recenzi“, Firmy.cz, Heureka…).
 * Jen http(s) – cokoli jiného by v SMS nešlo otevřít, nebo by šlo o něco,
 * co zákazníkovi posílat nechceme (javascript:, data:). Bez schématu se
 * doplní https://.
 */
export function normalizujOdkazRecenze(vstup: string | null | undefined): string | null {
  const s = (vstup ?? "").trim();
  if (!s || /\s/.test(s)) return null;
  const s2 = /^[a-z][a-z0-9+.-]*:/i.test(s) ? s : `https://${s}`;
  let url: URL;
  try {
    url = new URL(s2);
  } catch {
    return null;
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return null;
  if (!url.hostname.includes(".")) return null;
  return url.toString();
}

/**
 * Šablona, ve které chybí `{{review_url}}`, dostane odkaz na konec. Žádost
 * o recenzi bez odkazu je jen SMS navíc, za kterou servis zaplatí.
 */
export function sablonaSOdkazem(sablona: string): string {
  const s = sablona.trim();
  if (/\{\{\s*review_url\s*\}\}/.test(s)) return s;
  return s ? `${s} {{review_url}}` : "{{review_url}}";
}

/** Stejné jako substituteTemplate v src/lib/automations.ts a v edge funkci. */
export function dosadRecenze(sablona: string, promenne: Record<string, string>): string {
  return sablona.replace(/\{\{\s*(\w+)\s*\}\}/g, (_, k: string) => promenne[k] ?? "");
}

// ---------------------------------------------------------------------------
// Denní okno a časová zóna

type MistniCas = { rok: number; mesic: number; den: number; hodina: number; minuta: number; sekunda: number };

function platnaZona(tz: string | null | undefined): string {
  const z = (tz ?? "").trim() || RECENZE_VYCHOZI.casovaZona;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: z });
    return z;
  } catch {
    return RECENZE_VYCHOZI.casovaZona;
  }
}

function mistniCas(d: Date, tz: string): MistniCas {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    hourCycle: "h23",
    year: "numeric",
    month: "numeric",
    day: "numeric",
    hour: "numeric",
    minute: "numeric",
    second: "numeric",
  }).formatToParts(d);
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value ?? "0");
  return { rok: get("year"), mesic: get("month"), den: get("day"), hodina: get("hour") % 24, minuta: get("minute"), sekunda: get("second") };
}

/** O kolik je místní čas v zóně napřed před UTC (ms) v daném okamžiku. */
function posunZony(d: Date, tz: string): number {
  const m = mistniCas(d, tz);
  const jakoUtc = Date.UTC(m.rok, m.mesic - 1, m.den, m.hodina, m.minuta, m.sekunda);
  return jakoUtc - Math.floor(d.getTime() / 1000) * 1000;
}

/** Okamžik, kdy v zóně ukazují hodiny zadaný místní čas (přechody letního času řeší druhý průchod). */
function zMistnihoCasu(rok: number, mesic: number, den: number, hodina: number, tz: string): Date {
  const odhad = Date.UTC(rok, mesic - 1, den, hodina, 0, 0);
  const p1 = posunZony(new Date(odhad), tz);
  let t = odhad - p1;
  const p2 = posunZony(new Date(t), tz);
  if (p2 !== p1) t = odhad - p2;
  return new Date(t);
}

export type OknoOdeslani = { od: number; do: number };

/** Okno z nastavení; nesmysl (od ≥ do, mimo 0–24) spadne na výchozí 9–19. */
export function platneOkno(od: unknown, do_: unknown): OknoOdeslani {
  const a = Number(od);
  const b = Number(do_);
  if (!Number.isInteger(a) || !Number.isInteger(b) || a < 0 || b > 24 || a >= b) {
    return { od: RECENZE_VYCHOZI.oknoOd, do: RECENZE_VYCHOZI.oknoDo };
  }
  return { od: a, do: b };
}

/**
 * Nejbližší okamžik ≥ `od`, kdy se smí poslat: když je `od` uvnitř okna,
 * vrátí ho beze změny, jinak začátek okna téhož dne (před oknem) nebo
 * příštího dne (po okně), vše v místním čase zóny `tz`.
 */
export function dalsiCasOdeslani(od: Date, okno: OknoOdeslani, tz?: string | null): Date {
  const zona = platnaZona(tz);
  const { od: z, do: k } = platneOkno(okno.od, okno.do);
  const m = mistniCas(od, zona);
  if (m.hodina >= z && m.hodina < k) return od;
  if (m.hodina < z) return zMistnihoCasu(m.rok, m.mesic, m.den, z, zona);
  const zitra = new Date(Date.UTC(m.rok, m.mesic - 1, m.den + 1));
  return zMistnihoCasu(zitra.getUTCFullYear(), zitra.getUTCMonth() + 1, zitra.getUTCDate(), z, zona);
}

/** Kdy se žádost pošle: vydání + zpoždění, posunuté do nejbližšího okna. */
export function planovanyCasZadosti(vydano: Date, zpozdeniHodin: number, okno: OknoOdeslani, tz?: string | null): Date {
  const h = Number.isFinite(zpozdeniHodin) && zpozdeniHodin >= 0 ? zpozdeniHodin : RECENZE_VYCHOZI.zpozdeniHodin;
  return dalsiCasOdeslani(new Date(vydano.getTime() + h * 3_600_000), okno, tz);
}

// ---------------------------------------------------------------------------
// Kandidát a kanál

export type KanalRecenze = "sms" | "email";

/** Co o zakázce a zákazníkovi volající zjistil z databáze. */
export type FaktaKandidata = {
  ted: Date;
  smazana: boolean;
  /** Je zakázka pořád ve stavu, který pravidlo spouští? */
  vydanyStav: boolean;
  odkaz: string | null | undefined;
  telefon: string | null | undefined;
  email: string | null | undefined;
  /** Příznak u zákazníka „Neposílat žádosti o recenzi“. */
  zakaznikNechce: boolean;
  /** Žádost k téhle zakázce už odešla. */
  odeslanoNaZakazku: boolean;
  /** Poslední žádost stejnému zákazníkovi (podle zákazníka, telefonu nebo e-mailu). */
  posledniZadost: Date | null;
  limitDni: number;
  /** Umí servis poslat SMS (modul, číslo)? Když ne a zákazník má e-mail, jde e-mail. */
  smsDostupna?: boolean;
};

export type PosudekKandidata =
  | { ok: true; kanal: KanalRecenze }
  | { ok: false; duvod: string };

export function maTelefon(t: string | null | undefined): boolean {
  return (t ?? "").replace(/\D/g, "").length >= 9;
}

export function maEmail(e: string | null | undefined): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test((e ?? "").trim());
}

/** SMS, když má zákazník telefon (a servis SMS umí); jinak e-mail; jinak nic. */
export function zvolKanal(telefon: string | null | undefined, email: string | null | undefined, smsDostupna = true): KanalRecenze | null {
  if (maTelefon(telefon) && smsDostupna) return "sms";
  if (maEmail(email)) return "email";
  return null;
}

export function platnyLimitDni(v: unknown): number {
  const n = Number(v);
  if (!Number.isFinite(n) || n < 0) return RECENZE_VYCHOZI.limitDni;
  return Math.min(Math.round(n), 3650);
}

/** Pořadí kontrol je schválně od „trvalých“ důvodů k časovým – do logu jde ten první. */
export function posudKandidata(f: FaktaKandidata): PosudekKandidata {
  if (f.smazana) return { ok: false, duvod: "Zakázka je smazaná" };
  if (!f.vydanyStav) return { ok: false, duvod: "Zakázka už není ve vydaném stavu" };
  if (!normalizujOdkazRecenze(f.odkaz)) return { ok: false, duvod: "V pravidle chybí platný odkaz na recenze" };
  if (f.zakaznikNechce) return { ok: false, duvod: "Zákazník má zapnuto „Neposílat žádosti o recenzi“" };
  if (f.odeslanoNaZakazku) return { ok: false, duvod: "Žádost k této zakázce už odešla" };
  const kanal = zvolKanal(f.telefon, f.email, f.smsDostupna !== false);
  if (!kanal) {
    return {
      ok: false,
      duvod: maTelefon(f.telefon) ? "Servis nemůže poslat SMS a zákazník nemá e-mail" : "Zákazník nemá telefon ani e-mail",
    };
  }
  const limit = platnyLimitDni(f.limitDni);
  if (f.posledniZadost && limit > 0) {
    const dni = (f.ted.getTime() - f.posledniZadost.getTime()) / 86_400_000;
    if (dni < limit) {
      const pred = Math.max(0, Math.floor(dni));
      return { ok: false, duvod: `Zákazník dostal žádost před ${pred} ${pred === 1 ? "dnem" : "dny"} (limit ${limit} dní)` };
    }
  }
  return { ok: true, kanal };
}

/** Od kdy se hledá předchozí žádost stejnému zákazníkovi. */
export function zacatekLimitu(ted: Date, limitDni: number): Date {
  return new Date(ted.getTime() - platnyLimitDni(limitDni) * 86_400_000);
}
