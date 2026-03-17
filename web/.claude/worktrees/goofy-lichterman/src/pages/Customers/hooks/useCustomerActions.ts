import { useState } from "react";
import { supabase } from "../../../lib/supabaseClient";
import { showToast } from "../../../components/Toast";
import { normalizePhone } from "../../../lib/phone";
import { type CustomerRecord } from "../CustomerList";

type EditDraft = {
  name: string;
  phone: string;
  email: string;
  addressStreet: string;
  addressCity: string;
  addressZip: string;
  company: string;
  ico: string;
  info: string;
};

function draftFromCustomer(c: CustomerRecord): EditDraft {
  return {
    name: c.name ?? "",
    phone: c.phone ?? "",
    email: c.email ?? "",
    addressStreet: c.addressStreet ?? "",
    addressCity: c.addressCity ?? "",
    addressZip: c.addressZip ?? "",
    company: c.company ?? "",
    ico: c.ico ?? "",
    info: c.info ?? "",
  };
}

function computeCustomerIdFromDraft(d: EditDraft) {
  const phoneDigits = d.phone.trim().replace(/[^\d]/g, "");
  if (phoneDigits) return `tel:${phoneDigits}`;
  const email = d.email.trim().toLowerCase();
  if (email) return `mail:${email}`;
  const name = d.name.trim().toLowerCase();
  const city = d.addressCity.trim().toLowerCase();
  if (name || city) return `name:${name}|city:${city}`;
  return "";
}

function mapSupabaseCustomerToCustomerRecord(supabaseCustomer: any): CustomerRecord {
  return {
    id: supabaseCustomer.id || "",
    name: supabaseCustomer.name || "",
    phone: supabaseCustomer.phone || undefined,
    email: supabaseCustomer.email || undefined,
    addressStreet: supabaseCustomer.address_street || undefined,
    addressCity: supabaseCustomer.address_city || undefined,
    addressZip: supabaseCustomer.address_zip || undefined,
    company: supabaseCustomer.company || undefined,
    ico: supabaseCustomer.ico || undefined,
    info: supabaseCustomer.note || undefined,
    ticketIds: [],
    createdAt: supabaseCustomer.created_at || new Date().toISOString(),
    updatedAt: supabaseCustomer.updated_at || new Date().toISOString(),
    version: typeof supabaseCustomer.version === "number" ? supabaseCustomer.version : undefined,
  };
}

type UseCustomerActionsParams = {
  activeServiceId: string | null;
  onSave: (updatedCustomer: CustomerRecord, finalCustomerId: string) => void;
};

export function useCustomerActions({ activeServiceId, onSave }: UseCustomerActionsParams) {
  const [isSaving, setIsSaving] = useState(false);

  const saveEdit = async (
    customer: CustomerRecord,
    editDraft: EditDraft,
    onUpdateEditDraft?: (draft: EditDraft) => void
  ) => {
    if (!customer || !supabase || !activeServiceId) return;
    setIsSaving(true);

    try {
      const { data: sessionData } = await supabase.auth.getSession();
      const changedBy = sessionData?.session?.user?.id || null;

      // Load original customer record from DB for accurate diff
      const { data: originalData, error: fetchError } = await (supabase.from("customers") as any)
        .select("name,phone,email,address_street,address_city,address_zip,company,ico,note,phone_norm,version")
        .eq("id", customer.id)
        .eq("service_id", activeServiceId)
        .single();

      if (fetchError) {
        console.error("[Customers] Error fetching original customer for history:", fetchError);
        // Continue with update even if fetch fails
      }

      // Prepare payload for Supabase update
      const newPhone = editDraft.phone.trim();
      const payload: Record<string, any> = {
        name: editDraft.name.trim() || null,
        phone: newPhone || null,
        email: editDraft.email.trim() || null,
        address_street: editDraft.addressStreet.trim() || null,
        address_city: editDraft.addressCity.trim() || null,
        address_zip: editDraft.addressZip.trim() || null,
        company: editDraft.company.trim() || null,
        ico: editDraft.ico.trim() || null,
        note: editDraft.info.trim() || null,
      };

      // Always set phone_norm from phone using normalizePhone
      // normalizePhone returns string | null, ensure we never set undefined
      const phoneNorm = normalizePhone(newPhone) ?? null;
      payload.phone_norm = phoneNorm;

      // Build diff for history (only changed fields)
      const diff: Record<string, { old: any; new: any }> = {};
      const original = originalData || {
        name: customer.name || null,
        phone: customer.phone || null,
        email: customer.email || null,
        address_street: customer.addressStreet || null,
        address_city: customer.addressCity || null,
        address_zip: customer.addressZip || null,
        company: customer.company || null,
        ico: customer.ico || null,
        note: customer.info || null,
      };

      // Compare each field
      const fieldMap: Record<string, { oldKey: string; newKey: string }> = {
        name: { oldKey: "name", newKey: "name" },
        phone: { oldKey: "phone", newKey: "phone" },
        email: { oldKey: "email", newKey: "email" },
        address_street: { oldKey: "address_street", newKey: "address_street" },
        address_city: { oldKey: "address_city", newKey: "address_city" },
        address_zip: { oldKey: "address_zip", newKey: "address_zip" },
        company: { oldKey: "company", newKey: "company" },
        ico: { oldKey: "ico", newKey: "ico" },
        note: { oldKey: "note", newKey: "note" },
      };

      for (const [dbField, keys] of Object.entries(fieldMap)) {
        const oldValue = original[keys.oldKey] || null;
        const newValue = payload[dbField] || null;

        // Normalize for comparison (treat empty strings as null)
        const normalizedOld = oldValue === "" ? null : oldValue;
        const normalizedNew = newValue === "" ? null : newValue;

        if (normalizedOld !== normalizedNew) {
          diff[dbField] = { old: normalizedOld, new: normalizedNew };
        }
      }

      // Insert history entry if there are any changes
      if (Object.keys(diff).length > 0) {
        const { error: historyError } = await (supabase.from("customer_history") as any).insert({
          customer_id: customer.id,
          service_id: activeServiceId,
          changed_by: changedBy,
          change_type: "update",
          diff: diff,
        });

        if (historyError) {
          console.error("[Customers] Error inserting customer history:", historyError);
          // Continue with update even if history insert fails
        }
      }

      // Get expected version for optimistic locking
      const expectedVersion = customer.version;

      // Build update query with optimistic locking
      let updateQuery = (supabase.from("customers") as any)
        .update(payload)
        .eq("id", customer.id)
        .eq("service_id", activeServiceId);

      // Add version check for optimistic locking (if version is available)
      if (expectedVersion !== undefined) {
        updateQuery = updateQuery.eq("version", expectedVersion);
      }

      const { data, error } = await updateQuery
        .select("id,name,phone,email,address_street,address_city,address_zip,company,ico,note,created_at,updated_at,version")
        .single();

      if (error) {
        console.error("[Customers] Error updating customer:", error);

        // Handle unique constraint violation (duplicate phone_norm)
        if (error.code === "23505") {
          showToast("Zákazník s tímto telefonním číslem už existuje", "error");
          return false; // Don't close modal
        }

        showToast("Chyba při ukládání zákazníka: " + (error.message || "Neznámá chyba"), "error");
        return false; // Don't close modal on error
      }

      // Detect conflict: no error but no data returned (0 rows updated due to version mismatch)
      if (!data && expectedVersion !== undefined) {
        console.warn("[Customers] CONFLICT DETECTED - no data returned, version mismatch likely");
        showToast("Zákazník byl mezitím upraven jinde. Načetl jsem aktuální verzi.", "error");

        // Re-fetch the customer from DB
        try {
          const { data: refreshedData, error: refetchError } = await (supabase.from("customers") as any)
            .select("id,service_id,name,phone,email,company,ico,address_street,address_city,address_zip,note,created_at,updated_at,version")
            .eq("id", customer.id)
            .eq("service_id", activeServiceId)
            .single();

          if (refetchError) {
            console.error("[Customers] Error re-fetching customer after conflict:", refetchError);
            return false; // Don't close modal
          }

          if (refreshedData) {
            const refreshedCustomer = mapSupabaseCustomerToCustomerRecord(refreshedData);

            // Load ticket IDs for refreshed customer
            const { data: ticketsData } = await (supabase.from("tickets") as any)
              .select("id")
              .eq("service_id", activeServiceId)
              .eq("customer_id", refreshedCustomer.id)
              .is("deleted_at", null);

            if (ticketsData) {
              refreshedCustomer.ticketIds = ticketsData.map((t: any) => t.id);
            }

            // Call onSave with refreshed customer
            onSave(refreshedCustomer, refreshedCustomer.id);

            // Update edit draft if editing this customer
            if (onUpdateEditDraft) {
              onUpdateEditDraft(draftFromCustomer(refreshedCustomer));
            }
          }
        } catch (refetchErr) {
          console.error("[Customers] Exception re-fetching customer after conflict:", refetchErr);
        }

        return false; // Don't close modal on conflict
      }

      if (!data) {
        console.error("[Customers] update returned no data (and no version check was used)");
        showToast("Chyba: server nevrátil data", "error");
        return false; // Don't close modal
      }

      // Update successful - build updatedCustomer and call onSave
      const nowIso = new Date().toISOString();
      const nextId = computeCustomerIdFromDraft(editDraft) || customer.id;

      // Build updatedCustomer from DB response
      const updatedCustomer: CustomerRecord = {
        id: data.id || nextId,
        name: data.name || "",
        phone: data.phone || undefined,
        email: data.email || undefined,
        addressStreet: data.address_street || undefined,
        addressCity: data.address_city || undefined,
        addressZip: data.address_zip || undefined,
        company: data.company || undefined,
        ico: data.ico || undefined,
        info: data.note || undefined,
        ticketIds: customer.ticketIds || [],
        createdAt: data.created_at || customer.createdAt,
        updatedAt: data.updated_at || nowIso,
        version: typeof data.version === "number" ? data.version : undefined,
      };

      const finalCustomerId = data.id || nextId || customer.id;
      onSave(updatedCustomer, finalCustomerId);
      showToast("Uloženo", "success");
      return true; // Success - close modal
    } finally {
      setIsSaving(false);
    }
  };

  return {
    saveEdit,
    isSaving,
  };
}

