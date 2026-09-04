/**
 * Značka: vzhled dokumentů (galerie motivů), logo, razítko, hlavičkový papír,
 * odkaz na hodnocení. Platí pro všechny dokumenty servisu; ukládá se spolu
 * se šablonami.
 */
import { useLayoutEffect, useMemo, useRef, useState } from "react";
import { DEFAULT_BRAND, THEME_PRESETS, defaultTemplate, renderDocument, sampleData, serviceFromCompanyData, type Brand, type DocumentsV2, type Theme } from "../../core/index";
import type { SaveState } from "../state/useDocuments";

type Props = {
  docs: DocumentsV2;
  setDocs: (u: (d: DocumentsV2) => DocumentsV2) => void;
  dirty: boolean;
  save: SaveState;
  onSave: () => Promise<boolean>;
  canManage: boolean;
  companyData: Record<string, unknown> | null;
};

const ACCENTS = ["#0e7c86", "#2563eb", "#1f4e79", "#3c9d40", "#7c3aed", "#db2777", "#ea580c", "#b45309", "#334155", "#111111"];

async function fileToDataUrl(file: File, maxPx = 1200): Promise<string> {
  if (file.type === "application/pdf") {
    return new Promise((res, rej) => {
      const r = new FileReader();
      r.onload = () => res(String(r.result));
      r.onerror = rej;
      r.readAsDataURL(file);
    });
  }
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, maxPx / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext("2d")!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL("image/png");
}

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

export function BrandPage({ docs, setDocs, dirty, save, onSave, canManage, companyData }: Props) {
  const setBrand = (patch: Partial<Brand>) => setDocs((d) => ({ ...d, brand: { ...d.brand, ...patch } }));
  const setTheme = (patch: Partial<Theme>) => setDocs((d) => ({ ...d, theme: { ...d.theme, ...patch } }));
  const logoInput = useRef<HTMLInputElement>(null);
  const stampInput = useRef<HTMLInputElement>(null);
  const lhInput = useRef<HTMLInputElement>(null);

  const upload = async (file: File | undefined, key: keyof Brand) => {
    if (!file) return;
    const url = await fileToDataUrl(file);
    setBrand({ [key]: url } as Partial<Brand>);
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
        <div className="br-card">
          <h3>Logo</h3>
          <div className="br-preview">{brand.logoUrl ? <img src={brand.logoUrl} alt="Logo" /> : <span className="none">Bez loga</span>}</div>
          <div className="in-actions">
            <input ref={logoInput} type="file" accept="image/*" hidden onChange={(e) => void upload(e.target.files?.[0], "logoUrl")} />
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
            <input ref={stampInput} type="file" accept="image/*" hidden onChange={(e) => void upload(e.target.files?.[0], "stampUrl")} />
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
            <input ref={lhInput} type="file" accept="application/pdf" hidden onChange={(e) => void upload(e.target.files?.[0], "letterheadPdfUrl")} />
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
    </div>
  );
}
