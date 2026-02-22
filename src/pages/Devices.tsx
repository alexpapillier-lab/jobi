import React, { useEffect, useRef, useState, useMemo } from "react";
import { showToast } from "../components/Toast";
import { STORAGE_KEYS, getDevicesKey, getInventoryKey } from "../constants/storageKeys";
import { loadDevicesFromDb, saveDevicesToDb } from "../lib/devicesDb";
import { loadInventoryFromDb, saveInventoryToDb } from "../lib/inventoryDb";
import { supabase, resetTauriFetchState } from "../lib/supabaseClient";

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

type Repair = {
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

type DevicesData = {
  brands: Brand[];
  categories: Category[];
  models: DeviceModel[];
  repairs: Repair[];
};

function uuid() {
  return crypto?.randomUUID ? crypto.randomUUID() : `${Date.now()}_${Math.random()}`;
}

function loadDevicesFromKey(key: string): DevicesData {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return { brands: [], categories: [], models: [], repairs: [] };
    const parsed = JSON.parse(raw) as DevicesData;
    if (parsed.repairs) {
      parsed.repairs = parsed.repairs.map((r: any) => {
        if (r.modelId && !r.modelIds) {
          return { ...r, modelIds: [r.modelId], modelId: undefined };
        }
        if (!r.modelIds) {
          return { ...r, modelIds: [] };
        }
        return r;
      });
    }
    return parsed;
  } catch {
    return { brands: [], categories: [], models: [], repairs: [] };
  }
}

const EMPTY_DEVICES: DevicesData = { brands: [], categories: [], models: [], repairs: [] };

export default function Devices({ activeServiceId }: { activeServiceId: string | null }) {
  const [data, setData] = useState<DevicesData>(EMPTY_DEVICES);
  const [selectedBrandId, setSelectedBrandId] = useState<string | null>(null);
  const [selectedCategoryId, setSelectedCategoryId] = useState<string | null>(null);
  const [selectedModelId, setSelectedModelId] = useState<string | null>(null);

  const [editingBrand, setEditingBrand] = useState<string | null>(null);
  const [editingCategory, setEditingCategory] = useState<string | null>(null);
  const [editingModel, setEditingModel] = useState<string | null>(null);
  const [editingRepair, setEditingRepair] = useState<string | null>(null);

  const [editBrandName, setEditBrandName] = useState("");
  const [editCategoryName, setEditCategoryName] = useState("");
  const [editModelName, setEditModelName] = useState("");
  const [editRepairData, setEditRepairData] = useState({ name: "", price: "", time: "", details: "", costs: "", productIds: [] as string[], modelIds: [] as string[], productSearch: "", modelSearch: "" });

  const [newBrandName, setNewBrandName] = useState("");
  const [newCategoryName, setNewCategoryName] = useState("");
  const [newModelName, setNewModelName] = useState("");
  const [newRepair, setNewRepair] = useState({ name: "", price: "", time: "", details: "", costs: "", productIds: [] as string[], modelIds: [] as string[], productSearch: "", modelSearch: "" });
  
  // Filters for repair list
  const [repairSearchQuery, setRepairSearchQuery] = useState("");

  // Import section
  const [showImport, setShowImport] = useState(false);
  const [importPreview, setImportPreview] = useState<{
    brands: string[];
    categories: { name: string; brand: string }[];
    models: { name: string; category: string; brand: string }[];
    repairs: { name: string; model: string; category: string; brand: string; price: number; time: number; costs?: number; products?: string[]; details?: string }[];
    duplicates: { type: string; name: string }[];
  } | null>(null);

  type InventoryProduct = {
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

  type InventoryData = {
    brands: Brand[];
    categories: Category[];
    models: DeviceModel[];
    products: InventoryProduct[];
  };

  function loadInventoryFromKey(key: string | null): InventoryData {
    if (!key) return { brands: [], categories: [], models: [], products: [] };
    try {
      const raw = localStorage.getItem(key);
      if (!raw) return { brands: [], categories: [], models: [], products: [] };
      return JSON.parse(raw) as InventoryData;
    } catch {
      return { brands: [], categories: [], models: [], products: [] };
    }
  }

  const [inventoryData, setInventoryData] = useState<InventoryData>({ brands: [], categories: [], models: [], products: [] });

  const [draggedModelId, setDraggedModelId] = useState<string | null>(null);
  const [dragOverModelId, setDragOverModelId] = useState<string | null>(null);
  const [devicesLoading, setDevicesLoading] = useState(false);
  const [devicesLoadError, setDevicesLoadError] = useState<string | null>(null);
  const [retryKey, setRetryKey] = useState(0);

  /** Po dokončení prvního načtení z DB povolí ukládání. */
  const initialLoadDoneRef = useRef(false);
  /** Load vrátil prázdná data – pak neukládat prázdná zpět (přepsalo by to DB). */
  const loadedEmptyRef = useRef(false);
  /** Právě jsme načetli z DB – přeskočit následující save (data jsou již v DB, snižuje tlak na pool). */
  const justLoadedRef = useRef(false);

  // Load devices and inventory from DB when active service changes (with localStorage migration)
  useEffect(() => {
    if (!activeServiceId) {
      initialLoadDoneRef.current = false;
      setDevicesLoading(false);
      setDevicesLoadError(null);
      setData(EMPTY_DEVICES);
      setInventoryData({ brands: [], categories: [], models: [], products: [] });
      return;
    }
    initialLoadDoneRef.current = false;
    loadedEmptyRef.current = false;
    setDevicesLoadError(null);
    setDevicesLoading(true);
    let cancelled = false;
    (async () => {
      try {
      // Načítáme zařízení i sklad paralelně – zkrátí to celkovou dobu
      const [loadRes, invDb] = await Promise.all([
        loadDevicesFromDb(activeServiceId),
        loadInventoryFromDb(activeServiceId),
      ]);
      if (cancelled) return;
      if (loadRes.error) {
        setDevicesLoadError(loadRes.error);
        setDevicesLoading(false);
        return;
      }
      let devicesData = loadRes.data;
      const hasDbDevices =
        devicesData.brands.length > 0 ||
        devicesData.categories.length > 0 ||
        devicesData.models.length > 0 ||
        devicesData.repairs.length > 0;
      if (!hasDbDevices) {
        const fromStorage = loadDevicesFromKey(getDevicesKey(activeServiceId));
        const legacy = loadDevicesFromKey(STORAGE_KEYS.DEVICES);
        const merged =
          fromStorage.brands.length > 0 ||
          fromStorage.categories.length > 0 ||
          fromStorage.models.length > 0 ||
          fromStorage.repairs.length > 0
            ? fromStorage
            : legacy;
        const hasStorage =
          merged.brands.length > 0 ||
          merged.categories.length > 0 ||
          merged.models.length > 0 ||
          merged.repairs.length > 0;
        if (hasStorage) {
          await saveDevicesToDb(activeServiceId, merged);
          devicesData = merged;
        }
      }
      if (cancelled) return;
      const hadData =
        devicesData.brands.length > 0 ||
        devicesData.categories.length > 0 ||
        devicesData.models.length > 0 ||
        devicesData.repairs.length > 0;
      loadedEmptyRef.current = !hadData;
      justLoadedRef.current = true;
      setData(devicesData);
      initialLoadDoneRef.current = true;

      let invProducts = invDb.products;
      const hasDbInventory = invDb.productCategories.length > 0 || invDb.products.length > 0;
      if (!hasDbInventory) {
        const fromStorage = loadInventoryFromKey(getInventoryKey(activeServiceId)) as {
          productCategories?: { id: string; name: string; modelIds?: string[]; createdAt: string }[];
          products?: { id: string; name: string; modelIds: string[]; stock: number; price: number; sku?: string; description?: string; imageUrl?: string; repairIds?: string[]; categoryId?: string; createdAt: string }[];
        };
        const legacy = loadInventoryFromKey(STORAGE_KEYS.INVENTORY) as typeof fromStorage;
        const merged =
          (fromStorage.products?.length ?? 0) > 0 || (fromStorage.productCategories?.length ?? 0) > 0
            ? fromStorage
            : legacy;
        const hasStorage =
          (merged.products?.length ?? 0) > 0 || (merged.productCategories?.length ?? 0) > 0;
        if (hasStorage) {
          const productCategories = (merged.productCategories ?? []).map((c) => ({
            ...c,
            modelIds: c.modelIds ?? [],
          }));
          const products = merged.products ?? [];
          await saveInventoryToDb(activeServiceId, { productCategories, products });
          invProducts = products;
        }
      }
      if (cancelled) return;
      setInventoryData({
        brands: devicesData.brands,
        categories: devicesData.categories,
        models: devicesData.models,
        products: invProducts,
      });
      } finally {
        if (!cancelled) setDevicesLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [activeServiceId, retryKey]);

  // Save devices to DB when data changes (debounced). Nepouštět před load. Nepouštět prázdná data, pokud load vrátil prázdná – přepsalo by to DB.
  const hasAnyData =
    data.brands.length > 0 ||
    data.categories.length > 0 ||
    data.models.length > 0 ||
    data.repairs.length > 0;
  useEffect(() => {
    if (!activeServiceId || !initialLoadDoneRef.current) return;
    if (!hasAnyData && loadedEmptyRef.current) return; // load vrátil prázdná – neukládat zpět
    const t = setTimeout(() => {
      if (justLoadedRef.current) {
        justLoadedRef.current = false;
        return; // data právě z loadu – neukládat (snižuje tlak na connection pool)
      }
      saveDevicesToDb(activeServiceId, data).then((r) => {
        if (r.error) showToast("Chyba uložení zařízení: " + r.error, "error");
      });
    }, 500);
    return () => clearTimeout(t);
  }, [activeServiceId, data, hasAnyData]);

  // Realtime: při změně zařízení v jiné záložce/zařízení přenačíst (debounce 2s – sníží záplavu při nestabilním připojení)
  useEffect(() => {
    if (!activeServiceId || !supabase) return;
    let reloadTimer: ReturnType<typeof setTimeout> | null = null;
    let inventoryReloadTimer: ReturnType<typeof setTimeout> | null = null;
    const scheduleDevicesReload = () => {
      if (reloadTimer) clearTimeout(reloadTimer);
      reloadTimer = setTimeout(() => {
        reloadTimer = null;
        loadDevicesFromDb(activeServiceId).then((r) => {
          if (!r.error) {
            justLoadedRef.current = true;
            setData(r.data);
            setInventoryData((prev) => ({ ...prev, brands: r.data.brands, categories: r.data.categories, models: r.data.models }));
          }
        });
      }, 2000);
    };
    const scheduleInventoryReload = () => {
      if (inventoryReloadTimer) clearTimeout(inventoryReloadTimer);
      inventoryReloadTimer = setTimeout(() => {
        inventoryReloadTimer = null;
        loadInventoryFromDb(activeServiceId).then((inv) => setInventoryData((prev) => ({ ...prev, products: inv.products })));
      }, 2000);
    };
    const topic = `devices:${activeServiceId}`;
    const channel = supabase
      .channel(topic)
      .on("postgres_changes", { event: "*", schema: "public", table: "device_brands", filter: `service_id=eq.${activeServiceId}` }, scheduleDevicesReload)
      .on("postgres_changes", { event: "*", schema: "public", table: "device_categories", filter: `service_id=eq.${activeServiceId}` }, scheduleDevicesReload)
      .on("postgres_changes", { event: "*", schema: "public", table: "device_models", filter: `service_id=eq.${activeServiceId}` }, scheduleDevicesReload)
      .on("postgres_changes", { event: "*", schema: "public", table: "repairs", filter: `service_id=eq.${activeServiceId}` }, scheduleDevicesReload)
      .on("postgres_changes", { event: "*", schema: "public", table: "inventory_products", filter: `service_id=eq.${activeServiceId}` }, scheduleInventoryReload)
      .on("postgres_changes", { event: "*", schema: "public", table: "inventory_product_categories", filter: `service_id=eq.${activeServiceId}` }, scheduleInventoryReload)
      .subscribe();
    return () => {
      if (reloadTimer) clearTimeout(reloadTimer);
      if (inventoryReloadTimer) clearTimeout(inventoryReloadTimer);
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
    maxHeight: "600px",
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

  const addBrand = () => {
    if (!newBrandName.trim()) return;
    const brand: Brand = { id: uuid(), name: newBrandName.trim(), createdAt: new Date().toISOString() };
    const next: DevicesData = { ...data, brands: [...data.brands, brand] };
    setData(next);
    setNewBrandName("");
    showToast("Značka přidána", "success");
  };

  const addCategory = () => {
    if (!newCategoryName.trim() || !selectedBrandId) return;
    const cat: Category = {
      id: uuid(),
      brandId: selectedBrandId,
      name: newCategoryName.trim(),
      createdAt: new Date().toISOString(),
    };
    const next: DevicesData = { ...data, categories: [...data.categories, cat] };
    setData(next);
    setNewCategoryName("");
    showToast("Kategorie přidána", "success");
  };

  const addModel = () => {
    if (!newModelName.trim() || !selectedCategoryId) return;
    const model: DeviceModel = {
      id: uuid(),
      categoryId: selectedCategoryId,
      name: newModelName.trim(),
      createdAt: new Date().toISOString(),
    };
    const next: DevicesData = { ...data, models: [...data.models, model] };
    setData(next);
    setNewModelName("");
    showToast("Model přidán", "success");
  };

  const addRepairItem = () => {
    if (!newRepair.name.trim() || newRepair.modelIds.length === 0) return;
    const repair: Repair = {
      id: uuid(),
      modelIds: newRepair.modelIds,
      name: newRepair.name.trim(),
      price: parseFloat(newRepair.price) || 0,
      estimatedTime: parseInt(newRepair.time) || 0,
      details: newRepair.details.trim(),
      costs: parseFloat(newRepair.costs) || undefined,
      productIds: newRepair.productIds.length > 0 ? newRepair.productIds : undefined,
      createdAt: new Date().toISOString(),
    };
    const next: DevicesData = { ...data, repairs: [...data.repairs, repair] };
    setData(next);
    setNewRepair({ name: "", price: "", time: "", details: "", costs: "", productIds: [], modelIds: [], productSearch: "", modelSearch: "" });
    showToast("Oprava přidána", "success");
  };

  const deleteBrand = (id: string) => {
    const catIds = data.categories.filter((c) => c.brandId === id).map((c) => c.id);
    const modelIds = data.models.filter((m) => catIds.includes(m.categoryId)).map((m) => m.id);
    const next: DevicesData = {
      brands: data.brands.filter((b) => b.id !== id),
      categories: data.categories.filter((c) => c.brandId !== id),
      models: data.models.filter((m) => !catIds.includes(m.categoryId)),
      repairs: data.repairs.filter((r) => !r.modelIds || !r.modelIds.some((mid) => modelIds.includes(mid))),
    };
    setData(next);
    if (selectedBrandId === id) setSelectedBrandId(null);
    showToast("Značka smazána", "success");
  };

  const deleteCategory = (id: string) => {
    const modelIds = data.models.filter((m) => m.categoryId === id).map((m) => m.id);
    const next: DevicesData = {
      ...data,
      categories: data.categories.filter((c) => c.id !== id),
      models: data.models.filter((m) => m.categoryId !== id),
      repairs: data.repairs.filter((r) => !r.modelIds || !r.modelIds.some((mid) => modelIds.includes(mid))),
    };
    setData(next);
    if (selectedCategoryId === id) setSelectedCategoryId(null);
    showToast("Kategorie smazána", "success");
  };

  const deleteModel = (id: string) => {
    const next: DevicesData = {
      ...data,
      models: data.models.filter((m) => m.id !== id),
      repairs: data.repairs.filter((r) => !r.modelIds || !r.modelIds.includes(id)),
    };
    setData(next);
    if (selectedModelId === id) setSelectedModelId(null);
    showToast("Model smazán", "success");
  };

  const deleteRepair = (id: string) => {
    const next: DevicesData = { ...data, repairs: data.repairs.filter((r) => r.id !== id) };
    setData(next);
    showToast("Oprava smazána", "success");
  };

  const updateBrand = (id: string, name: string) => {
    const next: DevicesData = { ...data, brands: data.brands.map((b) => (b.id === id ? { ...b, name } : b)) };
    setData(next);
    setEditingBrand(null);
    showToast("Značka upravena", "success");
  };

  const updateCategory = (id: string, name: string) => {
    const next: DevicesData = { ...data, categories: data.categories.map((c) => (c.id === id ? { ...c, name } : c)) };
    setData(next);
    setEditingCategory(null);
    showToast("Kategorie upravena", "success");
  };

  const updateModel = (id: string, name: string) => {
    const next: DevicesData = { ...data, models: data.models.map((m) => (m.id === id ? { ...m, name } : m)) };
    setData(next);
    setEditingModel(null);
    showToast("Model upraven", "success");
  };

  const updateRepair = (id: string, repairData: { name: string; price: string; time: string; details: string; costs: string; productIds: string[]; modelIds: string[] }) => {
    const next: DevicesData = {
      ...data,
      repairs: data.repairs.map((r) =>
        r.id === id
          ? {
              ...r,
              modelIds: repairData.modelIds,
              name: repairData.name.trim(),
              price: parseFloat(repairData.price) || 0,
              estimatedTime: parseInt(repairData.time) || 0,
              details: repairData.details.trim(),
              costs: parseFloat(repairData.costs) || undefined,
              productIds: repairData.productIds.length > 0 ? repairData.productIds : undefined,
            }
          : r
      ),
    };
    setData(next);
    setEditingRepair(null);
    showToast("Oprava upravena", "success");
  };


  const reorderModels = (fromIndex: number, toIndex: number) => {
    setData((d) => {
      const models = [...d.models];
      const filtered = models.filter((m) => m.categoryId === selectedCategoryId);
      const others = models.filter((m) => m.categoryId !== selectedCategoryId);
      const [moved] = filtered.splice(fromIndex, 1);
      filtered.splice(toIndex, 0, moved);
      return { ...d, models: [...others, ...filtered] };
    });
  };


  const moveBrandUp = (index: number) => {
    if (index === 0) return;
    setData((d) => {
      const brands = [...d.brands];
      [brands[index - 1], brands[index]] = [brands[index], brands[index - 1]];
      return { ...d, brands };
    });
  };

  const moveBrandDown = (index: number) => {
    if (index === data.brands.length - 1) return;
    setData((d) => {
      const brands = [...d.brands];
      [brands[index], brands[index + 1]] = [brands[index + 1], brands[index]];
      return { ...d, brands };
    });
  };

  const moveCategoryUp = (index: number) => {
    if (index === 0) return;
    const filtered = filteredCategories;
    const categoryToMove = filtered[index];
    const categoryAbove = filtered[index - 1];
    
    setData((d) => {
      const categories = d.categories.map((c) => {
        if (c.id === categoryToMove.id) return categoryAbove;
        if (c.id === categoryAbove.id) return categoryToMove;
        return c;
      });
      return { ...d, categories };
    });
  };

  const moveCategoryDown = (index: number) => {
    if (index === filteredCategories.length - 1) return;
    const filtered = filteredCategories;
    const categoryToMove = filtered[index];
    const categoryBelow = filtered[index + 1];
    
    setData((d) => {
      const categories = d.categories.map((c) => {
        if (c.id === categoryToMove.id) return categoryBelow;
        if (c.id === categoryBelow.id) return categoryToMove;
        return c;
      });
      return { ...d, categories };
    });
  };

  const moveModelUp = (index: number) => {
    if (index === 0) return;
    const filtered = filteredModels;
    const modelToMove = filtered[index];
    const modelAbove = filtered[index - 1];
    
    setData((d) => {
      const models = d.models.map((m) => {
        if (m.id === modelToMove.id) return modelAbove;
        if (m.id === modelAbove.id) return modelToMove;
        return m;
      });
      return { ...d, models };
    });
  };

  const moveModelDown = (index: number) => {
    if (index === filteredModels.length - 1) return;
    const filtered = filteredModels;
    const modelToMove = filtered[index];
    const modelBelow = filtered[index + 1];
    
    setData((d) => {
      const models = d.models.map((m) => {
        if (m.id === modelToMove.id) return modelBelow;
        if (m.id === modelBelow.id) return modelToMove;
        return m;
      });
      return { ...d, models };
    });
  };


  const filteredCategories = useMemo(() => {
    return selectedBrandId
      ? data.categories.filter((c) => c.brandId === selectedBrandId)
      : [];
  }, [data.categories, selectedBrandId]);

  const filteredModels = useMemo(() => {
    return selectedCategoryId ? data.models.filter((m) => m.categoryId === selectedCategoryId) : [];
  }, [data.models, selectedCategoryId]);

  const filteredRepairs = useMemo(() => {
    return selectedModelId ? data.repairs.filter((r) => r.modelIds && r.modelIds.includes(selectedModelId)) : [];
  }, [data.repairs, selectedModelId]);

  const selectedBrand = data.brands.find((b) => b.id === selectedBrandId);
  const selectedCategory = data.categories.find((c) => c.id === selectedCategoryId);
  const selectedModel = data.models.find((m) => m.id === selectedModelId);

  // Parse import file
  const parseImportFile = (text: string) => {
    const lines = text.split('\n').map(l => l.trim()).filter(l => l && !l.startsWith('#'));
    const preview = {
      brands: [] as string[],
      categories: [] as { name: string; brand: string }[],
      models: [] as { name: string; category: string; brand: string }[],
      repairs: [] as { name: string; model: string; category: string; brand: string; price: number; time: number; costs?: number; products?: string[]; details?: string }[],
      duplicates: [] as { type: string; name: string }[]
    };

    let currentBrand = "";
    let currentCategory = "";
    let currentModel = "";
    let currentRepair: any = null;

    for (const line of lines) {
      if (line.startsWith('ZNAČKA:')) {
        const brandName = line.substring(7).trim();
        if (brandName) {
          currentBrand = brandName;
          if (!preview.brands.includes(brandName)) {
            preview.brands.push(brandName);
          }
          // Check for duplicates
          if (data.brands.some(b => b.name.toLowerCase() === brandName.toLowerCase())) {
            preview.duplicates.push({ type: 'Značka', name: brandName });
          }
        }
        currentCategory = "";
        currentModel = "";
        currentRepair = null;
      } else if (line.startsWith('KATEGORIE:')) {
        const categoryName = line.substring(10).trim();
        if (categoryName && currentBrand) {
          currentCategory = categoryName;
          if (!preview.categories.some(c => c.brand === currentBrand && c.name === categoryName)) {
            preview.categories.push({ name: categoryName, brand: currentBrand });
          }
          // Check for duplicates
          const brand = data.brands.find(b => b.name.toLowerCase() === currentBrand.toLowerCase());
          if (brand && data.categories.some(c => c.brandId === brand.id && c.name.toLowerCase() === categoryName.toLowerCase())) {
            preview.duplicates.push({ type: 'Kategorie', name: `${currentBrand} > ${categoryName}` });
          }
        }
        currentModel = "";
        currentRepair = null;
      } else if (line.startsWith('MODEL:')) {
        const modelName = line.substring(6).trim();
        if (modelName && currentCategory && currentBrand) {
          currentModel = modelName;
          if (!preview.models.some(m => m.brand === currentBrand && m.category === currentCategory && m.name === modelName)) {
            preview.models.push({ name: modelName, category: currentCategory, brand: currentBrand });
          }
          // Check for duplicates
          const brand = data.brands.find(b => b.name.toLowerCase() === currentBrand.toLowerCase());
          if (brand) {
            const category = data.categories.find(c => c.brandId === brand.id && c.name.toLowerCase() === currentCategory.toLowerCase());
            if (category && data.models.some(m => m.categoryId === category.id && m.name.toLowerCase() === modelName.toLowerCase())) {
              preview.duplicates.push({ type: 'Model', name: `${currentBrand} > ${currentCategory} > ${modelName}` });
            }
          }
        }
        currentRepair = null;
      } else if (line.startsWith('OPRAVA:')) {
        const repairName = line.substring(7).trim();
        if (repairName && currentModel && currentCategory && currentBrand) {
          currentRepair = {
            name: repairName,
            model: currentModel,
            category: currentCategory,
            brand: currentBrand,
            price: 0,
            time: 0
          };
          // Check for duplicates
          const brand = data.brands.find(b => b.name.toLowerCase() === currentBrand.toLowerCase());
          if (brand) {
            const category = data.categories.find(c => c.brandId === brand.id && c.name.toLowerCase() === currentCategory.toLowerCase());
            if (category) {
              const model = data.models.find(m => m.categoryId === category.id && m.name.toLowerCase() === currentModel.toLowerCase());
              if (model && data.repairs.some(r => r.modelIds.includes(model.id) && r.name.toLowerCase() === repairName.toLowerCase())) {
                preview.duplicates.push({ type: 'Oprava', name: `${currentBrand} > ${currentCategory} > ${currentModel} > ${repairName}` });
              }
            }
          }
        }
      } else if (line.startsWith('CENA:') && currentRepair) {
        const price = parseInt(line.substring(5).trim());
        if (!isNaN(price)) currentRepair.price = price;
      } else if (line.startsWith('ČAS:') && currentRepair) {
        const time = parseInt(line.substring(4).trim());
        if (!isNaN(time)) currentRepair.time = time;
      } else if (line.startsWith('NÁKLADY:') && currentRepair) {
        const costs = parseInt(line.substring(8).trim());
        if (!isNaN(costs)) currentRepair.costs = costs;
      } else if (line.startsWith('PRODUKTY:') && currentRepair) {
        const products = line.substring(9).trim().split(',').map(p => p.trim()).filter(p => p);
        currentRepair.products = products;
      } else if (line.startsWith('DETALY:') && currentRepair) {
        currentRepair.details = line.substring(7).trim();
      } else if (line === '---' && currentRepair) {
        preview.repairs.push(currentRepair);
        currentRepair = null;
      }
    }
    // Add last repair if exists
    if (currentRepair) {
      preview.repairs.push(currentRepair);
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
    const template = `# Vzorový soubor pro import zařízení a oprav
# Řádky začínající # jsou komentáře a budou ignorovány
# Struktura: ZNAČKA > KATEGORIE > MODEL > OPRAVA
# Mezi opravami použijte oddělovač ---
# Pro více oprav u jednoho modelu jednoduše přidejte další blok OPRAVA: s oddělovačem ---

ZNAČKA: Apple
KATEGORIE: Telefony
MODEL: iPhone 15
OPRAVA: Výměna displeje
CENA: 2500
ČAS: 60
NÁKLADY: 1500
PRODUKTY: displej-iphone-15, lepidlo
DETALY: Výměna poškozeného displeje
---
# Další oprava pro stejný model (iPhone 15)
# Model se nemusí opakovat, systém si pamatuje poslední zadaný MODEL
OPRAVA: Výměna baterie
CENA: 1200
ČAS: 45
NÁKLADY: 800
PRODUKTY: baterie-iphone-15
DETALY: Výměna opotřebované baterie
---
# Ještě jedna oprava pro iPhone 15
OPRAVA: Oprava tlačítka napájení
CENA: 500
ČAS: 20
NÁKLADY: 200
PRODUKTY: tlacitko-napajeni-iphone-15
DETALY: Oprava nebo výměna tlačítka napájení
---
# Nový model ve stejné kategorii
MODEL: iPhone 15 Pro
OPRAVA: Výměna zadního skla
CENA: 1800
ČAS: 50
NÁKLADY: 1000
PRODUKTY: zadni-sklo-iphone-15-pro
DETALY: Výměna poškozeného zadního skla
---
# Další oprava pro iPhone 15 Pro
OPRAVA: Výměna baterie
CENA: 1300
ČAS: 45
NÁKLADY: 850
PRODUKTY: baterie-iphone-15-pro
DETALY: Výměna opotřebované baterie
---
# Nová kategorie pro stejnou značku
KATEGORIE: Tablety
MODEL: iPad Pro
OPRAVA: Oprava konektoru
CENA: 800
ČAS: 30
NÁKLADY: 200
PRODUKTY: konektor-ipad-pro
DETALY: Oprava poškozeného konektoru
---
# Další oprava pro iPad Pro
OPRAVA: Výměna displeje
CENA: 3500
ČAS: 90
NÁKLADY: 2000
PRODUKTY: displej-ipad-pro
DETALY: Výměna poškozeného displeje
---
# Nová značka
ZNAČKA: Samsung
KATEGORIE: Telefony
MODEL: Galaxy S24
OPRAVA: Výměna zadního krytu
CENA: 1500
ČAS: 40
NÁKLADY: 900
PRODUKTY: kryt-galaxy-s24
DETALY: Výměna poškozeného zadního krytu
---
# Další oprava pro Galaxy S24
OPRAVA: Výměna baterie
CENA: 1100
ČAS: 40
NÁKLADY: 700
PRODUKTY: baterie-galaxy-s24
DETALY: Výměna opotřebované baterie
---`;

    const blob = new Blob([template], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'import-vzor.txt';
    a.click();
    URL.revokeObjectURL(url);
  };

  const executeImport = () => {
    if (!importPreview || !activeServiceId) return;

    const newData = (() => {
      const d = { ...data };
      const brandMap = new Map<string, string>();
      const categoryMap = new Map<string, string>();
      const modelMap = new Map<string, string>();

      for (const brandName of importPreview.brands) {
        const existing = d.brands.find(b => b.name.toLowerCase() === brandName.toLowerCase());
        if (!existing) {
          const newBrand = { id: uuid(), name: brandName, createdAt: new Date().toISOString() };
          d.brands.push(newBrand);
          brandMap.set(brandName.toLowerCase(), newBrand.id);
        } else {
          brandMap.set(brandName.toLowerCase(), existing.id);
        }
      }
      for (const cat of importPreview.categories) {
        const brandId = brandMap.get(cat.brand.toLowerCase());
        if (brandId) {
          const existing = d.categories.find(c => c.brandId === brandId && c.name.toLowerCase() === cat.name.toLowerCase());
          if (!existing) {
            const newCategory = { id: uuid(), brandId, name: cat.name, createdAt: new Date().toISOString() };
            d.categories.push(newCategory);
            categoryMap.set(`${cat.brand.toLowerCase()}:${cat.name.toLowerCase()}`, newCategory.id);
          } else {
            categoryMap.set(`${cat.brand.toLowerCase()}:${cat.name.toLowerCase()}`, existing.id);
          }
        }
      }
      for (const model of importPreview.models) {
        const categoryId = categoryMap.get(`${model.brand.toLowerCase()}:${model.category.toLowerCase()}`);
        if (categoryId) {
          const existing = d.models.find(m => m.categoryId === categoryId && m.name.toLowerCase() === model.name.toLowerCase());
          if (!existing) {
            const newModel = { id: uuid(), categoryId, name: model.name, createdAt: new Date().toISOString() };
            d.models.push(newModel);
            modelMap.set(`${model.brand.toLowerCase()}:${model.category.toLowerCase()}:${model.name.toLowerCase()}`, newModel.id);
          } else {
            modelMap.set(`${model.brand.toLowerCase()}:${model.category.toLowerCase()}:${model.name.toLowerCase()}`, existing.id);
          }
        }
      }
      for (const repair of importPreview.repairs) {
        const modelId = modelMap.get(`${repair.brand.toLowerCase()}:${repair.category.toLowerCase()}:${repair.model.toLowerCase()}`);
        if (modelId) {
          const existing = d.repairs.find(r => r.modelIds.includes(modelId) && r.name.toLowerCase() === repair.name.toLowerCase());
          if (!existing) {
            d.repairs.push({
              id: uuid(),
              modelIds: [modelId],
              name: repair.name,
              price: repair.price,
              estimatedTime: repair.time,
              costs: repair.costs,
              productIds: repair.products || [],
              details: repair.details || "",
              createdAt: new Date().toISOString(),
            });
          }
        }
      }
      return d;
    })();

    setData(newData);
    loadedEmptyRef.current = false;
    // Okamžitě uložit do DB – nečekat na debounce (uživatel může rychle reloadnout)
    saveDevicesToDb(activeServiceId, newData).then((r) => {
      if (r.error) showToast("Chyba uložení zařízení: " + r.error, "error");
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
            <div style={{ fontSize: 22, fontWeight: 950, color: "var(--text)" }}>Import zařízení a oprav</div>
            <div style={{ fontSize: 13, color: "var(--muted)", marginTop: 4 }}>
              Importujte značky, kategorie, modely a opravy z TXT souboru
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
              <strong>Struktura souboru:</strong> Soubor musí obsahovat hierarchii ZNAČKA → KATEGORIE → MODEL → OPRAVA.
            </p>
            <p style={{ marginBottom: 12 }}>
              <strong>Formát:</strong> Každý řádek začíná klíčovým slovem (ZNAČKA:, KATEGORIE:, MODEL:, OPRAVA:, CENA:, ČAS:, NÁKLADY:, PRODUKTY:, DETALY:).
            </p>
            <p style={{ marginBottom: 12 }}>
              <strong>Více oprav u jednoho modelu:</strong> Pro přidání více oprav k jednomu modelu jednoduše přidejte další blok OPRAVA: s jeho parametry. Mezi jednotlivými opravami použijte oddělovač <code style={{ background: "var(--panel-2)", padding: "2px 6px", borderRadius: 4 }}>---</code>. Model a kategorie se nemusí opakovat - systém si pamatuje poslední zadaný MODEL a KATEGORII.
            </p>
            <p style={{ marginBottom: 12 }}>
              <strong>Oddělovač:</strong> Mezi jednotlivými opravami použijte řádek s <code style={{ background: "var(--panel-2)", padding: "2px 6px", borderRadius: 4 }}>---</code>.
            </p>
            <p style={{ marginBottom: 12 }}>
              <strong>Komentáře:</strong> Řádky začínající <code style={{ background: "var(--panel-2)", padding: "2px 6px", borderRadius: 4 }}>#</code> jsou ignorovány.
            </p>
            <p style={{ marginBottom: 12 }}>
              <strong>Kontrola duplicit:</strong> Systém automaticky kontroluje, zda se nepokoušíte importovat položky, které již existují. Duplicitní položky budou přeskočeny.
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
          <div style={card}>
            <div style={{ fontWeight: 950, fontSize: 16, marginBottom: 16, color: "var(--text)" }}>
              Náhled importu
            </div>
            
            {/* Summary */}
            <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 12, marginBottom: 20 }}>
              <div style={{ padding: 12, background: "var(--panel-2)", borderRadius: 8, textAlign: "center" }}>
                <div style={{ fontSize: 24, fontWeight: 950, color: "var(--accent)", marginBottom: 4 }}>
                  {importPreview.brands.length}
                </div>
                <div style={{ fontSize: 12, color: "var(--muted)" }}>Značky</div>
              </div>
              <div style={{ padding: 12, background: "var(--panel-2)", borderRadius: 8, textAlign: "center" }}>
                <div style={{ fontSize: 24, fontWeight: 950, color: "var(--accent)", marginBottom: 4 }}>
                  {importPreview.categories.length}
                </div>
                <div style={{ fontSize: 12, color: "var(--muted)" }}>Kategorie</div>
              </div>
              <div style={{ padding: 12, background: "var(--panel-2)", borderRadius: 8, textAlign: "center" }}>
                <div style={{ fontSize: 24, fontWeight: 950, color: "var(--accent)", marginBottom: 4 }}>
                  {importPreview.models.length}
                </div>
                <div style={{ fontSize: 12, color: "var(--muted)" }}>Modely</div>
              </div>
              <div style={{ padding: 12, background: "var(--panel-2)", borderRadius: 8, textAlign: "center" }}>
                <div style={{ fontSize: 24, fontWeight: 950, color: "var(--accent)", marginBottom: 4 }}>
                  {importPreview.repairs.length}
                </div>
                <div style={{ fontSize: 12, color: "var(--muted)" }}>Opravy</div>
              </div>
            </div>

            {/* Detailed preview */}
            <div style={{ marginBottom: 20, maxHeight: 400, overflowY: "auto" }}>
              {importPreview.brands.map((brand, brandIdx) => {
                const brandCategories = importPreview.categories.filter(c => c.brand === brand);
                return (
                  <div key={brandIdx} style={{ marginBottom: 16, padding: 12, background: "var(--panel-2)", borderRadius: 8 }}>
                    <div style={{ fontWeight: 700, fontSize: 14, color: "var(--text)", marginBottom: 8 }}>
                      📱 {brand}
                    </div>
                    {brandCategories.map((cat, catIdx) => {
                      const catModels = importPreview.models.filter(m => m.brand === brand && m.category === cat.name);
                      return (
                        <div key={catIdx} style={{ marginLeft: 16, marginBottom: 12 }}>
                          <div style={{ fontWeight: 600, fontSize: 13, color: "var(--text)", marginBottom: 6 }}>
                            📂 {cat.name}
                          </div>
                          {catModels.map((model, modelIdx) => {
                            const modelRepairs = importPreview.repairs.filter(r => r.brand === brand && r.category === cat.name && r.model === model.name);
                            return (
                              <div key={modelIdx} style={{ marginLeft: 16, marginBottom: 8 }}>
                                <div style={{ fontWeight: 600, fontSize: 12, color: "var(--text)", marginBottom: 4 }}>
                                  🔧 {model.name}
                                </div>
                                {modelRepairs.length > 0 && (
                                  <div style={{ marginLeft: 16 }}>
                                    {modelRepairs.map((repair, repairIdx) => (
                                      <div key={repairIdx} style={{ fontSize: 11, color: "var(--muted)", marginBottom: 4, padding: "4px 8px", background: "var(--panel)", borderRadius: 4 }}>
                                        • {repair.name} ({repair.price} Kč, {repair.time} min{repair.costs ? `, náklady: ${repair.costs} Kč` : ""})
                                      </div>
                                    ))}
                                  </div>
                                )}
                              </div>
                            );
                          })}
                        </div>
                      );
                    })}
                  </div>
                );
              })}
            </div>

            {importPreview.duplicates.length > 0 && (
              <div style={{ marginBottom: 16, padding: 12, background: "rgba(239, 68, 68, 0.1)", borderRadius: 8, border: "1px solid rgba(239, 68, 68, 0.3)" }}>
                <div style={{ fontWeight: 700, color: "rgba(239, 68, 68, 0.9)", marginBottom: 8 }}>
                  ⚠️ Nalezené duplicity ({importPreview.duplicates.length}):
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: 4, maxHeight: 150, overflowY: "auto" }}>
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
              Provedit import ({importPreview.brands.length} značek, {importPreview.categories.length} kategorií, {importPreview.models.length} modelů, {importPreview.repairs.length} oprav)
            </button>
          </div>
        )}
      </div>
    );
  }

  return (
    <div data-tour="devices-main" style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      {devicesLoadError && (
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 12,
            padding: 16,
            background: "rgba(239,68,68,0.08)",
            borderRadius: 12,
            border: "1px solid rgba(239,68,68,0.3)",
            color: "var(--text)",
          }}
        >
          <span style={{ fontSize: 14 }}>Chyba načítání: {devicesLoadError}</span>
          <button
            onClick={() => {
              resetTauriFetchState();
              setRetryKey((k) => k + 1);
            }}
            style={{
              padding: "8px 16px",
              borderRadius: 10,
              border: "none",
              background: "var(--accent)",
              color: "white",
              fontSize: 13,
              fontWeight: 600,
              cursor: "pointer",
            }}
          >
            Načíst znovu
          </button>
        </div>
      )}
      {devicesLoading && activeServiceId && !devicesLoadError && (
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            gap: 12,
            padding: 24,
            background: "var(--panel)",
            borderRadius: 12,
            border: "1px solid var(--border)",
          }}
        >
          <div
            style={{
              width: 24,
              height: 24,
              border: "2px solid var(--accent)",
              borderTopColor: "transparent",
              borderRadius: "50%",
              animation: "devicesSpin 0.7s linear infinite",
            }}
          />
          <span style={{ color: "var(--muted)", fontSize: 14 }}>Načítání zařízení…</span>
        </div>
      )}
      <style>{`@keyframes devicesSpin { to { transform: rotate(360deg); } }`}</style>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
        <div>
          <div style={{ fontSize: 22, fontWeight: 950, color: "var(--text)" }}>Zařízení a opravy</div>
          <div style={{ fontSize: 13, color: "var(--muted)", marginTop: 4 }}>
            Spravujte značky, kategorie, modely a jejich opravy. Použijte ↑↓ pro změnu pořadí.
          </div>
        </div>
        <button onClick={() => setShowImport(true)} style={{ ...primaryBtn, padding: "10px 16px" }}>
          Import
        </button>
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
        {/* First row: Brands and Categories */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: 16 }}>
        {/* BRANDS */}
        <div style={card}>
          <div style={{ fontWeight: 950, fontSize: 14, marginBottom: 12, color: "var(--text)" }}>Značky</div>

          <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
            <input
              placeholder="Nová značka…"
              value={newBrandName}
              onChange={(e) => setNewBrandName(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && addBrand()}
              style={inputStyle}
            />
            <button onClick={addBrand} style={primaryBtn}>
              +
            </button>
          </div>

            <div style={{ display: "flex", flexDirection: "column", gap: 6, overflowY: "auto", flex: 1 }}>
            {data.brands.map((b, idx) => (
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
                {editingBrand === b.id ? (
                  <div style={{ display: "flex", gap: 6 }}>
                    <input
                      value={editBrandName}
                      onChange={(e) => setEditBrandName(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") updateBrand(b.id, editBrandName);
                        if (e.key === "Escape") setEditingBrand(null);
                      }}
                      style={{ ...inputStyle, fontSize: 13, padding: "6px 10px" }}
                      autoFocus
                    />
                    <button onClick={() => updateBrand(b.id, editBrandName)} style={{ ...primaryBtn, padding: "6px 10px" }}>
                      ✓
                    </button>
                    <button onClick={() => setEditingBrand(null)} style={{ ...softBtn, padding: "6px 10px" }}>
                      ✕
                    </button>
                  </div>
                ) : (
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
                    <div style={{ display: "flex", gap: 4 }}>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          moveBrandUp(idx);
                        }}
                        disabled={idx === 0}
                        style={{
                          background: "none",
                          border: "none",
                          color: idx === 0 ? "var(--muted)" : "var(--accent)",
                          cursor: idx === 0 ? "not-allowed" : "pointer",
                          fontSize: 16,
                          fontWeight: 900,
                          padding: 4,
                          opacity: idx === 0 ? 0.3 : 1,
                        }}
                        title="Posunout nahoru"
                      >
                        ↑
                      </button>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          moveBrandDown(idx);
                        }}
                        disabled={idx === data.brands.length - 1}
                        style={{
                          background: "none",
                          border: "none",
                          color: idx === data.brands.length - 1 ? "var(--muted)" : "var(--accent)",
                          cursor: idx === data.brands.length - 1 ? "not-allowed" : "pointer",
                          fontSize: 16,
                          fontWeight: 900,
                          padding: 4,
                          opacity: idx === data.brands.length - 1 ? 0.3 : 1,
                        }}
                        title="Posunout dolů"
                      >
                        ↓
                      </button>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          setEditBrandName(b.name);
                          setEditingBrand(b.id);
                        }}
                        style={{
                          background: "none",
                          border: "none",
                          color: "var(--accent)",
                          cursor: "pointer",
                          fontSize: 14,
                          fontWeight: 900,
                          padding: 4,
                        }}
                        title="Upravit"
                      >
                        ✎
                      </button>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          deleteBrand(b.id);
                        }}
                        style={{
                          background: "none",
                          border: "none",
                          color: "rgba(239,68,68,0.8)",
                          cursor: "pointer",
                          fontSize: 16,
                          fontWeight: 900,
                          padding: 4,
                        }}
                        title="Smazat"
                      >
                        ×
                      </button>
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>

        {/* CATEGORIES */}
        <div style={card}>
          <div style={{ fontWeight: 950, fontSize: 14, marginBottom: 12, color: "var(--text)" }}>
            Kategorie {selectedBrand && `· ${selectedBrand.name}`}
          </div>

          {selectedBrandId && (
            <>
              <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
                <input
                  placeholder="Nová kategorie…"
                  value={newCategoryName}
                  onChange={(e) => setNewCategoryName(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && addCategory()}
                  style={inputStyle}
                />
                <button onClick={addCategory} style={primaryBtn}>
                  +
                </button>
              </div>

                <div style={{ display: "flex", flexDirection: "column", gap: 6, overflowY: "auto", flex: 1 }}>
                {filteredCategories.map((c, idx) => (
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
                    {editingCategory === c.id ? (
                      <div style={{ display: "flex", gap: 6 }}>
                        <input
                          value={editCategoryName}
                          onChange={(e) => setEditCategoryName(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") updateCategory(c.id, editCategoryName);
                            if (e.key === "Escape") setEditingCategory(null);
                          }}
                          style={{ ...inputStyle, fontSize: 13, padding: "6px 10px" }}
                          autoFocus
                        />
                        <button onClick={() => updateCategory(c.id, editCategoryName)} style={{ ...primaryBtn, padding: "6px 10px" }}>
                          ✓
                        </button>
                        <button onClick={() => setEditingCategory(null)} style={{ ...softBtn, padding: "6px 10px" }}>
                          ✕
                        </button>
                      </div>
                    ) : (
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
                        style={{ cursor: "pointer", display: "flex", justifyContent: "space-between", alignItems: "center" }}
                      >
                        <span>{c.name}</span>
                        <div style={{ display: "flex", gap: 4 }}>
                          <button onClick={(e) => { e.stopPropagation(); moveCategoryUp(idx); }} disabled={idx === 0} style={arrowBtn(idx === 0)} title="Posunout nahoru">↑</button>
                          <button onClick={(e) => { e.stopPropagation(); moveCategoryDown(idx); }} disabled={idx === filteredCategories.length - 1} style={arrowBtn(idx === filteredCategories.length - 1)} title="Posunout dolů">↓</button>
                          <button onClick={(e) => { e.stopPropagation(); setEditCategoryName(c.name); setEditingCategory(c.id); }} style={arrowBtn(false)} title="Upravit">✎</button>
                          <button onClick={(e) => { e.stopPropagation(); deleteCategory(c.id); }} style={{ ...arrowBtn(false), color: "rgba(239,68,68,0.8)" }} title="Smazat">×</button>
                        </div>
                      </div>
                    )}
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

        {/* Second row: Models and Repairs */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 2fr", gap: 16 }}>
        {/* MODELS */}
          <div style={{ ...card, maxHeight: "400px" }}>
          <div style={{ fontWeight: 950, fontSize: 14, marginBottom: 12, color: "var(--text)" }}>
            Modely {selectedCategory && `· ${selectedCategory.name}`}
          </div>

          {selectedCategoryId && (
            <>
              <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
                <input
                  placeholder="Nový model…"
                  value={newModelName}
                  onChange={(e) => setNewModelName(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && addModel()}
                  style={inputStyle}
                />
                <button onClick={addModel} style={primaryBtn}>
                  +
                </button>
              </div>

                <div style={{ display: "flex", flexDirection: "column", gap: 6, overflowY: "auto", flex: 1 }}>
                {filteredModels.map((m, idx) => (
                  <div
                    key={m.id}
                    draggable={!editingModel}
                    onDragStart={() => {
                      setDraggedModelId(m.id);
                    }}
                    onDragEnd={() => {
                      setDraggedModelId(null);
                      setDragOverModelId(null);
                    }}
                    onDragEnter={(e) => {
                      e.preventDefault();
                      if (draggedModelId && draggedModelId !== m.id) {
                        setDragOverModelId(m.id);
                      }
                    }}
                    onDragOver={(e) => {
                      e.preventDefault();
                    }}
                    onDrop={(e) => {
                      e.preventDefault();
                      if (draggedModelId && draggedModelId !== m.id) {
                        const draggedIdx = filteredModels.findIndex((mod) => mod.id === draggedModelId);
                        const targetIdx = filteredModels.findIndex((mod) => mod.id === m.id);
                        reorderModels(draggedIdx, targetIdx);
                      }
                      setDraggedModelId(null);
                      setDragOverModelId(null);
                    }}
                    style={{
                      padding: "10px 12px",
                      borderRadius: 10,
                      border: dragOverModelId === m.id ? "2px solid var(--accent)" : border,
                      background: selectedModelId === m.id ? "var(--accent-soft)" : "var(--panel)",
                      color: selectedModelId === m.id ? "var(--accent)" : "var(--text)",
                      fontWeight: 600,
                      fontSize: 13,
                      cursor: editingModel ? "default" : draggedModelId ? "grabbing" : "grab",
                      opacity: draggedModelId === m.id ? 0.4 : 1,
                      transition: "opacity 150ms ease, border 150ms ease",
                    }}
                  >
                    {editingModel === m.id ? (
                      <div style={{ display: "flex", gap: 6 }}>
                        <input
                          value={editModelName}
                          onChange={(e) => setEditModelName(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") updateModel(m.id, editModelName);
                            if (e.key === "Escape") setEditingModel(null);
                          }}
                          style={{ ...inputStyle, fontSize: 13, padding: "6px 10px" }}
                          autoFocus
                        />
                        <button onClick={() => updateModel(m.id, editModelName)} style={{ ...primaryBtn, padding: "6px 10px" }}>
                          ✓
                        </button>
                        <button onClick={() => setEditingModel(null)} style={{ ...softBtn, padding: "6px 10px" }}>
                          ✕
                        </button>
                      </div>
                    ) : (
                      <div
                        onClick={() => {
                          if (selectedModelId === m.id) {
                            setSelectedModelId(null);
                          } else {
                            setSelectedModelId(m.id);
                          }
                        }}
                        style={{ cursor: "pointer", display: "flex", justifyContent: "space-between", alignItems: "center" }}
                      >
                        <span>{m.name}</span>
                        <div style={{ display: "flex", gap: 4 }}>
                          <button onClick={(e) => { e.stopPropagation(); moveModelUp(idx); }} disabled={idx === 0} style={arrowBtn(idx === 0)} title="Posunout nahoru">↑</button>
                          <button onClick={(e) => { e.stopPropagation(); moveModelDown(idx); }} disabled={idx === filteredModels.length - 1} style={arrowBtn(idx === filteredModels.length - 1)} title="Posunout dolů">↓</button>
                          <button onClick={(e) => { e.stopPropagation(); setEditModelName(m.name); setEditingModel(m.id); }} style={arrowBtn(false)} title="Upravit">✎</button>
                          <button onClick={(e) => { e.stopPropagation(); deleteModel(m.id); }} style={{ ...arrowBtn(false), color: "rgba(239,68,68,0.8)" }} title="Smazat">×</button>
                        </div>
                      </div>
                    )}
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

          {/* REPAIRS - Add Form Only */}
          <div style={{ ...card, maxHeight: "400px" }}>
          <div style={{ fontWeight: 950, fontSize: 14, marginBottom: 12, color: "var(--text)" }}>
              Přidání opravy {selectedModel && `· ${selectedModel.name}`}
          </div>

            {selectedCategoryId && (
            <>
              <div style={{ display: "grid", gap: 8, marginBottom: 12 }}>
                  <div>
                    <label style={{ fontSize: 12, color: "var(--muted)", marginBottom: 4, display: "block" }}>
                      Modely (samodoplnovací výběr)
                    </label>
                    <div style={{ position: "relative" }}>
                      <input
                        placeholder="Hledat model (např. dyson)…"
                        value={newRepair.modelSearch}
                        onChange={(e) => setNewRepair((p) => ({ ...p, modelSearch: e.target.value }))}
                        style={inputStyle}
                      />
                      {newRepair.modelSearch && (
                        <div style={{ position: "absolute", top: "100%", left: 0, right: 0, zIndex: 1000, background: "var(--panel)", border, borderRadius: 8, marginTop: 4, maxHeight: 200, overflowY: "auto" }}>
                          {data.models
                            .filter((m) => 
                              m.name.toLowerCase().includes(newRepair.modelSearch.toLowerCase()) &&
                              !newRepair.modelIds.includes(m.id)
                            )
                            .slice(0, 10)
                            .map((m) => (
                              <div
                                key={m.id}
                                onClick={() => {
                                  setNewRepair((prev) => ({
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
                    {newRepair.modelIds.length > 0 && (
                      <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 8 }}>
                        {newRepair.modelIds.map((mid) => {
                          const model = data.models.find((m) => m.id === mid);
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
                                  setNewRepair((prev) => ({
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
                <input
                  placeholder="Název opravy…"
                  value={newRepair.name}
                  onChange={(e) => setNewRepair((p) => ({ ...p, name: e.target.value }))}
                  style={inputStyle}
                />
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                  <input
                    placeholder="Cena (Kč)"
                    type="number"
                    value={newRepair.price}
                    onChange={(e) => setNewRepair((p) => ({ ...p, price: e.target.value }))}
                    style={inputStyle}
                  />
                  <input
                    placeholder="Čas (min)"
                    type="number"
                    value={newRepair.time}
                    onChange={(e) => setNewRepair((p) => ({ ...p, time: e.target.value }))}
                    style={inputStyle}
                  />
                </div>
                  <input
                    placeholder="Náklady (Kč, volitelné)"
                    type="number"
                    value={newRepair.costs}
                    onChange={(e) => setNewRepair((p) => ({ ...p, costs: e.target.value }))}
                    style={inputStyle}
                  />
                  <div>
                    <label style={{ fontSize: 12, color: "var(--muted)", marginBottom: 4, display: "block" }}>
                      Produkty (samodoplnovací výběr)
                    </label>
                    <div style={{ position: "relative" }}>
                      <input
                        placeholder="Hledat produkt…"
                        value={newRepair.productSearch}
                        onChange={(e) => setNewRepair((p) => ({ ...p, productSearch: e.target.value }))}
                        style={inputStyle}
                      />
                      {newRepair.productSearch && (
                        <div style={{ position: "absolute", top: "100%", left: 0, right: 0, zIndex: 1000, background: "var(--panel)", border, borderRadius: 8, marginTop: 4, maxHeight: 200, overflowY: "auto" }}>
                          {inventoryData.products
                            .filter((p) => 
                              p.name.toLowerCase().includes(newRepair.productSearch.toLowerCase()) &&
                              !newRepair.productIds.includes(p.id) &&
                              (p.modelIds.includes(selectedModelId!) || !selectedModelId)
                            )
                            .slice(0, 10)
                            .map((p) => (
                              <div
                                key={p.id}
                                onClick={() => {
                                  setNewRepair((prev) => ({
                                    ...prev,
                                    productIds: [...prev.productIds, p.id],
                                    productSearch: "",
                                  }));
                                }}
                                style={{
                                  padding: "8px 12px",
                                  cursor: "pointer",
                                  borderBottom: border,
                                  fontSize: 13,
                                }}
                                onMouseEnter={(e) => {
                                  e.currentTarget.style.background = "var(--accent-soft)";
                                }}
                                onMouseLeave={(e) => {
                                  e.currentTarget.style.background = "var(--panel)";
                                }}
                              >
                                <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                                  <div style={{ fontWeight: 600 }}>{p.name} {p.sku && `(${p.sku})`}</div>
                                  {p.modelIds.length > 0 && (
                                    <div style={{ fontSize: 11, color: "var(--muted)" }}>
                                      Modely: {p.modelIds.map((mid) => {
                                        const model = data.models.find((m) => m.id === mid);
                                        return model?.name;
                                      }).filter(Boolean).join(", ")}
                                    </div>
                                  )}
                                </div>
                              </div>
                            ))}
                        </div>
                      )}
                    </div>
                    {newRepair.productIds.length > 0 && (
                      <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 8 }}>
                        {newRepair.productIds.map((pid) => {
                          const product = inventoryData.products.find((p) => p.id === pid);
                          if (!product) return null;
                          return (
                            <div
                              key={pid}
                              style={{
                                padding: "6px 10px",
                                background: "var(--accent-soft)",
                                borderRadius: 6,
                                fontSize: 12,
                                display: "flex",
                                alignItems: "center",
                                gap: 6,
                              }}
                            >
                              <span>{product.name}</span>
                              <button
                                onClick={() => {
                                  setNewRepair((prev) => ({
                                    ...prev,
                                    productIds: prev.productIds.filter((id) => id !== pid),
                                  }));
                                }}
                                style={{
                                  background: "none",
                                  border: "none",
                                  color: "var(--accent)",
                                  cursor: "pointer",
                                  fontSize: 16,
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
                <textarea
                  placeholder="Podrobnosti…"
                  value={newRepair.details}
                  onChange={(e) => setNewRepair((p) => ({ ...p, details: e.target.value }))}
                  style={{ ...inputStyle, minHeight: 60, resize: "vertical" }}
                />
                <button onClick={addRepairItem} style={primaryBtn}>
                  Přidat opravu
                </button>
              </div>
              </>
            )}

            {!selectedCategoryId && (
              <div style={{ color: "var(--muted)", fontSize: 13, textAlign: "center", padding: 20 }}>
                Vyberte kategorii pro přidání opravy
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Repair List - Full Width */}
      <div style={{ ...card, marginTop: 16 }}>
        <div style={{ fontWeight: 950, fontSize: 16, marginBottom: 16, color: "var(--text)" }}>
          Seznam oprav
        </div>

        {/* Filters */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr", gap: 12, marginBottom: 16 }}>
          <input
            placeholder="Hledat opravu (název, podrobnosti)…"
            value={repairSearchQuery}
            onChange={(e) => setRepairSearchQuery(e.target.value)}
            style={inputStyle}
          />
        </div>

        {/* Active filters info */}
        {(selectedBrandId || selectedCategoryId || selectedModelId) && (
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
                  <span>Značka: {data.brands.find((b) => b.id === selectedBrandId)?.name}</span>
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
                  <span>Kategorie: {data.categories.find((c) => c.id === selectedCategoryId)?.name}</span>
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
                  <span>Model: {data.models.find((m) => m.id === selectedModelId)?.name}</span>
                  <button
                    onClick={() => setSelectedModelId(null)}
                    style={{ background: "none", border: "none", color: "var(--accent)", cursor: "pointer", fontSize: 14, padding: 0, width: 16, height: 16 }}
                  >
                    ×
                  </button>
                </div>
              )}
            </div>
        )}

        {/* Repairs Grid */}
        <div style={{ display: "flex", flexWrap: "wrap", gap: 16 }}>
          {filteredRepairs.map((r) => {
              const repairModels = data.models.filter((m) => r.modelIds && r.modelIds.includes(m.id));
              const isEditing = editingRepair === r.id;
              
              return (
                  <div
                    key={r.id}
                  style={{
                    padding: 16,
                    borderRadius: 12,
                    border,
                    background: "var(--panel)",
                    display: "flex",
                    flexDirection: "column",
                    gap: 12,
                    flex: "1 1 300px",
                    minWidth: 0,
                  }}
                >
                  {isEditing ? (
                    <div style={{ display: "grid", gap: 8 }}>
                      <div>
                        <label style={{ fontSize: 12, color: "var(--muted)", marginBottom: 4, display: "block" }}>
                          Modely (samodoplnovací výběr)
                        </label>
                        <div style={{ position: "relative" }}>
                          <input
                            placeholder="Hledat model (např. dyson)…"
                            value={editRepairData.modelSearch}
                            onChange={(e) => setEditRepairData((p) => ({ ...p, modelSearch: e.target.value }))}
                            style={{ ...inputStyle, fontSize: 13, padding: "8px 10px" }}
                          />
                          {editRepairData.modelSearch && (
                            <div style={{ position: "absolute", top: "100%", left: 0, right: 0, zIndex: 1000, background: "var(--panel)", border, borderRadius: 8, marginTop: 4, maxHeight: 200, overflowY: "auto" }}>
                              {data.models
                                .filter((m) => 
                                  m.name.toLowerCase().includes(editRepairData.modelSearch.toLowerCase()) &&
                                  !editRepairData.modelIds.includes(m.id)
                                )
                                .slice(0, 10)
                                .map((m) => (
                                  <div
                                    key={m.id}
                                    onClick={() => {
                                      setEditRepairData((prev) => ({
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
                        {editRepairData.modelIds.length > 0 && (
                          <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 8 }}>
                            {editRepairData.modelIds.map((mid) => {
                              const model = data.models.find((m) => m.id === mid);
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
                                      setEditRepairData((prev) => ({
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
                        <input
                          placeholder="Název opravy…"
                          value={editRepairData.name}
                          onChange={(e) => setEditRepairData((p) => ({ ...p, name: e.target.value }))}
                          style={{ ...inputStyle, fontSize: 13, padding: "8px 10px" }}
                        />
                        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                          <input
                            placeholder="Cena (Kč)"
                            type="number"
                            value={editRepairData.price}
                            onChange={(e) => setEditRepairData((p) => ({ ...p, price: e.target.value }))}
                            style={{ ...inputStyle, fontSize: 13, padding: "8px 10px" }}
                          />
                          <input
                            placeholder="Čas (min)"
                            type="number"
                            value={editRepairData.time}
                            onChange={(e) => setEditRepairData((p) => ({ ...p, time: e.target.value }))}
                            style={{ ...inputStyle, fontSize: 13, padding: "8px 10px" }}
                          />
                        </div>
                      <input
                        placeholder="Náklady (Kč, volitelné)"
                        type="number"
                        value={editRepairData.costs}
                        onChange={(e) => setEditRepairData((p) => ({ ...p, costs: e.target.value }))}
                        style={{ ...inputStyle, fontSize: 13, padding: "8px 10px" }}
                      />
                      <div>
                        <label style={{ fontSize: 12, color: "var(--muted)", marginBottom: 4, display: "block" }}>
                          Produkty (samodoplnovací výběr)
                        </label>
                        <div style={{ position: "relative" }}>
                          <input
                            placeholder="Hledat produkt…"
                            value={editRepairData.productSearch}
                            onChange={(e) => setEditRepairData((p) => ({ ...p, productSearch: e.target.value }))}
                            style={{ ...inputStyle, fontSize: 13, padding: "8px 10px" }}
                          />
                          {editRepairData.productSearch && (
                            <div style={{ position: "absolute", top: "100%", left: 0, right: 0, zIndex: 1000, background: "var(--panel)", border, borderRadius: 8, marginTop: 4, maxHeight: 200, overflowY: "auto" }}>
                              {inventoryData.products
                                .filter((p) => 
                                  p.name.toLowerCase().includes(editRepairData.productSearch.toLowerCase()) &&
                                  !editRepairData.productIds.includes(p.id) &&
                                  (p.modelIds.some((mid) => editRepairData.modelIds.includes(mid)) || editRepairData.modelIds.length === 0)
                                )
                                .slice(0, 10)
                                .map((p) => (
                                  <div
                                    key={p.id}
                                    onClick={() => {
                                      setEditRepairData((prev) => ({
                                        ...prev,
                                        productIds: [...prev.productIds, p.id],
                                        productSearch: "",
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
                                    <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                                      <div style={{ fontWeight: 600 }}>{p.name} {p.sku && `(${p.sku})`}</div>
                                      {p.modelIds.length > 0 && (
                                        <div style={{ fontSize: 11, color: "var(--muted)" }}>
                                          Modely: {p.modelIds.map((mid) => {
                                            const model = data.models.find((m) => m.id === mid);
                                            return model?.name;
                                          }).filter(Boolean).join(", ")}
                                        </div>
                                      )}
                                    </div>
                                  </div>
                                ))}
                            </div>
                          )}
                        </div>
                        {editRepairData.productIds.length > 0 && (
                          <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 8 }}>
                            {editRepairData.productIds.map((pid) => {
                              const product = inventoryData.products.find((p) => p.id === pid);
                              if (!product) return null;
                              return (
                                <div
                                  key={pid}
                                  style={{
                                    padding: "6px 10px",
                                    background: "var(--accent-soft)",
                                    borderRadius: 6,
                                    fontSize: 12,
                                    display: "flex",
                                    alignItems: "center",
                                    gap: 6,
                                  }}
                                >
                                  <span>{product.name}</span>
                                  <button
                                    onClick={() => {
                                      setEditRepairData((prev) => ({
                                        ...prev,
                                        productIds: prev.productIds.filter((id) => id !== pid),
                                      }));
                                    }}
                                    style={{
                                      background: "none",
                                      border: "none",
                                      color: "var(--accent)",
                                      cursor: "pointer",
                                      fontSize: 16,
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
                        <textarea
                          placeholder="Podrobnosti…"
                          value={editRepairData.details}
                          onChange={(e) => setEditRepairData((p) => ({ ...p, details: e.target.value }))}
                          style={{ ...inputStyle, minHeight: 50, resize: "vertical", fontSize: 13, padding: "8px 10px" }}
                        />
                        <div style={{ display: "flex", gap: 6 }}>
                          <button onClick={() => updateRepair(r.id, editRepairData)} style={{ ...primaryBtn, padding: "8px 12px", flex: 1 }}>
                            Uložit
                          </button>
                          <button onClick={() => setEditingRepair(null)} style={{ ...softBtn, padding: "8px 12px" }}>
                            Zrušit
                          </button>
                        </div>
                      </div>
                    ) : (
                      <>
                      <div>
                        <div style={{ fontWeight: 950, fontSize: 15, color: "var(--text)", marginBottom: 4 }}>
                          {r.name}
                          </div>
                        {repairModels.length > 0 && (
                          <div style={{ fontSize: 11, color: "var(--muted)", marginBottom: 4 }}>
                            Modely: {repairModels.map((m) => m.name).join(", ")}
                        </div>
                        )}
                        </div>

                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", paddingTop: 8, borderTop: border }}>
                        <div>
                          <div style={{ fontSize: 13, fontWeight: 700, color: "var(--text)" }}>
                            {r.price} Kč
                          </div>
                          <div style={{ fontSize: 13, color: "var(--muted)" }}>
                            {r.estimatedTime} min{r.costs ? ` · Náklady: ${r.costs} Kč` : ""}
                          </div>
                        </div>
                        <div style={{ display: "flex", gap: 6 }}>
                          <button
                            onClick={() => {
                              setEditRepairData({ 
                                name: r.name, 
                                price: String(r.price), 
                                time: String(r.estimatedTime), 
                                details: r.details, 
                                costs: r.costs ? String(r.costs) : "", 
                                productIds: r.productIds || [], 
                                modelIds: r.modelIds || [],
                                productSearch: "",
                                modelSearch: "",
                              });
                              setEditingRepair(r.id);
                            }}
                            style={{ ...softBtn, padding: "8px 12px", fontSize: 12 }}
                          >
                            Upravit
                          </button>
                          <button
                            onClick={() => deleteRepair(r.id)}
                            style={{ ...dangerBtn, padding: "8px 12px", fontSize: 12 }}
                          >
                            Smazat
                          </button>
                        </div>
                      </div>

                      {r.productIds && r.productIds.length > 0 && (
                        <div style={{ fontSize: 12, color: "var(--muted)" }}>
                          Produkty: {r.productIds.map((pid) => {
                            const product = inventoryData.products.find((p) => p.id === pid);
                            return product?.name;
                          }).filter(Boolean).join(", ")}
                        </div>
                      )}
                        {r.details && (
                        <div style={{ fontSize: 12, color: "var(--muted)", lineHeight: 1.4 }}>
                          {r.details}
                        </div>
                        )}
                      </>
                    )}
                  </div>
              );
          })}
        </div>

        {filteredRepairs.length === 0 && (
            <div style={{ 
              padding: 40, 
              textAlign: "center", 
              color: "var(--muted)",
              fontSize: 14,
            }}>
              {repairSearchQuery || selectedBrandId || selectedCategoryId || selectedModelId
                ? "Žádné opravy neodpovídají zvoleným filtrům"
                : "Zatím nebyly přidány žádné opravy"}
            </div>
        )}
      </div>
    </div>
  );
}
