/**
 * Značka: vzhled dokumentů (galerie motivů), logo, razítko, hlavičkový papír,
 * odkaz na hodnocení. Platí pro všechny dokumenty servisu; ukládá se spolu
 * se šablonami.
 */
import { useLayoutEffect, useMemo, useRef, useState } from "react";
import { DEFAULT_BRAND, THEME_PRESETS, defaultTemplate, renderDocument, sampleData, serviceFromCompanyData, type Brand, type DocumentsV2, type Theme } from "../../core/index";
import { ConflictDialog } from "../editor/ConflictDialog";
import type { SaveState } from "../state/useDocuments";
import { useDocumentsStorage } from "../storage/context";
import type { BrandAssetKind } from "../storage/types";

type Props = {
  docs: DocumentsV2;
  setDocs: (u: (d: DocumentsV2) => DocumentsV2) => void;
  dirty: boolean;
  save: SaveState;
  onSave: (opts?: { force?: boolean }) => Promise<boolean>;
  /** Načíst šablony znovu (po konfliktu „Načíst jeho verzi“). */
  onReload: () => Promise<void>;
  canManage: boolean;
  companyData: Record<string, unknown> | null;
};

const ACCENTS = ["#0e7c86", "#2563eb", "#1f4e79", "#3c9d40", "#7c3aed", "#db2777", "#ea580c", "#b45309", "#334155", "#111111"];

/** Zmenšený náhled dokumentu v daném motivu (stejný renderer jako tisk). */
function ThemeThumb({ theme, brand, companyData }: { theme: Theme; brand: Brand; companyData: Record<string, unknown> | null }) {
  const ref = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(0.25);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const m = () => setScale(el.clientWidth / 794);
    m();
    const ro = new ResizeObserver(m);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const html = useMemo(
    () => renderDocument({ template: defaultTemplate("zakazkovy_list"), data: sampleData("zakazkovy_list", "short", serviceFromCompanyData(companyData)), brand, theme, options: { mode: "print" } }),
    [theme, brand, companyData]
  );
  return (
    <div className="th-thumb" ref={ref}>
      <iframe title="Náhled motivu" srcDoc={html} style={{ transform: `scale(${scale})` }} tabIndex={-1} />
    </div>
  );
}

export function BrandPage({ docs, setDocs, dirty, save, onSave, onReload, canManage, companyData }: Props) {
  const setBrand = (patch: Partial<Brand>) => setDocs((d) => ({ ...d, brand: { ...d.brand, ...patch } }));
  const setTheme = (patch: Partial<Theme>) => setDocs((d) => ({ ...d, theme: { ...d.theme, ...patch } }));
  const logoInput = useRef<HTMLInputElement>(null);
  const stampInput = useRef<HTMLInputElement>(null);
  const lhInput = useRef<HTMLInputElement>(null);
  // Desktop: data: URL (do Storage je přesune server při uložení); web: zmenšený obrázek.
  const storage = useDocumentsStorage();
  const [uploadError, setUploadError] = useState<string | null>(null);

  const upload = async (input: HTMLInputElement, key: keyof Brand, kind: BrandAssetKind) => {
    const file = input.files?.[0];
    // Vynulovat, ať jde stejný soubor vybrat znovu (Safari a Firefox jinak nepošlou change).
    input.value = "";
    if (!file) return;
    setUploadError(null);
    try {
      const url = await storage.prepareBrandAsset(file, kind);
      setBrand({ [key]: url } as Partial<Brand>);
    } catch (e) {
      setUploadError(e instanceof Error ? e.message : String(e));
    }
  };

  const { brand, theme } = docs;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <div className="ed-toolbar">
        <div>
          <h2 style={{ margin: 0, fontSize: 20 }}>Značka</h2>
          <div className="ed-status">Vzhled, logo, razítko a barvy jsou společné pro všechny dokumenty servisu.</div>
        </div>
        <span className="spacer" />
        <button type="button" className={`ui-btn ${dirty ? "ui-btn-primary" : ""}`} onClick={() => void onSave()} disabled={!dirty || save.status === "saving" || !canManage}>
          {save.status === "saving" ? "Ukládám…" : "Uložit"}
        </button>
        {dirty && <span className="ed-status dirty">● Neuložené změny</span>}
        {save.status === "error" && <span className="ed-status err">{save.message}</span>}
      </div>

      {uploadError && <div className="ed-status err">Obrázek se nepodařilo načíst: {uploadError}</div>}

      <div className="br-card">
        <h3>Vzhled dokumentů</h3>
        <div className="th-grid">
          {THEME_PRESETS.map((pr) => {
            const active = theme.style === pr.style;
            const previewTheme: Theme = { ...theme, style: pr.style, accent: active ? theme.accent : pr.accent };
            return (
              <button key={pr.style} type="button" className={`th-card ${active ? "active" : ""}`} onClick={() => setTheme({ style: pr.style, accent: pr.accent })}>
                <ThemeThumb theme={previewTheme} brand={brand} companyData={companyData} />
                <b>{pr.name}</b>
                <span>{pr.description}</span>
              </button>
            );
          })}
        </div>
        <div className="in-inline" style={{ marginTop: 6 }}>
          <div className="in-row">
            <label>Barva</label>
            <div className="swatches">
              {ACCENTS.map((c) => (
                <button key={c} type="button" className={`swatch ${theme.accent.toLowerCase() === c ? "active" : ""}`} style={{ background: c }} onClick={() => setTheme({ accent: c })} title={c} />
              ))}
              <input type="color" value={theme.accent} onChange={(e) => setTheme({ accent: e.target.value })} title="Vlastní barva" />
            </div>
          </div>
          <div className="in-row">
            <label>Tisk</label>
            <select className="ui-select" value={theme.color} onChange={(e) => setTheme({ color: e.target.value as Theme["color"] })}>
              <option value="color">Barevně</option>
              <option value="bw">Černobíle (obrázky do šedi)</option>
            </select>
          </div>
          <div className="in-row">
            <label>Písmo</label>
            <select className="ui-select" value={theme.font} onChange={(e) => setTheme({ font: e.target.value as Theme["font"] })}>
              <option value="roboto">Roboto (přibalené)</option>
              <option value="inter">Inter (vyžaduje internet)</option>
              <option value="system">Systémové</option>
            </select>
          </div>
          <div className="in-row">
            <label>Linky v tabulkách</label>
            <select className="ui-select" value={theme.tableLines} onChange={(e) => setTheme({ tableLines: e.target.value as Theme["tableLines"] })}>
              <option value="rows">Mezi řádky</option>
              <option value="all">Kolem každé buňky</option>
              <option value="none">Bez linek</option>
            </select>
          </div>
        </div>
      </div>

      <div className="br-grid">
        <div className="br-card" data-tour="sablony-logo">
          <h3>Logo</h3>
          <div className="br-preview">{brand.logoUrl ? <img src={brand.logoUrl} alt="Logo" /> : <span className="none">Bez loga</span>}</div>
          <div className="in-actions">
            <input ref={logoInput} type="file" accept="image/*" hidden onChange={(e) => void upload(e.currentTarget, "logoUrl", "logo")} />
            <button type="button" className="ui-btn ui-btn-sm" onClick={() => logoInput.current?.click()}>
              {brand.logoUrl ? "Změnit" : "Nahrát logo"}
            </button>
            {brand.logoUrl && (
              <button type="button" className="ui-btn ui-btn-sm ui-btn-ghost" onClick={() => setBrand({ logoUrl: undefined })}>
                Odebrat
              </button>
            )}
          </div>
          <span style={{ fontSize: 12, color: "var(--muted)" }}>Zobrazí se v hlavičce dokumentů u prvku „Logo“.</span>
        </div>

        <div className="br-card">
          <h3>Razítko / podpis</h3>
          <div className="br-preview">{brand.stampUrl ? <img src={brand.stampUrl} alt="Razítko" /> : <span className="none">Bez razítka</span>}</div>
          <div className="in-actions">
            <input ref={stampInput} type="file" accept="image/*" hidden onChange={(e) => void upload(e.currentTarget, "stampUrl", "stamp")} />
            <button type="button" className="ui-btn ui-btn-sm" onClick={() => stampInput.current?.click()}>
              {brand.stampUrl ? "Změnit" : "Nahrát razítko"}
            </button>
            {brand.stampUrl && (
              <button type="button" className="ui-btn ui-btn-sm ui-btn-ghost" onClick={() => setBrand({ stampUrl: undefined })}>
                Odebrat
              </button>
            )}
          </div>
          <span style={{ fontSize: 12, color: "var(--muted)" }}>Nejlépe PNG s průhledným pozadím. Zobrazí se u prvku „Razítko / podpis“.</span>
        </div>

        <div className="br-card">
          <h3>Hlavičkový papír (PDF)</h3>
          <div className="br-preview">{brand.letterheadPdfUrl ? <span>PDF nahráno ✓</span> : <span className="none">Bez předtištěného papíru</span>}</div>
          <div className="in-actions">
            <input ref={lhInput} type="file" accept="application/pdf" hidden onChange={(e) => void upload(e.currentTarget, "letterheadPdfUrl", "letterhead")} />
            <button type="button" className="ui-btn ui-btn-sm" onClick={() => lhInput.current?.click()}>
              {brand.letterheadPdfUrl ? "Změnit" : "Nahrát PDF"}
            </button>
            {brand.letterheadPdfUrl && (
              <button type="button" className="ui-btn ui-btn-sm ui-btn-ghost" onClick={() => setBrand({ letterheadPdfUrl: undefined })}>
                Odebrat
              </button>
            )}
          </div>
          <span style={{ fontSize: 12, color: "var(--muted)" }}>Sloučí se pod každou stranu vytištěného dokumentu. V náhledu editoru se nezobrazuje.</span>
        </div>

        <div className="br-card">
          <h3>Hodnocení servisu (QR)</h3>
          <div className="in-row">
            <label>Odkaz na hodnocení</label>
            <input className="ui-input" value={brand.reviewUrl ?? ""} placeholder="https://g.page/r/…/review" onChange={(e) => setBrand({ reviewUrl: e.target.value })} />
          </div>
          <details className="br-help">
            <summary>Kde odkaz na hodnocení na Googlu vzít</summary>
            <ol>
              <li>
                Přihlaste se do Googlu účtem, který spravuje firemní profil, a otevřete{" "}
                <a href="https://business.google.com/" target="_blank" rel="noreferrer">
                  business.google.com
                </a>{" "}
                (nebo vyhledejte na Googlu název svého servisu a v přehledu profilu klikněte na „Získat další recenze“ / „Ask for reviews“).
              </li>
              <li>Zobrazí se odkaz ve tvaru <code>https://g.page/r/…/review</code>. Zkopírujte ho a vložte sem.</li>
              <li>
                Pokud odkaz nevidíte, najděte Place ID svého servisu v nástroji{" "}
                <a href="https://developers.google.com/maps/documentation/places/web-service/place-id#find-id" target="_blank" rel="noreferrer">
                  Place ID Finder
                </a>{" "}
                a vložte ho do pole níže – odkaz se sestaví sám.
              </li>
            </ol>
            <div className="in-row">
              <label>Place ID (volitelně)</label>
              <input
                className="ui-input"
                placeholder="ChIJ…"
                onChange={(e) => {
                  const id = e.target.value.trim();
                  if (id) setBrand({ reviewUrl: `https://search.google.com/local/writereview?placeid=${id}` });
                }}
              />
            </div>
            <p style={{ margin: 0 }}>Odkaz si ověřte: po otevření se má rovnou zobrazit okno pro napsání recenze.</p>
          </details>
          <div className="in-row">
            <label>Text vedle QR kódu</label>
            <input className="ui-input" value={brand.reviewText ?? DEFAULT_BRAND.reviewText ?? ""} onChange={(e) => setBrand({ reviewText: e.target.value })} />
          </div>
          <span style={{ fontSize: 12, color: "var(--muted)" }}>QR kód přidáte do dokumentu prvkem „QR kód na hodnocení“.</span>
        </div>
      </div>
      {save.status === "conflict" && <ConflictDialog onReload={onReload} onOverwrite={() => onSave({ force: true })} />}
    </div>
  );
}
