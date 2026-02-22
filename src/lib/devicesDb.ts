/**
 * Devices DB – načítání a ukládání značek, kategorií, modelů a oprav do Supabase.
 */

import { getSupabaseClient } from "./supabaseClient";

export type Brand = {
  id: string;
  name: string;
  createdAt: string;
};

export type Category = {
  id: string;
  brandId: string;
  name: string;
  createdAt: string;
};

export type DeviceModel = {
  id: string;
  categoryId: string;
  name: string;
  createdAt: string;
};

export type Repair = {
  id: string;
  modelIds: string[];
  name: string;
  price: number;
  estimatedTime: number;
  details: string;
  costs?: number;
  productIds?: string[];
  createdAt: string;
};

export type DevicesData = {
  brands: Brand[];
  categories: Category[];
  models: DeviceModel[];
  repairs: Repair[];
};

function mapBrandRow(r: { id: string; name: string; created_at: string }): Brand {
  return { id: r.id, name: r.name, createdAt: r.created_at };
}

function mapCategoryRow(r: { id: string; brand_id: string; name: string; created_at: string }): Category {
  return { id: r.id, brandId: r.brand_id, name: r.name, createdAt: r.created_at };
}

function mapModelRow(r: { id: string; category_id: string; name: string; created_at: string }): DeviceModel {
  return { id: r.id, categoryId: r.category_id, name: r.name, createdAt: r.created_at };
}

function mapRepairRow(r: {
  id: string;
  name: string;
  price: number;
  estimated_time: number;
  details: string;
  costs: number | null;
  model_ids: unknown;
  product_ids: unknown;
  created_at: string;
}): Repair {
  const modelIds = Array.isArray(r.model_ids) ? (r.model_ids as string[]) : [];
  const productIds = Array.isArray(r.product_ids) ? (r.product_ids as string[]) : undefined;
  return {
    id: r.id,
    name: r.name,
    price: Number(r.price),
    estimatedTime: Number(r.estimated_time),
    details: r.details ?? "",
    costs: r.costs != null ? Number(r.costs) : undefined,
    modelIds,
    productIds: productIds && productIds.length > 0 ? productIds : undefined,
    createdAt: r.created_at,
  };
}

export type LoadDevicesResult = { data: DevicesData; error?: string };

/** Načte data zařízení z databáze pro daný servis. Při chybě vrací error, data mohou být prázdné. */
export async function loadDevicesFromDb(serviceId: string | null): Promise<LoadDevicesResult> {
  const supabase = getSupabaseClient();
  if (!supabase || !serviceId) {
    return { data: { brands: [], categories: [], models: [], repairs: [] } };
  }

  // Sekvenčně místo paralelně – méně tlak na connection pool (PGRST683)
  const brandsRes = await (supabase.from("device_brands") as any).select("id, name, created_at").eq("service_id", serviceId).order("created_at");
  const categoriesRes = await (supabase.from("device_categories") as any).select("id, brand_id, name, created_at").eq("service_id", serviceId).order("order_index").order("created_at");
  const modelsRes = await (supabase.from("device_models") as any).select("id, category_id, name, created_at").eq("service_id", serviceId).order("order_index").order("created_at");
  const repairsRes = await (supabase.from("repairs") as any).select("id, name, price, estimated_time, details, costs, model_ids, product_ids, created_at").eq("service_id", serviceId).order("order_index").order("created_at");

  const err = brandsRes.error || categoriesRes.error || modelsRes.error || repairsRes.error;
  if (err) {
    const msg = (err as { message?: string }).message ?? String(err);
    console.warn("[devicesDb] Load error:", msg);
    return { data: { brands: [], categories: [], models: [], repairs: [] }, error: msg };
  }

  return {
    data: {
      brands: (brandsRes.data ?? []).map(mapBrandRow),
      categories: (categoriesRes.data ?? []).map(mapCategoryRow),
      models: (modelsRes.data ?? []).map(mapModelRow),
      repairs: (repairsRes.data ?? []).map(mapRepairRow),
    },
  };
}

/** Uloží data zařízení do databáze. Používá upsert a smaže odstraněné záznamy. */
export async function saveDevicesToDb(serviceId: string | null, data: DevicesData): Promise<{ error?: string }> {
  const supabase = getSupabaseClient();
  if (!supabase || !serviceId) {
    return { error: "No Supabase or serviceId" };
  }

  const brandIds = new Set(data.brands.map((b) => b.id));
  const categoryIds = new Set(data.categories.map((c) => c.id));
  const modelIds = new Set(data.models.map((m) => m.id));
  const repairIds = new Set(data.repairs.map((r) => r.id));

  // 1) Smazat opravy, které už nejsou v data
  const { data: existingRepairs } = await (supabase.from("repairs") as any).select("id").eq("service_id", serviceId);
  for (const r of existingRepairs ?? []) {
    if (!repairIds.has(r.id)) {
      await (supabase.from("repairs") as any).delete().eq("id", r.id);
    }
  }

  // 2) Smazat modely, které už nejsou v data
  const { data: existingModels } = await (supabase.from("device_models") as any).select("id").eq("service_id", serviceId);
  for (const m of existingModels ?? []) {
    if (!modelIds.has(m.id)) {
      await (supabase.from("device_models") as any).delete().eq("id", m.id);
    }
  }

  // 3) Smazat kategorie, které už nejsou v data
  const { data: existingCategories } = await (supabase.from("device_categories") as any).select("id").eq("service_id", serviceId);
  for (const c of existingCategories ?? []) {
    if (!categoryIds.has(c.id)) {
      await (supabase.from("device_categories") as any).delete().eq("id", c.id);
    }
  }

  // 4) Smazat značky, které už nejsou v data
  const { data: existingBrands } = await (supabase.from("device_brands") as any).select("id").eq("service_id", serviceId);
  for (const b of existingBrands ?? []) {
    if (!brandIds.has(b.id)) {
      await (supabase.from("device_brands") as any).delete().eq("id", b.id);
    }
  }

  // 5) Upsert brands
  if (data.brands.length > 0) {
    const rows = data.brands.map((b) => ({
      id: b.id,
      service_id: serviceId,
      name: b.name,
      created_at: b.createdAt,
    }));
    const { error } = await (supabase.from("device_brands") as any).upsert(rows, { onConflict: "id" });
    if (error) {
      console.warn("[devicesDb] Upsert brands error:", (error as { message?: string }).message ?? error);
      return { error: (error as { message?: string }).message ?? String(error) ?? "Chyba ukládání značek" };
    }
  }

  // 6) Upsert categories
  if (data.categories.length > 0) {
    const rows = data.categories.map((c, i) => ({
      id: c.id,
      service_id: serviceId,
      brand_id: c.brandId,
      name: c.name,
      order_index: i,
      created_at: c.createdAt,
    }));
    const { error } = await (supabase.from("device_categories") as any).upsert(rows, { onConflict: "id" });
    if (error) {
      console.warn("[devicesDb] Upsert categories error:", (error as { message?: string }).message ?? error);
      return { error: (error as { message?: string }).message ?? String(error) ?? "Chyba ukládání kategorií" };
    }
  }

  // 7) Upsert models
  if (data.models.length > 0) {
    const rows = data.models.map((m, i) => ({
      id: m.id,
      service_id: serviceId,
      category_id: m.categoryId,
      name: m.name,
      order_index: i,
      created_at: m.createdAt,
    }));
    const { error } = await (supabase.from("device_models") as any).upsert(rows, { onConflict: "id" });
    if (error) {
      console.warn("[devicesDb] Upsert models error:", (error as { message?: string }).message ?? error);
      return { error: (error as { message?: string }).message ?? String(error) ?? "Chyba ukládání modelů" };
    }
  }

  // 8) Upsert repairs
  if (data.repairs.length > 0) {
    const rows = data.repairs.map((r, i) => ({
      id: r.id,
      service_id: serviceId,
      name: r.name,
      price: r.price,
      estimated_time: r.estimatedTime,
      details: r.details ?? "",
      costs: r.costs ?? null,
      model_ids: r.modelIds ?? [],
      product_ids: r.productIds ?? [],
      order_index: i,
      created_at: r.createdAt,
    }));
    const { error } = await (supabase.from("repairs") as any).upsert(rows, { onConflict: "id" });
    if (error) {
      console.warn("[devicesDb] Upsert repairs error:", (error as { message?: string }).message ?? error);
      return { error: (error as { message?: string }).message ?? String(error) ?? "Chyba ukládání oprav" };
    }
  }

  return {};
}
