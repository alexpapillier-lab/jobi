/**
 * Import zakázek z CSV – přechod ze Zakázkového listu (ZL), MyRepair nebo
 * jiné tabulky. Čistá logika bez React a bez Supabase: sloupce → pole
 * zakázky, převod dat a částek, mapování cizích stavů na stavy servisu,
 * kontrola duplicit podle čísla zakázky a zápis po dávkách přes předaného
 * klienta (v aplikaci supabase, v testech atrapa).
 *
 * Přesnou podobu CSV exportu z konkurence neznáme (ZL umí export, ale
 * názvy sloupců se mohou lišit podle verze; z MyRepair nemáme vzorek).
 * Proto jsou tu jen předvolby s odhadem názvů sloupců – v UI jde každý
 * sloupec přemapovat ručně. Názvy pro ZL vycházejí z reálného exportu
 * 3 500 zakázek (klíče detailu zakázky), pro MyRepair z běžných českých
 * názvů.
 */
import type { CsvTabulka } from "./csv";
export { parseCsv } from "./csv";

/** Pole zakázky, do kterých se sloupce CSV mapují. */
export type PoleZakazky =
  | "code"
  | "created_at"
  | "completed_at"
  | "status"
  | "customer_name"
  | "customer_phone"
  | "customer_email"
  | "customer_company"
  | "device_label"
  | "device_brand"
  | "device_serial"
  | "device_imei"
  | "device_passcode"
  | "notes"
  | "device_condition"
  | "estimated_price"
  | "external_id"
  | "performed_repairs"
  | "repair_name"
  | "repair_price"
  | "repair_costs"
  | "total_price";

export const POPIS_POLE_ZAKAZKY: Record<PoleZakazky, string> = {
  code: "Číslo zakázky",
  created_at: "Datum přijetí",
  completed_at: "Datum vydání",
  status: "Stav",
  customer_name: "Zákazník – jméno",
  customer_phone: "Zákazník – telefon",
  customer_email: "Zákazník – e-mail",
  customer_company: "Zákazník – firma",
  device_label: "Zařízení",
  device_brand: "Značka",
  device_serial: "Sériové číslo",
  device_imei: "IMEI",
  device_passcode: "Heslo / kód zařízení",
  notes: "Požadovaná oprava (závada)",
  device_condition: "Popis stavu zařízení",
  estimated_price: "Předpokládaná cena",
  external_id: "Externí označení",
  performed_repairs: "Provedené opravy (název;cena;náklady|…)",
  repair_name: "Oprava – název",
  repair_price: "Oprava – cena",
  repair_costs: "Oprava – náklady",
  total_price: "Celková cena",
};

/** Pořadí polí v nabídce mapování (nejdřív to, co bývá v každém exportu). */
export const POLE_ZAKAZKY: PoleZakazky[] = [
  "code", "created_at", "completed_at", "status",
  "customer_name", "customer_phone", "customer_email", "customer_company",
  "device_label", "device_brand", "device_serial", "device_imei", "device_passcode",
  "notes", "device_condition", "estimated_price", "external_id",
  "performed_repairs", "repair_name", "repair_price", "repair_costs", "total_price",
];

export type Predvolba = "zl" | "myrepair" | "vlastni";

/**
 * Předvolby názvů sloupců. Porovnává se bez diakritiky a velikosti písmen,
 * takže „Telefonní číslo“ i „telefonni cislo“ sedí. Pořadí v seznamu je
 * priorita: u ZL je „Jméno a příjmení“ přesnější než „Zákazník“ (ten může
 * nést „Anonymní zákazník“), proto je první.
 */
export const PREDVOLBY: Record<Predvolba, { label: string; popis: string; sloupce: Partial<Record<PoleZakazky, string[]>> }> = {
  zl: {
    label: "Zakázkový list",
    popis: "Sloupce podle detailu zakázky v Zakázkovém listu (Přijetí zařízení do opravy, Zakázka vydána, Jméno a příjmení…).",
    sloupce: {
      code: ["Kód", "Kód zakázky", "Číslo zakázky", "Zakázka", "Číslo"],
      created_at: ["Přijetí zařízení do opravy", "Datum přijetí", "Přijato"],
      completed_at: ["Zakázka vydána", "Datum vydání", "Vydáno", "Zakázka dokončena"],
      status: ["Stav", "Stav zakázky", "Status"],
      customer_name: ["Jméno a příjmení", "Zákazník", "Jméno"],
      customer_phone: ["Telefonní číslo", "Telefon"],
      customer_email: ["E-mailová adresa", "E-mail", "Email"],
      customer_company: ["Firma"],
      device_label: ["Zařízení", "Model"],
      device_serial: ["Sériové číslo"],
      device_imei: ["IMEI"],
      device_passcode: ["Heslo zařízení / Kód obrazovky", "Heslo zařízení", "Kód obrazovky"],
      notes: ["Požadovaná oprava", "Závada"],
      device_condition: ["Popis stavu zařízení", "Stav zařízení a zjištěné závady"],
      estimated_price: ["Předpokládaná cena"],
      external_id: ["Externí identifikace"],
      performed_repairs: ["Položky opravy", "Položka opravy", "Opravy", "Provedené opravy"],
      total_price: ["Celková cena", "Cena celkem", "Celkem"],
    },
  },
  myrepair: {
    label: "MyRepair",
    popis: "Odhad názvů sloupců z exportu MyRepair (Číslo zakázky, Datum přijetí, Datum vydání, Stav, Zákazník, Telefon…). Přemapujte, co nesedí.",
    sloupce: {
      code: ["Číslo zakázky", "Číslo", "Zakázka", "ID", "Kód"],
      created_at: ["Datum přijetí", "Přijato", "Datum vytvoření", "Vytvořeno", "Datum"],
      completed_at: ["Datum vydání", "Datum předání", "Vydáno", "Předáno", "Datum dokončení", "Dokončeno"],
      status: ["Stav", "Status", "Stav zakázky"],
      customer_name: ["Zákazník", "Jméno zákazníka", "Jméno a příjmení", "Jméno", "Klient"],
      customer_phone: ["Telefon", "Telefonní číslo", "Mobil", "Tel."],
      customer_email: ["E-mail", "Email", "E-mailová adresa"],
      customer_company: ["Firma", "Společnost"],
      device_label: ["Zařízení", "Model", "Přístroj", "Typ zařízení"],
      device_brand: ["Značka", "Výrobce"],
      device_serial: ["Sériové číslo", "SN", "S/N", "Výrobní číslo"],
      device_imei: ["IMEI"],
      device_passcode: ["Heslo", "Kód", "Heslo zařízení"],
      notes: ["Závada", "Popis závady", "Požadovaná oprava", "Požadavek", "Popis"],
      device_condition: ["Stav zařízení", "Poškození", "Vzhled"],
      estimated_price: ["Předpokládaná cena", "Odhad ceny", "Odhad"],
      external_id: ["Externí ID", "Externí číslo"],
      performed_repairs: ["Provedené práce", "Provedené opravy", "Opravy", "Položky", "Práce"],
      repair_name: ["Oprava", "Název opravy", "Úkon"],
      repair_price: ["Cena opravy"],
      repair_costs: ["Náklady", "Nákup"],
      total_price: ["Cena celkem", "Celková cena", "Celkem", "Cena", "K úhradě"],
    },
  },
  vlastni: {
    label: "Vlastní",
    popis: "Obecná tabulka – sloupce se odhadnou podle názvů, zbytek přiřaďte ručně.",
    sloupce: {},
  },
};

/** Obecné vzory pro sloupce, které předvolba nezná. Pořadí = priorita. */
const VZORY: Array<[PoleZakazky, RegExp]> = [
  ["completed_at", /vyd[aá]n|p[řr]ed[aá]n|dokon[čc]en|uzav[řr]en|deliver|complet|finish|closed/i],
  ["created_at", /p[řr]ij(et|at)|vytvo[řr]en|datum|creat|received/i],
  ["code", /^(k[oó]d|[čc][ií]slo|zak[aá]zka|id|order)/i],
  ["status", /^(stav|status)/i],
  ["customer_phone", /tel|mobil|phone/i],
  ["customer_email", /mail/i],
  ["customer_company", /^(firma|spole[čc]nost|company)/i],
  ["customer_name", /jm[eé]no|z[aá]kazn[ií]k|customer|klient|name/i],
  ["device_imei", /imei/i],
  ["device_serial", /s[eé]riov|v[yý]robn[ií]\s*[čc]|^s\/?n$|serial/i],
  ["device_passcode", /heslo|k[oó]d obrazovky|passcode/i],
  ["device_brand", /zna[čc]ka|v[yý]robce|brand/i],
  ["device_condition", /stav za[řr][ií]zen[ií]|popis stavu|po[šs]kozen|condition/i],
  ["device_label", /za[řr][ií]zen[ií]|model|p[řr][ií]stroj|device/i],
  ["performed_repairs", /proveden|polo[žz]k|opravy|pr[aá]ce/i],
  ["repair_costs", /n[aá]klad/i],
  ["repair_name", /^(oprava|[uú]kon)/i],
  ["estimated_price", /p[řr]edpokl|odhad|estimat/i],
  ["total_price", /celk|cena|price|[uú]hrad/i],
  ["notes", /z[aá]vad|po[žz]ad|popis|pozn|note/i],
  ["external_id", /extern/i],
];

/** Porovnávání názvů bez diakritiky, velikosti písmen a okolních mezer. */
export function normalizujText(v: string): string {
  return v.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim().replace(/\s+/g, " ");
}

/**
 * Odhadne mapování sloupců: nejdřív přesná shoda s předvolbou, pak obecné
 * vzory. Každé pole se přiřadí jen jednou – druhý sloupec se stejným
 * významem zůstane nepřiřazený, ať si ho uživatel vybere sám.
 */
export function odhadniMapovaniZakazek(hlavicka: string[], predvolba: Predvolba = "vlastni"): Array<PoleZakazky | null> {
  const pouzito = new Set<PoleZakazky>();
  const vysledek: Array<PoleZakazky | null> = hlavicka.map(() => null);
  const normHlavicka = hlavicka.map(normalizujText);

  // 1) předvolba: přesná shoda názvu, v pořadí priority názvů u pole
  const sloupce = PREDVOLBY[predvolba].sloupce;
  for (const pole of POLE_ZAKAZKY) {
    const kandidati = sloupce[pole];
    if (!kandidati) continue;
    for (const k of kandidati) {
      const i = normHlavicka.findIndex((h, idx) => vysledek[idx] === null && h === normalizujText(k));
      if (i >= 0) {
        vysledek[i] = pole;
        pouzito.add(pole);
        break;
      }
    }
  }

  // 2) zbytek podle obecných vzorů
  hlavicka.forEach((h, i) => {
    if (vysledek[i] !== null) return;
    const nazev = h.trim();
    if (!nazev) return;
    for (const [pole, re] of VZORY) {
      if (!pouzito.has(pole) && re.test(nazev)) {
        vysledek[i] = pole;
        pouzito.add(pole);
        return;
      }
    }
  });
  return vysledek;
}

/** Hodnoty, které exporty používají místo prázdné buňky. */
function jePrazdne(text: string): boolean {
  const t = text.trim();
  return t === "" || t === "-" || t === "–" || t === "—" || /^nevypln[eě]no$/i.test(t);
}

/**
 * Datum z exportu → ISO. Zvládne „08.12.2022 09:51“ (ZL), „8. 12. 2022“,
 * „2022-12-08 09:51:00“, „2022-12-08T09:51“, „08/12/2022“. Bez času se bere
 * půlnoc místního času. Prázdná buňka → null; nerozpoznaný text → undefined,
 * aby volající poznal chybu od prázdna.
 */
export function parsujDatum(text: string): string | null | undefined {
  if (jePrazdne(text)) return null;
  const t = text.trim();
  let y: number, m: number, d: number;
  let hh = 0, mm = 0, ss = 0;
  const cz = t.match(/^(\d{1,2})\.\s*(\d{1,2})\.\s*(\d{4})(?:[\sT]+(\d{1,2}):(\d{2})(?::(\d{2}))?)?$/);
  const iso = t.match(/^(\d{4})-(\d{2})-(\d{2})(?:[\sT]+(\d{1,2}):(\d{2})(?::(\d{2}))?(?:\.\d+)?(Z|[+-]\d{2}:?\d{2})?)?$/);
  const lomitka = t.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:\s+(\d{1,2}):(\d{2})(?::(\d{2}))?)?$/);
  if (cz) {
    d = +cz[1]; m = +cz[2]; y = +cz[3];
    if (cz[4]) { hh = +cz[4]; mm = +cz[5]; ss = cz[6] ? +cz[6] : 0; }
  } else if (iso) {
    if (iso[7]) {
      // Má časovou zónu – JS ji převede sám.
      const dt = new Date(t);
      return Number.isNaN(dt.getTime()) ? undefined : dt.toISOString();
    }
    y = +iso[1]; m = +iso[2]; d = +iso[3];
    if (iso[4]) { hh = +iso[4]; mm = +iso[5]; ss = iso[6] ? +iso[6] : 0; }
  } else if (lomitka) {
    d = +lomitka[1]; m = +lomitka[2]; y = +lomitka[3];
    if (lomitka[4]) { hh = +lomitka[4]; mm = +lomitka[5]; ss = lomitka[6] ? +lomitka[6] : 0; }
  } else {
    return undefined;
  }
  if (m < 1 || m > 12 || d < 1 || d > 31 || hh > 23 || mm > 59 || ss > 59) return undefined;
  const dt = new Date(y, m - 1, d, hh, mm, ss);
  // 31. 2. by JS tiše posunul na březen – to je chyba ve vstupu, ne datum.
  if (dt.getFullYear() !== y || dt.getMonth() !== m - 1 || dt.getDate() !== d) return undefined;
  return dt.toISOString();
}

/**
 * Částka z exportu → číslo. „2 490,00 Kč“ → 2490, „950“ → 950, „1.250,50“ → 1250.5.
 * Prázdná buňka nebo text bez číslice (ZL: „Nebyla stanovená předpokládaná
 * cena zakázky.“) → null. Text s číslicemi, který přesto nejde přečíst → NaN.
 */
export function parsujCastku(text: string): number | null {
  if (jePrazdne(text)) return null;
  let t = text.replace(/\u00a0/g, " ").replace(/\s*(kč|czk|eur|€)\s*/gi, "").replace(/\s+/g, "").trim();
  if (!/\d/.test(t)) return null;
  // Tečka jako oddělovač tisíců („1.250,50“) – když je za ní čárka, tečky pryč.
  if (t.includes(",") && t.includes(".")) t = t.replace(/\./g, "");
  t = t.replace(",", ".");
  if (!/^-?\d+(\.\d+)?$/.test(t)) return Number.NaN;
  return Math.round(parseFloat(t) * 100) / 100;
}

/** Provedená oprava tak, jak ji zakázka nese v `performed_repairs` (ručně zadaná položka). */
export type ImportovanaOprava = { id: string; name: string; type: "manual"; price: number; costs?: number };

let citacOprav = 0;
function noveIdOpravy(): string {
  citacOprav += 1;
  return `import_${Date.now().toString(36)}_${citacOprav.toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
}

/**
 * Sloupec „Provedené opravy“ ve tvaru „název;cena;náklady|název;cena;náklady“
 * (položky oddělené svislítkem nebo novým řádkem, hodnoty středníkem).
 * Vrací položky, nebo text chyby.
 */
export function parsujOpravy(text: string): { opravy: ImportovanaOprava[]; chyba?: string } {
  const opravy: ImportovanaOprava[] = [];
  if (jePrazdne(text)) return { opravy };
  const polozky = text.split(/\s*(?:\||\r?\n)\s*/).map((p) => p.trim()).filter(Boolean);
  for (const p of polozky) {
    const [nazev = "", cenaText = "", nakladyText = ""] = p.split(";").map((x) => x.trim());
    if (!nazev) continue;
    const cena = parsujCastku(cenaText);
    const naklady = parsujCastku(nakladyText);
    if (Number.isNaN(cena)) return { opravy, chyba: `nečitelná cena opravy „${nazev}“: ${cenaText}` };
    if (Number.isNaN(naklady)) return { opravy, chyba: `nečitelné náklady opravy „${nazev}“: ${nakladyText}` };
    opravy.push({ id: noveIdOpravy(), name: nazev, type: "manual", price: cena ?? 0, ...(naklady != null ? { costs: naklady } : {}) });
  }
  return { opravy };
}

/** Stav servisu – to, co potřebuje mapování (podmnožina StatusMeta). */
export type StavServisu = { key: string; label: string; isFinal: boolean };

/** Klíč koncového stavu, do kterého jdou vydané zakázky: `completed`, jinak první koncový. */
export function koncovyStav(stavy: StavServisu[]): string | null {
  return stavy.find((s) => s.key === "completed")?.key ?? stavy.find((s) => s.isFinal)?.key ?? null;
}

type Synonymum = { vzor: RegExp; hledej?: RegExp; koncovy?: boolean };
/**
 * Cizí stavy → stavy servisu. `hledej` je vzor na popisek stavu servisu,
 * `koncovy` říká, že bez shody má jít zakázka do koncového stavu (vydáno,
 * storno…). Bez shody čehokoli zůstává výchozí stav.
 */
const SYNONYMA_STAVU: Synonymum[] = [
  { vzor: /^(vydano|vyzvednuto|predano|dokonceno|hotovo|uzavreno|ukonceno|zaplaceno|completed|done|closed|delivered|finished)/, hledej: /vydan|vyzved|dokonc|hotov|uzav/, koncovy: true },
  { vzor: /storn|zrus|cancel/, hledej: /storn|zrus/, koncovy: true },
  { vzor: /bez opravy|neopraven|vracen/, hledej: /bez opravy|vracen/, koncovy: true },
  { vzor: /nevyzved|unclaimed/, hledej: /nevyzved/, koncovy: true },
  { vzor: /ceka|waiting|pending/, hledej: /cek/ },
  { vzor: /pripraven|k vyzvednuti|ready/, hledej: /pripraven|k vyzved/ },
  { vzor: /oprav|progress|probiha|servis/, hledej: /^v oprav|oprav/ },
  { vzor: /schval|souhlas|approved/, hledej: /schval|souhlas/ },
  { vzor: /prijat|nova|nove|zaklada|otevren|new|received|open/ },
];

/**
 * Navrhne mapování hodnot stavu ze souboru na klíče stavů servisu. Přesná
 * shoda s klíčem nebo popiskem má přednost (servis, který si stavy převzal
 * ze ZL, dostane 1:1), pak synonyma, nakonec výchozí stav.
 */
export function navrhniMapovaniStavu(hodnoty: string[], stavy: StavServisu[], fallbackKey: string): Record<string, string> {
  const koncovy = koncovyStav(stavy) ?? fallbackKey;
  const nekoncove = stavy.filter((s) => !s.isFinal);
  const vysledek: Record<string, string> = {};
  for (const h of hodnoty) {
    const n = normalizujText(h);
    if (!n) continue;
    const presne = stavy.find((s) => normalizujText(s.key) === n || normalizujText(s.label) === n);
    if (presne) { vysledek[h] = presne.key; continue; }
    let klic = fallbackKey;
    for (const syn of SYNONYMA_STAVU) {
      if (!syn.vzor.test(n)) continue;
      const kandidati = syn.koncovy ? stavy : nekoncove;
      const shoda = syn.hledej ? kandidati.find((s) => syn.hledej!.test(normalizujText(s.label))) : undefined;
      klic = shoda?.key ?? (syn.koncovy ? koncovy : fallbackKey);
      break;
    }
    vysledek[h] = klic;
  }
  return vysledek;
}

/** Řádek tabulky `tickets` připravený k vložení (bez service_id – doplní se při zápisu). */
export type RadekZakazky = {
  code: string;
  created_at: string;
  completed_at: string | null;
  status: string;
  title: string;
  notes: string;
  customer_name: string | null;
  customer_phone: string | null;
  customer_email: string | null;
  customer_company: string | null;
  device_label: string | null;
  device_brand: string | null;
  device_serial: string | null;
  device_imei: string | null;
  device_passcode: string | null;
  device_condition: string | null;
  estimated_price: number | null;
  external_id: string | null;
  performed_repairs: ImportovanaOprava[];
};

export type ZaznamImportu =
  | { radek: number; stav: "novy"; data: RadekZakazky }
  | { radek: number; stav: "duplicita"; kod: string }
  | { radek: number; stav: "chyba"; zprava: string }
  | { radek: number; stav: "prazdny" };

export type PripravaZakazek = {
  zaznamy: ZaznamImportu[];
  novych: number;
  duplicit: number;
  chyb: number;
  prazdnych: number;
  /** Chyby s číslem řádku v souboru (hlavička je řádek 1). */
  chyby: Array<{ radek: number; zprava: string }>;
  /** Odlišné hodnoty stavu ze souboru – pro tabulku mapování v UI. */
  stavyVeVstupu: string[];
};

export type VolbyPripravy = {
  /** Čísla zakázek, která servis už má (bez smazaných). */
  existujiciKody: Set<string>;
  stavy: StavServisu[];
  fallbackKey: string;
  /** Hodnota stavu ze souboru → klíč stavu servisu; chybějící se dopočítá z data vydání. */
  mapovaniStavu?: Record<string, string>;
  /** Kdy vznikly řádky bez data přijetí (výchozí teď) – v testech pevné. */
  ted?: () => string;
};

/** Odlišné hodnoty ve sloupci stavu, v pořadí výskytu. */
export function stavyZeSouboru(tabulka: CsvTabulka, mapovani: Array<PoleZakazky | null>): string[] {
  const i = mapovani.indexOf("status");
  if (i < 0) return [];
  const videno = new Set<string>();
  for (const r of tabulka.radky) {
    const v = (r[i] ?? "").trim();
    if (v && !jePrazdne(v)) videno.add(v);
  }
  return [...videno];
}

/**
 * Přeloží řádky CSV na zakázky. Nic nezapisuje – UI z toho ukáže shrnutí
 * (kolik nových, kolik duplicit, které řádky mají chybu) a teprve potom
 * volá `zapisZakazky`.
 */
export function pripravZakazky(tabulka: CsvTabulka, mapovani: Array<PoleZakazky | null>, volby: VolbyPripravy): PripravaZakazek {
  const idx = (pole: PoleZakazky) => mapovani.indexOf(pole);
  const koncovy = koncovyStav(volby.stavy) ?? volby.fallbackKey;
  const mapovaniStavu = volby.mapovaniStavu ?? navrhniMapovaniStavu(stavyZeSouboru(tabulka, mapovani), volby.stavy, volby.fallbackKey);
  const znameKlice = new Set(volby.stavy.map((s) => s.key));
  const ted = volby.ted ?? (() => new Date().toISOString());
  const videneKody = new Set<string>();
  const zaznamy: ZaznamImportu[] = [];

  tabulka.radky.forEach((r, i) => {
    const radek = i + 2;
    const hodnota = (pole: PoleZakazky) => {
      const j = idx(pole);
      const v = j >= 0 ? (r[j] ?? "").trim() : "";
      return jePrazdne(v) ? "" : v;
    };
    const jeMapovano = (pole: PoleZakazky) => idx(pole) >= 0;
    const vsePrazdne = mapovani.every((m, j) => m === null || (r[j] ?? "").trim() === "");
    if (vsePrazdne) { zaznamy.push({ radek, stav: "prazdny" }); return; }

    const chyba = (zprava: string) => { zaznamy.push({ radek, stav: "chyba", zprava }); };

    const code = hodnota("code");
    if (!code) return chyba("chybí číslo zakázky");
    if (volby.existujiciKody.has(code) || videneKody.has(code)) {
      zaznamy.push({ radek, stav: "duplicita", kod: code });
      return;
    }

    let created_at: string;
    if (jeMapovano("created_at")) {
      const d = parsujDatum(hodnota("created_at"));
      if (d === undefined) return chyba(`nečitelné datum přijetí: ${hodnota("created_at")}`);
      if (d === null) return chyba("chybí datum přijetí");
      created_at = d;
    } else {
      created_at = ted();
    }
    const vydano = parsujDatum(hodnota("completed_at"));
    if (vydano === undefined) return chyba(`nečitelné datum vydání: ${hodnota("completed_at")}`);
    const completed_at = vydano ?? null;

    const estimated_price = parsujCastku(hodnota("estimated_price"));
    if (Number.isNaN(estimated_price)) return chyba(`nečitelná předpokládaná cena: ${hodnota("estimated_price")}`);
    const total = parsujCastku(hodnota("total_price"));
    if (Number.isNaN(total)) return chyba(`nečitelná celková cena: ${hodnota("total_price")}`);

    // Opravy: složený sloupec, nebo samostatné sloupce název/cena/náklady (jedna oprava na řádek).
    const slozene = parsujOpravy(hodnota("performed_repairs"));
    if (slozene.chyba) return chyba(slozene.chyba);
    const performed_repairs = [...slozene.opravy];
    const nazevOpravy = hodnota("repair_name");
    if (nazevOpravy) {
      const cena = parsujCastku(hodnota("repair_price"));
      const naklady = parsujCastku(hodnota("repair_costs"));
      if (Number.isNaN(cena)) return chyba(`nečitelná cena opravy: ${hodnota("repair_price")}`);
      if (Number.isNaN(naklady)) return chyba(`nečitelné náklady opravy: ${hodnota("repair_costs")}`);
      performed_repairs.push({ id: noveIdOpravy(), name: nazevOpravy, type: "manual", price: cena ?? 0, ...(naklady != null ? { costs: naklady } : {}) });
    }
    // Jen celková cena bez položek: jedna oprava, ať se částka neztratí ve statistikách.
    if (performed_repairs.length === 0 && total != null && total > 0) {
      performed_repairs.push({ id: noveIdOpravy(), name: "Oprava (z importu)", type: "manual", price: total });
    }

    const stavText = hodnota("status");
    let status = stavText ? mapovaniStavu[stavText] : undefined;
    if (!status || !znameKlice.has(status)) status = completed_at ? koncovy : volby.fallbackKey;

    const device_label = hodnota("device_label") || null;
    zaznamy.push({
      radek,
      stav: "novy",
      data: {
        code,
        created_at,
        completed_at,
        status,
        title: device_label ?? "Importovaná zakázka",
        notes: hodnota("notes") || "—",
        customer_name: hodnota("customer_name") || hodnota("customer_company") || null,
        customer_phone: hodnota("customer_phone") || null,
        customer_email: hodnota("customer_email") || null,
        customer_company: hodnota("customer_company") || null,
        device_label,
        device_brand: hodnota("device_brand") || null,
        device_serial: hodnota("device_serial") || null,
        device_imei: hodnota("device_imei") || null,
        device_passcode: hodnota("device_passcode") || null,
        device_condition: hodnota("device_condition") || null,
        estimated_price,
        external_id: hodnota("external_id") || null,
        performed_repairs,
      },
    });
    videneKody.add(code);
  });

  const chyby = zaznamy.flatMap((z) => (z.stav === "chyba" ? [{ radek: z.radek, zprava: z.zprava }] : []));
  return {
    zaznamy,
    novych: zaznamy.filter((z) => z.stav === "novy").length,
    duplicit: zaznamy.filter((z) => z.stav === "duplicita").length,
    chyb: chyby.length,
    prazdnych: zaznamy.filter((z) => z.stav === "prazdny").length,
    chyby,
    stavyVeVstupu: stavyZeSouboru(tabulka, mapovani),
  };
}

/** Kousek supabase klienta, který zápis potřebuje – v testech ho nahradí atrapa. */
export type KlientZapisu = {
  from: (tabulka: string) => { insert: (radky: unknown) => PromiseLike<{ error: { code?: string; message?: string } | null }> };
};

export type VysledekZapisu = {
  novych: number;
  /** Číslo zakázky mezitím někdo použil (unikátní index) – řádek se přeskočil. */
  preskoceno: number;
  chyb: number;
  chyby: Array<{ kod: string; zprava: string }>;
};

/**
 * Vloží zakázky po dávkách. Když dávka spadne (typicky kolize čísla
 * zakázky, kterou někdo založil během importu), projde se po jednom, aby
 * jedna kolize nezahodila zbylých 199 řádků. `completed_at` se posílá
 * výslovně – trigger ho doplní jen tam, kde chybí.
 */
export async function zapisZakazky(
  klient: KlientZapisu,
  serviceId: string,
  radky: RadekZakazky[],
  onPostup?: (procent: number) => void,
  velikostDavky = 200,
): Promise<VysledekZapisu> {
  const v: VysledekZapisu = { novych: 0, preskoceno: 0, chyb: 0, chyby: [] };
  for (let i = 0; i < radky.length; i += velikostDavky) {
    const davka = radky.slice(i, i + velikostDavky).map((r) => ({ ...r, service_id: serviceId }));
    const { error } = await klient.from("tickets").insert(davka);
    if (!error) {
      v.novych += davka.length;
    } else {
      for (const radek of davka) {
        const { error: e1 } = await klient.from("tickets").insert(radek);
        if (!e1) v.novych += 1;
        else if (e1.code === "23505") v.preskoceno += 1;
        else { v.chyb += 1; v.chyby.push({ kod: radek.code, zprava: e1.message ?? "zápis selhal" }); }
      }
    }
    onPostup?.(Math.min(100, Math.round(((i + davka.length) / Math.max(1, radky.length)) * 100)));
  }
  return v;
}
