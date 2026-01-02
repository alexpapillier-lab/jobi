import { useMemo, useState, useEffect, useRef, useLayoutEffect, useCallback } from "react";
import { createPortal } from "react-dom";
import { useStatuses, type StatusMeta } from "../state/StatusesStore";
import { useTheme } from "../theme/ThemeProvider";
import { STATUS_COLOR_PALETTE, getContrastText } from "../utils/statusColors";
import { showToast } from "../components/Toast";
import { supabase } from "../lib/supabaseClient";
import { useAuth } from "../auth/AuthProvider";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { generateTicketHTML, generateDiagnosticProtocolHTML, generateWarrantyHTML, safeLoadCompanyData, type TicketEx } from "./Orders";
import { useActiveRole } from "../hooks/useActiveRole";

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

import { STORAGE_KEYS } from "../constants/storageKeys";

type DocumentDesign = "classic" | "modern" | "minimal" | "professional";

type DocumentsConfig = {
  // Shared design settings
  logoUrl?: string; // Base64 or URL
  stampUrl?: string; // Base64 or URL for stamp/signature
  reviewUrl?: string; // URL for service review (QR code will be generated)
  reviewUrlType?: "custom" | "google"; // Type of review URL: custom link or Google Place ID
  googlePlaceId?: string; // Google Place ID for review link
  reviewText?: string; // Text displayed with QR code (default: "Budeme rádi za Vaši recenzi")
  colorMode?: "color" | "bw"; // Color or black & white printing
  logoSize?: number; // Logo size in percentage (default: 100)
  stampSize?: number; // Stamp/signature size in percentage (default: 100)
  qrCodeSize?: number; // QR code size in pixels (default: 120)
  
  // Service info configuration
  serviceInfoConfig?: {
    // Základní údaje
    abbreviation?: boolean;
    name?: boolean;
    ico?: boolean;
    dic?: boolean;
    addressStreet?: boolean;
    addressCity?: boolean;
    addressZip?: boolean;
    // Kontaktní údaje
    phone?: boolean;
    email?: boolean;
    website?: boolean;
  };
  
  // Device info configuration
  deviceInfoConfig?: {
    deviceLabel?: boolean; // Zařízení
    serialOrImei?: boolean; // SN/IMEI
    devicePasscode?: boolean; // Heslo/kód - zda zobrazit
    devicePasscodeVisible?: boolean; // Heslo/kód - zda zobrazit jako text nebo skrýt (křížky)
    deviceCondition?: boolean; // Popis stavu
    requestedRepair?: boolean; // Požadovaná oprava/Problém
    deviceNote?: boolean; // Poznámka
    handoffMethod?: boolean; // Předání/převzetí
    externalId?: boolean; // Externí ID
  };
  
  // Document-specific settings
  ticketList: {
    includeServiceInfo: boolean;
    includeCustomerInfo: boolean;
    includeDeviceInfo: boolean;
    includeRepairs: boolean;
    includeDiagnostic: boolean;
    includePhotos: boolean;
    includeDates: boolean;
    includeStamp: boolean; // Include stamp/signature for ticket list
    design: DocumentDesign;
    legalText: string; // Legal text for ticket list
  };
  diagnosticProtocol: {
    includeServiceInfo: boolean;
    includeCustomerInfo: boolean;
    includeDeviceInfo: boolean;
    includeDiagnosticText: boolean;
    includePhotos: boolean;
    includeDates: boolean;
    design: DocumentDesign;
    legalText: string; // Legal text for diagnostic protocol
  };
  warrantyCertificate: {
    includeServiceInfo: boolean;
    includeCustomerInfo: boolean;
    includeDeviceInfo: boolean;
    includeRepairs: boolean;
    includeDates: boolean;
    includeWarranty: boolean; // Include warranty section
    warrantyType: "unified" | "separate"; // Unified warranty or separate warranties
    warrantyUnifiedDuration?: number; // Duration for unified warranty
    warrantyUnifiedUnit?: "days" | "months" | "years"; // Unit for unified warranty
    warrantyItems?: Array<{ name: string; duration: number; unit: "days" | "months" | "years" }>; // Separate warranty items
    design: DocumentDesign;
    legalText: string; // Legal text for warranty certificate
  };
};

function defaultDocumentsConfig(): DocumentsConfig {
  return {
    logoUrl: undefined,
    stampUrl: undefined,
    reviewUrl: undefined,
    reviewUrlType: "custom",
    googlePlaceId: undefined,
    reviewText: "Budeme rádi za Vaši recenzi",
    colorMode: "color",
    logoSize: 100,
    stampSize: 100,
    qrCodeSize: 120,
    serviceInfoConfig: {
      abbreviation: true,
      name: true,
      ico: true,
      dic: true,
      addressStreet: true,
      addressCity: true,
      addressZip: true,
      phone: true,
      email: true,
      website: true,
    },
    deviceInfoConfig: {
      deviceLabel: true,
      serialOrImei: true,
      devicePasscode: true,
      devicePasscodeVisible: false, // Defaultně skrýt heslo (křížky)
      deviceCondition: true,
      requestedRepair: true,
      deviceNote: true,
      handoffMethod: true,
      externalId: true,
    },
    ticketList: {
      includeServiceInfo: true,
      includeCustomerInfo: true,
      includeDeviceInfo: true,
      includeRepairs: true,
      includeDiagnostic: false,
      includePhotos: false,
      includeDates: true,
      includeStamp: false,
      design: "classic",
      legalText: "Tento dokument slouží jako potvrzení o přijetí zařízení do servisu. Zákazník potvrzuje, že zařízení bylo předáno v uvedeném stavu.",
    },
    diagnosticProtocol: {
      includeServiceInfo: true,
      includeCustomerInfo: true,
      includeDeviceInfo: true,
      includeDiagnosticText: true,
      includePhotos: true,
      includeDates: true,
      design: "classic",
      legalText: "Tento diagnostický protokol obsahuje výsledky diagnostiky zařízení. Zákazník byl seznámen s výsledky diagnostiky.",
    },
    warrantyCertificate: {
      includeServiceInfo: true,
      includeCustomerInfo: true,
      includeDeviceInfo: true,
      includeRepairs: true,
      includeDates: true,
      includeWarranty: false,
      warrantyType: "unified",
      warrantyUnifiedDuration: 12,
      warrantyUnifiedUnit: "months",
      warrantyItems: [
        { name: "Díly", duration: 24, unit: "months" },
        { name: "Práce", duration: 12, unit: "months" },
      ],
      design: "classic",
      legalText: "Tento záruční list potvrzuje provedené opravy a poskytuje záruku na opravu po dobu 12 měsíců od data opravy.",
    },
  };
}

function safeLoadDocumentsConfig(): DocumentsConfig {
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.DOCUMENTS_CONFIG);
    if (!raw) return defaultDocumentsConfig();
    const parsed = JSON.parse(raw);
    const d = defaultDocumentsConfig();
    return {
      logoUrl: parsed?.logoUrl || d.logoUrl,
      stampUrl: parsed?.stampUrl || d.stampUrl,
      reviewUrl: parsed?.reviewUrl || d.reviewUrl,
      reviewUrlType: parsed?.reviewUrlType || d.reviewUrlType,
      googlePlaceId: parsed?.googlePlaceId || d.googlePlaceId,
      reviewText: parsed?.reviewText || d.reviewText,
      colorMode: parsed?.colorMode || d.colorMode,
      logoSize: typeof parsed?.logoSize === "number" ? parsed.logoSize : d.logoSize,
      stampSize: typeof parsed?.stampSize === "number" ? parsed.stampSize : d.stampSize,
      qrCodeSize: typeof parsed?.qrCodeSize === "number" ? parsed.qrCodeSize : d.qrCodeSize,
      serviceInfoConfig: parsed?.serviceInfoConfig || d.serviceInfoConfig,
      deviceInfoConfig: parsed?.deviceInfoConfig || d.deviceInfoConfig,
      ticketList: {
        includeServiceInfo: typeof parsed?.ticketList?.includeServiceInfo === "boolean" ? parsed.ticketList.includeServiceInfo : d.ticketList.includeServiceInfo,
        includeCustomerInfo: typeof parsed?.ticketList?.includeCustomerInfo === "boolean" ? parsed.ticketList.includeCustomerInfo : d.ticketList.includeCustomerInfo,
        includeDeviceInfo: typeof parsed?.ticketList?.includeDeviceInfo === "boolean" ? parsed.ticketList.includeDeviceInfo : d.ticketList.includeDeviceInfo,
        includeRepairs: typeof parsed?.ticketList?.includeRepairs === "boolean" ? parsed.ticketList.includeRepairs : d.ticketList.includeRepairs,
        includeDiagnostic: typeof parsed?.ticketList?.includeDiagnostic === "boolean" ? parsed.ticketList.includeDiagnostic : d.ticketList.includeDiagnostic,
        includePhotos: typeof parsed?.ticketList?.includePhotos === "boolean" ? parsed.ticketList.includePhotos : d.ticketList.includePhotos,
        includeDates: typeof parsed?.ticketList?.includeDates === "boolean" ? parsed.ticketList.includeDates : d.ticketList.includeDates,
        includeStamp: typeof parsed?.ticketList?.includeStamp === "boolean" ? parsed.ticketList.includeStamp : (d.ticketList.includeStamp ?? false),
        design: parsed?.ticketList?.design || d.ticketList.design,
        legalText: parsed?.ticketList?.legalText || d.ticketList.legalText,
      },
      diagnosticProtocol: {
        includeServiceInfo: typeof parsed?.diagnosticProtocol?.includeServiceInfo === "boolean" ? parsed.diagnosticProtocol.includeServiceInfo : d.diagnosticProtocol.includeServiceInfo,
        includeCustomerInfo: typeof parsed?.diagnosticProtocol?.includeCustomerInfo === "boolean" ? parsed.diagnosticProtocol.includeCustomerInfo : d.diagnosticProtocol.includeCustomerInfo,
        includeDeviceInfo: typeof parsed?.diagnosticProtocol?.includeDeviceInfo === "boolean" ? parsed.diagnosticProtocol.includeDeviceInfo : d.diagnosticProtocol.includeDeviceInfo,
        includeDiagnosticText: typeof parsed?.diagnosticProtocol?.includeDiagnosticText === "boolean" ? parsed.diagnosticProtocol.includeDiagnosticText : d.diagnosticProtocol.includeDiagnosticText,
        includePhotos: typeof parsed?.diagnosticProtocol?.includePhotos === "boolean" ? parsed.diagnosticProtocol.includePhotos : d.diagnosticProtocol.includePhotos,
        includeDates: typeof parsed?.diagnosticProtocol?.includeDates === "boolean" ? parsed.diagnosticProtocol.includeDates : d.diagnosticProtocol.includeDates,
        design: parsed?.diagnosticProtocol?.design || d.diagnosticProtocol.design,
        legalText: parsed?.diagnosticProtocol?.legalText || d.diagnosticProtocol.legalText,
      },
      warrantyCertificate: {
        includeServiceInfo: typeof parsed?.warrantyCertificate?.includeServiceInfo === "boolean" ? parsed.warrantyCertificate.includeServiceInfo : d.warrantyCertificate.includeServiceInfo,
        includeCustomerInfo: typeof parsed?.warrantyCertificate?.includeCustomerInfo === "boolean" ? parsed.warrantyCertificate.includeCustomerInfo : d.warrantyCertificate.includeCustomerInfo,
        includeDeviceInfo: typeof parsed?.warrantyCertificate?.includeDeviceInfo === "boolean" ? parsed.warrantyCertificate.includeDeviceInfo : d.warrantyCertificate.includeDeviceInfo,
        includeRepairs: typeof parsed?.warrantyCertificate?.includeRepairs === "boolean" ? parsed.warrantyCertificate.includeRepairs : d.warrantyCertificate.includeRepairs,
        includeDates: typeof parsed?.warrantyCertificate?.includeDates === "boolean" ? parsed.warrantyCertificate.includeDates : d.warrantyCertificate.includeDates,
        includeWarranty: typeof parsed?.warrantyCertificate?.includeWarranty === "boolean" ? parsed.warrantyCertificate.includeWarranty : d.warrantyCertificate.includeWarranty,
        warrantyType: parsed?.warrantyCertificate?.warrantyType || d.warrantyCertificate.warrantyType,
        warrantyUnifiedDuration: parsed?.warrantyCertificate?.warrantyUnifiedDuration ?? d.warrantyCertificate.warrantyUnifiedDuration,
        warrantyUnifiedUnit: parsed?.warrantyCertificate?.warrantyUnifiedUnit || d.warrantyCertificate.warrantyUnifiedUnit,
        warrantyItems: parsed?.warrantyCertificate?.warrantyItems || d.warrantyCertificate.warrantyItems,
        design: parsed?.warrantyCertificate?.design || d.warrantyCertificate.design,
        legalText: parsed?.warrantyCertificate?.legalText || d.warrantyCertificate.legalText,
      },
    };
  } catch {
    return defaultDocumentsConfig();
  }
}

function saveDocumentsConfig(config: DocumentsConfig) {
  localStorage.setItem(STORAGE_KEYS.DOCUMENTS_CONFIG, JSON.stringify(config));
}

// Helper function to save documents config to both localStorage and DB
// Returns: { success: boolean, conflict: boolean } for conflict handling
async function saveDocumentsConfigWithDB(
  serviceId: string | null, 
  config: DocumentsConfig,
  expectedVersion: number | null = null
): Promise<{ success: boolean; conflict: boolean; newVersion?: number }> {
  // Save to localStorage immediately (for backward compatibility)
  saveDocumentsConfig(config);
  
  // Save to DB if serviceId is available
  if (serviceId) {
    return await saveDocumentsConfigToDB(serviceId, config, expectedVersion);
  }
  
  return { success: true, conflict: false };
}

// Load documents config from DB (similar to Orders.tsx)
// Returns both config and version for optimistic locking
async function loadDocumentsConfigFromDB(serviceId: string | null): Promise<{ config: DocumentsConfig; version: number } | null> {
  if (!supabase || !serviceId) return null;
  
  try {
    const { data, error } = await (supabase
      .from("service_document_settings") as any)
      .select("config, version")
      .eq("service_id", serviceId)
      .single();
    
    if (error) {
      // If not found, return null (will use default/localStorage)
      if (error.code === "PGRST116") {
    return null;
  }
      throw error;
    }
    
    if (!data?.config) return null;
    
    const version = typeof data.version === "number" ? data.version : 1;
    
    const parsed = data.config as any;
    const defaultConfig = defaultDocumentsConfig();
    
    return {
      config: {
        logoUrl: parsed?.logoUrl || defaultConfig.logoUrl,
        stampUrl: parsed?.stampUrl || defaultConfig.stampUrl,
        reviewUrl: parsed?.reviewUrl || defaultConfig.reviewUrl,
        reviewUrlType: parsed?.reviewUrlType || defaultConfig.reviewUrlType,
        googlePlaceId: parsed?.googlePlaceId || defaultConfig.googlePlaceId,
        reviewText: parsed?.reviewText || defaultConfig.reviewText,
        colorMode: parsed?.colorMode || defaultConfig.colorMode,
        logoSize: typeof parsed?.logoSize === "number" ? parsed.logoSize : defaultConfig.logoSize,
        stampSize: typeof parsed?.stampSize === "number" ? parsed.stampSize : defaultConfig.stampSize,
        qrCodeSize: typeof parsed?.qrCodeSize === "number" ? parsed.qrCodeSize : defaultConfig.qrCodeSize,
      ticketList: {
        includeServiceInfo: typeof parsed?.ticketList?.includeServiceInfo === "boolean" ? parsed.ticketList.includeServiceInfo : defaultConfig.ticketList.includeServiceInfo,
        includeCustomerInfo: typeof parsed?.ticketList?.includeCustomerInfo === "boolean" ? parsed.ticketList.includeCustomerInfo : defaultConfig.ticketList.includeCustomerInfo,
        includeDeviceInfo: typeof parsed?.ticketList?.includeDeviceInfo === "boolean" ? parsed.ticketList.includeDeviceInfo : defaultConfig.ticketList.includeDeviceInfo,
        includeRepairs: typeof parsed?.ticketList?.includeRepairs === "boolean" ? parsed.ticketList.includeRepairs : defaultConfig.ticketList.includeRepairs,
        includeDiagnostic: typeof parsed?.ticketList?.includeDiagnostic === "boolean" ? parsed.ticketList.includeDiagnostic : defaultConfig.ticketList.includeDiagnostic,
        includePhotos: typeof parsed?.ticketList?.includePhotos === "boolean" ? parsed.ticketList.includePhotos : defaultConfig.ticketList.includePhotos,
        includeDates: typeof parsed?.ticketList?.includeDates === "boolean" ? parsed.ticketList.includeDates : defaultConfig.ticketList.includeDates,
        includeStamp: typeof parsed?.ticketList?.includeStamp === "boolean" ? parsed.ticketList.includeStamp : (defaultConfig.ticketList.includeStamp ?? false),
        design: parsed?.ticketList?.design || defaultConfig.ticketList.design,
        legalText: parsed?.ticketList?.legalText || defaultConfig.ticketList.legalText,
      },
      diagnosticProtocol: {
        includeServiceInfo: typeof parsed?.diagnosticProtocol?.includeServiceInfo === "boolean" ? parsed.diagnosticProtocol.includeServiceInfo : defaultConfig.diagnosticProtocol.includeServiceInfo,
        includeCustomerInfo: typeof parsed?.diagnosticProtocol?.includeCustomerInfo === "boolean" ? parsed.diagnosticProtocol.includeCustomerInfo : defaultConfig.diagnosticProtocol.includeCustomerInfo,
        includeDeviceInfo: typeof parsed?.diagnosticProtocol?.includeDeviceInfo === "boolean" ? parsed.diagnosticProtocol.includeDeviceInfo : defaultConfig.diagnosticProtocol.includeDeviceInfo,
        includeDiagnosticText: typeof parsed?.diagnosticProtocol?.includeDiagnosticText === "boolean" ? parsed.diagnosticProtocol.includeDiagnosticText : defaultConfig.diagnosticProtocol.includeDiagnosticText,
        includePhotos: typeof parsed?.diagnosticProtocol?.includePhotos === "boolean" ? parsed.diagnosticProtocol.includePhotos : defaultConfig.diagnosticProtocol.includePhotos,
        includeDates: typeof parsed?.diagnosticProtocol?.includeDates === "boolean" ? parsed.diagnosticProtocol.includeDates : defaultConfig.diagnosticProtocol.includeDates,
        design: parsed?.diagnosticProtocol?.design || defaultConfig.diagnosticProtocol.design,
        legalText: parsed?.diagnosticProtocol?.legalText || defaultConfig.diagnosticProtocol.legalText,
      },
      warrantyCertificate: {
        includeServiceInfo: typeof parsed?.warrantyCertificate?.includeServiceInfo === "boolean" ? parsed.warrantyCertificate.includeServiceInfo : defaultConfig.warrantyCertificate.includeServiceInfo,
        includeCustomerInfo: typeof parsed?.warrantyCertificate?.includeCustomerInfo === "boolean" ? parsed.warrantyCertificate.includeCustomerInfo : defaultConfig.warrantyCertificate.includeCustomerInfo,
        includeDeviceInfo: typeof parsed?.warrantyCertificate?.includeDeviceInfo === "boolean" ? parsed.warrantyCertificate.includeDeviceInfo : defaultConfig.warrantyCertificate.includeDeviceInfo,
        includeRepairs: typeof parsed?.warrantyCertificate?.includeRepairs === "boolean" ? parsed.warrantyCertificate.includeRepairs : defaultConfig.warrantyCertificate.includeRepairs,
        includeDates: typeof parsed?.warrantyCertificate?.includeDates === "boolean" ? parsed.warrantyCertificate.includeDates : defaultConfig.warrantyCertificate.includeDates,
        includeWarranty: typeof parsed?.warrantyCertificate?.includeWarranty === "boolean" ? parsed.warrantyCertificate.includeWarranty : defaultConfig.warrantyCertificate.includeWarranty,
        warrantyType: parsed?.warrantyCertificate?.warrantyType || defaultConfig.warrantyCertificate.warrantyType,
        warrantyUnifiedDuration: parsed?.warrantyCertificate?.warrantyUnifiedDuration ?? defaultConfig.warrantyCertificate.warrantyUnifiedDuration,
        warrantyUnifiedUnit: parsed?.warrantyCertificate?.warrantyUnifiedUnit || defaultConfig.warrantyCertificate.warrantyUnifiedUnit,
        warrantyItems: parsed?.warrantyCertificate?.warrantyItems || defaultConfig.warrantyCertificate.warrantyItems,
        design: parsed?.warrantyCertificate?.design || defaultConfig.warrantyCertificate.design,
        legalText: parsed?.warrantyCertificate?.legalText || defaultConfig.warrantyCertificate.legalText,
      },
      },
      version: version,
    };
  } catch (err) {
    console.error("[Settings] Error loading documents config from DB:", err);
    return null;
  }
}

// Save documents config to DB with optimistic locking
// Returns: { success: boolean, conflict: boolean, newVersion?: number }
// conflict = true means version mismatch (someone else updated) or unique constraint violation
async function saveDocumentsConfigToDB(
  serviceId: string | null, 
  config: DocumentsConfig, 
  expectedVersion: number | null
): Promise<{ success: boolean; conflict: boolean; newVersion?: number }> {
  if (!supabase || !serviceId) return { success: false, conflict: false };
  
  try {
    // If we have expectedVersion, use optimistic locking update
    if (expectedVersion !== null) {
      const { data, error } = await (supabase
        .from("service_document_settings") as any)
        .update({
          config: config,
        })
        .eq("service_id", serviceId)
        .eq("version", expectedVersion)
        .select("version")
        .single();
      
      if (error) {
        throw error;
      }
      
      // If no data returned, version mismatch = conflict
      if (!data) {
        return { success: false, conflict: true };
      }
      
      // Success - return new version
      const newVersion = data.version || expectedVersion + 1;
      saveDocumentsConfig(config);
      return { success: true, conflict: false, newVersion };
    }
    
    // No expectedVersion - try INSERT (first time save)
    try {
      const { data, error } = await (supabase
        .from("service_document_settings") as any)
        .insert({
          service_id: serviceId,
          config: config,
        })
        .select("version")
        .single();
      
      if (error) {
        // Check if it's a unique constraint violation (someone created it meanwhile)
        if (error.code === "23505" || error.message?.includes("duplicate") || error.message?.includes("unique")) {
          // Conflict - someone else created it, reload from DB
          return { success: false, conflict: true };
        }
        throw error;
      }

      // Sync to localStorage as fallback
      saveDocumentsConfig(config);
      
      const newVersion = data?.version || 1;
      return { success: true, conflict: false, newVersion };
    } catch (insertErr: any) {
      // If INSERT failed due to unique constraint, it's a conflict
      if (insertErr.code === "23505" || insertErr.message?.includes("duplicate") || insertErr.message?.includes("unique")) {
        return { success: false, conflict: true };
      }
      throw insertErr;
    }
  } catch (err) {
    console.error("[Settings] Error saving documents config to DB:", err);
    return { success: false, conflict: false };
  }
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

function saveCompanyData(data: CompanyData) {
  localStorage.setItem(STORAGE_KEYS.COMPANY, JSON.stringify(data));
}

function DocumentTypePicker({ value, onChange, disabled = false }: { value: "ticketList" | "diagnosticProtocol" | "warrantyCertificate"; onChange: (value: "ticketList" | "diagnosticProtocol" | "warrantyCertificate") => void; disabled?: boolean }) {
  const [open, setOpen] = useState(false);
  const buttonRef = useRef<HTMLButtonElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);

  const options: Array<{ value: "ticketList" | "diagnosticProtocol" | "warrantyCertificate"; label: string; description: string }> = [
    { value: "ticketList", label: "Zakázkový list", description: "Dokument pro přijetí zařízení do servisu" },
    { value: "diagnosticProtocol", label: "Diagnostický protokol", description: "Protokol s výsledky diagnostiky" },
    { value: "warrantyCertificate", label: "Záruční list", description: "Záruční list po opravě zařízení" },
  ];

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

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        onClick={() => !disabled && setOpen(!open)}
        style={{
          width: "100%",
          padding: "12px 16px",
          borderRadius: 12,
          border: "1px solid var(--border)",
          background: disabled ? "var(--panel-2)" : "var(--panel)",
          color: "var(--text)",
          fontSize: 14,
          fontFamily: "system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif",
          cursor: disabled ? "not-allowed" : "pointer",
          outline: "none",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          fontWeight: 600,
          opacity: disabled ? 0.6 : 1,
          transition: "var(--transition-smooth)",
        }}
        onMouseEnter={(e) => {
          if (!disabled) {
          e.currentTarget.style.borderColor = "var(--accent)";
          e.currentTarget.style.background = "var(--panel-2)";
          }
        }}
        onMouseLeave={(e) => {
          if (!disabled) {
          e.currentTarget.style.borderColor = "var(--border)";
          e.currentTarget.style.background = "var(--panel)";
          }
        }}
      >
        <span>{selected.label}</span>
        <span style={{ fontSize: 12, opacity: 0.6 }}>▼</span>
      </button>
      {open &&
        createPortal(
          <div
            ref={menuRef}
            style={{
              position: "fixed",
              borderRadius: 14,
              border: "1px solid var(--border)",
              background: "var(--panel)",
              backdropFilter: "var(--blur)",
              WebkitBackdropFilter: "var(--blur)",
              boxShadow: "0 25px 60px rgba(0,0,0,0.22)",
              padding: 6,
              zIndex: 10000,
              overflowY: "auto",
            }}
          >
            {options.map((option) => {
              const active = option.value === value;
              return (
                <button
                  key={option.value}
                  type="button"
                  disabled={disabled}                  onClick={() => {
                    if (!disabled) {
                    onChange(option.value);
                    setOpen(false);
                    }
                  }}
                  style={{
                    width: "100%",
                    textAlign: "left",
                    padding: "12px 16px",
                    borderRadius: 12,
                    border: "none",
                    background: active ? "var(--accent-soft)" : "transparent",
                    cursor: "pointer",
                    color: active ? "var(--accent)" : "var(--text)",
                    fontFamily: "system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif",
                    fontWeight: active ? 700 : 500,
                    fontSize: 14,
                    transition: "var(--transition-smooth)",
                    display: "flex",
                    flexDirection: "column",
                    gap: 4,
                  }}
                  onMouseEnter={(e) => {
                    if (!active) e.currentTarget.style.background = "var(--panel-2)";
                  }}
                  onMouseLeave={(e) => {
                    if (!active) e.currentTarget.style.background = "transparent";
                  }}
                >
                  <span style={{ fontWeight: active ? 700 : 600 }}>{option.label}</span>
                  <span style={{ fontSize: 11, opacity: 0.7, fontWeight: 400 }}>{option.description}</span>
                  {active && <span style={{ marginTop: 4, fontSize: 16, opacity: 0.8 }}>✓</span>}
                </button>
              );
            })}
          </div>,
          document.body
        )}
    </>
  );
}

function DesignPicker({ value, onChange, disabled = false }: { value: DocumentDesign; onChange: (value: DocumentDesign) => void; disabled?: boolean }) {
  const [open, setOpen] = useState(false);
  const buttonRef = useRef<HTMLButtonElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);

  const options: Array<{ value: DocumentDesign; label: string; description: string }> = [
    { value: "classic", label: "Klasický", description: "Tradiční vzhled s jasnou strukturou" },
    { value: "modern", label: "Moderní", description: "Světlé barvy a čistý design" },
    { value: "minimal", label: "Minimalistický", description: "Jednoduchý a elegantní styl" },
    { value: "professional", label: "Profesionální", description: "Formální vzhled pro firemní dokumenty" },
  ];

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

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        disabled={disabled}
        onClick={() => !disabled && setOpen(!open)}
        style={{
          width: "100%",
          padding: "12px 16px",
          borderRadius: 12,
          border: "1px solid var(--border)",
          background: "var(--panel)",
          color: "var(--text)",
          fontSize: 14,
          fontFamily: "system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif",
          cursor: "pointer",
          outline: "none",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          fontWeight: 600,
          transition: "var(--transition-smooth)",
        }}
        onMouseEnter={(e) => {
          e.currentTarget.style.borderColor = "var(--accent)";
          e.currentTarget.style.background = "var(--panel-2)";
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.borderColor = "var(--border)";
          e.currentTarget.style.background = "var(--panel)";
        }}
      >
        <span>{selected.label}</span>
        <span style={{ fontSize: 12, opacity: 0.6 }}>▼</span>
      </button>
      {open &&
        createPortal(
          <div
            ref={menuRef}
            style={{
              position: "fixed",
              borderRadius: 14,
              border: "1px solid var(--border)",
              background: "var(--panel)",
              backdropFilter: "var(--blur)",
              WebkitBackdropFilter: "var(--blur)",
              boxShadow: "0 25px 60px rgba(0,0,0,0.22)",
              padding: 6,
              zIndex: 10000,
              overflowY: "auto",
            }}
          >
            {options.map((option) => {
              const active = option.value === value;
              return (
                <button
                  key={option.value}
                  type="button"
                  disabled={disabled}                  onClick={() => {
                    if (!disabled) {
                    onChange(option.value);
                    setOpen(false);
                    }
                  }}
                  style={{
                    width: "100%",
                    textAlign: "left",
                    padding: "12px 16px",
                    borderRadius: 12,
                    border: "none",
                    background: active ? "var(--accent-soft)" : "transparent",
                    cursor: "pointer",
                    color: active ? "var(--accent)" : "var(--text)",
                    fontFamily: "system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif",
                    fontWeight: active ? 700 : 500,
                    fontSize: 14,
                    transition: "var(--transition-smooth)",
                    display: "flex",
                    flexDirection: "column",
                    gap: 4,
                  }}
                  onMouseEnter={(e) => {
                    if (!active) e.currentTarget.style.background = "var(--panel-2)";
                  }}
                  onMouseLeave={(e) => {
                    if (!active) e.currentTarget.style.background = "transparent";
                  }}
                >
                  <span style={{ fontWeight: active ? 700 : 600 }}>{option.label}</span>
                  <span style={{ fontSize: 11, opacity: 0.7, fontWeight: 400 }}>{option.description}</span>
                  {active && <span style={{ marginTop: 4, fontSize: 16, opacity: 0.8 }}>✓</span>}
                </button>
              );
            })}
          </div>,
          document.body
        )}
    </>
  );
}

function LanguagePicker({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  const [open, setOpen] = useState(false);
  const buttonRef = useRef<HTMLButtonElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);

  const options = [
    { value: "cs", label: "Čeština" },
    { value: "sk", label: "Slovenština" },
    { value: "en", label: "Angličtina" },
  ];

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
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              gap: 10,
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
            <span>{opt.label}</span>
            {active && <span style={{ marginLeft: "auto", fontSize: 16, opacity: 0.8 }}>✓</span>}
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
        onClick={() => setOpen(!open)}
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
          cursor: "pointer",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          boxShadow: open ? "0 0 0 3px var(--accent-soft)" : "var(--shadow-soft)",
          transition: "var(--transition-smooth)",
        }}
        onMouseEnter={(e) => {
          if (!open) {
            e.currentTarget.style.borderColor = "var(--accent)";
            e.currentTarget.style.boxShadow = "0 4px 16px var(--accent-glow)";
          }
        }}
        onMouseLeave={(e) => {
          if (!open) {
            e.currentTarget.style.borderColor = "var(--border)";
            e.currentTarget.style.boxShadow = "var(--shadow-soft)";
          }
        }}
      >
        <span>{selected.label}</span>
        <span style={{ opacity: 0.65, fontWeight: 900, fontSize: 12 }}>▾</span>
      </button>
      {open ? createPortal(menu, document.body) : null}
    </>
  );
}

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

function FieldLabel({ children }: { children: string }) {
  return <div style={{ color: "var(--muted)", fontSize: 12, paddingTop: 10 }}>{children}</div>;
}

function TextInput(props: any) {
  return (
    <input
      {...props}
      style={{
        width: "100%",
        padding: "10px 12px",
        borderRadius: 12,
        border: "1px solid var(--border)",
        background: "var(--panel)",
        backdropFilter: "var(--blur)",
        WebkitBackdropFilter: "var(--blur)",
        color: "var(--text)",
        outline: "none",
        transition: "var(--transition-smooth)",
        boxShadow: "var(--shadow-soft)",
      }}
    />
  );
}

function ModernCheckbox({ 
  checked, 
  onChange, 
  label,
  disabled = false
}: { 
  checked: boolean; 
  onChange: (checked: boolean) => void; 
  label: string;
  disabled?: boolean;
}) {
  return (
    <label 
      style={{ 
        display: "flex", 
        alignItems: "center", 
        gap: 12, 
        cursor: disabled ? "not-allowed" : "pointer",
        padding: "10px 12px",
        borderRadius: 10,
        border: "1px solid var(--border)",
        background: disabled ? "var(--panel-2)" : (checked ? "var(--accent-soft)" : "var(--panel)"),
        opacity: disabled ? 0.6 : 1,
        transition: "var(--transition-smooth)",
      }}
      onMouseEnter={(e) => {
        if (!disabled && !checked) {
          e.currentTarget.style.background = "var(--panel-2)";
          e.currentTarget.style.borderColor = "var(--accent)";
        }
      }}
      onMouseLeave={(e) => {
        if (!checked) {
          e.currentTarget.style.background = "var(--panel)";
          e.currentTarget.style.borderColor = "var(--border)";
        }
      }}
    >
      <div style={{ position: "relative", width: 20, height: 20, flexShrink: 0 }}>
        <input
          type="checkbox"
          checked={checked}
          onChange={(e) => !disabled && onChange(e.target.checked)}
          disabled={disabled}
          style={{
            position: "absolute",
            opacity: 0,
            width: "100%",
            height: "100%",
            margin: 0,
            cursor: disabled ? "not-allowed" : "pointer",
          }}
        />
        <div
          style={{
            width: "100%",
            height: "100%",
            borderRadius: 6,
            border: checked ? "2px solid var(--accent)" : "2px solid var(--border)",
            background: checked ? "var(--accent)" : "transparent",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            transition: "var(--transition-smooth)",
          }}
        >
          {checked && (
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="20 6 9 17 4 12"/>
            </svg>
          )}
        </div>
      </div>
      <span style={{ fontSize: 13, fontWeight: checked ? 600 : 400, color: "var(--text)" }}>{label}</span>
    </label>
  );
}

function ModernRadioButton({
  checked,
  onChange,
  label,
  name,
  disabled = false
}: {
  checked: boolean;
  onChange: () => void;
  label: string;
  name: string;
  disabled?: boolean;
}) {
  return (
    <label
      style={{
        display: "flex",
        alignItems: "center",
        gap: 8,
        cursor: disabled ? "not-allowed" : "pointer",
        padding: "8px 12px",
        borderRadius: 8,
        border: checked ? "2px solid var(--accent)" : "1px solid var(--border)",
        background: disabled ? "var(--panel-2)" : (checked ? "var(--accent-soft)" : "var(--panel)"),
        opacity: disabled ? 0.6 : 1,
        transition: "var(--transition-smooth)",
        flex: 1,
      }}
      onMouseEnter={(e) => {
        if (!disabled && !checked) {
          e.currentTarget.style.background = "var(--panel-2)";
          e.currentTarget.style.borderColor = "var(--accent)";
        }
      }}
      onMouseLeave={(e) => {
        if (!checked) {
          e.currentTarget.style.background = "var(--panel)";
          e.currentTarget.style.borderColor = "var(--border)";
        }
      }}
    >
      <div style={{ position: "relative", width: 18, height: 18, flexShrink: 0 }}>
        <input
          type="radio"
          name={name}
          checked={checked}
          onChange={() => !disabled && onChange()}
          disabled={disabled}
          style={{
            position: "absolute",
            opacity: 0,
            width: "100%",
            height: "100%",
            margin: 0,
            cursor: disabled ? "not-allowed" : "pointer",
          }}
        />
        <div
          style={{
            width: "100%",
            height: "100%",
            borderRadius: "50%",
            border: checked ? "2px solid var(--accent)" : "2px solid var(--border)",
            background: checked ? "var(--accent)" : "transparent",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            transition: "var(--transition-smooth)",
          }}
        >
          {checked && (
            <div
              style={{
                width: 8,
                height: 8,
                borderRadius: "50%",
                background: "white",
              }}
            />
          )}
        </div>
      </div>
      <span style={{ fontSize: 13, fontWeight: checked ? 600 : 400, color: "var(--text)" }}>{label}</span>
    </label>
  );
}

function UnitPicker({
  value,
  onChange,
  duration
}: {
  value: "days" | "months" | "years";
  onChange: (value: "days" | "months" | "years") => void;
  duration: number;
}) {
  const [open, setOpen] = useState(false);
  const buttonRef = useRef<HTMLButtonElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);

  const getUnitLabel = (unit: "days" | "months" | "years", count: number): string => {
    if (unit === "days") {
      if (count === 1) return "Den";
      if (count >= 2 && count <= 4) return "Dny";
      return "Dnů";
    } else if (unit === "months") {
      if (count === 1) return "Měsíc";
      if (count >= 2 && count <= 4) return "Měsíce";
      return "Měsíců";
    } else {
      if (count === 1) return "Rok";
      if (count >= 2 && count <= 4) return "Roky";
      return "Let";
    }
  };

  const options: Array<{ value: "days" | "months" | "years"; label: string }> = [
    { value: "days", label: getUnitLabel("days", duration) },
    { value: "months", label: getUnitLabel("months", duration) },
    { value: "years", label: getUnitLabel("years", duration) },
  ];

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

    let top = btnRect.bottom + 4;
    let maxHeight = Math.min(200, spaceBelow - 8);

    if (spaceBelow < menuHeight && spaceAbove > spaceBelow) {
      top = btnRect.top - menuHeight - 4;
      maxHeight = Math.min(200, spaceAbove - 8);
    }

    menu.style.top = `${top}px`;
    menu.style.left = `${btnRect.left}px`;
    menu.style.width = `${btnRect.width}px`;
    menu.style.maxHeight = `${maxHeight}px`;
  }, [open]);

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        onClick={() => setOpen(!open)}
        style={{
          flex: 1,
          padding: "8px 12px",
          borderRadius: 8,
          border: "1px solid var(--border)",
          background: "var(--panel)",
          color: "var(--text)",
          fontSize: 13,
          fontFamily: "system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif",
          cursor: "pointer",
          outline: "none",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          transition: "var(--transition-smooth)",
        }}
        onMouseEnter={(e) => {
          e.currentTarget.style.borderColor = "var(--accent)";
          e.currentTarget.style.background = "var(--panel-2)";
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.borderColor = "var(--border)";
          e.currentTarget.style.background = "var(--panel)";
        }}
      >
        <span>{selected.label}</span>
        <svg
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          style={{
            transform: open ? "rotate(180deg)" : "rotate(0deg)",
            transition: "transform 0.2s",
            flexShrink: 0,
            marginLeft: 8,
          }}
        >
          <polyline points="6 9 12 15 18 9" />
        </svg>
      </button>
      {open &&
        createPortal(
          <div
            ref={menuRef}
            style={{
              position: "fixed",
              zIndex: 10000,
              background: "var(--panel)",
              border: "1px solid var(--border)",
              borderRadius: 8,
              boxShadow: "0 4px 12px rgba(0, 0, 0, 0.15)",
              overflow: "auto",
              minWidth: 120,
            }}
          >
            {options.map((option) => (
              <button
                key={option.value}
                type="button"
                onClick={() => {
                  onChange(option.value);
                  setOpen(false);
                }}
                style={{
                  width: "100%",
                  padding: "10px 16px",
                  background: value === option.value ? "var(--accent-soft)" : "transparent",
                  color: "var(--text)",
                  fontSize: 13,
                  fontFamily: "system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif",
                  border: "none",
                  cursor: "pointer",
                  textAlign: "left",
                  transition: "var(--transition-smooth)",
                  fontWeight: value === option.value ? 600 : 400,
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.background = value === option.value ? "var(--accent-soft)" : "var(--panel-2)";
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.background = value === option.value ? "var(--accent-soft)" : "transparent";
                }}
              >
                {option.label}
              </button>
            ))}
          </div>,
          document.body
        )}
    </>
  );
}

function CustomizationCategory({
  checked,
  onChange,
  label,
  children
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label: string;
  children: React.ReactNode;
}) {
  const [isOpen, setIsOpen] = useState(checked);
  
  // Sync with external checked state
  useEffect(() => {
    setIsOpen(checked);
  }, [checked]);

  const handleChange = (newChecked: boolean) => {
    setIsOpen(newChecked);
    onChange(newChecked);
  };

  return (
    <div style={{ marginBottom: 16 }}>
      <ModernCheckbox
        checked={isOpen}
        onChange={handleChange}
        label={label}
      />
      {isOpen && (
        <div style={{ marginTop: 12, marginLeft: 32, padding: "12px 16px", borderRadius: 10, background: "var(--panel-2)", border: "1px solid var(--border)" }}>
          {children}
        </div>
      )}
    </div>
  );
}

// Helper function to create mock ticket for preview
function createMockTicket(): TicketEx {
  return {
    id: "mock-ticket-id",
    code: "DEMO-001",
    customerId: "mock-customer-id",
    customerName: "Jan Novák",
    customerPhone: "+420123456789",
    deviceLabel: "iPhone 13 Pro",
    serialOrImei: "SN123456789",
    issueShort: "Nefunguje displej",
    status: "received" as any,
    createdAt: new Date().toISOString(),
    customerEmail: "jan.novak@example.com",
    customerAddressStreet: "Hlavní 123",
    customerAddressCity: "Praha",
    customerAddressZip: "12000",
    customerCompany: undefined,
    customerIco: undefined,
    customerInfo: "Poznámka k zákazníkovi",
    devicePasscode: "1234",
    deviceCondition: "Poškozený displej",
    requestedRepair: "Oprava displeje",
    handoffMethod: "branch" as any,
    deviceNote: "Poznámka k zařízení",
    externalId: undefined,
    estimatedPrice: 5000,
    performedRepairs: [
      { id: "mock-repair-1", name: "Výměna displeje", type: "selected" as any, price: 2500 },
      { id: "mock-repair-2", name: "Kalibrace", type: "selected" as any, price: 500 }
    ],
    diagnosticText: "Displej je poškozený, nutná výměna.",
    diagnosticPhotos: undefined,
    discountType: "percentage" as any,
    discountValue: 10,
  };
}

// React component for document preview (alternative to HTML string approach)
function ReactDocumentPreview({ documentType, config }: { documentType: "ticketList" | "diagnosticProtocol" | "warrantyCertificate"; config: DocumentsConfig }) {
  const mockTicket = useMemo(() => createMockTicket(), []);
  const companyData = useMemo(() => safeLoadCompanyData(), []);
  const printRef = useRef<HTMLDivElement>(null);
  
  const design = documentType === "ticketList" 
    ? config.ticketList?.design || "classic"
    : documentType === "diagnosticProtocol"
    ? config.diagnosticProtocol?.design || "classic"
    : config.warrantyCertificate?.design || "classic";
  
  const colorMode = config.colorMode || "color";
  
  // Use useEffect to set up print event listeners and global print styles
  useEffect(() => {
    const handleBeforePrint = () => {
      console.log("[ReactDocumentPreview] Before print event");
      if (printRef.current) {
        document.body.classList.add("printing-document");
      }
    };
    
    const handleAfterPrint = () => {
      console.log("[ReactDocumentPreview] After print event");
      document.body.classList.remove("printing-document");
    };
    
    // Add global print styles to document head
    const printStyleId = "react-document-print-styles";
    let printStyle = document.getElementById(printStyleId);
    if (!printStyle) {
      printStyle = document.createElement("style");
      printStyle.id = printStyleId;
      document.head.appendChild(printStyle);
    }
    
    printStyle.textContent = `
      @media print {
        /* Hide everything by default */
        body.printing-document * {
          display: none !important;
        }
        /* Show document wrapper and ALL its descendants */
        body.printing-document .document-preview-wrapper,
        body.printing-document .document-preview-wrapper * {
          display: revert !important;
        }
        /* Reset body */
        body.printing-document {
          margin: 0 !important;
          padding: 0 !important;
          background: white !important;
        }
        /* Document wrapper - full screen */
        body.printing-document .document-preview-wrapper {
          display: block !important;
          position: fixed !important;
          top: 0 !important;
          left: 0 !important;
          width: 100% !important;
          height: 100% !important;
          margin: 0 !important;
          padding: 0 !important;
          background: white !important;
          z-index: 999999 !important;
        }
        /* Document preview - A4 size, centered */
        body.printing-document .document-preview {
          display: block !important;
          position: relative !important;
          width: 210mm !important;
          min-height: 297mm !important;
          max-width: 210mm !important;
          margin: 0 auto !important;
          padding: 15mm !important;
          box-sizing: border-box !important;
          border: none !important;
          border-radius: 0 !important;
          background: white !important;
          box-shadow: none !important;
          overflow: visible !important;
          max-height: none !important;
          transform: none !important;
        }
        /* Page settings */
        @page {
          size: A4;
          margin: 0;
        }
        /* Ensure content fits */
        body.printing-document .document-preview * {
          max-width: 100% !important;
          word-wrap: break-word !important;
          overflow-wrap: break-word !important;
          box-sizing: border-box !important;
        }
      }
    `;
    
    // Add event listeners
    window.addEventListener("beforeprint", handleBeforePrint);
    window.addEventListener("afterprint", handleAfterPrint);
    
    // Cleanup
    return () => {
      window.removeEventListener("beforeprint", handleBeforePrint);
      window.removeEventListener("afterprint", handleAfterPrint);
      document.body.classList.remove("printing-document");
      // Don't remove the style element as it might be used by other instances
    };
  }, []);
  
  const handlePrint = async () => {
    try {
      console.log("[ReactDocumentPreview] Starting print, document type:", documentType);
      
      // Generate HTML using existing HTML generators (same as in "Dokumenty" section)
      // Determine if multi-page is allowed (only for diagnostic protocol)
      const allowMultiPage = documentType === "diagnosticProtocol";
      
      let htmlContent = "";
      if (documentType === "ticketList") {
        htmlContent = generateTicketHTML(mockTicket, true, config, false);
      } else if (documentType === "diagnosticProtocol") {
        htmlContent = generateDiagnosticProtocolHTML(mockTicket, companyData, true, config, false);
      } else if (documentType === "warrantyCertificate") {
        htmlContent = generateWarrantyHTML(mockTicket, companyData, true, config, false);
      } else {
        showToast("Neznámý typ dokumentu", "error");
        return;
      }
      
      // Inject toolbar and auto-print script into HTML
      // Toolbar provides manual print button (more reliable than auto-print)
      const printToolbar = `
        <div class="print-toolbar no-print" style="
          position: fixed;
          top: 0;
          left: 0;
          right: 0;
          background: white;
          border-bottom: 1px solid #e5e5e5;
          padding: 12px 16px;
          display: flex;
          justify-content: flex-end;
          gap: 12px;
          z-index: 10000;
          box-shadow: 0 2px 4px rgba(0,0,0,0.1);
        ">
          <button onclick="if (window.doPrint) { window.doPrint(); } else { window.print(); }" style="
            padding: 8px 16px;
            border-radius: 6px;
            border: 1px solid #2563eb;
            background: #2563eb;
            color: white;
            cursor: pointer;
            font-size: 13px;
            font-weight: 600;
          ">🖨️ Tisknout</button>
        </div>
        <style>
          @media print {
            .no-print { display: none !important; }
            /* Page layout - always flex column */
            .page {
              overflow: visible !important;
              display: flex !important;
              flex-direction: column !important;
            }
            /* Content area - can be scaled for fit-to-page */
            .content {
              overflow: visible !important;
            }
            .content.fit-to-page {
              transform-origin: top left !important;
            }
            /* Footer - always visible, never scaled */
            .footer {
              overflow: visible !important;
              z-index: 10 !important;
              position: relative !important;
              flex-shrink: 0 !important;
            }
            .document-footer {
              overflow: visible !important;
              position: relative !important;
            }
            .signatures {
              overflow: visible !important;
            }
            .signature-box {
              overflow: visible !important;
              position: relative !important;
            }
            /* Ensure sections display correctly in print - borders and border-radius */
            .section {
              overflow: visible !important;
              position: relative !important;
            }
            .section::before {
              content: none !important;
              display: none !important;
            }
            .section::after {
              content: none !important;
              display: none !important;
            }
            /* Ensure container doesn't overflow */
            html, body {
              margin: 0 !important;
              padding: 0 !important;
            }
            body > .page {
              margin: 0 !important;
              overflow: visible !important;
            }
            /* Multi-page support for diagnostic protocol */
            ${allowMultiPage ? `
              .page {
                page-break-inside: auto !important;
                break-inside: auto !important;
              }
              .content {
                page-break-inside: auto !important;
                break-inside: auto !important;
              }
              .section {
                page-break-inside: auto !important;
                break-inside: auto !important;
              }
              /* Prevent images from breaking across pages */
              img {
                max-width: 100% !important;
                height: auto !important;
                page-break-inside: avoid !important;
                break-inside: avoid !important;
              }
              /* Image containers should not break */
              .section img,
              .photo-item,
              .photo-item img {
                page-break-inside: avoid !important;
                break-inside: avoid !important;
              }
            ` : `
              /* Single-page: prevent page breaks */
              .page {
                page-break-inside: avoid !important;
                break-inside: avoid !important;
                page-break-after: avoid !important;
                page-break-before: avoid !important;
              }
            `}
          }
          /* Also apply section styles in screen view (for print window preview) */
          @media screen {
            .section {
              overflow: visible !important;
            }
            .section::before {
              content: none !important;
              display: none !important;
            }
            .section::after {
              content: none !important;
              display: none !important;
            }
          }
          @media screen {
            body { 
              padding-top: 60px !important; 
              margin: 0 !important;
              padding-left: 16px !important;
              padding-right: 16px !important;
              padding-bottom: 16px !important;
              overflow: auto !important;
              background: #eee !important;
            }
            /* Ensure document is centered and scrollable in screen view */
            body > *:not(.print-toolbar) {
              max-width: 210mm !important;
              margin: 0 auto !important;
              background: #fff !important;
              box-shadow: 0 2px 8px rgba(0,0,0,0.1) !important;
            }
          }
        </style>
      `;
      
      // Improved auto-print script with fit-to-page logic
      const autoPrintScript = `
        <script>
          (function() {
            const allowMultiPage = ${allowMultiPage ? 'true' : 'false'};
            console.log("[PrintWindow] Auto-print script loaded, allowMultiPage:", allowMultiPage);
            
            // Fit-to-page function: ensures document fits on one A4 page
            // Only applies scale to .content, not to .page (footer stays unscaled)
            function fitToPage() {
              const pageElement = document.querySelector('.page');
              const contentElement = document.querySelector('.content');
              const footerElement = document.querySelector('.footer');
              
              if (!pageElement) {
                console.warn("[PrintWindow] .page element not found");
                return 1.0;
              }
              
              if (!contentElement) {
                console.warn("[PrintWindow] .content element not found");
                return 1.0;
              }
              
              // A4 dimensions: 210mm x 297mm
              const A4_WIDTH_MM = 210;
              const A4_HEIGHT_MM = 297;
              
              // Convert pixels to mm (96 DPI: 1mm = 3.779527559px)
              const MM_TO_PX = 3.779527559;
              const A4_WIDTH_PX = A4_WIDTH_MM * MM_TO_PX;
              const A4_HEIGHT_PX = A4_HEIGHT_MM * MM_TO_PX;
              
              // Get footer height (if exists)
              const footerHeight = footerElement ? footerElement.offsetHeight : 0;
              
              // Available height for content = A4 height - footer height
              const availableContentHeight = A4_HEIGHT_PX - footerHeight;
              
              // Measure content element (without footer)
              const contentHeight = contentElement.scrollHeight;
              const contentWidth = contentElement.scrollWidth;
              
              console.log("[PrintWindow] Dimensions:", {
                contentHeight: contentHeight.toFixed(2) + "px (" + (contentHeight / MM_TO_PX).toFixed(2) + "mm)",
                contentWidth: contentWidth.toFixed(2) + "px (" + (contentWidth / MM_TO_PX).toFixed(2) + "mm)",
                footerHeight: footerHeight.toFixed(2) + "px (" + (footerHeight / MM_TO_PX).toFixed(2) + "mm)",
                availableContentHeight: availableContentHeight.toFixed(2) + "px (" + (availableContentHeight / MM_TO_PX).toFixed(2) + "mm)",
                A4Width: A4_WIDTH_PX.toFixed(2) + "px (" + A4_WIDTH_MM + "mm)",
                A4Height: A4_HEIGHT_PX.toFixed(2) + "px (" + A4_HEIGHT_MM + "mm)"
              });
              
              // If content fits, no scaling needed
              if (contentHeight <= availableContentHeight && contentWidth <= A4_WIDTH_PX) {
                console.log("[PrintWindow] Content fits on one page, no scaling needed");
                contentElement.style.transform = '';
                contentElement.style.transformOrigin = '';
                contentElement.classList.remove('fit-to-page');
                return 1.0;
              }
              
              // Calculate scale needed (use the more restrictive scale)
              const heightScale = availableContentHeight / contentHeight;
              const widthScale = A4_WIDTH_PX / contentWidth;
              let scale = Math.min(heightScale, widthScale);
              
              // Minimum scale: 0.85 (don't shrink too much)
              const MIN_SCALE = 0.85;
              scale = Math.max(scale, MIN_SCALE);
              
              // Round to 2 decimal places for cleaner output
              scale = Math.round(scale * 100) / 100;
              
              // Apply scale ONLY to content element, not to page
              contentElement.style.transform = 'scale(' + scale + ')';
              contentElement.style.transformOrigin = 'top left';
              contentElement.classList.add('fit-to-page');
              
              // Ensure footer is not scaled
              if (footerElement) {
                footerElement.style.transform = '';
                footerElement.style.transformOrigin = '';
              }
              
              console.log("[PrintWindow] Applied scale to .content:", scale, "(" + (scale * 100).toFixed(1) + "%)");
              
              // Verify it fits after scaling
              const scaledContentHeight = contentHeight * scale;
              const scaledContentWidth = contentWidth * scale;
              console.log("[PrintWindow] Scaled dimensions:", {
                contentWidth: scaledContentWidth.toFixed(2) + "px (" + (scaledContentWidth / MM_TO_PX).toFixed(2) + "mm)",
                contentHeight: scaledContentHeight.toFixed(2) + "px (" + (scaledContentHeight / MM_TO_PX).toFixed(2) + "mm)",
                totalHeight: (scaledContentHeight + footerHeight).toFixed(2) + "px (" + ((scaledContentHeight + footerHeight) / MM_TO_PX).toFixed(2) + "mm)",
                fits: scaledContentHeight <= availableContentHeight && scaledContentWidth <= A4_WIDTH_PX
              });
              
              return scale;
            }
            
            // Print function with fit-to-page (only if multi-page is not allowed)
            function doPrint() {
              console.log("[PrintWindow] Starting print, allowMultiPage:", allowMultiPage);
              
              if (!allowMultiPage) {
                const scale = fitToPage();
                console.log("[PrintWindow] Final scale:", scale);
              } else {
                console.log("[PrintWindow] Multi-page allowed, skipping fit-to-page");
              }
              
              // Small delay to ensure transform is applied
              setTimeout(function() {
                window.focus();
                window.print();
                console.log("[PrintWindow] Print dialog opened");
              }, 100);
            }
            
            // Make doPrint available globally for toolbar button
            window.doPrint = doPrint;
            
            window.addEventListener("load", async function() {
              console.log("[PrintWindow] Window loaded");
              try {
                // Wait for fonts to load if available
                if (document.fonts && document.fonts.ready) {
                  await document.fonts.ready;
                  console.log("[PrintWindow] Fonts ready");
                }
                
                // Wait a bit more for layout to stabilize
                requestAnimationFrame(function() {
                  setTimeout(function() {
                    console.log("[PrintWindow] Attempting auto-print with fit-to-page");
                    doPrint();
                  }, 200);
                });
              } catch (err) {
                console.warn("[PrintWindow] Auto-print failed:", err);
                // Manual button is available as fallback
              }
            });
            
            // Expose doPrint globally for manual button
            window.doPrint = doPrint;
          })();
        </script>
      `;
      
      // Insert toolbar after <body> tag and script before closing </body> tag
      let htmlWithPrintScript = htmlContent.replace('<body>', '<body>' + printToolbar);
      htmlWithPrintScript = htmlWithPrintScript.replace('</body>', autoPrintScript + '</body>');
      
      console.log("[ReactDocumentPreview] HTML generated with auto-print script, length:", htmlWithPrintScript.length);
      
      // Check if running in Tauri
      const isTauri = typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
      
      if (isTauri) {
        // Variant A: Use Tauri WebviewWindow (same pattern as Preview.tsx)
        // Create blob URL (more reliable than data URL in Tauri)
        const blob = new Blob([htmlWithPrintScript], { type: "text/html;charset=utf-8" });
        const blobUrl = URL.createObjectURL(blob);
        
        console.log("[ReactDocumentPreview] Created blob URL for print window");
        
        try {
          // Dynamic import for WebviewWindow
          const webviewModule = await import('@tauri-apps/api/webviewWindow');
          const WebviewWindow = webviewModule.WebviewWindow;
          
          if (!WebviewWindow || typeof WebviewWindow !== 'function') {
            throw new Error('WebviewWindow not available');
          }
          
          // Check if print window already exists and close it
          // Use "print" label (matches capabilities allowlist)
          try {
            const existingPrint = await WebviewWindow.getByLabel("print");
            if (existingPrint) {
              console.log("[ReactDocumentPreview] Closing existing print window");
              await existingPrint.close();
              await new Promise(resolve => setTimeout(resolve, 100));
            }
          } catch (err) {
            // Window doesn't exist, that's fine
            console.log("[ReactDocumentPreview] No existing print window to close");
          }
          
          // Create new window for printing
          // Label "print" matches capabilities allowlist in default.json
          const printWindow = new WebviewWindow("print", {
            url: blobUrl,
            title: "Tisk dokumentu",
            width: 900,
            height: 700,
            center: true,
            closable: true,
            visible: true,
          });
          
          console.log("[ReactDocumentPreview] Print window created with blob URL");
          
          // Wait for window to be created and loaded
          printWindow.once("tauri://created", async () => {
            console.log("[ReactDocumentPreview] Print window created successfully");
            try {
              await printWindow.setFocus();
              await printWindow.center();
              console.log("[ReactDocumentPreview] Print window focused and centered");
              
              // Auto-print script in HTML will handle printing
              // Clean up blob URL after a delay
              setTimeout(() => {
                URL.revokeObjectURL(blobUrl);
                console.log("[ReactDocumentPreview] Blob URL revoked");
              }, 5000);
            } catch (showErr) {
              console.error("[ReactDocumentPreview] Error showing print window:", showErr);
              URL.revokeObjectURL(blobUrl);
              showToast("Chyba při zobrazení okna pro tisk.", "error");
            }
          });
          
          // Listen for window errors
          printWindow.once("tauri://error", (e: any) => {
            console.error("[ReactDocumentPreview] Print window error:", e);
            URL.revokeObjectURL(blobUrl);
            showToast("Chyba při vytváření okna pro tisk.", "error");
          });
          
        } catch (error) {
          console.error("[ReactDocumentPreview] Error creating print window:", error);
          URL.revokeObjectURL(blobUrl);
          showToast("Chyba při vytváření okna pro tisk: " + (error instanceof Error ? error.message : "Neznámá chyba"), "error");
        }
      } else {
        // Browser fallback: Use blob URL in new window
        const blob = new Blob([htmlWithPrintScript], { type: "text/html;charset=utf-8" });
        const blobUrl = URL.createObjectURL(blob);
        const printWindow = window.open(blobUrl, "_blank");
        if (!printWindow) {
          URL.revokeObjectURL(blobUrl);
          showToast("Nelze otevřít okno pro tisk. Zkontrolujte nastavení blokování vyskakovacích oken.", "error");
          return;
        }
        
        printWindow.onload = () => {
          setTimeout(() => {
            printWindow.focus();
            printWindow.print();
            URL.revokeObjectURL(blobUrl);
          }, 250);
        };
      }
      
    } catch (error) {
      console.error("[ReactDocumentPreview] Print error:", error);
      showToast("Chyba při tisku: " + (error instanceof Error ? error.message : "Neznámá chyba"), "error");
    }
  };
  
  return (
    <div className="document-preview-wrapper" style={{ position: "relative" }}>
      <style>{`
        .document-preview {
          font-family: system-ui, -apple-system, sans-serif;
          font-size: 11px;
          line-height: 1.4;
          color: ${colorMode === "bw" ? "#000" : "#1f2937"};
          ${colorMode === "bw" ? `
            * {
              color: #000 !important;
              background: #fff !important;
              border-color: #000 !important;
            }
            img {
              filter: grayscale(100%);
            }
            svg {
              filter: grayscale(100%);
            }
          ` : ""}
        }
        @media print {
          body.printing-document {
            margin: 0 !important;
            padding: 0 !important;
            background: white !important;
          }
          body.printing-document .document-preview-wrapper {
            position: fixed !important;
            top: 0 !important;
            left: 0 !important;
            width: 100% !important;
            height: 100% !important;
            margin: 0 !important;
            padding: 0 !important;
            background: white !important;
            z-index: 999999 !important;
            display: block !important;
          }
          body.printing-document .document-preview {
            position: relative !important;
            width: 210mm !important;
            min-height: 297mm !important;
            max-width: 210mm !important;
            margin: 0 auto !important;
            padding: 15mm !important;
            box-sizing: border-box !important;
            border: none !important;
            border-radius: 0 !important;
            background: white !important;
            box-shadow: none !important;
            overflow: visible !important;
            max-height: none !important;
            transform: none !important;
          }
          .no-print {
            display: none !important;
          }
          @page {
            size: A4;
            margin: 0;
          }
        }
      `}</style>
      
      <div
        ref={printRef}
        className="document-preview"
        style={{
          width: "100%",
          maxWidth: "210mm",
          minHeight: "297mm",
          background: "white",
          padding: "20mm",
          boxSizing: "border-box",
          margin: "0 auto",
          border: "1px solid var(--border)",
          borderRadius: 8,
          overflow: "auto",
          maxHeight: "80vh",
        }}
      >
        {documentType === "ticketList" && (
          <TicketDocumentReact ticket={mockTicket} companyData={companyData} config={config} design={design} />
        )}
        {documentType === "diagnosticProtocol" && (
          <DiagnosticDocumentReact ticket={mockTicket} companyData={companyData} config={config} design={design} />
        )}
        {documentType === "warrantyCertificate" && (
          <WarrantyDocumentReact ticket={mockTicket} companyData={companyData} config={config} design={design} />
        )}
      </div>
      
      <div style={{ marginTop: 16, display: "flex", justifyContent: "center" }}>
        <button
          onClick={handlePrint}
          className="no-print"
          style={{
            padding: "10px 20px",
            borderRadius: 10,
            border: "1px solid var(--accent)",
            background: "var(--accent)",
            color: "white",
            fontSize: 13,
            fontWeight: 600,
            cursor: "pointer",
            transition: "var(--transition-smooth)",
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.opacity = "0.9";
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.opacity = "1";
          }}
        >
          🖨️ Tisknout
        </button>
      </div>
    </div>
  );
}

// React component for Ticket Document
function TicketDocumentReact({ ticket, companyData, config, design }: { ticket: TicketEx; companyData: any; config: DocumentsConfig; design: string }) {
  const dateStr = new Date(ticket.createdAt).toLocaleDateString("cs-CZ");
  
  // Get design styles
  const getDesignStyles = () => {
    switch (design) {
      case "modern":
        return {
          primaryColor: "#1e40af",
          secondaryColor: "#3b82f6",
          accentColor: "#60a5fa",
          borderColor: "#dbeafe",
          bgColor: "#ffffff",
          headerBg: "transparent",
          headerText: "#1e40af",
          sectionBg: "#ffffff",
          sectionBorder: "2px solid #dbeafe",
        };
      case "minimal":
        return {
          primaryColor: "#1a1a1a",
          secondaryColor: "#6b7280",
          accentColor: "#9ca3af",
          borderColor: "#e5e7eb",
          bgColor: "#ffffff",
          headerBg: "transparent",
          headerText: "#1a1a1a",
          sectionBg: "transparent",
          sectionBorder: "none",
        };
      case "professional":
        return {
          primaryColor: "#0f172a",
          secondaryColor: "#334155",
          accentColor: "#475569",
          borderColor: "#cbd5e1",
          bgColor: "#ffffff",
          headerBg: "transparent",
          headerText: "#0f172a",
          sectionBg: "#ffffff",
          sectionBorder: "1px solid #e2e8f0",
        };
      default: // classic
        return {
          primaryColor: "#1f2937",
          secondaryColor: "#4b5563",
          accentColor: "#6b7280",
          borderColor: "#d1d5db",
          bgColor: "#ffffff",
          headerBg: "#f9fafb",
          headerText: "#1f2937",
          sectionBg: "#ffffff",
          sectionBorder: "1px solid #e5e7eb",
        };
    }
  };
  
  const styles = getDesignStyles();
  
  return (
    <div>
      {/* Header with logo */}
      <div style={{ 
        display: "flex", 
        justifyContent: "space-between", 
        alignItems: "flex-start", 
        marginBottom: 12,
        paddingBottom: 12,
        borderBottom: design === "minimal" ? "1px" : design === "modern" ? "3px" : "2px" + " solid " + styles.borderColor,
      }}>
        <div style={{ flex: 1 }}>
          {config.logoUrl && (
            <img 
              src={config.logoUrl} 
              alt="Logo servisu" 
              style={{ 
                maxWidth: ((config.logoSize ?? 100) / 100) * 120 + "px",
                maxHeight: ((config.logoSize ?? 100) / 100) * 50 + "px",
                marginBottom: 6,
              }} 
            />
          )}
          <h1 style={{ 
            margin: 0, 
            fontSize: design === "modern" ? 20 : design === "professional" ? 18 : 16,
            fontWeight: design === "minimal" ? 500 : design === "modern" ? 800 : 700,
            color: styles.headerText,
          }}>
            Zakázkový list - {ticket.code}
          </h1>
          {config.ticketList?.includeDates && (
            <div style={{ marginTop: 4, fontSize: 11, color: styles.secondaryColor }}>
              Datum: {dateStr}
            </div>
          )}
        </div>
      </div>
      
      {config.ticketList?.includeServiceInfo && companyData && (
        <div style={{ 
          marginBottom: 10,
          background: design === "minimal" ? "transparent" : styles.sectionBg,
          padding: design === "minimal" ? 0 : design === "modern" ? 15 : 12,
          borderRadius: design === "minimal" ? 0 : design === "modern" ? 8 : 6,
          border: design === "minimal" ? "none" : styles.sectionBorder,
        }}>
          <div style={{ 
            fontSize: design === "modern" ? 13 : 12,
            fontWeight: design === "minimal" ? 500 : design === "modern" ? 800 : "bold",
            marginBottom: design === "modern" ? 10 : 6,
            color: styles.secondaryColor,
          }}>
            Servis
          </div>
          {config.serviceInfoConfig?.abbreviation !== false && companyData.abbreviation && (
            <div style={{ fontSize: 11, marginBottom: 4 }}>
              <span style={{ fontWeight: 600, color: styles.secondaryColor, display: "inline-block", minWidth: 140 }}>Zkratka:</span>{" "}
              <span style={{ color: styles.primaryColor }}>{companyData.abbreviation}</span>
            </div>
          )}
          {config.serviceInfoConfig?.name !== false && companyData.name && (
            <div style={{ fontSize: 11, marginBottom: 4 }}>
              <span style={{ fontWeight: 600, color: styles.secondaryColor, display: "inline-block", minWidth: 140 }}>Název:</span>{" "}
              <span style={{ color: styles.primaryColor }}>{companyData.name}</span>
            </div>
          )}
          {config.serviceInfoConfig?.ico !== false && companyData.ico && (
            <div style={{ fontSize: 11, marginBottom: 4 }}>
              <span style={{ fontWeight: 600, color: styles.secondaryColor, display: "inline-block", minWidth: 140 }}>IČO:</span>{" "}
              <span style={{ color: styles.primaryColor }}>{companyData.ico}</span>
            </div>
          )}
          {config.serviceInfoConfig?.dic !== false && companyData.dic && (
            <div style={{ fontSize: 11, marginBottom: 4 }}>
              <span style={{ fontWeight: 600, color: styles.secondaryColor, display: "inline-block", minWidth: 140 }}>DIČ:</span>{" "}
              <span style={{ color: styles.primaryColor }}>{companyData.dic}</span>
            </div>
          )}
          {config.serviceInfoConfig?.addressStreet !== false && (companyData.addressStreet || companyData.addressCity || companyData.addressZip) && (
            <div style={{ fontSize: 11, marginBottom: 4 }}>
              <span style={{ fontWeight: 600, color: styles.secondaryColor, display: "inline-block", minWidth: 140 }}>Adresa:</span>{" "}
              <span style={{ color: styles.primaryColor }}>
                {[
                  (config.serviceInfoConfig?.addressStreet ?? true) ? companyData.addressStreet : null,
                  (config.serviceInfoConfig?.addressCity ?? true) ? companyData.addressCity : null,
                  (config.serviceInfoConfig?.addressZip ?? true) ? companyData.addressZip : null,
                ].filter(Boolean).join(", ")}
              </span>
            </div>
          )}
          {config.serviceInfoConfig?.phone !== false && companyData.phone && (
            <div style={{ fontSize: 11, marginBottom: 4 }}>
              <span style={{ fontWeight: 600, color: styles.secondaryColor, display: "inline-block", minWidth: 140 }}>Telefon:</span>{" "}
              <span style={{ color: styles.primaryColor }}>{companyData.phone}</span>
            </div>
          )}
          {config.serviceInfoConfig?.email !== false && companyData.email && (
            <div style={{ fontSize: 11, marginBottom: 4 }}>
              <span style={{ fontWeight: 600, color: styles.secondaryColor, display: "inline-block", minWidth: 140 }}>E-mail:</span>{" "}
              <span style={{ color: styles.primaryColor }}>{companyData.email}</span>
            </div>
          )}
          {config.serviceInfoConfig?.website !== false && companyData.website && (
            <div style={{ fontSize: 11 }}>
              <span style={{ fontWeight: 600, color: styles.secondaryColor, display: "inline-block", minWidth: 140 }}>Web:</span>{" "}
              <span style={{ color: styles.primaryColor }}>{companyData.website}</span>
            </div>
          )}
        </div>
      )}
      
      {config.ticketList?.includeCustomerInfo && (
        <div style={{ 
          marginBottom: 10,
          background: design === "minimal" ? "transparent" : styles.sectionBg,
          padding: design === "minimal" ? 0 : design === "modern" ? 15 : 12,
          borderRadius: design === "minimal" ? 0 : design === "modern" ? 8 : 6,
          border: design === "minimal" ? "none" : styles.sectionBorder,
        }}>
          <div style={{ 
            fontSize: design === "modern" ? 13 : 12,
            fontWeight: design === "minimal" ? 500 : design === "modern" ? 800 : "bold",
            marginBottom: design === "modern" ? 10 : 6,
            color: styles.secondaryColor,
          }}>
            Zákazník
          </div>
          <div style={{ fontSize: 11, marginBottom: 4 }}>{ticket.customerName}</div>
          {ticket.customerPhone && <div style={{ fontSize: 11, marginBottom: 4 }}>{ticket.customerPhone}</div>}
          {ticket.customerEmail && <div style={{ fontSize: 11 }}>{ticket.customerEmail}</div>}
        </div>
      )}
      
      {config.ticketList?.includeDeviceInfo && (
        <>
          <div style={{ 
            marginBottom: 10,
            background: design === "minimal" ? "transparent" : styles.sectionBg,
            padding: design === "minimal" ? 0 : design === "modern" ? 15 : 12,
            borderRadius: design === "minimal" ? 0 : design === "modern" ? 8 : 6,
            border: design === "minimal" ? "none" : styles.sectionBorder,
          }}>
            <div style={{ 
              fontSize: design === "modern" ? 13 : 12,
              fontWeight: design === "minimal" ? 500 : design === "modern" ? 800 : "bold",
              marginBottom: design === "modern" ? 10 : 6,
              color: styles.secondaryColor,
            }}>
              Zařízení
            </div>
            {config.deviceInfoConfig?.deviceLabel !== false && (
              <div style={{ fontSize: 11, marginBottom: 4 }}>
                <span style={{ fontWeight: 600, color: styles.secondaryColor, display: "inline-block", minWidth: 140 }}>Zařízení:</span>{" "}
                <span style={{ color: styles.primaryColor }}>{ticket.deviceLabel || "—"}</span>
              </div>
            )}
            {config.deviceInfoConfig?.serialOrImei !== false && ticket.serialOrImei && (
              <div style={{ fontSize: 11, marginBottom: 4 }}>
                <span style={{ fontWeight: 600, color: styles.secondaryColor, display: "inline-block", minWidth: 140 }}>SN/IMEI:</span>{" "}
                <span style={{ color: styles.primaryColor }}>{ticket.serialOrImei}</span>
              </div>
            )}
            {config.deviceInfoConfig?.devicePasscode !== false && ticket.devicePasscode && (
              <div style={{ fontSize: 11, marginBottom: 4 }}>
                <span style={{ fontWeight: 600, color: styles.secondaryColor, display: "inline-block", minWidth: 140 }}>Heslo/kód:</span>{" "}
                <span style={{ color: styles.primaryColor }}>{config.deviceInfoConfig?.devicePasscodeVisible ? ticket.devicePasscode : "••••"}</span>
              </div>
            )}
            {config.deviceInfoConfig?.deviceCondition !== false && ticket.deviceCondition && (
              <div style={{ fontSize: 11, marginBottom: 4 }}>
                <span style={{ fontWeight: 600, color: styles.secondaryColor, display: "inline-block", minWidth: 140 }}>Popis stavu:</span>{" "}
                <span style={{ color: styles.primaryColor }}>{ticket.deviceCondition}</span>
              </div>
            )}
            {config.deviceInfoConfig?.requestedRepair !== false && (ticket.requestedRepair || ticket.issueShort) && (
              <div style={{ fontSize: 11, marginBottom: 4 }}>
                <span style={{ fontWeight: 600, color: styles.secondaryColor, display: "inline-block", minWidth: 140 }}>Problém:</span>{" "}
                <span style={{ color: styles.primaryColor }}>{ticket.requestedRepair || ticket.issueShort || "—"}</span>
              </div>
            )}
            {config.deviceInfoConfig?.deviceNote !== false && ticket.deviceNote && (
              <div style={{ fontSize: 11, marginBottom: 4 }}>
                <span style={{ fontWeight: 600, color: styles.secondaryColor, display: "inline-block", minWidth: 140 }}>Poznámka:</span>{" "}
                <span style={{ color: styles.primaryColor }}>{ticket.deviceNote}</span>
              </div>
            )}
            {config.deviceInfoConfig?.handoffMethod !== false && ticket.handoffMethod && (
              <div style={{ fontSize: 11, marginBottom: 4 }}>
                <span style={{ fontWeight: 600, color: styles.secondaryColor, display: "inline-block", minWidth: 140 }}>Předání/převzetí:</span>{" "}
                <span style={{ color: styles.primaryColor }}>{handoffLabelReact(ticket.handoffMethod)}</span>
              </div>
            )}
            {config.deviceInfoConfig?.externalId !== false && ticket.externalId && (
              <div style={{ fontSize: 11 }}>
                <span style={{ fontWeight: 600, color: styles.secondaryColor, display: "inline-block", minWidth: 140 }}>Externí ID:</span>{" "}
                <span style={{ color: styles.primaryColor }}>{ticket.externalId}</span>
              </div>
            )}
          </div>
          <div style={{ borderTop: "1px solid " + styles.borderColor, margin: "8px 0" }} />
        </>
      )}
      
      {config.ticketList?.includeRepairs && ticket.performedRepairs && ticket.performedRepairs.length > 0 && (
        <>
          <div style={{ 
            marginBottom: 10,
            background: design === "minimal" ? "transparent" : styles.sectionBg,
            padding: design === "minimal" ? 0 : design === "modern" ? 15 : 12,
            borderRadius: design === "minimal" ? 0 : design === "modern" ? 8 : 6,
            border: design === "minimal" ? "none" : styles.sectionBorder,
          }}>
            <div style={{ 
              fontSize: design === "modern" ? 13 : 12,
              fontWeight: design === "minimal" ? 500 : design === "modern" ? 800 : "bold",
              marginBottom: design === "modern" ? 10 : 6,
              color: styles.secondaryColor,
            }}>
              Provedené opravy
            </div>
            {ticket.performedRepairs.map((repair) => {
              const priceText = repair.price ? `${repair.price} Kč` : "";
              return (
                <div key={repair.id} style={{ 
                  display: "flex", 
                  justifyContent: "space-between", 
                  alignItems: "center", 
                  marginBottom: 6, 
                  fontSize: 11,
                }}>
                  <span style={{ color: styles.primaryColor }}>• {repair.name}</span>
                  {priceText && (
                    <span style={{ color: styles.primaryColor, fontWeight: 600, textAlign: "right" }}>
                      {priceText}
                    </span>
                  )}
                </div>
              );
            })}
            {(() => {
              const totalPrice = ticket.performedRepairs?.reduce((sum, r) => sum + (r.price || 0), 0) || 0;
              const discountAmount = ticket.discountType === "percentage" && ticket.discountValue 
                ? totalPrice * (ticket.discountValue / 100)
                : ticket.discountType === "amount" && ticket.discountValue
                ? ticket.discountValue
                : 0;
              const finalPrice = totalPrice - discountAmount;
              if (totalPrice > 0) {
                return (
                  <>
                    <div style={{ 
                      marginTop: 8, 
                      paddingTop: 8, 
                      borderTop: "1px solid " + styles.borderColor,
                      display: "flex",
                      justifyContent: "space-between",
                      alignItems: "baseline",
                      gap: 10,
                      fontSize: 11,
                    }}>
                      <span style={{ fontWeight: 600, color: styles.secondaryColor }}>Celkem:</span>
                      <span style={{ color: styles.primaryColor, textAlign: "right" }}>{totalPrice} Kč</span>
                    </div>
                    {discountAmount > 0 && (
                      <div style={{ 
                        display: "flex",
                        justifyContent: "space-between",
                        alignItems: "baseline",
                        gap: 10,
                        fontSize: 11,
                      }}>
                        <span style={{ fontWeight: 600, color: styles.secondaryColor }}>
                          {ticket.discountType === "percentage" 
                            ? `Sleva ${ticket.discountValue}%`
                            : `Sleva ${ticket.discountValue} Kč`}:
                        </span>
                        <span style={{ color: styles.primaryColor, textAlign: "right" }}>
                          -{discountAmount.toFixed(2)} Kč
                        </span>
                      </div>
                    )}
                    <div style={{ 
                      marginTop: 10, 
                      paddingTop: 10, 
                      borderTop: "2px solid " + styles.primaryColor,
                      display: "flex",
                      justifyContent: "space-between",
                      alignItems: "baseline",
                      gap: 10,
                      fontWeight: 700,
                      fontSize: 13,
                    }}>
                      <span style={{ fontSize: 13, fontWeight: 700, color: styles.secondaryColor }}>Konečná cena:</span>
                      <span style={{ fontSize: 14, fontWeight: 800, color: styles.primaryColor, textAlign: "right" }}>
                        {finalPrice.toFixed(2)} Kč
                      </span>
                    </div>
                  </>
                );
              }
              return null;
            })()}
          </div>
          <div style={{ borderTop: "1px solid " + styles.borderColor, margin: "8px 0" }} />
        </>
      )}
      
      {config.ticketList?.includeDiagnostic && ticket.diagnosticText && (
        <>
          <div style={{ 
            marginBottom: 10,
            background: design === "minimal" ? "transparent" : styles.sectionBg,
            padding: design === "minimal" ? 0 : design === "modern" ? 15 : 12,
            borderRadius: design === "minimal" ? 0 : design === "modern" ? 8 : 6,
            border: design === "minimal" ? "none" : styles.sectionBorder,
          }}>
            <div style={{ 
              fontSize: design === "modern" ? 13 : 12,
              fontWeight: design === "minimal" ? 500 : design === "modern" ? 800 : "bold",
              marginBottom: design === "modern" ? 10 : 6,
              color: styles.secondaryColor,
            }}>
              Diagnostika
            </div>
            <div style={{ fontSize: 11, color: styles.primaryColor }}>{ticket.diagnosticText}</div>
          </div>
          <div style={{ borderTop: "1px solid " + styles.borderColor, margin: "8px 0" }} />
        </>
      )}
      
      {config.ticketList?.includePhotos && ticket.diagnosticPhotos && ticket.diagnosticPhotos.length > 0 && (
        <>
          <div style={{ 
            marginBottom: 10,
            background: design === "minimal" ? "transparent" : styles.sectionBg,
            padding: design === "minimal" ? 0 : design === "modern" ? 15 : 12,
            borderRadius: design === "minimal" ? 0 : design === "modern" ? 8 : 6,
            border: design === "minimal" ? "none" : styles.sectionBorder,
          }}>
            <div style={{ 
              fontSize: design === "modern" ? 13 : 12,
              fontWeight: design === "minimal" ? 500 : design === "modern" ? 800 : "bold",
              marginBottom: design === "modern" ? 10 : 6,
              color: styles.secondaryColor,
            }}>
              Diagnostické fotografie
            </div>
            <div style={{ 
              display: "grid",
              gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))",
              gap: 15,
              margin: "15px 0",
            }}>
              {ticket.diagnosticPhotos.map((photoUrl, idx) => (
                <div key={idx} style={{ border: "1px solid #ddd", borderRadius: 8, overflow: "hidden" }}>
                  <img src={photoUrl} alt="Diagnostická fotografie" style={{ width: "100%", height: "auto", display: "block" }} />
                </div>
              ))}
            </div>
          </div>
          <div style={{ borderTop: "1px solid " + styles.borderColor, margin: "8px 0" }} />
        </>
      )}
      
      {config.ticketList?.legalText && (
        <div style={{ 
          marginTop: 12, 
          padding: 10,
          background: styles.bgColor,
          border: "1px solid " + styles.borderColor,
          borderRadius: 6,
          fontSize: 9, 
          color: styles.secondaryColor,
          lineHeight: 1.4,
        }}>
          {config.ticketList.legalText}
        </div>
      )}
      
      {/* Signatures */}
      <div style={{ 
        marginTop: 12,
        display: "grid",
        gridTemplateColumns: "1fr 1fr 1fr",
        gap: 20,
        paddingTop: 10,
        borderTop: "1px solid " + styles.borderColor,
      }}>
        <div style={{ textAlign: "center", display: "flex", flexDirection: "column", alignItems: "center", minHeight: 80 }}>
          <div style={{ borderTop: "1px solid " + styles.primaryColor, width: 200, marginTop: "auto", marginBottom: 3 }} />
          <div style={{ fontSize: 9, color: styles.secondaryColor }}>Podpis zákazníka - při předání</div>
        </div>
        <div style={{ textAlign: "center", display: "flex", flexDirection: "column", alignItems: "center", minHeight: 80 }}>
          <div style={{ borderTop: "1px solid " + styles.primaryColor, width: 200, marginTop: "auto", marginBottom: 3 }} />
          <div style={{ fontSize: 9, color: styles.secondaryColor }}>Podpis zákazníka - při odevzdání servisem</div>
        </div>
        <div style={{ textAlign: "center", display: "flex", flexDirection: "column", alignItems: "center", minHeight: 80 }}>
          {config.ticketList?.includeStamp && config.stampUrl && (
            <img 
              src={config.stampUrl} 
              alt="Razítko servisu" 
              style={{ 
                maxWidth: ((config.stampSize ?? 100) / 100) * 120 + "px",
                maxHeight: ((config.stampSize ?? 100) / 100) * 60 + "px",
                marginBottom: "auto",
                marginTop: 0,
              }} 
            />
          )}
          <div style={{ borderTop: "1px solid " + styles.primaryColor, width: 200, marginTop: "auto", marginBottom: 3 }} />
          <div style={{ fontSize: 9, color: styles.secondaryColor }}>Razítko servisu</div>
        </div>
      </div>
    </div>
  );
}

// Helper function for warranty unit text
function formatWarrantyUnit(duration: number, unit: "days" | "months" | "years"): string {
  if (unit === "days") {
    if (duration === 1) return "den";
    else if (duration >= 2 && duration <= 4) return "dny";
    else return "dnů";
  } else if (unit === "months") {
    if (duration === 1) return "měsíc";
    else if (duration >= 2 && duration <= 4) return "měsíce";
    else return "měsíců";
  } else {
    if (duration === 1) return "rok";
    else if (duration >= 2 && duration <= 4) return "roky";
    else return "let";
  }
}

// Helper function for handoff label (used in TicketDocumentReact)
function handoffLabelReact(m?: "branch" | "courier" | "post"): string {
  if (m === "courier") return "Kurýrem";
  if (m === "post") return "Poštou";
  return "Na pobočce";
}

// React component for Diagnostic Protocol Document
function DiagnosticDocumentReact({ ticket, companyData, config, design }: { ticket: TicketEx; companyData: any; config: DocumentsConfig; design: string }) {
  const dateStr = new Date(ticket.createdAt).toLocaleDateString("cs-CZ");
  const dateTimeStr = new Date(ticket.createdAt).toLocaleString("cs-CZ");
  
  // Get design styles
  const getDesignStyles = () => {
    switch (design) {
      case "modern":
        return {
          primaryColor: "#1e40af",
          secondaryColor: "#3b82f6",
          accentColor: "#60a5fa",
          borderColor: "#dbeafe",
          bgColor: "#ffffff",
          headerBg: "transparent",
          headerText: "#1e40af",
          sectionBg: "#ffffff",
          sectionBorder: "2px solid #dbeafe",
        };
      case "minimal":
        return {
          primaryColor: "#1a1a1a",
          secondaryColor: "#6b7280",
          accentColor: "#9ca3af",
          borderColor: "#e5e7eb",
          bgColor: "#ffffff",
          headerBg: "transparent",
          headerText: "#1a1a1a",
          sectionBg: "transparent",
          sectionBorder: "none",
        };
      case "professional":
        return {
          primaryColor: "#0f172a",
          secondaryColor: "#334155",
          accentColor: "#475569",
          borderColor: "#cbd5e1",
          bgColor: "#ffffff",
          headerBg: "transparent",
          headerText: "#0f172a",
          sectionBg: "#ffffff",
          sectionBorder: "1px solid #e2e8f0",
        };
      default: // classic
        return {
          primaryColor: "#1f2937",
          secondaryColor: "#4b5563",
          accentColor: "#6b7280",
          borderColor: "#d1d5db",
          bgColor: "#ffffff",
          headerBg: "#f9fafb",
          headerText: "#1f2937",
          sectionBg: "#ffffff",
          sectionBorder: "1px solid #e5e7eb",
        };
    }
  };
  
  const styles = getDesignStyles();
  
  return (
    <div>
      {/* Header with logo */}
      <div style={{ 
        display: "flex", 
        justifyContent: "space-between", 
        alignItems: "flex-start", 
        marginBottom: 12,
        paddingBottom: 12,
        borderBottom: design === "minimal" ? "1px" : design === "modern" ? "3px" : "2px" + " solid " + styles.borderColor,
      }}>
        <div style={{ flex: 1 }}>
          {config.logoUrl && (
            <img 
              src={config.logoUrl} 
              alt="Logo servisu" 
              style={{ 
                maxWidth: ((config.logoSize ?? 100) / 100) * 120 + "px",
                maxHeight: ((config.logoSize ?? 100) / 100) * 50 + "px",
                marginBottom: 6,
              }} 
            />
          )}
          <h1 style={{ 
            margin: 0, 
            fontSize: design === "modern" ? 20 : design === "professional" ? 18 : 16,
            fontWeight: design === "minimal" ? 500 : design === "modern" ? 800 : 700,
            color: styles.headerText,
          }}>
            Diagnostický protokol - {ticket.code}
          </h1>
          <div style={{ marginTop: 4, fontSize: 11, color: styles.secondaryColor }}>
            Datum: {dateStr}
          </div>
        </div>
      </div>
      
      {config.diagnosticProtocol?.includeServiceInfo && companyData && (companyData.name || companyData.addressStreet) && (
        <>
          <div style={{ 
            marginBottom: 10,
            background: design === "minimal" ? "transparent" : styles.sectionBg,
            padding: design === "minimal" ? 0 : design === "modern" ? 15 : 12,
            borderRadius: design === "minimal" ? 0 : design === "modern" ? 8 : 6,
            border: design === "minimal" ? "none" : styles.sectionBorder,
          }}>
            <div style={{ 
              fontSize: design === "modern" ? 13 : 12,
              fontWeight: design === "minimal" ? 500 : design === "modern" ? 800 : "bold",
              marginBottom: design === "modern" ? 10 : 6,
              color: styles.secondaryColor,
            }}>
              Servis
            </div>
            {(config.serviceInfoConfig?.abbreviation ?? true) && companyData.abbreviation && (
              <div style={{ fontSize: 11, marginBottom: 4 }}>
                <span style={{ fontWeight: 600, color: styles.secondaryColor, display: "inline-block", minWidth: 140 }}>Zkratka:</span>{" "}
                <span style={{ color: styles.primaryColor }}>{companyData.abbreviation}</span>
              </div>
            )}
            {(config.serviceInfoConfig?.name ?? true) && companyData.name && (
              <div style={{ fontSize: 11, marginBottom: 4 }}>
                <span style={{ fontWeight: 600, color: styles.secondaryColor, display: "inline-block", minWidth: 140 }}>Název:</span>{" "}
                <span style={{ color: styles.primaryColor }}>{companyData.name}</span>
              </div>
            )}
            {(config.serviceInfoConfig?.ico ?? true) && companyData.ico && (
              <div style={{ fontSize: 11, marginBottom: 4 }}>
                <span style={{ fontWeight: 600, color: styles.secondaryColor, display: "inline-block", minWidth: 140 }}>IČO:</span>{" "}
                <span style={{ color: styles.primaryColor }}>{companyData.ico}</span>
              </div>
            )}
            {(config.serviceInfoConfig?.dic ?? true) && companyData.dic && (
              <div style={{ fontSize: 11, marginBottom: 4 }}>
                <span style={{ fontWeight: 600, color: styles.secondaryColor, display: "inline-block", minWidth: 140 }}>DIČ:</span>{" "}
                <span style={{ color: styles.primaryColor }}>{companyData.dic}</span>
              </div>
            )}
            {((config.serviceInfoConfig?.addressStreet ?? true) || (config.serviceInfoConfig?.addressCity ?? true) || (config.serviceInfoConfig?.addressZip ?? true)) && (companyData.addressStreet || companyData.addressCity || companyData.addressZip) && (
              <div style={{ fontSize: 11, marginBottom: 4 }}>
                <span style={{ fontWeight: 600, color: styles.secondaryColor, display: "inline-block", minWidth: 140 }}>Adresa:</span>{" "}
                <span style={{ color: styles.primaryColor }}>
                  {[
                    (config.serviceInfoConfig?.addressStreet ?? true) ? companyData.addressStreet : null,
                    (config.serviceInfoConfig?.addressCity ?? true) ? companyData.addressCity : null,
                    (config.serviceInfoConfig?.addressZip ?? true) ? companyData.addressZip : null,
                  ].filter(Boolean).join(", ")}
                </span>
              </div>
            )}
            {(config.serviceInfoConfig?.phone ?? true) && companyData.phone && (
              <div style={{ fontSize: 11, marginBottom: 4 }}>
                <span style={{ fontWeight: 600, color: styles.secondaryColor, display: "inline-block", minWidth: 140 }}>Telefon:</span>{" "}
                <span style={{ color: styles.primaryColor }}>{companyData.phone}</span>
              </div>
            )}
            {(config.serviceInfoConfig?.email ?? true) && companyData.email && (
              <div style={{ fontSize: 11, marginBottom: 4 }}>
                <span style={{ fontWeight: 600, color: styles.secondaryColor, display: "inline-block", minWidth: 140 }}>E-mail:</span>{" "}
                <span style={{ color: styles.primaryColor }}>{companyData.email}</span>
              </div>
            )}
            {(config.serviceInfoConfig?.website ?? true) && companyData.website && (
              <div style={{ fontSize: 11 }}>
                <span style={{ fontWeight: 600, color: styles.secondaryColor, display: "inline-block", minWidth: 140 }}>Web:</span>{" "}
                <span style={{ color: styles.primaryColor }}>{companyData.website}</span>
              </div>
            )}
          </div>
          <div style={{ borderTop: "1px solid " + styles.borderColor, margin: "8px 0" }} />
        </>
      )}
      
      {config.diagnosticProtocol?.includeCustomerInfo && (
        <>
          <div style={{ 
            marginBottom: 10,
            background: design === "minimal" ? "transparent" : styles.sectionBg,
            padding: design === "minimal" ? 0 : design === "modern" ? 15 : 12,
            borderRadius: design === "minimal" ? 0 : design === "modern" ? 8 : 6,
            border: design === "minimal" ? "none" : styles.sectionBorder,
          }}>
            <div style={{ 
              fontSize: design === "modern" ? 13 : 12,
              fontWeight: design === "minimal" ? 500 : design === "modern" ? 800 : "bold",
              marginBottom: design === "modern" ? 10 : 6,
              color: styles.secondaryColor,
            }}>
              Zákazník
            </div>
            <div style={{ fontSize: 11, marginBottom: 4 }}>
              <span style={{ fontWeight: 600, color: styles.secondaryColor, display: "inline-block", minWidth: 140 }}>Jméno:</span>{" "}
              <span style={{ color: styles.primaryColor }}>{ticket.customerName || "—"}</span>
            </div>
            {ticket.customerPhone && (
              <div style={{ fontSize: 11, marginBottom: 4 }}>
                <span style={{ fontWeight: 600, color: styles.secondaryColor, display: "inline-block", minWidth: 140 }}>Telefon:</span>{" "}
                <span style={{ color: styles.primaryColor }}>{ticket.customerPhone}</span>
              </div>
            )}
            {ticket.customerEmail && (
              <div style={{ fontSize: 11 }}>
                <span style={{ fontWeight: 600, color: styles.secondaryColor, display: "inline-block", minWidth: 140 }}>E-mail:</span>{" "}
                <span style={{ color: styles.primaryColor }}>{ticket.customerEmail}</span>
              </div>
            )}
          </div>
          <div style={{ borderTop: "1px solid " + styles.borderColor, margin: "8px 0" }} />
        </>
      )}
      
      {config.diagnosticProtocol?.includeDeviceInfo && (
        <>
          <div style={{ 
            marginBottom: 10,
            background: design === "minimal" ? "transparent" : styles.sectionBg,
            padding: design === "minimal" ? 0 : design === "modern" ? 15 : 12,
            borderRadius: design === "minimal" ? 0 : design === "modern" ? 8 : 6,
            border: design === "minimal" ? "none" : styles.sectionBorder,
          }}>
            <div style={{ 
              fontSize: design === "modern" ? 13 : 12,
              fontWeight: design === "minimal" ? 500 : design === "modern" ? 800 : "bold",
              marginBottom: design === "modern" ? 10 : 6,
              color: styles.secondaryColor,
            }}>
              Zařízení
            </div>
            <div style={{ fontSize: 11, marginBottom: 4 }}>
              <span style={{ fontWeight: 600, color: styles.secondaryColor, display: "inline-block", minWidth: 140 }}>Zařízení:</span>{" "}
              <span style={{ color: styles.primaryColor }}>{ticket.deviceLabel || "—"}</span>
            </div>
            {ticket.serialOrImei && (
              <div style={{ fontSize: 11, marginBottom: 4 }}>
                <span style={{ fontWeight: 600, color: styles.secondaryColor, display: "inline-block", minWidth: 140 }}>SN/IMEI:</span>{" "}
                <span style={{ color: styles.primaryColor }}>{ticket.serialOrImei}</span>
              </div>
            )}
            {config.diagnosticProtocol?.includeDates && (
              <div style={{ fontSize: 11 }}>
                <span style={{ fontWeight: 600, color: styles.secondaryColor, display: "inline-block", minWidth: 140 }}>Datum:</span>{" "}
                <span style={{ color: styles.primaryColor }}>{dateTimeStr}</span>
              </div>
            )}
          </div>
          <div style={{ borderTop: "1px solid " + styles.borderColor, margin: "8px 0" }} />
        </>
      )}
      
      {config.diagnosticProtocol?.includeDiagnosticText && (
        <>
          <div style={{ 
            marginBottom: 10,
            background: design === "minimal" ? "transparent" : styles.sectionBg,
            padding: design === "minimal" ? 0 : design === "modern" ? 15 : 12,
            borderRadius: design === "minimal" ? 0 : design === "modern" ? 8 : 6,
            border: design === "minimal" ? "none" : styles.sectionBorder,
          }}>
            <div style={{ 
              fontSize: design === "modern" ? 13 : 12,
              fontWeight: design === "minimal" ? 500 : design === "modern" ? 800 : "bold",
              marginBottom: design === "modern" ? 10 : 6,
              color: styles.secondaryColor,
            }}>
              Výsledky diagnostiky
            </div>
            {ticket.diagnosticText ? (
              <div style={{ 
                padding: 8,
                background: styles.bgColor,
                borderRadius: 6,
                whiteSpace: "pre-wrap",
                lineHeight: 1.4,
                margin: "6px 0",
                fontSize: 11,
                color: styles.primaryColor,
              }}>
                {ticket.diagnosticText}
              </div>
            ) : (
              <div style={{ fontSize: 11, color: styles.primaryColor }}>
                Diagnostika nebyla zadána.
              </div>
            )}
          </div>
          <div style={{ borderTop: "1px solid " + styles.borderColor, margin: "8px 0" }} />
        </>
      )}
      
      {config.diagnosticProtocol?.includePhotos && ticket.diagnosticPhotos && ticket.diagnosticPhotos.length > 0 && (
        <>
          <div style={{ 
            marginBottom: 10,
            background: design === "minimal" ? "transparent" : styles.sectionBg,
            padding: design === "minimal" ? 0 : design === "modern" ? 15 : 12,
            borderRadius: design === "minimal" ? 0 : design === "modern" ? 8 : 6,
            border: design === "minimal" ? "none" : styles.sectionBorder,
          }}>
            <div style={{ 
              fontSize: design === "modern" ? 13 : 12,
              fontWeight: design === "minimal" ? 500 : design === "modern" ? 800 : "bold",
              marginBottom: design === "modern" ? 10 : 6,
              color: styles.secondaryColor,
            }}>
              Diagnostické fotografie
            </div>
            <div style={{ 
              display: "grid",
              gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))",
              gap: 15,
              margin: "15px 0",
            }}>
              {ticket.diagnosticPhotos.map((photoUrl, idx) => (
                <div key={idx} style={{ border: "1px solid #ddd", borderRadius: 8, overflow: "hidden" }}>
                  <img src={photoUrl} alt="Diagnostická fotografie" style={{ width: "100%", height: "auto", display: "block" }} />
                </div>
              ))}
            </div>
          </div>
          <div style={{ borderTop: "1px solid " + styles.borderColor, margin: "8px 0" }} />
        </>
      )}
      
      {config.diagnosticProtocol?.includeDates && (
        <div style={{ 
          marginBottom: 10,
          background: design === "minimal" ? "transparent" : styles.sectionBg,
          padding: design === "minimal" ? "0 0 0 50px" : design === "modern" ? "15px 15px 15px 65px" : "12px 12px 12px 62px",
          borderRadius: design === "minimal" ? 0 : design === "modern" ? 8 : 6,
          border: design === "minimal" ? "none" : styles.sectionBorder,
        }}>
          <div style={{ fontSize: 11 }}>
            <span style={{ fontWeight: 600, color: styles.secondaryColor, display: "inline-block", minWidth: 140 }}>Datum vytvoření protokolu:</span>{" "}
            <span style={{ color: styles.primaryColor }}>{new Date().toLocaleString("cs-CZ")}</span>
          </div>
        </div>
      )}
      
      {config.diagnosticProtocol?.legalText && (
        <div style={{ 
          marginTop: 12, 
          padding: 10,
          background: styles.bgColor,
          border: "1px solid " + styles.borderColor,
          borderRadius: 6,
          fontSize: 9, 
          color: styles.secondaryColor,
          lineHeight: 1.4,
        }}>
          {config.diagnosticProtocol.legalText}
        </div>
      )}
      
      {/* Signature */}
      <div style={{ 
        marginTop: 12,
        textAlign: "center",
        paddingTop: 10,
        borderTop: "1px solid " + styles.borderColor,
      }}>
        <div style={{ 
          borderTop: "1px solid " + styles.primaryColor, 
          marginTop: design === "minimal" ? 20 : 30,
          marginBottom: 3,
          height: 1,
          width: 200,
          marginLeft: "auto",
          marginRight: "auto",
        }} />
        <div style={{ fontSize: 9, color: styles.secondaryColor }}>
          Razítko servisu
        </div>
        {config.stampUrl && (
          <img 
            src={config.stampUrl} 
            alt="Razítko servisu" 
            style={{ 
              maxWidth: ((config.stampSize ?? 100) / 100) * 120 + "px",
              maxHeight: ((config.stampSize ?? 100) / 100) * 60 + "px",
              marginTop: 10,
            }} 
          />
        )}
      </div>
    </div>
  );
}

// React component for Warranty Certificate Document
function WarrantyDocumentReact({ ticket, companyData, config, design }: { ticket: TicketEx; companyData: any; config: DocumentsConfig; design: string }) {
  const dateStr = new Date(ticket.createdAt).toLocaleDateString("cs-CZ");
  const dateTimeStr = new Date(ticket.createdAt).toLocaleString("cs-CZ");
  
  // Get design styles
  const getDesignStyles = () => {
    switch (design) {
      case "modern":
        return {
          primaryColor: "#1e40af",
          secondaryColor: "#3b82f6",
          accentColor: "#60a5fa",
          borderColor: "#dbeafe",
          bgColor: "#ffffff",
          headerBg: "transparent",
          headerText: "#1e40af",
          sectionBg: "#ffffff",
          sectionBorder: "2px solid #dbeafe",
        };
      case "minimal":
        return {
          primaryColor: "#1a1a1a",
          secondaryColor: "#6b7280",
          accentColor: "#9ca3af",
          borderColor: "#e5e7eb",
          bgColor: "#ffffff",
          headerBg: "transparent",
          headerText: "#1a1a1a",
          sectionBg: "transparent",
          sectionBorder: "none",
        };
      case "professional":
        return {
          primaryColor: "#0f172a",
          secondaryColor: "#334155",
          accentColor: "#475569",
          borderColor: "#cbd5e1",
          bgColor: "#ffffff",
          headerBg: "transparent",
          headerText: "#0f172a",
          sectionBg: "#ffffff",
          sectionBorder: "1px solid #e2e8f0",
        };
      default: // classic
        return {
          primaryColor: "#1f2937",
          secondaryColor: "#4b5563",
          accentColor: "#6b7280",
          borderColor: "#d1d5db",
          bgColor: "#ffffff",
          headerBg: "#f9fafb",
          headerText: "#1f2937",
          sectionBg: "#ffffff",
          sectionBorder: "1px solid #e5e7eb",
        };
    }
  };
  
  const styles = getDesignStyles();
  
  // Calculate review URL
  const reviewUrl = config.reviewUrlType === "google" && config.googlePlaceId
    ? `https://search.google.com/local/writereview?placeid=${config.googlePlaceId}`
    : config.reviewUrl;
  
  // Calculate prices
  const totalPrice = ticket.performedRepairs?.reduce((sum, r) => sum + (r.price || 0), 0) || 0;
  const discountAmount = ticket.discountType === "percentage" && ticket.discountValue 
    ? totalPrice * (ticket.discountValue / 100)
    : ticket.discountType === "amount" && ticket.discountValue
    ? ticket.discountValue
    : 0;
  const finalPrice = totalPrice - discountAmount;
  
  return (
    <div>
      {/* Header with logo and QR code */}
      <div style={{ 
        display: "flex", 
        justifyContent: "space-between", 
        alignItems: "flex-start", 
        marginBottom: 12,
        paddingBottom: 12,
        borderBottom: design === "minimal" ? "1px" : design === "modern" ? "3px" : "2px" + " solid " + styles.borderColor,
      }}>
        <div style={{ flex: 1 }}>
          {config.logoUrl && (
            <img 
              src={config.logoUrl} 
              alt="Logo servisu" 
              style={{ 
                maxWidth: ((config.logoSize ?? 100) / 100) * 120 + "px",
                maxHeight: ((config.logoSize ?? 100) / 100) * 50 + "px",
                marginBottom: 6,
              }} 
            />
          )}
          <h1 style={{ 
            margin: 0, 
            fontSize: design === "modern" ? 20 : design === "professional" ? 18 : 16,
            fontWeight: design === "minimal" ? 500 : design === "modern" ? 800 : 700,
            color: styles.headerText,
          }}>
            Záruční list - {ticket.code}
          </h1>
          <div style={{ marginTop: 4, fontSize: 11, color: styles.secondaryColor }}>
            Datum: {dateStr}
          </div>
        </div>
        {reviewUrl && (
          <div style={{ 
            flexShrink: 0,
            marginLeft: 20,
            display: "flex",
            alignItems: "center",
            gap: 12,
          }}>
            <div style={{ 
              textAlign: "right", 
              fontSize: 11, 
              color: styles.secondaryColor, 
              maxWidth: 150,
            }}>
              {config.reviewText || "Budeme rádi za Vaši recenzi"}
            </div>
            <img 
              src={`https://api.qrserver.com/v1/create-qr-code/?size=${config.qrCodeSize ?? 120}x${config.qrCodeSize ?? 120}&ecc=L&data=${encodeURIComponent(reviewUrl)}`} 
              alt="QR" 
              style={{ 
                width: (config.qrCodeSize ?? 120) + "px", 
                height: (config.qrCodeSize ?? 120) + "px", 
                display: "block",
                flexShrink: 0,
              }} 
            />
          </div>
        )}
      </div>
      
      {config.warrantyCertificate?.includeServiceInfo && companyData && (companyData.name || companyData.addressStreet) && (
        <>
          <div style={{ 
            marginBottom: 10,
            background: design === "minimal" ? "transparent" : styles.sectionBg,
            padding: design === "minimal" ? 0 : design === "modern" ? 15 : 12,
            borderRadius: design === "minimal" ? 0 : design === "modern" ? 8 : 6,
            border: design === "minimal" ? "none" : styles.sectionBorder,
          }}>
            <div style={{ 
              fontSize: design === "modern" ? 13 : 12,
              fontWeight: design === "minimal" ? 500 : design === "modern" ? 800 : "bold",
              marginBottom: design === "modern" ? 10 : 6,
              color: styles.secondaryColor,
            }}>
              Servis
            </div>
            {companyData.name && (
              <div style={{ fontSize: 11, marginBottom: 4 }}>
                <span style={{ fontWeight: 600, color: styles.secondaryColor, display: "inline-block", minWidth: 140 }}>Název:</span>{" "}
                <span style={{ color: styles.primaryColor }}>{companyData.name}</span>
              </div>
            )}
            {(companyData.addressStreet || companyData.addressCity || companyData.addressZip) && (
              <div style={{ fontSize: 11, marginBottom: 4 }}>
                <span style={{ fontWeight: 600, color: styles.secondaryColor, display: "inline-block", minWidth: 140 }}>Adresa:</span>{" "}
                <span style={{ color: styles.primaryColor }}>
                  {[companyData.addressStreet, companyData.addressCity, companyData.addressZip].filter(Boolean).join(", ")}
                </span>
              </div>
            )}
            {companyData.phone && (
              <div style={{ fontSize: 11, marginBottom: 4 }}>
                <span style={{ fontWeight: 600, color: styles.secondaryColor, display: "inline-block", minWidth: 140 }}>Telefon:</span>{" "}
                <span style={{ color: styles.primaryColor }}>{companyData.phone}</span>
              </div>
            )}
            {companyData.email && (
              <div style={{ fontSize: 11, marginBottom: 4 }}>
                <span style={{ fontWeight: 600, color: styles.secondaryColor, display: "inline-block", minWidth: 140 }}>E-mail:</span>{" "}
                <span style={{ color: styles.primaryColor }}>{companyData.email}</span>
              </div>
            )}
            {companyData.ico && (
              <div style={{ fontSize: 11, marginBottom: 4 }}>
                <span style={{ fontWeight: 600, color: styles.secondaryColor, display: "inline-block", minWidth: 140 }}>IČO:</span>{" "}
                <span style={{ color: styles.primaryColor }}>{companyData.ico}</span>
              </div>
            )}
            {companyData.dic && (
              <div style={{ fontSize: 11 }}>
                <span style={{ fontWeight: 600, color: styles.secondaryColor, display: "inline-block", minWidth: 140 }}>DIČ:</span>{" "}
                <span style={{ color: styles.primaryColor }}>{companyData.dic}</span>
              </div>
            )}
          </div>
          <div style={{ borderTop: "1px solid " + styles.borderColor, margin: "8px 0" }} />
        </>
      )}
      
      {config.warrantyCertificate?.includeCustomerInfo && (
        <>
          <div style={{ 
            marginBottom: 10,
            background: design === "minimal" ? "transparent" : styles.sectionBg,
            padding: design === "minimal" ? 0 : design === "modern" ? 15 : 12,
            borderRadius: design === "minimal" ? 0 : design === "modern" ? 8 : 6,
            border: design === "minimal" ? "none" : styles.sectionBorder,
          }}>
            <div style={{ 
              fontSize: design === "modern" ? 13 : 12,
              fontWeight: design === "minimal" ? 500 : design === "modern" ? 800 : "bold",
              marginBottom: design === "modern" ? 10 : 6,
              color: styles.secondaryColor,
            }}>
              Zákazník
            </div>
            <div style={{ fontSize: 11, marginBottom: 4 }}>
              <span style={{ fontWeight: 600, color: styles.secondaryColor, display: "inline-block", minWidth: 140 }}>Jméno:</span>{" "}
              <span style={{ color: styles.primaryColor }}>{ticket.customerName || "—"}</span>
            </div>
            {ticket.customerPhone && (
              <div style={{ fontSize: 11, marginBottom: 4 }}>
                <span style={{ fontWeight: 600, color: styles.secondaryColor, display: "inline-block", minWidth: 140 }}>Telefon:</span>{" "}
                <span style={{ color: styles.primaryColor }}>{ticket.customerPhone}</span>
              </div>
            )}
            {ticket.customerEmail && (
              <div style={{ fontSize: 11 }}>
                <span style={{ fontWeight: 600, color: styles.secondaryColor, display: "inline-block", minWidth: 140 }}>E-mail:</span>{" "}
                <span style={{ color: styles.primaryColor }}>{ticket.customerEmail}</span>
              </div>
            )}
          </div>
          <div style={{ borderTop: "1px solid " + styles.borderColor, margin: "8px 0" }} />
        </>
      )}
      
      {config.warrantyCertificate?.includeDeviceInfo && (
        <>
          <div style={{ 
            marginBottom: 10,
            background: design === "minimal" ? "transparent" : styles.sectionBg,
            padding: design === "minimal" ? 0 : design === "modern" ? 15 : 12,
            borderRadius: design === "minimal" ? 0 : design === "modern" ? 8 : 6,
            border: design === "minimal" ? "none" : styles.sectionBorder,
          }}>
            <div style={{ 
              fontSize: design === "modern" ? 13 : 12,
              fontWeight: design === "minimal" ? 500 : design === "modern" ? 800 : "bold",
              marginBottom: design === "modern" ? 10 : 6,
              color: styles.secondaryColor,
            }}>
              Zařízení
            </div>
            <div style={{ fontSize: 11, marginBottom: 4 }}>
              <span style={{ fontWeight: 600, color: styles.secondaryColor, display: "inline-block", minWidth: 140 }}>Zařízení:</span>{" "}
              <span style={{ color: styles.primaryColor }}>{ticket.deviceLabel || "—"}</span>
            </div>
            {ticket.serialOrImei && (
              <div style={{ fontSize: 11, marginBottom: 4 }}>
                <span style={{ fontWeight: 600, color: styles.secondaryColor, display: "inline-block", minWidth: 140 }}>SN/IMEI:</span>{" "}
                <span style={{ color: styles.primaryColor }}>{ticket.serialOrImei}</span>
              </div>
            )}
          </div>
          <div style={{ borderTop: "1px solid " + styles.borderColor, margin: "8px 0" }} />
        </>
      )}
      
      {config.warrantyCertificate?.includeRepairs && ticket.performedRepairs && ticket.performedRepairs.length > 0 && (
        <>
          <div style={{ 
            marginBottom: 10,
            background: design === "minimal" ? "transparent" : styles.sectionBg,
            padding: design === "minimal" ? 0 : design === "modern" ? 15 : 12,
            borderRadius: design === "minimal" ? 0 : design === "modern" ? 8 : 6,
            border: design === "minimal" ? "none" : styles.sectionBorder,
          }}>
            <div style={{ 
              fontSize: design === "modern" ? 13 : 12,
              fontWeight: design === "minimal" ? 500 : design === "modern" ? 800 : "bold",
              marginBottom: design === "modern" ? 10 : 6,
              color: styles.secondaryColor,
            }}>
              Provedené opravy
            </div>
            {ticket.performedRepairs.map((repair) => (
              <div key={repair.id} style={{ 
                display: "flex", 
                justifyContent: "space-between", 
                alignItems: "center", 
                marginBottom: 6, 
                fontSize: 11,
              }}>
                <span style={{ color: styles.primaryColor }}>• {repair.name}</span>
                {repair.price && (
                  <span style={{ color: styles.primaryColor, fontWeight: 600, textAlign: "right" }}>
                    {repair.price} Kč
                  </span>
                )}
              </div>
            ))}
            {totalPrice > 0 && (
              <>
                <div style={{ 
                  marginTop: 8, 
                  paddingTop: 8, 
                  borderTop: "1px solid " + styles.borderColor,
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "baseline",
                  gap: 10,
                  fontSize: 11,
                }}>
                  <span style={{ fontWeight: 600, color: styles.secondaryColor }}>Celkem:</span>
                  <span style={{ color: styles.primaryColor, textAlign: "right" }}>{totalPrice} Kč</span>
                </div>
                {discountAmount > 0 && (
                  <div style={{ 
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "baseline",
                    gap: 10,
                    fontSize: 11,
                  }}>
                    <span style={{ fontWeight: 600, color: styles.secondaryColor }}>
                      {ticket.discountType === "percentage" 
                        ? `Sleva ${ticket.discountValue}%`
                        : `Sleva ${ticket.discountValue} Kč`}:
                    </span>
                    <span style={{ color: styles.primaryColor, textAlign: "right" }}>
                      -{discountAmount.toFixed(2)} Kč
                    </span>
                  </div>
                )}
                <div style={{ 
                  marginTop: 10, 
                  paddingTop: 10, 
                  borderTop: "2px solid " + styles.primaryColor,
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "baseline",
                  gap: 10,
                  fontWeight: 700,
                  fontSize: 13,
                }}>
                  <span style={{ fontSize: 13, fontWeight: 700, color: styles.secondaryColor }}>Konečná cena:</span>
                  <span style={{ fontSize: 14, fontWeight: 800, color: styles.primaryColor, textAlign: "right" }}>
                    {finalPrice.toFixed(2)} Kč
                  </span>
                </div>
              </>
            )}
          </div>
          <div style={{ borderTop: "1px solid " + styles.borderColor, margin: "8px 0" }} />
        </>
      )}
      
      {config.warrantyCertificate?.includeWarranty && (
        <div style={{ 
          marginBottom: 10,
          background: design === "minimal" ? "transparent" : styles.sectionBg,
          padding: design === "minimal" ? 0 : design === "modern" ? 15 : 12,
          borderRadius: design === "minimal" ? 0 : design === "modern" ? 8 : 6,
          border: design === "minimal" ? "none" : styles.sectionBorder,
        }}>
          <div style={{ 
            fontSize: design === "modern" ? 13 : 12,
            fontWeight: design === "minimal" ? 500 : design === "modern" ? 800 : "bold",
            marginBottom: design === "modern" ? 10 : 6,
            color: styles.secondaryColor,
          }}>
            Záruční podmínky
          </div>
          {config.warrantyCertificate.warrantyType === "unified" ? (() => {
            const duration = config.warrantyCertificate.warrantyUnifiedDuration || 12;
            const unit = config.warrantyCertificate.warrantyUnifiedUnit || "months";
            let days = 0;
            if (unit === "days") days = duration;
            else if (unit === "months") days = duration * 30;
            else if (unit === "years") days = duration * 365;
            const warrantyUntil = new Date(new Date(ticket.createdAt).getTime() + days * 24 * 60 * 60 * 1000);
            const unitText = formatWarrantyUnit(duration, unit);
            return (
              <>
                <div style={{ fontSize: 11, marginBottom: 8, color: styles.primaryColor }}>
                  Tento záruční list potvrzuje provedení opravy uvedeného zařízení. Záruční doba činí {duration} {unitText} od data opravy.
                </div>
                <div style={{ fontSize: 11 }}>
                  <span style={{ fontWeight: 600, color: styles.secondaryColor, display: "inline-block", minWidth: 140 }}>Záruka do:</span>{" "}
                  <span style={{ color: styles.primaryColor }}>{warrantyUntil.toLocaleDateString("cs-CZ")}</span>
                </div>
              </>
            );
          })() : (() => {
            const items = config.warrantyCertificate.warrantyItems || [];
            const repairDate = new Date(ticket.createdAt);
            return (
              <>
                <div style={{ fontSize: 11, marginBottom: 8, color: styles.primaryColor }}>
                  Tento záruční list potvrzuje provedení opravy uvedeného zařízení. Záruční doby:
                </div>
                {items.map((item: { name: string; duration: number; unit: "days" | "months" | "years" }, idx: number) => {
                  let days = 0;
                  if (item.unit === "days") days = item.duration;
                  else if (item.unit === "months") days = item.duration * 30;
                  else if (item.unit === "years") days = item.duration * 365;
                  const warrantyUntil = new Date(repairDate.getTime() + days * 24 * 60 * 60 * 1000);
                  const unitText = formatWarrantyUnit(item.duration, item.unit);
                  return (
                    <div key={idx} style={{ fontSize: 11, marginTop: 6 }}>
                      <span style={{ fontWeight: 600, color: styles.secondaryColor, display: "inline-block", minWidth: 140 }}>
                        {item.name || "Záruka"} ({item.duration} {unitText}):
                      </span>{" "}
                      <span style={{ color: styles.primaryColor }}>do {warrantyUntil.toLocaleDateString("cs-CZ")}</span>
                    </div>
                  );
                })}
              </>
            );
          })()}
        </div>
      )}
      
      {config.warrantyCertificate?.includeDates && !config.warrantyCertificate?.includeWarranty && (
        <>
          <div style={{ borderTop: "1px solid " + styles.borderColor, margin: "8px 0" }} />
          <div style={{ 
            marginBottom: 10,
            background: design === "minimal" ? "transparent" : styles.sectionBg,
            padding: design === "minimal" ? 0 : design === "modern" ? 15 : 12,
            borderRadius: design === "minimal" ? 0 : design === "modern" ? 8 : 6,
            border: design === "minimal" ? "none" : styles.sectionBorder,
          }}>
            <div style={{ fontSize: 11 }}>
              <span style={{ fontWeight: 600, color: styles.secondaryColor, display: "inline-block", minWidth: 140 }}>Datum opravy:</span>{" "}
              <span style={{ color: styles.primaryColor }}>{dateTimeStr}</span>
            </div>
          </div>
        </>
      )}
      
      {config.warrantyCertificate?.legalText && (
        <div style={{ 
          marginTop: 12, 
          padding: 10,
          background: styles.bgColor,
          border: "1px solid " + styles.borderColor,
          borderRadius: 6,
          fontSize: 9, 
          color: styles.secondaryColor,
          lineHeight: 1.4,
        }}>
          {config.warrantyCertificate.legalText}
        </div>
      )}
      
      {/* Signature */}
      <div style={{ 
        marginTop: 12,
        display: "flex",
        justifyContent: "flex-end",
      }}>
        <div style={{ 
          textAlign: "center",
          position: "relative",
          paddingTop: 10,
          borderTop: "1px solid " + styles.borderColor,
        }}>
          <div style={{ 
            borderTop: "1px solid " + styles.primaryColor, 
            marginTop: design === "minimal" ? 20 : 30,
            marginBottom: 3,
            height: 1,
            width: 200,
            marginLeft: "auto",
            marginRight: "auto",
          }} />
          {config.stampUrl && (
            <img 
              src={config.stampUrl} 
              alt="Razítko servisu" 
              style={{ 
                position: "absolute",
                bottom: 3,
                left: "50%",
                transform: "translateX(-50%)",
                maxWidth: ((config.stampSize ?? 100) / 100) * 120 + "px",
                maxHeight: ((config.stampSize ?? 100) / 100) * 60 + "px",
                width: "auto",
                height: "auto",
                objectFit: "contain",
              }} 
            />
          )}
          <div style={{ fontSize: 9, color: styles.secondaryColor }}>
            Razítko servisu
          </div>
        </div>
      </div>
    </div>
  );
}

// Component for real-time document preview
function DocumentPreview({ documentType, config }: { documentType: "ticketList" | "diagnosticProtocol" | "warrantyCertificate"; config: DocumentsConfig }) {
  const mockTicket = useMemo(() => createMockTicket(), []);
  const companyData = useMemo(() => safeLoadCompanyData(), []);
  const iframeRef = useRef<HTMLIFrameElement>(null);
  
  const htmlContent = useMemo(() => {
    try {
      if (documentType === "ticketList") {
        return generateTicketHTML(mockTicket, false, config, false);
      } else if (documentType === "diagnosticProtocol") {
        return generateDiagnosticProtocolHTML(mockTicket, companyData, false, config, false);
      } else {
        return generateWarrantyHTML(mockTicket, companyData, false, config, false);
      }
    } catch (err) {
      console.error("[DocumentPreview] Error generating HTML:", err);
      return "<div style='padding: 20px; color: red;'>Chyba při generování náhledu</div>";
    }
  }, [documentType, config, mockTicket, companyData]);

  // Generate HTML for printing (with forPrint: true)
  const printHtmlContent = useMemo(() => {
    try {
      if (documentType === "ticketList") {
        return generateTicketHTML(mockTicket, true, config, false);
      } else if (documentType === "diagnosticProtocol") {
        return generateDiagnosticProtocolHTML(mockTicket, companyData, true, config, false);
      } else {
        return generateWarrantyHTML(mockTicket, companyData, true, config, false);
      }
    } catch (err) {
      console.error("[DocumentPreview] Error generating print HTML:", err);
      return "<div style='padding: 20px; color: red;'>Chyba při generování náhledu</div>";
    }
  }, [documentType, config, mockTicket, companyData]);

  // Preserve scroll position when content changes
  useEffect(() => {
    if (!iframeRef.current) return;
    const iframe = iframeRef.current;
    const scrollY = iframe.contentWindow?.scrollY || 0;
    
    // Restore scroll position after content update
    const timer = setTimeout(() => {
      if (iframe.contentWindow) {
        iframe.contentWindow.scrollTo(0, scrollY);
      }
    }, 0);
    
    return () => clearTimeout(timer);
  }, [htmlContent]);

  return (
    <>
      <style>{`
        @media print {
          * {
            visibility: visible !important;
          }
          body > *:not(.preview-wrapper) {
            display: none !important;
            visibility: hidden !important;
          }
          .preview-wrapper {
            position: fixed !important;
            top: 0 !important;
            left: 0 !important;
            width: 100vw !important;
            height: 100vh !important;
            margin: 0 !important;
            padding: 0 !important;
            border: none !important;
            border-radius: 0 !important;
            background: white !important;
            z-index: 9999 !important;
            display: block !important;
            visibility: visible !important;
          }
          .preview-wrapper iframe {
            width: 100% !important;
            height: 100% !important;
            border: none !important;
            display: block !important;
            visibility: visible !important;
            position: absolute !important;
            top: 0 !important;
            left: 0 !important;
          }
        }
      `}</style>
      <div
        className="preview-wrapper"
        style={{
          width: "100%",
          // Height will adjust automatically to fit the A4 document
          minHeight: "400px",
          border: "1px solid var(--border)",
          borderRadius: 12,
          overflow: "visible",
          background: "white",
          position: "relative",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          padding: "20px",
        }}
      >
        <div style={{
          // Match iframe dimensions to prevent cutoff
          width: "240mm",
          height: "327mm",
          transform: "scale(1)",
          transformOrigin: "center center",
          flexShrink: 0,
          position: "relative",
          overflow: "hidden",
        }}>
          <iframe
            ref={iframeRef}
            srcDoc={htmlContent}
            style={{
              width: "240mm",
              height: "327mm",
              border: "medium",
              display: "block",
              margin: "0px",
              padding: "0px",
              boxSizing: "border-box",
              position: "absolute",
              top: "0px",
              left: "0px",
            }}
            title="Náhled dokumentu"
            onLoad={() => {
              // Enable print button functionality
              if (iframeRef.current?.contentWindow) {
                const iframeWindow = iframeRef.current.contentWindow;
                // The print button already uses window.print() which should work
                // But we ensure the iframe can access the parent window's print function
                try {
                  (iframeWindow as any).print = () => {
                    window.print();
                  };
                } catch (e) {
                  // Cross-origin restrictions might prevent this, but window.print() in the iframe should work
                }
              }
            }}
          />
        </div>
        <div style={{
          marginTop: 16,
          display: "flex",
          justifyContent: "center",
        }}>
          <button
            onClick={() => {
              try {
                if (!iframeRef.current) {
                  showToast("Náhled není k dispozici.", "error");
                  return;
                }
                
                const iframe = iframeRef.current;
                const iframeWindow = iframe.contentWindow;
                const iframeDoc = iframe.contentDocument;
                
                if (!iframeWindow || !iframeDoc) {
                  showToast("Nelze přistupovat k náhledu dokumentu.", "error");
                  return;
                }
                
                // Write print HTML directly to iframe document
                iframeDoc.open();
                iframeDoc.write(printHtmlContent);
                iframeDoc.close();
                
                // Wait for content to render, then print
                setTimeout(() => {
                  try {
                    iframeWindow.focus();
                    iframeWindow.print();
                    
                    // Restore original content after print dialog
                    setTimeout(() => {
                      if (iframeDoc) {
                        iframeDoc.open();
                        iframeDoc.write(htmlContent);
                        iframeDoc.close();
                      }
                    }, 1000);
                  } catch (err) {
                    console.error("Print error:", err);
                    // Restore original content on error
                    if (iframeDoc) {
                      iframeDoc.open();
                      iframeDoc.write(htmlContent);
                      iframeDoc.close();
                    }
                    showToast("Chyba při tisku.", "error");
                  }
                }, 500);
              } catch (err) {
                console.error("Print setup error:", err);
                showToast("Chyba při přípravě tisku.", "error");
              }
            }}
            style={{
              padding: "10px 20px",
              borderRadius: 10,
              border: "1px solid var(--accent)",
              background: "var(--accent)",
              color: "white",
              fontSize: 13,
              fontWeight: 600,
              cursor: "pointer",
              transition: "var(--transition-smooth)",
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.opacity = "0.9";
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.opacity = "1";
            }}
          >
            🖨️ Tisknout
          </button>
        </div>
      </div>
    </>
  );
}

function Card({ children }: { children: any }) {
  return (
    <div
      style={{
        background: "var(--panel)",
        backdropFilter: "var(--blur)",
        WebkitBackdropFilter: "var(--blur)",
        border: "1px solid var(--border)",
        borderRadius: "var(--radius-lg)",
        padding: 16,
        boxShadow: "var(--shadow-soft)",
        color: "var(--text)",
      }}
    >
      {children}
    </div>
  );
}


type SettingsProps = {
  activeServiceId: string | null;
  setActiveServiceId: (serviceId: string | null) => void;
  services: Array<{ service_id: string; service_name: string; role: string }>;
};

export default function Settings({ activeServiceId, setActiveServiceId, services }: SettingsProps) {
  const { statuses, upsertStatus, removeStatus, fallbackKey } = useStatuses();
  const { theme, setTheme, availableThemes } = useTheme();
  const { isAdmin } = useActiveRole(activeServiceId);
  const [section, setSection] = useState<SettingsSection>({ category: "service", subsection: "service_basic" });
  const [uiCfg, setUiCfg] = useState<UIConfig>(defaultUIConfig());
  const [companyData, setCompanyData] = useState<CompanyData>(() => safeLoadCompanyData());
  const [documentsConfig, setDocumentsConfig] = useState<DocumentsConfig>(() => safeLoadDocumentsConfig());
  const [selectedDocumentType, setSelectedDocumentType] = useState<"ticketList" | "diagnosticProtocol" | "warrantyCertificate">("ticketList");
  const [openCategories, setOpenCategories] = useState<{
    logo: boolean;
    conditions: boolean;
    stamp: boolean;
    qr: boolean;
  }>(() => {
    const config = safeLoadDocumentsConfig();
    const hasReviewUrl = config.reviewUrlType === "google" 
      ? !!config.googlePlaceId 
      : !!config.reviewUrl;
    return {
      logo: !!config.logoUrl,
      conditions: !!(config.ticketList?.legalText || config.diagnosticProtocol?.legalText || config.warrantyCertificate?.legalText),
      stamp: !!config.stampUrl,
      qr: hasReviewUrl,
    };
  });
  
  const [showPlaceIdTooltip, setShowPlaceIdTooltip] = useState(false);
  const [tooltipPosition, setTooltipPosition] = useState<{ top: number; left: number } | null>(null);
  const tooltipTimeoutRef = useRef<number | null>(null);
  const placeIdQuestionRef = useRef<HTMLDivElement | null>(null);
  
  // Calculate tooltip position
  useLayoutEffect(() => {
    if (!showPlaceIdTooltip || !placeIdQuestionRef.current) {
      setTooltipPosition(null);
      return;
    }
    
    const updatePosition = () => {
      if (!placeIdQuestionRef.current) return;
      const rect = placeIdQuestionRef.current.getBoundingClientRect();
      setTooltipPosition({
        top: rect.bottom + 8,
        left: rect.left + rect.width / 2,
      });
    };
    
    updatePosition();
    
    window.addEventListener("scroll", updatePosition, true);
    window.addEventListener("resize", updatePosition);
    
    return () => {
      window.removeEventListener("scroll", updatePosition, true);
      window.removeEventListener("resize", updatePosition);
    };
  }, [showPlaceIdTooltip]);
  
  // Cleanup timeout on unmount
  useEffect(() => {
    return () => {
      if (tooltipTimeoutRef.current) {
        window.clearTimeout(tooltipTimeoutRef.current);
      }
    };
  }, []);
  
  // Sync openCategories with documentsConfig values (only set to true when value exists, never set to false automatically)
  useEffect(() => {
    const hasReviewUrl = documentsConfig.reviewUrlType === "google" 
      ? documentsConfig.googlePlaceId !== undefined
      : documentsConfig.reviewUrl !== undefined;
    setOpenCategories(prev => ({
      logo: documentsConfig.logoUrl ? true : prev.logo,
      conditions: (documentsConfig.ticketList?.legalText || documentsConfig.diagnosticProtocol?.legalText || documentsConfig.warrantyCertificate?.legalText) ? true : prev.conditions,
      stamp: documentsConfig.stampUrl ? true : prev.stamp,
      qr: hasReviewUrl ? true : prev.qr, // Keep checked if value is set (even if empty string)
    }));
  }, [documentsConfig.logoUrl, documentsConfig.ticketList?.legalText, documentsConfig.diagnosticProtocol?.legalText, documentsConfig.warrantyCertificate?.legalText, documentsConfig.stampUrl, documentsConfig.reviewUrl, documentsConfig.reviewUrlType, documentsConfig.googlePlaceId]);
  
  // State for service settings from DB (currently unused, but kept for future use)
  const [_serviceSettingsLoading, setServiceSettingsLoading] = useState(false);
  const [_serviceSettingsError, setServiceSettingsError] = useState<string | null>(null);
  
  // State for documents config from DB
  const [documentsConfigLoading, setDocumentsConfigLoading] = useState(false);
  const [documentsConfigError, setDocumentsConfigError] = useState<string | null>(null);
  const [documentsConfigVersion, setDocumentsConfigVersion] = useState<number | null>(null);
  const [documentsConfigConflict, setDocumentsConfigConflict] = useState(false);
  // documentsConfigConflict is used in UI below
  
  // Helper function to save config with conflict handling
  const handleSaveDocumentsConfig = async (newConfig: DocumentsConfig) => {
    // Check permissions - only admin/owner can save
    if (!isAdmin) {
      showToast("Nemáte oprávnění upravovat nastavení dokumentů. Pouze administrátor servisu může provádět změny.", "error");
      return false;
    }
    
    setDocumentsConfigConflict(false);
    const result = await saveDocumentsConfigWithDB(activeServiceId, newConfig, documentsConfigVersion);
    
    if (result.conflict) {
      // Version conflict - show error and reload
      setDocumentsConfigConflict(true);
      showToast("Nastavení bylo mezitím změněno jiným uživatelem. Načítám aktuální verzi...", "error");
      
      // Reload from DB
      const dbResult = await loadDocumentsConfigFromDB(activeServiceId);
      if (dbResult) {
        setDocumentsConfig(dbResult.config);
        setDocumentsConfigVersion(dbResult.version);
        setDocumentsConfigConflict(false);
        saveDocumentsConfig(dbResult.config);
      }
      return false;
    }
    
    if (result.success && result.newVersion !== undefined) {
      setDocumentsConfigVersion(result.newVersion);
      return true;
    }
    
    return result.success;
  };

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

  // Load documents config from DB when activeServiceId changes
  useEffect(() => {
    if (!activeServiceId || !supabase) {
      setDocumentsConfigLoading(false);
      setDocumentsConfigError(null);
      return;
    }

    setDocumentsConfigLoading(true);
    setDocumentsConfigError(null);

    const loadDocumentsConfig = async () => {
      try {
      const dbResult = await loadDocumentsConfigFromDB(activeServiceId);
        
      if (dbResult) {
        setDocumentsConfig(dbResult.config);
        setDocumentsConfigVersion(dbResult.version);
        setDocumentsConfigConflict(false);
        // Sync to localStorage as fallback
        saveDocumentsConfig(dbResult.config);
      } else {
        // If not found, keep using localStorage/default and reset version
        setDocumentsConfigVersion(null);
        setDocumentsConfigConflict(false);
      }

        setDocumentsConfigLoading(false);
      } catch (err) {
        console.error("[Settings] Error loading documents config:", err);
        setDocumentsConfigError(err instanceof Error ? err.message : "Neznámá chyba");
        setDocumentsConfigLoading(false);
      }
    };

    loadDocumentsConfig();
  }, [activeServiceId]);

  // Realtime subscription for service_document_settings
  useEffect(() => {
    if (!activeServiceId || !supabase) return;

    const topic = `service_document_settings:${activeServiceId}`;
    console.log("[RT] subscribe", topic, new Date().toISOString());

    const channel = supabase
      .channel(topic)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "service_document_settings",
          filter: `service_id=eq.${activeServiceId}`,
        },
        async (payload) => {
          console.log("[Settings] service_document_settings changed", payload);
          // Reload config from DB
          const dbResult = await loadDocumentsConfigFromDB(activeServiceId);
          if (dbResult) {
            setDocumentsConfig(dbResult.config);
            setDocumentsConfigVersion(dbResult.version);
            setDocumentsConfigConflict(false);
            // Sync to localStorage as fallback
            saveDocumentsConfig(dbResult.config);
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
                  // Save to localStorage (for backward compatibility)
                  saveCompanyData(companyData);
                  
                  // Save abbreviation to service_settings in DB
                  if (activeServiceId && supabase) {
                    try {
                      const { error } = await (supabase as any).rpc("update_service_settings", {
                        p_service_id: activeServiceId,
                        p_patch: {
                          config: {
                            abbreviation: companyData.abbreviation,
                          },
                        },
                      });

                      if (error) {
                        throw error;
                      }
                    } catch (err) {
                      console.error("[Settings] Error saving service settings:", err);
                      showToast(`Chyba při ukládání do databáze: ${err instanceof Error ? err.message : "Neznámá chyba"}`, "error");
                      return;
                    }
                  }
                  
                  showToast("Uloženo", "success");
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
                  // Save to localStorage (for backward compatibility)
                  saveCompanyData(companyData);
                  
                  // Save abbreviation to service_settings in DB
                  if (activeServiceId && supabase) {
                    try {
                      const { error } = await (supabase as any).rpc("update_service_settings", {
                        p_service_id: activeServiceId,
                        p_patch: {
                          config: {
                            abbreviation: companyData.abbreviation,
                          },
                        },
                      });

                      if (error) {
                        throw error;
                      }
                    } catch (err) {
                      console.error("[Settings] Error saving service settings:", err);
                      showToast(`Chyba při ukládání do databáze: ${err instanceof Error ? err.message : "Neznámá chyba"}`, "error");
                      return;
                    }
                  }
                  
                  showToast("Uloženo", "success");
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
        <TeamManagement activeServiceId={activeServiceId} setActiveServiceId={setActiveServiceId} services={services} />
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
                  onClick={() => {
                    if (!canSave) return;
                    upsertStatus({
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
                      onClick={() => removeStatus(s.key)}
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
      {false && section.subsection === "orders_documents" && (
        <>
          {documentsConfigLoading && (
            <div style={{ padding: 16, textAlign: "center", color: "var(--muted)", fontSize: 13 }}>
              Načítání konfigurace dokumentů...
            </div>
          )}
          {documentsConfigError && (
            <div style={{ padding: 16, textAlign: "center", color: "rgba(239,68,68,0.9)", background: "rgba(239,68,68,0.1)", borderRadius: 12, border: "1px solid rgba(239,68,68,0.3)", marginBottom: 16 }}>
              {documentsConfigError}
            </div>
          )}
          {documentsConfigConflict && (
            <div style={{ 
              padding: 16, 
              textAlign: "center", 
              color: "rgba(239,68,68,0.9)", 
              background: "rgba(239,68,68,0.1)", 
              borderRadius: 12, 
              border: "1px solid rgba(239,68,68,0.3)", 
              marginBottom: 16,
              display: "flex",
              flexDirection: "column",
              gap: 12,
              alignItems: "center"
            }}>
              <div style={{ fontWeight: 600 }}>Nastavení bylo mezitím změněno jiným uživatelem.</div>
              <button
                onClick={async () => {
                  setDocumentsConfigConflict(false);
                  setDocumentsConfigLoading(true);
                  const dbResult = await loadDocumentsConfigFromDB(activeServiceId);
                  if (dbResult) {
                    setDocumentsConfig(dbResult.config);
                    setDocumentsConfigVersion(dbResult.version);
                    saveDocumentsConfig(dbResult.config);
                    showToast("Nastavení bylo načteno znovu", "success");
                  }
                  setDocumentsConfigLoading(false);
                }}
                style={{
                  padding: "8px 16px",
                  borderRadius: 8,
                  border: "1px solid rgba(239,68,68,0.5)",
                  background: "rgba(239,68,68,0.2)",
                  color: "rgba(239,68,68,0.9)",
                  cursor: "pointer",
                  fontSize: 13,
                  fontWeight: 600,
                }}
              >
                🔄 Načíst znovu
              </button>
            </div>
          )}

          {/* Dropdown pro výběr typu dokumentu */}
          <div style={{ marginBottom: 20 }}>
            <label style={{ display: "block", fontSize: 13, fontWeight: 700, color: "var(--text)", marginBottom: 8 }}>
              Typ dokumentu
            </label>
            <DocumentTypePicker
              value={selectedDocumentType}
              onChange={(value) => setSelectedDocumentType(value)}
            />
            </div>

          {/* Dvousloupcový layout */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 20 }}>
            {/* LEVÝ SLOUPEC - Customizace */}
            <Card>
              <div style={{ fontWeight: 950, fontSize: 14, marginBottom: 16, color: "var(--text)" }}>Customizace dokumentu</div>
              
              {/* Checkboxy pro vybraný typ dokumentu */}
              <div style={{ display: "grid", gap: 10, marginBottom: 24 }}>
                {selectedDocumentType === "ticketList" && (
                  <>
                    <ModernCheckbox
                      checked={documentsConfig.ticketList.includeServiceInfo}
                      onChange={async (checked) => {
                        const newConfig = { ...documentsConfig, ticketList: { ...documentsConfig.ticketList, includeServiceInfo: checked } };
                        setDocumentsConfig(newConfig);
                        await handleSaveDocumentsConfig(newConfig);
                      }}
                      label="Údaje o servisu"
                    />
                    <ModernCheckbox
                      checked={documentsConfig.ticketList.includeCustomerInfo}
                      onChange={async (checked) => {
                        const newConfig = { ...documentsConfig, ticketList: { ...documentsConfig.ticketList, includeCustomerInfo: checked } };
                        setDocumentsConfig(newConfig);
                        await handleSaveDocumentsConfig(newConfig);
                      }}
                      label="Údaje o zákazníkovi"
                    />
                    <div>
                      <ModernCheckbox
                        checked={documentsConfig.ticketList.includeDeviceInfo}
                        onChange={async (checked) => {
                        const newConfig = {
                          ...documentsConfig,
                            ticketList: { 
                              ...documentsConfig.ticketList, 
                              includeDeviceInfo: checked,
                            },
                            // Initialize deviceInfoConfig if enabling
                            deviceInfoConfig: checked && !documentsConfig.deviceInfoConfig ? {
                              deviceLabel: true,
                              serialOrImei: true,
                              devicePasscode: true,
                              devicePasscodeVisible: false,
                              deviceCondition: true,
                              requestedRepair: true,
                              deviceNote: true,
                              handoffMethod: true,
                              externalId: true,
                            } : documentsConfig.deviceInfoConfig,
                        };
                        setDocumentsConfig(newConfig);
                        await handleSaveDocumentsConfig(newConfig);
                      }}
                        label="Údaje o zařízení"
                      />
                      {documentsConfig.ticketList.includeDeviceInfo && (
                        <div style={{ marginLeft: 32, marginTop: 8, display: "grid", gap: 8 }}>
                          <ModernCheckbox
                            checked={documentsConfig.deviceInfoConfig?.deviceLabel !== false}
                            onChange={async (checked) => {
                        const newConfig = {
                          ...documentsConfig,
                                deviceInfoConfig: {
                                  ...documentsConfig.deviceInfoConfig,
                                  deviceLabel: checked,
                                },
                        };
                        setDocumentsConfig(newConfig);
                        await handleSaveDocumentsConfig(newConfig);
                      }}
                            label="Zařízení"
                          />
                          <ModernCheckbox
                            checked={documentsConfig.deviceInfoConfig?.serialOrImei !== false}
                            onChange={async (checked) => {
                        const newConfig = {
                          ...documentsConfig,
                                deviceInfoConfig: {
                                  ...documentsConfig.deviceInfoConfig,
                                  serialOrImei: checked,
                                },
                        };
                        setDocumentsConfig(newConfig);
                        await handleSaveDocumentsConfig(newConfig);
                      }}
                            label="SN/IMEI"
                          />
                          <div>
                            <ModernCheckbox
                              checked={documentsConfig.deviceInfoConfig?.devicePasscode !== false}
                              onChange={async (checked) => {
                        const newConfig = {
                          ...documentsConfig,
                                  deviceInfoConfig: {
                                    ...documentsConfig.deviceInfoConfig,
                                    devicePasscode: checked,
                                  },
                        };
                        setDocumentsConfig(newConfig);
                        await handleSaveDocumentsConfig(newConfig);
                      }}
                              label="Heslo/kód"
                            />
                            {documentsConfig.deviceInfoConfig?.devicePasscode !== false && (
                              <div style={{ marginLeft: 20, marginTop: 4 }}>
                                <ModernCheckbox
                                  checked={documentsConfig.deviceInfoConfig?.devicePasscodeVisible === true}
                                  onChange={async (checked) => {
                        const newConfig = {
                          ...documentsConfig,
                                      deviceInfoConfig: {
                                        ...documentsConfig.deviceInfoConfig,
                                        devicePasscodeVisible: checked,
                                      },
                        };
                        setDocumentsConfig(newConfig);
                        await handleSaveDocumentsConfig(newConfig);
                      }}
                                  label="Zobrazit heslo (místo křížků)"
                                />
                              </div>
                            )}
                          </div>
                          <ModernCheckbox
                            checked={documentsConfig.deviceInfoConfig?.deviceCondition !== false}
                            onChange={async (checked) => {
                              const newConfig = {
                                ...documentsConfig,
                                deviceInfoConfig: {
                                  ...documentsConfig.deviceInfoConfig,
                                  deviceCondition: checked,
                                },
                              };
                              setDocumentsConfig(newConfig);
                              await handleSaveDocumentsConfig(newConfig);
                            }}
                            label="Popis stavu"
                          />
                          <ModernCheckbox
                            checked={documentsConfig.deviceInfoConfig?.requestedRepair !== false}
                            onChange={async (checked) => {
                              const newConfig = {
                                ...documentsConfig,
                                deviceInfoConfig: {
                                  ...documentsConfig.deviceInfoConfig,
                                  requestedRepair: checked,
                                },
                              };
                              setDocumentsConfig(newConfig);
                              await handleSaveDocumentsConfig(newConfig);
                            }}
                            label="Požadovaná oprava/Problém"
                          />
                          <ModernCheckbox
                            checked={documentsConfig.deviceInfoConfig?.deviceNote !== false}
                            onChange={async (checked) => {
                              const newConfig = {
                                ...documentsConfig,
                                deviceInfoConfig: {
                                  ...documentsConfig.deviceInfoConfig,
                                  deviceNote: checked,
                                },
                              };
                              setDocumentsConfig(newConfig);
                              await handleSaveDocumentsConfig(newConfig);
                            }}
                            label="Poznámka"
                          />
                          <ModernCheckbox
                            checked={documentsConfig.deviceInfoConfig?.handoffMethod !== false}
                            onChange={async (checked) => {
                              const newConfig = {
                                ...documentsConfig,
                                deviceInfoConfig: {
                                  ...documentsConfig.deviceInfoConfig,
                                  handoffMethod: checked,
                                },
                              };
                              setDocumentsConfig(newConfig);
                              await handleSaveDocumentsConfig(newConfig);
                            }}
                            label="Předání/převzetí"
                          />
                          <ModernCheckbox
                            checked={documentsConfig.deviceInfoConfig?.externalId !== false}
                            onChange={async (checked) => {
                              const newConfig = {
                                ...documentsConfig,
                                deviceInfoConfig: {
                                  ...documentsConfig.deviceInfoConfig,
                                  externalId: checked,
                                },
                              };
                              setDocumentsConfig(newConfig);
                              await handleSaveDocumentsConfig(newConfig);
                            }}
                            label="Externí ID"
                          />
                        </div>
                      )}
                    </div>
                    <ModernCheckbox
                      checked={documentsConfig.ticketList.includeRepairs}
                      onChange={async (checked) => {
                        const newConfig = { ...documentsConfig, ticketList: { ...documentsConfig.ticketList, includeRepairs: checked } };
                        setDocumentsConfig(newConfig);
                        await handleSaveDocumentsConfig(newConfig);
                      }}
                      label="Provedené opravy"
                    />
                    <ModernCheckbox
                      checked={documentsConfig.ticketList.includeDiagnostic}
                      onChange={async (checked) => {
                        const newConfig = { ...documentsConfig, ticketList: { ...documentsConfig.ticketList, includeDiagnostic: checked } };
                        setDocumentsConfig(newConfig);
                        await handleSaveDocumentsConfig(newConfig);
                      }}
                      label="Diagnostika"
                    />
                    <ModernCheckbox
                      checked={documentsConfig.ticketList.includePhotos}
                      onChange={async (checked) => {
                        const newConfig = { ...documentsConfig, ticketList: { ...documentsConfig.ticketList, includePhotos: checked } };
                        setDocumentsConfig(newConfig);
                        await handleSaveDocumentsConfig(newConfig);
                      }}
                      label="Diagnostické fotografie"
                    />
                    <ModernCheckbox
                      checked={documentsConfig.ticketList.includeDates}
                      onChange={async (checked) => {
                        const newConfig = { ...documentsConfig, ticketList: { ...documentsConfig.ticketList, includeDates: checked } };
                        setDocumentsConfig(newConfig);
                        await handleSaveDocumentsConfig(newConfig);
                      }}
                      label="Datum"
                    />
                    {selectedDocumentType === "ticketList" && (
                      <ModernCheckbox
                        checked={documentsConfig.ticketList.includeStamp}
                        onChange={async (checked) => {
                          const newConfig = { ...documentsConfig, ticketList: { ...documentsConfig.ticketList, includeStamp: checked } };
                          setDocumentsConfig(newConfig);
                          await handleSaveDocumentsConfig(newConfig);
                        }}
                        label="Razítko/podpis servisu"
                      />
                    )}
                  </>
                )}
                {selectedDocumentType === "diagnosticProtocol" && (
                  <>
                    <div>
                      <ModernCheckbox
                        checked={documentsConfig.diagnosticProtocol.includeServiceInfo}
                        onChange={async (checked) => {
                          const newConfig = {
                            ...documentsConfig,
                            diagnosticProtocol: { 
                              ...documentsConfig.diagnosticProtocol, 
                              includeServiceInfo: checked,
                            },
                            // Initialize serviceInfoConfig if enabling
                            serviceInfoConfig: checked && !documentsConfig.serviceInfoConfig ? {
                              abbreviation: true,
                              name: true,
                              ico: true,
                              dic: true,
                              addressStreet: true,
                              addressCity: true,
                              addressZip: true,
                              phone: true,
                              email: true,
                              website: true,
                            } : documentsConfig.serviceInfoConfig,
                          };
                          setDocumentsConfig(newConfig);
                          await handleSaveDocumentsConfig(newConfig);
                        }}
                        label="Údaje o servisu"
                      />
                      {documentsConfig.diagnosticProtocol.includeServiceInfo && (
                        <div style={{ marginLeft: 32, marginTop: 8, display: "grid", gap: 8 }}>
                          {/* Základní údaje - zobrazit pouze pokud jsou vyplněné */}
                          {(companyData.abbreviation || companyData.name || companyData.ico || companyData.dic || companyData.addressStreet || companyData.addressCity || companyData.addressZip) && (
                            <>
                              <div style={{ fontSize: 12, fontWeight: 700, color: "var(--muted)", marginBottom: 4 }}>Základní údaje</div>
                              {companyData.abbreviation && (
                                <ModernCheckbox
                                  checked={documentsConfig.serviceInfoConfig?.abbreviation !== false}
                                  onChange={async (checked) => {
                                    const newConfig = {
                                      ...documentsConfig,
                                      serviceInfoConfig: {
                                        ...documentsConfig.serviceInfoConfig,
                                        abbreviation: checked,
                                      },
                                    };
                                    setDocumentsConfig(newConfig);
                                    await handleSaveDocumentsConfig(newConfig);
                                  }}
                                  label="Zkratka"
                                />
                              )}
                              {companyData.name && (
                                <ModernCheckbox
                                  checked={documentsConfig.serviceInfoConfig?.name !== false}
                                  onChange={async (checked) => {
                                    const newConfig = {
                                      ...documentsConfig,
                                      serviceInfoConfig: {
                                        ...documentsConfig.serviceInfoConfig,
                                        name: checked,
                                      },
                                    };
                                    setDocumentsConfig(newConfig);
                                    await handleSaveDocumentsConfig(newConfig);
                                  }}
                                  label="Název"
                                />
                              )}
                              {companyData.ico && (
                                <ModernCheckbox
                                  checked={documentsConfig.serviceInfoConfig?.ico !== false}
                                  onChange={async (checked) => {
                                    const newConfig = {
                                      ...documentsConfig,
                                      serviceInfoConfig: {
                                        ...documentsConfig.serviceInfoConfig,
                                        ico: checked,
                                      },
                                    };
                                    setDocumentsConfig(newConfig);
                                    await handleSaveDocumentsConfig(newConfig);
                                  }}
                                  label="IČO"
                                />
                              )}
                              {companyData.dic && (
                                <ModernCheckbox
                                  checked={documentsConfig.serviceInfoConfig?.dic !== false}
                                  onChange={async (checked) => {
                                    const newConfig = {
                                      ...documentsConfig,
                                      serviceInfoConfig: {
                                        ...documentsConfig.serviceInfoConfig,
                                        dic: checked,
                                      },
                                    };
                                    setDocumentsConfig(newConfig);
                                    await handleSaveDocumentsConfig(newConfig);
                                  }}
                                  label="DIČ"
                                />
                              )}
                              {companyData.addressStreet && (
                                <ModernCheckbox
                                  checked={documentsConfig.serviceInfoConfig?.addressStreet !== false}
                                  onChange={async (checked) => {
                                    const newConfig = {
                                      ...documentsConfig,
                                      serviceInfoConfig: {
                                        ...documentsConfig.serviceInfoConfig,
                                        addressStreet: checked,
                                      },
                                    };
                                    setDocumentsConfig(newConfig);
                                    await handleSaveDocumentsConfig(newConfig);
                                  }}
                                  label="Ulice"
                                />
                              )}
                              {companyData.addressCity && (
                                <ModernCheckbox
                                  checked={documentsConfig.serviceInfoConfig?.addressCity !== false}
                                  onChange={async (checked) => {
                                    const newConfig = {
                                      ...documentsConfig,
                                      serviceInfoConfig: {
                                        ...documentsConfig.serviceInfoConfig,
                                        addressCity: checked,
                                      },
                                    };
                                    setDocumentsConfig(newConfig);
                                    await handleSaveDocumentsConfig(newConfig);
                                  }}
                                  label="Město"
                                />
                              )}
                              {companyData.addressZip && (
                                <ModernCheckbox
                                  checked={documentsConfig.serviceInfoConfig?.addressZip !== false}
                                  onChange={async (checked) => {
                                    const newConfig = {
                                      ...documentsConfig,
                                      serviceInfoConfig: {
                                        ...documentsConfig.serviceInfoConfig,
                                        addressZip: checked,
                                      },
                                    };
                                    setDocumentsConfig(newConfig);
                                    await handleSaveDocumentsConfig(newConfig);
                                  }}
                                  label="PSČ"
                                />
                              )}
                            </>
                          )}
                          {/* Kontaktní údaje - zobrazit pouze pokud jsou vyplněné */}
                          {(companyData.phone || companyData.email || companyData.website) && (
                            <>
                              <div style={{ fontSize: 12, fontWeight: 700, color: "var(--muted)", marginTop: 8, marginBottom: 4 }}>Kontaktní údaje</div>
                              {companyData.phone && (
                                <ModernCheckbox
                                  checked={documentsConfig.serviceInfoConfig?.phone !== false}
                                  onChange={async (checked) => {
                                    const newConfig = {
                                      ...documentsConfig,
                                      serviceInfoConfig: {
                                        ...documentsConfig.serviceInfoConfig,
                                        phone: checked,
                                      },
                                    };
                                    setDocumentsConfig(newConfig);
                                    await handleSaveDocumentsConfig(newConfig);
                                  }}
                                  label="Telefon"
                                />
                              )}
                              {companyData.email && (
                                <ModernCheckbox
                                  checked={documentsConfig.serviceInfoConfig?.email !== false}
                                  onChange={async (checked) => {
                                    const newConfig = {
                                      ...documentsConfig,
                                      serviceInfoConfig: {
                                        ...documentsConfig.serviceInfoConfig,
                                        email: checked,
                                      },
                                    };
                                    setDocumentsConfig(newConfig);
                                    await handleSaveDocumentsConfig(newConfig);
                                  }}
                                  label="E-mail"
                                />
                              )}
                              {companyData.website && (
                                <ModernCheckbox
                                  checked={documentsConfig.serviceInfoConfig?.website !== false}
                                  onChange={async (checked) => {
                                    const newConfig = {
                                      ...documentsConfig,
                                      serviceInfoConfig: {
                                        ...documentsConfig.serviceInfoConfig,
                                        website: checked,
                                      },
                                    };
                                    setDocumentsConfig(newConfig);
                                    await handleSaveDocumentsConfig(newConfig);
                                  }}
                                  label="Web"
                                />
                              )}
                            </>
                          )}
                        </div>
                      )}
                    </div>
                    <ModernCheckbox
                      checked={documentsConfig.diagnosticProtocol.includeCustomerInfo}
                      onChange={async (checked) => {
                        const newConfig = { ...documentsConfig, diagnosticProtocol: { ...documentsConfig.diagnosticProtocol, includeCustomerInfo: checked } };
                        setDocumentsConfig(newConfig);
                        await handleSaveDocumentsConfig(newConfig);
                      }}
                      label="Údaje o zákazníkovi"
                    />
                    <ModernCheckbox
                      checked={documentsConfig.diagnosticProtocol.includeDeviceInfo}
                      onChange={async (checked) => {
                        const newConfig = { ...documentsConfig, diagnosticProtocol: { ...documentsConfig.diagnosticProtocol, includeDeviceInfo: checked } };
                        setDocumentsConfig(newConfig);
                        await handleSaveDocumentsConfig(newConfig);
                      }}
                      label="Údaje o zařízení"
                    />
                    <ModernCheckbox
                      checked={documentsConfig.diagnosticProtocol.includeDiagnosticText}
                      onChange={async (checked) => {
                        const newConfig = { ...documentsConfig, diagnosticProtocol: { ...documentsConfig.diagnosticProtocol, includeDiagnosticText: checked } };
                        setDocumentsConfig(newConfig);
                        await handleSaveDocumentsConfig(newConfig);
                      }}
                      label="Text diagnostiky"
                    />
                    <ModernCheckbox
                      checked={documentsConfig.diagnosticProtocol.includePhotos}
                      onChange={async (checked) => {
                        const newConfig = { ...documentsConfig, diagnosticProtocol: { ...documentsConfig.diagnosticProtocol, includePhotos: checked } };
                        setDocumentsConfig(newConfig);
                        await handleSaveDocumentsConfig(newConfig);
                      }}
                      label="Diagnostické fotografie"
                    />
                    <ModernCheckbox
                      checked={documentsConfig.diagnosticProtocol.includeDates}
                      onChange={async (checked) => {
                        const newConfig = { ...documentsConfig, diagnosticProtocol: { ...documentsConfig.diagnosticProtocol, includeDates: checked } };
                        setDocumentsConfig(newConfig);
                        await handleSaveDocumentsConfig(newConfig);
                      }}
                      label="Datum"
                    />
                  </>
                )}
                {selectedDocumentType === "warrantyCertificate" && (
                  <>
                    <div>
                      <ModernCheckbox
                        checked={documentsConfig.warrantyCertificate.includeServiceInfo}
                        onChange={async (checked) => {
                        const newConfig = {
                          ...documentsConfig,
                            warrantyCertificate: { 
                              ...documentsConfig.warrantyCertificate, 
                              includeServiceInfo: checked,
                            },
                            // Initialize serviceInfoConfig if enabling
                            serviceInfoConfig: checked && !documentsConfig.serviceInfoConfig ? {
                              abbreviation: true,
                              name: true,
                              ico: true,
                              dic: true,
                              addressStreet: true,
                              addressCity: true,
                              addressZip: true,
                              phone: true,
                              email: true,
                              website: true,
                            } : documentsConfig.serviceInfoConfig,
                        };
                        setDocumentsConfig(newConfig);
                        await handleSaveDocumentsConfig(newConfig);
                      }}
                        label="Údaje o servisu"
                      />
                      {documentsConfig.warrantyCertificate.includeServiceInfo && (
                        <div style={{ marginLeft: 32, marginTop: 8, display: "grid", gap: 8 }}>
                          {/* Základní údaje - zobrazit pouze pokud jsou vyplněné */}
                          {(companyData.abbreviation || companyData.name || companyData.ico || companyData.dic || companyData.addressStreet || companyData.addressCity || companyData.addressZip) && (
                            <>
                              <div style={{ fontSize: 12, fontWeight: 700, color: "var(--muted)", marginBottom: 4 }}>Základní údaje</div>
                              {companyData.abbreviation && (
                                <ModernCheckbox
                                  checked={documentsConfig.serviceInfoConfig?.abbreviation !== false}
                                  onChange={async (checked) => {
                                    const newConfig = {
                                      ...documentsConfig,
                                      serviceInfoConfig: {
                                        ...documentsConfig.serviceInfoConfig,
                                        abbreviation: checked,
                                      },
                                    };
                                    setDocumentsConfig(newConfig);
                                    await handleSaveDocumentsConfig(newConfig);
                                  }}
                                  label="Zkratka"
                                />
                              )}
                              {companyData.name && (
                                <ModernCheckbox
                                  checked={documentsConfig.serviceInfoConfig?.name !== false}
                                  onChange={async (checked) => {
                                    const newConfig = {
                                      ...documentsConfig,
                                      serviceInfoConfig: {
                                        ...documentsConfig.serviceInfoConfig,
                                        name: checked,
                                      },
                                    };
                                    setDocumentsConfig(newConfig);
                                    await handleSaveDocumentsConfig(newConfig);
                                  }}
                                  label="Název"
                                />
                              )}
                              {companyData.ico && (
                                <ModernCheckbox
                                  checked={documentsConfig.serviceInfoConfig?.ico !== false}
                                  onChange={async (checked) => {
                                    const newConfig = {
                                      ...documentsConfig,
                                      serviceInfoConfig: {
                                        ...documentsConfig.serviceInfoConfig,
                                        ico: checked,
                                      },
                                    };
                                    setDocumentsConfig(newConfig);
                                    await handleSaveDocumentsConfig(newConfig);
                                  }}
                                  label="IČO"
                                />
                              )}
                              {companyData.dic && (
                                <ModernCheckbox
                                  checked={documentsConfig.serviceInfoConfig?.dic !== false}
                                  onChange={async (checked) => {
                                    const newConfig = {
                                      ...documentsConfig,
                                      serviceInfoConfig: {
                                        ...documentsConfig.serviceInfoConfig,
                                        dic: checked,
                                      },
                                    };
                                    setDocumentsConfig(newConfig);
                                    await handleSaveDocumentsConfig(newConfig);
                                  }}
                                  label="DIČ"
                                />
                              )}
                              {companyData.addressStreet && (
                                <ModernCheckbox
                                  checked={documentsConfig.serviceInfoConfig?.addressStreet !== false}
                                  onChange={async (checked) => {
                                    const newConfig = {
                                      ...documentsConfig,
                                      serviceInfoConfig: {
                                        ...documentsConfig.serviceInfoConfig,
                                        addressStreet: checked,
                                      },
                                    };
                                    setDocumentsConfig(newConfig);
                                    await handleSaveDocumentsConfig(newConfig);
                                  }}
                                  label="Ulice"
                                />
                              )}
                              {companyData.addressCity && (
                                <ModernCheckbox
                                  checked={documentsConfig.serviceInfoConfig?.addressCity !== false}
                                  onChange={async (checked) => {
                                    const newConfig = {
                                      ...documentsConfig,
                                      serviceInfoConfig: {
                                        ...documentsConfig.serviceInfoConfig,
                                        addressCity: checked,
                                      },
                                    };
                                    setDocumentsConfig(newConfig);
                                    await handleSaveDocumentsConfig(newConfig);
                                  }}
                                  label="Město"
                                />
                              )}
                              {companyData.addressZip && (
                                <ModernCheckbox
                                  checked={documentsConfig.serviceInfoConfig?.addressZip !== false}
                                  onChange={async (checked) => {
                                    const newConfig = {
                                      ...documentsConfig,
                                      serviceInfoConfig: {
                                        ...documentsConfig.serviceInfoConfig,
                                        addressZip: checked,
                                      },
                                    };
                                    setDocumentsConfig(newConfig);
                                    await handleSaveDocumentsConfig(newConfig);
                                  }}
                                  label="PSČ"
                                />
                              )}
                            </>
                          )}
                          {/* Kontaktní údaje - zobrazit pouze pokud jsou vyplněné */}
                          {(companyData.phone || companyData.email || companyData.website) && (
                            <>
                              <div style={{ fontSize: 12, fontWeight: 700, color: "var(--muted)", marginTop: 8, marginBottom: 4 }}>Kontaktní údaje</div>
                              {companyData.phone && (
                                <ModernCheckbox
                                  checked={documentsConfig.serviceInfoConfig?.phone !== false}
                                  onChange={async (checked) => {
                                    const newConfig = {
                                      ...documentsConfig,
                                      serviceInfoConfig: {
                                        ...documentsConfig.serviceInfoConfig,
                                        phone: checked,
                                      },
                                    };
                                    setDocumentsConfig(newConfig);
                                    await handleSaveDocumentsConfig(newConfig);
                                  }}
                                  label="Telefon"
                                />
                              )}
                              {companyData.email && (
                                <ModernCheckbox
                                  checked={documentsConfig.serviceInfoConfig?.email !== false}
                                  onChange={async (checked) => {
                                    const newConfig = {
                                      ...documentsConfig,
                                      serviceInfoConfig: {
                                        ...documentsConfig.serviceInfoConfig,
                                        email: checked,
                                      },
                                    };
                                    setDocumentsConfig(newConfig);
                                    await handleSaveDocumentsConfig(newConfig);
                                  }}
                                  label="E-mail"
                                />
                              )}
                              {companyData.website && (
                                <ModernCheckbox
                                  checked={documentsConfig.serviceInfoConfig?.website !== false}
                                  onChange={async (checked) => {
                                    const newConfig = {
                                      ...documentsConfig,
                                      serviceInfoConfig: {
                                        ...documentsConfig.serviceInfoConfig,
                                        website: checked,
                                      },
                                    };
                                    setDocumentsConfig(newConfig);
                                    await handleSaveDocumentsConfig(newConfig);
                                  }}
                                  label="Web"
                                />
                              )}
                            </>
                          )}
                        </div>
                      )}
                    </div>
                    <ModernCheckbox
                      checked={documentsConfig.warrantyCertificate.includeCustomerInfo}
                      onChange={async (checked) => {
                        const newConfig = { ...documentsConfig, warrantyCertificate: { ...documentsConfig.warrantyCertificate, includeCustomerInfo: checked } };
                        setDocumentsConfig(newConfig);
                        await handleSaveDocumentsConfig(newConfig);
                      }}
                      label="Údaje o zákazníkovi"
                    />
                    <div>
                      <ModernCheckbox
                        checked={documentsConfig.warrantyCertificate.includeDeviceInfo}
                        onChange={async (checked) => {
                          const newConfig = { 
                            ...documentsConfig, 
                            warrantyCertificate: { 
                              ...documentsConfig.warrantyCertificate, 
                              includeDeviceInfo: checked,
                            },
                            // Initialize deviceInfoConfig if enabling
                            deviceInfoConfig: checked && !documentsConfig.deviceInfoConfig ? {
                              deviceLabel: true,
                              serialOrImei: true,
                              devicePasscode: true,
                              devicePasscodeVisible: false,
                              deviceCondition: true,
                              requestedRepair: true,
                              deviceNote: true,
                              handoffMethod: true,
                              externalId: true,
                            } : documentsConfig.deviceInfoConfig,
                          };
                          setDocumentsConfig(newConfig);
                          await handleSaveDocumentsConfig(newConfig);
                        }}
                        label="Údaje o zařízení"
                      />
                      {documentsConfig.warrantyCertificate.includeDeviceInfo && (
                        <div style={{ marginLeft: 32, marginTop: 8, display: "grid", gap: 8 }}>
                          <ModernCheckbox
                            checked={documentsConfig.deviceInfoConfig?.deviceLabel !== false}
                            onChange={async (checked) => {
                              const newConfig = {
                                ...documentsConfig,
                                deviceInfoConfig: {
                                  ...documentsConfig.deviceInfoConfig,
                                  deviceLabel: checked,
                                },
                              };
                              setDocumentsConfig(newConfig);
                              await handleSaveDocumentsConfig(newConfig);
                            }}
                            label="Zařízení"
                          />
                          <ModernCheckbox
                            checked={documentsConfig.deviceInfoConfig?.serialOrImei !== false}
                            onChange={async (checked) => {
                              const newConfig = {
                                ...documentsConfig,
                                deviceInfoConfig: {
                                  ...documentsConfig.deviceInfoConfig,
                                  serialOrImei: checked,
                                },
                              };
                              setDocumentsConfig(newConfig);
                              await handleSaveDocumentsConfig(newConfig);
                            }}
                            label="SN/IMEI"
                          />
                        </div>
                      )}
                    </div>
                    <ModernCheckbox
                      checked={documentsConfig.warrantyCertificate.includeRepairs}
                      onChange={async (checked) => {
                        const newConfig = { ...documentsConfig, warrantyCertificate: { ...documentsConfig.warrantyCertificate, includeRepairs: checked } };
                        setDocumentsConfig(newConfig);
                        await handleSaveDocumentsConfig(newConfig);
                      }}
                      label="Provedené opravy"
                    />
                    <ModernCheckbox
                      checked={documentsConfig.warrantyCertificate.includeDates}
                      onChange={async (checked) => {
                        const newConfig = { ...documentsConfig, warrantyCertificate: { ...documentsConfig.warrantyCertificate, includeDates: checked } };
                        setDocumentsConfig(newConfig);
                        await handleSaveDocumentsConfig(newConfig);
                      }}
                      label="Datum"
                    />
                    <ModernCheckbox
                      checked={documentsConfig.warrantyCertificate.includeWarranty}
                      onChange={async (checked) => {
                        const newConfig = { ...documentsConfig, warrantyCertificate: { ...documentsConfig.warrantyCertificate, includeWarranty: checked } };
                        setDocumentsConfig(newConfig);
                        await handleSaveDocumentsConfig(newConfig);
                      }}
                      label="Záruka"
                    />
                    {documentsConfig.warrantyCertificate.includeWarranty && (
                      <div style={{ marginLeft: 20, marginTop: 10, marginBottom: 10, maxWidth: "100%" }}>
                        <div style={{ marginBottom: 12 }}>
                          <div style={{ fontSize: 13, fontWeight: 600, color: "var(--text)", marginBottom: 8 }}>
                            Typ záruky:
                          </div>
                          <div style={{ display: "flex", gap: 8 }}>
                            <ModernRadioButton
                              checked={documentsConfig.warrantyCertificate.warrantyType === "unified"}
                              onChange={async () => {
                                const newConfig = { ...documentsConfig, warrantyCertificate: { ...documentsConfig.warrantyCertificate, warrantyType: "unified" as const } };
                                setDocumentsConfig(newConfig);
                                await handleSaveDocumentsConfig(newConfig);
                              }}
                              label="Jednotná"
                              name="warranty-type"
                            />
                            <ModernRadioButton
                              checked={documentsConfig.warrantyCertificate.warrantyType === "separate"}
                              onChange={async () => {
                                const newConfig = { ...documentsConfig, warrantyCertificate: { ...documentsConfig.warrantyCertificate, warrantyType: "separate" as const } };
                                setDocumentsConfig(newConfig);
                                await handleSaveDocumentsConfig(newConfig);
                              }}
                              label="Zvlášť"
                              name="warranty-type"
                            />
                          </div>
                        </div>
                        {documentsConfig.warrantyCertificate.warrantyType === "unified" ? (
                          <div style={{ marginBottom: 10 }}>
                            <div style={{ fontSize: 13, fontWeight: 600, color: "var(--text)", marginBottom: 8 }}>
                              Délka záruky:
                            </div>
                            <div style={{ display: "flex", gap: 8, alignItems: "center", maxWidth: 280 }}>
                              <input
                                type="number"
                                min="1"
                                value={documentsConfig.warrantyCertificate.warrantyUnifiedDuration || 12}
                      onChange={async (e) => {
                        const newConfig = { ...documentsConfig, warrantyCertificate: { ...documentsConfig.warrantyCertificate, warrantyUnifiedDuration: parseInt(e.target.value) || 12 } };
                        setDocumentsConfig(newConfig);
                        await handleSaveDocumentsConfig(newConfig);
                      }}
                                style={{ width: 70, padding: "8px 10px", borderRadius: 8, border: "1px solid var(--border)", fontSize: 13, background: "var(--panel)", color: "var(--text)" }}
                              />
                              <UnitPicker
                                value={documentsConfig.warrantyCertificate.warrantyUnifiedUnit || "months"}
                                onChange={async (value) => {
                                  const newConfig = { ...documentsConfig, warrantyCertificate: { ...documentsConfig.warrantyCertificate, warrantyUnifiedUnit: value } };
                                  setDocumentsConfig(newConfig);
                                  await handleSaveDocumentsConfig(newConfig);
                                }}
                                duration={documentsConfig.warrantyCertificate.warrantyUnifiedDuration || 12}
                              />
                            </div>
                          </div>
                        ) : (
                          <div style={{ marginBottom: 10 }}>
                            <div style={{ fontSize: 13, fontWeight: 600, color: "var(--text)", marginBottom: 8 }}>
                              Typy záruk:
                            </div>
                            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                              {(documentsConfig.warrantyCertificate.warrantyItems || []).map((item, index) => (
                                <div key={index} style={{ display: "flex", gap: 8, alignItems: "center", maxWidth: "100%" }}>
                    <input
                                    type="text"
                                    value={item.name}
                      onChange={async (e) => {
                        const newItems = [...(documentsConfig.warrantyCertificate.warrantyItems || [])];
                        newItems[index] = { ...newItems[index], name: e.target.value };
                        const newConfig = { ...documentsConfig, warrantyCertificate: { ...documentsConfig.warrantyCertificate, warrantyItems: newItems } };
                        setDocumentsConfig(newConfig);
                        await handleSaveDocumentsConfig(newConfig);
                      }}
                                    placeholder="Název"
                                    style={{ width: 100, padding: "8px 10px", borderRadius: 8, border: "1px solid var(--border)", fontSize: 13, background: "var(--panel)", color: "var(--text)" }}
                    />
                    <input
                                    type="number"
                                    min="1"
                                    value={item.duration}
                      onChange={async (e) => {
                                      const newItems = [...(documentsConfig.warrantyCertificate.warrantyItems || [])];
                                      newItems[index] = { ...newItems[index], duration: parseInt(e.target.value) || 1 };
                                      const newConfig = { ...documentsConfig, warrantyCertificate: { ...documentsConfig.warrantyCertificate, warrantyItems: newItems } };
                        setDocumentsConfig(newConfig);
                        await handleSaveDocumentsConfig(newConfig);
                      }}
                                    style={{ width: 70, padding: "8px 10px", borderRadius: 8, border: "1px solid var(--border)", fontSize: 13, background: "var(--panel)", color: "var(--text)" }}
                                  />
                                  <UnitPicker
                                    value={item.unit}
                                    onChange={async (value) => {
                                      const newItems = [...(documentsConfig.warrantyCertificate.warrantyItems || [])];
                                      newItems[index] = { ...newItems[index], unit: value };
                                      const newConfig = { ...documentsConfig, warrantyCertificate: { ...documentsConfig.warrantyCertificate, warrantyItems: newItems } };
                                      setDocumentsConfig(newConfig);
                                      await handleSaveDocumentsConfig(newConfig);
                                    }}
                                    duration={item.duration}
                                  />
                                  <button
                                    onClick={async () => {
                                      const newItems = (documentsConfig.warrantyCertificate.warrantyItems || []).filter((_, i) => i !== index);
                                      const newConfig = { ...documentsConfig, warrantyCertificate: { ...documentsConfig.warrantyCertificate, warrantyItems: newItems } };
                                      setDocumentsConfig(newConfig);
                                      await handleSaveDocumentsConfig(newConfig);
                                    }}
                                    style={{ padding: "8px 12px", borderRadius: 8, border: "1px solid var(--border)", background: "var(--panel)", color: "var(--text)", cursor: "pointer", fontSize: 12, fontWeight: 500 }}
                                  >
                                    ✕
                                  </button>
                </div>
                              ))}
                              <button
                                onClick={async () => {
                                  const newItems = [...(documentsConfig.warrantyCertificate.warrantyItems || []), { name: "", duration: 12, unit: "months" as const }];
                                  const newConfig = { ...documentsConfig, warrantyCertificate: { ...documentsConfig.warrantyCertificate, warrantyItems: newItems } };
                                  setDocumentsConfig(newConfig);
                                  await handleSaveDocumentsConfig(newConfig);
                                }}
                                style={{ padding: "8px 12px", borderRadius: 8, border: "1px solid var(--border)", background: "var(--accent-soft)", color: "var(--accent)", cursor: "pointer", fontSize: 13, fontWeight: 600, alignSelf: "flex-start" }}
                              >
                                + Přidat typ záruky
                              </button>
                            </div>
                          </div>
                        )}
                      </div>
                    )}
                  </>
                )}
              </div>

              {/* Logo servisu */}
              <CustomizationCategory
                checked={openCategories.logo}
                onChange={(checked) => {
                  setOpenCategories(prev => ({ ...prev, logo: checked }));
                  if (!checked) {
                    const newConfig = { ...documentsConfig, logoUrl: undefined };
                        setDocumentsConfig(newConfig);
                        saveDocumentsConfigWithDB(activeServiceId, newConfig);
                  }
                }}
                label="Logo servisu"
              >
                    <input
                  type="file"
                  accept="image/*"
                      onChange={async (e) => {
                    const file = e.target.files?.[0];
                    if (file) {
                      const reader = new FileReader();
                      reader.onload = async (event) => {
                        const base64 = event.target?.result as string;
                        const newConfig = { ...documentsConfig, logoUrl: base64 };
                        setDocumentsConfig(newConfig);
                        await handleSaveDocumentsConfig(newConfig);
                      };
                      reader.readAsDataURL(file);
                    }
                  }}
                  style={{ display: "none" }}
                  id="logo-upload"
                />
                <label
                  htmlFor="logo-upload"
                  style={{
                    display: "block",
                    padding: "12px",
                    borderRadius: 10,
                    border: "1px dashed var(--border)",
                    background: "var(--panel)",
                    cursor: "pointer",
                    textAlign: "center",
                    fontSize: 13,
                    color: "var(--text)",
                    transition: "var(--transition-smooth)",
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.borderColor = "var(--accent)";
                    e.currentTarget.style.background = "var(--accent-soft)";
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.borderColor = "var(--border)";
                    e.currentTarget.style.background = "var(--panel)";
                  }}
                >
                  {documentsConfig.logoUrl ? "📷 Změnit logo" : "➕ Nahrát logo"}
                  </label>
                {documentsConfig.logoUrl && (
                  <>
                    <img
                      src={documentsConfig.logoUrl}
                      alt="Logo servisu"
                      style={{ width: "100%", maxHeight: 100, objectFit: "contain", marginTop: 12, borderRadius: 8 }}
                    />
                    <div style={{ marginTop: 12 }}>
                      <div style={{ fontSize: 12, fontWeight: 600, color: "var(--text)", marginBottom: 8 }}>
                        Velikost loga: {documentsConfig.logoSize ?? 100}%
                      </div>
                    <input
                        type="range"
                        min="50"
                        max="200"
                        step="5"
                        value={documentsConfig.logoSize ?? 100}
                      onChange={async (e) => {
                          const newConfig = { ...documentsConfig, logoSize: parseInt(e.target.value) };
                        setDocumentsConfig(newConfig);
                        await handleSaveDocumentsConfig(newConfig);
                      }}
                        style={{
                          width: "100%",
                          height: 6,
                          borderRadius: 3,
                          background: "var(--border)",
                          outline: "none",
                          cursor: "pointer",
                        }}
                      />
                    </div>
                  </>
                )}
              </CustomizationCategory>

              {/* Podmínky (Právní text) */}
              <CustomizationCategory
                checked={openCategories.conditions}
                onChange={(checked) => {
                  setOpenCategories(prev => ({ ...prev, conditions: checked }));
                  if (!checked) {
                    const newConfig = { ...documentsConfig };
                    if (selectedDocumentType === "ticketList") {
                      newConfig.ticketList = { ...newConfig.ticketList, legalText: "" };
                    } else if (selectedDocumentType === "diagnosticProtocol") {
                      newConfig.diagnosticProtocol = { ...newConfig.diagnosticProtocol, legalText: "" };
                    } else {
                      newConfig.warrantyCertificate = { ...newConfig.warrantyCertificate, legalText: "" };
                    }
                    setDocumentsConfig(newConfig);
                    saveDocumentsConfigWithDB(activeServiceId, newConfig);
                  }
                }}
                label="Podmínky"
              >
                <textarea
                  value={
                    selectedDocumentType === "ticketList" ? documentsConfig.ticketList.legalText :
                    selectedDocumentType === "diagnosticProtocol" ? documentsConfig.diagnosticProtocol.legalText :
                    documentsConfig.warrantyCertificate.legalText
                  }
                      onChange={async (e) => {
                    const newConfig = { ...documentsConfig };
                    if (selectedDocumentType === "ticketList") {
                      newConfig.ticketList = { ...newConfig.ticketList, legalText: e.target.value };
                    } else if (selectedDocumentType === "diagnosticProtocol") {
                      newConfig.diagnosticProtocol = { ...newConfig.diagnosticProtocol, legalText: e.target.value };
                    } else {
                      newConfig.warrantyCertificate = { ...newConfig.warrantyCertificate, legalText: e.target.value };
                    }
                        setDocumentsConfig(newConfig);
                        await handleSaveDocumentsConfig(newConfig);
                      }}
                  rows={4}
                  style={{
                    width: "100%",
                    padding: "10px 12px",
                    borderRadius: 10,
                    border: "1px solid var(--border)",
                    background: "var(--panel)",
                    color: "var(--text)",
                    fontSize: 13,
                    fontFamily: "system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif",
                    resize: "vertical",
                    outline: "none",
                  }}
                  placeholder="Zadejte podmínky pro tento dokument..."
                />
              </CustomizationCategory>

              {/* Razítko / Podpis */}
              <CustomizationCategory
                checked={openCategories.stamp}
                onChange={(checked) => {
                  setOpenCategories(prev => ({ ...prev, stamp: checked }));
                  if (!checked) {
                    const newConfig = { ...documentsConfig, stampUrl: undefined };
                    setDocumentsConfig(newConfig);
                    saveDocumentsConfigWithDB(activeServiceId, newConfig);
                  }
                }}
                label="Razítko / Podpis"
              >
                    <input
                  type="file"
                  accept="image/*"
                      onChange={async (e) => {
                    const file = e.target.files?.[0];
                    if (file) {
                      const reader = new FileReader();
                      reader.onload = async (event) => {
                        const base64 = event.target?.result as string;
                        const newConfig = { ...documentsConfig, stampUrl: base64 };
                        setDocumentsConfig(newConfig);
                        await handleSaveDocumentsConfig(newConfig);
                      };
                      reader.readAsDataURL(file);
                    }
                  }}
                  style={{ display: "none" }}
                  id="stamp-upload"
                />
                <label
                  htmlFor="stamp-upload"
                  style={{
                    display: "block",
                    padding: "12px",
                    borderRadius: 10,
                    border: "1px dashed var(--border)",
                    background: "var(--panel)",
                    cursor: "pointer",
                    textAlign: "center",
                    fontSize: 13,
                    color: "var(--text)",
                    transition: "var(--transition-smooth)",
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.borderColor = "var(--accent)";
                    e.currentTarget.style.background = "var(--accent-soft)";
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.borderColor = "var(--border)";
                    e.currentTarget.style.background = "var(--panel)";
                  }}
                >
                  {documentsConfig.stampUrl ? "📷 Změnit razítko" : "➕ Nahrát razítko"}
                  </label>
                {documentsConfig.stampUrl && (
                  <>
                    <img
                      src={documentsConfig.stampUrl}
                      alt="Razítko"
                      style={{ width: "100%", maxHeight: 100, objectFit: "contain", marginTop: 12, borderRadius: 8 }}
                    />
                    <div style={{ marginTop: 12 }}>
                      <div style={{ fontSize: 12, fontWeight: 600, color: "var(--text)", marginBottom: 8 }}>
                        Velikost razítka: {documentsConfig.stampSize ?? 100}%
                      </div>
                    <input
                        type="range"
                        min="50"
                        max="200"
                        step="5"
                        value={documentsConfig.stampSize ?? 100}
                      onChange={async (e) => {
                          const newConfig = { ...documentsConfig, stampSize: parseInt(e.target.value) };
                          setDocumentsConfig(newConfig);
                          await handleSaveDocumentsConfig(newConfig);
                        }}
                        style={{
                          width: "100%",
                          height: 6,
                          borderRadius: 3,
                          background: "var(--border)",
                          outline: "none",
                          cursor: "pointer",
                        }}
                      />
                    </div>
                  </>
                )}
              </CustomizationCategory>

              {/* QR kód (pouze pro záruční list) */}
              {selectedDocumentType === "warrantyCertificate" && (
                <CustomizationCategory
                  checked={openCategories.qr}
                  onChange={async (checked) => {
                    setOpenCategories(prev => ({ ...prev, qr: checked }));
                    if (checked) {
                      // When checking, ensure default values
                        const newConfig = {
                          ...documentsConfig,
                        reviewUrlType: documentsConfig.reviewUrlType || "custom",
                        reviewUrl: documentsConfig.reviewUrl ?? "",
                        googlePlaceId: documentsConfig.googlePlaceId ?? "",
                        };
                        setDocumentsConfig(newConfig);
                        await handleSaveDocumentsConfig(newConfig);
                    } else if (!checked) {
                      // When unchecking, clear the values
                        const newConfig = {
                          ...documentsConfig,
                        reviewUrl: undefined,
                        googlePlaceId: undefined,
                        };
                        setDocumentsConfig(newConfig);
                        await handleSaveDocumentsConfig(newConfig);
                    }
                  }}
                  label="QR kód"
                >
                  <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                    <div>
                      <div style={{ fontSize: 12, fontWeight: 600, color: "var(--text)", marginBottom: 8 }}>Typ odkazu</div>
                      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                        <ModernRadioButton
                          checked={documentsConfig.reviewUrlType === "custom"}
                          onChange={async () => {
                            const newConfig = { ...documentsConfig, reviewUrlType: "custom" as const };
                            setDocumentsConfig(newConfig);
                            await handleSaveDocumentsConfig(newConfig);
                          }}
                          label="Vlastní odkaz"
                          name="reviewUrlType"
                        />
                        <ModernRadioButton
                          checked={documentsConfig.reviewUrlType === "google"}
                          onChange={async () => {
                            const newConfig = { ...documentsConfig, reviewUrlType: "google" as const };
                            setDocumentsConfig(newConfig);
                            await handleSaveDocumentsConfig(newConfig);
                          }}
                          label="Podle Google ID lokace"
                          name="reviewUrlType"
                        />
                </div>
              </div>

                    {documentsConfig.reviewUrlType === "custom" ? (
              <div>
                        <div style={{ fontSize: 12, fontWeight: 600, color: "var(--text)", marginBottom: 6 }}>Odkaz na hodnocení servisu</div>
                    <input
                          type="url"
                          value={documentsConfig.reviewUrl ?? ""}
                      onChange={async (e) => {
                            const trimmed = e.target.value.trim();
                            const newConfig = { ...documentsConfig, reviewUrl: trimmed || (openCategories.qr ? "" : undefined) };
                        setDocumentsConfig(newConfig);
                        await handleSaveDocumentsConfig(newConfig);
                      }}
                          placeholder="https://example.com/review"
                          style={{
                            width: "100%",
                            padding: "10px 12px",
                            borderRadius: 10,
                            border: "1px solid var(--border)",
                            background: "var(--panel)",
                            color: "var(--text)",
                            fontSize: 13,
                            fontFamily: "system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif",
                            outline: "none",
                          }}
                        />
                        <div style={{ fontSize: 11, color: "var(--muted)", marginTop: 6 }}>
                          QR kód s tímto odkazem bude zobrazen na záručním listu
                        </div>
                      </div>
                    ) : (
                      <div>
                        <div style={{ fontSize: 12, fontWeight: 600, color: "var(--text)", marginBottom: 6, display: "flex", alignItems: "center", gap: 6 }}>
                          ID pobočky
                          <div style={{ position: "relative", display: "inline-block" }}>
                            <div
                              ref={placeIdQuestionRef}
                              style={{
                                width: 16,
                                height: 16,
                                borderRadius: "50%",
                                border: `1.5px solid ${showPlaceIdTooltip ? "var(--accent)" : "var(--muted)"}`,
                                display: "flex",
                                alignItems: "center",
                                justifyContent: "center",
                                cursor: "help",
                                fontSize: 11,
                                fontWeight: 700,
                                color: showPlaceIdTooltip ? "var(--accent)" : "var(--muted)",
                                transition: "var(--transition-smooth)",
                              }}
                              onMouseEnter={() => {
                                if (tooltipTimeoutRef.current) {
                                  window.clearTimeout(tooltipTimeoutRef.current);
                                  tooltipTimeoutRef.current = null;
                                }
                                setShowPlaceIdTooltip(true);
                              }}
                              onMouseLeave={() => {
                                tooltipTimeoutRef.current = window.setTimeout(() => {
                                  setShowPlaceIdTooltip(false);
                                }, 200);
                              }}
                            >
                              ?
                            </div>
                            {showPlaceIdTooltip && tooltipPosition && createPortal(
                              <div
                                data-tooltip-wrapper
                                style={{
                                  position: "fixed",
                                  top: tooltipPosition?.top || 0,
                                  left: tooltipPosition?.left || 0,
                                  transform: "translateX(-50%)",
                                  zIndex: 10000,
                                  pointerEvents: "auto",
                                }}
                                onMouseEnter={() => {
                                  if (tooltipTimeoutRef.current) {
                                    window.clearTimeout(tooltipTimeoutRef.current);
                                    tooltipTimeoutRef.current = null;
                                  }
                                  setShowPlaceIdTooltip(true);
                                }}
                                onMouseLeave={() => {
                                  tooltipTimeoutRef.current = window.setTimeout(() => {
                                    setShowPlaceIdTooltip(false);
                                  }, 200);
                                }}
                              >
                                <div
                                  style={{
                                    padding: "12px 16px",
                                    background: "var(--panel)",
                                    border: "1px solid var(--border)",
                                    borderRadius: 10,
                                    fontSize: 12,
                                    color: "var(--text)",
                                    whiteSpace: "normal",
                                    wordWrap: "break-word",
                                    overflowWrap: "break-word",
                                    boxShadow: "0 4px 12px rgba(0, 0, 0, 0.15)",
                                    display: "flex",
                                    flexDirection: "column",
                                    gap: 8,
                                    width: 320,
                                    maxWidth: "90vw",
                                  }}
                                >
                              <div style={{ lineHeight: "1.5" }}>ID svojí pobočky najdete tak, že na tomto odkaze najdete svou pobočku:</div>
                              <button
                                type="button"
                                onClick={async (e) => {
                                  e.stopPropagation();
                                  const url = "https://developers.google.com/maps/documentation/javascript/examples/places-placeid-finder";
                                  
                                  // Check if we're in Tauri
                                  const isTauri = typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
                                  
                                  if (isTauri) {
                                    try {
                                      // Use Tauri opener plugin to open in external browser
                                      const { openUrl } = await import('@tauri-apps/plugin-opener');
                                      await openUrl(url);
                                    } catch (err) {
                                      console.error("Failed to open URL with Tauri opener:", err);
                                      // Fallback to window.open
                                      window.open(url, "_blank", "noopener,noreferrer");
                                    }
                                  } else {
                                    // Browser fallback
                                    window.open(url, "_blank", "noopener,noreferrer");
                                  }
                                }}
                                style={{
                                  padding: "6px 12px",
                                  borderRadius: 6,
                                  border: "1px solid var(--accent)",
                                  background: "var(--accent)",
                                  color: "white",
                                  fontSize: 12,
                                  fontWeight: 600,
                                  cursor: "pointer",
                                  transition: "var(--transition-smooth)",
                                  alignSelf: "flex-start",
                                  fontFamily: "inherit",
                                }}
                                onMouseEnter={(e) => {
                                  e.currentTarget.style.opacity = "0.9";
                                }}
                                onMouseLeave={(e) => {
                                  e.currentTarget.style.opacity = "1";
                                }}
                              >
                                Otevřít Place ID Finder
                              </button>
                                </div>
                              </div>,
                              document.body
                            )}
                          </div>
                        </div>
                        <div style={{ display: "flex", gap: 8 }}>
                    <input
                            type="text"
                            value={documentsConfig.googlePlaceId ?? ""}
                      onChange={async (e) => {
                              const trimmed = e.target.value.trim();
                              const newConfig = { ...documentsConfig, googlePlaceId: trimmed || (openCategories.qr ? "" : undefined) };
                        setDocumentsConfig(newConfig);
                        await handleSaveDocumentsConfig(newConfig);
                      }}
                            placeholder="ChIJN1t_tDeuEmsRUsoyG83frY4"
                            style={{
                              flex: 1,
                              padding: "10px 12px",
                              borderRadius: 10,
                              border: "1px solid var(--border)",
                              background: "var(--panel)",
                              color: "var(--text)",
                              fontSize: 13,
                              fontFamily: "system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif",
                              outline: "none",
                            }}
                          />
                          <button
                            onClick={async () => {
                              try {
                                const text = await navigator.clipboard.readText();
                                const newConfig = { ...documentsConfig, googlePlaceId: text.trim() || (openCategories.qr ? "" : undefined) };
                                setDocumentsConfig(newConfig);
                                await handleSaveDocumentsConfig(newConfig);
                              } catch (err) {
                                console.error("Failed to read clipboard:", err);
                              }
                            }}
                            style={{
                              padding: "10px 16px",
                              borderRadius: 10,
                              border: "1px solid var(--border)",
                              background: "var(--panel)",
                              color: "var(--text)",
                              fontSize: 12,
                              fontWeight: 600,
                              cursor: "pointer",
                              transition: "var(--transition-smooth)",
                              whiteSpace: "nowrap",
                            }}
                            onMouseEnter={(e) => {
                              e.currentTarget.style.background = "var(--accent-soft)";
                              e.currentTarget.style.borderColor = "var(--accent)";
                              e.currentTarget.style.color = "var(--accent)";
                            }}
                            onMouseLeave={(e) => {
                              e.currentTarget.style.background = "var(--panel)";
                              e.currentTarget.style.borderColor = "var(--border)";
                              e.currentTarget.style.color = "var(--text)";
                            }}
                          >
                            Vložit
                          </button>
                        </div>
                        {documentsConfig.googlePlaceId && (
                          <div style={{ fontSize: 11, color: "var(--muted)", marginTop: 6 }}>
                            Odkaz: https://search.google.com/local/writereview?placeid={documentsConfig.googlePlaceId}
                          </div>
                        )}
                      </div>
                    )}

                    <div>
                      <div style={{ fontSize: 12, fontWeight: 600, color: "var(--text)", marginBottom: 6 }}>Text u QR kódu</div>
                    <input
                        type="text"
                        value={documentsConfig.reviewText || "Budeme rádi za Vaši recenzi"}
                      onChange={async (e) => {
                          const newConfig = { ...documentsConfig, reviewText: e.target.value.trim() || "Budeme rádi za Vaši recenzi" };
                        setDocumentsConfig(newConfig);
                        await handleSaveDocumentsConfig(newConfig);
                      }}
                        placeholder="Budeme rádi za Vaši recenzi"
                        style={{
                          width: "100%",
                          padding: "10px 12px",
                          borderRadius: 10,
                          border: "1px solid var(--border)",
                          background: "var(--panel)",
                          color: "var(--text)",
                          fontSize: 13,
                          fontFamily: "system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif",
                          outline: "none",
                        }}
                      />
                    </div>
                    <div>
                      <div style={{ fontSize: 12, fontWeight: 600, color: "var(--text)", marginBottom: 8 }}>
                        Velikost QR kódu: {documentsConfig.qrCodeSize ?? 120}px
                      </div>
                    <input
                        type="range"
                        min="80"
                        max="200"
                        step="10"
                        value={documentsConfig.qrCodeSize ?? 120}
                      onChange={async (e) => {
                          const newConfig = { ...documentsConfig, qrCodeSize: parseInt(e.target.value) };
                        setDocumentsConfig(newConfig);
                        await handleSaveDocumentsConfig(newConfig);
                      }}
                        style={{
                          width: "100%",
                          height: 6,
                          borderRadius: 3,
                          background: "var(--border)",
                          outline: "none",
                          cursor: "pointer",
                        }}
                      />
                    </div>
              </div>
                </CustomizationCategory>
              )}
            </Card>

            {/* PRAVÝ SLOUPEC - Vizuální úprava */}
            <Card>
              <div style={{ fontWeight: 950, fontSize: 14, marginBottom: 16, color: "var(--text)" }}>Vizuální úprava</div>
              
              {/* Výběr designu */}
              <div style={{ marginBottom: 20 }}>
                <div style={{ fontSize: 13, fontWeight: 700, color: "var(--text)", marginBottom: 8 }}>Design dokumentu</div>
                <DesignPicker
                  value={
                    selectedDocumentType === "ticketList" ? documentsConfig.ticketList.design :
                    selectedDocumentType === "diagnosticProtocol" ? documentsConfig.diagnosticProtocol.design :
                    documentsConfig.warrantyCertificate.design
                  }
                  onChange={async (design) => {
                    const newConfig = { ...documentsConfig };
                    if (selectedDocumentType === "ticketList") {
                      newConfig.ticketList = { ...newConfig.ticketList, design };
                    } else if (selectedDocumentType === "diagnosticProtocol") {
                      newConfig.diagnosticProtocol = { ...newConfig.diagnosticProtocol, design };
                    } else {
                      newConfig.warrantyCertificate = { ...newConfig.warrantyCertificate, design };
                    }
                        setDocumentsConfig(newConfig);
                        await handleSaveDocumentsConfig(newConfig);
                      }}
                    />
                </div>

              {/* Černobílé / Barevné */}
              <div style={{ marginBottom: 20 }}>
                <div style={{ fontSize: 13, fontWeight: 700, color: "var(--text)", marginBottom: 8 }}>Tisk</div>
                <div style={{ display: "flex", gap: 12 }}>
                  <button
                    type="button"
                    onClick={() => {
                      const newConfig = { ...documentsConfig, colorMode: "color" as const };
                      setDocumentsConfig(newConfig);
                      saveDocumentsConfigWithDB(activeServiceId, newConfig);
                    }}
                    style={{
                      flex: 1,
                      padding: "12px 16px",
                      borderRadius: 12,
                      border: `2px solid ${documentsConfig.colorMode === "color" ? "var(--accent)" : "var(--border)"}`,
                      background: documentsConfig.colorMode === "color" ? "var(--accent-soft)" : "var(--panel)",
                      color: documentsConfig.colorMode === "color" ? "var(--accent)" : "var(--text)",
                      fontSize: 14,
                      fontWeight: documentsConfig.colorMode === "color" ? 700 : 500,
                      cursor: "pointer",
                      transition: "var(--transition-smooth)",
                    }}
                  >
                    Barevné
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      const newConfig = { ...documentsConfig, colorMode: "bw" as const };
                      setDocumentsConfig(newConfig);
                      saveDocumentsConfigWithDB(activeServiceId, newConfig);
                    }}
                    style={{
                      flex: 1,
                      padding: "12px 16px",
                      borderRadius: 12,
                      border: `2px solid ${documentsConfig.colorMode === "bw" ? "var(--accent)" : "var(--border)"}`,
                      background: documentsConfig.colorMode === "bw" ? "var(--accent-soft)" : "var(--panel)",
                      color: documentsConfig.colorMode === "bw" ? "var(--accent)" : "var(--text)",
                      fontSize: 14,
                      fontWeight: documentsConfig.colorMode === "bw" ? 700 : 500,
                      cursor: "pointer",
                      transition: "var(--transition-smooth)",
                    }}
                  >
                    Černobílé
                  </button>
              </div>
              </div>

              {/* Real-time náhled */}
              <div>
                <div style={{ fontSize: 13, fontWeight: 700, color: "var(--text)", marginBottom: 8 }}>Náhled dokumentu</div>
                <DocumentPreview
                  documentType={selectedDocumentType}
                  config={documentsConfig}
                />
            </div>
          </Card>
          </div>
        </>
      )}

      {/* ZAKÁZKY - DOKUMENTY */}
      {section.subsection === "orders_documents" && (
        <>
          {documentsConfigLoading && (
            <div style={{ padding: 16, textAlign: "center", color: "var(--muted)", fontSize: 13 }}>
              Načítání konfigurace dokumentů...
            </div>
          )}
          {documentsConfigError && (
            <div style={{ padding: 16, textAlign: "center", color: "rgba(239,68,68,0.9)", background: "rgba(239,68,68,0.1)", borderRadius: 12, border: "1px solid rgba(239,68,68,0.3)", marginBottom: 16 }}>
              {documentsConfigError}
            </div>
          )}
          {!isAdmin && (
            <div style={{ 
              padding: 16, 
              textAlign: "center", 
              color: "rgba(239,68,68,0.9)", 
              background: "rgba(239,68,68,0.1)", 
              borderRadius: 12, 
              border: "1px solid rgba(239,68,68,0.3)", 
              marginBottom: 16 
            }}>
              <div style={{ fontWeight: 600, marginBottom: 4 }}>Pouze pro čtení</div>
              <div style={{ fontSize: 13 }}>Toto nastavení může upravovat pouze administrátor servisu.</div>
            </div>
          )}

          {/* Tlačítko Uložit - pouze pro admin/owner */}
          {isAdmin && (
            <div style={{ marginBottom: 20, display: "flex", justifyContent: "flex-end" }}>
              <button
                onClick={async () => {
                  const success = await handleSaveDocumentsConfig(documentsConfig);
                  if (success) {
                    showToast("Nastavení dokumentů bylo uloženo", "success");
                  }
                }}
                style={{
                  padding: "12px 24px",
                  borderRadius: 10,
                  border: "none",
                  background: "var(--accent)",
                  color: "white",
                  fontSize: 14,
                  fontWeight: 700,
                  cursor: "pointer",
                  transition: "var(--transition-smooth)",
                  boxShadow: "0 2px 8px rgba(0,0,0,0.1)",
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.background = "var(--accent-hover)";
                  e.currentTarget.style.boxShadow = "0 4px 12px rgba(0,0,0,0.15)";
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.background = "var(--accent)";
                  e.currentTarget.style.boxShadow = "0 2px 8px rgba(0,0,0,0.1)";
                }}
              >
                Uložit
              </button>
            </div>
          )}

          {/* Dropdown pro výběr typu dokumentu */}
          <div style={{ marginBottom: 20 }}>
            <label style={{ display: "block", fontSize: 13, fontWeight: 700, color: "var(--text)", marginBottom: 8 }}>
              Typ dokumentu
                  </label>
            <DocumentTypePicker
              value={selectedDocumentType}
              onChange={(value) => setSelectedDocumentType(value)}
              disabled={!isAdmin}
            />
          </div>

          {/* Dvousloupcový layout */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 20 }}>
            {/* LEVÝ SLOUPEC - Customizace */}
            <Card>
              <div style={{ fontWeight: 950, fontSize: 14, marginBottom: 16, color: "var(--text)" }}>Customizace dokumentu</div>
              
              {/* Checkboxy pro vybraný typ dokumentu */}
              <div style={{ display: "grid", gap: 10, marginBottom: 24 }}>
                {selectedDocumentType === "ticketList" && (
                  <>
                    <div>
                      <ModernCheckbox
                        checked={documentsConfig.ticketList.includeServiceInfo}
                        onChange={async (checked) => {
                        const newConfig = {
                          ...documentsConfig,
                            ticketList: { 
                              ...documentsConfig.ticketList, 
                              includeServiceInfo: checked,
                            },
                            // Initialize serviceInfoConfig if enabling
                            serviceInfoConfig: checked && !documentsConfig.serviceInfoConfig ? {
                              abbreviation: true,
                              name: true,
                              ico: true,
                              dic: true,
                              addressStreet: true,
                              addressCity: true,
                              addressZip: true,
                              phone: true,
                              email: true,
                              website: true,
                            } : documentsConfig.serviceInfoConfig,
                        };
                        setDocumentsConfig(newConfig);
                        await handleSaveDocumentsConfig(newConfig);
                      }}
                        label="Údaje o servisu"
                      />
                      {documentsConfig.ticketList.includeServiceInfo && (
                        <div style={{ marginLeft: 32, marginTop: 8, display: "grid", gap: 8 }}>
                          {/* Základní údaje - zobrazit pouze pokud jsou vyplněné */}
                          {(companyData.abbreviation || companyData.name || companyData.ico || companyData.dic || companyData.addressStreet || companyData.addressCity || companyData.addressZip) && (
                            <>
                              <div style={{ fontSize: 12, fontWeight: 700, color: "var(--muted)", marginBottom: 4 }}>Základní údaje</div>
                              {companyData.abbreviation && (
                                <ModernCheckbox
                                  checked={documentsConfig.serviceInfoConfig?.abbreviation !== false}
                                  onChange={async (checked) => {
                                    const newConfig = {
                                      ...documentsConfig,
                                      serviceInfoConfig: {
                                        ...documentsConfig.serviceInfoConfig,
                                        abbreviation: checked,
                                      },
                                    };
                                    setDocumentsConfig(newConfig);
                                    await handleSaveDocumentsConfig(newConfig);
                                  }}
                                  label="Zkratka"
                                />
                              )}
                              {companyData.name && (
                                <ModernCheckbox
                                  checked={documentsConfig.serviceInfoConfig?.name !== false}
                                  onChange={async (checked) => {
                                    const newConfig = {
                                      ...documentsConfig,
                                      serviceInfoConfig: {
                                        ...documentsConfig.serviceInfoConfig,
                                        name: checked,
                                      },
                                    };
                                    setDocumentsConfig(newConfig);
                                    await handleSaveDocumentsConfig(newConfig);
                                  }}
                                  label="Název"
                                />
                              )}
                              {companyData.ico && (
                                <ModernCheckbox
                                  checked={documentsConfig.serviceInfoConfig?.ico !== false}
                                  onChange={async (checked) => {
                                    const newConfig = {
                                      ...documentsConfig,
                                      serviceInfoConfig: {
                                        ...documentsConfig.serviceInfoConfig,
                                        ico: checked,
                                      },
                                    };
                                    setDocumentsConfig(newConfig);
                                    await handleSaveDocumentsConfig(newConfig);
                                  }}
                                  label="IČO"
                                />
                              )}
                              {companyData.dic && (
                                <ModernCheckbox
                                  checked={documentsConfig.serviceInfoConfig?.dic !== false}
                                  onChange={async (checked) => {
                                    const newConfig = {
                                      ...documentsConfig,
                                      serviceInfoConfig: {
                                        ...documentsConfig.serviceInfoConfig,
                                        dic: checked,
                                      },
                                    };
                                    setDocumentsConfig(newConfig);
                                    await handleSaveDocumentsConfig(newConfig);
                                  }}
                                  label="DIČ"
                                />
                              )}
                              {companyData.addressStreet && (
                                <ModernCheckbox
                                  checked={documentsConfig.serviceInfoConfig?.addressStreet !== false}
                                  onChange={async (checked) => {
                                    const newConfig = {
                                      ...documentsConfig,
                                      serviceInfoConfig: {
                                        ...documentsConfig.serviceInfoConfig,
                                        addressStreet: checked,
                                      },
                                    };
                                    setDocumentsConfig(newConfig);
                                    await handleSaveDocumentsConfig(newConfig);
                                  }}
                                  label="Ulice"
                                />
                              )}
                              {companyData.addressCity && (
                                <ModernCheckbox
                                  checked={documentsConfig.serviceInfoConfig?.addressCity !== false}
                                  onChange={async (checked) => {
                                    const newConfig = {
                                      ...documentsConfig,
                                      serviceInfoConfig: {
                                        ...documentsConfig.serviceInfoConfig,
                                        addressCity: checked,
                                      },
                                    };
                                    setDocumentsConfig(newConfig);
                                    await handleSaveDocumentsConfig(newConfig);
                                  }}
                                  label="Město"
                                />
                              )}
                              {companyData.addressZip && (
                                <ModernCheckbox
                                  checked={documentsConfig.serviceInfoConfig?.addressZip !== false}
                                  onChange={async (checked) => {
                                    const newConfig = {
                                      ...documentsConfig,
                                      serviceInfoConfig: {
                                        ...documentsConfig.serviceInfoConfig,
                                        addressZip: checked,
                                      },
                                    };
                                    setDocumentsConfig(newConfig);
                                    await handleSaveDocumentsConfig(newConfig);
                                  }}
                                  label="PSČ"
                                />
                              )}
                            </>
                          )}
                          {/* Kontaktní údaje - zobrazit pouze pokud jsou vyplněné */}
                          {(companyData.phone || companyData.email || companyData.website) && (
                            <>
                              <div style={{ fontSize: 12, fontWeight: 700, color: "var(--muted)", marginTop: 8, marginBottom: 4 }}>Kontaktní údaje</div>
                              {companyData.phone && (
                                <ModernCheckbox
                                  checked={documentsConfig.serviceInfoConfig?.phone !== false}
                                  onChange={async (checked) => {
                                    const newConfig = {
                                      ...documentsConfig,
                                      serviceInfoConfig: {
                                        ...documentsConfig.serviceInfoConfig,
                                        phone: checked,
                                      },
                                    };
                                    setDocumentsConfig(newConfig);
                                    await handleSaveDocumentsConfig(newConfig);
                                  }}
                                  label="Telefon"
                                />
                              )}
                              {companyData.email && (
                                <ModernCheckbox
                                  checked={documentsConfig.serviceInfoConfig?.email !== false}
                                  onChange={async (checked) => {
                                    const newConfig = {
                                      ...documentsConfig,
                                      serviceInfoConfig: {
                                        ...documentsConfig.serviceInfoConfig,
                                        email: checked,
                                      },
                                    };
                                    setDocumentsConfig(newConfig);
                                    await handleSaveDocumentsConfig(newConfig);
                                  }}
                                  label="E-mail"
                                />
                              )}
                              {companyData.website && (
                                <ModernCheckbox
                                  checked={documentsConfig.serviceInfoConfig?.website !== false}
                                  onChange={async (checked) => {
                                    const newConfig = {
                                      ...documentsConfig,
                                      serviceInfoConfig: {
                                        ...documentsConfig.serviceInfoConfig,
                                        website: checked,
                                      },
                                    };
                                    setDocumentsConfig(newConfig);
                                    await handleSaveDocumentsConfig(newConfig);
                                  }}
                                  label="Web"
                                />
                              )}
                            </>
                          )}
                        </div>
                      )}
              </div>
                    <ModernCheckbox
                      checked={documentsConfig.ticketList.includeCustomerInfo}
                      onChange={async (checked) => {
                        const newConfig = { ...documentsConfig, ticketList: { ...documentsConfig.ticketList, includeCustomerInfo: checked } };
                        setDocumentsConfig(newConfig);
                        await handleSaveDocumentsConfig(newConfig);
                      }}
                      label="Údaje o zákazníkovi"
                    />
              <div>
                      <ModernCheckbox
                        checked={documentsConfig.ticketList.includeDeviceInfo}
                        onChange={async (checked) => {
                          const newConfig = { 
                            ...documentsConfig, 
                            ticketList: { 
                              ...documentsConfig.ticketList, 
                              includeDeviceInfo: checked,
                            },
                            // Initialize deviceInfoConfig if enabling
                            deviceInfoConfig: checked && !documentsConfig.deviceInfoConfig ? {
                              deviceLabel: true,
                              serialOrImei: true,
                              devicePasscode: true,
                              devicePasscodeVisible: false,
                              deviceCondition: true,
                              requestedRepair: true,
                              deviceNote: true,
                              handoffMethod: true,
                              externalId: true,
                            } : documentsConfig.deviceInfoConfig,
                          };
                          setDocumentsConfig(newConfig);
                          await handleSaveDocumentsConfig(newConfig);
                        }}
                        label="Údaje o zařízení"
                      />
                      {documentsConfig.ticketList.includeDeviceInfo && (
                        <div style={{ marginLeft: 32, marginTop: 8, display: "grid", gap: 8 }}>
                          <ModernCheckbox
                            checked={documentsConfig.deviceInfoConfig?.deviceLabel !== false}
                            onChange={async (checked) => {
                              const newConfig = {
                                ...documentsConfig,
                                deviceInfoConfig: {
                                  ...documentsConfig.deviceInfoConfig,
                                  deviceLabel: checked,
                                },
                              };
                              setDocumentsConfig(newConfig);
                              await handleSaveDocumentsConfig(newConfig);
                            }}
                            label="Zařízení"
                          />
                          <ModernCheckbox
                            checked={documentsConfig.deviceInfoConfig?.serialOrImei !== false}
                            onChange={async (checked) => {
                              const newConfig = {
                                ...documentsConfig,
                                deviceInfoConfig: {
                                  ...documentsConfig.deviceInfoConfig,
                                  serialOrImei: checked,
                                },
                              };
                              setDocumentsConfig(newConfig);
                              await handleSaveDocumentsConfig(newConfig);
                            }}
                            label="SN/IMEI"
                          />
                          <div>
                            <ModernCheckbox
                              checked={documentsConfig.deviceInfoConfig?.devicePasscode !== false}
                              onChange={async (checked) => {
                                const newConfig = {
                                  ...documentsConfig,
                                  deviceInfoConfig: {
                                    ...documentsConfig.deviceInfoConfig,
                                    devicePasscode: checked,
                                  },
                                };
                                setDocumentsConfig(newConfig);
                                await handleSaveDocumentsConfig(newConfig);
                              }}
                              label="Heslo/kód"
                            />
                            {documentsConfig.deviceInfoConfig?.devicePasscode !== false && (
                              <div style={{ marginLeft: 20, marginTop: 4 }}>
                                <ModernCheckbox
                                  checked={documentsConfig.deviceInfoConfig?.devicePasscodeVisible === true}
                                  onChange={async (checked) => {
                                    const newConfig = {
                                      ...documentsConfig,
                                      deviceInfoConfig: {
                                        ...documentsConfig.deviceInfoConfig,
                                        devicePasscodeVisible: checked,
                                      },
                                    };
                                    setDocumentsConfig(newConfig);
                                    await handleSaveDocumentsConfig(newConfig);
                                  }}
                                  label="Zobrazit heslo (místo křížků)"
                                />
                              </div>
                            )}
                          </div>
                          <ModernCheckbox
                            checked={documentsConfig.deviceInfoConfig?.deviceCondition !== false}
                            onChange={async (checked) => {
                              const newConfig = {
                                ...documentsConfig,
                                deviceInfoConfig: {
                                  ...documentsConfig.deviceInfoConfig,
                                  deviceCondition: checked,
                                },
                              };
                              setDocumentsConfig(newConfig);
                              await handleSaveDocumentsConfig(newConfig);
                            }}
                            label="Popis stavu"
                          />
                          <ModernCheckbox
                            checked={documentsConfig.deviceInfoConfig?.requestedRepair !== false}
                            onChange={async (checked) => {
                              const newConfig = {
                                ...documentsConfig,
                                deviceInfoConfig: {
                                  ...documentsConfig.deviceInfoConfig,
                                  requestedRepair: checked,
                                },
                              };
                              setDocumentsConfig(newConfig);
                              await handleSaveDocumentsConfig(newConfig);
                            }}
                            label="Požadovaná oprava/Problém"
                          />
                          <ModernCheckbox
                            checked={documentsConfig.deviceInfoConfig?.deviceNote !== false}
                            onChange={async (checked) => {
                              const newConfig = {
                                ...documentsConfig,
                                deviceInfoConfig: {
                                  ...documentsConfig.deviceInfoConfig,
                                  deviceNote: checked,
                                },
                              };
                              setDocumentsConfig(newConfig);
                              await handleSaveDocumentsConfig(newConfig);
                            }}
                            label="Poznámka"
                          />
                          <ModernCheckbox
                            checked={documentsConfig.deviceInfoConfig?.handoffMethod !== false}
                            onChange={async (checked) => {
                              const newConfig = {
                                ...documentsConfig,
                                deviceInfoConfig: {
                                  ...documentsConfig.deviceInfoConfig,
                                  handoffMethod: checked,
                                },
                              };
                              setDocumentsConfig(newConfig);
                              await handleSaveDocumentsConfig(newConfig);
                            }}
                            label="Předání/převzetí"
                          />
                          <ModernCheckbox
                            checked={documentsConfig.deviceInfoConfig?.externalId !== false}
                            onChange={async (checked) => {
                              const newConfig = {
                                ...documentsConfig,
                                deviceInfoConfig: {
                                  ...documentsConfig.deviceInfoConfig,
                                  externalId: checked,
                                },
                              };
                              setDocumentsConfig(newConfig);
                              await handleSaveDocumentsConfig(newConfig);
                            }}
                            label="Externí ID"
                          />
                        </div>
                      )}
                    </div>
                    <ModernCheckbox
                      checked={documentsConfig.ticketList.includeRepairs}
                      onChange={async (checked) => {
                        const newConfig = { ...documentsConfig, ticketList: { ...documentsConfig.ticketList, includeRepairs: checked } };
                        setDocumentsConfig(newConfig);
                        await handleSaveDocumentsConfig(newConfig);
                      }}
                      label="Provedené opravy"
                    />
                    <ModernCheckbox
                      checked={documentsConfig.ticketList.includeDiagnostic}
                      onChange={async (checked) => {
                        const newConfig = { ...documentsConfig, ticketList: { ...documentsConfig.ticketList, includeDiagnostic: checked } };
                        setDocumentsConfig(newConfig);
                        await handleSaveDocumentsConfig(newConfig);
                      }}
                      label="Diagnostika"
                    />
                    <ModernCheckbox
                      checked={documentsConfig.ticketList.includePhotos}
                      onChange={async (checked) => {
                        const newConfig = { ...documentsConfig, ticketList: { ...documentsConfig.ticketList, includePhotos: checked } };
                        setDocumentsConfig(newConfig);
                        await handleSaveDocumentsConfig(newConfig);
                      }}
                      label="Diagnostické fotografie"
                    />
                    <ModernCheckbox
                      checked={documentsConfig.ticketList.includeDates}
                      onChange={async (checked) => {
                        const newConfig = { ...documentsConfig, ticketList: { ...documentsConfig.ticketList, includeDates: checked } };
                        setDocumentsConfig(newConfig);
                        await handleSaveDocumentsConfig(newConfig);
                      }}
                      label="Datum"
                    />
                    <ModernCheckbox
                      checked={documentsConfig.ticketList.includeStamp}
                      onChange={async (checked) => {
                        const newConfig = { ...documentsConfig, ticketList: { ...documentsConfig.ticketList, includeStamp: checked } };
                        setDocumentsConfig(newConfig);
                        await handleSaveDocumentsConfig(newConfig);
                      }}
                      label="Razítko/podpis servisu"
                    />
                  </>
                )}
                {selectedDocumentType === "diagnosticProtocol" && (
                  <>
                    <div>
                      <ModernCheckbox
                      checked={documentsConfig.diagnosticProtocol.includeServiceInfo}
                        onChange={async (checked) => {
                        const newConfig = {
                          ...documentsConfig,
                            diagnosticProtocol: { 
                              ...documentsConfig.diagnosticProtocol, 
                              includeServiceInfo: checked,
                            },
                            // Initialize serviceInfoConfig if enabling
                            serviceInfoConfig: checked && !documentsConfig.serviceInfoConfig ? {
                              abbreviation: true,
                              name: true,
                              ico: true,
                              dic: true,
                              addressStreet: true,
                              addressCity: true,
                              addressZip: true,
                              phone: true,
                              email: true,
                              website: true,
                            } : documentsConfig.serviceInfoConfig,
                        };
                        setDocumentsConfig(newConfig);
                          await handleSaveDocumentsConfig(newConfig);
                        }}
                        label="Údaje o servisu"
                      />
                      {documentsConfig.diagnosticProtocol.includeServiceInfo && (
                        <div style={{ marginLeft: 32, marginTop: 8, display: "grid", gap: 8 }}>
                          <div style={{ fontSize: 12, fontWeight: 700, color: "var(--muted)", marginBottom: 4 }}>Základní údaje</div>
                          <ModernCheckbox
                            checked={documentsConfig.serviceInfoConfig?.abbreviation !== false}
                            onChange={async (checked) => {
                        const newConfig = {
                          ...documentsConfig,
                                serviceInfoConfig: {
                                  ...documentsConfig.serviceInfoConfig,
                                  abbreviation: checked,
                                },
                        };
                        setDocumentsConfig(newConfig);
                              await handleSaveDocumentsConfig(newConfig);
                            }}
                            label="Zkratka"
                          />
                          <ModernCheckbox
                            checked={documentsConfig.serviceInfoConfig?.name !== false}
                            onChange={async (checked) => {
                        const newConfig = {
                          ...documentsConfig,
                                serviceInfoConfig: {
                                  ...documentsConfig.serviceInfoConfig,
                                  name: checked,
                                },
                        };
                        setDocumentsConfig(newConfig);
                              await handleSaveDocumentsConfig(newConfig);
                            }}
                            label="Název"
                          />
                          <ModernCheckbox
                            checked={documentsConfig.serviceInfoConfig?.ico !== false}
                            onChange={async (checked) => {
                        const newConfig = {
                          ...documentsConfig,
                                serviceInfoConfig: {
                                  ...documentsConfig.serviceInfoConfig,
                                  ico: checked,
                                },
                        };
                        setDocumentsConfig(newConfig);
                              await handleSaveDocumentsConfig(newConfig);
                            }}
                            label="IČO"
                          />
                          <ModernCheckbox
                            checked={documentsConfig.serviceInfoConfig?.dic !== false}
                            onChange={async (checked) => {
                        const newConfig = {
                          ...documentsConfig,
                                serviceInfoConfig: {
                                  ...documentsConfig.serviceInfoConfig,
                                  dic: checked,
                                },
                        };
                        setDocumentsConfig(newConfig);
                              await handleSaveDocumentsConfig(newConfig);
                            }}
                            label="DIČ"
                          />
                          <ModernCheckbox
                            checked={documentsConfig.serviceInfoConfig?.addressStreet !== false}
                            onChange={async (checked) => {
                        const newConfig = {
                          ...documentsConfig,
                                serviceInfoConfig: {
                                  ...documentsConfig.serviceInfoConfig,
                                  addressStreet: checked,
                                },
                        };
                        setDocumentsConfig(newConfig);
                              await handleSaveDocumentsConfig(newConfig);
                            }}
                            label="Ulice"
                          />
                          <ModernCheckbox
                            checked={documentsConfig.serviceInfoConfig?.addressCity !== false}
                            onChange={async (checked) => {
                              const newConfig = {
                                ...documentsConfig,
                                serviceInfoConfig: {
                                  ...documentsConfig.serviceInfoConfig,
                                  addressCity: checked,
                                },
                              };
                              setDocumentsConfig(newConfig);
                              await handleSaveDocumentsConfig(newConfig);
                            }}
                            label="Město"
                          />
                          <ModernCheckbox
                            checked={documentsConfig.serviceInfoConfig?.addressZip !== false}
                            onChange={async (checked) => {
                              const newConfig = {
                                ...documentsConfig,
                                serviceInfoConfig: {
                                  ...documentsConfig.serviceInfoConfig,
                                  addressZip: checked,
                                },
                              };
                              setDocumentsConfig(newConfig);
                              await handleSaveDocumentsConfig(newConfig);
                            }}
                            label="PSČ"
                          />
                          <div style={{ fontSize: 12, fontWeight: 700, color: "var(--muted)", marginTop: 8, marginBottom: 4 }}>Kontaktní údaje</div>
                          <ModernCheckbox
                            checked={documentsConfig.serviceInfoConfig?.phone !== false}
                            onChange={async (checked) => {
                              const newConfig = {
                                ...documentsConfig,
                                serviceInfoConfig: {
                                  ...documentsConfig.serviceInfoConfig,
                                  phone: checked,
                                },
                              };
                              setDocumentsConfig(newConfig);
                              await handleSaveDocumentsConfig(newConfig);
                            }}
                            label="Telefon"
                          />
                          <ModernCheckbox
                            checked={documentsConfig.serviceInfoConfig?.email !== false}
                            onChange={async (checked) => {
                              const newConfig = {
                                ...documentsConfig,
                                serviceInfoConfig: {
                                  ...documentsConfig.serviceInfoConfig,
                                  email: checked,
                                },
                              };
                              setDocumentsConfig(newConfig);
                              await handleSaveDocumentsConfig(newConfig);
                            }}
                            label="E-mail"
                          />
                          <ModernCheckbox
                            checked={documentsConfig.serviceInfoConfig?.website !== false}
                            onChange={async (checked) => {
                              const newConfig = {
                                ...documentsConfig,
                                serviceInfoConfig: {
                                  ...documentsConfig.serviceInfoConfig,
                                  website: checked,
                                },
                              };
                              setDocumentsConfig(newConfig);
                              await handleSaveDocumentsConfig(newConfig);
                            }}
                            label="Web"
                          />
                </div>
                      )}
              </div>
                    <ModernCheckbox
                      checked={documentsConfig.diagnosticProtocol.includeCustomerInfo}
                      onChange={async (checked) => {
                        const newConfig = { ...documentsConfig, diagnosticProtocol: { ...documentsConfig.diagnosticProtocol, includeCustomerInfo: checked } };
                        setDocumentsConfig(newConfig);
                        await handleSaveDocumentsConfig(newConfig);
                      }}
                      label="Údaje o zákazníkovi"
                    />
                    <ModernCheckbox
                      checked={documentsConfig.diagnosticProtocol.includeDeviceInfo}
                      onChange={async (checked) => {
                        const newConfig = { ...documentsConfig, diagnosticProtocol: { ...documentsConfig.diagnosticProtocol, includeDeviceInfo: checked } };
                        setDocumentsConfig(newConfig);
                        await handleSaveDocumentsConfig(newConfig);
                      }}
                      label="Údaje o zařízení"
                    />
                    <ModernCheckbox
                      checked={documentsConfig.diagnosticProtocol.includeDiagnosticText}
                      onChange={async (checked) => {
                        const newConfig = { ...documentsConfig, diagnosticProtocol: { ...documentsConfig.diagnosticProtocol, includeDiagnosticText: checked } };
                        setDocumentsConfig(newConfig);
                        await handleSaveDocumentsConfig(newConfig);
                      }}
                      label="Text diagnostiky"
                    />
                    <ModernCheckbox
                      checked={documentsConfig.diagnosticProtocol.includePhotos}
                      onChange={async (checked) => {
                        const newConfig = { ...documentsConfig, diagnosticProtocol: { ...documentsConfig.diagnosticProtocol, includePhotos: checked } };
                        setDocumentsConfig(newConfig);
                        await handleSaveDocumentsConfig(newConfig);
                      }}
                      label="Diagnostické fotografie"
                    />
                    <ModernCheckbox
                      checked={documentsConfig.diagnosticProtocol.includeDates}
                      onChange={async (checked) => {
                        const newConfig = { ...documentsConfig, diagnosticProtocol: { ...documentsConfig.diagnosticProtocol, includeDates: checked } };
                        setDocumentsConfig(newConfig);
                        await handleSaveDocumentsConfig(newConfig);
                      }}
                      label="Datum"
                    />
                  </>
                )}
                {selectedDocumentType === "warrantyCertificate" && (
                  <>
              <div>
                      <ModernCheckbox
                      checked={documentsConfig.warrantyCertificate.includeServiceInfo}
                        onChange={async (checked) => {
                        const newConfig = {
                          ...documentsConfig,
                            warrantyCertificate: { 
                              ...documentsConfig.warrantyCertificate, 
                              includeServiceInfo: checked,
                            },
                            // Initialize serviceInfoConfig if enabling
                            serviceInfoConfig: checked && !documentsConfig.serviceInfoConfig ? {
                              abbreviation: true,
                              name: true,
                              ico: true,
                              dic: true,
                              addressStreet: true,
                              addressCity: true,
                              addressZip: true,
                              phone: true,
                              email: true,
                              website: true,
                            } : documentsConfig.serviceInfoConfig,
                        };
                        setDocumentsConfig(newConfig);
                        await handleSaveDocumentsConfig(newConfig);
                      }}
                        label="Údaje o servisu"
                      />
                      {documentsConfig.warrantyCertificate.includeServiceInfo && (
                        <div style={{ marginLeft: 32, marginTop: 8, display: "grid", gap: 8 }}>
                          <div style={{ fontSize: 12, fontWeight: 700, color: "var(--muted)", marginBottom: 4 }}>Základní údaje</div>
                          <ModernCheckbox
                            checked={documentsConfig.serviceInfoConfig?.abbreviation !== false}
                            onChange={async (checked) => {
                        const newConfig = {
                          ...documentsConfig,
                                serviceInfoConfig: {
                                  ...documentsConfig.serviceInfoConfig,
                                  abbreviation: checked,
                                },
                        };
                        setDocumentsConfig(newConfig);
                        await handleSaveDocumentsConfig(newConfig);
                      }}
                            label="Zkratka"
                          />
                          <ModernCheckbox
                            checked={documentsConfig.serviceInfoConfig?.name !== false}
                            onChange={async (checked) => {
                              const newConfig = {
                                ...documentsConfig,
                                serviceInfoConfig: {
                                  ...documentsConfig.serviceInfoConfig,
                                  name: checked,
                                },
                              };
                              setDocumentsConfig(newConfig);
                              await handleSaveDocumentsConfig(newConfig);
                            }}
                            label="Název"
                          />
                          <ModernCheckbox
                            checked={documentsConfig.serviceInfoConfig?.ico !== false}
                            onChange={async (checked) => {
                              const newConfig = {
                                ...documentsConfig,
                                serviceInfoConfig: {
                                  ...documentsConfig.serviceInfoConfig,
                                  ico: checked,
                                },
                              };
                              setDocumentsConfig(newConfig);
                              await handleSaveDocumentsConfig(newConfig);
                            }}
                            label="IČO"
                          />
                          <ModernCheckbox
                            checked={documentsConfig.serviceInfoConfig?.dic !== false}
                            onChange={async (checked) => {
                              const newConfig = {
                                ...documentsConfig,
                                serviceInfoConfig: {
                                  ...documentsConfig.serviceInfoConfig,
                                  dic: checked,
                                },
                              };
                              setDocumentsConfig(newConfig);
                              await handleSaveDocumentsConfig(newConfig);
                            }}
                            label="DIČ"
                          />
                          <ModernCheckbox
                            checked={documentsConfig.serviceInfoConfig?.addressStreet !== false}
                            onChange={async (checked) => {
                              const newConfig = {
                                ...documentsConfig,
                                serviceInfoConfig: {
                                  ...documentsConfig.serviceInfoConfig,
                                  addressStreet: checked,
                                },
                              };
                              setDocumentsConfig(newConfig);
                              await handleSaveDocumentsConfig(newConfig);
                            }}
                            label="Ulice"
                          />
                          <ModernCheckbox
                            checked={documentsConfig.serviceInfoConfig?.addressCity !== false}
                            onChange={async (checked) => {
                              const newConfig = {
                                ...documentsConfig,
                                serviceInfoConfig: {
                                  ...documentsConfig.serviceInfoConfig,
                                  addressCity: checked,
                                },
                              };
                              setDocumentsConfig(newConfig);
                              await handleSaveDocumentsConfig(newConfig);
                            }}
                            label="Město"
                          />
                          <ModernCheckbox
                            checked={documentsConfig.serviceInfoConfig?.addressZip !== false}
                            onChange={async (checked) => {
                              const newConfig = {
                                ...documentsConfig,
                                serviceInfoConfig: {
                                  ...documentsConfig.serviceInfoConfig,
                                  addressZip: checked,
                                },
                              };
                              setDocumentsConfig(newConfig);
                              await handleSaveDocumentsConfig(newConfig);
                            }}
                            label="PSČ"
                          />
                          <div style={{ fontSize: 12, fontWeight: 700, color: "var(--muted)", marginTop: 8, marginBottom: 4 }}>Kontaktní údaje</div>
                          <ModernCheckbox
                            checked={documentsConfig.serviceInfoConfig?.phone !== false}
                            onChange={async (checked) => {
                              const newConfig = {
                                ...documentsConfig,
                                serviceInfoConfig: {
                                  ...documentsConfig.serviceInfoConfig,
                                  phone: checked,
                                },
                              };
                              setDocumentsConfig(newConfig);
                              await handleSaveDocumentsConfig(newConfig);
                            }}
                            label="Telefon"
                          />
                          <ModernCheckbox
                            checked={documentsConfig.serviceInfoConfig?.email !== false}
                            onChange={async (checked) => {
                              const newConfig = {
                                ...documentsConfig,
                                serviceInfoConfig: {
                                  ...documentsConfig.serviceInfoConfig,
                                  email: checked,
                                },
                              };
                              setDocumentsConfig(newConfig);
                              await handleSaveDocumentsConfig(newConfig);
                            }}
                            label="E-mail"
                          />
                          <ModernCheckbox
                            checked={documentsConfig.serviceInfoConfig?.website !== false}
                            onChange={async (checked) => {
                              const newConfig = {
                                ...documentsConfig,
                                serviceInfoConfig: {
                                  ...documentsConfig.serviceInfoConfig,
                                  website: checked,
                                },
                              };
                              setDocumentsConfig(newConfig);
                              await handleSaveDocumentsConfig(newConfig);
                            }}
                            label="Web"
                          />
                        </div>
                      )}
                    </div>
                    <ModernCheckbox
                      checked={documentsConfig.warrantyCertificate.includeCustomerInfo}
                      onChange={async (checked) => {
                        const newConfig = { ...documentsConfig, warrantyCertificate: { ...documentsConfig.warrantyCertificate, includeCustomerInfo: checked } };
                        setDocumentsConfig(newConfig);
                        await handleSaveDocumentsConfig(newConfig);
                      }}
                      label="Údaje o zákazníkovi"
                    />
                    <div>
                      <ModernCheckbox
                        checked={documentsConfig.warrantyCertificate.includeDeviceInfo}
                        onChange={async (checked) => {
                        const newConfig = {
                          ...documentsConfig,
                            warrantyCertificate: { 
                              ...documentsConfig.warrantyCertificate, 
                              includeDeviceInfo: checked,
                            },
                            // Initialize deviceInfoConfig if enabling
                            deviceInfoConfig: checked && !documentsConfig.deviceInfoConfig ? {
                              deviceLabel: true,
                              serialOrImei: true,
                              devicePasscode: true,
                              devicePasscodeVisible: false,
                              deviceCondition: true,
                              requestedRepair: true,
                              deviceNote: true,
                              handoffMethod: true,
                              externalId: true,
                            } : documentsConfig.deviceInfoConfig,
                        };
                        setDocumentsConfig(newConfig);
                        await handleSaveDocumentsConfig(newConfig);
                      }}
                        label="Údaje o zařízení"
                      />
                      {documentsConfig.warrantyCertificate.includeDeviceInfo && (
                        <div style={{ marginLeft: 32, marginTop: 8, display: "grid", gap: 8 }}>
                          <ModernCheckbox
                            checked={documentsConfig.deviceInfoConfig?.deviceLabel !== false}
                            onChange={async (checked) => {
                        const newConfig = {
                          ...documentsConfig,
                                deviceInfoConfig: {
                                  ...documentsConfig.deviceInfoConfig,
                                  deviceLabel: checked,
                                },
                        };
                        setDocumentsConfig(newConfig);
                        await handleSaveDocumentsConfig(newConfig);
                      }}
                            label="Zařízení"
                          />
                          <ModernCheckbox
                            checked={documentsConfig.deviceInfoConfig?.serialOrImei !== false}
                            onChange={async (checked) => {
                              const newConfig = {
                                ...documentsConfig,
                                deviceInfoConfig: {
                                  ...documentsConfig.deviceInfoConfig,
                                  serialOrImei: checked,
                                },
                              };
                              setDocumentsConfig(newConfig);
                              await handleSaveDocumentsConfig(newConfig);
                            }}
                            label="SN/IMEI"
                          />
                        </div>
                      )}
                    </div>
                    <ModernCheckbox
                      checked={documentsConfig.warrantyCertificate.includeRepairs}
                      onChange={async (checked) => {
                        const newConfig = { ...documentsConfig, warrantyCertificate: { ...documentsConfig.warrantyCertificate, includeRepairs: checked } };
                        setDocumentsConfig(newConfig);
                        await handleSaveDocumentsConfig(newConfig);
                      }}
                      label="Provedené opravy"
                    />
                    <ModernCheckbox
                      checked={documentsConfig.warrantyCertificate.includeDates}
                      onChange={async (checked) => {
                        const newConfig = { ...documentsConfig, warrantyCertificate: { ...documentsConfig.warrantyCertificate, includeDates: checked } };
                        setDocumentsConfig(newConfig);
                        await handleSaveDocumentsConfig(newConfig);
                      }}
                      label="Datum"
                    />
                    <ModernCheckbox
                      checked={documentsConfig.warrantyCertificate.includeWarranty}
                      onChange={async (checked) => {
                        const newConfig = { ...documentsConfig, warrantyCertificate: { ...documentsConfig.warrantyCertificate, includeWarranty: checked } };
                        setDocumentsConfig(newConfig);
                        await handleSaveDocumentsConfig(newConfig);
                      }}
                      label="Záruka"
                    />
                    {documentsConfig.warrantyCertificate.includeWarranty && (
                      <div style={{ marginLeft: 20, marginTop: 10, marginBottom: 10, maxWidth: "100%" }}>
                        <div style={{ marginBottom: 12 }}>
                          <div style={{ fontSize: 13, fontWeight: 600, color: "var(--text)", marginBottom: 8 }}>
                            Typ záruky:
                          </div>
                          <div style={{ display: "flex", gap: 8 }}>
                            <ModernRadioButton
                              checked={documentsConfig.warrantyCertificate.warrantyType === "unified"}
                              onChange={async () => {
                                const newConfig = { ...documentsConfig, warrantyCertificate: { ...documentsConfig.warrantyCertificate, warrantyType: "unified" as const } };
                                setDocumentsConfig(newConfig);
                                await handleSaveDocumentsConfig(newConfig);
                              }}
                              label="Jednotná"
                              name="warranty-type-copy"
                            />
                            <ModernRadioButton
                              checked={documentsConfig.warrantyCertificate.warrantyType === "separate"}
                              onChange={async () => {
                                const newConfig = { ...documentsConfig, warrantyCertificate: { ...documentsConfig.warrantyCertificate, warrantyType: "separate" as const } };
                                setDocumentsConfig(newConfig);
                                await handleSaveDocumentsConfig(newConfig);
                              }}
                              label="Zvlášť"
                              name="warranty-type-copy"
                            />
                          </div>
                        </div>
                        {documentsConfig.warrantyCertificate.warrantyType === "unified" ? (
                          <div style={{ marginBottom: 10 }}>
                            <div style={{ fontSize: 13, fontWeight: 600, color: "var(--text)", marginBottom: 8 }}>
                              Délka záruky:
                            </div>
                            <div style={{ display: "flex", gap: 8, alignItems: "center", maxWidth: 280 }}>
                              <input
                                type="number"
                                min="1"
                                value={documentsConfig.warrantyCertificate.warrantyUnifiedDuration || 12}
                      onChange={async (e) => {
                        const newConfig = { ...documentsConfig, warrantyCertificate: { ...documentsConfig.warrantyCertificate, warrantyUnifiedDuration: parseInt(e.target.value) || 12 } };
                        setDocumentsConfig(newConfig);
                        await handleSaveDocumentsConfig(newConfig);
                      }}
                                style={{ width: 70, padding: "8px 10px", borderRadius: 8, border: "1px solid var(--border)", fontSize: 13, background: "var(--panel)", color: "var(--text)" }}
                              />
                              <UnitPicker
                                value={documentsConfig.warrantyCertificate.warrantyUnifiedUnit || "months"}
                                onChange={async (value) => {
                                  const newConfig = { ...documentsConfig, warrantyCertificate: { ...documentsConfig.warrantyCertificate, warrantyUnifiedUnit: value } };
                                  setDocumentsConfig(newConfig);
                                  await handleSaveDocumentsConfig(newConfig);
                                }}
                                duration={documentsConfig.warrantyCertificate.warrantyUnifiedDuration || 12}
                              />
                            </div>
                          </div>
                        ) : (
                          <div style={{ marginBottom: 10 }}>
                            <div style={{ fontSize: 13, fontWeight: 600, color: "var(--text)", marginBottom: 8 }}>
                              Typy záruk:
                            </div>
                            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                              {(documentsConfig.warrantyCertificate.warrantyItems || []).map((item, index) => (
                                <div key={index} style={{ display: "flex", gap: 8, alignItems: "center", maxWidth: "100%" }}>
                    <input
                                    type="text"
                                    value={item.name}
                      onChange={async (e) => {
                        const newItems = [...(documentsConfig.warrantyCertificate.warrantyItems || [])];
                        newItems[index] = { ...newItems[index], name: e.target.value };
                        const newConfig = { ...documentsConfig, warrantyCertificate: { ...documentsConfig.warrantyCertificate, warrantyItems: newItems } };
                        setDocumentsConfig(newConfig);
                        await handleSaveDocumentsConfig(newConfig);
                      }}
                                    placeholder="Název"
                                    style={{ width: 100, padding: "8px 10px", borderRadius: 8, border: "1px solid var(--border)", fontSize: 13, background: "var(--panel)", color: "var(--text)" }}
                                  />
                                  <input
                                    type="number"
                                    min="1"
                                    value={item.duration}
                                    onChange={async (e) => {
                                      const newItems = [...(documentsConfig.warrantyCertificate.warrantyItems || [])];
                                      newItems[index] = { ...newItems[index], duration: parseInt(e.target.value) || 1 };
                                      const newConfig = { ...documentsConfig, warrantyCertificate: { ...documentsConfig.warrantyCertificate, warrantyItems: newItems } };
                                      setDocumentsConfig(newConfig);
                                      await handleSaveDocumentsConfig(newConfig);
                                    }}
                                    style={{ width: 70, padding: "8px 10px", borderRadius: 8, border: "1px solid var(--border)", fontSize: 13, background: "var(--panel)", color: "var(--text)" }}
                                  />
                                  <UnitPicker
                                    value={item.unit}
                                    onChange={async (value) => {
                                      const newItems = [...(documentsConfig.warrantyCertificate.warrantyItems || [])];
                                      newItems[index] = { ...newItems[index], unit: value };
                                      const newConfig = { ...documentsConfig, warrantyCertificate: { ...documentsConfig.warrantyCertificate, warrantyItems: newItems } };
                                      setDocumentsConfig(newConfig);
                                      await handleSaveDocumentsConfig(newConfig);
                                    }}
                                    duration={item.duration}
                                  />
                                  <button
                                    onClick={async () => {
                                      const newItems = (documentsConfig.warrantyCertificate.warrantyItems || []).filter((_, i) => i !== index);
                                      const newConfig = { ...documentsConfig, warrantyCertificate: { ...documentsConfig.warrantyCertificate, warrantyItems: newItems } };
                                      setDocumentsConfig(newConfig);
                                      await handleSaveDocumentsConfig(newConfig);
                                    }}
                                    style={{ padding: "8px 12px", borderRadius: 8, border: "1px solid var(--border)", background: "var(--panel)", color: "var(--text)", cursor: "pointer", fontSize: 12, fontWeight: 500 }}
                                  >
                                    ✕
                                  </button>
                </div>
                              ))}
                              <button
                                onClick={async () => {
                                  const newItems = [...(documentsConfig.warrantyCertificate.warrantyItems || []), { name: "", duration: 12, unit: "months" as const }];
                                  const newConfig = { ...documentsConfig, warrantyCertificate: { ...documentsConfig.warrantyCertificate, warrantyItems: newItems } };
                                  setDocumentsConfig(newConfig);
                                  await handleSaveDocumentsConfig(newConfig);
                                }}
                                style={{ padding: "8px 12px", borderRadius: 8, border: "1px solid var(--border)", background: "var(--accent-soft)", color: "var(--accent)", cursor: "pointer", fontSize: 13, fontWeight: 600, alignSelf: "flex-start" }}
                              >
                                + Přidat typ záruky
                              </button>
                            </div>
                          </div>
                        )}
                      </div>
                    )}
                  </>
                )}
              </div>

              {/* Logo servisu */}
              <CustomizationCategory
                checked={openCategories.logo}
                onChange={(checked) => {
                  setOpenCategories(prev => ({ ...prev, logo: checked }));
                  if (!checked) {
                    const newConfig = { ...documentsConfig, logoUrl: undefined };
                        setDocumentsConfig(newConfig);
                        saveDocumentsConfigWithDB(activeServiceId, newConfig);
                  }
                }}
                label="Logo servisu"
              >
                    <input
                  type="file"
                  accept="image/*"
                      onChange={async (e) => {
                    const file = e.target.files?.[0];
                    if (file) {
                      const reader = new FileReader();
                      reader.onload = async (event) => {
                        const base64 = event.target?.result as string;
                        const newConfig = { ...documentsConfig, logoUrl: base64 };
                        setDocumentsConfig(newConfig);
                        await handleSaveDocumentsConfig(newConfig);
                      };
                      reader.readAsDataURL(file);
                    }
                  }}
                  style={{ display: "none" }}
                  id="logo-upload-copy"
                />
                <label
                  htmlFor="logo-upload-copy"
                  style={{
                    display: "block",
                    padding: "12px",
                    borderRadius: 10,
                    border: "1px dashed var(--border)",
                    background: "var(--panel)",
                    cursor: "pointer",
                    textAlign: "center",
                    fontSize: 13,
                    color: "var(--text)",
                    transition: "var(--transition-smooth)",
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.borderColor = "var(--accent)";
                    e.currentTarget.style.background = "var(--accent-soft)";
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.borderColor = "var(--border)";
                    e.currentTarget.style.background = "var(--panel)";
                  }}
                >
                  {documentsConfig.logoUrl ? "📷 Změnit logo" : "➕ Nahrát logo"}
                  </label>
                {documentsConfig.logoUrl && (
                  <>
                    <img
                      src={documentsConfig.logoUrl}
                      alt="Logo servisu"
                      style={{ width: "100%", maxHeight: 100, objectFit: "contain", marginTop: 12, borderRadius: 8 }}
                    />
                    <div style={{ marginTop: 12 }}>
                      <div style={{ fontSize: 12, fontWeight: 600, color: "var(--text)", marginBottom: 8 }}>
                        Velikost loga: {documentsConfig.logoSize ?? 100}%
                      </div>
                    <input
                        type="range"
                        min="50"
                        max="200"
                        step="5"
                        value={documentsConfig.logoSize ?? 100}
                      onChange={async (e) => {
                          const newConfig = { ...documentsConfig, logoSize: parseInt(e.target.value) };
                        setDocumentsConfig(newConfig);
                        await handleSaveDocumentsConfig(newConfig);
                      }}
                        style={{
                          width: "100%",
                          height: 6,
                          borderRadius: 3,
                          background: "var(--border)",
                          outline: "none",
                          cursor: "pointer",
                        }}
                      />
                    </div>
                  </>
                )}
              </CustomizationCategory>

              {/* Podmínky (Právní text) */}
              <CustomizationCategory
                checked={openCategories.conditions}
                onChange={(checked) => {
                  setOpenCategories(prev => ({ ...prev, conditions: checked }));
                  if (!checked) {
                    const newConfig = { ...documentsConfig };
                    if (selectedDocumentType === "ticketList") {
                      newConfig.ticketList = { ...newConfig.ticketList, legalText: "" };
                    } else if (selectedDocumentType === "diagnosticProtocol") {
                      newConfig.diagnosticProtocol = { ...newConfig.diagnosticProtocol, legalText: "" };
                    } else {
                      newConfig.warrantyCertificate = { ...newConfig.warrantyCertificate, legalText: "" };
                    }
                    setDocumentsConfig(newConfig);
                    saveDocumentsConfigWithDB(activeServiceId, newConfig);
                  }
                }}
                label="Podmínky"
              >
                <textarea
                  value={
                    selectedDocumentType === "ticketList" ? documentsConfig.ticketList.legalText :
                    selectedDocumentType === "diagnosticProtocol" ? documentsConfig.diagnosticProtocol.legalText :
                    documentsConfig.warrantyCertificate.legalText
                  }
                  onChange={async (e) => {
                    const newConfig = { ...documentsConfig };
                    if (selectedDocumentType === "ticketList") {
                      newConfig.ticketList = { ...newConfig.ticketList, legalText: e.target.value };
                    } else if (selectedDocumentType === "diagnosticProtocol") {
                      newConfig.diagnosticProtocol = { ...newConfig.diagnosticProtocol, legalText: e.target.value };
                    } else {
                      newConfig.warrantyCertificate = { ...newConfig.warrantyCertificate, legalText: e.target.value };
                    }
                    setDocumentsConfig(newConfig);
                    await handleSaveDocumentsConfig(newConfig);
                  }}
                  disabled={!isAdmin}
                  rows={4}
                  style={{
                    width: "100%",
                    padding: "10px 12px",
                    borderRadius: 10,
                    border: "1px solid var(--border)",
                    background: "var(--panel)",
                    color: "var(--text)",
                    fontSize: 13,
                    fontFamily: "system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif",
                    resize: "vertical",
                    outline: "none",
                  }}
                  placeholder="Zadejte podmínky pro tento dokument..."
                />
              </CustomizationCategory>

              {/* Razítko / Podpis */}
              <CustomizationCategory
                checked={openCategories.stamp}
                onChange={(checked) => {
                  setOpenCategories(prev => ({ ...prev, stamp: checked }));
                  if (!checked) {
                    const newConfig = { ...documentsConfig, stampUrl: undefined };
                    setDocumentsConfig(newConfig);
                    saveDocumentsConfigWithDB(activeServiceId, newConfig);
                  }
                }}
                label="Razítko / Podpis"
              >
                    <input
                  type="file"
                  accept="image/*"
                      onChange={async (e) => {
                    const file = e.target.files?.[0];
                    if (file) {
                      const reader = new FileReader();
                      reader.onload = async (event) => {
                        const base64 = event.target?.result as string;
                        const newConfig = { ...documentsConfig, stampUrl: base64 };
                        setDocumentsConfig(newConfig);
                        await handleSaveDocumentsConfig(newConfig);
                      };
                      reader.readAsDataURL(file);
                    }
                  }}
                  style={{ display: "none" }}
                  id="stamp-upload-copy"
                />
                <label
                  htmlFor="stamp-upload-copy"
                  style={{
                    display: "block",
                    padding: "12px",
                    borderRadius: 10,
                    border: "1px dashed var(--border)",
                    background: "var(--panel)",
                    cursor: "pointer",
                    textAlign: "center",
                    fontSize: 13,
                    color: "var(--text)",
                    transition: "var(--transition-smooth)",
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.borderColor = "var(--accent)";
                    e.currentTarget.style.background = "var(--accent-soft)";
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.borderColor = "var(--border)";
                    e.currentTarget.style.background = "var(--panel)";
                  }}
                >
                  {documentsConfig.stampUrl ? "📷 Změnit razítko" : "➕ Nahrát razítko"}
                  </label>
                {documentsConfig.stampUrl && (
                  <>
                    <img
                      src={documentsConfig.stampUrl}
                      alt="Razítko"
                      style={{ width: "100%", maxHeight: 100, objectFit: "contain", marginTop: 12, borderRadius: 8 }}
                    />
                    <div style={{ marginTop: 12 }}>
                      <div style={{ fontSize: 12, fontWeight: 600, color: "var(--text)", marginBottom: 8 }}>
                        Velikost razítka: {documentsConfig.stampSize ?? 100}%
                      </div>
                    <input
                        type="range"
                        min="50"
                        max="200"
                        step="5"
                        value={documentsConfig.stampSize ?? 100}
                      onChange={async (e) => {
                          const newConfig = { ...documentsConfig, stampSize: parseInt(e.target.value) };
                          setDocumentsConfig(newConfig);
                          await handleSaveDocumentsConfig(newConfig);
                        }}
                        style={{
                          width: "100%",
                          height: 6,
                          borderRadius: 3,
                          background: "var(--border)",
                          outline: "none",
                          cursor: "pointer",
                        }}
                      />
                    </div>
                  </>
                )}
              </CustomizationCategory>

              {/* QR kód (pouze pro záruční list) */}
              {selectedDocumentType === "warrantyCertificate" && (
                <CustomizationCategory
                  checked={openCategories.qr}
                  onChange={async (checked) => {
                    setOpenCategories(prev => ({ ...prev, qr: checked }));
                    if (checked) {
                        const newConfig = {
                          ...documentsConfig,
                        reviewUrlType: documentsConfig.reviewUrlType || "custom",
                        reviewUrl: documentsConfig.reviewUrl ?? "",
                        googlePlaceId: documentsConfig.googlePlaceId ?? "",
                        };
                        setDocumentsConfig(newConfig);
                        await handleSaveDocumentsConfig(newConfig);
                    } else if (!checked) {
                      const newConfig = {
                        ...documentsConfig,
                        reviewUrl: undefined,
                        googlePlaceId: undefined,
                        };
                        setDocumentsConfig(newConfig);
                        saveDocumentsConfigWithDB(activeServiceId, newConfig);
                    }
                  }}
                  label="QR kód"
                >
                  <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                    <div>
                      <div style={{ fontSize: 12, fontWeight: 600, color: "var(--text)", marginBottom: 8 }}>Typ odkazu</div>
                      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                        <ModernRadioButton
                          checked={documentsConfig.reviewUrlType === "custom"}
                          onChange={async () => {
                            const newConfig = { ...documentsConfig, reviewUrlType: "custom" as const };
                            setDocumentsConfig(newConfig);
                            await handleSaveDocumentsConfig(newConfig);
                          }}
                          label="Vlastní odkaz"
                          name="reviewUrlType-copy"
                        />
                        <ModernRadioButton
                          checked={documentsConfig.reviewUrlType === "google"}
                          onChange={async () => {
                            const newConfig = { ...documentsConfig, reviewUrlType: "google" as const };
                            setDocumentsConfig(newConfig);
                            await handleSaveDocumentsConfig(newConfig);
                          }}
                          label="Podle Google ID lokace"
                          name="reviewUrlType-copy"
                        />
                </div>
              </div>

                    {documentsConfig.reviewUrlType === "custom" ? (
                      <div>
                        <div style={{ fontSize: 12, fontWeight: 600, color: "var(--text)", marginBottom: 6 }}>Odkaz na hodnocení servisu</div>
                    <input
                          type="url"
                          value={documentsConfig.reviewUrl ?? ""}
                      onChange={async (e) => {
                            const trimmed = e.target.value.trim();
                            const newConfig = { ...documentsConfig, reviewUrl: trimmed || (openCategories.qr ? "" : undefined) };
                        setDocumentsConfig(newConfig);
                        await handleSaveDocumentsConfig(newConfig);
                      }}
                          placeholder="https://example.com/review"
                          style={{
                            width: "100%",
                            padding: "10px 12px",
                            borderRadius: 10,
                            border: "1px solid var(--border)",
                            background: "var(--panel)",
                            color: "var(--text)",
                            fontSize: 13,
                            fontFamily: "system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif",
                            outline: "none",
                          }}
                        />
            </div>
                    ) : (
                      <div>
                        <div style={{ fontSize: 12, fontWeight: 600, color: "var(--text)", marginBottom: 6, display: "flex", alignItems: "center", gap: 6 }}>
                          ID pobočky
                          <div style={{ position: "relative", display: "inline-block" }}>
                            <div
                              ref={placeIdQuestionRef}
                              style={{
                                width: 16,
                                height: 16,
                                borderRadius: "50%",
                                border: `1.5px solid ${showPlaceIdTooltip ? "var(--accent)" : "var(--muted)"}`,
                                display: "flex",
                                alignItems: "center",
                                justifyContent: "center",
                                cursor: "help",
                                fontSize: 11,
                                fontWeight: 700,
                                color: showPlaceIdTooltip ? "var(--accent)" : "var(--muted)",
                                transition: "var(--transition-smooth)",
                              }}
                              onMouseEnter={() => {
                                if (tooltipTimeoutRef.current) {
                                  window.clearTimeout(tooltipTimeoutRef.current);
                                  tooltipTimeoutRef.current = null;
                                }
                                setShowPlaceIdTooltip(true);
                              }}
                              onMouseLeave={() => {
                                tooltipTimeoutRef.current = window.setTimeout(() => {
                                  setShowPlaceIdTooltip(false);
                                }, 200);
                              }}
                            >
                              ?
              </div>
                            {showPlaceIdTooltip && tooltipPosition && createPortal(
                              <div
                                data-tooltip-wrapper
                                style={{
                                  position: "fixed",
                                  top: tooltipPosition?.top || 0,
                                  left: tooltipPosition?.left || 0,
                                  transform: "translateX(-50%)",
                                  zIndex: 10000,
                                  pointerEvents: "auto",
                                }}
                                onMouseEnter={() => {
                                  if (tooltipTimeoutRef.current) {
                                    window.clearTimeout(tooltipTimeoutRef.current);
                                    tooltipTimeoutRef.current = null;
                                  }
                                  setShowPlaceIdTooltip(true);
                                }}
                                onMouseLeave={() => {
                                  tooltipTimeoutRef.current = window.setTimeout(() => {
                                    setShowPlaceIdTooltip(false);
                                  }, 200);
                                }}
                              >
                                <div
                                  style={{
                                    padding: "12px 16px",
                                    background: "var(--panel)",
                                    border: "1px solid var(--border)",
                                    borderRadius: 10,
                                    fontSize: 12,
                                    color: "var(--text)",
                                    whiteSpace: "normal",
                                    wordWrap: "break-word",
                                    overflowWrap: "break-word",
                                    boxShadow: "0 4px 12px rgba(0, 0, 0, 0.15)",
                                    display: "flex",
                                    flexDirection: "column",
                                    gap: 8,
                                    width: 320,
                                    maxWidth: "90vw",
                                  }}
                                >
                                  <div style={{ lineHeight: "1.5" }}>ID svojí pobočky najdete tak, že na tomto odkaze najdete svou pobočku:</div>
                                  <button
                                    type="button"
                    disabled={!isAdmin}
                                    onClick={async (e) => {
                                      e.stopPropagation();
                                      const url = "https://developers.google.com/maps/documentation/javascript/examples/places-placeid-finder";
                                      
                                      const isTauri = typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
                                      
                                      if (isTauri) {
                                        try {
                                          const { openUrl } = await import('@tauri-apps/plugin-opener');
                                          await openUrl(url);
                                        } catch (err) {
                                          console.error("Failed to open URL with Tauri opener:", err);
                                          window.open(url, "_blank", "noopener,noreferrer");
                                        }
                                      } else {
                                        window.open(url, "_blank", "noopener,noreferrer");
                                      }
                                    }}
                                    style={{
                                      padding: "6px 12px",
                                      borderRadius: 6,
                                      border: "1px solid var(--accent)",
                                      background: "var(--accent)",
                                      color: "white",
                                      fontSize: 12,
                                      fontWeight: 600,
                                      cursor: "pointer",
                                      transition: "var(--transition-smooth)",
                                      alignSelf: "flex-start",
                                      fontFamily: "inherit",
                                    }}
                                    onMouseEnter={(e) => {
                                      e.currentTarget.style.opacity = "0.9";
                                    }}
                                    onMouseLeave={(e) => {
                                      e.currentTarget.style.opacity = "1";
                                    }}
                                  >
                                    Otevřít Place ID Finder
                                  </button>
            </div>
                              </div>,
                              document.body
                            )}
                          </div>
                        </div>
                        <div style={{ display: "flex", gap: 8 }}>
                          <input
                            type="text"
                            value={documentsConfig.googlePlaceId ?? ""}
                            onChange={async (e) => {
                              const trimmed = e.target.value.trim();
                              const newConfig = { ...documentsConfig, googlePlaceId: trimmed || (openCategories.qr ? "" : undefined) };
                              setDocumentsConfig(newConfig);
                              await handleSaveDocumentsConfig(newConfig);
                            }}
                            placeholder="ChIJN1t_tDeuEmsRUsoyG83frY4"
                            style={{
                              flex: 1,
                              padding: "10px 12px",
                              borderRadius: 10,
                              border: "1px solid var(--border)",
                              background: "var(--panel)",
                              color: "var(--text)",
                              fontSize: 13,
                              fontFamily: "system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif",
                              outline: "none",
                            }}
                          />
                          <button
                            onClick={async () => {
                              try {
                                const text = await navigator.clipboard.readText();
                                const newConfig = { ...documentsConfig, googlePlaceId: text.trim() || (openCategories.qr ? "" : undefined) };
                                setDocumentsConfig(newConfig);
                                await handleSaveDocumentsConfig(newConfig);
                              } catch (err) {
                                console.error("Failed to read clipboard:", err);
                              }
                            }}
                            style={{
                              padding: "10px 16px",
                              borderRadius: 10,
                              border: "1px solid var(--border)",
                              background: "var(--panel)",
                              color: "var(--text)",
                              fontSize: 13,
                              fontWeight: 600,
                              cursor: "pointer",
                              whiteSpace: "nowrap",
                            }}
                          >
                            Vložit
                          </button>
                        </div>
                      </div>
                    )}
                    
                    <div>
                      <div style={{ fontSize: 12, fontWeight: 600, color: "var(--text)", marginBottom: 6 }}>Text u QR kódu</div>
                      <input
                        type="text"
                        value={documentsConfig.reviewText ?? "Budeme rádi za Vaši recenzi"}
                        onChange={async (e) => {
                          const newConfig = { ...documentsConfig, reviewText: e.target.value || "Budeme rádi za Vaši recenzi" };
                          setDocumentsConfig(newConfig);
                          await handleSaveDocumentsConfig(newConfig);
                        }}
                        placeholder="Budeme rádi za Vaši recenzi"
                        style={{
                          width: "100%",
                          padding: "10px 12px",
                          borderRadius: 10,
                          border: "1px solid var(--border)",
                          background: "var(--panel)",
                          color: "var(--text)",
                          fontSize: 13,
                          fontFamily: "system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif",
                          outline: "none",
                        }}
                      />
                    </div>
                    
                    <div>
                      <div style={{ fontSize: 12, fontWeight: 600, color: "var(--text)", marginBottom: 8 }}>
                        Velikost QR kódu: {documentsConfig.qrCodeSize ?? 120}px
                      </div>
                      <input
                        type="range"
                        min="80"
                        max="200"
                        step="10"
                        value={documentsConfig.qrCodeSize ?? 120}
                        onChange={async (e) => {
                          const newConfig = { ...documentsConfig, qrCodeSize: parseInt(e.target.value) };
                          setDocumentsConfig(newConfig);
                          await handleSaveDocumentsConfig(newConfig);
                        }}
                        style={{
                          width: "100%",
                          height: 6,
                          borderRadius: 3,
                          background: "var(--border)",
                          outline: "none",
                          cursor: "pointer",
                        }}
                      />
                    </div>
                  </div>
                </CustomizationCategory>
              )}
          </Card>

            {/* PRAVÝ SLOUPEC - Vizuální úprava a náhled */}
            <Card>
              <div style={{ fontWeight: 950, fontSize: 14, marginBottom: 16, color: "var(--text)" }}>Vizuální úprava</div>
              
              {/* Výběr designu */}
              <div style={{ marginBottom: 20 }}>
                <div style={{ fontSize: 13, fontWeight: 700, color: "var(--text)", marginBottom: 8 }}>Design dokumentu</div>
                <DesignPicker
                  value={
                    selectedDocumentType === "ticketList" ? documentsConfig.ticketList.design :
                    selectedDocumentType === "diagnosticProtocol" ? documentsConfig.diagnosticProtocol.design :
                    documentsConfig.warrantyCertificate.design
                  }
                  onChange={(design) => {
                    const newConfig = { ...documentsConfig };
                    if (selectedDocumentType === "ticketList") {
                      newConfig.ticketList = { ...newConfig.ticketList, design };
                    } else if (selectedDocumentType === "diagnosticProtocol") {
                      newConfig.diagnosticProtocol = { ...newConfig.diagnosticProtocol, design };
                    } else {
                      newConfig.warrantyCertificate = { ...newConfig.warrantyCertificate, design };
                    }
                    setDocumentsConfig(newConfig);
                    saveDocumentsConfigWithDB(activeServiceId, newConfig);
                  }}
                />
              </div>

              {/* Barevný režim */}
              <div style={{ marginBottom: 20 }}>
                <div style={{ fontSize: 13, fontWeight: 700, color: "var(--text)", marginBottom: 8 }}>Barevný režim</div>
                <div style={{ display: "flex", gap: 12 }}>
                  <button
                    onClick={() => {
                      const newConfig = { ...documentsConfig, colorMode: "color" as const };
                      setDocumentsConfig(newConfig);
                      saveDocumentsConfigWithDB(activeServiceId, newConfig);
                    }}
                    style={{
                      flex: 1,
                      padding: "12px 16px",
                      borderRadius: 10,
                      border: `2px solid ${documentsConfig.colorMode === "color" ? "var(--accent)" : "var(--border)"}`,
                      background: documentsConfig.colorMode === "color" ? "var(--accent-soft)" : "var(--panel)",
                      color: documentsConfig.colorMode === "color" ? "var(--accent)" : "var(--text)",
                      fontSize: 14,
                      fontWeight: documentsConfig.colorMode === "color" ? 700 : 500,
                      cursor: "pointer",
                      transition: "var(--transition-smooth)",
                    }}
                  >
                    Barevné
                  </button>
                  <button
                    onClick={() => {
                      const newConfig = { ...documentsConfig, colorMode: "bw" as const };
                      setDocumentsConfig(newConfig);
                      saveDocumentsConfigWithDB(activeServiceId, newConfig);
                    }}
                    style={{
                      flex: 1,
                      padding: "12px 16px",
                      borderRadius: 10,
                      border: `2px solid ${documentsConfig.colorMode === "bw" ? "var(--accent)" : "var(--border)"}`,
                      background: documentsConfig.colorMode === "bw" ? "var(--accent-soft)" : "var(--panel)",
                      color: documentsConfig.colorMode === "bw" ? "var(--accent)" : "var(--text)",
                      fontSize: 14,
                      fontWeight: documentsConfig.colorMode === "bw" ? 700 : 500,
                      cursor: "pointer",
                      transition: "var(--transition-smooth)",
                    }}
                  >
                    Černobílé
                  </button>
                </div>
              </div>

              <div style={{ fontSize: 13, fontWeight: 700, color: "var(--text)", marginBottom: 8, marginTop: 24 }}>Náhled dokumentu</div>
              <ReactDocumentPreview
                documentType={selectedDocumentType}
                config={documentsConfig}
              />
            </Card>
          </div>
        </>
      )}

      {/* ZAKÁZKY - FILTRY */}
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
        <DeletedTicketsManagement activeServiceId={activeServiceId} setActiveServiceId={setActiveServiceId} services={services} />
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

// Team Management Component
function TeamManagement({ activeServiceId, setActiveServiceId, services }: { activeServiceId: string | null; setActiveServiceId: (serviceId: string | null) => void; services: Array<{ service_id: string; service_name: string; role: string }> }) {
  const { session } = useAuth();
  const [members, setMembers] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  
  // Invite states
  const [inviteMode, setInviteMode] = useState<"current" | "stock">("current");
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState<"admin" | "member" | "owner">("member");
  const [serviceName, setServiceName] = useState("");
  
  // Invite role picker states
  const [inviteRolePickerOpen, setInviteRolePickerOpen] = useState(false);
  const [inviteRolePickerPosition, setInviteRolePickerPosition] = useState<{ top: number; left: number; width: number } | null>(null);
  const inviteRoleButtonRef = useRef<HTMLButtonElement | null>(null);
  const inviteRolePickerRef = useRef<HTMLDivElement | null>(null);
  
  // Pending invites states
  const [pendingInvites, setPendingInvites] = useState<any[]>([]);
  const [pendingInvitesLoading, setPendingInvitesLoading] = useState(false);
  const [lastInviteLink, setLastInviteLink] = useState<string | null>(null);
  const [lastInviteEmail, setLastInviteEmail] = useState<string | null>(null);
  const [lastInviteServiceId, setLastInviteServiceId] = useState<string | null>(null);
  
  // Dialog states
  const [removeDialogOpen, setRemoveDialogOpen] = useState(false);
  const [removeUserId, setRemoveUserId] = useState<string | null>(null);
  const [removeServiceId, setRemoveServiceId] = useState<string | null>(null);
  
  // Role change dialog states
  const [roleChangeDialogOpen, setRoleChangeDialogOpen] = useState(false);
  const [roleChangeUserId, setRoleChangeUserId] = useState<string | null>(null);
  const [roleChangeNewRole, setRoleChangeNewRole] = useState<"admin" | "member" | null>(null);
  const [roleChangeServiceId, setRoleChangeServiceId] = useState<string | null>(null);
  
  // Capabilities states
  const [_capabilitiesExpandedByMember, _setCapabilitiesExpandedByMember] = useState<Record<string, boolean>>({});
  const [localCapabilitiesByMember, _setLocalCapabilitiesByMember] = useState<Record<string, Record<string, boolean>>>({});
  const [capabilitiesSaveDialogOpen, setCapabilitiesSaveDialogOpen] = useState(false);
  const [capabilitiesSaveUserId, setCapabilitiesSaveUserId] = useState<string | null>(null);
  const [capabilitiesSaveServiceId, setCapabilitiesSaveServiceId] = useState<string | null>(null);

  // Load members when activeServiceId changes
  useEffect(() => {
    if (!activeServiceId || !session || !supabase) {
      setMembers([]);
      setError(null);
      return;
    }

    const loadMembers = async () => {
    setLoading(true);
    setError(null);

      try {
        if (!supabase) {
          console.error("[TeamManagement] Supabase client is null");
          setError("Chyba konfigurace: Supabase client není dostupný");
          setMembers([]);
          setLoading(false);
          return;
        }

        // Standardní volání Edge Function - Supabase JS automaticky přidá session JWT
        const { data, error: fetchError } = await supabase.functions.invoke("team-list", {
          body: { serviceId: activeServiceId },
        });

        if (fetchError) {
          const res = (fetchError as any)?.context as Response | undefined;
          let detail = "";
          let status = "";
          if (res) {
            status = `HTTP ${res.status}`;
            try {
              detail = await res.clone().text();
            } catch {}
          }

          console.error("[TeamManagement] team-list error", { fetchError, status, detail });

          if (res?.status === 403) {
            setError("Nemáte oprávnění k zobrazení seznamu členů. Pro přístup k této sekci potřebujete roli admin nebo owner.");
          } else {
            setError(`Chyba při načítání členů: ${fetchError.message}${status ? " | " + status : ""}${detail ? " | " + detail : ""}`);
          }
          setMembers([]);
          setLoading(false);
          return;
        }

        if (data?.error) {
          console.error("[TeamManagement] team-list error in response", data.error);
          setError(`Chyba při načítání členů: ${data.error}`);
          setMembers([]);
          setLoading(false);
          return;
        }

        if (data?.members) {
          const membersData = (data.members as any[]) || [];
          setMembers(membersData);
          setError(null);
        } else {
          setMembers([]);
        }
        setLoading(false);
      } catch (err) {
        const errorMessage = err instanceof Error ? err.message : "Neznámá chyba";
        setError(`Chyba při načítání členů: ${errorMessage}`);
        setMembers([]);
        setLoading(false);
      }
    };

    loadMembers();
  }, [activeServiceId, session, supabase]);

  const reloadMembers = useCallback(() => {
    // Trigger reload by calling loadMembers again
    if (!activeServiceId || !supabase || !session) return;
    
    const loadMembers = async () => {
      if (!supabase) {
        setLoading(false);
        return;
      }

      try {
        setLoading(true);
        const { data, error: fetchError } = await supabase.functions.invoke("team-list", {
          body: { serviceId: activeServiceId },
        });

        if (fetchError) {
          setMembers([]);
          setLoading(false);
          return;
        }

        if (data?.members) {
          const membersData = (data.members as any[]) || [];
          setMembers(membersData);
        } else {
          setMembers([]);
        }
        setLoading(false);
      } catch {
        setMembers([]);
        setLoading(false);
      }
    };
    
    loadMembers();
  }, [activeServiceId, session, supabase]);

  // Load pending invites when activeServiceId changes
  const reloadPendingInvites = useCallback(async () => {
    if (!activeServiceId || !supabase) {
      setPendingInvites([]);
      return;
    }

    setPendingInvitesLoading(true);
      try {
        const { data, error } = await supabase
        .from("service_invites")
        .select("id, email, role, token, created_at, expires_at, service_id")
          .eq("service_id", activeServiceId)
          .is("accepted_at", null)
          .order("created_at", { ascending: false });

        if (error) {
        console.error("[TeamManagement] Error loading pending invites:", error);
          setPendingInvites([]);
        } else {
        setPendingInvites(data || []);
        }
      } catch (err) {
        console.error("[TeamManagement] Exception loading pending invites:", err);
        setPendingInvites([]);
      } finally {
        setPendingInvitesLoading(false);
      }
  }, [activeServiceId, supabase]);

  useEffect(() => {
    reloadPendingInvites();
  }, [reloadPendingInvites]);

  // Calculate invite role picker position when opened
  useLayoutEffect(() => {
    if (inviteRolePickerOpen && inviteRoleButtonRef.current) {
      const rect = inviteRoleButtonRef.current.getBoundingClientRect();
      setInviteRolePickerPosition({
        top: rect.bottom + 8,
        left: rect.left,
        width: rect.width,
      });
    } else {
      setInviteRolePickerPosition(null);
    }
  }, [inviteRolePickerOpen]);

  // Close invite role picker on outside click or ESC
  useEffect(() => {
    if (!inviteRolePickerOpen) return;

    const handleClickOutside = (e: MouseEvent) => {
      if (
        inviteRolePickerRef.current &&
        !inviteRolePickerRef.current.contains(e.target as Node) &&
        inviteRoleButtonRef.current &&
        !inviteRoleButtonRef.current.contains(e.target as Node)
      ) {
        setInviteRolePickerOpen(false);
      }
    };

    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setInviteRolePickerOpen(false);
      }
    };

    window.addEventListener("mousedown", handleClickOutside);
    window.addEventListener("keydown", handleEscape);

    return () => {
      window.removeEventListener("mousedown", handleClickOutside);
      window.removeEventListener("keydown", handleEscape);
    };
  }, [inviteRolePickerOpen]);

  const handleCreateInvite = async () => {
    if (!supabase || !session || !activeServiceId) return;

      try {
        // Access token is not needed - Supabase JS client handles auth automatically
      const requestBody: any = {
        mode: inviteMode,
        role: inviteRole,
      };

      if (inviteMode === "current") {
        requestBody.serviceId = activeServiceId;
        requestBody.email = inviteEmail.trim();
      } else {
        if (serviceName.trim()) {
          requestBody.serviceName = serviceName.trim();
        }
        if (inviteEmail.trim()) {
          requestBody.email = inviteEmail.trim();
        }
      }

      // Standardní volání - Supabase JS automaticky přidá session JWT
      const { data, error } = await supabase.functions.invoke("invite-create", {
        body: requestBody,
        // žádné headers - Supabase JS automaticky přidá session JWT
      });

      if (error) {
        const res = (error as any)?.context as Response | undefined;
        let detail = "";
        if (res) {
          try {
            detail = await res.clone().text();
          } catch {}
        }
        showToast(`Chyba při vytváření pozvánky: ${error.message}${detail ? " | " + detail : ""}`, "error");
        return;
      }

      if (data?.inviteLink) {
        setLastInviteLink(data.inviteLink);
        setLastInviteEmail(inviteEmail.trim() || "");
        const newServiceId = data.service_id || activeServiceId;
        setLastInviteServiceId(newServiceId);
        setInviteEmail("");
        setServiceName("");
        showToast("Pozvánka byla vytvořena", "success");
        
        // If invite was created for a different service (stock mode), switch to it
        if (newServiceId && newServiceId !== activeServiceId) {
          setActiveServiceId(newServiceId);
          // Reload invites after switching (use setTimeout to ensure state has updated)
          setTimeout(() => {
        reloadPendingInvites();
          }, 200);
        } else {
          reloadPendingInvites();
        }
      } else if (data?.created_service) {
        showToast("Nový servis vytvořen", "success");
        setServiceName("");
        
        // If new service was created, switch to it
        if (data?.service_id) {
          setActiveServiceId(data.service_id);
          
          // Reload members for the new service
          if (supabase) {
          const loadMembers = async () => {
            if (!supabase) return;
              const { data: membersData } = await supabase.functions.invoke("team-list", {
                body: { serviceId: data.service_id },
            });
              if (membersData?.members) {
                setMembers(membersData.members);
            }
          };
          loadMembers();
          }
          
          // Reload pending invites for the new service after switching
          // Use setTimeout to ensure activeServiceId state has updated
          setTimeout(() => {
            reloadPendingInvites();
          }, 200);
        }
      } else {
        showToast("Pozvánka byla vytvořena", "success");
        setInviteEmail("");
        setServiceName("");
        reloadPendingInvites();
      }
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : "Neznámá chyba";
      showToast(`Chyba při vytváření pozvánky: ${errorMessage}`, "error");
    }
  };

  const updateRole = async () => {
    if (!roleChangeUserId || !roleChangeNewRole || !roleChangeServiceId || !supabase) return;

    try {
      const { error } = await (supabase as any).rpc("set_member_role", {
        p_service_id: roleChangeServiceId,
        p_user_id: roleChangeUserId,
        p_role: roleChangeNewRole,
      });

      if (error) {
        throw error;
      }

      showToast("Role byla změněna", "success");
      setRoleChangeDialogOpen(false);
      setRoleChangeUserId(null);
      setRoleChangeNewRole(null);
      setRoleChangeServiceId(null);

      // Reload members
      if (activeServiceId && supabase) {
        const loadMembers = async () => {
          if (!supabase) return;
          const { data } = await supabase.functions.invoke("team-list", {
            body: { serviceId: activeServiceId },
          });
          if (data?.members) {
            setMembers(data.members);
          }
        };
        loadMembers();
      }
    } catch (err: any) {
      const errorMessage = err?.message || "Neznámá chyba";
      if (errorMessage.includes("Not authorized") || errorMessage.includes("permission") || errorMessage.includes("Only owner")) {
        showToast("Nemáš oprávnění měnit role", "error");
      } else {
      showToast(`Chyba při změně role: ${errorMessage}`, "error");
      }
    }
  };

  const updateCapabilities = async (targetUserId: string, capabilities: Record<string, boolean>, serviceId: string) => {
    if (!supabase || !activeServiceId) {
      throw new Error("Chyba: není připojení k databázi");
    }

    const { error } = await (supabase as any).rpc("set_member_capabilities", {
      p_service_id: serviceId || activeServiceId,
      p_user_id: targetUserId,
      p_capabilities: capabilities,
    });

    if (error) {
      throw error;
    }

    showToast("Oprávnění aktualizována", "success");
    reloadMembers();
  };

  const saveCapabilities = async () => {
    if (!capabilitiesSaveUserId || !capabilitiesSaveServiceId || !supabase || !activeServiceId) {
      throw new Error("Chyba: chybí potřebné údaje");
    }

    const capabilitiesToSave = localCapabilitiesByMember[capabilitiesSaveUserId] || {};
    
    await updateCapabilities(capabilitiesSaveUserId, capabilitiesToSave, capabilitiesSaveServiceId);
    
    setCapabilitiesSaveDialogOpen(false);
    setCapabilitiesSaveUserId(null);
    setCapabilitiesSaveServiceId(null);
  };

  const handleRemoveMember = async () => {
    if (!supabase || !session || !removeUserId || !removeServiceId) return;

    try {
      // Standardní volání - Supabase JS automaticky přidá session JWT
      const { error } = await supabase.functions.invoke("team-remove-member", {
        body: { serviceId: removeServiceId, userId: removeUserId },
        // žádné headers - Supabase JS automaticky přidá session JWT
      });

      if (error) {
        const res = (error as any)?.context as Response | undefined;
        let detail = "";
        if (res) {
          try {
            detail = await res.clone().text();
          } catch {}
        }
        showToast(`Chyba při odstraňování člena: ${error.message}${detail ? " | " + detail : ""}`, "error");
        return;
      }

      showToast("Člen byl odstraněn", "success");
      setRemoveDialogOpen(false);
      setRemoveUserId(null);
      setRemoveServiceId(null);
      
      // Reload members
      if (activeServiceId && supabase) {
        const loadMembers = async () => {
          if (!supabase) return;
          const { data } = await supabase.functions.invoke("team-list", {
            body: { serviceId: activeServiceId },
          });
          if (data?.members) {
            setMembers(data.members);
          }
        };
        loadMembers();
      }
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : "Neznámá chyba";
      showToast(`Chyba při odstraňování člena: ${errorMessage}`, "error");
    }
  };

  const border = "1px solid var(--border)";

  return (
    <>
        <Card>
        <div style={{ fontWeight: 950, fontSize: 14, marginBottom: 12, color: "var(--text)" }}>Tým / Přístupy</div>
        
        {services.length === 0 ? (
          <div style={{ color: "var(--muted)", fontSize: 13 }}>Žádné servisy</div>
        ) : (
          <>
            <div style={{ marginBottom: 16 }}>
              <div style={{ fontSize: 13, color: "var(--muted)", marginBottom: 8 }}>Vyberte servis:</div>
              <ServicePicker
                value={activeServiceId}
                onChange={setActiveServiceId}
                services={services}
              />
          </div>

            {loading ? (
              <div style={{ color: "var(--muted)", fontSize: 13 }}>Načítání členů...</div>
            ) : error ? (
              <div style={{ color: "rgba(239,68,68,0.9)", fontSize: 13 }}>{error}</div>
            ) : (
              <>
                <div style={{ marginBottom: 16 }}>
                  <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 8, color: "var(--text)" }}>Členové týmu</div>
                  <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                    {members.map((m) => {
                      // Get current user ID from session
                      const currentUserId = session?.user?.id;
                      // Find current user's membership to check their role
                      const currentUserMember = members.find((mem) => mem.user_id === currentUserId);
                      const currentUserRole = currentUserMember?.role;
                      const canEditRole = (currentUserRole === "owner" || currentUserRole === "admin") && m.role !== "owner";
                      const isOwner = m.role === "owner";

                return (
                  <div
                          key={m.user_id}
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
                          <div>
                      <div style={{ fontWeight: 700, fontSize: 13, color: "var(--text)" }}>
                              {m.email || m.user_id}
                      </div>
                            <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 4, display: "flex", alignItems: "center", gap: 6 }}>
                              Role:{" "}
                              {isOwner ? (
                                <span>{m.role}</span>
                              ) : (
                                <RolePicker
                                  value={m.role}
                                  onChange={(newRole) => {
                                    setRoleChangeUserId(m.user_id);
                                    setRoleChangeNewRole(newRole as "admin" | "member");
                                    setRoleChangeServiceId(activeServiceId);
                                    setRoleChangeDialogOpen(true);
                                  }}
                                  disabled={!canEditRole}
                                  options={[
                                    { value: "member", label: "member" },
                                    { value: "admin", label: "admin" },
                                  ]}
                                />
                              )}
                            </div>
                          </div>
                                <button
                                  onClick={() => {
                              setRemoveUserId(m.user_id);
                              setRemoveServiceId(activeServiceId);
                              setRemoveDialogOpen(true);
                            }}
                          style={{
                            padding: "6px 12px",
                            borderRadius: 8,
                              border: "1px solid rgba(239,68,68,0.5)",
                              background: "transparent",
                            color: "rgba(239,68,68,0.9)",
                            fontSize: 12,
                              fontWeight: 700,
                              cursor: "pointer",
                          }}
                        >
                          Odebrat
                        </button>
                  </div>
                );
              })}
          </div>
                </div>

                <div style={{ marginTop: 24, paddingTop: 24, borderTop: border }}>
                  <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 12, color: "var(--text)" }}>Pozvat nového člena</div>
                  <div style={{ display: "grid", gap: 12 }}>
                    <div>
                      <div style={{ fontSize: 12, color: "var(--muted)", marginBottom: 6 }}>Režim</div>
              <div style={{ display: "flex", gap: 8 }}>
                <button
                  onClick={() => setInviteMode("current")}
                  style={{
                    padding: "8px 16px",
                    borderRadius: 8,
                            border,
                    background: inviteMode === "current" ? "var(--accent-soft)" : "var(--panel)",
                    color: inviteMode === "current" ? "var(--accent)" : "var(--text)",
                    fontSize: 12,
                            fontWeight: 700,
                    cursor: "pointer",
                  }}
                >
                          Současný servis
                </button>
                <button
                  onClick={() => setInviteMode("stock")}
                  style={{
                    padding: "8px 16px",
                    borderRadius: 8,
                            border,
                    background: inviteMode === "stock" ? "var(--accent-soft)" : "var(--panel)",
                    color: inviteMode === "stock" ? "var(--accent)" : "var(--text)",
                    fontSize: 12,
                            fontWeight: 700,
                    cursor: "pointer",
                  }}
                >
                  Nový servis
                </button>
              </div>
            </div>

                    {inviteMode === "stock" && (
                      <div>
                        <div style={{ fontSize: 12, color: "var(--muted)", marginBottom: 6 }}>Název servisu</div>
              <input
                type="text"
                value={serviceName}
                onChange={(e) => setServiceName(e.target.value)}
                          placeholder="např. iSwap Repair Point"
                style={{
                  width: "100%",
                  padding: "10px 12px",
                            borderRadius: 12,
                            border,
                            background: "var(--panel)",
                  color: "var(--text)",
                  fontSize: 13,
                }}
              />
            </div>
          )}

                    <div>
                      <div style={{ fontSize: 12, color: "var(--muted)", marginBottom: 6 }}>E-mail</div>
                <input
                  type="email"
                  value={inviteEmail}
                  onChange={(e) => setInviteEmail(e.target.value)}
                  placeholder="email@example.com"
                  style={{
                    width: "100%",
                    padding: "10px 12px",
                          borderRadius: 12,
                          border,
                          background: "var(--panel)",
                    color: "var(--text)",
                    fontSize: 13,
                  }}
                />
              </div>

                    <div>
                      <div style={{ fontSize: 12, color: "var(--muted)", marginBottom: 6 }}>Role</div>
                <div style={{ position: "relative", zIndex: 1 }}>
                  <button
                    ref={inviteRoleButtonRef}
                    type="button"
                    onClick={() => setInviteRolePickerOpen(!inviteRolePickerOpen)}
                    style={{
                      width: "100%",
                      padding: "10px 12px",
                            borderRadius: 12,
                            border,
                      background: "var(--panel)",
                      color: "var(--text)",
                      fontSize: 13,
                      fontWeight: 600,
                      cursor: "pointer",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "space-between",
                    }}
                  >
                    <span>{inviteRole}</span>
                    <span style={{ fontSize: 10, color: "var(--muted)" }}>▼</span>
                  </button>

                  {inviteRolePickerOpen && inviteRolePickerPosition &&
                    createPortal(
                      <div
                        ref={inviteRolePickerRef}
                        style={{
                          position: "absolute",
                          top: inviteRolePickerPosition.top,
                          left: inviteRolePickerPosition.left,
                          width: inviteRolePickerPosition.width,
                          background: "var(--panel)",
                          border: "1px solid var(--border)",
                          borderRadius: 8,
                          boxShadow: "var(--shadow-soft)",
                          zIndex: 10000,
                          overflow: "hidden",
                        }}
                      >
                      {(["member", "admin", "owner"] as const).map((role) => (
                        <button
                          key={role}
                          type="button"
                          onClick={() => {
                            setInviteRole(role);
                            setInviteRolePickerOpen(false);
                          }}
                          style={{
                            width: "100%",
                            padding: "10px 14px",
                            border: "none",
                            background: inviteRole === role ? "var(--accent-soft)" : "transparent",
                            color: inviteRole === role ? "var(--accent)" : "var(--text)",
                            fontSize: 13,
                            fontWeight: inviteRole === role ? 700 : 600,
                            cursor: "pointer",
                            textAlign: "left",
                            transition: "var(--transition-smooth)",
                          }}
                          onMouseEnter={(e) => {
                            if (inviteRole !== role) {
                              e.currentTarget.style.background = "var(--panel-2)";
                            }
                          }}
                          onMouseLeave={(e) => {
                            if (inviteRole !== role) {
                              e.currentTarget.style.background = "transparent";
                            }
                          }}
                        >
                          {role}
                        </button>
                      ))}
                      </div>,
                      document.body
                    )}
                </div>
              </div>

          <button
                      onClick={handleCreateInvite}
                      disabled={!inviteEmail.trim() || (inviteMode === "stock" && !serviceName.trim())}
            style={{
                        padding: "12px 24px",
                        borderRadius: 12,
              border: "none",
                        background: "var(--accent)",
              color: "white",
                        fontWeight: 900,
              fontSize: 13,
              cursor: "pointer",
                        opacity: !inviteEmail.trim() || (inviteMode === "stock" && !serviceName.trim()) ? 0.5 : 1,
                      }}
                    >
                      Vytvořit pozvánku
          </button>
                </div>
              </div>

              {/* Last Invite Link Display */}
          {lastInviteLink && (
            <div style={{ marginTop: 16, padding: 12, borderRadius: 8, background: "var(--panel-2)", border: "1px solid var(--border)" }}>
              <div style={{ fontSize: 12, fontWeight: 700, color: "var(--text)", marginBottom: 8 }}>
                Invite link pro {lastInviteEmail || "uživatele"}:
              </div>
              <div style={{ fontSize: 11, color: "var(--muted)", marginBottom: 8, wordBreak: "break-all" }}>
                {lastInviteLink}
              </div>
              {lastInviteServiceId && (
                <div style={{ fontSize: 11, color: "var(--muted)", marginBottom: 8 }}>
                  Service ID: {lastInviteServiceId}
                </div>
              )}
              <button
                type="button"
                onClick={async () => {
                  try {
                    await navigator.clipboard.writeText(lastInviteLink);
                    showToast("Zkopírováno", "success");
                  } catch {
                    showToast("Chyba při kopírování", "error");
                  }
                }}
                style={{
                  width: "100%",
                  padding: "8px 12px",
                  borderRadius: 6,
                  border: "1px solid var(--border)",
                  background: "var(--panel)",
                  color: "var(--text)",
                  fontSize: 12,
                  fontWeight: 600,
                  cursor: "pointer",
                }}
              >
                Kopírovat
              </button>
            </div>
          )}

          {/* Pending Invites List */}
          {pendingInvitesLoading ? (
            <div style={{ marginTop: 24, fontSize: 13, color: "var(--muted)", padding: 12 }}>
              Načítání pozvánek...
            </div>
          ) : pendingInvites.length > 0 ? (
            <div style={{ marginTop: 24 }}>
              <div style={{ fontSize: 12, fontWeight: 700, color: "var(--text)", marginBottom: 12 }}>
                Nepřijaté pozvánky ({pendingInvites.length})
              </div>
              <div style={{ display: "grid", gap: 8 }}>
                {pendingInvites.map((invite) => {
                  const inviteLink = `jobsheet://invite?token=${invite.token}`;
                  const isExpired = new Date(invite.expires_at) < new Date();
                  
                  return (
                    <div
                      key={invite.id}
                      style={{
                        padding: 12,
                        borderRadius: 8,
                        border: "1px solid var(--border)",
                        background: isExpired ? "rgba(239,68,68,0.05)" : "var(--panel-2)",
                        display: "flex",
                        flexDirection: "column",
                        gap: 8,
                      }}
                    >
                      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontSize: 13, fontWeight: 700, color: "var(--text)" }}>
                            {invite.email}
                          </div>
                          <div style={{ fontSize: 11, color: "var(--muted)", marginTop: 2 }}>
                            {invite.role} • {new Date(invite.created_at).toLocaleDateString("cs-CZ")}
                            {isExpired && <span style={{ color: "rgba(239,68,68,0.9)", marginLeft: 8 }}>• Vypršela</span>}
                          </div>
                        </div>
                      </div>
                      <div style={{ fontSize: 10, color: "var(--muted)", fontFamily: "monospace", wordBreak: "break-all", marginBottom: 8 }}>
                        Token: {invite.token}
                      </div>
                      <div style={{ fontSize: 10, color: "var(--muted)", wordBreak: "break-all", marginBottom: 8 }}>
                        Link: {inviteLink}
                      </div>
                      <div style={{ display: "flex", gap: 8 }}>
                        <button
                          type="button"
                          onClick={async () => {
                            try {
                              await navigator.clipboard.writeText(invite.token);
                              showToast("Token zkopírován", "success");
                            } catch {
                              showToast("Chyba při kopírování", "error");
                            }
                          }}
                          style={{
                            flex: 1,
                            padding: "6px 10px",
                            borderRadius: 6,
                            border: "1px solid var(--border)",
                            background: "var(--panel)",
                            color: "var(--text)",
                            fontSize: 11,
                            fontWeight: 600,
                            cursor: "pointer",
                          }}
                        >
                          Zkopírovat token
                        </button>
                        <button
                          type="button"
                          onClick={async () => {
                            try {
                              await navigator.clipboard.writeText(inviteLink);
                              showToast("Link zkopírován", "success");
                            } catch {
                              showToast("Chyba při kopírování", "error");
                            }
                          }}
                          style={{
                            flex: 1,
                            padding: "6px 10px",
                            borderRadius: 6,
                            border: "1px solid var(--border)",
                            background: "var(--panel)",
                            color: "var(--text)",
                            fontSize: 11,
                            fontWeight: 600,
                            cursor: "pointer",
                          }}
                        >
                          Zkopírovat link
                        </button>
                        <button
                          type="button"
                          onClick={async (e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            
                            if (!supabase || !activeServiceId) {
                              showToast("Chybí připojení k databázi", "error");
                              return;
                            }

                            try {
                                  // Standardní volání - Supabase JS automaticky přidá session JWT
                              const { data, error } = await supabase.functions.invoke("invite-delete", {
                                body: {
                                  inviteId: invite.id,
                                  serviceId: activeServiceId,
                                },
                                    // žádné headers - Supabase JS automaticky přidá session JWT
                              });

                              if (error) {
                                const res = (error as any)?.context as Response | undefined;
                                let detail = "";
                                if (res) {
                                  try {
                                    detail = await res.clone().text();
                                  } catch {}
                                }
                                showToast(`Chyba při mazání pozvánky: ${error.message || "Neznámá chyba"}${detail ? " | " + detail : ""}`, "error");
                                return;
                              }

                              if (data?.error) {
                                showToast(`Chyba při mazání pozvánky: ${data.error}`, "error");
                                return;
                              }

                              showToast("Pozvánka smazána", "success");
                              reloadPendingInvites();
                            } catch (err) {
                              console.error("[TeamManagement] Exception deleting invite:", err);
                              showToast(`Chyba při mazání pozvánky: ${err instanceof Error ? err.message : "Neznámá chyba"}`, "error");
                            }
                          }}
                          style={{
                            padding: "6px 10px",
                            borderRadius: 6,
                            border: "1px solid rgba(239,68,68,0.3)",
                            background: "rgba(239,68,68,0.1)",
                            color: "rgba(239,68,68,0.9)",
                            fontSize: 11,
                            fontWeight: 600,
                            cursor: "pointer",
                            whiteSpace: "nowrap",
                          }}
                        >
                          Smazat
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          ) : null}
            </>
          )}
          </>
        )}
        </Card>

      <ConfirmDialog
        open={removeDialogOpen}
        title="Odebrat člena"
        message="Opravdu chceš odebrat tohoto člena z týmu?"
        confirmLabel="Odebrat"
        cancelLabel="Zrušit"
        variant="danger"
        onConfirm={handleRemoveMember}
        onCancel={() => {
          setRemoveDialogOpen(false);
          setRemoveUserId(null);
          setRemoveServiceId(null);
        }}
      />

      {/* Role change confirmation dialog */}
      <ConfirmDialog
        open={roleChangeDialogOpen}
        title="Změnit roli?"
        message={`Opravdu chceš změnit roli na ${roleChangeNewRole === "admin" ? "admin" : "člen"}?`}
        confirmLabel="Změnit"
        cancelLabel="Zrušit"
        variant="default"
        onConfirm={updateRole}
        onCancel={() => {
          setRoleChangeDialogOpen(false);
          setRoleChangeUserId(null);
          setRoleChangeNewRole(null);
          setRoleChangeServiceId(null);
        }}
      />

      {/* Capabilities save confirmation dialog */}
      <ConfirmDialog
        open={capabilitiesSaveDialogOpen}
        title="Uložit oprávnění?"
        message="Opravdu chceš uložit změny v oprávněních?"
        confirmLabel="Uložit"
        cancelLabel="Zrušit"
        variant="default"
        onConfirm={saveCapabilities}
        onCancel={() => {
          setCapabilitiesSaveDialogOpen(false);
          setCapabilitiesSaveUserId(null);
          setCapabilitiesSaveServiceId(null);
        }}
      />
    </>
  );
}

// Deleted Tickets Management Component
function DeletedTicketsManagement({ activeServiceId, setActiveServiceId: _setActiveServiceId, services: _services }: { activeServiceId: string | null; setActiveServiceId: (serviceId: string | null) => void; services: Array<{ service_id: string; service_name: string; role: string }> }) {
  const { session } = useAuth();
  const [deletedTickets, setDeletedTickets] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  
  // Restore dialog states
  const [restoreDialogOpen, setRestoreDialogOpen] = useState(false);
  const [restoreTicketId, setRestoreTicketId] = useState<string | null>(null);

  // Load deleted tickets when activeServiceId changes
  useEffect(() => {
    if (!activeServiceId || !session || !supabase) {
      setDeletedTickets([]);
      setError(null);
      return;
    }

    const loadDeletedTickets = async () => {
      setLoading(true);
      setError(null);

      try {
        if (!supabase) {
          setError("Chyba konfigurace: Supabase client není dostupný");
          setDeletedTickets([]);
          setLoading(false);
                                return;
                              }

        const { data, error: fetchError } = await supabase
          .from("tickets")
          .select("id, title, status, customer_name, customer_phone, created_at, deleted_at")
          .eq("service_id", activeServiceId)
          .not("deleted_at", "is", null)
          .order("deleted_at", { ascending: false });

        if (fetchError) {
          setError(`Chyba při načítání smazaných zakázek: ${fetchError.message}`);
          setDeletedTickets([]);
          setLoading(false);
                                return;
                              }

        if (data) {
          setDeletedTickets(data || []);
          setError(null);
        } else {
          setDeletedTickets([]);
        }
        setLoading(false);
                            } catch (err) {
        const errorMessage = err instanceof Error ? err.message : "Neznámá chyba";
        setError(`Chyba při načítání smazaných zakázek: ${errorMessage}`);
        setDeletedTickets([]);
        setLoading(false);
      }
    };

    loadDeletedTickets();
  }, [activeServiceId, session, supabase]);

  const handleRestoreTicket = async () => {
    if (!restoreTicketId || !supabase) return;

    try {
      const { error } = await (supabase.rpc as any)("restore_ticket", {
        p_ticket_id: restoreTicketId,
      });

      if (error) {
        throw error;
      }

      // Remove ticket from local list
      setDeletedTickets((prev) => prev.filter((t) => t.id !== restoreTicketId));

      showToast("Zakázka byla obnovena", "success");
      setRestoreDialogOpen(false);
      setRestoreTicketId(null);
    } catch (err: any) {
      const errorMessage = err?.message || "Neznámá chyba";
      if (errorMessage.includes("Not authorized") || errorMessage.includes("permission")) {
        showToast("Nemáš oprávnění obnovit zakázku", "error");
      } else {
        showToast(`Chyba při obnovování zakázky: ${errorMessage}`, "error");
      }
    }
  };

  const border = "1px solid var(--border)";

  return (
    <>
      <Card>
        <div style={{ fontWeight: 950, fontSize: 14, marginBottom: 12, color: "var(--text)" }}>Smazané zakázky</div>
        <div style={{ fontSize: 13, color: "var(--muted)", marginBottom: 16 }}>
          Zobrazují se zakázky, které byly přesunuty do smazaných
        </div>

        {loading ? (
          <div style={{ color: "var(--muted)", fontSize: 13 }}>Načítání...</div>
        ) : error ? (
          <div style={{ color: "rgba(239,68,68,0.9)", fontSize: 13 }}>{error}</div>
        ) : deletedTickets.length === 0 ? (
          <div style={{ color: "var(--muted)", fontSize: 13 }}>Žádné smazané zakázky</div>
        ) : (
          <div style={{ display: "grid", gap: 12 }}>
            {deletedTickets.map((ticket) => (
              <div
                key={ticket.id}
                style={{
                  padding: 16,
                  borderRadius: 12,
                  border,
                  background: "var(--panel)",
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                }}
              >
                <div>
                  <div style={{ fontWeight: 800, fontSize: 14, color: "var(--text)" }}>
                    {ticket.title || "Neznámá zakázka"}
                  </div>
                  {ticket.customer_name && (
                    <div style={{ fontSize: 13, color: "var(--muted)", marginTop: 4 }}>
                      {ticket.customer_name}
                      {ticket.customer_phone && ` · ${ticket.customer_phone}`}
                    </div>
                  )}
                  {ticket.deleted_at && (
                    <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 4 }}>
                      Smazáno: {new Date(ticket.deleted_at).toLocaleString("cs-CZ")}
                    </div>
                  )}
                </div>
                <button
                  onClick={() => {
                    setRestoreTicketId(ticket.id);
                    setRestoreDialogOpen(true);
                          }}
                          style={{
                    padding: "8px 16px",
                    borderRadius: 10,
                    border,
                    background: "var(--accent)",
                    color: "white",
                    fontSize: 13,
                    fontWeight: 700,
                            cursor: "pointer",
                          }}
                        >
                  Obnovit
                        </button>
                      </div>
            ))}
                    </div>
        )}
      </Card>

      {/* Restore ticket confirmation dialog */}
      <ConfirmDialog
        open={restoreDialogOpen}
        title="Obnovit zakázku"
        message="Opravdu chceš tuto zakázku obnovit?"
        confirmLabel="Obnovit"
        cancelLabel="Zrušit"
        variant="default"
        onConfirm={handleRestoreTicket}
        onCancel={() => {
          setRestoreDialogOpen(false);
          setRestoreTicketId(null);
        }}
      />
    </>
  );
}
