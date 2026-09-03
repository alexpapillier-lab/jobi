import React, { useCallback, useEffect, useMemo, useState, useRef } from "react";
import { Button, Input, MenuItem } from "../components/ui";
import { BoxIcon, WarningIcon } from "../components/icons";
import { createPortal } from "react-dom";
import { showToast } from "../components/Toast";
import { reportError } from "../lib/reportError";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { useActiveRole } from "../hooks/useActiveRole";
import { useEntitlements } from "../hooks/useEntitlements";
import { useIsNarrow } from "../hooks/useIsNarrow";
import { STORAGE_KEYS, getInventoryKey } from "../constants/storageKeys";
import { loadDevicesFromDb } from "../lib/devicesDb";
import {
  loadInventoryFromDb, saveInventoryToDb, celkemKusu, vychoziSklad, stavyZeStarehoTvaru,
  type Warehouse,
} from "../lib/inventoryDb";
import { nahrajObrazekProduktu, smazObrazekProduktu } from "../lib/productImages";
import { oznamZmenuKatalogu } from "../lib/webhookPing";
import { supabase } from "../lib/supabaseClient";
const PRODUCT_DISPLAY_MODE_KEY = STORAGE_KEYS.INVENTORY_DISPLAY_MODE;
const INVENTORY_DISPLAY_MODE_EVENT = "jobsheet:inventory-display-mode-changed";

/**
 * Stav skladu, který tenhle klient naposledy viděl uložený. Od něj se počítá,
 * co se má poslat do databáze – bez toho by starší kopie přepsala cizí úpravy.
 *
 * Schválně mimo komponentu: snímek se nastavuje uvnitř efektu (po načtení)
 * i mimo něj (po úspěšném uložení) a React Compiler takový ref odmítá
 * („This value cannot be modified“). Klíčuje se servisem, takže po přepnutí
 * neplatí a přežije i přemontování stránky.
 */
let posledniUlozeno: { sid: string; data: InventoryData } | null = null;

function snimekProServis(sid: string): InventoryData | undefined {
  return posledniUlozeno && posledniUlozeno.sid === sid ? posledniUlozeno.data : undefined;
}

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
  /** Součet přes sklady. Odvozený – měň `stockByWarehouse`. */
  stock: number;
  /** Kolik kusů leží ve kterém skladu. Klíč je id skladu. */
  stockByWarehouse: Record<string, number>;
  price: number;
  /** Nákupní cena. Nepovinná; do veřejného API jde jen když si to servis zapne. */
  purchasePrice?: number | null;
  sku?: string;
  description?: string;
  imageUrl?: string; // base64 or URL
  repairIds?: string[]; // repairs that use this product
  createdAt: string;
};

type InventoryData = {
  productCategories: ProductCategory[];
  products: Product[];
  warehouses: Warehouse[];
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

/* Data z localStorage můžou být z verze před sklady – tam měl produkt jen
   `stock`. Sklady se dopočítají až v `sladitSeSklady`, kdy je známe. */
function parseInventoryRaw(parsed: InventoryData & Record<string, unknown>): InventoryData {
  const produkty = (parsed.products || []).map((p: any) => ({ ...p, stockByWarehouse: p.stockByWarehouse ?? {} }));
  const sklady = Array.isArray(parsed.warehouses) ? parsed.warehouses : [];
  if ("brands" in parsed || "categories" in parsed || "models" in parsed) {
    return { productCategories: (parsed.productCategories || []).map((c: any) => ({ ...c, modelIds: c.modelIds || [] })), products: produkty, warehouses: sklady };
  }
  if (!parsed.productCategories) {
    return { productCategories: [], products: produkty, warehouses: sklady };
  }
  return {
    ...parsed,
    productCategories: parsed.productCategories.map((c: any) => ({ ...c, modelIds: c.modelIds || [] })),
    products: produkty,
    warehouses: sklady,
  };
}

function loadInventoryFromKey(key: string): InventoryData {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return EMPTY_INVENTORY;
    return parseInventoryRaw(JSON.parse(raw) as InventoryData & Record<string, unknown>);
  } catch {
    return EMPTY_INVENTORY;
  }
}

/**
 * Doplní produktům stavy po skladech a převezme seznam skladů z databáze.
 *
 * Produkt ze starších dat má jen `stock`; ten se přiřadí výchozímu skladu.
 * Kdyby se to nedělalo, zásoba by se při prvním uložení ztratila.
 */
function sladitSeSklady(data: InventoryData, sklady: Warehouse[]): InventoryData {
  const vychozi = vychoziSklad(sklady);
  return {
    ...data,
    warehouses: sklady,
    products: data.products.map((p) => {
      const stavy = stavyZeStarehoTvaru(p, vychozi);
      return { ...p, stockByWarehouse: stavy, stock: celkemKusu(stavy) };
    }),
  };
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
        <MenuItem
          layout="between"
          selected={value === opt.value}
          key={opt.value}
          onClick={() => {
            onChange(opt.value as any);
            setOpen(false);
          }}
        >
          <span>{opt.label}</span>
          {value === opt.value && <span style={{ fontSize: 12, opacity: 0.8 }}>✓</span>}
        </MenuItem>
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
        <MenuItem
          layout="between"
          selected={value === opt.value}
          key={opt.value}
          onClick={() => {
            onChange(opt.value as any);
            setOpen(false);
          }}
        >
          <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span style={{ fontSize: 16 }}>{opt.icon}</span>
            <span>{opt.label}</span>
          </span>
          {value === opt.value && <span style={{ fontSize: 12, opacity: 0.8 }}>✓</span>}
        </MenuItem>
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

/**
 * Rychlá změna počtu kusů přímo v náhledu produktu.
 * Vlastní <button>, ne Button z ui – potřebujeme čtvercové tlačítko
 * bez vnitřního odsazení, aby stepper zabral stejnou výšku jako cena.
 */
function StockStepper({
  stock,
  dense,
  onAdjust,
}: {
  stock: number;
  dense?: boolean;
  onAdjust: (delta: number) => void;
}) {
  const size = dense ? 22 : 26;
  const barva = stock === 0 ? "var(--danger-text)" : stock < 5 ? "var(--warning-text)" : "var(--text)";
  const krok = (delta: number) => (e: React.MouseEvent) => {
    e.stopPropagation();
    onAdjust(delta);
  };
  const tlacitko = (disabled: boolean): React.CSSProperties => ({
    width: size,
    height: size,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    border: "1px solid var(--border)",
    borderRadius: "var(--radius-2xs, 6px)",
    background: "var(--panel-2)",
    color: disabled ? "var(--muted)" : "var(--text)",
    fontSize: dense ? 13 : 14,
    fontWeight: 800,
    lineHeight: 1,
    cursor: disabled ? "default" : "pointer",
    opacity: disabled ? 0.45 : 1,
    padding: 0,
  });
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 4 }} title="Rychlá změna počtu kusů">
      <button
        type="button"
        aria-label="Odebrat kus"
        disabled={stock <= 0}
        onClick={krok(-1)}
        style={tlacitko(stock <= 0)}
      >
        −
      </button>
      <div
        style={{
          minWidth: dense ? 44 : 52,
          textAlign: "center",
          fontSize: dense ? 12 : 13,
          fontWeight: 800,
          color: barva,
          whiteSpace: "nowrap",
        }}
      >
        {stock} ks
      </div>
      <button type="button" aria-label="Přidat kus" onClick={krok(1)} style={tlacitko(false)}>
        +
      </button>
    </div>
  );
}

/**
 * Zásoba produktu v náhledu. Se dvěma a víc sklady musí být vidět, kterého
 * skladu se „+“ týká – jinak by uživatel přidával kusy naslepo. Filtr skladu
 * proto rovnou zužuje, co se ukazuje.
 */
function StockCell({
  product,
  warehouses,
  filterId,
  dense,
  onAdjust,
}: {
  product: { stock: number; stockByWarehouse: Record<string, number> };
  warehouses: Warehouse[];
  filterId: string;
  dense?: boolean;
  onAdjust: (warehouseId: string, delta: number) => void;
}) {
  const viditelne = filterId === "all" ? warehouses : warehouses.filter((w) => w.id === filterId);
  if (viditelne.length === 0) return null;
  // Jediný sklad: vypadá to přesně jako předtím, bez popisků navíc.
  if (viditelne.length === 1) {
    const w = viditelne[0];
    return (
      <StockStepper
        stock={product.stockByWarehouse[w.id] ?? 0}
        dense={dense}
        onAdjust={(delta) => onAdjust(w.id, delta)}
      />
    );
  }
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 3, alignItems: "flex-end" }}>
      <div style={{ fontSize: 11, color: "var(--muted)", whiteSpace: "nowrap" }}>
        {product.stock} ks celkem
      </div>
      {viditelne.map((w) => (
        <div key={w.id} style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <span
            title={w.name}
            style={{ fontSize: 11, color: "var(--muted)", maxWidth: 96, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}
          >
            {w.name}
          </span>
          <StockStepper
            stock={product.stockByWarehouse[w.id] ?? 0}
            dense
            onAdjust={(delta) => onAdjust(w.id, delta)}
          />
        </div>
      ))}
    </div>
  );
}

type InventoryProps = { activeServiceId: string | null };

const EMPTY_INVENTORY: InventoryData = { productCategories: [], products: [], warehouses: [] };

export default function Inventory({ activeServiceId }: InventoryProps) {
  const isNarrow = useIsNarrow();
  const { hasCapability } = useActiveRole(activeServiceId);
  const { has: maModul } = useEntitlements(activeServiceId);
  /* Přepínač viditelnosti dává smysl jen když servis sklad ven vůbec posílá. */
  const ukazatViditelnost = maModul("api_inventory");
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

  const [newProduct, setNewProduct] = useState({ name: "", stock: "", price: "", purchasePrice: "", sku: "", description: "", modelIds: [] as string[], imageUrl: "", repairIds: [] as string[], categoryId: "" });
  /* Do kterého skladu se ukládá nový produkt a import. Prázdné = výchozí sklad. */
  const [newProductWarehouseId, setNewProductWarehouseId] = useState<string>("");
  /* Který sklad je vidět v seznamu. "all" = všechny, se součtem. */
  const [warehouseFilter, setWarehouseFilter] = useState<string>("all");
  const [newWarehouseName, setNewWarehouseName] = useState("");
  const [editingWarehouse, setEditingWarehouse] = useState<string | null>(null);
  const [editWarehouseName, setEditWarehouseName] = useState("");
  /* Mazání skladu, ve kterém ještě něco leží – kusy by zmizely, tak se ptáme. */
  const [deleteWarehouseInfo, setDeleteWarehouseInfo] = useState<{ id: string; kusy: number; onConfirm: () => void } | null>(null);
  const [newProductUnassigned, setNewProductUnassigned] = useState(false);
  const [newProductCategoryName, setNewProductCategoryName] = useState("");

  useEffect(() => {
    setNewProductUnassigned(!selectedModelId);
  }, [selectedModelId]);
  const [selectedProductCategoryId, setSelectedProductCategoryId] = useState<string | null>(null);
  
  // Filters for product list
  const [productSearchQuery, setProductSearchQuery] = useState("");
  const [productStockFilter, setProductStockFilter] = useState<"all" | "inStock" | "lowStock" | "outOfStock" | "noModels">("all");
  const [productDisplayMode, setProductDisplayMode] = useState<"grid" | "list" | "compact">(() => {
    const saved = localStorage.getItem(PRODUCT_DISPLAY_MODE_KEY);
    // Výchozí je řádkový seznam – stejné rozvržení jako u oprav v Zařízeních.
    return (saved as "grid" | "list" | "compact") || "list";
  });
  const [stockChanges, setStockChanges] = useState<Record<string, string>>({});
  /* Do kterého skladu se naskladňuje. Prázdné = výchozí sklad. */
  const [restockWarehouseId, setRestockWarehouseId] = useState<string>("");
  const [editingStock, setEditingStock] = useState<string | null>(null);
  const [nahravamObrazek, setNahravamObrazek] = useState(false);

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
    // Jiný servis = jiná data; starý snímek by dal nesmyslný rozdíl.
    posledniUlozeno = null;
    (async () => {
      const devicesRes = await loadDevicesFromDb(activeServiceId);
      if (cancelled) return;
      if (!devicesRes.error) setDevicesData(devicesRes.data);

      const loadRes = await loadInventoryFromDb(activeServiceId);
      if (cancelled) return;
      let invData = loadRes.data;
      const hasDb = !loadRes.error && (invData.productCategories.length > 0 || invData.products.length > 0);
      if (!hasDb) {
        const fromStorage = loadInventoryFromKey(getInventoryKey(activeServiceId));
        const legacy = loadInventoryFromKey(STORAGE_KEYS.INVENTORY);
        const merged =
          fromStorage.productCategories.length > 0 || fromStorage.products.length > 0
            ? fromStorage
            : legacy;
        const hasStorage = merged.productCategories.length > 0 || merged.products.length > 0;
        if (hasStorage) {
          /* Sklady bere z databáze – ta je zakládá sama a localStorage o nich
             nemusí vědět. Bez toho by zásoba ze starých dat neměla kam jít. */
          const sladeno = sladitSeSklady(merged, invData.warehouses);
          await saveInventoryToDb(activeServiceId, sladeno);
          invData = sladeno;
        }
      }
      if (cancelled) return;
      // Snímek toho, co je v databázi – od něj se počítá rozdíl při ukládání.
      posledniUlozeno = { sid: activeServiceId, data: invData };
      setData(invData);
    })();
    return () => {
      cancelled = true;
    };
  }, [activeServiceId]);

  // Po vlastním uložení neřešit realtime reload (zabrání smyčce: save → realtime → setData → save)
  const lastSaveAtRef = useRef<number>(0);
  // Save inventory to DB when data changes – debounced, max jeden toast za chybu
  const saveErrorToastRef = useRef<number>(0);
  /* Stav, který tenhle klient naposledy viděl uložený. Posílá se do
     saveInventoryToDb, aby zapsalo jen rozdíl – jinak by starší kopie
     přepsala cizí úpravy (typicky obrázky na null). */

  const dataRef = useRef(data);
  const sluzbaRef = useRef(activeServiceId);
  /* Zápis do refů patří do efektu, ne do renderu (React Compiler:
     „Cannot access refs during render“). Efekt běží po každém renderu,
     takže než se stihne spustit jakákoli událost, jsou hodnoty aktuální. */
  useEffect(() => {
    dataRef.current = data;
    sluzbaRef.current = activeServiceId;
  });

  /* Hláška o uložení se drží tady a vypíše se, až databáze potvrdí zápis.
     Dřív se volala hned po setData, takže hlásila jen změnu v paměti –
     a když zápis neprošel, uživatel se to nedozvěděl. */
  const cekaHlaska = useRef<string | null>(null);

  const ulozSklad = useCallback(async (kdo: string) => {
    const sid = sluzbaRef.current;
    if (!sid) return;
    /* Dokud nevíme, co je v databázi, nesmíme zapisovat vůbec. Bez snímku
       jde saveInventoryToDb do režimu „zapiš všechno a smaž, co v datech
       není“ – a data jsou při odchodu před dokončením načtení prázdná.
       Přesně tímhle jsem smazal sklad: odchod ze Skladu do 300 ms od
       otevření uložil prázdno. */
    const drive = snimekProServis(sid);
    if (!drive) return;
    const k = dataRef.current;

    /* Snímek je mimo komponentu, takže po návratu na Sklad existuje dřív,
       než se data stihnou načíst – a `data` jsou v tu chvíli prázdná.
       Rozdíl proti neprázdnému snímku by pak znamenal „smaž všechno“.
       3. 9. z toho byly chyby „Poslední sklad servisu nejde smazat“
       a porušený unikátní index na výchozí sklad; nebýt těch dvou
       pojistek v databázi, smazalo by to produkty. */
    const prazdno = k.products.length === 0 && k.productCategories.length === 0 && k.warehouses.length === 0;
    const drivNeco = drive.products.length > 0 || drive.productCategories.length > 0 || drive.warehouses.length > 0;
    if (prazdno && drivNeco) return;

    /* Značka se staví PŘED zápisem, ne až po něm. Ukládání je několik
       požadavků za sebou a hned ten první vyvolá realtime událost; její
       přenačtení má 800ms prodlevu, takže dobíhalo ještě během zápisu.
       setData(res.data) pak přepsalo rozdělaná data i snímek – množství
       v inventory_stock se zapisuje až po produktech, takže reload viděl
       produkt s nulou a další uložení to vyhodnotilo jako „ubyly kusy“. */
    lastSaveAtRef.current = Date.now();
    const r = await saveInventoryToDb(sid, k, drive);
    if (!r.error) {
      posledniUlozeno = { sid, data: k };
      lastSaveAtRef.current = Date.now();
      if (cekaHlaska.current) {
        showToast(cekaHlaska.current, "success");
        cekaHlaska.current = null;
      }
      oznamZmenuKatalogu(sid);
      return;
    }
    cekaHlaska.current = null;
    const now = Date.now();
    if (now - saveErrorToastRef.current > 5000) {
      saveErrorToastRef.current = now;
      reportError({
        code: "inventory.save_failed",
        error: r.error,
        userMessage: "Sklad se nepodařilo uložit: " + r.error,
        source: kdo,
      });
    }
  }, []);

  useEffect(() => {
    if (!activeServiceId) return;
    // Po vědomé akci (uložení produktu) krátce, ať potvrzení přijde hned;
    // u průběžných změn se drží delší prodleva.
    const t = setTimeout(() => { ulozSklad("Inventory.saveInventory"); }, cekaHlaska.current ? 150 : 1200);
    return () => clearTimeout(t);
  }, [activeServiceId, data, ulozSklad]);

  /* Dopsání při skutečném odchodu ze Skladu. Dřív viselo na úklidu efektu
     výš, jenže ten běží po KAŽDÉ změně dat – a v tu chvíli má dataRef ještě
     hodnotu z minulého renderu (úklidy běží před efekty). Ukládal se tak
     předchozí stav a po návratu na Sklad i prázdná data. Prázdné pole
     dependencies znamená, že tohle se spustí jen při odmontování. */
  useEffect(() => {
    return () => { ulozSklad("Inventory.saveOnLeave"); };
  }, [ulozSklad]);

  /* Zavření panelu ani celého okna neproběhne přes odmontování komponenty,
     proto ještě tohle. `pagehide` chytí i Safari, kde se `beforeunload`
     někdy nespustí. */
  useEffect(() => {
    const dopis = () => { ulozSklad("Inventory.savePageHide"); };
    window.addEventListener("pagehide", dopis);
    window.addEventListener("beforeunload", dopis);
    return () => {
      window.removeEventListener("pagehide", dopis);
      window.removeEventListener("beforeunload", dopis);
    };
  }, [ulozSklad]);

  useEffect(() => {
    if (!canAdjustInventoryQuantity && editingStock) setEditingStock(null);
  }, [canAdjustInventoryQuantity, editingStock]);

  useEffect(() => {
    if (localStorage.getItem(PRODUCT_DISPLAY_MODE_KEY) === productDisplayMode) return;
    localStorage.setItem(PRODUCT_DISPLAY_MODE_KEY, productDisplayMode);
    window.dispatchEvent(new CustomEvent(INVENTORY_DISPLAY_MODE_EVENT));
  }, [productDisplayMode]);

  // Zobrazení skladu nastavené na jiném zařízení dorazí přes
  // personalPreferencesSync rovnou do localStorage – bez tohohle
  // posluchače by se projevilo až po refreshi.
  useEffect(() => {
    const onExternalChange = () => {
      const saved = localStorage.getItem(PRODUCT_DISPLAY_MODE_KEY) as "grid" | "list" | "compact" | null;
      if (saved) setProductDisplayMode((prev) => (prev === saved ? prev : saved));
    };
    window.addEventListener(INVENTORY_DISPLAY_MODE_EVENT, onExternalChange);
    return () => window.removeEventListener(INVENTORY_DISPLAY_MODE_EVENT, onExternalChange);
  }, []);

  // Refresh inventory from DB when returning from import
  useEffect(() => {
    if (!showImport && activeServiceId) {
      loadInventoryFromDb(activeServiceId).then((res) => {
        if (!res.error) { posledniUlozeno = { sid: activeServiceId, data: res.data }; setData(res.data); }
      });
    }
  }, [showImport, activeServiceId]);

  // Realtime: přenačíst jen při změně od jiného klienta; debounce + ignorovat reload chvíli po vlastním save (zabrání záplavě requestů)
  useEffect(() => {
    if (!activeServiceId || !supabase) return;
    const topic = `inventory:${activeServiceId}`;
    let reloadTimer: ReturnType<typeof setTimeout> | null = null;
    const reloadInventory = () => {
      if (reloadTimer) clearTimeout(reloadTimer);
      reloadTimer = setTimeout(() => {
        reloadTimer = null;
        if (Date.now() - lastSaveAtRef.current < 4000) return; // vlastní save – nepřenačítat
        loadInventoryFromDb(activeServiceId).then((res) => {
          if (!res.error) { posledniUlozeno = { sid: activeServiceId, data: res.data }; setData(res.data); }
        });
      }, 800);
    };
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
      if (reloadTimer) clearTimeout(reloadTimer);
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
    if (!newProductCategoryName.trim()) {
      reportError({
        code: "inventory.add_product_category_failed",
        error: undefined,
        userMessage: "Zadejte název kategorie",
        source: "Inventory.addProductCategory",
      });
      return;
    }
    const category: ProductCategory = {
      id: uuid(),
      name: newProductCategoryName.trim(),
      modelIds: [], // začíná bez modelů, uživatel si je přidá
      createdAt: new Date().toISOString(),
    };
    setData((d) => ({ ...d, productCategories: [...d.productCategories, category] }));
    setNewProductCategoryName("");
    cekaHlaska.current = "Kategorie produktů přidána";
  };

  const deleteProductCategory = (id: string) => {
    setData((d) => ({
      ...d,
      productCategories: d.productCategories.filter((c) => c.id !== id),
      products: d.products.map((p) => (p.categoryId === id ? { ...p, categoryId: undefined } : p)),
    }));
    if (selectedProductCategoryId === id) setSelectedProductCategoryId(null);
    cekaHlaska.current = "Kategorie produktů smazána";
  };

  const updateProductCategory = (id: string, name: string) => {
    setData((d) => ({
      ...d,
      productCategories: d.productCategories.map((c) => (c.id === id ? { ...c, name } : c)),
    }));
    setEditingProductCategory(null);
    cekaHlaska.current = "Kategorie produktů upravena";
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
    const modelIds = newProductUnassigned ? [] : (selectedModelId ? [selectedModelId] : []);
    const stock = parseInt(newProduct.stock) || 0;
    const cilovySklad = newProductWarehouseId || vychoziSklad(data.warehouses);
    const stavy = stock > 0 && cilovySklad ? { [cilovySklad]: stock } : {};

    if (stock < 1) {
      setLowStockCallback(() => () => {
        const product: Product = {
          id: uuid(),
          name: newProduct.name.trim(),
          modelIds,
          stock: celkemKusu(stavy),
          stockByWarehouse: stavy,
          price: parseFloat(newProduct.price) || 0,
          purchasePrice: newProduct.purchasePrice.trim() === "" ? null : parseFloat(newProduct.purchasePrice),
          sku: newProduct.sku.trim() || undefined,
          description: newProduct.description.trim() || undefined,
          imageUrl: newProduct.imageUrl || undefined,
          repairIds: newProduct.repairIds.length > 0 ? newProduct.repairIds : undefined,
          categoryId: newProduct.categoryId || undefined,
          createdAt: new Date().toISOString(),
        };
        setData((d) => ({ ...d, products: [...d.products, product] }));
        setNewProduct({ name: "", stock: "", price: "", purchasePrice: "", sku: "", description: "", modelIds: [], imageUrl: "", repairIds: [], categoryId: "" });
        cekaHlaska.current = "Produkt přidán";
      });
      setLowStockDialogOpen(true);
      return;
    }

    const product: Product = {
      id: uuid(),
      name: newProduct.name.trim(),
      modelIds,
      stock: celkemKusu(stavy),
      stockByWarehouse: stavy,
      price: parseFloat(newProduct.price) || 0,
          purchasePrice: newProduct.purchasePrice.trim() === "" ? null : parseFloat(newProduct.purchasePrice),
      sku: newProduct.sku.trim() || undefined,
      description: newProduct.description.trim() || undefined,
      imageUrl: newProduct.imageUrl || undefined,
      repairIds: newProduct.repairIds.length > 0 ? newProduct.repairIds : undefined,
      categoryId: newProduct.categoryId || undefined,
      createdAt: new Date().toISOString(),
    };
    setData((d) => ({ ...d, products: [...d.products, product] }));
    setNewProduct({ name: "", stock: "", price: "", purchasePrice: "", sku: "", description: "", modelIds: [], imageUrl: "", repairIds: [], categoryId: "" });
    cekaHlaska.current = "Produkt přidán";
  };

  // Brands, categories and models are managed in Devices page - no delete functions needed

  const deleteProduct = (id: string) => {
    setData((d) => ({ ...d, products: d.products.filter((p) => p.id !== id) }));
    showToast("Produkt smazán", "success");
  };

  /**
   * Přidání/odebrání kusu v konkrétním skladu, přímo v seznamu. Bez
   * potvrzovacího dialogu – varování u nulového skladu má smysl při ruční
   * editaci, ne u klikání na „−“. Zápis do DB obstará stejný debounce jako
   * u ostatních změn.
   */
  const adjustStock = (id: string, warehouseId: string, delta: number) => {
    setData((d) => ({
      ...d,
      products: d.products.map((p) => {
        if (p.id !== id) return p;
        const stavy = { ...p.stockByWarehouse };
        const novy = Math.max(0, (stavy[warehouseId] ?? 0) + delta);
        // Nula se nedrží jako řádek – ať se „odepsáno“ nepletlo s „nikdy tu nebylo“.
        if (novy === 0) delete stavy[warehouseId];
        else stavy[warehouseId] = novy;
        return { ...p, stockByWarehouse: stavy, stock: celkemKusu(stavy) };
      }),
    }));
  };

  /** Naskladnění o `zmena` kusů do vybraného skladu. */
  const naskladnit = (productId: string, zmena: number) => {
    const cil = restockWarehouseId || vychoziSklad(data.warehouses);
    if (!cil) {
      showToast("Servis nemá žádný sklad", "error");
      return;
    }
    adjustStock(productId, cil, zmena);
    const kam = data.warehouses.length > 1
      ? ` (${data.warehouses.find((w) => w.id === cil)?.name ?? "sklad"})`
      : "";
    showToast(zmena > 0 ? `Přidáno ${zmena} ks${kam}` : `Odebráno ${Math.abs(zmena)} ks${kam}`, "success");
  };

  const addWarehouse = (name: string) => {
    const n = name.trim();
    if (!n) return;
    if (data.warehouses.some((w) => w.name.toLowerCase() === n.toLowerCase())) {
      showToast("Sklad s tímhle názvem už existuje", "error");
      return;
    }
    const w: Warehouse = {
      id: uuid(),
      name: n,
      // Výchozí je jen ten první; databáze víc než jeden stejně nepustí.
      isDefault: data.warehouses.length === 0,
      publicVisible: true,
      createdAt: new Date().toISOString(),
    };
    setData((d) => ({ ...d, warehouses: [...d.warehouses, w] }));
    showToast("Sklad přidán", "success");
  };

  const updateWarehouse = (id: string, zmena: Partial<Warehouse>) => {
    setData((d) => ({
      ...d,
      warehouses: d.warehouses.map((w) => {
        if (w.id === id) return { ...w, ...zmena };
        // Výchozí sklad je právě jeden – nastavením nového se ten starý zruší.
        if (zmena.isDefault === true) return { ...w, isDefault: false };
        return w;
      }),
    }));
  };

  const deleteWarehouse = (id: string) => {
    if (data.warehouses.length <= 1) {
      showToast("Poslední sklad nejde smazat", "error");
      return;
    }
    const kusy = data.products.reduce((a, p) => a + (p.stockByWarehouse[id] ?? 0), 0);
    const smazat = () => {
      setData((d) => {
        const zbytek = d.warehouses.filter((w) => w.id !== id);
        // Kdyby se mazal výchozí, musí ho někdo převzít.
        if (!zbytek.some((w) => w.isDefault) && zbytek[0]) zbytek[0] = { ...zbytek[0], isDefault: true };
        return {
          ...d,
          warehouses: zbytek,
          products: d.products.map((p) => {
            if (p.stockByWarehouse[id] === undefined) return p;
            const stavy = { ...p.stockByWarehouse };
            delete stavy[id];
            return { ...p, stockByWarehouse: stavy, stock: celkemKusu(stavy) };
          }),
        };
      });
      if (warehouseFilter === id) setWarehouseFilter("all");
      showToast("Sklad smazán", "success");
    };
    if (kusy > 0) {
      setDeleteWarehouseInfo({ id, kusy, onConfirm: smazat });
      return;
    }
    smazat();
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
        cekaHlaska.current = "Produkt upraven";
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
    cekaHlaska.current = "Produkt upraven";
  };

  const handleImageUpload = (e: React.ChangeEvent<HTMLInputElement>, isEdit: boolean) => {
    const file = e.target.files?.[0];
    if (!file) return;
    
    if (!file.type.startsWith('image/')) {
      reportError({
        code: "inventory.file_failed",
        error: undefined,
        userMessage: 'Prosím vyberte obrázek',
        source: "Inventory.file",
      });
      return;
    }
    
    /* Obrázek jde do úložiště, do sloupce se ukládá jen adresa. Dřív se
       tady četl jako base64 přímo do dat skladu – každé uložení pak
       posílalo všechny fotky všech produktů znovu. Starší base64 hodnoty
       zůstávají funkční, `<img src>` i veřejné API berou obojí. */
    const sid = activeServiceId;
    if (!sid) return;

    setNahravamObrazek(true);
    const stary = isEdit ? editProductData.imageUrl : newProduct.imageUrl;
    // Nový produkt ještě nemá id; složka „nove“ nevadí, práva se řídí
    // podle prvního dílu cesty, tedy podle servisu.
    const kam = isEdit ? (editingProduct ?? "nove") : "nove";

    nahrajObrazekProduktu(supabase, sid, kam, file)
      .then((adresa) => {
        if (isEdit) setEditProductData((p) => ({ ...p, imageUrl: adresa }));
        else setNewProduct((p) => ({ ...p, imageUrl: adresa }));
        // Nahrazený obrázek v úložišti nenecháváme ležet.
        void smazObrazekProduktu(supabase, stary);
      })
      .catch((err) => {
        reportError({
          code: "inventory.image_upload_failed",
          error: err,
          userMessage: "Obrázek se nepodařilo nahrát: " + (err?.message ?? String(err)),
          source: "Inventory.handleImageUpload",
        });
      })
      .finally(() => setNahravamObrazek(false));
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
  /* Stejný štítek jako u zařízení – text, ne ikona: „jde tahle položka na
     web?“ nevystihne žádný piktogram. Skrytá kategorie schová i produkty
     pod sebou, stejně jako v API. Uloží se autosave efektem výš. */
  const prepnoutViditelnost = (druh: "productCategories" | "products", id: string) => {
    setData((d) => ({
      ...d,
      [druh]: (d[druh] as Array<{ id: string; publicVisible?: boolean }>).map((x) =>
        x.id === id ? { ...x, publicVisible: x.publicVisible === false } : x,
      ),
    }) as InventoryData);
  };

  /* Odklikat stovku produktů po jedné nikdo nebude. Působí jen na to, co je
     zrovna vidět podle filtrů. */
  const hromadnaViditelnost = (zverejnit: boolean) => {
    const dotcene = new Set(filteredProducts.map((p) => p.id));
    setData((d) => ({
      ...d,
      products: d.products.map((p) =>
        dotcene.has(p.id) ? { ...p, publicVisible: zverejnit } : p,
      ),
    }));
    showToast(
      `${zverejnit ? "Posílá se do API" : "Vyřazeno z API"}: ${dotcene.size} ${dotcene.size === 1 ? "produkt" : dotcene.size < 5 ? "produkty" : "produktů"}`,
      "success",
    );
  };

  const stitekViditelnosti = (
    druh: "productCategories" | "products",
    polozka: { id: string; publicVisible?: boolean },
  ) => {
    if (!ukazatViditelnost) return null;
    const skryto = polozka.publicVisible === false;
    return (
      <button
        onClick={(e) => {
          e.stopPropagation();
          prepnoutViditelnost(druh, polozka.id);
        }}
        title={
          skryto
            ? "Neposílá se do veřejného API skladu, včetně všeho pod tím. Kliknutím zařadíš."
            : "Posílá se do veřejného API skladu. Kliknutím vyřadíš i všechno pod tím."
        }
        style={{
          flexShrink: 0,
          border: `1px solid ${skryto ? "var(--warn, #e5a94a)" : "var(--border)"}`,
          background: "none",
          borderRadius: 999,
          padding: "1px 7px",
          fontSize: 10,
          fontWeight: 700,
          lineHeight: 1.6,
          cursor: "pointer",
          color: skryto ? "var(--warn, #e5a94a)" : "var(--muted)",
        }}
      >
        {skryto ? "mimo API" : "v API"}
      </button>
    );
  };

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

        const skladProImport = newProductWarehouseId || vychoziSklad(data.warehouses);
        const stavyImportu = product.stock > 0 && skladProImport ? { [skladProImport]: product.stock } : {};
        const newProduct: Product = {
          id: uuid(),
          name: product.name,
          sku: product.sku,
          price: product.price,
          stock: celkemKusu(stavyImportu),
          stockByWarehouse: stavyImportu,
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
          <Button variant="soft" onClick={() => setShowImport(false)}>
            Zpět na Sklad
          </Button>
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
            <Button variant="primary" onClick={downloadTemplate} style={{ marginTop: 8 }}>
              Stáhnout vzorový soubor
            </Button>
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
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 100px), 1fr))", gap: 12, marginBottom: 20 }}>
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
                      <BoxIcon size={14} /> {product.name}
                      {isDuplicate && <span style={{ marginLeft: 8, fontSize: 11, color: "rgba(239, 68, 68, 0.9)" }}><WarningIcon size={12} /> Duplicitní</span>}
                      {needsReview && <span style={{ marginLeft: 8, fontSize: 11, color: "rgba(255, 193, 7, 0.9)" }}><WarningIcon size={12} /> Vyžaduje kontrolu</span>}
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
                        <WarningIcon size={13} /> Nenalezen žádný odpovídající model - produkt bude importován bez přiřazení k modelu
                      </div>
                    )}
                  </div>
                );
              })}
            </div>

            {importPreview.needsReview.length > 0 && (
              <div style={{ marginBottom: 16, padding: 12, background: "rgba(255, 193, 7, 0.1)", borderRadius: 8, border: "1px solid rgba(255, 193, 7, 0.3)" }}>
                <div style={{ fontWeight: 700, color: "rgba(255, 193, 7, 0.9)", marginBottom: 8 }}>
                  <WarningIcon size={13} /> Produkty vyžadující kontrolu ({importPreview.needsReview.length}):
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
                  <WarningIcon size={13} /> Nalezené duplicity ({importPreview.duplicates.length}):
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

            <Button variant="primary"
              onClick={executeImport} style={{ marginTop: 16, width: "100%" }}
            >
              Provedit import ({importPreview.products.length} produktů)
            </Button>
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
        </div>
        {/* Odsazení uhýbá plovoucímu "+" v pravém dolním rohu. Na telefonu
            je "+" nad spodní lištou, ne vedle nadpisu, takže by 120 px jen
            odstrčilo tlačítko doprostřed. */}
        <Button variant="primary" data-tour="inventory-import" onClick={() => setShowImport(true)} style={isNarrow ? undefined : { marginRight: 120 }}>
          Import
        </Button>
      </div>

      {/* NASKLADNĚNÍ */}
        <div style={card}>
        <div style={{ fontWeight: 950, fontSize: 14, marginBottom: 12, color: "var(--text)" }}>Naskladnění</div>
        <div style={{ fontSize: 13, color: "var(--muted)", marginBottom: 16 }}>
          Rychlé naskladnění produktů - vyberte produkt a zadejte množství
        </div>

        <div style={{ display: "grid", gap: 12 }}>
          <div>
            {data.warehouses.length > 1 && (
              <div style={{ marginBottom: 12 }}>
                <div style={{ fontSize: 12, color: "var(--muted)", marginBottom: 6 }}>Do kterého skladu</div>
                <select
                  value={restockWarehouseId}
                  onChange={(e) => setRestockWarehouseId(e.target.value)}
                  style={inputStyle}
                >
                  <option value="">
                    Výchozí ({data.warehouses.find((w) => w.isDefault)?.name ?? data.warehouses[0]?.name})
                  </option>
                  {data.warehouses.map((w) => (
                    <option key={w.id} value={w.id}>{w.name}</option>
                  ))}
                </select>
              </div>
            )}
            <div style={{ fontSize: 12, color: "var(--muted)", marginBottom: 6 }}>Vyhledat produkt</div>
            <Input
              type="text"
              placeholder="Začněte psát název nebo SKU produktu..."
              value={productSearchQuery}
              onChange={(e) => setProductSearchQuery(e.target.value)} />
          </div>

          {(() => {
            const searchLower = productSearchQuery.trim().toLowerCase();
            const matchingProducts = searchLower
              ? data.products.filter(
                  (p) =>
                    p.name.toLowerCase().includes(searchLower) ||
                    (p.sku || "").toLowerCase().includes(searchLower)
                )
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
                  Začněte psát název nebo SKU produktu pro vyhledání
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
                          {product.sku && (
                            <div style={{ fontSize: 11, color: "var(--muted)", marginTop: 2 }}>SKU: {product.sku}</div>
                          )}
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
                                  if (change !== 0) naskladnit(product.id, change);
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
                                if (change !== 0) naskladnit(product.id, change);
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
                                if (change !== 0) naskladnit(product.id, change);
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
        {/* Na telefonu vedle sebe ne – na panel zbylo 167 px a seznamy
            značek i kategorií se v něm zalomily na jedno písmeno na řádek. */}
        <div style={{ display: "grid", gridTemplateColumns: isNarrow ? "1fr" : "repeat(2, 1fr)", gap: 16 }}>
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
        <div style={{ display: "grid", gridTemplateColumns: isNarrow ? "1fr" : "1fr 1fr 2fr", gap: 16 }}>
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

          {/* SKLADY */}
          <div style={{ ...card, maxHeight: "400px", overflowY: "auto" }}>
            <div style={{ fontWeight: 950, fontSize: 14, marginBottom: 4 }}>Sklady</div>
            <div style={{ fontSize: 12, color: "var(--muted)", marginBottom: 12 }}>
              Stejný díl může ležet ve víc skladech. Součet je pak zásoba produktu.
            </div>

            <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
              <input
                placeholder="Nový sklad…"
                value={newWarehouseName}
                onChange={(e) => setNewWarehouseName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && newWarehouseName.trim()) {
                    addWarehouse(newWarehouseName);
                    setNewWarehouseName("");
                  }
                }}
                style={inputStyle}
              />
              <Button
                variant="primary"
                disabled={!newWarehouseName.trim()}
                onClick={() => { addWarehouse(newWarehouseName); setNewWarehouseName(""); }}
                style={{
                  opacity: !newWarehouseName.trim() ? 0.6 : 1,
                  cursor: !newWarehouseName.trim() ? "not-allowed" : "pointer",
                }}
                title={!newWarehouseName.trim() ? "Zadejte název skladu" : "Přidat sklad"}
              >
                +
              </Button>
            </div>

            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              {data.warehouses.map((w) => {
                const kusy = data.products.reduce((a, pr) => a + (pr.stockByWarehouse[w.id] ?? 0), 0);
                const upravovan = editingWarehouse === w.id;
                return (
                  <div
                    key={w.id}
                    style={{
                      padding: 8,
                      borderRadius: 8,
                      border: "1px solid var(--border)",
                      background: "var(--panel-2)",
                      display: "flex",
                      alignItems: "center",
                      gap: 8,
                    }}
                  >
                    {upravovan ? (
                      <>
                        <input
                          value={editWarehouseName}
                          onChange={(e) => setEditWarehouseName(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter" && editWarehouseName.trim()) {
                              updateWarehouse(w.id, { name: editWarehouseName.trim() });
                              setEditingWarehouse(null);
                            }
                            if (e.key === "Escape") setEditingWarehouse(null);
                          }}
                          autoFocus
                          style={{ ...inputStyle, fontSize: 13, padding: "6px 8px" }}
                        />
                        <Button
                          variant="primary"
                          size="sm"
                          onClick={() => {
                            if (editWarehouseName.trim()) updateWarehouse(w.id, { name: editWarehouseName.trim() });
                            setEditingWarehouse(null);
                          }}
                        >
                          Uložit
                        </Button>
                      </>
                    ) : (
                      <>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontSize: 13, fontWeight: 700, color: "var(--text)", display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                            <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{w.name}</span>
                            {w.isDefault && (
                              <span style={{ padding: "1px 5px", borderRadius: 4, background: "var(--accent-soft)", fontSize: "var(--text-xs)", fontWeight: 700, color: "var(--muted)" }}>
                                výchozí
                              </span>
                            )}
                          </div>
                          <div style={{ fontSize: 11, color: "var(--muted)", marginTop: 2 }}>
                            {kusy} ks{ukazatViditelnost ? (w.publicVisible ? " · ve veřejné dostupnosti" : " · mimo veřejnou dostupnost") : ""}
                          </div>
                        </div>
                        {!w.isDefault && (
                          <Button
                            variant="ghost"
                            size="sm"
                            title="Sem půjde automatický odpis a zápis přes API"
                            onClick={() => updateWarehouse(w.id, { isDefault: true })}
                            style={{ fontSize: 11 }}
                          >
                            Výchozí
                          </Button>
                        )}
                        {ukazatViditelnost && (
                          <Button
                            variant={w.publicVisible ? "ghost" : "soft"}
                            size="sm"
                            title="Počítat kusy z tohohle skladu do veřejné dostupnosti?"
                            onClick={() => updateWarehouse(w.id, { publicVisible: !w.publicVisible })}
                            style={{ fontSize: 11, color: w.publicVisible ? "var(--muted)" : "var(--warning-text)" }}
                          >
                            {w.publicVisible ? "Veřejný" : "Neveřejný"}
                          </Button>
                        )}
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => { setEditingWarehouse(w.id); setEditWarehouseName(w.name); }}
                          style={{ fontSize: 11 }}
                        >
                          ✎
                        </Button>
                        <Button
                          variant="danger"
                          size="sm"
                          disabled={data.warehouses.length <= 1}
                          title={data.warehouses.length <= 1 ? "Poslední sklad nejde smazat" : "Smazat sklad"}
                          onClick={() => deleteWarehouse(w.id)}
                          style={{ fontSize: 11, opacity: data.warehouses.length <= 1 ? 0.4 : 1 }}
                        >
                          ×
                        </Button>
                      </>
                    )}
                  </div>
                );
              })}
            </div>
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
                onKeyDown={(e) => e.key === "Enter" && newProductCategoryName.trim() && addProductCategory()}
                  style={inputStyle}
                />
              <Button variant="primary"
                  onClick={() => newProductCategoryName.trim() && addProductCategory()} style={{ opacity: !newProductCategoryName.trim() ? 0.6 : 1,
                    cursor: !newProductCategoryName.trim() ? "not-allowed" : "pointer" }}
                  disabled={!newProductCategoryName.trim()}
                  title={!newProductCategoryName.trim() ? "Zadejte název kategorie" : "Přidat kategorii"}
                >
                  +
                </Button>
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
                      <Button variant="primary" size="sm" onClick={() => updateProductCategory(c.id, editProductCategoryName)}>
                          ✓
                        </Button>
                      <Button variant="soft" size="sm" onClick={() => setEditingProductCategory(null)}>
                          ✕
                        </Button>
                      </div>
                    ) : (
                    <div>
                      <div
                        onClick={() => setSelectedProductCategoryId(selectedProductCategoryId === c.id ? null : c.id)}
                        style={{ cursor: "pointer", display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}
                      >
                        <span style={{ display: "flex", alignItems: "center", gap: 6, minWidth: 0 }}>
                          <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{c.name}</span>
                          {stitekViditelnosti("productCategories", c)}
                        </span>
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
                ? `Přidat produkt${selectedModel.name ? ` · ${selectedModel.name}` : ""}`
                : "Přidat produkt"}
          </div>
              <div style={{ display: "grid", gap: 8, marginBottom: 12 }}>
                <label style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer", marginBottom: 4 }}>
                  <input
                    type="checkbox"
                    checked={newProductUnassigned}
                    onChange={(e) => setNewProductUnassigned(e.target.checked)}
                  />
                  <span style={{ fontSize: 13, color: "var(--text)" }}>Nepřiřazovat k zařízení</span>
                </label>
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
                  {/* Nepovinná. Do veřejného API se neposílá, dokud si to
                      servis nezapne – prozrazuje marži. */}
                  <input
                    placeholder="Nákupní cena (Kč)"
                    title="Za kolik díl nakupujete. Nepovinné. Do veřejného API se neposílá, dokud si to nezapnete."
                    type="number"
                    value={newProduct.purchasePrice}
                    onChange={(e) => setNewProduct((p) => ({ ...p, purchasePrice: e.target.value }))}
                    /* Třetí pole v dvousloupci zůstávalo samo na druhém řádku
                       a v půlce šířky se do něj nevešel ani popisek. */
                    style={{ ...inputStyle, gridColumn: "1 / -1" }}
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
                        .filter((cat) => newProductUnassigned || !selectedModelId || (cat.modelIds || []).includes(selectedModelId))
                        .map((cat) => (
                          <option key={cat.id} value={cat.id}>
                            {cat.name}
                          </option>
                        ))}
                    </select>
                  </div>
                  {data.warehouses.length > 1 && (
                    <div>
                      <label style={{ fontSize: 12, color: "var(--muted)", marginBottom: 4, display: "block" }}>
                        Do kterého skladu
                      </label>
                      <select
                        value={newProductWarehouseId}
                        onChange={(e) => setNewProductWarehouseId(e.target.value)}
                        style={inputStyle}
                      >
                        <option value="">
                          Výchozí ({data.warehouses.find((w) => w.isDefault)?.name ?? data.warehouses[0]?.name})
                        </option>
                        {data.warehouses.map((w) => (
                          <option key={w.id} value={w.id}>{w.name}</option>
                        ))}
                      </select>
                    </div>
                  )}
                  <div>
                    <label style={{ fontSize: 12, color: "var(--muted)", marginBottom: 4, display: "block" }}>
                      Obrázek produktu (volitelné){nahravamObrazek ? " – nahrávám…" : ""}
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
                        <Button variant="danger" size="sm"
                          onClick={() => { void smazObrazekProduktu(supabase, newProduct.imageUrl); setNewProduct((p) => ({ ...p, imageUrl: "" })); }} style={{ marginTop: 8,  fontSize: 12 }}
                        >
                          Odstranit obrázek
                        </Button>
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
                <Button variant="primary"
                  onClick={() => newProduct.name.trim() && addProduct()} style={{ opacity: !newProduct.name.trim() ? 0.6 : 1,
                    cursor: !newProduct.name.trim() ? "not-allowed" : "pointer" }}
                  disabled={!newProduct.name.trim()}
                  title={!newProduct.name.trim() ? "Zadejte název produktu" : "Přidat produkt"}
                >
                  Přidat produkt
                </Button>
              </div>
          </div>
        </div>

        {/* Product List - Full Width */}
        <div style={{ ...card, marginTop: 32 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 16, flexWrap: "wrap" }}>
            <div style={{ fontWeight: 950, fontSize: 16, color: "var(--text)" }}>
              Seznam produktů
            </div>
            {ukazatViditelnost && filteredProducts.length > 0 && (
              <div style={{ display: "flex", gap: 6, marginLeft: "auto", alignItems: "center" }}>
                <span style={{ fontSize: 11, color: "var(--muted)" }}>
                  Posílat do veřejného API ({filteredProducts.length} zobrazených):
                </span>
                <Button variant="ghost" size="sm" onClick={() => hromadnaViditelnost(true)}>
                  Zveřejnit vše
                </Button>
                <Button variant="ghost" size="sm" onClick={() => hromadnaViditelnost(false)}>
                  Skrýt vše
                </Button>
              </div>
            )}
          </div>

          {/* Filters */}
          <div style={{ display: "flex", gap: 12, marginBottom: 16, alignItems: "center", flexWrap: "wrap" }}>
            <input
              placeholder="Hledat produkt (název, SKU, popis)…"
              value={productSearchQuery}
              onChange={(e) => setProductSearchQuery(e.target.value)}
              style={{ ...inputStyle, flex: "1 1 300px" }}
            />
            {data.warehouses.length > 1 && (
              <select
                value={warehouseFilter}
                onChange={(e) => setWarehouseFilter(e.target.value)}
                title="Který sklad ukazovat v seznamu"
                style={{ ...inputStyle, flex: "0 0 auto", width: "auto" }}
              >
                <option value="all">Všechny sklady</option>
                {data.warehouses.map((w) => (
                  <option key={w.id} value={w.id}>{w.name}</option>
                ))}
              </select>
            )}
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
            gridTemplateColumns: productDisplayMode === "grid" ? "repeat(auto-fill, minmax(min(100%, 300px), 1fr))" : undefined,
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
                    display: "flex",
                    flexDirection: "column",
                    gap: productDisplayMode === "compact" ? 8 : 12,
                    flex: productDisplayMode === "grid" ? "1 1 auto" : productDisplayMode === "list" ? "0 0 auto" : "1 1 250px",
                    minWidth: productDisplayMode === "list" ? "100%" : 0,
                    height: productDisplayMode === "grid" ? "100%" : productDisplayMode === "compact" ? "auto" : "auto",
                    minHeight: productDisplayMode === "grid" ? 320 : productDisplayMode === "compact" ? 220 : "auto",
                    position: "relative",
                    alignItems: "stretch",
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
                          Obrázek produktu (volitelné){nahravamObrazek ? " – nahrávám…" : ""}
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
                            <Button variant="danger" size="sm"
                              onClick={() => { void smazObrazekProduktu(supabase, editProductData.imageUrl); setEditProductData((d) => ({ ...d, imageUrl: "" })); }} style={{ marginTop: 8,  fontSize: 12 }}
                            >
                              Odstranit obrázek
                            </Button>
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
                          <Button variant="primary" onClick={() => updateProduct(p.id, editProductData)} style={{ flex: 1 }}>
                            Uložit
                          </Button>
                          <Button variant="soft" onClick={() => setEditingProduct(null)}>
                            Zrušit
                          </Button>
                        </div>
                      </div>
                    ) : productDisplayMode === "list" ? (
                      <>
                      {/* Řádek jako u oprav: vlevo popis, vpravo cena, sklad a akce. */}
                      <div style={{ display: "flex", alignItems: "flex-start", gap: 16 }}>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontWeight: 800, fontSize: 14, color: "var(--text)", marginBottom: 2, display: "flex", alignItems: "center", gap: 8 }}>
                            <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{p.name}</span>
                            {stitekViditelnosti("products", p)}
                            {hasNoModels && (
                              <span style={{
                                padding: "2px 6px",
                                background: "var(--accent-soft)",
                                borderRadius: 4,
                                fontSize: "var(--text-xs)",
                                fontWeight: 700,
                                color: "var(--muted)",
                                whiteSpace: "nowrap",
                              }}>
                                Nezávislý produkt
                              </span>
                            )}
                          </div>
                          {productModels.length > 0 && (
                            /* Zkrácený výčet, celý je v titulku – stejně jako u oprav. */
                            <div
                              style={{ fontSize: 11, color: "var(--muted)" }}
                              title={productModels.map((m) => m.name).join(", ")}
                            >
                              {productModels.slice(0, 3).map((m) => m.name).join(", ")}
                              {productModels.length > 3 && ` a ${productModels.length - 3} dalších`}
                            </div>
                          )}
                          <div style={{ fontSize: 11, color: "var(--muted)", marginTop: 2 }}>
                            {[productCategory?.name, p.sku ? `SKU: ${p.sku}` : null].filter(Boolean).join(" · ") || "—"}
                          </div>
                          {p.description && (
                            <div style={{
                              fontSize: 12,
                              color: "var(--muted)",
                              lineHeight: 1.4,
                              marginTop: 4,
                              display: "-webkit-box",
                              WebkitLineClamp: 2,
                              WebkitBoxOrient: "vertical",
                              overflow: "hidden",
                            }}>
                              {p.description}
                            </div>
                          )}
                        </div>

                        <div style={{ display: "flex", alignItems: "center", gap: 12, flexShrink: 0 }}>
                          <div style={{ textAlign: "right" }}>
                            <div style={{ fontSize: 14, fontWeight: 800, color: "var(--text)", whiteSpace: "nowrap" }}>
                              {p.price} Kč
                            </div>
                            {p.purchasePrice != null && (
                              <div style={{ fontSize: 11, color: "var(--muted)", whiteSpace: "nowrap" }}>
                                nákup {p.purchasePrice} Kč
                              </div>
                            )}
                          </div>
                          <StockCell
                            product={p}
                            warehouses={data.warehouses}
                            filterId={warehouseFilter}
                            onAdjust={(wid, delta) => adjustStock(p.id, wid, delta)}
                          />
                          <div style={{ display: "flex", gap: 6 }}>
                            <Button variant="soft" size="sm"
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
                              }} style={{ fontSize: 11 }}
                            >
                              Upravit
                            </Button>
                            <Button variant="danger" size="sm"
                              onClick={() => deleteProduct(p.id)} style={{ fontSize: 11 }}
                            >
                              Smazat
                            </Button>
                          </div>
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
                              {stitekViditelnosti("products", p)}
                          {hasNoModels && (
                            <span style={{
                              padding: "2px 6px",
                              background: "var(--accent-soft)",
                              borderRadius: 4,
                              fontSize: "var(--text-xs)",
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

                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", gap: 8, flexWrap: "wrap", paddingTop: 8, borderTop: border, marginTop: "auto" }}>
                        <div style={{ minWidth: 0 }}>
                          <div style={{ fontSize: productDisplayMode === "compact" ? 13 : 14, fontWeight: 800, color: "var(--text)", whiteSpace: "nowrap" }}>
                            {p.price} Kč
                          </div>
                          {p.purchasePrice != null && (
                            <div style={{ fontSize: 11, color: "var(--muted)", whiteSpace: "nowrap" }}>
                              nákup {p.purchasePrice} Kč
                            </div>
                          )}
                          <div style={{ marginTop: 6 }}>
                            <StockCell
                              product={p}
                              warehouses={data.warehouses}
                              filterId={warehouseFilter}
                              dense={productDisplayMode === "compact"}
                              onAdjust={(wid, delta) => adjustStock(p.id, wid, delta)}
                            />
                          </div>
                        </div>
                        <div style={{ display: "flex", gap: 6 }}>
                          <Button variant="soft"
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
                            }} style={{ padding: productDisplayMode === "compact" ? "6px 10px" : "8px 12px", fontSize: productDisplayMode === "compact" ? 11 : 12 }}
                          >
                            Upravit
                          </Button>
                          <Button variant="danger"
                            onClick={() => deleteProduct(p.id)} style={{ padding: productDisplayMode === "compact" ? "6px 10px" : "8px 12px", fontSize: productDisplayMode === "compact" ? 11 : 12 }}
                          >
                            Smazat
                          </Button>
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

      {/* Smazání skladu, ve kterém ještě něco leží – kusy by se ztratily. */}
      <ConfirmDialog
        open={deleteWarehouseInfo !== null}
        title="Smazat sklad?"
        message={
          deleteWarehouseInfo
            ? `Ve skladu „${data.warehouses.find((w) => w.id === deleteWarehouseInfo.id)?.name ?? ""}“ je ${deleteWarehouseInfo.kusy} ks. Smazáním se tyhle kusy ze zásoby odečtou. Jinam se nepřesunou.`
            : ""
        }
        confirmLabel="Smazat sklad"
        cancelLabel="Zrušit"
        variant="danger"
        onConfirm={() => {
          deleteWarehouseInfo?.onConfirm();
          setDeleteWarehouseInfo(null);
        }}
        onCancel={() => setDeleteWarehouseInfo(null)}
      />

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