import React, { useEffect, useMemo, useState, useRef } from "react";
import { createPortal } from "react-dom";
import { showToast } from "../components/Toast";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { useActiveRole } from "../hooks/useActiveRole";
import { STORAGE_KEYS, getInventoryKey } from "../constants/storageKeys";
import { loadDevicesFromDb } from "../lib/devicesDb";
import { loadInventoryFromDb, saveInventoryToDb } from "../lib/inventoryDb";
import { supabase } from "../lib/supabaseClient";
const PRODUCT_DISPLAY_MODE_KEY = "jobsheet_inventory_display_mode";

type Brand = {
  id: string;
  name: string;
  createdAt: string;
};

type Category = {
  id: string;
  brandId: string;
  name: string;
  createdAt: string;
};

type DeviceModel = {
  id: string;
  categoryId: string;
  name: string;
  createdAt: string;
};

type ProductCategory = {
  id: string;
  name: string;
  modelIds: string[]; // modely, které tuto kategorii používají
  createdAt: string;
};

type Product = {
  id: string;
  name: string;
  modelIds: string[]; // can be for multiple models
  categoryId?: string; // category of the product (not model category)
  stock: number;
  price: number;
  sku?: string;
  description?: string;
  imageUrl?: string; // base64 or URL
  repairIds?: string[]; // repairs that use this product
  createdAt: string;
};

type InventoryData = {
  productCategories: ProductCategory[];
  products: Product[];
};

type Repair = {
  id: string;
  modelIds: string[]; // může být u více modelů
  name: string;
  price: number;
  estimatedTime: number;
  details: string;
  createdAt: string;
};

type DevicesData = {
  brands: Brand[];
  categories: Category[];
  models: DeviceModel[];
  repairs: Repair[];
};

function uuid() {
  return crypto?.randomUUID ? crypto.randomUUID() : `${Date.now()}_${Math.random()}`;
}

function parseInventoryRaw(parsed: InventoryData & Record<string, unknown>): InventoryData {
  if ("brands" in parsed || "categories" in parsed || "models" in parsed) {
    return { productCategories: (parsed.productCategories || []).map((c: any) => ({ ...c, modelIds: c.modelIds || [] })), products: parsed.products || [] };
  }
  if (!parsed.productCategories) {
    return { productCategories: [], products: parsed.products || [] };
  }
  return {
    ...parsed,
    productCategories: parsed.productCategories.map((c: any) => ({ ...c, modelIds: c.modelIds || [] })),
  };
}

function loadInventoryFromKey(key: string): InventoryData {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return { productCategories: [], products: [] };
    return parseInventoryRaw(JSON.parse(raw) as InventoryData & Record<string, unknown>);
  } catch {
    return { productCategories: [], products: [] };
  }
}

// Product Filter Picker Component
function ProductFilterPicker({ value, onChange }: { value: "all" | "inStock" | "lowStock" | "outOfStock" | "noModels"; onChange: (v: "all" | "inStock" | "lowStock" | "outOfStock" | "noModels") => void }) {
  const [open, setOpen] = useState(false);
  const [menuPosition, setMenuPosition] = useState({ top: 0, left: 0 });
  const buttonRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open || !buttonRef.current) return;
    const rect = buttonRef.current.getBoundingClientRect();
    setMenuPosition({
      top: rect.bottom + window.scrollY + 4,
      left: rect.left + window.scrollX,
    });
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const handleClick = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node) && buttonRef.current && !buttonRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", handleClick);
    document.addEventListener("keydown", handleEscape, true);
    return () => {
      document.removeEventListener("mousedown", handleClick);
      document.removeEventListener("keydown", handleEscape, true);
    };
  }, [open]);

  const options = [
    { value: "all", label: "Všechny produkty" },
    { value: "inStock", label: "Na skladě" },
    { value: "lowStock", label: "Nízký stav (<5)" },
    { value: "outOfStock", label: "Vyprodáno" },
    { value: "noModels", label: "Bez modelu" },
  ];

  const selected = options.find(o => o.value === value) || options[0];

  const menu = open ? (
    <div
      ref={menuRef}
      style={{
        position: "absolute",
        top: menuPosition.top,
        left: menuPosition.left,
        background: "var(--panel)",
        border: "1px solid var(--border)",
        borderRadius: 12,
        boxShadow: "0 10px 25px rgba(0,0,0,0.15)",
        zIndex: 10000,
        minWidth: 200,
        overflow: "hidden",
      }}
    >
      {options.map((opt) => (
        <button
          key={opt.value}
          type="button"
          onClick={() => {
            onChange(opt.value as any);
            setOpen(false);
          }}
          style={{
            width: "100%",
            padding: "10px 14px",
            background: value === opt.value ? "var(--accent-soft)" : "transparent",
            border: "none",
            color: value === opt.value ? "var(--accent)" : "var(--text)",
            fontWeight: value === opt.value ? 900 : 500,
            fontSize: 13,
            textAlign: "left",
            cursor: "pointer",
            fontFamily: "system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
          }}
          onMouseEnter={(e) => {
            if (value !== opt.value) {
              e.currentTarget.style.background = "var(--panel-2)";
            }
          }}
          onMouseLeave={(e) => {
            if (value !== opt.value) {
              e.currentTarget.style.background = "transparent";
            }
          }}
        >
          <span>{opt.label}</span>
          {value === opt.value && <span style={{ fontSize: 12, opacity: 0.8 }}>✓</span>}
        </button>
      ))}
    </div>
  ) : null;

  return (
    <div style={{ position: "relative" }}>
      <button
        ref={buttonRef}
        type="button"
        onClick={() => setOpen(!open)}
        style={{
          padding: "10px 14px",
          minWidth: 160,
          borderRadius: 12,
          border: open ? "1px solid var(--accent)" : "1px solid var(--border)",
          outline: "none",
          background: open ? "var(--panel-2)" : "var(--panel)",
          color: "var(--text)",
          fontFamily: "system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif",
          fontWeight: 900,
          fontSize: 13,
          cursor: "pointer",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 8,
          boxShadow: open ? "0 0 0 3px var(--accent-soft)" : "var(--shadow-soft)",
          transition: "var(--transition-smooth)",
        }}
        onMouseEnter={(e) => {
          if (!open) e.currentTarget.style.borderColor = "var(--accent)";
        }}
        onMouseLeave={(e) => {
          if (!open) e.currentTarget.style.borderColor = "var(--border)";
        }}
      >
        <span>{selected.label}</span>
        <span style={{ opacity: 0.65, fontWeight: 900, fontSize: 10 }}>▾</span>
      </button>
      {open ? createPortal(menu, document.body) : null}
    </div>
  );
}

// Product Display Mode Picker Component
function ProductDisplayModePicker({ value, onChange }: { value: "grid" | "list" | "compact"; onChange: (v: "grid" | "list" | "compact") => void }) {
  const [open, setOpen] = useState(false);
  const [menuPosition, setMenuPosition] = useState({ top: 0, right: 0 });
  const buttonRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open || !buttonRef.current) return;
    const rect = buttonRef.current.getBoundingClientRect();
    setMenuPosition({
      top: rect.bottom + window.scrollY + 4,
      right: window.innerWidth - rect.right - window.scrollX,
    });
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const handleClick = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node) && buttonRef.current && !buttonRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", handleClick);
    document.addEventListener("keydown", handleEscape, true);
    return () => {
      document.removeEventListener("mousedown", handleClick);
      document.removeEventListener("keydown", handleEscape, true);
    };
  }, [open]);

  const options = [
    { value: "grid", label: "Mřížka", icon: "⊞" },
    { value: "list", label: "Seznam", icon: "☰" },
    { value: "compact", label: "Kompaktní", icon: "☷" },
  ];

  const selected = options.find(o => o.value === value) || options[0];

  const menu = open ? (
    <div
      ref={menuRef}
      style={{
        position: "absolute",
        top: menuPosition.top,
        right: menuPosition.right,
        background: "var(--panel)",
        border: "1px solid var(--border)",
        borderRadius: 12,
        boxShadow: "0 10px 25px rgba(0,0,0,0.15)",
        zIndex: 10000,
        minWidth: 180,
        overflow: "hidden",
      }}
    >
      {options.map((opt) => (
        <button
          key={opt.value}
          type="button"
          onClick={() => {
            onChange(opt.value as any);
            setOpen(false);
          }}
          style={{
            width: "100%",
            padding: "10px 14px",
            background: value === opt.value ? "var(--accent-soft)" : "transparent",
            border: "none",
            color: value === opt.value ? "var(--accent)" : "var(--text)",
            fontWeight: value === opt.value ? 900 : 500,
            fontSize: 13,
            textAlign: "left",
            cursor: "pointer",
            fontFamily: "system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 8,
          }}
          onMouseEnter={(e) => {
            if (value !== opt.value) {
              e.currentTarget.style.background = "var(--panel-2)";
            }
          }}
          onMouseLeave={(e) => {
            if (value !== opt.value) {
              e.currentTarget.style.background = "transparent";
            }
          }}
        >
          <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span style={{ fontSize: 16 }}>{opt.icon}</span>
            <span>{opt.label}</span>
          </span>
          {value === opt.value && <span style={{ fontSize: 12, opacity: 0.8 }}>✓</span>}
        </button>
      ))}
    </div>
  ) : null;

  return (
    <div style={{ position: "relative" }}>
      <button
        ref={buttonRef}
        type="button"
        onClick={() => setOpen(!open)}
        style={{
          padding: "10px 14px",
          minWidth: 140,
          borderRadius: 12,
          border: open ? "1px solid var(--accent)" : "1px solid var(--border)",
          outline: "none",
          background: open ? "var(--panel-2)" : "var(--panel)",
          color: "var(--text)",
          fontFamily: "system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif",
          fontWeight: 900,
          fontSize: 13,
          cursor: "pointer",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 8,
          boxShadow: open ? "0 0 0 3px var(--accent-soft)" : "var(--shadow-soft)",
          transition: "var(--transition-smooth)",
        }}
        onMouseEnter={(e) => {
          if (!open) e.currentTarget.style.borderColor = "var(--accent)";
        }}
        onMouseLeave={(e) => {
          if (!open) e.currentTarget.style.borderColor = "var(--border)";
        }}
      >
        <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <span style={{ fontSize: 16 }}>{selected.icon}</span>
          <span>{selected.label}</span>
        </span>
        <span style={{ opacity: 0.65, fontWeight: 900, fontSize: 10 }}>▾</span>
      </button>
      {open ? createPortal(menu, document.body) : null}
    </div>
  );
}

type InventoryProps = { activeServiceId: string | null };

const EMPTY_INVENTORY: InventoryData = { productCategories: [], products: [] };

export default function Inventory({ activeServiceId }: InventoryProps) {
  const { hasCapability } = useActiveRole(activeServiceId);
  const canAdjustInventoryQuantity = hasCapability("can_adjust_inventory_quantity");

  const [data, setData] = useState<InventoryData>(EMPTY_INVENTORY);
  const [selectedBrandId, setSelectedBrandId] = useState<string | null>(null);
  const [selectedCategoryId, setSelectedCategoryId] = useState<string | null>(null);
  const [selectedModelId, setSelectedModelId] = useState<string | null>(null);

  const [editingProduct, setEditingProduct] = useState<string | null>(null);
  const [editingProductCategory, setEditingProductCategory] = useState<string | null>(null);

  const [editProductData, setEditProductData] = useState({ name: "", stock: "", price: "", sku: "", description: "", imageUrl: "", repairIds: [] as string[], categoryId: "", modelIds: [] as string[], modelSearch: "" });
  const [editProductCategoryName, setEditProductCategoryName] = useState("");

  // Low stock warning dialog
  const [lowStockDialogOpen, setLowStockDialogOpen] = useState(false);
  const [lowStockCallback, setLowStockCallback] = useState<(() => void) | null>(null);

  const [newProduct, setNewProduct] = useState({ name: "", stock: "", price: "", sku: "", description: "", modelIds: [] as string[], imageUrl: "", repairIds: [] as string[], categoryId: "" });
  const [newProductCategoryName, setNewProductCategoryName] = useState("");
  const [selectedProductCategoryId, setSelectedProductCategoryId] = useState<string | null>(null);
  
  // Filters for product list
  const [productSearchQuery, setProductSearchQuery] = useState("");
  const [productStockFilter, setProductStockFilter] = useState<"all" | "inStock" | "lowStock" | "outOfStock" | "noModels">("all");
  const [productDisplayMode, setProductDisplayMode] = useState<"grid" | "list" | "compact">(() => {
    const saved = localStorage.getItem(PRODUCT_DISPLAY_MODE_KEY);
    return (saved as "grid" | "list" | "compact") || "grid";
  });
  const [stockChanges, setStockChanges] = useState<Record<string, string>>({});
  const [editingStock, setEditingStock] = useState<string | null>(null);

  const [devicesData, setDevicesData] = useState<DevicesData>({ brands: [], categories: [], models: [], repairs: [] });

  // Import section
  const [showImport, setShowImport] = useState(false);
  const [importPreview, setImportPreview] = useState<{
    products: { name: string; sku?: string; price: number; stock: number; description?: string; autoMatchedModels: { modelId: string; modelName: string; brand: string; category: string; confidence: "high" | "medium" | "low" }[]; explicitModels?: string[] }[];
    duplicates: { type: string; name: string }[];
    needsReview: { productName: string; reason: string; suggestions: { modelId: string; modelName: string; brand: string; category: string }[] }[];
  } | null>(null);


  // Load inventory and devices from DB when active service changes (with localStorage migration)
  useEffect(() => {
    if (!activeServiceId) {
      setData(EMPTY_INVENTORY);
      setDevicesData({ brands: [], categories: [], models: [], repairs: [] });
      return;
    }
    let cancelled = false;
    (async () => {
      // Load devices (for filtering products)
      const devicesRes = await loadDevicesFromDb(activeServiceId);
      if (cancelled) return;
      if (!devicesRes.error) setDevicesData(devicesRes.data);

      // Load inventory from DB
      let invData = await loadInventoryFromDb(activeServiceId);
      if (cancelled) return;
      const hasDb = invData.productCategories.length > 0 || invData.products.length > 0;
      if (!hasDb) {
        const fromStorage = loadInventoryFromKey(getInventoryKey(activeServiceId));
        const legacy = loadInventoryFromKey(STORAGE_KEYS.INVENTORY);
        const merged =
          fromStorage.productCategories.length > 0 || fromStorage.products.length > 0
            ? fromStorage
            : legacy;
        const hasStorage = merged.productCategories.length > 0 || merged.products.length > 0;
        if (hasStorage) {
          await saveInventoryToDb(activeServiceId, merged);
          invData = merged;
        }
      }
      if (cancelled) return;
      setData(invData);
    })();
    return () => {
      cancelled = true;
    };
  }, [activeServiceId]);

  // Save inventory to DB when data changes
  useEffect(() => {
    if (!activeServiceId) return;
    saveInventoryToDb(activeServiceId, data).then((r) => {
      if (r.error) showToast("Chyba uložení skladu: " + r.error, "error");
    });
  }, [activeServiceId, data]);

  useEffect(() => {
    if (!canAdjustInventoryQuantity && editingStock) setEditingStock(null);
  }, [canAdjustInventoryQuantity, editingStock]);

  useEffect(() => {
    localStorage.setItem(PRODUCT_DISPLAY_MODE_KEY, productDisplayMode);
  }, [productDisplayMode]);

  // Refresh inventory from DB when returning from import
  useEffect(() => {
    if (!showImport && activeServiceId) {
      loadInventoryFromDb(activeServiceId).then((invData) => setData(invData));
    }
  }, [showImport, activeServiceId]);

  // Realtime: při změně skladu nebo zařízení v jiné záložce/zařízení přenačíst
  useEffect(() => {
    if (!activeServiceId || !supabase) return;
    const topic = `inventory:${activeServiceId}`;
    const reloadInventory = () => loadInventoryFromDb(activeServiceId).then(setData);
    const reloadDevices = () => loadDevicesFromDb(activeServiceId).then((r) => { if (!r.error) setDevicesData(r.data); });
    const channel = supabase
      .channel(topic)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "inventory_products", filter: `service_id=eq.${activeServiceId}` },
        reloadInventory
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "inventory_product_categories", filter: `service_id=eq.${activeServiceId}` },
        reloadInventory
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "device_brands", filter: `service_id=eq.${activeServiceId}` },
        reloadDevices
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "device_categories", filter: `service_id=eq.${activeServiceId}` },
        reloadDevices
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "device_models", filter: `service_id=eq.${activeServiceId}` },
        reloadDevices
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "repairs", filter: `service_id=eq.${activeServiceId}` },
        reloadDevices
      )
      .subscribe();
    return () => {
      if (supabase) supabase.removeChannel(channel);
    };
  }, [activeServiceId]);

  const border = "1px solid var(--border)";
  const card: React.CSSProperties = {
    border,
    borderRadius: "var(--radius-lg)",
    background: "var(--panel)",
    backdropFilter: "var(--blur)",
    WebkitBackdropFilter: "var(--blur)",
    padding: 16,
    boxShadow: "var(--shadow-soft)",
    color: "var(--text)",
    display: "flex",
    flexDirection: "column",
  };

  const inputStyle: React.CSSProperties = {
    width: "100%",
    padding: "10px 12px",
    borderRadius: 12,
    border,
    outline: "none",
    background: "var(--panel)",
    backdropFilter: "var(--blur)",
    WebkitBackdropFilter: "var(--blur)",
    color: "var(--text)",
    fontFamily: "system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif",
    transition: "var(--transition-smooth)",
    boxShadow: "var(--shadow-soft)",
  };

  const primaryBtn: React.CSSProperties = {
    padding: "10px 14px",
    borderRadius: 12,
    border: "none",
    background: "linear-gradient(135deg, var(--accent), var(--accent-hover))",
    color: "white",
    fontWeight: 900,
    cursor: "pointer",
    fontFamily: "system-ui",
    fontSize: 13,
    boxShadow: `0 4px 12px var(--accent-glow)`,
    transition: "var(--transition-smooth)",
  };

  const softBtn: React.CSSProperties = {
    padding: "10px 14px",
    borderRadius: 12,
    border,
    background: "var(--panel)",
    color: "var(--text)",
    fontWeight: 900,
    cursor: "pointer",
    fontFamily: "system-ui",
    fontSize: 13,
  };

  const dangerBtn: React.CSSProperties = {
    ...softBtn,
    color: "rgba(239,68,68,0.95)",
    borderColor: "rgba(239,68,68,0.3)",
  };

  const arrowBtn = (disabled: boolean): React.CSSProperties => ({
    background: "none",
    border: "none",
    color: disabled ? "var(--muted)" : "var(--accent)",
    cursor: disabled ? "not-allowed" : "pointer",
    fontSize: 16,
    fontWeight: 900,
    padding: 4,
    opacity: disabled ? 0.3 : 1,
  });

  // Brands, categories and models are loaded from Devices - no add/edit/delete functions needed

  const addProductCategory = () => {
    if (!newProductCategoryName.trim()) return;
    const category: ProductCategory = {
      id: uuid(),
      name: newProductCategoryName.trim(),
      modelIds: [], // začíná bez modelů, uživatel si je přidá
      createdAt: new Date().toISOString(),
    };
    setData((d) => ({ ...d, productCategories: [...d.productCategories, category] }));
    setNewProductCategoryName("");
    showToast("Kategorie produktů přidána", "success");
  };

  const deleteProductCategory = (id: string) => {
    setData((d) => ({
      ...d,
      productCategories: d.productCategories.filter((c) => c.id !== id),
      products: d.products.map((p) => (p.categoryId === id ? { ...p, categoryId: undefined } : p)),
    }));
    if (selectedProductCategoryId === id) setSelectedProductCategoryId(null);
    showToast("Kategorie produktů smazána", "success");
  };

  const updateProductCategory = (id: string, name: string) => {
    setData((d) => ({
      ...d,
      productCategories: d.productCategories.map((c) => (c.id === id ? { ...c, name } : c)),
    }));
    setEditingProductCategory(null);
    showToast("Kategorie produktů upravena", "success");
  };

  const toggleProductCategoryForModel = (categoryId: string, modelId: string) => {
    setData((d) => ({
      ...d,
      productCategories: d.productCategories.map((c) =>
        c.id === categoryId
          ? {
              ...c,
              modelIds: (c.modelIds || []).includes(modelId)
                ? (c.modelIds || []).filter((id) => id !== modelId)
                : [...(c.modelIds || []), modelId],
            }
          : c
      ),
    }));
  };

  const addProduct = () => {
    if (!newProduct.name.trim()) return;
    const modelIds = selectedModelId ? [selectedModelId] : [];
    const stock = parseInt(newProduct.stock) || 0;

    if (stock < 1) {
      setLowStockCallback(() => () => {
        const product: Product = {
          id: uuid(),
          name: newProduct.name.trim(),
          modelIds,
          stock,
          price: parseFloat(newProduct.price) || 0,
          sku: newProduct.sku.trim() || undefined,
          description: newProduct.description.trim() || undefined,
          imageUrl: newProduct.imageUrl || undefined,
          repairIds: newProduct.repairIds.length > 0 ? newProduct.repairIds : undefined,
          createdAt: new Date().toISOString(),
        };
        setData((d) => ({ ...d, products: [...d.products, product] }));
        setNewProduct({ name: "", stock: "", price: "", sku: "", description: "", modelIds: [], imageUrl: "", repairIds: [], categoryId: "" });
        showToast(modelIds.length > 0 ? "Produkt přidán" : "Nezávislý produkt přidán", "success");
      });
      setLowStockDialogOpen(true);
      return;
    }

    const product: Product = {
      id: uuid(),
      name: newProduct.name.trim(),
      modelIds,
      stock,
      price: parseFloat(newProduct.price) || 0,
      sku: newProduct.sku.trim() || undefined,
      description: newProduct.description.trim() || undefined,
      imageUrl: newProduct.imageUrl || undefined,
      repairIds: newProduct.repairIds.length > 0 ? newProduct.repairIds : undefined,
      createdAt: new Date().toISOString(),
    };
    setData((d) => ({ ...d, products: [...d.products, product] }));
    setNewProduct({ name: "", stock: "", price: "", sku: "", description: "", modelIds: [], imageUrl: "", repairIds: [], categoryId: "" });
    showToast(modelIds.length > 0 ? "Produkt přidán" : "Nezávislý produkt přidán", "success");
  };

  // Brands, categories and models are managed in Devices page - no delete functions needed

  const deleteProduct = (id: string) => {
    setData((d) => ({ ...d, products: d.products.filter((p) => p.id !== id) }));
    showToast("Produkt smazán", "success");
  };

  // Brands, categories and models are managed in Devices page - no update functions needed

  const updateProduct = (id: string, productData: { name: string; stock: string; price: string; sku: string; description: string; imageUrl: string; repairIds: string[]; categoryId: string; modelIds: string[] }) => {
    const stock = parseInt(productData.stock) || 0;
    
    // Warning if stock would be less than 1
    if (stock < 1) {
      setLowStockCallback(() => () => {
        setData((d) => ({
          ...d,
          products: d.products.map((p) =>
            p.id === id
              ? {
                  ...p,
                  name: productData.name.trim(),
                  modelIds: productData.modelIds || [],
                  stock,
                  price: parseFloat(productData.price) || 0,
                  sku: productData.sku.trim() || undefined,
                  description: productData.description.trim() || undefined,
                  imageUrl: productData.imageUrl || undefined,
                  repairIds: productData.repairIds.length > 0 ? productData.repairIds : undefined,
                  categoryId: productData.categoryId || undefined,
                }
              : p
          ),
        }));
        setEditingProduct(null);
        showToast("Produkt upraven", "success");
      });
      setLowStockDialogOpen(true);
      return;
    }
    
    setData((d) => ({
      ...d,
      products: d.products.map((p) =>
        p.id === id
          ? {
              ...p,
              name: productData.name.trim(),
              modelIds: productData.modelIds || [],
              stock,
              price: parseFloat(productData.price) || 0,
              sku: productData.sku.trim() || undefined,
              description: productData.description.trim() || undefined,
              imageUrl: productData.imageUrl || undefined,
              repairIds: productData.repairIds.length > 0 ? productData.repairIds : undefined,
              categoryId: productData.categoryId || undefined,
            }
          : p
      ),
    }));
    setEditingProduct(null);
    showToast("Produkt upraven", "success");
  };

  const handleImageUpload = (e: React.ChangeEvent<HTMLInputElement>, isEdit: boolean) => {
    const file = e.target.files?.[0];
    if (!file) return;
    
    if (!file.type.startsWith('image/')) {
      showToast('Prosím vyberte obrázek', "error");
      return;
    }
    
    const reader = new FileReader();
    reader.onload = (event) => {
      const result = event.target?.result as string;
      if (isEdit) {
        setEditProductData((p) => ({ ...p, imageUrl: result }));
      } else {
        setNewProduct((p) => ({ ...p, imageUrl: result }));
      }
    };
    reader.readAsDataURL(file);
  };

  const availableRepairs = useMemo(() => {
    if (!selectedModelId) return [];
    return (devicesData.repairs || []).filter((r: any) => r.modelIds && r.modelIds.includes(selectedModelId));
  }, [selectedModelId, devicesData.repairs]);

  // Brands, categories and models are managed in Devices page - no reorder functions needed

  const filteredCategories = useMemo(() => {
    return selectedBrandId
      ? devicesData.categories.filter((c) => c.brandId === selectedBrandId)
      : [];
  }, [devicesData.categories, selectedBrandId]);

  const filteredModels = useMemo(() => {
    return selectedCategoryId ? devicesData.models.filter((m) => m.categoryId === selectedCategoryId) : [];
  }, [devicesData.models, selectedCategoryId]);

  // Smart filtered products list for display
  const filteredProducts = useMemo(() => {
    let products = [...data.products];
    
    // Filter by brand (all products for models of this brand)
    if (selectedBrandId) {
      const brandCategoryIds = devicesData.categories
        .filter((c) => c.brandId === selectedBrandId)
        .map((c) => c.id);
      const brandModelIds = devicesData.models
        .filter((m) => brandCategoryIds.includes(m.categoryId))
        .map((m) => m.id);
      products = products.filter((p) => p.modelIds.some((mid) => brandModelIds.includes(mid)));
    }
    
    // Filter by category (all products for models of this category)
    if (selectedCategoryId) {
      const categoryModelIds = devicesData.models
        .filter((m) => m.categoryId === selectedCategoryId)
        .map((m) => m.id);
      products = products.filter((p) => p.modelIds.some((mid) => categoryModelIds.includes(mid)));
    }
    
    // Filter by model
    if (selectedModelId) {
      products = products.filter((p) => p.modelIds.includes(selectedModelId));
    }
    
    // Filter by product category
    if (selectedProductCategoryId) {
      products = products.filter((p) => p.categoryId === selectedProductCategoryId);
    }
    
    // Filter by search query
    if (productSearchQuery.trim()) {
      const query = productSearchQuery.toLowerCase();
      products = products.filter((p) => 
        p.name.toLowerCase().includes(query) ||
        (p.sku && p.sku.toLowerCase().includes(query)) ||
        (p.description && p.description.toLowerCase().includes(query))
      );
    }
    
    // Filter by stock
    if (productStockFilter === "inStock") {
      products = products.filter((p) => p.stock > 0);
    } else if (productStockFilter === "lowStock") {
      products = products.filter((p) => p.stock > 0 && p.stock < 5);
    } else if (productStockFilter === "outOfStock") {
      products = products.filter((p) => p.stock === 0);
    } else if (productStockFilter === "noModels") {
      products = products.filter((p) => p.modelIds.length === 0);
    }
    
    return products;
  }, [data.products, selectedBrandId, selectedCategoryId, selectedModelId, selectedProductCategoryId, productSearchQuery, productStockFilter, devicesData]);

  const selectedBrand = devicesData.brands.find((b) => b.id === selectedBrandId);
  const selectedCategory = devicesData.categories.find((c) => c.id === selectedCategoryId);
  const selectedModel = devicesData.models.find((m) => m.id === selectedModelId);

  // Auto-match product to models based on name - STRICT: only high confidence matches
  const autoMatchProductToModels = (productName: string): { modelId: string; modelName: string; brand: string; category: string; confidence: "high" | "medium" | "low" }[] => {
    const matches: { modelId: string; modelName: string; brand: string; category: string; confidence: "high" | "medium" | "low"; matchLength: number }[] = [];
    const productNameLower = productName.toLowerCase().trim();
    
    // Extract brand name from product (first word or common brand patterns)
    const productWords = productNameLower.split(/\s+/);
    const firstWord = productWords[0];
    
    for (const model of devicesData.models) {
      const modelNameLower = model.name.toLowerCase().trim();
      const brand = devicesData.brands.find(b => b.id === devicesData.categories.find(c => c.id === model.categoryId)?.brandId);
      const category = devicesData.categories.find(c => c.id === model.categoryId);
      
      if (!brand || !category) continue;
      
      const brandNameLower = brand.name.toLowerCase();
      
      // Check if brand matches
      const brandMatches = productNameLower.includes(brandNameLower) || firstWord === brandNameLower;
      
      // Check for exact model name match (must be significant part)
      const modelWords = modelNameLower.split(/\s+/).filter(w => w.length >= 2);
      if (modelWords.length === 0) continue;
      
      // STRICT MATCHING: Prefer longer/more specific matches
      // CRITICAL: "iPhone 12 Pro" should NOT match "iPhone 12"
      
      const significantWords = modelWords.filter(w => !['pro', 'max', 'mini', 'plus', 'lite', 'ultra', 'standard', 'air', 'se'].includes(w));
      
      // Check if full model name appears in product name as a whole phrase (with word boundaries)
      const fullModelNamePattern = new RegExp(`\\b${modelNameLower.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i');
      const fullModelNameMatch = fullModelNamePattern.test(productNameLower);
      
      // Check if all significant words appear
      const allSignificantWordsMatch = significantWords.length > 0 && 
        significantWords.every(word => {
          const wordPattern = new RegExp(`\\b${word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i');
          return wordPattern.test(productNameLower) || productNameLower.includes(word);
        });
      
      // Only match if:
      // - Full model name is in product name as whole phrase, OR
      // - All significant words are found AND brand matches
      if (fullModelNameMatch || (allSignificantWordsMatch && brandMatches)) {
        if (significantWords.length >= 1) {
          matches.push({
            modelId: model.id,
            modelName: model.name,
            brand: brand.name,
            category: category.name,
            confidence: "high",
            matchLength: modelNameLower.length // Store length for filtering
          });
        }
      }
    }
    
    // Remove duplicates
    let uniqueMatches = matches.filter((match, index, self) => 
      index === self.findIndex(m => m.modelId === match.modelId)
    );
    
    // CRITICAL: Filter out shorter matches if a longer match exists
    // If product contains "iPhone 12 Pro", exclude "iPhone 12"
    uniqueMatches = uniqueMatches.filter(match => {
      // Check if there's a longer model name that also matches and contains this shorter one
      const longerMatch = uniqueMatches.find(m => 
        m.modelId !== match.modelId && 
        m.modelName.toLowerCase().length > match.modelName.toLowerCase().length &&
        productNameLower.includes(m.modelName.toLowerCase())
      );
      
      if (longerMatch) {
        // If longer match's name contains shorter match's name, exclude shorter
        const longerName = longerMatch.modelName.toLowerCase();
        const shorterName = match.modelName.toLowerCase();
        if (longerName.includes(shorterName) && longerName !== shorterName) {
          return false; // Exclude shorter match
        }
      }
      
      return true;
    });
    
    // Sort by match length (longer = more specific = better)
    uniqueMatches.sort((a, b) => b.matchLength - a.matchLength);
    
    // Limit to max 2 matches and remove matchLength from result
    return uniqueMatches.slice(0, 2).map(({ matchLength: _matchLength, ...rest }) => rest);
  };

  // Parse import file
  const parseImportFile = (text: string) => {
    const lines = text.split('\n').map(l => l.trim()).filter(l => l && !l.startsWith('#'));
    const preview = {
      products: [] as { name: string; sku?: string; price: number; stock: number; description?: string; autoMatchedModels: { modelId: string; modelName: string; brand: string; category: string; confidence: "high" | "medium" | "low" }[]; explicitModels?: string[] }[],
      duplicates: [] as { type: string; name: string }[],
      needsReview: [] as { productName: string; reason: string; suggestions: { modelId: string; modelName: string; brand: string; category: string }[] }[]
    };

    let currentProduct: any = null;

    for (const line of lines) {
      if (line.startsWith('PRODUKT:')) {
        // Save previous product if exists
        if (currentProduct) {
          if (!currentProduct.explicitModels || currentProduct.explicitModels.length === 0) {
            // Auto-match models
            currentProduct.autoMatchedModels = autoMatchProductToModels(currentProduct.name);
            if (currentProduct.autoMatchedModels.length === 0) {
              preview.needsReview.push({
                productName: currentProduct.name,
                reason: "Nenalezen žádný odpovídající model",
                suggestions: []
              });
            } else if (currentProduct.autoMatchedModels.length > 1 && currentProduct.autoMatchedModels.some((m: any) => m.confidence === "low")) {
              preview.needsReview.push({
                productName: currentProduct.name,
                reason: "Nalezeno více možných modelů, vyžaduje kontrolu",
                suggestions: currentProduct.autoMatchedModels.map((m: any) => ({ modelId: m.modelId, modelName: m.modelName, brand: m.brand, category: m.category }))
              });
            }
          }
          preview.products.push(currentProduct);
        }
        
        const productName = line.substring(8).trim();
        if (productName) {
          // Check for duplicates
          if (data.products.some(p => p.name.toLowerCase() === productName.toLowerCase())) {
            preview.duplicates.push({ type: 'Produkt', name: productName });
          }
          
          currentProduct = {
            name: productName,
            price: 0,
            stock: 0
          };
        }
      } else if (line.startsWith('SKU:') && currentProduct) {
        currentProduct.sku = line.substring(4).trim();
      } else if (line.startsWith('CENA:') && currentProduct) {
        const price = parseFloat(line.substring(5).trim());
        if (!isNaN(price)) currentProduct.price = price;
      } else if (line.startsWith('SKLAD:') && currentProduct) {
        const stock = parseInt(line.substring(6).trim());
        if (!isNaN(stock)) currentProduct.stock = stock;
      } else if (line.startsWith('POPIS:') && currentProduct) {
        currentProduct.description = line.substring(6).trim();
      } else if (line.startsWith('MODELY:') && currentProduct) {
        const modelNames = line.substring(7).trim().split(',').map(m => m.trim()).filter(m => m);
        currentProduct.explicitModels = modelNames;
      } else if (line === '---' && currentProduct) {
        if (!currentProduct.explicitModels || currentProduct.explicitModels.length === 0) {
          currentProduct.autoMatchedModels = autoMatchProductToModels(currentProduct.name);
          if (currentProduct.autoMatchedModels.length === 0) {
            preview.needsReview.push({
              productName: currentProduct.name,
              reason: "Nenalezen žádný odpovídající model",
              suggestions: []
            });
          } else if (currentProduct.autoMatchedModels.length > 1 && currentProduct.autoMatchedModels.some((m: any) => m.confidence === "low")) {
            preview.needsReview.push({
              productName: currentProduct.name,
              reason: "Nalezeno více možných modelů, vyžaduje kontrolu",
                suggestions: currentProduct.autoMatchedModels.map((m: any) => ({ modelId: m.modelId, modelName: m.modelName, brand: m.brand, category: m.category }))
            });
          }
        }
        preview.products.push(currentProduct);
        currentProduct = null;
      }
    }
    
    // Add last product if exists
    if (currentProduct) {
      if (!currentProduct.explicitModels || currentProduct.explicitModels.length === 0) {
        currentProduct.autoMatchedModels = autoMatchProductToModels(currentProduct.name);
        if (currentProduct.autoMatchedModels.length === 0) {
          preview.needsReview.push({
            productName: currentProduct.name,
            reason: "Nenalezen žádný odpovídající model",
            suggestions: []
          });
        } else if (currentProduct.autoMatchedModels.length > 1 && currentProduct.autoMatchedModels.some((m: any) => m.confidence === "low")) {
          preview.needsReview.push({
            productName: currentProduct.name,
            reason: "Nalezeno více možných modelů, vyžaduje kontrolu",
                suggestions: currentProduct.autoMatchedModels.map((m: any) => ({ modelId: m.modelId, modelName: m.modelName, brand: m.brand, category: m.category }))
          });
        }
      }
      preview.products.push(currentProduct);
    }
    
    return preview;
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onload = (event) => {
        const text = event.target?.result as string;
        const preview = parseImportFile(text);
        setImportPreview(preview);
      };
      reader.readAsText(file);
    }
  };

  const downloadTemplate = () => {
    const template = `# Vzorový soubor pro import produktů
# Řádky začínající # jsou komentáře a budou ignorovány
# Struktura: PRODUKT > SKU > CENA > SKLAD > MODELY (volitelné) > POPIS (volitelné)
# Mezi produkty použijte oddělovač ---
# Pokud MODELY není zadáno, systém automaticky přiřadí produkt k modelům na základě názvu

PRODUKT: Displej iPhone 15
SKU: DISP-IP15-001
CENA: 2500
SKLAD: 10
POPIS: Originální displej pro iPhone 15
# MODELY: iPhone 15 (volitelné - pokud není zadáno, systém automaticky najde odpovídající modely)
---
PRODUKT: Baterie Dyson V11
SKU: BAT-DY-V11
CENA: 1200
SKLAD: 5
POPIS: Náhradní baterie pro Dyson V11
# Systém automaticky najde model "V11" nebo "Dyson V11" v databázi
---
PRODUKT: Kryt Samsung Galaxy S24
SKU: KRYT-SG-S24
CENA: 800
SKLAD: 15
POPIS: Zadní kryt pro Samsung Galaxy S24
---
PRODUKT: Lepidlo univerzální
SKU: LEP-UNI-001
CENA: 150
SKLAD: 50
POPIS: Univerzální lepidlo pro opravy
MODELY: iPhone 15, iPhone 15 Pro, Samsung Galaxy S24
# Pro univerzální produkty můžete explicitně zadat více modelů
---
PRODUKT: Baterie iPhone 15 Pro Max
SKU: BAT-IP15PM
CENA: 1400
SKLAD: 8
POPIS: Náhradní baterie pro iPhone 15 Pro Max
---`;

    const blob = new Blob([template], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'import-produkty-vzor.txt';
    a.click();
    URL.revokeObjectURL(url);
  };

  const executeImport = () => {
    if (!importPreview) return;

    setData((d) => {
      const newData = { ...d };

      for (const product of importPreview.products) {
        const existing = newData.products.find(p => p.name.toLowerCase() === product.name.toLowerCase());
        if (existing) continue; // Skip duplicates

        let modelIds: string[] = [];
        
        if (product.explicitModels && product.explicitModels.length > 0) {
          // Use explicit models
          for (const modelName of product.explicitModels) {
            const model = devicesData.models.find(m => m.name.toLowerCase() === modelName.toLowerCase());
            if (model) modelIds.push(model.id);
          }
        } else {
          // Use auto-matched models (ONLY high confidence - strict mode)
          modelIds = product.autoMatchedModels
            .filter(m => m.confidence === "high")
            .map(m => m.modelId);
        }

        const newProduct: Product = {
          id: uuid(),
          name: product.name,
          sku: product.sku,
          price: product.price,
          stock: product.stock,
          description: product.description,
          modelIds,
          createdAt: new Date().toISOString()
        };
        newData.products.push(newProduct);
      }

      return newData;
    });

    showToast("Import dokončen", "success");
    setShowImport(false);
    setImportPreview(null);
  };

  if (showImport) {
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
          <div>
            <div style={{ fontSize: 22, fontWeight: 950, color: "var(--text)" }}>Import produktů</div>
            <div style={{ fontSize: 13, color: "var(--muted)", marginTop: 4 }}>
              Importujte produkty z TXT souboru s automatickým přiřazením k modelům
            </div>
          </div>
          <button onClick={() => setShowImport(false)} style={{ ...softBtn, padding: "10px 16px" }}>
            Zpět na správu
          </button>
        </div>

        <div style={card}>
          <div style={{ fontWeight: 950, fontSize: 16, marginBottom: 16, color: "var(--text)" }}>
            Návod k použití
          </div>
          <div style={{ fontSize: 13, color: "var(--text)", lineHeight: 1.6, marginBottom: 20 }}>
            <p style={{ marginBottom: 12 }}>
              <strong>Struktura souboru:</strong> Každý produkt začíná klíčovým slovem PRODUKT: následovaným názvem.
            </p>
            <p style={{ marginBottom: 12 }}>
              <strong>Automatické přiřazení:</strong> Pokud nezadáte MODELY:, systém automaticky najde odpovídající modely na základě názvu produktu. Například produkt "Displej iPhone 15" bude automaticky přiřazen k modelu "iPhone 15".
            </p>
            <p style={{ marginBottom: 12 }}>
              <strong>Explicitní přiřazení:</strong> Pro přesné přiřazení použijte MODELY: a uveďte názvy modelů oddělené čárkou.
            </p>
            <p style={{ marginBottom: 12 }}>
              <strong>Oddělovač:</strong> Mezi jednotlivými produkty použijte řádek s <code style={{ background: "var(--panel-2)", padding: "2px 6px", borderRadius: 4 }}>---</code>.
            </p>
            <p style={{ marginBottom: 12 }}>
              <strong>Komentáře:</strong> Řádky začínající <code style={{ background: "var(--panel-2)", padding: "2px 6px", borderRadius: 4 }}>#</code> jsou ignorovány.
            </p>
            <button onClick={downloadTemplate} style={{ ...primaryBtn, marginTop: 8 }}>
              Stáhnout vzorový soubor
            </button>
          </div>
        </div>

        <div style={card}>
          <div style={{ fontWeight: 950, fontSize: 16, marginBottom: 16, color: "var(--text)" }}>
            Nahrát soubor
          </div>
          <input
            type="file"
            accept=".txt"
            onChange={handleFileSelect}
            style={{ ...inputStyle, padding: "8px 12px", cursor: "pointer" }}
          />
        </div>

        {importPreview && (
          <div style={{ ...card, maxHeight: "none", overflow: "visible" }}>
            <div style={{ fontWeight: 950, fontSize: 16, marginBottom: 16, color: "var(--text)" }}>
              Náhled importu
            </div>
            
            {/* Summary */}
            <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 12, marginBottom: 20 }}>
              <div style={{ padding: 12, background: "var(--panel-2)", borderRadius: 8, textAlign: "center" }}>
                <div style={{ fontSize: 24, fontWeight: 950, color: "var(--accent)", marginBottom: 4 }}>
                  {importPreview.products.length}
                </div>
                <div style={{ fontSize: 12, color: "var(--muted)" }}>Produktů</div>
              </div>
              <div style={{ padding: 12, background: "var(--panel-2)", borderRadius: 8, textAlign: "center" }}>
                <div style={{ fontSize: 24, fontWeight: 950, color: importPreview.duplicates.length > 0 ? "rgba(239, 68, 68, 0.9)" : "var(--accent)", marginBottom: 4 }}>
                  {importPreview.duplicates.length}
                </div>
                <div style={{ fontSize: 12, color: "var(--muted)" }}>Duplicit</div>
              </div>
              <div style={{ padding: 12, background: "var(--panel-2)", borderRadius: 8, textAlign: "center" }}>
                <div style={{ fontSize: 24, fontWeight: 950, color: importPreview.needsReview.length > 0 ? "rgba(255, 193, 7, 0.9)" : "var(--accent)", marginBottom: 4 }}>
                  {importPreview.needsReview.length}
                </div>
                <div style={{ fontSize: 12, color: "var(--muted)" }}>Vyžaduje kontrolu</div>
              </div>
            </div>

            {/* Products preview */}
            <div style={{ marginBottom: 20 }}>
              {importPreview.products.map((product, idx) => {
                const needsReview = importPreview.needsReview.some(nr => nr.productName === product.name);
                const isDuplicate = importPreview.duplicates.some(d => d.name === product.name);
                
                return (
                  <div key={idx} style={{ 
                    marginBottom: 12, 
                    padding: 12, 
                    background: needsReview ? "rgba(255, 193, 7, 0.1)" : isDuplicate ? "rgba(239, 68, 68, 0.1)" : "var(--panel-2)", 
                    borderRadius: 8,
                    border: needsReview ? "1px solid rgba(255, 193, 7, 0.3)" : isDuplicate ? "1px solid rgba(239, 68, 68, 0.3)" : border
                  }}>
                    <div style={{ fontWeight: 700, fontSize: 14, color: "var(--text)", marginBottom: 8 }}>
                      📦 {product.name}
                      {isDuplicate && <span style={{ marginLeft: 8, fontSize: 11, color: "rgba(239, 68, 68, 0.9)" }}>⚠️ Duplicitní</span>}
                      {needsReview && <span style={{ marginLeft: 8, fontSize: 11, color: "rgba(255, 193, 7, 0.9)" }}>⚠️ Vyžaduje kontrolu</span>}
                    </div>
                    <div style={{ fontSize: 12, color: "var(--muted)", marginBottom: 8 }}>
                      <div>SKU: {product.sku || "—"}</div>
                      <div>Cena: {product.price} Kč | Sklad: {product.stock} ks</div>
                      {product.description && <div>Popis: {product.description}</div>}
                    </div>
                    {product.explicitModels && product.explicitModels.length > 0 ? (
                      <div style={{ fontSize: 11, color: "var(--text)", marginTop: 8 }}>
                        <strong>Explicitně přiřazeno k modelům ({product.explicitModels.length}):</strong>
                        <div style={{ marginTop: 4, display: "flex", flexWrap: "wrap", gap: 4 }}>
                          {product.explicitModels.map((modelName, midx) => (
                            <span key={midx} style={{ padding: "2px 8px", background: "var(--accent-soft)", borderRadius: 4 }}>
                              {modelName}
                            </span>
                          ))}
                        </div>
                      </div>
                    ) : product.autoMatchedModels.length > 0 ? (
                      <div style={{ fontSize: 11, color: "var(--text)", marginTop: 8 }}>
                        <strong>Automaticky přiřazeno k modelům:</strong>
                        <div style={{ marginTop: 4, display: "flex", flexDirection: "column", gap: 4 }}>
                          {product.autoMatchedModels.map((match, midx) => (
                            <div key={midx} style={{ 
                              padding: "4px 8px", 
                              background: "rgba(34, 197, 94, 0.1)",
                              borderRadius: 4,
                              border: "1px solid rgba(34, 197, 94, 0.3)"
                            }}>
                              {match.brand} {'>'} {match.category} {'>'} {match.modelName}
                            </div>
                          ))}
                        </div>
                      </div>
                    ) : (
                      <div style={{ fontSize: 11, color: "rgba(255, 140, 0, 0.9)", marginTop: 8, padding: "8px", background: "rgba(255, 140, 0, 0.1)", borderRadius: 4 }}>
                        ⚠️ Nenalezen žádný odpovídající model - produkt bude importován bez přiřazení k modelu
                      </div>
                    )}
                  </div>
                );
              })}
            </div>

            {importPreview.needsReview.length > 0 && (
              <div style={{ marginBottom: 16, padding: 12, background: "rgba(255, 193, 7, 0.1)", borderRadius: 8, border: "1px solid rgba(255, 193, 7, 0.3)" }}>
                <div style={{ fontWeight: 700, color: "rgba(255, 193, 7, 0.9)", marginBottom: 8 }}>
                  ⚠️ Produkty vyžadující kontrolu ({importPreview.needsReview.length}):
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                  {importPreview.needsReview.map((nr, idx) => (
                    <div key={idx} style={{ fontSize: 12, color: "var(--text)", padding: "8px", background: "rgba(255, 193, 7, 0.1)", borderRadius: 4 }}>
                      <div style={{ fontWeight: 600, marginBottom: 4 }}>{nr.productName}</div>
                      <div style={{ fontSize: 11, color: "var(--muted)", marginBottom: 4 }}>{nr.reason}</div>
                      {nr.suggestions.length > 0 && (
                        <div style={{ fontSize: 11 }}>
                          <strong>Navržené modely:</strong>
                          {nr.suggestions.map((s, sidx) => (
                            <div key={sidx} style={{ marginLeft: 8, marginTop: 2 }}>
                              • {s.brand} {'>'} {s.category} {'>'} {s.modelName}
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
                <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 8 }}>
                  Tyto produkty budou importovány, ale bez přiřazení k modelům. Můžete je později upravit ručně.
                </div>
              </div>
            )}

            {importPreview.duplicates.length > 0 && (
              <div style={{ marginBottom: 16, padding: 12, background: "rgba(239, 68, 68, 0.1)", borderRadius: 8, border: "1px solid rgba(239, 68, 68, 0.3)" }}>
                <div style={{ fontWeight: 700, color: "rgba(239, 68, 68, 0.9)", marginBottom: 8 }}>
                  ⚠️ Nalezené duplicity ({importPreview.duplicates.length}):
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                  {importPreview.duplicates.map((dup, idx) => (
                    <div key={idx} style={{ fontSize: 12, color: "var(--text)", padding: "4px 8px", background: "rgba(239, 68, 68, 0.1)", borderRadius: 4 }}>
                      {dup.type}: {dup.name}
                    </div>
                  ))}
                </div>
                <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 8 }}>
                  Duplicitní položky budou přeskočeny při importu.
                </div>
              </div>
            )}

            <button
              onClick={executeImport}
              style={{ ...primaryBtn, marginTop: 16, width: "100%" }}
            >
              Provedit import ({importPreview.products.length} produktů)
            </button>
          </div>
        )}
      </div>
    );
  }

  return (
    <div data-tour="inventory-main" style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
      <div>
        <div style={{ fontSize: 22, fontWeight: 950, color: "var(--text)" }}>Sklad</div>
        <div style={{ fontSize: 13, color: "var(--muted)", marginTop: 4 }}>
          Spravujte produkty na skladě. Produkty mohou být pro více modelů.
        </div>
        </div>
        <button data-tour="inventory-import" onClick={() => setShowImport(true)} style={{ ...primaryBtn, padding: "10px 16px", marginRight: 120 }}>
          Import
        </button>
      </div>

      {/* NASKLADNĚNÍ */}
        <div style={card}>
        <div style={{ fontWeight: 950, fontSize: 14, marginBottom: 12, color: "var(--text)" }}>Naskladnění</div>
        <div style={{ fontSize: 13, color: "var(--muted)", marginBottom: 16 }}>
          Rychlé naskladnění produktů - vyberte produkt a zadejte množství
        </div>

        <div style={{ display: "grid", gap: 12 }}>
          <div>
            <div style={{ fontSize: 12, color: "var(--muted)", marginBottom: 6 }}>Vyhledat produkt</div>
            <input
              type="text"
              placeholder="Začněte psát název produktu..."
              value={productSearchQuery}
              onChange={(e) => setProductSearchQuery(e.target.value)}
              style={{
                width: "100%",
                padding: "10px 12px",
                borderRadius: 12,
                border: "1px solid var(--border)",
                background: "var(--panel)",
                backdropFilter: "var(--blur)",
                WebkitBackdropFilter: "var(--blur)",
                color: "var(--text)",
                outline: "none",
                transition: "var(--transition-smooth)",
                boxShadow: "var(--shadow-soft)",
                fontFamily: "system-ui",
                fontSize: 13,
              }}
            />
          </div>

          {(() => {
            const searchLower = productSearchQuery.trim().toLowerCase();
            const matchingProducts = searchLower
              ? data.products.filter((p) => p.name.toLowerCase().includes(searchLower))
              : [];

            if (matchingProducts.length === 0 && productSearchQuery.trim()) {
              return (
                <div style={{ padding: 20, textAlign: "center", color: "var(--muted)", fontSize: 13 }}>
                  Žádný produkt nenalezen
                </div>
              );
            }

            if (matchingProducts.length === 0) {
              return (
                <div style={{ padding: 20, textAlign: "center", color: "var(--muted)", fontSize: 13 }}>
                  Začněte psát název produktu pro vyhledání
                </div>
              );
            }

            return (
              <div style={{ display: "flex", flexDirection: "column", gap: 8, maxHeight: 300, overflowY: "auto" }}>
                {matchingProducts.map((product) => {
                  const isEditing = editingStock === product.id;
                  const stockChangeValue = stockChanges[product.id] || "";

                  // Get model names with brands
                  const productModels = product.modelIds
                    .map((modelId) => {
                      const model = devicesData.models.find((m) => m.id === modelId);
                      if (!model) return null;
                      const category = devicesData.categories.find((c) => c.id === model.categoryId);
                      const brand = category ? devicesData.brands.find((b) => b.id === category.brandId) : null;
                      if (brand && model) {
                        return `${brand.name} ${model.name}`;
                      }
                      return model ? model.name : null;
                    })
                    .filter(Boolean) as string[];

                  return (
                    <div
                      key={product.id}
                style={{
                        padding: 12,
                  borderRadius: 10,
                        border: "1px solid var(--border)",
                        background: "var(--panel)",
                        display: "flex",
                        flexDirection: "column",
                        gap: 8,
                      }}
                    >
                      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontWeight: 700, fontSize: 13, color: "var(--text)" }}>{product.name}</div>
                          <div style={{ fontSize: 11, color: "var(--muted)", marginTop: 2 }}>
                            Aktuální sklad: <span style={{ fontWeight: 600, color: product.stock > 0 ? "var(--accent)" : "rgba(239,68,68,0.9)" }}>{product.stock} ks</span>
                          </div>
                          {productModels.length > 0 && (
                            <div style={{ fontSize: 11, color: "var(--muted)", marginTop: 4 }}>
                              Modely: <span style={{ color: "var(--text)" }}>{productModels.join(", ")}</span>
                            </div>
                          )}
                        </div>
                        {isEditing ? (
                          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                            <button
                              onClick={() => {
                                const current = parseInt(stockChangeValue) || 0;
                                setStockChanges((prev) => ({ ...prev, [product.id]: String(current - 1) }));
                              }}
                              style={{
                                width: 32,
                                height: 32,
                                padding: 0,
                                borderRadius: 8,
                                border: "1px solid var(--border)",
                                background: "var(--panel-2)",
                                color: "var(--text)",
                                fontWeight: 700,
                                cursor: "pointer",
                                fontSize: 16,
                                display: "flex",
                                alignItems: "center",
                                justifyContent: "center",
                              }}
                            >
                              −
                            </button>
                    <input
                              type="number"
                              value={stockChangeValue}
                              onChange={(e) => setStockChanges((prev) => ({ ...prev, [product.id]: e.target.value }))}
                              placeholder="0"
                              autoFocus
                              style={{
                                width: 80,
                                padding: "6px 8px",
                                borderRadius: 8,
                                border: "1px solid var(--border)",
                                background: "var(--panel)",
                                color: "var(--text)",
                                outline: "none",
                                fontSize: 13,
                                textAlign: "center",
                                fontWeight: 600,
                              }}
                      onKeyDown={(e) => {
                                if (e.key === "Enter") {
                                  const change = parseInt(stockChangeValue) || 0;
                                  if (change !== 0) {
                                    setData((d) => ({
                                      ...d,
                                      products: d.products.map((p) =>
                                        p.id === product.id ? { ...p, stock: Math.max(0, p.stock + change) } : p
                                      ),
                                    }));
                                    showToast(change > 0 ? `Přidáno ${change} ks` : `Odebráno ${Math.abs(change)} ks`, "success");
                                  }
                                  setEditingStock(null);
                                  setStockChanges((prev) => {
                                    const next = { ...prev };
                                    delete next[product.id];
                                    return next;
                                  });
                                }
                                if (e.key === "Escape") {
                                  setEditingStock(null);
                                  setStockChanges((prev) => {
                                    const next = { ...prev };
                                    delete next[product.id];
                                    return next;
                                  });
                                }
                              }}
                              onBlur={() => {
                                const change = parseInt(stockChangeValue) || 0;
                                if (change !== 0) {
                                  setData((d) => ({
                                    ...d,
                                    products: d.products.map((p) =>
                                      p.id === product.id ? { ...p, stock: Math.max(0, p.stock + change) } : p
                                    ),
                                  }));
                                  showToast(change > 0 ? `Přidáno ${change} ks` : `Odebráno ${Math.abs(change)} ks`, "success");
                                }
                                setEditingStock(null);
                                setStockChanges((prev) => {
                                  const next = { ...prev };
                                  delete next[product.id];
                                  return next;
                                });
                              }}
                            />
                            <button
                    onClick={() => {
                                const current = parseInt(stockChangeValue) || 0;
                                setStockChanges((prev) => ({ ...prev, [product.id]: String(current + 1) }));
                              }}
                        style={{
                                width: 32,
                                height: 32,
                                padding: 0,
                                borderRadius: 8,
                                border: "1px solid var(--border)",
                                background: "var(--panel-2)",
                                color: "var(--text)",
                                fontWeight: 700,
                                cursor: "pointer",
                          fontSize: 16,
                                display: "flex",
                                alignItems: "center",
                                justifyContent: "center",
                              }}
                            >
                              +
                      </button>
                      <button
                              onClick={() => {
                                const change = parseInt(stockChangeValue) || 0;
                                if (change !== 0) {
                                  setData((d) => ({
                                    ...d,
                                    products: d.products.map((p) =>
                                      p.id === product.id ? { ...p, stock: Math.max(0, p.stock + change) } : p
                                    ),
                                  }));
                                  showToast(change > 0 ? `Přidáno ${change} ks` : `Odebráno ${Math.abs(change)} ks`, "success");
                                }
                                setEditingStock(null);
                                setStockChanges((prev) => {
                                  const next = { ...prev };
                                  delete next[product.id];
                                  return next;
                                });
                              }}
                        style={{
                                padding: "8px 12px",
                                borderRadius: 8,
                          border: "none",
                                background: "var(--accent)",
                                color: "white",
                                fontWeight: 700,
                                cursor: "pointer",
                                fontSize: 12,
                                marginLeft: 4,
                              }}
                            >
                              ✓
                      </button>
                      <button
                              onClick={() => {
                                setEditingStock(null);
                                setStockChanges((prev) => {
                                  const next = { ...prev };
                                  delete next[product.id];
                                  return next;
                                });
                        }}
                        style={{
                                padding: "8px 12px",
                                borderRadius: 8,
                                border: "1px solid var(--border)",
                                background: "var(--panel)",
                                color: "var(--text)",
                                fontWeight: 700,
                          cursor: "pointer",
                                fontSize: 12,
                        }}
                      >
                              ✕
                      </button>
                          </div>
                        ) : canAdjustInventoryQuantity ? (
                      <button
                            onClick={() => setEditingStock(product.id)}
                        style={{
                              padding: "8px 14px",
                              borderRadius: 8,
                              border: "1px solid var(--accent)",
                              background: "var(--accent-soft)",
                              color: "var(--accent)",
                              fontWeight: 700,
                          cursor: "pointer",
                              fontSize: 12,
                              whiteSpace: "nowrap",
                        }}
                      >
                            Upravit sklad
                      </button>
                        ) : null}
                    </div>
                  </div>
                  );
                })}
              </div>
            );
          })()}
        </div>
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
        {/* First row: Brands and Categories */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: 16 }}>
        {/* BRANDS */}
        <div style={card}>
            <div style={{ fontWeight: 950, fontSize: 14, marginBottom: 12 }}>
              Značky
              <div style={{ fontSize: 11, color: "var(--muted)", fontWeight: 400, marginTop: 4 }}>
                (spravováno v Zařízení)
              </div>
          </div>

            <div style={{ display: "flex", flexDirection: "column", gap: 6, overflowY: "auto", flex: 1 }}>
            {devicesData.brands.map((b) => (
              <div
                key={b.id}
                style={{
                  padding: "10px 12px",
                  borderRadius: 10,
                  border,
                  background: selectedBrandId === b.id ? "var(--accent-soft)" : "var(--panel)",
                  color: selectedBrandId === b.id ? "var(--accent)" : "var(--text)",
                  fontWeight: 600,
                  fontSize: 13,
                }}
              >
                  <div
                    onClick={() => {
                      if (selectedBrandId === b.id) {
                        setSelectedBrandId(null);
                        setSelectedCategoryId(null);
                        setSelectedModelId(null);
                      } else {
                      setSelectedBrandId(b.id);
                      setSelectedCategoryId(null);
                      setSelectedModelId(null);
                      }
                    }}
                    style={{ cursor: "pointer", display: "flex", justifyContent: "space-between", alignItems: "center" }}
                  >
                    <span>{b.name}</span>
                    </div>
              </div>
            ))}
          </div>
        </div>

        {/* CATEGORIES */}
        <div style={card}>
          <div style={{ fontWeight: 950, fontSize: 14, marginBottom: 12 }}>
            Kategorie {selectedBrand && `· ${selectedBrand.name}`}
              <div style={{ fontSize: 11, color: "var(--muted)", fontWeight: 400, marginTop: 4 }}>
                (spravováno v Zařízení)
              </div>
          </div>

          {selectedBrandId && (
            <>
                <div style={{ display: "flex", flexDirection: "column", gap: 6, overflowY: "auto", flex: 1 }}>
                {filteredCategories.map((c) => (
                  <div
                    key={c.id}
                    style={{
                      padding: "10px 12px",
                      borderRadius: 10,
                      border,
                      background: selectedCategoryId === c.id ? "var(--accent-soft)" : "var(--panel)",
                      color: selectedCategoryId === c.id ? "var(--accent)" : "var(--text)",
                      fontWeight: 600,
                      fontSize: 13,
                    }}
                  >
                      <div
                        onClick={() => {
                          if (selectedCategoryId === c.id) {
                            setSelectedCategoryId(null);
                            setSelectedModelId(null);
                          } else {
                          setSelectedCategoryId(c.id);
                          setSelectedModelId(null);
                          }
                        }}
                      style={{ cursor: "pointer" }}
                      >
                        <span>{c.name}</span>
                        </div>
                  </div>
                ))}
              </div>
            </>
          )}

          {!selectedBrandId && (
            <div style={{ color: "var(--muted)", fontSize: 13, textAlign: "center", padding: 20 }}>
              Vyberte značku
            </div>
          )}
          </div>
        </div>

        {/* Second row: Models, Categories and Products */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 2fr", gap: 16 }}>
        {/* MODELS */}
          <div style={{ ...card, maxHeight: "400px" }}>
          <div style={{ fontWeight: 950, fontSize: 14, marginBottom: 12 }}>
            Modely {selectedCategory && `· ${selectedCategory.name}`}
              <div style={{ fontSize: 11, color: "var(--muted)", fontWeight: 400, marginTop: 4 }}>
                (spravováno v Zařízení)
              </div>
          </div>

          {selectedCategoryId && (
            <>
                <div style={{ display: "flex", flexDirection: "column", gap: 6, overflowY: "auto", flex: 1 }}>
                {filteredModels.map((m) => (
                  <div
                    key={m.id}
                    style={{
                      padding: "10px 12px",
                      borderRadius: 10,
                      border,
                      background: selectedModelId === m.id ? "var(--accent-soft)" : "var(--panel)",
                      color: selectedModelId === m.id ? "var(--accent)" : "var(--text)",
                      fontWeight: 600,
                      fontSize: 13,
                    }}
                  >
                    <div
                      onClick={() => {
                        if (selectedModelId === m.id) {
                          setSelectedModelId(null);
                        } else {
                          setSelectedModelId(m.id);
                        }
                      }}
                      style={{ cursor: "pointer" }}
                    >
                      <span>{m.name}</span>
                    </div>
                  </div>
                ))}
              </div>
            </>
          )}

            {!selectedCategoryId && (
              <div style={{ color: "var(--muted)", fontSize: 13, textAlign: "center", padding: 20 }}>
                Vyberte kategorii
              </div>
            )}
          </div>

          {/* PRODUCT CATEGORIES */}
          <div style={{ ...card, maxHeight: "400px" }}>
            <div style={{ fontWeight: 950, fontSize: 14, marginBottom: 12 }}>
              Kategorie produktů
            </div>

              <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
                <input
                placeholder="Nová kategorie…"
                value={newProductCategoryName}
                onChange={(e) => setNewProductCategoryName(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && addProductCategory()}
                  style={inputStyle}
                />
              <button onClick={addProductCategory} style={primaryBtn}>
                  +
                </button>
              </div>

            <div style={{ display: "flex", flexDirection: "column", gap: 6, overflowY: "auto", flex: 1 }}>
              {data.productCategories.map((c) => (
                <div
                  key={c.id}
                    style={{
                      padding: "10px 12px",
                      borderRadius: 10,
                    border,
                    background: selectedProductCategoryId === c.id ? "var(--accent-soft)" : "var(--panel)",
                    color: selectedProductCategoryId === c.id ? "var(--accent)" : "var(--text)",
                      fontWeight: 600,
                      fontSize: 13,
                    }}
                  >
                  {editingProductCategory === c.id ? (
                      <div style={{ display: "flex", gap: 6 }}>
                        <input
                        value={editProductCategoryName}
                        onChange={(e) => setEditProductCategoryName(e.target.value)}
                          onKeyDown={(e) => {
                          if (e.key === "Enter") updateProductCategory(c.id, editProductCategoryName);
                          if (e.key === "Escape") setEditingProductCategory(null);
                          }}
                          style={{ ...inputStyle, fontSize: 13, padding: "6px 10px" }}
                          autoFocus
                        />
                      <button onClick={() => updateProductCategory(c.id, editProductCategoryName)} style={{ ...primaryBtn, padding: "6px 10px" }}>
                          ✓
                        </button>
                      <button onClick={() => setEditingProductCategory(null)} style={{ ...softBtn, padding: "6px 10px" }}>
                          ✕
                        </button>
                      </div>
                    ) : (
                    <div>
                      <div
                        onClick={() => setSelectedProductCategoryId(selectedProductCategoryId === c.id ? null : c.id)}
                        style={{ cursor: "pointer", display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}
                      >
                        <span>{c.name}</span>
                        <div style={{ display: "flex", gap: 4 }}>
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              setEditProductCategoryName(c.name);
                              setEditingProductCategory(c.id);
                            }}
                            style={arrowBtn(false)}
                            title="Upravit"
                          >
                            ✎
                          </button>
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              deleteProductCategory(c.id);
                            }}
                            style={{ ...arrowBtn(false), color: "rgba(239,68,68,0.8)" }}
                            title="Smazat"
                          >
                            ×
                          </button>
                        </div>
                      </div>
                      {/* Toggle pro modely */}
                      {selectedCategoryId && filteredModels.length > 0 && (
                        <div style={{ display: "flex", flexDirection: "column", gap: 4, marginTop: 8, paddingTop: 8, borderTop: "1px solid var(--border)" }}>
                          <div style={{ fontSize: 11, color: "var(--muted)", marginBottom: 4 }}>Použít u modelů:</div>
                          {filteredModels.map((model) => (
                            <label
                              key={model.id}
                              style={{
                                display: "flex",
                                alignItems: "center",
                                gap: 8,
                                cursor: "pointer",
                                fontSize: 12,
                              }}
                              onClick={(e) => e.stopPropagation()}
                            >
                              <div
                                style={{
                                  width: 44,
                                  height: 24,
                                  borderRadius: 12,
                                  background: (c.modelIds || []).includes(model.id) ? "var(--accent)" : "var(--panel-2)",
                                  position: "relative",
                                  transition: "background 200ms ease",
                                  cursor: "pointer",
                                }}
                                onClick={() => toggleProductCategoryForModel(c.id, model.id)}
                              >
                                <div
                                  style={{
                                    width: 20,
                                    height: 20,
                                    borderRadius: "50%",
                                    background: "white",
                                    position: "absolute",
                                    top: 2,
                                    left: (c.modelIds || []).includes(model.id) ? 22 : 2,
                                    transition: "left 200ms ease",
                                    boxShadow: "0 2px 4px rgba(0,0,0,0.2)",
                                  }}
                                />
                  </div>
                              <span style={{ color: "var(--text)" }}>{model.name}</span>
                            </label>
                ))}
              </div>
                      )}
                    </div>
                  )}
                </div>
              ))}
              {data.productCategories.length === 0 && (
            <div style={{ color: "var(--muted)", fontSize: 13, textAlign: "center", padding: 20 }}>
                  Žádné kategorie
            </div>
          )}
            </div>
        </div>

        {/* PRODUCTS */}
          <div style={{ ...card, maxHeight: "none" }}>
          <div style={{ fontWeight: 950, fontSize: 14, marginBottom: 4 }}>
              {selectedModelId && selectedModel
                ? `Přidání produktu · ${selectedModel.name}`
                : "Přidání nezávislého produktu (bez přiřazení k modelu)"}
          </div>
          {!selectedModelId && (
            <div style={{ color: "var(--muted)", fontSize: 12, marginBottom: 12 }}>
              Produkt nebude přiřazen k žádnému modelu zařízení. Můžete ho později přiřadit v editaci, nebo vyberte vlevo model a přidejte produkt k němu.
            </div>
          )}
              <div style={{ display: "grid", gap: 8, marginBottom: 12 }}>
                <input
                  placeholder="Název produktu…"
                  value={newProduct.name}
                  onChange={(e) => setNewProduct((p) => ({ ...p, name: e.target.value }))}
                  style={inputStyle}
                />
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                  <input
                    placeholder="Sklad (ks)"
                    type="number"
                    value={newProduct.stock}
                    onChange={(e) => setNewProduct((p) => ({ ...p, stock: e.target.value }))}
                    style={inputStyle}
                  />
                  <input
                    placeholder="Cena (Kč)"
                    type="number"
                    value={newProduct.price}
                    onChange={(e) => setNewProduct((p) => ({ ...p, price: e.target.value }))}
                    style={inputStyle}
                  />
                </div>
                <input
                  placeholder="SKU (volitelné)"
                  value={newProduct.sku}
                  onChange={(e) => setNewProduct((p) => ({ ...p, sku: e.target.value }))}
                  style={inputStyle}
                />
                <textarea
                  placeholder="Popis (volitelné)…"
                  value={newProduct.description}
                  onChange={(e) => setNewProduct((p) => ({ ...p, description: e.target.value }))}
                  style={{ ...inputStyle, minHeight: 60, resize: "vertical" }}
                />
                  <div>
                    <label style={{ fontSize: 12, color: "var(--muted)", marginBottom: 4, display: "block" }}>
                      Kategorie produktu (volitelné)
                    </label>
                    <select
                      value={newProduct.categoryId}
                      onChange={(e) => setNewProduct((p) => ({ ...p, categoryId: e.target.value }))}
                      style={inputStyle}
                    >
                      <option value="">Bez kategorie</option>
                      {data.productCategories
                        .filter((cat) => !selectedModelId || (cat.modelIds || []).includes(selectedModelId))
                        .map((cat) => (
                          <option key={cat.id} value={cat.id}>
                            {cat.name}
                          </option>
                        ))}
                    </select>
                  </div>
                  <div>
                    <label style={{ fontSize: 12, color: "var(--muted)", marginBottom: 4, display: "block" }}>
                      Obrázek produktu (volitelné)
                    </label>
                    <input
                      type="file"
                      accept="image/*"
                      onChange={(e) => handleImageUpload(e, false)}
                      style={{ ...inputStyle, padding: "8px 12px" }}
                    />
                    {newProduct.imageUrl && (
                      <div style={{ marginTop: 8 }}>
                        <img src={newProduct.imageUrl} alt="Preview" style={{ maxWidth: "100%", maxHeight: 150, borderRadius: 8, border }} />
                        <button
                          onClick={() => setNewProduct((p) => ({ ...p, imageUrl: "" }))}
                          style={{ ...dangerBtn, marginTop: 8, padding: "6px 10px", fontSize: 12 }}
                        >
                          Odstranit obrázek
                        </button>
                      </div>
                    )}
                  </div>
                  {availableRepairs.length > 0 && (
                    <div>
                      <label style={{ fontSize: 12, color: "var(--muted)", marginBottom: 4, display: "block" }}>
                        Používá se u oprav (volitelné)
                      </label>
                      <div style={{ display: "flex", flexDirection: "column", gap: 6, maxHeight: 150, overflowY: "auto", padding: 8, border, borderRadius: 8 }}>
                        {availableRepairs.map((repair) => (
                          <label key={repair.id} style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer" }}>
                            <input
                              type="checkbox"
                              checked={newProduct.repairIds.includes(repair.id)}
                              onChange={(e) => {
                                if (e.target.checked) {
                                  setNewProduct((p) => ({ ...p, repairIds: [...p.repairIds, repair.id] }));
                                } else {
                                  setNewProduct((p) => ({ ...p, repairIds: p.repairIds.filter((id) => id !== repair.id) }));
                                }
                              }}
                            />
                            <span style={{ fontSize: 13 }}>{repair.name}</span>
                          </label>
                        ))}
                      </div>
                    </div>
                  )}
                <button onClick={addProduct} style={primaryBtn} disabled={!newProduct.name.trim()}>
                  {selectedModelId ? "Přidat produkt k modelu" : "Přidat nezávislý produkt"}
                </button>
              </div>
          </div>
        </div>

        {/* Product List - Full Width */}
        <div style={{ ...card, marginTop: 32 }}>
          <div style={{ fontWeight: 950, fontSize: 16, marginBottom: 16, color: "var(--text)" }}>
            Seznam produktů
          </div>

          {/* Filters */}
          <div style={{ display: "flex", gap: 12, marginBottom: 16, alignItems: "center", flexWrap: "wrap" }}>
            <input
              placeholder="Hledat produkt (název, SKU, popis)…"
              value={productSearchQuery}
              onChange={(e) => setProductSearchQuery(e.target.value)}
              style={{ ...inputStyle, flex: "1 1 300px" }}
            />
            <ProductFilterPicker value={productStockFilter} onChange={setProductStockFilter} />
            <ProductDisplayModePicker value={productDisplayMode} onChange={setProductDisplayMode} />
          </div>

          {/* Active filters info */}
          {(selectedBrandId || selectedCategoryId || selectedModelId || selectedProductCategoryId) && (
            <div style={{ 
              display: "flex", 
              flexWrap: "wrap", 
              gap: 8, 
              marginBottom: 16,
              padding: 12,
              background: "var(--panel-2)",
              borderRadius: 10,
              border,
            }}>
              <div style={{ fontSize: 12, color: "var(--muted)", fontWeight: 700 }}>Aktivní filtry:</div>
              {selectedBrandId && (
                <div style={{ 
                  padding: "4px 10px", 
                  background: "var(--accent-soft)", 
                  borderRadius: 6, 
                  fontSize: 12,
                  display: "flex",
                  alignItems: "center",
                  gap: 6,
                }}>
                  <span>Značka: {devicesData.brands.find((b) => b.id === selectedBrandId)?.name}</span>
                  <button
                    onClick={() => {
                      setSelectedBrandId(null);
                      setSelectedCategoryId(null);
                      setSelectedModelId(null);
                    }}
                    style={{ background: "none", border: "none", color: "var(--accent)", cursor: "pointer", fontSize: 14, padding: 0, width: 16, height: 16 }}
                  >
                    ×
                  </button>
                </div>
              )}
              {selectedCategoryId && (
                <div style={{ 
                  padding: "4px 10px", 
                  background: "var(--accent-soft)", 
                  borderRadius: 6, 
                  fontSize: 12,
                  display: "flex",
                  alignItems: "center",
                  gap: 6,
                }}>
                  <span>Kategorie: {devicesData.categories.find((c) => c.id === selectedCategoryId)?.name}</span>
                  <button
                    onClick={() => {
                      setSelectedCategoryId(null);
                      setSelectedModelId(null);
                    }}
                    style={{ background: "none", border: "none", color: "var(--accent)", cursor: "pointer", fontSize: 14, padding: 0, width: 16, height: 16 }}
                  >
                    ×
                  </button>
                </div>
              )}
              {selectedModelId && (
                <div style={{ 
                  padding: "4px 10px", 
                  background: "var(--accent-soft)", 
                  borderRadius: 6, 
                  fontSize: 12,
                  display: "flex",
                  alignItems: "center",
                  gap: 6,
                }}>
                  <span>Model: {devicesData.models.find((m) => m.id === selectedModelId)?.name}</span>
                  <button
                    onClick={() => setSelectedModelId(null)}
                    style={{ background: "none", border: "none", color: "var(--accent)", cursor: "pointer", fontSize: 14, padding: 0, width: 16, height: 16 }}
                  >
                    ×
                  </button>
                </div>
              )}
              {selectedProductCategoryId && (
                <div style={{ 
                  padding: "4px 10px", 
                  background: "var(--accent-soft)", 
                  borderRadius: 6, 
                  fontSize: 12,
                  display: "flex",
                  alignItems: "center",
                  gap: 6,
                }}>
                  <span>Kategorie produktu: {data.productCategories.find((c) => c.id === selectedProductCategoryId)?.name}</span>
                  <button
                    onClick={() => setSelectedProductCategoryId(null)}
                    style={{ background: "none", border: "none", color: "var(--accent)", cursor: "pointer", fontSize: 14, padding: 0, width: 16, height: 16 }}
                  >
                    ×
                  </button>
                </div>
              )}
            </div>
          )}

          {/* Products Display */}
          <div style={{ 
            display: productDisplayMode === "grid" ? "grid" : "flex",
            gridTemplateColumns: productDisplayMode === "grid" ? "repeat(auto-fill, minmax(300px, 1fr))" : undefined,
            flexWrap: productDisplayMode === "grid" ? undefined : productDisplayMode === "list" ? "nowrap" : "wrap",
            flexDirection: productDisplayMode === "list" ? "column" : "row",
            gap: productDisplayMode === "compact" ? 8 : 16,
            alignItems: productDisplayMode === "grid" ? "stretch" : undefined
          }}>
            {filteredProducts.map((p) => {
              const productModels = devicesData.models.filter((m) => p.modelIds.includes(m.id));
              const productCategory = p.categoryId ? data.productCategories.find((c) => c.id === p.categoryId) : null;
              const isEditing = editingProduct === p.id;
              const availableRepairsForProduct = (devicesData.repairs || []).filter((r: any) => r.modelIds && productModels.some((m) => r.modelIds.includes(m.id)));
              const hasNoModels = p.modelIds.length === 0;
              
              return (
                <div
                  key={p.id}
                    style={{
                    padding: productDisplayMode === "compact" ? 12 : 16,
                    borderRadius: 12,
                    border: hasNoModels ? "1px solid var(--border)" : border,
                      background: "var(--panel)",
                    display: productDisplayMode === "list" ? "grid" : "flex",
                    gridTemplateColumns: productDisplayMode === "list" ? "2fr 1fr 1fr 1fr auto" : undefined,
                    flexDirection: productDisplayMode === "list" ? "row" : "column",
                    gap: productDisplayMode === "compact" ? 8 : 12,
                    flex: productDisplayMode === "grid" ? "1 1 auto" : productDisplayMode === "list" ? "0 0 auto" : "1 1 250px",
                    minWidth: productDisplayMode === "list" ? "100%" : 0,
                    height: productDisplayMode === "grid" ? "100%" : productDisplayMode === "compact" ? "auto" : "auto",
                    minHeight: productDisplayMode === "grid" ? 320 : productDisplayMode === "compact" ? 220 : "auto",
                    position: "relative",
                    alignItems: productDisplayMode === "list" ? "center" : "stretch",
                  }}
                >
                  {isEditing ? (
                      <div style={{ display: "grid", gap: 8 }}>
                        <input
                          placeholder="Název produktu…"
                          value={editProductData.name}
                        onChange={(e) => setEditProductData((d) => ({ ...d, name: e.target.value }))}
                          style={{ ...inputStyle, fontSize: 13, padding: "8px 10px" }}
                        />
                        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                          <input
                            placeholder="Sklad (ks)"
                            type="number"
                            value={editProductData.stock}
                          onChange={(e) => setEditProductData((d) => ({ ...d, stock: e.target.value }))}
                            style={{ ...inputStyle, fontSize: 13, padding: "8px 10px" }}
                          />
                          <input
                            placeholder="Cena (Kč)"
                            type="number"
                            value={editProductData.price}
                          onChange={(e) => setEditProductData((d) => ({ ...d, price: e.target.value }))}
                            style={{ ...inputStyle, fontSize: 13, padding: "8px 10px" }}
                          />
                        </div>
                        <input
                          placeholder="SKU (volitelné)"
                          value={editProductData.sku}
                        onChange={(e) => setEditProductData((d) => ({ ...d, sku: e.target.value }))}
                          style={{ ...inputStyle, fontSize: 13, padding: "8px 10px" }}
                        />
                        <textarea
                          placeholder="Popis (volitelné)…"
                          value={editProductData.description}
                        onChange={(e) => setEditProductData((d) => ({ ...d, description: e.target.value }))}
                        style={{ ...inputStyle, minHeight: 60, resize: "vertical", fontSize: 13, padding: "8px 10px" }}
                      />
                      <div>
                        <label style={{ fontSize: 12, color: "var(--muted)", marginBottom: 4, display: "block" }}>
                          Modely (samodoplnovací výběr)
                        </label>
                        <div style={{ position: "relative" }}>
                          <input
                            placeholder="Hledat model (např. dyson)…"
                            value={editProductData.modelSearch}
                            onChange={(e) => setEditProductData((d) => ({ ...d, modelSearch: e.target.value }))}
                            style={{ ...inputStyle, fontSize: 13, padding: "8px 10px" }}
                          />
                          {editProductData.modelSearch && (
                            <div style={{ position: "absolute", top: "100%", left: 0, right: 0, zIndex: 1000, background: "var(--panel)", border, borderRadius: 8, marginTop: 4, maxHeight: 200, overflowY: "auto" }}>
                              {devicesData.models
                                .filter((m) =>
                                  m.name.toLowerCase().includes(editProductData.modelSearch.toLowerCase()) &&
                                  !editProductData.modelIds.includes(m.id)
                                )
                                .slice(0, 10)
                                .map((m) => (
                                  <div
                                    key={m.id}
                                    onClick={() => {
                                      setEditProductData((prev) => ({
                                        ...prev,
                                        modelIds: [...prev.modelIds, m.id],
                                        modelSearch: "",
                                      }));
                                    }}
                                    style={{
                                      padding: "8px 12px",
                                      cursor: "pointer",
                                      fontSize: 13,
                                      borderBottom: border,
                                    }}
                                    onMouseEnter={(e) => {
                                      e.currentTarget.style.background = "var(--accent-soft)";
                                    }}
                                    onMouseLeave={(e) => {
                                      e.currentTarget.style.background = "transparent";
                                    }}
                                  >
                                    {m.name}
                                  </div>
                                ))}
                            </div>
                          )}
                        </div>
                        {editProductData.modelIds.length > 0 && (
                          <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 8 }}>
                            {editProductData.modelIds.map((mid) => {
                              const model = devicesData.models.find((m) => m.id === mid);
                              if (!model) return null;
                              return (
                                <div
                                  key={mid}
                                  style={{
                                    padding: "4px 10px",
                                    background: "var(--accent-soft)",
                                    borderRadius: 6,
                                    fontSize: 12,
                                    display: "flex",
                                    alignItems: "center",
                                    gap: 6,
                                  }}
                                >
                                  <span>{model.name}</span>
                                  <button
                                    onClick={() => {
                                      setEditProductData((prev) => ({
                                        ...prev,
                                        modelIds: prev.modelIds.filter((id) => id !== mid),
                                      }));
                                    }}
                                    style={{
                                      background: "none",
                                      border: "none",
                                      color: "var(--accent)",
                                      cursor: "pointer",
                                      fontSize: 14,
                                      padding: 0,
                                      width: 16,
                                      height: 16,
                                      display: "flex",
                                      alignItems: "center",
                                      justifyContent: "center",
                                    }}
                                  >
                                    ×
                                  </button>
                                </div>
                              );
                            })}
                          </div>
                        )}
                      </div>
                      <div>
                        <label style={{ fontSize: 12, color: "var(--muted)", marginBottom: 4, display: "block" }}>
                          Kategorie produktu (volitelné)
                        </label>
                        <select
                          value={editProductData.categoryId}
                          onChange={(e) => setEditProductData((d) => ({ ...d, categoryId: e.target.value }))}
                          style={{ ...inputStyle, fontSize: 13, padding: "8px 10px" }}
                        >
                          <option value="">Bez kategorie</option>
                          {data.productCategories
                            .filter((cat) => {
                              const product = data.products.find((p) => editingProduct === p.id);
                              if (!product) return true;
                              if (product.modelIds.length === 0) return true;
                              return product.modelIds.some((mid) => (cat.modelIds || []).includes(mid));
                            })
                            .map((cat) => (
                              <option key={cat.id} value={cat.id}>
                                {cat.name}
                              </option>
                            ))}
                        </select>
                      </div>
                      <div>
                        <label style={{ fontSize: 12, color: "var(--muted)", marginBottom: 4, display: "block" }}>
                          Obrázek produktu (volitelné)
                        </label>
                        <input
                          type="file"
                          accept="image/*"
                          onChange={(e) => handleImageUpload(e, true)}
                          style={{ ...inputStyle, fontSize: 13, padding: "8px 10px" }}
                        />
                        {editProductData.imageUrl && (
                          <div style={{ marginTop: 8 }}>
                            <img src={editProductData.imageUrl} alt="Preview" style={{ maxWidth: "100%", maxHeight: 150, borderRadius: 8, border }} />
                            <button
                              onClick={() => setEditProductData((d) => ({ ...d, imageUrl: "" }))}
                              style={{ ...dangerBtn, marginTop: 8, padding: "6px 10px", fontSize: 12 }}
                            >
                              Odstranit obrázek
                            </button>
                          </div>
                        )}
                      </div>
                      {availableRepairsForProduct.length > 0 && (
                        <div>
                          <label style={{ fontSize: 12, color: "var(--muted)", marginBottom: 4, display: "block" }}>
                            Používá se u oprav (volitelné)
                          </label>
                          <div style={{ display: "flex", flexDirection: "column", gap: 6, maxHeight: 150, overflowY: "auto", padding: 8, border, borderRadius: 8 }}>
                            {availableRepairsForProduct.map((repair) => (
                              <label key={repair.id} style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer" }}>
                                <input
                                  type="checkbox"
                                  checked={editProductData.repairIds.includes(repair.id)}
                                  onChange={(e) => {
                                    if (e.target.checked) {
                                      setEditProductData((d) => ({ ...d, repairIds: [...d.repairIds, repair.id] }));
                                    } else {
                                      setEditProductData((d) => ({ ...d, repairIds: d.repairIds.filter((id) => id !== repair.id) }));
                                    }
                                  }}
                                />
                                <span style={{ fontSize: 13 }}>{repair.name}</span>
                              </label>
                            ))}
                          </div>
                        </div>
                      )}
                        <div style={{ display: "flex", gap: 6 }}>
                          <button onClick={() => updateProduct(p.id, editProductData)} style={{ ...primaryBtn, padding: "8px 12px", flex: 1 }}>
                            Uložit
                          </button>
                          <button onClick={() => setEditingProduct(null)} style={{ ...softBtn, padding: "8px 12px" }}>
                            Zrušit
                          </button>
                        </div>
                      </div>
                    ) : productDisplayMode === "list" ? (
                      <>
                        <div style={{ display: "contents" }}>
                          <div>
                            <div style={{ fontWeight: 950, fontSize: 14, color: "var(--text)", marginBottom: 2, display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                              <span>{p.name}</span>
                              {hasNoModels && (
                                <span style={{
                                  padding: "2px 6px",
                                  background: "var(--accent-soft)",
                                  borderRadius: 4,
                                  fontSize: 9,
                                  fontWeight: 700,
                                  color: "var(--muted)",
                                }}>
                                  Nezávislý produkt
                                </span>
                              )}
                          </div>
                            <div style={{ fontSize: 11, color: "var(--muted)" }}>
                              {productModels.length > 0 ? productModels.map((m) => m.name).join(", ") : "—"}
                            </div>
                        {p.sku && (
                              <div style={{ fontSize: 11, color: "var(--muted)", marginTop: 2 }}>
                            SKU: {p.sku}
                          </div>
                        )}
                          </div>
                          <div style={{ fontSize: 13, fontWeight: 700, color: p.stock === 0 ? "rgba(239,68,68,0.9)" : p.stock < 5 ? "rgba(251,191,36,0.9)" : "var(--text)" }}>
                            {p.stock} ks
                          </div>
                          <div style={{ fontSize: 13, color: "var(--text)" }}>
                            {p.price} Kč
                          </div>
                          <div style={{ fontSize: 11, color: "var(--muted)" }}>
                            {productCategory?.name || "—"}
                          </div>
                          <div style={{ display: "flex", gap: 6 }}>
                            <button
                              onClick={() => {
                                setEditProductData({ 
                                  name: p.name, 
                                  stock: String(p.stock), 
                                  price: String(p.price), 
                                  sku: p.sku || "", 
                                  description: p.description || "", 
                                  imageUrl: p.imageUrl || "", 
                                  repairIds: p.repairIds || [],
                                  categoryId: p.categoryId || "",
                                  modelIds: p.modelIds || [],
                                  modelSearch: "",
                                });
                                setEditingProduct(p.id);
                              }}
                              style={{ ...softBtn, padding: "6px 10px", fontSize: 11 }}
                            >
                              Upravit
                            </button>
                            <button
                              onClick={() => deleteProduct(p.id)}
                              style={{ ...dangerBtn, padding: "6px 10px", fontSize: 11 }}
                            >
                              Smazat
                            </button>
                          </div>
                        </div>
                      </>
                    ) : (
                      <>
                      {p.imageUrl && productDisplayMode !== "compact" && (
                        <div style={{ width: "100%", aspectRatio: "16/9", borderRadius: 8, overflow: "hidden", background: "var(--panel-2)" }}>
                          <img src={p.imageUrl} alt={p.name} style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                          </div>
                      )}
                      
                      <div>
                        <div style={{ fontWeight: 950, fontSize: productDisplayMode === "compact" ? 13 : 15, color: "var(--text)", marginBottom: 4, display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                          <span>{p.name}</span>
                          {hasNoModels && (
                            <span style={{
                              padding: "2px 6px",
                              background: "var(--accent-soft)",
                              borderRadius: 4,
                              fontSize: 9,
                              fontWeight: 700,
                              color: "var(--muted)",
                            }}>
                              Nezávislý produkt
                            </span>
                    )}
                  </div>
                        {productCategory && productDisplayMode !== "compact" && (
                          <div style={{ fontSize: 11, color: "var(--muted)", marginBottom: 4 }}>
                            {productCategory.name}
              </div>
                        )}
                        {productModels.length > 0 && (
                          <div style={{ fontSize: productDisplayMode === "compact" ? 10 : 11, color: "var(--muted)", marginBottom: 4 }}>
                            Modely: {productModels.map((m) => m.name).join(", ")}
                          </div>
                        )}
                      </div>

                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", paddingTop: 8, borderTop: border, marginTop: "auto" }}>
                        <div>
                          <div style={{ fontSize: productDisplayMode === "compact" ? 12 : 13, fontWeight: 700, color: p.stock === 0 ? "rgba(239,68,68,0.9)" : p.stock < 5 ? "rgba(251,191,36,0.9)" : "var(--text)" }}>
                            Sklad: {p.stock} ks
                          </div>
                          <div style={{ fontSize: productDisplayMode === "compact" ? 12 : 13, color: "var(--muted)" }}>
                            {p.price} Kč
                          </div>
                        </div>
                        <div style={{ display: "flex", gap: 6 }}>
                          <button
                            onClick={() => {
                              setEditProductData({ 
                                name: p.name, 
                                stock: String(p.stock), 
                                price: String(p.price), 
                                sku: p.sku || "", 
                                description: p.description || "", 
                                imageUrl: p.imageUrl || "", 
                                repairIds: p.repairIds || [],
                                categoryId: p.categoryId || "",
                                modelIds: p.modelIds || [],
                                modelSearch: "",
                              });
                              setEditingProduct(p.id);
                            }}
                            style={{ ...softBtn, padding: productDisplayMode === "compact" ? "6px 10px" : "8px 12px", fontSize: productDisplayMode === "compact" ? 11 : 12 }}
                          >
                            Upravit
                          </button>
                          <button
                            onClick={() => deleteProduct(p.id)}
                            style={{ ...dangerBtn, padding: productDisplayMode === "compact" ? "6px 10px" : "8px 12px", fontSize: productDisplayMode === "compact" ? 11 : 12 }}
                          >
                            Smazat
                          </button>
                        </div>
                      </div>

                        {p.sku && productDisplayMode !== "compact" && (
                        <div style={{ fontSize: 11, color: "var(--muted)" }}>
                            SKU: {p.sku}
                          </div>
                        )}
                        {p.description && productDisplayMode !== "compact" && (
                        <div style={{ fontSize: 12, color: "var(--muted)", lineHeight: 1.4 }}>
                          {p.description}
                        </div>
                        )}
            </>
          )}
                  </div>
              );
            })}
              </div>

          {filteredProducts.length === 0 && (
            <div style={{ 
              padding: 40, 
              textAlign: "center", 
              color: "var(--muted)",
              fontSize: 14,
            }}>
              {productSearchQuery || selectedBrandId || selectedCategoryId || selectedModelId || selectedProductCategoryId || productStockFilter !== "all"
                ? "Žádné produkty neodpovídají zvoleným filtrům"
                : "Zatím nebyly přidány žádné produkty"}
            </div>
          )}
        </div>
      </div>

      {/* ConfirmDialog for low stock warning */}
      <ConfirmDialog
        open={lowStockDialogOpen}
        title="Upozornění na sklad"
        message="Počet produktů na skladě bude menší než 1. Chcete pokračovat?"
        confirmLabel="Pokračovat"
        cancelLabel="Zrušit"
        variant="default"
        onConfirm={() => {
          if (lowStockCallback) {
            lowStockCallback();
            setLowStockCallback(null);
          }
          setLowStockDialogOpen(false);
        }}
        onCancel={() => {
          setLowStockDialogOpen(false);
          setLowStockCallback(null);
        }}
      />
    </div>
  );
}