/**
 * JobiDocs – skořápka aplikace: postranní navigace, hlavička s připojením
 * k Jobi, stránky Dokumenty / Značka / Tiskárna / Aktivity / O aplikaci.
 */
import { useCallback, useEffect, useState } from "react";
import { api, type Context } from "./api";
import { AppLogo } from "./components/AppLogo";
import { ActivityIcon, DocIcon, InfoIcon, PrinterIcon } from "./components/icons";
import { DocumentEditor } from "./editor/DocumentEditor";
import { BrandPage } from "./pages/BrandPage";
import { AboutPage, ActivityPage, PrinterPage } from "./pages/SimplePages";
import { useDocuments } from "./state/useDocuments";
import "./styles/editor.css";

type Tab = "dokumenty" | "znacka" | "tiskarna" | "aktivity" | "o_aplikaci";

const TABS: { key: Tab; label: string; icon: React.ReactNode }[] = [
  { key: "dokumenty", label: "Dokumenty", icon: <DocIcon /> },
  { key: "znacka", label: "Značka", icon: <BrandIcon /> },
  { key: "tiskarna", label: "Tiskárna", icon: <PrinterIcon /> },
  { key: "aktivity", label: "Aktivity", icon: <ActivityIcon /> },
  { key: "o_aplikaci", label: "O aplikaci", icon: <InfoIcon /> },
];

function BrandIcon() {
  return (
    <svg className="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="13.5" cy="6.5" r="2.5" />
      <path d="M12 2a10 10 0 1 0 10 10c0-1.7-1.3-3-3-3h-1.5a2 2 0 0 1-1.5-3.3A2 2 0 0 0 14.5 2z" />
      <circle cx="7.5" cy="10.5" r="1.5" />
      <circle cx="8.5" cy="16" r="1.5" />
    </svg>
  );
}

export default function App() {
  const [tab, setTab] = useState<Tab>("dokumenty");
  const [context, setContext] = useState<Context | null>(null);
  const [version, setVersion] = useState("");
  const [serviceId, setServiceId] = useState<string | null>(null);
  const [toast, setToast] = useState<{ msg: string; kind: "ok" | "error" } | null>(null);
  const [pendingTab, setPendingTab] = useState<Tab | null>(null);

  const showToast = useCallback((msg: string, kind: "ok" | "error" = "ok") => {
    setToast({ msg, kind });
    window.setTimeout(() => setToast(null), kind === "error" ? 6000 : 3000);
  }, []);

  // Kontext z Jobi (servisy, aktivní servis, údaje firmy, oprávnění).
  useEffect(() => {
    let alive = true;
    const tick = async () => {
      try {
        const c = await api.context();
        if (!alive) return;
        setContext(c);
        setServiceId((cur) => cur ?? c.activeServiceId ?? c.services[0]?.service_id ?? null);
      } catch {
        if (alive) setContext(null);
      }
    };
    void tick();
    const t = setInterval(() => void tick(), 3000);
    api.health().then((h) => setVersion(h.version)).catch(() => {});
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, []);

  const docsState = useDocuments(serviceId);
  const activeService = context?.services.find((s) => s.service_id === serviceId) ?? null;
  const connected = !!context && context.services.length > 0;

  const requestTab = (t: Tab) => {
    if (t !== tab && docsState.dirty && (tab === "dokumenty" || tab === "znacka") && t !== "dokumenty" && t !== "znacka") setPendingTab(t);
    else setTab(t);
  };

  return (
    <div className="app-layout">
      <aside className="app-sidebar">
        <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "4px 6px 14px" }}>
          <AppLogo size={34} />
          <div>
            <div style={{ fontWeight: 800, fontSize: 16, lineHeight: 1 }}>JobiDocs</div>
            <div style={{ fontSize: 11, color: "var(--muted)" }}>{version}</div>
          </div>
        </div>
        {TABS.map((t) => (
          <button key={t.key} type="button" className={`app-sidebar-nav-item ${tab === t.key ? "active" : ""}`} onClick={() => requestTab(t.key)}>
            {t.icon}
            {t.label}
          </button>
        ))}
        <div style={{ marginTop: "auto", fontSize: 12, padding: "10px 6px", color: connected ? "var(--success-text)" : "var(--muted)", display: "flex", gap: 8, alignItems: "center" }}>
          <span style={{ width: 8, height: 8, borderRadius: 4, background: connected ? "var(--success)" : "var(--muted)", flexShrink: 0 }} />
          {connected ? "Připojeno k Jobi" : "Čekám na Jobi…"}
        </div>
      </aside>

      <main className="app-main">
        <div className="ed-toolbar" style={{ marginBottom: 14 }}>
          <div style={{ fontSize: 13, color: "var(--muted)" }}>Servis</div>
          <select className="ui-select" style={{ width: "auto", minWidth: 220 }} value={serviceId ?? ""} onChange={(e) => setServiceId(e.target.value || null)} disabled={!context || context.services.length === 0}>
            {!connected && <option value="">Spusťte Jobi a přihlaste se</option>}
            {context?.services.map((s) => (
              <option key={s.service_id} value={s.service_id}>
                {s.service_name}
              </option>
            ))}
          </select>
          {context && !context.canManageDocuments && <span className="ed-status err">Jen pro čtení</span>}
        </div>

        {!connected && tab !== "o_aplikaci" && tab !== "aktivity" && (
          <div className="glass-panel" style={{ marginBottom: 14 }}>
            <b>JobiDocs čeká na Jobi.</b>
            <p style={{ margin: "6px 0 0", fontSize: 13, color: "var(--muted)" }}>Spusťte Jobi a přihlaste se. JobiDocs si z něj vezme seznam servisů, údaje firmy a přístup k uloženým šablonám.</p>
          </div>
        )}

        {tab === "dokumenty" &&
          (serviceId && docsState.docs ? (
            <DocumentEditor
              serviceId={serviceId}
              companyData={context?.companyData ?? null}
              docs={docsState.docs}
              setDocs={docsState.setDocs}
              dirty={docsState.dirty}
              save={docsState.save}
              onSave={docsState.persist}
              onReload={docsState.reload}
              canManage={context?.canManageDocuments !== false}
              undo={docsState.undo}
              redo={docsState.redo}
              canUndo={docsState.canUndo}
              canRedo={docsState.canRedo}
              onToast={showToast}
              lastSaved={docsState.loaded ? { version: docsState.loaded.version, updated_at: docsState.loaded.updated_at, source: docsState.loaded.source } : null}
              draft={docsState.draft}
              onRestoreDraft={docsState.restoreDraft}
              onDiscardDraft={docsState.discardDraft}
            />
          ) : (
            <div className="glass-panel">{docsState.loading ? "Načítám šablony…" : docsState.loadError ? `Šablony se nepodařilo načíst: ${docsState.loadError}` : "Vyberte servis."}</div>
          ))}

        {tab === "znacka" &&
          (docsState.docs ? (
            <BrandPage docs={docsState.docs} setDocs={docsState.setDocs} dirty={docsState.dirty} save={docsState.save} onSave={() => docsState.persist()} canManage={context?.canManageDocuments !== false} companyData={context?.companyData ?? null} />
          ) : (
            <div className="glass-panel">Vyberte servis.</div>
          ))}

        {tab === "tiskarna" && <PrinterPage serviceId={serviceId} serviceName={activeService?.service_name ?? ""} />}
        {tab === "aktivity" && <ActivityPage />}
        {tab === "o_aplikaci" && <AboutPage version={version} />}
      </main>

      {pendingTab && (
        <div className="dlg-backdrop" onClick={() => setPendingTab(null)}>
          <div className="dlg" onClick={(e) => e.stopPropagation()}>
            <h3>Neuložené změny</h3>
            <p>V dokumentech máte neuložené změny. Chcete je před odchodem uložit?</p>
            <div className="actions">
              <button type="button" className="ui-btn" onClick={() => setPendingTab(null)}>
                Zůstat
              </button>
              <button
                type="button"
                className="ui-btn ui-btn-ghost"
                onClick={() => {
                  setTab(pendingTab);
                  setPendingTab(null);
                }}
              >
                Odejít bez uložení
              </button>
              <button
                type="button"
                className="ui-btn ui-btn-primary"
                onClick={async () => {
                  if (await docsState.persist()) {
                    setTab(pendingTab);
                    setPendingTab(null);
                  }
                }}
              >
                Uložit a odejít
              </button>
            </div>
          </div>
        </div>
      )}

      {toast && <div className={`toast ${toast.kind === "error" ? "error" : ""}`}>{toast.msg}</div>}
    </div>
  );
}
