/**
 * Tisk a export dokumentů zakázky (zakázkový list, záruční list, diagnostický
 * protokol, smlouva o zápůjčce). Vyneseno z Orders.tsx beze změny obsahu.
 */
import { isJobiDocsRunning, printDocument, exportDocument, type DocTypeForPrint } from "../../lib/jobidocs";
import { ticketDocumentData, type DocumentData } from "../../lib/documentData";
import { showToast, showPersistentToast } from "../../components/Toast";
import { supabase } from "../../lib/supabaseClient";
import { fotkyDoDokumentu } from "../../lib/podepsaneFotky";
import { isWeb } from "../../lib/platform";
import { companyDataForBranch, getCachedBranch } from "../../lib/branches";
import { printDocumentInBrowser, type WebPrintDocType } from "../../lib/webPrint";
import { stahnoutDokumentJakoPdf } from "../../lib/pdfServer";
import { spustDesktopovyDokument, spustWebovyDokument, type ZavislostiDokumentu } from "../../lib/tiskDokumentu";
import { safeLoadCompanyData } from "../../lib/companyData";
import { trackDocumentAction } from "../../lib/documentTelemetry";
import { ensurePortalToken } from "../../lib/portal";
import { zarucniDobaProTisk } from "../../lib/documentHelpers";
import type { TicketEx } from "./typy";

// Tisk a export PDF probíhají přes JobiDocs (localhost:3847); ve webové verzi přes tiskový dialog prohlížeče.
// Jobi posílá typovaná data dokumentu, šablonu i formátování drží JobiDocs.

export type DocMode = "print" | "export";

export function ticketDocData(ticket: TicketEx, docType: DocTypeForPrint): DocumentData {
  const t = ticket as TicketEx & { completed_at?: string | null };
  const completedAt = t.completed_at ?? (docType === "zarucni_list" ? new Date().toISOString() : undefined);
  const serviceId = (ticket as any).service_id as string | null | undefined;
  // Adresa, telefon a e-mail pobočky mají na dokumentu přednost před firemními.
  const branch = getCachedBranch(serviceId, ticket.branchId);
  // Délku záruky si servis nastavuje v dokumentech, ne u zakázky. Bez ní
  // zůstávala na záručním listu ve větě „poskytuje servis záruku … měsíců“
  // díra místo čísla.
  const zaruka = zarucniDobaProTisk(serviceId);
  return ticketDocumentData(ticket, companyDataForBranch(safeLoadCompanyData(), branch), {
    completedAt,
    warrantyMonths: zaruka?.months,
    warrantyDays: zaruka?.days,
  });
}

/**
 * Skutečné napojení na okolí (JobiDocs, nativní dialog, hlášky).
 * Vlastní logika je v src/lib/tiskDokumentu.ts, aby šla otestovat – tady
 * zůstává jen to, co se v testu stejně nahradit nedá.
 */
export const zavislostiDokumentu: ZavislostiDokumentu = {
  jobiDocsBezi: isJobiDocsRunning,
  tisk: printDocument,
  exportPdf: exportDocument,
  vyberCilovySoubor: async (vychoziNazev) => {
    const { save } = await import("@tauri-apps/plugin-dialog");
    return save({
      defaultPath: vychoziNazev,
      filters: [{ name: "PDF", extensions: ["pdf"] }, { name: "All Files", extensions: ["*"] }],
    });
  },
  tiskVProhlizeci: (docType, sid, data) => printDocumentInBrowser(docType as WebPrintDocType, sid, data),
  exportPdfVProhlizeci: (docType, sid, data) => stahnoutDokumentJakoPdf(docType as WebPrintDocType, sid, data),
  pripravFotky: async (data) => {
    if (!data.photos || data.photos.length === 0) return data;
    return { ...data, photos: await fotkyDoDokumentu(supabase, data.photos) };
  },
  hlaska: showToast,
  hotovyExport: showExportSuccessToast,
  telemetrie: trackDocumentAction,
  ted: () => performance.now(),
};

export async function runWebDocument(mode: DocMode, docType: DocTypeForPrint, sid: string, data: DocumentData) {
  return spustWebovyDokument(mode, docType, sid, data, zavislostiDokumentu);
}

export async function runDesktopDocument(mode: DocMode, docType: DocTypeForPrint, sid: string, data: DocumentData, defaultFileName: string) {
  return spustDesktopovyDokument(mode, docType, sid, data, defaultFileName, zavislostiDokumentu);
}

export const TICKET_DOC_FILE_PREFIX: Partial<Record<DocTypeForPrint, string>> = {
  zakazkovy_list: "zakazka",
  zarucni_list: "zarucni-list",
  diagnosticky_protokol: "diagnostika",
  smlouva_zapujcka: "zapujcka",
};

export async function runTicketDocument(mode: DocMode, docType: DocTypeForPrint, ticket: TicketEx, serviceId?: string | null) {
  const sid = serviceId ?? undefined;
  if (!sid) {
    showToast(mode === "print" ? "Vyberte servis pro tisk." : "Vyberte servis pro export.", "error");
    return;
  }
  // Odkaz na zákaznický portál do dokumentu (QR „Stav zakázky online“ v JobiDocs).
  // Token vzniká při prvním tisku; když RPC selže (starší server), tiskne se bez něj.
  let withToken = ticket;
  if (!ticket.portalToken) {
    try {
      const token = await ensurePortalToken(ticket.id);
      withToken = { ...ticket, portalToken: token };
    } catch {
      /* bez portálu */
    }
  }
  const data = ticketDocData(withToken, docType);
  if (isWeb()) return runWebDocument(mode, docType, sid, data);
  return runDesktopDocument(mode, docType, sid, data, `${TICKET_DOC_FILE_PREFIX[docType] ?? docType}-${ticket.code}.pdf`);
}

export async function exportTicketToPDF(ticket: TicketEx, serviceId?: string | null) {
  return runTicketDocument("export", "zakazkovy_list", ticket, serviceId);
}

export async function printTicket(ticket: TicketEx, serviceId?: string | null) {
  return runTicketDocument("print", "zakazkovy_list", ticket, serviceId);
}

export async function exportDiagnosticProtocolToPDF(ticket: TicketEx, serviceId?: string | null) {
  return runTicketDocument("export", "diagnosticky_protokol", ticket, serviceId);
}

export async function printDiagnosticProtocol(ticket: TicketEx, serviceId?: string | null) {
  return runTicketDocument("print", "diagnosticky_protokol", ticket, serviceId);
}

export async function printZapujcku(ticket: TicketEx, serviceId?: string | null) {
  return runTicketDocument("print", "smlouva_zapujcka", ticket, serviceId);
}

export async function exportZapujckuToPDF(ticket: TicketEx, serviceId?: string | null) {
  return runTicketDocument("export", "smlouva_zapujcka", ticket, serviceId);
}

export async function exportWarrantyToPDF(ticket: TicketEx, serviceId?: string | null) {
  return runTicketDocument("export", "zarucni_list", ticket, serviceId);
}

export async function printWarranty(ticket: TicketEx, serviceId?: string | null) {
  return runTicketDocument("print", "zarucni_list", ticket, serviceId);
}

export function showExportSuccessToast(filePath: string) {
  const shortPath = filePath.replace(/^.*[/\\]/, "");
  // Ve webu soubor jen spadne do složky Stažené – není co otevírat ve Finderu.
  if (isWeb()) {
    showToast(`PDF uložen: ${shortPath}`, "success");
    return;
  }
  showPersistentToast(`PDF uložen: ${shortPath}`, "success", {
    actionLabel: "Otevřít složku",
    onAction: async () => {
      try {
        const { revealItemInDir } = await import("@tauri-apps/plugin-opener");
        await revealItemInDir(filePath);
      } catch (err) {
        showToast("Nelze otevřít složku: " + (err instanceof Error ? err.message : String(err)), "error");
      }
    },
  });
}

export async function quickPrintFromList(
  ticket: TicketEx,
  docType: "ticket" | "diagnostic" | "warranty",
  serviceId: string | null
) {
  if (docType === "ticket") await printTicket(ticket, serviceId);
  else if (docType === "diagnostic") await printDiagnosticProtocol(ticket, serviceId);
  else await printWarranty(ticket, serviceId);
}
