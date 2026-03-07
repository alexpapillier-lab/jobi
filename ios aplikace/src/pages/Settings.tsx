import { useMemo, useState, useEffect, useRef, useLayoutEffect, useCallback, type ChangeEvent } from "react";
import { createPortal } from "react-dom";
import { useStatuses, type StatusMeta } from "../state/StatusesStore";
import { useTheme } from "../theme/ThemeProvider";
import { STATUS_COLOR_PALETTE, getContrastText } from "../utils/statusColors";
import { supabase } from "../lib/supabaseClient";
import { safeLoadCompanyData } from "./Orders";
import { useActiveRole } from "../hooks/useActiveRole";
import { useSettingsActions } from "./Settings/hooks/useSettingsActions";
import { TeamSettings } from "./Settings/TeamSettings";
import { OwnerSettings } from "./Settings/OwnerSettings";
import { Card, FieldLabel, TextInput, LanguagePicker } from "../lib/settingsUi";
import { DeletedTicketsSettings } from "./Settings/DeletedTicketsSettings";
import { useUserProfile } from "../hooks/useUserProfile";
import { useIsRootOwner } from "../hooks/useIsRootOwner";
import { showToast } from "../components/Toast";
import { areSoundsEnabled, setSoundsEnabled } from "../lib/sounds";
import {
  getShortcut,
  setShortcut,
  resetShortcuts,
  keyEventToCombo,
  isModifierOnlyKey,
  formatShortcutForDisplay,
  SHORTCUT_LABELS,
  ALL_SHORTCUT_IDS,
  DEFAULT_SHORTCUTS,
  type ShortcutId,
} from "../lib/keyboardShortcuts";
import { getDeviceOptions, setDeviceOptions } from "../lib/deviceOptions";
import { getHandoffOptions, setHandoffOptions } from "../lib/handoffOptions";
import { loadDocumentsConfigRawFromDB, saveDocumentsConfigAutoPrint } from "../lib/documentSettings";
import { STORAGE_KEYS } from "../constants/storageKeys";
import { LOGO_PRESETS, getLogoColors, type LogoPresetId, type LogoColors } from "../lib/logoPresets";
import { setAppIconFromPreset } from "../lib/setAppIcon";
import { AppLogo } from "../components/AppLogo";
import { getVersion } from "@tauri-apps/api/app";
import { useAppUpdate } from "../context/AppUpdateContext";
import { useAuth } from "../auth/AuthProvider";

function LogoPresetButton({
  isActive,
  label,
  logoUrl,
  fallbackColors,
  onClick,
}: {
  isActive: boolean;
  label: string;
  logoUrl: string;
  fallbackColors: LogoColors;
  onClick: () => void;
}) {
  const [imgFailed, setImgFailed] = useState(false);
  return (
    <button
      type="button"
      onClick={onClick}
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
      <div style={{ height: 100, display: "flex", alignItems: "center", justifyContent: "center", background: fallbackColors.background }}>
        {imgFailed ? (
          <AppLogo size={56} colors={fallbackColors} modern />
        ) : (
          <img
            src={logoUrl}
            alt=""
            style={{ width: 56, height: 56, objectFit: "contain" }}
            onError={() => setImgFailed(true)}
          />
        )}
      </div>
      <div style={{ padding: "8px 10px", textAlign: "center", background: "var(--panel)", borderTop: "1px solid var(--border)" }}>
        <span style={{ fontWeight: 700, fontSize: 12, color: "var(--text)" }}>{label}</span>
      </div>
    </button>
  );
}

type SettingsCategory = "service" | "orders" | "appearance" | "profile" | "about";
type SettingsSubsection = 
  | "service_basic" | "service_contact" | "service_team" | "service_owner"
  | "orders_statuses" | "orders_filters" | "orders_required_fields" | "orders_tisk_dokumentu" | "orders_reklamace" | "orders_deleted" | "orders_device_options" | "orders_handoff_options"
  | "appearance_theme" | "appearance_ui" | "appearance_shortcuts"
  | "profile_me"
  | "about_app" | "about_updates";

type SettingsSection = {
  category: SettingsCategory;
  subsection: SettingsSubsection;
};

const ORDERS_PAGE_SIZE_CHOICES: { value: number; label: string }[] = [
  { value: 25, label: "25" },
  { value: 50, label: "50" },
  { value: 100, label: "100" },
  { value: 200, label: "200" },
  { value: 0, label: "Vše" },
];

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
    displayMode: "list" | "grid" | "compact" | "compact-extra";
    pageSize: number;
    customerPhoneRequired: boolean;
  };
};

function defaultUIConfig(): UIConfig {
  return {
    app: { fabNewOrderEnabled: true, uiScale: 1 },
    home: { orderFilters: { selectedQuickStatusFilters: [] } },
    orders: { displayMode: "list", pageSize: 50, customerPhoneRequired: true },
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
    const validPageSize = typeof pageSize === "number" && (pageSize === 0 || [25, 50, 100, 200].includes(pageSize))
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
        customerPhoneRequired: typeof customerPhoneRequired === "boolean" ? customerPhoneRequired : d.orders.customerPhoneRequired,
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

function ShortcutsSettingsSection() {
  const [recordingId, setRecordingId] = useState<ShortcutId | null>(null);
  const [, forceUpdate] = useState(0);

  useEffect(() => {
    if (recordingId === null) return;
    const onKey = (e: KeyboardEvent) => {
      if (isModifierOnlyKey(e)) {
        e.preventDefault();
        e.stopPropagation();
        return;
      }
      e.preventDefault();
      e.stopPropagation();
      const combo = keyEventToCombo(e);
      setShortcut(recordingId, combo);
      setRecordingId(null);
      forceUpdate((n) => n + 1);
      showToast(`Zkratka nastavena: ${formatShortcutForDisplay(combo)}`, "success");
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [recordingId]);

  const handleReset = () => {
    resetShortcuts();
    forceUpdate((n) => n + 1);
    showToast("Zkratky obnoveny na výchozí", "success");
  };

  const border = "1px solid var(--border)";
  return (
    <Card>
      <div style={{ fontWeight: 950, fontSize: 14, marginBottom: 12, color: "var(--text)" }}>Klávesové zkratky</div>
      <div style={{ fontSize: 13, color: "var(--muted)", marginBottom: 16 }}>
        Klikněte na zkratku a stiskněte novou kombinaci kláves. Na macOS použijte Cmd místo Ctrl.
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {ALL_SHORTCUT_IDS.map((id) => {
          const isRecording = recordingId === id;
          const current = getShortcut(id);
          const isDefault = current === DEFAULT_SHORTCUTS[id];
          return (
            <div
              key={id}
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                gap: 16,
                padding: "12px 14px",
                borderRadius: 10,
                border,
                background: isRecording ? "var(--accent-soft)" : "var(--panel)",
                transition: "background 0.15s ease",
              }}
            >
              <span style={{ color: "var(--text)", fontSize: 13, flex: 1 }}>{SHORTCUT_LABELS[id]}</span>
              <button
                type="button"
                onClick={() => setRecordingId(isRecording ? null : id)}
                style={{
                  padding: "6px 12px",
                  borderRadius: 8,
                  border: "1px solid var(--border)",
                  background: isRecording ? "var(--accent)" : "var(--bg)",
                  color: isRecording ? "var(--accent-fg)" : "var(--text)",
                  fontSize: 12,
                  fontFamily: "monospace",
                  cursor: "pointer",
                  minWidth: 100,
                }}
              >
                {isRecording ? "Stiskněte klávesy…" : formatShortcutForDisplay(current)}
              </button>
              {!isDefault && (
                <button
                  type="button"
                  onClick={() => {
                    setShortcut(id, DEFAULT_SHORTCUTS[id]);
                    forceUpdate((n) => n + 1);
                  }}
                  style={{
                    padding: "6px 10px",
                    borderRadius: 8,
                    border: "none",
                    background: "var(--panel-2)",
                    color: "var(--muted)",
                    fontSize: 11,
                    cursor: "pointer",
                  }}
                  title="Obnovit výchozí"
                >
                  Výchozí
                </button>
              )}
            </div>
          );
        })}
      </div>
      <div style={{ marginTop: 16 }}>
        <button
          type="button"
          onClick={handleReset}
          style={{
            padding: "10px 16px",
            borderRadius: 10,
            border: "1px solid var(--border)",
            background: "var(--panel-2)",
            color: "var(--text)",
            fontSize: 13,
            fontWeight: 600,
            cursor: "pointer",
          }}
        >
          Obnovit všechny výchozí zkratky
        </button>
      </div>
    </Card>
  );
}

function DeviceOptionsSettingsSection() {
  const [options, setOptions] = useState(() => getDeviceOptions());
  const [newCondition, setNewCondition] = useState("");
  const [newAccessory, setNewAccessory] = useState("");

  const addCondition = () => {
    const v = newCondition.trim();
    if (!v || options.deviceConditions.includes(v)) return;
    const next = { ...options, deviceConditions: [...options.deviceConditions, v] };
    setDeviceOptions(next);
    setOptions(next);
    setNewCondition("");
  };
  const removeCondition = (idx: number) => {
    const next = { ...options, deviceConditions: options.deviceConditions.filter((_, i) => i !== idx) };
    setDeviceOptions(next);
    setOptions(next);
  };
  const addAccessory = () => {
    const v = newAccessory.trim();
    if (!v || options.deviceAccessories.includes(v)) return;
    const next = { ...options, deviceAccessories: [...options.deviceAccessories, v] };
    setDeviceOptions(next);
    setOptions(next);
    setNewAccessory("");
  };
  const removeAccessory = (idx: number) => {
    const next = { ...options, deviceAccessories: options.deviceAccessories.filter((_, i) => i !== idx) };
    setDeviceOptions(next);
    setOptions(next);
  };
  const border = "1px solid var(--border)";
  const inputStyle = { padding: "8px 12px", borderRadius: 8, border, background: "var(--bg)", color: "var(--text)", fontSize: 13, width: "100%", maxWidth: 280 };
  const rowStyle: React.CSSProperties = { display: "flex", alignItems: "center", gap: 8, padding: "6px 0", flexWrap: "wrap" };
  return (
    <Card>
      <div style={{ fontWeight: 950, fontSize: 14, marginBottom: 12, color: "var(--text)" }}>Stavy zařízení a příslušenství</div>
      <div style={{ fontSize: 13, color: "var(--muted)", marginBottom: 16 }}>
        Přednastavené možnosti se zobrazí při zakládání zakázky v polích „Popis stavu“ a „Příslušenství“. Uživatel může vybrat z listu nebo napsat vlastní text. Změny se ukládají automaticky (tlačítko Uložit není potřeba).
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
        <div>
          <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 8, color: "var(--text)" }}>Stavy zařízení</div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 8 }}>
            <input value={newCondition} onChange={(e) => setNewCondition(e.target.value)} onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), addCondition())} placeholder="Přidat stav…" style={inputStyle} />
            <button type="button" onClick={addCondition} style={{ padding: "8px 14px", borderRadius: 8, border: "none", background: "var(--accent)", color: "var(--accent-fg)", fontWeight: 600, cursor: "pointer" }}>Přidat</button>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            {options.deviceConditions.map((item, idx) => (
              <div key={idx} style={rowStyle}>
                <span style={{ color: "var(--text)", fontSize: 13 }}>{item}</span>
                <button type="button" onClick={() => removeCondition(idx)} style={{ padding: "4px 8px", fontSize: 11, border: "none", background: "var(--panel-2)", color: "var(--muted)", borderRadius: 6, cursor: "pointer" }}>Odstranit</button>
              </div>
            ))}
          </div>
        </div>
        <div>
          <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 8, color: "var(--text)" }}>Příslušenství</div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 8 }}>
            <input value={newAccessory} onChange={(e) => setNewAccessory(e.target.value)} onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), addAccessory())} placeholder="Přidat položku…" style={inputStyle} />
            <button type="button" onClick={addAccessory} style={{ padding: "8px 14px", borderRadius: 8, border: "none", background: "var(--accent)", color: "var(--accent-fg)", fontWeight: 600, cursor: "pointer" }}>Přidat</button>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            {options.deviceAccessories.map((item, idx) => (
              <div key={idx} style={rowStyle}>
                <span style={{ color: "var(--text)", fontSize: 13 }}>{item}</span>
                <button type="button" onClick={() => removeAccessory(idx)} style={{ padding: "4px 8px", fontSize: 11, border: "none", background: "var(--panel-2)", color: "var(--muted)", borderRadius: 6, cursor: "pointer" }}>Odstranit</button>
              </div>
            ))}
          </div>
        </div>
      </div>
    </Card>
  );
}

function HandoffOptionsSettingsSection() {
  const [options, setOptions] = useState(() => getHandoffOptions());
  const [newReceive, setNewReceive] = useState("");
  const [newReturn, setNewReturn] = useState("");

  const addReceive = () => {
    const v = newReceive.trim();
    if (!v || options.receiveMethods.includes(v)) return;
    const next = { ...options, receiveMethods: [...options.receiveMethods, v] };
    setHandoffOptions(next);
    setOptions(next);
    setNewReceive("");
  };
  const removeReceive = (idx: number) => {
    const next = { ...options, receiveMethods: options.receiveMethods.filter((_, i) => i !== idx) };
    setHandoffOptions(next);
    setOptions(next);
  };
  const addReturn = () => {
    const v = newReturn.trim();
    if (!v || options.returnMethods.includes(v)) return;
    const next = { ...options, returnMethods: [...options.returnMethods, v] };
    setHandoffOptions(next);
    setOptions(next);
    setNewReturn("");
  };
  const removeReturn = (idx: number) => {
    const next = { ...options, returnMethods: options.returnMethods.filter((_, i) => i !== idx) };
    setHandoffOptions(next);
    setOptions(next);
  };

  const border = "1px solid var(--border)";
  const inputStyle = { padding: "8px 12px", borderRadius: 8, border, background: "var(--bg)", color: "var(--text)", fontSize: 13, width: "100%", maxWidth: 280 };
  const rowStyle: React.CSSProperties = { display: "flex", alignItems: "center", gap: 8, padding: "6px 0", flexWrap: "wrap" };
  return (
    <Card>
      <div style={{ fontWeight: 950, fontSize: 14, marginBottom: 12, color: "var(--text)" }}>Způsoby převzetí a předání</div>
      <div style={{ fontSize: 13, color: "var(--muted)", marginBottom: 16 }}>
        Možnosti pro „Způsob převzetí“ a „Způsob předání“ při zakládání a úpravě zakázky. V zakázce lze vybírat pouze z tohoto seznamu (dropdown). Změny se ukládají automaticky.
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
        <div>
          <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 8, color: "var(--text)" }}>Způsob převzetí</div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 8 }}>
            <input value={newReceive} onChange={(e) => setNewReceive(e.target.value)} onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), addReceive())} placeholder="Přidat (např. Na pobočce, Poštou)…" style={inputStyle} />
            <button type="button" onClick={addReceive} style={{ padding: "8px 14px", borderRadius: 8, border: "none", background: "var(--accent)", color: "var(--accent-fg)", fontWeight: 600, cursor: "pointer" }}>Přidat</button>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            {options.receiveMethods.map((item, idx) => (
              <div key={idx} style={rowStyle}>
                <span style={{ color: "var(--text)", fontSize: 13 }}>{item}</span>
                <button type="button" onClick={() => removeReceive(idx)} style={{ padding: "4px 8px", fontSize: 11, border: "none", background: "var(--panel-2)", color: "var(--muted)", borderRadius: 6, cursor: "pointer" }}>Odstranit</button>
              </div>
            ))}
          </div>
        </div>
        <div>
          <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 8, color: "var(--text)" }}>Způsob předání</div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 8 }}>
            <input value={newReturn} onChange={(e) => setNewReturn(e.target.value)} onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), addReturn())} placeholder="Přidat (např. Vyzvednutí na pobočce, Poštou)…" style={inputStyle} />
            <button type="button" onClick={addReturn} style={{ padding: "8px 14px", borderRadius: 8, border: "none", background: "var(--accent)", color: "var(--accent-fg)", fontWeight: 600, cursor: "pointer" }}>Přidat</button>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            {options.returnMethods.map((item, idx) => (
              <div key={idx} style={rowStyle}>
                <span style={{ color: "var(--text)", fontSize: 13 }}>{item}</span>
                <button type="button" onClick={() => removeReturn(idx)} style={{ padding: "4px 8px", fontSize: 11, border: "none", background: "var(--panel-2)", color: "var(--muted)", borderRadius: 6, cursor: "pointer" }}>Odstranit</button>
              </div>
            ))}
          </div>
        </div>
      </div>
    </Card>
  );
}

function ProfileSettingsSection() {
  const { profile, loading, error, setProfile } = useUserProfile();
  const [nickname, setNickname] = useState("");
  const [avatarUrl, setAvatarUrl] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (profile) {
      setNickname(profile.nickname ?? "");
      setAvatarUrl(profile.avatarUrl ?? "");
    }
  }, [profile]);

  const handleSave = async () => {
    setSaving(true);
    try {
      await setProfile({ nickname: nickname.trim() || null, avatarUrl: avatarUrl.trim() || null });
      showToast("Profil uložen", "success");
    } catch {
      showToast("Nepodařilo se uložit profil", "error");
    } finally {
      setSaving(false);
    }
  };

  const border = "1px solid var(--border)";
  return (
    <Card>
      <div style={{ fontWeight: 950, fontSize: 14, marginBottom: 12, color: "var(--text)" }}>Fotka a přezdívka</div>
      <div style={{ fontSize: 13, color: "var(--muted)", marginBottom: 16 }}>
        Vaše přezdívka a fotka se zobrazí u komentářů a u aktivit v zakázkách, aby ostatní viděli, kdo co napsal nebo upravil.
      </div>
      {loading ? (
        <div style={{ color: "var(--muted)", fontSize: 13 }}>Načítání…</div>
      ) : (
        <div style={{ display: "grid", gap: 16 }}>
          {error && (
            <div style={{ padding: 12, borderRadius: 12, background: "var(--panel-2)", border, color: "var(--text)", fontSize: 13 }}>
              {error}
            </div>
          )}
          <div>
            <FieldLabel>Přezdívka (nick)</FieldLabel>
            <TextInput
              value={nickname}
              onChange={(e: ChangeEvent<HTMLInputElement>) => setNickname(e.target.value)}
              placeholder="např. Honza, Servisák"
            />
          </div>
          <div>
            <FieldLabel>URL fotky (avatar)</FieldLabel>
            <TextInput
              type="url"
              value={avatarUrl}
              onChange={(e: ChangeEvent<HTMLInputElement>) => setAvatarUrl(e.target.value)}
              placeholder="https://… nebo nechte prázdné"
            />
          </div>
          {avatarUrl && (
            <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
              <span style={{ fontSize: 13, color: "var(--muted)" }}>Náhled:</span>
              <img
                src={avatarUrl}
                alt="Avatar"
                style={{ width: 40, height: 40, borderRadius: 12, objectFit: "cover", border }}
                onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
              />
            </div>
          )}
          <button
            onClick={handleSave}
            disabled={saving}
            style={{
              padding: "12px 24px",
              borderRadius: 12,
              border: "none",
              background: "var(--accent)",
              color: "var(--accent-fg)",
              fontWeight: 900,
              fontSize: 13,
              cursor: saving ? "not-allowed" : "pointer",
              opacity: saving ? 0.7 : 1,
              transition: "var(--transition-smooth)",
              boxShadow: "var(--shadow-soft)",
            }}
          >
            {saving ? "Ukládám…" : "Uložit profil"}
          </button>
        </div>
      )}
    </Card>
  );
}

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
  const { session } = useAuth();
  const { statuses, fallbackKey } = useStatuses();
  const { theme, setTheme, availableThemes } = useTheme();
  const appUpdate = useAppUpdate();
  const updateAvailable = !!(appUpdate?.update);
  const { isAdmin, hasCapability } = useActiveRole(activeServiceId);
  const isRootOwner = useIsRootOwner();
  const canManageDocuments = isAdmin || (hasCapability && hasCapability("can_manage_documents"));
  const { createStatus, deleteStatus, saveServiceSettings } = useSettingsActions({ activeServiceId });
  
  // Helper to handle status create/update (they use the same upsert function)
  const handleStatusUpsert = async (status: StatusMeta) => {
    await createStatus(status);
  };
  const [section, setSection] = useState<SettingsSection>({ category: "service", subsection: "service_basic" });
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
    if (tourSection?.category && tourSection?.subsection) {
      setSection({
        category: tourSection.category as SettingsCategory,
        subsection: tourSection.subsection as SettingsSubsection,
      });
    }
  }, [tourSection?.category, tourSection?.subsection]);

  // Otevřít konkrétní subsekci (např. Aktualizace po kliku na „Jít do nastavení“ v toastu)
  useEffect(() => {
    if (!openToSubsection?.category || !openToSubsection?.subsection) return;
    setSection({ category: openToSubsection.category, subsection: openToSubsection.subsection });
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
  const [autoPrintFormSaveSuccess, setAutoPrintFormSaveSuccess] = useState(false);
  const [appVersion, setAppVersion] = useState<string>("…");
  
  useEffect(() => setUiCfg(safeLoadUIConfig()), []);

  useEffect(() => {
    getVersion().then(setAppVersion).catch(() => setAppVersion("?"));
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
          setCompanyData((prev) => ({
            ...prev,
            abbreviation: data.config.abbreviation || prev.abbreviation,
          }));
        }
        setOrdersShowClaimsInList(!!data?.config?.orders_show_claims_in_list);

        setServiceSettingsLoading(false);
      } catch (err) {
        console.error("[Settings] Error loading service settings:", err);
        setServiceSettingsError(err instanceof Error ? err.message : "Neznámá chyba");
        setServiceSettingsLoading(false);
      }
    };

    loadServiceSettings();
  }, [activeServiceId]);

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
      showToast("Chyba při ukládání", "error");
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

  const categories = useMemo(() => [
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
        ...(canManageDocuments ? [{ key: "service_contact" as const, label: "Kontaktní údaje" }] : []),
        ...(isAdmin ? [{ key: "service_team" as const, label: "Tým / Přístupy" }] : []),
        ...(isRootOwner ? [{ key: "service_owner" as const, label: "Owner" }] : []),
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
        { key: "orders_required_fields" as const, label: "Povinná pole u zakázky" },
        { key: "orders_tisk_dokumentu" as const, label: "Tisk dokumentů" },
        { key: "orders_reklamace" as const, label: "Reklamace" },
        { key: "orders_device_options" as const, label: "Stavy zařízení a příslušenství" },
        { key: "orders_handoff_options" as const, label: "Způsoby převzetí a předání" },
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
        { key: "appearance_shortcuts" as const, label: "Klávesové zkratky" },
      ],
    },
    {
      category: "profile" as const,
      label: "Můj profil",
      icon: (
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/>
          <circle cx="12" cy="7" r="4"/>
        </svg>
      ),
      subsections: [
        { key: "profile_me" as const, label: "Fotka a přezdívka" },
      ],
    },
    {
      category: "about" as const,
      label: "O aplikaci",
      icon: (
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="12" cy="12" r="10"/>
          <line x1="12" y1="16" x2="12" y2="12"/>
          <line x1="12" y1="8" x2="12.01" y2="8"/>
        </svg>
      ),
      subsections: [
        { key: "about_app" as const, label: "O aplikaci" },
        { key: "about_updates" as const, label: "Aktualizace" },
      ],
    },
  ], [isRootOwner, isAdmin, canManageDocuments]);

  // Member nemá přístup k Tým/Přístupy – při výběru servisu kde je member přesměruj z service_team
  useEffect(() => {
    if (section.subsection === "service_team" && !isAdmin) {
      setSection((prev) => ({ ...prev, subsection: "service_basic" }));
    }
  }, [section.subsection, isAdmin]);

  // Owner záložka jen pro root ownera – admin/member ji nevidí ani na ni nesmí zůstat (např. po přepnutí servisu)
  useEffect(() => {
    if (section.subsection === "service_owner" && !isRootOwner) {
      setSection((prev) => ({ ...prev, subsection: "service_basic" }));
    }
  }, [section.subsection, isRootOwner]);

  // Bez can_manage_documents skrýt Kontaktní údaje – při přepnutí role přesměruj
  useEffect(() => {
    if (!canManageDocuments && section.subsection === "service_contact") {
      setSection((prev) => ({ ...prev, subsection: "service_basic" }));
    }
  }, [section.subsection, canManageDocuments]);

  const activeCategory = categories.find((cat) => cat.category === section.category) || categories[0];

  return (
    <div data-tour="settings-content" style={{ display: "flex", flexDirection: "column", gap: 24 }}>
      <div>
        <div style={{ fontSize: 22, fontWeight: 950, color: "var(--text)" }}>Nastavení</div>
        <div style={{ fontSize: 13, color: "var(--muted)", marginTop: 4 }}>
          Konfigurace statusů, UI a filtrů aplikace
        </div>
      </div>

      {/* Main Navigation - Categories */}
      <div
        data-tour="settings-categories"
        style={{
        display: "flex",
        gap: 8,
        borderBottom: "2px solid var(--border)",
        paddingBottom: 0,
        overflow: "hidden",
        width: "100%",
      }}
      >
        {categories.map((cat) => {
          const isCategoryActive = section.category === cat.category;
          return (
            <button
              key={cat.category}
              data-tour={`settings-cat-${cat.category}`}
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
              <span style={{ position: "relative", display: "inline-flex", alignItems: "center" }}>
                {cat.label}
                {cat.category === "about" && updateAvailable && (
                  <span
                    style={{
                      position: "absolute",
                      top: -6,
                      right: -10,
                      minWidth: 18,
                      height: 18,
                      borderRadius: 9,
                      background: "#dc2626",
                      color: "white",
                      fontSize: 11,
                      fontWeight: 800,
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      padding: "0 4px",
                    }}
                  >
                    1
                  </span>
                )}
              </span>
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
                data-tour={`settings-sub-${sub.key}`}
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

              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
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

              <button
                onClick={async () => {
                  try {
                    await saveServiceSettings(companyData);
                  } catch (_err) {
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

              <button
                onClick={async () => {
                  try {
                    await saveServiceSettings(companyData);
                  } catch (_err) {
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

      {/* Owner – pouze pro root ownera; správa servisů (vytvoření, mazání, deaktivace). Admin vidí vše kromě této záložky a nemůže přidávat/mazat servisy. */}
      {section.subsection === "service_owner" && isRootOwner && refreshServices && (
        <OwnerSettings services={services} refreshServices={refreshServices} setActiveServiceId={setActiveServiceId} />
      )}

      {/* MŮJ PROFIL - FOTKA A PŘEZDÍVKA + PŘIDAT SERVIS POZVÁNKOU */}
      {section.subsection === "profile_me" && (
        <>
          <ProfileSettingsSection />
          <div style={{ marginTop: 24 }}>
            <Card>
              <div style={{ fontWeight: 950, fontSize: 14, marginBottom: 12, color: "var(--text)" }}>Přidat servis pomocí pozvánky</div>
              <div style={{ fontSize: 13, color: "var(--muted)", marginBottom: 16 }}>
                Máš kód z e-mailu pozvánky do dalšího servisu? Zadej ho a přidáš se bez odhlášení.
              </div>
              <div style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "flex-end" }}>
                <div style={{ flex: "1 1 200px", minWidth: 0 }}>
                  <FieldLabel>Kód z e-mailu</FieldLabel>
                  <TextInput
                    type="text"
                    value={inviteCodeInput}
                    onChange={(e: ChangeEvent<HTMLInputElement>) => setInviteCodeInput(e.target.value)}
                    placeholder="Vlož kód z pozvánky"
                    disabled={inviteAcceptLoading}
                    style={{ width: "100%" }}
                  />
                </div>
                <button
                  type="button"
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
                      showToast(err instanceof Error ? err.message : "Neznámá chyba", "error");
                    } finally {
                      setInviteAcceptLoading(false);
                    }
                  }}
                  style={{
                    padding: "10px 20px",
                    borderRadius: 10,
                    border: "none",
                    background: "var(--accent)",
                    color: "var(--accent-text)",
                    fontWeight: 600,
                    fontSize: 14,
                    cursor: inviteCodeInput.trim() && !inviteAcceptLoading ? "pointer" : "not-allowed",
                    opacity: inviteCodeInput.trim() && !inviteAcceptLoading ? 1 : 0.6,
                  }}
                >
                  {inviteAcceptLoading ? "Přidávám…" : "Přidat servis"}
                </button>
              </div>
            </Card>
          </div>
        </>
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
                const themePreviews: Record<string, { title: string; desc: string; bg: string; panel: string; accent: string; text: string; lineStyle?: boolean; previewLineColors?: string[] }> = {
                  light: { title: "Světlé", desc: "Světlé téma s modrým akcentem.", bg: "linear-gradient(135deg, #f6f7f9 0%, #eef0f4 100%)", panel: "rgba(255, 255, 255, 0.92)", accent: "#2563eb", text: "#111827" },
                  dark: { title: "Tmavé", desc: "Tmavé téma s modrým akcentem.", bg: "linear-gradient(135deg, #0a0c10 0%, #141720 100%)", panel: "rgba(30, 32, 40, 0.85)", accent: "#60a5fa", text: "#f3f4f6" },
                  blue: { title: "Modré", desc: "Tmavé téma s modrým akcentem.", bg: "linear-gradient(135deg, #0a1628 0%, #0f1e3a 100%)", panel: "rgba(14, 116, 184, 0.4)", accent: "#0ea5e9", text: "#e0f2fe" },
                  green: { title: "Zelené", desc: "Tmavé téma se zeleným akcentem.", bg: "linear-gradient(135deg, #0a1f0e 0%, #0f2a14 100%)", panel: "rgba(34, 197, 94, 0.4)", accent: "#22c55e", text: "#dcfce7" },
                  orange: { title: "Oranžové", desc: "Tmavé téma s oranžovým akcentem.", bg: "linear-gradient(135deg, #2a1a0a 0%, #3a2410 100%)", panel: "rgba(249, 115, 22, 0.4)", accent: "#f97316", text: "#fff7ed" },
                  purple: { title: "Fialové", desc: "Tmavé téma s fialovým akcentem.", bg: "linear-gradient(135deg, #1a0f2a 0%, #251438 100%)", panel: "rgba(139, 92, 246, 0.4)", accent: "#8b5cf6", text: "#faf5ff" },
                  pink: { title: "Růžové", desc: "Tmavé téma s růžovým akcentem.", bg: "linear-gradient(135deg, #2a0f1a 0%, #381420 100%)", panel: "rgba(236, 72, 153, 0.4)", accent: "#ec4899", text: "#fdf2f8" },
                  "light-blue": { title: "Světle modré", desc: "Světlé téma s modrým akcentem.", bg: "linear-gradient(135deg, #e0f2fe 0%, #bae6fd 100%)", panel: "rgba(255, 255, 255, 0.85)", accent: "#0ea5e9", text: "#0c4a6e" },
                  "light-green": { title: "Světle zelené", desc: "Světlé téma se zeleným akcentem.", bg: "linear-gradient(135deg, #dcfce7 0%, #bbf7d0 100%)", panel: "rgba(255, 255, 255, 0.85)", accent: "#22c55e", text: "#14532d" },
                  "light-orange": { title: "Světle oranžové", desc: "Světlé téma s oranžovým akcentem.", bg: "linear-gradient(135deg, #fff7ed 0%, #ffedd5 100%)", panel: "rgba(255, 255, 255, 0.85)", accent: "#f97316", text: "#7c2d12" },
                  "light-purple": { title: "Světle fialové", desc: "Světlé téma s fialovým akcentem.", bg: "linear-gradient(135deg, #faf5ff 0%, #f3e8ff 100%)", panel: "rgba(255, 255, 255, 0.85)", accent: "#8b5cf6", text: "#4c1d95" },
                  "light-pink": { title: "Světle růžové", desc: "Světlé téma s růžovým akcentem.", bg: "linear-gradient(135deg, #fdf2f8 0%, #fce7f3 100%)", panel: "rgba(255, 255, 255, 0.85)", accent: "#ec4899", text: "#831843" },
                  "paper-mint": { title: "Paper Mint", desc: "Světlé téma s mátovým akcentem. Čistý papírový dojem.", bg: "#F7FBFA", panel: "#FFFFFF", accent: "#14B8A6", text: "#0F172A" },
                  "sand-ink": { title: "Sand & Ink", desc: "Světlé téma s jantarovým akcentem. Teplé písečné tóny.", bg: "#FBF7F1", panel: "#FFFFFF", accent: "#F59E0B", text: "#111827" },
                  "sky-blueprint": { title: "Sky Blueprint", desc: "Světlé téma s modrým akcentem. Tech, blueprint styl.", bg: "#F5FAFF", panel: "#FFFFFF", accent: "#2563EB", text: "#0B1220" },
                  "lilac-frost": { title: "Lilac Frost", desc: "Světlé téma s fialovým akcentem. Jemně creative.", bg: "#FAF8FF", panel: "#FFFFFF", accent: "#7C3AED", text: "#111827" },
                  halloween: { title: "🎃 Halloween", desc: "Speciální téma. Oranžovo-fialové, halloween.", bg: "linear-gradient(135deg, #0a0505 0%, #1a0f0f 100%)", panel: "rgba(124, 58, 237, 0.35)", accent: "#f97316", text: "#fef3c7" },
                  christmas: { title: "🎄 Vánoce", desc: "Speciální téma. Zelené a zlaté, vánoční.", bg: "linear-gradient(135deg, #0d1b1f 0%, #1a2e35 100%)", panel: "rgba(34, 197, 94, 0.35)", accent: "#22c55e", text: "#f0fdf4" },
                  "tron-red": { title: "Tron Red", desc: "Tmavé téma. Tenké červené neonové linie.", bg: "linear-gradient(135deg, #040405 0%, #0a0809 100%)", panel: "rgba(18, 18, 20, 0.95)", accent: "#DD2200", text: "#e5e5e5", lineStyle: true },
                  "tron-cyan": { title: "Tron Cyan", desc: "Tmavé téma. Tenké cyan neonové linie.", bg: "linear-gradient(135deg, #040506 0%, #070b0e 100%)", panel: "rgba(14, 18, 20, 0.95)", accent: "#04BFBF", text: "#e5e7eb", lineStyle: true },
                  synthwave: { title: "Synthwave Neon", desc: "Speciální téma. 80s outrun, magenta, cyan a fialová.", bg: "linear-gradient(135deg, #070812 0%, #0d0e1e 100%)", panel: "rgba(15, 16, 38, 0.95)", accent: "#FF2BD6", text: "#EDEBFF", lineStyle: true, previewLineColors: ["#FF2BD6", "#00E5FF", "#7C3AED"] },
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
                      {/* Preview karty – u Tron témat jako tenké linie */}
                      <div
                        style={{
                          width: "80%",
                          height: "60%",
                          background: info.panel,
                          backdropFilter: info.lineStyle ? "none" : "blur(20px)",
                          WebkitBackdropFilter: info.lineStyle ? "none" : "blur(20px)",
                          border: info.lineStyle ? `2px solid ${info.accent}` : `1px solid ${info.accent}40`,
                          borderRadius: 12,
                          boxShadow: info.lineStyle ? `0 0 12px ${info.accent}40` : `0 8px 24px ${info.accent}30`,
                          display: "flex",
                          flexDirection: "column",
                          padding: 12,
                          gap: 8,
                        }}
                      >
                        {info.lineStyle ? (
                          <>
                            {(info.previewLineColors ?? [info.accent, info.accent, info.accent]).map((lineColor, i) => (
                              <div
                                key={i}
                                style={{
                                  width: i === 0 ? "75%" : i === 1 ? "55%" : "45%",
                                  height: 2,
                                  background: lineColor,
                                  borderRadius: 1,
                                  boxShadow: `0 0 8px ${lineColor}`,
                                  opacity: 1 - i * 0.15,
                                }}
                              />
                            ))}
                          </>
                        ) : (
                          <>
                            <div style={{ width: "60%", height: 8, background: info.accent, borderRadius: 4 }} />
                            <div style={{ width: "40%", height: 6, background: `${info.accent}60`, borderRadius: 3 }} />
                          </>
                        )}
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

          <Card>
            <div style={{ fontWeight: 950, fontSize: 14, marginBottom: 12, color: "var(--text)" }}>Barvy loga Jobi</div>
            <div style={{ fontSize: 13, color: "var(--muted)", marginBottom: 16 }}>
              Ikona aplikace v Docku, Finderu atd.
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(140px, 1fr))", gap: 12 }}>
              <LogoPresetButton
                isActive={logoPreset === "auto"}
                label="Podle tématu"
                logoUrl={`/logos/${theme}.png`}
                fallbackColors={getLogoColors(theme, "auto")}
                onClick={() => setLogoPreset("auto")}
              />
              {LOGO_PRESETS.map((p) => (
                <LogoPresetButton
                  key={p.id}
                  isActive={logoPreset === p.id}
                  label={p.label}
                  logoUrl={`/logos/${p.id}.png`}
                  fallbackColors={{ background: p.background, jInner: p.jInner, foreground: p.foreground }}
                  onClick={() => setLogoPreset(p.id)}
                />
              ))}
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
                <div style={{ fontWeight: 700, fontSize: 13, color: "var(--text)" }}>Plovoucí tlačítko + „Nová zakázka"</div>
                <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 4 }}>
                  Zobrazit tlačítko + vpravo dole na všech stránkách. Pokud vypnete, zůstane jen tlačítko v záhlaví na stránce Zakázky.
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
            <div style={{ fontWeight: 950, fontSize: 14, marginBottom: 12, color: "var(--text)" }}>Zvuky</div>
            <div style={{ fontSize: 13, color: "var(--muted)", marginBottom: 12 }}>
              Krátké zvuky při založení zakázky, uložení změn a smazání.
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
                <div style={{ fontWeight: 700, fontSize: 13, color: "var(--text)" }}>Přehrávat zvuky při akcích</div>
                <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 4 }}>
                  Zapnout nebo vypnout zvukové odezvy
                </div>
              </div>
              <input
                type="checkbox"
                checked={soundsEnabled}
                onChange={(e) => {
                  const v = e.target.checked;
                  setSoundsEnabled(v);
                  setSoundsEnabledState(v);
                }}
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
                        <div style={{ fontSize: 10, fontWeight: 600, color: "var(--text)" }}>Zařízení</div>
                        <div style={{ fontSize: 9, color: "var(--muted)" }}>Zákazník</div>
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
                        <div style={{ fontSize: 9, fontWeight: 600, color: "var(--text)" }}>Zařízení</div>
                        <div style={{ fontSize: 8, color: "var(--muted)" }}>Zákazník</div>
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
                        <div style={{ fontWeight: 600, flex: 1 }}>Zařízení</div>
                        <div style={{ color: "var(--muted)", fontSize: 8 }}>Zákazník</div>
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
                { 
                  value: "compact-extra", 
                  label: "Kompaktní extra", 
                  description: "Nejvíce zakázek na obrazovku, jeden řádek na zakázku",
                  preview: (
                    <div style={{ display: "flex", flexDirection: "column", gap: 2, marginTop: 8 }}>
                      <div style={{ 
                        padding: "4px 8px", 
                        borderRadius: 4, 
                        border: "1px solid var(--border)", 
                        background: "var(--panel)",
                        display: "flex",
                        alignItems: "center",
                        gap: 6,
                        fontSize: 8,
                      }}>
                        <span style={{ fontWeight: 700, minWidth: 52 }}>#ORD-001</span>
                        <span style={{ color: "var(--muted)", minWidth: 36 }}>12.12.</span>
                        <span style={{ fontWeight: 600, flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>iPhone 15 Pro</span>
                        <span style={{ color: "var(--muted)" }}>J. Novák</span>
                      </div>
                      <div style={{ 
                        padding: "4px 8px", 
                        borderRadius: 4, 
                        border: "1px solid var(--border)", 
                        background: "var(--panel)",
                        display: "flex",
                        alignItems: "center",
                        gap: 6,
                        fontSize: 8,
                      }}>
                        <span style={{ fontWeight: 700, minWidth: 52 }}>#ORD-002</span>
                        <span style={{ color: "var(--muted)", minWidth: 36 }}>13.12.</span>
                        <span style={{ fontWeight: 600, flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>Samsung S23</span>
                        <span style={{ color: "var(--muted)" }}>M. Svobodová</span>
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
                        orders: { ...uiCfg.orders, displayMode: mode.value as "list" | "grid" | "compact" | "compact-extra" },
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
                            orders: { ...uiCfg.orders, displayMode: mode.value as "list" | "grid" | "compact" | "compact-extra" },
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

      {/* VZHLED - KLAVESOVÉ ZKRATKY */}
      {section.subsection === "appearance_shortcuts" && (
        <ShortcutsSettingsSection />
      )}

      {section.subsection === "orders_device_options" && (
        <DeviceOptionsSettingsSection />
      )}
      {section.subsection === "orders_handoff_options" && (
        <HandoffOptionsSettingsSection />
      )}

      {section.subsection === "orders_filters" && (
        <>
          <Card>
            <div style={{ fontWeight: 950, fontSize: 14, marginBottom: 12, color: "var(--text)" }}>Stránkování</div>
            <div style={{ fontSize: 13, color: "var(--muted)", marginBottom: 12 }}>
              Počet zakázek na stránce v seznamu. „Vše“ zobrazí všechny zakázky bez stránkování.
            </div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
              {ORDERS_PAGE_SIZE_CHOICES.map(({ value, label }) => (
                <button
                  key={value}
                  type="button"
                  onClick={() => {
                    const newCfg = { ...uiCfg, orders: { ...uiCfg.orders, pageSize: value } };
                    setUiCfg(newCfg);
                    saveUIConfig(newCfg);
                  }}
                  style={{
                    padding: "8px 14px",
                    borderRadius: 8,
                    border: "1px solid var(--border)",
                    background: uiCfg.orders.pageSize === value ? "var(--accent-soft)" : "var(--panel)",
                    color: uiCfg.orders.pageSize === value ? "var(--accent)" : "var(--text)",
                    fontWeight: 600,
                    fontSize: 13,
                    cursor: "pointer",
                  }}
                >
                  {label}
                </button>
              ))}
            </div>
          </Card>
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

      {/* ZAKÁZKY - TISK DOKUMENTŮ */}
      {section.subsection === "orders_reklamace" && (
        <Card>
          <div style={{ fontWeight: 950, fontSize: 14, marginBottom: 8, color: "var(--text)" }}>Reklamace v seznamu</div>
          <div style={{ fontSize: 13, color: "var(--muted)", marginBottom: 12 }}>
            Zobrazit reklamace mezi zakázkami v záložkách „Vše“ a „Aktivní“. Reklamace budou výrazně odlišené od běžných zakázek.
          </div>
          <label style={{ display: "flex", alignItems: "center", gap: 10, cursor: "pointer", fontSize: 14 }}>
            <input
              type="checkbox"
              checked={ordersShowClaimsInList}
              onChange={(e) => saveOrdersShowClaimsInList(e.target.checked)}
            />
            Zobrazit reklamace v záložkách Vše a Aktivní
          </label>
        </Card>
      )}

      {section.subsection === "orders_required_fields" && (
        <Card>
          <div style={{ fontWeight: 950, fontSize: 14, marginBottom: 12, color: "var(--text)" }}>Povinná pole u zakázky</div>
          <div style={{ fontSize: 13, color: "var(--muted)", marginBottom: 12 }}>
            U nové zakázky a při úpravě: která pole musí uživatel vyplnit.
          </div>
          <label
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              padding: 12,
              borderRadius: 10,
              border: "1px solid var(--border)",
              background: "var(--panel)",
              cursor: "pointer",
            }}
          >
            <div>
              <div style={{ fontWeight: 700, fontSize: 13, color: "var(--text)" }}>Telefon zákazníka povinný</div>
              <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 4 }}>
                Pokud vypnete, lze zakázku uložit i bez telefonu (pole zůstane volitelné).
              </div>
            </div>
            <input
              type="checkbox"
              checked={uiCfg.orders.customerPhoneRequired}
              onChange={(e) => setUiCfg((p) => ({ ...p, orders: { ...p.orders, customerPhoneRequired: e.target.checked } }))}
            />
          </label>
        </Card>
      )}

      {section.subsection === "orders_tisk_dokumentu" && (
        <>
          <Card>
            <div style={{ fontWeight: 950, fontSize: 14, marginBottom: 8, color: "var(--text)" }}>Automatický tisk</div>
            <div style={{ fontSize: 13, color: "var(--muted)", marginBottom: 16 }}>
              Zvolte, kdy se má automaticky otevřít dialog tisku při vytvoření zakázky/reklamace nebo při změně stavu.
            </div>
            {autoPrintFormLoading ? (
              <div style={{ padding: 24, textAlign: "center", color: "var(--muted)" }}>Načítání…</div>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
                {autoPrintFormSaveSuccess && (
                  <div style={{ padding: 10, background: "rgba(34,197,94,0.1)", border: "1px solid rgba(34,197,94,0.3)", borderRadius: 10, color: "var(--text)", fontSize: 13 }}>Nastavení uloženo.</div>
                )}
                <div>
                  <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 8 }}>Zakázkový list</div>
                  <label style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer", fontSize: 13, marginBottom: 6 }}>
                    <input type="checkbox" checked={autoPrintForm.ticketListOnCreate} onChange={async () => { const next = !autoPrintForm.ticketListOnCreate; setAutoPrintForm((p) => ({ ...p, ticketListOnCreate: next })); const ok = await saveDocumentsConfigAutoPrint(activeServiceId, { ...autoPrintForm, ticketListOnCreate: next }); if (ok) { setAutoPrintFormSaveSuccess(true); setTimeout(() => setAutoPrintFormSaveSuccess(false), 2000); } }} />
                    Tisknout při vytvoření zakázky
                  </label>
                  <div style={{ fontSize: 12, color: "var(--muted)", marginBottom: 4 }}>Tisknout při přepnutí do stavu</div>
                  <select value={autoPrintForm.ticketListOnStatusKey ?? ""} onChange={async (e) => { const v = e.target.value || null; setAutoPrintForm((p) => ({ ...p, ticketListOnStatusKey: v })); const ok = await saveDocumentsConfigAutoPrint(activeServiceId, { ...autoPrintForm, ticketListOnStatusKey: v }); if (ok) { setAutoPrintFormSaveSuccess(true); setTimeout(() => setAutoPrintFormSaveSuccess(false), 2000); } }} style={{ width: "100%", maxWidth: 280, padding: "8px 12px", borderRadius: 8, border: "1px solid var(--border)", background: "var(--panel)", color: "var(--text)", fontSize: 13 }}>
                    <option value="">— žádný —</option>
                    {statuses.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
                  </select>
                </div>
                <div>
                  <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 8 }}>Záruční list</div>
                  <label style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer", fontSize: 13, marginBottom: 6 }}>
                    <input type="checkbox" checked={autoPrintForm.warrantyOnCreate} onChange={async () => { const next = !autoPrintForm.warrantyOnCreate; setAutoPrintForm((p) => ({ ...p, warrantyOnCreate: next })); const ok = await saveDocumentsConfigAutoPrint(activeServiceId, { ...autoPrintForm, warrantyOnCreate: next }); if (ok) { setAutoPrintFormSaveSuccess(true); setTimeout(() => setAutoPrintFormSaveSuccess(false), 2000); } }} />
                    Tisknout při vytvoření zakázky
                  </label>
                  <div style={{ fontSize: 12, color: "var(--muted)", marginBottom: 4 }}>Tisknout při přepnutí do stavu</div>
                  <select value={autoPrintForm.warrantyOnStatusKey ?? ""} onChange={async (e) => { const v = e.target.value || null; setAutoPrintForm((p) => ({ ...p, warrantyOnStatusKey: v })); const ok = await saveDocumentsConfigAutoPrint(activeServiceId, { ...autoPrintForm, warrantyOnStatusKey: v }); if (ok) { setAutoPrintFormSaveSuccess(true); setTimeout(() => setAutoPrintFormSaveSuccess(false), 2000); } }} style={{ width: "100%", maxWidth: 280, padding: "8px 12px", borderRadius: 8, border: "1px solid var(--border)", background: "var(--panel)", color: "var(--text)", fontSize: 13 }}>
                    <option value="">— žádný —</option>
                    {statuses.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
                  </select>
                </div>
                <div>
                  <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 8 }}>Přijetí reklamace</div>
                  <label style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer", fontSize: 13, marginBottom: 6 }}>
                    <input type="checkbox" checked={autoPrintForm.prijetiReklamaceOnCreate} onChange={async () => { const next = !autoPrintForm.prijetiReklamaceOnCreate; setAutoPrintForm((p) => ({ ...p, prijetiReklamaceOnCreate: next })); const ok = await saveDocumentsConfigAutoPrint(activeServiceId, { ...autoPrintForm, prijetiReklamaceOnCreate: next }); if (ok) { setAutoPrintFormSaveSuccess(true); setTimeout(() => setAutoPrintFormSaveSuccess(false), 2000); } }} />
                    Tisknout při vytvoření reklamace
                  </label>
                  <div style={{ fontSize: 12, color: "var(--muted)", marginBottom: 4 }}>Tisknout při přepnutí do stavu</div>
                  <select value={autoPrintForm.prijetiReklamaceOnStatusKey ?? ""} onChange={async (e) => { const v = e.target.value || null; setAutoPrintForm((p) => ({ ...p, prijetiReklamaceOnStatusKey: v })); const ok = await saveDocumentsConfigAutoPrint(activeServiceId, { ...autoPrintForm, prijetiReklamaceOnStatusKey: v }); if (ok) { setAutoPrintFormSaveSuccess(true); setTimeout(() => setAutoPrintFormSaveSuccess(false), 2000); } }} style={{ width: "100%", maxWidth: 280, padding: "8px 12px", borderRadius: 8, border: "1px solid var(--border)", background: "var(--panel)", color: "var(--text)", fontSize: 13 }}>
                    <option value="">— žádný —</option>
                    {statuses.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
                  </select>
                </div>
                <div>
                  <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 8 }}>Vydání reklamace</div>
                  <div style={{ fontSize: 12, color: "var(--muted)", marginBottom: 4 }}>Tisknout při přepnutí do stavu</div>
                  <select value={autoPrintForm.vydaniReklamaceOnStatusKey ?? ""} onChange={async (e) => { const v = e.target.value || null; setAutoPrintForm((p) => ({ ...p, vydaniReklamaceOnStatusKey: v })); const ok = await saveDocumentsConfigAutoPrint(activeServiceId, { ...autoPrintForm, vydaniReklamaceOnStatusKey: v }); if (ok) { setAutoPrintFormSaveSuccess(true); setTimeout(() => setAutoPrintFormSaveSuccess(false), 2000); } }} style={{ width: "100%", maxWidth: 280, padding: "8px 12px", borderRadius: 8, border: "1px solid var(--border)", background: "var(--panel)", color: "var(--text)", fontSize: 13 }}>
                    <option value="">— žádný —</option>
                    {statuses.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
                  </select>
                </div>
              </div>
            )}
          </Card>
        </>
      )}

      {/* ZAKÁZKY - SMAZANÉ */}
      {section.subsection === "orders_deleted" && (
        <DeletedTicketsSettings activeServiceId={activeServiceId} />
      )}

      {/* O APLIKACI */}
      {section.subsection === "about_app" && (
        <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
          <Card>
            <div style={{ display: "flex", alignItems: "center", gap: 16, flexWrap: "wrap" }}>
              <div style={{ width: 64, height: 64, flexShrink: 0 }}>
                <AppLogo size={64} />
              </div>
              <div>
                <div style={{ fontWeight: 950, fontSize: 18, marginBottom: 4, color: "var(--text)" }}>Jobi</div>
                <div style={{ fontSize: 13, color: "var(--muted)" }}>
                  Evidence zakázek a zákazníků pro servisy. Tisk a export dokumentů přes JobiDocs.
                </div>
              </div>
            </div>
          </Card>
          {onStartTour && (
            <Card>
              <div style={{ fontWeight: 950, fontSize: 14, marginBottom: 8, color: "var(--text)" }}>Průvodce aplikací</div>
              <div style={{ fontSize: 13, color: "var(--muted)", marginBottom: 16 }}>
                Spusťte průvodce – provede vás krok za krokem po celé aplikaci a u každé části ukáže, co a jak funguje.
              </div>
              <button
                type="button"
                onClick={onStartTour}
                style={{
                  padding: "10px 20px",
                  background: "var(--accent)",
                  color: "white",
                  border: "none",
                  borderRadius: "var(--radius-md)",
                  cursor: "pointer",
                  fontWeight: 600,
                  fontSize: 14,
                }}
              >
                Spustit průvodce
              </button>
            </Card>
          )}
          <Card>
            <div style={{ fontWeight: 950, fontSize: 14, marginBottom: 12, color: "var(--text)" }}>Pro podporu</div>
            <div style={{ fontSize: 13, color: "var(--muted)", marginBottom: 12 }}>
              Tyto údaje můžete poskytnout při řešení problému (kliknutím zkopírujete).
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 8, fontFamily: "ui-monospace, monospace", fontSize: 12 }}>
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
            </div>
          </Card>
        </div>
      )}

      {/* AKTUALIZACE (samostatná subsekce) */}
      {section.subsection === "about_updates" && (
        <Card>
          <div style={{ fontWeight: 950, fontSize: 14, marginBottom: 12, color: "var(--text)" }}>Aktualizace</div>
          {typeof window !== "undefined" && !!(window as any).__TAURI_INTERNALS__ ? (
            <AppUpdateCard />
          ) : (
            <div style={{ fontSize: 13, color: "var(--muted)" }}>Aktualizace jsou dostupné pouze v desktopové aplikaci.</div>
          )}
        </Card>
      )}
    </div>
  );
}

function AppUpdateCard() {
  const update = useAppUpdate();
  if (!update) return null;

  const { update: updateInfo, downloadProgress, downloaded, checking, downloading, error, checkForUpdate, downloadAndInstall, relaunch } = update;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      {!updateInfo && !checking && (
        <div style={{ fontSize: 13, color: "var(--muted)" }}>
          Aktuálně nemáte k dispozici žádnou novou verzi. Kontrola probíhá automaticky.
        </div>
      )}
      {checking && <div style={{ fontSize: 13, color: "var(--muted)" }}>Kontroluji aktualizace…</div>}
      {error && <div style={{ fontSize: 13, color: "#dc2626" }}>Chyba: {error}</div>}
      {updateInfo && !downloaded && (
        <>
          <div style={{ fontSize: 13, color: "var(--text)" }}>
            K dispozici je nová verze <strong>{updateInfo.version}</strong>
            {updateInfo.body && <div style={{ marginTop: 8, color: "var(--muted)", whiteSpace: "pre-wrap" }}>{updateInfo.body}</div>}
          </div>
          {!downloading ? (
            <button
              type="button"
              onClick={downloadAndInstall}
              disabled={downloading}
              style={{
                padding: "10px 20px",
                background: "var(--accent)",
                color: "white",
                border: "none",
                borderRadius: "var(--radius-md)",
                cursor: "pointer",
                fontWeight: 600,
                fontSize: 14,
                alignSelf: "flex-start",
              }}
            >
              Nainstalovat
            </button>
          ) : (
            <>
              <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                <div
                  style={{
                    flex: 1,
                    height: 8,
                    background: "var(--panel-2)",
                    borderRadius: 4,
                    overflow: "hidden",
                  }}
                >
                  <div
                    style={{
                      width: `${downloadProgress}%`,
                      height: "100%",
                      background: "var(--accent)",
                      borderRadius: 4,
                      transition: "width 0.2s ease",
                    }}
                  />
                </div>
                <span style={{ fontSize: 12, color: "var(--muted)", minWidth: 36 }}>{downloadProgress}%</span>
              </div>
              <div style={{ fontSize: 13, color: "var(--muted)" }}>Stahuji…</div>
            </>
          )}
        </>
      )}
      {downloaded && (
        <button
          type="button"
          onClick={relaunch}
          style={{
            padding: "10px 20px",
            background: "var(--accent)",
            color: "white",
            border: "none",
            borderRadius: "var(--radius-md)",
            cursor: "pointer",
            fontWeight: 600,
            fontSize: 14,
            alignSelf: "flex-start",
          }}
        >
          Restartovat a nainstalovat
        </button>
      )}
      <button
        type="button"
        onClick={checkForUpdate}
        disabled={checking}
        style={{
          padding: "8px 14px",
          background: "var(--panel-2)",
          color: "var(--text)",
          border: "1px solid var(--border)",
          borderRadius: "var(--radius-md)",
          cursor: checking ? "not-allowed" : "pointer",
          fontSize: 12,
          alignSelf: "flex-start",
        }}
      >
        {checking ? "Kontroluji…" : "Zkontrolovat aktualizace"}
      </button>
    </div>
  );
}

// Service Picker Component (similar to LanguagePicker) – reserved for future use
export function ServicePicker({ 
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

// Role Picker Component – reserved for future use
export function RolePicker({ 
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


