/**
 * Inventory DB – načítání a ukládání kategorií produktů a produktů do Supabase.
 */

import { getSupabaseClient } from "./supabaseClient";

export type ProductCategory = {
  id: string;
  name: string;
  modelIds: string[];
  createdAt: string;
};

export type Product = {
  id: string;
  name: string;
  modelIds: string[];
  categoryId?: string;
  stock: number;
  price: number;
  sku?: string;
  description?: string;
  imageUrl?: string;
  repairIds?: string[];
  createdAt: string;
};

export type InventoryData = {
  productCategories: ProductCategory[];
  products: Product[];
};

function mapProductCategoryRow(r: {
  id: string;
  name: string;
  model_ids: unknown;
  created_at: string;
}): ProductCategory {
  const modelIds = Array.isArray(r.model_ids) ? (r.model_ids as string[]) : [];
  return { id: r.id, name: r.name, modelIds, createdAt: r.created_at };
}

function mapProductRow(r: {
  id: string;
  name: string;
  stock: number;
  price: number;
  sku: string | null;
  description: string | null;
  image_url: string | null;
  category_id: string | null;
  model_ids: unknown;
  repair_ids: unknown;
  created_at: string;
}): Product {
  const modelIds = Array.isArray(r.model_ids) ? (r.model_ids as string[]) : [];
  const repairIds = Array.isArray(r.repair_ids) ? (r.repair_ids as string[]) : undefined;
  return {
    id: r.id,
    name: r.name,
    modelIds,
    categoryId: r.category_id ?? undefined,
    stock: Number(r.stock),
    price: Number(r.price),
    sku: r.sku ?? undefined,
    description: r.description ?? undefined,
    imageUrl: r.image_url ?? undefined,
    repairIds: repairIds && repairIds.length > 0 ? repairIds : undefined,
    createdAt: r.created_at,
  };
}

/** Načte data skladu z databáze pro daný servis. */
export async function loadInventoryFromDb(serviceId: string | null): Promise<InventoryData> {
  const supabase = getSupabaseClient();
  if (!supabase || !serviceId) {
    return { productCategories: [], products: [] };
  }

  const [categoriesRes, productsRes] = await Promise.all([
    (supabase.from("inventory_product_categories") as any).select("id, name, model_ids, created_at").eq("service_id", serviceId).order("order_index").order("created_at"),
    (supabase.from("inventory_products") as any).select("id, name, stock, price, sku, description, image_url, category_id, model_ids, repair_ids, created_at").eq("service_id", serviceId).order("order_index").order("created_at"),
  ]);

  if (categoriesRes.error || productsRes.error) {
    console.error("[inventoryDb] Load error:", categoriesRes.error || productsRes.error);
    return { productCategories: [], products: [] };
  }

  return {
    productCategories: (categoriesRes.data ?? []).map(mapProductCategoryRow),
    products: (productsRes.data ?? []).map(mapProductRow),
  };
}

/** Uloží data skladu do databáze. */
export async function saveInventoryToDb(serviceId: string | null, data: InventoryData): Promise<{ error?: string }> {
  const supabase = getSupabaseClient();
  if (!supabase || !serviceId) {
    return { error: "No Supabase or serviceId" };
  }

  const categoryIds = new Set(data.productCategories.map((c) => c.id));
  const productIds = new Set(data.products.map((p) => p.id));

  // Smazat odstraněné produkty
  const { data: existingProducts } = await (supabase.from("inventory_products") as any).select("id").eq("service_id", serviceId);
  for (const p of existingProducts ?? []) {
    if (!productIds.has(p.id)) {
      await (supabase.from("inventory_products") as any).delete().eq("id", p.id);
    }
  }

  // Smazat odstraněné kategorie
  const { data: existingCategories } = await (supabase.from("inventory_product_categories") as any).select("id").eq("service_id", serviceId);
  for (const c of existingCategories ?? []) {
    if (!categoryIds.has(c.id)) {
      await (supabase.from("inventory_product_categories") as any).delete().eq("id", c.id);
    }
  }

  // Upsert categories
  if (data.productCategories.length > 0) {
    const rows = data.productCategories.map((c, i) => ({
      id: c.id,
      service_id: serviceId,
      name: c.name,
      model_ids: c.modelIds ?? [],
      order_index: i,
      created_at: c.createdAt,
    }));
    const { error } = await (supabase.from("inventory_product_categories") as any).upsert(rows, { onConflict: "id" });
    if (error) {
      console.error("[inventoryDb] Upsert categories error:", error);
      return { error: error.message };
    }
  }

  // Upsert products
  if (data.products.length > 0) {
    const rows = data.products.map((p, i) => ({
      id: p.id,
      service_id: serviceId,
      name: p.name,
      stock: p.stock,
      price: p.price,
      sku: p.sku ?? null,
      description: p.description ?? null,
      image_url: p.imageUrl ?? null,
      category_id: p.categoryId ?? null,
      model_ids: p.modelIds ?? [],
      repair_ids: p.repairIds ?? [],
      order_index: i,
      created_at: p.createdAt,
    }));
    const { error } = await (supabase.from("inventory_products") as any).upsert(rows, { onConflict: "id" });
    if (error) {
      console.error("[inventoryDb] Upsert products error:", error);
      return { error: error.message };
    }
  }

  return {};
}
