import { useCallback, useRef, useState } from "react";
import { Button, Label } from "../../components/ui";
import { CheckIcon, XIcon } from "../../components/icons";
import type { Warehouse } from "../../lib/inventoryDb";
import { InventoryDialog } from "./InventoryDialog";

type RestockProduct = {
  id: string;
  name: string;
  sku?: string;
  stock: number;
  modelIds: string[];
};

type Devices = {
  brands: { id: string; name: string }[];
  categories: { id: string; name: string; brandId: string }[];
  models: { id: string; name: string; categoryId: string }[];
};

/**
 * Rychlé naskladnění: vyhledat produkt, zadat o kolik kusů, potvrdit.
 *
 * Dřív karta nad celým skladem; teď dialog otevíraný z hlavičky, aby seznam
 * produktů byl první věc na stránce. Hledání má vlastní stav – dřív sdílelo
 * pole se seznamem, takže psaní sem přefiltrovalo i produkty dole.
 * Samotný zápis (`onRestock`) zůstává v kontejneru včetně výběru skladu.
 */
export function RestockDialog({
  open,
  onClose,
  products,
  warehouses,
  devices,
  warehouseId,
  onWarehouseChange,
  canAdjust,
  onRestock,
}: {
  open: boolean;
  onClose: () => void;
  products: RestockProduct[];
  warehouses: Warehouse[];
  devices: Devices;
  /** Cílový sklad; prázdný řetězec = výchozí sklad. */
  warehouseId: string;
  onWarehouseChange: (id: string) => void;
  canAdjust: boolean;
  onRestock: (productId: string, change: number) => void;
}) {
  const [query, setQuery] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [changes, setChanges] = useState<Record<string, string>>({});
  const searchRef = useRef<HTMLInputElement>(null);

  /* Rozdělaná úprava nemá přežít zavření – ať se po dalším otevření
     nezačíná uprostřed. Reset je tady, ne v efektu na `open`, aby
     nevyvolával render navíc. */
  const zavrit = useCallback(() => {
    setQuery("");
    setEditingId(null);
    setChanges({});
    onClose();
  }, [onClose]);

  /* Když právo upravovat zásobu zmizí za běhu, rozdělaná úprava se schová. */
  const upravovanyId = canAdjust ? editingId : null;

  const zrusitUpravu = useCallback((id: string) => {
    setEditingId(null);
    setChanges((prev) => {
      const next = { ...prev };
      delete next[id];
      return next;
    });
  }, []);

  const potvrdit = (id: string) => {
    const change = parseInt(changes[id] || "", 10) || 0;
    if (change !== 0) onRestock(id, change);
    zrusitUpravu(id);
  };

  const posun = (id: string, delta: number) =>
    setChanges((prev) => ({ ...prev, [id]: String((parseInt(prev[id] || "", 10) || 0) + delta) }));

  const hledane = query.trim().toLowerCase();
  const nalezene = hledane
    ? products.filter((p) => p.name.toLowerCase().includes(hledane) || (p.sku || "").toLowerCase().includes(hledane))
    : [];

  const vychozi = warehouses.find((w) => w.isDefault)?.name ?? warehouses[0]?.name;

  const nazvyModelu = (p: RestockProduct) =>
    p.modelIds
      .map((mid) => {
        const model = devices.models.find((m) => m.id === mid);
        if (!model) return null;
        const category = devices.categories.find((c) => c.id === model.categoryId);
        const brand = category ? devices.brands.find((b) => b.id === category.brandId) : null;
        return brand ? `${brand.name} ${model.name}` : model.name;
      })
      .filter(Boolean) as string[];

  return (
    <InventoryDialog
      open={open}
      onClose={zavrit}
      title="Naskladnění"
      subtitle="Vyberte produkt a zadejte, o kolik kusů se má zásoba změnit."
      initialFocusRef={searchRef}
    >
      <div style={{ display: "grid", gap: "var(--space-3)" }}>
        {warehouses.length > 1 && (
          <div>
            <Label>Do kterého skladu</Label>
            <select
              className="ui-input"
              value={warehouseId}
              onChange={(e) => onWarehouseChange(e.target.value)}
              style={{ marginTop: "var(--space-1)" }}
            >
              <option value="">Výchozí ({vychozi})</option>
              {warehouses.map((w) => (
                <option key={w.id} value={w.id}>{w.name}</option>
              ))}
            </select>
          </div>
        )}
        <div>
          <Label>Vyhledat produkt</Label>
          {/* Holý <input> s třídou ui-input: Input z ui nepředává ref a fokus
              po otevření je tu podstatný. */}
          <input
            ref={searchRef}
            className="ui-input"
            type="text"
            placeholder="Začněte psát název nebo SKU produktu…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            style={{ marginTop: "var(--space-1)" }}
          />
        </div>

        {nalezene.length === 0 ? (
          <div style={{ padding: "var(--space-5)", textAlign: "center", color: "var(--muted)", fontSize: "var(--text-base)" }}>
            {hledane ? "Žádný produkt neodpovídá hledání." : "Začněte psát název nebo SKU produktu."}
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-2)", maxHeight: 360, overflowY: "auto" }}>
            {nalezene.map((product) => {
              const upravuje = upravovanyId === product.id;
              const hodnota = changes[product.id] || "";
              const modely = nazvyModelu(product);
              return (
                <div
                  key={product.id}
                  style={{
                    padding: "var(--space-3)",
                    borderRadius: "var(--radius-sm)",
                    border: "1px solid var(--border)",
                    background: "var(--panel-2)",
                    display: "flex",
                    alignItems: "center",
                    gap: "var(--space-3)",
                    flexWrap: "wrap",
                  }}
                >
                  <div style={{ flex: 1, minWidth: 160 }}>
                    <div style={{ fontWeight: 700, fontSize: "var(--text-base)", color: "var(--text)" }}>{product.name}</div>
                    {product.sku && (
                      <div style={{ fontSize: "var(--text-xs)", color: "var(--muted)", marginTop: 2 }}>SKU: {product.sku}</div>
                    )}
                    <div style={{ fontSize: "var(--text-xs)", color: "var(--muted)", marginTop: 2 }}>
                      Aktuální zásoba:{" "}
                      <span style={{ fontWeight: 700, color: product.stock > 0 ? "var(--text)" : "var(--danger-text)" }}>
                        {product.stock} ks
                      </span>
                    </div>
                    {modely.length > 0 && (
                      <div style={{ fontSize: "var(--text-xs)", color: "var(--muted)", marginTop: 4 }}>
                        Modely: <span style={{ color: "var(--text)" }}>{modely.join(", ")}</span>
                      </div>
                    )}
                  </div>
                  {upravuje ? (
                    <div style={{ display: "flex", alignItems: "center", gap: "var(--space-1)" }}>
                      <Button
                        size="sm"
                        iconOnly
                        aria-label="O kus méně"
                        icon={<span aria-hidden="true">−</span>}
                        onMouseDown={(e) => e.preventDefault()}
                        onClick={() => posun(product.id, -1)}
                      />
                      <input
                        type="number"
                        className="ui-input"
                        aria-label="Změna počtu kusů"
                        value={hodnota}
                        onChange={(e) => setChanges((prev) => ({ ...prev, [product.id]: e.target.value }))}
                        placeholder="0"
                        autoFocus
                        style={{ width: 80, textAlign: "center", fontWeight: 600, padding: "6px var(--space-2)" }}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") potvrdit(product.id);
                          if (e.key === "Escape") {
                            /* Jen zrušit úpravu – Escape nemá zavřít celý dialog. */
                            e.preventDefault();
                            e.stopPropagation();
                            zrusitUpravu(product.id);
                          }
                        }}
                        onBlur={() => potvrdit(product.id)}
                      />
                      <Button
                        size="sm"
                        iconOnly
                        aria-label="O kus více"
                        icon={<span aria-hidden="true">+</span>}
                        onMouseDown={(e) => e.preventDefault()}
                        onClick={() => posun(product.id, 1)}
                      />
                      <Button
                        variant="primary"
                        size="sm"
                        iconOnly
                        aria-label="Potvrdit změnu"
                        icon={<CheckIcon size={14} />}
                        onMouseDown={(e) => e.preventDefault()}
                        onClick={() => potvrdit(product.id)}
                      />
                      <Button
                        size="sm"
                        iconOnly
                        aria-label="Zrušit"
                        icon={<XIcon size={14} />}
                        onMouseDown={(e) => e.preventDefault()}
                        onClick={() => zrusitUpravu(product.id)}
                      />
                    </div>
                  ) : canAdjust ? (
                    <Button variant="soft" size="sm" onClick={() => setEditingId(product.id)}>
                      Upravit zásobu
                    </Button>
                  ) : null}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </InventoryDialog>
  );
}
