import { useCallback } from "react";
import { supabase, resetTauriFetchState } from "../../../lib/supabaseClient";
import { devLog, devWarn } from "../../../lib/devLog";
import { normalizePhone } from "../../../lib/phone";
import { showToast } from "../../../components/Toast";
import { checkAchievementsOnTicketsChanged, checkAchievementsOnCustomersChanged } from "../../../lib/achievements";
import { addWatermarkToImageBlob } from "../../../lib/diagnosticPhotoWatermark";
import { uploadDiagnosticPhoto } from "../../../lib/diagnosticPhotosStorage";
import { mapSupabaseTicketToTicketEx, type TicketEx } from "../../Orders";

// Helper: normalize prefix for code generation
function normalizePrefix(raw: string): string {
  const cleaned = raw.trim().toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (cleaned.length === 0) return "SRV";
  if (cleaned.length > 6) return cleaned.slice(0, 6);
  return cleaned;
}

// Helper: load service settings for code generation
async function loadServiceSettingsForCode(
  supabase: any,
  activeServiceId: string | null
): Promise<string> {
  if (!supabase || !activeServiceId) {
    return "SRV";
  }
  
  try {
    const { data, error } = await supabase
      .from("service_settings")
      .select("config")
      .eq("service_id", activeServiceId)
      .maybeSingle();
    
    if (error || !data) {
      return "SRV";
    }
    
    const typedData = data as { config: any };
    if (!typedData.config) {
      return "SRV";
    }
    
    const abbreviation = typedData.config.abbreviation;
    if (typeof abbreviation === "string") {
      return normalizePrefix(abbreviation);
    }
    
    return "SRV";
  } catch (err) {
    console.error("[makeCode] Error loading service settings:", err);
    return "SRV";
  }
}

// Helper: generate ticket code
async function makeCode(
  cloudTickets: TicketEx[],
  supabase: any,
  activeServiceId: string | null
): Promise<string> {
  // Load and normalize prefix from DB
  const prefix = await loadServiceSettingsForCode(supabase, activeServiceId);
  
  // Get year (YY)
  const year = new Date().getFullYear().toString().slice(-2);
  const prefixYear = `${prefix}${year}`;
  
  // Find existing codes with same prefix + year
  let existingCodes: string[] = [];
  
  if (cloudTickets.length > 0) {
    // Use tickets from memory - filter by prefix + year pattern
    existingCodes = cloudTickets
      .map(t => t.code || "")
      .filter(code => code.startsWith(prefixYear));
  } else if (supabase && activeServiceId) {
    // Query Supabase for codes matching prefix + year pattern
    // Note: includes deleted tickets (deleted_at IS NOT NULL) for sequence number calculation
    try {
      const { data, error } = await (supabase
        .from("tickets") as any)
        .select("code")
        .eq("service_id", activeServiceId)
        .like("code", `${prefixYear}%`)
        // Note: includes deleted tickets (deleted_at IS NOT NULL) for sequence number calculation
        .order("code", { ascending: false })
        .limit(100);
      
      if (!error && data) {
        existingCodes = data
          .map((t: any) => t.code || "")
          .filter((code: string) => code.startsWith(prefixYear));
      }
    } catch (err) {
      console.error("[makeCode] Error querying tickets:", err);
      // Continue with empty array (will default to 000001)
    }
  }
  
  // Extract sequence numbers from existing codes
  // Format: PREFIXYY######, extract last 6 digits
  const existingNumbers = existingCodes
    .map(code => {
      // Get last 6 characters (should be the sequence number)
      const seqPart = code.slice(-6);
      const num = parseInt(seqPart, 10);
      return isNaN(num) ? 0 : num;
    })
    .filter(n => n > 0);
  
  // Find the next number
  const nextNumber = existingNumbers.length > 0 
    ? Math.max(...existingNumbers) + 1 
    : 1;
  
  // Format as PREFIXYY######
  const sequence = String(nextNumber).padStart(6, "0");
  return `${prefixYear}${sequence}`;
}

// Helper: check if customer name is anonymous
function isAnonymousCustomerName(name: string | null | undefined): boolean {
  if (!name) return false;
  
  // Normalize: trim, lowercase, remove diacritics, remove spaces
  const normalized = name
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "") // Remove diacritics
    .replace(/\s+/g, ""); // Remove spaces
  
  return normalized === "anonymnizakaznik" || normalized === "anonymouscustomer";
}

// Helper: ensure customer exists and return ID
async function ensureCustomerIdForTicketSnapshot(
  snapshot: {
    customer_phone?: string | null;
    customer_name?: string | null;
    customer_email?: string | null;
    customer_company?: string | null;
    customer_ico?: string | null;
    customer_address_street?: string | null;
    customer_address_city?: string | null;
    customer_address_zip?: string | null;
  },
  activeServiceId: string
): Promise<string | null> {
  if (!supabase) return null;
  
  // Skip if no phone - phone is required for lookup
  if (!snapshot.customer_phone) return null;

  const phoneNorm = normalizePhone(snapshot.customer_phone);
  if (!phoneNorm) return null;

  // 1) Try to find existing customer by phone_norm (priority: phone > name)
  const found = await (supabase
    .from("customers") as any)
    .select("id")
    .eq("service_id", activeServiceId)
    .eq("phone_norm", phoneNorm)
    .maybeSingle();

  if (found.data?.id) {
    // Found existing customer - return ID even if name is anonymous
    return found.data.id;
  }

  // 2) Try to create new customer (only if name is not anonymous)
  const isAnonymous = isAnonymousCustomerName(snapshot.customer_name);
  if (isAnonymous) {
    // Don't create new customer if name is anonymous
    return null;
  }

  const payload = {
    service_id: activeServiceId,
    name: snapshot.customer_name ?? "Zákazník",
    phone: snapshot.customer_phone ?? null,
    phone_norm: phoneNorm,
    email: snapshot.customer_email ?? null,
    company: snapshot.customer_company ?? null,
    ico: snapshot.customer_ico ?? null,
    address_street: snapshot.customer_address_street ?? null,
    address_city: snapshot.customer_address_city ?? null,
    address_zip: snapshot.customer_address_zip ?? null,
    note: null,
  };

  const created = await (supabase
    .from("customers") as any)
    .insert([payload])
    .select("id")
    .single();

  if (created.data?.id) {
    return created.data.id;
  }

  // 3) On conflict (23505), retry find
  if (created.error?.code === "23505") {
    const retry = await (supabase
      .from("customers") as any)
      .select("id")
      .eq("service_id", activeServiceId)
      .eq("phone_norm", phoneNorm)
      .maybeSingle();

    return retry.data?.id ?? null;
  }

  return null;
}

type UseOrderActionsDeps = {
  activeServiceId: string | null;
  userId: string | null;
  cloudTickets: TicketEx[];
  setCloudTickets: React.Dispatch<React.SetStateAction<TicketEx[]>>;
  setStatusById: React.Dispatch<React.SetStateAction<Record<string, string>>>;
  statusesReady: boolean;
  statuses: Array<{ key: string }>;
  statusKeysSet: Set<string>;
  normalizeStatus: (key: string) => string | null;
  refetchTicketById: (ticketId: string) => Promise<TicketEx | null>;
};

type CreateTicketParams = {
  newDraft: any;
  customerMatchDecision: "undecided" | "accepted" | "rejected";
  onSuccess: (tickets: TicketEx[]) => void;
};

type SaveTicketChangesParams = {
  detailedTicket: TicketEx;
  editedTicket: Partial<TicketEx>;
  onSuccess: (ticket: TicketEx) => void;
};

export function useOrderActions(deps: UseOrderActionsDeps) {
  const {
    activeServiceId,
    userId,
    cloudTickets,
    setCloudTickets,
    setStatusById,
    statusesReady,
    statuses,
    statusKeysSet,
    normalizeStatus,
    refetchTicketById,
  } = deps;

  const createTicket = useCallback(async (params: CreateTicketParams): Promise<boolean> => {
    const { newDraft, customerMatchDecision, onSuccess } = params;

    if (!activeServiceId || !supabase) {
      showToast("Vytváření zakázek vyžaduje přihlášení a aktivní službu", "error");
      return false;
    }

    resetTauriFetchState();

    // Ensure statuses are loaded before creating ticket
    if (!statusesReady || statuses.length === 0) {
      showToast("Statusy se ještě načítají. Zkuste to prosím za chvíli.", "error");
      return false;
    }

    try {
      // Use first available status if "received" doesn't exist, otherwise use "received"
      const preferredStatus = statusKeysSet.has("received") ? "received" : statuses[0]?.key;
      if (!preferredStatus) {
        showToast("Chyba: žádné statusy nejsou k dispozici. Kontaktujte administrátora.", "error");
        return false;
      }
      const statusKey = normalizeStatus(preferredStatus);
      if (statusKey === null) {
        showToast("Načítání statusů... Zkuste to prosím znovu za chvíli.", "error");
        return false;
      }

      const customerName = newDraft.customerName.trim() || "Anonymní zákazník";
      let customerId: string | null = null;
      if (customerMatchDecision === "rejected" && !newDraft.customerId) {
        customerId = null;
      } else {
        customerId = await ensureCustomerIdForTicketSnapshot(
          {
            customer_phone: newDraft.customerPhone.trim() || null,
            customer_name: customerName,
            customer_email: newDraft.customerEmail.trim() || null,
            customer_company: newDraft.company.trim() || null,
            customer_ico: newDraft.ico.trim() || null,
            customer_address_street: newDraft.addressStreet.trim() || null,
            customer_address_city: newDraft.addressCity.trim() || null,
            customer_address_zip: newDraft.addressZip.trim() || null,
          },
          activeServiceId
        );
      }

      const devices = Array.isArray(newDraft.devices) ? newDraft.devices : [{ deviceLabel: newDraft.deviceLabel, serialOrImei: newDraft.serialOrImei, devicePasscode: newDraft.devicePasscode, deviceCondition: newDraft.deviceCondition, deviceAccessories: newDraft.deviceAccessories, requestedRepair: newDraft.requestedRepair, handoffMethod: newDraft.handoffMethod, handbackMethod: newDraft.handbackMethod, deviceNote: newDraft.deviceNote, externalId: newDraft.externalId, estimatedPrice: newDraft.estimatedPrice }];
      const photosBefore = (newDraft as any).diagnosticPhotosBefore as string[] | undefined;

      let accumulatedTickets = [...cloudTickets];
      const createdTickets: TicketEx[] = [];

      for (let i = 0; i < devices.length; i++) {
        const dev = devices[i] as any;
        const issueShort = (dev.requestedRepair || "").trim() || "—";
        const code = await makeCode(accumulatedTickets, supabase, activeServiceId);

        const payload = {
          service_id: activeServiceId,
          code,
          title: (dev.deviceLabel || "").trim() || "Nová zakázka",
          status: statusKey,
          notes: issueShort,
          customer_id: customerId ?? newDraft.customerId ?? null,
          customer_name: customerName,
          customer_phone: newDraft.customerPhone.trim() || null,
          customer_email: newDraft.customerEmail.trim() || null,
          customer_address_street: newDraft.addressStreet.trim() || null,
          customer_address_city: newDraft.addressCity.trim() || null,
          customer_address_zip: newDraft.addressZip.trim() || null,
          customer_company: newDraft.company.trim() || null,
          customer_ico: newDraft.ico.trim() || null,
          customer_info: newDraft.customerInfo.trim() || null,
          device_serial: (dev.serialOrImei || "").trim() || null,
          device_passcode: (dev.devicePasscode || "").trim() || null,
          device_condition: (dev.deviceCondition || "").trim() || null,
          device_accessories: (dev.deviceAccessories || "").trim() || null,
          device_note: (dev.deviceNote || "").trim() || null,
          external_id: (dev.externalId || "").trim() || null,
          handoff_method: dev.handoffMethod || null,
          handback_method: (dev.handbackMethod || "").trim() || null,
          estimated_price: dev.estimatedPrice ?? null,
          performed_repairs: (newDraft as any).performedRepairs ?? [],
          diagnostic_text: (newDraft as any).diagnosticText?.trim() || "",
          diagnostic_photos: (newDraft as any).diagnosticPhotos ?? [],
          diagnostic_photos_before: [] as string[],
          expected_completion_at: (dev.expectedCompletionAt ?? newDraft.devices[0]?.expectedCompletionAt) || null,
          discount_type: (newDraft as any).discountType ?? null,
          discount_value: (newDraft as any).discountValue ?? null,
        };

        const { data, error } = await (supabase
          .from("tickets") as any)
          .insert(payload)
          .select()
          .single();

        if (error) {
          console.error("[SaveTicket] create error", error);
          showToast(`Chyba při vytváření zakázky: ${error.message}`, "error");
          return false;
        }

        let ticket = mapSupabaseTicketToTicketEx(data);
        if (i === 0 && photosBefore?.length && supabase && activeServiceId) {
          try {
            const urls: string[] = [];
            for (const dataUrl of photosBefore) {
              if (!dataUrl || typeof dataUrl !== "string") continue;
              const blob = await addWatermarkToImageBlob(dataUrl);
              const file = new File([blob], "photo.jpg", { type: "image/jpeg" });
              const url = await uploadDiagnosticPhoto(supabase, activeServiceId, ticket.id!, file);
              urls.push(url);
            }
            if (urls.length > 0) {
              const { data: updated, error: updErr } = await (supabase.from("tickets") as any)
                .update({ diagnostic_photos_before: urls })
                .eq("id", ticket.id)
                .select()
                .single();
              if (!updErr && updated) ticket = mapSupabaseTicketToTicketEx(updated);
            }
          } catch (err) {
            console.error("[SaveTicket] upload photos before failed", err);
            showToast("Fotky při příjmu se nepodařilo nahrát.", "error");
          }
        }

        accumulatedTickets = [ticket, ...accumulatedTickets];
        createdTickets.push(ticket);
        setCloudTickets((prev) => [ticket, ...prev]);
        setStatusById((prev) => ({ ...prev, [ticket.id]: statusKey }));
      }

      onSuccess(createdTickets);
      if (userId) {
        const newTotal = cloudTickets.length + createdTickets.length;
        checkAchievementsOnTicketsChanged(userId, activeServiceId, newTotal);
        (async () => {
          try {
            const { count } = await (supabase.from("customers") as any)
              .select("*", { count: "exact", head: true })
              .eq("service_id", activeServiceId);
            if (typeof count === "number") checkAchievementsOnCustomersChanged(userId, activeServiceId, count);
          } catch {
            // ignore
          }
        })();
      }
      showToast(createdTickets.length === 1 ? "Zakázka vytvořena" : `Vytvořeno ${createdTickets.length} zakázek`, "success");
      return true;
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : "Neznámá chyba";
      console.error("[SaveTicket] create exception", err);
      showToast(`Chyba při vytváření zakázky: ${errorMessage}`, "error");
      return false;
    }
  }, [activeServiceId, userId, cloudTickets, setCloudTickets, setStatusById, statusesReady, statuses, statusKeysSet, normalizeStatus]);

  const saveTicketChanges = useCallback(async (params: SaveTicketChangesParams): Promise<boolean> => {
    const { detailedTicket, editedTicket, onSuccess } = params;

    devLog("[Save] started", { ticketId: detailedTicket?.id });
    devLog("[SaveTicket] START", { 
      activeServiceId, 
      hasSupabase: !!supabase, 
      ticketId: detailedTicket?.id,
      version: detailedTicket.version
    });
    
    if (!detailedTicket) {
      devLog("[SaveTicket] END (no detailedTicket)");
      return false;
    }

    if (!activeServiceId || !supabase || !detailedTicket.id) {
      // Missing requirements
      showToast("Úpravy nejsou k dispozici - chybí požadavky na cloud", "info");
      devLog("[SaveTicket] END");
      return false;
    }

    resetTauriFetchState();

    // Get expected version for optimistic locking
    const expectedVersion = detailedTicket.version;
    if (expectedVersion === undefined) {
      devWarn("[SaveTicket] Ticket version is missing, cannot use optimistic locking");
      // Continue without version check (fallback for old tickets without version)
    }

    try {
      // Použij aktuální hodnoty z detailedTicket (které mohou obsahovat změny z diagnostiky)
      // nebo hodnoty z editedTicket pokud jsou definované (v edit módu)
      const updated: TicketEx = {
        ...detailedTicket,
        customerId: editedTicket.customerId !== undefined ? editedTicket.customerId : detailedTicket.customerId,
        customerName: editedTicket.customerName !== undefined ? editedTicket.customerName : detailedTicket.customerName,
        customerPhone: editedTicket.customerPhone !== undefined ? (editedTicket.customerPhone.trim() || undefined) : detailedTicket.customerPhone,
        customerEmail: editedTicket.customerEmail !== undefined ? (editedTicket.customerEmail.trim() || undefined) : detailedTicket.customerEmail,
        customerAddressStreet: editedTicket.customerAddressStreet !== undefined ? (editedTicket.customerAddressStreet.trim() || undefined) : detailedTicket.customerAddressStreet,
        customerAddressCity: editedTicket.customerAddressCity !== undefined ? (editedTicket.customerAddressCity.trim() || undefined) : detailedTicket.customerAddressCity,
        customerAddressZip: editedTicket.customerAddressZip !== undefined ? (editedTicket.customerAddressZip.trim() || undefined) : detailedTicket.customerAddressZip,
        customerCompany: editedTicket.customerCompany !== undefined ? (editedTicket.customerCompany.trim() || undefined) : detailedTicket.customerCompany,
        customerIco: editedTicket.customerIco !== undefined ? (editedTicket.customerIco.trim() || undefined) : detailedTicket.customerIco,
        customerInfo: editedTicket.customerInfo !== undefined ? (editedTicket.customerInfo.trim() || undefined) : detailedTicket.customerInfo,
        deviceLabel: editedTicket.deviceLabel !== undefined ? editedTicket.deviceLabel : detailedTicket.deviceLabel,
        serialOrImei: editedTicket.serialOrImei !== undefined ? (editedTicket.serialOrImei.trim() || undefined) : detailedTicket.serialOrImei,
        devicePasscode: editedTicket.devicePasscode !== undefined ? (editedTicket.devicePasscode.trim() || undefined) : detailedTicket.devicePasscode,
        deviceCondition: editedTicket.deviceCondition !== undefined ? (editedTicket.deviceCondition.trim() || undefined) : detailedTicket.deviceCondition,
        deviceAccessories: editedTicket.deviceAccessories !== undefined ? (editedTicket.deviceAccessories.trim() || undefined) : detailedTicket.deviceAccessories,
        requestedRepair: editedTicket.requestedRepair !== undefined ? (editedTicket.requestedRepair.trim() || undefined) : detailedTicket.requestedRepair,
        handoffMethod: editedTicket.handoffMethod !== undefined ? (editedTicket.handoffMethod.trim() || undefined) : detailedTicket.handoffMethod,
        handbackMethod: editedTicket.handbackMethod !== undefined ? (editedTicket.handbackMethod.trim() || undefined) : detailedTicket.handbackMethod,
        deviceNote: editedTicket.deviceNote !== undefined ? (editedTicket.deviceNote.trim() || undefined) : detailedTicket.deviceNote,
        externalId: editedTicket.externalId !== undefined ? (editedTicket.externalId.trim() || undefined) : detailedTicket.externalId,
        diagnosticText: editedTicket.diagnosticText !== undefined 
          ? (editedTicket.diagnosticText.trim() || undefined) 
          : (detailedTicket.diagnosticText?.trim() || undefined),
        diagnosticPhotos: editedTicket.diagnosticPhotos !== undefined 
          ? editedTicket.diagnosticPhotos 
          : detailedTicket.diagnosticPhotos,
        diagnosticPhotosBefore: editedTicket.diagnosticPhotosBefore !== undefined
          ? editedTicket.diagnosticPhotosBefore
          : detailedTicket.diagnosticPhotosBefore,
        performedRepairs: editedTicket.performedRepairs !== undefined
          ? editedTicket.performedRepairs
          : (detailedTicket.performedRepairs ?? []),
        discountType: editedTicket.discountType !== undefined
          ? editedTicket.discountType
          : (detailedTicket.discountType ?? null),
        discountValue: editedTicket.discountValue !== undefined
          ? editedTicket.discountValue
          : (detailedTicket.discountValue ?? undefined),
      };

      // Resolve customer_id: editedTicket has priority (explicit customer change)
      let resolvedCustomerId: string | null = null;
      if (editedTicket.customerId !== undefined) {
        // editedTicket.customerId has priority (explicit change via "Změnit zákazníka")
        resolvedCustomerId = editedTicket.customerId;
      } else if (updated.customerId) {
        // Use customerId from updated (which may be from detailedTicket)
        resolvedCustomerId = updated.customerId;
      } else {
        // Try to find/create customer from snapshot
        resolvedCustomerId = await ensureCustomerIdForTicketSnapshot(
          {
            customer_phone: updated.customerPhone || null,
            customer_name: updated.customerName || null,
            customer_email: updated.customerEmail || null,
            customer_company: updated.customerCompany || null,
            customer_ico: updated.customerIco || null,
            customer_address_street: updated.customerAddressStreet || null,
            customer_address_city: updated.customerAddressCity || null,
            customer_address_zip: updated.customerAddressZip || null,
          },
          activeServiceId
        );
      }

      const payload: any = {
        title: updated.deviceLabel || "Nová zakázka",
        status: updated.status,
        notes: updated.requestedRepair || updated.issueShort || "",
        customer_id: resolvedCustomerId ?? null,
        customer_name: updated.customerName || null,
        customer_phone: updated.customerPhone || null,
        customer_email: updated.customerEmail || null,
        customer_address_street: updated.customerAddressStreet || null,
        customer_address_city: updated.customerAddressCity || null,
        customer_address_zip: updated.customerAddressZip || null,
        customer_company: updated.customerCompany || null,
        customer_ico: updated.customerIco || null,
        customer_info: updated.customerInfo || null,
        device_serial: updated.serialOrImei || null,
        device_passcode: updated.devicePasscode || null,
        device_condition: updated.deviceCondition || null,
        device_accessories: updated.deviceAccessories?.trim() || null,
        device_note: updated.deviceNote || null,
        external_id: updated.externalId || null,
        handoff_method: updated.handoffMethod || null,
        handback_method: updated.handbackMethod || null,
        estimated_price: updated.estimatedPrice || null,
        performed_repairs: updated.performedRepairs ?? [],
        diagnostic_text: updated.diagnosticText ?? "",
        diagnostic_photos: updated.diagnosticPhotos ?? [],
        diagnostic_photos_before: updated.diagnosticPhotosBefore ?? [],
        discount_type: updated.discountType ?? null,
        discount_value: updated.discountValue ?? null,
        expected_completion_at: (editedTicket as any).expectedCompletionAt !== undefined ? (editedTicket as any).expectedCompletionAt : (detailedTicket as any).expected_completion_at ?? null,
      };
      
      // Audit: Log customer snapshot fields in payload
      devLog("[SaveTicket] PAYLOAD - Customer snapshot fields:", {
        customer_id: payload.customer_id,
        customer_name: payload.customer_name,
        customer_phone: payload.customer_phone,
        customer_email: payload.customer_email,
        customer_address_street: payload.customer_address_street,
        customer_address_city: payload.customer_address_city,
        customer_address_zip: payload.customer_address_zip,
        customer_company: payload.customer_company,
        customer_ico: payload.customer_ico,
        customer_info: payload.customer_info,
      });
      devLog("[SaveTicket] PAYLOAD (full)", payload);
      devLog("[SaveTicket] Optimistic lock - expected version:", expectedVersion);
      
      // Build update query with optimistic locking
      let updateQuery = (supabase
        .from("tickets") as any)
        .update(payload)
        .eq("id", detailedTicket.id)
        .eq("service_id", activeServiceId);
      
      // Add version check for optimistic locking (if version is available)
      if (expectedVersion !== undefined) {
        updateQuery = updateQuery.eq("version", expectedVersion);
      }
      
      const { data, error } = await updateQuery
        .select("id,service_id,code,title,status,notes,customer_id,customer_name,customer_phone,customer_email,customer_address_street,customer_address_city,customer_address_zip,customer_company,customer_ico,customer_info,device_serial,device_passcode,device_condition,device_accessories,device_note,external_id,handoff_method,handback_method,estimated_price,performed_repairs,diagnostic_text,diagnostic_photos,diagnostic_photos_before,discount_type,discount_value,created_at,updated_at,version")
        .single();

      devLog("[SaveTicket] RESULT", { data, error, expectedVersion });

      if (error) {
        console.error("[SaveTicket] update error", error);
        showToast(`Chyba při ukládání zakázky: ${error.message}`, "error");
        devLog("[SaveTicket] END (error)");
        return false;
      }

      // Detect conflict: no error but no data returned (0 rows updated due to version mismatch)
      if (!data && expectedVersion !== undefined) {
        devWarn("[SaveTicket] CONFLICT DETECTED - no data returned, version mismatch likely");
        showToast("Zakázku mezitím upravil někdo jiný. Načetl jsem novou verzi – prosím zkontrolujte změny a uložte znovu.", "error");
        
        // Re-fetch the ticket from DB
        try {
          const refreshedTicket = await refetchTicketById(detailedTicket.id);
          if (refreshedTicket) {
            setCloudTickets((prev) => prev.map((t) => (t.id === detailedTicket.id ? refreshedTicket : t)));
            onSuccess(refreshedTicket);
            devLog("[SaveTicket] END (conflict - refreshed)");
            return false; // Return false to indicate conflict, not success
          }
        } catch (refetchError) {
          console.error("[SaveTicket] Error re-fetching ticket after conflict:", refetchError);
        }
        
        devLog("[SaveTicket] END (conflict)");
        return false;
      }

      if (!data) {
        console.error("[SaveTicket] update returned no data (and no version check was used)");
        showToast("Chyba: server nevrátil data", "error");
        devLog("[SaveTicket] END (no data)");
        return false;
      }

      // Check if customer_id changed and dispatch refresh event
      const oldCustomerId = detailedTicket.customerId || null;
      const newCustomerId = data.customer_id || null;
      if (oldCustomerId !== newCustomerId) {
        devLog("[SaveTicket] Customer ID changed:", { oldCustomerId, newCustomerId });
        window.dispatchEvent(
          new CustomEvent("jobsheet:customer-tickets-refresh", {
            detail: { customerId: newCustomerId, oldCustomerId },
          })
        );
      }

      const updatedTicket = mapSupabaseTicketToTicketEx(data);
      devLog("[SaveTicket] cloudTickets updated:", {
        ticketId: updatedTicket.id,
        performedRepairs: updatedTicket.performedRepairs,
        diagnosticText: updatedTicket.diagnosticText,
        diagnosticPhotos: updatedTicket.diagnosticPhotos,
        fromSelect: true
      });
      setCloudTickets((prev) => prev.map((t) => (t.id === detailedTicket.id ? updatedTicket : t)));
      onSuccess(updatedTicket);
      devLog("[SaveTicket] END");
      return true;
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : "Neznámá chyba";
      console.error("[SaveTicket] update exception", err);
      showToast(`Chyba při ukládání zakázky: ${errorMessage}`, "error");
      devLog("[SaveTicket] END");
      return false;
    }
  }, [activeServiceId, setCloudTickets, refetchTicketById]);

  return {
    createTicket,
    saveTicketChanges,
  };
}

