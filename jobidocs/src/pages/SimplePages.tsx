/** Tiskárna, Aktivity, O aplikaci – jednoduché stránky bez šablon. */
import { useCallback, useEffect, useState } from "react";
import { api, electron, type ActivityEntry, type Printer } from "../api";
import { JobiDocsUpdateCard } from "../components/JobiDocsUpdateCard";

export function PrinterPage({ serviceId, serviceName }: { serviceId: string | null; serviceName: string }) {
  const [printers, setPrinters] = useState<Printer[]>([]);
  const [selected, setSelected] = useState("");
  const [saved, setSaved] = useState<string | null>(null);
  const [state, setState] = useState<"idle" | "saving" | "saved" | "error">("idle");

  const load = useCallback(async () => {
    setPrinters(await api.printers().catch(() => []));
    if (serviceId) {
      const s = await api.settings(serviceId).catch(() => ({}) as { preferred_printer_name?: string });
      setSaved(s.preferred_printer_name ?? null);
      setSelected(s.preferred_printer_name ?? "");
    }
  }, [serviceId]);

  useEffect(() => {
    void load();
  }, [load]);

  const save = async () => {
    if (!serviceId) return;
    setState("saving");
    try {
      await api.saveSettings(serviceId, selected);
      setSaved(selected);
      setState("saved");
    } catch {
      setState("error");
    }
  };

  return (
    <div className="glass-panel" style={{ maxWidth: 640 }}>
      <h2 style={{ marginTop: 0 }}>Tiskárna</h2>
      <p style={{ color: "var(--muted)", fontSize: 13 }}>
        Na tuto tiskárnu půjdou dokumenty servisu <b>{serviceName || "—"}</b> tisknuté z Jobi i zkušební tisky z editoru. Nastavení platí pro tento počítač.
      </p>
      <div className="in-row">
        <label>Tiskárna</label>
        <select className="ui-select" value={selected} onChange={(e) => setSelected(e.target.value)} disabled={!serviceId}>
          <option value="">Výchozí tiskárna systému</option>
          {printers.map((p) => (
            <option key={p.name} value={p.name}>
              {p.name}
              {p.available ? "" : " (nedostupná)"}
            </option>
          ))}
        </select>
      </div>
      <div className="in-actions">
        <button type="button" className="ui-btn ui-btn-primary" onClick={() => void save()} disabled={!serviceId || state === "saving" || selected === (saved ?? "")}>
          {state === "saving" ? "Ukládám…" : "Uložit"}
        </button>
        <button type="button" className="ui-btn" onClick={() => void load()}>
          Obnovit seznam
        </button>
        {state === "saved" && <span className="ed-status ok">Uloženo</span>}
        {state === "error" && <span className="ed-status err">Uložení selhalo</span>}
      </div>
    </div>
  );
}

export function ActivityPage() {
  const [entries, setEntries] = useState<ActivityEntry[]>([]);
  const [onlyErrors, setOnlyErrors] = useState(false);
  const load = useCallback(async () => setEntries(await api.activity().catch(() => [])), []);
  useEffect(() => {
    void load();
    const t = setInterval(() => void load(), 3000);
    return () => clearInterval(t);
  }, [load]);
  const shown = entries.filter((e) => !onlyErrors || e.status === "error");
  return (
    <div className="glass-panel">
      <div className="ed-toolbar" style={{ marginBottom: 12 }}>
        <h2 style={{ margin: 0 }}>Aktivity</h2>
        <span className="spacer" />
        <label style={{ display: "flex", gap: 6, alignItems: "center", fontSize: 13 }}>
          <input type="checkbox" checked={onlyErrors} onChange={(e) => setOnlyErrors(e.target.checked)} /> Jen chyby
        </label>
        <button type="button" className="ui-btn ui-btn-sm" onClick={() => void load()}>
          Obnovit
        </button>
      </div>
      {shown.length === 0 ? (
        <p style={{ color: "var(--muted)", fontSize: 13 }}>Zatím žádné tisky ani exporty od spuštění aplikace.</p>
      ) : (
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
            <thead>
              <tr style={{ textAlign: "left", color: "var(--muted)", fontSize: 11, textTransform: "uppercase" }}>
                <th style={{ padding: 8 }}>Čas</th>
                <th style={{ padding: 8 }}>Akce</th>
                <th style={{ padding: 8 }}>Stav</th>
                <th style={{ padding: 8 }}>Detail</th>
              </tr>
            </thead>
            <tbody>
              {shown.map((e, i) => (
                <tr key={i} style={{ borderTop: "1px solid var(--border)" }}>
                  <td style={{ padding: 8, whiteSpace: "nowrap" }}>{new Date(e.ts).toLocaleString("cs-CZ")}</td>
                  <td style={{ padding: 8 }}>{e.action === "print" ? "Tisk" : "Export"}</td>
                  <td style={{ padding: 8, color: e.status === "error" ? "var(--danger-text)" : e.status === "ok" ? "var(--success-text)" : "var(--muted)", fontWeight: 600 }}>{e.status === "ok" ? "Hotovo" : e.status === "error" ? "Chyba" : "Probíhá"}</td>
                  <td style={{ padding: 8, color: "var(--muted)", wordBreak: "break-all" }}>{e.detail}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

export function AboutPage({ version }: { version: string }) {
  const bridge = electron();
  const [updateState, setUpdateState] = useState<{ version: string; downloaded: boolean; progress: number } | null>(null);
  const [updateError, setUpdateError] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [channel, setChannel] = useState<"stable" | "beta">("stable");

  useEffect(() => {
    if (!bridge) return;
    bridge.update.getChannel?.().then(setChannel).catch(() => {});
    void bridge.update.getState().then(setUpdateState);
    void bridge.update.getError().then(setUpdateError);
    const off1 = bridge.update.onState(setUpdateState);
    const off2 = bridge.update.onError(setUpdateError);
    return () => {
      off1();
      off2();
    };
  }, [bridge]);

  return (
    <div className="glass-panel" style={{ maxWidth: 640 }}>
      <h2 style={{ marginTop: 0 }}>O aplikaci</h2>
      <p style={{ fontSize: 13 }}>
        <b>JobiDocs {version}</b> – tisk a export dokumentů z Jobi. Šablony dokumentů se ukládají pro celý servis, tiskárna pro tento počítač.
      </p>
      <h3 style={{ fontSize: 15 }}>Aktualizace</h3>
      {bridge && (
        <div className="in-row" style={{ maxWidth: 320 }}>
          <label>Kanál aktualizací</label>
          <select
            className="ui-select"
            value={channel}
            onChange={async (e) => {
              const c = e.target.value as "stable" | "beta";
              const saved = await bridge.update.setChannel(c);
              setChannel(saved);
            }}
          >
            <option value="stable">Stabilní (doporučeno)</option>
            <option value="beta">Beta (testovací verze dřív)</option>
          </select>
          <span className="hint">Beta dostává nové verze k vyzkoušení před ostatními. Přepnutí platí jen pro tento počítač.</span>
        </div>
      )}
      {bridge ? (
        <JobiDocsUpdateCard
          updateState={updateState}
          updateError={updateError}
          updateChecking={checking}
          updateDownloading={downloading}
          onCheck={async () => {
            setChecking(true);
            try {
              await bridge.update.check();
            } finally {
              setChecking(false);
            }
          }}
          onDownload={async () => {
            setDownloading(true);
            try {
              await bridge.update.download();
            } finally {
              setDownloading(false);
            }
          }}
          onRestart={() => void bridge.update.quitAndInstall()}
        />
      ) : (
        <p style={{ color: "var(--muted)", fontSize: 13 }}>Aktualizace jsou dostupné jen v nainstalované aplikaci.</p>
      )}
    </div>
  );
}
