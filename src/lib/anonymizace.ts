/**
 * GDPR: automatická anonymizace starých zákazníků – pravidlo „kdo je kandidát“.
 *
 * Zákazník, který u servisu nemá žádnou zakázku mladší než N let (výchozí
 * 5, volitelně 3–10), se anonymizuje: jméno se nahradí „Anonymizovaný
 * zákazník #…“, kontakty, adresa a poznámka se vymažou, podpisy a fotky
 * jeho zakázek zmizí z úložiště. Zakázky i faktury zůstávají – faktury se
 * nemění vůbec (účetní doklad se archivuje 10 let). Co přesně se maže
 * a proč: docs/GDPR_ANONYMIZACE.md.
 *
 * Tohle je čistá podoba pravidla. Skutečný výběr dělá databáze
 * (`anonymizace_kandidati` v migraci 20260927120000) – obě místa musí
 * rozhodovat stejně, test `anonymizace.test.ts` hlídá tuhle podobu.
 *
 * Pravidlo:
 *  - Poslední aktivita = nejpozdější z dat jeho zakázek (`created_at`
 *    i `completed_at`), reklamací (přijetí, vydání, dokončení) a faktur
 *    (datum vystavení). NE podle karty zákazníka: kartu může kdokoli
 *    upravit a import ze starého systému ji založí dnes, i když poslední
 *    zakázka je z roku 2018.
 *  - Jen zákazník bez jediné zakázky, reklamace i faktury se řídí datem
 *    založení karty – jinak by se čerstvě založená karta anonymizovala hned.
 *  - Zákazník s otevřenou zakázkou nebo reklamací (ne v koncovém stavu
 *    a nesmazaná) se nikdy neanonymizuje, ať je stará jak chce.
 *  - Zákazník s nezaplacenou fakturou (vystavená / odeslaná / po
 *    splatnosti, bez data úhrady) taky nikdy – pohledávku je potřeba
 *    vymáhat a k tomu kontakt patří.
 *  - Zakázky bez karty zákazníka (jméno a telefon jen na zakázce) se
 *    posuzují každá sama za sebe podle stejných pravidel.
 */

export const VYCHOZI_POCET_LET = 5;
export const MIN_POCET_LET = 3;
export const MAX_POCET_LET = 10;

/** Slovo, které správce musí napsat, aby anonymizaci spustil. Stejné kontroluje databáze. */
export const POTVRZOVACI_SLOVO = "ANONYMIZOVAT";

/** Jméno, které nahradí skutečné. U karty zákazníka se doplní „#“ a začátek id. */
export const JMENO_ANONYMNIHO = "Anonymizovaný zákazník";

/** Stavy faktury, ve kterých zákazník dluží (koncept ještě není doklad, storno už ne). */
const STAVY_NEZAPLACENE = new Set(["issued", "sent", "overdue"]);

export type NastaveniAnonymizace = {
  /** Po kolika letech bez zakázky anonymizovat; `null` = pravidlo vypnuté. */
  anonymizacePoLetech: number | null;
};

/** Počet let z configu: celé číslo 3–10, jinak `null` (vypnuto). */
export function normalizujPocetLet(raw: unknown): number | null {
  if (typeof raw !== "number" || !Number.isInteger(raw)) return null;
  return raw >= MIN_POCET_LET && raw <= MAX_POCET_LET ? raw : null;
}

/** Nastavení z `service_settings.config.gdpr`. */
export function nastaveniAnonymizaceZConfigu(gdpr: unknown): NastaveniAnonymizace {
  const g = gdpr && typeof gdpr === "object" ? (gdpr as Record<string, unknown>) : {};
  return { anonymizacePoLetech: normalizujPocetLet(g.anonymizacePoLetech) };
}

/**
 * Hranice: co je starší, je kandidát. Kalendářní roky zpět jako
 * `now() - make_interval(years => n)` v Postgresu – i s 29. únorem, ze
 * kterého Postgres udělá 28. února (JavaScript by přeskočil na 1. března).
 */
export function hraniceAnonymizace(ted: Date, poLetech: number): Date {
  const d = new Date(ted.getTime());
  const mesic = d.getUTCMonth();
  d.setUTCFullYear(d.getUTCFullYear() - poLetech);
  if (d.getUTCMonth() !== mesic) d.setUTCDate(0);
  return d;
}

/** „Anonymizovaný zákazník #1a2b3c4d“ – začátek id, ať jdou karty od sebe rozeznat. */
export function anonymniJmeno(customerId?: string | null): string {
  const kratke = (customerId ?? "").replace(/-/g, "").slice(0, 8);
  return kratke ? `${JMENO_ANONYMNIHO} #${kratke}` : JMENO_ANONYMNIHO;
}

/** Je jméno už anonymizované? (Poznají se tím i zakázky bez karty zákazníka.) */
export function jeAnonymniJmeno(jmeno: string | null | undefined): boolean {
  return typeof jmeno === "string" && jmeno.startsWith(JMENO_ANONYMNIHO);
}

/** Napsal správce potvrzovací slovo? Velikost písmen a mezery okolo nevadí. */
export function jePotvrzeni(text: string | null | undefined): boolean {
  return (text ?? "").trim().toLocaleUpperCase("cs-CZ") === POTVRZOVACI_SLOVO;
}

/** Otevřená zakázka: nesmazaná a stav není koncový. Neznámý stav = otevřená (opatrně). */
export function jeOtevrena(status: string | null | undefined, deletedAt: string | null | undefined, koncoveStavy: ReadonlySet<string>): boolean {
  if (deletedAt) return false;
  const klic = status && status.trim() ? status : "received";
  return !koncoveStavy.has(klic);
}

export type ZakaznikK = {
  id: string;
  createdAt: string;
  /** Už anonymizovaný (customers.anonymized_at) – podruhé se nepočítá. */
  anonymizovano?: boolean;
};

export type ZakazkaK = {
  id: string;
  customerId: string | null;
  createdAt: string;
  completedAt?: string | null;
  otevrena: boolean;
  /** Jen u zakázek bez karty: je na zakázce ještě co anonymizovat? Výchozí ano. */
  maOsobniUdaje?: boolean;
};

export type ReklamaceK = {
  customerId: string | null;
  sourceTicketId?: string | null;
  createdAt: string;
  receivedAt?: string | null;
  releasedAt?: string | null;
  completedAt?: string | null;
  otevrena: boolean;
};

export type FakturaK = {
  customerId: string | null;
  ticketId: string | null;
  issueDate: string | null;
  status: string;
  paidAt?: string | null;
  deletedAt?: string | null;
};

export type DuvodVylouceni = "otevrena_zakazka" | "nezaplacena_faktura" | "nedavna_aktivita" | "uz_anonymizovan";

export type VysledekVyberu = {
  zakaznici: Array<{ id: string; posledniAktivita: Date }>;
  zakazkyBezKarty: string[];
  /** Proč zákazník kandidátem není – pro test a pro vysvětlení v UI. */
  vylouceni: Array<{ id: string; duvod: DuvodVylouceni }>;
};

export function jeNezaplacena(f: FakturaK): boolean {
  return !f.deletedAt && !f.paidAt && STAVY_NEZAPLACENE.has(f.status);
}

function cas(s: string | null | undefined): number | null {
  if (!s) return null;
  const t = Date.parse(s);
  return Number.isFinite(t) ? t : null;
}

function nejpozdeji(...hodnoty: Array<string | null | undefined>): number | null {
  let max: number | null = null;
  for (const h of hodnoty) {
    const t = cas(h);
    if (t != null && (max == null || t > max)) max = t;
  }
  return max;
}

/**
 * Kdo je kandidát na anonymizaci. Stejné pravidlo jako
 * `public.anonymizace_kandidati` v databázi.
 */
export function vyberKandidaty(vstup: {
  zakaznici: ZakaznikK[];
  zakazky: ZakazkaK[];
  reklamace?: ReklamaceK[];
  faktury?: FakturaK[];
  poLetech: number;
  ted: Date;
}): VysledekVyberu {
  const hranice = hraniceAnonymizace(vstup.ted, vstup.poLetech).getTime();
  const reklamace = vstup.reklamace ?? [];
  const faktury = vstup.faktury ?? [];

  const zakaznikZakazky = new Map<string, string | null>();
  for (const z of vstup.zakazky) zakaznikZakazky.set(z.id, z.customerId);

  type Souhrn = { posledni: number | null; otevrena: boolean; nezaplacena: boolean };
  const souhrn = new Map<string, Souhrn>();
  const pridej = (id: string | null | undefined, posledni: number | null, otevrena: boolean, nezaplacena: boolean) => {
    if (!id) return;
    const s = souhrn.get(id) ?? { posledni: null, otevrena: false, nezaplacena: false };
    if (posledni != null && (s.posledni == null || posledni > s.posledni)) s.posledni = posledni;
    s.otevrena ||= otevrena;
    s.nezaplacena ||= nezaplacena;
    souhrn.set(id, s);
  };

  for (const z of vstup.zakazky) pridej(z.customerId, nejpozdeji(z.createdAt, z.completedAt), z.otevrena, false);
  for (const r of reklamace) {
    const komu = r.customerId ?? (r.sourceTicketId ? zakaznikZakazky.get(r.sourceTicketId) ?? null : null);
    pridej(komu, nejpozdeji(r.createdAt, r.receivedAt, r.releasedAt, r.completedAt), r.otevrena, false);
  }
  for (const f of faktury) {
    const komu = f.customerId ?? (f.ticketId ? zakaznikZakazky.get(f.ticketId) ?? null : null);
    pridej(komu, nejpozdeji(f.issueDate), false, jeNezaplacena(f));
  }

  const vysledek: VysledekVyberu = { zakaznici: [], zakazkyBezKarty: [], vylouceni: [] };

  for (const c of vstup.zakaznici) {
    if (c.anonymizovano) {
      vysledek.vylouceni.push({ id: c.id, duvod: "uz_anonymizovan" });
      continue;
    }
    const s = souhrn.get(c.id);
    if (s?.otevrena) {
      vysledek.vylouceni.push({ id: c.id, duvod: "otevrena_zakazka" });
      continue;
    }
    if (s?.nezaplacena) {
      vysledek.vylouceni.push({ id: c.id, duvod: "nezaplacena_faktura" });
      continue;
    }
    // Bez zakázek, reklamací a faktur rozhoduje založení karty.
    const posledni = s?.posledni ?? cas(c.createdAt);
    if (posledni == null || posledni >= hranice) {
      vysledek.vylouceni.push({ id: c.id, duvod: "nedavna_aktivita" });
      continue;
    }
    vysledek.zakaznici.push({ id: c.id, posledniAktivita: new Date(posledni) });
  }

  // Zakázky bez karty zákazníka – každá sama za sebe.
  for (const z of vstup.zakazky) {
    if (z.customerId || z.otevrena || z.maOsobniUdaje === false) continue;
    const posledni = nejpozdeji(z.createdAt, z.completedAt);
    if (posledni == null || posledni >= hranice) continue;
    if (faktury.some((f) => f.ticketId === z.id && jeNezaplacena(f))) continue;
    const reklamaceZakazky = reklamace.filter((r) => r.sourceTicketId === z.id);
    if (reklamaceZakazky.some((r) => r.otevrena || (nejpozdeji(r.createdAt, r.receivedAt, r.releasedAt, r.completedAt) ?? 0) >= hranice)) continue;
    vysledek.zakazkyBezKarty.push(z.id);
  }

  return vysledek;
}

/** „1 zákazník“, „3 zákazníci“, „12 zákazníků“. */
export function pocetZakazniku(n: number): string {
  if (n === 1) return "1 zákazník";
  if (n >= 2 && n <= 4) return `${n} zákazníci`;
  return `${n} zákazníků`;
}

/** „1 zakázka“, „3 zakázky“, „12 zakázek“. */
export function pocetZakazek(n: number): string {
  if (n === 1) return "1 zakázka";
  if (n >= 2 && n <= 4) return `${n} zakázky`;
  return `${n} zakázek`;
}

/** „1 soubor“, „3 soubory“, „12 souborů“. */
export function pocetSouboru(n: number): string {
  if (n === 1) return "1 soubor";
  if (n >= 2 && n <= 4) return `${n} soubory`;
  return `${n} souborů`;
}
