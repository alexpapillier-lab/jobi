import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import Orders from "./pages/Orders";
import Settings from "./pages/Settings";
import Customers from "./pages/Customers";
import Devices from "./pages/Devices";
import Inventory from "./pages/Inventory";
import Statistics from "./pages/Statistics";
import Preview from "./pages/Preview";

import { ThemeProvider } from "./theme/ThemeProvider";
import { AppLayout } from "./layout/AppLayout";
import type { NavKey } from "./layout/Sidebar";
import { StatusesProvider } from "./state/StatusesStore";
import { ToastContainer } from "./components/Toast";
import { Login, isAuthenticated, setAuthenticated } from "./components/Login";
import { OnlineGate } from "./components/OnlineGate";
import { ThemeAnimations } from "./components/ThemeAnimations";
import { AppTourOverlay, type TourStep } from "./components/AppTourOverlay";
import { ConfirmDialog } from "./components/ConfirmDialog";
import { supabase } from "./lib/supabaseClient";
import { getPendingInviteToken, clearPendingInviteToken } from "./lib/pendingInvite";
import { showToast } from "./components/Toast";
import { useAuth } from "./auth/AuthProvider";
import { useUserProfile } from "./hooks/useUserProfile";
import { clearOnServiceChange } from "./lib/storageInvalidation";
import { pushContextToJobiDocs, openJobiDocsDownload } from "./lib/jobidocs";
import { getLogoColors, LOGO_PRESETS } from "./lib/logoPresets";
import type { LogoPresetId } from "./lib/logoPresets";
import type { ThemeMode } from "./theme/ThemeProvider";
import { STORAGE_KEYS } from "./constants/storageKeys";
import { safeLoadDocumentsConfig, safeLoadCompanyData } from "./pages/Orders";
import { useCheckForAppUpdate } from "./hooks/useCheckForAppUpdate";
import { setAppIconFromPreset } from "./lib/setAppIcon";
import {
  getShortcut,
  comboMatchesEvent,
  isInputFocused,
  formatShortcutForDisplay,
  SHORTCUT_LABELS,
  ALL_SHORTCUT_IDS,
  type ShortcutId,
} from "./lib/keyboardShortcuts";

type OpenTicketIntent = {
  ticketId: string;
  mode?: "panel" | "detail";
  returnToPage?: NavKey; // Page to return to when ticket is closed
  returnToCustomerId?: string; // Customer ID to open when returning to customers page
};

type OpenCustomerIntent = {
  customerId: string;
};

const ORDERS_PAGE_SIZE_OPTIONS = [25, 50, 100, 200] as const;
type UIConfig = {
  app: { fabNewOrderEnabled: boolean; uiScale: number };
  home: { orderFilters: { selectedQuickStatusFilters: string[] } };
  orders: { displayMode: "list" | "grid" | "compact"; pageSize: number };
};

function defaultUIConfig(): UIConfig {
  return {
    app: { fabNewOrderEnabled: true, uiScale: 1 },
    home: { orderFilters: { selectedQuickStatusFilters: [] } },
    orders: { displayMode: "list", pageSize: 50 },
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
    const pageSize = parsed?.orders?.pageSize;
    const validPageSize = typeof pageSize === "number" && (pageSize === 0 || ORDERS_PAGE_SIZE_OPTIONS.includes(pageSize as any))
      ? pageSize
      : d.orders.pageSize;

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
        displayMode: displayMode === "list" || displayMode === "grid" || displayMode === "compact" || displayMode === "compact-extra" ? displayMode : d.orders.displayMode,
        pageSize: validPageSize,
      },
    };
  } catch {
    return defaultUIConfig();
  }
}

export default function App() {
  const { session } = useAuth();
  const { profile: userProfile } = useUserProfile();
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

  // Průvodce aplikací (krok za krokem po stránkách)
  const [isTourActive, setIsTourActive] = useState(false);
  const [tourStep, setTourStep] = useState(0);
  // Jednorázové okno po skončení průvodce: je potřeba stáhnout JobiDocs
  const [showJobiDocsDownloadPrompt, setShowJobiDocsDownloadPrompt] = useState(false);

  // Nápověda klávesových zkratek (?)
  const [shortcutsHelpOpen, setShortcutsHelpOpen] = useState(false);
  const TOUR_STEPS: TourStep[] = useMemo(
    () => [
      {
        page: "orders",
        title: "Zakládání nové zakázky",
        description:
          "Tlačítko „+ Nová zakázka“ otevře formulář pro vytvoření zakázky. Vyplňte zákazníka (telefon, jméno), zařízení a popis. Pokud zákazník s daným telefonem už existuje, aplikace ho nabídne k přiřazení. Novou zakázku můžete založit i plovoucím tlačítkem + vpravo dole na jakékoli stránce.",
        selector: "[data-tour=\"orders-new-btn\"]",
      },
      {
        page: "orders",
        title: "Zakázky – vyhledávání",
        description:
          "Do pole vyhledávání zadejte jméno, telefon, zařízení nebo text z poznámky. Seznam zakázek se filtruje v reálném čase.",
        selector: "[data-tour=\"orders-search\"]",
      },
      {
        page: "orders",
        title: "Zakázky – záložky Vše / Aktivní / Final",
        description:
          "Přepínejte mezi všemi zakázkami, jen aktivními (rozpracovanými) nebo finalizovanými. Usnadní to orientaci při velkém počtu zakázek.",
        selector: "[data-tour=\"orders-groups\"]",
      },
      {
        page: "orders",
        title: "Zakázky – filtry podle stavu",
        description:
          "Rychlé filtry podle stavu zakázky (Přijato, V opravě, Hotovo atd.). Stavů můžete mít více a měnit je v Nastavení.",
        selector: "[data-tour=\"orders-filters\"]",
      },
      {
        page: "orders",
        title: "Zakázky – seznam",
        description:
          "Kliknutím na řádek otevřete detail zakázky. V detailu měníte stav, údaje o zákazníkovi, zařízení, ceny a provedené opravy.",
        selector: "[data-tour=\"orders-list\"]",
      },
      {
        page: "orders",
        title: "Stav vpravo nahoře – JobiDocs",
        description:
          "Indikátor „JobiDocs ✓/✗“ vpravo nahoře ukazuje, zda je aplikace JobiDocs spuštěná a připojená. JobiDocs slouží k tisku a exportu PDF (zakázkové listy, diagnostické protokoly, záruční listy). Pokud je „✗“, spusťte JobiDocs – bez něj nelze tisknout ani exportovat do PDF.",
        selector: "[data-tour=\"header-jobidocs\"]",
      },
      {
        page: "orders",
        title: "Plovoucí tlačítko +",
        description:
          "Tlačítko + vpravo dole je dostupné na všech stránkách – rychle otevře formulář nové zakázky bez přepnutí na Zakázky. Lze vypnout v Nastavení → Vzhled.",
        selector: "[data-tour=\"orders-fab\"]",
      },
      {
        page: "customers",
        title: "Zákazníci – vyhledávání",
        description:
          "Vyhledávejte zákazníky podle jména, telefonu, e-mailu nebo firmy. Seznam vlevo se okamžitě filtruje.",
        selector: "[data-tour=\"customers-search\"]",
      },
      {
        page: "customers",
        title: "Zákazníci – seznam a detail",
        description:
          "Vlevo seznam zákazníků, vpravo detail vybraného. V detailu upravíte údaje, založíte zakázku nebo zobrazíte historii zakázek.",
        selector: "[data-tour=\"customers-content\"]",
      },
      {
        page: "inventory",
        title: "Sklad – přehled",
        description:
          "Skladové položky (produkty) a jejich propojení s modely zařízení. Ceny, zásoby a přiřazení k opravám. Návod k importu a formátu souboru najdete na této stránce po kliknutí na tlačítko „Import“.",
        selector: "[data-tour=\"inventory-main\"]",
      },
      {
        page: "inventory",
        title: "Sklad – Import a návod",
        description:
          "Tlačítko „Import“ otevře nahrání TXT souboru s produkty a návod k použití (struktura PRODUKT:, MODELY:, oddělovač ---). Vzorový soubor si můžete stáhnout přímo v té sekci.",
        selector: "[data-tour=\"inventory-import\"]",
      },
      {
        page: "devices",
        title: "Zařízení – katalog",
        description:
          "Značky, kategorie a modely zařízení. U každého modelu můžete definovat opravy a ceny. Při zakázce pak vyberete model a přiřadíte opravy.",
        selector: "[data-tour=\"devices-main\"]",
      },
      {
        page: "statistics",
        title: "Statistiky – období a režimy",
        description:
          "Výběr časového období (Vše, Dnes, Týden, Měsíc, Rok, Vlastní) a režim zobrazení: Karty, Tabulka nebo Grafy. Data se načítají z vašich zakázek v cloudu.",
        selector: "[data-tour=\"statistics-period\"]",
      },
      {
        page: "statistics",
        title: "Statistiky – grafy",
        description:
          "V režimu „Grafy“ uvidíte sloupcové grafy: zakázky podle statusu a příjem podle měsíců. Přepnutí na Karty zobrazí přehledové karty a tabulku zakázek.",
        selector: "[data-tour=\"statistics-view-charts\"]",
      },
      {
        page: "settings",
        title: "Nastavení – záložky",
        description:
          "V horní řadě přepínejte mezi sekcemi: Servis (údaje, tým, Owner), Zakázky (statusy, filtry), Vzhled a chování, Můj profil, O aplikaci.",
        selector: "[data-tour=\"settings-categories\"]",
      },
      {
        page: "settings",
        title: "Nastavení – Statusy zakázek",
        description:
          "V záložce Zakázky vyberte „Statusy zakázek“. Zde přidáváte a upravujete stavy (Přijato, V opravě, Hotovo…), barvy z palety a označení finálního stavu.",
        selector: "[data-tour=\"settings-sub-orders_statuses\"]",
        settingsSection: { category: "orders", subsection: "orders_statuses" },
      },
      {
        page: "settings",
        title: "Nastavení – Vzhled a rozhraní",
        description:
          "V záložce „Vzhled a chování“ → „Rozhraní“ nastavíte plovoucí tlačítko +, povinný telefon u zakázky, způsob zobrazení zakázek (seznam/mřížka) a zvuky.",
        selector: "[data-tour=\"settings-sub-appearance_ui\"]",
        settingsSection: { category: "appearance", subsection: "appearance_ui" },
      },
      {
        page: "settings",
        title: "Nastavení – Barevné téma",
        description:
          "V „Vzhled a chování“ → „Barevné téma“ přepínáte mezi světlým a tmavým režimem aplikace.",
        selector: "[data-tour=\"settings-sub-appearance_theme\"]",
        settingsSection: { category: "appearance", subsection: "appearance_theme" },
      },
      {
        page: "settings",
        title: "Nastavení – O aplikaci a průvodce",
        description:
          "Záložka „O aplikaci“: verze, údaje pro podporu a tlačítko „Spustit průvodce“, kterým jste tento průvodce spustili.",
        selector: "[data-tour=\"settings-sub-about_app\"]",
        settingsSection: { category: "about", subsection: "about_app" },
      },
    ],
    []
  );
  const startTour = useCallback(() => {
    setIsTourActive(true);
    setTourStep(0);
    setActivePage(TOUR_STEPS[0].page);
  }, [TOUR_STEPS]);

  const onTourEnded = useCallback(() => {
    try {
      if (!localStorage.getItem(STORAGE_KEYS.JOBIDOCS_DOWNLOAD_PROMPT_SEEN)) {
        setShowJobiDocsDownloadPrompt(true);
      }
    } catch {
      // ignore
    }
  }, []);

  const tourOnNext = useCallback(() => {
    if (tourStep >= TOUR_STEPS.length - 1) {
      setIsTourActive(false);
      onTourEnded();
      return;
    }
    const next = tourStep + 1;
    setTourStep(next);
    setActivePage(TOUR_STEPS[next].page);
  }, [tourStep, TOUR_STEPS, onTourEnded]);
  const tourOnPrev = useCallback(() => {
    if (tourStep <= 0) return;
    const prev = tourStep - 1;
    setTourStep(prev);
    setActivePage(TOUR_STEPS[prev].page);
  }, [tourStep, TOUR_STEPS]);
  const tourOnClose = useCallback(() => {
    setIsTourActive(false);
    onTourEnded();
  }, [onTourEnded]);

  // Load services and set activeServiceId when session changes
  const servicesListRunRef = useRef(0);
  useEffect(() => {
    if (!session || !supabase) return;
    const runId = ++servicesListRunRef.current;
    (async () => {
      try {
        // Explicitní JWT v hlavičce (v Tauri jinak často 401 Invalid JWT – stejně jako u týmových funkcí)
        const { data: sessionData } = await supabase.auth.getSession();
        if (runId !== servicesListRunRef.current) return;
        const accessToken = sessionData?.session?.access_token;
        const { data, error } = await supabase.functions.invoke("services-list", {
          ...(accessToken ? { headers: { Authorization: `Bearer ${accessToken}` } } : {}),
        });
        if (runId !== servicesListRunRef.current) return;
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
            setActiveServiceId(servicesList[0].service_id);
          }
        }
      } catch (err) {
        if (runId === servicesListRunRef.current) {
          console.error("[App] Error loading services:", err);
        }
      }
    })();
  }, [session, supabase]);

  const refreshServices = useCallback(async () => {
    if (!session?.user?.id || !supabase) return;
    try {
      const { data: sessionData } = await supabase.auth.getSession();
      const accessToken = sessionData?.session?.access_token;
      const { data, error } = await supabase.functions.invoke("services-list", {
        ...(accessToken ? { headers: { Authorization: `Bearer ${accessToken}` } } : {}),
      });
      if (error || !data?.services) return;
      const list = (data.services as Array<{ service_id: string; service_name: string; role: string }>) || [];
      if (list.length > 0) {
        setServices(list);
        const currentActive = activeServiceId;
        const isValid = currentActive && list.some((s) => s.service_id === currentActive);
        if (!isValid) setActiveServiceId(list[0].service_id);
      }
    } catch (err) {
      console.error("[App] refreshServices error:", err);
    }
  }, [session, supabase, activeServiceId]);

  // Push services + activeServiceId + documentsConfig + companyData + jobidocsLogo to JobiDocs (JobiDocs logo vždy podle tématu)
  useEffect(() => {
    if (services.length === 0) return;
    const theme = (localStorage.getItem("jobsheet_theme") || "light") as ThemeMode;
    let jobidocsLogo = getLogoColors(theme, "auto");
    jobidocsLogo = { ...jobidocsLogo, foreground: jobidocsLogo.background };

    const documentsConfig = safeLoadDocumentsConfig();
    const companyData = safeLoadCompanyData();
    pushContextToJobiDocs(services, activeServiceId, {
      documentsConfig: documentsConfig ?? null,
      companyData: companyData ?? null,
      jobidocsLogo,
    });
    const id = setInterval(() => {
      const doc = safeLoadDocumentsConfig();
      const comp = safeLoadCompanyData();
      const t = (localStorage.getItem("jobsheet_theme") || "light") as ThemeMode;
      let logo = getLogoColors(t, "auto");
      logo = { ...logo, foreground: logo.background };
      pushContextToJobiDocs(services, activeServiceId, {
        documentsConfig: doc ?? null,
        companyData: comp ?? null,
        jobidocsLogo: logo,
      });
    }, 5000);
    return () => clearInterval(id);
  }, [services, activeServiceId]);

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

  // Globální klávesové zkratky: nápověda (?) a navigace (Q, S, D, C, Ctrl+ř, Ctrl+,)
  // document i window, capture phase – v Tauri/Electron může keydown chodit jen na document
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!session) return;
      if (shortcutsHelpOpen && e.key === "Escape") {
        setShortcutsHelpOpen(false);
        e.preventDefault();
        return;
      }
      if (shortcutsHelpOpen) return;
      if (document.body.dataset.jobsheetShortcutsConfig === "true") return;
      if (isInputFocused()) return;
      const navMap: Record<string, NavKey> = {
        nav_orders: "orders",
        nav_inventory: "inventory",
        nav_devices: "devices",
        nav_customers: "customers",
        nav_statistics: "statistics",
        nav_settings: "settings",
      };
      for (const [id, page] of Object.entries(navMap)) {
        if (comboMatchesEvent(e, getShortcut(id as ShortcutId))) {
          e.preventDefault();
          e.stopPropagation();
          setActivePage(page);
          return;
        }
      }
      if (comboMatchesEvent(e, getShortcut("help"))) {
        e.preventDefault();
        setShortcutsHelpOpen(true);
        return;
      }
    };
    document.addEventListener("keydown", onKey, true);
    window.addEventListener("keydown", onKey, true);
    return () => {
      document.removeEventListener("keydown", onKey, true);
      window.removeEventListener("keydown", onKey, true);
    };
  }, [session, shortcutsHelpOpen]);

  // Navigace ze zkratek – Orders posílá jobsheet:navigate (window i document)
  useEffect(() => {
    const onNav = (e: Event) => {
      const ev = e as CustomEvent<{ page: NavKey }>;
      const page = ev.detail?.page;
      if (page && ["orders", "inventory", "devices", "customers", "statistics", "settings"].includes(page)) {
        setActivePage(page);
      }
    };
    window.addEventListener("jobsheet:navigate" as any, onNav);
    document.addEventListener("jobsheet:navigate" as any, onNav);
    return () => {
      window.removeEventListener("jobsheet:navigate" as any, onNav);
      document.removeEventListener("jobsheet:navigate" as any, onNav);
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
          clearPendingInviteToken();
          showToast("Pozvánka přijata", "success");
          await refreshServices();
          setActiveServiceId(data.serviceId);
        }
      } catch (err) {
        const errorMessage = err instanceof Error ? err.message : "Neznámá chyba";
        console.error("[App] invite-accept exception", err);
        showToast(`Chyba při přijetí pozvánky: ${errorMessage}`, "error");
      }
    };

    handleInvite();
  }, [authenticated, refreshServices, setActiveServiceId]);

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
      default:
        return "jobi";
    }
  }, [activePage]);

  // OTA: check once when app is ready (Tauri only). Must be called unconditionally (hooks order).
  useCheckForAppUpdate();

  // Apply saved logo preset to app (Dock) icon on startup (Tauri/macOS only).
  useEffect(() => {
    const preset = localStorage.getItem(STORAGE_KEYS.LOGO_PRESET) as LogoPresetId | null;
    const theme = (localStorage.getItem("jobsheet_theme") || "light") as ThemeMode;
    const effective: LogoPresetId =
      preset && (preset === "auto" || LOGO_PRESETS.some((p) => p.id === preset))
        ? preset
        : "auto";
    setAppIconFromPreset(effective, theme);
  }, []);

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
        <AppTourOverlay
          active={isTourActive}
          stepIndex={tourStep}
          steps={TOUR_STEPS}
          activePage={activePage}
          onNext={tourOnNext}
          onPrev={tourOnPrev}
          onClose={tourOnClose}
        />
        <ConfirmDialog
          open={showJobiDocsDownloadPrompt}
          title="Stáhnout JobiDocs"
          message="Pro tisk a export PDF je potřeba aplikace JobiDocs. Chcete ji stáhnout a nainstalovat?"
          confirmLabel="Stáhnout"
          cancelLabel="Později"
          onConfirm={async () => {
            await openJobiDocsDownload();
            try {
              localStorage.setItem(STORAGE_KEYS.JOBIDOCS_DOWNLOAD_PROMPT_SEEN, "1");
            } catch {
              // ignore
            }
            setShowJobiDocsDownloadPrompt(false);
          }}
          onCancel={() => {
            try {
              localStorage.setItem(STORAGE_KEYS.JOBIDOCS_DOWNLOAD_PROMPT_SEEN, "1");
            } catch {
              // ignore
            }
            setShowJobiDocsDownloadPrompt(false);
          }}
        />
        <AppLayout 
          pageTitle={pageTitle} 
          activePage={activePage} 
          onNavigate={setActivePage}
          userEmail={session?.user?.email || null}
          userProfile={userProfile ? { nickname: userProfile.nickname, avatarUrl: userProfile.avatarUrl } : null}
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

          {activePage === "inventory" && <Inventory activeServiceId={activeServiceId} />}

          {activePage === "devices" && <Devices />}

          {activePage === "statistics" && (
            <Statistics
              activeServiceId={activeServiceId}
              onOpenTicket={(ticketId) => {
                setOpenTicketIntent({ ticketId, mode: "detail", returnToPage: "statistics" });
                setActivePage("orders");
              }}
            />
          )}

          {activePage === "settings" && (
            <Settings
              activeServiceId={activeServiceId}
              setActiveServiceId={setActiveServiceId}
              services={services}
              refreshServices={refreshServices}
              onStartTour={startTour}
              tourSection={
                isTourActive && TOUR_STEPS[tourStep]?.page === "settings" && TOUR_STEPS[tourStep].settingsSection
                  ? TOUR_STEPS[tourStep].settingsSection!
                  : null
              }
            />
          )}

          {!["orders", "settings", "customers", "devices", "inventory", "statistics"].includes(activePage) && (
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

          {/* Global FAB (all pages) – portál do body, aby position:fixed nebylo ovlivněno scroll kontejnerem */}
          {uiCfg.app.fabNewOrderEnabled !== false &&
            createPortal(
              <button
                type="button"
                data-tour="orders-fab"
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
              </button>,
              document.body
            )}

          {shortcutsHelpOpen &&
            createPortal(
              <div
                role="dialog"
                aria-label="Nápověda klávesových zkratek"
                style={{
                  position: "fixed",
                  inset: 0,
                  zIndex: 15000,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  padding: 24,
                  background: "rgba(0,0,0,0.5)",
                  backdropFilter: "blur(4px)",
                }}
                onClick={() => setShortcutsHelpOpen(false)}
              >
                <div
                  style={{
                    background: "var(--panel)",
                    border: "1px solid var(--border)",
                    borderRadius: "var(--radius-lg)",
                    boxShadow: "var(--shadow)",
                    maxWidth: 480,
                    width: "100%",
                    maxHeight: "80vh",
                    overflow: "auto",
                    padding: 24,
                  }}
                  onClick={(e) => e.stopPropagation()}
                >
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
                    <h2 style={{ margin: 0, fontSize: 18, fontWeight: 800, color: "var(--text)" }}>Klávesové zkratky</h2>
                    <button
                      type="button"
                      onClick={() => setShortcutsHelpOpen(false)}
                      style={{
                        border: "none",
                        background: "var(--panel-2)",
                        color: "var(--text)",
                        padding: "8px 12px",
                        borderRadius: 8,
                        cursor: "pointer",
                        fontWeight: 600,
                      }}
                    >
                      Zavřít
                    </button>
                  </div>
                  <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                    {ALL_SHORTCUT_IDS.map((id) => (
                      <div
                        key={id}
                        style={{
                          display: "flex",
                          justifyContent: "space-between",
                          alignItems: "center",
                          gap: 16,
                          padding: "8px 0",
                          borderBottom: "1px solid var(--border)",
                        }}
                      >
                        <span style={{ color: "var(--text)", fontSize: 14 }}>{SHORTCUT_LABELS[id]}</span>
                        <kbd
                          style={{
                            padding: "4px 8px",
                            background: "var(--bg)",
                            border: "1px solid var(--border)",
                            borderRadius: 6,
                            fontSize: 12,
                            fontFamily: "monospace",
                            whiteSpace: "nowrap",
                          }}
                        >
                          {formatShortcutForDisplay(getShortcut(id))}
                        </kbd>
                      </div>
                    ))}
                  </div>
                </div>
              </div>,
              document.body
            )}
          </AppLayout>
          <ToastContainer />
        </StatusesProvider>
      </OnlineGate>
    </ThemeProvider>
  );
}
