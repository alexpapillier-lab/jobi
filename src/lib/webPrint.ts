/**
 * Tisk dokumentů ve webové verzi – bez JobiDocs.
 *
 * Desktop posílá data do JobiDocs, ten z nich přes Electron udělá PDF a pošle
 * ho na tiskárnu. V prohlížeči nic takového není, takže HTML vyrobíme rovnou
 * tady a předáme ho tiskovému dialogu prohlížeče.
 *
 * Vzhled zůstává stejný: používá se `generateDocumentHtml` z JobiDocs (tentýž
 * modul, ne kopie) a konfigurace ze Supabase – tedy to, co si servis nastavil
 * v JobiDocs. Modul je čisté TypeScript bez Node a Electronu, takže v prohlížeči
 * běží beze změny.
 *
 * Omezení oproti JobiDocs:
 * - Tiskový dialog se vždy zobrazí, tichý tisk v prohlížeči neexistuje.
 * - Hlavičkový papír jako PDF (`letterheadPdfUrl`) se nesloučí – JobiDocs to
 *   dělá přes pdf-lib nad hotovým PDF, což tudy nejde.
 * - "Uložit PDF" = v dialogu zvolit cíl "Uložit jako PDF".
 */
import { generateDocumentHtml } from "../../jobidocs/src/documentToHtml";
import { getConfigWithProfile } from "./documentHelpers";
import { safeLoadCompanyData } from "./companyData";

/** Typy dokumentů, které umí generátor JobiDocs. */
export type WebPrintDocType =
  | "zakazkovy_list"
  | "zarucni_list"
  | "diagnosticky_protokol"
  | "prijemka_reklamace"
  | "vydejka_reklamace"
  | "faktura";

/** Doc typy, pro které Jobi umí načíst konfiguraci i s profilem. */
type ConfigDocType = "zakazkovy_list" | "zarucni_list" | "diagnosticky_protokol";

function configDocTypeFor(docType: WebPrintDocType): ConfigDocType {
  // Reklamační dokumenty sdílejí nastavení se zakázkovým listem.
  if (docType === "zakazkovy_list" || docType === "zarucni_list" || docType === "diagnosticky_protokol") {
    return docType;
  }
  return "zakazkovy_list";
}

/**
 * Sestaví HTML dokumentu stejně, jako to dělá JobiDocs na serveru.
 */
export async function buildDocumentHtmlForWeb(
  docType: WebPrintDocType,
  serviceId: string | null,
  options?: { repairDate?: string; variables?: Record<string, string> }
): Promise<string> {
  const config = await getConfigWithProfile(serviceId, configDocTypeFor(docType));
  const companyData = safeLoadCompanyData() as unknown as Record<string, unknown>;

  const opts: { repairDate?: string; variables?: Record<string, string>; useSampleFallbacks?: boolean } = {};
  if (options?.repairDate) opts.repairDate = options.repairDate;
  if (options?.variables) {
    opts.variables = options.variables;
    // Stejně jako v JobiDocs: s reálnými hodnotami nechceme ukázkové výplně.
    opts.useSampleFallbacks = false;
  }

  return generateDocumentHtml(
    config as Record<string, unknown>,
    docType,
    companyData,
    undefined,
    Object.keys(opts).length ? opts : undefined
  );
}

/** Počká, až se v dokumentu načtou obrázky (logo, razítko, QR). */
async function waitForImages(doc: Document, timeoutMs = 5000): Promise<void> {
  const imgs = Array.from(doc.images || []);
  if (imgs.length === 0) return;
  const pending = imgs.map(
    (img) =>
      new Promise<void>((resolve) => {
        if (img.complete) return resolve();
        img.addEventListener("load", () => resolve(), { once: true });
        img.addEventListener("error", () => resolve(), { once: true });
      })
  );
  await Promise.race([
    Promise.all(pending).then(() => undefined),
    new Promise<void>((r) => setTimeout(r, timeoutMs)),
  ]);
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
  // Jinak se "load" spustí už pro about:blank, čekání skončí předčasně
  // a tiskne se prázdná stránka. Ověřeno v prohlížeči: při opačném pořadí
  // má iframe 3 elementy bez stylů, při správném 24 elementů včetně stylů.
  iframe.srcdoc = html;
  document.body.appendChild(iframe);
  await loaded;

  const win = iframe.contentWindow;
  const doc = iframe.contentDocument;
  if (!win || !doc) {
    iframe.remove();
    throw new Error("Nepodařilo se připravit tiskový náhled.");
  }

  await waitForImages(doc);

  const cleanup = () => {
    // Odklad, ať se stihne otevřít dialog i v prohlížečích, kde print() nečeká.
    setTimeout(() => iframe.remove(), 1000);
  };
  win.addEventListener("afterprint", cleanup, { once: true });
  // Pojistka, kdyby afterprint nepřišel (Safari ho neposílá spolehlivě).
  setTimeout(cleanup, 60000);

  win.focus();
  win.print();
}

/** Sestaví dokument a rovnou otevře tiskový dialog. */
export async function printDocumentInBrowser(
  docType: WebPrintDocType,
  serviceId: string | null,
  options?: { repairDate?: string; variables?: Record<string, string> }
): Promise<void> {
  const html = await buildDocumentHtmlForWeb(docType, serviceId, options);
  await printHtmlInBrowser(html);
}

/**
 * Náhled dokumentu ve webu.
 *
 * Desktop si nechá od JobiDocs vyrobit PDF a ukáže ho jako blob. V prohlížeči
 * PDF nevyrábíme, takže se do stejného iframu vloží rovnou HTML – vypadá to
 * stejně a je to rychlejší.
 *
 * Volající je zodpovědný za URL.revokeObjectURL() po zavření náhledu,
 * stejně jako u PDF blobu.
 */
export async function buildDocumentPreviewUrlForWeb(
  docType: WebPrintDocType,
  serviceId: string | null,
  options?: { repairDate?: string; variables?: Record<string, string> }
): Promise<string> {
  const html = await buildDocumentHtmlForWeb(docType, serviceId, options);
  return URL.createObjectURL(new Blob([html], { type: "text/html" }));
}
