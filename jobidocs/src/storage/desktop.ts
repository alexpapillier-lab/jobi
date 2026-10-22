/**
 * Desktopové úložiště: místní server JobiDocs (Electron) přes `api.ts`.
 *
 * Jen obal nad tím, co editor dělal dřív přímo – chování desktopu se tím
 * nemění: stejné požadavky, stejné hlášky, obrázky značky jako data: URL
 * (do Storage je při uložení přesouvá server, viz api/documentsStore.ts).
 */
import { api, electron } from "../api";
import type { BrandAssetKind, DocumentsStorage, PrintRequest } from "./types";

/** Soubor → data: URL. Obrázek se zmenší na nejvýš `maxPx` a uloží jako PNG, PDF zůstane, jak je. */
export async function fileToDataUrl(file: File, maxPx = 1200): Promise<string> {
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

/** Tělo požadavku na místní server – ukázková data si server dosadí sám. */
function renderBody(req: PrintRequest) {
  return { service_id: req.serviceId, doc_type: req.docType, documents: req.documents, ...(req.data ? { data: req.data } : { sample: req.sample }) };
}

export const desktopStorage: DocumentsStorage = {
  kind: "desktop",
  context: () => api.context(),
  load: (serviceId) => api.documents(serviceId),
  save: (serviceId, documents, ifVersion) => api.saveDocuments(serviceId, documents, ifVersion),
  prepareBrandAsset: (file: File, _kind: BrandAssetKind) => fileToDataUrl(file),
  recent: async (serviceId, docType) => (await api.recent(serviceId, docType)).items,
  async testPrint(req) {
    const r = await api.print(renderBody(req));
    return `Zkušební tisk odeslán na tiskárnu ${r.printer ?? ""}`.trim();
  },
  async savePdf(req) {
    const bridge = electron();
    if (bridge) {
      const path = await bridge.showSaveDialog(`${req.docType}-ukazka.pdf`);
      if (!path) return null;
      await api.exportPdf({ ...renderBody(req), target_path: path });
      return `PDF uloženo: ${path}`;
    }
    const blob = await api.pdf(renderBody(req));
    window.open(URL.createObjectURL(blob), "_blank");
    return null;
  },
};
