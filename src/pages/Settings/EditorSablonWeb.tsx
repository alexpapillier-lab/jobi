/**
 * Editor šablon dokumentů ve webové verzi Jobi.
 *
 * Vykresluje tentýž editor jako desktopový JobiDocs (jobidocs/src/editor,
 * sdílený kód, ne kopie) přes celé okno, protože potřebuje šířku: osnova,
 * dokument a vlastnosti vedle sebe. Data jdou přímo do Supabase přes
 * webové úložiště (lib/sablonyDokumentuWeb.ts) pod přihlášeným uživatelem.
 *
 * Proti JobiDocs tu chybí jen to, co v prohlížeči nemá smysl: výběr
 * tiskárny, profily tiskáren, automatický tisk (ten je v Nastavení → JobiDocs
 * a automatický tisk) a Aktivity místního serveru. Zkušební tisk otevře
 * tiskový dialog prohlížeče, Uložit PDF stáhne PDF ze serveru (nebo poradí
 * dialog).
 *
 * Načítá se líně (React.lazy) – editor a jeho styly se stáhnou, až když
 * ho někdo otevře.
 */
import "../../../jobidocs/src/styles/editorPanels.css";
import "./editorSablonWeb.css";
import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { DocumentEditor } from "../../../jobidocs/src/editor/DocumentEditor";
import { BrandPage } from "../../../jobidocs/src/pages/BrandPage";
import { useDocuments } from "../../../jobidocs/src/state/useDocuments";
import { DocumentsStorageContext } from "../../../jobidocs/src/storage/context";
import { showToast } from "../../components/Toast";
import { useIsNarrow } from "../../hooks/useIsNarrow";
import { safeLoadCompanyData } from "../../lib/companyData";
import { vytvorPdfNaServeru } from "../../lib/pdfServer";
import { fotkyDoDokumentu } from "../../lib/podepsaneFotky";
import { vytvorWeboveUloziste, type KlientSablon } from "../../lib/sablonyDokumentuWeb";
import { stahnoutSoubor } from "../../lib/stahnoutSoubor";
import { supabase } from "../../lib/supabaseClient";
import { printHtmlInBrowser, zapomenSablonyProWeb } from "../../lib/webPrint";

export type EditorSablonWebProps = {
  serviceId: string;
  serviceName: string;
  /** Majitel, správce nebo člen s oprávněním Dokumenty. Bez něj jen náhled. */
  canManage: boolean;
  onClose: () => void;
};

type Zalozka = "dokumenty" | "znacka";

export default function EditorSablonWeb(p: EditorSablonWebProps) {
  const { serviceId, serviceName, canManage } = p;
  const storage = useMemo(() => {
    if (!supabase) return null;
    const klient = supabase;
    return vytvorWeboveUloziste({
      klient: klient as unknown as KlientSablon,
      services: [{ service_id: serviceId, service_name: serviceName, role: "" }],
      activeServiceId: serviceId,
      companyData: () => safeLoadCompanyData() as unknown as Record<string, unknown>,
      canManage,
      tiskHtml: printHtmlInBrowser,
      pdfZeServeru: vytvorPdfNaServeru,
      stahnout: (pdf, nazev) => stahnoutSoubor(pdf, nazev, "application/pdf"),
      pripravFotky: async (data) => (data.photos && data.photos.length > 0 ? { ...data, photos: await fotkyDoDokumentu(klient, data.photos) } : data),
      hlaska: showToast,
      poUlozeni: zapomenSablonyProWeb,
    });
  }, [serviceId, serviceName, canManage]);

  return createPortal(
    storage ? (
      <DocumentsStorageContext.Provider value={storage}>
        <ObsahEditoru {...p} />
      </DocumentsStorageContext.Provider>
    ) : (
      <Ram nazev={serviceName} onClose={p.onClose}>
        <div className="jd-web-zprava">Webová verze nemá spojení s databází. Obnovte stránku a přihlaste se znovu.</div>
      </Ram>
    ),
    document.body,
  );
}

function Ram({ nazev, onClose, children, zalozky }: { nazev: string; onClose: () => void; children: ReactNode; zalozky?: ReactNode }) {
  return (
    <div className="jd-web" role="dialog" aria-modal="true" aria-label="Šablony dokumentů" data-tour="sablony-editor">
      <header className="jd-web-hlavicka">
        <div className="jd-web-nazev">
          <b>Šablony dokumentů</b>
          <span>{nazev}</span>
        </div>
        {zalozky}
        <span className="spacer" />
        <span className="jd-web-pozn">Tisk bez dialogu rovnou na tiskárnu umí jen JobiDocs na počítači; tady se tiskne přes dialog prohlížeče.</span>
        <button type="button" className="ui-btn ui-btn-sm" onClick={onClose} data-tour="sablony-zavrit">
          Zavřít
        </button>
      </header>
      <main className="jd-web-obsah">{children}</main>
    </div>
  );
}

function ObsahEditoru({ serviceId, serviceName, canManage, onClose }: EditorSablonWebProps) {
  const uzky = useIsNarrow();
  const [zalozka, setZalozka] = useState<Zalozka>("dokumenty");
  const [ptatSe, setPtatSe] = useState(false);
  const docsState = useDocuments(serviceId);
  const { dirty } = docsState;
  // Údaje firmy pro náhled – stejné, jaké jdou do tisku ze zakázky.
  const [companyData] = useState(() => safeLoadCompanyData() as unknown as Record<string, unknown>);
  const smiMenit = docsState.loaded?.canManage ?? canManage;

  // Klávesové zkratky Jobi (T = Dnes…) by při psaní mimo pole přepnuly
  // stránku pod editorem; stránka pod překryvem se nemá posouvat.
  useEffect(() => {
    const body = document.body;
    const predtim = body.style.overflow;
    body.dataset.jobsheetShortcutsConfig = "true";
    body.style.overflow = "hidden";
    return () => {
      delete body.dataset.jobsheetShortcutsConfig;
      body.style.overflow = predtim;
    };
  }, []);

  // Zavření karty prohlížeče s neuloženými změnami – prohlížeč se zeptá.
  // (Rozpracovaná verze se i tak průběžně zálohuje a nabídne se po návratu.)
  useEffect(() => {
    if (!dirty) return;
    const varuj = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", varuj);
    return () => window.removeEventListener("beforeunload", varuj);
  }, [dirty]);

  const zavrit = () => {
    if (dirty) setPtatSe(true);
    else onClose();
  };

  const toast = useCallback((msg: string, kind: "ok" | "error" = "ok") => showToast(msg, kind === "error" ? "error" : "success"), []);

  const zalozky = (
    <div className="jd-web-zalozky" role="tablist" aria-label="Části editoru">
      <button type="button" role="tab" aria-selected={zalozka === "dokumenty"} onClick={() => setZalozka("dokumenty")} data-tour="sablony-zalozka-dokumenty">
        Dokumenty
      </button>
      <button type="button" role="tab" aria-selected={zalozka === "znacka"} onClick={() => setZalozka("znacka")} data-tour="sablony-zalozka-znacka">
        Značka
      </button>
    </div>
  );

  let obsah: ReactNode;
  if (uzky) {
    obsah = (
      <div className="jd-web-zprava">
        <b>Šablony upravujte na počítači nebo tabletu.</b>
        <p>Editor potřebuje vedle sebe osnovu, dokument a vlastnosti – na telefonu se nevejdou. Tisknout z telefonu jde dál normálně.</p>
      </div>
    );
  } else if (!docsState.docs) {
    obsah = (
      <div className="jd-web-zprava">
        {docsState.loadError ? (
          <>
            <b>Šablony se nepodařilo načíst.</b>
            <p>{docsState.loadError}</p>
            <button type="button" className="ui-btn ui-btn-primary" onClick={() => void docsState.reload()}>
              Zkusit znovu
            </button>
          </>
        ) : (
          "Načítám šablony…"
        )}
      </div>
    );
  } else if (zalozka === "dokumenty") {
    obsah = (
      <DocumentEditor
        serviceId={serviceId}
        companyData={companyData}
        docs={docsState.docs}
        setDocs={docsState.setDocs}
        dirty={dirty}
        save={docsState.save}
        onSave={docsState.persist}
        onReload={docsState.reload}
        canManage={smiMenit}
        undo={docsState.undo}
        redo={docsState.redo}
        canUndo={docsState.canUndo}
        canRedo={docsState.canRedo}
        onToast={toast}
        lastSaved={docsState.loaded ? { version: docsState.loaded.version, updated_at: docsState.loaded.updated_at, source: docsState.loaded.source } : null}
        draft={docsState.draft}
        onRestoreDraft={docsState.restoreDraft}
        onDiscardDraft={docsState.discardDraft}
      />
    );
  } else {
    obsah = (
      <div className="jd-web-znacka">
        <BrandPage docs={docsState.docs} setDocs={docsState.setDocs} dirty={dirty} save={docsState.save} onSave={docsState.persist} onReload={docsState.reload} canManage={smiMenit} companyData={companyData} />
      </div>
    );
  }

  return (
    <Ram nazev={serviceName} onClose={zavrit} zalozky={uzky ? undefined : zalozky}>
      {obsah}
      {ptatSe && (
        <div className="dlg-backdrop" onClick={() => setPtatSe(false)}>
          <div className="dlg" role="alertdialog" aria-labelledby="jd-web-neulozeno" onClick={(e) => e.stopPropagation()}>
            <h3 id="jd-web-neulozeno">Neuložené změny</h3>
            <p>V šablonách máte neuložené změny. Chcete je před zavřením uložit?</p>
            <div className="actions">
              <button type="button" className="ui-btn" onClick={() => setPtatSe(false)}>
                Zůstat
              </button>
              <button type="button" className="ui-btn ui-btn-ghost" onClick={onClose}>
                Zavřít bez uložení
              </button>
              <button
                type="button"
                className="ui-btn ui-btn-primary"
                disabled={!smiMenit}
                onClick={async () => {
                  setPtatSe(false);
                  if (await docsState.persist()) onClose();
                }}
              >
                Uložit a zavřít
              </button>
            </div>
          </div>
        </div>
      )}
    </Ram>
  );
}
