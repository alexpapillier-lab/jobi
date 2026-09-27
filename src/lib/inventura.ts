/**
 * Inventura skladu – čistá logika (bez Supabase, bez Reactu).
 *
 * Inventura se dělá po skladech: při zahájení se zmrazí evidovaný stav
 * každého produktu ve skladu (`ocekavano`), lidé postupně zapisují
 * napočítané kusy a uzavření srovná sklad s napočítaným (RPC
 * `inventura_uzavrit`, migrace 20260927110000).
 *
 * Rozdíl řádku se počítá proti **stavu při počítání**, ne proti stavu při
 * zahájení. Inventura může běžet víc dní a sklad se mezitím hýbe (zakázka
 * odepíše díl, přijde objednávka); databáze si proto ve chvíli zápisu
 * napočítaného čísla zapamatuje, kolik evidence v tu chvíli ukazovala.
 * Když takový údaj chybí (starý řádek, ještě nedošel ze serveru), bere se
 * stav při zahájení. Stejný vzorec používá databáze – čísla v náhledu
 * a v protokolu tak sedí.
 *
 * Datová vrstva je v `inventuraDb.ts`.
 */

export type StavInventury = "open" | "closed" | "cancelled";

export type SouhrnInventury = {
  polozek: number;
  spocitano: number;
  nespocitano: number;
  /** Spočítané řádky, kde napočítané číslo nesedí s evidencí. */
  sRozdilem: number;
  /** Kusy, které chybí (kladné číslo). */
  mankoKs: number;
  /** Kusy navíc. */
  prebytekKs: number;
  /** Manko oceněné nákupní cenou (kladné číslo), jen řádky s cenou. */
  mankoKc: number;
  prebytekKc: number;
  /** Řádky s rozdílem, které nejde ocenit (produkt nemá nákupní cenu). */
  bezCeny: number;
};

export type Inventura = {
  id: string;
  serviceId: string;
  warehouseId: string | null;
  branchId: string | null;
  cislo: string;
  skladNazev: string;
  status: StavInventury;
  poznamka: string | null;
  zahajil: string | null;
  zahajenoAt: string;
  uzavrel: string | null;
  uzavrenoAt: string | null;
  nespocitaneBezeZmeny: boolean;
  /** Souhrn uložený při uzavření. U otevřené inventury null – počítá se živě. */
  souhrn: SouhrnInventury | null;
};

export type PolozkaInventury = {
  id: string;
  stocktakeId: string;
  /** null = produkt byl mezitím smazán; řádek zůstává jen v protokolu. */
  productId: string | null;
  nazev: string;
  sku: string | null;
  nakupniCena: number | null;
  /** Evidovaný stav ve skladu při zahájení inventury. */
  ocekavano: number;
  /** Živé rezervace zakázek při zahájení (díly pořád leží na regálu). */
  rezervovano: number;
  /** null = nespočítáno. */
  napocitano: number | null;
  /** Evidovaný stav ve chvíli, kdy se zapsalo `napocitano`. */
  stavPriPocitani: number | null;
  napocital: string | null;
  napocitanoAt: string | null;
  stavPredUzavrenim: number | null;
  zapsanyRozdil: number | null;
  pridanoRucne: boolean;
};

/* ---------- mapování řádků z databáze ---------- */

function cislo(v: unknown, vychozi: number): number {
  const n = typeof v === "string" ? Number(v) : (v as number);
  return typeof n === "number" && Number.isFinite(n) ? n : vychozi;
}

function cisloNeboNull(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = typeof v === "string" ? Number(v) : (v as number);
  return typeof n === "number" && Number.isFinite(n) ? n : null;
}

export function mapSouhrn(raw: unknown): SouhrnInventury | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  return {
    polozek: cislo(r.polozek, 0),
    spocitano: cislo(r.spocitano, 0),
    nespocitano: cislo(r.nespocitano, 0),
    sRozdilem: cislo(r.s_rozdilem, 0),
    mankoKs: cislo(r.manko_ks, 0),
    prebytekKs: cislo(r.prebytek_ks, 0),
    mankoKc: cislo(r.manko_kc, 0),
    prebytekKc: cislo(r.prebytek_kc, 0),
    bezCeny: cislo(r.bez_ceny, 0),
  };
}

export function mapInventura(r: Record<string, unknown>): Inventura {
  const status = r.status === "closed" || r.status === "cancelled" ? r.status : "open";
  return {
    id: String(r.id),
    serviceId: String(r.service_id),
    warehouseId: (r.warehouse_id as string | null) ?? null,
    branchId: (r.branch_id as string | null) ?? null,
    cislo: String(r.cislo ?? ""),
    skladNazev: String(r.sklad_nazev ?? ""),
    status,
    poznamka: (r.poznamka as string | null) ?? null,
    zahajil: (r.zahajil as string | null) ?? null,
    zahajenoAt: String(r.zahajeno_at ?? r.created_at ?? ""),
    uzavrel: (r.uzavrel as string | null) ?? null,
    uzavrenoAt: (r.uzavreno_at as string | null) ?? null,
    nespocitaneBezeZmeny: r.nespocitane_beze_zmeny === true,
    souhrn: mapSouhrn(r.souhrn),
  };
}

export function mapPolozka(r: Record<string, unknown>): PolozkaInventury {
  return {
    id: String(r.id),
    stocktakeId: String(r.stocktake_id),
    productId: (r.product_id as string | null) ?? null,
    nazev: String(r.nazev ?? ""),
    sku: (r.sku as string | null) || null,
    nakupniCena: cisloNeboNull(r.nakupni_cena),
    ocekavano: cislo(r.ocekavano, 0),
    rezervovano: cislo(r.rezervovano, 0),
    napocitano: cisloNeboNull(r.napocitano),
    stavPriPocitani: cisloNeboNull(r.stav_pri_pocitani),
    napocital: (r.napocital as string | null) ?? null,
    napocitanoAt: (r.napocitano_at as string | null) ?? null,
    stavPredUzavrenim: cisloNeboNull(r.stav_pred_uzavrenim),
    zapsanyRozdil: cisloNeboNull(r.zapsany_rozdil),
    pridanoRucne: r.pridano_rucne === true,
  };
}

/* ---------- rozdíly a ocenění ---------- */

/** Proti čemu se napočítané číslo porovnává. */
export function zakladPolozky(p: Pick<PolozkaInventury, "ocekavano" | "stavPriPocitani">): number {
  return p.stavPriPocitani ?? p.ocekavano;
}

/** Napočítáno − evidence. Záporné = manko, kladné = přebytek, null = nespočítáno. */
export function rozdilPolozky(p: Pick<PolozkaInventury, "napocitano" | "ocekavano" | "stavPriPocitani">): number | null {
  if (p.napocitano === null) return null;
  return p.napocitano - zakladPolozky(p);
}

/** Rozdíl v Kč (nákupní cena × rozdíl). null = nespočítáno nebo bez ceny. */
export function ocenitRozdil(p: Pick<PolozkaInventury, "napocitano" | "ocekavano" | "stavPriPocitani" | "nakupniCena">): number | null {
  const r = rozdilPolozky(p);
  if (r === null || p.nakupniCena === null) return null;
  return zaokrouhlitKc(r * p.nakupniCena);
}

function zaokrouhlitKc(n: number): number {
  return Math.round(n * 100) / 100;
}

/** Řádky, které do inventury patří (smazaný produkt se nepočítá ani nezapisuje). */
function zive(polozky: readonly PolozkaInventury[]): PolozkaInventury[] {
  return polozky.filter((p) => p.productId !== null);
}

export function souhrnInventury(polozky: readonly PolozkaInventury[]): SouhrnInventury {
  const s: SouhrnInventury = {
    polozek: 0, spocitano: 0, nespocitano: 0, sRozdilem: 0,
    mankoKs: 0, prebytekKs: 0, mankoKc: 0, prebytekKc: 0, bezCeny: 0,
  };
  for (const p of zive(polozky)) {
    s.polozek += 1;
    const r = rozdilPolozky(p);
    if (r === null) {
      s.nespocitano += 1;
      continue;
    }
    s.spocitano += 1;
    if (r === 0) continue;
    s.sRozdilem += 1;
    if (r < 0) s.mankoKs += -r;
    else s.prebytekKs += r;
    if (p.nakupniCena === null) {
      s.bezCeny += 1;
    } else if (r < 0) {
      s.mankoKc += -r * p.nakupniCena;
    } else {
      s.prebytekKc += r * p.nakupniCena;
    }
  }
  s.mankoKc = zaokrouhlitKc(s.mankoKc);
  s.prebytekKc = zaokrouhlitKc(s.prebytekKc);
  return s;
}

/** Průběh „X/Y spočítáno“ a procento (celé číslo, 100 jen když je hotovo všechno). */
export function prubehInventury(polozky: readonly PolozkaInventury[]): { hotovo: number; celkem: number; procento: number } {
  const z = zive(polozky);
  const hotovo = z.filter((p) => p.napocitano !== null).length;
  const celkem = z.length;
  if (celkem === 0) return { hotovo: 0, celkem: 0, procento: 0 };
  const procento = hotovo === celkem ? 100 : Math.min(99, Math.floor((hotovo / celkem) * 100));
  return { hotovo, celkem, procento };
}

/* ---------- validace ---------- */

export type MoznostUzavreni = { ok: true } | { ok: false; duvod: string };

/**
 * Jde inventuru uzavřít? Jen otevřenou, s aspoň jedním řádkem a buď se
 * všemi řádky spočítanými, nebo s výslovným „nespočítané = beze změny“.
 * Stejné pravidlo vynucuje databáze; tady je kvůli srozumitelné hlášce dřív.
 */
export function lzeUzavrit(
  inventura: Pick<Inventura, "status" | "warehouseId">,
  polozky: readonly PolozkaInventury[],
  nespocitaneBezeZmeny: boolean
): MoznostUzavreni {
  if (inventura.status === "closed") return { ok: false, duvod: "Inventura už je uzavřená." };
  if (inventura.status === "cancelled") return { ok: false, duvod: "Inventura je zrušená." };
  if (!inventura.warehouseId) return { ok: false, duvod: "Sklad inventury už neexistuje – inventuru jde jen zrušit." };
  const { hotovo, celkem } = prubehInventury(polozky);
  if (celkem === 0) return { ok: false, duvod: "Inventura nemá žádnou položku." };
  if (hotovo === 0 && !nespocitaneBezeZmeny) return { ok: false, duvod: "Zatím není spočítaná žádná položka." };
  const zbyva = celkem - hotovo;
  if (zbyva > 0 && !nespocitaneBezeZmeny) {
    return { ok: false, duvod: `Nespočítané položky: ${zbyva}. Spočítejte je, nebo potvrďte, že zůstanou beze změny.` };
  }
  return { ok: true };
}

/** Nejvíc kusů na jednom řádku. Víc je skoro jistě překlep (nebo načtený EAN v poli počtu). */
export const MAX_NAPOCITANO = 100_000;

export type VstupPoctu = { ok: true; hodnota: number | null } | { ok: false; chyba: string };

/**
 * Převede, co člověk napsal do pole, na počet kusů. Prázdné = nespočítáno
 * (tím jde omylem zapsané číslo vzít zpět). Jen celá nezáporná čísla.
 */
export function parseNapocitano(text: string): VstupPoctu {
  const t = text.trim().replace(/\s+/g, "");
  if (t === "") return { ok: true, hodnota: null };
  if (!/^\d+$/.test(t)) return { ok: false, chyba: "Zadejte celý počet kusů (0 a víc)." };
  const n = Number(t);
  if (!Number.isSafeInteger(n) || n > MAX_NAPOCITANO) return { ok: false, chyba: `Nejvýš ${MAX_NAPOCITANO.toLocaleString("cs-CZ")} ks na řádek.` };
  return { ok: true, hodnota: n };
}

/* ---------- hledání a čtečka ---------- */

export function bezDiakritiky(s: string): string {
  return s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
}

function normKod(s: string | null | undefined): string {
  return (s ?? "").trim().replace(/\s+/g, "").toLowerCase();
}

export type FiltrPolozek = "vse" | "nespocitane" | "rozdily";

/** Hledání v názvu a kódu (bez diakritiky) + filtr stavu řádku. Pořadí zůstává. */
export function filtrujPolozky(polozky: readonly PolozkaInventury[], dotaz: string, filtr: FiltrPolozek): PolozkaInventury[] {
  const q = bezDiakritiky(dotaz.trim());
  return polozky.filter((p) => {
    if (filtr === "nespocitane" && p.napocitano !== null) return false;
    if (filtr === "rozdily") {
      const r = rozdilPolozky(p);
      if (r === null || r === 0) return false;
    }
    if (!q) return true;
    return bezDiakritiky(p.nazev).includes(q) || bezDiakritiky(p.sku ?? "").includes(q);
  });
}

/**
 * Čtečka čárových kódů píše kód jako klávesnice a končí Enterem. Najde
 * řádek, jehož kód (SKU) se shoduje přesně – bez ohledu na velikost písmen
 * a mezery. Víc shod = nejednoznačné, vrací null.
 */
export function najdiPodleKodu<T extends { sku?: string | null }>(radky: readonly T[], kod: string): T | null {
  const k = normKod(kod);
  if (!k) return null;
  const shody = radky.filter((r) => normKod(r.sku) === k);
  return shody.length === 1 ? shody[0] : null;
}

/** Produkt ze skladu podle kódu – SKU nebo kód dodavatele. Pro „přidat nalezený díl“. */
export function najdiProduktPodleKodu<T extends { id: string; sku?: string | null; supplierSku?: string | null }>(
  produkty: readonly T[],
  kod: string
): T | null {
  const k = normKod(kod);
  if (!k) return null;
  const podleSku = produkty.filter((p) => normKod(p.sku) === k);
  if (podleSku.length === 1) return podleSku[0];
  if (podleSku.length > 1) return null;
  const podleDodavatele = produkty.filter((p) => normKod(p.supplierSku) === k);
  return podleDodavatele.length === 1 ? podleDodavatele[0] : null;
}

/** Další počet po načtení kódu čtečkou: každý „pípnutý“ kus přičte jedničku. */
export function poctemZeCtecky(p: Pick<PolozkaInventury, "napocitano">): number {
  return (p.napocitano ?? 0) + 1;
}

/* ---------- protokol ---------- */

function csvBunka(v: string | number | null | undefined): string {
  const s = v === null || v === undefined ? "" : String(v);
  return /[";\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function csvCislo(n: number | null): string {
  if (n === null) return "";
  // Excel v češtině čte desetinnou čárku.
  return String(n).replace(".", ",");
}

function csvDatum(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleString("cs-CZ");
}

/**
 * Protokol inventury jako CSV (středník, BOM – ať Excel pozná UTF-8).
 * Hlavička s údaji o inventuře, pak řádek na produkt, na konci souhrn.
 * `jmena` = přezdívky lidí podle id (kdo zahájil, uzavřel, napočítal).
 */
export function protokolCsv(
  inventura: Inventura,
  polozky: readonly PolozkaInventury[],
  jmena: Record<string, string> = {}
): string {
  const kdo = (id: string | null) => (id ? jmena[id] ?? "" : "");
  const souhrn = inventura.souhrn ?? souhrnInventury(polozky);
  const stav = inventura.status === "closed" ? "Uzavřená" : inventura.status === "cancelled" ? "Zrušená" : "Rozdělaná";
  const radky: (string | number | null)[][] = [
    ["Inventura", inventura.cislo],
    ["Sklad", inventura.skladNazev],
    ["Stav", stav],
    ["Zahájil", kdo(inventura.zahajil)],
    ["Zahájeno", csvDatum(inventura.zahajenoAt)],
    ["Uzavřel", kdo(inventura.uzavrel)],
    ["Uzavřeno", csvDatum(inventura.uzavrenoAt)],
    ["Nespočítané beze změny", inventura.nespocitaneBezeZmeny ? "ano" : "ne"],
    ["Poznámka", inventura.poznamka ?? ""],
    [],
    [
      "Produkt", "Kód", "Evidováno při zahájení", "Rezervováno", "Evidováno při počítání", "Napočítáno",
      "Rozdíl ks", "Nákupní cena", "Rozdíl Kč", "Zapsáno do skladu", "Napočítal", "Kdy",
    ],
  ];
  for (const p of polozky) {
    const r = rozdilPolozky(p);
    radky.push([
      p.productId === null ? `${p.nazev} (smazaný produkt)` : p.nazev,
      p.sku ?? "",
      p.ocekavano,
      p.rezervovano,
      p.napocitano === null ? "" : zakladPolozky(p),
      p.napocitano === null ? "nespočítáno" : p.napocitano,
      r === null ? "" : r,
      csvCislo(p.nakupniCena),
      csvCislo(ocenitRozdil(p)),
      p.zapsanyRozdil === null ? "" : p.zapsanyRozdil,
      kdo(p.napocital),
      csvDatum(p.napocitanoAt),
    ]);
  }
  radky.push(
    [],
    ["Položek", souhrn.polozek],
    ["Spočítáno", souhrn.spocitano],
    ["Nespočítáno", souhrn.nespocitano],
    ["S rozdílem", souhrn.sRozdilem],
    ["Manko ks", souhrn.mankoKs],
    ["Manko Kč", csvCislo(souhrn.mankoKc)],
    ["Přebytek ks", souhrn.prebytekKs],
    ["Přebytek Kč", csvCislo(souhrn.prebytekKc)],
    ["Rozdíly bez nákupní ceny", souhrn.bezCeny],
  );
  return "﻿" + radky.map((r) => r.map(csvBunka).join(";")).join("\r\n");
}

/** Název souboru protokolu: inventura-INV-2026-001.csv */
export function nazevProtokolu(inventura: Pick<Inventura, "cislo" | "zahajenoAt">): string {
  const zaklad = inventura.cislo.trim() || inventura.zahajenoAt.slice(0, 10) || "inventura";
  return `inventura-${zaklad.replace(/[^\w.-]+/g, "_")}.csv`;
}
