import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Rezervace } from "./lib/rezervace";
import { useIsNarrow } from "./hooks/useIsNarrow";
import { createPortal } from "react-dom";
import Orders from "./pages/Orders";
import Settings, { type SettingsCategory, type SettingsSubsection } from "./pages/Settings";
import Customers from "./pages/Customers";
import Devices from "./pages/Devices";
import Inventory from "./pages/Inventory";
import Statistics from "./pages/Statistics";
import { ProvizeSdilene } from "./pages/ProvizeSdilene";
import { Odmeny } from "./pages/Odmeny";
import { UDALOST_ZMENY_CONFIGU, nactiServiceConfig, subscribeServiceConfig } from "./lib/serviceSettingsSync";
import { normalizujOdmeny } from "./lib/odmeny";
import { AKTUALNI_BUILD, strankaPoObnove, useAktualizaceWebu } from "./lib/aktualizaceWebu";
import { kPripomenuti, prevedPlatbu } from "./lib/platbyServisu";
import Calendar from "./pages/Calendar";
import Invoices from "./pages/Invoices";
import SmsChatsPage from "./pages/SmsChatsPage";
import Zasilky from "./pages/Zasilky";
import { useZasilkyZapnuty } from "./hooks/useZasilkyZapnuty";

import { ThemeProvider } from "./theme/ThemeProvider";
import { useIsRootOwner } from "./hooks/useIsRootOwner";
import { FirstServiceSetup } from "./components/FirstServiceSetup";
import { TrialEnded } from "./components/TrialEnded";
import { AppLayout } from "./layout/AppLayout";
import type { NavKey } from "./layout/Sidebar";
import { StatusesProvider } from "./state/StatusesStore";
import { ToastContainer } from "./components/Toast";
import { Login, isAuthenticated, setAuthenticated } from "./components/Login";
import { OnlineGate } from "./components/OnlineGate";
import { NeulozeneZmeny } from "./components/NeulozeneZmeny";
import { PrepinacUctu } from "./components/PrepinacUctu";
import { ChatPlovouci } from "./components/chat/ChatPlovouci";
import { useChatZapnuty } from "./hooks/useChatZapnuty";
import { CiziServis } from "./components/CiziServis";
import { pouzijMeritko } from "./lib/velikostRozhrani";
import { spustHlidacFronty } from "./lib/frontaZapisu";

/* Fronta neuložených změn běží od startu: co nestihl minulý běh aplikace,
   se dopíše hned, jak je spojení. */
spustHlidacFronty();
import { AppTourOverlay, type TourStep } from "./components/AppTourOverlay";
import { NapovedaPanel } from "./components/NapovedaPanel";
import { PRUVODCI, dostupniPruvodci, nactiStavPruvodcu, nastavStavPruvodcu, oznacProsly, pruvodceProMisto, ulozStavPruvodcu, useStavPruvodcu, zjistiNovinky, type KontextPruvodcu, type Pruvodce } from "./lib/pruvodci";
import { ConfirmDialog } from "./components/ConfirmDialog";
import { supabase } from "./lib/supabaseClient";
import { startServicePresence } from "./lib/presence";
import { jeZvyrazneni, VYCHOZI_ZVYRAZNENI, type ZvyrazneniStavu } from "./lib/zvyrazneniStavu";
import { getPendingInviteToken, clearPendingInviteToken } from "./lib/pendingInvite";
import { showToast, showPersistentToast } from "./components/Toast";
import { useAuth } from "./auth/AuthProvider";
import { useUserProfile } from "./hooks/useUserProfile";
import { clearOnServiceChange } from "./lib/storageInvalidation";
import { pushContextToJobiDocs, openJobiDocsDownload, isJobiDocsRunning, launchJobiDocsApp } from "./lib/jobidocs";
import { isWeb } from "./lib/platform";
import { loadDocumentsConfigRawFromDB } from "./lib/documentSettings";
import { useActiveRole } from "./hooks/useActiveRole";
import { getLogoColors, LOGO_PRESETS } from "./lib/logoPresets";
import type { LogoPresetId } from "./lib/logoPresets";
import type { ThemeMode } from "./theme/ThemeProvider";
import { STORAGE_KEYS } from "./constants/storageKeys";
import { safeLoadCompanyData } from "./lib/companyData";
import { useCheckForAppUpdate } from "./hooks/useCheckForAppUpdate";
import { useSmsNotifications } from "./hooks/useSmsNotifications";
import {
  useGlobalSmsUnreadCount,
  type InboundSmsNavigatePayload,
} from "./hooks/useGlobalSmsUnreadCount";
import { useSmsEnabled } from "./hooks/useSmsEnabled";
import { useEntitlements } from "./hooks/useEntitlements";
import { useAppUpdate } from "./context/AppUpdateContext";
import { BranchProvider } from "./context/BranchContext";
import { setAppIconFromPreset } from "./lib/setAppIcon";
import { startPersonalPreferencesSync } from "./lib/personalPreferencesSync";
import {
  getShortcut,
  formatShortcutForDisplay,
  registerShortcut,
  startShortcutDispatcher,
  SHORTCUT_LABELS,
  ALL_SHORTCUT_IDS,
  type ShortcutId,
} from "./lib/keyboardShortcuts";

type OpenTicketIntent = {
  ticketId: string;
  mode?: "panel" | "detail";
  returnToPage?: NavKey; // Page to return to when ticket is closed
  returnToCustomerId?: string; // Customer ID to open when returning to customers page
  openSmsPanel?: boolean; // When true, open SMS chat panel after opening ticket (e.g. from notification click)
};

type OpenCustomerIntent = {
  customerId: string;
};

type OpenClaimIntent = {
  claimId: string;
  returnToPage?: NavKey;
};

const ORDERS_PAGE_SIZE_OPTIONS = [25, 50, 100, 200] as const;
type DisplayMode = "list" | "grid" | "compact" | "compact-extra" | "timeline" | "stripe" | "status-grouped";
type SidebarPosition = "left" | "right" | "bottom";
const VALID_DISPLAY_MODES: DisplayMode[] = ["list", "grid", "compact", "compact-extra", "timeline", "stripe", "status-grouped"];
const VALID_SIDEBAR_POSITIONS: SidebarPosition[] = ["left", "right", "bottom"];

type UIConfig = {
  app: { fabNewOrderEnabled: boolean; uiScale: number; reducedEffects?: boolean };
  /** `pinned` – lišta trvale rozbalená (viz AppLayout); chybí-li, bere se false. */
  sidebar: { position: SidebarPosition; pinned?: boolean };
  home: { orderFilters: { selectedQuickStatusFilters: string[] } };
  orders: { displayMode: DisplayMode; pageSize: number; zvyrazneniStavu: ZvyrazneniStavu };
  /** Zapnutý modul Faktury (stránka, tlačítka u zakázek). Vypnout, pokud používáte vlastní fakturační systém. */
  invoicingEnabled?: boolean;
};

/**
 * Výchozí stav omezených efektů podle platformy.
 *
 * Na Windows je rozostření za panely (backdrop-filter) prokazatelně drahé –
 * aplikace kvůli němu trhala i v nativním ARM64 buildu, takže to nezpůsobila
 * emulace, ale vykreslování. Windows proto startují s efekty vypnutými;
 * kdo má výkonný stroj, zapne si je v Nastavení → Vzhled → Rozhraní.
 *
 * Na macOS zůstávají zapnuté – tam žádné trhání pozorované nebylo.
 */
function defaultReducedEffects(): boolean {
  if (typeof navigator === "undefined") return false;
  // Web v prohlížeči startuje s omezenými efekty vždy – rozostření tam
  // trhá i na Macu, a kdo má výkonný stroj, zapne si je v Nastavení.
  if (isWeb()) return true;
  return /Windows|Win64|Win32/i.test(navigator.userAgent || "");
}

function defaultUIConfig(): UIConfig {
  return {
    app: { fabNewOrderEnabled: true, uiScale: 1, reducedEffects: defaultReducedEffects() },
    sidebar: { position: "left", pinned: false },
    home: { orderFilters: { selectedQuickStatusFilters: [] } },
    orders: { displayMode: "list", pageSize: 50, zvyrazneniStavu: VYCHOZI_ZVYRAZNENI },
    invoicingEnabled: true,
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
    const sidebarPos = parsed?.sidebar?.position;
    const validPageSize = typeof pageSize === "number" && (pageSize === 0 || ORDERS_PAGE_SIZE_OPTIONS.includes(pageSize as any))
      ? pageSize
      : d.orders.pageSize;

    const invoicingEnabled = parsed?.invoicingEnabled;
    return {
      app: {
        fabNewOrderEnabled: typeof fab === "boolean" ? fab : d.app.fabNewOrderEnabled,
        uiScale: typeof scale === "number" && scale >= 0.85 && scale <= 1.35 ? scale : d.app.uiScale,
        reducedEffects:
          typeof parsed?.app?.reducedEffects === "boolean"
            ? parsed.app.reducedEffects
            : d.app.reducedEffects,
      },
      sidebar: {
        position: VALID_SIDEBAR_POSITIONS.includes(sidebarPos) ? sidebarPos : d.sidebar.position,
        pinned: typeof parsed?.sidebar?.pinned === "boolean" ? parsed.sidebar.pinned : false,
      },
      home: {
        orderFilters: {
          selectedQuickStatusFilters: Array.isArray(quick)
            ? quick.filter((x: any) => typeof x === "string")
            : d.home.orderFilters.selectedQuickStatusFilters,
        },
      },
      orders: {
        displayMode: VALID_DISPLAY_MODES.includes(displayMode) ? displayMode : d.orders.displayMode,
        pageSize: validPageSize,
        zvyrazneniStavu: jeZvyrazneni(parsed?.orders?.zvyrazneniStavu)
          ? parsed.orders.zvyrazneniStavu
          : d.orders.zvyrazneniStavu,
      },
      invoicingEnabled: typeof invoicingEnabled === "boolean" ? invoicingEnabled : true,
    };
  } catch {
    return defaultUIConfig();
  }
}

export default function App() {
  const isNarrowFab = useIsNarrow();
  const { session, initializing: authInitializing } = useAuth();
  const { profile: userProfile } = useUserProfile();
  const [, setAuthenticatedState] = useState(() => isAuthenticated());
  const [activePage, setActivePage] = useState<NavKey>(() => {
    // Po tiché obnově webu (nová verze) se vrátit tam, kde uživatel byl.
    const s = strankaPoObnove();
    const zname: NavKey[] = ["orders", "sms", "calendar", "inventory", "devices", "customers", "invoices", "zasilky", "statistics", "provize", "odmeny", "settings"];
    return s && (zname as string[]).includes(s) ? (s as NavKey) : "orders";
  });
  /* Nová verze webu: v klidné chvíli se záložka obnoví sama, jinak lišta dole. */
  const aktualizaceWebu = useAktualizaceWebu(() => activePage);
  /* Majitel aplikace: po přihlášení jednou denně připomenout servisy, které
     mají zaplatit (Owner → Platby servisů). E-mail chodí zvlášť z cronu. */
  const jeRootOwner = useIsRootOwner();
  useEffect(() => {
    if (!jeRootOwner || !supabase) return;
    const klic = `jobi:platby-pripomenuto:${new Date().toISOString().slice(0, 10)}`;
    try { if (localStorage.getItem(klic)) return; } catch { /* bez úložiště připomenout vždy */ }
    let zruseno = false;
    // deno-lint-ignore no-explicit-any
    void (supabase as any).rpc("platby_prehled").then(({ data }: { data: unknown }) => {
      if (zruseno || !Array.isArray(data)) return;
      const dluzi = kPripomenuti(data.map(prevedPlatbu), new Date());
      if (dluzi.length === 0) return;
      try { localStorage.setItem(klic, "1"); } catch { /* ignorovat */ }
      const text = dluzi.map((d) => `${d.nazev} ${new Intl.NumberFormat("cs-CZ", { maximumFractionDigits: 0 }).format(d.cenaMesicne)} Kč${d.dni > 0 ? ` (${d.dni} dní po splatnosti)` : ""}`).join(", ");
      showPersistentToast(`Platby servisů: ${text}`, "info", {
        actionLabel: "Otevřít Owner",
        onAction: () => {
          setOpenSettingsToSubsection({ category: "company", subsection: "service_owner" });
          setActivePage("settings");
        },
        subtitle: "Zaplacení zapište v Owner → Platby servisů.",
      });
    });
    return () => { zruseno = true; };
  }, [jeRootOwner]);
  // Stránky jednou navštívené zůstávají namountované (jen skryté) – instant přepnutí bez reload
  const [visitedPages, setVisitedPages] = useState<Set<NavKey>>(() => new Set(["orders"]));
  useEffect(() => {
    setVisitedPages((prev) => {
      if (prev.has(activePage)) return prev;
      return new Set([...prev, activePage]);
    });
  }, [activePage]);
  /** Když uživatel klikne „Jít do nastavení“ v toastu aktualizace, otevřeme Settings na této subsekci */
  const [openSettingsToSubsection, setOpenSettingsToSubsection] = useState<{ category: SettingsCategory; subsection: SettingsSubsection } | null>(null);
  const [activeServiceId, setActiveServiceId] = useState<string | null>(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEYS.ACTIVE_SERVICE_ID);
      return stored || null;
    } catch {
      return null;
    }
  });
  const { isAdmin, hasCapability, capabilities } = useActiveRole(activeServiceId);

  // Přítomnost v týmu (zelená tečka v Nastavení → Tým, bubliny „kdo tu je“
  // u zakázky). Jeden kanál na servis, spuštěný tady, aby byl online každý,
  // kdo má appku otevřenou – ne jen ten, kdo má otevřené Nastavení.
  const presenceUserId = session?.user?.id ?? null;
  const presenceNickname = userProfile?.nickname?.trim() || session?.user?.email?.split("@")[0] || "Kolega";
  const presenceAvatarUrl = userProfile?.avatarUrl ?? null;
  useEffect(() => {
    if (!activeServiceId || !presenceUserId) return;
    return startServicePresence(activeServiceId, presenceUserId, { nickname: presenceNickname, avatarUrl: presenceAvatarUrl });
  }, [activeServiceId, presenceUserId, presenceNickname, presenceAvatarUrl]);
  const canManageDocuments = isAdmin || hasCapability("can_manage_documents");
  /* Statistiky ukazují peníze celého servisu – člen je vidí, dokud mu právo
     can_view_statistics někdo neodebere (Nastavení → Tým). Chybějící klíč
     znamená „povoleno“, ne „zakázáno“: statistiky dřív viděl každý a řádek
     bez klíče je starší člen nebo databáze bez migrace – ani jednomu se
     nesmí stránka ztratit. Server to čte stejně; tady jde o to, aby po
     odebrání stránka zmizela z navigace a nešla otevřít zkratkou. */
  const canViewStatistics = isAdmin || capabilities.can_view_statistics !== false;
  /* Servisy, ve kterých majitel aplikace sdílí s tímhle účtem své provize
     (provize_sdileni). Záložka Provize je jen tam – sdílí se jménem účtu,
     ne rolí, takže vlastník servisu ji bez sdílení nevidí. */
  const [provizeSdileneServisy, setProvizeSdileneServisy] = useState<string[]>([]);
  useEffect(() => {
    if (!session?.user?.id || !supabase) {
      setProvizeSdileneServisy([]);
      return;
    }
    let zruseno = false;
    // deno-lint-ignore no-explicit-any
    void (supabase as any).rpc("provize_sdilene_servisy").then(({ data }: { data: string[] | null }) => {
      if (!zruseno) setProvizeSdileneServisy(Array.isArray(data) ? data : []);
    });
    return () => {
      zruseno = true;
    };
  }, [session?.user?.id, activeServiceId]);
  const provizeAvailable = !!activeServiceId && provizeSdileneServisy.includes(activeServiceId);
  /* Odměny týmu: v navigaci podle přepínače v Nastavení → Tým → Odměny za
     opravy (bez přepínače = když existuje aktivní pravidlo). Majitel a
     správce se na stránku dostanou vždy (tlačítko v nastavení), ať si ji
     můžou prohlédnout dřív, než ji ukážou týmu. Config se poslouchá
     v reálném čase, ať se záložka objeví hned. */
  const [odmenyVNavigaci, setOdmenyVNavigaci] = useState(false);
  const odmenyAvailable = odmenyVNavigaci || isAdmin;
  useEffect(() => {
    if (!activeServiceId || !supabase) {
      setOdmenyVNavigaci(false);
      return;
    }
    let zruseno = false;
    const vyhodnot = (raw: unknown) => setOdmenyVNavigaci(normalizujOdmeny(raw).zobrazit_v_navigaci);
    const nacti = () => {
      void nactiServiceConfig(activeServiceId).then((r) => {
        if (!zruseno) vyhodnot(r.stav === "ok" ? r.config.odmeny : undefined);
      });
    };
    nacti();
    const odhlasit = subscribeServiceConfig(activeServiceId, (config) => vyhodnot(config.odmeny), "odmeny");
    // Uložení v Nastavení téhle záložky: znovu načíst hned, bez čekání na realtime.
    const naZmenu = (e: Event) => {
      const d = (e as CustomEvent<{ serviceId?: string; patch?: Record<string, unknown> }>).detail;
      if (d?.serviceId === activeServiceId && d.patch && "odmeny" in d.patch) nacti();
    };
    window.addEventListener(UDALOST_ZMENY_CONFIGU, naZmenu);
    return () => { zruseno = true; odhlasit(); window.removeEventListener(UDALOST_ZMENY_CONFIGU, naZmenu); };
  }, [activeServiceId]);
  const [services, setServices] = useState<Array<{ service_id: string; service_name: string; role: string }>>([]);
  /** Seznam servisů už doběhl – teprve pak má smysl nabízet založení prvního. */
  const [servicesLoaded, setServicesLoaded] = useState(false);

  // Track previous activeServiceId for service change detection
  const prevActiveServiceIdRef = useRef<string | null>(activeServiceId);

  // one-shot intent: navigate to Orders and open a specific ticket
  const [openTicketIntent, setOpenTicketIntent] = useState<OpenTicketIntent | null>(null);
  const [openSmsIntent, setOpenSmsIntent] = useState<{
    phone: string;
    displayName?: string;
    conversationId?: string;
  } | null>(null);
  const smsPanelTicketIdRef = useRef<string | null>(null);
  const clearOpenSmsIntent = useCallback(() => setOpenSmsIntent(null), []);

  useSmsNotifications(
    activeServiceId,
    smsPanelTicketIdRef,
    useCallback((ticketId: string) => {
      setOpenTicketIntent({ ticketId, mode: "detail", openSmsPanel: true });
      setActivePage("orders");
    }, [])
  );

  const smsProvisioned = useSmsEnabled(activeServiceId);
  const { has: hasModule, loading: entitlementsLoading, nacteniSelhalo: narokySelhaly } = useEntitlements(activeServiceId);
  /** Majitel aplikace musí dovnitř i u servisu po zkušebním období. */
  const isRootOwnerUser = useIsRootOwner();
  /** Chat týmu visí nad celou aplikací; vypínač je v Nastavení → Komunikace. */
  const chatZapnuty = useChatZapnuty(activeServiceId);

  // Modul je dostupný, jen když ho má servis ZAPLACENÝ.
  // U SMS navíc musí být zřízené telefonní číslo – nárok sám o sobě nestačí.
  // Faktury si uživatel může navíc skrýt v Nastavení, když má vlastní
  // fakturační systém; to je předvolba, ne nárok.
  const smsEnabled = smsProvisioned && hasModule("sms");
  const globalSmsUnreadCount = useGlobalSmsUnreadCount(activeServiceId, {
    onInboundSmsNavigate: useCallback((p: InboundSmsNavigatePayload) => {
      setOpenSmsIntent({
        phone: p.phone,
        displayName: p.displayName,
        conversationId: p.conversationId,
      });
      setActivePage("sms");
    }, []),
  });

  const [openClaimIntent, setOpenClaimIntent] = useState<OpenClaimIntent | null>(null);

  // one-shot intent: navigate to Customers and open a specific customer
  const [openCustomerIntent, setOpenCustomerIntent] = useState<OpenCustomerIntent | null>(null);

  // create new order intent (prefill)
  const [newOrderPrefill, setNewOrderPrefill] = useState<{ customerId?: string; rezervace?: Rezervace } | null>(null);
  const [invoicePrefill, setInvoicePrefill] = useState<any>(null);
  const [openInvoiceId, setOpenInvoiceId] = useState<string | null>(null);

  // UI config
  const [uiCfg, setUiCfg] = useState<UIConfig>(() => safeLoadUIConfig());

  /* Osobní volby (zobrazení zakázek, zvýraznění stavu, barva loga...)
     sdílené napříč zařízeními – ne přes tenhle state přímo, ale přes
     localStorage a existující "jobsheet:ui-updated" / "…logo-preset-changed"
     události, na které appka už reaguje. Sync jen po přihlášení stáhne
     uložené volby a po každé změně je odešle zpátky; samotné čtení/zápis
     UI configu se tímhle nemění. */
  useEffect(() => {
    if (!session?.user?.id) return;
    return startPersonalPreferencesSync();
  }, [session?.user?.id]);

  // Faktury: nárok servisu A zároveň to, že si je uživatel neskryl.
  // Musí být až za uiCfg, ze kterého čte předvolbu.
  const invoicesAvailable = hasModule("invoices") && uiCfg.invoicingEnabled !== false;
  /* Zásilky mezi pobočkami: zapíná správce v Nastavení, potřebuje modul poboček. */
  const zasilkyZapnuty = useZasilkyZapnuty(activeServiceId);
  const zasilkyAvailable = zasilkyZapnuty && hasModule("branches");

  // Draft badge count (from Orders via jobsheet:draft-count)
  const [draftCount, setDraftCount] = useState(0);

  // Invite token resolution guards (aby se flow nespouštěl opakovaně po refreshi session)
  const inviteResolvingTokenRef = useRef<string | null>(null);
  const inviteResolvedTokenRef = useRef<string | null>(null);

  // Průvodce aplikací (krok za krokem po stránkách)
  const [isTourActive, setIsTourActive] = useState(false);
  const [tourStep, setTourStep] = useState(0);
  // Jednorázové okno po skončení průvodce: je potřeba stáhnout JobiDocs
  const [showJobiDocsDownloadPrompt, setShowJobiDocsDownloadPrompt] = useState(false);

  // Nápověda klávesových zkratek (?)
  const [shortcutsHelpOpen, setShortcutsHelpOpen] = useState(false);
  /** Právě běžící průvodce z katalogu (lib/pruvodci); úvodní má id „uvod“. */
  const [aktivniPruvodce, setAktivniPruvodce] = useState<Pruvodce | null>(null);
  const TOUR_STEPS: TourStep[] = useMemo(() => aktivniPruvodce?.kroky ?? [], [aktivniPruvodce]);
  const stavPruvodcu = useStavPruvodcu();
  /** Co má uživatel k dispozici: podle role, stránek v navigaci a modulů – průvodce k API bez API nikdo neuvidí. */
  const kontextPruvodcu = useMemo<KontextPruvodcu>(
    () => ({
      admin: isAdmin,
      rootOwner: jeRootOwner,
      web: isWeb(),
      stranky: { orders: true, calendar: true, customers: true, inventory: true, devices: true, settings: true, statistics: canViewStatistics, invoices: invoicesAvailable, sms: smsEnabled, zasilky: zasilkyAvailable, odmeny: odmenyAvailable, provize: provizeAvailable },
      moduly: { api_catalog: hasModule("api_catalog"), api_inventory: hasModule("api_inventory"), branches: hasModule("branches"), invoices: hasModule("invoices"), sms: hasModule("sms") },
    }),
    [isAdmin, jeRootOwner, canViewStatistics, invoicesAvailable, smsEnabled, zasilkyAvailable, odmenyAvailable, provizeAvailable, hasModule]
  );
  const pruvodciDostupni = useMemo(() => dostupniPruvodci(kontextPruvodcu), [kontextPruvodcu]);

  const spustPruvodce = useCallback((p: Pruvodce) => {
    if (p.kroky.length === 0) return;
    setAktivniPruvodce(p);
    setIsTourActive(true);
    setTourStep(0);
    setActivePage(p.kroky[0].page);
  }, []);
  const startTour = useCallback(() => {
    const uvod = PRUVODCI.find((p) => p.id === "uvod");
    if (uvod) spustPruvodce(uvod);
  }, [spustPruvodce]);

  const onTourEnded = useCallback(() => {
    // Prošlý průvodce už není novinka.
    const uid = session?.user?.id;
    if (uid && aktivniPruvodce) {
      const next = oznacProsly(uid, aktivniPruvodce.id);
      nastavStavPruvodcu({ dostupne: pruvodciDostupni, videno: next.videno, novinky: next.neprosle });
    }
    if (aktivniPruvodce?.id !== "uvod") return;
    // Ve webové verzi se tiskne přímo z prohlížeče, takže nabízet instalaci
    // JobiDocs nedává smysl – uživatel by si stahoval něco, co nepotřebuje.
    if (isWeb()) return;
    try {
      if (!localStorage.getItem(STORAGE_KEYS.JOBIDOCS_DOWNLOAD_PROMPT_SEEN)) {
        setShowJobiDocsDownloadPrompt(true);
      }
    } catch {
      // ignore
    }
  }, [session?.user?.id, aktivniPruvodce, pruvodciDostupni]);

  /* Krok průvodce s akcí: otevřít ukázkovou zakázku (z config.demo_data), jinak
     poslední zakázku servisu – detail je dialog a průvodce ho potřebuje vidět. */
  useEffect(() => {
    if (!isTourActive || !supabase || !activeServiceId) return;
    const krok = TOUR_STEPS[tourStep];
    if (krok?.akce !== "otevrit-ukazkovou-zakazku") return;
    let zruseno = false;
    void (async () => {
      const config = await nactiServiceConfig(activeServiceId);
      const demo = config.stav === "ok" ? (config.config.demo_data as { ticketIds?: string[] } | undefined) : undefined;
      let ticketId = demo?.ticketIds?.[0] ?? null;
      if (!ticketId) {
        // deno-lint-ignore no-explicit-any
        const { data } = await (supabase as any).from("tickets").select("id").eq("service_id", activeServiceId).is("deleted_at", null).order("created_at", { ascending: false }).limit(1);
        ticketId = Array.isArray(data) && data[0]?.id ? String(data[0].id) : null;
      }
      if (zruseno || !ticketId) return;
      setActivePage("orders");
      setOpenTicketIntent({ ticketId, mode: "detail" });
    })();
    return () => { zruseno = true; };
  }, [isTourActive, tourStep, TOUR_STEPS, activeServiceId]);

  /* Otazník v navigaci: panel nápovědy – průvodce pro aktuální stránku /
     podsekci Nastavení, novinky a agent. Podsekce se čte z DOM při otevření
     (Nastavení si ji drží uvnitř). */
  const [napovedaOtevrena, setNapovedaOtevrena] = useState(false);
  const [napovedaPodsekce, setNapovedaPodsekce] = useState<string | null>(null);
  const otevriPruvodce = useCallback(() => {
    const sub = activePage === "settings" ? document.querySelector<HTMLElement>('[data-tour="settings-content"]')?.dataset.section ?? null : null;
    setNapovedaPodsekce(sub);
    setNapovedaOtevrena((o) => !o);
  }, [activePage]);
  const pruvodceMisto = useMemo(() => pruvodceProMisto(pruvodciDostupni, activePage, napovedaPodsekce), [pruvodciDostupni, activePage, napovedaPodsekce]);
  const spustPruvodceId = useCallback((id: string) => {
    const p = pruvodciDostupni.find((x) => x.id === id);
    if (p) spustPruvodce(p);
  }, [pruvodciDostupni, spustPruvodce]);
  const kontextAgenta = useMemo(
    () => ({
      role: jeRootOwner ? "majitel aplikace" : isAdmin ? "majitel/správce servisu" : "člen týmu",
      web: isWeb(),
      moduly: (Object.entries(kontextPruvodcu.moduly) as Array<[string, boolean | undefined]>).filter(([, v]) => v).map(([k]) => k),
      stranky: (Object.entries(kontextPruvodcu.stranky) as Array<[string, boolean | undefined]>).filter(([, v]) => v).map(([k]) => k),
    }),
    [jeRootOwner, isAdmin, kontextPruvodcu]
  );

  /* Novinky: po přihlášení (s odstupem, ať jsou načtené moduly) porovnat,
     co má uživatel k dispozici, s tím, co měl minule – nová funkce se
     oznámí jednou a nabídne průvodce. */
  const novinkyOznamenoRef = useRef<string | null>(null);
  useEffect(() => {
    const uid = session?.user?.id;
    if (!uid || !activeServiceId) return;
    const klic = `${uid}:${activeServiceId}`;
    const ulozeno = nactiStavPruvodcu(uid);
    nastavStavPruvodcu({ dostupne: pruvodciDostupni, videno: ulozeno?.videno ?? {}, novinky: ulozeno?.neprosle ?? [] });
    if (novinkyOznamenoRef.current === klic) return;
    const t = window.setTimeout(() => {
      novinkyOznamenoRef.current = klic;
      const { novinky, ulozit } = zjistiNovinky(pruvodciDostupni, nactiStavPruvodcu(uid), new Date());
      ulozStavPruvodcu(uid, ulozit);
      nastavStavPruvodcu({ dostupne: pruvodciDostupni, videno: ulozit.videno, novinky: ulozit.neprosle });
      if (novinky.length === 1) {
        showPersistentToast(`Novinka: ${novinky[0].nazev}`, "info", { actionLabel: "Projít průvodce", onAction: () => spustPruvodce(novinky[0]), subtitle: novinky[0].popis, silent: true });
      } else if (novinky.length > 1) {
        showPersistentToast(`${novinky.length} novinky v Jobi`, "info", {
          actionLabel: "Zobrazit",
          onAction: () => {
            setOpenSettingsToSubsection({ category: "app", subsection: "about_help" });
            setActivePage("settings");
          },
          subtitle: novinky.map((n) => n.nazev).join(", "),
          silent: true,
        });
      }
    }, 8000);
    return () => window.clearTimeout(t);
  }, [session?.user?.id, activeServiceId, pruvodciDostupni, spustPruvodce]);

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
  /**
   * activeServiceId se v efektu níž čte až PO awaitu na services-list.
   * Přes uzávěr by to byla hodnota z okamžiku spuštění efektu – kdyby
   * uživatel mezitím servis přepnul, kód by mu volbu přepsal. Ref drží
   * vždy aktuální hodnotu, a přitom efekt neznovuspouští (to by načítalo
   * seznam servisů dokola).
   */
  const activeServiceIdRef = useRef(activeServiceId);
  // Zápis v efektu, ne během renderu – stejně jako v useGlobalSmsUnreadCount.
  useEffect(() => {
    activeServiceIdRef.current = activeServiceId;
  }, [activeServiceId]);
  /*
   * Seznam servisů patří k člověku. Po odhlášení a přihlášení jiného účtu
   * ve stejném okně tu dřív zůstal seznam toho předchozího: účet bez
   * jediného členství pak „patřil“ do cizího servisu, nároky se mu (správně)
   * nenačetly a aplikace mu ukázala „Zkušební období skončilo“ u servisu,
   * který má přístup trvalý. Při změně uživatele se seznam vyprázdní dřív,
   * než se načte nový.
   */
  const posledniUzivatelRef = useRef<string | null>(null);
  useEffect(() => {
    if (!session || !supabase) return;
    if (posledniUzivatelRef.current !== null && posledniUzivatelRef.current !== session.user.id) {
      setServices([]);
      setServicesLoaded(false);
      setActiveServiceId(null);
    }
    posledniUzivatelRef.current = session.user.id;
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
          setServicesLoaded(true);
          return;
        }
        
        const servicesList = (data.services as Array<{ service_id: string; service_name: string; role: string }>) || [];
        setServicesLoaded(true);
        // Prázdný seznam se musí zapsat, ne přeskočit – jinak zůstane ten
        // předchozí (viz komentář nad efektem a stejná oprava v refreshServices).
        setServices(servicesList);
        if (servicesList.length === 0) {
          setActiveServiceId(null);
          return;
        }
        
        // If activeServiceId is null, try to restore from localStorage or use first service
        const aktivni = activeServiceIdRef.current;
        if (!aktivni) {
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
          const isValid = servicesList.some(s => s.service_id === aktivni);
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
  }, [session]);

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
      setServices(list);
      /*
       * Prázdný seznam se nesmí přeskočit. Po smazání posledního servisu tu
       * dřív zůstal ten starý: přepínač ho dál nabízel, aplikace do něj
       * načítala data a obrazovka „Založte si servis“ se neukázala – vypadalo
       * to, že mazání neproběhlo.
       */
      if (list.length === 0) {
        setActiveServiceId(null);
        return;
      }
      const currentActive = activeServiceId;
      const isValid = currentActive && list.some((s) => s.service_id === currentActive);
      if (!isValid) setActiveServiceId(list[0].service_id);
    } catch (err) {
      console.error("[App] refreshServices error:", err);
    }
  }, [session, activeServiceId]);

  // Push services + activeServiceId + documentsConfig (z DB) + companyData + jobidocsLogo + Supabase auth + canManageDocuments do JobiDocs
  useEffect(() => {
    if (services.length === 0 || !supabase) return;
    const client = supabase;

    const push = async () => {
      const [dbConfig, sessionData] = await Promise.all([
        loadDocumentsConfigRawFromDB(activeServiceId),
        client.auth.getSession(),
      ]);
      const documentsConfig = dbConfig?.config ?? null;
      const session = sessionData.data?.session;
      const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string | undefined;
      const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;
      const t = (localStorage.getItem("jobsheet_theme") || "light") as ThemeMode;
      let logo = getLogoColors(t, "auto");
      logo = { ...logo, foreground: logo.background };
      pushContextToJobiDocs(services, activeServiceId, {
        documentsConfig,
        companyData: safeLoadCompanyData() ?? null,
        jobidocsLogo: logo,
        canManageDocuments,
        supabaseAuth:
          supabaseUrl && supabaseAnonKey
            ? {
                supabaseUrl,
                supabaseAnonKey,
                supabaseAccessToken: session?.access_token ?? null,
              }
            : null,
      });
    };

    push();
    const id = setInterval(push, 5000);
    return () => clearInterval(id);
  }, [services, activeServiceId, canManageDocuments]);

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
    try {
      if (activeServiceId) localStorage.setItem(STORAGE_KEYS.ACTIVE_SERVICE_ID, activeServiceId);
      // Uklidit i naprázdno: po smazání servisu tu jinak zůstane jeho id a
      // aplikace se do něj po restartu pokouší vrátit.
      else localStorage.removeItem(STORAGE_KEYS.ACTIVE_SERVICE_ID);
    } catch (err) {
      console.error("[App] Error saving activeServiceId to localStorage:", err);
    }
  }, [activeServiceId]);

  /*
   * Velikost rozhraní. Na desktopu se zvětšuje samotné webview (jako ⌘+
   * v prohlížeči), v prohlížeči CSS zoomem – rozdíl a důvody popisuje
   * `src/lib/velikostRozhrani.ts`.
   */
  useEffect(() => {
    void pouzijMeritko(uiCfg.app.uiScale ?? 1, {
      nastavZoomWebview: async (meritko) => {
        const { getCurrentWebview } = await import("@tauri-apps/api/webview");
        await getCurrentWebview().setZoom(meritko);
      },
      nahlasChybu: (e) => console.error("[App] zoom webview selhal:", e),
    });
  }, [uiCfg.app.uiScale]);

  // Omezené efekty: vypne backdrop-filter napříč aplikací jedinou proměnnou.
  // Rozostření za průhlednými panely je pro GPU drahé – ve virtuálech
  // (Parallels) a na slabších strojích je to hlavní příčina sekání.
  // Respektuje i systémové "omezit průhlednost".
  useEffect(() => {
    const prefersReduced =
      typeof window !== "undefined" &&
      typeof window.matchMedia === "function" &&
      window.matchMedia("(prefers-reduced-transparency: reduce)").matches;
    const off = uiCfg.app.reducedEffects === true || prefersReduced;
    document.documentElement.style.setProperty("--blur", off ? "none" : "");
    document.documentElement.classList.toggle("reduced-effects", off);
  }, [uiCfg.app.reducedEffects]);

  // Při otevření Jobi automaticky spustit JobiDocs do tray, pokud neběží (pro tisk/export)
  useEffect(() => {
    const t = setTimeout(async () => {
      try {
        const running = await isJobiDocsRunning();
        if (!running) await launchJobiDocsApp();
      } catch {
        // ignore (např. v prohlížeči launch neexistuje)
      }
    }, 2000);
    return () => clearTimeout(t);
  }, []);

  // Když je fakturační modul vypnutý a uživatel je na Fakturách, přesměruj na Zakázky
  useEffect(() => {
    if (!invoicesAvailable && activePage === "invoices") {
      setActivePage("orders");
    }
  }, [invoicesAvailable, activePage]);

  useEffect(() => {
    if (smsEnabled === false && activePage === "sms") {
      setActivePage("orders");
    }
  }, [smsEnabled, activePage]);

  useEffect(() => {
    if (!zasilkyAvailable && activePage === "zasilky") {
      setActivePage("orders");
    }
  }, [zasilkyAvailable, activePage]);

  // Člen bez práva na statistiky na nich nesmí zůstat (po přepnutí servisu,
  // po odebrání práva za běhu).
  useEffect(() => {
    if (!canViewStatistics && activePage === "statistics") {
      setActivePage("orders");
    }
  }, [canViewStatistics, activePage]);
  useEffect(() => {
    if (!provizeAvailable && activePage === "provize") setActivePage("orders");
  }, [provizeAvailable, activePage]);
  useEffect(() => {
    if (!odmenyAvailable && activePage === "odmeny") setActivePage("orders");
  }, [odmenyAvailable, activePage]);

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

  /**
   * Zkratky: jeden dispečink pro celou aplikaci (viz lib/keyboardShortcuts).
   * Stránky si obsluhy jen přihlašují, takže se dvě obrazovky nepřebíjejí
   * podle toho, která se dřív namountovala.
   */
  useEffect(() => {
    if (!session) return;
    return startShortcutDispatcher(() => shortcutsHelpOpen);
  }, [session, shortcutsHelpOpen]);

  // Navigace – nejnižší priorita, obsluhy stránek ji mohou přebít.
  useEffect(() => {
    if (!session) return;
    const navMap: Array<[ShortcutId, NavKey]> = [
      ["nav_orders", "orders"],
      ["nav_calendar", "calendar"],
      ["nav_inventory", "inventory"],
      ["nav_devices", "devices"],
      ["nav_customers", "customers"],
      ["nav_invoices", "invoices"],
      ["nav_statistics", "statistics"],
      ["nav_settings", "settings"],
    ];
    const offs = navMap.map(([id, page]) =>
      registerShortcut(id, () => setActivePage(page), {
        enabled: () => (page !== "invoices" || invoicesAvailable) && (page !== "statistics" || canViewStatistics),
      })
    );
    offs.push(registerShortcut("help", () => setShortcutsHelpOpen(true)));
    return () => { for (const off of offs) off(); };
  }, [session, invoicesAvailable, canViewStatistics]);

  // Escape zavře nápovědu zkratek. Není to nastavitelná zkratka, proto zvlášť.
  useEffect(() => {
    if (!shortcutsHelpOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.preventDefault();
      setShortcutsHelpOpen(false);
    };
    document.addEventListener("keydown", onKey, true);
    return () => document.removeEventListener("keydown", onKey, true);
  }, [shortcutsHelpOpen]);

  // Navigace ze zkratek – Orders posílá jobsheet:navigate (window i document)
  useEffect(() => {
    const onNav = (e: Event) => {
      const ev = e as CustomEvent<{ page: NavKey; subsection?: string; openTicketId?: string; openCustomerId?: string }>;
      const page = ev.detail?.page;
      // Zmínka v chatu (#SN26000012, #Pavel Konečný) otevře rovnou detail.
      if (page === "orders" && typeof ev.detail?.openTicketId === "string") {
        setOpenTicketIntent({ ticketId: ev.detail.openTicketId, mode: "detail" });
      }
      if (page === "customers" && typeof ev.detail?.openCustomerId === "string") {
        setOpenCustomerIntent({ customerId: ev.detail.openCustomerId });
      }
      // Seznam je psaný ručně, takže na novou stránku se snadno zapomene –
      // chybějící „sms“ znamenalo, že na chaty se programově (a tedy ani
      // z testu nebo z odkazu) nedalo dostat, i když v liště jsou.
      if (page && ["orders", "calendar", "inventory", "devices", "customers", "invoices", "sms", "statistics", "settings", "zasilky", "provize", "odmeny"].includes(page)) {
        if (page === "invoices" && !invoicesAvailable) return;
        if (page === "statistics" && !canViewStatistics) return;
        if (page === "provize" && !provizeAvailable) return;
        if (page === "odmeny" && !odmenyAvailable) return;
        if (page === "zasilky" && !zasilkyAvailable) return;
        setActivePage(page);
        // Odkaz rovnou na podsekci Nastavení (první kroky, upozornění).
        const sub = ev.detail?.subsection;
        if (page === "settings" && typeof sub === "string" && sub) {
          setOpenSettingsToSubsection({ category: "company" as SettingsCategory, subsection: sub as SettingsSubsection });
        }
      }
    };
    window.addEventListener("jobsheet:navigate" as any, onNav);
    document.addEventListener("jobsheet:navigate" as any, onNav);
    return () => {
window.removeEventListener("jobsheet:navigate" as any, onNav);
    document.removeEventListener("jobsheet:navigate" as any, onNav);
    };
    // Dostupnost stránek se mění po načtení (sdílené provize, modul zásilek,
    // pravidla odměn) – bez nich tu zůstal starý handler, který novou
    // stránku odmítl, i když už byla v navigaci.
  }, [invoicesAvailable, canViewStatistics, provizeAvailable, zasilkyAvailable, odmenyAvailable]);

  // Orders → publish draft badge count
  useEffect(() => {
    const onDraft = (e: any) => {
      setDraftCount(Number(e?.detail?.count ?? 0));
    };
    window.addEventListener("jobsheet:draft-count" as any, onDraft);
    return () => window.removeEventListener("jobsheet:draft-count" as any, onDraft);
  }, []);

  /**
   * Přepnutí servisu zahodí rozpracované záměry z toho předchozího.
   * Bez toho se stalo tohle: rozdělaná rezervace v jednom servisu, přepnutí
   * jinam, „Založit zakázku“ – a v příjmu byla data z cizího servisu.
   */
  useEffect(() => {
    setNewOrderPrefill(null);
    setOpenTicketIntent(null);
    setInvoicePrefill(null);
  }, [activeServiceId]);

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

  // Po přihlášení: pokud je uložený invite token, nejdřív vyřídit pozvánku; při chybě automatický retry + refresh
  useEffect(() => {
    if (!session || !supabase) return;
    const client = supabase;

    const token = getPendingInviteToken();
    if (!token) return;
    // Session se může po návratu do okna refreshnout; stejný token proto neřeš opakovaně.
    if (inviteResolvingTokenRef.current === token || inviteResolvedTokenRef.current === token) return;
    inviteResolvingTokenRef.current = token;

    const MAX_RETRIES = 3;
    const RETRY_DELAY_MS = 2000;

    const handleInvite = async (attempt = 0): Promise<void> => {
      try {
        const { data: sessionData } = await client.auth.getSession();
        const accessToken = sessionData?.session?.access_token;
        if (!accessToken) {
          console.error("[App] No access token for invite-accept");
          inviteResolvingTokenRef.current = null;
          return;
        }

        // Uživatel už má členství/služby => starý pending invite token je irelevantní.
        const { data: listDataPre } = await client.functions.invoke("services-list", {
          headers: { Authorization: `Bearer ${accessToken}` },
        });
        const listPre = (listDataPre?.services as Array<{ service_id: string; service_name: string; role: string }>) || [];
        if (listPre.length > 0) {
          clearPendingInviteToken();
          inviteResolvedTokenRef.current = token;
          inviteResolvingTokenRef.current = null;
          setServices(listPre);
          const currentActive = activeServiceId;
          const valid = currentActive && listPre.some((s) => s.service_id === currentActive);
          if (!valid) setActiveServiceId(listPre[0].service_id);
          return;
        }

        const { data, error } = await client.functions.invoke("invite-accept", {
          body: { token },
        });

        if (error) {
          const res = (error as any)?.context as Response | undefined;
          let detail = "";
          if (res) {
            try {
              detail = await res.clone().text();
            } catch {}
          }
          console.error("[App] invite-accept error (attempt " + (attempt + 1) + ")", { error, detail });
          const rawErr = `${error?.message || ""} ${detail || ""}`.toLowerCase();
          const looksLikeInvalidInvite =
            /(invite|pozv|token)/.test(rawErr) &&
            /(invalid|neplat|not found|nenalez|expired|vypr|id)/.test(rawErr);
          if (looksLikeInvalidInvite) {
            clearPendingInviteToken();
            inviteResolvedTokenRef.current = token;
            inviteResolvingTokenRef.current = null;
            showToast("Pozvánka už není platná. Starý kód byl odstraněn.", "error");
            return;
          }
          if (attempt < MAX_RETRIES - 1) {
            await new Promise((r) => setTimeout(r, RETRY_DELAY_MS));
            return handleInvite(attempt + 1);
          }
          showToast(`Chyba při přijetí pozvánky: ${error.message}${detail ? " | " + detail : ""}`, "error");
          inviteResolvingTokenRef.current = null;
          return;
        }

        if (data?.serviceId) {
          clearPendingInviteToken();
          inviteResolvedTokenRef.current = token;
          inviteResolvingTokenRef.current = null;
          showToast("Pozvánka přijata", "success");
          await refreshServices();
          setActiveServiceId(data.serviceId);
          return;
        }

        // Odpověď bez serviceId – zkusit refresh služeb (možná backend už pozvánku zpracoval)
        await refreshServices();
        const { data: sessionData2 } = await client.auth.getSession();
        const accessToken2 = sessionData2?.session?.access_token;
        if (accessToken2) {
          const { data: listData } = await client.functions.invoke("services-list", {
            headers: { Authorization: `Bearer ${accessToken2}` },
          });
          const list = (listData?.services as Array<{ service_id: string }>) || [];
          if (list.length > 0) {
            clearPendingInviteToken();
            inviteResolvedTokenRef.current = token;
            inviteResolvingTokenRef.current = null;
            showToast("Pozvánka přijata", "success");
            setServices(list as Array<{ service_id: string; service_name: string; role: string }>);
            setActiveServiceId(list[0].service_id);
            return;
          }
        }

        if (attempt < MAX_RETRIES - 1) {
          await new Promise((r) => setTimeout(r, RETRY_DELAY_MS));
          return handleInvite(attempt + 1);
        }
        inviteResolvingTokenRef.current = null;
      } catch (err) {
        const errorMessage = err instanceof Error ? err.message : "Neznámá chyba";
        console.error("[App] invite-accept exception (attempt " + (attempt + 1) + ")", err);
        if (attempt < MAX_RETRIES - 1) {
          await new Promise((r) => setTimeout(r, RETRY_DELAY_MS));
          return handleInvite(attempt + 1);
        }
        showToast(`Chyba při přijetí pozvánky: ${errorMessage}`, "error");
        inviteResolvingTokenRef.current = null;
      }
    };

    handleInvite();
  }, [session, activeServiceId, refreshServices, setActiveServiceId]);

  const pageTitle = useMemo(() => {
    switch (activePage) {
      case "orders":
        return "Zakázky";
      case "calendar":
        return "Kalendář";
      case "inventory":
        return "Sklad";
      case "devices":
        return "Zařízení";
      case "customers":
        return "Customers";
      case "statistics":
        return "Statistiky";
      case "provize":
        return "Provize";
      case "odmeny":
        return "Odměny";
      case "invoices":
        return "Faktury";
      case "zasilky":
        return "Zásilky";
      case "settings":
        return "Settings";
      default:
        return "jobi";
    }
  }, [activePage]);

  // OTA: check once when app is ready (Tauri only). Must be called unconditionally (hooks order).
  useCheckForAppUpdate();

  const appUpdate = useAppUpdate();
  const lastShownUpdateVersionRef = useRef<string | null>(null);
  const openUpdateSettings = () => {
    setActivePage("settings");
    setOpenSettingsToSubsection({ category: "app", subsection: "about_updates" });
  };
  // Ozveme se jednou, a to až s hotovou verzí – ne „něco je k dispozici,
  // jděte si to stáhnout“. Když je automatické stahování vypnuté, nabídne
  // toast rovnou stažení.
  useEffect(() => {
    if (!appUpdate) return;
    const v = appUpdate.update?.version;
    if (!v) return;
    const key = `${appUpdate.phase}:${v}`;
    if (appUpdate.phase === "ready") {
      if (lastShownUpdateVersionRef.current === key) return;
      lastShownUpdateVersionRef.current = key;
      showPersistentToast(`Verze ${v} je připravená.`, "info", {
        subtitle: "Nainstaluje se při restartu aplikace, trvá to pár sekund.",
        actionLabel: "Restartovat",
        onAction: () => { void appUpdate.relaunch(); },
        secondaryLabel: "Později",
        onSecondaryAction: () => {},
        silent: true,
      });
      return;
    }
    if (appUpdate.phase === "available" && !appUpdate.autoDownload) {
      if (lastShownUpdateVersionRef.current === key) return;
      lastShownUpdateVersionRef.current = key;
      showPersistentToast(`Je k dispozici verze ${v}.`, "info", {
        actionLabel: "Stáhnout",
        onAction: () => { void appUpdate.downloadAndInstall(); },
        secondaryLabel: "Podrobnosti",
        onSecondaryAction: openUpdateSettings,
        silent: true,
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [appUpdate?.phase, appUpdate?.update?.version, appUpdate?.autoDownload]);

  // Po restartu do nové verze jednou „Co je nového“.
  useEffect(() => {
    const v = appUpdate?.currentVersion;
    if (!v) return;
    try {
      const seen = localStorage.getItem("jobsheet_last_seen_version");
      if (seen && seen !== v) {
        showToast(`Aplikace je aktualizovaná na verzi ${v}.`, "success");
      }
      localStorage.setItem("jobsheet_last_seen_version", v);
    } catch {
      // ignore
    }
  }, [appUpdate?.currentVersion]);

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

  /*
   * Než se z úložiště obnoví přihlášení, nesmí se ukázat přihlašovací
   * obrazovka. Probliknutí formuláře při každém otevření webu vypadalo, že
   * si aplikace přihlášení nepamatuje, a lidé se rovnou hlásili znovu.
   */
  if (authInitializing) {
    return (
      <ThemeProvider>
        <div style={{ position: "fixed", inset: 0, display: "grid", placeItems: "center", background: "var(--bg, #f5f5f5)", color: "var(--muted, #666)", fontFamily: "system-ui, -apple-system, sans-serif", fontSize: 14 }}>
          Načítám…
        </div>
      </ThemeProvider>
    );
  }

  /*
   * Po registraci bez servisu: nabídnout jeho založení. Dřív se člověk díval
   * na prázdnou aplikaci a čekal, až mu servis někdo vytvoří ručně.
   */
  if (servicesLoaded && services.length === 0 && session) {
    return (
      <ThemeProvider>
        <OnlineGate>
          <NeulozeneZmeny />
          <FirstServiceSetup
            email={session.user?.email ?? null}
            onCreated={(serviceId) => {
              setActiveServiceId(serviceId);
              void refreshServices();
            }}
            onSignOut={() => { void supabase?.auth.signOut(); }}
          />
        </OnlineGate>
      </ThemeProvider>
    );
  }

  /*
   * Konec zkušebního období: bez platného nároku „access“ se v aplikaci
   * nepracuje. Majitel aplikace (root owner) projde vždycky, aby měl jak
   * nárok prodloužit.
   *
   * Když se nároky nepodařilo načíst, zamykat se nesmí: výpadek sítě není
   * konec předplatného a platící servis by přišel o přístup k vlastní práci.
   * Riziko je malé – od migrace 20260911100000 hlídá nárok „access“ i RLS
   * na serveru, takže servisu bez předplatného stejně žádný zápis neprojde.
   */
  /*
   * Zamykací obrazovka platí jen pro servis, do kterého člověk pořád patří.
   *
   * Když majitel někoho ze servisu odebere, zůstane mu v prohlížeči poslední
   * `activeServiceId` – nároky se pak nenačtou (RLS ho už nepustí) a aplikace
   * mu hlásila „Zkušební období skončilo“ u servisu bez názvu („Servis“).
   * Vyhozený zaměstnanec tak dostal zprávu, že má zaplatit, místo aby se
   * dozvěděl, že do toho servisu už nepatří. Když servis v seznamu není,
   * pokračuje se dál – seznam servisů je prázdný a ukáže se „Založte si
   * servis“ (nebo se přepne do jiného servisu, který uživatel má).
   *
   * Dokud se seznam servisů nenačte, zamykací obrazovka nepadá vůbec: nároky
   * se načtou dřív než seznam a jinak by zámek probleskl i tomu, kdo platí.
   */
  const patrimDoAktivniho = servicesLoaded && services.some((s) => s.service_id === activeServiceId);
  if (session && activeServiceId && patrimDoAktivniho && !entitlementsLoading && !narokySelhaly && !hasModule("access") && !isRootOwnerUser) {
    const aktivni = services.find((s) => s.service_id === activeServiceId);
    return (
      <ThemeProvider>
        <OnlineGate>
          <NeulozeneZmeny />
          <TrialEnded
            serviceId={activeServiceId}
            serviceName={aktivni?.service_name ?? "Servis"}
            services={services}
            onSwitchService={(id) => setActiveServiceId(id)}
            onSignOut={() => { void supabase?.auth.signOut(); }}
          />
        </OnlineGate>
      </ThemeProvider>
    );
  }

  // Guard: session must exist to render app shell (Sidebar, Orders, Customers, Settings)
  if (!session) {
    return (
      <ThemeProvider>
        <OnlineGate>
          {/* I na přihlašovací obrazovce: kdo se odhlásí s neuloženou změnou,
              musí vidět, že na něj čeká – fronta se odesílá až po přihlášení
              toho, komu data patří. Bez ukazatele tu vypadalo všechno hotové. */}
          <NeulozeneZmeny />
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

  // App shell - only rendered when session exists and invite (if any) was resolved
  return (
    <ThemeProvider>
      <OnlineGate>
        <NeulozeneZmeny />
        <PrepinacUctu userId={session.user.id} email={session.user.email ?? null} profil={userProfile ? { nickname: userProfile.nickname, avatarUrl: userProfile.avatarUrl } : null} />
        {/* Ve Fakturách sedí bublina na spodní liště editoru („Vystavit“,
            „Uložit koncept“) a tlačítka pak nejdou kliknout. Plovoucí „+“ je
            tam ze stejného důvodu schované už dřív; chat běží dál, jen
            kolečko na téhle stránce není. */}
        <ChatPlovouci serviceId={activeServiceId} userId={session.user.id} profil={userProfile ? { nickname: userProfile.nickname, avatarUrl: userProfile.avatarUrl } : null} zapnuto={chatZapnuty} bublinaSkryta={activePage === "invoices"} />
        <CiziServis serviceId={activeServiceId} onPristupZiskan={() => { void refreshServices(); }} />
        <StatusesProvider activeServiceId={activeServiceId}>
        <BranchProvider serviceId={activeServiceId} userId={presenceUserId} enabled={hasModule("branches")}>
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
          invoicingEnabled={invoicesAvailable}
          sidebarPosition={uiCfg.sidebar?.position || "left"}
          sidebarPinned={uiCfg.sidebar?.pinned ?? false}
          onSidebarPinnedChange={(pinned) => {
            setUiCfg((prev) => ({ ...prev, sidebar: { ...prev.sidebar, pinned } }));
            // Zrcadlit i do uložených UI nastavení, aby to přežilo reload i bez klíče lišty.
            try {
              const raw = localStorage.getItem(STORAGE_KEYS.UI_SETTINGS);
              const parsed = raw ? JSON.parse(raw) : {};
              parsed.sidebar = { ...(parsed.sidebar ?? {}), pinned };
              localStorage.setItem(STORAGE_KEYS.UI_SETTINGS, JSON.stringify(parsed));
            } catch {
              // ignore
            }
          }}
          smsUnreadCount={globalSmsUnreadCount}
          smsEnabled={smsEnabled}
          statisticsEnabled={canViewStatistics}
          zasilkyEnabled={zasilkyAvailable}
          provizeEnabled={provizeAvailable}
          odmenyEnabled={odmenyVNavigaci}
          onHelp={otevriPruvodce}
          helpBadge={stavPruvodcu.novinky.length}
        >
            {/*
              Tenhle obal i ty pod ním (Zákazníci, Sklad, Zařízení, Statistiky,
              Nastavení) mají minHeight, ne pevných 100 %. <main> je scroll
              kontejner a stránky samy žádnou vlastní výšku nežádají – když
              obal dostal height: "100%", byl napevno vysoký přesně jako
              viditelná plocha <main> (bez jeho paddingu). Delší seznam
              zakázek pak "přetekl" mimo vlastní obal (overflow: visible ho
              nezastavil, jen ho to nenafouklo), takže spodní karty ležely
              až u úplně dolního okraje <main> – přesně tam, kde na mobilu
              sedí spodní lišta – a nešlo se k nim doscrollovat, protože to
              přetečení <main>.scrollHeight nepočítal spolehlivě.

              SMS, Kalendář a Faktury height: "100%" naopak POTŘEBUJÍ – řeší
              si posouvání samy uvnitř (rozdělený pohled, vlastní hlavička),
              a bez pevné výšky by jim to přestalo fungovat. Proto se jich
              tahle oprava netýká.
            */}
            {visitedPages.has("orders") && (
              <div data-tour="page-orders" style={{ display: activePage === "orders" ? "block" : "none", minHeight: "100%" }} aria-hidden={activePage !== "orders"}>
                <Orders
                  activeServiceId={activeServiceId}
                  serviceName={services.find((s) => s.service_id === activeServiceId)?.service_name ?? null}
                  smsPanelTicketIdRef={smsPanelTicketIdRef}
                  newOrderPrefill={newOrderPrefill}
                  onNewOrderPrefillConsumed={() => setNewOrderPrefill(null)}
                  openTicketIntent={openTicketIntent}
                  onOpenTicketIntentConsumed={() => setOpenTicketIntent(null)}
                  openClaimIntent={openClaimIntent}
                  onOpenClaimIntentConsumed={() => setOpenClaimIntent(null)}
                  onOpenCustomer={(customerId) => {
                    setOpenCustomerIntent({ customerId });
                    setActivePage("customers");
                  }}
                  onReturnToPage={(page, customerId) => {
                    setActivePage(page);
                    if (page === "customers" && customerId) {
                      setOpenCustomerIntent({ customerId });
                    }
                  }}
                  onCreateInvoice={invoicesAvailable ? (prefill) => {
                    setInvoicePrefill(prefill);
                    setOpenInvoiceId(null);
                    setActivePage("invoices");
                  } : undefined}
                  onOpenInvoice={invoicesAvailable ? (id) => {
                    setOpenInvoiceId(id);
                    setInvoicePrefill(null);
                    setActivePage("invoices");
                  } : undefined}
                  closeDetailWhen={activePage !== "orders"}
                  smsEnabled={smsEnabled}
                />
              </div>
            )}

          {visitedPages.has("sms") && (
            <div data-tour="page-sms" style={{ display: activePage === "sms" ? "block" : "none", height: "100%", minHeight: 0 }} aria-hidden={activePage !== "sms"}>
              <SmsChatsPage
                activeServiceId={activeServiceId}
                openSmsIntent={openSmsIntent}
                onOpenSmsIntentConsumed={clearOpenSmsIntent}
                onOpenTicket={(ticketId, openSmsPanel) => {
                  setOpenTicketIntent({ ticketId, mode: "detail", openSmsPanel: openSmsPanel ?? true });
                  setActivePage("orders");
                }}
              />
            </div>
          )}

          {visitedPages.has("calendar") && (
            <div data-tour="page-calendar" style={{ display: activePage === "calendar" ? "block" : "none", height: "100%", minHeight: 0 }} aria-hidden={activePage !== "calendar"}>
              <Calendar
                activeServiceId={activeServiceId}
                onZalozitZakazku={(rezervace) => {
                  setNewOrderPrefill({ rezervace });
                  setActivePage("orders");
                }}
                onOpenTicket={(ticketId) => {
                  setOpenTicketIntent({ ticketId, mode: "detail", returnToPage: "calendar" });
                  setActivePage("orders");
                }}
                onOpenClaim={(claimId) => {
                  setOpenClaimIntent({ claimId, returnToPage: "calendar" });
                  setActivePage("orders");
                }}
              />
            </div>
          )}

          {visitedPages.has("customers") && (
              <div data-tour="page-customers" style={{ display: activePage === "customers" ? "block" : "none", minHeight: "100%" }} aria-hidden={activePage !== "customers"}>
            <Customers
              activeServiceId={activeServiceId}
              openCustomerIntent={openCustomerIntent}
              onOpenCustomerIntentConsumed={() => setOpenCustomerIntent(null)}
              openTicketIntent={openTicketIntent}
              onOpenTicketIntentConsumed={() => setOpenTicketIntent(null)}
              onOpenSmsChat={(phone, displayName) => {
                setOpenSmsIntent({ phone, displayName });
                setActivePage("sms");
              }}
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
              </div>
          )}

          {visitedPages.has("inventory") && (
            <div data-tour="page-inventory" style={{ display: activePage === "inventory" ? "block" : "none", minHeight: "100%" }} aria-hidden={activePage !== "inventory"}>
              <Inventory activeServiceId={activeServiceId} />
            </div>
          )}

          {visitedPages.has("devices") && (
            <div data-tour="page-devices" style={{ display: activePage === "devices" ? "block" : "none", minHeight: "100%" }} aria-hidden={activePage !== "devices"}>
              <Devices activeServiceId={activeServiceId} />
            </div>
          )}

          {canViewStatistics && visitedPages.has("statistics") && (
            <div data-tour="page-statistics" style={{ display: activePage === "statistics" ? "block" : "none", minHeight: "100%" }} aria-hidden={activePage !== "statistics"}>
              <Statistics
                activeServiceId={activeServiceId}
                onOpenTicket={(ticketId) => {
                  setOpenTicketIntent({ ticketId, mode: "detail", returnToPage: "statistics" });
                  setActivePage("orders");
                }}
              />
            </div>
          )}

          {odmenyAvailable && visitedPages.has("odmeny") && (
            <div data-tour="page-odmeny" style={{ display: activePage === "odmeny" ? "block" : "none", minHeight: "100%" }} aria-hidden={activePage !== "odmeny"}>
              <Odmeny
                activeServiceId={activeServiceId}
                onOpenTicket={(ticketId) => {
                  setOpenTicketIntent({ ticketId, mode: "detail", returnToPage: "odmeny" });
                  setActivePage("orders");
                }}
                onOtevritNastaveni={() => {
                  setOpenSettingsToSubsection({ category: "people", subsection: "service_odmeny" });
                  setActivePage("settings");
                }}
              />
            </div>
          )}

          {provizeAvailable && visitedPages.has("provize") && (
            <div data-tour="page-provize" style={{ display: activePage === "provize" ? "block" : "none", minHeight: "100%" }} aria-hidden={activePage !== "provize"}>
              <ProvizeSdilene
                activeServiceId={activeServiceId}
                onOpenTicket={(ticketId) => {
                  setOpenTicketIntent({ ticketId, mode: "detail", returnToPage: "provize" });
                  setActivePage("orders");
                }}
              />
            </div>
          )}

          {invoicesAvailable && visitedPages.has("invoices") && (
            <div data-tour="page-invoices" style={{ display: activePage === "invoices" ? "block" : "none", height: "100%", minHeight: 0 }} aria-hidden={activePage !== "invoices"}>
              <Invoices
                activeServiceId={activeServiceId}
                prefillFromTicket={invoicePrefill}
                onPrefillConsumed={() => setInvoicePrefill(null)}
                openInvoiceId={openInvoiceId}
                onOpenInvoiceIdConsumed={() => setOpenInvoiceId(null)}
                onOpenTicket={(ticketId) => {
                  setOpenTicketIntent({ ticketId, mode: "detail", returnToPage: "invoices" });
                  setActivePage("orders");
                }}
              />
            </div>
          )}

          {zasilkyAvailable && visitedPages.has("zasilky") && (
            <div data-tour="page-zasilky" style={{ display: activePage === "zasilky" ? "block" : "none", minHeight: "100%" }} aria-hidden={activePage !== "zasilky"}>
              <Zasilky
                activeServiceId={activeServiceId}
                onOpenTicket={(ticketId) => {
                  setOpenTicketIntent({ ticketId, mode: "detail", returnToPage: "zasilky" });
                  setActivePage("orders");
                }}
              />
            </div>
          )}

          {visitedPages.has("settings") && (
            <div data-tour="page-settings" style={{ display: activePage === "settings" ? "block" : "none", minHeight: "100%" }} aria-hidden={activePage !== "settings"}>
            <Settings
              activeServiceId={activeServiceId}
              setActiveServiceId={setActiveServiceId}
              services={services}
              refreshServices={refreshServices}
              onStartTour={startTour}
              onSpustitPruvodce={(id) => {
                const p = pruvodciDostupni.find((x) => x.id === id);
                if (p) spustPruvodce(p);
              }}
              tourSection={
                isTourActive && TOUR_STEPS[tourStep]?.page === "settings" && TOUR_STEPS[tourStep].settingsSection
                  ? TOUR_STEPS[tourStep].settingsSection!
                  : null
              }
              openToSubsection={openSettingsToSubsection}
              onOpenToSubsectionConsumed={() => setOpenSettingsToSubsection(null)}
            />
            </div>
          )}

          {/* "sms" v seznamu chybělo, takže se pod SMS chaty vykresloval navíc
              prázdný panel "Placeholder page." */}
          {!["orders", "calendar", "settings", "customers", "devices", "inventory", "statistics", "invoices", "sms", "zasilky"].includes(activePage) && (
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
          {/* Na telefonu ne v SMS chatu: kolečko sedí přesně na tlačítku
              odeslat, takže se zpráva nedala odeslat vůbec. */}
          {uiCfg.app.fabNewOrderEnabled !== false &&
            !(isNarrowFab && activePage === "sms") &&
            /* V Nastavení překrývalo pruh „Neuložené změny“ a ve Fakturách
               formulář – tam se nová zakázka nezakládá. */
            activePage !== "settings" &&
            activePage !== "invoices" &&
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
                  right: uiCfg.sidebar.position === "right" ? (uiCfg.sidebar.pinned ? 242 : 90) : 22,
                  /* Na úzké obrazovce je dole navigace – bez tohohle si na ni
                     tlačítko sedne a zakryje poslední záložku. */
                  bottom: isNarrowFab
                    ? "calc(var(--bottom-nav-h) + var(--safe-bottom) + 16px)"
                    : uiCfg.sidebar.position === "bottom"
                      ? 62
                      : 22,
                  width: 56,
                  height: 56,
                  borderRadius: 999,
                  border: "none",
                  background: "linear-gradient(135deg, var(--accent), var(--accent-hover))",
                  color: "white",
                  fontWeight: 950,
                  cursor: "pointer",
                  boxShadow: `0 20px 50px var(--accent-glow)`,
                  /* Bylo 12000, tedy nad vším včetně otevřených oken. Na
                     telefonu pak kolečko "+" viselo přes formulář a překrývalo
                     tlačítka. Patří nad obsah, ale pod okna – viz pásma
                     z-indexů v theme.css. */
                  zIndex: 1050,
                  display: "grid",
                  placeItems: "center",
                  fontFamily: "system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif",
                  transition: "all 250ms cubic-bezier(0.4, 0, 0.2, 1)",
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
                  backdropFilter: "var(--blur)",
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
        <NapovedaPanel
          open={napovedaOtevrena}
          onClose={() => setNapovedaOtevrena(false)}
          activeServiceId={activeServiceId}
          page={activePage}
          subsection={napovedaPodsekce}
          pruvodceMisto={pruvodceMisto}
          stav={stavPruvodcu}
          kontext={kontextAgenta}
          onSpustitPruvodce={spustPruvodceId}
          onOtevritNastaveni={(sub) => {
            setOpenSettingsToSubsection({ category: "company", subsection: sub as SettingsSubsection });
            setActivePage("settings");
          }}
          onOtevritStranku={(page) => {
            if ((kontextAgenta.stranky as string[]).includes(page)) setActivePage(page as NavKey);
          }}
          onVsichniPruvodci={() => {
            setOpenSettingsToSubsection({ category: "app", subsection: "about_help" });
            setActivePage("settings");
          }}
        />
        {aktualizaceWebu.novaVerze && (
          <div
            role="status"
            style={{ position: "fixed", left: "50%", bottom: 76, transform: "translateX(-50%)", zIndex: 1200, display: "flex", alignItems: "center", gap: 12, padding: "10px 14px", borderRadius: 14, border: "1px solid var(--border)", background: "var(--panel)", boxShadow: "var(--shadow)", fontSize: 13, color: "var(--text)", maxWidth: "calc(100vw - 32px)" }}
          >
            <span>Je připravená nová verze Jobi.</span>
            <button
              type="button"
              onClick={aktualizaceWebu.obnovit}
              title={`Běží build ${AKTUALNI_BUILD}`}
              style={{ padding: "6px 12px", borderRadius: 10, border: "none", background: "var(--accent)", color: "#fff", fontWeight: 700, cursor: "pointer", fontFamily: "inherit", fontSize: 13 }}
            >
              Obnovit
            </button>
          </div>
        )}
          <ToastContainer />
        </BranchProvider>
        </StatusesProvider>
      </OnlineGate>
    </ThemeProvider>
  );
}
