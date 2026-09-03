/**
 * Inventory DB – načítání a ukládání kategorií produktů a produktů do Supabase.
 */

import { getSupabaseClient } from "./supabaseClient";

export type ProductCategory = {
  id: string;
  name: string;
  modelIds: string[];
  createdAt: string;
  /** Posílat do veřejného API? Výchozí true; skrytí je výjimka. */
  publicVisible?: boolean;
};

export type Warehouse = {
  id: string;
  name: string;
  /** Kam míří automatický odpis a zápis přes API, když se neřekne jinak. */
  isDefault: boolean;
  /** Počítat do dostupnosti ve veřejném ceníku a API? */
  publicVisible: boolean;
  createdAt: string;
};

export type Product = {
  id: string;
  name: string;
  modelIds: string[];
  categoryId?: string;
  /**
   * Součet přes všechny sklady. Odvozený – v databázi ho drží trigger,
   * tady se dopočítává ze `stockByWarehouse`, ať je UI okamžité.
   * Zapisovat se do něj nedá, měň `stockByWarehouse`.
   */
  stock: number;
  /** Kolik kusů leží ve kterém skladu. Klíč je id skladu. */
  stockByWarehouse: Record<string, number>;
  price: number;
  /** Nákupní cena. Nepovinná – do veřejného API jde jen když si to servis zapne. */
  purchasePrice?: number | null;
  sku?: string;
  description?: string;
  imageUrl?: string;
  repairIds?: string[];
  createdAt: string;
  /** Posílat do veřejného API? Výchozí true; skrytí je výjimka. */
  publicVisible?: boolean;
};

export type InventoryData = {
  productCategories: ProductCategory[];
  products: Product[];
  /** Servis má vždy aspoň jeden sklad – hlídá to databáze. */
  warehouses: Warehouse[];
};

/**
 * Převod staršího tvaru (jedno číslo `stock`) na stavy po skladech.
 *
 * Používá se na hranici, kde do aplikace vstupují data z localStorage nebo
 * z klienta, který o skladech ještě neví. Bez znalosti skladu se množství
 * zahodit nesmí, proto padá do výchozího skladu.
 */
export function stavyZeStarehoTvaru(
  p: { stock?: number; stockByWarehouse?: Record<string, number> },
  vychoziSkladId: string | null,
): Record<string, number> {
  if (p.stockByWarehouse && Object.keys(p.stockByWarehouse).length > 0) return p.stockByWarehouse;
  const ks = Math.max(0, Math.round(p.stock ?? 0));
  if (ks === 0 || !vychoziSkladId) return {};
  return { [vychoziSkladId]: ks };
}

/** Id výchozího skladu, jinak prvního v pořadí. `null`, když servis nemá žádný. */
export function vychoziSklad(warehouses: Warehouse[]): string | null {
  return warehouses.find((w) => w.isDefault)?.id ?? warehouses[0]?.id ?? null;
}

/** Součet přes sklady. Jediné místo, kde se `stock` počítá. */
export function celkemKusu(stockByWarehouse: Record<string, number>): number {
  return Object.values(stockByWarehouse).reduce((a, b) => a + (b || 0), 0);
}

function mapWarehouseRow(r: {
  id: string;
  name: string;
  is_default: boolean;
  public_visible: boolean;
  created_at: string;
}): Warehouse {
  return {
    id: r.id,
    name: r.name,
    isDefault: r.is_default === true,
    publicVisible: r.public_visible !== false,
    createdAt: r.created_at,
  };
}

function mapProductCategoryRow(r: {
  id: string;
  name: string;
  model_ids: unknown;
  created_at: string;
  public_visible?: boolean;
}): ProductCategory {
  const modelIds = Array.isArray(r.model_ids) ? (r.model_ids as string[]) : [];
  return {
    id: r.id,
    name: r.name,
    modelIds,
    createdAt: r.created_at,
    publicVisible: r.public_visible !== false,
  };
}

function mapProductRow(r: {
  id: string;
  name: string;
  stock: number;
  price: number;
  purchase_price?: number | string | null;
  sku: string | null;
  description: string | null;
  image_url: string | null;
  category_id: string | null;
  model_ids: unknown;
  repair_ids: unknown;
  created_at: string;
  public_visible?: boolean;
}, stavy: Record<string, number>): Product {
  const modelIds = Array.isArray(r.model_ids) ? (r.model_ids as string[]) : [];
  const repairIds = Array.isArray(r.repair_ids) ? (r.repair_ids as string[]) : undefined;
  return {
    id: r.id,
    name: r.name,
    modelIds,
    categoryId: r.category_id ?? undefined,
    stock: celkemKusu(stavy),
    stockByWarehouse: stavy,
    price: Number(r.price),
    purchasePrice: r.purchase_price === null || r.purchase_price === undefined ? null : Number(r.purchase_price),
    sku: r.sku ?? undefined,
    description: r.description ?? undefined,
    imageUrl: r.image_url ?? undefined,
    repairIds: repairIds && repairIds.length > 0 ? repairIds : undefined,
    createdAt: r.created_at,
    publicVisible: r.public_visible !== false,
  };
}

export type LoadInventoryResult = { data: InventoryData; error?: string };

/** Načte data skladu z databáze pro daný servis. Při chybě vrací { data: prázdné, error } – nekračuj stav prázdnými daty. */
export async function loadInventoryFromDb(serviceId: string | null): Promise<LoadInventoryResult> {
  const supabase = getSupabaseClient();
  if (!supabase || !serviceId) {
    return { data: { productCategories: [], products: [], warehouses: [] } };
  }

  const categoriesRes = await (supabase.from("inventory_product_categories") as any).select("id, name, model_ids, created_at, public_visible").eq("service_id", serviceId).order("order_index").order("created_at");
  const productsRes = await (supabase.from("inventory_products") as any).select("id, name, price, purchase_price, sku, description, image_url, category_id, model_ids, repair_ids, created_at, public_visible").eq("service_id", serviceId).order("order_index").order("created_at");
  const warehousesRes = await (supabase.from("inventory_warehouses") as any).select("id, name, is_default, public_visible, created_at").eq("service_id", serviceId).order("order_index").order("created_at");
  const stockRes = await (supabase.from("inventory_stock") as any).select("product_id, warehouse_id, quantity").eq("service_id", serviceId);

  if (categoriesRes.error || productsRes.error || warehousesRes.error || stockRes.error) {
    const err = categoriesRes.error || productsRes.error || warehousesRes.error || stockRes.error;
    if (typeof console !== "undefined" && console.warn) {
      console.warn("[inventoryDb] Load failed (síť/DB):", err?.message ?? err);
    }
    return { data: { productCategories: [], products: [], warehouses: [] }, error: (err as { message?: string })?.message ?? "Load failed" };
  }

  // Stavy nejdřív seskupit podle produktu, ať se nad každým produktem
  // neprochází celé pole.
  const stavyPodleProduktu = new Map<string, Record<string, number>>();
  for (const r of (stockRes.data ?? []) as { product_id: string; warehouse_id: string; quantity: number }[]) {
    const m = stavyPodleProduktu.get(r.product_id) ?? {};
    m[r.warehouse_id] = Number(r.quantity);
    stavyPodleProduktu.set(r.product_id, m);
  }

  return {
    data: {
      productCategories: (categoriesRes.data ?? []).map(mapProductCategoryRow),
      products: (productsRes.data ?? []).map((r: { id: string }) =>
        mapProductRow(r as never, stavyPodleProduktu.get(r.id) ?? {})
      ),
      warehouses: (warehousesRes.data ?? []).map(mapWarehouseRow),
    },
  };
}

/** Co se z produktu a kategorie posílá do databáze. Exportované kvůli testům. */
export function radekKategorie(c: ProductCategory, serviceId: string, i: number) {
  return {
    id: c.id,
    service_id: serviceId,
    name: c.name,
    model_ids: c.modelIds ?? [],
    public_visible: c.publicVisible !== false,
    order_index: i,
    created_at: c.createdAt,
  };
}

export function radekProduktu(p: Product, serviceId: string, i: number) {
  return {
    id: p.id,
    service_id: serviceId,
    name: p.name,
    // `stock` se schválně neposílá: v databázi je odvozený z inventory_stock
    // a trigger by zápis stejně přepsal. Množství jde přes `radekStavu`.
    price: p.price,
    purchase_price: p.purchasePrice ?? null,
    sku: p.sku ?? null,
    description: p.description ?? null,
    image_url: p.imageUrl ?? null,
    category_id: p.categoryId ?? null,
    model_ids: p.modelIds ?? [],
    repair_ids: p.repairIds ?? [],
    public_visible: p.publicVisible !== false,
    order_index: i,
    created_at: p.createdAt,
  };
}

export function radekSkladu(w: Warehouse, serviceId: string, i: number) {
  return {
    id: w.id,
    service_id: serviceId,
    name: w.name,
    is_default: w.isDefault === true,
    public_visible: w.publicVisible !== false,
    order_index: i,
    created_at: w.createdAt,
  };
}

export function radekStavu(productId: string, warehouseId: string, serviceId: string, quantity: number) {
  return {
    product_id: productId,
    warehouse_id: warehouseId,
    service_id: serviceId,
    quantity: Math.max(0, Math.round(quantity)),
  };
}

/** Všechny nenulové stavy napříč produkty, jako ploché řádky. */
function stavyProduktu(data: InventoryData, serviceId: string) {
  const out: ReturnType<typeof radekStavu>[] = [];
  for (const p of data.products) {
    for (const [warehouseId, qty] of Object.entries(p.stockByWarehouse ?? {})) {
      if (qty > 0) out.push(radekStavu(p.id, warehouseId, serviceId, qty));
    }
  }
  return out;
}

/**
 * Co se má poslat do databáze, když známe stav, který tenhle klient
 * naposledy viděl. Bez Deno/Supabase API, aby to šlo testovat.
 */
export function rozdilSkladu(data: InventoryData, predchozi: InventoryData, serviceId: string) {
  const otisk = (x: unknown) => JSON.stringify(x);
  const categoryIds = new Set(data.productCategories.map((c) => c.id));
  const productIds = new Set(data.products.map((p) => p.id));

  const warehouseIds = new Set(data.warehouses.map((w) => w.id));

  const drivKategorie = new Map(predchozi.productCategories.map((c, i) => [c.id, otisk(radekKategorie(c, serviceId, i))]));
  const drivProdukty = new Map(predchozi.products.map((p, i) => [p.id, otisk(radekProduktu(p, serviceId, i))]));
  const drivSklady = new Map(predchozi.warehouses.map((w, i) => [w.id, otisk(radekSkladu(w, serviceId, i))]));

  // Stavy se porovnávají po dvojici produkt+sklad. Nula se neukládá jako řádek,
  // takže „poslední kus odepsán“ znamená smazat řádek, ne uložit 0.
  const klic = (r: { product_id: string; warehouse_id: string }) => `${r.product_id}|${r.warehouse_id}`;
  const noveStavy = stavyProduktu(data, serviceId);
  const drivStavy = new Map(stavyProduktu(predchozi, serviceId).map((r) => [klic(r), otisk(r)]));
  const noveKlice = new Set(noveStavy.map(klic));

  return {
    kategorieKeZmene: data.productCategories
      .map((c, i) => radekKategorie(c, serviceId, i))
      .filter((r) => drivKategorie.get(r.id) !== otisk(r)),
    produktyKeZmene: data.products
      .map((p, i) => radekProduktu(p, serviceId, i))
      .filter((r) => drivProdukty.get(r.id) !== otisk(r)),
    // Mažeme jen to, co tenhle klient sám odebral – ne všechno, co zrovna
    // nemá v paměti.
    kategorieKeSmazani: predchozi.productCategories.map((c) => c.id).filter((id) => !categoryIds.has(id)),
    produktyKeSmazani: predchozi.products.map((p) => p.id).filter((id) => !productIds.has(id)),
    skladyKeZmene: data.warehouses
      .map((w, i) => radekSkladu(w, serviceId, i))
      .filter((r) => drivSklady.get(r.id) !== otisk(r)),
    skladyKeSmazani: predchozi.warehouses.map((w) => w.id).filter((id) => !warehouseIds.has(id)),
    stavyKeZmene: noveStavy.filter((r) => drivStavy.get(klic(r)) !== otisk(r)),
    stavyKeSmazani: [...drivStavy.keys()]
      .filter((k) => !noveKlice.has(k))
      .map((k) => {
        const [product_id, warehouse_id] = k.split("|");
        return { product_id, warehouse_id };
      })
      // Řádky smazaných produktů a skladů zmizí kaskádou samy.
      .filter((r) => productIds.has(r.product_id) && warehouseIds.has(r.warehouse_id)),
  };
}

/**
 * Uloží data skladu do databáze.
 *
 * `predchozi` je stav, který tenhle klient naposledy úspěšně uložil nebo
 * načetl. Když ho dostane, zapisuje se jen rozdíl – řádky, které se od té
 * doby změnily nebo přibyly, a mažou se jen ty, které tenhle klient sám
 * odebral.
 *
 * Bez toho posílal každý klient celý sklad. Kdo měl data načtená před
 * cizí úpravou, přepsal ji svou starší kopií – u obrázků doslova na
 * `image_url: null`, protože se posílají všechny sloupce všech řádků.
 * A mazání „co není v mých datech“ odstranilo i produkty, které mezitím
 * přidal někdo jiný.
 */
async function ulozitStavy(
  supabase: any,
  keZmene: { product_id: string; warehouse_id: string; service_id: string; quantity: number }[],
  keSmazani: { product_id: string; warehouse_id: string }[],
): Promise<string | undefined> {
  if (keZmene.length > 0) {
    const { error } = await supabase
      .from("inventory_stock")
      .upsert(keZmene, { onConflict: "product_id,warehouse_id" });
    if (error) return error.message;
  }
  // Nulové stavy se neukládají – řádek se maže. Po jednom, protože složený
  // klíč nejde vyjádřit jedním `in()`.
  for (const r of keSmazani) {
    const { error } = await supabase
      .from("inventory_stock")
      .delete()
      .eq("product_id", r.product_id)
      .eq("warehouse_id", r.warehouse_id);
    if (error) return error.message;
  }
  return undefined;
}

export async function saveInventoryToDb(
  serviceId: string | null,
  data: InventoryData,
  predchozi?: InventoryData,
): Promise<{ error?: string }> {
  const supabase = getSupabaseClient();
  if (!supabase || !serviceId) {
    return { error: "No Supabase or serviceId" };
  }

  const categoryIds = new Set(data.productCategories.map((c) => c.id));
  const productIds = new Set(data.products.map((p) => p.id));

  if (predchozi) {
    const {
      kategorieKeZmene, produktyKeZmene, kategorieKeSmazani, produktyKeSmazani,
      skladyKeZmene, skladyKeSmazani, stavyKeZmene, stavyKeSmazani,
    } = rozdilSkladu(data, predchozi, serviceId);

    if (produktyKeSmazani.length > 0) {
      await (supabase.from("inventory_products") as any).delete().in("id", produktyKeSmazani);
    }
    if (kategorieKeSmazani.length > 0) {
      await (supabase.from("inventory_product_categories") as any).delete().in("id", kategorieKeSmazani);
    }
    // Sklady musí být v databázi dřív než stavy, které na ně ukazují.
    if (skladyKeZmene.length > 0) {
      const { error } = await (supabase.from("inventory_warehouses") as any).upsert(skladyKeZmene, { onConflict: "id" });
      if (error) return { error: error.message };
    }
    if (kategorieKeZmene.length > 0) {
      const { error } = await (supabase.from("inventory_product_categories") as any).upsert(kategorieKeZmene, { onConflict: "id" });
      if (error) return { error: error.message };
    }
    if (produktyKeZmene.length > 0) {
      const { error } = await (supabase.from("inventory_products") as any).upsert(produktyKeZmene, { onConflict: "id" });
      if (error) return { error: error.message };
    }
    const chyba = await ulozitStavy(supabase, stavyKeZmene, stavyKeSmazani);
    if (chyba) return { error: chyba };
    // Sklad se maže až nakonec – databáze nepustí smazat poslední.
    if (skladyKeSmazani.length > 0) {
      const { error } = await (supabase.from("inventory_warehouses") as any).delete().in("id", skladyKeSmazani);
      if (error) return { error: error.message };
    }
    return {};
  }

  // Bez známého předchozího stavu (první uložení po sloučení s localStorage)
  // se zapisuje všechno, jako dřív.

  // Sklady napřed – stavy i produkty se o ně opírají.
  if (data.warehouses.length > 0) {
    const { error } = await (supabase.from("inventory_warehouses") as any)
      .upsert(data.warehouses.map((w, i) => radekSkladu(w, serviceId, i)), { onConflict: "id" });
    if (error) {
      if (typeof console !== "undefined" && console.warn) console.warn("[inventoryDb] Upsert warehouses:", error.message);
      return { error: error.message };
    }
  }

  // Smazat odstraněné produkty (jedno volání místo N)
  const { data: existingProducts } = await (supabase.from("inventory_products") as any).select("id").eq("service_id", serviceId);
  const toDeleteProductIds = (existingProducts ?? []).map((p: { id: string }) => p.id).filter((id: string) => !productIds.has(id));
  if (toDeleteProductIds.length > 0) {
    await (supabase.from("inventory_products") as any).delete().in("id", toDeleteProductIds);
  }

  // Smazat odstraněné kategorie (jedno volání místo N)
  const { data: existingCategories } = await (supabase.from("inventory_product_categories") as any).select("id").eq("service_id", serviceId);
  const toDeleteCategoryIds = (existingCategories ?? []).map((c: { id: string }) => c.id).filter((id: string) => !categoryIds.has(id));
  if (toDeleteCategoryIds.length > 0) {
    await (supabase.from("inventory_product_categories") as any).delete().in("id", toDeleteCategoryIds);
  }

  // Upsert categories
  if (data.productCategories.length > 0) {
    const rows = data.productCategories.map((c, i) => ({
      id: c.id,
      service_id: serviceId,
      name: c.name,
      model_ids: c.modelIds ?? [],
      public_visible: c.publicVisible !== false,
      order_index: i,
      created_at: c.createdAt,
    }));
    const { error } = await (supabase.from("inventory_product_categories") as any).upsert(rows, { onConflict: "id" });
    if (error) {
      if (typeof console !== "undefined" && console.warn) console.warn("[inventoryDb] Upsert categories:", error.message);
      return { error: error.message };
    }
  }

  // Upsert products
  if (data.products.length > 0) {
    const rows = data.products.map((p, i) => ({
      id: p.id,
      service_id: serviceId,
      name: p.name,
      price: p.price,
      purchase_price: p.purchasePrice ?? null,
      sku: p.sku ?? null,
      description: p.description ?? null,
      image_url: p.imageUrl ?? null,
      category_id: p.categoryId ?? null,
      model_ids: p.modelIds ?? [],
      repair_ids: p.repairIds ?? [],
      public_visible: p.publicVisible !== false,
      order_index: i,
      created_at: p.createdAt,
    }));
    const { error } = await (supabase.from("inventory_products") as any).upsert(rows, { onConflict: "id" });
    if (error) {
      if (typeof console !== "undefined" && console.warn) console.warn("[inventoryDb] Upsert products:", error.message);
      return { error: error.message };
    }
  }

  // Stavy po skladech. Nulový stav nesmí v databázi zůstat, jinak by odepsaný
  // kus po přenačtení „obživl“.
  const stavy = stavyProduktu(data, serviceId);
  const chybaStavu = await ulozitStavy(supabase, stavy, []);
  if (chybaStavu) return { error: chybaStavu };
  const drzeneKlice = new Set(stavy.map((r) => `${r.product_id}|${r.warehouse_id}`));
  const { data: existujiciStavy } = await (supabase.from("inventory_stock") as any)
    .select("product_id, warehouse_id").eq("service_id", serviceId);
  /* Mazat jen u produktů a skladů, které tenhle klient opravdu drží. Kdyby se
     maglo „všechno, co nemám v datech“, přišel by o zásobu produkt, který mezitím
     přidal někdo jiný – přesně tak dnes zmizel celý sklad. */
  const znameProdukty = new Set(data.products.map((p) => p.id));
  const znameSklady = new Set(data.warehouses.map((w) => w.id));
  const kSmazani = ((existujiciStavy ?? []) as { product_id: string; warehouse_id: string }[])
    .filter((r) => znameProdukty.has(r.product_id) && znameSklady.has(r.warehouse_id))
    .filter((r) => !drzeneKlice.has(`${r.product_id}|${r.warehouse_id}`));
  const chybaMazani = await ulozitStavy(supabase, [], kSmazani);
  if (chybaMazani) return { error: chybaMazani };

  return {};
}
