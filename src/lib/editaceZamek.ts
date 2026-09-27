/**
 * „Upravuje kolega“ – ochrana před tichým přepsáním souběžné úpravy zakázky.
 *
 * Uložení formuláře Upravit zakázku posílá do databáze celý řádek. Když
 * zakázku mezitím uložil kolega, vyhrál by poslední zápis a kolega by se
 * o tom nedozvěděl: realtime mu sice přinesl novou `version`, takže zámek
 * verze v `saveTicketChanges` prošel, ale formulář držel hodnoty z chvíle,
 * kdy se kliklo na Upravit.
 *
 * Proto se při kliknutí na Upravit zapamatuje základ (zakázka, jak byla)
 * a před uložením se porovnají tři verze:
 *   - základ – zakázka při začátku úprav,
 *   - z databáze – co je v řádku teď,
 *   - zapisujeme – řádek z databáze přepsaný tím, co by uložení poslalo.
 * Pole, které se od začátku úprav v databázi změnilo, je změna někoho
 * jiného. Konflikt je jen tam, kde by ji naše uložení přepsalo jinou
 * hodnotou. Okamžité zápisy (stav, technik, provedené opravy) sem nepatří –
 * jdou hned a přes frontu, pravidla jsou v src/lib/slouceniZakazky.ts.
 *
 * Tady je jen čistá logika (bez Reactu a databáze), ať jde otestovat.
 * Přítomnost v detailu a načtení autora: src/pages/Orders/hooks/useEditaceZakazky.ts.
 */
import { sloucZakazkuZDb, type EvidenceZapisu, type OkamziteSloupce } from "./slouceniZakazky";

/** Jeden údaj zakázky, jak ho vidí uživatel (adresa jsou tři sloupce, sleva dva). */
export type PoleZakazky = {
  /** Česky, malým písmenem – skládá se do věty „mezitím změnil: stav, telefon“. */
  popisek: string;
  /** Klíče zakázky v paměti (TicketEx), ze kterých se údaj skládá. */
  klice: readonly string[];
  /** Sloupce v `ticket_history.details.changes` – podle nich se hledá autor. */
  sloupce: readonly string[];
  /** Klíče ve formuláři Upravit (editedTicket), když se jmenují jinak než `klice`. */
  formular?: readonly string[];
};

/**
 * Všechno, co uložení zakázky zapisuje (payload v useOrderActions). Chybět
 * tu nesmí nic: pole mimo seznam by se při souběhu přepsalo bez ptaní.
 * Popisky odpovídají historii zakázky (HistorieZakazkyModal).
 */
export const POLE_ZAKAZKY: readonly PoleZakazky[] = [
  { popisek: "stav", klice: ["status"], sloupce: ["status"] },
  { popisek: "zařízení", klice: ["deviceLabel"], sloupce: ["title"] },
  { popisek: "popis závady", klice: ["requestedRepair"], sloupce: ["notes"] },
  { popisek: "zákazník", klice: ["customerName", "customerId"], sloupce: ["customer_name", "customer_id"] },
  { popisek: "telefon", klice: ["customerPhone"], sloupce: ["customer_phone"] },
  { popisek: "e-mail", klice: ["customerEmail"], sloupce: ["customer_email"] },
  {
    popisek: "adresa",
    klice: ["customerAddressStreet", "customerAddressCity", "customerAddressZip"],
    sloupce: ["customer_address_street", "customer_address_city", "customer_address_zip"],
  },
  { popisek: "firma", klice: ["customerCompany"], sloupce: ["customer_company"] },
  { popisek: "IČO", klice: ["customerIco"], sloupce: ["customer_ico"] },
  { popisek: "poznámka k zákazníkovi", klice: ["customerInfo"], sloupce: ["customer_info"] },
  { popisek: "sériové číslo / IMEI", klice: ["serialOrImei"], sloupce: ["device_serial"] },
  // Kód do historie nepatří (trigger ho vynechává), autor se u něj proto nenajde.
  { popisek: "kód zařízení", klice: ["devicePasscode"], sloupce: ["device_passcode"] },
  { popisek: "stav zařízení", klice: ["deviceCondition"], sloupce: ["device_condition"] },
  { popisek: "příslušenství", klice: ["deviceAccessories"], sloupce: ["device_accessories"] },
  { popisek: "poznámka k zařízení", klice: ["deviceNote"], sloupce: ["device_note"] },
  {
    popisek: "záruka",
    klice: ["warrantyClaim", "purchaseDate", "purchaseProof"],
    sloupce: ["warranty_claim", "purchase_date", "purchase_proof"],
  },
  { popisek: "Find My", klice: ["findMyOff"], sloupce: ["find_my_off"] },
  { popisek: "externí číslo", klice: ["externalId"], sloupce: ["external_id"] },
  { popisek: "převzetí", klice: ["handoffMethod"], sloupce: ["handoff_method"] },
  { popisek: "předání", klice: ["handbackMethod"], sloupce: ["handback_method"] },
  { popisek: "odhadovaná cena", klice: ["estimatedPrice"], sloupce: ["estimated_price"] },
  { popisek: "provedené opravy a ceny", klice: ["performedRepairs"], sloupce: ["performed_repairs"] },
  { popisek: "sleva", klice: ["discountType", "discountValue"], sloupce: ["discount"] },
  { popisek: "diagnostika", klice: ["diagnosticText"], sloupce: ["diagnostic_text"] },
  {
    popisek: "fotky",
    klice: ["diagnosticPhotos", "diagnosticPhotosBefore"],
    sloupce: ["diagnostic_photos", "diagnostic_photos_before"],
  },
  // V paměti leží pod jménem sloupce (mapSupabaseTicketToTicketEx), ve formuláři jako expectedCompletionAt.
  {
    popisek: "předpokládané dokončení",
    klice: ["expected_completion_at"],
    sloupce: ["expected_completion_at"],
    formular: ["expectedCompletionAt"],
  },
];

/* ------------------------------------------------------------------ */
/* Porovnání hodnot                                                    */
/* ------------------------------------------------------------------ */

/** Objekt s klíči seřazenými a bez prázdných hodnot – jsonb v databázi klíče přeskládá. */
function ustalit(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(ustalit);
  if (v && typeof v === "object") {
    const o = v as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(o).sort()) {
      const h = normalizuj(o[k]);
      if (h !== null) out[k] = h;
    }
    return out;
  }
  return v;
}

/**
 * Hodnota pro porovnání. Prázdný text, null a undefined jsou totéž (paměť
 * používá undefined, databáze null, formulář ""), text se ořízne jako při
 * uložení, pole a objekty se porovnávají obsahem.
 */
export function normalizuj(v: unknown): unknown {
  if (v === undefined || v === null) return null;
  if (typeof v === "string") {
    const t = v.trim();
    return t === "" ? null : t;
  }
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (Array.isArray(v) || typeof v === "object") return JSON.stringify(ustalit(v));
  return v;
}

function hodnota(o: object, klic: string): unknown {
  return normalizuj((o as Record<string, unknown>)[klic]);
}

function lisiSe(a: object, b: object, klic: string): boolean {
  return hodnota(a, klic) !== hodnota(b, klic);
}

/* ------------------------------------------------------------------ */
/* Verze                                                               */
/* ------------------------------------------------------------------ */

export type VerzeZakazky = { version?: number | null; updatedAt?: string | null };

/**
 * Změnil se řádek od začátku úprav? `version` zvyšuje trigger při každém
 * zápisu (i okamžitém), `updated_at` je záloha pro řádek bez verze. Když
 * není ani jedno, radši se porovnávají pole.
 */
export function zmenilaSeVerze(zaklad: VerzeZakazky, aktualni: VerzeZakazky): boolean {
  if (typeof zaklad.version === "number" && typeof aktualni.version === "number") {
    return zaklad.version !== aktualni.version;
  }
  if (zaklad.updatedAt && aktualni.updatedAt) return zaklad.updatedAt !== aktualni.updatedAt;
  return true;
}

/**
 * Je řádek v databázi výsledkem našeho vlastního uložení? `updated_at`
 * z odpovědi na naše uložení si pamatujeme; shoduje-li se, nikdo po nás
 * nezapisoval.
 */
export function jeNasZapis(aktualni: VerzeZakazky, naseZapisy: ReadonlySet<string> | undefined): boolean {
  return !!aktualni.updatedAt && !!naseZapisy?.has(aktualni.updatedAt);
}

/* ------------------------------------------------------------------ */
/* Pole                                                                */
/* ------------------------------------------------------------------ */

/**
 * Co se v databázi změnilo od začátku úprav. `vynechat` jsou klíče, které
 * drží paměť (rozepsaná diagnostika, neuložené opravy) – u nich je základ
 * místní a rozdíl proti databázi by byl naše vlastní změna.
 */
export function zmenenaPole(
  zaklad: object,
  zDb: object,
  vynechat: ReadonlySet<string> = new Set(),
  pole: readonly PoleZakazky[] = POLE_ZAKAZKY,
): PoleZakazky[] {
  return pole.filter((p) => p.klice.some((k) => !vynechat.has(k) && lisiSe(zaklad, zDb, k)));
}

/**
 * Změny od někoho jiného, které by naše uložení přepsalo jinou hodnotou.
 * Pole, které kolega změnil a my zapisujeme totéž (dorazilo realtime, nebo
 * jsme ho sami přepnuli okamžitým zápisem), konflikt není.
 */
export function konfliktniPole(
  zaklad: object,
  zDb: object,
  zapisujeme: object,
  vynechat: ReadonlySet<string> = new Set(),
  pole: readonly PoleZakazky[] = POLE_ZAKAZKY,
): PoleZakazky[] {
  return pole.filter((p) =>
    p.klice.some((k) => !vynechat.has(k) && lisiSe(zaklad, zDb, k) && lisiSe(zapisujeme, zDb, k)),
  );
}

/**
 * Která z konfliktních polí jdou z formuláře Upravit. Jen ta uložení
 * opravdu přepíše; ostatní (stav, opravy) se při uložení vezmou čerstvé
 * z databáze.
 */
export function poleZFormulare(pole: readonly PoleZakazky[], formular: object): PoleZakazky[] {
  const f = formular as Record<string, unknown>;
  return pole.filter((p) => (p.formular ?? p.klice).some((k) => f[k] !== undefined));
}

/** „stav“, „stav a telefon“, „stav, telefon a adresa“. */
export function vyctiPole(pole: readonly PoleZakazky[]): string {
  const popisky = [...new Set(pole.map((p) => p.popisek))];
  if (popisky.length <= 1) return popisky[0] ?? "";
  return `${popisky.slice(0, -1).join(", ")} a ${popisky[popisky.length - 1]}`;
}

/* ------------------------------------------------------------------ */
/* Autor změny                                                         */
/* ------------------------------------------------------------------ */

/** Řádek `ticket_history` (useHistorieZakazky čte stejné sloupce). */
export type ZaznamHistorieZmeny = {
  changed_by: string | null;
  created_at: string;
  action: string;
  details: unknown;
};

export type AutorZmen =
  /** Kolega (id, nejnovější první); null = bez přihlášeného uživatele (portál zákazníka, automatika). */
  | { typ: "kolega"; autori: (string | null)[]; cas: string }
  /** Jen já – z jiného okna nebo zařízení. */
  | { typ: "ja"; cas: string }
  /** Historie nic neřekla (chybí záznam, kód zařízení se nezapisuje). */
  | { typ: "neznamy" };

function zmeneneSloupce(details: unknown): string[] {
  const zmeny = (details as { changes?: unknown } | null)?.changes;
  return zmeny && typeof zmeny === "object" ? Object.keys(zmeny) : [];
}

/**
 * Kdo změnil dané sloupce po `od` (updated_at základu – čas serveru, ne
 * hodiny v počítači). Cizí je změna s jiným `changed_by` než já; když jsou
 * všechny moje, je to jiné okno téhož uživatele.
 */
export function autorZmen(
  zaznamy: readonly ZaznamHistorieZmeny[],
  { mojeId, od, sloupce }: { mojeId: string | null; od: string | null; sloupce: readonly string[] },
): AutorZmen {
  const odMs = od ? Date.parse(od) : NaN;
  const hledane = new Set(sloupce);
  const relevantni = zaznamy
    .filter((z) => z.action === "updated")
    .filter((z) => Number.isNaN(odMs) || Date.parse(z.created_at) > odMs)
    .filter((z) => hledane.size === 0 || zmeneneSloupce(z.details).some((s) => hledane.has(s)))
    .sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at));
  if (relevantni.length === 0) return { typ: "neznamy" };
  const cizi = relevantni.filter((z) => !mojeId || z.changed_by !== mojeId);
  if (cizi.length === 0) return { typ: "ja", cas: relevantni[0].created_at };
  const autori: (string | null)[] = [];
  for (const z of cizi) if (!autori.includes(z.changed_by)) autori.push(z.changed_by);
  return { typ: "kolega", autori, cas: cizi[0].created_at };
}

/** Je změna od někoho jiného? Neznámý autor se bere jako cizí – radši se zeptat. */
export function jeCiziZmena(autor: AutorZmen): boolean {
  return autor.typ !== "ja";
}

/* ------------------------------------------------------------------ */
/* Přítomnost v detailu                                                */
/* ------------------------------------------------------------------ */

/** Co o sobě hlásí klient v kanálu `zakazka-editace:<ticketId>`. */
export type PritomnostVDetailu = {
  userId: string;
  jmeno: string;
  /** Od kdy (ISO) má detail otevřený, resp. od kdy upravuje. */
  od: string;
  upravuje: boolean;
};

/**
 * Ostatní v detailu podle stavu presence (klíč = userId, jeden záznam na
 * okno). Já se vynechávám; víc oken jednoho kolegy je jeden řádek –
 * upravuje, když upravuje v kterémkoli, a „od“ je nejstarší z nich.
 * Upravující jsou první.
 */
export function ostatniVDetailu(
  stav: Record<string, readonly Partial<PritomnostVDetailu>[] | undefined>,
  mojeId: string | null,
): PritomnostVDetailu[] {
  const out: PritomnostVDetailu[] = [];
  for (const [klic, zaznamy] of Object.entries(stav)) {
    if (!zaznamy || zaznamy.length === 0) continue;
    const userId = zaznamy[0]?.userId || klic;
    if (userId === mojeId) continue;
    const upravujici = zaznamy.filter((z) => z.upravuje);
    const zdroj = upravujici.length > 0 ? upravujici : zaznamy;
    const casy = zdroj.map((z) => z.od).filter((c): c is string => typeof c === "string").sort();
    out.push({
      userId,
      jmeno: zaznamy.find((z) => z.jmeno?.trim())?.jmeno?.trim() || "Kolega",
      od: casy[0] ?? "",
      upravuje: upravujici.length > 0,
    });
  }
  return out.sort((a, b) => Number(b.upravuje) - Number(a.upravuje) || a.od.localeCompare(b.od));
}

/** „Jana Nováková“ → „Jana N.“; přezdívka z jednoho slova zůstává. */
export function kratkeJmeno(jmeno: string): string {
  const casti = jmeno.trim().split(/\s+/).filter(Boolean);
  if (casti.length < 2) return casti[0] ?? "Kolega";
  return `${casti[0]} ${casti[casti.length - 1].charAt(0).toUpperCase()}.`;
}

/** Čas „14:02“ z ISO; prázdný text, když čas chybí. */
export function casHodiny(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return `${d.getHours()}:${String(d.getMinutes()).padStart(2, "0")}`;
}

/** Text štítku v hlavičce detailu, nebo null, když tu nikdo jiný není. */
export function popisKolegu(ostatni: readonly PritomnostVDetailu[]): { text: string; upravuje: boolean } | null {
  if (ostatni.length === 0) return null;
  const upravujici = ostatni.filter((o) => o.upravuje);
  const zbytek = (n: number) => (n > 0 ? ` a ${n} další` : "");
  if (upravujici.length > 0) {
    const prvni = upravujici[0];
    const cas = casHodiny(prvni.od);
    return {
      text: `Upravuje: ${kratkeJmeno(prvni.jmeno)}${cas ? ` (od ${cas})` : ""}${zbytek(upravujici.length - 1)}`,
      upravuje: true,
    };
  }
  return { text: `Otevřeno: ${kratkeJmeno(ostatni[0].jmeno)}${zbytek(ostatni.length - 1)}`, upravuje: false };
}

/* ------------------------------------------------------------------ */
/* Sloučení čerstvé verze s tím, co je rozdělané v paměti              */
/* ------------------------------------------------------------------ */

export type RozepsaneVDetailu = { diagnosticText: boolean; diagnosticPhotos: boolean; performedRepairs: boolean };

type ZakazkaSRozepsanym = OkamziteSloupce & {
  diagnosticText?: unknown;
  diagnosticPhotos?: unknown;
  diagnosticPhotosBefore?: unknown;
};

/**
 * Klíče, které drží paměť a porovnání je musí vynechat: rozepsaná
 * diagnostika a fotky (ukládají se až při zavření detailu) a opravy, jejichž
 * okamžitý zápis běží, čeká nebo selhal.
 */
export function drzeneKlice(rozepsane: RozepsaneVDetailu, opravyVPameti: boolean): Set<string> {
  const s = new Set<string>();
  if (rozepsane.diagnosticText) s.add("diagnosticText");
  if (rozepsane.diagnosticPhotos) {
    s.add("diagnosticPhotos");
    s.add("diagnosticPhotosBefore");
  }
  if (rozepsane.performedRepairs || opravyVPameti) s.add("performedRepairs");
  return s;
}

/**
 * Čerstvá verze z databáze (po konfliktu: Přepsat i Načíst jeho verzi)
 * sloučená s tím, co ještě není uložené: okamžitě ukládané sloupce podle
 * evidence zápisů (sloucZakazkuZDb) a rozepsaná diagnostika a fotky.
 * Ani jedna volba konfliktního dialogu nesmí tyhle rozdělané věci ztratit.
 */
export function sloucSRozepsanym<T extends ZakazkaSRozepsanym>(
  mistni: T | undefined,
  zDb: T,
  evidence: EvidenceZapisu,
  ticketId: string,
  rozepsane: RozepsaneVDetailu,
): T {
  let s = sloucZakazkuZDb(mistni, zDb, evidence, ticketId);
  if (!mistni) return s;
  if (rozepsane.performedRepairs) s = { ...s, performedRepairs: mistni.performedRepairs };
  if (rozepsane.diagnosticText) s = { ...s, diagnosticText: mistni.diagnosticText };
  if (rozepsane.diagnosticPhotos) {
    s = { ...s, diagnosticPhotos: mistni.diagnosticPhotos, diagnosticPhotosBefore: mistni.diagnosticPhotosBefore };
  }
  return s;
}
