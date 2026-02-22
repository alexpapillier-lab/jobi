import { useCallback } from "react";
import { supabase } from "../../../lib/supabaseClient";
import { showToast } from "../../../components/Toast";
import type { TicketEx } from "../../Orders";
import type { Database } from "../../../types/supabase";

export type WarrantyClaimRow = Database["public"]["Tables"]["warranty_claims"]["Row"];
export type WarrantyClaimInsert = Database["public"]["Tables"]["warranty_claims"]["Insert"];

/** Generate next warranty claim code: R + YY + 6 digits (e.g. R25000001) */
async function makeWarrantyClaimCode(
  existingClaims: { code: string | null }[],
  activeServiceId: string | null
): Promise<string> {
  if (!activeServiceId) return "R25000001";
  const year = new Date().getFullYear().toString().slice(-2);
  const prefix = `R${year}`;
  let existingCodes: string[] = existingClaims
    .map((c) => c.code || "")
    .filter((code) => code.startsWith(prefix));
  if (existingCodes.length === 0 && supabase) {
    const { data } = await (supabase
      .from("warranty_claims") as any)
      .select("code")
      .eq("service_id", activeServiceId)
      .like("code", `${prefix}%`)
      .order("code", { ascending: false })
      .limit(100);
    if (data?.length) {
      existingCodes = data.map((r: any) => r.code || "").filter((c: string) => c.startsWith(prefix));
    }
  }
  const existingNumbers = existingCodes
    .map((code) => {
      const num = parseInt(code.slice(-6), 10);
      return isNaN(num) ? 0 : num;
    })
    .filter((n) => n > 0);
  const next = existingNumbers.length > 0 ? Math.max(...existingNumbers) + 1 : 1;
  return `${prefix}${String(next).padStart(6, "0")}`;
}

/** Copy ticket customer/device fields into warranty claim payload */
function ticketToClaimPayload(
  ticket: TicketEx,
  serviceId: string,
  code: string,
  status: string,
  notes: string
): WarrantyClaimInsert {
  return {
    service_id: serviceId,
    source_ticket_id: ticket.id,
    code,
    status,
    notes: notes.trim() || "",
    customer_id: ticket.customerId ?? null,
    customer_name: ticket.customerName ?? null,
    customer_phone: ticket.customerPhone ?? null,
    customer_email: ticket.customerEmail ?? null,
    customer_address_street: ticket.customerAddressStreet ?? null,
    customer_address_city: ticket.customerAddressCity ?? null,
    customer_address_zip: ticket.customerAddressZip ?? null,
    customer_address_country: (ticket as any).customerAddressCountry ?? null,
    customer_company: ticket.customerCompany ?? null,
    customer_ico: ticket.customerIco ?? null,
    customer_info: ticket.customerInfo ?? null,
    device_condition: ticket.deviceCondition ?? null,
    device_accessories: ticket.deviceAccessories ?? null,
    device_note: ticket.deviceNote ?? null,
    device_label: ticket.deviceLabel ?? null,
    device_brand: (ticket as any).deviceBrand ?? null,
    device_model: (ticket as any).deviceModel ?? null,
    device_serial: ticket.serialOrImei ?? null,
    device_imei: (ticket as any).deviceImei ?? null,
    device_passcode: ticket.devicePasscode ?? null,
  };
}

export function useWarrantyClaims(activeServiceId: string | null) {
  const createFromTicket = useCallback(
    async (
      ticket: TicketEx,
      statusKey: string,
      notes: string,
      existingClaims: { code: string | null }[],
      overrides?: Partial<WarrantyClaimInsert>
    ): Promise<WarrantyClaimRow | null> => {
      if (!activeServiceId || !supabase) {
        showToast("Chybí aktivní servis nebo připojení.", "error");
        return null;
      }
      const code = await makeWarrantyClaimCode(existingClaims, activeServiceId);
      const base = ticketToClaimPayload(ticket, activeServiceId, code, statusKey, notes);
      const payload: WarrantyClaimInsert = { ...base, ...overrides };
      const { data, error } = await (supabase.from("warranty_claims") as any)
        .insert(payload)
        .select()
        .single();
      if (error) {
        showToast(`Chyba při vytváření reklamace: ${error.message}`, "error");
        return null;
      }
      // Log to ticket_history so original ticket shows "založena reklamace R-xxx" (only if we still have source_ticket_id)
      if (ticket.id) {
        await (supabase.from("ticket_history") as any).insert({
        ticket_id: ticket.id,
        service_id: activeServiceId,
        action: "warranty_claim_created",
        changed_by: (await supabase.auth.getUser()).data.user?.id ?? null,
        details: { warranty_claim_id: data.id, warranty_claim_code: data.code },
        });
      }
      showToast(`Reklamace ${data.code} vytvořena`, "success");
      return data as WarrantyClaimRow;
    },
    [activeServiceId]
  );

  const createWithoutTicket = useCallback(
    async (
      statusKey: string,
      notes: string,
      customerDevice: Partial<WarrantyClaimInsert>,
      existingClaims: { code: string | null }[]
    ): Promise<WarrantyClaimRow | null> => {
      if (!activeServiceId || !supabase) {
        showToast("Chybí aktivní servis nebo připojení.", "error");
        return null;
      }
      const code = await makeWarrantyClaimCode(existingClaims, activeServiceId);
      const payload: WarrantyClaimInsert = {
        service_id: activeServiceId,
        source_ticket_id: null,
        code,
        status: statusKey,
        notes: notes.trim() || "",
        ...customerDevice,
      };
      const { data, error } = await (supabase.from("warranty_claims") as any)
        .insert(payload)
        .select()
        .single();
      if (error) {
        showToast(`Chyba při vytváření reklamace: ${error.message}`, "error");
        return null;
      }
      showToast(`Reklamace ${data.code} vytvořena`, "success");
      return data as WarrantyClaimRow;
    },
    [activeServiceId]
  );

  const updateClaimStatus = useCallback(
    async (claimId: string, newStatusKey: string): Promise<boolean> => {
      if (!supabase) {
        showToast("Chybí připojení.", "error");
        return false;
      }
      const { error } = await (supabase.from("warranty_claims") as any)
        .update({ status: newStatusKey })
        .eq("id", claimId);
      if (error) {
        showToast(`Chyba při změně statusu reklamace: ${error.message}`, "error");
        return false;
      }
      return true;
    },
    []
  );

  type ClaimUpdate = Database["public"]["Tables"]["warranty_claims"]["Update"];
  const updateClaim = useCallback(
    async (claimId: string, payload: ClaimUpdate): Promise<WarrantyClaimRow | null> => {
      if (!supabase) {
        showToast("Chybí připojení.", "error");
        return null;
      }
      const { data, error } = await (supabase.from("warranty_claims") as any)
        .update(payload)
        .eq("id", claimId)
        .select()
        .single();
      if (error) {
        showToast(`Chyba při úpravě reklamace: ${error.message}`, "error");
        return null;
      }
      showToast("Reklamace upravena", "success");
      return data as WarrantyClaimRow;
    },
    []
  );

  const deleteClaim = useCallback(
    async (claimId: string): Promise<boolean> => {
      if (!supabase) {
        showToast("Chybí připojení.", "error");
        return false;
      }
      const { error } = await (supabase.from("warranty_claims") as any).delete().eq("id", claimId);
      if (error) {
        showToast(`Chyba při mazání reklamace: ${error.message}`, "error");
        return false;
      }
      showToast("Reklamace smazána", "success");
      return true;
    },
    []
  );

  return { createFromTicket, createWithoutTicket, makeWarrantyClaimCode, updateClaimStatus, updateClaim, deleteClaim };
}
