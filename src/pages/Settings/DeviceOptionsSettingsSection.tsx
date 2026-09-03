import { Card } from "../../lib/settingsUi";
import { getDeviceOptions, setDeviceOptions, type DeviceOptions } from "../../lib/deviceOptions";
import { useCallback, useEffect, useState } from "react";
import { loadServiceConfig, mergeServiceConfig, subscribeServiceConfig } from "../../lib/serviceSettingsSync";

/**
 * Nabídka stavů zařízení/příslušenství sdílená mezi všemi na servisu,
 * v reálném čase. Do teď byla jen v localStorage – a ani ne po servisech:
 * jeden seznam pro všechny servisy na tom samém zařízení.
 *
 * localStorage (getDeviceOptions/setDeviceOptions) zůstává jako rychlá
 * cache pro Orders.tsx, který ji čte synchronně při zakládání zakázky –
 * DB je zdroj pravdy, cache se přepisuje při načtení i při realtime
 * události.
 */
export function DeviceOptionsSettingsSection({ activeServiceId }: { activeServiceId: string | null }) {
  const [options, setOptions] = useState(() => getDeviceOptions());
  const [newCondition, setNewCondition] = useState("");
  const [newAccessory, setNewAccessory] = useState("");

  const applyRemote = useCallback((remote: DeviceOptions) => {
    setDeviceOptions(remote);
    setOptions(getDeviceOptions());
  }, []);

  useEffect(() => {
    if (!activeServiceId) return;
    let zruseno = false;
    loadServiceConfig(activeServiceId).then((config) => {
      if (zruseno || !config?.deviceOptions) return;
      applyRemote(config.deviceOptions as DeviceOptions);
    });
    const unsubscribe = subscribeServiceConfig(activeServiceId, (config) => {
      if (config.deviceOptions) applyRemote(config.deviceOptions as DeviceOptions);
    });
    return () => { zruseno = true; unsubscribe(); };
  }, [activeServiceId, applyRemote]);

  const ulozit = useCallback((next: DeviceOptions) => {
    setDeviceOptions(next);
    setOptions(next);
    if (activeServiceId) void mergeServiceConfig(activeServiceId, { deviceOptions: next });
  }, [activeServiceId]);

  const addCondition = () => {
    const v = newCondition.trim();
    if (!v || options.deviceConditions.includes(v)) return;
    ulozit({ ...options, deviceConditions: [...options.deviceConditions, v] });
    setNewCondition("");
  };
  const removeCondition = (idx: number) => {
    ulozit({ ...options, deviceConditions: options.deviceConditions.filter((_, i) => i !== idx) });
  };
  const addAccessory = () => {
    const v = newAccessory.trim();
    if (!v || options.deviceAccessories.includes(v)) return;
    ulozit({ ...options, deviceAccessories: [...options.deviceAccessories, v] });
    setNewAccessory("");
  };
  const removeAccessory = (idx: number) => {
    ulozit({ ...options, deviceAccessories: options.deviceAccessories.filter((_, i) => i !== idx) });
  };
  const border = "1px solid var(--border)";
  const inputStyle = { padding: "8px 12px", borderRadius: 8, border, background: "var(--bg)", color: "var(--text)", fontSize: 13, width: "100%", maxWidth: 280 };
  const rowStyle: React.CSSProperties = { display: "flex", alignItems: "center", gap: 8, padding: "6px 0", flexWrap: "wrap" };
  return (
    <Card>
      <div style={{ fontWeight: 950, fontSize: 14, marginBottom: 12, color: "var(--text)" }}>Stavy zařízení a příslušenství</div>
      <div style={{ fontSize: 13, color: "var(--muted)", marginBottom: 16 }}>
        Přednastavené možnosti se zobrazí při zakládání zakázky v polích „Popis stavu“ a „Příslušenství“. Uživatel může vybrat z listu nebo napsat vlastní text. Změny se ukládají automaticky (tlačítko Uložit není potřeba).
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
        <div>
          <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 8, color: "var(--text)" }}>Stavy zařízení</div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 8 }}>
            <input value={newCondition} onChange={(e) => setNewCondition(e.target.value)} onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), addCondition())} placeholder="Přidat stav…" style={inputStyle} />
            <button type="button" onClick={addCondition} style={{ padding: "8px 14px", borderRadius: 8, border: "none", background: "var(--accent)", color: "var(--accent-fg)", fontWeight: 600, cursor: "pointer" }}>Přidat</button>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            {options.deviceConditions.map((item, idx) => (
              <div key={idx} style={rowStyle}>
                <span style={{ color: "var(--text)", fontSize: 13 }}>{item}</span>
                <button type="button" onClick={() => removeCondition(idx)} style={{ padding: "4px 8px", fontSize: 11, border: "none", background: "var(--panel-2)", color: "var(--muted)", borderRadius: 6, cursor: "pointer" }}>Odstranit</button>
              </div>
            ))}
          </div>
        </div>
        <div>
          <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 8, color: "var(--text)" }}>Příslušenství</div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 8 }}>
            <input value={newAccessory} onChange={(e) => setNewAccessory(e.target.value)} onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), addAccessory())} placeholder="Přidat položku…" style={inputStyle} />
            <button type="button" onClick={addAccessory} style={{ padding: "8px 14px", borderRadius: 8, border: "none", background: "var(--accent)", color: "var(--accent-fg)", fontWeight: 600, cursor: "pointer" }}>Přidat</button>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            {options.deviceAccessories.map((item, idx) => (
              <div key={idx} style={rowStyle}>
                <span style={{ color: "var(--text)", fontSize: 13 }}>{item}</span>
                <button type="button" onClick={() => removeAccessory(idx)} style={{ padding: "4px 8px", fontSize: 11, border: "none", background: "var(--panel-2)", color: "var(--muted)", borderRadius: 6, cursor: "pointer" }}>Odstranit</button>
              </div>
            ))}
          </div>
        </div>
      </div>
    </Card>
  );
}
