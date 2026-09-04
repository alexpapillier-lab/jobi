import React, { useEffect, useMemo, useRef, useState } from "react";
import { useEntitlements } from "../hooks/useEntitlements";
import { Button, Card, PageHeader } from "../components/ui";
import { DeviceIcon, FolderIcon, WarningIcon, WrenchIcon } from "../components/icons";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { showToast } from "../components/Toast";
import { STORAGE_KEYS, getDevicesKey, getInventoryKey } from "../constants/storageKeys";
import { loadDevicesFromDb, saveDevicesToDb } from "../lib/devicesDb";
import { oznamZmenuKatalogu } from "../lib/webhookPing";
import { loadInventoryFromDb, saveInventoryToDb, celkemKusu, vychoziSklad, stavyZeStarehoTvaru } from "../lib/inventoryDb";
import { supabase, resetTauriFetchState } from "../lib/supabaseClient";
import { useIsNarrow } from "../hooks/useIsNarrow";
import { DeviceTree, DeviceTreeSheet, TreeTriggerButton } from "./Devices/DeviceTree";
import { RepairsPane } from "./Devices/RepairsPane";
import { plural } from "./Devices/shared";
import {
  EMPTY_REPAIR_DRAFT,
  KIND_KEY,
  type Brand,
  type Category,
  type DeviceModel,
  type DevicesData,
  type InventoryProduct,
  type NodeKind,
  type Repair,
  type RepairDraft,
  type Selection,
} from "./Devices/types";

/**
 * Zařízení a opravy.
 *
 * Vlevo strom značka › kategorie › model (DeviceTree), vpravo opravy
 * vybraného uzlu (RepairsPane). Tenhle soubor drží data, ukládání do DB,
 * import a všechny akce – panely jen kreslí a volají zpět.
 */

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

/** Čtvrtý pád pro titulky dialogů („Smazat značku …“). */
const KIND_ACCUSATIVE: Record<NodeKind, string> = { brand: "značku", category: "kategorii", model: "model" };

/** Přeskládá sourozence podle `order`; ostatní položky pole zůstanou, kde byly. */
function reorderWithin<T extends { id: string }>(list: T[], siblingIds: Set<string>, order: string[]): T[] {
  const byId = new Map(list.map((x) => [x.id, x]));
  let i = 0;
  return list.map((x) => (siblingIds.has(x.id) ? byId.get(order[i++])! : x));
}

export default function Devices({ activeServiceId }: { activeServiceId: string | null }) {
  const isNarrow = useIsNarrow();
  const [data, setData] = useState<DevicesData>(EMPTY_DEVICES);
  /** Přepínače viditelnosti mají smysl, jen když servis ceník ven posílá. */
  const { has: maModul } = useEntitlements(activeServiceId);
  const ukazatViditelnost = maModul("api_catalog");

  /** Vybraný uzel stromu – určuje, které opravy jsou vpravo. */
  const [selection, setSelection] = useState<Selection | null>(null);
  /** Uzel, který se právě přejmenovává přímo v řádku stromu. */
  const [renaming, setRenaming] = useState<Selection | null>(null);
  /** Úzká obrazovka: strom je v panelu, který se otevírá tlačítkem s drobečky. */
  const [treeOpen, setTreeOpen] = useState(false);
  const [confirm, setConfirm] = useState<{ title: string; message: string; onConfirm: () => void } | null>(null);

  const [editingRepair, setEditingRepair] = useState<string | null>(null);
  const [editRepairData, setEditRepairData] = useState<RepairDraft>(EMPTY_REPAIR_DRAFT);
  const [addingRepair, setAddingRepair] = useState(false);
  const [newRepair, setNewRepair] = useState<RepairDraft>(EMPTY_REPAIR_DRAFT);
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
      const [loadRes, invRes] = await Promise.all([
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
      const invDb = invRes.data;

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
          /* Data z localStorage znají jen jedno číslo `stock`. Sklady přijdou
             z databáze a zásoba padne do výchozího – jinak by se ztratila. */
          const vychozi = vychoziSklad(invDb.warehouses);
          const products = (merged.products ?? []).map((p) => {
            const stavy = stavyZeStarehoTvaru(p, vychozi);
            return { ...p, stockByWarehouse: stavy, stock: celkemKusu(stavy) };
          });
          await saveInventoryToDb(activeServiceId, { productCategories, products, warehouses: invDb.warehouses });
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
        else oznamZmenuKatalogu(activeServiceId);
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
        loadInventoryFromDb(activeServiceId).then((res) => { if (!res.error) setInventoryData((prev) => ({ ...prev, products: res.data.products })); });
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


  /* Styly jen pro obrazovku importu – hlavní stránka používá Card / Input. */
  const border = "1px solid var(--border)";
  const card: React.CSSProperties = {
    border,
    borderRadius: "var(--radius-lg)",
    background: "var(--panel)",
    backdropFilter: "var(--blur)",
    WebkitBackdropFilter: "var(--blur)",
    padding: "var(--pad-16)",
    boxShadow: "var(--shadow-soft)",
    color: "var(--text)",
    display: "flex",
    flexDirection: "column",
  };

  const inputStyle: React.CSSProperties = {
    width: "100%",
    padding: "10px 12px",
    borderRadius: "var(--radius-sm)",
    border,
    outline: "none",
    background: "var(--panel)",
    color: "var(--text)",
    fontFamily: "inherit",
    fontSize: "var(--text-base)",
    transition: "var(--transition-smooth)",
    boxShadow: "var(--shadow-soft)",
  };

  const now = () => new Date().toISOString();

  const nodeName = (sel: Selection) =>
    (data[KIND_KEY[sel.kind]] as { id: string; name: string }[]).find((x) => x.id === sel.id)?.name ?? "";

  const parentOf = (sel: Selection): Selection | null => {
    if (sel.kind === "model") {
      const m = data.models.find((x) => x.id === sel.id);
      return m ? { kind: "category", id: m.categoryId } : null;
    }
    if (sel.kind === "category") {
      const c = data.categories.find((x) => x.id === sel.id);
      return c ? { kind: "brand", id: c.brandId } : null;
    }
    return null;
  };

  /* ---------- strom: přidat / přejmenovat / smazat / přesunout ---------- */

  const addNode = (kind: NodeKind, parentId: string | null, name: string) => {
    const trimmed = name.trim();
    if (!trimmed) return;
    const id = uuid();
    if (kind === "brand") {
      const brand: Brand = { id, name: trimmed, createdAt: now() };
      setData((d) => ({ ...d, brands: [...d.brands, brand] }));
      showToast("Značka přidána", "success");
    } else if (kind === "category") {
      if (!parentId) return;
      const cat: Category = { id, brandId: parentId, name: trimmed, createdAt: now() };
      setData((d) => ({ ...d, categories: [...d.categories, cat] }));
      showToast("Kategorie přidána", "success");
    } else {
      if (!parentId) return;
      const model: DeviceModel = { id, categoryId: parentId, name: trimmed, createdAt: now() };
      setData((d) => ({ ...d, models: [...d.models, model] }));
      showToast("Model přidán", "success");
    }
    setSelection({ kind, id });
  };

  const renameNode = (sel: Selection, name: string) => {
    const key = KIND_KEY[sel.kind];
    setData(
      (d) =>
        ({
          ...d,
          [key]: (d[key] as { id: string; name: string }[]).map((x) => (x.id === sel.id ? { ...x, name } : x)),
        }) as DevicesData,
    );
    setRenaming(null);
    showToast(
      sel.kind === "brand" ? "Značka přejmenována" : sel.kind === "category" ? "Kategorie přejmenována" : "Model přejmenován",
      "success",
    );
  };

  /** Co všechno pod uzlem visí – pro potvrzení i pro samotné smazání. */
  const subtreeOf = (sel: Selection) => {
    const catIds =
      sel.kind === "brand"
        ? data.categories.filter((c) => c.brandId === sel.id).map((c) => c.id)
        : sel.kind === "category"
          ? [sel.id]
          : [];
    const modelIds =
      sel.kind === "model" ? [sel.id] : data.models.filter((m) => catIds.includes(m.categoryId)).map((m) => m.id);
    const modelSet = new Set(modelIds);
    const repairCount = data.repairs.filter((r) => r.modelIds?.some((m) => modelSet.has(m))).length;
    return { catIds, modelIds, modelSet, repairCount };
  };

  /* Oprava sdílená s dalšími modely u nich zůstane; zanikne jen ta, které
     nezbyl žádný model. Dřív se mazala každá oprava, která smazaný model
     obsahovala – i když patřila ještě k devíti dalším. */
  const withoutModels = (repairs: Repair[], gone: Set<string>): Repair[] =>
    repairs
      .map((r) =>
        r.modelIds?.some((m) => gone.has(m))
          ? {
              ...r,
              modelIds: r.modelIds.filter((m) => !gone.has(m)),
              publicHiddenModelIds: r.publicHiddenModelIds?.filter((m) => !gone.has(m)),
            }
          : r,
      )
      .filter((r) => !r.modelIds || r.modelIds.length > 0);

  const deleteNode = (sel: Selection) => {
    const { catIds, modelSet } = subtreeOf(sel);
    const catSet = new Set(catIds);
    setData({
      brands: sel.kind === "brand" ? data.brands.filter((b) => b.id !== sel.id) : data.brands,
      categories: data.categories.filter((c) => !catSet.has(c.id)),
      models: data.models.filter((m) => !modelSet.has(m.id)),
      repairs: withoutModels(data.repairs, modelSet),
    });
    const gone = new Set([sel.id, ...catIds, ...modelSet]);
    if (selection && gone.has(selection.id)) setSelection(parentOf(sel));
    if (renaming && gone.has(renaming.id)) setRenaming(null);
    showToast(sel.kind === "brand" ? "Značka smazána" : sel.kind === "category" ? "Kategorie smazána" : "Model smazán", "success");
  };

  const askDeleteNode = (sel: Selection) => {
    const { catIds, modelIds, repairCount } = subtreeOf(sel);
    const parts: string[] = [];
    if (sel.kind === "brand" && catIds.length) parts.push(`${catIds.length} ${plural(catIds.length, ["kategorie", "kategorie", "kategorií"])}`);
    if (sel.kind !== "model" && modelIds.length) parts.push(`${modelIds.length} ${plural(modelIds.length, ["model", "modely", "modelů"])}`);
    if (repairCount) parts.push(`${repairCount} ${plural(repairCount, ["oprava", "opravy", "oprav"])}`);
    setConfirm({
      title: `Smazat ${KIND_ACCUSATIVE[sel.kind]} „${nodeName(sel)}“?`,
      message: parts.length
        ? `Spolu s tím zmizí ${parts.join(", ")}. Opravy sdílené s dalšími modely u nich zůstanou. Akci nelze vrátit zpět.`
        : "Akci nelze vrátit zpět.",
      onConfirm: () => deleteNode(sel),
    });
  };

  const siblingsOf = (d: DevicesData, sel: Selection): { id: string }[] => {
    if (sel.kind === "brand") return d.brands;
    if (sel.kind === "category") {
      const c = d.categories.find((x) => x.id === sel.id);
      return d.categories.filter((x) => x.brandId === c?.brandId);
    }
    const m = d.models.find((x) => x.id === sel.id);
    return d.models.filter((x) => x.categoryId === m?.categoryId);
  };

  const applyOrder = (d: DevicesData, kind: NodeKind, order: string[]): DevicesData => {
    const ids = new Set(order);
    if (kind === "brand") return { ...d, brands: reorderWithin(d.brands, ids, order) };
    if (kind === "category") return { ...d, categories: reorderWithin(d.categories, ids, order) };
    return { ...d, models: reorderWithin(d.models, ids, order) };
  };

  /** Posun o jednu pozici mezi sourozenci (nabídka „Posunout nahoru / dolů“). */
  const moveNode = (sel: Selection, dir: -1 | 1) => {
    setData((d) => {
      const order = siblingsOf(d, sel).map((x) => x.id);
      const idx = order.indexOf(sel.id);
      const j = idx + dir;
      if (idx < 0 || j < 0 || j >= order.length) return d;
      [order[idx], order[j]] = [order[j], order[idx]];
      return applyOrder(d, sel.kind, order);
    });
  };

  /** Přetažení na jiného sourozence – položka se zařadí na jeho místo. */
  const reorderNode = (kind: NodeKind, fromId: string, toId: string) => {
    setData((d) => {
      const order = siblingsOf(d, { kind, id: fromId }).map((x) => x.id);
      const from = order.indexOf(fromId);
      const to = order.indexOf(toId);
      if (from < 0 || to < 0 || from === to) return d;
      order.splice(from, 1);
      order.splice(to, 0, fromId);
      return applyOrder(d, kind, order);
    });
  };

  /* ---------- opravy ---------- */

  const canAddRepair = selection?.kind === "model" || selection?.kind === "category";

  const openAddRepair = () => {
    const modelIds =
      selection?.kind === "model"
        ? [selection.id]
        : selection?.kind === "category"
          ? data.models.filter((m) => m.categoryId === selection.id).map((m) => m.id)
          : [];
    setNewRepair({ ...EMPTY_REPAIR_DRAFT, modelIds });
    setEditingRepair(null);
    setAddingRepair(true);
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
      createdAt: now(),
    };
    setData((d) => ({ ...d, repairs: [...d.repairs, repair] }));
    setNewRepair(EMPTY_REPAIR_DRAFT);
    setAddingRepair(false);
    showToast("Oprava přidána", "success");
  };

  const startEditRepair = (r: Repair) => {
    setAddingRepair(false);
    setEditRepairData({
      name: r.name,
      price: String(r.price),
      time: String(r.estimatedTime),
      details: r.details,
      costs: r.costs ? String(r.costs) : "",
      productIds: r.productIds || [],
      modelIds: r.modelIds || [],
      hiddenModelIds: r.publicHiddenModelIds || [],
      productSearch: "",
      modelSearch: "",
    });
    setEditingRepair(r.id);
  };

  const deleteRepair = (id: string) => {
    setData((d) => ({ ...d, repairs: d.repairs.filter((r) => r.id !== id) }));
    if (editingRepair === id) setEditingRepair(null);
    showToast("Oprava smazána", "success");
  };

  const askDeleteRepair = (r: Repair) => {
    setConfirm({
      title: `Smazat opravu „${r.name}“?`,
      message:
        r.modelIds.length > 1
          ? `Oprava zmizí u všech ${r.modelIds.length} modelů, ke kterým patří. Akci nelze vrátit zpět.`
          : "Akci nelze vrátit zpět.",
      onConfirm: () => deleteRepair(r.id),
    });
  };

  const updateRepair = (id: string, repairData: RepairDraft) => {
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
              // výjimka nemá smysl u modelu, který k opravě už nepatří
              publicHiddenModelIds: repairData.hiddenModelIds.filter((mid) =>
                repairData.modelIds.includes(mid),
              ),
            }
          : r
      ),
    };
    setData(next);
    setEditingRepair(null);
    showToast("Oprava upravena", "success");
  };

  /* ---------- výběr → opravy vpravo ---------- */

  /** Modely, jejichž opravy se zobrazují. null = bez omezení (nic nevybráno). */
  const scopeModelIds = useMemo<Set<string> | null>(() => {
    if (!selection) return null;
    if (selection.kind === "model") return new Set([selection.id]);
    const catIds =
      selection.kind === "category"
        ? new Set([selection.id])
        : new Set(data.categories.filter((c) => c.brandId === selection.id).map((c) => c.id));
    return new Set(data.models.filter((m) => catIds.has(m.categoryId)).map((m) => m.id));
  }, [data.categories, data.models, selection]);

  const filteredRepairs = useMemo(() => {
    const q = repairSearchQuery.trim().toLowerCase();
    const modelName = new Map(data.models.map((m) => [m.id, m.name.toLowerCase()]));
    return data.repairs.filter((r) => {
      if (scopeModelIds && !r.modelIds?.some((m) => scopeModelIds.has(m))) return false;
      if (!q) return true;
      return (
        r.name.toLowerCase().includes(q) ||
        (r.details ?? "").toLowerCase().includes(q) ||
        (r.modelIds ?? []).some((m) => modelName.get(m)?.includes(q))
      );
    });
  }, [data.repairs, data.models, scopeModelIds, repairSearchQuery]);

  /** „Apple › iPhone › iPhone 13“ pro tlačítko na úzké obrazovce. */
  const crumbText = useMemo(() => {
    if (!selection) return null;
    const names: string[] = [];
    let category: Category | undefined;
    if (selection.kind === "model") {
      const m = data.models.find((x) => x.id === selection.id);
      if (m) {
        names.unshift(m.name);
        category = data.categories.find((c) => c.id === m.categoryId);
      }
    } else if (selection.kind === "category") {
      category = data.categories.find((c) => c.id === selection.id);
    }
    if (category) {
      names.unshift(category.name);
      const b = data.brands.find((x) => x.id === category!.brandId);
      if (b) names.unshift(b.name);
    }
    if (selection.kind === "brand") {
      const b = data.brands.find((x) => x.id === selection.id);
      if (b) names.push(b.name);
    }
    return names.join(" › ");
  }, [data, selection]);

  const selectNode = (sel: Selection | null) => {
    setSelection(sel);
    setRenaming(null);
    /* Rozepsaná oprava má modely podle starého výběru – prázdný formulář
       zavřeme, do rozepsaného uživateli nesaháme. */
    if (addingRepair && !newRepair.name.trim()) setAddingRepair(false);
    if (isNarrow && sel) setTreeOpen(false);
  };


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

  /* Odklikat stovku oprav po jedné nikdo nebude. Působí jen na to, co je
     zrovna vidět podle filtrů – „zveřejnit vše“ napříč celým servisem by
     byl moc velký kanón na omylem stisknuté tlačítko. */
  const hromadnaViditelnost = (zverejnit: boolean) => {
    if (!activeServiceId) return;
    const dotcene = new Set(filteredRepairs.map((r) => r.id));
    const nova: DevicesData = {
      ...data,
      repairs: data.repairs.map((r) =>
        dotcene.has(r.id) ? { ...r, publicVisible: zverejnit } : r,
      ),
    };
    setData(nova);
    saveDevicesToDb(activeServiceId, nova).then((r) => {
      if (r.error) showToast("Změnu viditelnosti se nepodařilo uložit: " + r.error, "error");
      else showToast(
        `${zverejnit ? "Posílá se do API" : "Vyřazeno z API"}: ${dotcene.size} ${dotcene.size === 1 ? "oprava" : dotcene.size < 5 ? "opravy" : "oprav"}`,
        "success",
      );
    });
  };

  /**
   * Přepne, jestli položka jde do veřejného API.
   *
   * Ukládá se hned, ne přes debounce – jinak by uživatel mohl odejít
   * dřív, než se změna zapíše, a myslel si, že něco skryl.
   */
  const prepnoutViditelnost = (
    druh: "brands" | "categories" | "models" | "repairs",
    id: string,
  ) => {
    if (!activeServiceId) return;
    const nova = {
      ...data,
      [druh]: (data[druh] as Array<{ id: string; publicVisible?: boolean }>).map((x) =>
        x.id === id ? { ...x, publicVisible: x.publicVisible === false } : x,
      ),
    } as DevicesData;
    setData(nova);
    saveDevicesToDb(activeServiceId, nova).then((r) => {
      if (r.error) showToast("Změnu viditelnosti se nepodařilo uložit: " + r.error, "error");
    });
  };

  if (showImport) {
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-4)" }}>
        <PageHeader
          title="Import zařízení a oprav"
          subtitle="Importujte značky, kategorie, modely a opravy z TXT souboru."
          actions={
            <Button variant="soft" onClick={() => setShowImport(false)}>
              Zpět na správu
            </Button>
          }
        />

        <div style={card}>
          <div style={{ fontWeight: 950, fontSize: "var(--text-lg)", marginBottom: 16, color: "var(--text)" }}>
            Návod k použití
          </div>
          <div style={{ fontSize: "var(--text-sm)", color: "var(--text)", lineHeight: 1.6, marginBottom: 20 }}>
            <p style={{ marginBottom: 12 }}>
              <strong>Struktura souboru:</strong> Soubor musí obsahovat hierarchii ZNAČKA › KATEGORIE › MODEL › OPRAVA.
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
            <Button variant="primary" onClick={downloadTemplate} style={{ marginTop: 8 }}>
              Stáhnout vzorový soubor
            </Button>
          </div>
        </div>

        <div style={card}>
          <div style={{ fontWeight: 950, fontSize: "var(--text-lg)", marginBottom: 16, color: "var(--text)" }}>
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
            <div style={{ fontWeight: 950, fontSize: "var(--text-lg)", marginBottom: 16, color: "var(--text)" }}>
              Náhled importu
            </div>
            
            {/* Summary */}
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 100px), 1fr))", gap: 12, marginBottom: 20 }}>
              <div style={{ padding: 12, background: "var(--panel-2)", borderRadius: 8, textAlign: "center" }}>
                <div style={{ fontSize: "var(--text-2xl)", fontWeight: 950, color: "var(--accent)", marginBottom: 4 }}>
                  {importPreview.brands.length}
                </div>
                <div style={{ fontSize: "var(--text-xs)", color: "var(--muted)" }}>Značky</div>
              </div>
              <div style={{ padding: 12, background: "var(--panel-2)", borderRadius: 8, textAlign: "center" }}>
                <div style={{ fontSize: "var(--text-2xl)", fontWeight: 950, color: "var(--accent)", marginBottom: 4 }}>
                  {importPreview.categories.length}
                </div>
                <div style={{ fontSize: "var(--text-xs)", color: "var(--muted)" }}>Kategorie</div>
              </div>
              <div style={{ padding: 12, background: "var(--panel-2)", borderRadius: 8, textAlign: "center" }}>
                <div style={{ fontSize: "var(--text-2xl)", fontWeight: 950, color: "var(--accent)", marginBottom: 4 }}>
                  {importPreview.models.length}
                </div>
                <div style={{ fontSize: "var(--text-xs)", color: "var(--muted)" }}>Modely</div>
              </div>
              <div style={{ padding: 12, background: "var(--panel-2)", borderRadius: 8, textAlign: "center" }}>
                <div style={{ fontSize: "var(--text-2xl)", fontWeight: 950, color: "var(--accent)", marginBottom: 4 }}>
                  {importPreview.repairs.length}
                </div>
                <div style={{ fontSize: "var(--text-xs)", color: "var(--muted)" }}>Opravy</div>
              </div>
            </div>

            {/* Detailed preview */}
            <div style={{ marginBottom: 20, maxHeight: 400, overflowY: "auto" }}>
              {importPreview.brands.map((brand, brandIdx) => {
                const brandCategories = importPreview.categories.filter(c => c.brand === brand);
                return (
                  <div key={brandIdx} style={{ marginBottom: 16, padding: 12, background: "var(--panel-2)", borderRadius: 8 }}>
                    <div style={{ fontWeight: 700, fontSize: "var(--text-base)", color: "var(--text)", marginBottom: 8 }}>
                      <DeviceIcon size={14} /> {brand}
                    </div>
                    {brandCategories.map((cat, catIdx) => {
                      const catModels = importPreview.models.filter(m => m.brand === brand && m.category === cat.name);
                      return (
                        <div key={catIdx} style={{ marginLeft: 16, marginBottom: 12 }}>
                          <div style={{ fontWeight: 600, fontSize: "var(--text-sm)", color: "var(--text)", marginBottom: 6 }}>
                            <FolderIcon size={14} /> {cat.name}
                          </div>
                          {catModels.map((model, modelIdx) => {
                            const modelRepairs = importPreview.repairs.filter(r => r.brand === brand && r.category === cat.name && r.model === model.name);
                            return (
                              <div key={modelIdx} style={{ marginLeft: 16, marginBottom: 8 }}>
                                <div style={{ fontWeight: 600, fontSize: "var(--text-xs)", color: "var(--text)", marginBottom: 4 }}>
                                  <WrenchIcon size={14} /> {model.name}
                                </div>
                                {modelRepairs.length > 0 && (
                                  <div style={{ marginLeft: 16 }}>
                                    {modelRepairs.map((repair, repairIdx) => (
                                      <div key={repairIdx} style={{ fontSize: "var(--text-xs)", color: "var(--muted)", marginBottom: 4, padding: "4px 8px", background: "var(--panel)", borderRadius: 4 }}>
                                        {repair.name} ({repair.price} Kč, {repair.time} min{repair.costs ? `, náklady: ${repair.costs} Kč` : ""})
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
                  <WarningIcon size={13} /> Nalezené duplicity ({importPreview.duplicates.length}):
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: 4, maxHeight: 150, overflowY: "auto" }}>
                  {importPreview.duplicates.map((dup, idx) => (
                    <div key={idx} style={{ fontSize: "var(--text-xs)", color: "var(--text)", padding: "4px 8px", background: "rgba(239, 68, 68, 0.1)", borderRadius: 4 }}>
                      {dup.type}: {dup.name}
                    </div>
                  ))}
                </div>
                <div style={{ fontSize: "var(--text-xs)", color: "var(--muted)", marginTop: 8 }}>
                  Duplicitní položky budou přeskočeny při importu.
                </div>
              </div>
            )}

            <Button variant="primary"
              onClick={executeImport} style={{ marginTop: 16, width: "100%" }}
            >
              Provedit import ({importPreview.brands.length} značek, {importPreview.categories.length} kategorií, {importPreview.models.length} modelů, {importPreview.repairs.length} oprav)
            </Button>
          </div>
        )}
      </div>
    );
  }

  const subtitle = [
    `${data.brands.length} ${plural(data.brands.length, ["značka", "značky", "značek"])}`,
    `${data.models.length} ${plural(data.models.length, ["model", "modely", "modelů"])}`,
    `${data.repairs.length} ${plural(data.repairs.length, ["oprava", "opravy", "oprav"])}`,
  ].join(" · ");

  const tree = (
    <DeviceTree
      data={data}
      selection={selection}
      onSelect={selectNode}
      renaming={renaming}
      onStartRename={setRenaming}
      onCommitRename={renameNode}
      onCancelRename={() => setRenaming(null)}
      onDelete={askDeleteNode}
      onAdd={addNode}
      onMove={moveNode}
      onReorder={reorderNode}
      onTogglePublic={(sel) => prepnoutViditelnost(KIND_KEY[sel.kind], sel.id)}
      showPublic={ukazatViditelnost}
    />
  );

  const repairsPane = (
    <RepairsPane
      data={data}
      products={inventoryData.products}
      selection={selection}
      onSelect={selectNode}
      onStartRename={(sel) => {
        setRenaming(sel);
        if (isNarrow) setTreeOpen(true);
      }}
      onToggleNodePublic={(sel) => prepnoutViditelnost(KIND_KEY[sel.kind], sel.id)}
      showPublic={ukazatViditelnost}
      repairs={filteredRepairs}
      search={repairSearchQuery}
      onSearch={setRepairSearchQuery}
      onToggleRepairPublic={(id) => prepnoutViditelnost("repairs", id)}
      onBulkPublic={hromadnaViditelnost}
      canAdd={canAddRepair}
      adding={addingRepair}
      onOpenAdd={openAddRepair}
      onCancelAdd={() => {
        setAddingRepair(false);
        setNewRepair(EMPTY_REPAIR_DRAFT);
      }}
      newRepair={newRepair}
      setNewRepair={setNewRepair}
      onSubmitAdd={addRepairItem}
      editingId={editingRepair}
      editDraft={editRepairData}
      setEditDraft={setEditRepairData}
      onStartEdit={startEditRepair}
      onSaveEdit={() => {
        if (editingRepair) updateRepair(editingRepair, editRepairData);
      }}
      onCancelEdit={() => setEditingRepair(null)}
      onDeleteRepair={askDeleteRepair}
    />
  );

  return (
    <div data-tour="devices-main" style={{ display: "flex", flexDirection: "column", gap: "var(--space-4)" }}>
      {devicesLoadError && (
        <div
          role="alert"
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: "var(--space-3)",
            padding: "var(--space-3) var(--space-4)",
            background: "var(--danger-soft)",
            borderRadius: "var(--radius-md)",
            border: "1px solid var(--danger)",
            color: "var(--text)",
            fontSize: "var(--text-base)",
          }}
        >
          <span>Chyba načítání: {devicesLoadError}</span>
          <Button
            variant="primary"
            size="sm"
            onClick={() => {
              resetTauriFetchState();
              setRetryKey((k) => k + 1);
            }}
          >
            Načíst znovu
          </Button>
        </div>
      )}
      {devicesLoading && activeServiceId && !devicesLoadError && (
        <Card style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: "var(--space-3)", padding: "var(--space-5)" }}>
          <div
            aria-hidden="true"
            style={{
              width: 22,
              height: 22,
              border: "2px solid var(--accent)",
              borderTopColor: "transparent",
              borderRadius: "50%",
              animation: "devicesSpin 0.7s linear infinite",
            }}
          />
          <span style={{ color: "var(--muted)", fontSize: "var(--text-base)" }}>Načítání zařízení…</span>
        </Card>
      )}
      <style>{`@keyframes devicesSpin { to { transform: rotate(360deg); } }`}</style>

      <PageHeader
        title="Zařízení a opravy"
        subtitle={subtitle}
        actions={
          <Button variant="primary" onClick={() => setShowImport(true)}>
            Import
          </Button>
        }
      />

      {isNarrow ? (
        <>
          <TreeTriggerButton
            label={crumbText ?? "Všechna zařízení – klepnutím vyberete značku, kategorii nebo model"}
            onClick={() => setTreeOpen(true)}
          />
          <DeviceTreeSheet open={treeOpen} onClose={() => setTreeOpen(false)}>
            {tree}
          </DeviceTreeSheet>
          {repairsPane}
        </>
      ) : (
        <div style={{ display: "flex", gap: "var(--space-4)", alignItems: "flex-start" }}>
          {/* Strom si posouvá sám: lepí se k hornímu okraji a nepřeroste
              viditelnou plochu, seznam oprav vpravo běží s celou stránkou. */}
          <Card
            style={{
              width: 320,
              flexShrink: 0,
              position: "sticky",
              top: 0,
              maxHeight: "calc(100dvh - var(--topbar-h) - var(--pad-24) * 2)",
              display: "flex",
              flexDirection: "column",
              overflow: "hidden",
              padding: "var(--space-3)",
            }}
          >
            {tree}
          </Card>
          <div style={{ flex: 1, minWidth: 0 }}>{repairsPane}</div>
        </div>
      )}

      <ConfirmDialog
        open={!!confirm}
        title={confirm?.title ?? ""}
        message={confirm?.message ?? ""}
        confirmLabel="Smazat"
        variant="danger"
        onConfirm={() => {
          confirm?.onConfirm();
          setConfirm(null);
        }}
        onCancel={() => setConfirm(null)}
      />
    </div>
  );
}
