import { useEffect, useMemo, useRef, useState } from "react";
import Orders from "./pages/Orders";
import Settings from "./pages/Settings";
import Customers from "./pages/Customers";
import Devices from "./pages/Devices";
import Inventory from "./pages/Inventory";
import Statistics from "./pages/Statistics";
import Preview from "./pages/Preview";
import Guide from "./pages/Guide";

import { ThemeProvider } from "./theme/ThemeProvider";
import { AppLayout } from "./layout/AppLayout";
import type { NavKey } from "./layout/Sidebar";
import { StatusesProvider } from "./state/StatusesStore";
import { ToastContainer } from "./components/Toast";
import { Login, isAuthenticated, setAuthenticated } from "./components/Login";
import { OnlineGate } from "./components/OnlineGate";
import { ThemeAnimations } from "./components/ThemeAnimations";
import { supabase } from "./lib/supabaseClient";
import { getPendingInviteToken, clearPendingInviteToken } from "./lib/pendingInvite";
import { showToast } from "./components/Toast";
import { useAuth } from "./auth/AuthProvider";
import { clearOnServiceChange } from "./lib/storageInvalidation";

type OpenTicketIntent = {
  ticketId: string;
  mode?: "panel" | "detail";
  returnToPage?: NavKey; // Page to return to when ticket is closed
  returnToCustomerId?: string; // Customer ID to open when returning to customers page
};

type OpenCustomerIntent = {
  customerId: string;
};

import { STORAGE_KEYS } from "./constants/storageKeys";

type UIConfig = {
  app: { fabNewOrderEnabled: boolean; uiScale: number };
  home: { orderFilters: { selectedQuickStatusFilters: string[] } };
  orders: { displayMode: "list" | "grid" | "compact" };
};

function defaultUIConfig(): UIConfig {
  return {
    app: { fabNewOrderEnabled: true, uiScale: 1 },
    home: { orderFilters: { selectedQuickStatusFilters: [] } },
    orders: { displayMode: "list" },
  };
}

function safeLoadUIConfig(): UIConfig {
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.UI_SETTINGS);
    if (!raw) return defaultUIConfig();
    const parsed = JSON.parse(raw);

    const d = defaultUIConfig();
    const quick = parsed?.home?.orderFilters?.selectedQuickStatusFilters;
    const fab = parsed?.app?.fabNewOrderEnabled;
    const scale = parsed?.app?.uiScale;
    const displayMode = parsed?.orders?.displayMode;

    return {
      app: {
        fabNewOrderEnabled: typeof fab === "boolean" ? fab : d.app.fabNewOrderEnabled,
        uiScale: typeof scale === "number" && scale >= 0.85 && scale <= 1.35 ? scale : d.app.uiScale,
      },
      home: {
        orderFilters: {
          selectedQuickStatusFilters: Array.isArray(quick)
            ? quick.filter((x: any) => typeof x === "string")
            : d.home.orderFilters.selectedQuickStatusFilters,
        },
      },
      orders: {
        displayMode: displayMode === "list" || displayMode === "grid" || displayMode === "compact" ? displayMode : d.orders.displayMode,
      },
    };
  } catch {
    return defaultUIConfig();
  }
}

export default function App() {
  const { session } = useAuth();
  const [authenticated, setAuthenticatedState] = useState(() => isAuthenticated());
  const [activePage, setActivePage] = useState<NavKey>("orders");
  const [activeServiceId, setActiveServiceId] = useState<string | null>(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEYS.ACTIVE_SERVICE_ID);
      return stored || null;
    } catch {
      return null;
    }
  });
  const [services, setServices] = useState<Array<{ service_id: string; service_name: string; role: string }>>([]);

  // Track previous activeServiceId for service change detection
  const prevActiveServiceIdRef = useRef<string | null>(activeServiceId);

  // one-shot intent: navigate to Orders and open a specific ticket
  const [openTicketIntent, setOpenTicketIntent] = useState<OpenTicketIntent | null>(null);

  // one-shot intent: navigate to Customers and open a specific customer
  const [openCustomerIntent, setOpenCustomerIntent] = useState<OpenCustomerIntent | null>(null);

  // create new order intent (prefill)
  const [newOrderPrefill, setNewOrderPrefill] = useState<{ customerId?: string } | null>(null);

  // UI config
  const [uiCfg, setUiCfg] = useState<UIConfig>(() => safeLoadUIConfig());

  // Draft badge count (from Orders via jobsheet:draft-count)
  const [draftCount, setDraftCount] = useState(0);

  // Load services and set activeServiceId when session changes
  useEffect(() => {
    if (!session || !supabase) return;
    
    (async () => {
      try {
        const { data, error } = await supabase.functions.invoke("services-list");
        if (error || !data?.services) {
          return;
        }
        
        const servicesList = (data.services as Array<{ service_id: string; service_name: string; role: string }>) || [];
        if (servicesList.length === 0) {
          return;
        }
        
        setServices(servicesList);
        
        // If activeServiceId is null, try to restore from localStorage or use first service
        if (!activeServiceId) {
          try {
            const stored = localStorage.getItem(STORAGE_KEYS.ACTIVE_SERVICE_ID);
            const isValidStored = stored && servicesList.some(s => s.service_id === stored);
            
            if (isValidStored) {
              setActiveServiceId(stored);
            } else {
              setActiveServiceId(servicesList[0].service_id);
            }
          } catch {
            setActiveServiceId(servicesList[0].service_id);
          }
        } else {
          // Validate that current activeServiceId exists in services list
          const isValid = servicesList.some(s => s.service_id === activeServiceId);
          if (!isValid) {
            // Current activeServiceId is invalid, use first service
            setActiveServiceId(servicesList[0].service_id);
          }
        }
      } catch (err) {
        console.error("[App] Error loading services:", err);
      }
    })();
  }, [session, supabase]);

  // Clear service-scoped cache when activeServiceId changes
  useEffect(() => {
    const prevServiceId = prevActiveServiceIdRef.current;
    if (prevServiceId !== activeServiceId) {
      clearOnServiceChange(prevServiceId, activeServiceId);
      prevActiveServiceIdRef.current = activeServiceId;
    }
  }, [activeServiceId]);

  // Persist activeServiceId to localStorage when it changes
  useEffect(() => {
    if (activeServiceId) {
      try {
        localStorage.setItem(STORAGE_KEYS.ACTIVE_SERVICE_ID, activeServiceId);
      } catch (err) {
        console.error("[App] Error saving activeServiceId to localStorage:", err);
      }
    }
  }, [activeServiceId]);

  // Apply global UI scale (for all pages)
  useEffect(() => {
    const s = uiCfg.app.uiScale ?? 1;
    document.documentElement.style.fontSize = `${16 * s}px`;
  }, [uiCfg.app.uiScale]);

  // React to UI settings changes (Settings will dispatch "jobsheet:ui-updated")
  useEffect(() => {
    const onUiUpdated = () => setUiCfg(safeLoadUIConfig());
    const onStorage = (e: StorageEvent) => {
      if (e.key === STORAGE_KEYS.UI_SETTINGS) setUiCfg(safeLoadUIConfig());
    };

    window.addEventListener("jobsheet:ui-updated" as any, onUiUpdated);
    window.addEventListener("storage", onStorage);

    return () => {
      window.removeEventListener("jobsheet:ui-updated" as any, onUiUpdated);
      window.removeEventListener("storage", onStorage);
    };
  }, []);

  // Orders → publish draft badge count
  useEffect(() => {
    const onDraft = (e: any) => {
      setDraftCount(Number(e?.detail?.count ?? 0));
    };
    window.addEventListener("jobsheet:draft-count" as any, onDraft);
    return () => window.removeEventListener("jobsheet:draft-count" as any, onDraft);
  }, []);

  // Customers → request new order (prefill and redirect to Orders)
  useEffect(() => {
    const onReq = (e: any) => {
      const customerId = e?.detail?.customerId as string | undefined;
      if (activePage !== "orders") {
        setNewOrderPrefill(customerId ? { customerId } : {});
        setActivePage("orders");
      } else {
        setNewOrderPrefill(customerId ? { customerId } : {});
      }
    };
    window.addEventListener("jobsheet:request-new-order" as any, onReq);
    return () => window.removeEventListener("jobsheet:request-new-order" as any, onReq);
  }, [activePage]);

  // Handle invite acceptance after login
  useEffect(() => {
    if (!authenticated || !supabase) return;

      const handleInvite = async () => {
    const token = getPendingInviteToken();
      if (!token || !supabase) return;

      try {
        const { data: sessionData } = await supabase.auth.getSession();
        const accessToken = sessionData?.session?.access_token;
        if (!accessToken) {
          console.error("[App] No access token for invite-accept");
          return;
        }

        console.log("[App] Calling invite-accept Edge Function", { 
          tokenPreview: token.substring(0, 8) + "...",
          hasAccessToken: !!accessToken,
        });
        // Standardní volání - Supabase JS automaticky přidá session JWT
        const { data, error } = await supabase.functions.invoke("invite-accept", {
          body: { token },
          // žádné headers - Supabase JS automaticky přidá session JWT
        });

        console.log("[App] invite-accept response", { 
          data, 
          error,
          hasServiceId: !!data?.serviceId,
        });

        if (error) {
          const res = (error as any)?.context as Response | undefined;
          let detail = "";
          if (res) {
            try {
              detail = await res.clone().text();
            } catch {}
          }
          console.error("[App] invite-accept error", { error, detail });
          showToast(`Chyba při přijetí pozvánky: ${error.message}${detail ? " | " + detail : ""}`, "error");
          return;
        }

        if (data?.serviceId) {
          showToast("Pozvánka byla přijata", "success");
          clearPendingInviteToken();
        }
      } catch (err) {
        const errorMessage = err instanceof Error ? err.message : "Neznámá chyba";
        console.error("[App] invite-accept exception", err);
        showToast(`Chyba při přijetí pozvánky: ${errorMessage}`, "error");
      }
    };

    handleInvite();
  }, [authenticated]);

  const pageTitle = useMemo(() => {
    switch (activePage) {
      case "orders":
        return "Orders";
      case "inventory":
        return "Inventory";
      case "devices":
        return "Zařízení";
      case "customers":
        return "Customers";
      case "statistics":
        return "Statistiky";
      case "settings":
        return "Settings";
      case "guide":
        return "Návod";
      default:
        return "jobi";
    }
  }, [activePage]);

  // Check if we're on preview route
  const isPreviewRoute = typeof window !== "undefined" && window.location.pathname === "/preview";

  if (isPreviewRoute) {
    // Render Preview without layout
    return (
      <ThemeProvider>
        <Preview />
      </ThemeProvider>
    );
  }

  // Guard: session must exist to render app shell (Sidebar, Orders, Customers, Settings)
  if (!session) {
    return (
      <ThemeProvider>
        <OnlineGate>
          <Login
            onLogin={() => {
              setAuthenticated(true);
              setAuthenticatedState(true);
            }}
          />
        </OnlineGate>
      </ThemeProvider>
    );
  }

  // App shell - only rendered when session exists
  return (
    <ThemeProvider>
      <ThemeAnimations />
      <OnlineGate>
        <StatusesProvider activeServiceId={activeServiceId}>
        <AppLayout 
          pageTitle={pageTitle} 
          activePage={activePage} 
          onNavigate={setActivePage}
          userEmail={session?.user?.email || null}
          onSignOut={async () => {
            // Sign out is handled in AppLayout.handleSignOut
          }}
          services={services}
          activeServiceId={activeServiceId}
          setActiveServiceId={setActiveServiceId}
        >
            {activePage === "orders" && (
              <Orders
              activeServiceId={activeServiceId}
                newOrderPrefill={newOrderPrefill}
                onNewOrderPrefillConsumed={() => setNewOrderPrefill(null)}
                openTicketIntent={openTicketIntent}
                onOpenTicketIntentConsumed={() => setOpenTicketIntent(null)}
                onOpenCustomer={(customerId) => {
                  setOpenCustomerIntent({ customerId });
                  setActivePage("customers");
                }}
                onReturnToPage={(page, customerId) => {
                  setActivePage(page);
                  // If returning to customers and customerId is provided, open that customer
                  if (page === "customers" && customerId) {
                    setOpenCustomerIntent({ customerId });
                  }
                }}
              />
            )}

          {activePage === "customers" && (
            <Customers
              activeServiceId={activeServiceId}
              openCustomerIntent={openCustomerIntent}
              onOpenCustomerIntentConsumed={() => setOpenCustomerIntent(null)}
              openTicketIntent={openTicketIntent}
              onOpenTicketIntentConsumed={() => setOpenTicketIntent(null)}
                onOpenTicket={(ticketId, mode, returnToCustomerId) => {
                // Navigate to Orders and open ticket detail there (same as clicking in Orders)
                // Mark that we should return to customers when ticket is closed
                setOpenTicketIntent({ 
                  ticketId, 
                  mode: mode ?? "detail", 
                  returnToPage: "customers",
                  returnToCustomerId: returnToCustomerId
                });
                setActivePage("orders");
              }}
            />
          )}

          {activePage === "inventory" && <Inventory />}

          {activePage === "devices" && <Devices />}

          {activePage === "statistics" && <Statistics />}

          {activePage === "settings" && <Settings activeServiceId={activeServiceId} setActiveServiceId={setActiveServiceId} services={services} />}

          {activePage === "guide" && <Guide onNavigate={setActivePage} />}

          {!["orders", "settings", "customers", "devices", "inventory", "statistics", "guide"].includes(activePage) && (
            <div
              style={{
                background: "var(--panel)",
                backdropFilter: "var(--blur)",
                WebkitBackdropFilter: "var(--blur)",
                border: "1px solid var(--border)",
                borderRadius: "var(--radius-lg)",
                padding: "var(--pad-24)",
                boxShadow: "var(--shadow-soft)",
              }}
            >
              <div style={{ fontWeight: 800, fontSize: 16, color: "var(--text)" }}>{pageTitle}</div>
              <div style={{ color: "var(--muted)", marginTop: 6 }}>Placeholder page.</div>
            </div>
          )}

          {/* Global FAB (all pages) */}
          {uiCfg.app.fabNewOrderEnabled !== false && (
            <button
              type="button"
              onClick={() => {
                window.dispatchEvent(new CustomEvent("jobsheet:request-new-order", { detail: {} }));
              }}
              title="Nová zakázka"
              style={{
                position: "fixed",
                right: 22,
                bottom: 22,
                width: 56,
                height: 56,
                borderRadius: 999,
                border: "none",
                background: "linear-gradient(135deg, var(--accent), var(--accent-hover))",
                color: "white",
                fontWeight: 950,
                cursor: "pointer",
                boxShadow: `0 20px 50px var(--accent-glow)`,
                zIndex: 12000,
                display: "grid",
                placeItems: "center",
                fontFamily: "system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif",
                transition: "var(--transition-smooth)",
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.transform = "scale(1.1) translateY(-2px)";
                e.currentTarget.style.boxShadow = `0 24px 60px var(--accent-glow)`;
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.transform = "scale(1) translateY(0)";
                e.currentTarget.style.boxShadow = `0 20px 50px var(--accent-glow)`;
              }}
            >
              <span style={{ fontSize: 24, lineHeight: 1, transform: "translateY(-1px)" }}>+</span>

              {draftCount > 0 && (
                <span
                  style={{
                    position: "absolute",
                    top: -4,
                    right: -4,
                    width: 20,
                    height: 20,
                    borderRadius: 999,
                    background: "rgba(239,68,68,0.95)",
                    border: "2px solid var(--panel)",
                    display: "grid",
                    placeItems: "center",
                    fontSize: 12,
                    fontWeight: 950,
                    color: "white",
                    boxShadow: "var(--shadow-soft)",
                  }}
                >
                  {draftCount}
                </span>
              )}
            </button>
          )}
          </AppLayout>
          <ToastContainer />
        </StatusesProvider>
      </OnlineGate>
    </ThemeProvider>
  );
}
