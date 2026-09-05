import { useState } from "react";
import { Segmented } from "../ui";
import { type DevicesData, type InventoryData, type DeviceRepair, safeLoadInventoryData } from "../../lib/catalogStorage";
import { RepairPicker } from "./RepairPicker";

export function PerformedRepairAdder({
  availableRepairs,
  onAdd,
  deviceLabel,
  devicesData,
  inventoryData: inventoryDataProp,
  vychoziSazba,
  vychoziTechnik,
  onAddToModel,
}: {
  availableRepairs: DeviceRepair[];
  onAdd: (repair: { name: string; type: "selected" | "manual" | "hourly"; repairId?: string; hodiny?: number; sazba?: number; technik?: string }) => void;
  /** Hodinová sazba servisu (Nastavení → Zakázky → Hodinová práce). */
  vychoziSazba?: number;
  /** Přezdívka přihlášeného – kdo práci nejspíš odvedl. */
  vychoziTechnik?: string;
  deviceLabel?: string;
  devicesData?: DevicesData;
  /** Produkty skladu z databáze; bez nich se sáhne do starší kopie v localStorage. */
  inventoryData?: InventoryData;
  onAddToModel?: (repairData: { name: string; modelId: string; price?: number; costs?: number; estimatedTime?: number; productIds?: string[] }) => void;
}) {
  const [mode, setMode] = useState<"select" | "manual" | "hourly">("select");
  // Hodinová práce: hodiny × sazba. Sazba se předvyplní ze servisu, ale jde
  // ji pro konkrétní práci přepsat (expresní příplatek, sleva).
  const [praceNazev, setPraceNazev] = useState("Práce technika");
  const [praceHodiny, setPraceHodiny] = useState("1");
  const [praceSazba, setPraceSazba] = useState(vychoziSazba && vychoziSazba > 0 ? String(vychoziSazba) : "");
  const [praceTechnik, setPraceTechnik] = useState(vychoziTechnik ?? "");
  const hodinyCislo = parseFloat(praceHodiny.replace(",", ".")) || 0;
  const sazbaCislo = parseFloat(praceSazba.replace(",", ".")) || 0;
  const praceCena = Math.round(hodinyCislo * sazbaCislo * 100) / 100;
  const [selectedRepairId, setSelectedRepairId] = useState<string>("");
  const [manualRepairName, setManualRepairName] = useState("");
  const [manualRepairPrice, setManualRepairPrice] = useState<string>("");
  const [manualRepairCosts, setManualRepairCosts] = useState<string>("");
  const [manualRepairTime, setManualRepairTime] = useState<string>("");
  const [manualRepairProductIds, setManualRepairProductIds] = useState<string[]>([]);
  const [manualRepairProductSearch, setManualRepairProductSearch] = useState<string>("");
  
  // Produkty pro výběr dílů: z databáze (prop), záložně ze starší kopie v localStorage.
  const [lokalniInventar] = useState<InventoryData>(() => safeLoadInventoryData());
  const inventoryData = inventoryDataProp ?? lokalniInventar;
  
  // Find matching model
  const matchingModel = deviceLabel && devicesData ? (() => {
    const deviceName = deviceLabel.toLowerCase();
    const matchingModels = devicesData.models.filter(
      (m) => m && m.name && (m.name.toLowerCase().includes(deviceName) || deviceName.includes(m.name.toLowerCase()))
    );
    return matchingModels.length > 0 ? matchingModels[0] : null;
  })() : null;
  
  // Díly k výběru: přednostně ty navázané na rozpoznaný model; když se model
  // nepozná nebo na něj nic navázané není, celý sklad. Prázdný výběr by
  // nutil díl vybírat až později v editaci opravy.
  const availableProducts = (() => {
    const vse = inventoryData.products;
    if (!matchingModel) return vse;
    const proModel = vse.filter((p) => p.modelIds.includes(matchingModel.id));
    return proModel.length > 0 ? proModel : vse;
  })();

  const handleAdd = () => {
    if (mode === "select" && selectedRepairId) {
      const repair = availableRepairs.find((r) => r.id === selectedRepairId);
      if (repair) {
        onAdd({ name: repair.name, type: "selected", repairId: repair.id });
        setSelectedRepairId("");
      }
    } else if (mode === "manual" && manualRepairName.trim()) {
      onAdd({ name: manualRepairName.trim(), type: "manual" });
      setManualRepairName("");
    } else if (mode === "hourly" && hodinyCislo > 0 && sazbaCislo > 0) {
      onAdd({
        name: praceNazev.trim() || "Práce technika",
        type: "hourly",
        hodiny: hodinyCislo,
        sazba: sazbaCislo,
        technik: praceTechnik.trim() || undefined,
      });
      setPraceHodiny("1");
    }
  };

  const border = "1px solid var(--border)";

  return (
    <div style={{ display: "grid", gap: 10 }}>
      <Segmented
        ariaLabel="Způsob zadání opravy"
        size="sm"
        value={mode}
        onChange={setMode}
        options={[
          { value: "select", label: "Vybrat z katalogu" },
          { value: "manual", label: "Manuálně zadat" },
          { value: "hourly", label: "Hodinová práce" },
        ]}
      />

      {mode === "select" && (
        <div style={{ display: "grid", gap: 8 }}>
          {availableRepairs.length > 0 ? (
            <RepairPicker
              value={selectedRepairId}
              repairs={availableRepairs.map((r) => ({ id: r.id, name: r.name, price: r.price || 0 }))}
              placeholder="Vyberte opravu..."
              onChange={(repairId) => {
                setSelectedRepairId(repairId);
                if (repairId) {
                  const repair = availableRepairs.find((r) => r.id === repairId);
                  if (repair) {
                    onAdd({
                      type: "selected",
                      repairId: repair.id,
                      name: repair.name,
                    });
                    setSelectedRepairId("");
                  }
                }
              }}
            />
          ) : (
            <div
              style={{
                padding: 12,
                borderRadius: 10,
                background: "var(--panel-2)",
                color: "var(--muted)",
                fontSize: 12,
                textAlign: "center",
              }}
            >
              Pro toto zařízení nejsou v katalogu žádné opravy. Použijte manuální zadání.
            </div>
          )}
        </div>
      )}

      {mode === "hourly" && (
        <div style={{ display: "grid", gap: 8 }}>
          <input
            type="text"
            value={praceNazev}
            onChange={(e) => setPraceNazev(e.target.value)}
            placeholder="Popis práce (např. Diagnostika, Čištění)"
            aria-label="Popis práce"
            style={{ padding: "10px 12px", borderRadius: 10, border, background: "var(--panel)", color: "var(--text)", fontSize: 13, fontFamily: "inherit", width: "100%" }}
          />
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 140px), 1fr))", gap: 8 }}>
            <label style={{ display: "grid", gap: 4, fontSize: 12, color: "var(--muted)" }}>
              Hodiny
              <input
                type="number"
                min={0}
                step={0.25}
                value={praceHodiny}
                onChange={(e) => setPraceHodiny(e.target.value)}
                style={{ padding: "10px 12px", borderRadius: 10, border, background: "var(--panel)", color: "var(--text)", fontSize: 13, fontFamily: "inherit", width: "100%" }}
              />
            </label>
            <label style={{ display: "grid", gap: 4, fontSize: 12, color: "var(--muted)" }}>
              Sazba (Kč/h)
              <input
                type="number"
                min={0}
                step={10}
                value={praceSazba}
                onChange={(e) => setPraceSazba(e.target.value)}
                placeholder={vychoziSazba ? String(vychoziSazba) : "např. 800"}
                style={{ padding: "10px 12px", borderRadius: 10, border, background: "var(--panel)", color: "var(--text)", fontSize: 13, fontFamily: "inherit", width: "100%" }}
              />
            </label>
            <label style={{ display: "grid", gap: 4, fontSize: 12, color: "var(--muted)" }}>
              Technik
              <input
                type="text"
                value={praceTechnik}
                onChange={(e) => setPraceTechnik(e.target.value)}
                placeholder="Kdo pracoval"
                style={{ padding: "10px 12px", borderRadius: 10, border, background: "var(--panel)", color: "var(--text)", fontSize: 13, fontFamily: "inherit", width: "100%" }}
              />
            </label>
          </div>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
            <span style={{ fontSize: 13, color: "var(--muted)" }}>
              {hodinyCislo > 0 && sazbaCislo > 0
                ? `${hodinyCislo.toLocaleString("cs-CZ")} h × ${sazbaCislo.toLocaleString("cs-CZ")} Kč = ${praceCena.toLocaleString("cs-CZ", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} Kč`
                : !vychoziSazba
                  ? "Výchozí sazbu nastavíte v Nastavení → Zakázky → Hodinová práce."
                  : "Zadejte hodiny a sazbu."}
            </span>
            <button
              type="button"
              onClick={handleAdd}
              disabled={!(hodinyCislo > 0 && sazbaCislo > 0)}
              style={{ padding: "10px 16px", borderRadius: 10, border: "none", background: "var(--accent)", color: "#fff", fontWeight: 700, fontSize: 13, cursor: hodinyCislo > 0 && sazbaCislo > 0 ? "pointer" : "not-allowed", opacity: hodinyCislo > 0 && sazbaCislo > 0 ? 1 : 0.6 }}
            >
              Přidat práci
            </button>
          </div>
        </div>
      )}

      {mode === "manual" && (
        <div style={{ display: "grid", gap: 8 }}>
        <input
          type="text"
          value={manualRepairName}
          onChange={(e) => setManualRepairName(e.target.value)}
          placeholder="Napište název opravy..."
          style={{
            padding: "10px 12px",
            borderRadius: 10,
            border,
            background: "var(--panel)",
            color: "var(--text)",
            fontSize: 13,
            fontFamily: "inherit",
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter" && manualRepairName.trim()) {
              handleAdd();
            }
          }}
        />
          {matchingModel && onAddToModel && (
            <>
              <div style={{ 
                padding: 12, 
                borderRadius: 10, 
                background: "var(--accent-soft)", 
                border: "1px solid var(--accent)",
                fontSize: 12,
                color: "var(--accent)",
                fontWeight: 600,
              }}>
                Přidat opravu k modelu "{matchingModel.name}"
              </div>
              <div style={{ display: "grid", gap: 8 }}>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 240px), 1fr))", gap: 8 }}>
                  <input
                    type="number"
                    value={manualRepairPrice}
                    onChange={(e) => setManualRepairPrice(e.target.value)}
                    placeholder="Cena (Kč)"
                    style={{
                      padding: "10px 12px",
                      borderRadius: 10,
                      border,
                      background: "var(--panel)",
                      color: "var(--text)",
                      fontSize: 13,
                      fontFamily: "inherit",
                    }}
                  />
                  <input
                    type="number"
                    value={manualRepairTime}
                    onChange={(e) => setManualRepairTime(e.target.value)}
                    placeholder="Čas (min)"
                    style={{
                      padding: "10px 12px",
                      borderRadius: 10,
                      border,
                      background: "var(--panel)",
                      color: "var(--text)",
                      fontSize: 13,
                      fontFamily: "inherit",
                    }}
                  />
                </div>
                <input
                  type="number"
                  value={manualRepairCosts}
                  onChange={(e) => setManualRepairCosts(e.target.value)}
                  placeholder="Náklady (Kč, volitelné)"
                  style={{
                    padding: "10px 12px",
                    borderRadius: 10,
                    border,
                    background: "var(--panel)",
                    color: "var(--text)",
                    fontSize: 13,
                    fontFamily: "inherit",
                  }}
                />
                <div>
                  <label style={{ fontSize: 12, color: "var(--muted)", marginBottom: 4, display: "block" }}>
                    Produkty (samodoplnovací výběr, volitelné)
                  </label>
                  <div style={{ position: "relative" }}>
                    <input
                      placeholder="Hledat produkt…"
                      value={manualRepairProductSearch}
                      onChange={(e) => setManualRepairProductSearch(e.target.value)}
                      style={{
                        padding: "10px 12px",
                        borderRadius: 10,
                        border,
                        background: "var(--panel)",
                        color: "var(--text)",
                        fontSize: 13,
                        fontFamily: "inherit",
                        width: "100%",
                      }}
                    />
                    {manualRepairProductSearch && (
                      <div style={{ position: "absolute", top: "100%", left: 0, right: 0, zIndex: 1000, background: "var(--panel)", border, borderRadius: 8, marginTop: 4, maxHeight: 200, overflowY: "auto" }}>
                        {availableProducts
                          .filter((p) =>
                            p.name.toLowerCase().includes(manualRepairProductSearch.toLowerCase()) &&
                            !manualRepairProductIds.includes(p.id)
                          )
                          .slice(0, 10)
                          .map((p) => (
                            <div
                              key={p.id}
                              onClick={() => {
                                setManualRepairProductIds((prev) => [...prev, p.id]);
                                setManualRepairProductSearch("");
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
                  {manualRepairProductIds.length > 0 && (
                    <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 8 }}>
                      {manualRepairProductIds.map((pid) => {
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
                                setManualRepairProductIds((prev) => prev.filter((id) => id !== pid));
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
                <button
                  onClick={() => {
                    if (manualRepairName.trim() && matchingModel) {
                      onAddToModel({
                        name: manualRepairName.trim(),
                        modelId: matchingModel.id,
                        price: manualRepairPrice ? parseFloat(manualRepairPrice) : undefined,
                        costs: manualRepairCosts ? parseFloat(manualRepairCosts) : undefined,
                        estimatedTime: manualRepairTime ? parseInt(manualRepairTime) : undefined,
                        productIds: manualRepairProductIds.length > 0 ? manualRepairProductIds : undefined,
                      });
                      setManualRepairName("");
                      setManualRepairPrice("");
                      setManualRepairCosts("");
                      setManualRepairTime("");
                      setManualRepairProductIds([]);
                      setManualRepairProductSearch("");
                    }
                  }}
                  disabled={!manualRepairName.trim()}
                  style={{
                    padding: "10px 12px",
                    borderRadius: 10,
                    border: "1px solid var(--accent)",
                    background: manualRepairName.trim() ? "var(--accent)" : "var(--panel-2)",
                    color: manualRepairName.trim() ? "white" : "var(--muted)",
                    fontWeight: 700,
                    fontSize: 12,
                    cursor: manualRepairName.trim() ? "pointer" : "not-allowed",
                  }}
                >
                  Přidat opravu k modelu "{matchingModel.name}"
                </button>
              </div>
            </>
          )}
        </div>
      )}

      <button
        onClick={handleAdd}
        disabled={(mode === "select" && !selectedRepairId) || (mode === "manual" && !manualRepairName.trim())}
        style={{
          padding: "10px 14px",
          borderRadius: 10,
          border,
          background:
            (mode === "select" && selectedRepairId) || (mode === "manual" && manualRepairName.trim())
              ? "var(--accent)"
              : "var(--panel-2)",
          color:
            (mode === "select" && selectedRepairId) || (mode === "manual" && manualRepairName.trim())
              ? "white"
              : "var(--muted)",
          fontWeight: 700,
          fontSize: 13,
          cursor:
            (mode === "select" && selectedRepairId) || (mode === "manual" && manualRepairName.trim())
              ? "pointer"
              : "not-allowed",
        }}
      >
        Přidat opravu
      </button>
    </div>
  );
}
