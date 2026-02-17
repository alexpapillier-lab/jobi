import { useEffect, useMemo, useState, useCallback } from "react";
import { showToast } from "../components/Toast";
import { supabase } from "../lib/supabaseClient";
import { typedSupabase } from "../lib/typedSupabase";
import { CustomerList, type CustomerRecord } from "./Customers/CustomerList";
import { CustomerDetail } from "./Customers/CustomerDetail";

type TicketLite = {
  id: string;
  code: string;
  deviceLabel: string;
  serialOrImei?: string;
  issueShort: string;
  createdAt: string;
  status: string;
};

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
  const [query, setQuery] = useState("");
  const [openId, setOpenId] = useState<string | null>(null);

  const [cloudCustomers, setCloudCustomers] = useState<CustomerRecord[]>([]);
  const [customersLoading, setCustomersLoading] = useState(false);
  const [customersError, setCustomersError] = useState<string | null>(null);

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
  }, [activeServiceId, cloudCustomers]);

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

  const border = "1px solid var(--border)";

  // Get selected customer
  const selectedCustomer = useMemo(
    () => filtered.find((c) => c.id === openId) ?? customers.find((c) => c.id === openId) ?? null,
    [filtered, customers, openId]
  );

  // Callbacks for CustomerDetail
  const handleSaveCustomer = useCallback(
    (updatedCustomer: CustomerRecord, finalCustomerId: string) => {
    setCloudCustomers((prev) => {
      const clone = [...prev];
        const oldIdx = clone.findIndex((c) => c.id === updatedCustomer.id);
        
        if (oldIdx < 0) {
          // Customer not found, add it
          return [...clone, updatedCustomer];
        }

      const old = clone[oldIdx];

        // Check if customer ID changed (merge scenario)
        const existingIdx = clone.findIndex((c) => c.id === finalCustomerId);
      if (existingIdx >= 0 && clone[existingIdx].id !== old.id) {
          // Merge customers
        const target = clone[existingIdx];
        const merged: CustomerRecord = {
          ...target,
            ...updatedCustomer,
          ticketIds: Array.from(new Set([...(target.ticketIds ?? []), ...(old.ticketIds ?? [])])),
          createdAt: target.createdAt ?? old.createdAt,
        };
        clone.splice(oldIdx, 1);
          const targetNowIdx = clone.findIndex((c) => c.id === finalCustomerId);
        if (targetNowIdx >= 0) clone[targetNowIdx] = merged;
      } else {
          // Simple update
          clone[oldIdx] = updatedCustomer;
      }

      return clone;
    });

      // Update openId if customer ID changed
      if (finalCustomerId !== openId) {
    setOpenId(finalCustomerId);
      }
    },
    [openId]
  );

  const handleDeleteCustomer = useCallback(async (customerId: string) => {
    if (!activeServiceId || !supabase) return;

    try {
      const { error } = await (supabase.from("customers") as any).delete().eq("id", customerId).eq("service_id", activeServiceId);

      if (error) throw error;

      showToast("Zákazník smazán", "success");
      setCloudCustomers((prev) => prev.filter((c) => c.id !== customerId));
      if (openId === customerId) {
        setOpenId(null);
      }
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : "Neznámá chyba";
      console.error("[Customers] Error deleting customer:", err);
      showToast(`Chyba při mazání zákazníka: ${errorMessage}`, "error");
      throw err;
    }
  }, [activeServiceId, openId]);

  const handleHistoryRefresh = useCallback(async () => {
    if (!openId || !activeServiceId || !supabase) return;

    try {
      const { data, error } = await (supabase
          .from("customer_history") as any)
          .select("id,changed_at,changed_by,change_type,diff")
        .eq("customer_id", openId)
          .eq("service_id", activeServiceId)
          .order("changed_at", { ascending: false });

      if (error) throw error;
      if (data) setCustomerHistory(data);
      } catch (err) {
      console.error("[Customers] Error refreshing customer history:", err);
      }
  }, [openId, activeServiceId]);

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
          data-tour="customers-search"
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

      <div data-tour="customers-content" style={{ display: "grid", gridTemplateColumns: "420px 1fr", gap: 12 }}>
        <CustomerList
          customers={filtered}
          selectedCustomerId={openId}
          onSelect={(id) => setOpenId(id)}
          loading={customersLoading}
          error={customersError}
        />

        <CustomerDetail
          customer={selectedCustomer}
          tickets={customerTickets}
          ticketsLoading={customerTicketsLoading}
          customerHistory={customerHistory}
          customerHistoryLoading={customerHistoryLoading}
          activeServiceId={activeServiceId}
          onOpenTicket={onOpenTicket}
          onSave={handleSaveCustomer}
          onDelete={handleDeleteCustomer}
          onHistoryRefresh={handleHistoryRefresh}
        />
          </div>
    </div>
  );
}
