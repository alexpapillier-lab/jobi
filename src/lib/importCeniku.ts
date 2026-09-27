/**
 * Import ceníku oprav z CSV (značka, kategorie, model, oprava, cena,
 * náklady, čas) do katalogu servisu: device_brands → device_categories →
 * device_models → repairs. Čistá logika bez React a bez Supabase; zápis
 * jde přes předaného klienta (v aplikaci supabase, v testech atrapa).
 *
 * Co už v katalogu je, se znovu nezakládá: značka, kategorie i model se
 * poznají podle názvu bez ohledu na velikost písmen (stejně jako unikátní
 * indexy v databázi). Oprava se stejným názvem u téhož modelu se přeskočí;
 * oprava stejného názvu, ceny a času u jiného modelu se jen rozšíří o ten
 * model – v Jobi jedna oprava patří k více modelům (Repair.modelIds).
 */
import type { CsvTabulka } from "./csv";
import type { DevicesData } from "./devicesDb";
import { normalizujText, parsujCastku } from "./importZakazek";

export type PoleCeniku = "brand" | "category" | "model" | "repair" | "price" | "costs" | "time" | "details";

export const POPIS_POLE_CENIKU: Record<PoleCeniku, string> = {
  brand: "Značka",
  category: "Kategorie",
  model: "Model",
  repair: "Oprava",
  price: "Cena",
  costs: "Náklady",
  time: "Čas opravy",
  details: "Popis opravy",
};

export const POLE_CENIKU: PoleCeniku[] = ["brand", "category", "model", "repair", "price", "costs", "time", "details"];

/** Kategorie pro řádky, které ji neuvádějí – katalog Jobi ji vyžaduje. */
export const VYCHOZI_KATEGORIE = "Ostatní";

const VZORY: Array<[PoleCeniku, RegExp]> = [
  ["brand", /zna[čc]k|v[yý]robc|brand/i],
  ["category", /kategor|typ za[řr][ií]zen[ií]|category|skupin/i],
  ["model", /model|za[řr][ií]zen[ií]|device/i],
  ["costs", /n[aá]klad|n[aá]kup|cost/i],
  ["price", /cena|price/i],
  ["time", /[čc]as|doba|minut|trv[aá]n|time|duration/i],
  ["details", /popis|pozn|detail|description|note/i],
  ["repair", /oprav|[uú]kon|slu[žz]b|n[aá]zev|polo[žz]k|repair|service|name/i],
];

/** Odhadne význam sloupců podle hlavičky; každé pole nejvýš jednou. */
export function odhadniMapovaniCeniku(hlavicka: string[]): Array<PoleCeniku | null> {
  const pouzito = new Set<PoleCeniku>();
  return hlavicka.map((h) => {
    const nazev = h.trim();
    if (!nazev) return null;
    for (const [pole, re] of VZORY) {
      if (!pouzito.has(pole) && re.test(nazev)) {
        pouzito.add(pole);
        return pole;
      }
    }
    return null;
  });
}

/**
 * Čas opravy → minuty. „60“, „60 min“, „1,5 h“, „2 hod“, „3 dny“ i rozsah
 * „2 - 3 dny“ (bere se horní mez, viz scripts/import-zakazkovylist). Den je
 * 24 h, protože v ZL jde o dobu, po kterou je zařízení v servisu. Prázdno →
 * null, nečitelný text → NaN.
 */
export function parsujCas(text: string): number | null {
  const t = text.replace(/\u00a0/g, " ").trim().toLowerCase();
  if (t === "" || t === "-" || t === "–") return null;
  const m = t.match(/^(?:(\d+(?:[.,]\d+)?)\s*[-–]\s*)?(\d+(?:[.,]\d+)?)\s*([a-zá-ž.]*)$/i);
  if (!m) return Number.NaN;
  const cislo = parseFloat(m[2].replace(",", "."));
  const jednotka = m[3].replace(/\./g, "");
  let nasobek: number;
  if (jednotka === "" || /^m/.test(jednotka)) nasobek = 1;
  else if (/^h/.test(jednotka)) nasobek = 60;
  else if (/^d/.test(jednotka)) nasobek = 24 * 60;
  else if (/^t/.test(jednotka)) nasobek = 7 * 24 * 60;
  else return Number.NaN;
  return Math.round(cislo * nasobek);
}

export type NovaZnacka = { docasneId: string; name: string };
export type NovaKategorie = { docasneId: string; brandId: string; name: string };
export type NovyModel = { docasneId: string; categoryId: string; name: string };
export type NovaOprava = { name: string; price: number; costs: number | null; estimatedTime: number; details: string; modelIds: string[] };
export type RozsireniOpravy = { id: string; name: string; modelIds: string[] };

export type PlanCeniku = {
  brands: NovaZnacka[];
  categories: NovaKategorie[];
  models: NovyModel[];
  repairs: NovaOprava[];
  /** Existující opravy, ke kterým přibyly modely (model_ids se přepíše celé). */
  rozsireni: RozsireniOpravy[];
  /** Opravy, které u modelu už byly (podle názvu) – nic se s nimi nedělá. */
  preskoceno: number;
  chyby: Array<{ radek: number; zprava: string }>;
};

/** Id nové položky je dočasné – po vložení do databáze se nahradí skutečným. */
const docasne = (typ: string, klic: string) => `novy:${typ}:${klic}`;

/**
 * Přeloží řádky CSV na plán změn katalogu. Řádek bez opravy jen zakládá
 * značku/kategorii/model; řádek s opravou musí mít model. Chyby nesou
 * číslo řádku v souboru (hlavička je řádek 1).
 */
export function pripravCenik(tabulka: CsvTabulka, mapovani: Array<PoleCeniku | null>, existujici: DevicesData): PlanCeniku {
  const idx = (pole: PoleCeniku) => mapovani.indexOf(pole);
  const plan: PlanCeniku = { brands: [], categories: [], models: [], repairs: [], rozsireni: [], preskoceno: 0, chyby: [] };

  // Rejstříky podle normalizovaného názvu – existující i nově plánované položky.
  const znacky = new Map<string, string>(existujici.brands.map((b) => [normalizujText(b.name), b.id]));
  const kategorie = new Map<string, string>(existujici.categories.map((c) => [`${c.brandId}|${normalizujText(c.name)}`, c.id]));
  const modely = new Map<string, string>(existujici.models.map((m) => [`${m.categoryId}|${normalizujText(m.name)}`, m.id]));
  /** Oprava podle názvu → modely, které ji už mají (existující i naplánované). */
  const opravyPodleNazvu = new Map<string, Set<string>>();
  for (const r of existujici.repairs) {
    const k = normalizujText(r.name);
    if (!opravyPodleNazvu.has(k)) opravyPodleNazvu.set(k, new Set());
    for (const m of r.modelIds) opravyPodleNazvu.get(k)!.add(m);
  }
  const klicOpravy = (name: string, price: number, costs: number | null, cas: number) => `${normalizujText(name)}|${price}|${costs ?? ""}|${cas}`;
  const existujiciPodleKlice = new Map<string, { id: string; name: string; modelIds: string[] }>();
  for (const r of existujici.repairs) existujiciPodleKlice.set(klicOpravy(r.name, r.price, r.costs ?? null, r.estimatedTime), { id: r.id, name: r.name, modelIds: [...r.modelIds] });
  const rozsireniPodleId = new Map<string, RozsireniOpravy>();
  const novePodleKlice = new Map<string, NovaOprava>();

  tabulka.radky.forEach((r, i) => {
    const radek = i + 2;
    const hodnota = (pole: PoleCeniku) => {
      const j = idx(pole);
      const v = j >= 0 ? (r[j] ?? "").trim() : "";
      return v === "-" ? "" : v;
    };
    const chyba = (zprava: string) => plan.chyby.push({ radek, zprava });

    const brandName = hodnota("brand");
    const modelName = hodnota("model");
    const repairName = hodnota("repair");
    if (!brandName && !modelName && !repairName) return;
    if (!brandName) return chyba("chybí značka");

    const bk = normalizujText(brandName);
    let brandId = znacky.get(bk);
    if (!brandId) {
      brandId = docasne("brand", bk);
      znacky.set(bk, brandId);
      plan.brands.push({ docasneId: brandId, name: brandName });
    }

    let modelId: string | null = null;
    if (modelName) {
      const categoryName = hodnota("category") || VYCHOZI_KATEGORIE;
      const ck = `${brandId}|${normalizujText(categoryName)}`;
      let categoryId = kategorie.get(ck);
      if (!categoryId) {
        categoryId = docasne("category", ck);
        kategorie.set(ck, categoryId);
        plan.categories.push({ docasneId: categoryId, brandId, name: categoryName });
      }
      const mk = `${categoryId}|${normalizujText(modelName)}`;
      modelId = modely.get(mk) ?? null;
      if (!modelId) {
        modelId = docasne("model", mk);
        modely.set(mk, modelId);
        plan.models.push({ docasneId: modelId, categoryId, name: modelName });
      }
    }

    if (!repairName) return;
    if (!modelId) return chyba(`oprava „${repairName}“ nemá model`);

    const price = parsujCastku(hodnota("price"));
    const costs = parsujCastku(hodnota("costs"));
    const cas = parsujCas(hodnota("time"));
    if (Number.isNaN(price)) return chyba(`nečitelná cena: ${hodnota("price")}`);
    if (Number.isNaN(costs)) return chyba(`nečitelné náklady: ${hodnota("costs")}`);
    if (Number.isNaN(cas)) return chyba(`nečitelný čas: ${hodnota("time")}`);

    const nk = normalizujText(repairName);
    const uModelu = opravyPodleNazvu.get(nk);
    if (uModelu?.has(modelId)) { plan.preskoceno += 1; return; }
    if (!uModelu) opravyPodleNazvu.set(nk, new Set([modelId]));
    else uModelu.add(modelId);

    const klic = klicOpravy(repairName, price ?? 0, costs, cas ?? 0);
    const stejna = existujiciPodleKlice.get(klic);
    if (stejna) {
      const roz = rozsireniPodleId.get(stejna.id) ?? { id: stejna.id, name: stejna.name, modelIds: stejna.modelIds };
      roz.modelIds = [...roz.modelIds, modelId];
      rozsireniPodleId.set(stejna.id, roz);
      return;
    }
    const nova = novePodleKlice.get(klic);
    if (nova) { nova.modelIds.push(modelId); return; }
    const n: NovaOprava = { name: repairName, price: price ?? 0, costs, estimatedTime: cas ?? 0, details: hodnota("details"), modelIds: [modelId] };
    novePodleKlice.set(klic, n);
    plan.repairs.push(n);
  });

  plan.rozsireni = [...rozsireniPodleId.values()];
  return plan;
}

type OdpovedRadku = PromiseLike<{ data: Array<Record<string, unknown>> | null; error: { message?: string } | null }>;
/** Kousek supabase klienta, který zápis potřebuje – v testech ho nahradí atrapa. */
export type KlientCeniku = {
  from: (tabulka: string) => {
    insert: (radky: unknown[]) => { select: (sloupce: string) => OdpovedRadku };
    update: (hodnoty: Record<string, unknown>) => { eq: (sloupec: string, hodnota: string) => PromiseLike<{ error: { message?: string } | null }> };
  };
};

export type VysledekCeniku = { znacek: number; kategorii: number; modelu: number; oprav: number; rozsireno: number; chyby: string[] };

/**
 * Zapíše plán do katalogu v pořadí značky → kategorie → modely → opravy,
 * protože každá další úroveň potřebuje skutečná id té předchozí. Chyba
 * v jedné úrovni zastaví další (bez id značky nejde založit kategorie).
 */
export async function zapisCenik(klient: KlientCeniku, serviceId: string, plan: PlanCeniku, onPostup?: (procent: number) => void): Promise<VysledekCeniku> {
  const v: VysledekCeniku = { znacek: 0, kategorii: 0, modelu: 0, oprav: 0, rozsireno: 0, chyby: [] };
  const skutecna = new Map<string, string>();
  const id = (x: string) => skutecna.get(x) ?? x;
  const kroky = 4;
  let krok = 0;
  const postup = () => { krok += 1; onPostup?.(Math.round((krok / kroky) * 100)); };

  if (plan.brands.length > 0) {
    const { data, error } = await klient.from("device_brands").insert(plan.brands.map((b) => ({ service_id: serviceId, name: b.name }))).select("id, name");
    if (error || !data) { v.chyby.push(`Značky: ${error?.message ?? "zápis selhal"}`); return v; }
    for (const b of plan.brands) {
      const radek = data.find((d) => normalizujText(String(d.name)) === normalizujText(b.name));
      if (radek) skutecna.set(b.docasneId, String(radek.id));
    }
    v.znacek = data.length;
  }
  postup();

  if (plan.categories.length > 0) {
    const { data, error } = await klient.from("device_categories").insert(plan.categories.map((c) => ({ service_id: serviceId, brand_id: id(c.brandId), name: c.name }))).select("id, brand_id, name");
    if (error || !data) { v.chyby.push(`Kategorie: ${error?.message ?? "zápis selhal"}`); return v; }
    for (const c of plan.categories) {
      const radek = data.find((d) => String(d.brand_id) === id(c.brandId) && normalizujText(String(d.name)) === normalizujText(c.name));
      if (radek) skutecna.set(c.docasneId, String(radek.id));
    }
    v.kategorii = data.length;
  }
  postup();

  if (plan.models.length > 0) {
    const { data, error } = await klient.from("device_models").insert(plan.models.map((m) => ({ service_id: serviceId, category_id: id(m.categoryId), name: m.name }))).select("id, category_id, name");
    if (error || !data) { v.chyby.push(`Modely: ${error?.message ?? "zápis selhal"}`); return v; }
    for (const m of plan.models) {
      const radek = data.find((d) => String(d.category_id) === id(m.categoryId) && normalizujText(String(d.name)) === normalizujText(m.name));
      if (radek) skutecna.set(m.docasneId, String(radek.id));
    }
    v.modelu = data.length;
  }
  postup();

  if (plan.repairs.length > 0) {
    const radky = plan.repairs.map((r) => ({
      service_id: serviceId,
      name: r.name,
      price: r.price,
      costs: r.costs,
      estimated_time: r.estimatedTime,
      details: r.details,
      model_ids: r.modelIds.map(id),
    }));
    const { data, error } = await klient.from("repairs").insert(radky).select("id");
    if (error || !data) v.chyby.push(`Opravy: ${error?.message ?? "zápis selhal"}`);
    else v.oprav = data.length;
  }
  for (const roz of plan.rozsireni) {
    const { error } = await klient.from("repairs").update({ model_ids: roz.modelIds.map(id) }).eq("id", roz.id);
    if (error) v.chyby.push(`Oprava „${roz.name}“: ${error.message ?? "rozšíření o modely selhalo"}`);
    else v.rozsireno += 1;
  }
  postup();
  return v;
}
