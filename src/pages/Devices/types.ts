/**
 * Typy stránky Zařízení a opravy.
 *
 * Značka › kategorie › model tvoří strom, opravy visí na modelech
 * (jedna oprava může patřit více modelům). Typy jsou záměrně duplicitní
 * vůči lib/devicesDb.ts – stránka si drží vlastní tvar kvůli migraci
 * z localStorage (`modelId` → `modelIds`).
 */

export type Brand = {
  id: string;
  name: string;
  createdAt: string;
  /** Posílat do veřejného API? */
  publicVisible?: boolean;
};

export type Category = {
  id: string;
  brandId: string;
  name: string;
  createdAt: string;
  publicVisible?: boolean;
};

export type DeviceModel = {
  id: string;
  categoryId: string;
  name: string;
  createdAt: string;
  publicVisible?: boolean;
};

export type Repair = {
  id: string;
  /** Oprava může být u více modelů. */
  modelIds: string[];
  name: string;
  price: number;
  estimatedTime: number;
  details: string;
  costs?: number;
  productIds?: string[];
  createdAt: string;
  publicVisible?: boolean;
  /** Modely, u kterých se tahle oprava do ceníku neposílá. */
  publicHiddenModelIds?: string[];
};

export type DevicesData = {
  brands: Brand[];
  categories: Category[];
  models: DeviceModel[];
  repairs: Repair[];
};

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

/** Úroveň stromu. */
export type NodeKind = "brand" | "category" | "model";

/** Vybraný uzel stromu. */
export type Selection = { kind: NodeKind; id: string };

/** Rozepsaná oprava ve formuláři (přidání i úprava sdílejí tvar). */
export type RepairDraft = {
  name: string;
  price: string;
  time: string;
  details: string;
  costs: string;
  productIds: string[];
  modelIds: string[];
  hiddenModelIds: string[];
  productSearch: string;
  modelSearch: string;
};

export const EMPTY_REPAIR_DRAFT: RepairDraft = {
  name: "",
  price: "",
  time: "",
  details: "",
  costs: "",
  productIds: [],
  modelIds: [],
  hiddenModelIds: [],
  productSearch: "",
  modelSearch: "",
};

/** Klíč pole v DevicesData pro danou úroveň stromu. */
export const KIND_KEY: Record<NodeKind, "brands" | "categories" | "models"> = {
  brand: "brands",
  category: "categories",
  model: "models",
};

export const KIND_LABEL: Record<NodeKind, string> = {
  brand: "Značka",
  category: "Kategorie",
  model: "Model",
};
