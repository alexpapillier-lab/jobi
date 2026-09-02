import { STORAGE_KEYS } from "../constants/storageKeys";

/**
 * Typy a načítání katalogu zařízení a skladu z localStorage.
 *
 * Pozor: tvary tady NEJSOU totožné s těmi v devicesDb.ts / inventoryDb.ts.
 * Zařízení sedí strukturálně (jen jiné názvy), ale InventoryData je jinde
 * { productCategories, products }, kdežto tady { brands, categories, models,
 * products }. Jde o starší localStorage formát, proto se nesloučily.
 */

export type DeviceRepair = {
  id: string;
  modelIds: string[]; // může být u více modelů
  name: string;
  price: number;
  estimatedTime: number;
  details: string;
  costs?: number; // náklady
  productIds?: string[]; // produkty používané u této opravy
  createdAt: string;
};

export type DeviceBrand = {
  id: string;
  name: string;
  createdAt: string;
};

export type DeviceCategory = {
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

export type DevicesData = {
  brands: DeviceBrand[];
  categories: DeviceCategory[];
  models: DeviceModel[];
  repairs: DeviceRepair[];
};

export function safeLoadDevicesData(): DevicesData {
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.DEVICES);
    if (!raw) return { brands: [], categories: [], models: [], repairs: [] };
    const parsed = JSON.parse(raw) as DevicesData;
    return {
      brands: Array.isArray(parsed.brands) ? parsed.brands : [],
      categories: Array.isArray(parsed.categories) ? parsed.categories : [],
      models: Array.isArray(parsed.models) ? parsed.models : [],
      repairs: Array.isArray(parsed.repairs) ? parsed.repairs : [],
    };
  } catch {
    return { brands: [], categories: [], models: [], repairs: [] };
  }
}

export type InventoryProduct = {
  id: string;
  name: string;
  modelIds: string[];
  stock: number;
  price: number;
  sku?: string;
  description?: string;
  imageUrl?: string;
  repairIds?: string[];
  createdAt: string;
};

export type InventoryData = {
  brands: DeviceBrand[];
  categories: DeviceCategory[];
  models: DeviceModel[];
  products: InventoryProduct[];
};

export function safeLoadInventoryData(): InventoryData {
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.INVENTORY);
    if (!raw) return { brands: [], categories: [], models: [], products: [] };
    const parsed = JSON.parse(raw) as InventoryData;
    return {
      brands: Array.isArray(parsed.brands) ? parsed.brands : [],
      categories: Array.isArray(parsed.categories) ? parsed.categories : [],
      models: Array.isArray(parsed.models) ? parsed.models : [],
      products: Array.isArray(parsed.products) ? parsed.products : [],
    };
  } catch {
    return { brands: [], categories: [], models: [], products: [] };
  }
}

export function safeSaveInventoryData(data: InventoryData) {
  try {
    localStorage.setItem(STORAGE_KEYS.INVENTORY, JSON.stringify(data));
  } catch {}
}
