import { useState, useEffect } from "react";
import { formatCurrency } from "../../lib/invoiceMath";
import { showToast } from "../Toast";
import { STORAGE_KEYS } from "../../constants/storageKeys";
import { type DevicesData, type InventoryData, safeLoadDevicesData } from "../../lib/catalogStorage";
import { type PerformedRepair } from "./types";

export function PerformedRepairItem({
  repair,
  onRemove,
  onUpdatePrice,
  onUpdateCosts,
  onUpdateTime,
  onUpdateProducts,
  devicesData,
  inventoryData,
}: {
  repair: PerformedRepair;
  onRemove: (repairId: string) => void;
  onUpdatePrice: (repairId: string, price: number) => void;
  onUpdateCosts: (repairId: string, costs: number) => void;
  onUpdateTime: (repairId: string, estimatedTime: number) => void;
  onUpdateProducts: (repairId: string, productIds: string[]) => void;
  devicesData?: DevicesData;
  inventoryData?: InventoryData;
}) {
  const [isEditing, setIsEditing] = useState(false);
  const [priceValue, setPriceValue] = useState(String(repair.price || 0));
  const [costsValue, setCostsValue] = useState(String(repair.costs || 0));
  const [timeValue, setTimeValue] = useState(String(repair.estimatedTime || 0));
  const [productSearch, setProductSearch] = useState("");
  const [selectedProductIds, setSelectedProductIds] = useState<string[]>(repair.productIds || []);

  useEffect(() => {
    if (!isEditing) {
      setPriceValue(String(repair.price || 0));
      setCostsValue(String(repair.costs || 0));
      setTimeValue(String(repair.estimatedTime || 0));
      setSelectedProductIds(repair.productIds || []);
    }
  }, [repair.price, repair.costs, repair.estimatedTime, repair.productIds, isEditing]);

  // Find repair in catalog by ID or by name
  const catalogRepair = repair.repairId 
    ? devicesData?.repairs.find((r) => r.id === repair.repairId)
    : devicesData?.repairs.find((r) => r.name === repair.name);

  // Get available products for autocomplete
  const availableProducts = inventoryData?.products || [];

  const border = "1px solid var(--border)";

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 8,
        padding: 10,
        borderRadius: 10,
        background: "var(--panel-2)",
        border,
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <div style={{ flex: 1 }}>
          <div style={{ fontWeight: 700, fontSize: 13, color: "var(--text)" }}>{repair.name}</div>
          {repair.type === "selected" && (
            <div style={{ fontSize: 11, color: "var(--muted)", marginTop: 2 }}>Z katalogu</div>
          )}
        </div>
        <div style={{ display: "flex", gap: 6 }}>
          {!isEditing && (
            <button
              onClick={() => setIsEditing(true)}
              style={{
                padding: "6px 10px",
                borderRadius: 8,
                border,
                background: "var(--panel)",
                color: "var(--text)",
                fontWeight: 700,
                cursor: "pointer",
                fontSize: 12,
              }}
            >
              Upravit
            </button>
          )}
          <button
            onClick={() => onRemove(repair.id)}
            style={{
              padding: "6px 10px",
              borderRadius: 8,
              border,
              background: "var(--panel)",
              color: "var(--text)",
              fontWeight: 700,
              cursor: "pointer",
              fontSize: 12,
            }}
          >
            Odstranit
          </button>
        </div>
      </div>
      {isEditing ? (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {/* Price */}
          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            <label style={{ fontSize: 12, color: "var(--muted)" }}>Cena (Kč):</label>
            <input
              type="number"
              value={priceValue}
              onChange={(e) => setPriceValue(e.target.value)}
              style={{
                padding: "8px 10px",
                borderRadius: 6,
                border,
                background: "var(--panel)",
                color: "var(--text)",
                fontSize: 13,
              }}
            />
          </div>

          {/* Costs */}
          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            <label style={{ fontSize: 12, color: "var(--muted)" }}>Náklady (Kč):</label>
            <input
              type="number"
              value={costsValue}
              onChange={(e) => setCostsValue(e.target.value)}
              style={{
                padding: "8px 10px",
                borderRadius: 6,
                border,
                background: "var(--panel)",
                color: "var(--text)",
                fontSize: 13,
              }}
            />
          </div>

          {/* Time */}
          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            <label style={{ fontSize: 12, color: "var(--muted)" }}>Čas (min):</label>
            <input
              type="number"
              value={timeValue}
              onChange={(e) => setTimeValue(e.target.value)}
              style={{
                padding: "8px 10px",
                borderRadius: 6,
                border,
                background: "var(--panel)",
                color: "var(--text)",
                fontSize: 13,
              }}
            />
          </div>

          {/* Products */}
          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            <label style={{ fontSize: 12, color: "var(--muted)" }}>Produkty:</label>
            <div style={{ position: "relative" }}>
              <input
                placeholder="Hledat produkt…"
                value={productSearch}
                onChange={(e) => setProductSearch(e.target.value)}
                style={{
                  padding: "8px 10px",
                  borderRadius: 6,
                  border,
                  background: "var(--panel)",
                  color: "var(--text)",
                  fontSize: 13,
                  width: "100%",
                }}
              />
              {productSearch && (
                <div style={{ position: "absolute", top: "100%", left: 0, right: 0, zIndex: 1000, background: "var(--panel)", border, borderRadius: 8, marginTop: 4, maxHeight: 200, overflowY: "auto" }}>
                  {availableProducts
                    .filter((p) =>
                      p.name.toLowerCase().includes(productSearch.toLowerCase()) &&
                      !selectedProductIds.includes(p.id)
                    )
                    .slice(0, 10)
                    .map((p) => (
                      <div
                        key={p.id}
                        onClick={() => {
                          setSelectedProductIds((prev) => [...prev, p.id]);
                          setProductSearch("");
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
                                const model = devicesData?.models.find((m) => m.id === mid);
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
            {selectedProductIds.length > 0 && (
              <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                {selectedProductIds.map((pid) => {
                  const product = availableProducts.find((p) => p.id === pid);
                  if (!product) return null;
                  return (
                    <div
                      key={pid}
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
                      <span>{product.name}</span>
                      <button
                        onClick={() => {
                          setSelectedProductIds((prev) => prev.filter((id) => id !== pid));
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

          {/* Action buttons */}
          <div style={{ display: "flex", gap: 6, marginTop: 4 }}>
            {catalogRepair ? (
              <>
                <button
                  onClick={() => {
                    const price = parseFloat(priceValue) || 0;
                    const costs = parseFloat(costsValue) || 0;
                    const time = parseInt(timeValue) || 0;
                    onUpdatePrice(repair.id, price);
                    onUpdateCosts(repair.id, costs);
                    onUpdateTime(repair.id, time);
                    onUpdateProducts(repair.id, selectedProductIds);
                    setIsEditing(false);
                    showToast("Uloženo", "success");
                  }}
                  style={{
                    padding: "8px 12px",
                    borderRadius: 6,
                    border,
                    background: "var(--panel)",
                    color: "var(--text)",
                    fontWeight: 700,
                    cursor: "pointer",
                    fontSize: 12,
                    flex: 1,
                  }}
                >
                  Uložit pouze pro zakázku
                </button>
                <button
                  onClick={() => {
                    const price = parseFloat(priceValue) || 0;
                    const costs = parseFloat(costsValue) || 0;
                    const time = parseInt(timeValue) || 0;
                    onUpdatePrice(repair.id, price);
                    onUpdateCosts(repair.id, costs);
                    onUpdateTime(repair.id, time);
                    onUpdateProducts(repair.id, selectedProductIds);
                    setIsEditing(false);
                    // Update catalog
                    const currentDevices = safeLoadDevicesData();
                    const updatedDevices = {
                      ...currentDevices,
                      repairs: currentDevices.repairs.map((r) =>
                        r.id === catalogRepair.id
                          ? { ...r, price, costs, estimatedTime: time, productIds: selectedProductIds }
                          : r
                      ),
                    };
                    try {
                      localStorage.setItem(STORAGE_KEYS.DEVICES, JSON.stringify(updatedDevices));
                      showToast("Uloženo do katalogu", "success");
                    } catch (_e) {
                      showToast("Chyba při ukládání", "error");
                    }
                  }}
                  style={{
                    padding: "8px 12px",
                    borderRadius: 6,
                    border: "1px solid var(--accent)",
                    background: "var(--accent-soft)",
                    color: "var(--accent)",
                    fontWeight: 700,
                    cursor: "pointer",
                    fontSize: 12,
                    flex: 1,
                  }}
                >
                  Uložit do katalogu
                </button>
              </>
            ) : (
              <button
                onClick={() => {
                  const price = parseFloat(priceValue) || 0;
                  const costs = parseFloat(costsValue) || 0;
                  const time = parseInt(timeValue) || 0;
                  onUpdatePrice(repair.id, price);
                  onUpdateCosts(repair.id, costs);
                  onUpdateTime(repair.id, time);
                  onUpdateProducts(repair.id, selectedProductIds);
                  setIsEditing(false);
                  showToast("Uloženo", "success");
                }}
                style={{
                  padding: "8px 12px",
                  borderRadius: 6,
                  border: "none",
                  background: "var(--accent)",
                  color: "white",
                  fontWeight: 700,
                  cursor: "pointer",
                  fontSize: 12,
                  flex: 1,
                }}
              >
                Uložit
              </button>
            )}
            <button
              onClick={() => {
                setIsEditing(false);
                setPriceValue(String(repair.price || 0));
                setCostsValue(String(repair.costs || 0));
                setTimeValue(String(repair.estimatedTime || 0));
                setSelectedProductIds(repair.productIds || []);
                setProductSearch("");
              }}
              style={{
                padding: "8px 12px",
                borderRadius: 6,
                border,
                background: "var(--panel)",
                color: "var(--text)",
                fontWeight: 700,
                cursor: "pointer",
                fontSize: 12,
              }}
            >
              Zrušit
            </button>
          </div>
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <span style={{ fontSize: 12, color: "var(--muted)" }}>Cena:</span>
            <span style={{ fontWeight: 700, fontSize: 13, color: "var(--text)" }}>
              {repair.price !== undefined ? formatCurrency(repair.price) : "Neuvedeno"}
            </span>
          </div>
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <span style={{ fontSize: 12, color: "var(--muted)" }}>Náklady:</span>
            <span style={{ fontWeight: 700, fontSize: 13, color: "var(--text)" }}>
              {repair.costs !== undefined ? formatCurrency(repair.costs) : "Neuvedeno"}
            </span>
          </div>
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <span style={{ fontSize: 12, color: "var(--muted)" }}>Čas:</span>
            <span style={{ fontWeight: 700, fontSize: 13, color: "var(--text)" }}>
              {repair.estimatedTime !== undefined ? `${repair.estimatedTime} min` : "Neuvedeno"}
            </span>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            <span style={{ fontSize: 12, color: "var(--muted)" }}>Produkty:</span>
            {selectedProductIds.length > 0 ? (
              <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                {selectedProductIds.map((pid) => {
                  const product = availableProducts.find((p) => p.id === pid);
                  return product ? (
                    <span key={pid} style={{ fontSize: 12, color: "var(--text)" }}>
                      {product.name}
                    </span>
                  ) : null;
                })}
              </div>
            ) : (
              <span style={{ fontSize: 12, color: "var(--muted)" }}>Neuvedeno</span>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ========================
// PerformedRepairAdder Component
// ========================
