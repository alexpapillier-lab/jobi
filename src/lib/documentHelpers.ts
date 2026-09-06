import type { WarrantyClaimRow } from "../pages/Orders/hooks/useWarrantyClaims";
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

// Proměnné pro JobiDocs v2 staví src/lib/documentData.ts (DocumentData); starší
// plochý slovník proměnných byl odstraněn 6. 9. – nikdo ho nevolal.

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
// Záruční doba pro záruční list
// ---------------------------------------------------------------------------

export type ZarucniDoba = { months?: number; days?: number };

/**
 * Jak dlouhou záruku servis dává na opravu.
 *
 * Není to údaj zakázky, ale nastavení dokumentů servisu
 * (service_document_settings → warrantyCertificate), proto se čte odtud.
 * Dny se na měsíce nepřepočítávají: „45 dnů“ není „1,5 měsíce“ a přepočet
 * přes třicetidenní měsíc by zákazníkovi na papíře slíbil něco jiného, než
 * si servis nastavil. Vlastní text záruky žádnou délku neurčuje.
 */
export function zarucniDobaZNastaveni(config: unknown): ZarucniDoba | undefined {
  const wc = (config as { warrantyCertificate?: Record<string, unknown> } | null | undefined)?.warrantyCertificate;
  if (!wc || typeof wc !== "object") return undefined;
  if (wc.warrantyType === "custom") return undefined;
  const delka = Number(wc.warrantyUnifiedDuration);
  if (!Number.isFinite(delka) || delka <= 0) return undefined;
  if (wc.warrantyUnifiedUnit === "days") return { days: Math.round(delka) };
  if (wc.warrantyUnifiedUnit === "years") return { months: Math.round(delka * 12) };
  return { months: Math.round(delka) };
}

/**
 * Poslední načtená záruční doba servisu.
 *
 * Tisk zakázky je synchronní, ale nastavení dokumentů se načítá z databáze;
 * drží se proto v paměti spolu s ID servisu. Bez shody ID se raději nevrátí
 * nic – vytisknout záruku předchozího servisu je horší než ji nevytisknout,
 * právní text si v takovém případě vystačí se zákonnou délkou.
 */
let zapamatovanaZaruka: { serviceId: string; doba: ZarucniDoba } | null = null;

export function zapamatujZarukuServisu(serviceId: string | null | undefined, config: unknown): void {
  if (!serviceId) return;
  const doba = zarucniDobaZNastaveni(config);
  zapamatovanaZaruka = doba ? { serviceId, doba } : null;
}

export function zarucniDobaProTisk(serviceId: string | null | undefined): ZarucniDoba | undefined {
  if (!serviceId || zapamatovanaZaruka?.serviceId !== serviceId) return undefined;
  return zapamatovanaZaruka.doba;
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
      .maybeSingle();

    if (error || !data) return null;

    const typedData = data as { config: any };
    if (!typedData.config) return null;
    const parsed = typedData.config as any;
    // Záruční doba se odsud tiskne na záruční list, viz zarucniDobaProTisk.
    zapamatujZarukuServisu(serviceId, parsed);

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
        // Délka záruky se dřív z načteného configu ztrácela, takže na
        // záručním listu chybělo číslo, které si servis nastavil.
        warrantyType: parsed?.warrantyCertificate?.warrantyType,
        warrantyUnifiedDuration: parsed?.warrantyCertificate?.warrantyUnifiedDuration,
        warrantyUnifiedUnit: parsed?.warrantyCertificate?.warrantyUnifiedUnit,
        warrantyCustomText: parsed?.warrantyCertificate?.warrantyCustomText,
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
