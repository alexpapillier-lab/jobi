/**
 * Převod řádků z databáze na typy stránky Zakázky (zakázka, komentář).
 * Vyneseno z Orders.tsx beze změny obsahu; `mapSupabaseTicketToTicketEx`
 * zůstává re-exportovaná z Orders.tsx (Calendar, Statistics, useOrderActions).
 */
import type { TicketComment } from "../../components/tickets";
import { jePlnyRadekZakazky } from "../../lib/sloupceZakazky";
import { mapPortalTicketFields } from "../../lib/portal";
import type { TicketEx } from "./typy";

export type SupabaseTicketCommentRow = {
  id: string;
  ticket_id: string;
  author: string;
  author_id: string | null;
  author_nickname: string | null;
  author_avatar_url: string | null;
  content: string;
  pinned: boolean;
  created_at: string;
};

export function mapSupabaseCommentRow(row: SupabaseTicketCommentRow): TicketComment {
  return {
    id: row.id,
    ticketId: row.ticket_id,
    author: row.author,
    text: row.content,
    createdAt: row.created_at,
    pinned: row.pinned,
    author_id: row.author_id,
    author_nickname: row.author_nickname,
    author_avatar_url: row.author_avatar_url,
  };
}
export function mapSupabaseTicketToTicketEx(supabaseTicket: any): TicketEx {
  const ticket: TicketEx = {
    id: supabaseTicket.id || "",
    code: (typeof supabaseTicket.code === "string" ? supabaseTicket.code : null),
    customerId: supabaseTicket.customer_id || undefined,
    customerName: supabaseTicket.customer_name || "Cloud Customer",
    customerPhone: supabaseTicket.customer_phone || undefined,
    deviceLabel: supabaseTicket.title || "Nová zakázka",
    // Jedno pole "Sériové číslo / IMEI": importované zakázky (zakazkovylist)
    // mají u telefonů jen device_imei, bez fallbacku by pole zůstalo prázdné.
    serialOrImei: supabaseTicket.device_serial || supabaseTicket.device_imei || undefined,
    issueShort: supabaseTicket.notes || "—",
    status: (supabaseTicket.status || "received") as any,
    createdAt: supabaseTicket.created_at, // DB guarantees NOT NULL with default now()
    customerEmail: supabaseTicket.customer_email || undefined,
    customerAddressStreet: supabaseTicket.customer_address_street || undefined,
    customerAddressCity: supabaseTicket.customer_address_city || undefined,
    customerAddressZip: supabaseTicket.customer_address_zip || undefined,
    customerCompany: supabaseTicket.customer_company || undefined,
    customerIco: supabaseTicket.customer_ico || undefined,
    customerInfo: supabaseTicket.customer_info || undefined,
    devicePasscode: supabaseTicket.device_passcode || undefined,
    deviceCondition: supabaseTicket.device_condition || undefined,
    deviceAccessories: (supabaseTicket as any).device_accessories || undefined,
    // Záruka a Find My z příjmu: null zůstává null („neuvedeno“), ne false.
    warrantyClaim: typeof supabaseTicket.warranty_claim === "boolean" ? supabaseTicket.warranty_claim : null,
    purchaseDate: supabaseTicket.purchase_date || undefined,
    purchaseProof: supabaseTicket.purchase_proof || undefined,
    findMyOff: typeof supabaseTicket.find_my_off === "boolean" ? supabaseTicket.find_my_off : null,
    // Záruka na opravu (datum RRRR-MM-DD); null = nevydáno / bez záruky.
    warrantyUntil: typeof supabaseTicket.warranty_until === "string" ? supabaseTicket.warranty_until : null,
    requestedRepair: supabaseTicket.notes || undefined,
    handoffMethod: supabaseTicket.handoff_method || undefined,
    handbackMethod: (supabaseTicket as any).handback_method || undefined,
    deviceNote: supabaseTicket.device_note || undefined,
    externalId: supabaseTicket.external_id || undefined,
    estimatedPrice: supabaseTicket.estimated_price || undefined,
    performedRepairs: supabaseTicket.performed_repairs || [],
    testChecklist: supabaseTicket.test_checklist || undefined,
    loaner: supabaseTicket.loaner || undefined,
    diagnosticText: supabaseTicket.diagnostic_text || undefined,
    diagnosticPhotos: supabaseTicket.diagnostic_photos || undefined,
    diagnosticPhotosBefore: supabaseTicket.diagnostic_photos_before || undefined,
    discountType: supabaseTicket.discount_type ?? null,
    discountValue: supabaseTicket.discount_value == null ? undefined : Number(supabaseTicket.discount_value),
    version: typeof supabaseTicket.version === "number" ? supabaseTicket.version : undefined,
    branchId: typeof supabaseTicket.branch_id === "string" ? supabaseTicket.branch_id : null,
    assignedTo: typeof supabaseTicket.assigned_to === "string" ? supabaseTicket.assigned_to : null,
    locationBranchId: typeof supabaseTicket.location_branch_id === "string" ? supabaseTicket.location_branch_id : null,
    transitShipmentId: typeof supabaseTicket.transit_shipment_id === "string" ? supabaseTicket.transit_shipment_id : null,
    updatedAt: typeof supabaseTicket.updated_at === "string" ? supabaseTicket.updated_at : null,
    // Pozná se to z řádku samotného, ne z volajícího: realtime, insert i
    // uložení vracejí celý řádek, seznam jen svoji úzkou sadu sloupců.
    uplna: jePlnyRadekZakazky(supabaseTicket),
    // Portálové sloupce: v hlavních selectech nejsou (migrace může chybět), přijdou z realtime nebo z PortalCard.
    ...mapPortalTicketFields(supabaseTicket),
  };
  (ticket as any).service_id = supabaseTicket.service_id;
  (ticket as any).expected_completion_at = supabaseTicket.expected_completion_at ?? null;
  (ticket as any).completed_at = supabaseTicket.completed_at ?? null;
  return ticket;
}
