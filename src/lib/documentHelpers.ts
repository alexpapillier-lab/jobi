import type { TicketEx } from "../pages/Orders";
import type { WarrantyClaimRow } from "../pages/Orders/hooks/useWarrantyClaims";
import { getProfileFromJobiDocs } from "./jobidocs";
import { supabase } from "./supabaseClient";
import { STORAGE_KEYS } from "../constants/storageKeys";

// ---------------------------------------------------------------------------
// DocumentsConfig contract – shared type across Jobi and JobiDocs
// ---------------------------------------------------------------------------

export type DocumentDesignType = "classic" | "modern" | "minimal" | "professional";
export type ColorMode = "color" | "bw";

export interface DocumentSectionConfig {
  includeServiceInfo?: boolean;
  includeCustomerInfo?: boolean;
  includeDeviceInfo?: boolean;
  includeRepairs?: boolean;
  includeDiagnostic?: boolean;
  includeDiagnosticText?: boolean;
  includePhotos?: boolean;
  includeDates?: boolean;
  design?: DocumentDesignType;
  sectionOrder?: string[];
  sectionWidths?: Record<string, string>;
  sectionSide?: Record<string, "left" | "right">;
  sectionStyles?: Record<string, string>;
  sectionFields?: Record<string, Record<string, boolean>>;
  customBlocks?: Record<string, {
    type?: string;
    content?: string;
    showHeading?: boolean;
    headingText?: string;
    showHeadingLine?: boolean;
  }>;
}

export interface AutoPrintConfig {
  ticketListOnCreate?: boolean;
  ticketListOnStatusKey?: string | null;
  warrantyOnCreate?: boolean;
  warrantyOnStatusKey?: string | null;
  prijetiReklamaceOnCreate?: boolean;
  prijetiReklamaceOnStatusKey?: string | null;
  vydaniReklamaceOnStatusKey?: string | null;
}

export interface WarrantyCertificateExtras {
  includeWarranty?: boolean;
  warrantyType?: "unified" | "custom";
  warrantyUnifiedDuration?: number;
  warrantyUnifiedUnit?: "days" | "months" | "years";
  warrantyCustomText?: string;
}

export interface DocumentsConfig {
  ticketList?: DocumentSectionConfig;
  diagnosticProtocol?: DocumentSectionConfig;
  warrantyCertificate?: DocumentSectionConfig & WarrantyCertificateExtras;
  autoPrint?: AutoPrintConfig;
  colorMode?: ColorMode;
  designAccentColor?: string;
  designPrimaryColor?: string;
  designSecondaryColor?: string;
  designHeaderBg?: string;
  designSectionBorder?: string;
  logoUrl?: string;
  stampUrl?: string;
  letterheadPdfUrl?: string;
  logoSize?: number;
  stampSize?: number;
  deviceInfoConfig?: unknown;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

export function escapeHtmlForDoc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/** Sestaví proměnné pro vlastní texty v šabloně JobiDocs ({{ticket_code}}, {{customer_name}} atd.) při tisku z Jobi. */
export function buildTicketVariablesForJobiDocs(ticket: TicketEx, companyData: Record<string, unknown>): Record<string, string> {
  const addr = [ticket.customerAddressStreet, ticket.customerAddressCity, ticket.customerAddressZip].filter(Boolean).join(", ");
  const totalPrice = ticket.performedRepairs?.length
    ? ticket.performedRepairs.reduce((sum, r) => sum + (r.price || 0), 0)
    : 0;
  const repairDateFormatted = new Date(ticket.createdAt).toLocaleDateString("cs-CZ");
  const completionFormatted = ticket.expectedDoneAt ? new Date(ticket.expectedDoneAt).toLocaleDateString("cs-CZ") : "";
  const serviceName = (companyData?.name != null && String(companyData.name).trim() !== "") ? String(companyData.name) : "";
  const serviceAddr = [companyData?.addressStreet, companyData?.addressCity, companyData?.addressZip].filter(Boolean).map((x) => String(x)).join(", ");
  const repairItems = ticket.performedRepairs?.length
    ? JSON.stringify(
        ticket.performedRepairs.map((r) => ({
          name: r.name ?? "",
          price: r.price != null ? `${r.price} Kč` : "",
          quantity: 1,
          unit: "ks",
          total: r.price != null ? `${r.price} Kč` : "",
        }))
      )
    : "[]";
  return {
    ticket_code: ticket.code ?? "",
    order_code: ticket.code ?? "",
    customer_name: ticket.customerName ?? "",
    customer_phone: ticket.customerPhone ?? "",
    customer_email: ticket.customerEmail ?? "",
    customer_address: addr,
    device_name: ticket.deviceLabel ?? "",
    device_serial: ticket.serialOrImei ?? "",
    device_imei: ticket.serialOrImei ?? "",
    device_state: ticket.deviceCondition ?? "",
    device_problem: (ticket.requestedRepair || ticket.issueShort) ?? "",
    service_name: serviceName,
    service_phone: (companyData?.phone != null && String(companyData.phone).trim() !== "") ? String(companyData.phone) : "",
    service_email: (companyData?.email != null && String(companyData.email).trim() !== "") ? String(companyData.email) : "",
    service_address: serviceAddr,
    service_ico: (companyData?.ico != null && String(companyData.ico).trim() !== "") ? String(companyData.ico) : "",
    service_dic: (companyData?.dic != null && String(companyData.dic).trim() !== "") ? String(companyData.dic) : "",
    repair_date: repairDateFormatted,
    repair_completion_date: completionFormatted,
    total_price: totalPrice > 0 ? `${totalPrice} Kč` : "",
    warranty_until: "",
    diagnostic_text: ticket.diagnosticText ?? "",
    note: (ticket as { notes?: string }).notes ?? "",
    repair_items: repairItems,
    photo_urls: JSON.stringify(ticket.diagnosticPhotos && ticket.diagnosticPhotos.length > 0 ? ticket.diagnosticPhotos : []),
    complaint_code: "",
    reclamation_code: "",
    original_ticket_code: ticket.code ?? "",
  };
}

/** Sestaví proměnné pro dokument příjemky/výdejky reklamace (JobiDocs šablona). */
export function buildClaimVariablesForJobiDocs(claim: WarrantyClaimRow, originalTicketCode: string = ""): Record<string, string> {
  const addr = [claim.customer_address_street, claim.customer_address_city, claim.customer_address_zip].filter(Boolean).join(", ");
  return {
    complaint_code: claim.code ?? "",
    reclamation_code: claim.code ?? "",
    original_ticket_code: originalTicketCode || "",
    ticket_code: originalTicketCode || "",
    customer_name: claim.customer_name ?? "",
    customer_phone: claim.customer_phone ?? "",
    customer_email: claim.customer_email ?? "",
    customer_address: addr,
    device_name: claim.device_label ?? "",
    device_serial: claim.device_serial ?? "",
    device_imei: claim.device_imei ?? "",
    device_state: claim.device_condition ?? "",
    device_problem: claim.notes ?? "",
  };
}

// ---------------------------------------------------------------------------
// Documents config loading
// ---------------------------------------------------------------------------

const DEFAULT_DOCUMENTS_CONFIG = {
  ticketList: {
    includeServiceInfo: true,
    includeCustomerInfo: true,
    includeDeviceInfo: true,
    includeRepairs: true,
    includeDiagnostic: false,
    includePhotos: false,
    includeDates: true,
  },
  diagnosticProtocol: {
    includeServiceInfo: true,
    includeCustomerInfo: true,
    includeDeviceInfo: true,
    includeDiagnosticText: true,
    includePhotos: true,
    includeDates: true,
  },
  warrantyCertificate: {
    includeServiceInfo: true,
    includeCustomerInfo: true,
    includeDeviceInfo: true,
    includeRepairs: true,
    includeDates: true,
  },
};

export async function loadDocumentsConfigFromDB(serviceId: string | null): Promise<any | null> {
  if (!supabase || !serviceId) return null;

  try {
    const { data, error } = await supabase
      .from("service_document_settings")
      .select("config")
      .eq("service_id", serviceId)
      .single();

    if (error || !data) return null;

    const typedData = data as { config: any };
    if (!typedData.config) return null;
    const parsed = typedData.config as any;

    return {
      ticketList: {
        includeServiceInfo: typeof parsed?.ticketList?.includeServiceInfo === "boolean" ? parsed.ticketList.includeServiceInfo : DEFAULT_DOCUMENTS_CONFIG.ticketList.includeServiceInfo,
        includeCustomerInfo: typeof parsed?.ticketList?.includeCustomerInfo === "boolean" ? parsed.ticketList.includeCustomerInfo : DEFAULT_DOCUMENTS_CONFIG.ticketList.includeCustomerInfo,
        includeDeviceInfo: typeof parsed?.ticketList?.includeDeviceInfo === "boolean" ? parsed.ticketList.includeDeviceInfo : DEFAULT_DOCUMENTS_CONFIG.ticketList.includeDeviceInfo,
        includeRepairs: typeof parsed?.ticketList?.includeRepairs === "boolean" ? parsed.ticketList.includeRepairs : DEFAULT_DOCUMENTS_CONFIG.ticketList.includeRepairs,
        includeDiagnostic: typeof parsed?.ticketList?.includeDiagnostic === "boolean" ? parsed.ticketList.includeDiagnostic : DEFAULT_DOCUMENTS_CONFIG.ticketList.includeDiagnostic,
        includePhotos: typeof parsed?.ticketList?.includePhotos === "boolean" ? parsed.ticketList.includePhotos : DEFAULT_DOCUMENTS_CONFIG.ticketList.includePhotos,
        includeDates: typeof parsed?.ticketList?.includeDates === "boolean" ? parsed.ticketList.includeDates : DEFAULT_DOCUMENTS_CONFIG.ticketList.includeDates,
      },
      diagnosticProtocol: {
        includeServiceInfo: typeof parsed?.diagnosticProtocol?.includeServiceInfo === "boolean" ? parsed.diagnosticProtocol.includeServiceInfo : DEFAULT_DOCUMENTS_CONFIG.diagnosticProtocol.includeServiceInfo,
        includeCustomerInfo: typeof parsed?.diagnosticProtocol?.includeCustomerInfo === "boolean" ? parsed.diagnosticProtocol.includeCustomerInfo : DEFAULT_DOCUMENTS_CONFIG.diagnosticProtocol.includeCustomerInfo,
        includeDeviceInfo: typeof parsed?.diagnosticProtocol?.includeDeviceInfo === "boolean" ? parsed.diagnosticProtocol.includeDeviceInfo : DEFAULT_DOCUMENTS_CONFIG.diagnosticProtocol.includeDeviceInfo,
        includeDiagnosticText: typeof parsed?.diagnosticProtocol?.includeDiagnosticText === "boolean" ? parsed.diagnosticProtocol.includeDiagnosticText : DEFAULT_DOCUMENTS_CONFIG.diagnosticProtocol.includeDiagnosticText,
        includePhotos: typeof parsed?.diagnosticProtocol?.includePhotos === "boolean" ? parsed.diagnosticProtocol.includePhotos : DEFAULT_DOCUMENTS_CONFIG.diagnosticProtocol.includePhotos,
        includeDates: typeof parsed?.diagnosticProtocol?.includeDates === "boolean" ? parsed.diagnosticProtocol.includeDates : DEFAULT_DOCUMENTS_CONFIG.diagnosticProtocol.includeDates,
      },
      warrantyCertificate: {
        includeServiceInfo: typeof parsed?.warrantyCertificate?.includeServiceInfo === "boolean" ? parsed.warrantyCertificate.includeServiceInfo : DEFAULT_DOCUMENTS_CONFIG.warrantyCertificate.includeServiceInfo,
        includeCustomerInfo: typeof parsed?.warrantyCertificate?.includeCustomerInfo === "boolean" ? parsed.warrantyCertificate.includeCustomerInfo : DEFAULT_DOCUMENTS_CONFIG.warrantyCertificate.includeCustomerInfo,
        includeDeviceInfo: typeof parsed?.warrantyCertificate?.includeDeviceInfo === "boolean" ? parsed.warrantyCertificate.includeDeviceInfo : DEFAULT_DOCUMENTS_CONFIG.warrantyCertificate.includeDeviceInfo,
        includeRepairs: typeof parsed?.warrantyCertificate?.includeRepairs === "boolean" ? parsed.warrantyCertificate.includeRepairs : DEFAULT_DOCUMENTS_CONFIG.warrantyCertificate.includeRepairs,
        includeDates: typeof parsed?.warrantyCertificate?.includeDates === "boolean" ? parsed.warrantyCertificate.includeDates : DEFAULT_DOCUMENTS_CONFIG.warrantyCertificate.includeDates,
      },
      autoPrint: parsed?.autoPrint ? {
        ticketListOnCreate: !!parsed.autoPrint.ticketListOnCreate,
        ticketListOnStatusKey: parsed.autoPrint.ticketListOnStatusKey ?? null,
        warrantyOnCreate: !!parsed.autoPrint.warrantyOnCreate,
        warrantyOnStatusKey: parsed.autoPrint.warrantyOnStatusKey ?? null,
        prijetiReklamaceOnCreate: !!parsed.autoPrint.prijetiReklamaceOnCreate,
        prijetiReklamaceOnStatusKey: parsed.autoPrint.prijetiReklamaceOnStatusKey ?? null,
        vydaniReklamaceOnStatusKey: parsed.autoPrint.vydaniReklamaceOnStatusKey ?? null,
      } : undefined,
    };
  } catch {
    return null;
  }
}

export function safeLoadDocumentsConfig(): any {
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.DOCUMENTS_CONFIG);
    if (!raw) return { ...DEFAULT_DOCUMENTS_CONFIG };
    const parsed = JSON.parse(raw);
    return {
      ticketList: {
        includeServiceInfo: parsed?.ticketList?.includeServiceInfo !== false,
        includeCustomerInfo: parsed?.ticketList?.includeCustomerInfo !== false,
        includeDeviceInfo: parsed?.ticketList?.includeDeviceInfo !== false,
        includeRepairs: parsed?.ticketList?.includeRepairs !== false,
        includeDiagnostic: parsed?.ticketList?.includeDiagnostic === true,
        includePhotos: parsed?.ticketList?.includePhotos === true,
        includeDates: parsed?.ticketList?.includeDates !== false,
      },
      diagnosticProtocol: {
        includeServiceInfo: parsed?.diagnosticProtocol?.includeServiceInfo !== false,
        includeCustomerInfo: parsed?.diagnosticProtocol?.includeCustomerInfo !== false,
        includeDeviceInfo: parsed?.diagnosticProtocol?.includeDeviceInfo !== false,
        includeDiagnosticText: parsed?.diagnosticProtocol?.includeDiagnosticText !== false,
        includePhotos: parsed?.diagnosticProtocol?.includePhotos !== false,
        includeDates: parsed?.diagnosticProtocol?.includeDates !== false,
      },
      warrantyCertificate: {
        includeServiceInfo: parsed?.warrantyCertificate?.includeServiceInfo !== false,
        includeCustomerInfo: parsed?.warrantyCertificate?.includeCustomerInfo !== false,
        includeDeviceInfo: parsed?.warrantyCertificate?.includeDeviceInfo !== false,
        includeRepairs: parsed?.warrantyCertificate?.includeRepairs !== false,
        includeDates: parsed?.warrantyCertificate?.includeDates !== false,
      },
    };
  } catch {
    return { ...DEFAULT_DOCUMENTS_CONFIG };
  }
}

export async function getConfigWithProfile(
  serviceId: string | null,
  docType: "zakazkovy_list" | "zarucni_list" | "diagnosticky_protokol"
): Promise<any> {
  const base = (await loadDocumentsConfigFromDB(serviceId)) || safeLoadDocumentsConfig();
  const profile = await getProfileFromJobiDocs(serviceId ?? "", docType);
  if (!profile) return base;
  const section = docType === "zakazkovy_list" ? "ticketList" : docType === "zarucni_list" ? "warrantyCertificate" : "diagnosticProtocol";
  return {
    ...base,
    [section]: { ...base[section], ...profile },
  };
}

// ---------------------------------------------------------------------------
// Fallback design styles for Jobi HTML generators
// (simplified flat shape; JobiDocs has a richer version in documentDesign.ts)
// ---------------------------------------------------------------------------

export type FallbackDesignStyles = {
  primaryColor: string;
  secondaryColor: string;
  accentColor: string;
  borderColor: string;
  bgColor: string;
  headerBg: string;
  headerText: string;
  sectionBg: string;
  sectionBorder: string;
};

export function getDesignStylesForFallback(designType: string): FallbackDesignStyles {
  switch (designType) {
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
}
