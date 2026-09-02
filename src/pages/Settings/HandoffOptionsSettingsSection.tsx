import { Card } from "../../lib/settingsUi";
import { getHandoffOptions, setHandoffOptions } from "../../lib/handoffOptions";
import { useState } from "react";

export function HandoffOptionsSettingsSection() {
  const [options, setOptions] = useState(() => getHandoffOptions());
  const [newReceive, setNewReceive] = useState("");
  const [newReturn, setNewReturn] = useState("");

  const addReceive = () => {
    const v = newReceive.trim();
    if (!v || options.receiveMethods.includes(v)) return;
    const next = { ...options, receiveMethods: [...options.receiveMethods, v] };
    setHandoffOptions(next);
    setOptions(next);
    setNewReceive("");
  };
  const removeReceive = (idx: number) => {
    const next = { ...options, receiveMethods: options.receiveMethods.filter((_, i) => i !== idx) };
    setHandoffOptions(next);
    setOptions(next);
  };
  const addReturn = () => {
    const v = newReturn.trim();
    if (!v || options.returnMethods.includes(v)) return;
    const next = { ...options, returnMethods: [...options.returnMethods, v] };
    setHandoffOptions(next);
    setOptions(next);
    setNewReturn("");
  };
  const removeReturn = (idx: number) => {
    const next = { ...options, returnMethods: options.returnMethods.filter((_, i) => i !== idx) };
    setHandoffOptions(next);
    setOptions(next);
  };

  const border = "1px solid var(--border)";
  const inputStyle = { padding: "8px 12px", borderRadius: 8, border, background: "var(--bg)", color: "var(--text)", fontSize: 13, width: "100%", maxWidth: 280 };
  const rowStyle: React.CSSProperties = { display: "flex", alignItems: "center", gap: 8, padding: "6px 0", flexWrap: "wrap" };
  return (
    <Card>
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
