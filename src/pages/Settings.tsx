import { useMemo, useState, useEffect, useRef, useLayoutEffect } from "react";
import { createPortal } from "react-dom";
import { useStatuses, type StatusMeta } from "../state/StatusesStore";
import { useTheme } from "../theme/ThemeProvider";
import { STATUS_COLOR_PALETTE, getContrastText } from "../utils/statusColors";
import { supabase } from "../lib/supabaseClient";
import { safeLoadCompanyData } from "./Orders";
import { useActiveRole } from "../hooks/useActiveRole";
import { useSettingsActions } from "./Settings/hooks/useSettingsActions";
import { TeamSettings } from "./Settings/TeamSettings";
import { Card, FieldLabel, TextInput, LanguagePicker } from "../lib/settingsUi";
import { DocumentsSettings } from "./Settings/DocumentsSettings";
import { DeletedTicketsSettings } from "./Settings/DeletedTicketsSettings";

type SettingsCategory = "service" | "orders" | "appearance";
type SettingsSubsection = 
  | "service_basic" | "service_contact" | "service_team"
  | "orders_statuses" | "orders_filters" | "orders_documents" | "orders_deleted"
  | "appearance_theme" | "appearance_ui";

type SettingsSection = {
  category: SettingsCategory;
  subsection: SettingsSubsection;
};

type UIConfig = {
  app: {
    fabNewOrderEnabled: boolean;
    uiScale: number;
  };
  home: {
    orderFilters: {
      selectedQuickStatusFilters: string[];
    };
  };
  orders: {
    displayMode: "list" | "grid" | "compact";
  };
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

function saveUIConfig(cfg: UIConfig) {
  localStorage.setItem(STORAGE_KEYS.UI_SETTINGS, JSON.stringify(cfg));
  window.dispatchEvent(new CustomEvent("jobsheet:ui-updated"));
}


import { STORAGE_KEYS } from "../constants/storageKeys";



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
};

// safeLoadCompanyData is imported from Orders.tsx
// defaultCompanyData is not needed here as it's only used internally in Orders.tsx


type SettingsProps = {
  activeServiceId: string | null;
  setActiveServiceId: (serviceId: string | null) => void;
  services: Array<{ service_id: string; service_name: string; role: string }>;
};

export default function Settings({ activeServiceId, setActiveServiceId, services }: SettingsProps) {
  const { statuses, fallbackKey } = useStatuses();
  const { theme, setTheme, availableThemes } = useTheme();
  const { isAdmin } = useActiveRole(activeServiceId);
  const { createStatus, deleteStatus, saveServiceSettings } = useSettingsActions({ activeServiceId });
  
  // Helper to handle status create/update (they use the same upsert function)
  const handleStatusUpsert = async (status: StatusMeta) => {
    await createStatus(status);
  };
  const [section, setSection] = useState<SettingsSection>({ category: "service", subsection: "service_basic" });
  const [uiCfg, setUiCfg] = useState<UIConfig>(defaultUIConfig());
  const [companyData, setCompanyData] = useState<CompanyData>(() => safeLoadCompanyData());
  
  
  // Calculate tooltip position
  
  
  
  // State for service settings from DB (currently unused, but kept for future use)
  const [_serviceSettingsLoading, setServiceSettingsLoading] = useState(false);
  const [_serviceSettingsError, setServiceSettingsError] = useState<string | null>(null);
  
  useEffect(() => setUiCfg(safeLoadUIConfig()), []);
  
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
          .single();

        if (error) {
          // If not found, it's okay - will use default/localStorage
          if (error.code === "PGRST116") {
            setServiceSettingsLoading(false);
            return;
          }
          throw error;
        }

        if (data?.config?.abbreviation) {
          // Update companyData abbreviation from DB
          setCompanyData((prev) => ({
            ...prev,
            abbreviation: data.config.abbreviation || prev.abbreviation,
          }));
        }

        setServiceSettingsLoading(false);
      } catch (err) {
        console.error("[Settings] Error loading service settings:", err);
        setServiceSettingsError(err instanceof Error ? err.message : "Neznámá chyba");
        setServiceSettingsLoading(false);
      }
    };

    loadServiceSettings();
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
      if (e.key === STORAGE_KEYS.COMPANY) setCompanyData(safeLoadCompanyData());
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
  const primaryBtn: React.CSSProperties = {
    padding: "10px 14px",
    borderRadius: 12,
    border,
    background: "var(--accent)",
    color: "white",
    fontWeight: 900,
    cursor: "pointer",
    fontFamily: "system-ui",
    fontSize: 13,
  };

  const softBtn: React.CSSProperties = {
    padding: "10px 14px",
    borderRadius: 12,
    border,
    background: "var(--panel)",
    color: "var(--text)",
    fontWeight: 900,
    cursor: "pointer",
    fontFamily: "system-ui",
    fontSize: 13,
  };

  const categories = [
    {
      category: "service" as const,
      label: "Servis",
      icon: (
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>
          <polyline points="9 22 9 12 15 12 15 22"/>
        </svg>
      ),
      subsections: [
        { key: "service_basic" as const, label: "Základní údaje" },
        { key: "service_contact" as const, label: "Kontaktní údaje" },
        { key: "service_team" as const, label: "Tým / Přístupy" },
      ],
    },
    {
      category: "orders" as const,
      label: "Zakázky",
      icon: (
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
          <polyline points="14 2 14 8 20 8"/>
          <line x1="16" y1="13" x2="8" y2="13"/>
          <line x1="16" y1="17" x2="8" y2="17"/>
          <polyline points="10 9 9 9 8 9"/>
        </svg>
      ),
      subsections: [
        { key: "orders_statuses" as const, label: "Statusy zakázek" },
        { key: "orders_filters" as const, label: "Filtry zakázek" },
        { key: "orders_documents" as const, label: "Dokumenty" },
        { key: "orders_deleted" as const, label: "Smazané zakázky" },
      ],
    },
    {
      category: "appearance" as const,
      label: "Vzhled a chování",
      icon: (
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="13.5" cy="6.5" r=".5"/>
          <circle cx="17.5" cy="10.5" r=".5"/>
          <circle cx="8.5" cy="7.5" r=".5"/>
          <circle cx="6.5" cy="12.5" r=".5"/>
          <path d="M12 2C6.5 2 2 6.5 2 12s4.5 10 10 10c.926 0 1.648-.746 1.648-1.688 0-.437-.18-.835-.437-1.125-.29-.289-.438-.652-.438-1.125a1.64 1.64 0 0 1 1.668-1.668h1.996c3.051 0 5.555-2.503 5.555-5.554C21.965 6.012 17.461 2 12 2z"/>
        </svg>
      ),
      subsections: [
        { key: "appearance_ui" as const, label: "Rozhraní" },
        { key: "appearance_theme" as const, label: "Barevné téma" },
      ],
    },
  ];

  const activeCategory = categories.find((cat) => cat.category === section.category) || categories[0];

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
      <div>
        <div style={{ fontSize: 22, fontWeight: 950, color: "var(--text)" }}>Nastavení</div>
        <div style={{ fontSize: 13, color: "var(--muted)", marginTop: 4 }}>
          Konfigurace statusů, UI a filtrů aplikace
        </div>
      </div>

      {/* Main Navigation - Categories */}
      <div style={{ 
        display: "flex", 
        gap: 8, 
        borderBottom: "2px solid var(--border)",
        paddingBottom: 0,
        overflow: "hidden",
        width: "100%",
      }}>
        {categories.map((cat) => {
          const isCategoryActive = section.category === cat.category;
          return (
            <button
              key={cat.category}
              onClick={() => {
                setSection({ category: cat.category, subsection: cat.subsections[0].key });
              }}
              style={{
                padding: "12px 20px",
                border: "none",
                borderBottom: isCategoryActive ? "3px solid var(--accent)" : "3px solid transparent",
                background: isCategoryActive ? "var(--accent-soft)" : "var(--panel)",
                color: isCategoryActive ? "var(--accent)" : "var(--text)",
                fontWeight: isCategoryActive ? 900 : 600,
                cursor: "pointer",
                fontSize: 14,
                display: "flex",
                alignItems: "center",
                gap: 10,
                whiteSpace: "nowrap",
                transition: "var(--transition-smooth)",
                marginBottom: "-2px",
                position: "relative",
                borderRadius: "12px 12px 0 0",
                flexShrink: 0,
                minWidth: 0,
              }}
              onMouseEnter={(e) => {
                if (!isCategoryActive) {
                  e.currentTarget.style.color = "var(--accent)";
                }
              }}
              onMouseLeave={(e) => {
                if (!isCategoryActive) {
                  e.currentTarget.style.color = "var(--text)";
                }
              }}
            >
              <span style={{ display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                {cat.icon}
              </span>
              <span>{cat.label}</span>
            </button>
          );
        })}
      </div>

      {/* Sub Navigation - Subsections */}
      {activeCategory && (
        <div style={{ 
          display: "flex", 
          gap: 8, 
          flexWrap: "wrap",
          paddingBottom: 16,
          borderBottom: "1px solid var(--border)",
        }}>
          {activeCategory.subsections.map((sub) => {
            const isSubsectionActive = section.subsection === sub.key;
            return (
              <button
                key={sub.key}
                onClick={() => setSection({ category: activeCategory.category, subsection: sub.key })}
                style={{
                  padding: "8px 16px",
                  borderRadius: 8,
                  border: "1px solid var(--border)",
                  background: isSubsectionActive ? "var(--accent)" : "var(--panel)",
                  color: isSubsectionActive ? "white" : "var(--text)",
                  fontWeight: isSubsectionActive ? 900 : 600,
                cursor: "pointer",
                fontSize: 13,
                  transition: "var(--transition-smooth)",
                  whiteSpace: "nowrap",
                }}
                onMouseEnter={(e) => {
                  if (!isSubsectionActive) {
                    e.currentTarget.style.background = "var(--accent-soft)";
                    e.currentTarget.style.borderColor = "var(--accent)";
                  }
                }}
                onMouseLeave={(e) => {
                  if (!isSubsectionActive) {
                    e.currentTarget.style.background = "var(--panel)";
                    e.currentTarget.style.borderColor = "var(--border)";
                  }
                }}
              >
                {sub.label}
            </button>
          );
        })}
      </div>
      )}

      {/* SERVIS - ZÁKLADNÍ ÚDAJE */}
      {section.subsection === "service_basic" && (
        <>
          <Card>
            <div style={{ fontWeight: 950, fontSize: 14, marginBottom: 12, color: "var(--text)" }}>Základní údaje</div>
            <div style={{ fontSize: 13, color: "var(--muted)", marginBottom: 16 }}>
              Základní informace o vašem servisu nebo firmě
            </div>

            <div style={{ display: "grid", gap: 16 }}>
              <div>
                <FieldLabel>Zkratka *</FieldLabel>
                <TextInput
                  type="text"
                  value={companyData.abbreviation}
                  onChange={(e: any) => setCompanyData((p) => ({ ...p, abbreviation: e.target.value }))}
                  placeholder="např. IRP"
                />
              </div>

              <div>
                <FieldLabel>Název *</FieldLabel>
                <TextInput
                  type="text"
                  value={companyData.name}
                  onChange={(e: any) => setCompanyData((p) => ({ ...p, name: e.target.value }))}
                  placeholder="např. iSwap Repair Point"
                />
              </div>

              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
                <div>
                  <FieldLabel>IČO *</FieldLabel>
                  <TextInput
                    type="text"
                    value={companyData.ico}
                    onChange={(e: any) => setCompanyData((p) => ({ ...p, ico: e.target.value }))}
                    placeholder="např. 01028359"
                  />
                </div>

                <div>
                  <FieldLabel>DIČ</FieldLabel>
                  <TextInput
                    type="text"
                    value={companyData.dic}
                    onChange={(e: any) => setCompanyData((p) => ({ ...p, dic: e.target.value }))}
                    placeholder="např. CZ01028359"
                  />
                </div>
              </div>

              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
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
                <div style={{ fontWeight: 700, fontSize: 13, color: "var(--text)", marginTop: 8, marginBottom: 8 }}>Adresa</div>
                
                <div style={{ marginBottom: 16 }}>
                  <FieldLabel>Ulice *</FieldLabel>
                  <TextInput
                    type="text"
                    value={companyData.addressStreet}
                    onChange={(e: any) => setCompanyData((p) => ({ ...p, addressStreet: e.target.value }))}
                    placeholder="např. U Vokovické školy 299/4"
                  />
                </div>

                <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr", gap: 16 }}>
                  <div>
                    <FieldLabel>Město *</FieldLabel>
                    <TextInput
                      type="text"
                      value={companyData.addressCity}
                      onChange={(e: any) => setCompanyData((p) => ({ ...p, addressCity: e.target.value }))}
                      placeholder="např. Praha"
                    />
                  </div>

                  <div>
                    <FieldLabel>PSČ *</FieldLabel>
                    <TextInput
                      type="text"
                      value={companyData.addressZip}
                      onChange={(e: any) => setCompanyData((p) => ({ ...p, addressZip: e.target.value }))}
                      placeholder="např. 160 00"
                    />
                  </div>
                </div>
              </div>

              <button
                onClick={async () => {
                  try {
                    await saveServiceSettings(companyData);
                  } catch (err) {
                    // Error is already handled in saveServiceSettings
                  }
                }}
                style={{
                  padding: "12px 24px",
                  borderRadius: 12,
                  border: "none",
                  background: "var(--accent)",
                  color: "var(--accent-fg)",
                  fontWeight: 900,
                  fontSize: 13,
                  cursor: "pointer",
                  transition: "var(--transition-smooth)",
                  boxShadow: "var(--shadow-soft)",
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.opacity = "0.9";
                  e.currentTarget.style.transform = "translateY(-1px)";
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.opacity = "1";
                  e.currentTarget.style.transform = "translateY(0)";
                }}
              >
                Uložit základní údaje
              </button>
            </div>
          </Card>
        </>
      )}

      {/* SERVIS - KONTAKTNÍ ÚDAJE */}
      {section.subsection === "service_contact" && (
        <>
          <Card>
            <div style={{ fontWeight: 950, fontSize: 14, marginBottom: 12, color: "var(--text)" }}>Kontaktní údaje</div>
            <div style={{ fontSize: 13, color: "var(--muted)", marginBottom: 16 }}>
              Kontaktní informace pro komunikaci se zákazníky
            </div>

            <div style={{ display: "grid", gap: 16 }}>
              <div>
                <FieldLabel>Telefonní číslo *</FieldLabel>
                <TextInput
                  type="tel"
                  value={companyData.phone}
                  onChange={(e: any) => setCompanyData((p) => ({ ...p, phone: e.target.value }))}
                  placeholder="+420 773 118 472"
                />
              </div>

              <div>
                <FieldLabel>E-mailová adresa *</FieldLabel>
                <TextInput
                  type="email"
                  value={companyData.email}
                  onChange={(e: any) => setCompanyData((p) => ({ ...p, email: e.target.value }))}
                  placeholder="servis@example.cz"
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

              <button
                onClick={async () => {
                  try {
                    await saveServiceSettings(companyData);
                  } catch (err) {
                    // Error is already handled in saveServiceSettings
                  }
                }}
                style={{
                  padding: "12px 24px",
                  borderRadius: 12,
                  border: "none",
                  background: "var(--accent)",
                  color: "var(--accent-fg)",
                  fontWeight: 900,
                  fontSize: 13,
                  cursor: "pointer",
                  transition: "var(--transition-smooth)",
                  boxShadow: "var(--shadow-soft)",
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.opacity = "0.9";
                  e.currentTarget.style.transform = "translateY(-1px)";
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.opacity = "1";
                  e.currentTarget.style.transform = "translateY(0)";
                }}
              >
                Uložit kontaktní údaje
              </button>
            </div>
          </Card>
        </>
      )}

      {/* SERVIS - TÝM / PŘÍSTUPY */}
      {section.subsection === "service_team" && (
        <TeamSettings activeServiceId={activeServiceId} setActiveServiceId={setActiveServiceId} services={services} />
      )}

      {/* VZHLED A CHOVÁNÍ - BAREVNÉ TÉMA */}
      {section.subsection === "appearance_theme" && (
        <>
          <Card>
            <div style={{ fontWeight: 950, fontSize: 14, marginBottom: 12, color: "var(--text)" }}>Vyberte barevné téma</div>
            <div style={{ fontSize: 13, color: "var(--muted)", marginBottom: 16 }}>
              Změna tématu se aplikuje plynule na celou aplikaci
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 16 }}>
              {availableThemes.map((t) => {
                const isActive = theme === t;
                const themePreviews: Record<string, { title: string; desc: string; bg: string; panel: string; accent: string; text: string }> = {
                  light: { 
                    title: "Světlé", 
                    desc: "Klasické světlé téma", 
                    bg: "linear-gradient(135deg, #f6f7f9 0%, #eef0f4 100%)",
                    panel: "rgba(255, 255, 255, 0.92)",
                    accent: "#2563eb",
                    text: "#111827"
                  },
                  dark: { 
                    title: "Tmavé", 
                    desc: "Tmavé téma pro noční práci", 
                    bg: "linear-gradient(135deg, #0a0c10 0%, #141720 100%)",
                    panel: "rgba(30, 32, 40, 0.85)",
                    accent: "#60a5fa",
                    text: "#f3f4f6"
                  },
                  blue: { 
                    title: "Modré", 
                    desc: "Syté modré odstíny", 
                    bg: "linear-gradient(135deg, #0a1628 0%, #0f1e3a 100%)",
                    panel: "rgba(14, 116, 184, 0.4)",
                    accent: "#0ea5e9",
                    text: "#e0f2fe"
                  },
                  green: { 
                    title: "Zelené", 
                    desc: "Uklidňující zelené tóny", 
                    bg: "linear-gradient(135deg, #0a1f0e 0%, #0f2a14 100%)",
                    panel: "rgba(34, 197, 94, 0.4)",
                    accent: "#22c55e",
                    text: "#dcfce7"
                  },
                  orange: { 
                    title: "Oranžové", 
                    desc: "Teplé oranžové barvy", 
                    bg: "linear-gradient(135deg, #2a1a0a 0%, #3a2410 100%)",
                    panel: "rgba(249, 115, 22, 0.4)",
                    accent: "#f97316",
                    text: "#fff7ed"
                  },
                  purple: { 
                    title: "Fialové", 
                    desc: "Elegantní fialové tóny", 
                    bg: "linear-gradient(135deg, #1a0f2a 0%, #251438 100%)",
                    panel: "rgba(139, 92, 246, 0.4)",
                    accent: "#8b5cf6",
                    text: "#faf5ff"
                  },
                  pink: { 
                    title: "Růžové", 
                    desc: "Jemné růžové odstíny", 
                    bg: "linear-gradient(135deg, #2a0f1a 0%, #381420 100%)",
                    panel: "rgba(236, 72, 153, 0.4)",
                    accent: "#ec4899",
                    text: "#fdf2f8"
                  },
                  "light-blue": {
                    title: "Světle modré",
                    desc: "Světlé modré tóny",
                    bg: "linear-gradient(135deg, #e0f2fe 0%, #bae6fd 100%)",
                    panel: "rgba(255, 255, 255, 0.85)",
                    accent: "#0ea5e9",
                    text: "#0c4a6e"
                  },
                  "light-green": {
                    title: "Světle zelené",
                    desc: "Světlé zelené tóny",
                    bg: "linear-gradient(135deg, #dcfce7 0%, #bbf7d0 100%)",
                    panel: "rgba(255, 255, 255, 0.85)",
                    accent: "#22c55e",
                    text: "#14532d"
                  },
                  "light-orange": {
                    title: "Světle oranžové",
                    desc: "Světlé oranžové tóny",
                    bg: "linear-gradient(135deg, #fff7ed 0%, #ffedd5 100%)",
                    panel: "rgba(255, 255, 255, 0.85)",
                    accent: "#f97316",
                    text: "#7c2d12"
                  },
                  "light-purple": {
                    title: "Světle fialové",
                    desc: "Světlé fialové tóny",
                    bg: "linear-gradient(135deg, #faf5ff 0%, #f3e8ff 100%)",
                    panel: "rgba(255, 255, 255, 0.85)",
                    accent: "#8b5cf6",
                    text: "#4c1d95"
                  },
                  "light-pink": {
                    title: "Světle růžové",
                    desc: "Světlé růžové tóny",
                    bg: "linear-gradient(135deg, #fdf2f8 0%, #fce7f3 100%)",
                    panel: "rgba(255, 255, 255, 0.85)",
                    accent: "#ec4899",
                    text: "#831843"
                  },
                  halloween: {
                    title: "🎃 Halloween",
                    desc: "Strašidelné oranžovo-fialové s dýněmi",
                    bg: "linear-gradient(135deg, #0a0505 0%, #1a0f0f 100%)",
                    panel: "rgba(124, 58, 237, 0.35)",
                    accent: "#f97316",
                    text: "#fef3c7"
                  },
                  christmas: {
                    title: "🎄 Vánoce",
                    desc: "Vánoční zelené s vločkami a sněhulákem",
                    bg: "linear-gradient(135deg, #0d1b1f 0%, #1a2e35 100%)",
                    panel: "rgba(34, 197, 94, 0.35)",
                    accent: "#22c55e",
                    text: "#f0fdf4"
                  },
                };

                const info = themePreviews[t];

                return (
                  <button
                    key={t}
                    onClick={() => setTheme(t)}
                    style={{
                      padding: 0,
                      border: isActive ? "3px solid var(--accent)" : "2px solid var(--border)",
                      borderRadius: "var(--radius-md)",
                      background: "var(--panel)",
                      cursor: "pointer",
                      overflow: "hidden",
                      transition: "var(--transition-smooth)",
                      transform: isActive ? "scale(1.02)" : "scale(1)",
                      boxShadow: isActive ? "0 8px 24px var(--accent-glow)" : "var(--shadow-soft)",
                    }}
                  >
                    <div
                      style={{
                        height: 140,
                        background: info.bg,
                        position: "relative",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        padding: 16,
                      }}
                    >
                      {/* Preview karty */}
                      <div
                        style={{
                          width: "80%",
                          height: "60%",
                          background: info.panel,
                          backdropFilter: "blur(20px)",
                          WebkitBackdropFilter: "blur(20px)",
                          border: `1px solid ${info.accent}40`,
                          borderRadius: 12,
                          boxShadow: `0 8px 24px ${info.accent}30`,
                          display: "flex",
                          flexDirection: "column",
                          padding: 12,
                          gap: 8,
                        }}
                      >
                        <div style={{ width: "60%", height: 8, background: info.accent, borderRadius: 4 }} />
                        <div style={{ width: "40%", height: 6, background: `${info.accent}60`, borderRadius: 3 }} />
                      </div>
                      
                      {isActive && (
                        <div
                          style={{
                            position: "absolute",
                            top: 8,
                            right: 8,
                            width: 28,
                            height: 28,
                            borderRadius: "50%",
                            background: info.accent,
                            display: "grid",
                            placeItems: "center",
                            color: "white",
                            fontWeight: 900,
                            fontSize: 16,
                            boxShadow: `0 4px 12px ${info.accent}60`,
                          }}
                        >
                          ✓
                        </div>
                      )}
                    </div>
                    <div style={{ padding: 12, textAlign: "left", background: "var(--panel)" }}>
                      <div style={{ fontWeight: 900, fontSize: 14, color: "var(--text)", marginBottom: 4 }}>
                        {info.title}
                      </div>
                      <div style={{ fontSize: 12, color: "var(--muted)" }}>{info.desc}</div>
                    </div>
                  </button>
                );
              })}
            </div>
          </Card>
        </>
      )}

      {/* ZAKÁZKY - STATUSY */}
      {section.subsection === "orders_statuses" && (
        <>
          <Card>
            <div style={{ fontWeight: 950, fontSize: 14, marginBottom: 12, color: "var(--text)" }}>Přidat / upravit status</div>

            <div style={{ display: "grid", gap: 10 }}>
              <div>
                <FieldLabel>Název (zobrazovaný text)</FieldLabel>
                <TextInput
                  placeholder="např. Přijato, Probíhá, Hotovo"
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
                                fontSize: 12,
                                boxShadow: `0 2px 8px var(--accent-glow)`,
                              }}
                            >
                              ✓
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
                        fontSize: 12,
                        cursor: "pointer",
                        transition: "var(--transition-smooth)",
                        boxShadow: "var(--shadow-soft)",
                      }}
                    >
                      {showCustomColor ? "✕" : "+"} Vlastní barva
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
                <span style={{ color: "var(--text)", fontWeight: 700, fontSize: 13 }}>Je finální stav</span>
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
                    fontSize: 12,
                    boxShadow: draft.bg ? `0 2px 8px ${draft.bg}30` : "var(--shadow-soft)",
                    transition: "var(--transition-smooth)",
                  }}
                >
                  {draft.label || "Náhled"}
                </div>

                <button
                  type="button"
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
                  style={{
                    ...primaryBtn,
                    opacity: canSave ? 1 : 0.4,
                    cursor: canSave ? "pointer" : "not-allowed",
                  }}
                >
                  {keyExists ? "Aktualizovat" : "Přidat"}
                </button>
              </div>
            </div>
          </Card>

          <Card>
            <div style={{ fontWeight: 950, fontSize: 14, marginBottom: 12, color: "var(--text)" }}>Existující statusy</div>
            <div style={{ fontSize: 12, color: "var(--muted)", marginBottom: 12 }}>
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
                        fontSize: 12,
                      }}
                    >
                      {s.label}
                    </div>
                    {s.isFinal && <div style={{ fontSize: 11, fontWeight: 900, color: "var(--muted)" }}>FINAL</div>}
                    {s.key === fallbackKey && (
                      <div style={{ fontSize: 11, fontWeight: 900, color: "var(--accent)" }}>FALLBACK</div>
                    )}
                  </div>

                  <div style={{ display: "flex", gap: 6 }}>
                    <button onClick={() => setDraft({ ...s })} style={softBtn}>
                      Upravit
                    </button>
                    <button
                      onClick={() => deleteStatus(s.key)}
                      disabled={s.key === fallbackKey}
                      style={{
                        ...softBtn,
                        opacity: s.key === fallbackKey ? 0.4 : 1,
                        cursor: s.key === fallbackKey ? "not-allowed" : "pointer",
                        color: s.key === fallbackKey ? "var(--muted)" : "rgba(239,68,68,0.9)",
                      }}
                    >
                      Smazat
                    </button>
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
            <div style={{ fontWeight: 950, fontSize: 14, marginBottom: 12, color: "var(--text)" }}>Velikost UI</div>
            <div style={{ fontSize: 13, color: "var(--muted)", marginBottom: 12 }}>
              Upravte velikost celého uživatelského rozhraní. Doporučeno: 100% - 125%.
            </div>

            <div style={{ display: "grid", gap: 12 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <div style={{ fontWeight: 700, fontSize: 13, color: "var(--text)" }}>Měřítko</div>
                <div style={{ fontWeight: 900, fontSize: 16, color: "var(--accent)" }}>
                  {Math.round(uiCfg.app.uiScale * 100)}%
                </div>
              </div>

              <input
                type="range"
                min={0.85}
                max={1.35}
                step={0.05}
                value={uiCfg.app.uiScale}
                onChange={(e) => {
                  const newScale = Number(e.target.value);
                  const newCfg = { ...uiCfg, app: { ...uiCfg.app, uiScale: newScale } };
                  setUiCfg(newCfg);
                  saveUIConfig(newCfg);
                }}
                style={{ width: "100%" }}
              />

              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                {[0.85, 0.9, 1, 1.1, 1.25, 1.35].map((v) => (
                  <button
                    key={v}
                    onClick={() => {
                      const newCfg = { ...uiCfg, app: { ...uiCfg.app, uiScale: v } };
                      setUiCfg(newCfg);
                      saveUIConfig(newCfg);
                    }}
                    style={{
                      ...softBtn,
                      background: uiCfg.app.uiScale === v ? "var(--accent-soft)" : "var(--panel)",
                      color: uiCfg.app.uiScale === v ? "var(--accent)" : "var(--text)",
                    }}
                  >
                    {Math.round(v * 100)}%
                  </button>
                ))}
              </div>
            </div>
          </Card>

          <Card>
            <div style={{ fontWeight: 950, fontSize: 14, marginBottom: 12, color: "var(--text)" }}>Plovoucí tlačítko</div>
            <div style={{ fontSize: 13, color: "var(--muted)", marginBottom: 12 }}>
              Zobrazit vpravo dole globální tlačítko „+" pro založení nové zakázky na všech stránkách.
            </div>

            <label
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                padding: 12,
                borderRadius: 10,
                border,
                background: "var(--panel)",
                cursor: "pointer",
              }}
            >
              <div>
                <div style={{ fontWeight: 700, fontSize: 13, color: "var(--text)" }}>Zapnout FAB „Nová zakázka"</div>
                <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 4 }}>
                  Pokud vypnete, zůstane jen tlačítko na stránce Orders
                </div>
              </div>
              <input
                type="checkbox"
                checked={uiCfg.app.fabNewOrderEnabled}
                onChange={(e) => setUiCfg((p) => ({ ...p, app: { ...p.app, fabNewOrderEnabled: e.target.checked } }))}
              />
            </label>
          </Card>

          <Card>
            <div style={{ fontWeight: 950, fontSize: 14, marginBottom: 12, color: "var(--text)" }}>Zobrazení zakázek</div>
            <div style={{ fontSize: 13, color: "var(--muted)", marginBottom: 12 }}>
              Vyberte způsob zobrazení zakázek na stránce Orders.
            </div>

            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              {[
                { 
                  value: "list", 
                  label: "Seznam", 
                  description: "Klasické řádky pod sebou",
                  preview: (
                    <div style={{ display: "flex", flexDirection: "column", gap: 6, marginTop: 8 }}>
                      <div style={{ 
                        padding: "8px 10px", 
                        borderRadius: 8, 
                        border: "1px solid var(--border)", 
                        background: "var(--panel)",
                        display: "flex",
                        flexDirection: "column",
                        gap: 6,
                      }}>
                        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                          <div style={{ fontSize: 11, fontWeight: 700 }}>#ORD-001</div>
                          <div style={{ fontSize: 9, color: "var(--muted)" }}>12.12.2024</div>
                        </div>
                        <div style={{ fontSize: 10, fontWeight: 600, color: "var(--text)" }}>iPhone 15 Pro</div>
                        <div style={{ fontSize: 9, color: "var(--muted)" }}>Jan Novák</div>
                      </div>
                      <div style={{ 
                        padding: "8px 10px", 
                        borderRadius: 8, 
                        border: "1px solid var(--border)", 
                        background: "var(--panel)",
                        display: "flex",
                        flexDirection: "column",
                        gap: 6,
                      }}>
                        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                          <div style={{ fontSize: 11, fontWeight: 700 }}>#ORD-002</div>
                          <div style={{ fontSize: 9, color: "var(--muted)" }}>13.12.2024</div>
                        </div>
                        <div style={{ fontSize: 10, fontWeight: 600, color: "var(--text)" }}>Samsung Galaxy S23</div>
                        <div style={{ fontSize: 9, color: "var(--muted)" }}>Marie Svobodová</div>
                      </div>
                    </div>
                  )
                },
                { 
                  value: "grid", 
                  label: "Mřížka", 
                  description: "Karty vedle sebe",
                  preview: (
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6, marginTop: 8 }}>
                      <div style={{ 
                        padding: "8px 10px", 
                        borderRadius: 8, 
                        border: "1px solid var(--border)", 
                        background: "var(--panel)",
                        display: "flex",
                        flexDirection: "column",
                        gap: 6,
                      }}>
                        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                          <div style={{ fontSize: 10, fontWeight: 700 }}>#ORD-001</div>
                          <div style={{ fontSize: 8, color: "var(--muted)" }}>12.12</div>
                        </div>
                        <div style={{ fontSize: 9, fontWeight: 600, color: "var(--text)" }}>iPhone 15 Pro</div>
                        <div style={{ fontSize: 8, color: "var(--muted)" }}>Jan Novák</div>
                      </div>
                      <div style={{ 
                        padding: "8px 10px", 
                        borderRadius: 8, 
                        border: "1px solid var(--border)", 
                        background: "var(--panel)",
                        display: "flex",
                        flexDirection: "column",
                        gap: 6,
                      }}>
                        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                          <div style={{ fontSize: 10, fontWeight: 700 }}>#ORD-002</div>
                          <div style={{ fontSize: 8, color: "var(--muted)" }}>13.12</div>
                        </div>
                        <div style={{ fontSize: 9, fontWeight: 600, color: "var(--text)" }}>Samsung Galaxy</div>
                        <div style={{ fontSize: 8, color: "var(--muted)" }}>Marie Svobodová</div>
                      </div>
                    </div>
                  )
                },
                { 
                  value: "compact", 
                  label: "Kompaktní", 
                  description: "Menší řádky s méně informacemi",
                  preview: (
                    <div style={{ display: "flex", flexDirection: "column", gap: 4, marginTop: 8 }}>
                      <div style={{ 
                        padding: "6px 8px", 
                        borderRadius: 6, 
                        border: "1px solid var(--border)", 
                        background: "var(--panel)",
                        display: "flex",
                        alignItems: "center",
                        gap: 8,
                        fontSize: 9,
                      }}>
                        <div style={{ fontWeight: 700, minWidth: 60 }}>#ORD-001</div>
                        <div style={{ fontWeight: 600, flex: 1 }}>iPhone 15 Pro</div>
                        <div style={{ color: "var(--muted)", fontSize: 8 }}>Jan Novák</div>
                      </div>
                      <div style={{ 
                        padding: "6px 8px", 
                        borderRadius: 6, 
                        border: "1px solid var(--border)", 
                        background: "var(--panel)",
                        display: "flex",
                        alignItems: "center",
                        gap: 8,
                        fontSize: 9,
                      }}>
                        <div style={{ fontWeight: 700, minWidth: 60 }}>#ORD-002</div>
                        <div style={{ fontWeight: 600, flex: 1 }}>Samsung Galaxy S23</div>
                        <div style={{ color: "var(--muted)", fontSize: 8 }}>Marie Svobodová</div>
                      </div>
                    </div>
                  )
                },
              ].map((mode) => {
                const isSelected = uiCfg.orders?.displayMode === mode.value;
                return (
                  <label
                    key={mode.value}
                    onClick={(e) => {
                      e.preventDefault();
                      const newCfg = {
                        ...uiCfg,
                        orders: { ...uiCfg.orders, displayMode: mode.value as "list" | "grid" | "compact" },
                      };
                      setUiCfg(newCfg);
                      saveUIConfig(newCfg);
                    }}
                    style={{
                      display: "flex",
                      flexDirection: "column",
                      gap: 8,
                      padding: 12,
                      borderRadius: 10,
                      border: isSelected ? "2px solid var(--accent)" : border,
                      background: isSelected ? "var(--accent-soft)" : "var(--panel)",
                      cursor: "pointer",
                      transition: "var(--transition-smooth)",
                    }}
                    onMouseEnter={(e) => {
                      if (!isSelected) {
                        e.currentTarget.style.borderColor = "var(--accent)";
                        e.currentTarget.style.background = "var(--accent-soft)";
                      }
                    }}
                    onMouseLeave={(e) => {
                      if (!isSelected) {
                        e.currentTarget.style.borderColor = border.split(" ")[2];
                        e.currentTarget.style.background = "var(--panel)";
                      }
                    }}
                  >
                    <div style={{ display: "flex", alignItems: "flex-start", gap: 12 }}>
                      <input
                        type="radio"
                        name="displayMode"
                        value={mode.value}
                        checked={isSelected}
                        onChange={() => {
                          const newCfg = {
                            ...uiCfg,
                            orders: { ...uiCfg.orders, displayMode: mode.value as "list" | "grid" | "compact" },
                          };
                          setUiCfg(newCfg);
                          saveUIConfig(newCfg);
                        }}
                        style={{ marginTop: 2 }}
                      />
                      <div style={{ flex: 1 }}>
                        <div style={{ fontWeight: 700, fontSize: 13, color: "var(--text)" }}>{mode.label}</div>
                        <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 2 }}>{mode.description}</div>
                      </div>
                    </div>
                    {mode.preview}
                  </label>
                );
              })}
            </div>
          </Card>
        </>
      )}

      {/* ZAKÁZKY - DOKUMENTY (removed old legacy section) */}

      {/* ZAKÁZKY - DOKUMENTY */}
      {section.subsection === "orders_documents" && (
        <DocumentsSettings activeServiceId={activeServiceId} />
      )}

      {section.subsection === "orders_filters" && (
        <>
          <Card>
            <div style={{ fontWeight: 950, fontSize: 14, marginBottom: 12, color: "var(--text)" }}>Rychlé filtry zakázek</div>
            <div style={{ fontSize: 13, color: "var(--muted)", marginBottom: 12 }}>
              Vyberte statusy, které se mají zobrazovat jako rychlé filtry na stránce Orders.
            </div>

            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {statuses.map((s) => {
                const checked = selectedQuick.includes(s.key);
                return (
                  <label
                    key={s.key}
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      alignItems: "center",
                      padding: 12,
                      borderRadius: 10,
                      border,
                      background: "var(--panel)",
                      cursor: "pointer",
                    }}
                  >
                    <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
                      <div
                        style={{
                          padding: "6px 12px",
                          borderRadius: 999,
                          border,
                          background: s.bg || "var(--panel-2)",
                          color: s.fg || "var(--text)",
                          fontWeight: 900,
                          fontSize: 12,
                        }}
                      >
                        {s.label}
                      </div>
                      {s.isFinal && <div style={{ fontSize: 11, fontWeight: 900, color: "var(--muted)" }}>FINAL</div>}
                    </div>
                    <input type="checkbox" checked={checked} onChange={() => toggleQuick(s.key)} />
                  </label>
                );
              })}
            </div>
          </Card>
        </>
      )}

      {/* ZAKÁZKY - SMAZANÉ */}
      {section.subsection === "orders_deleted" && (
        <DeletedTicketsSettings activeServiceId={activeServiceId} />
      )}
    </div>
  );
}

// Service Picker Component (similar to LanguagePicker)
function ServicePicker({ 
  value, 
  onChange, 
  services 
}: { 
  value: string | null; 
  onChange: (serviceId: string | null) => void; 
  services: Array<{ service_id: string; service_name: string; role: string }>;
}) {
  const [open, setOpen] = useState(false);
  const buttonRef = useRef<HTMLButtonElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);

  const selected = services.find((s) => s.service_id === value) || services[0];

  useEffect(() => {
    if (!open) return;
    const handleClick = (e: MouseEvent) => {
      if (
        menuRef.current &&
        !menuRef.current.contains(e.target as Node) &&
        buttonRef.current &&
        !buttonRef.current.contains(e.target as Node)
      ) {
        setOpen(false);
      }
    };
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", handleClick);
    document.addEventListener("keydown", handleEscape);
    return () => {
      document.removeEventListener("mousedown", handleClick);
      document.removeEventListener("keydown", handleEscape);
    };
  }, [open]);

  useLayoutEffect(() => {
    if (!open || !buttonRef.current || !menuRef.current) return;
    const btnRect = buttonRef.current.getBoundingClientRect();
    const menu = menuRef.current;
    const menuHeight = menu.scrollHeight;
    const spaceBelow = window.innerHeight - btnRect.bottom;
    const spaceAbove = btnRect.top;
    let top = btnRect.bottom + 8;
    let maxHeight = Math.min(300, spaceBelow - 16);
    if (spaceBelow < menuHeight && spaceAbove > spaceBelow) {
      top = btnRect.top - menuHeight - 8;
      maxHeight = Math.min(300, spaceAbove - 16);
    }
    menu.style.top = `${top}px`;
    menu.style.left = `${btnRect.left}px`;
    menu.style.width = `${btnRect.width}px`;
    menu.style.maxHeight = `${maxHeight}px`;
  }, [open]);

  const border = "1px solid var(--border)";
  const menu = open ? (
    <div
      ref={menuRef}
      role="listbox"
      style={{
        position: "fixed",
        borderRadius: 14,
        border: "1px solid var(--border)",
        background: "var(--panel)",
        boxShadow: "0 25px 60px rgba(0,0,0,0.22)",
        padding: 6,
        zIndex: 10000,
        overflowY: "auto",
      }}
    >
      {services.map((s) => {
        const active = s.service_id === value;
        return (
          <button
            key={s.service_id}
            type="button"
            onClick={() => {
              onChange(s.service_id);
              setOpen(false);
            }}
            style={{
              width: "100%",
              textAlign: "left",
              padding: "12px 14px",
              borderRadius: 12,
              border: "none",
              background: active ? "var(--accent-soft)" : "transparent",
              cursor: "pointer",
              color: active ? "var(--accent)" : "var(--text)",
              fontFamily: "system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif",
              fontWeight: active ? 700 : 500,
              fontSize: 14,
              transition: "var(--transition-smooth)",
            }}
            onMouseEnter={(e) => {
              if (!active) e.currentTarget.style.background = "var(--panel-2)";
            }}
            onMouseLeave={(e) => {
              if (!active) e.currentTarget.style.background = "transparent";
            }}
          >
            {s.service_name} ({s.role})
          </button>
        );
      })}
    </div>
  ) : null;

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
                onClick={() =>  setOpen(!open)}
        style={{
          width: "100%",
          padding: "10px 40px 10px 12px",
          borderRadius: 12,
          border: open ? "1px solid var(--accent)" : border,
          outline: "none",
          background: open ? "var(--panel-2)" : "var(--panel)",
          backdropFilter: "var(--blur)",
          WebkitBackdropFilter: "var(--blur)",
          color: "var(--text)",
          fontFamily: "system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif",
          fontWeight: 500,
          fontSize: 13,
          cursor: false ? "not-allowed" : "pointer",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          boxShadow: open ? "0 0 0 3px var(--accent-soft)" : "var(--shadow-soft)",
          transition: "var(--transition-smooth)",
        }}
        onMouseEnter={(e) => {
          if (true) {
          if (!open) e.currentTarget.style.borderColor = "var(--accent)";
          if (!open) e.currentTarget.style.boxShadow = "0 4px 16px var(--accent-glow)";
          }
        }}
        onMouseLeave={(e) => {
          if (true) {
          if (!open) e.currentTarget.style.borderColor = border.split(" ")[2];
          if (!open) e.currentTarget.style.boxShadow = "var(--shadow-soft)";
          }
        }}
      >
        <span>{selected ? `${selected.service_name} (${selected.role})` : "Vyberte servis"}</span>
        <span style={{ opacity: 0.65, fontWeight: 900, fontSize: 12 }}>▾</span>
      </button>
      {open ? createPortal(menu, document.body) : null}
    </>
  );
}

// Role Picker Component
function RolePicker({ 
  value, 
  onChange, 
  disabled,
  options 
}: { 
  value: string; 
  onChange: (role: string) => void; 
  disabled?: boolean;
  options: Array<{ value: string; label: string }>;
}) {
  const [open, setOpen] = useState(false);
  const buttonRef = useRef<HTMLButtonElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);

  const selected = options.find((o) => o.value === value) || options[0];

  useEffect(() => {
    if (!open) return;
    const handleClick = (e: MouseEvent) => {
      if (
        menuRef.current &&
        !menuRef.current.contains(e.target as Node) &&
        buttonRef.current &&
        !buttonRef.current.contains(e.target as Node)
      ) {
        setOpen(false);
      }
    };
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", handleClick);
    document.addEventListener("keydown", handleEscape);
    return () => {
      document.removeEventListener("mousedown", handleClick);
      document.removeEventListener("keydown", handleEscape);
    };
  }, [open]);

  useLayoutEffect(() => {
    if (!open || !buttonRef.current || !menuRef.current) return;
    const btnRect = buttonRef.current.getBoundingClientRect();
    const menu = menuRef.current;
    const menuHeight = menu.scrollHeight;
    const spaceBelow = window.innerHeight - btnRect.bottom;
    const spaceAbove = btnRect.top;
    let top = btnRect.bottom + 8;
    let maxHeight = Math.min(300, spaceBelow - 16);
    if (spaceBelow < menuHeight && spaceAbove > spaceBelow) {
      top = btnRect.top - menuHeight - 8;
      maxHeight = Math.min(300, spaceAbove - 16);
    }
    menu.style.top = `${top}px`;
    menu.style.left = `${btnRect.left}px`;
    menu.style.width = `${btnRect.width}px`;
    menu.style.maxHeight = `${maxHeight}px`;
  }, [open]);

  const border = "1px solid var(--border)";
  const menu = open ? (
    <div
      ref={menuRef}
      role="listbox"
      style={{
        position: "fixed",
        borderRadius: 14,
        border: "1px solid var(--border)",
        background: "var(--panel)",
        boxShadow: "0 25px 60px rgba(0,0,0,0.22)",
        padding: 6,
        zIndex: 10000,
        overflowY: "auto",
      }}
    >
      {options.map((opt) => {
        const active = opt.value === value;
        return (
          <button
            key={opt.value}
            type="button"
            onClick={() => {
              onChange(opt.value);
              setOpen(false);
            }}
            style={{
              width: "100%",
              textAlign: "left",
              padding: "12px 14px",
              borderRadius: 12,
              border: "none",
              background: active ? "var(--accent-soft)" : "transparent",
              cursor: "pointer",
              color: active ? "var(--accent)" : "var(--text)",
              fontFamily: "system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif",
              fontWeight: active ? 700 : 500,
              fontSize: 14,
              transition: "var(--transition-smooth)",
            }}
            onMouseEnter={(e) => {
              if (!active) e.currentTarget.style.background = "var(--panel-2)";
            }}
            onMouseLeave={(e) => {
              if (!active) e.currentTarget.style.background = "transparent";
            }}
          >
            {opt.label}
          </button>
        );
      })}
    </div>
  ) : null;

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        onClick={() => !disabled && setOpen(!open)}
        disabled={disabled}
        style={{
          padding: "4px 24px 4px 8px",
          borderRadius: 6,
          border: open ? "1px solid var(--accent)" : border,
          outline: "none",
          background: disabled ? "transparent" : (open ? "var(--panel-2)" : "var(--panel)"),
          color: disabled ? "var(--muted)" : "var(--text)",
          fontFamily: "system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif",
          fontWeight: 500,
          fontSize: 12,
          cursor: disabled ? "not-allowed" : "pointer",
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "space-between",
          opacity: disabled ? 0.6 : 1,
          transition: "var(--transition-smooth)",
        }}
        onMouseEnter={(e) => {
          if (!open && !disabled) e.currentTarget.style.borderColor = "var(--accent)";
        }}
        onMouseLeave={(e) => {
          if (!open && !disabled) e.currentTarget.style.borderColor = border.split(" ")[2];
        }}
      >
        <span>{selected.label}</span>
        <span style={{ opacity: 0.65, fontWeight: 900, fontSize: 10, marginLeft: 4 }}>▾</span>
      </button>
      {open && !disabled ? createPortal(menu, document.body) : null}
    </>
  );
}


