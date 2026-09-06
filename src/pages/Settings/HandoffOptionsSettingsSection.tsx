import { Card } from "../../lib/settingsUi";
import { getHandoffOptions, setHandoffOptions, type HandoffOptions } from "../../lib/handoffOptions";
import { useCallback, useEffect, useState } from "react";
import { showToast } from "../../components/Toast";
import { nactiServiceConfig, mergeServiceConfig, subscribeServiceConfig } from "../../lib/serviceSettingsSync";
import { useConfigNacteno } from "./useConfigNacteno";

/** Sdílené mezi všemi na servisu v reálném čase – viz komentář u DeviceOptionsSettingsSection. */
export function HandoffOptionsSettingsSection({ activeServiceId }: { activeServiceId: string | null }) {
  const [options, setOptions] = useState(() => getHandoffOptions());
  const [newReceive, setNewReceive] = useState("");
  const [newReturn, setNewReturn] = useState("");
  const { nacteno, oznacNacteno } = useConfigNacteno(activeServiceId);
  const [chybaNacteni, setChybaNacteni] = useState(false);

  const applyRemote = useCallback((remote: HandoffOptions) => {
    setHandoffOptions(remote);
    setOptions(getHandoffOptions());
  }, []);

  useEffect(() => {
    if (!activeServiceId) return;
    let zruseno = false;
    nactiServiceConfig(activeServiceId).then((r) => {
      if (zruseno) return;
      // Chyba čtení není platný stav: bez jistoty, co je v databázi, by se
      // uložil výchozí seznam přes ten skutečný.
      if (r.stav === "chyba") {
        setChybaNacteni(true);
        return;
      }
      setChybaNacteni(false);
      if (r.stav === "ok" && (r.config as any)?.handoffOptions) applyRemote((r.config as any).handoffOptions as HandoffOptions);
      oznacNacteno();
    });
    const unsubscribe = subscribeServiceConfig(activeServiceId, (config) => {
      if (config.handoffOptions) applyRemote(config.handoffOptions as HandoffOptions);
    });
    return () => { zruseno = true; unsubscribe(); };
  }, [activeServiceId, applyRemote, oznacNacteno]);

  const ulozit = useCallback((next: HandoffOptions) => {
    // Viz useConfigNacteno: bez načteného configu by se uložil výchozí seznam.
    if (!nacteno) return;
    setHandoffOptions(next);
    setOptions(next);
    if (activeServiceId) {
      // Chyba se vrací, nevyhazuje – bez téhle kontroly zmizí potichu.
      void mergeServiceConfig(activeServiceId, { handoffOptions: next }).then((r) => {
        if (r.error) showToast("Nastavení se nepodařilo uložit: " + r.error, "error");
      });
    }
  }, [activeServiceId, nacteno]);

  const addReceive = () => {
    const v = newReceive.trim();
    if (!v || options.receiveMethods.includes(v)) return;
    ulozit({ ...options, receiveMethods: [...options.receiveMethods, v] });
    setNewReceive("");
  };
  const removeReceive = (idx: number) => {
    ulozit({ ...options, receiveMethods: options.receiveMethods.filter((_, i) => i !== idx) });
  };
  const addReturn = () => {
    const v = newReturn.trim();
    if (!v || options.returnMethods.includes(v)) return;
    ulozit({ ...options, returnMethods: [...options.returnMethods, v] });
    setNewReturn("");
  };
  const removeReturn = (idx: number) => {
    ulozit({ ...options, returnMethods: options.returnMethods.filter((_, i) => i !== idx) });
  };

  const border = "1px solid var(--border)";
  const inputStyle = { padding: "8px 12px", borderRadius: 8, border, background: "var(--bg)", color: "var(--text)", fontSize: 13, width: "100%", maxWidth: 280 };
  const rowStyle: React.CSSProperties = { display: "flex", alignItems: "center", gap: 8, padding: "6px 0", flexWrap: "wrap" };
  return (
    <Card>
      {chybaNacteni && (
        <div style={{ marginBottom: 12, padding: 10, borderRadius: 8, border: "1px solid var(--danger, #dc2626)", color: "var(--danger, #dc2626)", fontSize: 13 }}>
          Způsoby předání se nepodařilo načíst. Dokud se nenačtou, nejde je měnit – jinak by se uložily výchozí.
        </div>
      )}
      <div style={{ fontWeight: 950, fontSize: 14, marginBottom: 12, color: "var(--text)" }}>Způsoby převzetí a předání</div>
      <div style={{ fontSize: 13, color: "var(--muted)", marginBottom: 16 }}>
        Možnosti pro „Způsob převzetí“ a „Způsob předání“ při zakládání a úpravě zakázky. V zakázce lze vybírat pouze z tohoto seznamu (dropdown). Změny se ukládají automaticky.
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
        <div>
          <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 8, color: "var(--text)" }}>Způsob převzetí</div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 8 }}>
            <input value={newReceive} onChange={(e) => setNewReceive(e.target.value)} onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), addReceive())} placeholder="Přidat (např. Na pobočce, Poštou)…" style={inputStyle} />
            <button type="button" onClick={addReceive} style={{ padding: "8px 14px", borderRadius: 8, border: "none", background: "var(--accent)", color: "var(--accent-fg)", fontWeight: 600, cursor: "pointer" }}>Přidat</button>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            {options.receiveMethods.map((item, idx) => (
              <div key={idx} style={rowStyle}>
                <span style={{ color: "var(--text)", fontSize: 13 }}>{item}</span>
                <button type="button" onClick={() => removeReceive(idx)} style={{ padding: "4px 8px", fontSize: 11, border: "none", background: "var(--panel-2)", color: "var(--muted)", borderRadius: 6, cursor: "pointer" }}>Odstranit</button>
              </div>
            ))}
          </div>
        </div>
        <div>
          <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 8, color: "var(--text)" }}>Způsob předání</div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 8 }}>
            <input value={newReturn} onChange={(e) => setNewReturn(e.target.value)} onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), addReturn())} placeholder="Přidat (např. Vyzvednutí na pobočce, Poštou)…" style={inputStyle} />
            <button type="button" onClick={addReturn} style={{ padding: "8px 14px", borderRadius: 8, border: "none", background: "var(--accent)", color: "var(--accent-fg)", fontWeight: 600, cursor: "pointer" }}>Přidat</button>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            {options.returnMethods.map((item, idx) => (
              <div key={idx} style={rowStyle}>
                <span style={{ color: "var(--text)", fontSize: 13 }}>{item}</span>
                <button type="button" onClick={() => removeReturn(idx)} style={{ padding: "4px 8px", fontSize: 11, border: "none", background: "var(--panel-2)", color: "var(--muted)", borderRadius: 6, cursor: "pointer" }}>Odstranit</button>
              </div>
            ))}
          </div>
        </div>
      </div>
    </Card>
  );
}
