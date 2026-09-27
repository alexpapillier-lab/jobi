/**
 * Převod dat stažených ze Zakázkového listu (NDJSON, jeden záznam na
 * zakázku či reklamaci) na CSV ve tvaru, který čeká import v Jobi
 * (Nastavení → Firma → Migrace z jiného systému):
 *
 *   zakazky.csv   – předvolba „Zakázkový list“ v `src/lib/importZakazek.ts`
 *   zakaznici.csv – odhad sloupců v `src/lib/csv.ts` (import zákazníků)
 *   cenik.csv     – odhad sloupců v `src/lib/importCeniku.ts`
 *
 * Názvy sloupců jsou zvolené tak, aby je Jobi poznalo samo bez ručního
 * přemapování – hlídá to `prevod.test.ts`, který výstup pouští přímo přes
 * funkce importu z `src/lib`.
 *
 * Čistá logika: nic nečte ze sítě ani z disku (to dělá `migrace.ts`).
 * Kód nesmí importovat nic z `src/`, aby šla složka zkopírovat samostatně.
 */

// ── Tvar záznamu ze stahování (shodný se starým scrape_all.js) ──────────────

export type ZlKomentar = { author: string | null; createdAt: string | null; content: string };
export type ZlZmenaStavu = { status: string; user: string; at: string };
export type ZlTabulkaOprav = { header: string; rows: string[][] };
export type ZlZaznam = {
  code: string;
  kind: "order" | "claim";
  scrapedAt?: string;
  title?: string;
  kv?: Record<string, string>;
  repairTables?: ZlTabulkaOprav[];
  comments?: ZlKomentar[];
  statusHistory?: ZlZmenaStavu[];
  customerCode?: string | null;
  customerName?: string | null;
  deviceCode?: string | null;
  sourceOrderCode?: string | null;
  /** Detail se nepodařilo stáhnout – záznam se při dalším běhu stáhne znovu. */
  error?: string;
};

// ── Pomocné převody ─────────────────────────────────────────────────────────

/**
 * Hodnota z detailu, nebo null, když ZL místo ní píše pomlčku či větu
 * („Popis závady pro průvodní dopis nebyl vyplněn.“, „Nebyla stanovená
 * předpokládaná cena zakázky.“, „U této zakázky nebyl zvolen zákazník.“).
 */
export function hodnota(v: string | null | undefined): string | null {
  if (v == null) return null;
  const s = String(v).replace(/\s+/g, " ").trim();
  if (s === "" || s === "-" || s === "–" || /^nevypln[eě]no$/i.test(s)) return null;
  if (/nebyl[ao]? vyplněn|nebyla stanoven|nebyl zvolen|^anonymní zákazník$/i.test(s)) return null;
  return s;
}

/**
 * „2 600,00 Kč“ → 2600; pomlčka, prázdno a text bez čísla → null; nečitelné → NaN.
 * ZL k částce občas přilepí větu („3 500,00 Kč Cena zakázky je vyšší než
 * předpokládaná cena.“) – bere se částka na začátku.
 */
export function castka(v: string | null | undefined): number | null {
  const s0 = hodnota(v);
  if (!s0) return null;
  const s = s0.replace(/\u00a0/g, " ");
  const zacatek = s.match(/^(-?\d[\d ]*(?:[.,]\d+)?)\s*(?:kč|czk)\s+\S/i);
  let t = (zacatek ? zacatek[1] : s).replace(/\s*(kč|czk|,-)\s*/gi, "").replace(/\s+/g, "");
  if (!/\d/.test(t)) return null;
  if (t.includes(",") && t.includes(".")) t = t.replace(/\./g, "");
  t = t.replace(",", ".");
  if (!/^-?\d+(\.\d+)?$/.test(t)) return Number.NaN;
  return Math.round(parseFloat(t) * 100) / 100;
}

/** Číslo do CSV: bez měny a mezer, desetinná tečka (Jobi přečte obojí). */
export function formatCastka(n: number | null): string {
  if (n == null || Number.isNaN(n)) return "";
  return String(Math.round(n * 100) / 100);
}

/** „Vydáno - Zakázka dokončena“ → „Vydáno“ (stejně se jmenuje stav v seznamu i v Jobi). */
export function kratkyStav(s: string | null | undefined): string {
  return String(s ?? "")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\s*-\s*(Zakázka|Reklamace) dokončena$/i, "");
}

/** Aktuální stav: poslední záznam historie, jinak konec titulku („… IRPAZ2200001 Stornováno“). */
export function aktualniStav(rec: ZlZaznam): string {
  const h = rec.statusHistory ?? [];
  if (h.length > 0) return kratkyStav(h[h.length - 1].status);
  const t = rec.title ?? "";
  const i = t.indexOf(rec.code);
  return i >= 0 ? kratkyStav(t.slice(i + rec.code.length)) : "";
}

/** Středník a svislítko v názvu by rozbily složený sloupec oprav v Jobi. */
function bezOddelovacu(s: string): string {
  return s.replace(/[;|]/g, ",").replace(/\s+/g, " ").trim();
}

/** Telefon pro párování duplicit – stejné pravidlo jako `normalizePhone` v Jobi. */
export function normalizujTelefon(raw: string | null | undefined): string | null {
  if (!raw) return null;
  let s = String(raw).replace(/[\s\-()]/g, "").replace(/[^\d+]/g, "");
  if (!s) return null;
  if (s.startsWith("00")) s = "+" + s.slice(2);
  if (!s.startsWith("+")) s = "+420" + s;
  return s.length >= 8 ? s : null;
}

function bezDiakritiky(s: string): string {
  return s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();
}

// ── Položky oprav ───────────────────────────────────────────────────────────

export type Polozka = { nazev: string; cena: number | null; naklady: number | null };

/**
 * Položky z rozpisů „Položka opravy / Náklady / Cena (/ Akce)“. U reklamace
 * je navíc kopie položek původní zakázky („Zakázka - položky opravy“) –
 * ta se s `jenVlastni` přeskočí. Pořadí sloupců se čte z hlavičky, řádek
 * „Celkem“ se vynechá. Nečitelná částka se vrátí ve `varovani`.
 */
export function polozkyOprav(rec: ZlZaznam, jenVlastni = false): { polozky: Polozka[]; varovani: string[] } {
  const polozky: Polozka[] = [];
  const varovani: string[] = [];
  for (const t of rec.repairTables ?? []) {
    if (jenVlastni && /zakázk[ay]\s*-\s*polo/i.test(t.header)) continue;
    const h = t.header;
    const iNaklady = h.search(/Náklady/i);
    const iCena = h.search(/\bCena\b/i);
    // Sloupce za názvem v pořadí, v jakém jsou v hlavičce.
    const poradi = [
      ...(iNaklady >= 0 ? [{ pole: "naklady" as const, pozice: iNaklady }] : []),
      ...(iCena >= 0 ? [{ pole: "cena" as const, pozice: iCena }] : []),
    ].sort((a, b) => a.pozice - b.pozice);
    for (const row of t.rows) {
      const nazev = bezOddelovacu(row[0] ?? "");
      // „Žádné položky k zobrazení.“ je jediná buňka prázdného rozpisu, ne položka.
      if (!nazev || row.length < 2 || /^celkem$/i.test(nazev) || /^žádné položky/i.test(nazev)) continue;
      const p: Polozka = { nazev, cena: null, naklady: null };
      poradi.forEach((sl, k) => {
        const n = castka(row[k + 1]);
        if (Number.isNaN(n)) {
          varovani.push(`${rec.code}: nečitelná částka „${row[k + 1]}“ u položky „${nazev}“ – vynechána`);
          return;
        }
        p[sl.pole] = n;
      });
      polozky.push(p);
    }
  }
  return { polozky, varovani };
}

/** Složený sloupec pro Jobi: „název;cena;náklady|název;cena;náklady“. */
export function slozeneOpravy(polozky: Polozka[]): string {
  return polozky.map((p) => [p.nazev, formatCastka(p.cena), formatCastka(p.naklady)].join(";").replace(/;+$/, "")).join("|");
}

/** Historie stavů pro Jobi: „08.12.2022 09:51;Vydáno;Jakub Zima|…“ (datum v zápisu ZL). */
export function slozenaHistorie(rec: ZlZaznam): string {
  return (rec.statusHistory ?? [])
    .filter((h) => hodnota(h.at) && hodnota(h.status))
    .map((h) => [h.at.trim(), bezOddelovacu(kratkyStav(h.status)), bezOddelovacu(hodnota(h.user) ?? "")].join(";").replace(/;+$/, ""))
    .join("|");
}

// ── CSV ─────────────────────────────────────────────────────────────────────

/** Buňka CSV se středníkem jako oddělovačem (uvozovky jen když je potřeba). */
export function bunka(v: string | number | null | undefined): string {
  const s = v == null ? "" : String(v);
  return /[;"\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** CSV s BOM (Excel pak pozná UTF-8) a středníkem, řádky CRLF. */
export function csv(hlavicka: string[], radky: Array<Array<string | number | null>>): string {
  return "\uFEFF" + [hlavicka, ...radky].map((r) => r.map(bunka).join(";")).join("\r\n") + "\r\n";
}

/** Jednoduché čtení CSV (autodetekce ; , tab) – jen pro export zákazníků ze ZL. */
export function prectiCsv(text: string): { hlavicka: string[]; radky: string[][] } {
  const bez = text.replace(/^\uFEFF/, "");
  const prvni = bez.split(/\r?\n/, 1)[0] ?? "";
  const sep = [";", ",", "\t"].reduce((a, b) => (prvni.split(b).length > prvni.split(a).length ? b : a), ";");
  const radky: string[][] = [];
  let radek: string[] = [];
  let b = "";
  let q = false;
  for (let i = 0; i < bez.length; i++) {
    const c = bez[i];
    if (q) {
      if (c === '"' && bez[i + 1] === '"') { b += '"'; i++; }
      else if (c === '"') q = false;
      else b += c;
    } else if (c === '"' && b === "") q = true;
    else if (c === sep) { radek.push(b); b = ""; }
    else if (c === "\n" || c === "\r") {
      if (c === "\r" && bez[i + 1] === "\n") i++;
      radek.push(b); b = "";
      if (radek.some((x) => x.trim())) radky.push(radek.map((x) => x.trim()));
      radek = [];
    } else b += c;
  }
  radek.push(b);
  if (radek.some((x) => x.trim())) radky.push(radek.map((x) => x.trim()));
  return { hlavicka: radky.shift() ?? [], radky };
}

// ── Zakázky ─────────────────────────────────────────────────────────────────

/**
 * Hlavička zakazky.csv. Každý název je v předvolbě „Zakázkový list“
 * v Jobi, takže se sloupce přiřadí samy. Heslo zařízení jen na vyžádání.
 */
export function hlavickaZakazek(sHesly: boolean): string[] {
  return [
    "Kód",
    "Přijetí zařízení do opravy",
    "Zakázka vydána",
    "Stav",
    "Jméno a příjmení",
    "Telefonní číslo",
    "E-mailová adresa",
    "Firma",
    "Zařízení",
    "Sériové číslo",
    "IMEI",
    ...(sHesly ? ["Heslo zařízení / Kód obrazovky"] : []),
    "Požadovaná oprava",
    "Popis stavu zařízení",
    "Předpokládaná cena",
    "Externí identifikace",
    "Položky opravy",
    "Historie stavů",
  ];
}

/** Jméno zákazníka zakázky: „Jméno a příjmení“, jinak text odkazu na zákazníka. */
function jmenoZakaznika(rec: ZlZaznam): string | null {
  const kv = rec.kv ?? {};
  return hodnota(kv["Jméno a příjmení"]) ?? hodnota(rec.customerName) ?? null;
}

export function radekZakazky(rec: ZlZaznam, sHesly: boolean): { radek: string[]; varovani: string[] } {
  const kv = rec.kv ?? {};
  const h = rec.statusHistory ?? [];
  const prijato = hodnota(kv["Přijetí zařízení do opravy"]) ?? (h[0] ? hodnota(h[0].at) : null) ?? "";
  const vydano = hodnota(kv["Zakázka vydána"]) ?? hodnota(kv["Zakázka dokončena"]) ?? "";
  const { polozky, varovani } = polozkyOprav(rec, false);
  // Jobi má jedno pole „Stav zařízení“ – popis i zjištěné závady jdou do něj.
  const stavZarizeni = [hodnota(kv["Popis stavu zařízení"]), hodnota(kv["Stav zařízení a zjištěné závady"])].filter(Boolean);
  const odhad = castka(kv["Předpokládaná cena"]);
  if (Number.isNaN(odhad)) varovani.push(`${rec.code}: nečitelná předpokládaná cena „${kv["Předpokládaná cena"]}“ – vynechána`);
  const radek = [
    rec.code,
    prijato,
    vydano,
    aktualniStav(rec),
    jmenoZakaznika(rec) ?? "",
    hodnota(kv["Telefonní číslo"]) ?? "",
    hodnota(kv["E-mailová adresa"]) ?? "",
    hodnota(kv["Firma"]) ?? "",
    hodnota(kv["Zařízení"]) ?? "",
    hodnota(kv["Sériové číslo"]) ?? "",
    hodnota(kv["IMEI"]) ?? "",
    ...(sHesly ? [hodnota(kv["Heslo zařízení / Kód obrazovky"]) ?? ""] : []),
    hodnota(kv["Požadovaná oprava"]) ?? "",
    [...new Set(stavZarizeni)].join(" · "),
    Number.isNaN(odhad) ? "" : formatCastka(odhad),
    hodnota(kv["Externí identifikace"]) ?? "",
    slozeneOpravy(polozky),
    slozenaHistorie(rec),
  ];
  return { radek, varovani };
}

// ── Zákazníci ───────────────────────────────────────────────────────────────

export const HLAVICKA_ZAKAZNIKU = ["Jméno", "Telefon", "E-mail", "Firma", "IČO", "DIČ", "Poznámka"];

export type Zakaznik = {
  kod: string | null;
  jmeno: string | null;
  telefon: string | null;
  email: string | null;
  firma: string | null;
  ico: string | null;
  dic: string | null;
  zakazek: number;
  zExportu: boolean;
};

/** Sloupce exportu zákazníků ze ZL (Zákazníci → Export zákazníků): ID;Název;Telefonní číslo;E-mailová adresa;Firma;IČO;DIČ. */
function sloupecExportu(nazev: string): keyof Zakaznik | null {
  const n = bezDiakritiky(nazev);
  if (/^(id|kod)/.test(n)) return "kod";
  if (/^(nazev|jmeno|zakaznik)/.test(n)) return "jmeno";
  if (/tel/.test(n)) return "telefon";
  if (/mail/.test(n)) return "email";
  if (/^firma|spolecnost/.test(n)) return "firma";
  if (/^ic(o)?$/.test(n)) return "ico";
  if (/^dic$/.test(n)) return "dic";
  return null;
}

/**
 * Zákazníci z údajů na zakázkách a reklamacích, volitelně doplnění
 * o export zákazníků ze ZL (ten má navíc IČO/DIČ a zákazníky bez zakázky).
 * Totožnost: kód zákazníka v ZL (IRPC…), jinak telefon, jinak jméno+e-mail.
 * První neprázdná hodnota vyhrává, export doplňuje jen prázdná pole.
 */
export function zakaznici(zaznamy: ZlZaznam[], exportZl?: string | null): Zakaznik[] {
  const podleKlice = new Map<string, Zakaznik>();
  const podleTelefonu = new Map<string, Zakaznik>();
  const podleKodu = new Map<string, Zakaznik>();

  const doplnit = (z: Zakaznik, d: Partial<Zakaznik>) => {
    for (const k of ["kod", "jmeno", "telefon", "email", "firma", "ico", "dic"] as const) {
      if (!z[k] && d[k]) z[k] = d[k] as string;
    }
  };
  const najdi = (d: Partial<Zakaznik>): Zakaznik | undefined => {
    if (d.kod && podleKodu.has(d.kod)) return podleKodu.get(d.kod);
    const tel = normalizujTelefon(d.telefon);
    if (tel && podleTelefonu.has(tel)) return podleTelefonu.get(tel);
    const klic = `${bezDiakritiky(d.jmeno ?? "")}|${bezDiakritiky(d.email ?? "")}`;
    if (!tel && klic !== "|") return podleKlice.get(klic);
    return undefined;
  };
  const zaregistruj = (z: Zakaznik) => {
    if (z.kod) podleKodu.set(z.kod, z);
    const tel = normalizujTelefon(z.telefon);
    if (tel && !podleTelefonu.has(tel)) podleTelefonu.set(tel, z);
    const klic = `${bezDiakritiky(z.jmeno ?? "")}|${bezDiakritiky(z.email ?? "")}`;
    if (klic !== "|" && !podleKlice.has(klic)) podleKlice.set(klic, z);
  };
  const vysledek: Zakaznik[] = [];
  const pridej = (d: Partial<Zakaznik>, zakazka: boolean, zExportu: boolean) => {
    if (!d.jmeno && !d.telefon && !d.firma) return;
    const z = najdi(d);
    if (z) {
      doplnit(z, d);
      if (zakazka) z.zakazek += 1;
      if (zExportu) z.zExportu = true;
      zaregistruj(z);
      return;
    }
    const novy: Zakaznik = { kod: null, jmeno: null, telefon: null, email: null, firma: null, ico: null, dic: null, zakazek: zakazka ? 1 : 0, zExportu };
    doplnit(novy, d);
    vysledek.push(novy);
    zaregistruj(novy);
  };

  for (const rec of zaznamy) {
    if (rec.error) continue;
    const kv = rec.kv ?? {};
    pridej(
      {
        kod: hodnota(rec.customerCode),
        jmeno: jmenoZakaznika(rec),
        telefon: hodnota(kv["Telefonní číslo"]),
        email: hodnota(kv["E-mailová adresa"]),
        firma: hodnota(kv["Firma"]),
      },
      true,
      false,
    );
  }

  if (exportZl) {
    const t = prectiCsv(exportZl);
    const mapa = t.hlavicka.map(sloupecExportu);
    for (const r of t.radky) {
      const d: Partial<Zakaznik> = {};
      mapa.forEach((pole, i) => {
        if (pole && pole !== "zakazek" && pole !== "zExportu") (d as Record<string, string | null>)[pole] = hodnota(r[i]);
      });
      pridej(d, false, true);
    }
  }
  return vysledek;
}

export function radekZakaznika(z: Zakaznik): string[] {
  return [
    z.jmeno ?? z.firma ?? z.telefon ?? "",
    z.telefon ?? "",
    z.email ?? "",
    z.firma ?? "",
    z.ico ?? "",
    z.dic ?? "",
    z.kod ? `Zakázkový list: ${z.kod}` : "",
  ];
}

// ── Ceník ───────────────────────────────────────────────────────────────────

export const HLAVICKA_CENIKU = ["Značka", "Kategorie", "Model", "Oprava", "Cena", "Náklady", "Čas", "Popis"];

/**
 * Čas z ceníku ZL → minuty. Volný text: „60 min“, „60 mion.“, „2 hod“,
 * „3 dny“, „2 - 3 dny“ (horní mez – slibovat kratší dobu je horší),
 * „1 - 10 dnů“. Prázdno → null, nečitelné → NaN.
 */
export function minuty(text: string | null | undefined): number | null {
  const s = String(text ?? "").replace(/\u00a0/g, " ").trim().toLowerCase();
  if (!s || s === "-") return null;
  const m = s.match(/^(\d+(?:[.,]\d+)?)\s*(?:[-–]\s*(\d+(?:[.,]\d+)?))?\s*([a-zá-ž]+)?\.?$/);
  if (!m) return Number.NaN;
  const n = parseFloat((m[2] ?? m[1]).replace(",", "."));
  const j = m[3] ?? "m";
  const nasobek = /^m/.test(j) ? 1 : /^h/.test(j) ? 60 : /^d/.test(j) ? 1440 : /^t/.test(j) ? 10080 : null;
  return nasobek == null ? Number.NaN : Math.round(n * nasobek);
}

/** Produktové řady, u kterých je značka jasná (ZL značky nevede, jen kategorie). */
const RADY: Array<[RegExp, string, string]> = [
  [/^iphone/i, "Apple", "iPhone"],
  [/^ipad/i, "Apple", "iPad"],
  [/^macbook/i, "Apple", "MacBook"],
  [/^imac/i, "Apple", "iMac"],
  [/^mac\b|^mac mini/i, "Apple", "Mac"],
  [/^(apple )?watch/i, "Apple", "Apple Watch"],
  [/^airpods/i, "Apple", "AirPods"],
  [/^(samsung|galaxy)/i, "Samsung", "Telefony"],
  [/^(xiaomi|redmi|poco)/i, "Xiaomi", "Telefony"],
  [/^(google )?pixel/i, "Google", "Telefony"],
  [/^dyson/i, "Dyson", "Ostatní"],
];
const ZNAMKY = ["Apple", "Samsung", "Dyson", "Xiaomi", "Huawei", "Honor", "Google", "Motorola", "Nokia", "OnePlus", "Oppo", "Realme", "Vivo", "Sony", "Lenovo", "Asus", "Acer", "HP", "Dell", "Microsoft", "Nintendo", "LG", "Garmin", "JBL", "Bose"];

/** Značka pro kategorii: Apple podle řady, jinak nejčastější známá značka v názvech modelů, jinak název kategorie. */
export function znackaKategorie(kategorie: string, modely: string[]): string {
  for (const [re, znacka] of RADY) if (znacka === "Apple" && re.test(kategorie)) return znacka;
  const pocty = new Map<string, number>();
  for (const m of modely) {
    for (const z of ZNAMKY) if (new RegExp(`(^|\\s)${z}(\\s|$)`, "i").test(m) || RADY.some(([re, zn]) => zn === z && re.test(m))) pocty.set(z, (pocty.get(z) ?? 0) + 1);
  }
  const nej = [...pocty.entries()].sort((a, b) => b[1] - a[1])[0];
  return nej ? nej[0] : kategorie;
}

export type KatalogPolozka = { name: string; description?: string | null; time_requirement?: string | null; priority?: number | null; price: number | string; discount?: number | null };
export type KatalogModel = {
  id: number | string;
  description: string;
  priority?: number | null;
  isDeprecated?: boolean;
  priceLists?: KatalogPolozka[] | null;
  parent?: { description?: string | null } | null;
};

export type SouhrnCeniku = { znacek: number; kategorii: number; modelu: number; oprav: number; modeluBezCeniku: number; slouceno: number; varovani: string[] };

/**
 * Ceník z API ZL (`/api/rest/device-type/{id}`, odpověď `{ response: … }`).
 * Model stejného jména ve dvou kategoriích (u iSwapu prázdná „Apple Watch“
 * vedle staré „Watch“ s ceníkem) se bere jednou – přednost má ten s ceníkem.
 * Model bez ceníku dostane řádek bez opravy (Jobi ho jen založí).
 */
export function cenikZKatalogu(detail: Record<string, unknown>): { radky: string[][]; souhrn: SouhrnCeniku } {
  const zaznamy = Object.values(detail).map((v) => ((v as { response?: KatalogModel }).response ?? v) as KatalogModel).filter((m) => m && m.description);
  const podleJmena = new Map<string, { m: KatalogModel; kategorie: string }>();
  let slouceno = 0;
  for (const m of zaznamy) {
    const kategorie = hodnota(m.parent?.description) ?? "Ostatní";
    const k = bezDiakritiky(m.description);
    const pred = podleJmena.get(k);
    if (pred) {
      slouceno += 1;
      if ((pred.m.priceLists ?? []).length === 0 && (m.priceLists ?? []).length > 0) podleJmena.set(k, { m, kategorie });
      continue;
    }
    podleJmena.set(k, { m, kategorie });
  }
  const modelyKategorie = new Map<string, string[]>();
  for (const { m, kategorie } of podleJmena.values()) modelyKategorie.set(kategorie, [...(modelyKategorie.get(kategorie) ?? []), m.description]);
  const znacka = new Map([...modelyKategorie.entries()].map(([k, ms]) => [k, znackaKategorie(k, ms)]));

  const varovani: string[] = [];
  const radky: string[][] = [];
  let oprav = 0;
  let bezCeniku = 0;
  const serazene = [...podleJmena.values()].sort((a, b) => a.kategorie.localeCompare(b.kategorie, "cs") || (a.m.priority ?? 0) - (b.m.priority ?? 0) || a.m.description.localeCompare(b.m.description, "cs"));
  for (const { m, kategorie } of serazene) {
    const z = znacka.get(kategorie) ?? kategorie;
    const polozky = [...(m.priceLists ?? [])].sort((a, b) => (a.priority ?? 0) - (b.priority ?? 0));
    if (polozky.length === 0) {
      bezCeniku += 1;
      radky.push([z, kategorie, m.description, "", "", "", "", ""]);
      continue;
    }
    for (const p of polozky) {
      const cas = minuty(p.time_requirement);
      if (Number.isNaN(cas)) varovani.push(`${m.description} / ${p.name}: nečitelný čas „${p.time_requirement}“ – vynechán`);
      const cena = typeof p.price === "number" ? p.price : castka(p.price);
      if (p.discount) varovani.push(`${m.description} / ${p.name}: sleva ${p.discount} se nepřenáší, cena je bez slevy`);
      radky.push([z, kategorie, m.description, bezOddelovacu(p.name), formatCastka(Number.isNaN(cena) ? null : cena), "", cas == null || Number.isNaN(cas) ? "" : String(cas), (p.description ?? "").replace(/\s+/g, " ").trim()]);
      oprav += 1;
    }
  }
  return {
    radky,
    souhrn: { znacek: new Set(znacka.values()).size, kategorii: modelyKategorie.size, modelu: podleJmena.size, oprav, modeluBezCeniku: bezCeniku, slouceno, varovani },
  };
}

/**
 * Náhradní ceník z provedených oprav na zakázkách (když k API ceníku nejsou
 * tokeny). Model = pole „Zařízení“, cena = nejčastější cena položky u toho
 * modelu, při shodě ta z novější zakázky. Hrubé: překlepy v názvech položek
 * se přenesou jako samostatné opravy – proto jen na výslovné přání.
 */
export function cenikZeZakazek(zaznamy: ZlZaznam[]): { radky: string[][]; souhrn: SouhrnCeniku } {
  type Stat = { znacka: string; kategorie: string; model: string; nazev: string; ceny: Map<number, { pocet: number; posledni: number }>; naklady: number | null };
  const stat = new Map<string, Stat>();
  zaznamy.forEach((rec, poradi) => {
    if (rec.error || rec.kind !== "order") return;
    const model = hodnota(rec.kv?.["Zařízení"]);
    if (!model) return;
    const rada = RADY.find(([re]) => re.test(model));
    const znacka = rada?.[1] ?? ZNAMKY.find((z) => new RegExp(`^${z}\\b`, "i").test(model)) ?? model.split(" ")[0];
    const kategorie = rada?.[2] ?? "Ostatní";
    for (const p of polozkyOprav(rec).polozky) {
      if (p.cena == null || p.cena <= 0) continue;
      const k = `${bezDiakritiky(model)}|${bezDiakritiky(p.nazev)}`;
      const s = stat.get(k) ?? { znacka, kategorie, model, nazev: p.nazev, ceny: new Map(), naklady: null };
      const c = s.ceny.get(p.cena) ?? { pocet: 0, posledni: 0 };
      c.pocet += 1;
      c.posledni = poradi;
      s.ceny.set(p.cena, c);
      if (p.naklady != null) s.naklady = p.naklady;
      stat.set(k, s);
    }
  });
  const radky = [...stat.values()]
    .sort((a, b) => a.znacka.localeCompare(b.znacka, "cs") || a.model.localeCompare(b.model, "cs") || a.nazev.localeCompare(b.nazev, "cs"))
    .map((s) => {
      const [cena] = [...s.ceny.entries()].sort((a, b) => b[1].pocet - a[1].pocet || b[1].posledni - a[1].posledni)[0];
      return [s.znacka, s.kategorie, s.model, s.nazev, formatCastka(cena), formatCastka(s.naklady), "", ""];
    });
  const modely = new Set(radky.map((r) => `${r[1]}|${r[2]}`));
  return {
    radky,
    souhrn: { znacek: new Set(radky.map((r) => r[0])).size, kategorii: new Set(radky.map((r) => `${r[0]}|${r[1]}`)).size, modelu: modely.size, oprav: radky.length, modeluBezCeniku: 0, slouceno: 0, varovani: [] },
  };
}

// ── Archivní soubory (Jobi je zatím neimportuje) ────────────────────────────

export const HLAVICKA_KOMENTARU = ["Kód", "Druh", "Autor", "Datum", "Text"];
export function radkyKomentaru(zaznamy: ZlZaznam[]): string[][] {
  const out: string[][] = [];
  for (const rec of zaznamy) {
    for (const c of rec.comments ?? []) {
      if (!hodnota(c.content)) continue;
      out.push([rec.code, rec.kind === "claim" ? "reklamace" : "zakázka", hodnota(c.author) ?? "", hodnota(c.createdAt) ?? "", c.content.replace(/\s+/g, " ").trim()]);
    }
  }
  return out;
}

export const HLAVICKA_REKLAMACI = ["Kód", "Původní zakázka", "Převzetí zařízení k reklamaci", "Reklamace vydána", "Stav", "Jméno a příjmení", "Telefonní číslo", "Zařízení", "Sériové číslo", "IMEI", "Důvod reklamace", "Řešení (položky)", "Historie stavů"];
export function radekReklamace(rec: ZlZaznam): string[] {
  const kv = rec.kv ?? {};
  return [
    rec.code,
    hodnota(rec.sourceOrderCode) ?? "",
    hodnota(kv["Převzetí zařízení k reklamaci"]) ?? (rec.statusHistory?.[0] ? rec.statusHistory[0].at : ""),
    hodnota(kv["Reklamace vydána"]) ?? hodnota(kv["Reklamace dokončena"]) ?? "",
    aktualniStav(rec),
    jmenoZakaznika(rec) ?? "",
    hodnota(kv["Telefonní číslo"]) ?? "",
    hodnota(kv["Zařízení"]) ?? "",
    hodnota(kv["Sériové číslo"]) ?? "",
    hodnota(kv["IMEI"]) ?? "",
    hodnota(kv["Důvod reklamace"]) ?? "",
    slozeneOpravy(polozkyOprav(rec, true).polozky),
    slozenaHistorie(rec),
  ];
}

// ── Celý převod + report ────────────────────────────────────────────────────

export type VstupPrevodu = {
  zakazky: ZlZaznam[];
  reklamace: ZlZaznam[];
  /** Text exportu zákazníků ze ZL, pokud ho máme. */
  exportZakazniku?: string | null;
  /** Detail katalogu z API (`{ id: { response: model } }`), pokud ho máme. */
  katalog?: Record<string, unknown> | null;
  cenikZeZakazek?: boolean;
  sHesly?: boolean;
  /** Kolik kódů bylo v seznamech ZL (kvůli kontrole úplnosti), pokud víme. */
  kodyVSeznamu?: { zakazky: number; reklamace: number } | null;
  ted?: Date;
};

export type VystupPrevodu = { soubory: Record<string, string>; report: string; pocty: Record<string, number> };

/** Poslední záznam ke každému kódu (při opakovaném stažení vyhrává novější). */
export function posledniPodleKodu(zaznamy: ZlZaznam[]): ZlZaznam[] {
  const m = new Map<string, ZlZaznam>();
  for (const z of zaznamy) {
    const pred = m.get(z.code);
    // Chybový pokus nepřepíše dřív úspěšně stažený záznam.
    if (pred && !pred.error && z.error) continue;
    m.set(z.code, z);
  }
  return [...m.values()].sort((a, b) => (a.code < b.code ? -1 : a.code > b.code ? 1 : 0));
}

export function preved(vstup: VstupPrevodu): VystupPrevodu {
  const sHesly = !!vstup.sHesly;
  const vsechnyZakazky = posledniPodleKodu(vstup.zakazky);
  const vsechnyReklamace = posledniPodleKodu(vstup.reklamace);
  const zakazky = vsechnyZakazky.filter((z) => !z.error);
  const reklamace = vsechnyReklamace.filter((z) => !z.error);
  const chybne = [...vsechnyZakazky, ...vsechnyReklamace].filter((z) => z.error);

  const varovani: string[] = [];
  const radkyZakazek = zakazky.map((rec) => {
    const r = radekZakazky(rec, sHesly);
    varovani.push(...r.varovani);
    return r.radek;
  });
  const zak = zakaznici([...zakazky, ...reklamace], vstup.exportZakazniku);
  const zakSJmenem = zak.filter((z) => z.jmeno || z.firma || z.telefon);

  let cenik: { radky: string[][]; souhrn: SouhrnCeniku } | null = null;
  let zdrojCeniku = "";
  if (vstup.katalog && Object.keys(vstup.katalog).length > 0) {
    cenik = cenikZKatalogu(vstup.katalog);
    zdrojCeniku = "API ceníku Zakázkového listu";
  } else if (vstup.cenikZeZakazek) {
    cenik = cenikZeZakazek(zakazky);
    zdrojCeniku = "provedené opravy na zakázkách (náhradní ceník)";
  }
  if (cenik) varovani.push(...cenik.souhrn.varovani);

  const soubory: Record<string, string> = {
    "zakazky.csv": csv(hlavickaZakazek(sHesly), radkyZakazek),
    "zakaznici.csv": csv(HLAVICKA_ZAKAZNIKU, zakSJmenem.map(radekZakaznika)),
  };
  if (cenik) soubory["cenik.csv"] = csv(HLAVICKA_CENIKU, cenik.radky);
  const komentare = radkyKomentaru([...zakazky, ...reklamace]);
  if (komentare.length > 0) soubory["komentare.csv"] = csv(HLAVICKA_KOMENTARU, komentare);
  if (reklamace.length > 0) soubory["reklamace.csv"] = csv(HLAVICKA_REKLAMACI, reklamace.map(radekReklamace));

  // ── počty pro report ──
  const stavy = new Map<string, number>();
  for (const z of zakazky) stavy.set(aktualniStav(z) || "(bez stavu)", (stavy.get(aktualniStav(z) || "(bez stavu)") ?? 0) + 1);
  const stavyVHistorii = new Set(zakazky.flatMap((z) => (z.statusHistory ?? []).map((h) => kratkyStav(h.status))));
  const kv = (pole: string) => zakazky.filter((z) => hodnota(z.kv?.[pole])).length;
  const polozek = zakazky.reduce((s, z) => s + polozkyOprav(z).polozky.length, 0);
  const sHistorii = zakazky.filter((z) => (z.statusHistory ?? []).length > 0).length;
  const bezZakaznika = zakazky.filter((z) => !jmenoZakaznika(z) && !hodnota(z.kv?.["Telefonní číslo"])).length;
  // Místo hesla ZL často píše větu („Pro tento typ opravy není heslo požadováno.“) – to heslo není.
  const hesel = zakazky.filter((z) => { const v = hodnota(z.kv?.["Heslo zařízení / Kód obrazovky"]); return !!v && !/\s\S+.*\.$/.test(v); }).length;
  const komentaruZakazek = zakazky.reduce((s, z) => s + (z.comments ?? []).length, 0);
  const komentaruReklamaci = reklamace.reduce((s, z) => s + (z.comments ?? []).length, 0);
  const zExportu = zak.filter((z) => z.zExportu).length;
  const bezTelefonu = zakSJmenem.filter((z) => !normalizujTelefon(z.telefon)).length;

  const pocty: Record<string, number> = {
    zakazek: zakazky.length,
    reklamaci: reklamace.length,
    zakazniku: zakSJmenem.length,
    polozekOprav: polozek,
    komentaru: komentare.length,
    chyb: chybne.length,
    cenikRadku: cenik?.radky.length ?? 0,
  };

  const ted = vstup.ted ?? new Date();
  const r: string[] = [];
  r.push(`# Migrace ze Zakázkového listu – report`, "");
  r.push(`Vytvořeno ${ted.toLocaleString("cs-CZ", { timeZone: "Europe/Prague" })}.`, "");
  r.push("## Co je v souborech", "");
  r.push("| Soubor | Řádků | Kam s ním |", "|---|---:|---|");
  r.push(`| zakazky.csv | ${zakazky.length} | Nastavení → Firma → Migrace → 2. Zakázky (předvolba „Zakázkový list“) |`);
  r.push(`| zakaznici.csv | ${zakSJmenem.length} | Migrace → 1. Zákazníci |`);
  r.push(cenik ? `| cenik.csv | ${cenik.radky.length} | Migrace → 3. Ceník oprav (zdroj: ${zdrojCeniku}) |` : "| cenik.csv | – | nevznikl – viz „Ceník“ níže |");
  if (komentare.length > 0) r.push(`| komentare.csv | ${komentare.length} | jen archiv, Jobi je zatím neimportuje |`);
  if (reklamace.length > 0) r.push(`| reklamace.csv | ${reklamace.length} | jen archiv, Jobi reklamace z CSV zatím neimportuje |`);
  r.push("");

  r.push("## Zakázky", "");
  if (vstup.kodyVSeznamu) {
    const ok = vstup.kodyVSeznamu.zakazky === vsechnyZakazky.length;
    r.push(`- V seznamu ZL bylo **${vstup.kodyVSeznamu.zakazky}** zakázek, staženo **${zakazky.length}**${ok && chybne.length === 0 ? " – úplné." : "."}`);
  } else {
    r.push(`- Staženo **${zakazky.length}** zakázek.`);
  }
  r.push(`- S historií stavů: ${sHistorii} (sloupec „Historie stavů“ – import ji zapíše do historie zakázky s původním datem; kdo stav měnil, ukáže Jobi jako „Systém“).`);
  const rozepsane = zakazky.filter((z) => /^zakládá se$/i.test(aktualniStav(z))).length;
  if (rozepsane > 0) r.push(`- Rozepsané („Zakládá se“): ${rozepsane} – v ZL nikdy nedokončené; při importu je můžete přiřadit ke storno stavu.`);
  r.push(`- Provedených oprav (položek): ${polozek}.`);
  r.push(`- Bez zákazníka (anonymní / nevyplněný): ${bezZakaznika}.`);
  r.push(`- S předpokládanou cenou: ${kv("Předpokládaná cena")}, s externím označením: ${kv("Externí identifikace")}.`);
  r.push("");
  r.push("Stavy (hodnota ve sloupci „Stav“ → počet). V Jobi je při importu přiřadíte ke stavům servisu:", "");
  for (const [s, n] of [...stavy.entries()].sort((a, b) => b[1] - a[1])) r.push(`- ${s}: ${n}`);
  const jenVHistorii = [...stavyVHistorii].filter((s) => !stavy.has(s));
  if (jenVHistorii.length > 0) r.push("", `Stavy, které jsou jen v historii (taky se budou přiřazovat): ${jenVHistorii.join(", ")}.`);
  r.push("");

  r.push("## Zákazníci", "");
  r.push(`- ${zakSJmenem.length} zákazníků${zExportu > 0 ? `, z toho ${zExportu} spárováno s exportem zákazníků ze ZL (IČO, DIČ, zákazníci bez zakázky)` : " sestavených z údajů na zakázkách (export zákazníků ze ZL nebyl k dispozici – bez IČO/DIČ a bez zákazníků, kteří nemají zakázku)"}.`);
  r.push(`- Bez použitelného telefonu: ${bezTelefonu} – Jobi je založí, ale duplicity u nich nepozná.`);
  r.push("");

  r.push("## Ceník", "");
  if (cenik) {
    const s = cenik.souhrn;
    r.push(`- Zdroj: ${zdrojCeniku}.`);
    r.push(`- ${s.znacek} značek, ${s.kategorii} kategorií, ${s.modelu} modelů, ${s.oprav} oprav${s.modeluBezCeniku ? `, ${s.modeluBezCeniku} modelů bez ceníku (založí se jen model)` : ""}${s.slouceno ? `, ${s.slouceno} duplicitních modelů sloučeno` : ""}.`);
    r.push("- Značky Zakázkový list nevede – odvozené z kategorie a názvů modelů. Po importu je zkontrolujte na stránce Zařízení.");
  } else {
    r.push("- Ceník se nestáhl: k API ceníku chybí tokeny (ZL_APPLICATION_TOKEN, ZL_BRAND_TOKEN) a náhradní ceník ze zakázek nebyl zapnutý (`--cenik-ze-zakazek`).");
  }
  r.push("");

  r.push("## Co se nepřeneslo", "");
  r.push(`- **Komentáře** (${komentaruZakazek} u zakázek, ${komentaruReklamaci} u reklamací) – import v Jobi je zatím neumí, jsou v komentare.csv.`);
  r.push(`- **Reklamace** (${reklamace.length}) – import v Jobi reklamace nemá, jsou v reklamace.csv.`);
  r.push(`- **Technici** („Přijal“, „Opravoval“, „Vydal“) a jména v historii stavů – v Jobi nejsou stejní uživatelé; historie ukáže „Systém“.`);
  r.push(`- **Způsob převzetí a předání**, **Maximální cena**, **Závada pro průvodní dopis** (vyplněna u ${kv("Závada pro průvodní dopis")} zakázek) – Jobi je v importu nemá.`);
  r.push(sHesly
    ? `- Hesla zařízení jsou v zakazky.csv (${hesel} zakázek) – soubor po importu smažte.`
    : `- **Hesla / kódy obrazovky** (${hesel} zakázek) – schválně vynechané; kdo je chce, spustí převod s \`--s-hesly\`. PIN se ze ZL nestahuje nikdy.`);
  r.push("- Fotky, dokumenty a podpisy – bot je nestahuje.");
  r.push("");

  if (chybne.length > 0) {
    r.push("## Nestažené detaily", "");
    r.push(`${chybne.length} zakázek/reklamací se nepodařilo stáhnout. Spusťte stahování znovu – hotové se přeskočí a zkusí se jen tyto:`, "");
    for (const z of chybne.slice(0, 50)) r.push(`- ${z.code}: ${z.error}`);
    if (chybne.length > 50) r.push(`- … a dalších ${chybne.length - 50}`);
    r.push("");
  }
  if (varovani.length > 0) {
    r.push("## Varování převodu", "");
    for (const v of varovani.slice(0, 100)) r.push(`- ${v}`);
    if (varovani.length > 100) r.push(`- … a dalších ${varovani.length - 100}`);
    r.push("");
  }

  r.push("## Postup v Jobi", "");
  r.push("1. Nastavení → Firma → Migrace z jiného systému → **Importovat zákazníky** → zakaznici.csv.");
  r.push("2. **Importovat zakázky** → předvolba „Zakázkový list“ → zakazky.csv → zkontrolujte přiřazení stavů → Importovat.");
  r.push("3. **Importovat ceník** → cenik.csv.");
  r.push("4. Import jde spustit znovu – co už v Jobi je (telefon, číslo zakázky, oprava u modelu), se přeskočí.");
  r.push("5. Po kontrole složku s CSV smažte – jsou v ní osobní údaje zákazníků.");
  r.push("");
  return { soubory, report: r.join("\n"), pocty };
}
