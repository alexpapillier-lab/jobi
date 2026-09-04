/**
 * Tisk dokumentů ve webové verzi – bez JobiDocs.
 *
 * Desktop posílá data do JobiDocs, ten z nich přes Electron udělá PDF a pošle
 * ho na tiskárnu. V prohlížeči nic takového není, takže HTML vyrobíme rovnou
 * tady a předáme ho tiskovému dialogu prohlížeče.
 *
 * Vzhled zůstává stejný: používá se jádro JobiDocs (`jobidocs/core`, tentýž
 * modul, ne kopie) a šablony ze Supabase – tedy to, co si servis nastavil
 * v JobiDocs. Jádro je čisté TypeScript bez Node a Electronu.
 *
 * Omezení oproti JobiDocs:
 * - Tiskový dialog se vždy zobrazí, tichý tisk v prohlížeči neexistuje.
 * - Hlavičkový papír jako PDF (`letterheadPdfUrl`) se nesloučí.
 * - „Uložit PDF“ = v dialogu zvolit cíl „Uložit jako PDF“.
 */
import { documentsFromConfig, normalizeDocuments, renderDocument, templateFor, type DocType, type DocumentsV2 } from "../../jobidocs/core/index";
import { loadDocumentsConfigRawFromDB } from "./documentSettings";
import type { DocumentData } from "./documentData";

export type WebPrintDocType = DocType;

const cache = new Map<string, { at: number; docs: DocumentsV2 }>();

/** Šablony servisu ze Supabase (krátká cache, ať se při tisku a náhledu nečte dvakrát). */
export async function loadDocumentsForWeb(serviceId: string | null): Promise<DocumentsV2> {
  const key = serviceId ?? "";
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < 15000) return hit.docs;
  const raw = await loadDocumentsConfigRawFromDB(serviceId);
  const docs = normalizeDocuments(documentsFromConfig(raw?.config ?? null));
  cache.set(key, { at: Date.now(), docs });
  return docs;
}

/** Sestaví HTML dokumentu stejně, jako to dělá JobiDocs. */
export async function buildDocumentHtmlForWeb(docType: WebPrintDocType, serviceId: string | null, data: DocumentData): Promise<string> {
  const docs = await loadDocumentsForWeb(serviceId);
  return renderDocument({ template: templateFor(docs, docType), data, brand: docs.brand, theme: docs.theme, options: { mode: "print" } });
}

/** Počká, až se v dokumentu načtou obrázky (logo, razítko, QR) a doběhne měření stránky. */
async function waitForDocument(doc: Document, timeoutMs = 6000): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (doc.documentElement.dataset.fit === "done") return;
    await new Promise((r) => setTimeout(r, 100));
  }
}

/**
 * Otevře tiskový dialog prohlížeče nad daným HTML.
 *
 * Tiskne se ze skrytého iframu, aby uživatel nepřišel o rozdělanou práci
 * ve stránce. Iframe se uklidí po zavření dialogu.
 */
export async function printHtmlInBrowser(html: string): Promise<void> {
  const iframe = document.createElement("iframe");
  iframe.setAttribute("aria-hidden", "true");
  iframe.style.position = "fixed";
  iframe.style.right = "0";
  iframe.style.bottom = "0";
  iframe.style.width = "0";
  iframe.style.height = "0";
  iframe.style.border = "0";
  iframe.style.visibility = "hidden";

  const loaded = new Promise<void>((resolve) => {
    iframe.addEventListener("load", () => resolve(), { once: true });
  });

  // POZOR na pořadí: srcdoc se musí nastavit PŘED vložením do stránky.
  // Jinak se "load" spustí už pro about:blank a tiskne se prázdná stránka.
  iframe.srcdoc = html;
  document.body.appendChild(iframe);
  await loaded;

  const win = iframe.contentWindow;
  const doc = iframe.contentDocument;
  if (!win || !doc) {
    iframe.remove();
    throw new Error("Nepodařilo se připravit tiskový náhled.");
  }

  await waitForDocument(doc);

  const cleanup = () => {
    setTimeout(() => iframe.remove(), 1000);
  };
  win.addEventListener("afterprint", cleanup, { once: true });
  setTimeout(cleanup, 60000);

  win.focus();
  win.print();
}

/** Sestaví dokument a rovnou otevře tiskový dialog. */
export async function printDocumentInBrowser(docType: WebPrintDocType, serviceId: string | null, data: DocumentData): Promise<void> {
  const html = await buildDocumentHtmlForWeb(docType, serviceId, data);
  await printHtmlInBrowser(html);
}

/**
 * Náhled dokumentu ve webu jako blob URL s HTML.
 * Volající je zodpovědný za URL.revokeObjectURL() po zavření náhledu.
 */
export async function buildDocumentPreviewUrlForWeb(docType: WebPrintDocType, serviceId: string | null, data: DocumentData): Promise<string> {
  const html = await buildDocumentHtmlForWeb(docType, serviceId, data);
  return URL.createObjectURL(new Blob([html], { type: "text/html" }));
}
