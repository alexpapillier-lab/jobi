/**
 * Ověření a očištění těla zápisu přes veřejné API.
 *
 * Klíčové pravidlo: do databáze jde JEN to, co je tady vyjmenované.
 * Kdyby se přeposílal celý objekt od klienta, dal by se přes API přepsat
 * service_id – tedy obejít vlastnictví. Vazby (category_id, model_ids…)
 * tady projdou jen tvarem; že patří servisu, ověřuje až edge funkce.
 *
 * Od 6. 9. jde přes API i zakládat, přejmenovávat a mazat produkty a opravy
 * a spravovat značky, kategorie a modely – kdo si dělá vlastní rozhraní na
 * sklad nebo ceník, nesmí být odkázaný na aplikaci.
 *
 * Bez Deno API, aby to šlo testovat z vitest – viz src/lib/zapis.test.ts.
 */
export type Akce = "create" | "delete";

export type Zmena = {
  id?: string;
  sku?: string;
  hodnoty: Record<string, unknown>;
  /** Bez hodnoty = úprava existujícího záznamu. */
  akce?: Akce;
  /**
   * Do kterého skladu má jít `stock` – id nebo název. Když chybí, použije se
   * výchozí sklad servisu. Existující integrace o skladech nevědí, a proto
   * musí dál fungovat beze změny těla.
   */
  sklad?: string;
};
export type Vysledek = { zmeny: Zmena[]; chyby: string[] };

/** Kladné konečné číslo, zaokrouhlené. `null`, když hodnota nedává smysl. */
function cislo(x: unknown, celociselne: boolean): number | null {
  if (typeof x === "boolean" || x === null || x === undefined || x === "") return null;
  const n = Number(x);
  if (!Number.isFinite(n) || n < 0) return null;
  return celociselne ? Math.trunc(n) : Math.round(n * 100) / 100;
}

const JE_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const jeUuid = (x: unknown): x is string => typeof x === "string" && JE_UUID.test(x);

/** Nejvýš 200 položek na požadavek – ať jeden dotaz neběží minutu. */
const MAX_POLOZEK = 200;

type Pole = {
  klic: string;
  typ: "text" | "cislo" | "cele" | "bool" | "uuid" | "uuid_nullable" | "uuid_pole";
  max?: number;
};

/** Přečte a očistí pole podle popisu; chyby píše česky s indexem položky. */
function precti(r: Record<string, unknown>, pole: Pole[], prefix: string, chyby: string[]): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const p of pole) {
    if (!(p.klic in r)) continue;
    const v = r[p.klic];
    switch (p.typ) {
      case "text": {
        if (typeof v !== "string") { chyby.push(`${prefix}: ${p.klic} musí být text`); break; }
        const t = v.trim();
        if (p.max && t.length > p.max) { chyby.push(`${prefix}: ${p.klic} je delší než ${p.max} znaků`); break; }
        out[p.klic] = t;
        break;
      }
      case "cislo":
      case "cele": {
        const n = cislo(v, p.typ === "cele");
        if (n === null) chyby.push(`${prefix}: ${p.klic} musí být nezáporné ${p.typ === "cele" ? "celé " : ""}číslo`);
        else out[p.klic] = n;
        break;
      }
      case "bool":
        if (typeof v !== "boolean") chyby.push(`${prefix}: ${p.klic} musí být true/false`);
        else out[p.klic] = v;
        break;
      case "uuid":
        if (!jeUuid(v)) chyby.push(`${prefix}: ${p.klic} musí být id`);
        else out[p.klic] = v;
        break;
      case "uuid_nullable":
        if (v === null) out[p.klic] = null;
        else if (!jeUuid(v)) chyby.push(`${prefix}: ${p.klic} musí být id nebo null`);
        else out[p.klic] = v;
        break;
      case "uuid_pole":
        if (!Array.isArray(v) || !v.every(jeUuid)) chyby.push(`${prefix}: ${p.klic} musí být pole id`);
        else out[p.klic] = [...new Set(v as string[])];
        break;
    }
  }
  return out;
}

const POLE_PRODUKTU: Pole[] = [
  { klic: "stock", typ: "cele" },
  { klic: "price", typ: "cislo" },
  { klic: "purchase_price", typ: "cislo" },
  { klic: "min_stock", typ: "cele" },
  { klic: "name", typ: "text", max: 200 },
  { klic: "description", typ: "text", max: 2000 },
  { klic: "supplier_sku", typ: "text", max: 80 },
  { klic: "category_id", typ: "uuid_nullable" },
  { klic: "model_ids", typ: "uuid_pole" },
  { klic: "public_visible", typ: "bool" },
];

export function zmenyProduktu(vstup: unknown[]): Vysledek {
  const zmeny: Zmena[] = [];
  const chyby: string[] = [];
  if (vstup.length > MAX_POLOZEK) {
    return { zmeny: [], chyby: [`Najednou jde poslat nejvýš ${MAX_POLOZEK} produktů`] };
  }
  vstup.forEach((r: any, i) => {
    const prefix = `products[${i}]`;
    if (!r || typeof r !== "object") { chyby.push(`${prefix}: musí být objekt`); return; }
    const id = jeUuid(r.id) ? r.id : undefined;
    const sku = typeof r?.sku === "string" && r.sku.trim() ? r.sku.trim() : undefined;
    const akce: Akce | undefined = r.delete === true ? "delete" : r.create === true ? "create" : undefined;

    if (akce === "delete") {
      if (!id) { chyby.push(`${prefix}: mazat jde jen podle id`); return; }
      zmeny.push({ id, hodnoty: {}, akce });
      return;
    }
    if (!id && !sku && akce !== "create") {
      chyby.push(`${prefix}: chybí id nebo sku`);
      return;
    }
    const hodnoty = precti(r, POLE_PRODUKTU, prefix, chyby);
    // SKU jde přejmenovat jen u položky adresované id – jinak by se neposkládalo, co je adresa a co nová hodnota.
    if (akce === "create" && sku) hodnoty.sku = sku;
    if (akce === "create" && !hodnoty.name) { chyby.push(`${prefix}: nový produkt potřebuje name`); return; }
    const sklad = typeof r?.warehouse === "string" && r.warehouse.trim() ? r.warehouse.trim() : undefined;
    if (sklad && !("stock" in r)) {
      chyby.push(`${prefix}: warehouse dává smysl jen se stock`);
      return;
    }
    if (Object.keys(hodnoty).length === 0) {
      chyby.push(`${prefix}: není co měnit (povolené: ${POLE_PRODUKTU.map((p) => p.klic).join(", ")})`);
      return;
    }
    zmeny.push(akce ? { id, sku: akce === "create" ? undefined : sku, hodnoty, akce, sklad } : { id, sku, hodnoty, sklad });
  });
  return { zmeny, chyby };
}

const POLE_OPRAVY: Pole[] = [
  { klic: "price", typ: "cislo" },
  { klic: "estimated_time", typ: "cele" },
  { klic: "costs", typ: "cislo" },
  { klic: "name", typ: "text", max: 200 },
  { klic: "details", typ: "text", max: 2000 },
  { klic: "model_ids", typ: "uuid_pole" },
  { klic: "product_ids", typ: "uuid_pole" },
  { klic: "public_visible", typ: "bool" },
];

export function zmenyOprav(vstup: unknown[]): Vysledek {
  const zmeny: Zmena[] = [];
  const chyby: string[] = [];
  if (vstup.length > MAX_POLOZEK) {
    return { zmeny: [], chyby: [`Najednou jde poslat nejvýš ${MAX_POLOZEK} oprav`] };
  }
  vstup.forEach((r: any, i) => {
    const prefix = `repairs[${i}]`;
    if (!r || typeof r !== "object") { chyby.push(`${prefix}: musí být objekt`); return; }
    // U oprav se schválně nedá adresovat názvem – ten není jedinečný,
    // „Výměna displeje“ má servis u každého modelu jinou.
    const id = jeUuid(r.id) ? r.id : undefined;
    const akce: Akce | undefined = r.delete === true ? "delete" : r.create === true || (!id && typeof r.name === "string") ? "create" : undefined;
    if (akce === "delete") {
      if (!id) { chyby.push(`${prefix}: mazat jde jen podle id`); return; }
      zmeny.push({ id, hodnoty: {}, akce });
      return;
    }
    if (!id && akce !== "create") {
      chyby.push(`${prefix}: chybí platné id`);
      return;
    }
    const hodnoty = precti(r, POLE_OPRAVY, prefix, chyby);
    if (akce === "create") {
      if (!hodnoty.name) { chyby.push(`${prefix}: nová oprava potřebuje name`); return; }
      if (!Array.isArray(hodnoty.model_ids) || (hodnoty.model_ids as string[]).length === 0) { chyby.push(`${prefix}: nová oprava potřebuje model_ids (aspoň jeden model z ceníku)`); return; }
    }
    if (Object.keys(hodnoty).length === 0) {
      chyby.push(`${prefix}: není co měnit (povolené: ${POLE_OPRAVY.map((p) => p.klic).join(", ")})`);
      return;
    }
    zmeny.push(akce ? { id, hodnoty, akce } : { id, hodnoty });
  });
  return { zmeny, chyby };
}

export type DruhKatalogu = "brands" | "categories" | "models";
const POLE_KATALOGU: Record<DruhKatalogu, Pole[]> = {
  brands: [{ klic: "name", typ: "text", max: 120 }, { klic: "public_visible", typ: "bool" }],
  categories: [{ klic: "name", typ: "text", max: 120 }, { klic: "brand_id", typ: "uuid" }, { klic: "public_visible", typ: "bool" }],
  models: [{ klic: "name", typ: "text", max: 160 }, { klic: "category_id", typ: "uuid" }, { klic: "public_visible", typ: "bool" }],
};
const NADRAZENE: Record<DruhKatalogu, string | null> = { brands: null, categories: "brand_id", models: "category_id" };

/** Značky, kategorie a modely: založit nebo upravit. Mazání jen v aplikaci (kaskáda přes celý katalog). */
export function zmenyKatalogu(vstup: unknown[], druh: DruhKatalogu): Vysledek {
  const zmeny: Zmena[] = [];
  const chyby: string[] = [];
  if (vstup.length > MAX_POLOZEK) {
    return { zmeny: [], chyby: [`Najednou jde poslat nejvýš ${MAX_POLOZEK} položek (${druh})`] };
  }
  vstup.forEach((r: any, i) => {
    const prefix = `${druh}[${i}]`;
    if (!r || typeof r !== "object") { chyby.push(`${prefix}: musí být objekt`); return; }
    if (r.delete === true) { chyby.push(`${prefix}: mazání značek, kategorií a modelů jde jen v aplikaci`); return; }
    const id = jeUuid(r.id) ? r.id : undefined;
    const hodnoty = precti(r, POLE_KATALOGU[druh], prefix, chyby);
    if (!id) {
      if (!hodnoty.name) { chyby.push(`${prefix}: nová položka potřebuje name`); return; }
      const rodic = NADRAZENE[druh];
      if (rodic && !hodnoty[rodic]) { chyby.push(`${prefix}: nová položka potřebuje ${rodic}`); return; }
      zmeny.push({ hodnoty, akce: "create" });
      return;
    }
    if (Object.keys(hodnoty).length === 0) { chyby.push(`${prefix}: není co měnit`); return; }
    zmeny.push({ id, hodnoty });
  });
  return { zmeny, chyby };
}

/** Otisk těla, aby stejný Idempotency-Key s jiným obsahem nešel zaměnit. */
export async function otiskTela(telo: unknown): Promise<string> {
  const bytes = new TextEncoder().encode(JSON.stringify(telo));
  const hash = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(hash)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
