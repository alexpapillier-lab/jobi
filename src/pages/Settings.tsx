import { useMemo, useState, useEffect, useRef, useCallback, type ChangeEvent, type ReactNode } from "react";
import { Button, Segmented, Input, MenuItem, SettingRow, SettingRows, UnsavedBar, useSavedHint } from "../components/ui";
import { SearchIcon, CheckIcon } from "../components/icons";
import { UnsavedGuardProvider, type UnsavedHandle } from "./Settings/hooks/useUnsavedGuard";
import { UnsavedChangesDialog } from "./Settings/components/UnsavedChangesDialog";
import { assetUrl } from "../lib/assetUrl";
import { jeZvyrazneni, VYCHOZI_ZVYRAZNENI, type ZvyrazneniStavu } from "../lib/zvyrazneniStavu";
import { useStatuses, type StatusMeta } from "../state/StatusesStore";
import { useTheme, splitTheme, themeFor, type ThemeMode, type ThemeAccent, type ThemePreference } from "../theme/ThemeProvider";
import { STATUS_COLOR_PALETTE, getContrastText } from "../utils/statusColors";
import { supabase, supabaseUrl, supabaseFetch } from "../lib/supabaseClient";
import { getTypedSupabaseClient } from "../lib/typedSupabase";
import { safeLoadCompanyData } from "../lib/companyData";
import { useActiveRole } from "../hooks/useActiveRole";
import { useSettingsActions } from "./Settings/hooks/useSettingsActions";
import { TeamSettings } from "./Settings/TeamSettings";
import { OwnerSettings } from "./Settings/OwnerSettings";
import { Card, FieldLabel, TextInput, LanguagePicker } from "../lib/settingsUi";
import { DphNastaveni } from "./Settings/DphNastaveni";
import { ApiNastaveni } from "./Settings/ApiNastaveni";
import { useEntitlements } from "../hooks/useEntitlements";
import { useIsNarrow } from "../hooks/useIsNarrow";
import { DeletedTicketsSettings } from "./Settings/DeletedTicketsSettings";
import { ShortcutsSettingsSection } from "./Settings/ShortcutsSettingsSection";
import { DeviceOptionsSettingsSection } from "./Settings/DeviceOptionsSettingsSection";
import { HandoffOptionsSettingsSection } from "./Settings/HandoffOptionsSettingsSection";
import { ProfileSettingsSection } from "./Settings/ProfileSettingsSection";
import { AppUpdateCard } from "./Settings/AppUpdateCard";
import { AutomationsSection } from "./Settings/Automations/AutomationsSection";
import { BranchesSettings } from "./Settings/BranchesSettings";
import { LogoPresetButton } from "./Settings/components/LogoPresetButton";
import { useIsRootOwner } from "../hooks/useIsRootOwner";
import { isDesktop } from "../lib/platform";
import { showToast } from "../components/Toast";
import { getSessionId } from "../lib/errorLog";
import { reportError } from "../lib/reportError";
import { areSoundsEnabled, setSoundsEnabled } from "../lib/sounds";
import { loadDocumentsConfigRawFromDB, saveDocumentsConfigAutoPrint } from "../lib/documentSettings";
import { isJobiDocsRunning, launchJobiDocsApp, openJobiDocsDownload } from "../lib/jobidocs";
import { STORAGE_KEYS } from "../constants/storageKeys";
import { subscribeServiceConfig, mergeServiceConfig, type ServiceConfig } from "../lib/serviceSettingsSync";
import { LOGO_PRESETS, getLogoColors, type LogoPresetId } from "../lib/logoPresets";
import { setAppIconFromPreset } from "../lib/setAppIcon";
import { AppLogo } from "../components/AppLogo";
import { getVersion } from "@tauri-apps/api/app";
import { useAppUpdate } from "../context/AppUpdateContext";
import { useAuth } from "../auth/AuthProvider";


/**
 * Skupiny navigace. Klíče podsekcí (service_*, orders_*, appearance_*, about_*)
 * se schválně NEMĚNÍ, i když už neodpovídají skupinám – vedou na ně hluboké
 * odkazy z App.tsx (průvodce, toast aktualizace) a data-tour kotvy.
 */
type SettingsCategory = "company" | "orders" | "documents" | "communication" | "people" | "app" | "profile";
type SettingsSubsection = 
  | "service_basic" | "service_contact" | "service_billing" | "service_branches" | "service_sms" | "service_team" | "service_owner" | "service_api"
  | "communication_automations"
  | "orders_statuses" | "orders_filters" | "orders_required_fields" | "orders_tisk_dokumentu" | "orders_reklamace" | "orders_deleted" | "orders_device_options" | "orders_handoff_options"
  | "appearance_theme" | "appearance_ui" | "appearance_shortcuts" | "appearance_modules"
  | "profile_me"
  | "about_app" | "about_updates";

type SettingsSection = {
  category: SettingsCategory;
  subsection: SettingsSubsection;
};

/** Do které skupiny podsekce patří – ať hluboký odkaz nemusí znát skupinu. */
const SUBSECTION_CATEGORY: Record<SettingsSubsection, SettingsCategory> = {
  service_basic: "company", service_contact: "company", service_billing: "company", service_branches: "company", service_owner: "company",
  orders_statuses: "orders", orders_required_fields: "orders", orders_device_options: "orders", orders_handoff_options: "orders",
  orders_reklamace: "orders", orders_filters: "orders", orders_deleted: "orders",
  orders_tisk_dokumentu: "documents",
  service_sms: "communication", communication_automations: "communication",
  service_team: "people", service_api: "people",
  appearance_ui: "app", appearance_theme: "app", appearance_shortcuts: "app", appearance_modules: "app", about_updates: "app", about_app: "app",
  profile_me: "profile",
};

function sectionFor(subsection: SettingsSubsection): SettingsSection {
  return { category: SUBSECTION_CATEGORY[subsection], subsection };
}

function isSubsection(v: unknown): v is SettingsSubsection {
  return typeof v === "string" && v in SUBSECTION_CATEGORY;
}

type SubsectionDef = { key: SettingsSubsection; label: string; keywords: string[]; badge?: number };
type CategoryDef = { category: SettingsCategory; label: string; icon: ReactNode; subsections: SubsectionDef[] };

/** Hledání bez ohledu na diakritiku a velikost písmen. */
function normalizeText(v: string): string {
  return v.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
}

/** Akcentové barvy pro vzorníky v sekci Vzhled. Odpovídají --accent v theme.css. */
const ACCENT_SWATCHES: { id: ThemeAccent; label: string; color: string }[] = [
  { id: "default", label: "Výchozí", color: "#2563eb" },
  { id: "blue", label: "Modrá", color: "#0ea5e9" },
  { id: "green", label: "Zelená", color: "#22c55e" },
  { id: "orange", label: "Oranžová", color: "#f97316" },
  { id: "purple", label: "Fialová", color: "#8b5cf6" },
  { id: "pink", label: "Růžová", color: "#ec4899" },
];

const THEME_PRESETS: { id: ThemeMode; title: string; desc: string; bg: string; panel: string; accent: string; text: string }[] = [
  { id: "paper-mint", title: "Paper Mint", desc: "Světlé, mátový akcent, papírový dojem.", bg: "#F7FBFA", panel: "#FFFFFF", accent: "#14B8A6", text: "#0F172A" },
  { id: "sand-ink", title: "Sand & Ink", desc: "Světlé, jantarový akcent, teplé tóny.", bg: "#FBF7F1", panel: "#FFFFFF", accent: "#F59E0B", text: "#111827" },
  { id: "sky-blueprint", title: "Sky Blueprint", desc: "Světlé, modrý akcent, technický styl.", bg: "#F5FAFF", panel: "#FFFFFF", accent: "#2563EB", text: "#0B1220" },
  { id: "lilac-frost", title: "Lilac Frost", desc: "Světlé, fialový akcent, jemné.", bg: "#FAF8FF", panel: "#FFFFFF", accent: "#7C3AED", text: "#111827" },
];

/** Křížek – nahrazuje textové ✕, které se v každém systému kreslilo jinak. */
function XIcon({ size = 14 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M18 6L6 18M6 6l12 12" />
    </svg>
  );
}
function ArrowIcon({ dir }: { dir: "up" | "down" }) {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {dir === "up" ? <path d="M12 19V5M5 12l7-7 7 7" /> : <path d="M12 5v14M19 12l-7 7-7-7" />}
    </svg>
  );
}

/** Nadpis karty s popisem a místem pro „Uloženo“. */
function CardHeader({ title, description, right }: { title: ReactNode; description?: ReactNode; right?: ReactNode }) {
  return (
    <div style={{ marginBottom: "var(--space-3)" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "var(--space-2)" }}>
        <div style={{ fontWeight: 900, fontSize: "var(--text-base)", color: "var(--text)" }}>{title}</div>
        {right}
      </div>
      {description ? <div style={{ fontSize: "var(--text-sm)", color: "var(--muted)", marginTop: 2, lineHeight: 1.5 }}>{description}</div> : null}
    </div>
  );
}

const ORDERS_PAGE_SIZE_CHOICES: { value: number; label: string }[] = [
  { value: 25, label: "25" },
  { value: 50, label: "50" },
  { value: 100, label: "100" },
  { value: 200, label: "200" },
  { value: 0, label: "Vše" },
];

type DisplayMode = "list" | "grid" | "compact" | "compact-extra" | "timeline" | "stripe" | "status-grouped";
type SidebarPosition = "left" | "right" | "bottom";

type UIConfig = {
  app: {
    fabNewOrderEnabled: boolean;
    uiScale: number;
    reducedEffects?: boolean;
  };
  sidebar: {
    position: SidebarPosition;
  };
  home: {
    orderFilters: {
      selectedQuickStatusFilters: string[];
    };
  };
  orders: {
    displayMode: DisplayMode;
    pageSize: number;
    customerPhoneRequired: boolean;
    statusGroupedOrder?: string[];
    zvyrazneniStavu?: ZvyrazneniStavu;
  };
  /** Zapnutý modul Faktury. Vypnout, pokud používáte vlastní fakturační systém. */
  invoicingEnabled?: boolean;
};

const VALID_DISPLAY_MODES: DisplayMode[] = ["list", "grid", "compact", "compact-extra", "timeline", "stripe", "status-grouped"];
const VALID_SIDEBAR_POSITIONS: SidebarPosition[] = ["left", "right", "bottom"];

/** Windows startují s vypnutými efekty – rozostření tam prokazatelně trhá.
 *  Musí odpovídat stejnojmenné funkci v App.tsx. */
function defaultReducedEffects(): boolean {
  if (typeof navigator === "undefined") return false;
  return /Windows|Win64|Win32/i.test(navigator.userAgent || "");
}

function defaultUIConfig(): UIConfig {
  return {
    app: { fabNewOrderEnabled: true, uiScale: 1, reducedEffects: defaultReducedEffects() },
    sidebar: { position: "left" },
    home: { orderFilters: { selectedQuickStatusFilters: [] } },
    orders: { displayMode: "list", pageSize: 50, customerPhoneRequired: true },
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
    const customerPhoneRequired = parsed?.orders?.customerPhoneRequired;
    const invoicingEnabled = parsed?.invoicingEnabled;
    const sidebarPos = parsed?.sidebar?.position;
    const validPageSize = typeof pageSize === "number" && (pageSize === 0 || [25, 50, 100, 200].includes(pageSize))
      ? pageSize
      : d.orders.pageSize;

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
          : VYCHOZI_ZVYRAZNENI,
        customerPhoneRequired: typeof customerPhoneRequired === "boolean" ? customerPhoneRequired : d.orders.customerPhoneRequired,
        statusGroupedOrder: Array.isArray(parsed?.orders?.statusGroupedOrder) ? parsed.orders.statusGroupedOrder.filter((x: any) => typeof x === "string") : undefined,
      },
      invoicingEnabled: typeof invoicingEnabled === "boolean" ? invoicingEnabled : true,
    };
  } catch {
    return defaultUIConfig();
  }
}

function saveUIConfig(cfg: UIConfig & { invoicingEnabled?: boolean }) {
  localStorage.setItem(STORAGE_KEYS.UI_SETTINGS, JSON.stringify(cfg));
  window.dispatchEvent(new CustomEvent("jobsheet:ui-updated"));
}

type CompanyData = {
  abbreviation: string;
  name: string;
  ico: string;
  dic: string;
  language: string;
  defaultPhonePrefix: string;
  addressStreet: string;
  addressCity: string;
  addressZip: string;
  phone: string;
  email: string;
  website: string;
  bankAccount: string;
  iban: string;
  swift: string;
};

// safeLoadCompanyData is imported from Orders.tsx
// defaultCompanyData is not needed here as it's only used internally in Orders.tsx





type SettingsProps = {
  activeServiceId: string | null;
  setActiveServiceId: (serviceId: string | null) => void;
  services: Array<{ service_id: string; service_name: string; role: string; active?: boolean }>;
  refreshServices?: () => Promise<void>;
  onStartTour?: () => void;
  /** When set (e.g. by app tour), switch to this category/subsection so the highlighted tab is visible. */
  tourSection?: { category: string; subsection: string } | null;
  /** Když uživatel přijde z toastu „Jít do nastavení“ (aktualizace), otevřít tuto subsekci a pak vyvolat callback. */
  openToSubsection?: { category: SettingsCategory; subsection: SettingsSubsection } | null;
  onOpenToSubsectionConsumed?: () => void;
};

export default function Settings({ activeServiceId, setActiveServiceId, services, refreshServices, onStartTour, tourSection, openToSubsection, onOpenToSubsectionConsumed }: SettingsProps) {
  const isNarrow = useIsNarrow();
  const { session } = useAuth();
  const { statuses, fallbackKey } = useStatuses();
  const { theme, preference, setPreference } = useTheme();
  const appUpdate = useAppUpdate();
  const updateAvailable = !!(appUpdate?.update);
  const { isAdmin, hasCapability } = useActiveRole(activeServiceId);
  const { has: maModul } = useEntitlements(activeServiceId);
  /** Sekce API se ukazuje, jen když servis aspoň jeden z modulů má. */
  const maApi = maModul("api_catalog") || maModul("api_inventory");
  const isRootOwner = useIsRootOwner();
  const canManageDocuments = isAdmin || (hasCapability && hasCapability("can_manage_documents"));
  const { createStatus, deleteStatus, saveServiceSettings } = useSettingsActions({ activeServiceId });
  
  // Helper to handle status create/update (they use the same upsert function)
  const handleStatusUpsert = async (status: StatusMeta) => {
    await createStatus(status);
  };
  const [section, setSection] = useState<SettingsSection>(sectionFor("service_basic"));
  const [navQuery, setNavQuery] = useState("");
  const [pendingSection, setPendingSection] = useState<SettingsSection | null>(null);
  const [logoPreset, setLogoPresetState] = useState<LogoPresetId>(() => {
    try {
      const v = localStorage.getItem(STORAGE_KEYS.LOGO_PRESET) as LogoPresetId | null;
      return v && (v === "auto" || LOGO_PRESETS.some((p) => p.id === v)) ? v : "auto";
    } catch {
      return "auto";
    }
  });
  const setLogoPreset = (value: LogoPresetId) => {
    localStorage.setItem(STORAGE_KEYS.LOGO_PRESET, value);
    setLogoPresetState(value);
    window.dispatchEvent(new CustomEvent("jobsheet:logo-preset-changed"));
    setAppIconFromPreset(value, theme);
  };

  // Průvodce: přepnutí na správnou záložku, aby byl zvýrazněný prvek viditelný
  useEffect(() => {
    if (isSubsection(tourSection?.subsection)) {
      setSection(sectionFor(tourSection.subsection));
    }
  }, [tourSection?.category, tourSection?.subsection]);

  // Otevřít konkrétní subsekci (např. Aktualizace po kliku na „Jít do nastavení“ v toastu)
  useEffect(() => {
    if (!isSubsection(openToSubsection?.subsection)) return;
    setSection(sectionFor(openToSubsection.subsection));
    onOpenToSubsectionConsumed?.();
  }, [openToSubsection?.category, openToSubsection?.subsection, onOpenToSubsectionConsumed]);

  // Na stránce Klávesové zkratky vypnout globální zkratky (aby Ctrl+Q nevyhodilo jinam)
  useEffect(() => {
    if (section.subsection === "appearance_shortcuts") {
      document.body.dataset.jobsheetShortcutsConfig = "true";
      return () => {
        delete document.body.dataset.jobsheetShortcutsConfig;
      };
    }
  }, [section.subsection]);

  const [uiCfg, setUiCfg] = useState<UIConfig>(defaultUIConfig());
  const [soundsEnabled, setSoundsEnabledState] = useState(() => areSoundsEnabled());
  const [companyData, setCompanyData] = useState<CompanyData>(() => safeLoadCompanyData());
  /** Poslední uložený stav firemních údajů – proti němu se pozná „neuloženo“. */
  const companySavedRef = useRef<CompanyData>(companyData);
  const [companySaving, setCompanySaving] = useState(false);
  const [inviteCodeInput, setInviteCodeInput] = useState("");
  const [inviteAcceptLoading, setInviteAcceptLoading] = useState(false);
  
  
  // Calculate tooltip position
  
  
  
  // State for service settings from DB
  const [_serviceSettingsLoading, setServiceSettingsLoading] = useState(false);
  const [_serviceSettingsError, setServiceSettingsError] = useState<string | null>(null);
  const [ordersShowClaimsInList, setOrdersShowClaimsInList] = useState(false);
  const [autoPrintForm, setAutoPrintForm] = useState<{
    ticketListOnCreate: boolean;
    ticketListOnStatusKey: string | null;
    warrantyOnCreate: boolean;
    warrantyOnStatusKey: string | null;
    prijetiReklamaceOnCreate: boolean;
    prijetiReklamaceOnStatusKey: string | null;
    vydaniReklamaceOnStatusKey: string | null;
  }>({
    ticketListOnCreate: false,
    ticketListOnStatusKey: null,
    warrantyOnCreate: false,
    warrantyOnStatusKey: null,
    prijetiReklamaceOnCreate: false,
    prijetiReklamaceOnStatusKey: null,
    vydaniReklamaceOnStatusKey: null,
  });
  const [autoPrintFormLoading, setAutoPrintFormLoading] = useState(false);
  const [jobiDocsConnected, setJobiDocsConnected] = useState<boolean | null>(null);
  const [appVersion, setAppVersion] = useState<string>("…");
  const [smsPhoneRow, setSmsPhoneRow] = useState<{ twilio_number: string; forwarding_number: string | null } | null>(null);
  const [smsPhoneLoading, setSmsPhoneLoading] = useState(false);
  const [smsProvisionLoading, setSmsProvisionLoading] = useState(false);
  const [smsDisconnectLoading, setSmsDisconnectLoading] = useState(false);

  useEffect(() => setUiCfg(safeLoadUIConfig()), []);

  useEffect(() => {
    getVersion().then(setAppVersion).catch(() => setAppVersion("?"));
  }, []);
  
  /**
   * Firemní údaje (IČO, DIČ, adresa, bankovní účet...) se čtou z
   * service_settings.config.companyData a mirrorují do localStorage, kde
   * je pořád čtou dokumenty a faktury (safeLoadCompanyData) synchronně –
   * DB je zdroj pravdy, localStorage jen rychlá cache pro místa, která
   * dnes nejdou přes async načtení. Bez týhle druhé zápisu by Nastavení
   * ukazovalo čerstvá data, ale vygenerovaná faktura by pořád použila
   * starou lokální kopii.
   */
  const applyServiceConfig = useCallback((config: ServiceConfig) => {
    if (config.abbreviation || config.companyData) {
      setCompanyData((prev) => {
        const next = {
          ...prev,
          ...(config.companyData as Partial<CompanyData> | undefined),
          abbreviation: config.abbreviation || prev.abbreviation,
        };
        localStorage.setItem(STORAGE_KEYS.COMPANY, JSON.stringify(next));
        companySavedRef.current = next;
        return next;
      });
    }
    setOrdersShowClaimsInList(!!config.orders_show_claims_in_list);
  }, []);

  // Load service_settings from DB when activeServiceId changes
  useEffect(() => {
    if (!activeServiceId || !supabase) {
      setServiceSettingsLoading(false);
      setServiceSettingsError(null);
      return;
    }

    setServiceSettingsLoading(true);
    setServiceSettingsError(null);

    const loadServiceSettings = async () => {
      if (!supabase) {
        setServiceSettingsLoading(false);
        return;
      }

      try {
        const { data, error } = await (supabase
          .from("service_settings") as any)
          .select("config")
          .eq("service_id", activeServiceId)
          .maybeSingle();

        if (error) throw error;

        const config = (data?.config ?? {}) as ServiceConfig;
        if (data?.config) applyServiceConfig(config);

        // Jednorázová migrace: firemní údaje dřív žily jen v localStorage
        // každého zařízení. Když je DB ještě nemá a tady vyplněné jsou,
        // pošlou se nahoru – jinak by kolegové (a web) viděli prázdná pole,
        // dokud by někdo neklikl na Uložit. Kdo nemá oprávnění, RPC odmítne
        // a nic se neděje.
        if (!config.companyData) {
          const local = safeLoadCompanyData();
          const hasLocal = !!(local.name?.trim() || local.ico?.trim() || local.addressStreet?.trim() || local.email?.trim());
          if (hasLocal) {
            const res = await mergeServiceConfig(activeServiceId, {
              abbreviation: local.abbreviation || config.abbreviation,
              companyData: local as unknown as Record<string, unknown>,
            });
            if (!res.error) {
              companySavedRef.current = local;
              setCompanyData(local);
            }
          }
        }

        setServiceSettingsLoading(false);
      } catch (err) {
        console.error("[Settings] Error loading service settings:", err);
        setServiceSettingsError(err instanceof Error ? err.message : "Neznámá chyba");
        setServiceSettingsLoading(false);
      }
    };

    loadServiceSettings();
  }, [activeServiceId, applyServiceConfig]);

  // Realtime: firemní údaje a nabídky změněné kolegou/jiným zařízením se
  // propíšou i bez obnovení stránky.
  useEffect(() => {
    if (!activeServiceId) return;
    return subscribeServiceConfig(activeServiceId, applyServiceConfig);
  }, [activeServiceId, applyServiceConfig]);

  useEffect(() => {
    const client = getTypedSupabaseClient();
    if (!activeServiceId || !client) {
      setSmsPhoneRow(null);
      setSmsPhoneLoading(false);
      return;
    }
    setSmsPhoneLoading(true);
    client
      .from("service_phone_numbers")
      .select("twilio_number, forwarding_number")
      .eq("service_id", activeServiceId)
      .maybeSingle()
      .then(({ data, error }) => {
        setSmsPhoneLoading(false);
        if (error) {
          setSmsPhoneRow(null);
          return;
        }
        setSmsPhoneRow(data ?? null);
      });
  }, [activeServiceId]);

  useEffect(() => {
    if (section.subsection !== "orders_tisk_dokumentu") return;
    let cancelled = false;
    const check = () => { isJobiDocsRunning().then((ok) => { if (!cancelled) setJobiDocsConnected(ok); }); };
    check();
    const id = setInterval(check, 3000);
    return () => { cancelled = true; clearInterval(id); };
  }, [section.subsection]);

  // Load auto-print config when opening Tisk dokumentů
  useEffect(() => {
    if (section.subsection !== "orders_tisk_dokumentu" || !activeServiceId) return;
    let cancelled = false;
    setAutoPrintFormLoading(true);
    loadDocumentsConfigRawFromDB(activeServiceId).then((raw) => {
      if (cancelled) return;
      setAutoPrintFormLoading(false);
      if (raw?.config?.autoPrint) {
        const ap = raw.config.autoPrint;
        setAutoPrintForm({
          ticketListOnCreate: !!ap.ticketListOnCreate,
          ticketListOnStatusKey: ap.ticketListOnStatusKey ?? null,
          warrantyOnCreate: !!ap.warrantyOnCreate,
          warrantyOnStatusKey: ap.warrantyOnStatusKey ?? null,
          prijetiReklamaceOnCreate: !!ap.prijetiReklamaceOnCreate,
          prijetiReklamaceOnStatusKey: ap.prijetiReklamaceOnStatusKey ?? null,
          vydaniReklamaceOnStatusKey: ap.vydaniReklamaceOnStatusKey ?? null,
        });
      }
    }).catch(() => { if (!cancelled) setAutoPrintFormLoading(false); });
    return () => { cancelled = true; };
  }, [section.subsection, activeServiceId]);

  const saveOrdersShowClaimsInList = useCallback(async (value: boolean) => {
    if (!activeServiceId || !supabase) return;
    try {
      await (supabase as any).rpc("update_service_settings", {
        p_service_id: activeServiceId,
        p_patch: { config: { orders_show_claims_in_list: value } },
      });
      setOrdersShowClaimsInList(value);
      showToast("Uloženo", "success");
      window.dispatchEvent(new CustomEvent("jobsheet:ui-updated"));
    } catch (err) {
      console.error("[Settings] saveOrdersShowClaimsInList", err);
      reportError({
        code: "settings.save_failed",
        error: err,
        userMessage: "Chyba při ukládání",
        source: "Settings.save",
      });
    }
  }, [activeServiceId]);

  // Save only when explicitly changed, not on every render
  const prevUiCfgRef = useRef<UIConfig | null>(null);
  useEffect(() => {
    if (prevUiCfgRef.current && JSON.stringify(prevUiCfgRef.current) !== JSON.stringify(uiCfg)) {
      saveUIConfig(uiCfg);
    }
    prevUiCfgRef.current = uiCfg;
  }, [uiCfg]);
  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key === STORAGE_KEYS.COMPANY) {
        const loaded = safeLoadCompanyData();
        companySavedRef.current = loaded;
        setCompanyData(loaded);
      }
      if (e.key === STORAGE_KEYS.UI_SETTINGS) setUiCfg(safeLoadUIConfig());
    };
    window.addEventListener("storage", onStorage);
    const onUiUpdated = () => setUiCfg(safeLoadUIConfig());
    window.addEventListener("jobsheet:ui-updated" as any, onUiUpdated);
    return () => {
      window.removeEventListener("storage", onStorage);
      window.removeEventListener("jobsheet:ui-updated" as any, onUiUpdated);
    };
  }, []);

  const [draft, setDraft] = useState<StatusMeta>({
    key: "",
    label: "",
    bg: STATUS_COLOR_PALETTE[0].bg,
    fg: STATUS_COLOR_PALETTE[0].fg,
    isFinal: false,
  });
  
  const [showCustomColor, setShowCustomColor] = useState(false);

  // Generate unique key from label automatically
  const generateKeyFromLabel = (label: string, existingKeys: Set<string> = new Set()): string => {
    if (!label) return "";
    
    // Convert to lowercase
    let baseKey = label.toLowerCase();
    
    // Remove diacritics (Czech characters)
    const diacriticsMap: Record<string, string> = {
      'á': 'a', 'č': 'c', 'ď': 'd', 'é': 'e', 'ě': 'e', 'í': 'i', 'ň': 'n',
      'ó': 'o', 'ř': 'r', 'š': 's', 'ť': 't', 'ú': 'u', 'ů': 'u', 'ý': 'y', 'ž': 'z'
    };
    baseKey = baseKey.replace(/[áčďéěíňóřšťúůýž]/g, (char) => diacriticsMap[char] || char);
    
    // Replace spaces and special characters with underscores
    baseKey = baseKey.replace(/[^a-z0-9]+/g, '_');
    
    // Remove leading/trailing underscores
    baseKey = baseKey.replace(/^_+|_+$/g, '');
    
    // Limit length to 50 characters
    if (baseKey.length > 50) {
      baseKey = baseKey.substring(0, 50);
      baseKey = baseKey.replace(/_+$/, ''); // Remove trailing underscores after truncation
    }
    
    // Ensure uniqueness by appending a number if needed
    let key = baseKey;
    let counter = 1;
    while (existingKeys.has(key)) {
      key = `${baseKey}_${counter}`;
      counter++;
      // Prevent infinite loop
      if (counter > 1000) break;
    }
    
    return key;
  };

  const keyTrim = draft.key.trim();
  const labelTrim = draft.label.trim();

  const keyExists = useMemo(() => {
    if (!keyTrim) return false;
    return statuses.some((s) => s.key === keyTrim);
  }, [keyTrim, statuses]);

  const canSave = keyTrim.length > 0 && labelTrim.length > 0;

  const selectedQuick = uiCfg.home.orderFilters.selectedQuickStatusFilters;

  useEffect(() => {
    const existingKeys = new Set(statuses.map((s) => s.key));
    const cleaned = selectedQuick.filter((k) => existingKeys.has(k));
    if (cleaned.length !== selectedQuick.length) {
      setUiCfg((p) => ({
        ...p,
        home: { ...p.home, orderFilters: { ...p.home.orderFilters, selectedQuickStatusFilters: cleaned } },
      }));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [statuses]);

  const toggleQuick = (key: string) => {
    setUiCfg((p) => {
      const curr = p.home.orderFilters.selectedQuickStatusFilters;
      const exists = curr.includes(key);
      const next = exists ? curr.filter((x) => x !== key) : [...curr, key];
      return {
        ...p,
        home: {
          ...p.home,
          orderFilters: { ...p.home.orderFilters, selectedQuickStatusFilters: next },
        },
      };
    });
  };

  const border = "1px solid var(--border)";

  // „Uloženo“ u samoukládacích prvků – jedno na kartu.
  const hintEfekty = useSavedHint();
  const hintMeritko = useSavedHint();
  const hintFab = useSavedHint();
  const hintZvuky = useSavedHint();
  const hintZobrazeni = useSavedHint();
  const hintZvyrazneni = useSavedHint();
  const hintPoradi = useSavedHint();
  const hintSidebar = useSavedHint();
  const hintModuly = useSavedHint();
  const hintStrankovani = useSavedHint();
  const hintFiltry = useSavedHint();
  const hintReklamace = useSavedHint();
  const hintPovinne = useSavedHint();
  const hintTisk = useSavedHint();
  const hintTema = useSavedHint();
  const hintLogo = useSavedHint();

  const updateUi = (next: UIConfig, hint?: { show: () => void }) => {
    setUiCfg(next);
    saveUIConfig(next);
    hint?.show();
  };

  // ---- Firemní údaje: jedna lišta „Neuložené změny“ pro Údaje firmy i Kontakty ----
  const companyDirty = JSON.stringify(companyData) !== JSON.stringify(companySavedRef.current);
  const saveCompany = async () => {
    setCompanySaving(true);
    try {
      await saveServiceSettings(companyData);
      companySavedRef.current = companyData;
    } finally {
      setCompanySaving(false);
    }
  };
  const discardCompany = () => setCompanyData(companySavedRef.current);

  // ---- Hlídání neuložených změn při přepnutí sekce ----
  const childUnsavedRef = useRef<UnsavedHandle | null>(null);
  const registerUnsaved = useCallback((h: UnsavedHandle | null) => { childUnsavedRef.current = h; }, []);
  const isCompanySection = section.subsection === "service_basic" || section.subsection === "service_contact";
  const currentUnsaved = (): UnsavedHandle | null =>
    isCompanySection ? { dirty: companyDirty, save: saveCompany, discard: discardCompany } : childUnsavedRef.current;
  const requestSection = (next: SettingsSection) => {
    if (next.subsection === section.subsection) return;
    const h = currentUnsaved();
    if (h?.dirty) { setPendingSection(next); return; }
    setSection(next);
  };

  const categories = useMemo<CategoryDef[]>(() => {
    const all: CategoryDef[] = [
    {
      category: "company",
      label: "Firma",
      icon: (
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M3 21h18M5 21V7l7-4 7 4v14M9 21v-6h6v6M9 10h.01M15 10h.01M9 14h.01M15 14h.01" />
        </svg>
      ),
      subsections: [
        { key: "service_basic", label: "Údaje firmy", keywords: ["firma", "servis", "název", "ičo", "dič", "adresa", "zkratka", "jazyk", "předvolba", "základní údaje", "město", "psč"] },
        ...(canManageDocuments ? [{ key: "service_contact" as const, label: "Kontakty", keywords: ["kontakt", "telefon", "e-mail", "email", "web", "banka", "bankovní účet", "číslo účtu", "iban", "swift"] }] : []),
        { key: "service_billing", label: "Fakturace a DPH", keywords: ["dph", "faktura", "fakturace", "sazba", "plátce", "ceny s dph", "veřejné api", "adresa api", "slug"] },
        ...(isAdmin ? [{ key: "service_branches" as const, label: "Pobočky", keywords: ["pobočka", "pobočky", "provozovna", "adresa", "sklad", "zkratka", "více míst"] }] : []),
        ...(isRootOwner ? [{ key: "service_owner" as const, label: "Owner", keywords: ["owner", "majitel", "servisy", "moduly", "licence", "vytvořit servis", "smazat servis"] }] : []),
      ],
    },
    {
      category: "orders",
      label: "Zakázky",
      icon: (
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z" />
        </svg>
      ),
      subsections: [
        { key: "orders_statuses", label: "Statusy zakázek", keywords: ["status", "stav", "statusy", "stavy", "barvy", "finální", "pořadí", "hotovo", "přijato"] },
        { key: "orders_required_fields", label: "Povinná pole", keywords: ["telefon", "povinné", "povinný", "pole", "validace", "telefon zákazníka"] },
        { key: "orders_device_options", label: "Stavy zařízení a příslušenství", keywords: ["zařízení", "příslušenství", "stav zařízení", "kryt", "nabíječka", "poškození"] },
        { key: "orders_handoff_options", label: "Převzetí a předání", keywords: ["převzetí", "předání", "osobně", "pošta", "kurýr", "způsob"] },
        { key: "orders_reklamace", label: "Reklamace", keywords: ["reklamace", "seznam", "aktivní", "vše"] },
        { key: "orders_filters", label: "Filtry a stránkování", keywords: ["filtry", "rychlé filtry", "stránkování", "počet zakázek", "stránka", "na stránce"] },
        { key: "orders_deleted", label: "Koš smazaných zakázek", keywords: ["koš", "smazané", "smazaná zakázka", "obnovit", "obnova"] },
      ],
    },
    {
      category: "documents",
      label: "Dokumenty a tisk",
      icon: (
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M6 9V2h12v7M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2M6 14h12v8H6z" />
        </svg>
      ),
      subsections: [
        { key: "orders_tisk_dokumentu", label: "JobiDocs a automatický tisk", keywords: ["tisk", "tiskárna", "jobidocs", "automaticky", "automatický tisk", "záruční list", "zakázkový list", "šablony", "dokumenty", "reklamační protokol", "přijetí reklamace", "vydání reklamace"] },
      ],
    },
    {
      category: "communication",
      label: "Komunikace",
      icon: (
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
        </svg>
      ),
      subsections: [
        ...(isAdmin ? [{ key: "service_sms" as const, label: "SMS", keywords: ["sms", "telefonní číslo", "zprávy", "přesměrování", "hovory", "šablona zprávy"] }] : []),
        ...(isAdmin ? [{ key: "communication_automations" as const, label: "Automatizace", keywords: ["automatizace", "pravidla", "připomínka", "sms", "e-mail", "skladné", "recenze", "vyzvednutí"] }] : []),
      ],
    },
    {
      category: "people",
      label: "Lidé a přístupy",
      icon: (
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2M23 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75" /><circle cx="9" cy="7" r="4" />
        </svg>
      ),
      subsections: [
        ...(isAdmin ? [{ key: "service_team" as const, label: "Tým a oprávnění", keywords: ["tým", "přístupy", "oprávnění", "povolení", "pozvánka", "pozvat", "člen", "admin", "role", "odebrat"] }] : []),
        ...(maApi ? [{ key: "service_api" as const, label: "API", keywords: ["api", "token", "webhook", "ceník", "sklad", "veřejné", "dokumentace", "openapi"] }] : []),
      ],
    },
    {
      category: "app",
      label: "Aplikace",
      icon: (
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <rect x="2" y="3" width="20" height="14" rx="2" /><path d="M8 21h8M12 17v4" />
        </svg>
      ),
      subsections: [
        { key: "appearance_ui", label: "Rozhraní", keywords: ["rozhraní", "měřítko", "velikost", "zvuky", "plovoucí tlačítko", "zobrazení zakázek", "seznam", "mřížka", "kompaktní", "sidebar", "postranní panel", "navigace", "efekty", "výkon", "rozostření", "zvýraznění stavu"] },
        { key: "appearance_theme", label: "Vzhled", keywords: ["tmavý", "světlý", "barva", "motiv", "téma", "akcent", "vzhled", "logo", "ikona", "podle systému", "dark mode", "předvolby"] },
        { key: "appearance_shortcuts", label: "Klávesové zkratky", keywords: ["klávesové zkratky", "zkratky", "klávesnice", "hotkey"] },
        { key: "appearance_modules", label: "Moduly", keywords: ["moduly", "faktury", "fakturační systém", "vypnout faktury", "modul"] },
        // Aktualizace jsou jen pro desktop – web je vždy aktuální.
        ...(isDesktop() ? [{ key: "about_updates" as const, label: "Aktualizace", keywords: ["aktualizace", "verze", "update", "nová verze", "nainstalovat"], badge: updateAvailable ? 1 : undefined }] : []),
        { key: "about_app", label: "O aplikaci", keywords: ["o aplikaci", "verze", "podpora", "průvodce", "id relace", "tour", "userid", "serviceid"] },
      ],
    },
    {
      category: "profile",
      label: "Můj profil",
      icon: (
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" /><circle cx="12" cy="7" r="4" />
        </svg>
      ),
      subsections: [
        { key: "profile_me", label: "Fotka a přezdívka", keywords: ["profil", "přezdívka", "avatar", "fotka", "nick", "pozvánka", "kód", "přidat servis"] },
      ],
    },
  // Skupina bez viditelné podsekce se neukazuje (např. Komunikace pro člena).
    ];
    return all.filter((cat) => cat.subsections.length > 0);
  }, [isRootOwner, isAdmin, canManageDocuments, maApi, updateAvailable]);

  // Member nemá přístup k Tým/Přístupy ani SMS – při výběru servisu kde je member přesměruj
  useEffect(() => {
    if ((section.subsection === "service_team" || section.subsection === "service_sms" || section.subsection === "communication_automations" || section.subsection === "service_branches") && !isAdmin) {
      setSection(sectionFor("service_basic"));
    }
  }, [section.subsection, isAdmin]);

  // Owner záložka jen pro root ownera – admin/member ji nevidí ani na ni nesmí zůstat (např. po přepnutí servisu)
  useEffect(() => {
    if (section.subsection === "service_owner" && !isRootOwner) {
      setSection(sectionFor("service_basic"));
    }
  }, [section.subsection, isRootOwner]);

  // Bez can_manage_documents skrýt Kontaktní údaje – při přepnutí role přesměruj
  useEffect(() => {
    if (!canManageDocuments && section.subsection === "service_contact") {
      setSection(sectionFor("service_basic"));
    }
  }, [section.subsection, canManageDocuments]);

  const pendingHandle = pendingSection ? currentUnsaved() : null;

  return (
    <UnsavedGuardProvider register={registerUnsaved}>
    <div data-tour="settings-content" style={{ display: "flex", flexDirection: "column", gap: "var(--space-4)" }}>
      <div style={{ fontSize: "var(--text-xl)", fontWeight: 950, color: "var(--text)" }}>Nastavení</div>

      <div
        style={{
          display: isNarrow ? "flex" : "grid",
          flexDirection: "column",
          gridTemplateColumns: "236px minmax(0, 1fr)",
          gap: "var(--space-5)",
          // Ve sloupci (telefon) musí být stretch: se start se obsah
          // nesmršťuje na šířku displeje, ale roste podle nejširšího prvku
          // (dlaždice režimů zobrazení měly 800 px) a stránka přetékala.
          alignItems: isNarrow ? "stretch" : "start",
        }}
      >
      <SettingsNav
        categories={categories}
        section={section}
        onSelect={requestSection}
        query={navQuery}
        onQueryChange={setNavQuery}
        isNarrow={isNarrow}
      />

      <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-4)", minWidth: 0, maxWidth: "100%" }}>

      {/* SERVIS - ZÁKLADNÍ ÚDAJE */}
      {section.subsection === "service_basic" && (
        <>
          <Card>
            <CardHeader title="Údaje firmy" description="Základní informace o vašem servisu nebo firmě. Tisknou se v hlavičce dokumentů." />

            <div style={{ display: "grid", gap: 16 }}>
              <div>
                <FieldLabel>Zkratka *</FieldLabel>
                <TextInput
                  type="text"
                  value={companyData.abbreviation}
                  onChange={(e: any) => setCompanyData((p) => ({ ...p, abbreviation: e.target.value }))}
                  placeholder="Zkratka"
                />
              </div>

              <div>
                <FieldLabel>Název *</FieldLabel>
                <TextInput
                  type="text"
                  value={companyData.name}
                  onChange={(e: any) => setCompanyData((p) => ({ ...p, name: e.target.value }))}
                  placeholder="Název servisu"
                />
              </div>

              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 240px), 1fr))", gap: 16 }}>
                <div>
                  <FieldLabel>IČO *</FieldLabel>
                  <TextInput
                    type="text"
                    value={companyData.ico}
                    onChange={(e: any) => setCompanyData((p) => ({ ...p, ico: e.target.value }))}
                    placeholder="12345678"
                  />
                </div>

                <div>
                  <FieldLabel>DIČ</FieldLabel>
                  <TextInput
                    type="text"
                    value={companyData.dic}
                    onChange={(e: any) => setCompanyData((p) => ({ ...p, dic: e.target.value }))}
                    placeholder="CZ12345678"
                  />
                </div>
              </div>

              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 240px), 1fr))", gap: 16 }}>
                <div>
                  <FieldLabel>Jazyk *</FieldLabel>
                  <LanguagePicker
                    value={companyData.language}
                    onChange={(value) => setCompanyData((p) => ({ ...p, language: value }))}
                  />
                </div>

                <div>
                  <FieldLabel>Výchozí tel. předvolba *</FieldLabel>
                  <TextInput
                    type="text"
                    value={companyData.defaultPhonePrefix}
                    onChange={(e: any) => setCompanyData((p) => ({ ...p, defaultPhonePrefix: e.target.value }))}
                    placeholder="+420"
                  />
                </div>
              </div>

              <div>
                <div style={{ fontWeight: 700, fontSize: "var(--text-base)", color: "var(--text)", marginTop: 8, marginBottom: 8 }}>Adresa</div>
                
                <div style={{ marginBottom: 16 }}>
                  <FieldLabel>Ulice *</FieldLabel>
                  <TextInput
                    type="text"
                    value={companyData.addressStreet}
                    onChange={(e: any) => setCompanyData((p) => ({ ...p, addressStreet: e.target.value }))}
                    placeholder="Ulice a číslo popisné"
                  />
                </div>

                <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr", gap: 16 }}>
                  <div>
                    <FieldLabel>Město *</FieldLabel>
                    <TextInput
                      type="text"
                      value={companyData.addressCity}
                      onChange={(e: any) => setCompanyData((p) => ({ ...p, addressCity: e.target.value }))}
                      placeholder="Město"
                    />
                  </div>

                  <div>
                    <FieldLabel>PSČ *</FieldLabel>
                    <TextInput
                      type="text"
                      value={companyData.addressZip}
                      onChange={(e: any) => setCompanyData((p) => ({ ...p, addressZip: e.target.value }))}
                      placeholder="123 45"
                    />
                  </div>
                </div>
              </div>

            </div>
          </Card>
          <UnsavedBar dirty={companyDirty} saving={companySaving} onSave={() => { saveCompany().catch(() => {}); }} onDiscard={discardCompany} />
        </>
      )}

      {/* SERVIS - KONTAKTNÍ ÚDAJE */}
      {section.subsection === "service_contact" && (
        <>
          <Card>
            <CardHeader title="Kontakty" description="Kontaktní a bankovní údaje pro komunikaci se zákazníky a pro dokumenty." />

            <div style={{ display: "grid", gap: 16 }}>
              <div>
                <FieldLabel>Telefonní číslo *</FieldLabel>
                <TextInput
                  type="tel"
                  value={companyData.phone}
                  onChange={(e: any) => setCompanyData((p) => ({ ...p, phone: e.target.value }))}
                  placeholder="+420 123 456 789"
                />
              </div>

              <div>
                <FieldLabel>E-mailová adresa *</FieldLabel>
                <TextInput
                  type="email"
                  value={companyData.email}
                  onChange={(e: any) => setCompanyData((p) => ({ ...p, email: e.target.value }))}
                  placeholder="kontakt@example.cz"
                />
              </div>

              <div>
                <FieldLabel>Webová adresa</FieldLabel>
                <TextInput
                  type="url"
                  value={companyData.website}
                  onChange={(e: any) => setCompanyData((p) => ({ ...p, website: e.target.value }))}
                  placeholder="www.example.cz"
                />
              </div>

              <div style={{ borderTop: "1px solid var(--border)", marginTop: 8, paddingTop: 16 }}>
                <div style={{ fontWeight: 800, fontSize: "var(--text-base)", color: "var(--text)", marginBottom: 12 }}>Bankovní údaje</div>
              </div>

              <div>
                <FieldLabel>Číslo účtu</FieldLabel>
                <TextInput
                  value={companyData.bankAccount}
                  onChange={(e: any) => setCompanyData((p) => ({ ...p, bankAccount: e.target.value }))}
                  placeholder="123456789/0100"
                />
              </div>

              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 240px), 1fr))", gap: 16 }}>
                <div>
                  <FieldLabel>IBAN</FieldLabel>
                  <TextInput
                    value={companyData.iban}
                    onChange={(e: any) => setCompanyData((p) => ({ ...p, iban: e.target.value }))}
                    placeholder="CZ6508000000192000145399"
                  />
                </div>
                <div>
                  <FieldLabel>SWIFT / BIC</FieldLabel>
                  <TextInput
                    value={companyData.swift}
                    onChange={(e: any) => setCompanyData((p) => ({ ...p, swift: e.target.value }))}
                    placeholder="GIBACZPX"
                  />
                </div>
              </div>

            </div>
          </Card>
          <UnsavedBar dirty={companyDirty} saving={companySaving} onSave={() => { saveCompany().catch(() => {}); }} onDiscard={discardCompany} />
        </>
      )}

      {/* FIRMA - FAKTURACE A DPH */}
      {section.subsection === "service_billing" && (
        <DphNastaveni activeServiceId={activeServiceId} />
      )}

      {/* KOMUNIKACE - SMS */}
      {section.subsection === "service_sms" && activeServiceId && (
        <>
          <Card>
            <div style={{ fontWeight: 900, fontSize: "var(--text-base)", marginBottom: "var(--space-2)", color: "var(--text)" }}>SMS komunikace</div>
            <div style={{ fontSize: "var(--text-base)", color: "var(--muted)", marginBottom: 16 }}>
              Vlastní telefonní číslo pro SMS a hovory se zákazníky
            </div>

            {smsPhoneLoading ? (
              <div style={{ padding: "var(--space-4)", textAlign: "center", color: "var(--muted)" }}>Načítám…</div>
            ) : !smsPhoneRow ? (
              <>
                <p style={{ marginBottom: 16, color: "var(--text)", fontSize: "var(--text-base)" }}>
                  Aktivací SMS získáte vlastní telefonní číslo pro komunikaci se zákazníky.
                </p>
                <button
                  type="button"
                  disabled={smsProvisionLoading}
                  onClick={async () => {
                    const token = session?.access_token;
                    if (!token || !activeServiceId) {
                      showToast("Přihlaste se a zvolte servis", "error");
                      return;
                    }
                    setSmsProvisionLoading(true);
                    try {
                      const res = await supabaseFetch(`${supabaseUrl}/functions/v1/sms-provision`, {
                        method: "POST",
                        headers: {
                          "Content-Type": "application/json",
                          Authorization: `Bearer ${token}`,
                        },
                        body: JSON.stringify({ service_id: activeServiceId }),
                      });
                      const raw = await res.text();
                      let data: { error?: string; detail?: string; twilio_number?: string } = {};
                      try {
                        if (raw) data = JSON.parse(raw);
                      } catch {
                        if (!res.ok) data = { error: raw || `HTTP ${res.status}` };
                      }
                      if (!res.ok) {
                        const msg = (data.error ?? data.detail ?? raw) || `Chyba ${res.status}`;
                        throw new Error(msg);
                      }
                      const errMsg = data.error;
                      if (errMsg) throw new Error(errMsg);
                      if (data.twilio_number) {
                        setSmsPhoneRow({ twilio_number: data.twilio_number, forwarding_number: null });
                        showToast("SMS aktivována. Číslo: " + data.twilio_number, "success");
                      }
                    } catch (e) {
                      const msg = e instanceof Error ? e.message : "Nepodařilo se aktivovat SMS";
                      showToast(msg, "error");
                    } finally {
                      setSmsProvisionLoading(false);
                    }
                  }}
                  style={{
                    padding: "12px 24px",
                    borderRadius: 12,
                    border: "none",
                    background: smsProvisionLoading ? "var(--panel-2)" : "var(--accent)",
                    color: smsProvisionLoading ? "var(--muted)" : "var(--accent-fg)",
                    fontWeight: 700,
                    fontSize: "var(--text-base)",
                    cursor: smsProvisionLoading ? "not-allowed" : "pointer",
                  }}
                >
                  {smsProvisionLoading ? "Aktivuji…" : "Aktivovat SMS"}
                </button>
              </>
            ) : (
              <>
                <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 16 }}>
                  <span style={{ fontSize: "var(--text-base)", color: "var(--text)" }}>
                    Přidělené číslo: <strong>{smsPhoneRow.twilio_number.replace(/(\+420)(\d{3})(\d{3})(\d{3})/, "$1 $2 $3 $4")}</strong>
                  </span>
                  <span style={{ fontSize: "var(--text-xs)", fontWeight: 700, color: "var(--success)", background: "var(--success-muted)", padding: "4px 8px", borderRadius: 8 }}>Aktivní</span>
                </div>
                {/* Přesměrování hovorů tu bylo, ale sdílené číslo má v Twiliu jen SMS
                    (hlas ne), takže se hovor nikdy nespojí a nastavení nemělo účinek.
                    Vrátit, až bude číslo s hlasem – logika v sms-voice zůstává. */}
                <div style={{ fontSize: "var(--text-sm)", color: "var(--muted)", marginBottom: 12 }}>
                  Číslo je jen pro SMS, hovory na něj se nespojí. Do zpráv zákazníkům proto přidávejte telefon servisu.
                </div>
                {isAdmin && (
                  <div
                    style={{
                      marginTop: 24,
                      paddingTop: 20,
                      borderTop: "1px solid var(--border)",
                    }}
                  >
                    <button
                      type="button"
                      disabled={smsDisconnectLoading}
                      onClick={async () => {
                        if (
                          !confirm(
                            "Odpojit SMS u tohoto servisu?\n\nTento servis přestane používat přiřazené číslo. Konverzace v Jobi zůstanou. U jiných servisů se stejným sdíleným číslem nic nemění."
                          )
                        ) {
                          return;
                        }
                        const client = getTypedSupabaseClient();
                        if (!client || !activeServiceId) return;
                        setSmsDisconnectLoading(true);
                        try {
                          const { error } = await client.from("service_phone_numbers").delete().eq("service_id", activeServiceId);
                          if (error) throw error;
                          setSmsPhoneRow(null);
                          showToast("SMS odpojena. Můžete znovu aktivovat.", "success");
                        } catch (e) {
                          reportError({
                            code: "settings.sms_disconnect_failed",
                            error: e,
                            userMessage: e instanceof Error ? e.message : "Nepodařilo se odpojit SMS",
                            source: "Settings.disconnectSms",
                          });
                        } finally {
                          setSmsDisconnectLoading(false);
                        }
                      }}
                      style={{
                        padding: "10px 16px",
                        borderRadius: 10,
                        border: "1px solid var(--danger, #c62828)",
                        background: "transparent",
                        color: "var(--danger, #c62828)",
                        fontWeight: 700,
                        fontSize: "var(--text-sm)",
                        cursor: smsDisconnectLoading ? "not-allowed" : "pointer",
                        opacity: smsDisconnectLoading ? 0.6 : 1,
                      }}
                    >
                      {smsDisconnectLoading ? "Odpojuji…" : "Odpojit SMS u tohoto servisu"}
                    </button>
                  </div>
                )}
              </>
            )}
          </Card>

          <div style={{ marginTop: 24 }}>
            <Card>
              <div style={{ fontWeight: 950, fontSize: "var(--text-base)", marginBottom: 4, color: "var(--text)" }}>Automatické zprávy</div>
              <div style={{ fontSize: "var(--text-sm)", color: "var(--muted)", marginBottom: 12 }}>
                Automatické SMS při změně stavu, připomínky vyzvednutí a další pravidla nastavíte v sekci Komunikace → Automatizace.
              </div>
              <Button size="sm" onClick={() => requestSection(sectionFor("communication_automations"))}>Otevřít Automatizace</Button>
            </Card>
          </div>
        </>
      )}

      {/* KOMUNIKACE - AUTOMATIZACE */}
      {section.subsection === "communication_automations" && activeServiceId && (
        <AutomationsSection activeServiceId={activeServiceId} />
      )}

      {/* FIRMA - POBOČKY */}
      {section.subsection === "service_branches" && activeServiceId && isAdmin && (
        <BranchesSettings activeServiceId={activeServiceId} abbreviation={companyData.abbreviation} />
      )}

      {/* SERVIS - TÝM / PŘÍSTUPY */}
      {section.subsection === "service_team" && (
        <TeamSettings activeServiceId={activeServiceId} setActiveServiceId={setActiveServiceId} services={services} />
      )}

      {/* Owner – pouze pro root ownera; správa servisů (vytvoření, mazání, deaktivace). Admin vidí vše kromě této záložky a nemůže přidávat/mazat servisy. */}
      {section.subsection === "service_api" && maApi && (
        <Card>
          <CardHeader title="Veřejné API" description="Údaje pro napojení webu nebo jiného systému na data tohoto servisu." />
          <ApiNastaveni activeServiceId={activeServiceId} />
        </Card>
      )}

      {section.subsection === "service_owner" && isRootOwner && refreshServices && (
        <OwnerSettings services={services} refreshServices={refreshServices} setActiveServiceId={setActiveServiceId} />
      )}

      {/* MŮJ PROFIL - FOTKA A PŘEZDÍVKA + PŘIDAT SERVIS POZVÁNKOU */}
      {section.subsection === "profile_me" && (
        <>
          <ProfileSettingsSection />
          <div>
            <Card>
              <CardHeader title="Přidat servis pomocí pozvánky" description="Máte kód z e-mailu s pozvánkou do dalšího servisu? Zadejte ho a přidáte se bez odhlášení." />
              <div style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "flex-end" }}>
                <div style={{ flex: "1 1 200px", minWidth: 0 }}>
                  <FieldLabel>Kód z e-mailu</FieldLabel>
                  <TextInput
                    type="text"
                    value={inviteCodeInput}
                    onChange={(e: ChangeEvent<HTMLInputElement>) => setInviteCodeInput(e.target.value)}
                    placeholder="Vložte kód z pozvánky"
                    disabled={inviteAcceptLoading}
                    style={{ width: "100%" }}
                  />
                </div>
                <Button
                  variant="primary"
                  disabled={!inviteCodeInput.trim() || inviteAcceptLoading}
                  onClick={async () => {
                    const token = inviteCodeInput.trim();
                    if (!token || !refreshServices || !supabase) return;
                    setInviteAcceptLoading(true);
                    try {
                      const { data, error } = await supabase.functions.invoke("invite-accept", { body: { token } });
                      if (error) {
                        const res = (error as any)?.context as Response | undefined;
                        let detail = "";
                        if (res) {
                          try {
                            detail = await res.clone().text();
                          } catch {}
                        }
                        showToast(`Chyba při přijetí pozvánky: ${error.message}${detail ? " | " + detail : ""}`, "error");
                        return;
                      }
                      if (data?.serviceId) {
                        showToast("Pozvánka byla přijata – servis je přidaný", "success");
                        setInviteCodeInput("");
                        await refreshServices();
                      }
                    } catch (err) {
                      reportError({
                        code: "settings.invite_accept_failed",
                        error: err,
                        userMessage: err instanceof Error ? err.message : "Neznámá chyba",
                        source: "Settings.acceptInvite",
                      });
                    } finally {
                      setInviteAcceptLoading(false);
                    }
                  }}
                >
                  {inviteAcceptLoading ? "Přidávám…" : "Přidat servis"}
                </Button>
              </div>
            </Card>
          </div>
        </>
      )}

      {/* APLIKACE - VZHLED */}
      {section.subsection === "appearance_theme" && (() => {
        // Uložená volba → režim × akcent. Pojmenované předvolby nemají akcent.
        const isSystem = preference.startsWith("system:");
        const split = isSystem ? null : splitTheme(preference as ThemeMode);
        const mode: "light" | "dark" | "system" = isSystem ? "system" : split!.mode;
        const accent: ThemeAccent | null = isSystem ? (preference.slice("system:".length) as ThemeAccent) : split!.accent;
        const activePreset = !isSystem && accent === null ? (preference as ThemeMode) : null;
        const apply = (p: ThemePreference) => { setPreference(p); hintTema.show(); };
        const applyModeAccent = (m: "light" | "dark" | "system", a: ThemeAccent | null) => {
          const acc = a ?? "default";
          apply(m === "system" ? `system:${acc}` : themeFor(m, acc));
        };
        return (
          <>
            <Card>
              <CardHeader title="Vzhled" description="Změna se použije hned na celou aplikaci a přenese se i na ostatní zařízení." right={hintTema.node} />
              <SettingRows>
                <SettingRow
                  label="Režim"
                  description={mode === "system" ? "Světlý nebo tmavý podle nastavení systému." : undefined}
                  control={
                    <Segmented<"light" | "dark" | "system">
                      size="sm"
                      ariaLabel="Režim vzhledu"
                      value={mode}
                      onChange={(m) => applyModeAccent(m, accent)}
                      options={[
                        { value: "light", label: "Světlý" },
                        { value: "dark", label: "Tmavý" },
                        { value: "system", label: "Podle systému" },
                      ]}
                    />
                  }
                />
                <SettingRow
                  label="Akcent"
                  description={activePreset ? "Vybraná předvolba má vlastní barvy – zvolením akcentu se přepnete zpět." : undefined}
                  control={
                    <div role="radiogroup" aria-label="Akcentová barva" style={{ display: "flex", gap: "var(--space-2)", flexWrap: "wrap" }}>
                      {ACCENT_SWATCHES.map((sw) => {
                        const selected = !activePreset && accent === sw.id;
                        return (
                          <button
                            key={sw.id}
                            type="button"
                            role="radio"
                            aria-checked={selected}
                            title={sw.label}
                            aria-label={sw.label}
                            onClick={() => applyModeAccent(mode, sw.id)}
                            style={{
                              width: 30, height: 30, borderRadius: "50%", border: "none", cursor: "pointer", padding: 0,
                              background: sw.color, display: "grid", placeItems: "center", color: "white",
                              boxShadow: selected ? "0 0 0 2px var(--panel), 0 0 0 4px var(--accent)" : "var(--shadow-soft)",
                              transition: "box-shadow 0.15s ease, transform 0.12s ease",
                              transform: selected ? "scale(1.06)" : "none",
                            }}
                          >
                            {selected ? <CheckIcon size={14} /> : null}
                          </button>
                        );
                      })}
                    </div>
                  }
                />
              </SettingRows>

              <details style={{ marginTop: "var(--space-3)" }}>
                <summary style={{ cursor: "pointer", fontWeight: 700, fontSize: "var(--text-base)", color: "var(--text)", padding: "var(--space-2) 0" }}>
                  Předvolby
                  <span style={{ color: "var(--muted)", fontWeight: 500, marginLeft: "var(--space-2)", fontSize: "var(--text-sm)" }}>
                    {activePreset ? THEME_PRESETS.find((t) => t.id === activePreset)?.title : "pojmenované světlé motivy"}
                  </span>
                </summary>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(140px, 1fr))", gap: "var(--space-2)", paddingTop: "var(--space-2)" }}>
                  {THEME_PRESETS.map((t) => {
                    const selected = activePreset === t.id;
                    return (
                      <button
                        key={t.id}
                        type="button"
                        aria-pressed={selected}
                        onClick={() => apply(t.id)}
                        style={{
                          padding: 0, overflow: "hidden", textAlign: "left", cursor: "pointer",
                          border: "1px solid var(--border)", borderRadius: "var(--radius-sm)", background: "var(--panel)",
                          boxShadow: selected ? "0 0 0 2px var(--accent)" : "none",
                        }}
                      >
                        <div style={{ height: 52, background: t.bg, display: "flex", alignItems: "center", justifyContent: "center" }}>
                          <div style={{ width: "70%", height: "56%", background: t.panel, borderRadius: 6, border: `1px solid ${t.accent}40`, display: "flex", flexDirection: "column", gap: 4, padding: 6, justifyContent: "center" }}>
                            <div style={{ width: "60%", height: 5, background: t.accent, borderRadius: 3 }} />
                            <div style={{ width: "40%", height: 4, background: `${t.text}30`, borderRadius: 2 }} />
                          </div>
                        </div>
                        <div style={{ padding: "var(--space-2) var(--space-3)" }}>
                          <div style={{ fontWeight: 800, fontSize: "var(--text-sm)", color: "var(--text)", display: "flex", alignItems: "center", gap: "var(--space-1)" }}>
                            {t.title}
                            {selected ? <span style={{ color: "var(--accent)", display: "flex" }}><CheckIcon size={12} /></span> : null}
                          </div>
                          <div style={{ fontSize: "var(--text-xs)", color: "var(--muted)" }}>{t.desc}</div>
                        </div>
                      </button>
                    );
                  })}
                </div>
              </details>
            </Card>

            <Card>
              <CardHeader title="Barvy loga Jobi" description="Ikona aplikace v Docku, Finderu atd." right={hintLogo.node} />
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(120px, 1fr))", gap: "var(--space-2)" }}>
                <LogoPresetButton
                  isActive={logoPreset === "auto"}
                  label="Podle motivu"
                  logoUrl={assetUrl(`logos/${theme}.png`)}
                  fallbackColors={getLogoColors(theme, "auto")}
                  onClick={() => { setLogoPreset("auto"); hintLogo.show(); }}
                />
                {LOGO_PRESETS.map((p) => (
                  <LogoPresetButton
                    key={p.id}
                    isActive={logoPreset === p.id}
                    label={p.label}
                    logoUrl={assetUrl(`logos/${p.id}.png`)}
                    fallbackColors={{ background: p.background, jInner: p.jInner, foreground: p.foreground }}
                    onClick={() => { setLogoPreset(p.id); hintLogo.show(); }}
                  />
                ))}
              </div>
            </Card>
          </>
        );
      })()}

      {/* ZAKÁZKY - STATUSY */}
      {section.subsection === "orders_statuses" && (
        <>
          <Card>
            <div style={{ fontWeight: 900, fontSize: "var(--text-base)", marginBottom: "var(--space-2)", color: "var(--text)" }}>Přidat / upravit status</div>

            <div style={{ display: "grid", gap: 10 }}>
              <div>
                <FieldLabel>Název (zobrazovaný text)</FieldLabel>
                <TextInput
                  placeholder="Přijato, V opravě, Hotovo"
                  value={draft.label}
                  onChange={(e: any) => {
                    const newLabel = e.target.value;
                    // Generate key automatically only for new statuses (when key is empty)
                    // For existing statuses, keep the original key
                    if (!draft.key) {
                      // Only generate new key if we're creating a new status
                      const existingKeys = new Set(statuses.map((s) => s.key));
                      const generatedKey = generateKeyFromLabel(newLabel, existingKeys);
                      setDraft((p) => ({ 
                        ...p, 
                        label: newLabel, 
                        key: generatedKey
                      }));
                    } else {
                      // Keep existing key when editing
                      setDraft((p) => ({ 
                        ...p, 
                        label: newLabel
                      }));
                    }
                  }}
                />
              </div>

              <div>
                <FieldLabel>Barva statusu</FieldLabel>
                <div style={{ display: "grid", gap: 12 }}>
                  {/* Paleta předvybraných barev */}
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(40px, 1fr))", gap: 8 }}>
                    {STATUS_COLOR_PALETTE.map((color, idx) => {
                      const isSelected = draft.bg === color.bg;
                      return (
                        <button
                          key={idx}
                          type="button"
                          onClick={() => {
                            setDraft((p) => ({ ...p, bg: color.bg, fg: color.fg }));
                            setShowCustomColor(false);
                          }}
                          style={{
                            width: "100%",
                            aspectRatio: "1",
                            borderRadius: 12,
                            border: isSelected ? "3px solid var(--accent)" : "2px solid var(--border)",
                            background: color.bg,
                            cursor: "pointer",
                            transition: "var(--transition-smooth)",
                            transform: isSelected ? "scale(1.1)" : "scale(1)",
                            boxShadow: isSelected ? `0 4px 12px var(--accent-glow)` : "var(--shadow-soft)",
                            position: "relative",
                            overflow: "hidden",
                          }}
                          title={color.name}
                          onMouseEnter={(e) => {
                            if (!isSelected) {
                              e.currentTarget.style.transform = "scale(1.05)";
                              e.currentTarget.style.boxShadow = "var(--shadow)";
                            }
                          }}
                          onMouseLeave={(e) => {
                            if (!isSelected) {
                              e.currentTarget.style.transform = "scale(1)";
                              e.currentTarget.style.boxShadow = "var(--shadow-soft)";
                            }
                          }}
                        >
                          {isSelected && (
                            <div
                              style={{
                                position: "absolute",
                                top: "50%",
                                left: "50%",
                                transform: "translate(-50%, -50%)",
                                width: 20,
                                height: 20,
                                borderRadius: "50%",
                                background: "var(--accent)",
                                display: "grid",
                                placeItems: "center",
                                color: "white",
                                fontWeight: 900,
                                fontSize: "var(--text-sm)",
                                boxShadow: `0 2px 8px var(--accent-glow)`,
                              }}
                            >
                              <CheckIcon size={12} />
                            </div>
                          )}
                        </button>
                      );
                    })}
                  </div>
                  
                  {/* Tlačítko pro vlastní barvu */}
                  <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                    <button
                      type="button"
                      onClick={() => setShowCustomColor(!showCustomColor)}
                      style={{
                        padding: "8px 12px",
                        borderRadius: 12,
                        border: "1px solid var(--border)",
                        background: showCustomColor ? "var(--accent-soft)" : "var(--panel)",
                        backdropFilter: "var(--blur)",
                        WebkitBackdropFilter: "var(--blur)",
                        color: showCustomColor ? "var(--accent)" : "var(--text)",
                        fontWeight: 700,
                        fontSize: "var(--text-sm)",
                        cursor: "pointer",
                        transition: "var(--transition-smooth)",
                        boxShadow: "var(--shadow-soft)",
                      }}
                    >
                      <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>{showCustomColor ? <XIcon size={12} /> : <span aria-hidden="true">+</span>} Vlastní barva</span>
                    </button>
                    {showCustomColor && (
                      <div style={{ display: "flex", gap: 8, flex: 1 }}>
                        <div style={{ flex: 1 }}>
                          <FieldLabel>Pozadí (hex)</FieldLabel>
                          <TextInput
                            placeholder="#DCFCE7"
                            value={draft.bg ?? ""}
                            onChange={(e: any) => {
                              const bg = e.target.value;
                              setDraft((p) => ({ ...p, bg, fg: getContrastText(bg) }));
                            }}
                          />
                        </div>
                        <div style={{ flex: 1 }}>
                          <FieldLabel>Text (hex)</FieldLabel>
                          <TextInput
                            placeholder="#14532D"
                            value={draft.fg ?? ""}
                            onChange={(e: any) => setDraft((p) => ({ ...p, fg: e.target.value }))}
                          />
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              </div>

              <label style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 6 }}>
                <input
                  type="checkbox"
                  checked={!!draft.isFinal}
                  onChange={(e) => setDraft((p) => ({ ...p, isFinal: e.target.checked }))}
                />
                <span style={{ color: "var(--text)", fontWeight: 700, fontSize: "var(--text-base)" }}>Je finální stav</span>
              </label>

              <div style={{ display: "flex", gap: 10, alignItems: "center", marginTop: 8 }}>
                <div
                  style={{
                    padding: "8px 14px",
                    borderRadius: 999,
                    border: `1px solid ${draft.bg ? `${draft.bg}40` : "var(--border)"}`,
                    background: draft.bg || "var(--panel-2)",
                    color: draft.fg || "var(--text)",
                    fontWeight: 900,
                    fontSize: "var(--text-sm)",
                    boxShadow: draft.bg ? `0 2px 8px ${draft.bg}30` : "var(--shadow-soft)",
                    transition: "var(--transition-smooth)",
                  }}
                >
                  {draft.label || "Náhled"}
                </div>

                  <Button
                    variant="primary"
                    disabled={!canSave}
                    onClick={async () => {
                    if (!canSave) return;
                    await handleStatusUpsert({
                      key: keyTrim,
                      label: labelTrim,
                      bg: draft.bg?.trim() || undefined,
                      fg: draft.fg?.trim() || undefined,
                      isFinal: !!draft.isFinal,
                    });
                    setDraft({ key: "", label: "", bg: STATUS_COLOR_PALETTE[0].bg, fg: STATUS_COLOR_PALETTE[0].fg, isFinal: false });
                    setShowCustomColor(false);
                  }}
                  >
                    {keyExists ? "Aktualizovat" : "Přidat"}
                  </Button>
              </div>
            </div>
          </Card>

          <Card>
            <div style={{ fontWeight: 900, fontSize: "var(--text-base)", marginBottom: "var(--space-2)", color: "var(--text)" }}>Existující statusy</div>
            <div style={{ fontSize: "var(--text-sm)", color: "var(--muted)", marginBottom: 12 }}>
              Fallback status (nelze smazat): <b>{fallbackKey}</b>
            </div>

            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {statuses.map((s) => (
                <div
                  key={s.key}
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                    padding: 12,
                    borderRadius: 10,
                    border,
                    background: "var(--panel)",
                  }}
                >
                  <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
                    <div
                      style={{
                        padding: "6px 12px",
                        borderRadius: 999,
                        border,
                        background: s.bg || "var(--panel)",
                        color: s.fg || "var(--text)",
                        fontWeight: 900,
                        fontSize: "var(--text-sm)",
                      }}
                    >
                      {s.label}
                    </div>
                    {s.isFinal && <div style={{ fontSize: "var(--text-xs)", fontWeight: 900, color: "var(--muted)" }}>FINAL</div>}
                    {s.key === fallbackKey && (
                      <div style={{ fontSize: "var(--text-xs)", fontWeight: 900, color: "var(--accent)" }}>FALLBACK</div>
                    )}
                  </div>

                  <div style={{ display: "flex", gap: 6 }}>
                    <Button size="sm" onClick={() => setDraft({ ...s })}>
                      Upravit
                    </Button>
                    <Button
                      size="sm"
                      variant="danger"
                      onClick={() => deleteStatus(s.key)}
                      disabled={s.key === fallbackKey}
                      title={s.key === fallbackKey ? "Fallback status nelze smazat" : "Smazat status"}
                    >
                      Smazat
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          </Card>
        </>
      )}

      {/* VZHLED A CHOVÁNÍ - UI */}
      {section.subsection === "appearance_ui" && (
        <>
          <Card>
            <CardHeader
              title="Výkon"
              description="Rozostření za průhlednými panely je náročné na grafiku. Pokud aplikace sekne při posouvání, omezením efektů se chod znatelně zrychlí. Na Windows je to zapnuté od začátku."
              right={hintEfekty.node}
            />
            <SettingRows>
              <SettingRow
                clickable
                label="Omezit efekty (rychlejší chod)"
                control={
                  <input
                    type="checkbox"
                    checked={uiCfg.app.reducedEffects === true}
                    onChange={(e) => updateUi({ ...uiCfg, app: { ...uiCfg.app, reducedEffects: e.target.checked } }, hintEfekty)}
                  />
                }
              />
            </SettingRows>
          </Card>

          <Card>
            <CardHeader title="Velikost rozhraní" description="Doporučeno 100–125 %." right={hintMeritko.node} />
            <SettingRows>
              <SettingRow
                label={<>Měřítko <span style={{ color: "var(--accent)", marginLeft: "var(--space-2)" }}>{Math.round(uiCfg.app.uiScale * 100)}%</span></>}
                control={
                  <Segmented<number>
                    ariaLabel="Měřítko rozhraní"
                    size="sm"
                    value={uiCfg.app.uiScale}
                    onChange={(v) => updateUi({ ...uiCfg, app: { ...uiCfg.app, uiScale: v } }, hintMeritko)}
                    options={[0.85, 0.9, 1, 1.1, 1.25, 1.35].map((v) => ({ value: v, label: `${Math.round(v * 100)}%` }))}
                  />
                }
              />
            </SettingRows>
            <input
              type="range"
              aria-label="Měřítko rozhraní (plynule)"
              min={0.85}
              max={1.35}
              step={0.05}
              value={uiCfg.app.uiScale}
              onChange={(e) => updateUi({ ...uiCfg, app: { ...uiCfg.app, uiScale: Number(e.target.value) } }, hintMeritko)}
              style={{ width: "100%", marginTop: "var(--space-2)", accentColor: "var(--accent)" }}
            />
          </Card>

          <Card>
            <CardHeader title="Chování" right={<>{hintFab.node}{hintZvuky.node}</>} />
            <SettingRows>
              <SettingRow
                clickable
                label="Plovoucí tlačítko „+ Nová zakázka“"
                description="Vpravo dole na stránkách se seznamy (ne v Nastavení a ve Fakturách). Po vypnutí zůstane jen tlačítko v záhlaví stránky Zakázky."
                control={
                  <input
                    type="checkbox"
                    checked={uiCfg.app.fabNewOrderEnabled}
                    onChange={(e) => updateUi({ ...uiCfg, app: { ...uiCfg.app, fabNewOrderEnabled: e.target.checked } }, hintFab)}
                  />
                }
              />
              <SettingRow
                clickable
                label="Přehrávat zvuky při akcích"
                description="Krátké zvuky při založení zakázky, uložení změn a smazání."
                control={
                  <input
                    type="checkbox"
                    checked={soundsEnabled}
                    onChange={(e) => {
                      const v = e.target.checked;
                      setSoundsEnabled(v);
                      setSoundsEnabledState(v);
                      hintZvuky.show();
                    }}
                  />
                }
              />
              <SettingRow
                label="Umístění navigace"
                control={
                  <Segmented<SidebarPosition>
                    size="sm"
                    ariaLabel="Umístění navigačního panelu"
                    value={uiCfg.sidebar?.position ?? "left"}
                    onChange={(v) => updateUi({ ...uiCfg, sidebar: { ...uiCfg.sidebar, position: v } }, hintSidebar)}
                    options={[
                      { value: "left", label: "Vlevo" },
                      { value: "right", label: "Vpravo" },
                      { value: "bottom", label: "Dole" },
                    ]}
                  />
                }
              />
            </SettingRows>
          </Card>

          <Card>
            <CardHeader title="Zobrazení zakázek" description="Způsob zobrazení seznamu na stránce Zakázky." right={hintZobrazeni.node} />
            {(() => {
              const bar = (w: string | number, h = 5, c = "var(--muted)", o = 0.55) => (
                <div style={{ width: w, height: h, borderRadius: 2, background: c, opacity: o }} />
              );
              const modes: { value: DisplayMode; label: string; description: string; thumb: ReactNode }[] = [
                { value: "list", label: "Seznam", description: "Klasické řádky pod sebou.", thumb: (
                  <div style={{ display: "flex", flexDirection: "column", gap: 4, width: "100%" }}>{bar("100%", 9)}{bar("100%", 9)}{bar("100%", 9)}</div>
                ) },
                { value: "grid", label: "Mřížka", description: "Karty vedle sebe.", thumb: (
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 4, width: "100%" }}>{bar("100%", 14)}{bar("100%", 14)}{bar("100%", 14)}{bar("100%", 14)}</div>
                ) },
                { value: "compact", label: "Kompaktní", description: "Menší řádky s méně informacemi.", thumb: (
                  <div style={{ display: "flex", flexDirection: "column", gap: 3, width: "100%" }}>{bar("100%", 5)}{bar("100%", 5)}{bar("100%", 5)}{bar("100%", 5)}{bar("100%", 5)}</div>
                ) },
                { value: "compact-extra", label: "Kompaktní extra", description: "Jeden řádek na zakázku, nejvíc zakázek na obrazovku.", thumb: (
                  <div style={{ display: "flex", flexDirection: "column", gap: 2, width: "100%" }}>{bar("100%", 3)}{bar("100%", 3)}{bar("100%", 3)}{bar("100%", 3)}{bar("100%", 3)}{bar("100%", 3)}{bar("100%", 3)}</div>
                ) },
                { value: "stripe", label: "Pruhy", description: "Barevný pruh se statusem u každé zakázky.", thumb: (
                  <div style={{ display: "flex", flexDirection: "column", gap: 4, width: "100%" }}>
                    {["var(--accent)", "var(--warning)", "var(--success)"].map((c) => (
                      <div key={c} style={{ display: "flex", gap: 3, alignItems: "stretch" }}>
                        <div style={{ width: 3, borderRadius: 2, background: c }} />
                        {bar("100%", 8)}
                      </div>
                    ))}
                  </div>
                ) },
                { value: "status-grouped", label: "Podle statusu", description: "Zakázky seskupené a seřazené podle statusu.", thumb: (
                  <div style={{ display: "flex", flexDirection: "column", gap: 3, width: "100%" }}>
                    {bar("45%", 4, "var(--accent)", 1)}{bar("100%", 6)}{bar("100%", 6)}
                    {bar("40%", 4, "var(--warning)", 1)}{bar("100%", 6)}
                  </div>
                ) },
                { value: "timeline", label: "Časová osa", description: "Zakázky seskupené podle data na ose.", thumb: (
                  <div style={{ display: "flex", gap: 6, width: "100%" }}>
                    <div style={{ width: 2, background: "var(--border)", borderRadius: 1, position: "relative" }}>
                      <div style={{ position: "absolute", left: -2, top: 2, width: 6, height: 6, borderRadius: 3, background: "var(--accent)" }} />
                      <div style={{ position: "absolute", left: -2, top: 22, width: 6, height: 6, borderRadius: 3, background: "var(--muted)" }} />
                    </div>
                    <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 3 }}>{bar("35%", 4, "var(--accent)", 1)}{bar("100%", 6)}{bar("35%", 4)}{bar("100%", 6)}</div>
                  </div>
                ) },
              ];
              const current = uiCfg.orders?.displayMode ?? "list";
              const selectedMode = modes.find((m) => m.value === current);
              return (
                <>
                  <div role="radiogroup" aria-label="Zobrazení zakázek" style={{ display: "flex", gap: "var(--space-2)", overflowX: "auto", paddingBottom: "var(--space-1)" }}>
                    {modes.map((mode) => {
                      const isSelected = current === mode.value;
                      return (
                        <button
                          key={mode.value}
                          type="button"
                          role="radio"
                          aria-checked={isSelected}
                          onClick={() => updateUi({ ...uiCfg, orders: { ...uiCfg.orders, displayMode: mode.value } }, hintZobrazeni)}
                          style={{
                            flex: "0 0 auto", width: 108, padding: "var(--space-2)", cursor: "pointer", textAlign: "center",
                            border: isSelected ? "1px solid var(--accent)" : border, borderRadius: "var(--radius-xs)",
                            background: isSelected ? "var(--accent-soft)" : "var(--panel)", color: isSelected ? "var(--accent)" : "var(--text)",
                            boxShadow: isSelected ? "inset 0 0 0 1px var(--accent)" : "none",
                            transition: "background 0.15s ease, border-color 0.15s ease",
                          }}
                        >
                          <div style={{ height: 48, display: "flex", alignItems: "center", padding: "var(--space-1) var(--space-2)", borderRadius: 6, background: "var(--panel-2)", border: "1px solid var(--border)", marginBottom: "var(--space-2)", color: "var(--text)" }}>
                            {mode.thumb}
                          </div>
                          <div style={{ fontSize: "var(--text-xs)", fontWeight: 700, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{mode.label}</div>
                        </button>
                      );
                    })}
                  </div>
                  {selectedMode && (
                    <div style={{ fontSize: "var(--text-sm)", color: "var(--muted)", marginTop: "var(--space-2)" }}>
                      <strong style={{ color: "var(--text)" }}>{selectedMode.label}</strong> – {selectedMode.description}
                    </div>
                  )}
                </>
              );
            })()}
          </Card>

          {/* Jak výrazně se ve výpisu propíše barva stavu */}
          <Card>
            <CardHeader
              title="Zvýraznění stavu"
              description="Jak silně se barva stavu propíše do řádku zakázky. Samotné barvy nastavujete u jednotlivých stavů. Hotové zakázky jsou vždy ztlumené, ať vyskočí ty, které na někoho čekají."
              right={hintZvyrazneni.node}
            />
            {(() => {
              const volby: [ZvyrazneniStavu, string, string][] = [
                ["jemne", "Jemné", "Řádek je lehce podbarvený barvou stavu. Doporučeno."],
                ["vyrazne", "Výrazné", "Řádek se vyplní barvou stavu. Barva písma se dopočítá, ať zůstane čitelné."],
                ["zadne", "Žádné", "Jen tenký proužek vlevo a odznak vpravo."],
              ];
              const aktualni = uiCfg.orders?.zvyrazneniStavu ?? VYCHOZI_ZVYRAZNENI;
              return (
                <SettingRows>
                  <SettingRow
                    label="Síla zvýraznění"
                    description={volby.find(([v]) => v === aktualni)?.[2]}
                    control={
                      <Segmented<ZvyrazneniStavu>
                        size="sm"
                        ariaLabel="Zvýraznění stavu"
                        value={aktualni}
                        onChange={(v) => updateUi({ ...uiCfg, orders: { ...uiCfg.orders, zvyrazneniStavu: v } }, hintZvyrazneni)}
                        options={volby.map(([value, label]) => ({ value, label }))}
                      />
                    }
                  />
                </SettingRows>
              );
            })()}
          </Card>

          {/* Status-grouped order configuration */}
          {uiCfg.orders?.displayMode === "status-grouped" && (
            <Card>
              <CardHeader title="Pořadí statusů v zobrazení" description="Přesuňte statusy do požadovaného pořadí. Skryté statusy se v seznamu nezobrazí." right={hintPoradi.node} />
              {(() => {
                const order: string[] = uiCfg.orders?.statusGroupedOrder ?? statuses.map((s) => s.key);
                const enabledSet = new Set(order);
                const allKeys = statuses.map((s) => s.key);
                const disabledKeys = allKeys.filter((k) => !enabledSet.has(k));
                const setOrder = (next: string[] | undefined) =>
                  updateUi({ ...uiCfg, orders: { ...uiCfg.orders, statusGroupedOrder: next } }, hintPoradi);

                const moveUp = (key: string) => {
                  const idx = order.indexOf(key);
                  if (idx <= 0) return;
                  const next = [...order];
                  [next[idx - 1], next[idx]] = [next[idx], next[idx - 1]];
                  setOrder(next);
                };
                const moveDown = (key: string) => {
                  const idx = order.indexOf(key);
                  if (idx < 0 || idx >= order.length - 1) return;
                  const next = [...order];
                  [next[idx], next[idx + 1]] = [next[idx + 1], next[idx]];
                  setOrder(next);
                };
                const toggleStatus = (key: string) => setOrder(enabledSet.has(key) ? order.filter((k) => k !== key) : [...order, key]);

                return (
                  <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-1)" }}>
                    {order.map((key, idx) => {
                      const s = statuses.find((st) => st.key === key);
                      if (!s) return null;
                      const color = s.bg || "var(--muted)";
                      return (
                        <div key={key} style={{
                          display: "flex", alignItems: "center", gap: "var(--space-2)",
                          padding: "4px var(--space-2)", borderRadius: "var(--radius-xs)", minHeight: 36,
                          border: `1px solid ${color}25`, background: `${color}06`,
                        }}>
                          <div style={{ width: 10, height: 10, borderRadius: 5, background: color, flexShrink: 0 }} />
                          <span style={{ fontWeight: 700, fontSize: "var(--text-base)", color: "var(--text)", flex: 1 }}>{s.label}</span>
                          <Button variant="ghost" size="sm" iconOnly aria-label="Posunout nahoru" title="Posunout nahoru" icon={<ArrowIcon dir="up" />} onClick={() => moveUp(key)} disabled={idx === 0} />
                          <Button variant="ghost" size="sm" iconOnly aria-label="Posunout dolů" title="Posunout dolů" icon={<ArrowIcon dir="down" />} onClick={() => moveDown(key)} disabled={idx === order.length - 1} />
                          <Button variant="ghost" size="sm" iconOnly aria-label="Skrýt status" title="Skrýt status" icon={<XIcon size={13} />} onClick={() => toggleStatus(key)} style={{ color: "var(--danger-text)" }} />
                        </div>
                      );
                    })}
                    {disabledKeys.length > 0 && (
                      <div style={{ marginTop: "var(--space-2)" }}>
                        <div style={{ fontSize: "var(--text-xs)", color: "var(--muted)", fontWeight: 600, marginBottom: "var(--space-1)" }}>Skryté statusy:</div>
                        <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                          {disabledKeys.map((key) => {
                            const s = statuses.find((st) => st.key === key);
                            if (!s) return null;
                            return (
                              <button key={key} type="button" onClick={() => toggleStatus(key)} style={{
                                border: `1px dashed ${s.bg || "var(--muted)"}40`, background: "transparent",
                                borderRadius: 6, padding: "4px 10px", cursor: "pointer",
                                fontSize: "var(--text-sm)", fontWeight: 600, color: "var(--muted)",
                                display: "flex", alignItems: "center", gap: 4,
                              }}>
                                <div style={{ width: 6, height: 6, borderRadius: 3, background: s.bg || "var(--muted)", opacity: 0.5 }} />
                                {s.label}
                                <span style={{ fontSize: "var(--text-xs)", color: "var(--accent)" }}>+</span>
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    )}
                    <Button variant="ghost" size="sm" onClick={() => setOrder(undefined)} style={{ alignSelf: "flex-start", marginTop: "var(--space-2)" }}>
                      Obnovit výchozí pořadí
                    </Button>
                  </div>
                );
              })()}
            </Card>
          )}
        </>
      )}

      {/* VZHLED - KLAVESOVÉ ZKRATKY */}
      {section.subsection === "appearance_shortcuts" && (
        <ShortcutsSettingsSection />
      )}

      {/* APLIKACE - MODULY */}
      {section.subsection === "appearance_modules" && (
        <Card>
          <CardHeader
            title="Moduly"
            description="Části aplikace, které jdou vypnout, pokud je nepoužíváte."
            right={hintModuly.node}
          />
          <SettingRows>
            <SettingRow
              clickable
              label="Faktury"
              description="Stránka Faktury a tlačítka „Vystavit fakturu“ / „Přejít na fakturu“ u zakázek. Vypněte, pokud používáte vlastní fakturační systém."
              control={
                <input
                  type="checkbox"
                  checked={uiCfg.invoicingEnabled !== false}
                  onChange={(e) => updateUi({ ...uiCfg, invoicingEnabled: e.target.checked }, hintModuly)}
                />
              }
            />
          </SettingRows>
        </Card>
      )}

      {section.subsection === "orders_device_options" && (
        <DeviceOptionsSettingsSection activeServiceId={activeServiceId} />
      )}
      {section.subsection === "orders_handoff_options" && (
        <HandoffOptionsSettingsSection activeServiceId={activeServiceId} />
      )}

      {section.subsection === "orders_filters" && (
        <>
          <Card>
            <CardHeader title="Stránkování" description="Počet zakázek na stránce v seznamu. „Vše“ zobrazí všechny zakázky bez stránkování." right={hintStrankovani.node} />
            <SettingRows>
              <SettingRow
                label="Zakázek na stránce"
                control={
                  <Segmented
                    size="sm"
                    ariaLabel="Počet zakázek na stránce"
                    value={uiCfg.orders.pageSize}
                    onChange={(value) => updateUi({ ...uiCfg, orders: { ...uiCfg.orders, pageSize: value } }, hintStrankovani)}
                    options={ORDERS_PAGE_SIZE_CHOICES.map(({ value, label }) => ({ value, label }))}
                  />
                }
              />
            </SettingRows>
          </Card>
          <Card>
            <CardHeader title="Rychlé filtry zakázek" description="Statusy, které se zobrazí jako rychlé filtry na stránce Zakázky." right={hintFiltry.node} />
            <SettingRows>
              {statuses.map((s) => {
                const checked = selectedQuick.includes(s.key);
                return (
                  <SettingRow
                    key={s.key}
                    clickable
                    label={
                      <span style={{ display: "inline-flex", gap: "var(--space-2)", alignItems: "center" }}>
                        <span
                          style={{
                            padding: "3px 10px", borderRadius: "var(--radius-pill)", border,
                            background: s.bg || "var(--panel-2)", color: s.fg || "var(--text)",
                            fontWeight: 800, fontSize: "var(--text-sm)",
                          }}
                        >
                          {s.label}
                        </span>
                        {s.isFinal && <span style={{ fontSize: "var(--text-xs)", fontWeight: 800, color: "var(--muted)" }}>FINÁLNÍ</span>}
                      </span>
                    }
                    control={<input type="checkbox" checked={checked} onChange={() => { toggleQuick(s.key); hintFiltry.show(); }} />}
                  />
                );
              })}
            </SettingRows>
          </Card>
        </>
      )}

      {/* ZAKÁZKY - REKLAMACE */}
      {section.subsection === "orders_reklamace" && (
        <Card>
          <CardHeader title="Reklamace v seznamu" description="Reklamace budou v seznamu výrazně odlišené od běžných zakázek." right={hintReklamace.node} />
          <SettingRows>
            <SettingRow
              clickable
              label="Zobrazit reklamace v záložkách Vše a Aktivní"
              control={
                <input
                  type="checkbox"
                  checked={ordersShowClaimsInList}
                  onChange={(e) => { void saveOrdersShowClaimsInList(e.target.checked).then(() => hintReklamace.show()); }}
                />
              }
            />
          </SettingRows>
        </Card>
      )}

      {/* ZAKÁZKY - POVINNÁ POLE */}
      {section.subsection === "orders_required_fields" && (
        <Card>
          <CardHeader title="Povinná pole u zakázky" description="U nové zakázky a při úpravě: která pole musí uživatel vyplnit." right={hintPovinne.node} />
          <SettingRows>
            <SettingRow
              clickable
              label="Telefon zákazníka povinný"
              description="Po vypnutí lze zakázku uložit i bez telefonu (pole zůstane volitelné)."
              control={
                <input
                  type="checkbox"
                  checked={uiCfg.orders.customerPhoneRequired}
                  onChange={(e) => updateUi({ ...uiCfg, orders: { ...uiCfg.orders, customerPhoneRequired: e.target.checked } }, hintPovinne)}
                />
              }
            />
          </SettingRows>
        </Card>
      )}

      {/* DOKUMENTY A TISK - JOBIDOCS + AUTOMATICKÝ TISK */}
      {section.subsection === "orders_tisk_dokumentu" && (
        <>
          <Card>
            <CardHeader
              title="Šablony dokumentů"
              description={
                <>
                  Vzhled dokumentů (rozvržení, sekce, logo, razítko, design a vlastní texty) se upravuje v aplikaci <strong>JobiDocs</strong>.
                  {isDesktop()
                    ? " Zde v Nastavení se nastavuje jen automatický tisk."
                    : " Ve webové verzi se tiskne přímo z prohlížeče a nastavený vzhled se použije; upravit ho jde v JobiDocs na počítači."}
                </>
              }
            />
            {/* Spuštění JobiDocs má smysl jen na desktopu – ve webu tam není co spouštět. */}
            {isDesktop() && (
              <div style={{ display: "flex", alignItems: "center", gap: "var(--space-3)", flexWrap: "wrap" }}>
                <Button
                  variant="primary"
                  icon={<img src={assetUrl("logos/jdlogo.png")} alt="" style={{ width: 18, height: 18, objectFit: "contain" }} />}
                  onClick={async () => {
                    if (jobiDocsConnected) {
                      try {
                        const { openUrl } = await import("@tauri-apps/plugin-opener");
                        await openUrl("http://127.0.0.1:3847");
                      } catch { /* fallback below */ }
                    } else {
                      const launched = await launchJobiDocsApp();
                      if (!launched) await openJobiDocsDownload();
                    }
                  }}
                >
                  {jobiDocsConnected ? "Otevřít JobiDocs" : "Spustit JobiDocs"}
                </Button>
                <span style={{
                  display: "inline-flex", alignItems: "center", gap: 6, fontSize: "var(--text-sm)", fontWeight: 600,
                  color: jobiDocsConnected === true ? "var(--success-text)" : jobiDocsConnected === false ? "var(--muted)" : "var(--warning-text)",
                }}>
                  <span style={{
                    width: 8, height: 8, borderRadius: "50%", display: "inline-block",
                    background: jobiDocsConnected === true ? "var(--success)" : jobiDocsConnected === false ? "var(--muted)" : "var(--warning)",
                  }} />
                  {jobiDocsConnected === true ? "Připojeno" : jobiDocsConnected === false ? "Nepřipojeno" : "Kontroluji…"}
                </span>
              </div>
            )}
          </Card>
          <Card>
            <CardHeader
              title="Automatický tisk"
              description="Kdy se má automaticky otevřít dialog tisku – při vytvoření zakázky/reklamace nebo při přepnutí do stavu."
              right={hintTisk.node}
            />
            {autoPrintFormLoading ? (
              <div style={{ padding: "var(--space-4)", textAlign: "center", color: "var(--muted)", fontSize: "var(--text-base)" }}>Načítání…</div>
            ) : (() => {
              type AutoPrintForm = typeof autoPrintForm;
              const ulozAutoPrint = async (patch: Partial<AutoPrintForm>) => {
                const next = { ...autoPrintForm, ...patch };
                setAutoPrintForm(next);
                const ok = await saveDocumentsConfigAutoPrint(activeServiceId, next);
                if (ok) hintTisk.show();
              };
              const statusSelect = (value: string | null, onChange: (v: string | null) => void, label: string) => (
                <select aria-label={label} value={value ?? ""} onChange={(e) => onChange(e.target.value || null)}>
                  <option value="">— žádný —</option>
                  {statuses.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
                </select>
              );
              const skupina = (nazev: string) => (
                <div style={{ fontSize: "var(--text-sm)", fontWeight: 800, color: "var(--muted)", textTransform: "uppercase", letterSpacing: 0.4, marginTop: "var(--space-3)", marginBottom: "var(--space-1)" }}>{nazev}</div>
              );
              return (
                <div>
                  {skupina("Zakázkový list")}
                  <SettingRows>
                    <SettingRow clickable label="Tisknout při vytvoření zakázky" control={<input type="checkbox" checked={autoPrintForm.ticketListOnCreate} onChange={(e) => ulozAutoPrint({ ticketListOnCreate: e.target.checked })} />} />
                    <SettingRow label="Tisknout při přepnutí do stavu" control={statusSelect(autoPrintForm.ticketListOnStatusKey, (v) => ulozAutoPrint({ ticketListOnStatusKey: v }), "Zakázkový list – tisknout při přepnutí do stavu")} />
                  </SettingRows>
                  {skupina("Záruční list")}
                  <SettingRows>
                    <SettingRow clickable label="Tisknout při vytvoření zakázky" control={<input type="checkbox" checked={autoPrintForm.warrantyOnCreate} onChange={(e) => ulozAutoPrint({ warrantyOnCreate: e.target.checked })} />} />
                    <SettingRow label="Tisknout při přepnutí do stavu" control={statusSelect(autoPrintForm.warrantyOnStatusKey, (v) => ulozAutoPrint({ warrantyOnStatusKey: v }), "Záruční list – tisknout při přepnutí do stavu")} />
                  </SettingRows>
                  {skupina("Přijetí reklamace")}
                  <SettingRows>
                    <SettingRow clickable label="Tisknout při vytvoření reklamace" control={<input type="checkbox" checked={autoPrintForm.prijetiReklamaceOnCreate} onChange={(e) => ulozAutoPrint({ prijetiReklamaceOnCreate: e.target.checked })} />} />
                    <SettingRow label="Tisknout při přepnutí do stavu" control={statusSelect(autoPrintForm.prijetiReklamaceOnStatusKey, (v) => ulozAutoPrint({ prijetiReklamaceOnStatusKey: v }), "Přijetí reklamace – tisknout při přepnutí do stavu")} />
                  </SettingRows>
                  {skupina("Vydání reklamace")}
                  <SettingRows>
                    <SettingRow label="Tisknout při přepnutí do stavu" control={statusSelect(autoPrintForm.vydaniReklamaceOnStatusKey, (v) => ulozAutoPrint({ vydaniReklamaceOnStatusKey: v }), "Vydání reklamace – tisknout při přepnutí do stavu")} />
                  </SettingRows>
                </div>
              );
            })()}
          </Card>
        </>
      )}

      {/* ZAKÁZKY - SMAZANÉ */}
      {section.subsection === "orders_deleted" && (
        <DeletedTicketsSettings activeServiceId={activeServiceId} />
      )}

      {/* O APLIKACI */}
      {section.subsection === "about_app" && (
        <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-4)" }}>
          <Card>
            <div style={{ display: "flex", alignItems: "center", gap: 16, flexWrap: "wrap" }}>
              <div style={{ width: 64, height: 64, flexShrink: 0 }}>
                <AppLogo size={64} />
              </div>
              <div>
                <div style={{ fontWeight: 950, fontSize: "var(--text-lg)", marginBottom: 4, color: "var(--text)" }}>Jobi</div>
                <div style={{ fontSize: "var(--text-base)", color: "var(--muted)" }}>
                  Evidence zakázek a zákazníků pro servisy. Tisk a export dokumentů přes JobiDocs.
                </div>
              </div>
            </div>
          </Card>
          {onStartTour && (
            <Card>
              <div style={{ fontWeight: 900, fontSize: "var(--text-base)", marginBottom: "var(--space-2)", color: "var(--text)" }}>Průvodce aplikací</div>
              <div style={{ fontSize: "var(--text-base)", color: "var(--muted)", marginBottom: 16 }}>
                Spusťte průvodce – provede vás krok za krokem po celé aplikaci a u každé části ukáže, co a jak funguje.
              </div>
              <Button variant="primary" onClick={onStartTour}>Spustit průvodce</Button>
            </Card>
          )}
          <Card>
            <div style={{ fontWeight: 900, fontSize: "var(--text-base)", marginBottom: "var(--space-2)", color: "var(--text)" }}>Pro podporu</div>
            <div style={{ fontSize: "var(--text-base)", color: "var(--muted)", marginBottom: 12 }}>
              Tyto údaje můžete poskytnout při řešení problému (kliknutím zkopírujete).
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 8, fontFamily: "ui-monospace, monospace", fontSize: "var(--text-sm)" }}>
              <div
                title="Kliknutím zkopírovat"
                onClick={() => session?.user?.id && navigator.clipboard.writeText(session.user.id)}
                style={{
                  padding: "8px 12px",
                  borderRadius: 8,
                  background: "var(--panel-2)",
                  border: "1px solid var(--border)",
                  cursor: session?.user?.id ? "pointer" : "default",
                  userSelect: "text",
                  color: "var(--text)",
                }}
              >
                <span style={{ color: "var(--muted)", marginRight: 8 }}>userId:</span>
                {session?.user?.id ?? "—"}
              </div>
              <div
                title="Kliknutím zkopírovat"
                onClick={() => activeServiceId && navigator.clipboard.writeText(activeServiceId)}
                style={{
                  padding: "8px 12px",
                  borderRadius: 8,
                  background: "var(--panel-2)",
                  border: "1px solid var(--border)",
                  cursor: activeServiceId ? "pointer" : "default",
                  userSelect: "text",
                  color: "var(--text)",
                }}
              >
                <span style={{ color: "var(--muted)", marginRight: 8 }}>serviceId:</span>
                {activeServiceId ?? "—"}
              </div>
              <div
                title="Kliknutím zkopírovat"
                onClick={() => navigator.clipboard.writeText(appVersion)}
                style={{
                  padding: "8px 12px",
                  borderRadius: 8,
                  background: "var(--panel-2)",
                  border: "1px solid var(--border)",
                  cursor: "pointer",
                  userSelect: "text",
                  color: "var(--text)",
                }}
              >
                <span style={{ color: "var(--muted)", marginRight: 8 }}>verze:</span>
                {appVersion}
              </div>

              {/*
                ID běhu aplikace. Uživatel ho nadiktuje při hlášení problému
                a v chybových logech se podle něj najdou všechny chyby
                z téhož spuštění – včetně těch, které se staly předtím
                a mohly být příčinou.
              */}
              <div
                title="Kliknutím zkopírovat. Uveďte při hlášení problému."
                onClick={() => navigator.clipboard.writeText(getSessionId())}
                style={{
                  marginTop: "var(--space-2)",
                  fontFamily: "ui-monospace, monospace",
                  fontSize: "var(--text-xs)",
                  cursor: "pointer",
                  userSelect: "text",
                  color: "var(--muted)",
                }}
              >
                <span style={{ marginRight: 8 }}>ID relace:</span>
                {getSessionId()}
              </div>
            </div>
          </Card>
        </div>
      )}

      {/* AKTUALIZACE (samostatná subsekce) */}
      {section.subsection === "about_updates" && (
        <Card>
          <div style={{ fontWeight: 900, fontSize: "var(--text-base)", marginBottom: "var(--space-2)", color: "var(--text)" }}>Aktualizace</div>
          {typeof window !== "undefined" && !!(window as any).__TAURI_INTERNALS__ ? (
            <AppUpdateCard />
          ) : (
            <div style={{ fontSize: "var(--text-base)", color: "var(--muted)" }}>Aktualizace jsou dostupné pouze v desktopové aplikaci.</div>
          )}
        </Card>
      )}
      </div>
      </div>

      <UnsavedChangesDialog
        open={!!pendingSection}
        onBack={() => setPendingSection(null)}
        onDiscard={() => {
          pendingHandle?.discard();
          if (pendingSection) setSection(pendingSection);
          setPendingSection(null);
        }}
        onSave={async () => {
          await pendingHandle?.save();
          if (pendingSection) setSection(pendingSection);
          setPendingSection(null);
        }}
      />
    </div>
    </UnsavedGuardProvider>
  );
}

/**
 * Navigace Nastavení: hledání + skupiny podsekcí.
 *
 * Na širokém displeji levý sloupec (lepí se při rolování), na telefonu
 * rozbalovací <details> s názvem aktuální sekce, aby nezabírala celou
 * obrazovku. Při hledání se skupiny nahradí plochým seznamem shod.
 */
function SettingsNav({
  categories,
  section,
  onSelect,
  query,
  onQueryChange,
  isNarrow,
}: {
  categories: CategoryDef[];
  section: SettingsSection;
  onSelect: (next: SettingsSection) => void;
  query: string;
  onQueryChange: (q: string) => void;
  isNarrow: boolean;
}) {
  const [open, setOpen] = useState(false);
  const q = normalizeText(query.trim());
  const matches = q
    ? categories.flatMap((cat) =>
        cat.subsections
          .filter((sub) =>
            normalizeText(sub.label).includes(q)
            || normalizeText(cat.label).includes(q)
            || sub.keywords.some((k) => normalizeText(k).includes(q)))
          .map((sub) => ({ cat, sub })))
    : [];

  const select = (cat: CategoryDef, sub: SubsectionDef) => {
    onSelect({ category: cat.category, subsection: sub.key });
    onQueryChange("");
    setOpen(false);
  };

  const currentCat = categories.find((c) => c.subsections.some((s) => s.key === section.subsection));
  const currentSub = currentCat?.subsections.find((s) => s.key === section.subsection);

  const badge = (n: number) => (
    <span
      style={{
        minWidth: 18, height: 18, borderRadius: "var(--radius-pill)", background: "var(--danger)", color: "white",
        fontSize: "var(--text-xs)", fontWeight: 800, display: "inline-flex", alignItems: "center", justifyContent: "center", padding: "0 5px",
      }}
    >
      {n}
    </span>
  );

  const body = (
    <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-1)" }}>
      <div style={{ position: "relative", marginBottom: "var(--space-2)" }}>
        <span style={{ position: "absolute", left: 10, top: "50%", transform: "translateY(-50%)", color: "var(--muted)", display: "flex", pointerEvents: "none" }}>
          <SearchIcon size={14} />
        </span>
        <Input
          type="search"
          value={query}
          onChange={(e) => onQueryChange(e.target.value)}
          placeholder="Hledat v nastavení…"
          aria-label="Hledat v nastavení"
          autoComplete="off"
          style={{ paddingLeft: 32 }}
          onKeyDown={(e) => {
            if (e.key === "Escape") { e.preventDefault(); onQueryChange(""); }
            if (e.key === "Enter" && matches[0]) { e.preventDefault(); select(matches[0].cat, matches[0].sub); }
          }}
        />
      </div>

      {q ? (
        matches.length === 0 ? (
          <div style={{ padding: "var(--space-3)", color: "var(--muted)", fontSize: "var(--text-base)" }}>Nic nenalezeno</div>
        ) : (
          matches.map(({ cat, sub }) => (
            <MenuItem key={sub.key} selected={section.subsection === sub.key} onClick={() => select(cat, sub)}>
              <span style={{ color: "var(--muted)", fontSize: "var(--text-xs)", display: "block" }}>{cat.label} ›</span>
              {sub.label}
            </MenuItem>
          ))
        )
      ) : (
        categories.map((cat) => (
          <div key={cat.category} data-tour={`settings-cat-${cat.category}`} style={{ marginBottom: "var(--space-2)" }}>
            <div
              style={{
                display: "flex", alignItems: "center", gap: "var(--space-2)", padding: "var(--space-2) var(--space-3) var(--space-1)",
                fontSize: "var(--text-xs)", fontWeight: 800, letterSpacing: 0.4, textTransform: "uppercase", color: "var(--muted)",
              }}
            >
              {cat.icon}
              {cat.label}
            </div>
            {cat.subsections.map((sub) => (
              <MenuItem
                key={sub.key}
                data-tour={`settings-sub-${sub.key}`}
                layout="between"
                selected={section.subsection === sub.key}
                onClick={() => select(cat, sub)}
              >
                <span>{sub.label}</span>
                {sub.badge ? badge(sub.badge) : null}
              </MenuItem>
            ))}
          </div>
        ))
      )}
    </div>
  );

  if (isNarrow) {
    return (
      <details
        data-tour="settings-categories"
        open={open}
        onToggle={(e) => setOpen((e.currentTarget as HTMLDetailsElement).open)}
        style={{ border: "1px solid var(--border)", borderRadius: "var(--radius-sm)", background: "var(--panel)", padding: "var(--space-2) var(--space-3)" }}
      >
        <summary className="ui-summary" style={{ cursor: "pointer", fontWeight: 700, fontSize: "var(--text-base)", color: "var(--text)", display: "flex", alignItems: "center", justifyContent: "space-between", gap: "var(--space-2)", minHeight: 32 }}>
          <span>
            <span style={{ color: "var(--muted)", fontWeight: 600 }}>{currentCat?.label} › </span>
            {currentSub?.label}
          </span>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={{ transform: open ? "rotate(180deg)" : "none", transition: "transform 0.15s" }}>
            <path d="M6 9l6 6 6-6" />
          </svg>
        </summary>
        <div style={{ paddingTop: "var(--space-3)" }}>{body}</div>
      </details>
    );
  }

  return (
    <nav data-tour="settings-categories" aria-label="Sekce nastavení" style={{ position: "sticky", top: "var(--space-3)", minWidth: 0 }}>
      {body}
    </nav>
  );
}

// Service Picker Component (similar to LanguagePicker) – reserved for future use

// Role Picker Component – reserved for future use


