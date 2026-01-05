import { useEffect, useMemo, useState, useCallback } from "react";
import { showToast } from "../components/Toast";
import { supabase } from "../lib/supabaseClient";
import { typedSupabase } from "../lib/typedSupabase";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { normalizePhone } from "../lib/phone";
import { useStatuses } from "../state/StatusesStore";

// Removed: CUSTOMERS_STORAGE_KEY - no longer used in cloud-first mode

type CustomerRecord = {
  id: string;
  name: string;
  phone?: string;
  email?: string;
  addressStreet?: string;
  addressCity?: string;
  addressZip?: string;
  company?: string;
  ico?: string;
  info?: string;
  ticketIds: string[];
  createdAt: string;
  updatedAt: string;
  version?: number; // optimistic locking version
};

type TicketLite = {
  id: string;
  code: string;
  deviceLabel: string;
  serialOrImei?: string;
  issueShort: string;
  createdAt: string;
  status: string;
};

function formatCZ(dtIso: string) {
  const d = new Date(dtIso);
  return d.toLocaleString("cs-CZ", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function isEmailValid(v: string) {
  const s = v.trim();
  if (!s) return true;
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s);
}
function isPhoneValid(v: string) {
  const s = v.trim();
  if (!s) return true;
  const digits = s.replace(/[^\d]/g, "");
  return digits.length >= 9 && digits.length <= 15;
}
function isZipValid(v: string) {
  const s = v.trim();
  if (!s) return true;
  const digits = s.replace(/[^\d]/g, "");
  return digits.length === 5;
}
function isIcoValid(v: string) {
  const s = v.trim();
  if (!s) return true;
  const digits = s.replace(/[^\d]/g, "");
  return digits.length === 8;
}

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

type OpenTicketIntent = {
  ticketId: string;
  mode?: "panel" | "detail";
};

type CustomersProps = {
  activeServiceId: string | null;
  openCustomerIntent: { customerId: string } | null;
  onOpenCustomerIntentConsumed: () => void;
  openTicketIntent: OpenTicketIntent | null;
  onOpenTicketIntentConsumed: () => void;
  onOpenTicket: (ticketId: string, mode?: "panel" | "detail", returnToCustomerId?: string) => void;
};

export default function Customers({
  activeServiceId,
  openCustomerIntent,
  onOpenCustomerIntentConsumed,
  openTicketIntent,
  onOpenTicketIntentConsumed,
  onOpenTicket,
}: CustomersProps) {
  const { getByKey } = useStatuses();
  const normalizeStatus = useCallback(
    (key: string): string | null => {
      if (!key || typeof key !== "string") return null;
      const trimmed = key.trim();
      return trimmed || null;
    },
    []
  );

  const [query, setQuery] = useState("");
  const [openId, setOpenId] = useState<string | null>(null);

  const [editOpen, setEditOpen] = useState(false);
  const [submitAttempted, setSubmitAttempted] = useState(false);
  const [editDraft, setEditDraft] = useState<EditDraft>({
    name: "",
    phone: "",
    email: "",
    addressStreet: "",
    addressCity: "",
    addressZip: "",
    company: "",
    ico: "",
    info: "",
  });

  const [cloudCustomers, setCloudCustomers] = useState<CustomerRecord[]>([]);
  const [customersLoading, setCustomersLoading] = useState(false);
  const [customersError, setCustomersError] = useState<string | null>(null);

  // Delete dialog states
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [deleteCustomerId, setDeleteCustomerId] = useState<string | null>(null);

  // Map Supabase customer to CustomerRecord
  const mapSupabaseCustomerToCustomerRecord = (supabaseCustomer: any): CustomerRecord => {
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
      info: supabaseCustomer.note || undefined, // note -> info
      ticketIds: [], // Will be populated separately from tickets table
      createdAt: supabaseCustomer.created_at || new Date().toISOString(),
      updatedAt: supabaseCustomer.updated_at || new Date().toISOString(),
      version: typeof supabaseCustomer.version === "number" ? supabaseCustomer.version : undefined,
    };
  };

  // Load customers from cloud when activeServiceId changes
  useEffect(() => {
    if (!activeServiceId || !supabase) {
      setCloudCustomers([]);
      setCustomersLoading(false);
      setCustomersError(null);
      return;
    }

    setCustomersLoading(true);
    setCustomersError(null);

    const loadCustomers = async () => {
      if (!supabase) {
        setCustomersError("Supabase není inicializován");
        setCustomersLoading(false);
        return;
      }

      try {
        // ✅ Použití typovaného Supabase clientu - bez 'as any'!
        const { data, error } = await typedSupabase
          .from("customers")
          .select("id,service_id,name,phone,email,company,ico,address_street,address_city,address_zip,note,created_at,updated_at,version")
          .eq("service_id", activeServiceId)
          .order("created_at", { ascending: false });

        if (error) {
          throw error;
        }

        if (data) {
          const mapped = data.map(mapSupabaseCustomerToCustomerRecord);
          
          // Load ticket IDs for each customer
          if (mapped.length > 0) {
            if (!supabase) {
              setCustomersError("Supabase není inicializován");
              setCustomersLoading(false);
              return;
            }
            const customerIds = mapped.map((c: CustomerRecord) => c.id);
            const { data: ticketsData, error: ticketsError } = await (supabase
              .from("tickets") as any)
              .select("id,customer_id")
              .eq("service_id", activeServiceId)
              .in("customer_id", customerIds)
              .is("deleted_at", null);

            if (!ticketsError && ticketsData) {
              // Group tickets by customer_id
              const ticketsByCustomerId: Record<string, string[]> = {};
              for (const ticket of ticketsData) {
                if (ticket.customer_id) {
                  if (!ticketsByCustomerId[ticket.customer_id]) {
                    ticketsByCustomerId[ticket.customer_id] = [];
                  }
                  ticketsByCustomerId[ticket.customer_id].push(ticket.id);
                }
              }

              // Assign ticketIds to customers
              for (const customer of mapped) {
                customer.ticketIds = ticketsByCustomerId[customer.id] || [];
              }
            }
          }

          setCloudCustomers(mapped);
        } else {
          setCloudCustomers([]);
        }
        setCustomersLoading(false);
      } catch (err) {
        console.error("[Customers] Error loading customers:", err);
        setCustomersError(err instanceof Error ? err.message : "Neznámá chyba při načítání zákazníků");
        setCloudCustomers([]);
        setCustomersLoading(false);
      }
    };

    loadCustomers();
  }, [activeServiceId, supabase]);

  // Realtime subscription for customers
  useEffect(() => {
    if (!activeServiceId || !supabase) return;

    const topic = `customers:${activeServiceId}`;
    console.log("[RT] subscribe", topic, new Date().toISOString());

    const channel = supabase
      .channel(topic)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "customers",
          filter: `service_id=eq.${activeServiceId}`,
        },
        async (payload) => {
          console.log("[Customers] customers changed", payload);
          
          // Check if this is the currently edited customer and if version conflict occurred
          if (payload.eventType === "UPDATE" && editOpen && openId) {
            const updatedCustomer = payload.new as any;
            if (updatedCustomer.id === openId) {
              const existingCustomer = cloudCustomers.find((c) => c.id === openId);
              if (existingCustomer) {
                const existingVersion = existingCustomer.version ?? 0;
                const newVersion = typeof updatedCustomer.version === "number" ? updatedCustomer.version : 0;
                if (newVersion > existingVersion) {
                  // Remote update detected during editing - show banner/toast
                  console.log("[RT customers] Remote update detected for edited customer", {
                    customerId: openId,
                    existingVersion,
                    newVersion,
                  });
                  showToast("Zákazník se změnil na pozadí", "info");
                }
              }
            }
          }
          
          if (payload.eventType === "INSERT" || payload.eventType === "UPDATE") {
            const newCustomer = mapSupabaseCustomerToCustomerRecord(payload.new);
            
            // Load ticket IDs for this customer
            if (!supabase) return;
            const { data: ticketsData } = await (supabase
              .from("tickets") as any)
              .select("id")
              .eq("service_id", activeServiceId)
              .eq("customer_id", newCustomer.id)
              .is("deleted_at", null);
            
            if (ticketsData) {
              newCustomer.ticketIds = ticketsData.map((t: any) => t.id);
            }

            setCloudCustomers((prev) => {
              const existing = prev.find((c) => c.id === newCustomer.id);
              if (existing) {
                return prev.map((c) => (c.id === newCustomer.id ? newCustomer : c));
              } else {
                return [newCustomer, ...prev];
              }
            });
          } else if (payload.eventType === "DELETE") {
            setCloudCustomers((prev) => prev.filter((c) => c.id !== payload.old.id));
          }
        }
      )
      .subscribe();

    return () => {
      console.log("[RT] unsubscribe", topic, new Date().toISOString());
      if (supabase) {
        supabase.removeChannel(channel);
      }
    };
  }, [activeServiceId, editOpen, openId, cloudCustomers]);

  const customers = cloudCustomers;

  // State for customer tickets (loaded from cloud)
  const [customerTickets, setCustomerTickets] = useState<TicketLite[]>([]);
  const [customerTicketsLoading, setCustomerTicketsLoading] = useState(false);

  // Customer history state
  type CustomerHistoryEntry = {
    id: string;
    changed_at: string;
    changed_by: string | null;
    change_type: string;
    diff: Record<string, { old: any; new: any }>;
  };
  const [customerHistory, setCustomerHistory] = useState<CustomerHistoryEntry[]>([]);
  const [customerHistoryLoading, setCustomerHistoryLoading] = useState(false);

  // Map Supabase ticket to TicketLite
  const mapSupabaseTicketToTicketLite = (supabaseTicket: any): TicketLite => {
    return {
      id: supabaseTicket.id || "",
      code: supabaseTicket.code || "",
      deviceLabel: supabaseTicket.title || "Nová zakázka",
      serialOrImei: supabaseTicket.device_serial || undefined,
      issueShort: supabaseTicket.notes || "—",
      createdAt: supabaseTicket.created_at || new Date().toISOString(),
      status: supabaseTicket.status || "received",
    };
  };

  // Load tickets for opened customer from cloud
  useEffect(() => {
    if (!openId || !activeServiceId || !supabase) {
      setCustomerTickets([]);
      setCustomerTicketsLoading(false);
      return;
    }

    setCustomerTicketsLoading(true);

    const loadCustomerTickets = async () => {
      if (!supabase) {
        setCustomerTicketsLoading(false);
        return;
      }

      try {
        const { data, error } = await (supabase
          .from("tickets") as any)
          .select("id,code,title,status,notes,device_serial,created_at")
          .eq("service_id", activeServiceId)
          .eq("customer_id", openId)
          .is("deleted_at", null)
          .order("created_at", { ascending: false });

        if (error) {
          throw error;
        }

        if (data) {
          const mapped = data.map(mapSupabaseTicketToTicketLite);
          setCustomerTickets(mapped);
        } else {
          setCustomerTickets([]);
        }
        setCustomerTicketsLoading(false);
      } catch (err) {
        console.error("[Customers] Error loading customer tickets:", err);
        setCustomerTickets([]);
        setCustomerTicketsLoading(false);
      }
    };

    loadCustomerTickets();
  }, [openId, activeServiceId, supabase]);

  // Load customer history when customer detail is opened
  useEffect(() => {
    if (!openId || !activeServiceId || !supabase) {
      setCustomerHistory([]);
      setCustomerHistoryLoading(false);
      return;
    }

    setCustomerHistoryLoading(true);

    const loadCustomerHistory = async () => {
      if (!supabase) {
        setCustomerHistoryLoading(false);
        return;
      }

      try {
        const { data, error } = await (supabase
          .from("customer_history") as any)
          .select("id,changed_at,changed_by,change_type,diff")
          .eq("customer_id", openId)
          .eq("service_id", activeServiceId)
          .order("changed_at", { ascending: false });

        if (error) {
          throw error;
        }

        if (data) {
          setCustomerHistory(data);
        } else {
          setCustomerHistory([]);
        }
        setCustomerHistoryLoading(false);
      } catch (err) {
        console.error("[Customers] Error loading customer history:", err);
        setCustomerHistory([]);
        setCustomerHistoryLoading(false);
      }
    };

    loadCustomerHistory();
  }, [openId, activeServiceId, supabase]);

  // Listen for customer tickets refresh event (when customer_id changes in ticket)
  useEffect(() => {
    const handleRefresh = (e: any) => {
      const { customerId, oldCustomerId } = e.detail || {};
      // Refresh if currently opened customer matches new or old customer ID
      if (openId && (openId === customerId || openId === oldCustomerId)) {
        console.log("[Customers] Refreshing customer tickets due to customer_id change:", { customerId, oldCustomerId, openId });
        // Trigger reload by temporarily clearing and setting openId
        // Or directly call loadCustomerTickets if we have access to it
        // For now, we'll use a simple approach: reload when openId matches
        if (supabase && activeServiceId) {
          (async () => {
            setCustomerTicketsLoading(true);
            try {
              const { data, error } = await (supabase
                .from("tickets") as any)
                .select("id,code,title,status,notes,device_serial,created_at")
                .eq("service_id", activeServiceId)
                .eq("customer_id", openId)
                .is("deleted_at", null)
                .order("created_at", { ascending: false });

              if (error) throw error;

              if (data) {
                const mapped = data.map(mapSupabaseTicketToTicketLite);
                setCustomerTickets(mapped);
              } else {
                setCustomerTickets([]);
              }
              setCustomerTicketsLoading(false);
            } catch (err) {
              console.error("[Customers] Error refreshing customer tickets:", err);
              setCustomerTickets([]);
              setCustomerTicketsLoading(false);
            }
          })();
        }
      }
    };

    window.addEventListener("jobsheet:customer-tickets-refresh" as any, handleRefresh);
    return () => window.removeEventListener("jobsheet:customer-tickets-refresh" as any, handleRefresh);
  }, [openId, supabase, activeServiceId]);

  const tickets = customerTickets;

  // Handle openCustomerIntent - automatically open customer profile
  useEffect(() => {
    if (openCustomerIntent?.customerId) {
      const customerId = openCustomerIntent.customerId;
      const customer = customers.find((c) => c.id === customerId);
      if (customer) {
        setOpenId(customerId);
        onOpenCustomerIntentConsumed();
      }
    }
  }, [openCustomerIntent, customers, onOpenCustomerIntentConsumed]);

  // Handle openTicketIntent - navigate to Orders instead of showing simple preview
  useEffect(() => {
    if (openTicketIntent?.ticketId) {
      // Instead of showing simple preview, navigate to Orders with the ticket
      // This will be handled by App.tsx which will switch to Orders page
      onOpenTicketIntentConsumed();
    }
  }, [openTicketIntent, onOpenTicketIntentConsumed]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    let result = customers;

    // Filter by query if provided
    if (q) {
      result = customers.filter((c) => {
        const hay = [c.name, c.phone ?? "", c.email ?? "", c.company ?? "", c.ico ?? "", c.addressCity ?? ""]
          .join(" ")
          .toLowerCase();
        return hay.includes(q);
      });
    }

    // Sort alphabetically by name
    return [...result].sort((a, b) => {
      const nameA = (a.name || "").toLowerCase();
      const nameB = (b.name || "").toLowerCase();
      return nameA.localeCompare(nameB, "cs");
    });
  }, [customers, query]);

  const opened = useMemo(
    () => filtered.find((c) => c.id === openId) ?? customers.find((c) => c.id === openId),
    [filtered, customers, openId]
  );

  const openedTickets = useMemo(() => {
    if (!opened) return [];
    // Tickets are already filtered by customer_id in the useEffect
    return tickets.sort((a, b) => (b.createdAt ?? "").localeCompare(a.createdAt ?? ""));
  }, [tickets]);

  const border = "1px solid var(--border)";
  const borderError = "1px solid rgba(239,68,68,0.9)";

  const openEdit = () => {
    if (!opened) return;
    setSubmitAttempted(false);
    setEditDraft(draftFromCustomer(opened));
    setEditOpen(true);
  };

  const errors = useMemo(() => {
    const e: Record<string, string> = {};
    if (!editDraft.name.trim()) e.name = "Jméno je povinné.";
    if (!isPhoneValid(editDraft.phone)) e.phone = "Telefon vypadá neplatně.";
    if (!isEmailValid(editDraft.email)) e.email = "E-mail vypadá neplatně.";
    if (!isZipValid(editDraft.addressZip)) e.zip = "PSČ musí mít 5 číslic.";
    if (!isIcoValid(editDraft.ico)) e.ico = "IČO musí mít 8 číslic.";
    return e;
  }, [editDraft]);

  const canSave = Object.keys(errors).length === 0;

  const saveEdit = async () => {
    if (!opened || !supabase || !activeServiceId) return;
    setSubmitAttempted(true);
    if (!canSave) return;

    // Get current user ID for history
    const { data: sessionData } = await supabase.auth.getSession();
    const changedBy = sessionData?.session?.user?.id || null;

    // Load original customer record from DB for accurate diff
    const { data: originalData, error: fetchError } = await (supabase
      .from("customers") as any)
      .select("name,phone,email,address_street,address_city,address_zip,company,ico,note,phone_norm,version")
      .eq("id", opened.id)
      .eq("service_id", activeServiceId)
      .single();

    if (fetchError) {
      console.error("[Customers] Error fetching original customer for history:", fetchError);
      // Continue with update even if fetch fails
    }

    // Check if phone changed
    const originalPhone = (opened.phone || "").trim();
    const newPhone = editDraft.phone.trim();
    const phoneChanged = originalPhone !== newPhone;

    // Prepare payload for Supabase update
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

    // Update phone_norm if phone changed
    if (phoneChanged) {
      if (!newPhone) {
        payload.phone_norm = null;
      } else {
        const phoneNorm = normalizePhone(newPhone);
        payload.phone_norm = phoneNorm;
      }
    }

    // Build diff for history (only changed fields)
    const diff: Record<string, { old: any; new: any }> = {};
    const original = originalData || {
      name: opened.name || null,
      phone: opened.phone || null,
      email: opened.email || null,
      address_street: opened.addressStreet || null,
      address_city: opened.addressCity || null,
      address_zip: opened.addressZip || null,
      company: opened.company || null,
      ico: opened.ico || null,
      note: opened.info || null,
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
      const { error: historyError } = await (supabase
        .from("customer_history") as any)
        .insert({
          customer_id: opened.id,
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
    const expectedVersion = opened.version;
    
    // Build update query with optimistic locking
    let updateQuery = (supabase
      .from("customers") as any)
      .update(payload)
      .eq("id", opened.id)
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
        return; // Don't close modal
      }
      
      showToast("Chyba při ukládání zákazníka: " + (error.message || "Neznámá chyba"), "error");
      return; // Don't close modal on error
    }

    // Detect conflict: no error but no data returned (0 rows updated due to version mismatch)
    if (!data && expectedVersion !== undefined) {
      console.warn("[Customers] CONFLICT DETECTED - no data returned, version mismatch likely");
      showToast("Zákazník byl mezitím upraven jinde. Načetl jsem aktuální verzi.", "error");
      
      // Re-fetch the customer from DB
      try {
        const { data: refreshedData, error: refetchError } = await (supabase
          .from("customers") as any)
          .select("id,service_id,name,phone,email,company,ico,address_street,address_city,address_zip,note,created_at,updated_at,version")
          .eq("id", opened.id)
          .eq("service_id", activeServiceId)
          .single();
        
        if (refetchError) {
          console.error("[Customers] Error re-fetching customer after conflict:", refetchError);
          return; // Don't close modal
        }
        
        if (refreshedData) {
          const refreshedCustomer = mapSupabaseCustomerToCustomerRecord(refreshedData);
          
          // Load ticket IDs for refreshed customer
          const { data: ticketsData } = await (supabase
            .from("tickets") as any)
            .select("id")
            .eq("service_id", activeServiceId)
            .eq("customer_id", refreshedCustomer.id)
            .is("deleted_at", null);
          
          if (ticketsData) {
            refreshedCustomer.ticketIds = ticketsData.map((t: any) => t.id);
          }
          
          // Update local state with refreshed customer
          setCloudCustomers((prev) => {
            const updated = prev.map((c) => (c.id === refreshedCustomer.id ? refreshedCustomer : c));
            // If customer was not in the list, add it
            if (!prev.find((c) => c.id === refreshedCustomer.id)) {
              return [...updated, refreshedCustomer];
            }
            return updated;
          });
          
          // Update edit draft if editing this customer
          if (editOpen && openId === refreshedCustomer.id) {
            setEditDraft(draftFromCustomer(refreshedCustomer));
          }
        }
      } catch (refetchErr) {
        console.error("[Customers] Exception re-fetching customer after conflict:", refetchErr);
      }
      
      return; // Don't close modal on conflict
    }
    
    if (!data) {
      console.error("[Customers] update returned no data (and no version check was used)");
      showToast("Chyba: server nevrátil data", "error");
      return; // Don't close modal
    }

    // Update successful - update local state from returned data
    const nowIso = new Date().toISOString();
    const nextId = computeCustomerIdFromDraft(editDraft) || opened.id;

    setCloudCustomers((prev) => {
      const clone = [...prev];

      const oldIdx = clone.findIndex((c) => c.id === opened.id);
      if (oldIdx < 0) return prev;

      const old = clone[oldIdx];

      // Map Supabase response to CustomerRecord
      const updatedBase: CustomerRecord = {
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
        ticketIds: old.ticketIds || [],
        createdAt: data.created_at || old.createdAt,
        updatedAt: data.updated_at || nowIso,
        version: typeof data.version === "number" ? data.version : undefined,
      };

      const existingIdx = clone.findIndex((c) => c.id === nextId);
      if (existingIdx >= 0 && clone[existingIdx].id !== old.id) {
        const target = clone[existingIdx];
        const merged: CustomerRecord = {
          ...target,
          ...updatedBase,
          ticketIds: Array.from(new Set([...(target.ticketIds ?? []), ...(old.ticketIds ?? [])])),
          createdAt: target.createdAt ?? old.createdAt,
          updatedAt: nowIso,
          version: typeof data.version === "number" ? data.version : updatedBase.version,
        };
        clone.splice(oldIdx, 1);
        const targetNowIdx = clone.findIndex((c) => c.id === nextId);
        if (targetNowIdx >= 0) clone[targetNowIdx] = merged;
      } else {
        clone[oldIdx] = updatedBase;
      }

      return clone;
    });

    // Set openId after state update to ensure we stay on the same customer
    // Use the actual customer ID from DB response, or fallback to nextId
    const finalCustomerId = data.id || nextId || opened.id;
    setOpenId(finalCustomerId);

    setEditOpen(false);
    setSubmitAttempted(false);
    showToast("Uloženo", "success");

    // Refresh customer history after successful update
    // Use finalCustomerId instead of openId to ensure we refresh the correct customer
    if (finalCustomerId && activeServiceId && supabase) {
      try {
        const { data: historyData, error: historyError } = await (supabase
          .from("customer_history") as any)
          .select("id,changed_at,changed_by,change_type,diff")
          .eq("customer_id", finalCustomerId)
          .eq("service_id", activeServiceId)
          .order("changed_at", { ascending: false });

        if (!historyError && historyData) {
          setCustomerHistory(historyData);
        }
      } catch (err) {
        console.error("[Customers] Error refreshing customer history after update:", err);
      }
    }
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      {/* Header */}
      <div>
        <div style={{ fontSize: 22, fontWeight: 950, color: "var(--text)" }}>Zákazníci</div>
        <div style={{ fontSize: 13, color: "var(--muted)", marginTop: 4 }}>
          Spravujte zákaznickou databázi a jejich zakázky
        </div>
      </div>

      <div style={{ display: "flex", justifyContent: "space-between", gap: 16, alignItems: "center" }}>
        <input
          placeholder="Vyhledávání zákazníků…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          style={{
            width: 360,
            padding: "10px 12px",
            borderRadius: 12,
            border: border,
            outline: "none",
            background: "var(--panel)",
            backdropFilter: "var(--blur)",
            WebkitBackdropFilter: "var(--blur)",
            color: "var(--text)",
            transition: "var(--transition-smooth)",
            boxShadow: "var(--shadow-soft)",
          }}
        />
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "420px 1fr", gap: 12 }}>
        {/* List */}
        <div
          style={{
            border: border,
            borderRadius: "var(--radius-lg)",
            background: "var(--panel)",
            backdropFilter: "var(--blur)",
            WebkitBackdropFilter: "var(--blur)",
            boxShadow: "var(--shadow-soft)",
            overflow: "hidden",
          }}
        >
          <div style={{ padding: 12, borderBottom: border, color: "var(--muted)", fontSize: 12 }}>
            {filtered.length} zákazníků
          </div>

          {customersLoading && (
            <div style={{ padding: 24, textAlign: "center", color: "var(--muted)" }}>
              Načítání zákazníků...
            </div>
          )}
          {customersError && (
            <div style={{ padding: 16, textAlign: "center", color: "rgba(239,68,68,0.9)", background: "rgba(239,68,68,0.1)", borderRadius: 12, border: "1px solid rgba(239,68,68,0.3)", margin: 12 }}>
              {customersError}
            </div>
          )}

          {!customersLoading && !customersError && (
          <div style={{ display: "grid" }}>
            {filtered.map((c) => {
              const active = c.id === openId;
              return (
                <button
                  key={c.id}
                  onClick={() => setOpenId(c.id)}
                  style={{
                    textAlign: "left",
                    padding: 12,
                    border: "none",
                    borderBottom: "1px solid rgba(0,0,0,0.06)",
                    background: active ? "var(--accent-soft)" : "transparent",
                    backdropFilter: active ? "var(--blur)" : "none",
                    WebkitBackdropFilter: active ? "var(--blur)" : "none",
                    cursor: "pointer",
                    color: "var(--text)",
                  }}
                >
                  <div style={{ fontWeight: 900, display: "flex", justifyContent: "space-between", gap: 10 }}>
                    <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{c.name}</span>
                    <span style={{ color: "var(--muted)", fontWeight: 800 }}>{(c.ticketIds ?? []).length}</span>
                  </div>
                  <div style={{ marginTop: 4, color: "var(--muted)", fontSize: 12 }}>
                    {[c.phone, c.email, c.company].filter(Boolean).join(" · ")}
                  </div>
                </button>
              );
            })}

            {filtered.length === 0 && <div style={{ padding: 14, color: "var(--muted)" }}>Nic nenalezeno.</div>}
          </div>
          )}
        </div>

        {/* Detail */}
        <div
          style={{
            border: border,
            borderRadius: "var(--radius-lg)",
            background: "var(--panel)",
            backdropFilter: "var(--blur)",
            WebkitBackdropFilter: "var(--blur)",
            boxShadow: "var(--shadow-soft)",
            padding: 14,
            minHeight: 240,
          }}
        >
          {!opened ? (
            <div style={{ color: "var(--muted)" }}>Vyber zákazníka vlevo.</div>
          ) : (
            <>
              <div style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "flex-start" }}>
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontWeight: 900, fontSize: 16 }}>{opened.name}</div>
                  <div style={{ color: "var(--muted)", marginTop: 4, fontSize: 12 }}>
                    {[opened.phone, opened.email].filter(Boolean).join(" · ")}
                  </div>
                  <div style={{ color: "var(--muted)", marginTop: 4, fontSize: 12 }}>
                    {[opened.company, opened.ico].filter(Boolean).join(" · ")}
                  </div>
                  <div style={{ color: "var(--muted)", marginTop: 4, fontSize: 12 }}>
                    {[opened.addressStreet, opened.addressCity, opened.addressZip].filter(Boolean).join(", ")}
                  </div>
                </div>

                <div style={{ display: "grid", gap: 8, justifyItems: "end" }}>
                  <div style={{ color: "var(--muted)", fontSize: 12, fontWeight: 800, whiteSpace: "nowrap" }}>
                    Aktualizováno: {formatCZ(opened.updatedAt)}
                  </div>

                  <div style={{ display: "flex", gap: 10 }}>
                    <button
                      onClick={openEdit}
                      style={{
                        padding: "10px 12px",
                        borderRadius: 12,
                        border: border,
                        background: "var(--panel)",
                        backdropFilter: "var(--blur)",
                        WebkitBackdropFilter: "var(--blur)",
                        color: "var(--text)",
                        fontWeight: 900,
                        cursor: "pointer",
                        boxShadow: "var(--shadow-soft)",
                        transition: "var(--transition-smooth)",
                      }}
                    >
                      Upravit
                    </button>

                    <button
                      onClick={() => {
                        setDeleteCustomerId(opened.id);
                        setDeleteDialogOpen(true);
                      }}
                      style={{
                        padding: "10px 12px",
                        borderRadius: 12,
                        border: "1px solid rgba(239,68,68,0.3)",
                        background: "rgba(239,68,68,0.1)",
                        color: "rgba(239,68,68,0.9)",
                        fontWeight: 900,
                        cursor: "pointer",
                        boxShadow: "var(--shadow-soft)",
                        transition: "var(--transition-smooth)",
                      }}
                    >
                      Smazat
                    </button>

                    <button
                      onClick={() =>
                        window.dispatchEvent(
                          new CustomEvent("jobsheet:request-new-order", { detail: { customerId: opened.id } })
                        )
                      }
                      style={{
                        padding: "10px 12px",
                        borderRadius: 12,
                        border: border,
                        background: "var(--accent)",
                        color: "white",
                        fontWeight: 900,
                        cursor: "pointer",
                        boxShadow: "var(--shadow-soft)",
                      }}
                    >
                      + Vytvořit zakázku
                    </button>
                  </div>
                </div>
              </div>

              {opened.info && (
                <div
                  style={{
                    marginTop: 12,
                    border: border,
                    borderRadius: 12,
                    background: "var(--panel)",
                    backdropFilter: "var(--blur)",
                    WebkitBackdropFilter: "var(--blur)",
                    padding: 12,
                    color: "var(--text)",
                    boxShadow: "var(--shadow-soft)",
                  }}
                >
                  <div style={{ fontWeight: 900, fontSize: 12, color: "var(--muted)" }}>Informace</div>
                  <div style={{ marginTop: 6 }}>{opened.info}</div>
                </div>
              )}

              <div style={{ marginTop: 12, fontWeight: 900, fontSize: 13 }}>Zakázky</div>

              {customerTicketsLoading && (
                <div style={{ padding: 16, textAlign: "center", color: "var(--muted)", fontSize: 13 }}>
                  Načítání zakázek...
                </div>
              )}

              {!customerTicketsLoading && (
              <div style={{ marginTop: 8, display: "grid", gap: 10 }}>
                {openedTickets.map((t) => {
                  const currentStatus = normalizeStatus(t.status);
                  const meta = currentStatus !== null ? getByKey(currentStatus) : null;

                  return (
                    <button
                      key={t.id}
                      onClick={() => onOpenTicket(t.id, "detail", openId || undefined)}
                      style={{
                        textAlign: "left",
                        border: meta?.bg ? `2px solid ${meta.bg}80` : border,
                        borderRadius: 14,
                        background: meta?.bg ? `${meta.bg}30` : "var(--panel)",
                        backdropFilter: "var(--blur)",
                        WebkitBackdropFilter: "var(--blur)",
                        padding: 0,
                        cursor: "pointer",
                        color: "var(--text)",
                        boxShadow: meta?.bg ? `0 4px 16px ${meta.bg}40, 0 0 0 1px ${meta.bg}20` : "var(--shadow-soft)",
                        transition: "var(--transition-smooth)",
                        display: "flex",
                        position: "relative",
                        overflow: "hidden",
                      }}
                      onMouseEnter={(e) => {
                        e.currentTarget.style.transform = "translateY(-1px)";
                        e.currentTarget.style.boxShadow = meta?.bg ? `0 6px 20px ${meta.bg}50, 0 0 0 1px ${meta.bg}30` : "var(--shadow-hover)";
                      }}
                      onMouseLeave={(e) => {
                        e.currentTarget.style.transform = "translateY(0)";
                        e.currentTarget.style.boxShadow = meta?.bg ? `0 4px 16px ${meta.bg}40, 0 0 0 1px ${meta.bg}20` : "var(--shadow-soft)";
                      }}
                      title="Otevřít zakázku"
                    >
                      <div
                        style={{
                          width: 10,
                          background: meta?.bg || "var(--border)",
                          flexShrink: 0,
                          boxShadow: meta?.bg ? `0 0 24px ${meta.bg}90, inset 0 0 12px ${meta.bg}60, 0 0 8px ${meta.bg}50` : "none",
                        }}
                      />
                      <div style={{ flex: 1, padding: 12 }}>
                        <div style={{ display: "flex", justifyContent: "space-between", gap: 10 }}>
                          <div style={{ fontWeight: 900 }}>{t.code}</div>
                          <div style={{ color: "var(--muted)", fontSize: 12 }}>{formatCZ(t.createdAt)}</div>
                        </div>
                        <div style={{ marginTop: 6, fontWeight: 850 }}>{t.deviceLabel}</div>
                        <div style={{ marginTop: 4, color: "var(--muted)", fontSize: 12 }}>
                          {[t.serialOrImei, meta?.label || t.status].filter(Boolean).join(" · ")}
                        </div>
                        <div style={{ marginTop: 6, opacity: 0.92 }}>{t.issueShort}</div>
                      </div>
                    </button>
                  );
                })}

                {openedTickets.length === 0 && <div style={{ color: "var(--muted)" }}>Zatím žádné zakázky.</div>}
              </div>
              )}

              {/* Customer History */}
              <div style={{ marginTop: 12 }}>
                <div style={{ fontWeight: 900, fontSize: 13, marginBottom: 8 }}>Historie změn</div>
                {customerHistoryLoading ? (
                  <div style={{ padding: 16, textAlign: "center", color: "var(--muted)", fontSize: 13 }}>
                    Načítání historie...
                  </div>
                ) : customerHistory.length === 0 ? (
                  <div style={{ padding: 16, textAlign: "center", color: "var(--muted)", fontSize: 13 }}>
                    Zatím žádné změny.
                  </div>
                ) : (
                  <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                    {customerHistory.map((entry) => {
                      const fieldLabels: Record<string, string> = {
                        name: "Jméno",
                        phone: "Telefon",
                        email: "E-mail",
                        address_street: "Ulice",
                        address_city: "Město",
                        address_zip: "PSČ",
                        company: "Firma",
                        ico: "IČO",
                        note: "Poznámka",
                      };

                      return (
                        <div
                          key={entry.id}
                          style={{
                            border: border,
                            borderRadius: 8,
                            background: "var(--panel)",
                            backdropFilter: "var(--blur)",
                            WebkitBackdropFilter: "var(--blur)",
                            padding: 12,
                            color: "var(--text)",
                            boxShadow: "var(--shadow-soft)",
                          }}
                        >
                          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12 }}>
                            <div style={{ flex: 1 }}>
                              <div style={{ fontWeight: 900, fontSize: 12, color: "var(--text)" }}>
                                Změna údajů zákazníka
                              </div>
                              <div style={{ fontSize: 11, color: "var(--muted)", marginTop: 4 }}>
                                {formatCZ(entry.changed_at)}
                              </div>
                            </div>
                          </div>
                          <div style={{ marginTop: 10, display: "flex", flexDirection: "column", gap: 6 }}>
                            {Object.entries(entry.diff || {}).map(([field, change]) => (
                              <div key={field} style={{ fontSize: 12 }}>
                                <div style={{ fontWeight: 700, color: "var(--muted)", marginBottom: 2 }}>
                                  {fieldLabels[field] || field}
                                </div>
                                <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                                  <span style={{ color: "var(--text)", textDecoration: change.old ? "none" : "line-through" }}>
                                    {change.old || "(prázdné)"}
                                  </span>
                                  <span style={{ color: "var(--muted)" }}>→</span>
                                  <span style={{ color: "var(--accent)", fontWeight: 600 }}>
                                    {change.new || "(prázdné)"}
                                  </span>
                                </div>
                              </div>
                            ))}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </>
          )}
        </div>
      </div>


      {/* ===== Edit customer modal ===== */}
      <div
        onClick={() => setEditOpen(false)}
        style={{
          position: "fixed",
          inset: 0,
          background: "rgba(0,0,0,0.35)",
          opacity: editOpen ? 1 : 0,
          pointerEvents: editOpen ? "auto" : "none",
          transition: "opacity 180ms ease",
          zIndex: 200,
        }}
      />

      <div
        style={{
          position: "fixed",
          left: "50%",
          top: "50%",
          transform: editOpen ? "translate(-50%, -50%) scale(1)" : "translate(-50%, -48%) scale(0.98)",
          opacity: editOpen ? 1 : 0,
          pointerEvents: editOpen ? "auto" : "none",
          transition: "transform 180ms ease, opacity 180ms ease",
          width: 820,
          maxWidth: "calc(100vw - 24px)",
          maxHeight: "calc(100vh - 24px)",
          overflow: "auto",
          background: "var(--panel)",
          backdropFilter: "var(--blur)",
          WebkitBackdropFilter: "var(--blur)",
          border: border,
          borderRadius: "var(--radius-lg)",
          boxShadow: "var(--shadow)",
          padding: 18,
          zIndex: 210,
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* (zbytek tvého modalu nechávám beze změn) */}
        <div style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "center" }}>
          <div>
            <div style={{ fontWeight: 900, fontSize: 16 }}>Upravit zákazníka</div>
            <div style={{ color: "var(--muted)", fontSize: 12, marginTop: 4 }}>Ukládá se do localStorage.</div>
          </div>
          <button
            onClick={() => setEditOpen(false)}
            style={{
              padding: "10px 12px",
              borderRadius: 12,
              border: border,
              background: "var(--panel)",
              color: "var(--text)",
              fontWeight: 900,
              cursor: "pointer",
            }}
          >
            Zavřít
          </button>
        </div>

        {/* --- form (beze změn, jen zkráceno v komentáři) --- */}
        <div style={{ marginTop: 14 }}>
          <div style={{ fontSize: 12, color: "var(--muted)" }}>Jméno a příjmení *</div>
          <input
            value={editDraft.name}
            onChange={(e) => setEditDraft((p) => ({ ...p, name: e.target.value }))}
            style={{
              width: "100%",
              padding: "10px 12px",
              borderRadius: 12,
              outline: "none",
              border: submitAttempted && !!errors.name ? borderError : border,
              background: "var(--panel)",
              backdropFilter: "var(--blur)",
              WebkitBackdropFilter: "var(--blur)",
              color: "var(--text)",
              transition: "var(--transition-smooth)",
              boxShadow: "var(--shadow-soft)",
            }}
          />
          {submitAttempted && errors.name && (
            <div style={{ fontSize: 12, marginTop: 6, color: "rgba(239,68,68,0.95)" }}>{errors.name}</div>
          )}

          <div style={{ marginTop: 14 }}>
            <div style={{ fontSize: 12, color: "var(--muted)" }}>Telefon</div>
            <input
              value={editDraft.phone}
              onChange={(e) => setEditDraft((p) => ({ ...p, phone: e.target.value }))}
              style={{
                width: "100%",
                padding: "10px 12px",
                borderRadius: 12,
                outline: "none",
                border: submitAttempted && !!errors.phone ? borderError : border,
                background: "var(--panel)",
                backdropFilter: "var(--blur)",
                WebkitBackdropFilter: "var(--blur)",
                color: "var(--text)",
                transition: "var(--transition-smooth)",
                boxShadow: "var(--shadow-soft)",
              }}
            />
            {submitAttempted && errors.phone && (
              <div style={{ fontSize: 12, marginTop: 6, color: "rgba(239,68,68,0.95)" }}>{errors.phone}</div>
            )}
          </div>

          <div style={{ marginTop: 14 }}>
            <div style={{ fontSize: 12, color: "var(--muted)" }}>E-mail</div>
            <input
              type="email"
              value={editDraft.email}
              onChange={(e) => setEditDraft((p) => ({ ...p, email: e.target.value }))}
              style={{
                width: "100%",
                padding: "10px 12px",
                borderRadius: 12,
                outline: "none",
                border: submitAttempted && !!errors.email ? borderError : border,
                background: "var(--panel)",
                backdropFilter: "var(--blur)",
                WebkitBackdropFilter: "var(--blur)",
                color: "var(--text)",
                transition: "var(--transition-smooth)",
                boxShadow: "var(--shadow-soft)",
              }}
            />
            {submitAttempted && errors.email && (
              <div style={{ fontSize: 12, marginTop: 6, color: "rgba(239,68,68,0.95)" }}>{errors.email}</div>
            )}
          </div>

          <div style={{ marginTop: 14 }}>
            <div style={{ fontSize: 12, color: "var(--muted)" }}>Firma</div>
            <input
              value={editDraft.company}
              onChange={(e) => setEditDraft((p) => ({ ...p, company: e.target.value }))}
              style={{
                width: "100%",
                padding: "10px 12px",
                borderRadius: 12,
                outline: "none",
                border,
                background: "var(--panel)",
                backdropFilter: "var(--blur)",
                WebkitBackdropFilter: "var(--blur)",
                color: "var(--text)",
                transition: "var(--transition-smooth)",
                boxShadow: "var(--shadow-soft)",
              }}
            />
          </div>

          <div style={{ marginTop: 14 }}>
            <div style={{ fontSize: 12, color: "var(--muted)" }}>IČO</div>
            <input
              value={editDraft.ico}
              onChange={(e) => setEditDraft((p) => ({ ...p, ico: e.target.value }))}
              style={{
                width: "100%",
                padding: "10px 12px",
                borderRadius: 12,
                outline: "none",
                border: submitAttempted && !!errors.ico ? borderError : border,
                background: "var(--panel)",
                backdropFilter: "var(--blur)",
                WebkitBackdropFilter: "var(--blur)",
                color: "var(--text)",
                transition: "var(--transition-smooth)",
                boxShadow: "var(--shadow-soft)",
              }}
            />
            {submitAttempted && errors.ico && (
              <div style={{ fontSize: 12, marginTop: 6, color: "rgba(239,68,68,0.95)" }}>{errors.ico}</div>
            )}
          </div>

          <div style={{ marginTop: 14 }}>
            <div style={{ fontSize: 12, color: "var(--muted)" }}>Adresa – ulice</div>
            <input
              value={editDraft.addressStreet}
              onChange={(e) => setEditDraft((p) => ({ ...p, addressStreet: e.target.value }))}
              style={{
                width: "100%",
                padding: "10px 12px",
                borderRadius: 12,
                outline: "none",
                border,
                background: "var(--panel)",
                backdropFilter: "var(--blur)",
                WebkitBackdropFilter: "var(--blur)",
                color: "var(--text)",
                transition: "var(--transition-smooth)",
                boxShadow: "var(--shadow-soft)",
              }}
            />
          </div>

          <div style={{ marginTop: 14, display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            <div>
              <div style={{ fontSize: 12, color: "var(--muted)" }}>Město</div>
              <input
                value={editDraft.addressCity}
                onChange={(e) => setEditDraft((p) => ({ ...p, addressCity: e.target.value }))}
                style={{
                  width: "100%",
                  padding: "10px 12px",
                  borderRadius: 12,
                  outline: "none",
                  border,
                  background: "var(--panel)",
                  backdropFilter: "var(--blur)",
                  WebkitBackdropFilter: "var(--blur)",
                  color: "var(--text)",
                  transition: "var(--transition-smooth)",
                  boxShadow: "var(--shadow-soft)",
                }}
              />
            </div>

            <div>
              <div style={{ fontSize: 12, color: "var(--muted)" }}>PSČ</div>
              <input
                value={editDraft.addressZip}
                onChange={(e) => setEditDraft((p) => ({ ...p, addressZip: e.target.value }))}
                style={{
                  width: "100%",
                  padding: "10px 12px",
                  borderRadius: 12,
                  outline: "none",
                  border: submitAttempted && !!errors.zip ? borderError : border,
                  background: "var(--panel)",
                  backdropFilter: "var(--blur)",
                  WebkitBackdropFilter: "var(--blur)",
                  color: "var(--text)",
                  transition: "var(--transition-smooth)",
                  boxShadow: "var(--shadow-soft)",
                }}
              />
              {submitAttempted && errors.zip && (
                <div style={{ fontSize: 12, marginTop: 6, color: "rgba(239,68,68,0.95)" }}>{errors.zip}</div>
              )}
            </div>
          </div>

          <div style={{ marginTop: 14 }}>
            <div style={{ fontSize: 12, color: "var(--muted)" }}>Informace</div>
            <textarea
              value={editDraft.info}
              onChange={(e) => setEditDraft((p) => ({ ...p, info: e.target.value }))}
              rows={4}
              style={{
                width: "100%",
                padding: "10px 12px",
                borderRadius: 12,
                outline: "none",
                border,
                background: "var(--panel)",
                backdropFilter: "var(--blur)",
                WebkitBackdropFilter: "var(--blur)",
                color: "var(--text)",
                transition: "var(--transition-smooth)",
                boxShadow: "var(--shadow-soft)",
                resize: "vertical",
                fontFamily: "inherit",
              }}
            />
          </div>

          <div style={{ marginTop: 14, display: "flex", justifyContent: "flex-end", gap: 10 }}>
            <button
              onClick={() => setEditOpen(false)}
              style={{
                padding: "10px 12px",
                borderRadius: 12,
                border: border,
                background: "var(--panel)",
                backdropFilter: "var(--blur)",
                WebkitBackdropFilter: "var(--blur)",
                color: "var(--text)",
                fontWeight: 900,
                cursor: "pointer",
                transition: "var(--transition-smooth)",
                boxShadow: "var(--shadow-soft)",
              }}
            >
              Zrušit
            </button>

            <button
              onClick={saveEdit}
              style={{
                padding: "10px 12px",
                borderRadius: 12,
                border: "none",
                background: "linear-gradient(135deg, var(--accent), var(--accent-hover))",
                color: "white",
                fontWeight: 900,
                cursor: canSave ? "pointer" : "not-allowed",
                opacity: canSave ? 1 : 0.55,
                boxShadow: canSave ? `0 4px 12px var(--accent-glow)` : "none",
                transition: "var(--transition-smooth)",
              }}
            >
              Uložit
            </button>
          </div>
        </div>
      </div>

      {/* Confirm Dialog for Delete Customer */}
      <ConfirmDialog
        open={deleteDialogOpen}
        title="Smazat zákazníka?"
        message="Opravdu chceš smazat tohoto zákazníka? Všechny jeho zakázky budou odpojeny (customer_id bude nastaveno na NULL). Tato akce je nevratná."
        confirmLabel="Smazat"
        cancelLabel="Zrušit"
        variant="danger"
        onConfirm={async () => {
          if (!deleteCustomerId || !activeServiceId || !supabase) return;
          try {
            const { error } = await (supabase
              .from("customers") as any)
              .delete()
              .eq("id", deleteCustomerId)
              .eq("service_id", activeServiceId);

            if (error) throw error;

            showToast("Zákazník smazán", "success");
            setCloudCustomers((prev) => prev.filter((c) => c.id !== deleteCustomerId));
            if (openId === deleteCustomerId) {
              setOpenId(null);
            }
          } catch (err) {
            const errorMessage = err instanceof Error ? err.message : "Neznámá chyba";
            console.error("[Customers] Error deleting customer:", err);
            showToast(`Chyba při mazání zákazníka: ${errorMessage}`, "error");
          } finally {
            setDeleteDialogOpen(false);
            setDeleteCustomerId(null);
          }
        }}
        onCancel={() => {
          setDeleteDialogOpen(false);
          setDeleteCustomerId(null);
        }}
      />
    </div>
  );
}
