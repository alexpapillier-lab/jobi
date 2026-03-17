import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { Ticket } from "../mock/tickets";
import { useStatuses, type StatusMeta } from "../state/StatusesStore";
import { TicketCardList, TicketCardGrid, TicketCardCompact, TicketCardCompactExtra, TicketCardModern, TicketCardSplit, TicketCardStripe, TicketTable, TicketTimeline, TicketStatusGrouped, ClaimStatusGrouped, CombinedStatusGrouped, ClaimCard, type TicketCardData } from "../components/tickets";
import { computeFinalPrice } from "../components/tickets/types";
import { showToast, showPersistentToast } from "../components/Toast";
import { isJobiDocsRunning, printDocumentViaJobiDocs, exportDocumentViaJobiDocs, exportViaJobiDocs, formatJobiDocsErrorForUser } from "../lib/jobidocs";
import { normalizeError } from "../utils/errorNormalizer";
import type { NavKey } from "../layout/Sidebar";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { DateTimePicker } from "../components/DateTimePicker";
import { supabase, supabaseUrl, supabaseAnonKey, supabaseFetch, resetTauriFetchState } from "../lib/supabaseClient";
import { typedSupabase } from "../lib/typedSupabase";
import { devLog } from "../lib/devLog";
import {
  uploadDiagnosticPhotoWithWatermark,
  deleteDiagnosticPhotoFromStorage,
  isDiagnosticPhotoStorageUrl,
} from "../lib/diagnosticPhotosStorage";
import { normalizePhone } from "../lib/phone";
import { STORAGE_KEYS } from "../constants/storageKeys";
import { useOrderActions } from "./Orders/hooks/useOrderActions";
import { type WarrantyClaimRow, useWarrantyClaims } from "./Orders/hooks/useWarrantyClaims";
import { CreateWarrantyClaimModal } from "./Orders/components/CreateWarrantyClaimModal";
import { SmsChat } from "../components/SmsChat";
import { useAuth } from "../auth/AuthProvider";
import { checkAchievementOnFirstPrint, checkAchievementOnPaperless, checkAchievementOnFirstCapturePhoto, checkAchievementOnShortcutUsed } from "../lib/achievements";
import { useUserProfile } from "../hooks/useUserProfile";
import { useActiveRole } from "../hooks/useActiveRole";
import { getShortcut, comboMatchesEvent, isInputFocused } from "../lib/keyboardShortcuts";
import { getDeviceOptions } from "../lib/deviceOptions";
import { getHandoffOptions } from "../lib/handoffOptions";
import { safeLoadCompanyData, type CompanyData } from "../lib/companyData";
import { trackDocumentAction, validateDocumentVariables } from "../lib/documentTelemetry";
import {
  escapeHtmlForDoc,
  buildTicketVariablesForJobiDocs,
  buildClaimVariablesForJobiDocs,
  loadDocumentsConfigFromDB,
  safeLoadDocumentsConfig,
  getConfigWithProfile,
  getDesignStylesForFallback,
} from "../lib/documentHelpers";

export { safeLoadCompanyData } from "../lib/companyData";
export { safeLoadDocumentsConfig } from "../lib/documentHelpers";
import { generateTicketHTML, generateDiagnosticProtocolHTML, generateWarrantyHTML, generatePrijetiReklamaceHTML } from "../lib/documentGenerators";
export { generateTicketHTML, generateDiagnosticProtocolHTML, generateWarrantyHTML, generatePrijetiReklamaceHTML } from "../lib/documentGenerators";

type DeviceRepair = {
  id: string;
  modelIds: string[]; // může být u více modelů
  name: string;
  price: number;
  estimatedTime: number;
  details: string;
  costs?: number; // náklady
  productIds?: string[]; // produkty používané u této opravy
  createdAt: string;
};

type DeviceBrand = {
  id: string;
  name: string;
  createdAt: string;
};

type DeviceCategory = {
  id: string;
  brandId: string;
  name: string;
  createdAt: string;
};

type DeviceModel = {
  id: string;
  categoryId: string;
  name: string;
  createdAt: string;
};

type DevicesData = {
  brands: DeviceBrand[];
  categories: DeviceCategory[];
  models: DeviceModel[];
  repairs: DeviceRepair[];
};

function safeLoadDevicesData(): DevicesData {
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.DEVICES);
    if (!raw) return { brands: [], categories: [], models: [], repairs: [] };
    const parsed = JSON.parse(raw) as DevicesData;
    return {
      brands: Array.isArray(parsed.brands) ? parsed.brands : [],
      categories: Array.isArray(parsed.categories) ? parsed.categories : [],
      models: Array.isArray(parsed.models) ? parsed.models : [],
      repairs: Array.isArray(parsed.repairs) ? parsed.repairs : [],
    };
  } catch {
    return { brands: [], categories: [], models: [], repairs: [] };
  }
}

type InventoryProduct = {
  id: string;
  name: string;
  modelIds: string[];
  stock: number;
  price: number;
  sku?: string;
  description?: string;
  imageUrl?: string;
  repairIds?: string[];
  createdAt: string;
};

type InventoryData = {
  brands: DeviceBrand[];
  categories: DeviceCategory[];
  models: DeviceModel[];
  products: InventoryProduct[];
};

function safeLoadInventoryData(): InventoryData {
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.INVENTORY);
    if (!raw) return { brands: [], categories: [], models: [], products: [] };
    const parsed = JSON.parse(raw) as InventoryData;
    return {
      brands: Array.isArray(parsed.brands) ? parsed.brands : [],
      categories: Array.isArray(parsed.categories) ? parsed.categories : [],
      models: Array.isArray(parsed.models) ? parsed.models : [],
      products: Array.isArray(parsed.products) ? parsed.products : [],
    };
  } catch {
    return { brands: [], categories: [], models: [], products: [] };
  }
}

function safeSaveInventoryData(data: InventoryData) {
  try {
    localStorage.setItem(STORAGE_KEYS.INVENTORY, JSON.stringify(data));
  } catch {}
}

type GroupKey = "all" | "active" | "final" | "reklamace";
type ClaimsSubGroup = "all" | "active" | "final";

const VALID_PAGE_SIZES = [0, 25, 50, 100, 200] as const;
type DisplayMode = "list" | "grid" | "compact" | "compact-extra" | "table" | "timeline" | "cards-modern" | "split" | "stripe" | "status-grouped";
type UIConfig = {
  app: { fabNewOrderEnabled: boolean; uiScale: number };
  sidebar: { position: "left" | "right" | "bottom" };
  home: { orderFilters: { selectedQuickStatusFilters: string[] } };
  orders: { displayMode: DisplayMode; pageSize: number; customerPhoneRequired: boolean; statusGroupedOrder?: string[] };
};

type OpenTicketIntent = {
  ticketId: string;
  mode?: "panel" | "detail";
  returnToPage?: NavKey;
  returnToCustomerId?: string;
  openSmsPanel?: boolean;
};

type OrdersProps = {
  activeServiceId: string | null;
  smsPanelTicketIdRef?: React.MutableRefObject<string | null> | null;
  newOrderPrefill: { customerId?: string } | null;
  onNewOrderPrefillConsumed: () => void;

  openTicketIntent: OpenTicketIntent | null;
  onOpenTicketIntentConsumed: () => void;

  openClaimIntent?: { claimId: string } | null;
  onOpenClaimIntentConsumed?: () => void;

  onOpenCustomer?: (customerId: string) => void;
  onReturnToPage?: (page: NavKey, customerId?: string) => void;
  onCreateInvoice?: (prefill: {
    ticketId: string;
    customerId?: string;
    customerName?: string;
    customerEmail?: string;
    customerPhone?: string;
    customerIco?: string;
    customerDic?: string;
    customerAddress?: string;
    items?: { name: string; qty: number; unit: string; unit_price: number; vat_rate: number }[];
  }) => void;
  /** When ticket already has an invoice, open that invoice (navigate to Faktury and open editor). */
  onOpenInvoice?: (invoiceId: string) => void;

  /** When true, detail panel (ticket/claim) is closed. Used when navigating to e.g. Faktury so the preview does not stay on top. */
  closeDetailWhen?: boolean;
};

const NEW_ORDER_DRAFT_KEY = "jobsheet_new_order_draft_v1";
const COMMENTS_STORAGE_KEY = "jobsheet_ticket_comments_v1";

/** Položka provedeného zákroku u reklamace (ukládá se do resolution_summary jako JSON). */
type ClaimResolutionItem = { id: string; name: string; description?: string; price?: number };

function parseClaimResolutionItems(raw: string | null): ClaimResolutionItem[] {
  if (!raw || !raw.trim()) return [];
  const t = raw.trim();
  if (t.startsWith("[")) {
    try {
      const arr = JSON.parse(t) as unknown;
      if (!Array.isArray(arr)) return [];
      return arr.filter((x): x is ClaimResolutionItem => x && typeof x === "object" && typeof (x as any).id === "string" && typeof (x as any).name === "string").map((x) => ({
        id: (x as any).id,
        name: (x as any).name ?? "",
        description: (x as any).description ?? undefined,
        price: typeof (x as any).price === "number" ? (x as any).price : undefined,
      }));
    } catch {
      return [{ id: (crypto as any).randomUUID?.() ?? `legacy-${Date.now()}`, name: t }];
    }
  }
  return [{ id: (crypto as any).randomUUID?.() ?? `legacy-${Date.now()}`, name: t }];
}

function serializeClaimResolutionItems(items: ClaimResolutionItem[]): string {
  if (items.length === 0) return "";
  return JSON.stringify(items);
}

type PerformedRepair = {
  id: string;
  name: string;
  type: "selected" | "manual";
  repairId?: string;
  price?: number; // cena opravy (lze upravit)
  costs?: number; // náklady (lze upravit)
  estimatedTime?: number; // čas (lze upravit)
  productIds?: string[]; // produkty (lze upravit)
};

export type TicketEx = Ticket & {
  customerId?: string;
  customerEmail?: string;
  customerAddressStreet?: string;
  customerAddressCity?: string;
  customerAddressZip?: string;
  customerCompany?: string;
  customerIco?: string;
  customerInfo?: string;

  devicePasscode?: string;
  deviceCondition?: string;
  deviceAccessories?: string;

  discountType?: "percentage" | "amount" | null; // typ slevy: procenta, částka, nebo žádná
  discountValue?: number; // hodnota slevy (% nebo Kč)
  requestedRepair?: string;
  handoffMethod?: string;
  handbackMethod?: string;
  deviceNote?: string;
  externalId?: string;
  estimatedPrice?: number;
  performedRepairs?: PerformedRepair[];
  
  diagnosticText?: string; // text diagnostiky
  diagnosticPhotos?: string[]; // URL diagnostických fotek (po vytvoření)
  diagnosticPhotosBefore?: string[]; // URL fotek při příjmu / před vytvořením
  
  expectedDoneAt?: string; // předpokládané dokončení (ISO)
  version?: number; // optimistic locking version
};

type DeviceRow = {
  deviceLabel: string;
  serialOrImei: string;
  devicePasscode: string;
  deviceCondition: string;
  deviceAccessories: string;
  requestedRepair: string;
  handoffMethod: string;
  handbackMethod: string;
  deviceNote: string;
  externalId: string;
  estimatedPrice?: number;
  /** Předpokládané datum/čas dokončení – primárně kopírováno z prvního zařízení */
  expectedCompletionAt?: string | null;
};

type NewOrderDraft = {
  customerId?: string;
  customerName: string;
  customerPhone: string;
  customerEmail: string;
  addressStreet: string;
  addressCity: string;
  addressZip: string;
  company: string;
  ico: string;
  customerInfo: string;

  devices: DeviceRow[];

  diagnosticPhotosBefore?: string[]; // data URLs – fotky při příjmu (před vytvořením zakázky)
};

type TicketComment = {
  id: string;
  ticketId: string;
  author: string;
  text: string;
  createdAt: string;
  pinned?: boolean;
  author_id?: string | null;
  author_nickname?: string | null;
  author_avatar_url?: string | null;
};

// ========================
// Utils: storage
// ========================
const VALID_DISPLAY_MODES: DisplayMode[] = ["list", "grid", "compact", "compact-extra", "table", "timeline", "cards-modern", "split", "stripe", "status-grouped"];

function defaultUIConfig(): UIConfig {
  return {
    app: { fabNewOrderEnabled: true, uiScale: 1 },
    sidebar: { position: "left" },
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
    const validPageSize = typeof pageSize === "number" && (VALID_PAGE_SIZES as readonly number[]).includes(pageSize)
      ? pageSize
      : d.orders.pageSize;

    const sidebarPos = parsed?.sidebar?.position;
    return {
      app: {
        fabNewOrderEnabled: typeof fab === "boolean" ? !!fab : d.app.fabNewOrderEnabled,
        uiScale: typeof scale === "number" && scale >= 0.85 && scale <= 1.35 ? scale : d.app.uiScale,
      },
      sidebar: {
        position: (["left", "right", "bottom"] as const).includes(sidebarPos) ? sidebarPos : d.sidebar.position,
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
        customerPhoneRequired: typeof customerPhoneRequired === "boolean" ? customerPhoneRequired : d.orders.customerPhoneRequired,
        statusGroupedOrder: Array.isArray(parsed?.orders?.statusGroupedOrder) ? parsed.orders.statusGroupedOrder.filter((x: any) => typeof x === "string") : undefined,
      },
    };
  } catch {
    return defaultUIConfig();
  }
}


function safeLoadDraft(): NewOrderDraft | null {
  try {
    const raw = localStorage.getItem(NEW_ORDER_DRAFT_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return null;
    if (Array.isArray(parsed.devices)) {
      const draft = parsed as NewOrderDraft;
      const firstExpected = draft.devices[0]?.expectedCompletionAt ?? (draft as any).expectedCompletionAt;
      const migrated = {
        ...draft,
        devices: draft.devices.map((d: DeviceRow) => ({
          ...d,
          expectedCompletionAt: d.expectedCompletionAt ?? firstExpected ?? undefined,
        })),
      };
      delete (migrated as any).expectedCompletionAt;
      return migrated;
    }
    const d = defaultDraft();
    const def = defaultDeviceRow();
    const migrated: NewOrderDraft = {
      ...d,
      customerId: parsed.customerId,
      customerName: parsed.customerName ?? "",
      customerPhone: parsed.customerPhone ?? "",
      customerEmail: parsed.customerEmail ?? "",
      addressStreet: parsed.addressStreet ?? "",
      addressCity: parsed.addressCity ?? "",
      addressZip: parsed.addressZip ?? "",
      company: parsed.company ?? "",
      ico: parsed.ico ?? "",
      customerInfo: parsed.customerInfo ?? "",
      devices: [{
        deviceLabel: parsed.deviceLabel ?? def.deviceLabel,
        serialOrImei: parsed.serialOrImei ?? def.serialOrImei,
        devicePasscode: parsed.devicePasscode ?? def.devicePasscode,
        deviceCondition: parsed.deviceCondition ?? def.deviceCondition,
        deviceAccessories: parsed.deviceAccessories ?? def.deviceAccessories,
        requestedRepair: parsed.requestedRepair ?? def.requestedRepair,
        handoffMethod: parsed.handoffMethod ?? def.handoffMethod,
        handbackMethod: parsed.handbackMethod ?? def.handbackMethod,
        deviceNote: parsed.deviceNote ?? def.deviceNote,
        externalId: parsed.externalId ?? def.externalId,
        estimatedPrice: parsed.estimatedPrice ?? def.estimatedPrice,
        expectedCompletionAt: (parsed as any).expectedCompletionAt ?? undefined,
      }],
      diagnosticPhotosBefore: parsed.diagnosticPhotosBefore,
    };
    return migrated;
  } catch {
    return null;
  }
}

function safeSaveDraft(draft: NewOrderDraft | null) {
  try {
    if (!draft) localStorage.removeItem(NEW_ORDER_DRAFT_KEY);
    else localStorage.setItem(NEW_ORDER_DRAFT_KEY, JSON.stringify(draft));
  } catch {
    // ignore
  }
}

// Removed: safeLoadCustomers and safeSaveCustomers - no longer used in cloud-first mode

function safeLoadCommentsMap(): Record<string, TicketComment[]> {
  try {
    const raw = localStorage.getItem(COMMENTS_STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return {};
    return parsed as Record<string, TicketComment[]>;
  } catch {
    return {};
  }
}

function safeSaveCommentsMap(map: Record<string, TicketComment[]>) {
  try {
    localStorage.setItem(COMMENTS_STORAGE_KEY, JSON.stringify(map));
  } catch {
    // ignore
  }
}

// ========================
// Utils: formatting
// ========================
function formatCZ(dtIso: string) {
  const d = new Date(dtIso);
  return d.toLocaleString("cs-CZ", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}


function defaultDeviceRow(): DeviceRow {
  const handoffOpts = getHandoffOptions();
  const defaultReceive = handoffOpts.receiveMethods.includes("Osobně") ? "Osobně" : "";
  const defaultReturn = handoffOpts.returnMethods.includes("Osobně") ? "Osobně" : "";
  return {
    deviceLabel: "",
    serialOrImei: "",
    devicePasscode: "",
    deviceCondition: "",
    deviceAccessories: "",
    requestedRepair: "",
    handoffMethod: defaultReceive,
    handbackMethod: defaultReturn,
    deviceNote: "",
    externalId: "",
    estimatedPrice: undefined,
    expectedCompletionAt: undefined,
  };
}

function defaultDraft(): NewOrderDraft {
  return {
    customerId: undefined,
    customerName: "",
    customerPhone: "",
    customerEmail: "",
    addressStreet: "",
    addressCity: "",
    addressZip: "",
    company: "",
    ico: "",
    customerInfo: "",

    devices: [defaultDeviceRow()],

    diagnosticPhotosBefore: undefined,
  };
}

function isDraftDirty(d: NewOrderDraft) {
  const def = defaultDraft();
  const norm = (v: any) => (typeof v === "string" ? v.trim() : v);
  for (const k of ["customerId", "customerName", "customerPhone", "customerEmail", "addressStreet", "addressCity", "addressZip", "company", "ico", "customerInfo"]) {
    if (norm((d as any)[k]) !== norm((def as any)[k])) return true;
  }
  if ((d.diagnosticPhotosBefore?.length ?? 0) !== (def.diagnosticPhotosBefore?.length ?? 0)) return true;
  if (d.devices.length !== def.devices.length) return true;
  for (let i = 0; i < d.devices.length; i++) {
    const dev = d.devices[i];
    const devDef = def.devices[i] ?? defaultDeviceRow();
    for (const k of Object.keys(devDef) as (keyof DeviceRow)[]) {
      if (norm((dev as any)[k]) !== norm((devDef as any)[k])) return true;
    }
  }
  return false;
}

function isEmailValid(v: string) {
  const s = v.trim();
  if (!s) return true;
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s);
}

function isPhoneValid(v: string) {
  const s = v.trim();
  if (!s) return true;
  const digits = s.replace(/[^\d]/g, "");
  return digits.length >= 9 && digits.length <= 15;
}

function formatPhoneNumber(value: string): string {
  const cleaned = value.replace(/[^\d+]/g, "");
  if (cleaned.length === 0) return "";

  if (cleaned.startsWith("+")) {
    const digits = cleaned.slice(1);
    if (digits.length === 0) return "+";

    if (cleaned.startsWith("+420")) {
      const rest = digits.slice(3);
      if (rest.length === 0) return "+420";
      if (rest.length <= 3) return `+420 ${rest}`;
      if (rest.length <= 6) return `+420 ${rest.slice(0, 3)} ${rest.slice(3)}`;
      return `+420 ${rest.slice(0, 3)} ${rest.slice(3, 6)} ${rest.slice(6, 9)}`;
    }

    const countryCodeMatch = cleaned.match(/^\+(\d{1,3})(\d*)$/);
    if (countryCodeMatch) {
      const [, countryCode, rest] = countryCodeMatch;
      if (rest.length === 0) return `+${countryCode}`;
      if (rest.length <= 3) return `+${countryCode} ${rest}`;
      if (rest.length <= 6) return `+${countryCode} ${rest.slice(0, 3)} ${rest.slice(3)}`;
      return `+${countryCode} ${rest.slice(0, 3)} ${rest.slice(3, 6)} ${rest.slice(6, 9)}`;
    }

    return cleaned;
  }

  const digitsOnly = cleaned.replace(/[^\d]/g, "");
  if (digitsOnly.length === 0) return "";
  if (digitsOnly.length <= 3) return digitsOnly;
  if (digitsOnly.length <= 6) return `${digitsOnly.slice(0, 3)} ${digitsOnly.slice(3)}`;
  if (digitsOnly.length <= 9) return `${digitsOnly.slice(0, 3)} ${digitsOnly.slice(3, 6)} ${digitsOnly.slice(6)}`;
  return `${digitsOnly.slice(0, 3)} ${digitsOnly.slice(3, 6)} ${digitsOnly.slice(6, 9)} ${digitsOnly.slice(9)}`;
}

function formatZipCode(value: string): string {
  const digits = value.replace(/[^\d]/g, "");
  if (digits.length === 0) return "";
  if (digits.length <= 3) return digits;
  return `${digits.slice(0, 3)} ${digits.slice(3, 5)}`;
}

function formatIco(value: string): string {
  const digits = value.replace(/[^\d]/g, "");
  if (digits.length === 0) return "";
  if (digits.length <= 4) return digits;
  return `${digits.slice(0, 4)} ${digits.slice(4, 8)}`;
}

function isZipValid(v: string) {
  const s = v.trim();
  if (!s) return true;
  const digits = s.replace(/[^\d]/g, "");
  return digits.length === 5;
}

function isIcoValid(v: string) {
  const s = v.trim();
  if (!s) return true;
  const digits = s.replace(/[^\d]/g, "");
  return digits.length === 8;
}



export function mapSupabaseTicketToTicketEx(supabaseTicket: any): TicketEx {
  const ticket: TicketEx = {
    id: supabaseTicket.id || "",
    code: (typeof supabaseTicket.code === "string" ? supabaseTicket.code : null),
    customerId: supabaseTicket.customer_id || undefined,
    customerName: supabaseTicket.customer_name || "Cloud Customer",
    customerPhone: supabaseTicket.customer_phone || undefined,
    deviceLabel: supabaseTicket.title || "Nová zakázka",
    serialOrImei: supabaseTicket.device_serial || undefined,
    issueShort: supabaseTicket.notes || "—",
    status: (supabaseTicket.status || "received") as any,
    createdAt: supabaseTicket.created_at, // DB guarantees NOT NULL with default now()
    customerEmail: supabaseTicket.customer_email || undefined,
    customerAddressStreet: supabaseTicket.customer_address_street || undefined,
    customerAddressCity: supabaseTicket.customer_address_city || undefined,
    customerAddressZip: supabaseTicket.customer_address_zip || undefined,
    customerCompany: supabaseTicket.customer_company || undefined,
    customerIco: supabaseTicket.customer_ico || undefined,
    customerInfo: supabaseTicket.customer_info || undefined,
    devicePasscode: supabaseTicket.device_passcode || undefined,
    deviceCondition: supabaseTicket.device_condition || undefined,
    deviceAccessories: (supabaseTicket as any).device_accessories || undefined,
    requestedRepair: supabaseTicket.notes || undefined,
    handoffMethod: supabaseTicket.handoff_method || undefined,
    handbackMethod: (supabaseTicket as any).handback_method || undefined,
    deviceNote: supabaseTicket.device_note || undefined,
    externalId: supabaseTicket.external_id || undefined,
    estimatedPrice: supabaseTicket.estimated_price || undefined,
    performedRepairs: supabaseTicket.performed_repairs || [],
    diagnosticText: supabaseTicket.diagnostic_text || undefined,
    diagnosticPhotos: supabaseTicket.diagnostic_photos || undefined,
    diagnosticPhotosBefore: supabaseTicket.diagnostic_photos_before || undefined,
    discountType: supabaseTicket.discount_type ?? null,
    discountValue: supabaseTicket.discount_value == null ? undefined : Number(supabaseTicket.discount_value),
    version: typeof supabaseTicket.version === "number" ? supabaseTicket.version : undefined,
  };
  (ticket as any).service_id = supabaseTicket.service_id;
  (ticket as any).expected_completion_at = supabaseTicket.expected_completion_at ?? null;
  (ticket as any).completed_at = supabaseTicket.completed_at ?? null;
  return ticket;
}

function uuid() {
  return (crypto as any)?.randomUUID ? (crypto as any).randomUUID() : `${Date.now()}_${Math.random()}`;
}

// Tisk a export PDF probíhají přes JobiDocs (localhost:3847). Bez JobiDocs se zobrazí chybová hláška.

// generateTicketHTML was moved to ../lib/documentGenerators.ts
async function exportTicketToPDF(ticket: TicketEx, serviceId?: string | null) {
  const running = await isJobiDocsRunning();
  if (!running) {
    showToast("Spusťte JobiDocs pro export do PDF.", "error");
    return;
  }
  const sid = serviceId ?? undefined;
  if (!sid) {
    showToast("Vyberte servis pro export.", "error");
    return;
  }
  const start = performance.now();
  let usedFallback = false;
  try {
    const { save } = await import("@tauri-apps/plugin-dialog");
    const filePath = await save({
      defaultPath: `zakazka-${ticket.code}.pdf`,
      filters: [{ name: "PDF", extensions: ["pdf"] }, { name: "All Files", extensions: ["*"] }],
    });
    if (filePath) {
      const config = await getConfigWithProfile(serviceId ?? null, "zakazkovy_list");
      const companyData = safeLoadCompanyData();
      const stillRunning = await isJobiDocsRunning();
      if (!stillRunning) {
        showToast("JobiDocs není dostupný. Zkontrolujte, že je spuštěný, a zkuste to znovu.", "error");
        return;
      }
      const variables = buildTicketVariablesForJobiDocs(ticket, companyData as Record<string, unknown>);
      const validation = validateDocumentVariables(variables);
      if (!validation.valid) {
        devLog("[DocGuardrail]", validation.warnings);
      }
      let res = await exportDocumentViaJobiDocs("zakazkovy_list", sid, companyData as Record<string, unknown>, {}, filePath, { variables });
      if (!res.ok && res.error?.toLowerCase().includes("not found")) {
        usedFallback = true;
        const htmlContent = generateTicketHTML(ticket, true, config);
        res = await exportViaJobiDocs(htmlContent, filePath);
      }
      const durationMs = Math.round(performance.now() - start);
      if (res.ok) {
        trackDocumentAction({ action: "export", docType: "zakazkovy_list", result: usedFallback ? "fallback" : "success", durationMs, usedFallback });
        const u = (await supabase?.auth.getUser())?.data?.user?.id;
        if (u) {
          checkAchievementOnFirstPrint(u);
          checkAchievementOnPaperless(u);
        }
        showExportSuccessToast(filePath);
      } else {
        trackDocumentAction({ action: "export", docType: "zakazkovy_list", result: "error", durationMs, errorMessage: res.error, usedFallback });
        showToast(`JobiDocs: ${formatJobiDocsErrorForUser(res.error)}`, "error");
      }
    }
  } catch (e) {
    const durationMs = Math.round(performance.now() - start);
    trackDocumentAction({ action: "export", docType: "zakazkovy_list", result: "error", durationMs, errorMessage: e instanceof Error ? e.message : String(e) });
    showToast(`Chyba exportu: ${e instanceof Error ? e.message : String(e)}`, "error");
  }
}

function showExportSuccessToast(filePath: string) {
  const shortPath = filePath.replace(/^.*[/\\]/, "");
  showPersistentToast(`PDF uložen: ${shortPath}`, "success", {
    actionLabel: "Otevřít složku",
    onAction: async () => {
      try {
        const { revealItemInDir } = await import("@tauri-apps/plugin-opener");
        await revealItemInDir(filePath);
      } catch (err) {
        showToast("Nelze otevřít složku: " + (err instanceof Error ? err.message : String(err)), "error");
      }
    },
  });
}

async function printTicket(ticket: TicketEx, serviceId?: string | null) {
  const running = await isJobiDocsRunning();
  if (!running) {
    showToast("Spusťte JobiDocs pro tisk.", "error");
    return;
  }
  const sid = serviceId ?? undefined;
  if (!sid) {
    showToast("Vyberte servis pro tisk.", "error");
    return;
  }
  const start = performance.now();
  const companyData = safeLoadCompanyData();
  const stillRunning = await isJobiDocsRunning();
  if (!stillRunning) {
    showToast("JobiDocs není dostupný. Zkontrolujte, že je spuštěný, a zkuste to znovu.", "error");
    return;
  }
  const variables = buildTicketVariablesForJobiDocs(ticket, companyData as Record<string, unknown>);
  const validation = validateDocumentVariables(variables);
  if (!validation.valid) {
    devLog("[DocGuardrail]", validation.warnings);
  }
  const res = await printDocumentViaJobiDocs("zakazkovy_list", sid, companyData as Record<string, unknown>, {}, { variables });
  const durationMs = Math.round(performance.now() - start);
  if (res.ok) {
    trackDocumentAction({ action: "print", docType: "zakazkovy_list", result: "success", durationMs });
    const u = (await supabase?.auth.getUser())?.data?.user?.id;
    if (u) {
      checkAchievementOnFirstPrint(u);
      checkAchievementOnPaperless(u);
    }
    showToast("Úloha odeslána do fronty", "success");
  } else {
    trackDocumentAction({ action: "print", docType: "zakazkovy_list", result: "error", durationMs, errorMessage: res.error });
    showToast(`JobiDocs: ${formatJobiDocsErrorForUser(res.error)}`, "error");
  }
}


async function exportDiagnosticProtocolToPDF(ticket: TicketEx, serviceId?: string | null) {
  const running = await isJobiDocsRunning();
  if (!running) {
    showToast("Spusťte JobiDocs pro export do PDF.", "error");
    return;
  }
  const sid = serviceId ?? undefined;
  if (!sid) {
    showToast("Vyberte servis pro export.", "error");
    return;
  }
  const start = performance.now();
  let usedFallback = false;
  try {
    const { save } = await import("@tauri-apps/plugin-dialog");
    const filePath = await save({
      defaultPath: `diagnostika-${ticket.code}.pdf`,
      filters: [{ name: "PDF", extensions: ["pdf"] }, { name: "All Files", extensions: ["*"] }],
    });
    if (filePath) {
      const config = await getConfigWithProfile(serviceId ?? null, "diagnosticky_protokol");
      const companyData = safeLoadCompanyData();
      const stillRunning = await isJobiDocsRunning();
      if (!stillRunning) {
        showToast("JobiDocs není dostupný. Zkontrolujte, že je spuštěný, a zkuste to znovu.", "error");
        return;
      }
      const variables = buildTicketVariablesForJobiDocs(ticket, companyData as Record<string, unknown>);
      const validation = validateDocumentVariables(variables);
      if (!validation.valid) {
        devLog("[DocGuardrail]", validation.warnings);
      }
      let res = await exportDocumentViaJobiDocs("diagnosticky_protokol", sid, companyData as Record<string, unknown>, {}, filePath, { variables });
      if (!res.ok && res.error?.toLowerCase().includes("not found")) {
        usedFallback = true;
        const htmlContent = generateDiagnosticProtocolHTML(ticket, companyData, true, config);
        res = await exportViaJobiDocs(htmlContent, filePath);
      }
      const durationMs = Math.round(performance.now() - start);
      if (res.ok) {
        trackDocumentAction({ action: "export", docType: "diagnosticky_protokol", result: usedFallback ? "fallback" : "success", durationMs, usedFallback });
        const u = (await supabase?.auth.getUser())?.data?.user?.id;
        if (u) {
          checkAchievementOnFirstPrint(u);
          checkAchievementOnPaperless(u);
        }
        showExportSuccessToast(filePath);
      } else {
        trackDocumentAction({ action: "export", docType: "diagnosticky_protokol", result: "error", durationMs, errorMessage: res.error, usedFallback });
        showToast(`JobiDocs: ${formatJobiDocsErrorForUser(res.error)}`, "error");
      }
    }
  } catch (e) {
    const durationMs = Math.round(performance.now() - start);
    trackDocumentAction({ action: "export", docType: "diagnosticky_protokol", result: "error", durationMs, errorMessage: e instanceof Error ? e.message : String(e) });
    showToast(`Chyba exportu: ${e instanceof Error ? e.message : String(e)}`, "error");
  }
}

async function printDiagnosticProtocol(ticket: TicketEx, serviceId?: string | null) {
  const running = await isJobiDocsRunning();
  if (!running) {
    showToast("Spusťte JobiDocs pro tisk.", "error");
    return;
  }
  const sid = serviceId ?? undefined;
  if (!sid) {
    showToast("Vyberte servis pro tisk.", "error");
    return;
  }
  const start = performance.now();
  const companyData = safeLoadCompanyData();
  const stillRunning = await isJobiDocsRunning();
  if (!stillRunning) {
    showToast("JobiDocs není dostupný. Zkontrolujte, že je spuštěný, a zkuste to znovu.", "error");
    return;
  }
  const variables = buildTicketVariablesForJobiDocs(ticket, companyData as Record<string, unknown>);
  const validation = validateDocumentVariables(variables);
  if (!validation.valid) {
    devLog("[DocGuardrail]", validation.warnings);
  }
  const res = await printDocumentViaJobiDocs("diagnosticky_protokol", sid, companyData as Record<string, unknown>, {}, { variables });
  const durationMs = Math.round(performance.now() - start);
  if (res.ok) {
    trackDocumentAction({ action: "print", docType: "diagnosticky_protokol", result: "success", durationMs });
    const u = (await supabase?.auth.getUser())?.data?.user?.id;
    if (u) {
      checkAchievementOnFirstPrint(u);
      checkAchievementOnPaperless(u);
    }
    showToast("Úloha odeslána do fronty", "success");
  } else {
    trackDocumentAction({ action: "print", docType: "diagnosticky_protokol", result: "error", durationMs, errorMessage: res.error });
    showToast(`JobiDocs: ${formatJobiDocsErrorForUser(res.error)}`, "error");
  }
}



async function exportWarrantyToPDF(ticket: TicketEx, serviceId?: string | null) {
  const running = await isJobiDocsRunning();
  if (!running) {
    showToast("Spusťte JobiDocs pro export do PDF.", "error");
    return;
  }
  const sid = serviceId ?? undefined;
  if (!sid) {
    showToast("Vyberte servis pro export.", "error");
    return;
  }
  const start = performance.now();
  let usedFallback = false;
  try {
    const { save } = await import("@tauri-apps/plugin-dialog");
    const filePath = await save({
      defaultPath: `zarucni-list-${ticket.code}.pdf`,
      filters: [{ name: "PDF", extensions: ["pdf"] }, { name: "All Files", extensions: ["*"] }],
    });
    if (filePath) {
      const config = await getConfigWithProfile(serviceId ?? null, "zarucni_list");
      const companyData = safeLoadCompanyData();
      const stillRunning = await isJobiDocsRunning();
      if (!stillRunning) {
        showToast("JobiDocs není dostupný. Zkontrolujte, že je spuštěný, a zkuste to znovu.", "error");
        return;
      }
      const variables = buildTicketVariablesForJobiDocs(ticket, companyData as Record<string, unknown>);
      const validation = validateDocumentVariables(variables);
      if (!validation.valid) {
        devLog("[DocGuardrail]", validation.warnings);
      }
      let res = await exportDocumentViaJobiDocs("zarucni_list", sid, companyData as Record<string, unknown>, {}, filePath, {
        repair_date: new Date().toISOString(),
        variables,
      });
      if (!res.ok && res.error?.toLowerCase().includes("not found")) {
        usedFallback = true;
        const htmlContent = generateWarrantyHTML(ticket, companyData, true, config);
        res = await exportViaJobiDocs(htmlContent, filePath);
      }
      const durationMs = Math.round(performance.now() - start);
      if (res.ok) {
        trackDocumentAction({ action: "export", docType: "zarucni_list", result: usedFallback ? "fallback" : "success", durationMs, usedFallback });
        const u = (await supabase?.auth.getUser())?.data?.user?.id;
        if (u) {
          checkAchievementOnFirstPrint(u);
          checkAchievementOnPaperless(u);
        }
        showExportSuccessToast(filePath);
      } else {
        trackDocumentAction({ action: "export", docType: "zarucni_list", result: "error", durationMs, errorMessage: res.error, usedFallback });
        showToast(`JobiDocs: ${formatJobiDocsErrorForUser(res.error)}`, "error");
      }
    }
  } catch (e) {
    const durationMs = Math.round(performance.now() - start);
    trackDocumentAction({ action: "export", docType: "zarucni_list", result: "error", durationMs, errorMessage: e instanceof Error ? e.message : String(e) });
    showToast(`Chyba exportu: ${e instanceof Error ? e.message : String(e)}`, "error");
  }
}

async function printWarranty(ticket: TicketEx, serviceId?: string | null) {
  const running = await isJobiDocsRunning();
  if (!running) {
    showToast("Spusťte JobiDocs pro tisk.", "error");
    return;
  }
  const sid = serviceId ?? undefined;
  if (!sid) {
    showToast("Vyberte servis pro tisk.", "error");
    return;
  }
  const start = performance.now();
  const companyData = safeLoadCompanyData();
  const stillRunning = await isJobiDocsRunning();
  if (!stillRunning) {
    showToast("JobiDocs není dostupný. Zkontrolujte, že je spuštěný, a zkuste to znovu.", "error");
    return;
  }
  const variables = buildTicketVariablesForJobiDocs(ticket, companyData as Record<string, unknown>);
  const validation = validateDocumentVariables(variables);
  if (!validation.valid) {
    devLog("[DocGuardrail]", validation.warnings);
  }
  const res = await printDocumentViaJobiDocs("zarucni_list", sid, companyData as Record<string, unknown>, {}, {
    repair_date: new Date().toISOString(),
    variables,
  });
  const durationMs = Math.round(performance.now() - start);
  if (res.ok) {
    trackDocumentAction({ action: "print", docType: "zarucni_list", result: "success", durationMs });
    const u = (await supabase?.auth.getUser())?.data?.user?.id;
    if (u) {
      checkAchievementOnFirstPrint(u);
      checkAchievementOnPaperless(u);
    }
    showToast("Úloha odeslána do fronty", "success");
  } else {
    trackDocumentAction({ action: "print", docType: "zarucni_list", result: "error", durationMs, errorMessage: res.error });
    showToast(`JobiDocs: ${formatJobiDocsErrorForUser(res.error)}`, "error");
  }
}

async function quickPrintFromList(
  ticket: TicketEx,
  docType: "ticket" | "diagnostic" | "warranty",
  serviceId: string | null
) {
  if (docType === "ticket") await printTicket(ticket, serviceId);
  else if (docType === "diagnostic") await printDiagnosticProtocol(ticket, serviceId);
  else await printWarranty(ticket, serviceId);
}

/** Otevře náhled a po načtení automaticky spustí tisk (dialog Tisk). */
function openPreviewWindowWithPrint(html: string, title: string = "Náhled") {
  const w = window.open("", "_blank", "noopener,noreferrer,width=900,height=700,scrollbars=yes");
  if (!w) {
    showToast("Povolte v prohlížeči vyskakovací okna pro automatický tisk.", "error");
    return;
  }
  const printScript = "<script>window.onload=function(){setTimeout(function(){window.print();},400);};</script>";
  w.document.write(html + printScript);
  w.document.close();
  w.document.title = title;
}

// Document Action Picker Component (for each document type) – pořadí: Tisk, Export
function DocumentActionPicker({
  label,
  onSelect,
}: {
  label: string;
  onSelect: (action: "print" | "export") => void;
}) {
  const [open, setOpen] = useState(false);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ left: 0, top: 0, width: 0, maxHeight: 300 });

  useLayoutEffect(() => {
    if (open && buttonRef.current) {
      const rect = buttonRef.current.getBoundingClientRect();
      const viewportHeight = window.innerHeight;
      const spaceBelow = viewportHeight - rect.bottom;
      const spaceAbove = rect.top;
      const estimatedMenuHeight = 150;
      const gap = 8;
      const margin = 10;
      const openUp = spaceBelow < estimatedMenuHeight + margin && spaceAbove > spaceBelow;
      const maxHeight = Math.max(100, Math.min(300, openUp ? spaceAbove - gap - margin : spaceBelow - gap - margin));

      setPos({
        left: rect.left,
        top: openUp ? rect.top - estimatedMenuHeight - gap : rect.bottom + gap,
        width: rect.width,
        maxHeight,
      });
    }
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const handleClick = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node) && buttonRef.current && !buttonRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [open]);

  const actions = [
    { value: "print" as const, label: "🖨️ Tisk" },
    { value: "export" as const, label: "💾 Export" },
  ];

  const menu = open ? (
    <div
      ref={menuRef}
      role="listbox"
      style={{
        position: "fixed",
        left: pos.left,
        top: pos.top,
        width: pos.width,
        maxHeight: pos.maxHeight,
        background: "var(--panel)",
        border: "1px solid var(--border)",
        borderRadius: 12,
        boxShadow: "0 10px 25px rgba(0,0,0,0.15)",
        zIndex: 10000,
        overflowY: "auto",
        padding: 4,
      }}
    >
      {actions.map((action) => (
        <button
          key={action.value}
          type="button"
          onClick={() => {
            onSelect(action.value);
            setOpen(false);
          }}
          style={{
            width: "100%",
            padding: "10px 14px",
            textAlign: "left",
            background: "transparent",
            border: "none",
            color: "var(--text)",
            fontSize: 13,
            fontWeight: 500,
            cursor: "pointer",
            borderRadius: 8,
            fontFamily: "system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif",
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.background = "var(--panel-2)";
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.background = "transparent";
          }}
        >
          {action.label}
        </button>
      ))}
    </div>
  ) : null;

  return (
    <div style={{ position: "relative" }}>
      <button
        ref={buttonRef}
        type="button"
        onClick={() => setOpen(!open)}
        style={{
          padding: "10px 14px",
          background: "var(--panel)",
          border: "1px solid var(--border)",
          borderRadius: 10,
          color: "var(--text)",
          fontSize: 13,
          fontWeight: 600,
          cursor: "pointer",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 8,
          minWidth: 140,
          boxShadow: open ? "0 0 0 3px var(--accent-soft)" : "var(--shadow-soft)",
          transition: "var(--transition-smooth)",
        }}
        onMouseEnter={(e) => {
          if (!open) e.currentTarget.style.background = "var(--panel-2)";
        }}
        onMouseLeave={(e) => {
          if (!open) e.currentTarget.style.background = "var(--panel)";
        }}
      >
        <span>{label}</span>
        <span style={{ opacity: 0.65, fontWeight: 900, fontSize: 10 }}>▾</span>
      </button>
      {open ? createPortal(menu, document.body) : null}
    </div>
  );
}

// ========================
// PerformedRepairItem Component
// ========================
function PerformedRepairItem({
  repair,
  onRemove,
  onUpdatePrice,
  onUpdateCosts,
  onUpdateTime,
  onUpdateProducts,
  devicesData,
  inventoryData,
}: {
  repair: PerformedRepair;
  onRemove: (repairId: string) => void;
  onUpdatePrice: (repairId: string, price: number) => void;
  onUpdateCosts: (repairId: string, costs: number) => void;
  onUpdateTime: (repairId: string, estimatedTime: number) => void;
  onUpdateProducts: (repairId: string, productIds: string[]) => void;
  devicesData?: DevicesData;
  inventoryData?: InventoryData;
}) {
  const [isEditing, setIsEditing] = useState(false);
  const [priceValue, setPriceValue] = useState(String(repair.price || 0));
  const [costsValue, setCostsValue] = useState(String(repair.costs || 0));
  const [timeValue, setTimeValue] = useState(String(repair.estimatedTime || 0));
  const [productSearch, setProductSearch] = useState("");
  const [selectedProductIds, setSelectedProductIds] = useState<string[]>(repair.productIds || []);

  useEffect(() => {
    if (!isEditing) {
      setPriceValue(String(repair.price || 0));
      setCostsValue(String(repair.costs || 0));
      setTimeValue(String(repair.estimatedTime || 0));
      setSelectedProductIds(repair.productIds || []);
    }
  }, [repair.price, repair.costs, repair.estimatedTime, repair.productIds, isEditing]);

  // Find repair in catalog by ID or by name
  const catalogRepair = repair.repairId 
    ? devicesData?.repairs.find((r) => r.id === repair.repairId)
    : devicesData?.repairs.find((r) => r.name === repair.name);

  // Get available products for autocomplete
  const availableProducts = inventoryData?.products || [];

  const border = "1px solid var(--border)";

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 8,
        padding: 10,
        borderRadius: 10,
        background: "var(--panel-2)",
        border,
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <div style={{ flex: 1 }}>
          <div style={{ fontWeight: 700, fontSize: 13, color: "var(--text)" }}>{repair.name}</div>
          {repair.type === "selected" && (
            <div style={{ fontSize: 11, color: "var(--muted)", marginTop: 2 }}>Z katalogu</div>
          )}
        </div>
        <div style={{ display: "flex", gap: 6 }}>
          {!isEditing && (
            <button
              onClick={() => setIsEditing(true)}
              style={{
                padding: "6px 10px",
                borderRadius: 8,
                border,
                background: "var(--panel)",
                color: "var(--text)",
                fontWeight: 700,
                cursor: "pointer",
                fontSize: 12,
              }}
            >
              Upravit
            </button>
          )}
          <button
            onClick={() => onRemove(repair.id)}
            style={{
              padding: "6px 10px",
              borderRadius: 8,
              border,
              background: "var(--panel)",
              color: "var(--text)",
              fontWeight: 700,
              cursor: "pointer",
              fontSize: 12,
            }}
          >
            Odstranit
          </button>
        </div>
      </div>
      {isEditing ? (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {/* Price */}
          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            <label style={{ fontSize: 12, color: "var(--muted)" }}>Cena (Kč):</label>
            <input
              type="number"
              value={priceValue}
              onChange={(e) => setPriceValue(e.target.value)}
              style={{
                padding: "8px 10px",
                borderRadius: 6,
                border,
                background: "var(--panel)",
                color: "var(--text)",
                fontSize: 13,
              }}
            />
          </div>

          {/* Costs */}
          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            <label style={{ fontSize: 12, color: "var(--muted)" }}>Náklady (Kč):</label>
            <input
              type="number"
              value={costsValue}
              onChange={(e) => setCostsValue(e.target.value)}
              style={{
                padding: "8px 10px",
                borderRadius: 6,
                border,
                background: "var(--panel)",
                color: "var(--text)",
                fontSize: 13,
              }}
            />
          </div>

          {/* Time */}
          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            <label style={{ fontSize: 12, color: "var(--muted)" }}>Čas (min):</label>
            <input
              type="number"
              value={timeValue}
              onChange={(e) => setTimeValue(e.target.value)}
              style={{
                padding: "8px 10px",
                borderRadius: 6,
                border,
                background: "var(--panel)",
                color: "var(--text)",
                fontSize: 13,
              }}
            />
          </div>

          {/* Products */}
          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            <label style={{ fontSize: 12, color: "var(--muted)" }}>Produkty:</label>
            <div style={{ position: "relative" }}>
              <input
                placeholder="Hledat produkt…"
                value={productSearch}
                onChange={(e) => setProductSearch(e.target.value)}
                style={{
                  padding: "8px 10px",
                  borderRadius: 6,
                  border,
                  background: "var(--panel)",
                  color: "var(--text)",
                  fontSize: 13,
                  width: "100%",
                }}
              />
              {productSearch && (
                <div style={{ position: "absolute", top: "100%", left: 0, right: 0, zIndex: 1000, background: "var(--panel)", border, borderRadius: 8, marginTop: 4, maxHeight: 200, overflowY: "auto" }}>
                  {availableProducts
                    .filter((p) =>
                      p.name.toLowerCase().includes(productSearch.toLowerCase()) &&
                      !selectedProductIds.includes(p.id)
                    )
                    .slice(0, 10)
                    .map((p) => (
                      <div
                        key={p.id}
                        onClick={() => {
                          setSelectedProductIds((prev) => [...prev, p.id]);
                          setProductSearch("");
                        }}
                        style={{
                          padding: "8px 12px",
                          cursor: "pointer",
                          fontSize: 13,
                          borderBottom: border,
                        }}
                        onMouseEnter={(e) => {
                          e.currentTarget.style.background = "var(--accent-soft)";
                        }}
                        onMouseLeave={(e) => {
                          e.currentTarget.style.background = "transparent";
                        }}
                      >
                        <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                          <div style={{ fontWeight: 600 }}>{p.name} {p.sku && `(${p.sku})`}</div>
                          {p.modelIds.length > 0 && (
                            <div style={{ fontSize: 11, color: "var(--muted)" }}>
                              Modely: {p.modelIds.map((mid) => {
                                const model = devicesData?.models.find((m) => m.id === mid);
                                return model?.name;
                              }).filter(Boolean).join(", ")}
                            </div>
                          )}
                        </div>
                      </div>
                    ))}
                </div>
              )}
            </div>
            {selectedProductIds.length > 0 && (
              <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                {selectedProductIds.map((pid) => {
                  const product = availableProducts.find((p) => p.id === pid);
                  if (!product) return null;
                  return (
                    <div
                      key={pid}
                      style={{
                        padding: "4px 10px",
                        background: "var(--accent-soft)",
                        borderRadius: 6,
                        fontSize: 12,
                        display: "flex",
                        alignItems: "center",
                        gap: 6,
                      }}
                    >
                      <span>{product.name}</span>
                      <button
                        onClick={() => {
                          setSelectedProductIds((prev) => prev.filter((id) => id !== pid));
                        }}
                        style={{
                          background: "none",
                          border: "none",
                          color: "var(--accent)",
                          cursor: "pointer",
                          fontSize: 14,
                          padding: 0,
                          width: 16,
                          height: 16,
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "center",
                        }}
                      >
                        ×
                      </button>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Action buttons */}
          <div style={{ display: "flex", gap: 6, marginTop: 4 }}>
            {catalogRepair ? (
              <>
                <button
                  onClick={() => {
                    const price = parseFloat(priceValue) || 0;
                    const costs = parseFloat(costsValue) || 0;
                    const time = parseInt(timeValue) || 0;
                    onUpdatePrice(repair.id, price);
                    onUpdateCosts(repair.id, costs);
                    onUpdateTime(repair.id, time);
                    onUpdateProducts(repair.id, selectedProductIds);
                    setIsEditing(false);
                    showToast("Uloženo", "success");
                  }}
                  style={{
                    padding: "8px 12px",
                    borderRadius: 6,
                    border,
                    background: "var(--panel)",
                    color: "var(--text)",
                    fontWeight: 700,
                    cursor: "pointer",
                    fontSize: 12,
                    flex: 1,
                  }}
                >
                  Uložit pouze pro zakázku
                </button>
                <button
                  onClick={() => {
                    const price = parseFloat(priceValue) || 0;
                    const costs = parseFloat(costsValue) || 0;
                    const time = parseInt(timeValue) || 0;
                    onUpdatePrice(repair.id, price);
                    onUpdateCosts(repair.id, costs);
                    onUpdateTime(repair.id, time);
                    onUpdateProducts(repair.id, selectedProductIds);
                    setIsEditing(false);
                    // Update catalog
                    const currentDevices = safeLoadDevicesData();
                    const updatedDevices = {
                      ...currentDevices,
                      repairs: currentDevices.repairs.map((r) =>
                        r.id === catalogRepair.id
                          ? { ...r, price, costs, estimatedTime: time, productIds: selectedProductIds }
                          : r
                      ),
                    };
                    try {
                      localStorage.setItem(STORAGE_KEYS.DEVICES, JSON.stringify(updatedDevices));
                      showToast("Uloženo do katalogu", "success");
                    } catch (_e) {
                      showToast("Chyba při ukládání", "error");
                    }
                  }}
                  style={{
                    padding: "8px 12px",
                    borderRadius: 6,
                    border: "1px solid var(--accent)",
                    background: "var(--accent-soft)",
                    color: "var(--accent)",
                    fontWeight: 700,
                    cursor: "pointer",
                    fontSize: 12,
                    flex: 1,
                  }}
                >
                  Uložit do katalogu
                </button>
              </>
            ) : (
              <button
                onClick={() => {
                  const price = parseFloat(priceValue) || 0;
                  const costs = parseFloat(costsValue) || 0;
                  const time = parseInt(timeValue) || 0;
                  onUpdatePrice(repair.id, price);
                  onUpdateCosts(repair.id, costs);
                  onUpdateTime(repair.id, time);
                  onUpdateProducts(repair.id, selectedProductIds);
                  setIsEditing(false);
                  showToast("Uloženo", "success");
                }}
                style={{
                  padding: "8px 12px",
                  borderRadius: 6,
                  border: "none",
                  background: "var(--accent)",
                  color: "white",
                  fontWeight: 700,
                  cursor: "pointer",
                  fontSize: 12,
                  flex: 1,
                }}
              >
                Uložit
              </button>
            )}
            <button
              onClick={() => {
                setIsEditing(false);
                setPriceValue(String(repair.price || 0));
                setCostsValue(String(repair.costs || 0));
                setTimeValue(String(repair.estimatedTime || 0));
                setSelectedProductIds(repair.productIds || []);
                setProductSearch("");
              }}
              style={{
                padding: "8px 12px",
                borderRadius: 6,
                border,
                background: "var(--panel)",
                color: "var(--text)",
                fontWeight: 700,
                cursor: "pointer",
                fontSize: 12,
              }}
            >
              Zrušit
            </button>
          </div>
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <span style={{ fontSize: 12, color: "var(--muted)" }}>Cena:</span>
            <span style={{ fontWeight: 700, fontSize: 13, color: "var(--text)" }}>
              {repair.price !== undefined ? `${repair.price} Kč` : "Neuvedeno"}
            </span>
          </div>
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <span style={{ fontSize: 12, color: "var(--muted)" }}>Náklady:</span>
            <span style={{ fontWeight: 700, fontSize: 13, color: "var(--text)" }}>
              {repair.costs !== undefined ? `${repair.costs} Kč` : "Neuvedeno"}
            </span>
          </div>
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <span style={{ fontSize: 12, color: "var(--muted)" }}>Čas:</span>
            <span style={{ fontWeight: 700, fontSize: 13, color: "var(--text)" }}>
              {repair.estimatedTime !== undefined ? `${repair.estimatedTime} min` : "Neuvedeno"}
            </span>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            <span style={{ fontSize: 12, color: "var(--muted)" }}>Produkty:</span>
            {selectedProductIds.length > 0 ? (
              <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                {selectedProductIds.map((pid) => {
                  const product = availableProducts.find((p) => p.id === pid);
                  return product ? (
                    <span key={pid} style={{ fontSize: 12, color: "var(--text)" }}>
                      {product.name}
                    </span>
                  ) : null;
                })}
              </div>
            ) : (
              <span style={{ fontSize: 12, color: "var(--muted)" }}>Neuvedeno</span>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ========================
// PerformedRepairAdder Component
// ========================
function PerformedRepairAdder({
  availableRepairs,
  onAdd,
  deviceLabel,
  devicesData,
  onAddToModel,
}: {
  availableRepairs: DeviceRepair[];
  onAdd: (repair: { name: string; type: "selected" | "manual"; repairId?: string }) => void;
  deviceLabel?: string;
  devicesData?: DevicesData;
  onAddToModel?: (repairData: { name: string; modelId: string; price?: number; costs?: number; estimatedTime?: number; productIds?: string[] }) => void;
}) {
  const [mode, setMode] = useState<"select" | "manual">("select");
  const [selectedRepairId, setSelectedRepairId] = useState<string>("");
  const [manualRepairName, setManualRepairName] = useState("");
  const [manualRepairPrice, setManualRepairPrice] = useState<string>("");
  const [manualRepairCosts, setManualRepairCosts] = useState<string>("");
  const [manualRepairTime, setManualRepairTime] = useState<string>("");
  const [manualRepairProductIds, setManualRepairProductIds] = useState<string[]>([]);
  const [manualRepairProductSearch, setManualRepairProductSearch] = useState<string>("");
  
  // Load inventory data for product selection
  const [inventoryData] = useState<InventoryData>(() => safeLoadInventoryData());
  
  // Find matching model
  const matchingModel = deviceLabel && devicesData ? (() => {
    const deviceName = deviceLabel.toLowerCase();
    const matchingModels = devicesData.models.filter(
      (m) => m && m.name && (m.name.toLowerCase().includes(deviceName) || deviceName.includes(m.name.toLowerCase()))
    );
    return matchingModels.length > 0 ? matchingModels[0] : null;
  })() : null;
  
  // Get available products for matching model
  const availableProducts = matchingModel ? inventoryData.products.filter((p) => p.modelIds.includes(matchingModel.id)) : [];

  const handleAdd = () => {
    if (mode === "select" && selectedRepairId) {
      const repair = availableRepairs.find((r) => r.id === selectedRepairId);
      if (repair) {
        onAdd({ name: repair.name, type: "selected", repairId: repair.id });
        setSelectedRepairId("");
      }
    } else if (mode === "manual" && manualRepairName.trim()) {
      onAdd({ name: manualRepairName.trim(), type: "manual" });
      setManualRepairName("");
    }
  };

  const border = "1px solid var(--border)";

  return (
    <div style={{ display: "grid", gap: 10 }}>
      <div style={{ display: "flex", gap: 8 }}>
        <button
          onClick={() => setMode("select")}
          style={{
            padding: "8px 12px",
            borderRadius: 8,
            border,
            background: mode === "select" ? "var(--accent-soft)" : "var(--panel)",
            color: mode === "select" ? "var(--accent)" : "var(--text)",
            fontWeight: 700,
            fontSize: 12,
            cursor: "pointer",
          }}
        >
          Vybrat z katalogu
        </button>
        <button
          onClick={() => setMode("manual")}
          style={{
            padding: "8px 12px",
            borderRadius: 8,
            border,
            background: mode === "manual" ? "var(--accent-soft)" : "var(--panel)",
            color: mode === "manual" ? "var(--accent)" : "var(--text)",
            fontWeight: 700,
            fontSize: 12,
            cursor: "pointer",
          }}
        >
          Manuálně zadat
        </button>
      </div>

      {mode === "select" && (
        <div style={{ display: "grid", gap: 8 }}>
          {availableRepairs.length > 0 ? (
            <RepairPicker
              value={selectedRepairId}
              repairs={availableRepairs.map((r) => ({ id: r.id, name: r.name, price: r.price || 0 }))}
              placeholder="Vyberte opravu..."
              onChange={(repairId) => {
                setSelectedRepairId(repairId);
                if (repairId) {
                  const repair = availableRepairs.find((r) => r.id === repairId);
                  if (repair) {
                    onAdd({
                      type: "selected",
                      repairId: repair.id,
                      name: repair.name,
                    });
                    setSelectedRepairId("");
                  }
                }
              }}
            />
          ) : (
            <div
              style={{
                padding: 12,
                borderRadius: 10,
                background: "var(--panel-2)",
                color: "var(--muted)",
                fontSize: 12,
                textAlign: "center",
              }}
            >
              Pro toto zařízení nejsou v katalogu žádné opravy. Použijte manuální zadání.
            </div>
          )}
        </div>
      )}

      {mode === "manual" && (
        <div style={{ display: "grid", gap: 8 }}>
        <input
          type="text"
          value={manualRepairName}
          onChange={(e) => setManualRepairName(e.target.value)}
          placeholder="Napište název opravy..."
          style={{
            padding: "10px 12px",
            borderRadius: 10,
            border,
            background: "var(--panel)",
            color: "var(--text)",
            fontSize: 13,
            fontFamily: "inherit",
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter" && manualRepairName.trim()) {
              handleAdd();
            }
          }}
        />
          {matchingModel && onAddToModel && (
            <>
              <div style={{ 
                padding: 12, 
                borderRadius: 10, 
                background: "var(--accent-soft)", 
                border: "1px solid var(--accent)",
                fontSize: 12,
                color: "var(--accent)",
                fontWeight: 600,
              }}>
                Přidat opravu k modelu "{matchingModel.name}"
              </div>
              <div style={{ display: "grid", gap: 8 }}>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                  <input
                    type="number"
                    value={manualRepairPrice}
                    onChange={(e) => setManualRepairPrice(e.target.value)}
                    placeholder="Cena (Kč)"
                    style={{
                      padding: "10px 12px",
                      borderRadius: 10,
                      border,
                      background: "var(--panel)",
                      color: "var(--text)",
                      fontSize: 13,
                      fontFamily: "inherit",
                    }}
                  />
                  <input
                    type="number"
                    value={manualRepairTime}
                    onChange={(e) => setManualRepairTime(e.target.value)}
                    placeholder="Čas (min)"
                    style={{
                      padding: "10px 12px",
                      borderRadius: 10,
                      border,
                      background: "var(--panel)",
                      color: "var(--text)",
                      fontSize: 13,
                      fontFamily: "inherit",
                    }}
                  />
                </div>
                <input
                  type="number"
                  value={manualRepairCosts}
                  onChange={(e) => setManualRepairCosts(e.target.value)}
                  placeholder="Náklady (Kč, volitelné)"
                  style={{
                    padding: "10px 12px",
                    borderRadius: 10,
                    border,
                    background: "var(--panel)",
                    color: "var(--text)",
                    fontSize: 13,
                    fontFamily: "inherit",
                  }}
                />
                <div>
                  <label style={{ fontSize: 12, color: "var(--muted)", marginBottom: 4, display: "block" }}>
                    Produkty (samodoplnovací výběr, volitelné)
                  </label>
                  <div style={{ position: "relative" }}>
                    <input
                      placeholder="Hledat produkt…"
                      value={manualRepairProductSearch}
                      onChange={(e) => setManualRepairProductSearch(e.target.value)}
                      style={{
                        padding: "10px 12px",
                        borderRadius: 10,
                        border,
                        background: "var(--panel)",
                        color: "var(--text)",
                        fontSize: 13,
                        fontFamily: "inherit",
                        width: "100%",
                      }}
                    />
                    {manualRepairProductSearch && (
                      <div style={{ position: "absolute", top: "100%", left: 0, right: 0, zIndex: 1000, background: "var(--panel)", border, borderRadius: 8, marginTop: 4, maxHeight: 200, overflowY: "auto" }}>
                        {availableProducts
                          .filter((p) =>
                            p.name.toLowerCase().includes(manualRepairProductSearch.toLowerCase()) &&
                            !manualRepairProductIds.includes(p.id)
                          )
                          .slice(0, 10)
                          .map((p) => (
                            <div
                              key={p.id}
                              onClick={() => {
                                setManualRepairProductIds((prev) => [...prev, p.id]);
                                setManualRepairProductSearch("");
                              }}
                              style={{
                                padding: "8px 12px",
                                cursor: "pointer",
                                fontSize: 13,
                                borderBottom: border,
                              }}
                              onMouseEnter={(e) => {
                                e.currentTarget.style.background = "var(--accent-soft)";
                              }}
                              onMouseLeave={(e) => {
                                e.currentTarget.style.background = "transparent";
                              }}
                            >
                              <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                                <div style={{ fontWeight: 600 }}>{p.name} {p.sku && `(${p.sku})`}</div>
                                {p.modelIds.length > 0 && (
                                  <div style={{ fontSize: 11, color: "var(--muted)" }}>
                                    Modely: {p.modelIds.map((mid) => {
                                      const model = devicesData?.models.find((m) => m.id === mid);
                                      return model?.name;
                                    }).filter(Boolean).join(", ")}
                                  </div>
                                )}
                              </div>
                            </div>
                          ))}
                      </div>
                    )}
                  </div>
                  {manualRepairProductIds.length > 0 && (
                    <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 8 }}>
                      {manualRepairProductIds.map((pid) => {
                        const product = availableProducts.find((p) => p.id === pid);
                        if (!product) return null;
                        return (
                          <div
                            key={pid}
                            style={{
                              padding: "4px 10px",
                              background: "var(--accent-soft)",
                              borderRadius: 6,
                              fontSize: 12,
                              display: "flex",
                              alignItems: "center",
                              gap: 6,
                            }}
                          >
                            <span>{product.name}</span>
                            <button
                              onClick={() => {
                                setManualRepairProductIds((prev) => prev.filter((id) => id !== pid));
                              }}
                              style={{
                                background: "none",
                                border: "none",
                                color: "var(--accent)",
                                cursor: "pointer",
                                fontSize: 14,
                                padding: 0,
                                width: 16,
                                height: 16,
                                display: "flex",
                                alignItems: "center",
                                justifyContent: "center",
                              }}
                            >
                              ×
                            </button>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
                <button
                  onClick={() => {
                    if (manualRepairName.trim() && matchingModel) {
                      onAddToModel({
                        name: manualRepairName.trim(),
                        modelId: matchingModel.id,
                        price: manualRepairPrice ? parseFloat(manualRepairPrice) : undefined,
                        costs: manualRepairCosts ? parseFloat(manualRepairCosts) : undefined,
                        estimatedTime: manualRepairTime ? parseInt(manualRepairTime) : undefined,
                        productIds: manualRepairProductIds.length > 0 ? manualRepairProductIds : undefined,
                      });
                      setManualRepairName("");
                      setManualRepairPrice("");
                      setManualRepairCosts("");
                      setManualRepairTime("");
                      setManualRepairProductIds([]);
                      setManualRepairProductSearch("");
                    }
                  }}
                  disabled={!manualRepairName.trim()}
                  style={{
                    padding: "10px 12px",
                    borderRadius: 10,
                    border: "1px solid var(--accent)",
                    background: manualRepairName.trim() ? "var(--accent)" : "var(--panel-2)",
                    color: manualRepairName.trim() ? "white" : "var(--muted)",
                    fontWeight: 700,
                    fontSize: 12,
                    cursor: manualRepairName.trim() ? "pointer" : "not-allowed",
                  }}
                >
                  Přidat opravu k modelu "{matchingModel.name}"
                </button>
              </div>
            </>
          )}
        </div>
      )}

      <button
        onClick={handleAdd}
        disabled={(mode === "select" && !selectedRepairId) || (mode === "manual" && !manualRepairName.trim())}
        style={{
          padding: "10px 14px",
          borderRadius: 10,
          border,
          background:
            (mode === "select" && selectedRepairId) || (mode === "manual" && manualRepairName.trim())
              ? "var(--accent)"
              : "var(--panel-2)",
          color:
            (mode === "select" && selectedRepairId) || (mode === "manual" && manualRepairName.trim())
              ? "white"
              : "var(--muted)",
          fontWeight: 700,
          fontSize: 13,
          cursor:
            (mode === "select" && selectedRepairId) || (mode === "manual" && manualRepairName.trim())
              ? "pointer"
              : "not-allowed",
        }}
      >
        Přidat opravu
      </button>
    </div>
  );
}

// Device Autocomplete
type DeviceAutocompleteProps = {
  value: string;
  onChange: (value: string) => void;
  models: Array<{
    id: string;
    name: string;
    fullName: string;
    brandName: string;
    categoryName: string;
  }>;
  error?: boolean;
};

function DeviceAutocomplete({ value, onChange, models, error }: DeviceAutocompleteProps) {
  const [open, setOpen] = useState(false);
  const [focusedIndex, setFocusedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ left: 0, top: 0, width: 0, maxHeight: 300 });

  const filteredModels = useMemo(() => {
    if (!value.trim()) return models.slice(0, 10);
    const query = value.toLowerCase();
    return models
      .filter(
        (m) =>
          m.fullName.toLowerCase().includes(query) ||
          m.name.toLowerCase().includes(query) ||
          m.brandName.toLowerCase().includes(query) ||
          m.categoryName.toLowerCase().includes(query)
      )
      .slice(0, 10);
  }, [value, models]);

  useLayoutEffect(() => {
    if (open && inputRef.current) {
      const rect = inputRef.current.getBoundingClientRect();
      const viewportHeight = window.innerHeight;
      const spaceBelow = viewportHeight - rect.bottom;
      const spaceAbove = rect.top;
      const estimatedMenuHeight = Math.min(300, filteredModels.length * 50 + 20);
      const gap = 8;
      const margin = 10;
      const openUp = spaceBelow < estimatedMenuHeight + margin && spaceAbove > spaceBelow;
      const maxHeight = Math.max(100, Math.min(300, openUp ? spaceAbove - gap - margin : spaceBelow - gap - margin));
      const actualMenuHeight = Math.min(maxHeight, estimatedMenuHeight);

      setPos({
        left: rect.left,
        top: openUp ? rect.top - actualMenuHeight - gap : rect.bottom + gap,
        width: rect.width,
        maxHeight,
      });
    }
  }, [open, filteredModels.length]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (
        menuRef.current &&
        !menuRef.current.contains(e.target as Node) &&
        inputRef.current &&
        !inputRef.current.contains(e.target as Node)
      ) {
        setOpen(false);
      }
    };
    window.addEventListener("mousedown", onDown);
    return () => window.removeEventListener("mousedown", onDown);
  }, [open]);

  const border = "1px solid var(--border)";
  const borderError = "1px solid rgba(239,68,68,0.9)";

  return (
    <div style={{ position: "relative" }}>
      <input
        ref={inputRef}
        type="text"
        value={value}
        onChange={(e) => {
          onChange(e.target.value);
          setOpen(true);
          setFocusedIndex(0);
        }}
        onFocus={() => setOpen(true)}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown") {
            e.preventDefault();
            setFocusedIndex((prev) => Math.min(prev + 1, filteredModels.length - 1));
            setOpen(true);
          } else if (e.key === "ArrowUp") {
            e.preventDefault();
            setFocusedIndex((prev) => Math.max(prev - 1, 0));
            setOpen(true);
          } else if (e.key === "Enter" && filteredModels[focusedIndex]) {
            e.preventDefault();
            onChange(filteredModels[focusedIndex].fullName);
            setOpen(false);
            inputRef.current?.blur();
          } else if (e.key === "Escape") {
            setOpen(false);
            inputRef.current?.blur();
          }
        }}
        placeholder="Název nebo typ zařízení…"
        style={{
          width: "100%",
          padding: "10px 12px",
          borderRadius: 12,
          border: error ? borderError : border,
          outline: "none",
          background: "var(--panel)",
          color: "var(--text)",
          fontFamily: "system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif",
        }}
      />

      {open &&
        filteredModels.length > 0 &&
        createPortal(
          <div
            ref={menuRef}
            role="listbox"
            style={{
              position: "fixed",
              left: pos.left,
              top: pos.top,
              width: pos.width,
              borderRadius: 14,
              border: "1px solid var(--border)",
              background: "var(--panel)",
              backdropFilter: "var(--blur)",
              WebkitBackdropFilter: "var(--blur)",
              boxShadow: "0 25px 60px rgba(0,0,0,0.22)",
              padding: 6,
              zIndex: 10000,
              maxHeight: pos.maxHeight,
              overflowY: "auto",
            }}
          >
            {filteredModels.map((model, idx) => {
              const isFocused = idx === focusedIndex;
              const isSelected = value === model.fullName;

              return (
                <button
                  key={model.id}
                  type="button"
                  onClick={() => {
                    onChange(model.fullName);
                    setOpen(false);
                    inputRef.current?.blur();
                  }}
                  onMouseEnter={() => setFocusedIndex(idx)}
                  style={{
                    width: "100%",
                    textAlign: "left",
                    padding: "10px 12px",
                    borderRadius: 10,
                    border: "none",
                    background: isFocused || isSelected ? "var(--panel-2)" : "transparent",
                    cursor: "pointer",
                    color: "var(--text)",
                    fontFamily: "system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif",
                    fontSize: 13,
                  }}
                >
                  <div style={{ fontWeight: isSelected ? 700 : 500 }}>{model.fullName}</div>
                </button>
              );
            })}
          </div>,
          document.body
        )}
    </div>
  );
}

// ========================
// Repair Picker (custom dropdown)
// ========================
type RepairPickerProps = {
  value: string;
  repairs: Array<{ id: string; name: string; price: number }>;
  placeholder?: string;
  onChange: (repairId: string) => void;
};

function RepairPicker({ value, repairs, placeholder = "Vyberte opravu...", onChange }: RepairPickerProps) {
  const [open, setOpen] = useState(false);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ left: 0, top: 0, width: 0, maxHeight: 300 });

  const selected = repairs.find((r) => r.id === value);

  useLayoutEffect(() => {
    if (open && buttonRef.current) {
      const rect = buttonRef.current.getBoundingClientRect();
      const viewportHeight = window.innerHeight;
      const spaceBelow = viewportHeight - rect.bottom;
      const spaceAbove = rect.top;

      const estimatedMenuHeight = Math.min(300, repairs.length * 50 + 20);
      const gap = 8;
      const margin = 10;

      const openUp = spaceBelow < estimatedMenuHeight + margin && spaceAbove > spaceBelow;

      const maxHeight = Math.max(100, Math.min(400, openUp ? spaceAbove - gap - margin : spaceBelow - gap - margin));

      setPos({
        left: rect.left,
        top: openUp ? rect.top - maxHeight - gap : rect.bottom + gap,
        width: rect.width,
        maxHeight,
      });
    }
  }, [open, repairs.length]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (
        menuRef.current &&
        !menuRef.current.contains(e.target as Node) &&
        buttonRef.current &&
        !buttonRef.current.contains(e.target as Node)
      ) {
        setOpen(false);
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("mousedown", onDown);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("mousedown", onDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const menu = open ? (
    <div
      ref={menuRef}
      role="listbox"
      style={{
        position: "fixed",
        left: pos.left,
        top: pos.top,
        width: pos.width,
        borderRadius: 14,
        border: "1px solid var(--border)",
        background: "var(--panel)",
        backdropFilter: "var(--blur)",
        WebkitBackdropFilter: "var(--blur)",
        boxShadow: "0 25px 60px rgba(0,0,0,0.22)",
        padding: 6,
        zIndex: 10000,
        maxHeight: pos.maxHeight,
        overflowY: "auto",
      }}
    >
      {repairs.length === 0 ? (
        <div style={{ padding: "12px 14px", color: "var(--muted)", fontSize: 13, textAlign: "center" }}>
          Žádné opravy k dispozici
        </div>
      ) : (
        repairs.map((repair) => {
          const active = repair.id === value;
          return (
            <button
              key={repair.id}
              type="button"
              onClick={() => {
                onChange(repair.id);
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
              <span>{repair.name}</span>
              {repair.price > 0 && (
                <span style={{ fontSize: 12, opacity: 0.7, marginLeft: "auto" }}>
                  {repair.price} Kč
                </span>
              )}
              {active && <span style={{ marginLeft: 8, fontSize: 16, opacity: 0.8 }}>✓</span>}
            </button>
          );
        })
      )}
    </div>
  ) : null;

  const border = "1px solid var(--border)";

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        onClick={() => setOpen(!open)}
        style={{
          width: "100%",
          padding: "12px 40px 12px 14px",
          borderRadius: 12,
          border: open ? "1px solid var(--accent)" : border,
          outline: "none",
          background: open ? "var(--panel-2)" : "var(--panel)",
          backdropFilter: "var(--blur)",
          WebkitBackdropFilter: "var(--blur)",
          color: selected ? "var(--text)" : "var(--muted)",
          fontFamily: "system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif",
          fontWeight: 500,
          fontSize: 14,
          cursor: "pointer",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          boxShadow: open ? "0 0 0 3px var(--accent-soft)" : "var(--shadow-soft)",
          transition: "var(--transition-smooth)",
        }}
        onMouseEnter={(e) => {
          if (!open) e.currentTarget.style.borderColor = "var(--accent)";
          if (!open) e.currentTarget.style.boxShadow = "0 4px 16px var(--accent-glow)";
        }}
        onMouseLeave={(e) => {
          if (!open) e.currentTarget.style.borderColor = "var(--border)";
          if (!open) e.currentTarget.style.boxShadow = "var(--shadow-soft)";
        }}
      >
        <span>{selected ? selected.name : placeholder}</span>
        <span style={{ opacity: 0.65, fontWeight: 900, fontSize: 12 }}>▾</span>
      </button>
      {open ? createPortal(menu, document.body) : null}
    </>
  );
}

// ========================
// Handoff method select (modern dropdown)
// ========================
type HandoffMethodSelectProps = {
  options: string[];
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  extraOption?: string;
  triggerStyle?: React.CSSProperties;
};

function HandoffMethodSelect({ options, value, onChange, placeholder = "—", extraOption, triggerStyle }: HandoffMethodSelectProps) {
  const [open, setOpen] = useState(false);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ left: 0, top: 0, width: 0, maxHeight: 280 });

  const displayValue = value || placeholder;
  const listOptions = [
    ...(extraOption && !options.includes(extraOption) ? [extraOption] : []),
    ...options,
  ];

  useLayoutEffect(() => {
    if (open && buttonRef.current) {
      const rect = buttonRef.current.getBoundingClientRect();
      const viewportHeight = window.innerHeight;
      const spaceBelow = viewportHeight - rect.bottom;
      const spaceAbove = rect.top;
      const estimatedHeight = Math.min(280, listOptions.length * 48 + 24);
      const gap = 8;
      const margin = 10;
      const openUp = spaceBelow < estimatedHeight + margin && spaceAbove > spaceBelow;
      const maxHeight = Math.max(120, Math.min(280, openUp ? spaceAbove - gap - margin : spaceBelow - gap - margin));
      setPos({
        left: rect.left,
        top: openUp ? rect.top - maxHeight - gap : rect.bottom + gap,
        width: rect.width,
        maxHeight,
      });
    }
  }, [open, listOptions.length]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node) && buttonRef.current && !buttonRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("mousedown", onDown);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("mousedown", onDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const border = "1px solid var(--border)";
  const menu = open ? (
    <div
      ref={menuRef}
      role="listbox"
      style={{
        position: "fixed",
        left: pos.left,
        top: pos.top,
        width: pos.width,
        borderRadius: 14,
        border: "1px solid var(--border)",
        background: "var(--panel)",
        backdropFilter: "var(--blur)",
        WebkitBackdropFilter: "var(--blur)",
        boxShadow: "0 16px 48px rgba(0,0,0,0.18)",
        padding: 6,
        zIndex: 10000,
        maxHeight: pos.maxHeight,
        overflowY: "auto",
      }}
    >
      <button
        type="button"
        onClick={() => { onChange(""); setOpen(false); }}
        style={{
          width: "100%",
          textAlign: "left",
          padding: "12px 14px",
          borderRadius: 10,
          border: "none",
          background: !value ? "var(--accent-soft)" : "transparent",
          color: !value ? "var(--accent)" : "var(--text)",
          fontWeight: !value ? 600 : 500,
          fontSize: 13,
          cursor: "pointer",
          fontFamily: "inherit",
          transition: "var(--transition-smooth)",
        }}
        onMouseEnter={(e) => { if (value) e.currentTarget.style.background = "var(--panel-2)"; }}
        onMouseLeave={(e) => { if (value) e.currentTarget.style.background = "transparent"; }}
      >
        {placeholder}
      </button>
      {listOptions.map((opt, i) => {
        const active = opt === value;
        return (
          <button
            key={i}
            type="button"
            onClick={() => { onChange(opt); setOpen(false); }}
            style={{
              width: "100%",
              textAlign: "left",
              padding: "12px 14px",
              borderRadius: 10,
              border: "none",
              background: active ? "var(--accent-soft)" : "transparent",
              color: active ? "var(--accent)" : "var(--text)",
              fontWeight: active ? 600 : 500,
              fontSize: 13,
              cursor: "pointer",
              fontFamily: "inherit",
              transition: "var(--transition-smooth)",
            }}
            onMouseEnter={(e) => { if (!active) e.currentTarget.style.background = "var(--panel-2)"; }}
            onMouseLeave={(e) => { if (!active) e.currentTarget.style.background = "transparent"; }}
          >
            {opt}
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
          ...triggerStyle,
          width: "100%",
          padding: "10px 36px 10px 12px",
          borderRadius: 12,
          border: open ? "1px solid var(--accent)" : border,
          outline: "none",
          background: open ? "var(--panel-2)" : "var(--panel)",
          backdropFilter: "var(--blur)",
          WebkitBackdropFilter: "var(--blur)",
          color: "var(--text)",
          fontFamily: "system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif",
          fontSize: 13,
          cursor: "pointer",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          boxShadow: open ? "0 0 0 3px var(--accent-soft)" : "var(--shadow-soft)",
          transition: "var(--transition-smooth)",
        }}
        onMouseEnter={(e) => {
          if (!open) { e.currentTarget.style.borderColor = "var(--accent)"; e.currentTarget.style.boxShadow = "0 4px 12px rgba(0,0,0,0.08)"; }
        }}
        onMouseLeave={(e) => {
          if (!open) { e.currentTarget.style.borderColor = ""; e.currentTarget.style.boxShadow = ""; }
        }}
      >
        <span style={{ color: value ? "var(--text)" : "var(--muted)" }}>{displayValue}</span>
        <span style={{ opacity: 0.6, fontSize: 10, marginLeft: 8 }}>▾</span>
      </button>
      {open ? createPortal(menu, document.body) : null}
    </>
  );
}

// ========================
// Discount Picker (custom dropdown)
// ========================
type DiscountPickerProps = {
  discountType: "percentage" | "amount" | null;
  discountValue: number;
  onChange: (type: "percentage" | "amount" | null, value: number) => void;
};

function DiscountPicker({ discountType, discountValue, onChange }: DiscountPickerProps) {
  const [open, setOpen] = useState(false);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ left: 0, top: 0, width: 0, maxHeight: 300 });
  const [inputValue, setInputValue] = useState(String(discountValue || ""));

  useEffect(() => {
    setInputValue(String(discountValue || ""));
  }, [discountValue]);

  const options: Array<{ value: "percentage" | "amount" | null; label: string }> = [
    { value: null, label: "Bez slevy" },
    { value: "percentage", label: "Sleva %" },
    { value: "amount", label: "Sleva (Kč)" },
  ];

  const selected = options.find((o) => o.value === discountType) ?? options[0];

  useLayoutEffect(() => {
    if (open && buttonRef.current) {
      const rect = buttonRef.current.getBoundingClientRect();
      const viewportHeight = window.innerHeight;
      const spaceBelow = viewportHeight - rect.bottom;
      const spaceAbove = rect.top;

      const estimatedMenuHeight = 150;
      const gap = 8;
      const margin = 10;

      const openUp = spaceBelow < estimatedMenuHeight + margin && spaceAbove > spaceBelow;

      const maxHeight = Math.max(100, Math.min(300, openUp ? spaceAbove - gap - margin : spaceBelow - gap - margin));

      setPos({
        left: rect.left,
        top: openUp ? rect.top - maxHeight - gap : rect.bottom + gap,
        width: rect.width,
        maxHeight,
      });
    }
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (
        menuRef.current &&
        !menuRef.current.contains(e.target as Node) &&
        buttonRef.current &&
        !buttonRef.current.contains(e.target as Node)
      ) {
        setOpen(false);
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("mousedown", onDown);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("mousedown", onDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const handleOptionSelect = (type: "percentage" | "amount" | null) => {
    onChange(type, type ? discountValue : 0);
    setOpen(false);
  };

  const handleInputChange = (value: string) => {
    setInputValue(value);
    const numValue = parseFloat(value) || 0;
    onChange(discountType, numValue);
  };

  const menu = open ? (
    <div
      ref={menuRef}
      role="listbox"
      style={{
        position: "fixed",
        left: pos.left,
        top: pos.top,
        width: pos.width,
        borderRadius: 14,
        border: "1px solid var(--border)",
        background: "var(--panel)",
        backdropFilter: "var(--blur)",
        WebkitBackdropFilter: "var(--blur)",
        boxShadow: "0 25px 60px rgba(0,0,0,0.22)",
        padding: 6,
        zIndex: 10000,
        maxHeight: pos.maxHeight,
        overflowY: "auto",
      }}
    >
      {options.map((opt) => {
        const active = opt.value === discountType;
        return (
          <button
            key={opt.value ?? "none"}
            type="button"
            onClick={() => handleOptionSelect(opt.value)}
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

  const border = "1px solid var(--border)";

  return (
    <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
      <div style={{ position: "relative", flex: discountType ? "0 0 auto" : "1 1 auto" }}>
        <button
          ref={buttonRef}
          type="button"
          onClick={() => setOpen(!open)}
          style={{
            padding: "6px 10px",
            minWidth: 120,
            borderRadius: 6,
            border: open ? "1px solid var(--accent)" : border,
            outline: "none",
            background: open ? "var(--panel-2)" : "var(--panel)",
            backdropFilter: "var(--blur)",
            WebkitBackdropFilter: "var(--blur)",
            color: "var(--text)",
            fontFamily: "system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif",
            fontWeight: 500,
            fontSize: 12,
            cursor: "pointer",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 8,
            boxShadow: open ? "0 0 0 3px var(--accent-soft)" : "var(--shadow-soft)",
            transition: "var(--transition-smooth)",
          }}
          onMouseEnter={(e) => {
            if (!open) e.currentTarget.style.borderColor = "var(--accent)";
          }}
          onMouseLeave={(e) => {
            if (!open) e.currentTarget.style.borderColor = "var(--border)";
          }}
        >
          <span>{selected.label}</span>
          <span style={{ opacity: 0.65, fontWeight: 900, fontSize: 10 }}>▾</span>
        </button>
        {open ? createPortal(menu, document.body) : null}
      </div>

      {discountType && (
        <input
          type="number"
          value={inputValue}
          onChange={(e) => handleInputChange(e.target.value)}
          placeholder={discountType === "percentage" ? "%" : "Kč"}
          style={{
            padding: "6px 10px",
            borderRadius: 6,
            border: border,
            background: "var(--panel)",
            color: "var(--text)",
            fontSize: 12,
            width: 80,
            outline: "none",
            fontFamily: "system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif",
          }}
          onFocus={(e) => {
            e.currentTarget.style.borderColor = "var(--accent)";
            e.currentTarget.style.boxShadow = "0 0 0 3px var(--accent-soft)";
          }}
          onBlur={(e) => {
            e.currentTarget.style.borderColor = "var(--border)";
            e.currentTarget.style.boxShadow = "none";
          }}
        />
      )}
    </div>
  );
}

// ========================
// Modern Status Picker (PORTAL)
// ========================
type StatusPickerProps = {
  value: string;
  statuses: StatusMeta[];
  getByKey: (k: string) => StatusMeta | undefined;
  onChange: (k: string) => void;
  size?: "sm" | "md";
};

function StatusPicker({ value, statuses, getByKey, onChange, size = "md" }: StatusPickerProps) {
  const [open, setOpen] = useState(false);

  const wrapRef = useRef<HTMLDivElement | null>(null);
  const btnRef = useRef<HTMLButtonElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);

  const current = getByKey(value);

  const [pos, setPos] = useState<{
    top: number;
    left: number;
    width: number;
    maxHeight: number;
    openUp: boolean;
  }>({
    top: 0,
    left: 0,
    width: 320,
    maxHeight: 420,
    openUp: false,
  });

  const padY = size === "sm" ? 8 : 10;
  const padX = size === "sm" ? 10 : 12;
  const fontSize = size === "sm" ? 12 : 13;

  const recompute = () => {
    const btn = btnRef.current;
    if (!btn) return;

    const r = btn.getBoundingClientRect();
    const w = 320;

    const margin = 10;
    const gap = 8;

    let left = r.right - w;
    left = Math.max(margin, Math.min(left, window.innerWidth - w - margin));

    const spaceBelow = window.innerHeight - r.bottom - margin;
    const spaceAbove = r.top - margin;

    const wantHeight = 420;
    const openUp = spaceBelow < Math.min(220, wantHeight) && spaceAbove > spaceBelow;

    const maxHeight = Math.max(160, Math.min(wantHeight, openUp ? spaceAbove - gap : spaceBelow - gap));

    const top = openUp ? Math.max(margin, r.top - gap - maxHeight) : r.bottom + gap;

    setPos({ top, left, width: w, maxHeight, openUp });
  };

  useLayoutEffect(() => {
    if (!open) return;
    recompute();
     
  }, [open, value, size]);

  useEffect(() => {
    if (!open) return;

    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      const wrap = wrapRef.current;
      const menu = menuRef.current;

      if (wrap?.contains(t)) return;
      if (menu?.contains(t)) return;

      setOpen(false);
    };

    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };

    const onScroll = () => recompute();
    const onResize = () => recompute();

    window.addEventListener("mousedown", onDown);
    window.addEventListener("keydown", onKey);
    window.addEventListener("scroll", onScroll, true);
    window.addEventListener("resize", onResize);

    return () => {
      window.removeEventListener("mousedown", onDown);
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("resize", onResize);
    };
     
  }, [open]);

  const menu = open ? (
    <div
      ref={menuRef}
      role="listbox"
      style={{
        position: "fixed",
        left: pos.left,
        top: pos.top,
        width: pos.width,
        borderRadius: 14,
        border: "1px solid var(--border)",
        background: "var(--panel)",
        boxShadow: "0 25px 60px rgba(0,0,0,0.22)",
        padding: 6,
        zIndex: 10000,
        maxHeight: pos.maxHeight,
        overflowY: "auto",
      }}
    >
      {statuses.map((s) => {
        const active = s.key === value;
        const rowBg = active ? "var(--panel-2)" : "transparent";

        return (
          <button
            key={s.key}
            type="button"
            onClick={() => {
              onChange(s.key);
              setOpen(false);
            }}
            style={{
              width: "100%",
              textAlign: "left",
              display: "flex",
              alignItems: "center",
              gap: 10,
              padding: "10px 10px",
              borderRadius: 12,
              border: "none",
              background: rowBg,
              cursor: "pointer",
              color: "var(--text)",
              fontFamily: "system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif",
            }}
          >
            <span
              style={{
                width: 4,
                height: 26,
                borderRadius: 999,
                background: s.bg ?? "rgba(0,0,0,0.12)",
                boxShadow: s.bg ? `0 0 8px ${s.bg}40` : "none",
              }}
            />
            <span
              style={{
                width: 12,
                height: 12,
                borderRadius: 999,
                background: s.bg ?? "rgba(0,0,0,0.12)",
                boxShadow: s.bg ? `0 2px 8px ${s.bg}30` : "none",
                border: `1px solid ${s.bg ? `${s.bg}60` : "transparent"}`,
              }}
            />

            <div style={{ minWidth: 0, flex: 1 }}>
              <div style={{ fontWeight: 950, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                {s.label}
              </div>
            </div>

            {active && <div style={{ fontSize: 12, fontWeight: 950, opacity: 0.8 }}>✓</div>}
          </button>
        );
      })}
    </div>
  ) : null;

  return (
    <div ref={wrapRef} style={{ position: "relative", display: "inline-flex" }}>
      <button
        ref={btnRef}
        type="button"
        onClick={() => setOpen((v) => !v)}
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: 10,
          padding: `${padY}px ${padX}px`,
          borderRadius: 12,
          border: "1px solid var(--border)",
          background: "var(--panel)",
          color: "var(--text)",
          fontWeight: 900,
          fontSize,
          cursor: "pointer",
          fontFamily: "system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif",
          boxShadow: "0 10px 25px rgba(0,0,0,0.06)",
          transition: "transform 120ms ease, box-shadow 160ms ease",
          userSelect: "none",
          whiteSpace: "nowrap",
        }}
        onMouseEnter={(e) => {
          e.currentTarget.style.transform = "translateY(-1px)";
          e.currentTarget.style.boxShadow = "0 16px 34px rgba(0,0,0,0.10)";
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.transform = "translateY(0)";
          e.currentTarget.style.boxShadow = "0 10px 25px rgba(0,0,0,0.06)";
        }}
        aria-haspopup="listbox"
        aria-expanded={open}
        title="Změnit stav"
      >
        <span
          style={{
            width: 12,
            height: 12,
            borderRadius: 999,
            background: current?.bg ?? "rgba(0,0,0,0.15)",
            boxShadow: current?.bg
              ? `0 0 0 2px ${current.bg}40, 0 2px 8px ${current.bg}30`
              : "0 0 0 3px rgba(0,0,0,0.06)",
            flex: "0 0 auto",
            border: `1px solid ${current?.bg ? `${current.bg}60` : "transparent"}`,
          }}
        />
        <span style={{ maxWidth: 200, overflow: "hidden", textOverflow: "ellipsis" }}>{current?.label ?? "Status"}</span>
        <span style={{ opacity: 0.65, fontWeight: 900, marginLeft: 2 }}>▾</span>
      </button>

      {open ? createPortal(menu, document.body) : null}
    </div>
  );
}

// ========================
// Page
// ========================
type ModelWithHierarchy = DeviceModel & {
  fullName: string;
  brandName: string;
  categoryName: string;
};

export default function Orders({
  activeServiceId,
  newOrderPrefill,
  onNewOrderPrefillConsumed,
  openTicketIntent,
  onOpenTicketIntentConsumed,
  smsPanelTicketIdRef,
  openClaimIntent,
  onOpenClaimIntentConsumed,
  onOpenCustomer,
  onReturnToPage,
  onCreateInvoice,
  onOpenInvoice,
  closeDetailWhen,
}: OrdersProps) {
  const { statuses, loading: statusesLoading, error: statusesError, getByKey, isFinal, fallbackKey } = useStatuses();
  const { session } = useAuth();
  const { profile: userProfile } = useUserProfile();
  const { hasCapability } = useActiveRole(activeServiceId);
  const canPrintExport = hasCapability("can_print_export");

  const [uiCfg, setUiCfg] = useState<UIConfig>(() => safeLoadUIConfig());
  const [cloudTickets, setCloudTickets] = useState<TicketEx[]>([]);
  const [ticketsLoading, setTicketsLoading] = useState(false);
  const [ticketsError, setTicketsError] = useState<string | null>(null);
  const [cloudClaims, setCloudClaims] = useState<WarrantyClaimRow[]>([]);
  const [claimsLoading, setClaimsLoading] = useState(false);
  const [claimsError, setClaimsError] = useState<string | null>(null);
  
  const [, setDocumentsConfig] = useState<any>(() => safeLoadDocumentsConfig());
  
  // Refs for race condition protection
  const ticketsReqIdRef = useRef(0);
  const claimsReqIdRef = useRef(0);
  const docsReqIdRef = useRef(0);
  const activeServiceIdRef = useRef<string | null>(activeServiceId);
  
  // Keep activeServiceIdRef in sync
  useEffect(() => {
    activeServiceIdRef.current = activeServiceId;
  }, [activeServiceId]);
  
  // Load documents config from DB when activeServiceId changes
  useEffect(() => {
    if (!activeServiceId || !supabase) {
      return;
    }
    
    const myReqId = ++docsReqIdRef.current;
    
    const loadConfig = async () => {
      const dbConfig = await loadDocumentsConfigFromDB(activeServiceId);
      
      // Check if this request is still valid
      if (myReqId !== docsReqIdRef.current) {
        return; // This request is stale, ignore it
      }
      
      if (dbConfig) {
        setDocumentsConfig(dbConfig);
      }
    };
    
    loadConfig().catch((err) => {
      console.error("[Orders] Error loading documents config:", err);
    });
    
    return () => {
      docsReqIdRef.current++;
    };
  }, [activeServiceId]);

  // Realtime subscription for service_document_settings
  useEffect(() => {
    if (!activeServiceId || !supabase) return;

    const topic = `service_document_settings:${activeServiceId}`;
    devLog("[RT] subscribe", topic, new Date().toISOString());

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
          devLog("[Orders] service_document_settings changed", payload);
          // Use ref to get current activeServiceId (not closure value)
          const sid = activeServiceIdRef.current;
          if (!sid) return;
          
          // Reload config from DB
          const dbConfig = await loadDocumentsConfigFromDB(sid);
          if (dbConfig) {
            setDocumentsConfig(dbConfig);
            // Sync to localStorage as fallback
            localStorage.setItem(STORAGE_KEYS.DOCUMENTS_CONFIG, JSON.stringify(dbConfig));
          }
        }
      )
      .subscribe();

    return () => {
      devLog("[RT] unsubscribe", topic, new Date().toISOString());
      if (supabase) {
        supabase.removeChannel(channel);
      }
    };
  }, [activeServiceId]);

  // Load orders_show_claims_in_list from service_settings
  useEffect(() => {
    if (!activeServiceId || !supabase) {
      setOrdersShowClaimsInList(false);
      return;
    }
    (supabase
      .from("service_settings") as any)
      .select("config")
      .eq("service_id", activeServiceId)
      .maybeSingle()
      .then(({ data }: any) => {
        setOrdersShowClaimsInList(!!data?.config?.orders_show_claims_in_list);
      })
      .catch(() => setOrdersShowClaimsInList(false));
  }, [activeServiceId]);
  useEffect(() => {
    const onUiUpdated = () => {
      if (!activeServiceId || !supabase) return;
      (supabase.from("service_settings") as any)
        .select("config")
        .eq("service_id", activeServiceId)
        .maybeSingle()
        .then(({ data }: any) => {
          setOrdersShowClaimsInList(!!data?.config?.orders_show_claims_in_list);
        })
        .catch(() => {});
    };
    window.addEventListener("jobsheet:ui-updated" as any, onUiUpdated);
    return () => window.removeEventListener("jobsheet:ui-updated" as any, onUiUpdated);
  }, [activeServiceId]);

  // Load tickets from cloud when activeServiceId changes
  useEffect(() => {
    if (!activeServiceId || !supabase) {
        setCloudTickets([]);
      setTicketsLoading(false);
        setTicketsError(null);
      return;
    }

    const myReqId = ++ticketsReqIdRef.current;

    setTicketsLoading(true);
    setTicketsError(null);

    const loadTickets = async () => {
      try {
        const { data, error } = await (supabase!
          .from("tickets") as any)
          .select("id,service_id,code,title,status,notes,customer_id,customer_name,customer_phone,customer_email,customer_address_street,customer_address_city,customer_address_zip,customer_company,customer_ico,customer_info,device_serial,device_passcode,device_condition,device_accessories,device_note,external_id,handoff_method,handback_method,estimated_price,performed_repairs,diagnostic_text,diagnostic_photos,diagnostic_photos_before,discount_type,discount_value,created_at,updated_at,version")
          .eq("service_id", activeServiceId)
          .is("deleted_at", null)
          .order("created_at", { ascending: false });

        // Check if this request is still valid
        if (myReqId !== ticketsReqIdRef.current) {
          return; // This request is stale, ignore it
        }

        if (error) {
          throw error;
        }

        if (data) {
          const mapped = data.map(mapSupabaseTicketToTicketEx);
          setCloudTickets(mapped);
        } else {
          setCloudTickets([]);
        }
        setTicketsLoading(false);
      } catch (err) {
        // Check if this request is still valid before setting error
        if (myReqId !== ticketsReqIdRef.current) {
          return; // This request is stale, ignore it
        }
        console.error("[Orders] Error loading tickets:", err);
        setTicketsError(normalizeError(err) || "Neznámá chyba při načítání zakázek");
        setCloudTickets([]);
        setTicketsLoading(false);
      }
    };

    loadTickets();
    
    return () => {
      ticketsReqIdRef.current++;
    };
  }, [activeServiceId, supabase]);

  // Load warranty claims when activeServiceId changes
  useEffect(() => {
    if (!activeServiceId || !supabase) {
      setCloudClaims([]);
      setClaimsLoading(false);
      setClaimsError(null);
      return;
    }
    const myReqId = ++claimsReqIdRef.current;
    const client = supabase;
    setClaimsLoading(true);
    setClaimsError(null);
    const loadClaims = async () => {
      if (!client) return;
      try {
        const { data, error } = await (client
          .from("warranty_claims") as any)
          .select("*")
          .eq("service_id", activeServiceId)
          .order("created_at", { ascending: false });
        if (myReqId !== claimsReqIdRef.current) return;
        if (error) throw error;
        setCloudClaims(data ?? []);
      } catch (err) {
        if (myReqId !== claimsReqIdRef.current) return;
        setClaimsError(normalizeError(err) || "Chyba při načítání reklamací");
        setCloudClaims([]);
      } finally {
        if (myReqId === claimsReqIdRef.current) setClaimsLoading(false);
      }
    };
    loadClaims();
    return () => { claimsReqIdRef.current++; };
  }, [activeServiceId, supabase]);

  const refetchClaims = useCallback(async () => {
    if (!activeServiceId || !supabase) return;
    const { data, error } = await (supabase.from("warranty_claims") as any)
      .select("*")
      .eq("service_id", activeServiceId)
      .order("created_at", { ascending: false });
    if (!error && data) setCloudClaims(data);
  }, [activeServiceId, supabase]);

  const { updateClaimStatus, updateClaim, deleteClaim } = useWarrantyClaims(activeServiceId);

  // Realtime subscription for warranty_claims
  useEffect(() => {
    if (!activeServiceId || !supabase) return;
    const topic = `warranty_claims:${activeServiceId}`;
    const client = supabase;
    const channel = client
      .channel(topic)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "warranty_claims", filter: `service_id=eq.${activeServiceId}` },
        () => refetchClaims()
      )
      .subscribe();
    return () => {
      if (client) client.removeChannel(channel);
    };
  }, [activeServiceId, supabase, refetchClaims]);

  // State declarations (moved up to fix dependency order)
  const [detailId, setDetailId] = useState<string | null>(null);
  const [detailClaimId, setDetailClaimId] = useState<string | null>(null);
  const [isEditing, setIsEditing] = useState(false);
  const [diagnosticPhotosUploading, setDiagnosticPhotosUploading] = useState(false);
  const [captureQRItems, setCaptureQRItems] = useState<Array<{ deviceLabel: string; url: string }> | null>(null);
  const [captureQRLoading, setCaptureQRLoading] = useState(false);
  const newOrderPhotosBeforeInputRef = useRef<HTMLInputElement>(null);
  const draftCaptureTokenRef = useRef<string | null>(null);
  const [draftCapturePreviewUrls, setDraftCapturePreviewUrls] = useState<string[]>([]);
  const [draftCaptureLiveCount, setDraftCaptureLiveCount] = useState(0);
  const [photoLightbox, setPhotoLightbox] = useState<{ urls: string[]; index: number; ticketCode?: string } | null>(null);

  useEffect(() => {
    if (!photoLightbox) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setPhotoLightbox(null); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [photoLightbox]);

  // When navigating away (e.g. to Faktury), close detail so the preview is not left open on top
  useEffect(() => {
    if (closeDetailWhen) {
      setDetailId(null);
      setDetailClaimId(null);
    }
  }, [closeDetailWhen]);

  // Realtime subscription for tickets
  useEffect(() => {
    if (!activeServiceId || !supabase) return;

    const topic = `tickets:${activeServiceId}`;
    devLog("[RT] subscribe", topic, new Date().toISOString());

    const channel = supabase
      .channel(topic)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "tickets",
          filter: `service_id=eq.${activeServiceId}`,
        },
        async (payload) => {
          devLog("[Orders] tickets changed", payload);
          
          if (payload.eventType === "INSERT" || payload.eventType === "UPDATE") {
            devLog("[RT tickets] event", payload.eventType, {
              id: (payload.new as any)?.id,
              service_id: (payload.new as any)?.service_id,
              status: (payload.new as any)?.status,
              updated_at: (payload.new as any)?.updated_at,
            });

            const newTicket = mapSupabaseTicketToTicketEx(payload.new as any);
            const wasDeleted = (payload.old as any)?.deleted_at != null;
            const isDeleted = (payload.new as any)?.deleted_at != null;
            
            // Handle restore: deleted_at changed from not null to null
            if (wasDeleted && !isDeleted) {
              // Ticket was restored - add it back
            setCloudTickets((prev) => {
                const existing = prev.find((t) => t.id === newTicket.id);
                devLog("[RT tickets] setCloudTickets (restore)", {
                  id: newTicket.id,
                  hadExisting: !!existing,
                  prevLen: prev.length,
                  newStatus: newTicket.status,
                });
                if (existing) {
                  // Update existing
                  return prev.map((t) => (t.id === newTicket.id ? newTicket : t));
                } else {
                  // Add new - insert in correct position based on created_at
                  const sorted = [...prev, newTicket].sort((a, b) => {
                    const aTime = a.createdAt ? new Date(a.createdAt).getTime() : 0;
                    const bTime = b.createdAt ? new Date(b.createdAt).getTime() : 0;
                    return bTime - aTime; // Descending order (newest first)
                  });
                  return sorted;
                }
              });
            } else if (!isDeleted) {
              // Ticket is not deleted - upsert
              setCloudTickets((prev) => {
                const existing = prev.find((t) => t.id === newTicket.id);
                devLog("[RT tickets] setCloudTickets (upsert)", {
                  id: newTicket.id,
                  hadExisting: !!existing,
                  prevLen: prev.length,
                  newStatus: newTicket.status,
                  oldStatus: existing?.status,
                });
                
                // Check if this is the currently edited ticket and if version conflict occurred
                if (existing && isEditing && detailId === newTicket.id) {
                  const existingVersion = existing.version ?? 0;
                  const newVersion = newTicket.version ?? 0;
                  if (newVersion > existingVersion) {
                    // Remote update detected during editing - show banner/toast
                    devLog("[RT tickets] Remote update detected for edited ticket", {
                      ticketId: newTicket.id,
                      existingVersion,
                      newVersion,
                    });
                    showToast("Zakázka se změnila na pozadí", "info");
                  }
                }
                
                if (existing) {
                  // Update existing
                  return prev.map((t) => (t.id === newTicket.id ? newTicket : t));
                } else {
                  // Add new - insert in correct position based on created_at
                  const sorted = [...prev, newTicket].sort((a, b) => {
                    const aTime = a.createdAt ? new Date(a.createdAt).getTime() : 0;
                    const bTime = b.createdAt ? new Date(b.createdAt).getTime() : 0;
                    return bTime - aTime; // Descending order (newest first)
                  });
                  return sorted;
                }
              });
            } else {
              // Ticket was soft-deleted (deleted_at changed from null to not null)
              setCloudTickets((prev) => prev.filter((t) => t.id !== newTicket.id));
            }
          } else if (payload.eventType === "DELETE") {
            // Hard delete - remove from list
            const deletedId = (payload.old as any)?.id || (payload.new as any)?.id;
            if (deletedId) {
            setCloudTickets((prev) => prev.filter((t) => t.id !== deletedId));
            }
          }
        }
      )
      .subscribe();

    return () => {
      devLog("[RT] unsubscribe", topic, new Date().toISOString());
      if (supabase) {
        supabase.removeChannel(channel);
      }
    };
  }, [activeServiceId, isEditing, detailId]);

  // Cloud mode only: show only cloud tickets
  const tickets = useMemo(() => {
      return cloudTickets;
  }, [cloudTickets]);

  const [activeGroup, setActiveGroup] = useState<GroupKey>("active");
  const [activeStatusKey, setActiveStatusKey] = useState<string | null>(null);
  const [claimsSubGroup, setClaimsSubGroup] = useState<ClaimsSubGroup>("all");

  const [query, setQuery] = useState("");
  const [statusById, setStatusById] = useState<Record<string, string>>({});

  const [isNewOpen, setIsNewOpen] = useState(false);
  const [newDraft, setNewDraft] = useState<NewOrderDraft>(() => safeLoadDraft() ?? defaultDraft());
  const [submitAttempted, setSubmitAttempted] = useState(false);
  const [shouldOpenNew, setShouldOpenNew] = useState(false);
  const [matchedCustomer, setMatchedCustomer] = useState<{
    id: string;
    name: string;
    phone?: string;
    email?: string;
    company?: string;
  } | null>(null);
  const [customerMatchDecision, setCustomerMatchDecision] = useState<"undecided" | "accepted" | "rejected">("undecided");
  const lastLookupPhoneNormRef = useRef<string | null>(null);
  const phoneLookupDebounceTimerRef = useRef<NodeJS.Timeout | null>(null);

  const [editedTicket, setEditedTicket] = useState<Partial<TicketEx>>({});
  const [returnToPage, setReturnToPage] = useState<NavKey | null>(null);
  const [matchedCustomerEdit, setMatchedCustomerEdit] = useState<{
    id: string;
    name: string;
    phone?: string;
    email?: string;
    company?: string;
  } | null>(null);
  const returnToCustomerIdRef = useRef<string | undefined>(undefined);
  const originalTicketRef = useRef<TicketEx | null>(null);
  const lastDetailIdRef = useRef<string | null>(null);
  const ticketsLoadHasRunRef = useRef(false);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const openNewOrderRef = useRef<() => void>(() => {});
  const startEditingRef = useRef<() => void>(() => {});
  const saveTicketChangesRef = useRef<() => Promise<boolean>>(async () => false);

  // Dirty tracking for diagnostic text, photos, and performed repairs
  const [dirtyFlags, setDirtyFlags] = useState({
    diagnosticText: false,
    diagnosticPhotos: false,
    performedRepairs: false,
  });

  const [commentDraftByTicket, setCommentDraftByTicket] = useState<Record<string, string>>({});
  const [openQuickPrintTicket, setOpenQuickPrintTicket] = useState<TicketEx | null>(null);
  const [quickPrintDropdownRect, setQuickPrintDropdownRect] = useState<{ top: number; left: number; right: number; height: number } | null>(null);

  const [ordersPage, setOrdersPage] = useState(0);

  // Delete ticket dialog states
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [deleteTicketId, setDeleteTicketId] = useState<string | null>(null);
  const [ticketHistoryModalOpen, setTicketHistoryModalOpen] = useState(false);
  const [createClaimModalOpen, setCreateClaimModalOpen] = useState(false);
  const [ordersShowClaimsInList, setOrdersShowClaimsInList] = useState(false);
  const [ticketHistoryEntries, setTicketHistoryEntries] = useState<Array<{ id: string; action: string; changed_by: string | null; created_at: string; details: Record<string, unknown>; nickname: string | null }>>([]);
  const [ticketHistoryLoading, setTicketHistoryLoading] = useState(false);
  const [ticketHistoryError, setTicketHistoryError] = useState<string | null>(null);
  const [ticketHistoryExpandedId, setTicketHistoryExpandedId] = useState<string | null>(null);
  const [isEditingClaim, setIsEditingClaim] = useState(false);
  const [editedClaim, setEditedClaim] = useState<Partial<WarrantyClaimRow>>({});
  /** Draft zákroků v náhledu reklamace – při změně reklamace se resetuje */
  const [claimResolutionDraft, setClaimResolutionDraft] = useState<ClaimResolutionItem[] | null>(null);
  const [claimHistoryModalOpen, setClaimHistoryModalOpen] = useState(false);
  const [claimHistoryEntries, setClaimHistoryEntries] = useState<Array<{ id: string; action: string; changed_by: string | null; created_at: string; details: Record<string, unknown>; nickname: string | null }>>([]);
  const [claimHistoryLoading, setClaimHistoryLoading] = useState(false);
  const [claimHistoryError, setClaimHistoryError] = useState<string | null>(null);
  const [deleteClaimDialogOpen, setDeleteClaimDialogOpen] = useState(false);
  const [deleteClaimId, setDeleteClaimId] = useState<string | null>(null);
  const [lowStockDialogOpen, setLowStockDialogOpen] = useState(false);
  const [lowStockProducts, setLowStockProducts] = useState<string[]>([]);
  const [lowStockCallback, setLowStockCallback] = useState<(() => void) | null>(null);
  const [smsPanelOpen, setSmsPanelOpen] = useState(false);
  const [smsUnreadCount, setSmsUnreadCount] = useState(0);
  const [smsUnreadByTicketId, setSmsUnreadByTicketId] = useState<Record<string, number>>({});
  const [smsActivatedForService, setSmsActivatedForService] = useState(false);

  useEffect(() => {
    if (!activeServiceId || !supabase) {
      setSmsActivatedForService(false);
      return;
    }
    supabase
      .from("service_phone_numbers")
      .select("id")
      .eq("service_id", activeServiceId)
      .eq("active", true)
      .maybeSingle()
      .then(({ data }) => setSmsActivatedForService(!!data));
  }, [activeServiceId]);

  // Sync ref for SMS notifications: when SMS panel is open for a ticket, don't show OS notification for that ticket
  useEffect(() => {
    if (smsPanelTicketIdRef) {
      smsPanelTicketIdRef.current = smsPanelOpen && detailId ? detailId : null;
    }
    return () => {
      if (smsPanelTicketIdRef) smsPanelTicketIdRef.current = null;
    };
  }, [smsPanelOpen, detailId, smsPanelTicketIdRef]);

  // Load SMS unread count for current detail ticket
  useEffect(() => {
    if (!detailId || !activeServiceId || !supabase) {
      setSmsUnreadCount(0);
      return;
    }
    let cancelled = false;
    (async () => {
      const { data: convs } = await supabase.from("sms_conversations").select("id").eq("ticket_id", detailId);
      if (cancelled || !convs?.length) {
        if (!cancelled) setSmsUnreadCount(0);
        return;
      }
      const ids = convs.map((c) => c.id);
      const { count, error } = await supabase
        .from("sms_messages")
        .select("id", { count: "exact", head: true })
        .in("conversation_id", ids)
        .eq("direction", "inbound")
        .is("read_at", null);
      if (cancelled) return;
      setSmsUnreadCount(error ? 0 : count ?? 0);
    })();
    return () => { cancelled = true; };
  }, [detailId, activeServiceId]);

  // Load ticket history when history modal opens
  useEffect(() => {
    if (!ticketHistoryModalOpen || !detailId || !supabase || !activeServiceId) {
      if (!ticketHistoryModalOpen) {
        setTicketHistoryEntries([]);
        setTicketHistoryError(null);
        setTicketHistoryExpandedId(null);
      }
      return;
    }
    const ticketId = detailId;
    setTicketHistoryLoading(true);
    setTicketHistoryError(null);
    (async () => {
      try {
        const { data: rows, error } = await (supabase as any)
          .from("ticket_history")
          .select("id, action, changed_by, created_at, details")
          .eq("ticket_id", ticketId)
          .order("created_at", { ascending: false });
        if (error) throw error;
        const entries = (rows || []) as Array<{ id: string; action: string; changed_by: string | null; created_at: string; details: Record<string, unknown> }>;
        const userIds = [...new Set(entries.map((e) => e.changed_by).filter(Boolean))] as string[];
        const nicknames: Record<string, string> = {};
        if (userIds.length > 0) {
          const { data: profiles } = await (supabase as any).from("profiles").select("id, nickname").in("id", userIds);
          if (profiles) {
            for (const p of profiles) {
              if (p.nickname) nicknames[p.id] = p.nickname;
            }
          }
        }
        setTicketHistoryEntries(
          entries.map((e) => ({ ...e, nickname: (e.changed_by && nicknames[e.changed_by]) || null }))
        );
      } catch (err) {
        console.error("[Orders] ticket history load error", err);
        const code = (err as { code?: string })?.code;
        const msg = code === "PGRST205"
          ? "Historie zatím není k dispozici. V databázi chybí tabulka – spusť migraci (např. supabase db push)."
          : (err instanceof Error ? err.message : "Nelze načíst historii");
        setTicketHistoryError(msg);
        setTicketHistoryEntries([]);
      } finally {
        setTicketHistoryLoading(false);
      }
    })();
  }, [ticketHistoryModalOpen, detailId, activeServiceId, supabase]);

  // Load claim history when claim history modal opens
  useEffect(() => {
    if (!claimHistoryModalOpen || !detailClaimId || !supabase || !activeServiceId) {
      if (!claimHistoryModalOpen) {
        setClaimHistoryEntries([]);
        setClaimHistoryError(null);
      }
      return;
    }
    const claimId = detailClaimId;
    setClaimHistoryLoading(true);
    setClaimHistoryError(null);
    (async () => {
      try {
        const { data: rows, error } = await (supabase as any)
          .from("warranty_claim_history")
          .select("id, action, changed_by, created_at, details")
          .eq("warranty_claim_id", claimId)
          .order("created_at", { ascending: false });
        if (error) throw error;
        const entries = (rows || []) as Array<{ id: string; action: string; changed_by: string | null; created_at: string; details: Record<string, unknown> }>;
        const userIds = [...new Set(entries.map((e) => e.changed_by).filter(Boolean))] as string[];
        const nicknames: Record<string, string> = {};
        if (userIds.length > 0) {
          const { data: profiles } = await (supabase as any).from("profiles").select("id, nickname").in("id", userIds);
          if (profiles) {
            for (const p of profiles) {
              if (p.nickname) nicknames[p.id] = p.nickname;
            }
          }
        }
        setClaimHistoryEntries(
          entries.map((e) => ({ ...e, nickname: (e.changed_by && nicknames[e.changed_by]) || null }))
        );
      } catch (err) {
        console.error("[Orders] claim history load error", err);
        setClaimHistoryError(err instanceof Error ? err.message : "Nelze načíst historii");
        setClaimHistoryEntries([]);
      } finally {
        setClaimHistoryLoading(false);
      }
    })();
  }, [claimHistoryModalOpen, detailClaimId, activeServiceId, supabase]);

  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
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

  useEffect(() => {
    const next: Record<string, string> = {};
    for (const t of tickets) next[t.id] = t.status as any;
    setStatusById(next);
  }, [tickets]);

  useLayoutEffect(() => {
    if (!openQuickPrintTicket) {
      setQuickPrintDropdownRect(null);
      return;
    }
    const el = document.querySelector(`[data-quick-print-trigger-id="${openQuickPrintTicket.id}"]`);
    if (el) {
      const rect = el.getBoundingClientRect();
      setQuickPrintDropdownRect({ top: rect.bottom, left: rect.left, right: rect.right, height: rect.height });
    } else {
      setQuickPrintDropdownRect(null);
    }
  }, [openQuickPrintTicket]);

  useEffect(() => {
    if (!openQuickPrintTicket) return;
    const handleClick = (e: MouseEvent) => {
      const el = e.target as Element;
      if (el?.closest?.("[data-quick-print-menu]") || el?.closest?.("[data-quick-print-trigger]")) return;
      setOpenQuickPrintTicket(null);
    };
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [openQuickPrintTicket]);

  // When navigating from Customers (click on ticket): open that ticket's detail once tickets are loaded.
  // Don't consume intent until we've opened the detail or confirmed the ticket isn't in the list (after load).
  // On first mount tickets is [] and ticketsLoading is false (initial state), so we must not consume until
  // we have either found the ticket or load has completed (ticketsLoadHasRunRef set when ticketsLoading was true).
  useEffect(() => {
    if (ticketsLoading) ticketsLoadHasRunRef.current = true;
  }, [ticketsLoading]);

  useEffect(() => {
    if (!openTicketIntent) return;

    const { ticketId, mode, returnToPage: returnPage, returnToCustomerId, openSmsPanel } = openTicketIntent;
    const exists = tickets.some((t) => t.id === ticketId);

    if (exists) {
      if ((mode ?? "detail") === "detail") {
        setDetailId(ticketId);
        setReturnToPage(returnPage || null);
        returnToCustomerIdRef.current = returnToCustomerId;
        if (openSmsPanel) setSmsPanelOpen(true);
      } else {
        setDetailId(null);
        setReturnToPage(null);
        returnToCustomerIdRef.current = undefined;
      }
      onOpenTicketIntentConsumed();
    } else {
      setDetailId(null);
      setReturnToPage(null);
      returnToCustomerIdRef.current = undefined;
      // Consume when load has finished: either we have data, or we've seen loading complete (ref set when ticketsLoading was true).
      if (!ticketsLoading && (tickets.length > 0 || ticketsLoadHasRunRef.current)) {
        onOpenTicketIntentConsumed();
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openTicketIntent, tickets, ticketsLoading]);

  useEffect(() => {
    if (!openClaimIntent || !onOpenClaimIntentConsumed) return;
    const { claimId } = openClaimIntent;
    const exists = cloudClaims.some((c) => c.id === claimId);
    if (exists) {
      setDetailClaimId(claimId);
      setDetailId(null);
    }
    onOpenClaimIntentConsumed();
  }, [openClaimIntent, cloudClaims, onOpenClaimIntentConsumed]);

  // Map ticket_id -> invoice id for "Přejít na fakturu" when invoice already exists
  const [invoiceIdByTicketId, setInvoiceIdByTicketId] = useState<Record<string, string>>({});
  useEffect(() => {
    if (!activeServiceId || (!onCreateInvoice && !onOpenInvoice)) return;
    let cancelled = false;
    (async () => {
      try {
        const { data } = await typedSupabase
          .from("invoices")
          .select("id, ticket_id")
          .eq("service_id", activeServiceId)
          .not("ticket_id", "is", null)
          .is("deleted_at", null);
        if (cancelled || !data) return;
        const map: Record<string, string> = {};
        for (const row of data) {
          if (row.ticket_id) map[row.ticket_id] = row.id;
        }
        setInvoiceIdByTicketId(map);
      } catch {
        // ignore
      }
    })();
    return () => { cancelled = true; };
  }, [activeServiceId, onCreateInvoice, onOpenInvoice]);

  const devicesData: DevicesData = useMemo(() => safeLoadDevicesData(), []);
  const inventoryData: InventoryData = useMemo(() => safeLoadInventoryData(), []);

  const modelsWithHierarchy: ModelWithHierarchy[] = useMemo(() => {
    if (!devicesData || !Array.isArray(devicesData.models)) return [];
    return devicesData.models
      .map((model) => {
        if (!model || !model.id || !model.name) return null;
        const category = devicesData.categories?.find((c) => c && c.id === model.categoryId);
        const brand = category && devicesData.brands ? devicesData.brands.find((b) => b && b.id === category.brandId) : null;
        const brandName = brand?.name ?? "";
        const categoryName = category?.name ?? "";
        return {
          ...model,
          categoryName,
          brandName,
          fullName: brand ? `${brand.name} ${model.name}` : model.name,
        } satisfies ModelWithHierarchy;
      })
      .filter((m): m is ModelWithHierarchy => m !== null);
  }, [devicesData]);

  const draftDirty = useMemo(() => isDraftDirty(newDraft), [newDraft]);

  const validEnoughToCreate = useMemo(() => {
    const hasDevices = newDraft.devices.length > 0 && newDraft.devices.every((d) => (d.deviceLabel || "").trim().length > 0);
    return (
      hasDevices &&
      isEmailValid(newDraft.customerEmail) &&
      isPhoneValid(newDraft.customerPhone) &&
      isZipValid(newDraft.addressZip) &&
      isIcoValid(newDraft.ico)
    );
  }, [newDraft]);

  const draftBadgeCount = useMemo(() => {
    return draftDirty && !validEnoughToCreate && !isNewOpen ? 1 : 0;
  }, [draftDirty, validEnoughToCreate, isNewOpen]);

  useEffect(() => {
    safeSaveDraft(draftDirty ? newDraft : null);
    window.dispatchEvent(new CustomEvent("jobsheet:draft-count", { detail: { count: draftBadgeCount } }));
  }, [newDraft, draftDirty, draftBadgeCount]);

  useEffect(() => {
    if (!newOrderPrefill) return;
    setShouldOpenNew(true);
    if (!newOrderPrefill.customerId) onNewOrderPrefillConsumed();
  }, [newOrderPrefill, onNewOrderPrefillConsumed]);

  // Load customer detail and prefill form when newOrderPrefill.customerId is set (e.g. "Vytvořit zakázku" u zákazníka)
  useEffect(() => {
    const customerId = newOrderPrefill?.customerId;
    if (!customerId || !supabase || !activeServiceId) return;

    onNewOrderPrefillConsumed();
    (async () => {
      try {
        const { data, error } = await (supabase
          .from("customers") as any)
          .select("id,name,phone,email,company,ico,address_street,address_city,address_zip,note")
          .eq("id", customerId)
          .eq("service_id", activeServiceId)
          .single();

        if (error || !data) {
          console.error("[Orders] Error loading customer for prefill:", error);
          return;
        }

        setNewDraft((prev) => {
          const shouldPrefill = !prev.customerId;
          return {
            ...prev,
            customerId: data.id,
            customerName: shouldPrefill || !prev.customerName.trim() ? (data.name || "") : prev.customerName,
            customerPhone: shouldPrefill || !prev.customerPhone.trim() ? (data.phone || "") : prev.customerPhone,
            customerEmail: shouldPrefill || !prev.customerEmail.trim() ? (data.email || "") : prev.customerEmail,
            addressStreet: shouldPrefill || !prev.addressStreet.trim() ? (data.address_street || "") : prev.addressStreet,
            addressCity: shouldPrefill || !prev.addressCity.trim() ? (data.address_city || "") : prev.addressCity,
            addressZip: shouldPrefill || !prev.addressZip.trim() ? (data.address_zip || "") : prev.addressZip,
            company: shouldPrefill || !prev.company.trim() ? (data.company || "") : prev.company,
            ico: shouldPrefill || !prev.ico.trim() ? (data.ico || "") : prev.ico,
            customerInfo: shouldPrefill || !prev.customerInfo.trim() ? (data.note || "") : prev.customerInfo,
          };
        });
      } catch (err) {
        console.error("[Orders] Error loading customer for prefill:", err);
      }
    })();
  }, [newOrderPrefill?.customerId, supabase, activeServiceId, onNewOrderPrefillConsumed]);

  useEffect(() => {
    const onReq = () => setShouldOpenNew(true);
    window.addEventListener("jobsheet:request-new-order" as any, onReq);
    return () => window.removeEventListener("jobsheet:request-new-order" as any, onReq);
     
  }, []);

  useEffect(() => {
    if (!shouldOpenNew) return;
    setShouldOpenNew(false);
    setSubmitAttempted(false);
    setIsNewOpen(true);
  }, [shouldOpenNew]);

  // Lookup customer by phone or name
  const lookupCustomer = async (phone?: string, name?: string) => {
    if (!supabase || !activeServiceId) return;

    // Try phone lookup first (primary identifier)
    if (phone) {
      const phoneNorm = normalizePhone(phone);
      if (phoneNorm) {
        // Update lastLookupPhoneNormRef to prevent duplicate lookups
        lastLookupPhoneNormRef.current = phoneNorm;

        const { data, error } = await (supabase
          .from("customers") as any)
          .select("id,name,phone,email,company")
          .eq("service_id", activeServiceId)
          .eq("phone_norm", phoneNorm)
          .maybeSingle();

        if (!error && data) {
          // If name is also provided, check if it matches (case-insensitive)
          if (name && name.trim()) {
            const nameMatch = data.name?.trim().toLowerCase() === name.trim().toLowerCase();
            if (nameMatch) {
              // Phone + name match - high confidence
              setMatchedCustomer({
                id: data.id,
                name: data.name || "",
                phone: data.phone || undefined,
                email: data.email || undefined,
                company: data.company || undefined,
              });
              setCustomerMatchDecision("undecided");
              return;
            }
          }
          // Phone match (name may or may not match)
          setMatchedCustomer({
            id: data.id,
            name: data.name || "",
            phone: data.phone || undefined,
            email: data.email || undefined,
            company: data.company || undefined,
          });
          setCustomerMatchDecision("undecided");
          return;
        }
      } else {
        // Invalid phone norm - reset lastLookupPhoneNormRef
        lastLookupPhoneNormRef.current = null;
      }
    }

    // Vyhledání podle jména (když není telefon nebo telefon nenašel)
    if (name && name.trim().length >= 2) {
      const nameTrim = name.trim();
      const { data: nameData, error: nameError } = await (supabase
        .from("customers") as any)
        .select("id,name,phone,email,company")
        .eq("service_id", activeServiceId)
        .ilike("name", `%${nameTrim.replace(/%/g, "\\%")}%`)
        .limit(1)
        .maybeSingle();

      if (!nameError && nameData) {
        setMatchedCustomer({
          id: nameData.id,
          name: nameData.name || "",
          phone: nameData.phone || undefined,
          email: nameData.email || undefined,
          company: nameData.company || undefined,
        });
        setCustomerMatchDecision("undecided");
        return;
      }
    }

    // No match found
    setMatchedCustomer(null);
    setCustomerMatchDecision("undecided");
  };

  // Lookup customer by phone or name (for Edit mode)
  const lookupCustomerEdit = async (phone?: string, name?: string) => {
    if (!supabase || !activeServiceId) return;

    // Try phone lookup first (primary identifier)
    if (phone) {
      const phoneNorm = normalizePhone(phone);
      if (phoneNorm) {
        const { data, error } = await (supabase
          .from("customers") as any)
          .select("id,name,phone,email,company")
          .eq("service_id", activeServiceId)
          .eq("phone_norm", phoneNorm)
          .maybeSingle();

        if (!error && data) {
          // If name is also provided, check if it matches (case-insensitive)
          if (name && name.trim()) {
            const nameMatch = data.name?.trim().toLowerCase() === name.trim().toLowerCase();
            if (nameMatch) {
              // Phone + name match - high confidence
              setMatchedCustomerEdit({
                id: data.id,
                name: data.name || "",
                phone: data.phone || undefined,
                email: data.email || undefined,
                company: data.company || undefined,
              });
              return;
            }
          }
          // Phone match (name may or may not match)
          setMatchedCustomerEdit({
            id: data.id,
            name: data.name || "",
            phone: data.phone || undefined,
            email: data.email || undefined,
            company: data.company || undefined,
          });
          return;
        }
      }
    }

    // Vyhledání podle jména (když není telefon nebo telefon nenašel)
    if (name && name.trim().length >= 2) {
      const nameTrim = name.trim();
      const { data: nameData, error: nameError } = await (supabase
        .from("customers") as any)
        .select("id,name,phone,email,company")
        .eq("service_id", activeServiceId)
        .ilike("name", `%${nameTrim.replace(/%/g, "\\%")}%`)
        .limit(1)
        .maybeSingle();

      if (!nameError && nameData) {
        setMatchedCustomerEdit({
          id: nameData.id,
          name: nameData.name || "",
          phone: nameData.phone || undefined,
          email: nameData.email || undefined,
          company: nameData.company || undefined,
        });
        return;
      }
    }

    // No match found
    setMatchedCustomerEdit(null);
  };

  const statusKeysSet = useMemo(() => new Set(statuses.map((s) => s.key)), [statuses]);
  const statusesReady = !statusesLoading && statuses.length > 0;

  const normalizeStatus = useCallback(
    (key: string): string | null => {
      // If statuses are not loaded yet, return null to indicate placeholder
      if (statusesLoading || statuses.length === 0) {
        return null;
      }
      return statusKeysSet.has(key) ? key : fallbackKey;
    },
    [statusKeysSet, fallbackKey, statusesLoading, statuses.length]
  );

  // Order actions hook
  // Re-fetch single ticket by ID (for conflict resolution)
  const refetchTicketById = useCallback(async (ticketId: string): Promise<TicketEx | null> => {
    if (!activeServiceId || !supabase) return null;
    
    try {
      const { data, error } = await (supabase
        .from("tickets") as any)
        .select("id,service_id,code,title,status,notes,customer_id,customer_name,customer_phone,customer_email,customer_address_street,customer_address_city,customer_address_zip,customer_company,customer_ico,customer_info,device_serial,device_passcode,device_condition,device_accessories,device_note,external_id,handoff_method,handback_method,estimated_price,performed_repairs,diagnostic_text,diagnostic_photos,diagnostic_photos_before,discount_type,discount_value,created_at,updated_at,version")
        .eq("id", ticketId)
        .eq("service_id", activeServiceId)
        .single();
      
      if (error) {
        console.error("[Orders] Error re-fetching ticket:", error);
        return null;
      }
      
      if (data) {
        return mapSupabaseTicketToTicketEx(data);
      }
      
      return null;
    } catch (err) {
      console.error("[Orders] Exception re-fetching ticket:", err);
      return null;
    }
  }, [activeServiceId, supabase]);

  const { createTicket: createTicketAction, saveTicketChanges: saveTicketChangesAction } = useOrderActions({
    activeServiceId,
    userId: session?.user?.id ?? null,
    cloudTickets,
    setCloudTickets,
    setStatusById,
    statusesReady,
    statuses,
    statusKeysSet,
    normalizeStatus,
    refetchTicketById,
  });

  const selectedQuickKeys = uiCfg.home.orderFilters.selectedQuickStatusFilters;

  const quickStatuses = useMemo(() => {
    const set = new Set(statuses.map((s) => s.key));
    const keys = selectedQuickKeys.filter((k) => set.has(k));
    return statuses.filter((s) => keys.includes(s.key));
  }, [selectedQuickKeys, statuses]);

  const showSecondaryFiltersRow = quickStatuses.length > 0;

  useEffect(() => {
    if (!activeStatusKey) return;
    if (statusKeysSet.has(activeStatusKey)) return;
    setActiveStatusKey(null);
  }, [activeStatusKey, statusKeysSet]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();

    const base = tickets
      .filter((t) => {
        const raw = (t.status as any) ?? statusById[t.id];
        const st = normalizeStatus(raw);
        
        // If statuses are not ready, show all tickets
        if (st === null) return true;

        if (activeGroup === "all") return true;
        if (activeGroup === "final") return isFinal(st);
        return !isFinal(st);
      })
      .filter((t) => {
        if (!showSecondaryFiltersRow) return true;
        if (!activeStatusKey) return true;
        const raw = (t.status as any) ?? statusById[t.id];
        const st = normalizeStatus(raw);
        
        // If statuses are not ready, don't filter by status
        if (st === null) return true;
        return st === activeStatusKey;
      })
      .filter((t) => {
        if (!q) return true;
        return (
          t.code.toLowerCase().includes(q) ||
          t.customerName.toLowerCase().includes(q) ||
          (t.customerPhone ?? "").toLowerCase().includes(q) ||
          t.deviceLabel.toLowerCase().includes(q) ||
          (t.serialOrImei ?? "").toLowerCase().includes(q) ||
          t.issueShort.toLowerCase().includes(q) ||
          (t.externalId ?? "").toLowerCase().includes(q)
        );
      });
    // Explicitně řadit od nejnovějších, aby stránkování bylo konzistentní
    return [...base].sort(
      (a, b) => new Date(b.createdAt ?? 0).getTime() - new Date(a.createdAt ?? 0).getTime()
    );
  }, [tickets, activeGroup, query, statusById, isFinal, showSecondaryFiltersRow, activeStatusKey, normalizeStatus]);

  const filteredClaims = useMemo(() => {
    const q = query.trim().toLowerCase();
    const base = !q
      ? cloudClaims
      : cloudClaims.filter(
          (c) =>
            (c.code?.toLowerCase().includes(q)) ||
            (c.customer_name?.toLowerCase().includes(q)) ||
            (c.customer_phone?.replace(/\s/g, "").includes(q.replace(/\s/g, ""))) ||
            (c.device_serial?.toLowerCase().includes(q)) ||
            (c.device_label?.toLowerCase().includes(q)) ||
            (c.notes?.toLowerCase().includes(q))
        );
    // Explicitně řadit od nejnovějších kvůli konzistentnímu stránkování
    return [...base].sort(
      (a, b) => new Date(b.created_at ?? 0).getTime() - new Date(a.created_at ?? 0).getTime()
    );
  }, [cloudClaims, query]);

  const filteredClaimsForTab = useMemo(() => {
    if (activeGroup !== "reklamace") return filteredClaims;
    if (claimsSubGroup === "all") return filteredClaims;
    return filteredClaims.filter((c) => {
      const st = normalizeStatus((c.status as string) ?? "");
      if (st === null) return claimsSubGroup === "active";
      if (claimsSubGroup === "final") return isFinal(st);
      return !isFinal(st);
    });
  }, [activeGroup, claimsSubGroup, filteredClaims, normalizeStatus, isFinal]);

  const showClaimsInOrdersList = (activeGroup === "all" || activeGroup === "active" || activeGroup === "final") && ordersShowClaimsInList;
  const combinedList = useMemo(() => {
    if (!showClaimsInOrdersList) return [];
    const ticketItems = filtered.map((t) => ({ type: "ticket" as const, data: t, created_at: t.createdAt ?? "" }));
    const claimsForGroup = filteredClaims.filter((c) => {
      const st = normalizeStatus((c.status as string) ?? "");
      if (st === null) return activeGroup !== "final";
      if (activeGroup === "all") return true;
      if (activeGroup === "final") return isFinal(st);
      return !isFinal(st);
    });
    const claimItems = claimsForGroup.map((c) => ({ type: "claim" as const, data: c, created_at: c.created_at ?? "" }));
    return [...ticketItems, ...claimItems].sort(
      (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
    );
  }, [showClaimsInOrdersList, filtered, filteredClaims, activeGroup, normalizeStatus, isFinal]);

  const pageSize = uiCfg.orders.pageSize ?? 50;
  const listLength = activeGroup === "reklamace"
    ? filteredClaimsForTab.length
    : showClaimsInOrdersList
      ? combinedList.length
      : filtered.length;
  const effectivePageSize = pageSize <= 0 ? listLength || 1 : pageSize;
  const totalOrdersPages = Math.max(1, Math.ceil(listLength / effectivePageSize));
  const paginatedTickets = useMemo(
    () => (pageSize <= 0 ? filtered : filtered.slice(ordersPage * effectivePageSize, (ordersPage + 1) * effectivePageSize)),
    [filtered, ordersPage, pageSize, effectivePageSize]
  );
  const paginatedClaims = useMemo(
    () => (pageSize <= 0 ? filteredClaimsForTab : filteredClaimsForTab.slice(ordersPage * effectivePageSize, (ordersPage + 1) * effectivePageSize)),
    [filteredClaimsForTab, ordersPage, pageSize, effectivePageSize]
  );
  const paginatedCombined = useMemo(
    () => (pageSize <= 0 ? combinedList : combinedList.slice(ordersPage * effectivePageSize, (ordersPage + 1) * effectivePageSize)),
    [combinedList, ordersPage, pageSize, effectivePageSize]
  );

  const paginatedTicketIds = useMemo(() => paginatedTickets.map((t) => t.id), [paginatedTickets]);

  // Load SMS unread counts for tickets on current page (one batch) — only when SMS is activated
  useEffect(() => {
    if (!smsActivatedForService || !activeServiceId || !supabase || paginatedTicketIds.length === 0) {
      setSmsUnreadByTicketId({});
      return;
    }
    let cancelled = false;
    (async () => {
      const { data: convs } = await supabase
        .from("sms_conversations")
        .select("id, ticket_id")
        .eq("service_id", activeServiceId)
        .in("ticket_id", paginatedTicketIds);
      if (cancelled || !convs?.length) {
        if (!cancelled) setSmsUnreadByTicketId({});
        return;
      }
      const convIds = convs.map((c) => c.id);
      const ticketByConvId: Record<string, string> = {};
      convs.forEach((c) => { if (c.ticket_id) ticketByConvId[c.id] = c.ticket_id; });
      const { data: messages } = await supabase
        .from("sms_messages")
        .select("conversation_id")
        .in("conversation_id", convIds)
        .eq("direction", "inbound")
        .is("read_at", null);
      if (cancelled) return;
      const countByConv: Record<string, number> = {};
      (messages ?? []).forEach((m) => { countByConv[m.conversation_id] = (countByConv[m.conversation_id] ?? 0) + 1; });
      const byTicket: Record<string, number> = {};
      Object.entries(countByConv).forEach(([cid, n]) => {
        const tid = ticketByConvId[cid];
        if (tid) byTicket[tid] = (byTicket[tid] ?? 0) + n;
      });
      setSmsUnreadByTicketId(byTicket);
    })();
    return () => { cancelled = true; };
  }, [smsActivatedForService, activeServiceId, paginatedTicketIds]);

  useEffect(() => {
    setOrdersPage(0);
  }, [query, activeStatusKey, activeGroup, claimsSubGroup]);

  useEffect(() => {
    setOrdersPage(0);
  }, [pageSize]);

  useEffect(() => {
    if (ordersPage >= totalOrdersPages && totalOrdersPages > 0) setOrdersPage(totalOrdersPages - 1);
  }, [ordersPage, totalOrdersPages]);

  const detailedTicket: TicketEx | undefined = useMemo(
    () => (detailId ? tickets.find((t) => t.id === detailId) : undefined),
    [detailId, tickets]
  );

  const detailedClaim: WarrantyClaimRow | undefined = useMemo(
    () => (detailClaimId ? cloudClaims.find((c) => c.id === detailClaimId) : undefined),
    [detailClaimId, cloudClaims]
  );

  // Save originalTicketRef when detailId changes and reset dirty flags
  useEffect(() => {
    if (detailId !== lastDetailIdRef.current) {
      lastDetailIdRef.current = detailId;
      if (detailedTicket) {
        originalTicketRef.current = JSON.parse(JSON.stringify(detailedTicket));
      } else {
        originalTicketRef.current = null;
      }
      // Reset dirty flags when opening new ticket
      setDirtyFlags({
        diagnosticText: false,
        diagnosticPhotos: false,
        performedRepairs: false,
      });
    }
  }, [detailId, detailedTicket]);

  const availableRepairs = useMemo(() => {
    if (!detailedTicket?.deviceLabel) return [];
    if (!devicesData || !Array.isArray(devicesData.models) || !Array.isArray(devicesData.repairs)) return [];
    const deviceName = detailedTicket.deviceLabel.toLowerCase();
    const matchingModels = devicesData.models.filter(
      (m) => m && m.name && (m.name.toLowerCase().includes(deviceName) || deviceName.includes(m.name.toLowerCase()))
    );
    const modelIds = matchingModels.map((m) => m.id).filter(Boolean);
    return devicesData.repairs.filter((r) => r && r.modelIds && r.modelIds.some((mid: string) => modelIds.includes(mid)));
  }, [detailedTicket?.deviceLabel, devicesData]);

  const addPerformedRepair = useCallback(
    (ticketId: string, repair: { name: string; type: "selected" | "manual"; repairId?: string }) => {
      // Mark performed repairs as dirty
      setDirtyFlags((prev) => ({ ...prev, performedRepairs: true }));
      // If repair has repairId, check for linked products and reduce stock, and get price, costs, time, products
      let repairPrice: number | undefined = undefined;
      let repairCosts: number | undefined = undefined;
      let repairTime: number | undefined = undefined;
      let repairProductIds: string[] | undefined = undefined;
      if (repair.repairId) {
        const repairData = devicesData.repairs.find((r) => r.id === repair.repairId);
        if (repairData) {
          repairPrice = repairData.price;
          repairCosts = repairData.costs;
          repairTime = repairData.estimatedTime;
          repairProductIds = repairData.productIds;
        }
        
        const currentInventory = safeLoadInventoryData();
        const productsToReduce = currentInventory.products.filter(
          (p) => p.repairIds && p.repairIds.includes(repair.repairId!)
        );

        if (productsToReduce.length > 0) {
          const lowStockProducts: string[] = [];
          const updatedProducts = currentInventory.products.map((p) => {
            if (p.repairIds && p.repairIds.includes(repair.repairId!)) {
              const newStock = p.stock - 1;
              if (newStock < 1) {
                lowStockProducts.push(p.name);
              }
              return { ...p, stock: Math.max(0, newStock) };
            }
            return p;
          });

          if (lowStockProducts.length > 0) {
            setLowStockProducts(lowStockProducts);
            setLowStockCallback(() => () => {
              safeSaveInventoryData({ ...currentInventory, products: updatedProducts });
            });
            setLowStockDialogOpen(true);
            return;
          }

          safeSaveInventoryData({ ...currentInventory, products: updatedProducts });
        }
      }

      setCloudTickets((prev) =>
        prev.map((t) => {
          if (t.id !== ticketId) return t;
          const newRepair: PerformedRepair = {
            id: `${Date.now()}_${Math.random()}`,
            name: repair.name,
            type: repair.type,
            repairId: repair.repairId,
            price: repairPrice,
            costs: repairCosts,
            estimatedTime: repairTime,
            productIds: repairProductIds,
          };
          return {
            ...t,
            performedRepairs: [...(t.performedRepairs ?? []), newRepair],
          };
        })
      );
    },
    [devicesData]
  );

  const updatePerformedRepairPrice = useCallback((ticketId: string, repairId: string, price: number) => {
    setDirtyFlags((prev) => ({ ...prev, performedRepairs: true }));
    setCloudTickets((prev) =>
      prev.map((t) => {
        if (t.id !== ticketId) return t;
        return {
          ...t,
          performedRepairs: (t.performedRepairs ?? []).map((r) =>
            r.id === repairId ? { ...r, price } : r
          ),
        };
      })
    );
  }, []);

  const updatePerformedRepairCosts = useCallback((ticketId: string, repairId: string, costs: number) => {
    setDirtyFlags((prev) => ({ ...prev, performedRepairs: true }));
    setCloudTickets((prev) =>
      prev.map((t) => {
        if (t.id !== ticketId) return t;
        return {
          ...t,
          performedRepairs: (t.performedRepairs ?? []).map((r) =>
            r.id === repairId ? { ...r, costs } : r
          ),
        };
      })
    );
  }, []);

  const updatePerformedRepairTime = useCallback((ticketId: string, repairId: string, estimatedTime: number) => {
    setDirtyFlags((prev) => ({ ...prev, performedRepairs: true }));
    setCloudTickets((prev) =>
      prev.map((t) => {
        if (t.id !== ticketId) return t;
        return {
          ...t,
          performedRepairs: (t.performedRepairs ?? []).map((r) =>
            r.id === repairId ? { ...r, estimatedTime } : r
          ),
        };
      })
    );
  }, []);

  const updatePerformedRepairProducts = useCallback((ticketId: string, repairId: string, productIds: string[]) => {
    setDirtyFlags((prev) => ({ ...prev, performedRepairs: true }));
    setCloudTickets((prev) =>
      prev.map((t) => {
        if (t.id !== ticketId) return t;
        return {
          ...t,
          performedRepairs: (t.performedRepairs ?? []).map((r) =>
            r.id === repairId ? { ...r, productIds } : r
          ),
        };
      })
    );
  }, []);


  const removePerformedRepair = useCallback((ticketId: string, repairId: string) => {
    setDirtyFlags((prev) => ({ ...prev, performedRepairs: true }));
    setCloudTickets((prev) =>
      prev.map((t) => {
        if (t.id !== ticketId) return t;
        return {
          ...t,
          performedRepairs: (t.performedRepairs ?? []).filter((r) => r.id !== repairId),
        };
      })
    );
  }, []);

  const border = "1px solid var(--border)";
  const borderError = "1px solid rgba(239,68,68,0.9)";

  const inputStyle: React.CSSProperties = useMemo(
    () => ({
      width: 360,
      padding: "10px 12px",
      borderRadius: 12,
      border,
      outline: "none",
      background: "var(--panel)",
      backdropFilter: "var(--blur)",
      WebkitBackdropFilter: "var(--blur)",
      color: "var(--text)",
      fontFamily: "system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif",
      transition: "var(--transition-smooth)",
      boxShadow: "var(--shadow-soft)",
    }),
    [border]
  );

  const primaryBtn: React.CSSProperties = useMemo(
    () => ({
      padding: "12px 16px",
      borderRadius: 16,
      border: "none",
      background: "linear-gradient(135deg, var(--accent), var(--accent-hover))",
      color: "white",
      fontWeight: 600,
      cursor: "pointer",
      fontFamily: "system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif",
      boxShadow: `0 4px 16px var(--accent-glow)`,
      transition: "var(--transition-smooth)",
    }),
    []
  );

  const softBtn: React.CSSProperties = useMemo(
    () => ({
      padding: "12px 16px",
      borderRadius: 16,
      border,
      background: "var(--panel)",
      backdropFilter: "var(--blur)",
      WebkitBackdropFilter: "var(--blur)",
      color: "var(--text)",
      fontWeight: 600,
      cursor: "pointer",
      fontFamily: "system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif",
      transition: "var(--transition-smooth)",
      boxShadow: "var(--shadow-soft)",
    }),
    [border]
  );

  const pillBase: React.CSSProperties = useMemo(
    () => ({
      padding: "10px 16px",
      borderRadius: 20,
      border,
      cursor: "pointer",
      fontSize: 13,
      fontWeight: 600,
      transition: "var(--transition-smooth)",
      fontFamily: "system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif",
      boxShadow: "var(--shadow-soft)",
      background: "var(--panel)",
      backdropFilter: "var(--blur)",
      WebkitBackdropFilter: "var(--blur)",
    }),
    [border]
  );

  const smallPillBase: React.CSSProperties = useMemo(
    () => ({
      padding: "7px 10px",
      borderRadius: 999,
      border,
      cursor: "pointer",
      fontSize: 12,
      fontWeight: 900,
      transition: "transform 120ms ease, background 120ms ease, color 120ms ease",
      fontFamily: "system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif",
    }),
    [border]
  );

  const fieldLabel: React.CSSProperties = useMemo(() => ({ fontSize: 12, color: "var(--muted)", marginTop: 10 }), []);
  const fieldHint: React.CSSProperties = useMemo(() => ({ fontSize: 12, marginTop: 6, color: "rgba(239,68,68,0.95)" }), []);

  const baseFieldInput: React.CSSProperties = useMemo(
    () => ({
      width: "100%",
      padding: "10px 12px",
      borderRadius: 12,
      border,
      outline: "none",
      background: "var(--panel)",
      color: "var(--text)",
      fontFamily: "system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif",
    }),
    [border]
  );

  const baseFieldTextArea: React.CSSProperties = useMemo(
    () => ({
      ...baseFieldInput,
      resize: "vertical",
      minHeight: 88,
      lineHeight: 1.35,
    }),
    [baseFieldInput]
  );

  const card: React.CSSProperties = useMemo(
    () => ({
      border,
      borderRadius: "var(--radius-lg)",
      background: "var(--panel)",
      backdropFilter: "var(--blur)",
      WebkitBackdropFilter: "var(--blur)",
      padding: 12,
      boxShadow: "var(--shadow-soft)",
      color: "var(--text)",
    }),
    [border]
  );

  const openNewOrder = () => {
    setSubmitAttempted(false);
    setIsNewOpen(true);
  };

  const setClaimStatus = async (claimId: string, next: string) => {
    if (!statusKeysSet.has(next)) {
      showToast("Neplatný status pro tento servis (obnovte statusy).", "error");
      return;
    }
    const prev = cloudClaims.find((c) => c.id === claimId);
    const completedAt = isFinal(next) ? new Date().toISOString() : null;
    setCloudClaims((p) =>
      p.map((c) =>
        c.id === claimId ? { ...c, status: next, ...(completedAt ? { completed_at: completedAt } : {}) } : c
      )
    );
    const ok = await updateClaimStatus(claimId, next, completedAt ?? undefined);
    if (!ok && prev) {
      setCloudClaims((p) => p.map((c) => (c.id === claimId ? { ...c, status: prev.status } : c)));
    }
  };

  const startEditingClaim = useCallback(() => {
    if (!detailedClaim) return;
    setEditedClaim({
      customer_name: detailedClaim.customer_name ?? "",
      customer_phone: detailedClaim.customer_phone ?? "",
      customer_email: detailedClaim.customer_email ?? "",
      customer_address_street: detailedClaim.customer_address_street ?? "",
      customer_address_city: detailedClaim.customer_address_city ?? "",
      customer_address_zip: detailedClaim.customer_address_zip ?? "",
      customer_company: detailedClaim.customer_company ?? "",
      customer_ico: detailedClaim.customer_ico ?? "",
      customer_info: detailedClaim.customer_info ?? "",
      device_label: detailedClaim.device_label ?? "",
      device_serial: detailedClaim.device_serial ?? "",
      device_brand: detailedClaim.device_brand ?? "",
      device_model: detailedClaim.device_model ?? "",
      device_condition: detailedClaim.device_condition ?? "",
      device_accessories: detailedClaim.device_accessories ?? "",
      device_note: detailedClaim.device_note ?? "",
      device_passcode: detailedClaim.device_passcode ?? "",
      notes: detailedClaim.notes ?? "",
      resolution_summary: detailedClaim.resolution_summary ?? "",
      status: detailedClaim.status,
      expected_completion_at: detailedClaim.expected_completion_at ?? null,
    });
    setIsEditingClaim(true);
  }, [detailedClaim]);

  /** Uložit pouze zákroky reklamace (bez přepnutí do režimu úprav) */
  const saveClaimResolutionItems = useCallback(
    async (claimId: string, items: ClaimResolutionItem[]): Promise<boolean> => {
      const filtered = items.filter((x) => (x.name || "").trim());
      const payload = { resolution_summary: filtered.length > 0 ? serializeClaimResolutionItems(filtered) : null };
      const updated = await updateClaim(claimId, payload as any);
      if (!updated) return false;
      setCloudClaims((prev) => prev.map((cl) => (cl.id === claimId ? { ...cl, ...updated } : cl)));
      setClaimResolutionDraft(null);
      return true;
    },
    [updateClaim]
  );

  const saveClaimChanges = useCallback(async (): Promise<boolean> => {
    if (!detailedClaim) return false;
    const payload: Record<string, unknown> = {};
    const c = { ...detailedClaim, ...editedClaim };
    if (claimResolutionDraft !== null) {
      const filtered = claimResolutionDraft.filter((x) => (x.name || "").trim());
      payload.resolution_summary = filtered.length > 0 ? serializeClaimResolutionItems(filtered) : null;
    } else if (c.resolution_summary !== undefined) {
      const items = parseClaimResolutionItems(c.resolution_summary || null).filter((x) => (x.name || "").trim());
      payload.resolution_summary = items.length > 0 ? serializeClaimResolutionItems(items) : null;
    }
    if (c.customer_name !== undefined) payload.customer_name = c.customer_name || null;
    if (c.customer_phone !== undefined) payload.customer_phone = c.customer_phone || null;
    if (c.customer_email !== undefined) payload.customer_email = c.customer_email || null;
    if (c.customer_address_street !== undefined) payload.customer_address_street = c.customer_address_street || null;
    if (c.customer_address_city !== undefined) payload.customer_address_city = c.customer_address_city || null;
    if (c.customer_address_zip !== undefined) payload.customer_address_zip = c.customer_address_zip || null;
    if (c.customer_company !== undefined) payload.customer_company = c.customer_company || null;
    if (c.customer_ico !== undefined) payload.customer_ico = c.customer_ico || null;
    if (c.customer_info !== undefined) payload.customer_info = c.customer_info || null;
    if (c.device_label !== undefined) payload.device_label = c.device_label || null;
    if (c.device_serial !== undefined) payload.device_serial = c.device_serial || null;
    if (c.device_brand !== undefined) payload.device_brand = c.device_brand || null;
    if (c.device_model !== undefined) payload.device_model = c.device_model || null;
    if (c.device_condition !== undefined) payload.device_condition = c.device_condition || null;
    if (c.device_accessories !== undefined) payload.device_accessories = c.device_accessories || null;
    if (c.device_note !== undefined) payload.device_note = c.device_note || null;
    if (c.device_passcode !== undefined) payload.device_passcode = c.device_passcode || null;
    if (c.notes !== undefined) payload.notes = c.notes || "";
    if (c.status !== undefined) payload.status = c.status;
    if ("expected_completion_at" in c && (c as any).expected_completion_at !== undefined) payload.expected_completion_at = (c as any).expected_completion_at;
    const updated = await updateClaim(detailedClaim.id, payload as any);
    if (!updated) return false;
    setCloudClaims((prev) => prev.map((cl) => (cl.id === detailedClaim.id ? { ...cl, ...updated } : cl)));
    setIsEditingClaim(false);
    setEditedClaim({});
    setClaimResolutionDraft(null);
    return true;
  }, [detailedClaim, editedClaim, claimResolutionDraft, updateClaim]);

  const setTicketStatus = async (ticketId: string, next: string) => {
    // Guard: check if selectedStatusKey is valid (exists in statuses array)
    if (!statusKeysSet.has(next)) {
      showToast("Neplatný status pro tento servis (obnovte statusy).", "error");
      return;
    }

    const ticket = tickets.find((t) => t.id === ticketId);

    // Optimistic update
    const prevStatus = statusById[ticketId] ?? (ticket?.status as any);
    setStatusById((prev) => ({ ...prev, [ticketId]: next }));
      setCloudTickets((prev) => prev.map((t) => (t.id === ticketId ? ({ ...t, status: next as any } as TicketEx) : t)));

    // Call RPC if supabase is available
    if (supabase) {
      try {
        const { error } = await (supabase as any).rpc("change_ticket_status", {
          p_ticket_id: ticketId,
          p_next: next,
        });

        if (error) {
          console.error("[change_ticket_status] rpc error", error);
          throw error;
        }

        const config = await loadDocumentsConfigFromDB(activeServiceId);
        const ticketUpdated = ticket ? { ...ticket, status: next as any } : tickets.find((t) => t.id === ticketId);
        if (config?.autoPrint && ticketUpdated) {
          if (config.autoPrint.ticketListOnStatusKey === next) {
            printTicket(ticketUpdated as TicketEx, activeServiceId).then(() => {});
          }
          if (config.autoPrint.warrantyOnStatusKey === next) {
            printWarranty(ticketUpdated as TicketEx, activeServiceId).then(() => {});
          }
        }
        // SMS automations: send template message when status changes
        if (ticketUpdated && (ticketUpdated as TicketEx).customerPhone?.trim()) {
          const { data: automations } = await supabase
            .from("sms_automations")
            .select("id, message_template")
            .eq("service_id", activeServiceId)
            .eq("trigger_status_key", next)
            .eq("active", true);
          const statusLabel = statuses.find((s) => s.key === next)?.label ?? next;
          const totalPrice = computeFinalPrice(toCardData(ticketUpdated as (typeof filtered)[number]));
          const vars: Record<string, string> = {
            code: (ticketUpdated as TicketEx).code ?? "",
            customer_name: (ticketUpdated as TicketEx).customerName ?? "",
            device_label: (ticketUpdated as TicketEx).deviceLabel ?? "",
            total_price: String(totalPrice),
            status: statusLabel,
            notes: (ticketUpdated as TicketEx).issueShort ?? "",
          };
          const phoneNorm = normalizePhone((ticketUpdated as TicketEx).customerPhone!);
          if (automations?.length && phoneNorm) {
            const { data: sessionData } = await supabase.auth.getSession();
            const token = sessionData?.session?.access_token;
            if (token) {
              for (const a of automations) {
                const body = (a.message_template || "").replace(/\{\{(\w+)\}\}/g, (_, k) => vars[k] ?? "");
                if (!body.trim()) continue;
                supabaseFetch(`${supabaseUrl}/functions/v1/sms-send`, {
                  method: "POST",
                  headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
                  body: JSON.stringify({
                    service_id: activeServiceId,
                    to: phoneNorm,
                    body,
                    ticket_id: ticketId,
                  }),
                }).then(async (res) => {
                  const raw = await res.text();
                  let data: { error?: string } = {};
                  try { if (raw) data = JSON.parse(raw); } catch { }
                  if (!res.ok || data.error) showToast(data.error ?? "SMS automatizace se nepodařila odeslat", "error");
                }).catch(() => showToast("SMS automatizace se nepodařila odeslat", "error"));
              }
            }
          }
        }
      } catch (err: any) {
        // Rollback optimistic update
        setStatusById((prev) => {
          const next = { ...prev };
          if (prevStatus) {
            next[ticketId] = prevStatus;
          } else {
            delete next[ticketId];
          }
          return next;
        });
        setCloudTickets((prev) => prev.map((t) => (t.id === ticketId ? ({ ...t, status: prevStatus as any } as TicketEx) : t)));

        console.error("[change_ticket_status] error", err);
        const errorMessage = err?.message || "Neznámá chyba";
        if (errorMessage.includes("Not authorized") || errorMessage.includes("permission")) {
          showToast("Nemáš oprávnění měnit status zakázky", "error");
        } else {
        showToast(`Chyba při změně statusu: ${errorMessage}`, "error");
        }
      }
    }
  };


  const saveTicketChanges = useCallback(async (): Promise<boolean> => {
    if (!detailedTicket) {
      return false;
    }
    if (uiCfg.orders.customerPhoneRequired && !(editedTicket.customerPhone ?? detailedTicket.customerPhone ?? "").trim()) {
      showToast("Telefon zákazníka je povinný. Vyplňte ho před uložením.", "error");
      return false;
    }

    return saveTicketChangesAction({
      detailedTicket,
      editedTicket,
      onSuccess: (updatedTicket) => {
        setIsEditing(false);
        setEditedTicket({});
        // Aktualizovat původní hodnotu po úspěšném uložení
        originalTicketRef.current = JSON.parse(JSON.stringify(updatedTicket));
        // Reset dirty flags after successful save
        setDirtyFlags({
          diagnosticText: false,
          diagnosticPhotos: false,
          performedRepairs: false,
        });
      },
    });
  }, [detailedTicket, editedTicket, saveTicketChangesAction, activeServiceId, uiCfg.orders.customerPhoneRequired]);

  const handleCloseDetail = useCallback(async () => {
    devLog("[Close] clicked - about to save?");
    
    const hasEditingChanges = isEditing && Object.keys(editedTicket).length > 0;
    const hasEditingClaimChanges = isEditingClaim && Object.keys(editedClaim).length > 0;
    
    if (hasEditingChanges || hasEditingClaimChanges) {
      showToast("Máte neuložené změny. Uložte nebo zrušte úpravy.", "error");
      return;
    }

    const hasDirtyAutoSave = dirtyFlags.diagnosticText || dirtyFlags.diagnosticPhotos || dirtyFlags.performedRepairs;
    if (hasDirtyAutoSave) {
      try {
        const saved = await saveTicketChanges();
        if (!saved) {
          return;
        }
        showToast("Změny uloženy", "success");
      } catch (err) {
        showToast("Chyba při ukládání změn: " + (err instanceof Error ? err.message : "Neznámá chyba"), "error");
        return;
      }
    }

    const page = returnToPage;
    const customerId = returnToCustomerIdRef.current;
    setDetailId(null);
    setDetailClaimId(null);
    setIsEditingClaim(false);
    setEditedClaim({});
    setReturnToPage(null);
    returnToCustomerIdRef.current = undefined;
    if (page && onReturnToPage) {
      onReturnToPage(page, customerId);
    }
  }, [saveTicketChanges, returnToPage, onReturnToPage, dirtyFlags, isEditing, editedTicket, isEditingClaim, editedClaim]);

  // Escape: zavřít detail/modal; v capture phase + preventDefault, aby v fullscreen neukončil fullscreen
  useEffect(() => {
    const onKey = async (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      const hasSomethingToClose = smsPanelOpen || ticketHistoryModalOpen || claimHistoryModalOpen || !!detailId || !!detailClaimId || isNewOpen;
      if (!hasSomethingToClose) return;
      e.preventDefault();
      e.stopPropagation();
      if (smsPanelOpen) {
        setSmsPanelOpen(false);
        return;
      }
      if (ticketHistoryModalOpen) {
        setTicketHistoryModalOpen(false);
        return;
      }
      if (claimHistoryModalOpen) {
        setClaimHistoryModalOpen(false);
        return;
      }
      if (detailId || detailClaimId) {
        await handleCloseDetail();
      } else if (isNewOpen) {
        setIsNewOpen(false);
        setCustomerMatchDecision("undecided");
        setMatchedCustomer(null);
        lastLookupPhoneNormRef.current = null;
        if (phoneLookupDebounceTimerRef.current) {
          clearTimeout(phoneLookupDebounceTimerRef.current);
          phoneLookupDebounceTimerRef.current = null;
        }
      }
    };
    window.addEventListener("keydown", onKey, true);
    document.addEventListener("keydown", onKey, true);
    return () => {
      window.removeEventListener("keydown", onKey, true);
      document.removeEventListener("keydown", onKey, true);
    };
  }, [smsPanelOpen, detailId, detailClaimId, isNewOpen, ticketHistoryModalOpen, claimHistoryModalOpen, handleCloseDetail]);

  // Zamykání scrollu za modalem – body i hlavní oblast (main) scrollují, obě musí být zamčené
  useEffect(() => {
    if (!detailId && !detailClaimId) return;
    const prevBody = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const main = document.querySelector("main");
    if (main instanceof HTMLElement) {
      main.style.overflow = "hidden";
    }
    return () => {
      document.body.style.overflow = prevBody;
      if (main instanceof HTMLElement) {
        main.style.overflow = "auto";
      }
    };
  }, [detailId, detailClaimId]);

  useEffect(() => {
    setClaimResolutionDraft(null);
  }, [detailClaimId]);

  useEffect(() => {
    if (!detailedTicket) return;
    const onKey = (e: KeyboardEvent) => {
      if (comboMatchesEvent(e, getShortcut("order_print"))) {
        e.preventDefault();
        const uid = session?.user?.id;
        if (uid) checkAchievementOnShortcutUsed(uid);
        printTicket(detailedTicket, activeServiceId);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [detailedTicket, activeServiceId, session?.user?.id]);

  // Enter v náhledu zakázky při úpravách = Uložit a zavřít (kromě textarea, kde Enter = nový řádek)
  useEffect(() => {
    if (!detailId || !isEditing) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Enter") return;
      const target = e.target as Node | null;
      if (target && typeof (target as HTMLElement).tagName === "string" && (target as HTMLElement).tagName === "TEXTAREA") return;
      e.preventDefault();
      saveTicketChanges().then((ok) => {
        if (!ok) return;
        showToast("Změny uloženy", "success");
        const page = returnToPage;
        const customerId = returnToCustomerIdRef.current;
        setDetailId(null);
        setReturnToPage(null);
        returnToCustomerIdRef.current = undefined;
        if (page && onReturnToPage) onReturnToPage(page, customerId);
      });
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [detailId, isEditing, saveTicketChanges, returnToPage, onReturnToPage]);

  const startEditing = useCallback(() => {
    if (!detailedTicket) return;
    setEditedTicket({
      customerName: detailedTicket.customerName,
      customerPhone: detailedTicket.customerPhone || "",
      customerEmail: detailedTicket.customerEmail || "",
      customerAddressStreet: detailedTicket.customerAddressStreet || "",
      customerAddressCity: detailedTicket.customerAddressCity || "",
      customerAddressZip: detailedTicket.customerAddressZip || "",
      customerCompany: detailedTicket.customerCompany || "",
      customerIco: detailedTicket.customerIco || "",
      customerInfo: detailedTicket.customerInfo || "",
      deviceLabel: detailedTicket.deviceLabel,
      serialOrImei: detailedTicket.serialOrImei || "",
      devicePasscode: detailedTicket.devicePasscode || "",
      deviceCondition: detailedTicket.deviceCondition || "",
      deviceAccessories: detailedTicket.deviceAccessories || "",
      requestedRepair: detailedTicket.requestedRepair || detailedTicket.issueShort || "",
      handoffMethod: detailedTicket.handoffMethod || "",
      handbackMethod: detailedTicket.handbackMethod || "",
      deviceNote: detailedTicket.deviceNote || "",
      externalId: detailedTicket.externalId || "",
      expectedCompletionAt: (detailedTicket as any).expected_completion_at ?? null,
    } as any);
    setIsEditing(true);
  }, [detailedTicket]);

  useEffect(() => {
    openNewOrderRef.current = openNewOrder;
    startEditingRef.current = startEditing;
    saveTicketChangesRef.current = saveTicketChanges;
  });

  // Zkratky stránky Zakázky a detailu (capture, aby Ctrl+S v detailu měl přednost před globální navigací)
  // Na přehledu zakázek také přímo obsloužíme Q/S/D/C atd. (vlastní událost), aby fungovaly i když window keydown nedojde
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (comboMatchesEvent(e, getShortcut("orders_search"))) {
        e.preventDefault();
        e.stopPropagation();
        if (session?.user?.id) checkAchievementOnShortcutUsed(session.user.id);
        searchInputRef.current?.focus();
        return;
      }
      if (isInputFocused()) return;
      if (comboMatchesEvent(e, getShortcut("orders_new"))) {
        e.preventDefault();
        e.stopPropagation();
        if (session?.user?.id) checkAchievementOnShortcutUsed(session.user.id);
        openNewOrderRef.current();
        return;
      }
      if (detailId && !isEditing && comboMatchesEvent(e, getShortcut("order_detail_edit"))) {
        e.preventDefault();
        e.stopPropagation();
        if (session?.user?.id) checkAchievementOnShortcutUsed(session.user.id);
        startEditingRef.current();
        return;
      }
      if (detailId && isEditing && comboMatchesEvent(e, getShortcut("order_detail_save"))) {
        e.preventDefault();
        e.stopPropagation();
        if (session?.user?.id) checkAchievementOnShortcutUsed(session.user.id);
        saveTicketChangesRef.current();
        return;
      }
    };
    const doc = document;
    doc.addEventListener("keydown", onKey, true);
    window.addEventListener("keydown", onKey, true);
    return () => {
      doc.removeEventListener("keydown", onKey, true);
      window.removeEventListener("keydown", onKey, true);
    };
  }, [detailId, isEditing, session?.user?.id]);

  const errors = useMemo(() => {
    const e: Record<string, string> = {};
    newDraft.devices.forEach((dev, i) => {
      if (!dev.deviceLabel.trim()) e[`deviceLabel_${i}`] = "Vyplň zařízení.";
    });
    const phoneRequired = uiCfg.orders.customerPhoneRequired;
    if (phoneRequired && !newDraft.customerPhone.trim()) e.customerPhone = "Telefon je povinný.";
    else if (!isPhoneValid(newDraft.customerPhone)) e.customerPhone = "Telefon vypadá neplatně.";
    if (!isEmailValid(newDraft.customerEmail)) e.customerEmail = "E-mail vypadá neplatně.";
    if (!isZipValid(newDraft.addressZip)) e.addressZip = "PSČ musí mít 5 číslic.";
    if (!isIcoValid(newDraft.ico)) e.ico = "IČO musí mít 8 číslic.";
    return e;
  }, [newDraft, uiCfg.orders.customerPhoneRequired]);

  const canCreate = Object.keys(errors).length === 0;
  const showError = (field: string) => submitAttempted && !!errors[field];
  const showDeviceError = (idx: number) => submitAttempted && !!errors[`deviceLabel_${idx}`];

  const createTicket = () => {
    setSubmitAttempted(true);
    if (!canCreate) {
      return;
    }

    createTicketAction({
      newDraft,
      customerMatchDecision,
      draftCaptureToken: draftCaptureTokenRef.current ?? undefined,
      onSuccess: async (tickets) => {
        draftCaptureTokenRef.current = null;
        setDraftCapturePreviewUrls([]);
        setDraftCaptureLiveCount(0);
        setNewDraft(defaultDraft());
        setIsNewOpen(false);
        setSubmitAttempted(false);
        setCustomerMatchDecision("undecided");
        setMatchedCustomer(null);
        lastLookupPhoneNormRef.current = null;
        if (phoneLookupDebounceTimerRef.current) {
          clearTimeout(phoneLookupDebounceTimerRef.current);
          phoneLookupDebounceTimerRef.current = null;
        }
        safeSaveDraft(null);
        window.dispatchEvent(new CustomEvent("jobsheet:draft-count", { detail: { count: 0 } }));
        const first = tickets[0];
        if (first) setDetailId(first.id);
        const config = await loadDocumentsConfigFromDB(activeServiceId);
        if (first && config?.autoPrint?.ticketListOnCreate) {
          printTicket(first, activeServiceId).then(() => {});
        }
        if (first && config?.autoPrint?.warrantyOnCreate) {
          printWarranty(first, activeServiceId).then(() => {});
        }
      },
    });
  };

  const loadDraftCapturePreviews = useCallback(async (showAddedToast: boolean = true) => {
    const draftToken = draftCaptureTokenRef.current;
    if (!draftToken || !supabase || !supabaseUrl || !supabaseAnonKey) return;
    try {
      const authToken = (await supabase.auth.getSession()).data?.session?.access_token;
      if (!authToken) return;
      const res = await supabaseFetch(`${supabaseUrl}/functions/v1/capture-list-draft`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${authToken}`, apikey: supabaseAnonKey },
        body: JSON.stringify({ token: draftToken }),
      });
      const raw = await res.text();
      const data: { urls?: string[]; error?: string } = raw ? JSON.parse(raw) : {};
      if (!res.ok) throw new Error(data.error || res.statusText);
      if (Array.isArray(data.urls)) {
        setDraftCaptureLiveCount(data.urls.length);
        setDraftCapturePreviewUrls((prev) => {
          const added = Math.max(0, data.urls!.length - prev.length);
          if (showAddedToast && added > 0) {
            const suffix = added === 1 ? "fotka" : added >= 2 && added <= 4 ? "fotky" : "fotek";
            showToast(`Načteno ${added} ${suffix} z mobilu`, "success");
          }
          return data.urls!;
        });
      }
    } catch (err) {
      console.warn("[Orders] loadDraftCapturePreviews failed", err);
    }
  }, []);

  const closeCaptureQrModal = useCallback(() => {
    setCaptureQRItems(null);
    void loadDraftCapturePreviews(true);
  }, [loadDraftCapturePreviews]);

  useEffect(() => {
    if (!captureQRItems || !draftCaptureTokenRef.current) return;
    void loadDraftCapturePreviews(false);
    const t = setInterval(() => {
      void loadDraftCapturePreviews(false);
    }, 3000);
    return () => clearInterval(t);
  }, [captureQRItems, loadDraftCapturePreviews]);

  const commentsFor = (ticketId: string): TicketComment[] => {
    const map = safeLoadCommentsMap();
    const all = (map[ticketId] ?? []).slice();

    all.sort((a, b) => {
      const ap = !!a.pinned;
      const bp = !!b.pinned;
      if (ap !== bp) return ap ? -1 : 1;
      return (a.createdAt ?? "").localeCompare(b.createdAt ?? "");
    });

    return all;
  };

  const addComment = (ticketId: string) => {
    const text = (commentDraftByTicket[ticketId] ?? "").trim();
    if (!text) return;

    const map = safeLoadCommentsMap();
    const list = map[ticketId] ?? [];

    const displayName = userProfile?.nickname?.trim() || session?.user?.email?.split("@")[0] || "Servis";
    const c: TicketComment = {
      id: uuid(),
      ticketId,
      author: displayName,
      text,
      createdAt: new Date().toISOString(),
      pinned: false,
      author_id: session?.user?.id ?? null,
      author_nickname: userProfile?.nickname?.trim() || null,
      author_avatar_url: userProfile?.avatarUrl?.trim() || null,
    };

    map[ticketId] = [...list, c];
    safeSaveCommentsMap(map);

    setCommentDraftByTicket((p) => ({ ...p, [ticketId]: "" }));
  };

  const togglePin = (ticketId: string, commentId: string) => {
    const map = safeLoadCommentsMap();
    const list = map[ticketId] ?? [];
    map[ticketId] = list.map((c) => (c.id === commentId ? { ...c, pinned: !c.pinned } : c));
    safeSaveCommentsMap(map);
    setCommentDraftByTicket((p) => ({ ...p }));
  };

  const toCardData = useCallback((t: (typeof filtered)[number]): TicketCardData => ({
    id: t.id,
    code: t.code,
    customerName: t.customerName,
    customerPhone: t.customerPhone,
    deviceLabel: t.deviceLabel,
    serialOrImei: t.serialOrImei,
    issueShort: t.issueShort,
    requestedRepair: t.requestedRepair,
    createdAt: t.createdAt,
    status: (t.status as any) ?? statusById[t.id] ?? null,
    discountType: t.discountType,
    discountValue: t.discountValue,
    performedRepairs: t.performedRepairs,
    expectedDoneAt: t.expectedDoneAt,
  }), [statusById]);

  const renderStatusPicker = useCallback((ticketId: string, currentStatus: string | null) => {
    if (currentStatus !== null) {
      return <StatusPicker value={currentStatus} statuses={statuses as any} getByKey={getByKey as any} onChange={(next) => setTicketStatus(ticketId, next)} size="sm" />;
    }
    return <div style={{ fontSize: 11, padding: "4px 8px", borderRadius: 6, background: "var(--panel-2)", color: "var(--muted)", fontWeight: 600 }}>…</div>;
  }, [statuses, getByKey, setTicketStatus]);

  const renderPrintButton = useCallback((t: TicketCardData, small?: boolean) => {
    if (!canPrintExport) return null;
    const sz = small ? 26 : 32;
    return (
      <button
        type="button"
        data-quick-print-trigger-id={t.id}
        onClick={(e) => { e.stopPropagation(); setOpenQuickPrintTicket((prev: any) => (prev?.id === t.id ? null : t as any)); }}
        title="Tisk"
        style={{ display: "flex", alignItems: "center", justifyContent: "center", width: sz, height: sz, minWidth: sz, minHeight: sz, borderRadius: small ? 6 : 8, border: "1px solid var(--border)", background: "var(--panel)", color: "var(--text)", cursor: "pointer", fontSize: small ? 12 : 14, flexShrink: 0 }}
      >🖨️</button>
    );
  }, [canPrintExport, setOpenQuickPrintTicket]);

  const smsBadge = (ticketId: string) => {
    const n = smsUnreadByTicketId[ticketId] ?? 0;
    if (n <= 0) return null;
    return (
      <span
        style={{
          position: "absolute",
          top: -8,
          right: -8,
          minWidth: 20,
          height: 20,
          borderRadius: "50%",
          background: "#FF3B30",
          color: "#fff",
          fontSize: 11,
          fontWeight: 700,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          padding: "0 6px",
          zIndex: 1,
        }}
      >
        {n > 99 ? "99+" : n}
      </span>
    );
  };

  const renderTicketCard = (t: (typeof filtered)[number]) => {
    const raw = (t.status as any) ?? statusById[t.id];
    const currentStatus = normalizeStatus(raw);
    const meta = currentStatus !== null ? getByKey(currentStatus) : null;
    const cardData = toCardData(t);
    const mode = uiCfg.orders.displayMode;
    const onClick = () => { setDetailId(t.id); setDetailClaimId(null); };
    const statusNode = renderStatusPicker(t.id, currentStatus);
    const metaOrNull = meta ?? null;
    const wrap = (node: React.ReactNode) =>
      (smsUnreadByTicketId[t.id] ?? 0) > 0 ? (
        <div key={t.id} style={{ position: "relative" }}>
          {smsBadge(t.id)}
          {node}
        </div>
      ) : (
        <React.Fragment key={t.id}>{node}</React.Fragment>
      );

    switch (mode) {
      case "compact":
        return wrap(<TicketCardCompact ticket={cardData} meta={metaOrNull} onClick={onClick} statusPicker={statusNode} printButton={renderPrintButton(cardData, true)} />);
      case "compact-extra":
        return wrap(<TicketCardCompactExtra ticket={cardData} meta={metaOrNull} onClick={onClick} statusPicker={statusNode} printButton={renderPrintButton(cardData, true)} />);
      case "grid":
        return wrap(<TicketCardGrid ticket={cardData} meta={metaOrNull} onClick={onClick} statusPicker={statusNode} printButton={renderPrintButton(cardData, true)} />);
      case "cards-modern":
        return wrap(<TicketCardModern ticket={cardData} meta={metaOrNull} onClick={onClick} statusPicker={statusNode} printButton={renderPrintButton(cardData, true)} />);
      case "split":
        return wrap(<TicketCardSplit ticket={cardData} meta={metaOrNull} onClick={onClick} statusPicker={statusNode} printButton={renderPrintButton(cardData, true)} />);
      case "stripe":
        return wrap(<TicketCardStripe ticket={cardData} meta={metaOrNull} onClick={onClick} statusPicker={statusNode} printButton={renderPrintButton(cardData, true)} />);
      case "list":
      default:
        return wrap(<TicketCardList ticket={cardData} meta={metaOrNull} onClick={onClick} statusPicker={statusNode} printButton={renderPrintButton(cardData, true)} />);
    }
  };

  const renderClaimCard = (c: any, keyPrefix = "") => {
    const rawStatus = (c.status as string | null) ?? "";
    const currentStatus = normalizeStatus(rawStatus);
    const claimMeta = currentStatus !== null ? getByKey(currentStatus) : null;
    const statusColor = claimMeta?.bg || "var(--border)";
    const isSmall = uiCfg.orders.displayMode === "compact" || uiCfg.orders.displayMode === "compact-extra";
    const claimAsCardData: TicketCardData = {
      id: c.id, code: c.code, customerName: c.customer_name ?? "—",
      deviceLabel: c.device_label ?? "—", issueShort: c.notes ?? "",
      createdAt: c.created_at ?? "", status: c.status,
    };
    return (
      <ClaimCard
        key={`${keyPrefix}${c.id}`}
        claim={c}
        displayMode={uiCfg.orders.displayMode}
        statusColor={statusColor}
        statusLabel={claimMeta?.label}
        onClick={() => { setDetailClaimId(c.id); setDetailId(null); }}
        statusPicker={<StatusPicker value={c.status} statuses={statuses as any} getByKey={getByKey as any} onChange={(next) => setClaimStatus(c.id, next)} size="sm" />}
        printButton={renderPrintButton(claimAsCardData, isSmall)}
      />
    );
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      {/* Header */}
      <div>
        <div style={{ fontSize: 22, fontWeight: 950, color: "var(--text)" }}>Zakázky</div>
        <div style={{ fontSize: 13, color: "var(--muted)", marginTop: 4 }}>
          Spravujte zakázky, sledujte stavy a komunikujte se zákazníky
        </div>
      </div>

      {/* Toolbar */}
      <div style={{ display: "flex", justifyContent: "space-between", gap: 16, alignItems: "flex-start" }}>
        <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap", flex: 1 }}>
          <input ref={searchInputRef} data-tour="orders-search" placeholder="Vyhledávání…" value={query} onChange={(e) => setQuery(e.target.value)} style={inputStyle} />
          <button data-tour="orders-new-btn" style={primaryBtn} onClick={openNewOrder}>
            + Nová zakázka
          </button>
          <button
            data-tour="orders-new-claim-btn"
            type="button"
            style={primaryBtn}
            onClick={() => setCreateClaimModalOpen(true)}
          >
            + Nová reklamace
          </button>
        </div>
      </div>

      {/* Group tabs */}
      <div data-tour="orders-groups" style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
        {[
          { key: "all" as const, label: "Vše" },
          { key: "active" as const, label: "Aktivní" },
          { key: "final" as const, label: "Final" },
          { key: "reklamace" as const, label: "Reklamace" },
        ].map((g) => {
          const active = g.key === activeGroup;
          return (
            <button
              key={g.key}
              onClick={() => setActiveGroup(g.key)}
              style={{
                ...pillBase,
                background: active ? "var(--accent-soft)" : "var(--panel)",
                color: active ? "var(--accent)" : "var(--text)",
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.transform = "scale(1.05) translateY(-1px)";
                e.currentTarget.style.boxShadow = "0 4px 16px rgba(0,0,0,0.15)";
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.transform = "scale(1.0) translateY(0)";
                e.currentTarget.style.boxShadow = "0 2px 8px rgba(0,0,0,0.1)";
              }}
            >
              {g.label}
            </button>
          );
        })}
      </div>

      {/* Reklamace sub-filter: Aktivní / Final */}
      {activeGroup === "reklamace" && (
        <div data-tour="orders-claims-subfilter" style={{ marginTop: 10, display: "flex", flexWrap: "wrap", gap: 8 }}>
          {[
            { key: "all" as const, label: "Vše" },
            { key: "active" as const, label: "Aktivní" },
            { key: "final" as const, label: "Final" },
          ].map((g) => {
            const active = g.key === claimsSubGroup;
            return (
              <button
                key={g.key}
                onClick={() => setClaimsSubGroup(g.key)}
                style={{
                  padding: "6px 12px",
                  borderRadius: 10,
                  border: "1px solid var(--border)",
                  background: active ? "var(--accent-soft)" : "var(--panel)",
                  color: active ? "var(--accent)" : "var(--text)",
                  fontWeight: active ? 700 : 500,
                  fontSize: 13,
                  cursor: "pointer",
                  fontFamily: "system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif",
                  boxShadow: "var(--shadow-soft)",
                  transition: "var(--transition-smooth)",
                }}
                onMouseEnter={(e) => {
                  if (!active) e.currentTarget.style.background = "var(--panel-2)";
                }}
                onMouseLeave={(e) => {
                  if (!active) e.currentTarget.style.background = "var(--panel)";
                }}
              >
                {g.label}
              </button>
            );
          })}
        </div>
      )}

      {/* Secondary quick status filters */}
      {showSecondaryFiltersRow && (
        <div data-tour="orders-filters" style={{ marginTop: 10, display: "flex", flexWrap: "wrap", gap: 8 }}>
          <button
            onClick={() => setActiveStatusKey(null)}
            style={{
              ...smallPillBase,
              background: activeStatusKey === null ? "var(--panel-2)" : "var(--panel)",
              color: activeStatusKey === null ? "var(--text)" : "var(--muted)",
            }}
            onMouseEnter={(e) => (e.currentTarget.style.transform = "scale(1.01)")}
            onMouseLeave={(e) => (e.currentTarget.style.transform = "scale(1.0)")}
          >
            Všechny stavy
          </button>

          {quickStatuses.map((s) => {
            const active = s.key === activeStatusKey;
            return (
              <button
                key={s.key}
                onClick={() => setActiveStatusKey(s.key)}
                style={{
                  ...smallPillBase,
                  background: active ? "var(--panel-2)" : "var(--panel)",
                  color: "var(--text)",
                  opacity: active ? 1 : 0.9,
                }}
                onMouseEnter={(e) => (e.currentTarget.style.transform = "scale(1.01)")}
                onMouseLeave={(e) => (e.currentTarget.style.transform = "scale(1.0)")}
                title={s.label}
              >
                {s.label}
              </button>
            );
          })}
        </div>
      )}

      {/* Loading/Error states */}
      {statusesLoading && (
        <div style={{ padding: 24, textAlign: "center", color: "var(--muted)" }}>
          Načítání statusů...
        </div>
      )}
      {statusesError && (
        <div style={{ padding: 24, textAlign: "center", color: "rgba(239,68,68,0.9)", background: "rgba(239,68,68,0.1)", borderRadius: 12, border: "1px solid rgba(239,68,68,0.3)" }}>
          Chyba při načítání statusů: {statusesError}
        </div>
      )}
      {ticketsLoading && (
        <div style={{ padding: 24, textAlign: "center", color: "var(--muted)" }}>
          Načítání zakázek...
        </div>
      )}
      {ticketsError && activeGroup !== "reklamace" && (
        <div style={{ padding: 24, textAlign: "center", color: "rgba(239,68,68,0.9)", background: "rgba(239,68,68,0.1)", borderRadius: 12, border: "1px solid rgba(239,68,68,0.3)" }}>
          {ticketsError}
        </div>
      )}
      {claimsLoading && activeGroup === "reklamace" && (
        <div style={{ padding: 24, textAlign: "center", color: "var(--muted)" }}>Načítání reklamací…</div>
      )}
      {claimsError && (
        <div style={{ padding: 24, textAlign: "center", color: "rgba(239,68,68,0.9)", background: "rgba(239,68,68,0.1)", borderRadius: 12, border: "1px solid rgba(239,68,68,0.3)" }}>
          {claimsError}
        </div>
      )}

      {/* List/Grid - only render if statuses are ready and not loading and no error */}
      {statusesReady && (activeGroup === "reklamace" ? !claimsLoading && !claimsError : !ticketsLoading && !ticketsError) && (
      <div data-tour="orders-list" style={{ 
        marginTop: 16, 
        ...(uiCfg.orders.displayMode === "table" || uiCfg.orders.displayMode === "timeline" || uiCfg.orders.displayMode === "status-grouped"
          ? { minWidth: 0 }
          : {
              display: "grid",
              gridTemplateColumns: uiCfg.orders.displayMode === "grid" || uiCfg.orders.displayMode === "cards-modern" ? "repeat(auto-fill, minmax(280px, 1fr))" : uiCfg.orders.displayMode === "split" ? "repeat(auto-fill, minmax(400px, 1fr))" : "minmax(260px, 1fr)",
              gap: uiCfg.orders.displayMode === "grid" || uiCfg.orders.displayMode === "cards-modern" ? 12 : uiCfg.orders.displayMode === "compact-extra" || uiCfg.orders.displayMode === "stripe" ? 2 : 6,
              minWidth: 0,
            }),
      }}>
        {/* Table / Timeline: full-container views rendered here */}
        {activeGroup !== "reklamace" && uiCfg.orders.displayMode === "table" && (
          <TicketTable
            tickets={paginatedTickets.map(toCardData)}
            getByKey={getByKey as any}
            normalizeStatus={normalizeStatus}
            onClickDetail={(id) => { setDetailId(id); setDetailClaimId(null); }}
            statusPickerFor={(t, st) => renderStatusPicker(t.id, st)}
            smsUnreadByTicketId={smsUnreadByTicketId}
          />
        )}
        {activeGroup !== "reklamace" && uiCfg.orders.displayMode === "timeline" && (
          <TicketTimeline
            tickets={paginatedTickets.map(toCardData)}
            getByKey={getByKey as any}
            normalizeStatus={normalizeStatus}
            onClickDetail={(id) => { setDetailId(id); setDetailClaimId(null); }}
            smsUnreadByTicketId={smsUnreadByTicketId}
          />
        )}
        {activeGroup !== "reklamace" && uiCfg.orders.displayMode === "status-grouped" && (
          showClaimsInOrdersList ? (
            <CombinedStatusGrouped
              tickets={combinedList.filter((r) => r.type === "ticket").map((r) => toCardData((r as { type: "ticket"; data: (typeof filtered)[number] }).data))}
              claims={combinedList.filter((r) => r.type === "claim").map((r) => (r as { type: "claim"; data: WarrantyClaimRow }).data)}
              statuses={statuses as any}
              normalizeStatus={normalizeStatus}
              onClickTicket={(id) => { setDetailId(id); setDetailClaimId(null); }}
              onClickClaim={(id) => { setDetailClaimId(id); setDetailId(null); }}
              statusPickerForTicket={(t, st) => renderStatusPicker(t.id, st)}
              statusPickerForClaim={(c) => <StatusPicker value={c.status ?? ""} statuses={statuses as any} getByKey={getByKey as any} onChange={(next) => setClaimStatus(c.id, next)} size="sm" />}
              printButtonForTicket={(t) => renderPrintButton(t, true)}
              printButtonForClaim={(c) => renderPrintButton({ id: c.id, code: c.code, customerName: c.customer_name ?? "—", deviceLabel: c.device_label ?? "—", issueShort: c.notes ?? "", createdAt: c.created_at ?? "", status: c.status }, true)}
              customOrder={uiCfg.orders.statusGroupedOrder}
              smsUnreadByTicketId={smsUnreadByTicketId}
            />
          ) : (
            <TicketStatusGrouped
              tickets={filtered.map(toCardData)}
              statuses={statuses as any}
              normalizeStatus={normalizeStatus}
              onClickDetail={(id) => { setDetailId(id); setDetailClaimId(null); }}
              statusPickerFor={(t, st) => renderStatusPicker(t.id, st)}
              printButtonFor={(t) => renderPrintButton(t, true)}
              customOrder={uiCfg.orders.statusGroupedOrder}
              smsUnreadByTicketId={smsUnreadByTicketId}
            />
          )
        )}
        {activeGroup === "reklamace" && uiCfg.orders.displayMode === "status-grouped" && (
          <ClaimStatusGrouped
            claims={paginatedClaims}
            statuses={statuses as any}
            normalizeStatus={normalizeStatus}
            onClickDetail={(id) => { setDetailClaimId(id); setDetailId(null); }}
            statusPickerFor={(c) => <StatusPicker value={c.status ?? ""} statuses={statuses as any} getByKey={getByKey as any} onChange={(next) => setClaimStatus(c.id, next)} size="sm" />}
            printButtonFor={(c) => renderPrintButton({ id: c.id, code: c.code, customerName: c.customer_name ?? "—", deviceLabel: c.device_label ?? "—", issueShort: c.notes ?? "", createdAt: c.created_at ?? "", status: c.status }, true)}
            customOrder={uiCfg.orders.statusGroupedOrder}
          />
        )}
        {/* Card-based modes: render individual cards (skip if table/timeline/status-grouped already rendered above) */}
        {activeGroup === "reklamace" && uiCfg.orders.displayMode !== "table" && uiCfg.orders.displayMode !== "timeline" && uiCfg.orders.displayMode !== "status-grouped"
          ? paginatedClaims.map((c) => renderClaimCard(c))
          : uiCfg.orders.displayMode !== "table" && uiCfg.orders.displayMode !== "timeline" && uiCfg.orders.displayMode !== "status-grouped" && showClaimsInOrdersList
            ? paginatedCombined.map((row) =>
                row.type === "claim"
                  ? renderClaimCard(row.data, "claim-")
                  : renderTicketCard(row.data)
              )
          : uiCfg.orders.displayMode !== "table" && uiCfg.orders.displayMode !== "timeline" && uiCfg.orders.displayMode !== "status-grouped"
            ? paginatedTickets.map((t) => renderTicketCard(t))
            : null
        }

        {pageSize > 0 && listLength > pageSize && (() => {
          const from = ordersPage * effectivePageSize + 1;
          const to = Math.min((ordersPage + 1) * effectivePageSize, listLength);
          const label = activeGroup === "reklamace" ? "reklamací" : "zakázek";
          const maxPageButtons = 7;
          const showPageNumbers = totalOrdersPages <= maxPageButtons;
          const getPageNumbers = (): number[] => {
            if (totalOrdersPages <= maxPageButtons) {
              return Array.from({ length: totalOrdersPages }, (_, i) => i);
            }
            const cur = ordersPage;
            const last = totalOrdersPages - 1;
            const pages: number[] = [0];
            if (cur > 2) pages.push(-1);
            for (let i = Math.max(1, cur - 1); i <= Math.min(last - 1, cur + 1); i++) {
              if (!pages.includes(i)) pages.push(i);
            }
            if (cur < last - 2) pages.push(-2);
            if (last > 0 && !pages.includes(last)) pages.push(last);
            return pages;
          };
          const pageNumbers = getPageNumbers();
          const btnBase = {
            minWidth: 36,
            height: 36,
            padding: "0 10px",
            borderRadius: 10,
            border: "1px solid var(--border)",
            background: "var(--panel)",
            color: "var(--text)",
            fontWeight: 600,
            fontSize: 13,
            cursor: "pointer" as const,
            transition: "background 0.15s ease, border-color 0.15s ease, box-shadow 0.15s ease",
          };
          const btnDisabled = { opacity: 0.45, cursor: "not-allowed" as const };
          return (
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                gap: 16,
                marginTop: 20,
                padding: "14px 20px",
                background: "var(--panel)",
                border: "1px solid var(--border)",
                borderRadius: 14,
                boxShadow: "0 1px 3px rgba(0,0,0,0.04)",
                flexWrap: "wrap",
              }}
            >
              <span style={{ fontSize: 13, color: "var(--muted)", fontWeight: 500 }}>
                Zobrazeno <strong style={{ color: "var(--text)", fontWeight: 700 }}>{from}–{to}</strong> z {listLength} {label}
              </span>
              <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                <button
                  type="button"
                  aria-label="Předchozí stránka"
                  onClick={() => setOrdersPage((p) => Math.max(0, p - 1))}
                  disabled={ordersPage === 0}
                  style={{
                    ...btnBase,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    ...(ordersPage === 0 ? btnDisabled : {}),
                  }}
                  onMouseEnter={(e) => { if (ordersPage > 0) { e.currentTarget.style.background = "var(--panel-2)"; e.currentTarget.style.borderColor = "var(--accent)"; e.currentTarget.style.boxShadow = "0 0 0 1px var(--accent)"; } }}
                  onMouseLeave={(e) => { e.currentTarget.style.background = "var(--panel)"; e.currentTarget.style.borderColor = "var(--border)"; e.currentTarget.style.boxShadow = "none"; }}
                >
                  ‹
                </button>
                {showPageNumbers ? (
                  pageNumbers.map((p) => {
                    if (p === -1) return <span key="ell-left" style={{ padding: "0 4px", color: "var(--muted)", fontSize: 12 }}>…</span>;
                    if (p === -2) return <span key="ell-right" style={{ padding: "0 4px", color: "var(--muted)", fontSize: 12 }}>…</span>;
                    const isCurrent = p === ordersPage;
                    return (
                      <button
                        key={p}
                        type="button"
                        aria-label={`Stránka ${p + 1}`}
                        aria-current={isCurrent ? "page" : undefined}
                        onClick={() => setOrdersPage(p)}
                        style={{
                          ...btnBase,
                          background: isCurrent ? "var(--accent)" : "var(--panel)",
                          color: isCurrent ? "white" : "var(--text)",
                          borderColor: isCurrent ? "var(--accent)" : "var(--border)",
                          ...(isCurrent ? { boxShadow: "0 2px 8px var(--accent-glow)" } : {}),
                        }}
                        onMouseEnter={(e) => { if (!isCurrent) { e.currentTarget.style.background = "var(--panel-2)"; e.currentTarget.style.borderColor = "var(--accent)"; } }}
                        onMouseLeave={(e) => { if (!isCurrent) { e.currentTarget.style.background = "var(--panel)"; e.currentTarget.style.borderColor = "var(--border)"; } }}
                      >
                        {p + 1}
                      </button>
                    );
                  })
                ) : (
                  <span style={{ fontSize: 13, color: "var(--muted)", minWidth: 72, textAlign: "center", fontWeight: 600 }}>
                    {ordersPage + 1} / {totalOrdersPages}
                  </span>
                )}
                <button
                  type="button"
                  aria-label="Další stránka"
                  onClick={() => setOrdersPage((p) => Math.min(totalOrdersPages - 1, p + 1))}
                  disabled={ordersPage >= totalOrdersPages - 1}
                  style={{
                    ...btnBase,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    ...(ordersPage >= totalOrdersPages - 1 ? btnDisabled : {}),
                  }}
                  onMouseEnter={(e) => { if (ordersPage < totalOrdersPages - 1) { e.currentTarget.style.background = "var(--panel-2)"; e.currentTarget.style.borderColor = "var(--accent)"; e.currentTarget.style.boxShadow = "0 0 0 1px var(--accent)"; } }}
                  onMouseLeave={(e) => { e.currentTarget.style.background = "var(--panel)"; e.currentTarget.style.borderColor = "var(--border)"; e.currentTarget.style.boxShadow = "none"; }}
                >
                  ›
                </button>
              </div>
            </div>
          );
        })()}

        {listLength === 0 && (
          <div
            style={{
              padding: 48,
              borderRadius: "var(--radius-lg)",
              border: "1px solid var(--border)",
              background: "var(--panel)",
              backdropFilter: "var(--blur)",
              WebkitBackdropFilter: "var(--blur)",
              boxShadow: "var(--shadow-soft)",
              textAlign: "center",
              color: "var(--muted)",
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              gap: 12,
            }}
          >
            <div style={{ fontSize: 48, opacity: 0.5 }}>{activeGroup === "reklamace" ? "—" : "📋"}</div>
            <div style={{ fontSize: 16, fontWeight: 700, color: "var(--text)" }}>
              {activeGroup === "reklamace" ? "Žádné reklamace neodpovídají filtru" : "Žádné zakázky neodpovídají filtru"}
            </div>
            <div style={{ fontSize: 13 }}>
              {activeGroup === "reklamace" ? "Zkuste změnit vyhledávání nebo vytvořte reklamaci" : "Zkuste změnit filtry nebo vytvořte novou zakázku"}
            </div>
          </div>
        )}
      </div>
      )}

      {/* ===== New Order Modal ===== */}
      <div
        onClick={() => {
          setIsNewOpen(false);
          setCustomerMatchDecision("undecided");
          setMatchedCustomer(null);
          lastLookupPhoneNormRef.current = null;
          if (phoneLookupDebounceTimerRef.current) {
            clearTimeout(phoneLookupDebounceTimerRef.current);
            phoneLookupDebounceTimerRef.current = null;
          }
        }}
        style={{
          position: "fixed",
          inset: 0,
          background: "rgba(0,0,0,0.35)",
          opacity: isNewOpen ? 1 : 0,
          pointerEvents: isNewOpen ? "auto" : "none",
          transition: "opacity 180ms ease",
          zIndex: 90,
        }}
      />
      <div
        style={{
          position: "fixed",
          left: "50%",
          top: "50%",
          transform: isNewOpen ? "translate(-50%, -50%) scale(1)" : "translate(-50%, -48%) scale(0.98)",
          opacity: isNewOpen ? 1 : 0,
          pointerEvents: isNewOpen ? "auto" : "none",
          transition: "transform 180ms ease, opacity 180ms ease",
          width: 920,
          maxWidth: "calc(100vw - 24px)",
          maxHeight: "calc(100vh - 24px)",
          overflow: "auto",
          background: "var(--panel)",
          backdropFilter: "var(--blur)",
          WebkitBackdropFilter: "var(--blur)",
          border,
          borderRadius: "var(--radius-lg)",
          boxShadow: "var(--shadow)",
          padding: 18,
          zIndex: 100,
          fontFamily: "system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "center", position: "sticky", top: 0, left: 0, right: 0, zIndex: 3, background: "var(--panel)", margin: -18, marginBottom: 0, padding: 18, paddingBottom: 12, borderBottom: "1px solid var(--border)" }}>
          <div>
            <div style={{ fontWeight: 950, fontSize: 16, color: "var(--text)" }}>Nová zakázka</div>
            <div style={{ color: "var(--muted)", fontSize: 12, marginTop: 4 }}>
              Stav se automaticky nastaví na <b>Přijato</b>. Rozpracované údaje se ukládají automaticky.
            </div>
          </div>
          <button
            onClick={() => {
              setIsNewOpen(false);
              setCustomerMatchDecision("undecided");
              setMatchedCustomer(null);
              lastLookupPhoneNormRef.current = null;
              if (phoneLookupDebounceTimerRef.current) {
                clearTimeout(phoneLookupDebounceTimerRef.current);
                phoneLookupDebounceTimerRef.current = null;
              }
            }}
            style={softBtn}
          >
            Zavřít
          </button>
        </div>

        <div style={{ marginTop: 14, display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
          {/* ZÁKAZNÍK */}
          <div style={card}>
            <div style={{ fontWeight: 950, fontSize: 13, color: "var(--text)" }}>Zákazník</div>

            <div style={fieldLabel}>Jméno a příjmení (pokud necháš prázdné, bude anonymní)</div>
            <input
              value={newDraft.customerName}
              onChange={(e) => {
                setNewDraft((p) => ({ ...p, customerName: e.target.value }));
                // Reset decision when name changes
                setCustomerMatchDecision("undecided");
              }}
              onBlur={async () => {
                if (newDraft.customerName.trim()) {
                  await lookupCustomer(newDraft.customerPhone.trim() || undefined, newDraft.customerName);
                }
              }}
              style={{
                ...baseFieldInput,
                border: submitAttempted && !newDraft.customerName.trim() ? borderError : border,
              }}
              placeholder="Jméno zákazníka"
              autoFocus
            />
            {submitAttempted && !newDraft.customerName.trim() && (
              <div style={fieldHint}>Doporučeno vyplnit. Pokud ne, uloží se jako „Anonymní zákazník".</div>
            )}

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
              <div>
                <div style={fieldLabel}>Telefon{uiCfg.orders.customerPhoneRequired ? " *" : ""}</div>
                <input
                  value={formatPhoneNumber(newDraft.customerPhone)}
                  onChange={(e) => {
                    const cleaned = e.target.value.replace(/[^\d+]/g, "");
                    setNewDraft((p) => ({ ...p, customerPhone: cleaned }));
                    // Clear matched customer and reset decision when phone changes
                    if (matchedCustomer) setMatchedCustomer(null);
                    setCustomerMatchDecision("undecided");

                    // Clear any existing debounce timer
                    if (phoneLookupDebounceTimerRef.current) {
                      clearTimeout(phoneLookupDebounceTimerRef.current);
                      phoneLookupDebounceTimerRef.current = null;
                    }

                    // Don't lookup if user explicitly rejected
                    if (customerMatchDecision === "rejected") {
                      return;
                    }

                    // Calculate normalized phone
                    const phoneNorm = normalizePhone(cleaned);

                    // Reset lastLookupPhoneNormRef if phone is empty or invalid
                    if (!cleaned.trim() || !phoneNorm) {
                      lastLookupPhoneNormRef.current = null;
                    }

                    // If phone is valid and different from last lookup, trigger lookup
                    if (phoneNorm && phoneNorm !== lastLookupPhoneNormRef.current && customerMatchDecision === "undecided") {
                      // Immediate lookup for valid, new phone number
                      lookupCustomer(cleaned, newDraft.customerName);
                    } else if (cleaned.trim()) {
                      // Debounce for intermediate states or invalid numbers
                      phoneLookupDebounceTimerRef.current = setTimeout(async () => {
                        const finalPhoneNorm = normalizePhone(cleaned);
                        if (finalPhoneNorm && finalPhoneNorm !== lastLookupPhoneNormRef.current && customerMatchDecision === "undecided") {
                          await lookupCustomer(cleaned, newDraft.customerName);
                        }
                        phoneLookupDebounceTimerRef.current = null;
                      }, 200);
                    }
                  }}
                  onKeyDown={async (e) => {
                    if (e.key === "Enter") {
                      const phone = newDraft.customerPhone.trim();
                      const name = newDraft.customerName.trim();
                      if (phone || name) {
                        await lookupCustomer(phone || undefined, name || undefined);
                      }
                    }
                  }}
                  onBlur={async () => {
                    await lookupCustomer(
                      newDraft.customerPhone.trim() || undefined,
                      newDraft.customerName.trim() || undefined
                    );
                  }}
                  style={{ ...baseFieldInput, border: showError("customerPhone") ? borderError : border }}
                  placeholder="+420 xxx xxx xxx"
                />
                {showError("customerPhone") && <div style={fieldHint}>{errors.customerPhone}</div>}
                
                {/* Customer match panel */}
                {matchedCustomer && customerMatchDecision === "undecided" && (
                  <div
                    style={{
                      marginTop: 12,
                      padding: 12,
                      background: "var(--accent-light)",
                      borderRadius: 8,
                      border: "1px solid var(--accent)",
                    }}
                  >
                    <div style={{ fontSize: 13, fontWeight: 600, color: "var(--text)", marginBottom: 8 }}>
                      Chcete zákazníka přiřadit k této zakázce?
                    </div>
                    <div style={{ fontSize: 12, color: "var(--muted)", marginBottom: 10 }}>
                      <div><strong>Jméno:</strong> {matchedCustomer.name}</div>
                      {matchedCustomer.phone && <div><strong>Telefon:</strong> {matchedCustomer.phone}</div>}
                      {matchedCustomer.email && <div><strong>E-mail:</strong> {matchedCustomer.email}</div>}
                      {matchedCustomer.company && <div><strong>Firma:</strong> {matchedCustomer.company}</div>}
                    </div>
                    <div style={{ display: "flex", gap: 8 }}>
                      <button
                        onClick={() => {
                          // Load full customer data for prefill
                          (async () => {
                            if (!supabase || !activeServiceId) return;
                            const { data } = await (supabase
                              .from("customers") as any)
                              .select("id,name,phone,email,company,ico,address_street,address_city,address_zip,note")
                              .eq("id", matchedCustomer.id)
                              .eq("service_id", activeServiceId)
                              .single();
                            
                            if (data) {
                              // Prefill only empty fields
                              setNewDraft((prev) => ({
                                ...prev,
                                customerId: data.id,
                                customerName: !prev.customerName.trim() ? (data.name || "") : prev.customerName,
                                customerPhone: !prev.customerPhone.trim() ? (data.phone || "") : prev.customerPhone,
                                customerEmail: !prev.customerEmail.trim() ? (data.email || "") : prev.customerEmail,
                                addressStreet: !prev.addressStreet.trim() ? (data.address_street || "") : prev.addressStreet,
                                addressCity: !prev.addressCity.trim() ? (data.address_city || "") : prev.addressCity,
                                addressZip: !prev.addressZip.trim() ? (data.address_zip || "") : prev.addressZip,
                                company: !prev.company.trim() ? (data.company || "") : prev.company,
                                ico: !prev.ico.trim() ? (data.ico || "") : prev.ico,
                                customerInfo: !prev.customerInfo.trim() ? (data.note || "") : prev.customerInfo,
                              }));
                            }
                            setCustomerMatchDecision("accepted");
                            setMatchedCustomer(null);
                          })();
                        }}
                        style={{
                          padding: "6px 12px",
                          borderRadius: 6,
                          border: "none",
                          background: "var(--accent)",
                          color: "white",
                          fontWeight: 600,
                          fontSize: 12,
                          cursor: "pointer",
                        }}
                      >
                        Přiřadit zákazníka
                      </button>
                      <button
                        onClick={() => {
                          setCustomerMatchDecision("rejected");
                          setMatchedCustomer(null);
                        }}
                        style={{
                          padding: "6px 12px",
                          borderRadius: 6,
                          border: "1px solid var(--border)",
                          background: "transparent",
                          color: "var(--text)",
                          fontWeight: 500,
                          fontSize: 12,
                          cursor: "pointer",
                        }}
                      >
                        Ne, pokračovat bez přiřazení
                      </button>
                    </div>
                  </div>
                )}
              </div>

              <div>
                <div style={fieldLabel}>E-mail</div>
                <input
                  value={newDraft.customerEmail}
                  onChange={(e) => setNewDraft((p) => ({ ...p, customerEmail: e.target.value }))}
                  style={{ ...baseFieldInput, border: showError("customerEmail") ? borderError : border }}
                  placeholder="email@example.cz"
                />
                {showError("customerEmail") && <div style={fieldHint}>{errors.customerEmail}</div>}
              </div>
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 160px", gap: 10 }}>
              <div style={{ gridColumn: "1 / -1" }}>
                <div style={fieldLabel}>Adresa – ulice</div>
                <input
                  value={newDraft.addressStreet}
                  onChange={(e) => setNewDraft((p) => ({ ...p, addressStreet: e.target.value }))}
                  style={baseFieldInput}
                  placeholder="Ulice a číslo"
                />
              </div>

              <div>
                <div style={fieldLabel}>Město</div>
                <input
                  value={newDraft.addressCity}
                  onChange={(e) => setNewDraft((p) => ({ ...p, addressCity: e.target.value }))}
                  style={baseFieldInput}
                  placeholder="Město"
                />
              </div>

              <div>
                <div style={fieldLabel}>PSČ</div>
                <input
                  value={formatZipCode(newDraft.addressZip)}
                  onChange={(e) => {
                    const cleaned = e.target.value.replace(/[^\d]/g, "");
                    setNewDraft((p) => ({ ...p, addressZip: cleaned }));
                  }}
                  style={{ ...baseFieldInput, border: showError("addressZip") ? borderError : border }}
                  placeholder="110 00"
                  maxLength={6}
                />
                {showError("addressZip") && <div style={fieldHint}>{errors.addressZip}</div>}
              </div>
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 220px", gap: 10 }}>
              <div>
                <div style={fieldLabel}>Firma</div>
                <input
                  value={newDraft.company}
                  onChange={(e) => setNewDraft((p) => ({ ...p, company: e.target.value }))}
                  style={baseFieldInput}
                  placeholder="Název firmy"
                />
              </div>

              <div>
                <div style={fieldLabel}>IČO</div>
                <input
                  value={formatIco(newDraft.ico)}
                  onChange={(e) => {
                    const cleaned = e.target.value.replace(/[^\d]/g, "");
                    setNewDraft((p) => ({ ...p, ico: cleaned }));
                  }}
                  style={{ ...baseFieldInput, border: showError("ico") ? borderError : border }}
                  placeholder="1234 5678"
                  maxLength={9}
                />
                {showError("ico") && <div style={fieldHint}>{errors.ico}</div>}
              </div>
            </div>

            <div style={fieldLabel}>Informace</div>
            <textarea
              value={newDraft.customerInfo}
              onChange={(e) => setNewDraft((p) => ({ ...p, customerInfo: e.target.value }))}
              style={baseFieldTextArea}
              placeholder="Dodatečné informace o zákazníkovi…"
            />
          </div>

          {/* ZAŘÍZENÍ */}
          <div style={card}>
            <div style={{ fontWeight: 950, fontSize: 13, color: "var(--text)", marginBottom: 12 }}>Zařízení</div>
            {newDraft.devices.map((dev, idx) => (
              <div key={idx} style={{ padding: idx > 0 ? "16px 0 0" : 0, borderTop: idx > 0 ? "1px solid var(--border)" : "none", marginTop: idx > 0 ? 16 : 0 }}>
                {idx > 0 && (
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
                    <span style={{ fontSize: 12, color: "var(--muted)", fontWeight: 700 }}>Zařízení {idx + 1}</span>
                    <button
                      type="button"
                      onClick={() => setNewDraft((p) => ({ ...p, devices: p.devices.filter((_, i) => i !== idx) }))}
                      style={{ ...softBtn, padding: "4px 10px", fontSize: 12 }}
                    >
                      Odebrat
                    </button>
                  </div>
                )}
                <div style={fieldLabel}>Zařízení *</div>
                <DeviceAutocomplete
                  value={dev.deviceLabel}
                  onChange={(value) =>
                    setNewDraft((p) => ({
                      ...p,
                      devices: p.devices.map((d, i) => (i === idx ? { ...d, deviceLabel: value } : d)),
                    }))
                  }
                  models={modelsWithHierarchy}
                  error={showDeviceError(idx)}
                />
                {showDeviceError(idx) && <div style={fieldHint}>{errors[`deviceLabel_${idx}`]}</div>}

                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginTop: 10 }}>
                  <div>
                    <div style={fieldLabel}>IMEI / SN</div>
                    <input
                      value={dev.serialOrImei}
                      onChange={(e) =>
                        setNewDraft((p) => ({
                          ...p,
                          devices: p.devices.map((d, i) => (i === idx ? { ...d, serialOrImei: e.target.value } : d)),
                        }))
                      }
                      style={baseFieldInput}
                      placeholder="Volitelné"
                    />
                  </div>
                  <div>
                    <div style={fieldLabel}>Heslo / kód</div>
                    <input
                      value={dev.devicePasscode}
                      onChange={(e) =>
                        setNewDraft((p) => ({
                          ...p,
                          devices: p.devices.map((d, i) => (i === idx ? { ...d, devicePasscode: e.target.value } : d)),
                        }))
                      }
                      style={baseFieldInput}
                      placeholder="např. 1234 / 0000"
                    />
                  </div>
                </div>

                <div style={fieldLabel}>Popis stavu</div>
                <input
                  list="new-order-device-condition-list"
                  value={dev.deviceCondition}
                  onChange={(e) =>
                    setNewDraft((p) => ({
                      ...p,
                      devices: p.devices.map((d, i) => (i === idx ? { ...d, deviceCondition: e.target.value } : d)),
                    }))
                  }
                  style={baseFieldInput}
                  placeholder="Vyberte nebo napište vlastní (např. rozbitý displej, oděrky…)"
                />

                <div style={fieldLabel}>Příslušenství</div>
                <input
                  list="new-order-device-accessories-list"
                  value={dev.deviceAccessories}
                  onChange={(e) =>
                    setNewDraft((p) => ({
                      ...p,
                      devices: p.devices.map((d, i) => (i === idx ? { ...d, deviceAccessories: e.target.value } : d)),
                    }))
                  }
                  style={baseFieldInput}
                  placeholder="Vyberte nebo napište vlastní (např. nabíječka, pouzdro…)"
                />

                <div style={{ marginTop: 12 }}>
                  <div style={fieldLabel}>Předpokládané datum/čas dokončení</div>
                  <DateTimePicker
                    value={dev.expectedCompletionAt ?? null}
                    onChange={(v) => {
                      setNewDraft((p) => {
                        if (idx === 0) {
                          return { ...p, devices: p.devices.map((d) => ({ ...d, expectedCompletionAt: v })) };
                        }
                        return {
                          ...p,
                          devices: p.devices.map((d, i) => (i === idx ? { ...d, expectedCompletionAt: v } : d)),
                        };
                      });
                    }}
                    inputStyle={baseFieldInput}
                  />
                </div>

                <div style={fieldLabel}>Požadovaná oprava</div>
                <textarea
                  value={dev.requestedRepair}
                  onChange={(e) =>
                    setNewDraft((p) => ({
                      ...p,
                      devices: p.devices.map((d, i) => (i === idx ? { ...d, requestedRepair: e.target.value } : d)),
                    }))
                  }
                  style={baseFieldTextArea}
                  placeholder="Např. výměna displeje, výměna baterie, diagnostika…"
                />

                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginTop: 10 }}>
                  <div>
                    <div style={fieldLabel}>Způsob převzetí</div>
                    <HandoffMethodSelect
                      options={getHandoffOptions().receiveMethods}
                      value={dev.handoffMethod}
                      onChange={(v) =>
                        setNewDraft((p) => ({
                          ...p,
                          devices: p.devices.map((d, i) => (i === idx ? { ...d, handoffMethod: v } : d)),
                        }))
                      }
                      triggerStyle={baseFieldInput}
                    />
                  </div>
                  <div>
                    <div style={fieldLabel}>Způsob předání</div>
                    <HandoffMethodSelect
                      options={getHandoffOptions().returnMethods}
                      value={dev.handbackMethod}
                      onChange={(v) =>
                        setNewDraft((p) => ({
                          ...p,
                          devices: p.devices.map((d, i) => (i === idx ? { ...d, handbackMethod: v } : d)),
                        }))
                      }
                      triggerStyle={baseFieldInput}
                    />
                  </div>
                </div>

                <div style={fieldLabel}>Externí identifikace</div>
                <input
                  value={dev.externalId}
                  onChange={(e) =>
                    setNewDraft((p) => ({
                      ...p,
                      devices: p.devices.map((d, i) => (i === idx ? { ...d, externalId: e.target.value } : d)),
                    }))
                  }
                  style={baseFieldInput}
                  placeholder="Např. číslo zakázky partnera"
                />

                <div style={fieldLabel}>Předschválená cena</div>
                <input
                  type="number"
                  value={dev.estimatedPrice ?? ""}
                  onChange={(e) =>
                    setNewDraft((p) => ({
                      ...p,
                      devices: p.devices.map((d, i) => (i === idx ? { ...d, estimatedPrice: e.target.value ? Number(e.target.value) : undefined } : d)),
                    }))
                  }
                  style={baseFieldInput}
                  placeholder="Kč"
                  min="0"
                  step="1"
                />

                <div style={fieldLabel}>Poznámka k zařízení</div>
                <textarea
                  value={dev.deviceNote}
                  onChange={(e) =>
                    setNewDraft((p) => ({
                      ...p,
                      devices: p.devices.map((d, i) => (i === idx ? { ...d, deviceNote: e.target.value } : d)),
                    }))
                  }
                  style={baseFieldTextArea}
                  placeholder="Poznámka pro technika…"
                />
              </div>
            ))}
            <button
              type="button"
              disabled={!newDraft.devices[newDraft.devices.length - 1]?.deviceLabel?.trim()}
              onClick={() =>
                setNewDraft((p) => ({
                  ...p,
                  devices: [
                    ...p.devices,
                    { ...defaultDeviceRow(), expectedCompletionAt: p.devices[0]?.expectedCompletionAt ?? undefined },
                  ],
                }))
              }
              style={{ ...softBtn, marginTop: 16, width: "100%", padding: "10px 14px", display: "flex", alignItems: "center", justifyContent: "center", gap: 8, opacity: !newDraft.devices[newDraft.devices.length - 1]?.deviceLabel?.trim() ? 0.6 : 1, cursor: !newDraft.devices[newDraft.devices.length - 1]?.deviceLabel?.trim() ? "not-allowed" : "pointer" }}
              title={!newDraft.devices[newDraft.devices.length - 1]?.deviceLabel?.trim() ? "Vyplňte nejdřív název zařízení v tomto řádku" : "Přidat další zařízení"}
            >
              + Přidat další zařízení
            </button>
          </div>
        </div>

        {/* Fotky při příjmu – nahrají se po vytvoření zakázky */}
        <div id="new-order-photos-before" style={{ marginTop: 16, ...card, gridColumn: "1 / -1" }}>
          <div style={{ fontWeight: 950, fontSize: 13, color: "var(--text)", marginBottom: 4 }}>📷 Fotky při příjmu</div>
          <div style={{ fontSize: 11, color: "var(--muted)", marginBottom: 10 }}>Fotky se po vytvoření zakázky automaticky nahrají a připojí k zakázce.</div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 12 }}>
            {(newDraft.diagnosticPhotosBefore || []).map((dataUrl, idx) => (
              <div key={idx} style={{ position: "relative" }}>
                <img
                  src={dataUrl}
                  alt={`Fotka ${idx + 1}`}
                  style={{
                    width: 80,
                    height: 80,
                    objectFit: "cover",
                    borderRadius: 8,
                    border: "1px solid var(--border)",
                  }}
                />
                <button
                  type="button"
                  onClick={() =>
                    setNewDraft((p) => ({
                      ...p,
                      diagnosticPhotosBefore: (p.diagnosticPhotosBefore || []).filter((_, i) => i !== idx),
                    }))
                  }
                  style={{
                    position: "absolute",
                    top: 4,
                    right: 4,
                    width: 22,
                    height: 22,
                    borderRadius: "50%",
                    background: "rgba(239, 68, 68, 0.9)",
                    color: "white",
                    border: "none",
                    cursor: "pointer",
                    fontSize: 14,
                    lineHeight: 1,
                    padding: 0,
                  }}
                >
                  ×
                </button>
              </div>
            ))}
            {draftCapturePreviewUrls.map((photoUrl, idx) => (
              <div key={`draft-${idx}`} style={{ position: "relative" }}>
                <img
                  src={photoUrl}
                  alt={`QR fotka ${idx + 1}`}
                  style={{
                    width: 80,
                    height: 80,
                    objectFit: "cover",
                    borderRadius: 8,
                    border: "1px solid var(--border)",
                  }}
                />
                <div
                  style={{
                    position: "absolute",
                    left: 4,
                    right: 4,
                    bottom: 4,
                    fontSize: 10,
                    fontWeight: 700,
                    borderRadius: 6,
                    background: "rgba(0,0,0,0.55)",
                    color: "white",
                    textAlign: "center",
                    padding: "2px 4px",
                  }}
                >
                  z mobilu
                </div>
              </div>
            ))}
          </div>
          <label style={{ ...baseFieldInput, padding: "8px 12px", cursor: "pointer", marginTop: 8, display: "inline-block" }}>
            <input
              ref={newOrderPhotosBeforeInputRef}
              type="file"
              accept="image/*"
              multiple
              style={{ display: "none" }}
              onChange={(e) => {
                const files = Array.from(e.target.files || []);
                e.target.value = "";
                if (!files.length) return;
                const reader = (f: File) =>
                  new Promise<string>((resolve, reject) => {
                    const r = new FileReader();
                    r.onload = () => resolve(r.result as string);
                    r.onerror = () => reject(new Error("Načtení selhalo"));
                    r.readAsDataURL(f);
                  });
                Promise.all(files.map(reader)).then((urls) => {
                  setNewDraft((p) => ({
                    ...p,
                    diagnosticPhotosBefore: [...(p.diagnosticPhotosBefore || []), ...urls],
                  }));
                });
              }}
            />
            Nahrát fotky
          </label>
        </div>

        <div style={{ display: "flex", gap: 10, justifyContent: "flex-end", flexWrap: "wrap", position: "sticky", bottom: 0, left: 0, right: 0, zIndex: 3, background: "var(--panel)", margin: -18, marginTop: 14, padding: 18, paddingTop: 12, borderTop: "1px solid var(--border)" }}>
          <button
            onClick={() => {
              draftCaptureTokenRef.current = null;
              setDraftCapturePreviewUrls([]);
              setDraftCaptureLiveCount(0);
              setNewDraft(defaultDraft());
              safeSaveDraft(null);
              window.dispatchEvent(new CustomEvent("jobsheet:draft-count", { detail: { count: 0 } }));
              setIsNewOpen(false);
              setCustomerMatchDecision("undecided");
              setMatchedCustomer(null);
              lastLookupPhoneNormRef.current = null;
              if (phoneLookupDebounceTimerRef.current) {
                clearTimeout(phoneLookupDebounceTimerRef.current);
                phoneLookupDebounceTimerRef.current = null;
              }
            }}
            style={softBtn}
          >
            Zrušit
          </button>
          <button
            type="button"
            onClick={async () => {
              if (!supabase || !supabaseUrl || !supabaseAnonKey || !activeServiceId) {
                showToast("Chybí připojení nebo aktivní služba.", "error");
                return;
              }
              setCaptureQRLoading(true);
              try {
                const { data: refreshData, error: refreshErr } = await supabase.auth.refreshSession();
                if (refreshErr) throw new Error("Session vypršela.");
                const authToken = refreshData?.session?.access_token ?? (await supabase.auth.getSession()).data?.session?.access_token;
                if (!authToken) throw new Error("Nejste přihlášeni.");
                const res = await supabaseFetch(`${supabaseUrl}/functions/v1/capture-create-token`, {
                  method: "POST",
                  headers: { "Content-Type": "application/json", Authorization: `Bearer ${authToken}`, apikey: supabaseAnonKey },
                  body: JSON.stringify({ draft: true, serviceId: activeServiceId, isBefore: true }),
                });
                const raw = await res.text();
                const data: { url?: string; token?: string; error?: string } = raw ? JSON.parse(raw) : {};
                if (!res.ok) throw new Error(data.error || res.statusText);
                setDraftCapturePreviewUrls([]);
                setDraftCaptureLiveCount(0);
                if (data.token) draftCaptureTokenRef.current = data.token;
                if (data.url) {
                  setCaptureQRItems([{ deviceLabel: "Přijímací fotky (před vytvořením zakázky)", url: data.url }]);
                }
              } catch (err) {
                showToast(normalizeError(err) || "Nepodařilo vytvořit QR pro focení.", "error");
              } finally {
                setCaptureQRLoading(false);
              }
            }}
            disabled={captureQRLoading}
            style={{
              ...softBtn,
              opacity: captureQRLoading ? 0.55 : 1,
              cursor: captureQRLoading ? "not-allowed" : "pointer",
            }}
            title="Zobrazit QR kód pro nafocení přijímacích fotek z telefonu. Zakázka se nevytvoří – fotky se připojí po kliknutí na „Vytvořit zakázku“."
          >
            {captureQRLoading ? "⏳ Vytvářím…" : "📱 Udělat přijímací fotky"}
          </button>
          <button
            onClick={createTicket}
            style={{
              ...primaryBtn,
              opacity: canCreate ? 1 : 0.55,
              cursor: canCreate ? "pointer" : "not-allowed",
            }}
          >
            Vytvořit zakázku
          </button>
        </div>
      </div>

      {/* ===== Full detail modal (portal do body, aby fixed byl vůči viewportu, ne main s transform) ===== */}
      {createPortal(
        <>
          <div
            onClick={handleCloseDetail}
            style={{
              position: "fixed",
              inset: 0,
              background: "rgba(0,0,0,0.42)",
              opacity: (detailId || detailClaimId) ? 1 : 0,
              pointerEvents: (detailId || detailClaimId) ? "auto" : "none",
              transition: "opacity 160ms ease",
              zIndex: 300,
            }}
          />

          <div
        style={{
          position: "fixed",
          left: "50%",
          top: "50%",
          transform: (detailId || detailClaimId) ? "translate(-50%, -50%) scale(1) translateZ(0)" : "translate(-50%, -48%) scale(0.99) translateZ(0)",
          opacity: (detailId || detailClaimId) ? 1 : 0,
          pointerEvents: (detailId || detailClaimId) ? "auto" : "none",
          transition: "transform 160ms ease, opacity 160ms ease",
          width: 1080,
          maxWidth: "calc(100vw - 24px)",
          maxHeight: "calc(100vh - 24px)",
          display: "flex",
          flexDirection: "column",
          overflow: "hidden",
          background: "var(--panel)",
          backdropFilter: "var(--blur)",
          WebkitBackdropFilter: "var(--blur)",
          border,
          borderRadius: "var(--radius-lg)",
          boxShadow: "var(--shadow)",
          padding: 0,
          zIndex: 310,
          fontFamily: "system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif",
          willChange: (detailId || detailClaimId) ? "transform" : "auto",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div style={{ flex: "0 0 auto", display: "flex", justifyContent: "space-between", gap: 12, alignItems: "flex-start", zIndex: 5, background: "var(--panel)", padding: 18, paddingBottom: 12, borderBottom: "1px solid var(--border)" }}>
          <div style={{ minWidth: 0, paddingRight: 70 }}>
            <div style={{ fontWeight: 950, fontSize: 18, color: "var(--text)", display: "flex", alignItems: "center", gap: 8 }}>
              {detailedClaim ? detailedClaim.code : (detailedTicket ? detailedTicket.code : "—")}
              {detailedClaim && <span style={{ fontSize: 12, padding: "4px 10px", borderRadius: 8, background: "linear-gradient(180deg, rgba(20,184,166,0.4) 0%, rgba(15,118,110,0.3) 100%)", color: "#134e4a", fontWeight: 800, border: "1px solid rgba(13,148,136,0.5)", boxShadow: "0 1px 3px rgba(0,0,0,0.08)" }}>Reklamace</span>}
            </div>
            <div style={{ color: "var(--muted)", marginTop: 4 }}>
              {detailedClaim ? (
                <>{detailedClaim.customer_name ?? "—"} · {formatCZ(detailedClaim.created_at)}</>
              ) : detailedTicket ? (
                <>
                  <span
                    onClick={() => {
                      const customerId = detailedTicket.customerId;
                      if (customerId && onOpenCustomer) {
                        onOpenCustomer(customerId);
                      }
                    }}
                    style={{
                      cursor: detailedTicket.customerId ? "pointer" : "default",
                      color: "var(--muted)",
                    }}
                    title={detailedTicket.customerId ? "Otevřít profil zákazníka" : undefined}
                    onMouseEnter={(e) => {
                      if (detailedTicket.customerId) {
                        e.currentTarget.style.color = "var(--text)";
                      }
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.color = "var(--muted)";
                    }}
                  >
                    {detailedTicket.customerName}
                  </span>
                  {" · "}
                  {formatCZ(detailedTicket.createdAt)}
                </>
              ) : (
                "—"
              )}
            </div>
          </div>

          <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap", paddingRight: 70 }}>
            {detailedClaim ? (
              <>
                {detailedClaim.source_ticket_id && (
                  <button
                    type="button"
                    onClick={() => { setDetailId(detailedClaim.source_ticket_id!); setDetailClaimId(null); }}
                    style={{ ...primaryBtn, display: "flex", alignItems: "center", gap: 8, padding: "10px 14px", background: "var(--panel-2)", color: "var(--text)", border: "1px solid var(--border)" }}
                    title="Otevřít původní zakázku"
                  >
                    Otevřít zakázku
                  </button>
                )}
                {!isEditingClaim ? (
                  <>
                    <button onClick={startEditingClaim} style={{ ...primaryBtn, display: "flex", alignItems: "center", gap: 8, padding: "10px 14px" }} title="Upravit reklamaci">
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" /><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" /></svg>
                      Upravit
                    </button>
                    <button onClick={() => { setDeleteClaimId(detailedClaim.id); setDeleteClaimDialogOpen(true); }} style={{ ...primaryBtn, display: "flex", alignItems: "center", gap: 8, padding: "10px 14px", background: "rgba(239, 68, 68, 0.9)" }} title="Smazat reklamaci">
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 6h18" /><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" /></svg>
                      Smazat reklamaci
                    </button>
                  </>
                ) : (
                  <>
                    <button onClick={() => saveClaimChanges().then((ok) => ok && showToast("Změny uloženy", "success"))} style={{ ...primaryBtn, display: "flex", alignItems: "center", gap: 8, padding: "10px 14px" }} title="Uložit změny">
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z" /><polyline points="17 21 17 13 7 13 7 21" /><polyline points="7 3 7 8 15 8" /></svg>
                      Uložit
                    </button>
                    <button onClick={() => { setIsEditingClaim(false); setEditedClaim({}); }} style={softBtn} title="Zrušit úpravy">Zrušit</button>
                  </>
                )}
                {canPrintExport && (
                  <DocumentActionPicker
                    label="Přijetí reklamace"
                    onSelect={async (action) => {
                      const running = await isJobiDocsRunning();
                      const sid = activeServiceId ?? undefined;
                      const companyData = safeLoadCompanyData() as Record<string, unknown>;
                      const originalCode = detailedClaim.source_ticket_id && paginatedTickets.some((t) => t.id === detailedClaim.source_ticket_id)
                        ? (paginatedTickets.find((t) => t.id === detailedClaim.source_ticket_id) as TicketEx)?.code ?? ""
                        : "";
                      const variables = buildClaimVariablesForJobiDocs(detailedClaim, originalCode);
                      if (running && sid) {
                        if (action === "print") {
                          const res = await printDocumentViaJobiDocs("prijemka_reklamace", sid, companyData, {}, { variables });
                          if (res.ok) {
                            const u = (await supabase?.auth.getUser())?.data?.user?.id;
                            if (u) {
                              checkAchievementOnFirstPrint(u);
                              checkAchievementOnPaperless(u);
                            }
                            showToast("Úloha odeslána do fronty", "success");
                          } else showToast(`JobiDocs: ${formatJobiDocsErrorForUser(res.error)}`, "error");
                        } else {
                          try {
                            const { save } = await import("@tauri-apps/plugin-dialog");
                            const filePath = await save({
                              defaultPath: `prijemka-reklamace-${detailedClaim.code}.pdf`,
                              filters: [{ name: "PDF", extensions: ["pdf"] }, { name: "All Files", extensions: ["*"] }],
                            });
                            if (filePath) {
                              const res = await exportDocumentViaJobiDocs("prijemka_reklamace", sid, companyData, {}, filePath, { variables });
                              if (res.ok) {
                                const u = (await supabase?.auth.getUser())?.data?.user?.id;
                                if (u) {
                                  checkAchievementOnFirstPrint(u);
                                  checkAchievementOnPaperless(u);
                                }
                                showExportSuccessToast(filePath);
                              } else showToast(`JobiDocs: ${formatJobiDocsErrorForUser(res.error)}`, "error");
                            }
                          } catch (e) {
                            showToast(`Chyba exportu: ${e instanceof Error ? e.message : String(e)}`, "error");
                          }
                        }
                      } else {
                        const config = await loadDocumentsConfigFromDB(activeServiceId);
                        const html = generatePrijetiReklamaceHTML(detailedClaim, safeLoadCompanyData(), config ?? undefined);
                        if (action === "print") {
                          openPreviewWindowWithPrint(html, "Přijetí reklamace");
                        } else {
                          try {
                            const { save } = await import("@tauri-apps/plugin-dialog");
                            const filePath = await save({
                              defaultPath: `prijemka-reklamace-${detailedClaim.code}.pdf`,
                              filters: [{ name: "PDF", extensions: ["pdf"] }, { name: "All Files", extensions: ["*"] }],
                            });
                            if (filePath) {
                              const res = await exportViaJobiDocs(html, filePath);
                              if (res.ok) {
                                const u = (await supabase?.auth.getUser())?.data?.user?.id;
                                if (u) {
                                  checkAchievementOnFirstPrint(u);
                                  checkAchievementOnPaperless(u);
                                }
                                showExportSuccessToast(filePath);
                              } else showToast(`JobiDocs: ${formatJobiDocsErrorForUser(res.error)}`, "error");
                            }
                          } catch (e) {
                            showToast(`Chyba exportu: ${e instanceof Error ? e.message : String(e)}`, "error");
                          }
                        }
                      }
                    }}
                  />
                )}
                <button onClick={() => setClaimHistoryModalOpen(true)} style={softBtn} title="Historie změn reklamace">Historie</button>
              </>
            ) : !isEditing ? (
              <>
              <button
                onClick={startEditing}
                style={{ ...primaryBtn, display: "flex", alignItems: "center", gap: 8, padding: "10px 14px" }}
                title="Upravit zakázku"
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
                  <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
                </svg>
                Upravit
              </button>
                {detailedTicket && (
                  <button
                    onClick={() => {
                      setDeleteTicketId(detailedTicket.id);
                      setDeleteDialogOpen(true);
                    }}
                    style={{
                      ...primaryBtn,
                      display: "flex",
                      alignItems: "center",
                      gap: 8,
                      padding: "10px 14px",
                      background: "rgba(239, 68, 68, 0.9)",
                    }}
                    title="Smazat zakázku"
                  >
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M3 6h18" />
                      <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                    </svg>
                    Smazat zakázku
                  </button>
                )}
              </>
            ) : (
              <>
                <button
                  onClick={saveTicketChanges}
                  style={{ ...primaryBtn, display: "flex", alignItems: "center", gap: 8, padding: "10px 14px" }}
                  title="Uložit změny"
                >
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z" />
                    <polyline points="17 21 17 13 7 13 7 21" />
                    <polyline points="7 3 7 8 15 8" />
                  </svg>
                  Uložit
                </button>
                <button
                  onClick={() => {
                    setIsEditing(false);
                    setEditedTicket({});
                  }}
                  style={softBtn}
                  title="Zrušit úpravy"
                >
                  Zrušit
                </button>
              </>
            )}

            {detailedTicket && !detailedClaim && canPrintExport && (
              <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
                <DocumentActionPicker
                  label="📄 Zakázkový list"
                  onSelect={(action) => {
                    if (action === "export") exportTicketToPDF(detailedTicket, activeServiceId);
                    else if (action === "print") printTicket(detailedTicket, activeServiceId);
                  }}
                />
                {(detailedTicket.diagnosticText || (detailedTicket.diagnosticPhotos && detailedTicket.diagnosticPhotos.length > 0)) && (
                  <DocumentActionPicker
                    label="🔍 Diagnostický protokol"
                    onSelect={(action) => {
                      if (action === "export") exportDiagnosticProtocolToPDF(detailedTicket, activeServiceId);
                      else if (action === "print") printDiagnosticProtocol(detailedTicket, activeServiceId);
                    }}
                  />
                )}
                <DocumentActionPicker
                  label="📋 Záruční list"
                  onSelect={(action) => {
                    if (action === "export") exportWarrantyToPDF(detailedTicket, activeServiceId);
                    else if (action === "print") printWarranty(detailedTicket, activeServiceId);
                  }}
                />
                {(onCreateInvoice || onOpenInvoice) && (() => {
                  const existingInvoiceId = invoiceIdByTicketId[detailedTicket.id];
                  return existingInvoiceId && onOpenInvoice ? (
                    <button
                      key="open-invoice"
                      onClick={() => onOpenInvoice(existingInvoiceId)}
                      style={softBtn}
                      title="Otevřít fakturu k této zakázce"
                    >
                      📄 Přejít na fakturu
                    </button>
                  ) : onCreateInvoice ? (
                    <button
                      key="create-invoice"
                      onClick={() => {
                        const t = detailedTicket;
                        const repairs = (t.performedRepairs || []).filter((r) => r.name);
                        onCreateInvoice({
                          ticketId: t.id,
                          customerId: t.customerId || undefined,
                          customerName: t.customerName || t.customerCompany || undefined,
                          customerEmail: t.customerEmail || undefined,
                          customerPhone: t.customerPhone || undefined,
                          customerIco: t.customerIco || undefined,
                          customerAddress: [t.customerAddressStreet, t.customerAddressCity, t.customerAddressZip].filter(Boolean).join(", ") || undefined,
                          items: repairs.length > 0 ? repairs.map((r) => ({
                            name: r.name,
                            qty: 1,
                            unit: "ks",
                            unit_price: r.price ?? 0,
                            vat_rate: 21,
                          })) : undefined,
                        });
                      }}
                      style={softBtn}
                      title="Vytvořit fakturu z této zakázky"
                    >
                      💰 Vystavit fakturu
                    </button>
                  ) : null;
                })()}
              </div>
            )}

            {detailedTicket && !detailedClaim && smsActivatedForService && (
              <button
                type="button"
                onClick={() => { setSmsPanelOpen(true); setSmsUnreadCount(0); }}
                style={{ ...softBtn, position: "relative" }}
                title="SMS chat se zákazníkem"
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
                </svg>
                SMS
                {smsUnreadCount > 0 && (
                  <span
                    style={{
                      position: "absolute",
                      top: -8,
                      right: -8,
                      minWidth: 20,
                      height: 20,
                      borderRadius: "50%",
                      background: "#FF3B30",
                      color: "#fff",
                      fontSize: 11,
                      fontWeight: 700,
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      padding: "0 6px",
                    }}
                  >
                    {smsUnreadCount > 99 ? "99+" : smsUnreadCount}
                  </span>
                )}
              </button>
            )}
            {detailedTicket && !detailedClaim && (
              <button
                onClick={() => setTicketHistoryModalOpen(true)}
                style={softBtn}
                title="Historie změn zakázky"
              >
                Historie
              </button>
            )}

          </div>

          {/* Close button - uvnitř náhledu, s odsazením aby nezasahoval mimo */}
          <button
            onClick={handleCloseDetail}
            style={{ ...softBtn, position: "absolute", top: 10, right: 10, zIndex: 2 }}
            aria-label="Zavřít"
          >
            ×
          </button>
        </div>

        <div style={{ flex: 1, minHeight: 0, overflow: "auto", padding: 18 }}>
        {detailedClaim && (() => {
          const c = { ...detailedClaim, ...editedClaim };
          const sourceTicket = detailedClaim.source_ticket_id ? tickets.find((t) => t.id === detailedClaim.source_ticket_id) : undefined;
          return (
          <>
          <div style={{ marginTop: 20, display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
            <div style={card}>
              <div style={{ fontWeight: 950, fontSize: 14, color: "var(--text)", marginBottom: 12 }}>👤 Zákazník</div>
              {!isEditingClaim ? (
                <div style={{ display: "grid", gap: 8 }}>
                  <div style={{ fontSize: 15, fontWeight: 800, color: "var(--text)" }}>{c.customer_name ?? "—"}</div>
                  {c.customer_phone && (
                    <div style={{ fontSize: 13, color: "var(--text)", display: "flex", alignItems: "center", gap: 6 }}>
                      <span>📞</span>
                      <span>{formatPhoneNumber(c.customer_phone)}</span>
                    </div>
                  )}
                  {c.customer_email && (
                    <div style={{ fontSize: 13, color: "var(--text)", display: "flex", alignItems: "center", gap: 6 }}>
                      <span>✉️</span>
                      <span>{c.customer_email}</span>
                    </div>
                  )}
                  {[c.customer_address_street, c.customer_address_city, c.customer_address_zip].filter(Boolean).length > 0 && (
                    <div style={{ fontSize: 13, color: "var(--text)", display: "flex", alignItems: "center", gap: 6, marginTop: 4 }}>
                      <span>📍</span>
                      <span>{[c.customer_address_street, c.customer_address_city, c.customer_address_zip].filter(Boolean).join(", ")}</span>
                    </div>
                  )}
                  {(c.customer_company || c.customer_ico) && (
                    <div style={{ fontSize: 13, color: "var(--text)", marginTop: 4 }}>{[c.customer_company, c.customer_ico].filter(Boolean).join(" · ")}</div>
                  )}
                  {c.customer_info && <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 4, whiteSpace: "pre-wrap" }}>{c.customer_info}</div>}
                </div>
              ) : (
                <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                  <input value={c.customer_name ?? ""} onChange={(e) => setEditedClaim((p) => ({ ...p, customer_name: e.target.value }))} placeholder="Jméno / firma" style={baseFieldInput} />
                  <input value={c.customer_phone ?? ""} onChange={(e) => setEditedClaim((p) => ({ ...p, customer_phone: e.target.value }))} placeholder="Telefon" style={baseFieldInput} />
                  <input value={c.customer_email ?? ""} onChange={(e) => setEditedClaim((p) => ({ ...p, customer_email: e.target.value }))} placeholder="E-mail" style={baseFieldInput} />
                  <input value={c.customer_address_street ?? ""} onChange={(e) => setEditedClaim((p) => ({ ...p, customer_address_street: e.target.value }))} placeholder="Ulice, č.p." style={baseFieldInput} />
                  <input value={c.customer_address_city ?? ""} onChange={(e) => setEditedClaim((p) => ({ ...p, customer_address_city: e.target.value }))} placeholder="Město" style={baseFieldInput} />
                  <input value={c.customer_address_zip ?? ""} onChange={(e) => setEditedClaim((p) => ({ ...p, customer_address_zip: e.target.value }))} placeholder="PSČ" style={baseFieldInput} />
                  <input value={c.customer_company ?? ""} onChange={(e) => setEditedClaim((p) => ({ ...p, customer_company: e.target.value }))} placeholder="Firma" style={baseFieldInput} />
                  <input value={c.customer_ico ?? ""} onChange={(e) => setEditedClaim((p) => ({ ...p, customer_ico: e.target.value }))} placeholder="IČO" style={baseFieldInput} />
                  <textarea value={c.customer_info ?? ""} onChange={(e) => setEditedClaim((p) => ({ ...p, customer_info: e.target.value }))} placeholder="Poznámka k zákazníkovi" rows={2} style={{ ...baseFieldInput, minHeight: 60 }} />
                </div>
              )}
            </div>
            <div style={card}>
              <div style={{ fontWeight: 950, fontSize: 14, color: "var(--text)", marginBottom: 12 }}>📱 Zařízení</div>
              {!isEditingClaim ? (
                <div style={{ display: "grid", gap: 8 }}>
                  <div style={{ fontSize: 15, fontWeight: 800, color: "var(--text)" }}>{c.device_label || c.device_serial || "—"}</div>
                  {c.device_serial && (
                    <div style={{ fontSize: 13, color: "var(--text)", display: "flex", alignItems: "center", gap: 6 }}>
                      <span>🔢</span>
                      <span>SN: {c.device_serial}</span>
                    </div>
                  )}
                  {(c.device_brand || c.device_model) && (
                    <div style={{ fontSize: 13, color: "var(--text)" }}>{[c.device_brand, c.device_model].filter(Boolean).join(" ")}</div>
                  )}
                  {c.device_condition && <div style={{ fontSize: 13, color: "var(--text)" }}>{c.device_condition}</div>}
                  {(c.device_accessories || c.device_note) && (
                    <div style={{ fontSize: 13, color: "var(--text)" }}>{[c.device_accessories, c.device_note].filter(Boolean).join(" · ")}</div>
                  )}
                  {c.device_passcode && <div style={{ fontSize: 13, color: "var(--text)" }}>Heslo/kód: {c.device_passcode}</div>}
                </div>
              ) : (
                <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                  <input value={c.device_label ?? ""} onChange={(e) => setEditedClaim((p) => ({ ...p, device_label: e.target.value }))} placeholder="Popis zařízení" style={baseFieldInput} />
                  <input value={c.device_serial ?? ""} onChange={(e) => setEditedClaim((p) => ({ ...p, device_serial: e.target.value }))} placeholder="SN / IMEI" style={baseFieldInput} />
                  <input value={c.device_condition ?? ""} onChange={(e) => setEditedClaim((p) => ({ ...p, device_condition: e.target.value }))} placeholder="Stav zařízení" style={baseFieldInput} />
                  <input value={c.device_accessories ?? ""} onChange={(e) => setEditedClaim((p) => ({ ...p, device_accessories: e.target.value }))} placeholder="Příslušenství" style={baseFieldInput} />
                  <input value={c.device_note ?? ""} onChange={(e) => setEditedClaim((p) => ({ ...p, device_note: e.target.value }))} placeholder="Poznámka k zařízení" style={baseFieldInput} />
                  <input value={c.device_passcode ?? ""} onChange={(e) => setEditedClaim((p) => ({ ...p, device_passcode: e.target.value }))} placeholder="Heslo/kód" style={baseFieldInput} />
                  <div>
                    <div style={fieldLabel}>Předpokládané datum/čas dokončení</div>
                    <DateTimePicker
                      value={(c as any).expected_completion_at ?? null}
                      onChange={(v) => setEditedClaim((p) => ({ ...p, expected_completion_at: v }))}
                      inputStyle={baseFieldInput}
                    />
                  </div>
                </div>
              )}
            </div>
            <div style={{ ...card, gridColumn: "1 / -1" }}>
              <div style={{ fontWeight: 950, fontSize: 14, color: "var(--text)", marginBottom: 12 }}>📝 Poznámka / důvod reklamace</div>
              {!isEditingClaim ? (
                <div style={{ fontSize: 14, color: "var(--text)", whiteSpace: "pre-wrap" }}>{c.notes || "—"}</div>
              ) : (
                <textarea value={c.notes ?? ""} onChange={(e) => setEditedClaim((p) => ({ ...p, notes: e.target.value }))} placeholder="Poznámka / důvod reklamace" rows={4} style={{ ...baseFieldInput, minHeight: 100 }} />
              )}
            </div>
            <div style={{ ...card, gridColumn: "1 / -1" }}>
              <div style={{ fontWeight: 950, fontSize: 14, color: "var(--text)", marginBottom: 12 }}>Provedené zákroky</div>
              {(() => {
                const resolutionItems = claimResolutionDraft ?? parseClaimResolutionItems(detailedClaim?.resolution_summary ?? null);
                const setResolutionItems = (next: ClaimResolutionItem[]) => setClaimResolutionDraft(next);
                return (
                  <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                    {resolutionItems.length === 0 ? (
                      <div style={{ fontSize: 14, color: "var(--muted)" }}>Zatím nebyly přidány žádné zákroky. Přidejte zákrok nebo opravu a u každého můžete nastavit cenu (0 Kč = zdarma při uznané reklamaci).</div>
                    ) : (
                      resolutionItems.map((item) => (
                        <div key={item.id} style={{ display: "flex", flexDirection: "column", gap: 8, padding: 12, borderRadius: 10, background: "var(--panel)", border: "1px solid var(--border)" }}>
                          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "flex-start" }}>
                            <input
                              value={item.name}
                              onChange={(e) => setResolutionItems(resolutionItems.map((x) => (x.id === item.id ? { ...x, name: e.target.value } : x)))}
                              placeholder="Název zákroku / opravy"
                              style={{ ...baseFieldInput, flex: 1, minWidth: 180 }}
                            />
                            <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                              <label style={{ fontSize: 12, color: "var(--muted)", whiteSpace: "nowrap" }}>Cena (Kč)</label>
                              <input
                                type="number"
                                min={0}
                                value={item.price ?? ""}
                                onChange={(e) => {
                                  const v = e.target.value;
                                  const num = v === "" ? undefined : Number(v);
                                  setResolutionItems(resolutionItems.map((x) => (x.id === item.id ? { ...x, price: num } : x)));
                                }}
                                placeholder="0 = zdarma"
                                title="Při uznané reklamaci 0 Kč, při neuznané uvedte cenu opravy"
                                style={{ ...baseFieldInput, width: 100, fontWeight: 700 }}
                              />
                            </div>
                            <button
                              type="button"
                              onClick={() => setResolutionItems(resolutionItems.filter((x) => x.id !== item.id))}
                              style={{ padding: "8px 12px", borderRadius: 8, border: "1px solid var(--border)", background: "var(--panel)", color: "var(--text)", fontWeight: 600, cursor: "pointer", fontSize: 12 }}
                            >
                              Odstranit
                            </button>
                          </div>
                          <textarea
                            value={item.description ?? ""}
                            onChange={(e) => setResolutionItems(resolutionItems.map((x) => (x.id === item.id ? { ...x, description: e.target.value || undefined } : x)))}
                            placeholder="Popis (volitelné)"
                            rows={2}
                            style={{ ...baseFieldInput, minHeight: 50, fontSize: 12 }}
                          />
                        </div>
                      ))
                    )}
                    <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
                      <button
                        type="button"
                        disabled={resolutionItems.length > 0 && !resolutionItems[resolutionItems.length - 1]?.name?.trim()}
                        onClick={() => setResolutionItems([...resolutionItems, { id: (crypto as any).randomUUID?.() ?? `z-${Date.now()}`, name: "" }])}
                        style={{
                          ...primaryBtn,
                          display: "inline-flex",
                          alignItems: "center",
                          gap: 8,
                          padding: "10px 14px",
                          opacity: resolutionItems.length > 0 && !resolutionItems[resolutionItems.length - 1]?.name?.trim() ? 0.6 : 1,
                          cursor: resolutionItems.length > 0 && !resolutionItems[resolutionItems.length - 1]?.name?.trim() ? "not-allowed" : "pointer",
                        }}
                        title={resolutionItems.length > 0 && !resolutionItems[resolutionItems.length - 1]?.name?.trim() ? "Vyplňte název posledního zákroku" : "Přidat zákrok"}
                      >
                        <span>+</span> Přidat zákrok
                      </button>
                      {claimResolutionDraft !== null && (
                        <button
                          type="button"
                          onClick={() => {
                            saveClaimResolutionItems(detailedClaim!.id, claimResolutionDraft!).then((ok) => ok && showToast("Zákroky uloženy", "success"));
                          }}
                          style={{ ...primaryBtn, display: "inline-flex", alignItems: "center", gap: 8, padding: "10px 14px", background: "var(--accent)", color: "var(--accent-fg)" }}
                        >
                          Uložit zákroky
                        </button>
                      )}
                    </div>
                    {resolutionItems.length > 0 && (() => {
                      const total = resolutionItems.reduce((sum, r) => sum + (r.price || 0), 0);
                      return (
                        <div style={{ marginTop: 4, paddingTop: 8, borderTop: "1px solid var(--border)", fontSize: 14, fontWeight: 800, color: "var(--text)" }}>
                          Celkem: {total.toLocaleString("cs-CZ")} Kč
                          {total === 0 && resolutionItems.some((r) => r.price === 0 || r.price === undefined) && (
                            <span style={{ fontSize: 12, fontWeight: 500, color: "var(--muted)", marginLeft: 8 }}>(vše zdarma)</span>
                          )}
                        </div>
                      );
                    })()}
                  </div>
                );
              })()}
            </div>
            <div style={{ ...card, gridColumn: "1 / -1", display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
              <div style={{ fontWeight: 950, fontSize: 14, color: "var(--text)", marginBottom: 0 }}>Stav</div>
              <div onClick={(e) => e.stopPropagation()} onMouseDown={(e) => e.stopPropagation()}>
                {!isEditingClaim ? (
                  <StatusPicker value={c.status} statuses={statuses as any} getByKey={getByKey as any} onChange={(next) => setClaimStatus(detailedClaim.id, next)} size="sm" />
                ) : (
                  <StatusPicker value={c.status ?? "received"} statuses={statuses as any} getByKey={getByKey as any} onChange={(next) => setEditedClaim((p) => ({ ...p, status: next }))} size="sm" />
                )}
              </div>
              <span style={{ fontSize: 12, color: "var(--muted)" }}>Vytvořeno: {formatCZ(c.created_at)}</span>
              {c.updated_at && <span style={{ fontSize: 12, color: "var(--muted)" }}>· Upraveno: {formatCZ(c.updated_at)}</span>}
            </div>
          </div>

          {sourceTicket ? (
            <>
              <div style={{ ...card, marginTop: 16 }}>
                <div style={{ fontWeight: 950, fontSize: 14, color: "var(--text)", marginBottom: 12 }}>🔍 Diagnostika</div>
                <div style={{ fontSize: 12, color: "var(--muted)", marginBottom: 10 }}>Údaje napojené zakázky. Pro uložení do databáze otevřete zakázku a klikněte na Uložit.</div>
                <div style={{ display: "grid", gap: 12 }}>
                  <div>
                    <div style={fieldLabel}>Diagnostický protokol</div>
                    <textarea
                      value={sourceTicket.diagnosticText || ""}
                      onChange={(e) =>
                        setCloudTickets((prev) =>
                          prev.map((t) => (t.id === sourceTicket.id ? { ...t, diagnosticText: e.target.value } : t))
                        )
                      }
                      style={baseFieldTextArea}
                      placeholder="Zadejte výsledky diagnostiky zařízení..."
                      rows={6}
                    />
                  </div>
                  {(sourceTicket.diagnosticPhotosBefore?.length ?? 0) > 0 && (
                    <div>
                      <div style={fieldLabel}>Fotky před</div>
                      <div style={{ display: "flex", flexWrap: "wrap", gap: 12, marginTop: 8 }}>
                        {(sourceTicket.diagnosticPhotosBefore || []).map((photoUrl, idx) => (
                          <div key={idx} style={{ position: "relative" }}>
                            <img
                              src={photoUrl}
                              alt={`Fotka před ${idx + 1}`}
                              role="button"
                              tabIndex={0}
                              onClick={() => setPhotoLightbox({ urls: sourceTicket.diagnosticPhotosBefore || [], index: idx, ticketCode: sourceTicket.code })}
                              onKeyDown={(e) => e.key === "Enter" && setPhotoLightbox({ urls: sourceTicket.diagnosticPhotosBefore || [], index: idx, ticketCode: sourceTicket.code })}
                              style={{ width: 120, height: 120, objectFit: "cover", borderRadius: 8, border: "1px solid var(--border)", cursor: "pointer" }}
                            />
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                (async () => {
                                  const url = (sourceTicket.diagnosticPhotosBefore || [])[idx];
                                  if (url && isDiagnosticPhotoStorageUrl(url) && supabase) {
                                    try { await deleteDiagnosticPhotoFromStorage(supabase, url); } catch (_) {}
                                  }
                                  setCloudTickets((prev) =>
                                    prev.map((t) =>
                                      t.id === sourceTicket.id
                                        ? { ...t, diagnosticPhotosBefore: (t.diagnosticPhotosBefore || []).filter((_, i) => i !== idx) }
                                        : t
                                    )
                                  );
                                })();
                              }}
                              style={{
                                position: "absolute", top: 4, right: 4, width: 24, height: 24, borderRadius: "50%",
                                background: "rgba(239, 68, 68, 0.9)", color: "white", border: "none", cursor: "pointer",
                                display: "flex", alignItems: "center", justifyContent: "center", fontSize: 14, fontWeight: 700,
                              }}
                            >
                              ×
                            </button>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                  <div>
                    <div style={fieldLabel}>Diagnostické fotografie</div>
                    <div style={{ display: "flex", flexWrap: "wrap", gap: 12, marginTop: 8 }}>
                      {(sourceTicket.diagnosticPhotos || []).map((photoUrl, idx) => (
                        <div key={idx} style={{ position: "relative" }}>
                          <img
                            src={photoUrl}
                            alt={`Diagnostika ${idx + 1}`}
                            role="button"
                            tabIndex={0}
                            onClick={() => setPhotoLightbox({ urls: sourceTicket.diagnosticPhotos || [], index: idx, ticketCode: sourceTicket.code })}
                            onKeyDown={(e) => e.key === "Enter" && setPhotoLightbox({ urls: sourceTicket.diagnosticPhotos || [], index: idx, ticketCode: sourceTicket.code })}
                            style={{ width: 120, height: 120, objectFit: "cover", borderRadius: 8, border: "1px solid var(--border)", cursor: "pointer" }}
                          />
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              (async () => {
                              const url = (sourceTicket.diagnosticPhotos || [])[idx];
                              if (url && isDiagnosticPhotoStorageUrl(url) && supabase) {
                                try {
                                  await deleteDiagnosticPhotoFromStorage(supabase, url);
                                } catch (_) {}
                              }
                              setCloudTickets((prev) =>
                                prev.map((t) =>
                                  t.id === sourceTicket.id ? { ...t, diagnosticPhotos: (t.diagnosticPhotos || []).filter((_, i) => i !== idx) } : t
                                )
                              );
                            })();
                            }}
                            style={{
                              position: "absolute",
                              top: 4,
                              right: 4,
                              width: 24,
                              height: 24,
                              borderRadius: "50%",
                              background: "rgba(239, 68, 68, 0.9)",
                              color: "white",
                              border: "none",
                              cursor: "pointer",
                              display: "flex",
                              alignItems: "center",
                              justifyContent: "center",
                              fontSize: 14,
                              fontWeight: 700,
                            }}
                          >
                            ×
                          </button>
                        </div>
                      ))}
                    </div>
                    <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 8, alignItems: "center" }}>
                      <button
                        type="button"
                        onClick={async () => {
                          if (!supabase || !supabaseUrl || !supabaseAnonKey || !activeServiceId || !sourceTicket?.id) return;
                          const client = supabase!;
                          setCaptureQRLoading(true);
                          try {
                          let lastErr: unknown = null;
                          for (let attempt = 0; attempt < 2; attempt++) {
                            try {
                              const doRequest = async (retry = false): Promise<Response> => {
                                const { data: refreshData, error: refreshErr } = await client.auth.refreshSession();
                                if (refreshErr && !retry) {
                                  throw new Error("Session vypršela. Odhlaste se a přihlaste znovu.");
                                }
                                const token = refreshData?.session?.access_token ?? (await client.auth.getSession()).data?.session?.access_token;
                                if (!token) {
                                  throw new Error("Nejste přihlášeni.");
                                }
                                return supabaseFetch(`${supabaseUrl}/functions/v1/capture-create-token`, {
                                  method: "POST",
                                  headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}`, apikey: supabaseAnonKey },
                                  body: JSON.stringify({ ticketId: sourceTicket.id }),
                                });
                              };
                              let res = await doRequest();
                              if (res.status === 401) {
                                res = await doRequest(true);
                              }
                              const raw = await res.text();
                              let data: { url?: string; error?: string; detail?: string } = {};
                              try { if (raw) data = JSON.parse(raw); } catch {}
                              if (!res.ok) {
                                if (res.status === 401) throw new Error("Přihlášení vypršelo. Odhlaste se a přihlaste znovu.");
                                throw new Error(data?.error || data?.detail || res.statusText || "Chyba serveru");
                              }
                              if (data?.error) throw new Error(data.error);
                              if (!data?.url) throw new Error("Chybí URL v odpovědi");
                              setCaptureQRItems([{ deviceLabel: (detailedTicket?.deviceLabel) || "Zakázka", url: data.url }]);
                              return;
                            } catch (err) {
                              lastErr = err;
                              const msg = err instanceof Error ? err.message : String(err);
                              if (attempt === 0 && (msg.includes("síťový modul") || msg.includes("Nelze načíst"))) {
                                resetTauriFetchState();
                                continue;
                              }
                              break;
                            }
                          }
                            showToast(normalizeError(lastErr) || "Nepodařilo vytvořit QR odkaz.", "error");
                          } finally {
                            setCaptureQRLoading(false);
                          }
                        }}
                        disabled={!supabase || !activeServiceId || !sourceTicket?.id || diagnosticPhotosUploading || captureQRLoading}
                        style={{ ...softBtn, padding: "8px 14px", fontSize: 13 }}
                      >
                        {captureQRLoading ? "⏳ Vytvářím…" : "📱 Vyfotit z telefonu"}
                      </button>
                      <label style={{ ...baseFieldInput, padding: "8px 12px", cursor: diagnosticPhotosUploading ? "wait" : "pointer", margin: 0 }}>
                        <input
                          type="file"
                          accept="image/*"
                          multiple
                          disabled={diagnosticPhotosUploading}
                          style={{ display: "none" }}
                          onChange={async (e) => {
                            const files = Array.from(e.target.files || []);
                            e.target.value = "";
                            if (!files.length) return;
                            const hasId = !!(activeServiceId && sourceTicket.id);
                            if (hasId && supabase) {
                              setDiagnosticPhotosUploading(true);
                              try {
                                const urls: string[] = [];
                                for (const file of files) {
                                  const url = await uploadDiagnosticPhotoWithWatermark(supabase, activeServiceId!, sourceTicket.id!, file);
                                  urls.push(url);
                                }
                                const uid = session?.user?.id;
                                if (uid) checkAchievementOnFirstCapturePhoto(uid);
                                setCloudTickets((prev) =>
                                  prev.map((t) =>
                                    t.id === sourceTicket.id ? { ...t, diagnosticPhotos: [...(t.diagnosticPhotos || []), ...urls] } : t
                                  )
                                );
                              } catch (err) {
                                showToast(`Nahrání fotky se nezdařilo: ${normalizeError(err) || "neznámá chyba"}`, "error");
                              } finally {
                                setDiagnosticPhotosUploading(false);
                              }
                            } else {
                              const reader = (file: File) =>
                                new Promise<string>((resolve, reject) => {
                                  const r = new FileReader();
                                  r.onload = () => resolve(r.result as string);
                                  r.onerror = () => reject(new Error("Načtení souboru selhalo"));
                                  r.readAsDataURL(file);
                                });
                              try {
                                const results = await Promise.all(files.map(reader));
                                setCloudTickets((prev) =>
                                  prev.map((t) =>
                                    t.id === sourceTicket.id ? { ...t, diagnosticPhotos: [...(t.diagnosticPhotos || []), ...results] } : t
                                  )
                                );
                              } catch (_) {
                                showToast("Nepodařilo se načíst vybrané soubory.", "error");
                              }
                            }
                          }}
                        />
                        Nahrát soubory
                      </label>
                      {diagnosticPhotosUploading && (
                        <span style={{ fontSize: 12, color: "var(--text-secondary)" }}>Nahrávám…</span>
                      )}
                    </div>
                  </div>
                </div>
              </div>

              <div style={{ ...card, marginTop: 16 }}>
                <div style={{ fontWeight: 950, fontSize: 13, color: "var(--text)" }}>💬 Interní komentáře (chat)</div>
                <div style={{ marginTop: 10, display: "grid", gap: 10 }}>
                  {commentsFor(sourceTicket.id).map((c) => {
                    const commentAuthorName = c.author_nickname ?? c.author ?? "Servis";
                    const commentAvatarUrl = c.author_avatar_url?.trim() || null;
                    return (
                      <div
                        key={c.id}
                        style={{
                          border,
                          borderRadius: 14,
                          background: "var(--panel)",
                          padding: 12,
                          boxShadow: c.pinned ? "0 14px 30px rgba(0,0,0,0.16)" : "none",
                        }}
                      >
                        <div style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "center" }}>
                          <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
                            {commentAvatarUrl ? (
                              <img
                                src={commentAvatarUrl}
                                alt=""
                                style={{ width: 28, height: 28, borderRadius: 10, objectFit: "cover", border: "1px solid var(--border)" }}
                                onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
                              />
                            ) : (
                              <div
                                style={{
                                  width: 28,
                                  height: 28,
                                  borderRadius: 10,
                                  background: "var(--accent-soft)",
                                  color: "var(--accent)",
                                  display: "grid",
                                  placeItems: "center",
                                  fontSize: 12,
                                  fontWeight: 800,
                                }}
                              >
                                {(commentAuthorName || "?").charAt(0).toUpperCase()}
                              </div>
                            )}
                            <div style={{ fontWeight: 950 }}>{commentAuthorName}</div>
                            {c.pinned && (
                              <div style={{ fontSize: 11, fontWeight: 950, padding: "4px 8px", borderRadius: 999, background: "var(--panel-2)", border, color: "var(--muted)" }}>
                                PINNED
                              </div>
                            )}
                          </div>
                          <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
                            <div style={{ color: "var(--muted)", fontSize: 12 }}>{formatCZ(c.createdAt)}</div>
                            <button
                              onClick={() => togglePin(sourceTicket.id, c.id)}
                              style={{
                                padding: "8px 10px",
                                borderRadius: 12,
                                border,
                                background: c.pinned ? "var(--panel-2)" : "var(--panel)",
                                color: "var(--text)",
                                fontWeight: 950,
                                cursor: "pointer",
                                fontFamily: "inherit",
                              }}
                              title={c.pinned ? "Odepnout" : "Připnout"}
                            >
                              {c.pinned ? "Unpin" : "Pin"}
                            </button>
                          </div>
                        </div>
                        <div style={{ marginTop: 6, whiteSpace: "pre-wrap" }}>{c.text}</div>
                      </div>
                    );
                  })}
                  {commentsFor(sourceTicket.id).length === 0 && <div style={{ color: "var(--muted)" }}>Zatím žádné komentáře.</div>}
                  <div style={{ display: "grid", gap: 8 }}>
                    <textarea
                      value={commentDraftByTicket[sourceTicket.id] ?? ""}
                      onChange={(e) => setCommentDraftByTicket((p) => ({ ...p, [sourceTicket.id]: e.target.value }))}
                      style={{ ...baseFieldTextArea, minHeight: 90 }}
                      placeholder="Napiš interní komentář k zakázce…"
                      onKeyDown={(e) => {
                        if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
                          e.preventDefault();
                          addComment(sourceTicket.id);
                        }
                      }}
                    />
                    <div style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "center" }}>
                      <div style={{ color: "var(--muted)", fontSize: 12 }}>Tip: <b>Ctrl+Enter</b> pro odeslání.</div>
                      <button style={{ ...primaryBtn, padding: "10px 14px" }} onClick={() => addComment(sourceTicket.id)}>
                        Přidat komentář
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            </>
          ) : (
            <div style={{ ...card, marginTop: 16, color: "var(--muted)", fontSize: 13 }}>
              Reklamace není napojená na zakázku. Diagnostiku a komentáře lze přidat u navázané zakázky.
            </div>
          )}
          </>
          );
        })()}
        {detailedTicket && (
          <>
            {!isEditing ? (
              <>
                <div style={{ marginTop: 20, display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
                  <div style={card}>
                    <div style={{ fontWeight: 950, fontSize: 14, color: "var(--text)", marginBottom: 12 }}>👤 Zákazník</div>
                    <div style={{ display: "grid", gap: 8 }}>
                      <div
                        onClick={() => {
                          const customerId = detailedTicket.customerId;
                          if (customerId && onOpenCustomer) {
                            onOpenCustomer(customerId);
                          }
                        }}
                        style={{
                          fontSize: 15,
                          fontWeight: 800,
                          color: "var(--text)",
                          cursor: detailedTicket.customerId ? "pointer" : "default",
                        }}
                        title={detailedTicket.customerId ? "Otevřít profil zákazníka" : undefined}
                        onMouseEnter={(e) => {
                          if (detailedTicket.customerId) {
                            e.currentTarget.style.opacity = "0.8";
                          }
                        }}
                        onMouseLeave={(e) => {
                          e.currentTarget.style.opacity = "1";
                        }}
                      >
                        {detailedTicket.customerName}
                      </div>
                      {detailedTicket.customerPhone && (
                        <div style={{ fontSize: 13, color: "var(--text)", display: "flex", alignItems: "center", gap: 6 }}>
                          <span>📞</span>
                          <span>{formatPhoneNumber(detailedTicket.customerPhone)}</span>
                        </div>
                      )}
                      {detailedTicket.customerEmail && (
                        <div style={{ fontSize: 13, color: "var(--text)", display: "flex", alignItems: "center", gap: 6 }}>
                          <span>✉️</span>
                          <span>{detailedTicket.customerEmail}</span>
                        </div>
                      )}
                      {[detailedTicket.customerAddressStreet, detailedTicket.customerAddressCity, detailedTicket.customerAddressZip].filter(Boolean).length >
                        0 && (
                        <div style={{ fontSize: 13, color: "var(--text)", display: "flex", alignItems: "center", gap: 6, marginTop: 4 }}>
                          <span>📍</span>
                          <span>
                            {[detailedTicket.customerAddressStreet, detailedTicket.customerAddressCity, detailedTicket.customerAddressZip]
                              .filter(Boolean)
                              .join(", ")}
                          </span>
                        </div>
                      )}
                    </div>
                  </div>

                  {(() => {
                    const claimsForTicket = detailedTicket ? cloudClaims.filter((c) => c.source_ticket_id === detailedTicket.id) : [];
                    return claimsForTicket.length > 0 ? (
                      <div style={{ gridColumn: "1 / -1", ...card, border: "2px solid rgba(13,148,136,0.3)", background: "linear-gradient(180deg, rgba(20,184,166,0.05) 0%, rgba(15,118,110,0.03) 100%)" }}>
                        <div style={{ fontWeight: 950, fontSize: 14, color: "var(--text)", marginBottom: 12, display: "flex", alignItems: "center", gap: 8 }}>
                          <span style={{ padding: "3px 8px", borderRadius: 6, background: "rgba(13,148,136,0.18)", color: "#134e4a", fontWeight: 800, fontSize: 12 }}>Reklamace k této zakázce</span>
                        </div>
                        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                          {claimsForTicket.map((c) => (
                            <button
                              key={c.id}
                              type="button"
                              onClick={() => { setDetailClaimId(c.id); setDetailId(null); }}
                              style={{ textAlign: "left", padding: "12px 14px", borderRadius: 10, border: "2px solid rgba(13,148,136,0.45)", background: "linear-gradient(135deg, rgba(20,184,166,0.1) 0%, rgba(15,118,110,0.05) 100%)", color: "var(--text)", fontSize: 13, cursor: "pointer", display: "flex", justifyContent: "space-between", alignItems: "center", fontWeight: 700, boxShadow: "0 1px 4px rgba(13,148,136,0.12)" }}
                            >
                              <span style={{ fontWeight: 800 }}>{c.code}</span>
                              <span style={{ color: "#134e4a", fontSize: 12, fontWeight: 600 }}>{getByKey(c.status)?.label ?? c.status}</span>
                            </button>
                          ))}
                        </div>
                      </div>
                    ) : null;
                  })()}

                  <div style={card}>
                    <div style={{ fontWeight: 950, fontSize: 14, color: "var(--text)", marginBottom: 12 }}>📱 Zařízení</div>
                    <div style={{ display: "grid", gap: 8 }}>
                      <div style={{ fontSize: 15, fontWeight: 800, color: "var(--text)" }}>{detailedTicket.deviceLabel}</div>
                      {detailedTicket.serialOrImei && (
                        <div style={{ fontSize: 13, color: "var(--text)", display: "flex", alignItems: "center", gap: 6 }}>
                          <span>🔢</span>
                          <span>SN: {detailedTicket.serialOrImei}</span>
                        </div>
                      )}
                      <div
                        style={{
                          fontSize: 14,
                          fontWeight: 700,
                          color: "var(--text)",
                          marginTop: 8,
                          padding: 10,
                          borderRadius: 12,
                          background: "var(--panel-2)",
                          border: "1px solid var(--border)",
                        }}
                      >
                        🔧 {detailedTicket.requestedRepair ?? detailedTicket.issueShort}
                      </div>
                    </div>
                  </div>
                </div>
              </>
            ) : (
              // EDIT
              <div style={{ marginTop: 20 }}>
                <div style={{ fontWeight: 950, fontSize: 16, color: "var(--text)", marginBottom: 16 }}>Upravit zakázku</div>

                <div style={{ display: "grid", gap: 16 }}>
                  <div style={card}>
                    <div style={{ fontWeight: 950, fontSize: 14, color: "var(--text)", marginBottom: 12 }}>👤 Zákazník</div>
                    <div style={{ display: "grid", gap: 12 }}>
                      <div>
                        <div style={fieldLabel}>Jméno *</div>
                        <input
                          type="text"
                          value={editedTicket.customerName || ""}
                          onChange={(e) => setEditedTicket((p) => ({ ...p, customerName: e.target.value }))}
                          onBlur={async () => {
                            const phone = editedTicket.customerPhone?.trim();
                            const name = editedTicket.customerName?.trim();
                            if (phone && name) {
                              await lookupCustomerEdit(phone, name);
                            }
                          }}
                          style={baseFieldInput}
                          placeholder="Jméno zákazníka"
                        />
                      </div>
                      <div>
                        <div style={fieldLabel}>Telefon{uiCfg.orders.customerPhoneRequired ? " *" : ""}</div>
                        <input
                          type="text"
                          value={editedTicket.customerPhone || ""}
                          onChange={(e) => {
                            const cleaned = e.target.value.replace(/\D/g, "");
                            setEditedTicket((p) => ({ ...p, customerPhone: cleaned }));
                            // Clear matched customer when phone changes
                            if (matchedCustomerEdit) setMatchedCustomerEdit(null);
                            
                            // Trigger lookup if phone is valid (without waiting for blur)
                            if (cleaned.trim()) {
                              const phoneNorm = normalizePhone(cleaned);
                              if (phoneNorm) {
                                const name = editedTicket.customerName?.trim();
                                lookupCustomerEdit(cleaned, name);
                              }
                            }
                          }}
                          onKeyDown={async (e) => {
                            if (e.key === "Enter") {
                              const phone = editedTicket.customerPhone?.trim();
                              const name = editedTicket.customerName?.trim();
                              if (phone) {
                                await lookupCustomerEdit(phone, name);
                              }
                            }
                          }}
                          onBlur={async () => {
                            const phone = editedTicket.customerPhone?.trim();
                            const name = editedTicket.customerName?.trim();
                            if (phone) {
                              await lookupCustomerEdit(phone, name);
                            } else {
                              setMatchedCustomerEdit(null);
                            }
                          }}
                          style={baseFieldInput}
                          placeholder="(+420) xxx xxx xxx"
                        />
                        
                        {/* Customer match panel for Edit */}
                        {matchedCustomerEdit && (
                          <div
                            style={{
                              marginTop: 12,
                              padding: 12,
                              background: "var(--accent-light)",
                              borderRadius: 8,
                              border: "1px solid var(--accent)",
                            }}
                          >
                            <div style={{ fontSize: 13, fontWeight: 600, color: "var(--text)", marginBottom: 8 }}>
                              Chcete změnit zákazníka této zakázky?
                            </div>
                            <div style={{ fontSize: 12, color: "var(--muted)", marginBottom: 10 }}>
                              <div><strong>Jméno:</strong> {matchedCustomerEdit.name}</div>
                              {matchedCustomerEdit.phone && <div><strong>Telefon:</strong> {matchedCustomerEdit.phone}</div>}
                              {matchedCustomerEdit.email && <div><strong>E-mail:</strong> {matchedCustomerEdit.email}</div>}
                              {matchedCustomerEdit.company && <div><strong>Firma:</strong> {matchedCustomerEdit.company}</div>}
                            </div>
                            <div style={{ display: "flex", gap: 8 }}>
                              <button
                                onClick={async () => {
                                  // Load full customer data for prefill
                                  if (!supabase || !activeServiceId) return;
                                  const { data } = await (supabase
                                    .from("customers") as any)
                                    .select("id,name,phone,email,company,ico,address_street,address_city,address_zip,note")
                                    .eq("id", matchedCustomerEdit.id)
                                    .eq("service_id", activeServiceId)
                                    .single();
                                  
                                  if (data) {
                                    // Audit: Log customer data loaded from DB
                                    devLog("[EditTicket] Customer data loaded from DB:", {
                                      id: data.id,
                                      name: data.name,
                                      phone: data.phone,
                                      email: data.email,
                                      address_street: data.address_street,
                                      address_city: data.address_city,
                                      address_zip: data.address_zip,
                                      company: data.company,
                                      ico: data.ico,
                                      note: data.note,
                                    });
                                    
                                    // User explicitly confirmed change - update all customer snapshot fields
                                    const updatedFields = {
                                      customerId: data.id,
                                      customerName: data.name || "",
                                      customerPhone: data.phone || "",
                                      customerEmail: data.email || "",
                                      customerAddressStreet: data.address_street || "",
                                      customerAddressCity: data.address_city || "",
                                      customerAddressZip: data.address_zip || "",
                                      customerCompany: data.company || "",
                                      customerIco: data.ico || "",
                                      customerInfo: data.note || "",
                                    };
                                    
                                    // Audit: Log what we're setting to editedTicket
                                    devLog("[EditTicket] Setting to editedTicket:", updatedFields);
                                    
                                    setEditedTicket((prev) => ({
                                      ...prev,
                                      ...updatedFields,
                                    }));
                                  }
                                  setMatchedCustomerEdit(null);
                                }}
                                style={{
                                  padding: "6px 12px",
                                  borderRadius: 6,
                                  border: "none",
                                  background: "var(--accent)",
                                  color: "white",
                                  fontWeight: 600,
                                  fontSize: 12,
                                  cursor: "pointer",
                                }}
                              >
                                Změnit zákazníka
                              </button>
                              <button
                                onClick={() => setMatchedCustomerEdit(null)}
                                style={{
                                  padding: "6px 12px",
                                  borderRadius: 6,
                                  border: "1px solid var(--border)",
                                  background: "transparent",
                                  color: "var(--text)",
                                  fontWeight: 500,
                                  fontSize: 12,
                                  cursor: "pointer",
                                }}
                              >
                                Ne, ponechat
                              </button>
                            </div>
                          </div>
                        )}
                      </div>
                      <div>
                        <div style={fieldLabel}>E-mail</div>
                        <input
                          type="email"
                          value={editedTicket.customerEmail || ""}
                          onChange={(e) => setEditedTicket((p) => ({ ...p, customerEmail: e.target.value }))}
                          style={baseFieldInput}
                          placeholder="email@example.com"
                        />
                      </div>
                      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                        <div>
                          <div style={fieldLabel}>Ulice</div>
                          <input
                            type="text"
                            value={editedTicket.customerAddressStreet || ""}
                            onChange={(e) => setEditedTicket((p) => ({ ...p, customerAddressStreet: e.target.value }))}
                            style={baseFieldInput}
                            placeholder="Ulice a číslo"
                          />
                        </div>
                        <div>
                          <div style={fieldLabel}>Město</div>
                          <input
                            type="text"
                            value={editedTicket.customerAddressCity || ""}
                            onChange={(e) => setEditedTicket((p) => ({ ...p, customerAddressCity: e.target.value }))}
                            style={baseFieldInput}
                            placeholder="Město"
                          />
                        </div>
                      </div>
                      <div>
                        <div style={fieldLabel}>PSČ</div>
                        <input
                          type="text"
                          value={editedTicket.customerAddressZip || ""}
                          onChange={(e) => setEditedTicket((p) => ({ ...p, customerAddressZip: e.target.value.replace(/\D/g, "") }))}
                          style={baseFieldInput}
                          placeholder="123 45"
                        />
                      </div>
                      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                        <div>
                          <div style={fieldLabel}>Firma</div>
                          <input
                            type="text"
                            value={editedTicket.customerCompany || ""}
                            onChange={(e) => setEditedTicket((p) => ({ ...p, customerCompany: e.target.value }))}
                            style={baseFieldInput}
                            placeholder="Název firmy"
                          />
                        </div>
                        <div>
                          <div style={fieldLabel}>IČO</div>
                          <input
                            type="text"
                            value={editedTicket.customerIco || ""}
                            onChange={(e) => setEditedTicket((p) => ({ ...p, customerIco: e.target.value.replace(/\D/g, "") }))}
                            style={baseFieldInput}
                            placeholder="12345678"
                          />
                        </div>
                      </div>
                      <div>
                        <div style={fieldLabel}>Poznámka o zákazníkovi</div>
                        <textarea
                          value={editedTicket.customerInfo || ""}
                          onChange={(e) => setEditedTicket((p) => ({ ...p, customerInfo: e.target.value }))}
                          style={baseFieldTextArea}
                          placeholder="Dodatečné informace o zákazníkovi..."
                        />
                      </div>
                    </div>
                  </div>

                  <div style={card}>
                    <div style={{ fontWeight: 950, fontSize: 14, color: "var(--text)", marginBottom: 12 }}>📱 Zařízení</div>
                    <div style={{ display: "grid", gap: 12 }}>
                      <div>
                        <div style={fieldLabel}>Zařízení *</div>
                        <DeviceAutocomplete
                          value={editedTicket.deviceLabel || ""}
                          onChange={(value) => setEditedTicket((p) => ({ ...p, deviceLabel: value }))}
                          models={modelsWithHierarchy}
                          error={undefined}
                        />
                      </div>
                      <div>
                        <div style={fieldLabel}>Sériové číslo / IMEI</div>
                        <input
                          type="text"
                          value={editedTicket.serialOrImei || ""}
                          onChange={(e) => setEditedTicket((p) => ({ ...p, serialOrImei: e.target.value }))}
                          style={baseFieldInput}
                          placeholder="SN123456789"
                        />
                      </div>
                      <div>
                        <div style={fieldLabel}>Požadovaná oprava *</div>
                        <input
                          type="text"
                          value={editedTicket.requestedRepair || ""}
                          onChange={(e) => setEditedTicket((p) => ({ ...p, requestedRepair: e.target.value }))}
                          style={baseFieldInput}
                          placeholder="Popis požadované opravy"
                        />
                      </div>
                      <div>
                        <div style={fieldLabel}>Heslo/kód zařízení</div>
                        <input
                          type="text"
                          value={editedTicket.devicePasscode || ""}
                          onChange={(e) => setEditedTicket((p) => ({ ...p, devicePasscode: e.target.value }))}
                          style={baseFieldInput}
                          placeholder="Heslo nebo kód"
                        />
                      </div>
                      <div>
                        <div style={fieldLabel}>Popis stavu zařízení</div>
                        <input
                          list="edit-device-condition-list"
                          value={editedTicket.deviceCondition || ""}
                          onChange={(e) => setEditedTicket((p) => ({ ...p, deviceCondition: e.target.value }))}
                          style={baseFieldInput}
                          placeholder="Vyberte nebo napište vlastní..."
                        />
                        <datalist id="edit-device-condition-list">
                          {getDeviceOptions().deviceConditions.map((c, i) => (
                            <option key={i} value={c} />
                          ))}
                        </datalist>
                      </div>
                      <div>
                        <div style={fieldLabel}>Příslušenství</div>
                        <input
                          list="edit-device-accessories-list"
                          value={editedTicket.deviceAccessories || ""}
                          onChange={(e) => setEditedTicket((p) => ({ ...p, deviceAccessories: e.target.value }))}
                          style={baseFieldInput}
                          placeholder="Vyberte nebo napište vlastní..."
                        />
                        <datalist id="edit-device-accessories-list">
                          {getDeviceOptions().deviceAccessories.map((a, i) => (
                            <option key={i} value={a} />
                          ))}
                        </datalist>
                      </div>
                      <div>
                        <div style={fieldLabel}>Poznámka k zařízení</div>
                        <textarea
                          value={editedTicket.deviceNote || ""}
                          onChange={(e) => setEditedTicket((p) => ({ ...p, deviceNote: e.target.value }))}
                          style={baseFieldTextArea}
                          placeholder="Dodatečné poznámky k zařízení..."
                        />
                      </div>
                      <div>
                        <div style={fieldLabel}>Způsob převzetí</div>
                        <HandoffMethodSelect
                          options={getHandoffOptions().receiveMethods}
                          value={editedTicket.handoffMethod || ""}
                          onChange={(v) => setEditedTicket((p) => ({ ...p, handoffMethod: v }))}
                          extraOption={editedTicket.handoffMethod || undefined}
                          triggerStyle={baseFieldInput}
                        />
                      </div>
                      <div>
                        <div style={fieldLabel}>Způsob předání</div>
                        <HandoffMethodSelect
                          options={getHandoffOptions().returnMethods}
                          value={editedTicket.handbackMethod || ""}
                          onChange={(v) => setEditedTicket((p) => ({ ...p, handbackMethod: v }))}
                          extraOption={editedTicket.handbackMethod || undefined}
                          triggerStyle={baseFieldInput}
                        />
                      </div>
                      <div>
                        <div style={fieldLabel}>Externí ID</div>
                        <input
                          type="text"
                          value={editedTicket.externalId || ""}
                          onChange={(e) => setEditedTicket((p) => ({ ...p, externalId: e.target.value }))}
                          style={baseFieldInput}
                          placeholder="Externí identifikátor"
                        />
                      </div>
                      <div>
                        <div style={fieldLabel}>Předpokládané datum/čas dokončení</div>
                        <DateTimePicker
                          value={
                            (editedTicket as any).expectedCompletionAt ?? (detailedTicket as any).expected_completion_at ?? null
                          }
                          onChange={(v) =>
                            setEditedTicket((p) => ({
                              ...p,
                              expectedCompletionAt: v,
                            } as any))
                          }
                          inputStyle={baseFieldInput}
                        />
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {!isEditing && (
              <>
                <div style={{ ...card, marginTop: 16 }}>
                  <div style={{ fontWeight: 950, fontSize: 14, color: "var(--text)", marginBottom: 12 }}>📊 Stav zakázky</div>
                  <div style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
                    <div onClick={(e) => e.stopPropagation()} onMouseDown={(e) => e.stopPropagation()}>
                      {(() => {
                        const detailStatus = normalizeStatus((detailedTicket.status as any) ?? statusById[detailedTicket.id]);
                        if (detailStatus === null) {
                          return (
                            <div
                              style={{
                                fontSize: 13,
                                padding: "8px 12px",
                                borderRadius: 8,
                                background: "var(--panel-2)",
                                color: "var(--muted)",
                                fontWeight: 600,
                              }}
                            >
                              …
                            </div>
                          );
                        }
                        return (
                      <StatusPicker
                            value={detailStatus}
                        statuses={statuses as any}
                        getByKey={getByKey as any}
                        onChange={(next) => setTicketStatus(detailedTicket.id, next)}
                        size="md"
                      />
                        );
                      })()}
                    </div>
                    {(() => {
                      const detailStatus = normalizeStatus((detailedTicket.status as any) ?? statusById[detailedTicket.id]);
                      if (detailStatus === null) {
                        return null;
                      }
                      return (
                    <div
                      style={{
                        fontSize: 12,
                        padding: "6px 10px",
                        borderRadius: 8,
                            background: isFinal(detailStatus) ? "var(--accent-soft)" : "var(--panel-2)",
                            color: isFinal(detailStatus) ? "var(--accent)" : "var(--muted)",
                        fontWeight: 700,
                      }}
                    >
                          {isFinal(detailStatus) ? "✓ Finální" : "⚡ Aktivní"}
                    </div>
                      );
                    })()}
                  </div>
                </div>

                <div style={{ marginTop: 20, display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
                  <div style={{ ...card, opacity: 0.85 }}>
                    <div
                      style={{
                        fontWeight: 800,
                        fontSize: 12,
                        color: "var(--muted)",
                        marginBottom: 10,
                        textTransform: "uppercase",
                        letterSpacing: "0.5px",
                      }}
                    >
                      Dodatečné informace o zákazníkovi
                    </div>
                    <div style={{ display: "grid", gap: 6, fontSize: 13 }}>
                      {detailedTicket.customerCompany && (
                        <div>
                          <span style={{ color: "var(--muted)" }}>Firma:</span> {detailedTicket.customerCompany}
                        </div>
                      )}
                      {detailedTicket.customerIco && (
                        <div>
                          <span style={{ color: "var(--muted)" }}>IČO:</span> {detailedTicket.customerIco}
                        </div>
                      )}
                      {detailedTicket.customerInfo && (
                        <div
                          style={{
                            marginTop: 6,
                            padding: 10,
                            borderRadius: 10,
                            background: "var(--panel-2)",
                            color: "var(--text)",
                            fontSize: 12,
                            lineHeight: 1.5,
                          }}
                        >
                          {detailedTicket.customerInfo}
                        </div>
                      )}
                    </div>
                  </div>

                  <div style={{ ...card, opacity: 0.85 }}>
                    <div
                      style={{
                        fontWeight: 800,
                        fontSize: 12,
                        color: "var(--muted)",
                        marginBottom: 10,
                        textTransform: "uppercase",
                        letterSpacing: "0.5px",
                      }}
                    >
                      Technické detaily
                    </div>
                    <div style={{ display: "grid", gap: 6, fontSize: 13 }}>
                      {detailedTicket.devicePasscode && (
                        <div>
                          <span style={{ color: "var(--muted)" }}>Heslo/kód:</span> {detailedTicket.devicePasscode}
                        </div>
                      )}
                      {detailedTicket.deviceCondition && (
                        <div style={{ marginTop: 4 }}>
                          <div style={{ color: "var(--muted)", marginBottom: 4 }}>Popis stavu:</div>
                          <div style={{ padding: 8, borderRadius: 8, background: "var(--panel-2)", fontSize: 12, lineHeight: 1.4 }}>
                            {detailedTicket.deviceCondition}
                          </div>
                        </div>
                      )}
                      {detailedTicket.deviceAccessories && (
                        <div style={{ marginTop: 4 }}>
                          <div style={{ color: "var(--muted)", marginBottom: 4 }}>Příslušenství:</div>
                          <div style={{ padding: 8, borderRadius: 8, background: "var(--panel-2)", fontSize: 12, lineHeight: 1.4 }}>
                            {detailedTicket.deviceAccessories}
                          </div>
                        </div>
                      )}
                      {detailedTicket.deviceNote && (
                        <div style={{ marginTop: 4 }}>
                          <div style={{ color: "var(--muted)", marginBottom: 4 }}>Poznámka:</div>
                          <div style={{ padding: 8, borderRadius: 8, background: "var(--panel-2)", fontSize: 12, lineHeight: 1.4 }}>
                            {detailedTicket.deviceNote}
                          </div>
                        </div>
                      )}
                      <div style={{ marginTop: 6, display: "flex", gap: 8, flexWrap: "wrap" }}>
                        {detailedTicket.handoffMethod && (
                          <div style={{ fontSize: 12, color: "var(--muted)" }}>
                            <span>📥</span> Převzetí: {detailedTicket.handoffMethod}
                          </div>
                        )}
                        {detailedTicket.handbackMethod && (
                          <div style={{ fontSize: 12, color: "var(--muted)" }}>
                            <span>📤</span> Předání: {detailedTicket.handbackMethod}
                          </div>
                        )}
                        {detailedTicket.externalId && (
                          <div style={{ fontSize: 12, color: "var(--muted)" }}>
                            <span>🔗</span> Ext: {detailedTicket.externalId}
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                </div>

                <div style={{ ...card, marginTop: 16 }}>
                  <div style={{ fontWeight: 950, fontSize: 14, color: "var(--text)", marginBottom: 12 }}>🔧 Provedené opravy</div>

                  <div style={{ display: "grid", gap: 8, marginBottom: 12 }}>
                    {(detailedTicket.performedRepairs ?? []).map((repair) => (
                      <PerformedRepairItem
                        key={repair.id}
                        repair={repair}
                        onRemove={(repairId) => removePerformedRepair(detailedTicket.id, repairId)}
                        onUpdatePrice={(repairId, price) => updatePerformedRepairPrice(detailedTicket.id, repairId, price)}
                        onUpdateCosts={(repairId, costs) => updatePerformedRepairCosts(detailedTicket.id, repairId, costs)}
                        onUpdateTime={(repairId, time) => updatePerformedRepairTime(detailedTicket.id, repairId, time)}
                        onUpdateProducts={(repairId, productIds) => updatePerformedRepairProducts(detailedTicket.id, repairId, productIds)}
                        devicesData={devicesData}
                        inventoryData={inventoryData}
                      />
                    ))}
                    {(detailedTicket.performedRepairs ?? []).length === 0 && (
                      <div style={{ color: "var(--muted)", fontSize: 13, padding: 12, textAlign: "center" }}>
                        Zatím nebyly přidány žádné opravy
                      </div>
                    )}
                    {(detailedTicket.performedRepairs ?? []).length > 0 && (() => {
                      const totalPrice = (detailedTicket.performedRepairs ?? []).reduce((sum, r) => sum + (r.price || 0), 0);
                      const discountType: "percentage" | "amount" | null = detailedTicket.discountType ?? null;
                      const discountValue = detailedTicket.discountValue || 0;
                      let discountAmount = 0;
                      if (discountType === "percentage") {
                        discountAmount = (totalPrice * discountValue) / 100;
                      } else if (discountType === "amount") {
                        discountAmount = discountValue;
                      }
                      const finalPrice = Math.max(0, totalPrice - discountAmount);
                      
                      return (
                        <div style={{ 
                          padding: 12, 
                          borderRadius: 10,
                          background: "var(--accent-soft)", 
                          border: "1px solid var(--accent)",
                          marginTop: 8,
                        }}>
                          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                              <span style={{ fontWeight: 950, fontSize: 14, color: "var(--text)" }}>Celková cena oprav:</span>
                              <span style={{ fontWeight: 950, fontSize: 16, color: "var(--accent)" }}>
                                {totalPrice} Kč
                              </span>
                            </div>
                            
                            {/* Discount UI */}
                            <div style={{ display: "flex", flexDirection: "column", gap: 6, paddingTop: 8, borderTop: "1px solid var(--border)" }}>
                              <DiscountPicker
                                discountType={discountType ?? null}
                                discountValue={discountValue || 0}
                                onChange={(type, value) => {
                                  setCloudTickets((prev) =>
                                    prev.map((t) =>
                                      t.id === detailedTicket.id
                                        ? { ...t, discountType: type, discountValue: type ? value : undefined }
                                        : t
                                    )
                                  );
                                }}
                              />
                              
                              {discountAmount > 0 && (
                                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                                  <span style={{ fontSize: 12, color: "var(--muted)" }}>
                                    Sleva {discountType === "percentage" ? `(${discountValue}%)` : ""}:
                                  </span>
                                  <span style={{ fontSize: 13, color: "var(--accent)", fontWeight: 700 }}>
                                    -{discountAmount.toFixed(2)} Kč
                                  </span>
                                </div>
                              )}
                              
                              {discountAmount > 0 && (
                                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", paddingTop: 4, borderTop: "1px solid var(--border)" }}>
                                  <span style={{ fontWeight: 950, fontSize: 14, color: "var(--text)" }}>Finální cena:</span>
                                  <span style={{ fontWeight: 950, fontSize: 18, color: "var(--accent)" }}>
                                    {finalPrice.toFixed(2)} Kč
                                  </span>
                        </div>
                              )}
                            </div>
                          </div>
                        </div>
                      );
                    })()}
                  </div>

                  <PerformedRepairAdder 
                    availableRepairs={availableRepairs} 
                    onAdd={(repair) => addPerformedRepair(detailedTicket.id, repair)}
                    deviceLabel={detailedTicket.deviceLabel}
                    devicesData={devicesData}
                    onAddToModel={(repairData) => {
                      // Add repair to model in Devices
                      const currentDevices = safeLoadDevicesData();
                      const newRepair: DeviceRepair = {
                        id: `${Date.now()}_${Math.random()}`,
                        modelIds: [repairData.modelId],
                        name: repairData.name,
                        price: repairData.price || 0,
                        estimatedTime: repairData.estimatedTime || 0,
                        details: "",
                        costs: repairData.costs,
                        productIds: repairData.productIds,
                        createdAt: new Date().toISOString(),
                      };
                      const updatedDevices = {
                        ...currentDevices,
                        repairs: [...currentDevices.repairs, newRepair],
                      };
                      try {
                        localStorage.setItem(STORAGE_KEYS.DEVICES, JSON.stringify(updatedDevices));
                        // Also add to current ticket
                        addPerformedRepair(detailedTicket.id, { name: repairData.name, type: "manual" });
                        showToast(`Oprava "${repairData.name}" byla přidána k modelu a do zakázky.`, "success");
                      } catch (_e) {
                        showToast("Chyba při ukládání opravy k modelu.", "error");
                      }
                    }}
                  />
                </div>

                <div style={{ ...card, marginTop: 16 }}>
                  <div style={{ fontWeight: 950, fontSize: 14, color: "var(--text)", marginBottom: 12 }}>🔍 Diagnostika</div>
                  
                  <div style={{ display: "grid", gap: 12 }}>
                    <div>
                      <div style={fieldLabel}>Diagnostický protokol</div>
                      <textarea
                        value={detailedTicket.diagnosticText || ""}
                        onChange={(e) => {
                          setDirtyFlags((prev) => ({ ...prev, diagnosticText: true }));
                          setCloudTickets((prev) =>
                            prev.map((t) =>
                              t.id === detailedTicket.id
                                ? { ...t, diagnosticText: e.target.value }
                                : t
                            )
                          );
                        }}
                        style={baseFieldTextArea}
                        placeholder="Zadejte výsledky diagnostiky zařízení..."
                        rows={6}
                      />
                    </div>
                    
                    <div>
                      <div style={fieldLabel}>Fotky před</div>
                      <div style={{ display: "flex", flexWrap: "wrap", gap: 12, marginTop: 8 }}>
                        {(detailedTicket.diagnosticPhotosBefore || []).map((photoUrl, idx) => (
                            <div key={idx} style={{ position: "relative" }}>
                              <img
                                src={photoUrl}
                                alt={`Fotka před ${idx + 1}`}
                                role="button"
                                tabIndex={0}
                                onClick={() =>
                                  setPhotoLightbox({
                                    urls: detailedTicket.diagnosticPhotosBefore || [],
                                    index: idx,
                                    ticketCode: detailedTicket.code,
                                  })
                                }
                                onKeyDown={(e) =>
                                  e.key === "Enter" &&
                                  setPhotoLightbox({
                                    urls: detailedTicket.diagnosticPhotosBefore || [],
                                    index: idx,
                                    ticketCode: detailedTicket.code,
                                  })
                                }
                                style={{
                                  width: 120,
                                  height: 120,
                                  objectFit: "cover",
                                  borderRadius: 8,
                                  border: "1px solid var(--border)",
                                  cursor: "pointer",
                                }}
                              />
                              <button
                                onClick={async (e) => {
                                  e.stopPropagation();
                                  const url = (detailedTicket.diagnosticPhotosBefore || [])[idx];
                                  if (url && isDiagnosticPhotoStorageUrl(url)) {
                                    try {
                                      await deleteDiagnosticPhotoFromStorage(supabase, url);
                                    } catch (_) {}
                                  }
                                  setDirtyFlags((prev) => ({ ...prev, diagnosticPhotos: true }));
                                  setCloudTickets((prev) =>
                                    prev.map((t) =>
                                      t.id === detailedTicket.id
                                        ? {
                                            ...t,
                                            diagnosticPhotosBefore: (t.diagnosticPhotosBefore || []).filter((_, i) => i !== idx),
                                          }
                                        : t
                                    )
                                  );
                                }}
                                style={{
                                  position: "absolute",
                                  top: 4,
                                  right: 4,
                                  width: 24,
                                  height: 24,
                                  borderRadius: "50%",
                                  background: "rgba(239, 68, 68, 0.9)",
                                  color: "white",
                                  border: "none",
                                  cursor: "pointer",
                                  display: "flex",
                                  alignItems: "center",
                                  justifyContent: "center",
                                  fontSize: 14,
                                  fontWeight: 700,
                                }}
                              >
                                ×
                              </button>
                            </div>
                          ))}
                      </div>
                      <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 8, alignItems: "center" }}>
                        <button
                          type="button"
                          onClick={async () => {
                            if (!supabase || !supabaseUrl || !supabaseAnonKey || !activeServiceId || !detailedTicket?.id) return;
                            setCaptureQRLoading(true);
                            try {
                              let lastErr: unknown = null;
                              for (let attempt = 0; attempt < 2; attempt++) {
                                try {
                                  const { data: refreshData, error: refreshErr } = await supabase.auth.refreshSession();
                                  if (refreshErr && attempt === 0) throw new Error("Session vypršela.");
                                  const token = refreshData?.session?.access_token ?? (await supabase.auth.getSession()).data?.session?.access_token;
                                  if (!token) throw new Error("Nejste přihlášeni.");
                                  const res = await supabaseFetch(`${supabaseUrl}/functions/v1/capture-create-token`, {
                                    method: "POST",
                                    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}`, apikey: supabaseAnonKey },
                                    body: JSON.stringify({ ticketId: detailedTicket.id, isBefore: true }),
                                  });
                                  const raw = await res.text();
                                  const data: { url?: string; error?: string } = raw ? JSON.parse(raw) : {};
                                  if (!res.ok) throw new Error(data.error || res.statusText);
                                  if (data.url) setCaptureQRItems([{ deviceLabel: detailedTicket.deviceLabel || "Zakázka", url: data.url }]);
                                  return;
                                } catch (err) {
                                  lastErr = err;
                                  const msg = err instanceof Error ? err.message : String(err);
                                  if (attempt === 0 && (msg.includes("síťový modul") || msg.includes("Nelze načíst"))) {
                                    resetTauriFetchState();
                                    continue;
                                  }
                                  break;
                                }
                              }
                              showToast(normalizeError(lastErr) || "Nepodařilo vytvořit QR odkaz.", "error");
                            } finally {
                              setCaptureQRLoading(false);
                            }
                          }}
                          disabled={!supabase || !activeServiceId || !detailedTicket?.id || diagnosticPhotosUploading || captureQRLoading}
                          style={{ ...softBtn, padding: "8px 14px", fontSize: 13 }}
                        >
                          {captureQRLoading ? "⏳ Vytvářím…" : "📱 Vyfotit z telefonu"}
                        </button>
                        <label style={{ ...baseFieldInput, padding: "8px 12px", cursor: diagnosticPhotosUploading ? "wait" : "pointer", margin: 0 }}>
                          <input
                            type="file"
                            accept="image/*"
                            multiple
                            disabled={diagnosticPhotosUploading}
                            style={{ display: "none" }}
                            onChange={async (e) => {
                              const files = Array.from(e.target.files || []);
                              e.target.value = "";
                              if (!files.length || !supabase || !activeServiceId || !detailedTicket?.id) return;
                              setDiagnosticPhotosUploading(true);
                              try {
                                const urls: string[] = [];
                                for (const file of files) {
                                  const url = await uploadDiagnosticPhotoWithWatermark(supabase, activeServiceId, detailedTicket.id, file);
                                  urls.push(url);
                                }
                                const uid = session?.user?.id;
                                if (uid) checkAchievementOnFirstCapturePhoto(uid);
                                setDirtyFlags((prev) => ({ ...prev, diagnosticPhotos: true }));
                                setCloudTickets((prev) =>
                                  prev.map((t) =>
                                    t.id === detailedTicket.id
                                      ? { ...t, diagnosticPhotosBefore: [...(t.diagnosticPhotosBefore || []), ...urls] }
                                      : t
                                  )
                                );
                              } catch (err) {
                                showToast(`Nahrání fotky se nezdařilo: ${normalizeError(err) || "neznámá chyba"}`, "error");
                              } finally {
                                setDiagnosticPhotosUploading(false);
                              }
                            }}
                          />
                          Nahrát soubory
                        </label>
                      </div>
                    </div>
                    <div>
                      <div style={fieldLabel}>Diagnostické fotografie</div>
                      <div style={{ display: "flex", flexWrap: "wrap", gap: 12, marginTop: 8 }}>
                        {(detailedTicket.diagnosticPhotos || []).map((photoUrl, idx) => (
                          <div key={idx} style={{ position: "relative" }}>
                            <img 
                              src={photoUrl} 
                              alt={`Diagnostika ${idx + 1}`}
                              role="button"
                              tabIndex={0}
                              onClick={() => setPhotoLightbox({ urls: detailedTicket.diagnosticPhotos || [], index: idx, ticketCode: detailedTicket.code })}
                              onKeyDown={(e) => e.key === "Enter" && setPhotoLightbox({ urls: detailedTicket.diagnosticPhotos || [], index: idx, ticketCode: detailedTicket.code })}
                              style={{
                                width: 120, 
                                height: 120, 
                                objectFit: "cover", 
                                borderRadius: 8,
                                border: "1px solid var(--border)",
                                cursor: "pointer",
                              }}
                            />
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                (async () => {
                                const photoUrl = (detailedTicket.diagnosticPhotos || [])[idx];
                                if (photoUrl && isDiagnosticPhotoStorageUrl(photoUrl)) {
                                  try {
                                    await deleteDiagnosticPhotoFromStorage(supabase, photoUrl);
                                  } catch (_) {
                                    // Orphan v Storage; odstraníme jen z UI
                                  }
                                }
                                setDirtyFlags((prev) => ({ ...prev, diagnosticPhotos: true }));
                                setCloudTickets((prev) =>
                                  prev.map((t) =>
                                    t.id === detailedTicket.id
                                      ? { ...t, diagnosticPhotos: (t.diagnosticPhotos || []).filter((_, i) => i !== idx) }
                                      : t
                                  )
                                );
                              })();
                              }}
                              style={{
                                position: "absolute",
                                top: 4,
                                right: 4,
                                width: 24,
                                height: 24,
                                borderRadius: "50%",
                                background: "rgba(239, 68, 68, 0.9)",
                                color: "white",
                                border: "none",
                                cursor: "pointer",
                                display: "flex",
                                alignItems: "center",
                                justifyContent: "center",
                                fontSize: 14,
                                fontWeight: 700,
                              }}
                            >
                              ×
                            </button>
                          </div>
                        ))}
                      </div>
                      <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 8, alignItems: "center" }}>
                        <button
                          type="button"
                          onClick={async () => {
                            if (!supabase || !supabaseUrl || !supabaseAnonKey || !activeServiceId || !detailedTicket?.id) return;
                            const client = supabase!;
                            setCaptureQRLoading(true);
                            try {
                            let lastErr: unknown = null;
                            for (let attempt = 0; attempt < 2; attempt++) {
                              try {
                                const doRequest = async (retry = false): Promise<Response> => {
                                  const { data: refreshData, error: refreshErr } = await client.auth.refreshSession();
                                  if (refreshErr && !retry) {
                                    throw new Error("Session vypršela. Odhlaste se a přihlaste znovu.");
                                  }
                                  const token = refreshData?.session?.access_token ?? (await client.auth.getSession()).data?.session?.access_token;
                                  if (!token) {
                                    throw new Error("Nejste přihlášeni.");
                                  }
                                  return supabaseFetch(`${supabaseUrl}/functions/v1/capture-create-token`, {
                                    method: "POST",
                                    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}`, apikey: supabaseAnonKey },
                                    body: JSON.stringify({ ticketId: detailedTicket.id }),
                                  });
                                };
                                let res = await doRequest();
                                if (res.status === 401) {
                                  res = await doRequest(true);
                                }
                                const raw = await res.text();
                                let data: { url?: string; error?: string; detail?: string } = {};
                                try { if (raw) data = JSON.parse(raw); } catch {}
                                if (!res.ok) {
                                  if (res.status === 401) throw new Error("Přihlášení vypršelo. Odhlaste se a přihlaste znovu.");
                                  throw new Error(data?.error || data?.detail || res.statusText || "Chyba serveru");
                                }
                                if (data?.error) throw new Error(data.error);
                                if (!data?.url) throw new Error("Chybí URL v odpovědi");
                                setCaptureQRItems([{ deviceLabel: (detailedTicket?.deviceLabel) || "Zakázka", url: data.url }]);
                                return;
                              } catch (err) {
                                lastErr = err;
                                const msg = err instanceof Error ? err.message : String(err);
                                if (attempt === 0 && (msg.includes("síťový modul") || msg.includes("Nelze načíst"))) {
                                  resetTauriFetchState();
                                  continue;
                                }
                                break;
                              }
                            }
                            showToast(normalizeError(lastErr) || "Nepodařilo vytvořit QR odkaz.", "error");
                          } finally {
                            setCaptureQRLoading(false);
                          }
                        }}
                        disabled={!supabase || !activeServiceId || !detailedTicket?.id || diagnosticPhotosUploading || captureQRLoading}
                          style={{ ...softBtn, padding: "8px 14px", fontSize: 13 }}
                        >
                          {captureQRLoading ? "⏳ Vytvářím…" : "📱 Vyfotit z telefonu"}
                        </button>
                        <label style={{ ...baseFieldInput, padding: "8px 12px", cursor: diagnosticPhotosUploading ? "wait" : "pointer", margin: 0 }}>
                          <input
                            type="file"
                            accept="image/*"
                            multiple
                            disabled={diagnosticPhotosUploading}
                            style={{ display: "none" }}
                            onChange={async (e) => {
                              const files = Array.from(e.target.files || []);
                              e.target.value = "";
                              if (!files.length) return;
                              const hasId = !!(activeServiceId && detailedTicket.id);
                              if (hasId && supabase) {
                                setDiagnosticPhotosUploading(true);
                                try {
                                const urls: string[] = [];
                                for (const file of files) {
                                  const url = await uploadDiagnosticPhotoWithWatermark(
                                    supabase,
                                    activeServiceId!,
                                    detailedTicket.id!,
                                    file
                                  );
                                    urls.push(url);
                                  }
                                  const uid = session?.user?.id;
                                  if (uid) checkAchievementOnFirstCapturePhoto(uid);
                                  setDirtyFlags((prev) => ({ ...prev, diagnosticPhotos: true }));
                                  setCloudTickets((prev) =>
                                    prev.map((t) =>
                                      t.id === detailedTicket.id
                                        ? { ...t, diagnosticPhotos: [...(t.diagnosticPhotos || []), ...urls] }
                                        : t
                                    )
                                  );
                                } catch (err) {
                                  showToast(
                                    `Nahrání fotky se nezdařilo: ${normalizeError(err) || "neznámá chyba"}`,
                                    "error"
                                  );
                                } finally {
                                  setDiagnosticPhotosUploading(false);
                                }
                              } else {
                                const reader = (file: File) =>
                                  new Promise<string>((resolve, reject) => {
                                    const r = new FileReader();
                                    r.onload = () => resolve(r.result as string);
                                    r.onerror = () => reject(new Error("Načtení souboru selhalo"));
                                    r.readAsDataURL(file);
                                  });
                                try {
                                  const results = await Promise.all(files.map(reader));
                                  setDirtyFlags((prev) => ({ ...prev, diagnosticPhotos: true }));
                                  setCloudTickets((prev) =>
                                    prev.map((t) =>
                                      t.id === detailedTicket.id
                                        ? { ...t, diagnosticPhotos: [...(t.diagnosticPhotos || []), ...results] }
                                        : t
                                    )
                                  );
                                } catch (_) {
                                  showToast("Nepodařilo se načíst vybrané soubory.", "error");
                                }
                              }
                            }}
                          />
                          Nahrát soubory
                        </label>
                        {diagnosticPhotosUploading && (
                          <span style={{ fontSize: 12, color: "var(--text-secondary)" }}>Nahrávám…</span>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              </>
            )}

            {/* Komentáře - vždy viditelné */}
            <div style={{ ...card, marginTop: 16 }}>
              <div style={{ fontWeight: 950, fontSize: 13, color: "var(--text)" }}>💬 Interní komentáře (chat)</div>

              <div style={{ marginTop: 10, display: "grid", gap: 10 }}>
                {commentsFor(detailedTicket.id).map((c) => {
                  const commentAuthorName = c.author_nickname ?? c.author ?? "Servis";
                  const commentAvatarUrl = c.author_avatar_url?.trim() || null;
                  return (
                  <div
                    key={c.id}
                    style={{
                      border,
                      borderRadius: 14,
                      background: "var(--panel)",
                      padding: 12,
                      boxShadow: c.pinned ? "0 14px 30px rgba(0,0,0,0.16)" : "none",
                    }}
                  >
                    <div style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "center" }}>
                      <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
                        {commentAvatarUrl ? (
                          <img
                            src={commentAvatarUrl}
                            alt=""
                            style={{
                              width: 28,
                              height: 28,
                              borderRadius: 10,
                              objectFit: "cover",
                              border: "1px solid var(--border)",
                            }}
                            onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
                          />
                        ) : (
                          <div
                            style={{
                              width: 28,
                              height: 28,
                              borderRadius: 10,
                              background: "var(--accent-soft)",
                              color: "var(--accent)",
                              display: "grid",
                              placeItems: "center",
                              fontSize: 12,
                              fontWeight: 800,
                            }}
                          >
                            {(commentAuthorName || "?").charAt(0).toUpperCase()}
                          </div>
                        )}
                        <div style={{ fontWeight: 950 }}>{commentAuthorName}</div>
                        {c.pinned && (
                          <div
                            style={{
                              fontSize: 11,
                              fontWeight: 950,
                              padding: "4px 8px",
                              borderRadius: 999,
                              background: "var(--panel-2)",
                              border,
                              color: "var(--muted)",
                            }}
                          >
                            PINNED
                          </div>
                        )}
                      </div>

                      <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
                        <div style={{ color: "var(--muted)", fontSize: 12 }}>{formatCZ(c.createdAt)}</div>
                        <button
                          onClick={() => togglePin(detailedTicket.id, c.id)}
                          style={{
                            padding: "8px 10px",
                            borderRadius: 12,
                            border,
                            background: c.pinned ? "var(--panel-2)" : "var(--panel)",
                            color: "var(--text)",
                            fontWeight: 950,
                            cursor: "pointer",
                            fontFamily: "inherit",
                          }}
                          title={c.pinned ? "Odepnout" : "Připnout"}
                        >
                          {c.pinned ? "Unpin" : "Pin"}
                        </button>
                      </div>
                    </div>

                    <div style={{ marginTop: 6, whiteSpace: "pre-wrap" }}>{c.text}</div>
                  </div>
                  );
                })}

                {commentsFor(detailedTicket.id).length === 0 && <div style={{ color: "var(--muted)" }}>Zatím žádné komentáře.</div>}

                <div style={{ display: "grid", gap: 8 }}>
                  <textarea
                    value={commentDraftByTicket[detailedTicket.id] ?? ""}
                    onChange={(e) => setCommentDraftByTicket((p) => ({ ...p, [detailedTicket.id]: e.target.value }))}
                    style={{ ...baseFieldTextArea, minHeight: 90 }}
                    placeholder="Napiš interní komentář k zakázce…"
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
                        e.preventDefault();
                        addComment(detailedTicket.id);
                      }
                    }}
                  />

                  <div style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "center" }}>
                    <div style={{ color: "var(--muted)", fontSize: 12 }}>
                      Tip: <b>Ctrl+Enter</b> pro odeslání.
                    </div>
                    <button style={{ ...primaryBtn, padding: "10px 14px" }} onClick={() => addComment(detailedTicket.id)}>
                      Přidat komentář
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </>
        )}
        </div>
      </div>

      {/* SMS slide-over panel – respektuje pozici sidebaru (dole / vpravo), aby nebyl překryt */}
      {smsPanelOpen && detailedTicket && activeServiceId && (() => {
        const sidebarPos = uiCfg.sidebar?.position ?? "left";
        const isSidebarBottom = sidebarPos === "bottom";
        const isSidebarRight = sidebarPos === "right";
        const panelStyle: React.CSSProperties = {
          position: "fixed",
          top: 0,
          right: isSidebarRight ? "var(--sidebar-collapsed)" : 0,
          width: 380,
          maxWidth: "100vw",
          height: isSidebarBottom ? "calc(100vh - var(--sidebar-bottom-collapsed))" : "100vh",
          background: "var(--panel)",
          borderLeft: "1px solid var(--border)",
          boxShadow: "var(--shadow)",
          zIndex: 321,
          display: "flex",
          flexDirection: "column",
          transform: "translateX(0)",
          transition: "transform 400ms ease",
        };
        return (
        <>
          <div
            role="presentation"
            onClick={() => setSmsPanelOpen(false)}
            style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.3)", zIndex: 320 }}
          />
          <div
            style={panelStyle}
            onClick={(e) => e.stopPropagation()}
          >
            <div style={{ flex: "0 0 auto", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, padding: 12, borderBottom: "1px solid var(--border)" }}>
              <div style={{ minWidth: 0, flex: 1 }}>
                <div style={{ fontWeight: 700, fontSize: 15, color: "var(--text)" }}>
                  {detailedTicket.customerName?.trim() || "Zákazník"}
                </div>
                <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 2 }}>
                  {detailedTicket.code && <span style={{ marginRight: 8 }}>Zakázka {detailedTicket.code}</span>}
                  {detailedTicket.customerPhone?.trim() && <span>{detailedTicket.customerPhone.trim()}</span>}
                </div>
              </div>
              <button type="button" onClick={() => setSmsPanelOpen(false)} style={{ ...softBtn, width: 36, height: 36 }} aria-label="Zavřít">×</button>
            </div>
            <div style={{ flex: 1, minHeight: 0, overflow: "hidden" }}>
              <SmsChat
                ticketId={detailedTicket.id}
                serviceId={(detailedTicket as { service_id?: string }).service_id ?? activeServiceId ?? undefined}
                customerPhone={detailedTicket.customerPhone ?? null}
                customerName={detailedTicket.customerName ?? null}
              />
            </div>
          </div>
        </>
        );
      })()}
        </>,
        document.body
      )}

      {/* ConfirmDialog for soft delete */}
      <ConfirmDialog
        open={deleteDialogOpen}
        title="Smazat zakázku"
        message="Opravdu chceš tuto zakázku přesunout do smazaných?"
        confirmLabel="Smazat"
        cancelLabel="Zrušit"
        variant="danger"
        onConfirm={async () => {
          if (!deleteTicketId || !supabase || !activeServiceId) {
            throw new Error("Chyba: není připojení k databázi");
          }
          
          const { error } = await (supabase as any).rpc("soft_delete_ticket", {
            p_ticket_id: deleteTicketId,
          });
          
          if (error) {
            console.error("[DeleteTicket] Error soft deleting ticket:", error);
            throw error;
          }
          
          showToast("Zakázka smazána", "success");

          // Reuse returnTo navigation logic from "Zavřít" button
          const page = returnToPage;
          const customerId = returnToCustomerIdRef.current;
          setDetailId(null);
          setReturnToPage(null);
          returnToCustomerIdRef.current = undefined;
          if (page && onReturnToPage) {
            onReturnToPage(page, customerId);
          }
          
          setDeleteDialogOpen(false);
          setDeleteTicketId(null);
        }}
        onCancel={() => {
          setDeleteDialogOpen(false);
          setDeleteTicketId(null);
        }}
      />

      <ConfirmDialog
        open={deleteClaimDialogOpen}
        title="Smazat reklamaci"
        message="Opravdu chceš smazat tuto reklamaci? Tato akce je nevratná."
        confirmLabel="Smazat"
        cancelLabel="Zrušit"
        variant="danger"
        onConfirm={async () => {
          if (!deleteClaimId) return;
          const ok = await deleteClaim(deleteClaimId);
          if (!ok) return;
          refetchClaims();
          setDetailClaimId(null);
          setDeleteClaimDialogOpen(false);
          setDeleteClaimId(null);
        }}
        onCancel={() => {
          setDeleteClaimDialogOpen(false);
          setDeleteClaimId(null);
        }}
      />

      <CreateWarrantyClaimModal
        open={createClaimModalOpen}
        onClose={() => setCreateClaimModalOpen(false)}
        activeServiceId={activeServiceId}
        tickets={cloudTickets}
        existingClaimCodes={cloudClaims.map((c) => ({ code: c.code }))}
        onCreated={async (_claimCode, claim) => {
          setCreateClaimModalOpen(false);
          refetchClaims();
          setActiveGroup("reklamace");
          if (claim) {
            const config = await loadDocumentsConfigFromDB(activeServiceId);
            if (config?.autoPrint?.prijetiReklamaceOnCreate) {
              openPreviewWindowWithPrint(generatePrijetiReklamaceHTML(claim, safeLoadCompanyData(), config), "Přijetí reklamace");
            }
          }
        }}
      />

      {/* Ticket history modal */}
      {ticketHistoryModalOpen && createPortal(
        <div
          role="dialog"
          aria-label="Historie zakázky"
          style={{
            position: "fixed",
            inset: 0,
            zIndex: 10000,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            background: "rgba(0,0,0,0.4)",
            padding: 24,
          }}
          onClick={() => setTicketHistoryModalOpen(false)}
        >
          <div
            style={{
              background: "var(--panel)",
              border: "1px solid var(--border)",
              borderRadius: "var(--radius-lg)",
              boxShadow: "var(--shadow-soft)",
              maxWidth: 480,
              width: "100%",
              maxHeight: "80vh",
              overflow: "hidden",
              display: "flex",
              flexDirection: "column",
              color: "var(--text)",
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div style={{ padding: "16px 20px", borderBottom: "1px solid var(--border)", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <div style={{ fontWeight: 950, fontSize: 16 }}>Historie zakázky</div>
              <button type="button" onClick={() => setTicketHistoryModalOpen(false)} style={{ ...softBtn, padding: "6px 12px" }}>Zavřít</button>
            </div>
            <div style={{ padding: 16, overflowY: "auto", flex: 1 }}>
              {ticketHistoryLoading && <div style={{ color: "var(--muted)", padding: 12 }}>Načítám…</div>}
              {ticketHistoryError && <div style={{ color: "rgba(239,68,68,0.9)", padding: 12 }}>{ticketHistoryError}</div>}
              {!ticketHistoryLoading && !ticketHistoryError && ticketHistoryEntries.length === 0 && (
                <div style={{ color: "var(--muted)", padding: 12 }}>Žádné záznamy v historii. Historie se vytváří po uložení zakázky na server.</div>
              )}
              {!ticketHistoryLoading && !ticketHistoryError && ticketHistoryEntries.length > 0 && (() => {
                const FIELD_LABELS: Record<string, string> = {
                  title: "Zakázka / zařízení",
                  status: "Stav",
                  notes: "Popis",
                  estimated_price: "Odhadovaná cena",
                  performed_repairs: "Provedené opravy",
                  diagnostic_text: "Diagnostika",
                  customer_name: "Zákazník",
                  customer_phone: "Telefon",
                  customer_email: "E-mail",
                  device_label: "Zařízení",
                  discount: "Sleva",
                  device_condition: "Stav zařízení",
                  device_note: "Poznámka k zařízení",
                };
                const formatHistoryVal = (key: string, val: unknown): string => {
                  if (val === null || val === undefined) return "—";
                  if (key === "estimated_price" && typeof val === "number") return `${val} Kč`;
                  if (key === "performed_repairs" && Array.isArray(val)) {
                    return val.map((r: { name?: string; price?: number }) => `${r?.name ?? "—"}${typeof r?.price === "number" ? ` (${r.price} Kč)` : ""}`).join(", ") || "—";
                  }
                  if (key === "discount" && val && typeof val === "object" && !Array.isArray(val)) {
                    const o = val as { type?: string; value?: number };
                    return [o.type, typeof o.value === "number" ? `${o.value} Kč` : ""].filter(Boolean).join(" · ") || "—";
                  }
                  return String(val);
                };
                const getHistoryChanges = (details: Record<string, unknown>): Array<{ label: string; oldVal: string; newVal: string }> => {
                  const out: Array<{ label: string; oldVal: string; newVal: string }> = [];
                  const changes = details?.changes as Record<string, { old?: unknown; new?: unknown }> | undefined;
                  if (changes && typeof changes === "object") {
                    for (const [field, v] of Object.entries(changes)) {
                      if (!v || typeof v !== "object") continue;
                      const label = FIELD_LABELS[field] ?? field;
                      if (field === "discount") {
                        const oldD = v.old as { type?: string; value?: number } | undefined;
                        const newD = v.new as { type?: string; value?: number } | undefined;
                        out.push({
                          label,
                          oldVal: oldD ? formatHistoryVal("discount", oldD) : "—",
                          newVal: newD ? formatHistoryVal("discount", newD) : "—",
                        });
                      } else {
                        out.push({
                          label,
                          oldVal: formatHistoryVal(field, v.old),
                          newVal: formatHistoryVal(field, v.new),
                        });
                      }
                    }
                  } else if (details?.status_old !== undefined || details?.title_old !== undefined) {
                    if (details.status_old !== undefined && details.status_new !== undefined) {
                      out.push({ label: "Stav", oldVal: String(details.status_old), newVal: String(details.status_new) });
                    }
                    if (details.title_old !== undefined && details.title_new !== undefined) {
                      out.push({ label: "Zakázka / zařízení", oldVal: String(details.title_old), newVal: String(details.title_new) });
                    }
                  }
                  return out;
                };
                return (
                  <ul style={{ listStyle: "none", margin: 0, padding: 0 }}>
                    {ticketHistoryEntries.map((e) => {
                      const actionLabel = e.action === "created" ? "Vytvořena" : e.action === "updated" ? "Upravena" : e.action === "deleted" ? "Smazána" : e.action === "restored" ? "Obnovena" : e.action;
                      const who = e.nickname || (e.changed_by ? `${String(e.changed_by).slice(0, 8)}…` : "Systém");
                      const changes = e.action === "updated" && e.details ? getHistoryChanges(e.details) : [];
                      const statusChange = changes.find((c) => c.label === "Stav");
                      const isExpanded = ticketHistoryExpandedId === e.id;
                      return (
                        <li key={e.id} style={{ padding: "10px 0", borderBottom: "1px solid var(--border)", fontSize: 13 }}>
                          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 8 }}>
                            <div>
                              <div style={{ fontWeight: 700 }}>
                                {actionLabel}
                                {statusChange && (
                                  <span style={{ fontWeight: 600, color: "var(--muted)", marginLeft: 6 }}>
                                    · Stav: {statusChange.oldVal} → {statusChange.newVal}
                                  </span>
                                )}
                              </div>
                              <div style={{ color: "var(--muted)", marginTop: 2 }}>{formatCZ(e.created_at)} · {who}</div>
                            </div>
                            {changes.length > 0 && (
                              <button
                                type="button"
                                onClick={() => setTicketHistoryExpandedId(isExpanded ? null : e.id)}
                                style={{
                                  padding: "4px 8px",
                                  border: "1px solid var(--border)",
                                  borderRadius: 6,
                                  background: "var(--bg)",
                                  color: "var(--accent)",
                                  fontSize: 11,
                                  fontWeight: 600,
                                  cursor: "pointer",
                                  whiteSpace: "nowrap",
                                }}
                              >
                                {isExpanded ? "Skrýt detail" : "Detail změn"}
                              </button>
                            )}
                          </div>
                          {isExpanded && changes.length > 0 && (
                            <div style={{ marginTop: 10, padding: "10px 12px", background: "var(--bg)", borderRadius: 8, border: "1px solid var(--border)" }}>
                              {changes.map((c, i) => (
                                <div key={i} style={{ marginBottom: i < changes.length - 1 ? 8 : 0, fontSize: 12 }}>
                                  <div style={{ fontWeight: 600, color: "var(--text)", marginBottom: 2 }}>{c.label}</div>
                                  <div style={{ color: "var(--muted)", display: "flex", flexWrap: "wrap", gap: "4px 8px" }}>
                                    <span>{c.oldVal}</span>
                                    <span style={{ color: "var(--text)" }}>→</span>
                                    <span>{c.newVal}</span>
                                  </div>
                                </div>
                              ))}
                            </div>
                          )}
                        </li>
                      );
                    })}
                  </ul>
                );
              })()}
            </div>
          </div>
        </div>,
        document.body
      )}

      {/* Claim history modal */}
      {claimHistoryModalOpen && createPortal(
        <div
          role="dialog"
          aria-label="Historie reklamace"
          style={{
            position: "fixed",
            inset: 0,
            zIndex: 10000,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            background: "rgba(0,0,0,0.4)",
            padding: 24,
          }}
          onClick={() => setClaimHistoryModalOpen(false)}
        >
          <div
            style={{
              background: "var(--panel)",
              border: "1px solid var(--border)",
              borderRadius: "var(--radius-lg)",
              boxShadow: "var(--shadow-soft)",
              maxWidth: 480,
              width: "100%",
              maxHeight: "80vh",
              overflow: "hidden",
              display: "flex",
              flexDirection: "column",
              color: "var(--text)",
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div style={{ padding: "16px 20px", borderBottom: "1px solid var(--border)", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <div style={{ fontWeight: 950, fontSize: 16 }}>Historie reklamace</div>
              <button type="button" onClick={() => setClaimHistoryModalOpen(false)} style={{ ...softBtn, padding: "6px 12px" }}>Zavřít</button>
            </div>
            <div style={{ padding: 16, overflowY: "auto", flex: 1 }}>
              {claimHistoryLoading && <div style={{ color: "var(--muted)", padding: 12 }}>Načítám…</div>}
              {claimHistoryError && <div style={{ color: "rgba(239,68,68,0.9)", padding: 12 }}>{claimHistoryError}</div>}
              {!claimHistoryLoading && !claimHistoryError && claimHistoryEntries.length === 0 && (
                <div style={{ color: "var(--muted)", padding: 12 }}>Žádné záznamy v historii.</div>
              )}
              {!claimHistoryLoading && !claimHistoryError && claimHistoryEntries.length > 0 && (
                <ul style={{ listStyle: "none", margin: 0, padding: 0 }}>
                  {claimHistoryEntries.map((e) => {
                    const actionLabel = e.action === "created" ? "Vytvořena" : e.action === "status_changed" ? "Změna stavu" : e.action === "updated" ? "Upravena" : e.action;
                    const who = e.nickname || (e.changed_by ? `${String(e.changed_by).slice(0, 8)}…` : "Systém");
                    const details = (e.details || {}) as Record<string, unknown>;
                    const statusOld = details.status_old;
                    const statusNew = details.status_new;
                    return (
                      <li key={e.id} style={{ padding: "10px 0", borderBottom: "1px solid var(--border)", fontSize: 13 }}>
                        <div style={{ fontWeight: 700 }}>{actionLabel}</div>
                        {e.action === "status_changed" && statusOld != null && statusNew != null && (
                          <div style={{ fontWeight: 600, color: "var(--muted)", marginTop: 4 }}>
                            Stav: {String(statusOld)} → {String(statusNew)}
                          </div>
                        )}
                        <div style={{ color: "var(--muted)", marginTop: 2 }}>{formatCZ(e.created_at)} · {who}</div>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          </div>
        </div>,
        document.body
      )}

      {/* Capture QR modal – fotka z telefonu */}
      {captureQRItems && captureQRItems.length > 0 && createPortal(
        <div
          role="dialog"
          aria-label="Vyfotit z telefonu"
          style={{
            position: "fixed",
            inset: 0,
            zIndex: 10000,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            background: "rgba(0,0,0,0.5)",
            padding: 24,
          }}
          onClick={closeCaptureQrModal}
        >
          <div
            style={{
              background: "var(--panel)",
              border: "1px solid var(--border)",
              borderRadius: "var(--radius-lg)",
              boxShadow: "var(--shadow-soft)",
              maxWidth: captureQRItems.length > 1 ? 480 : 360,
              width: "100%",
              maxHeight: "90vh",
              overflow: "auto",
              padding: 24,
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              gap: 16,
              color: "var(--text)",
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div style={{ fontWeight: 950, fontSize: 18 }}>📱 Vyfotit z telefonu</div>
            <p style={{ margin: 0, fontSize: 14, color: "var(--text-secondary)", textAlign: "center" }}>
              {draftCaptureTokenRef.current
                ? "Naskenujte QR kód mobilem. Vyfocené fotky se po zavření tohoto okna načtou do rozpracované zakázky."
                : captureQRItems.length > 1
                ? "Naskenujte QR kód podle zařízení. Fotka se uloží k příslušné zakázce."
                : "Naskenujte QR kód mobilem. Otevře se stránka pro vyfocení diagnostiky – fotka se uloží přímo k zakázce."}
            </p>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 20, justifyContent: "center" }}>
              {captureQRItems.map((item, i) => (
                <div key={i} style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 8 }}>
                  {captureQRItems.length > 1 && (
                    <div style={{ fontWeight: 700, fontSize: 14, color: "var(--text)", textAlign: "center" }}>{item.deviceLabel || `Zakázka ${i + 1}`}</div>
                  )}
                  <div style={{ background: "white", padding: 12, borderRadius: 12 }}>
                    <img
                      src={`https://api.qrserver.com/v1/create-qr-code/?size=220x220&ecc=L&data=${encodeURIComponent(item.url)}`}
                      alt={`QR pro ${item.deviceLabel || "zakázku"}`}
                      style={{ display: "block", width: 220, height: 220 }}
                    />
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      navigator.clipboard?.writeText(item.url).then(() => showToast("Odkaz zkopírován", "success"));
                    }}
                    style={{ ...softBtn, padding: "8px 12px", fontSize: 12 }}
                  >
                    Kopírovat odkaz
                  </button>
                </div>
              ))}
            </div>
            {draftCaptureTokenRef.current && (
              <div style={{ fontSize: 12, color: "var(--muted)", textAlign: "center" }}>
                Aktuálně nafoceno: <b style={{ color: "var(--text)" }}>{draftCaptureLiveCount}</b>. Zavřete až po nafocení všech fotek.
              </div>
            )}
            <button type="button" onClick={closeCaptureQrModal} style={{ ...softBtn, padding: "10px 14px", marginTop: 8 }}>
              {draftCaptureTokenRef.current
                ? `Zavřít (${draftCaptureLiveCount} ${draftCaptureLiveCount === 1 ? "fotka" : draftCaptureLiveCount >= 2 && draftCaptureLiveCount <= 4 ? "fotky" : "fotek"})`
                : "Zavřít"}
            </button>
          </div>
        </div>,
        document.body
      )}

      {/* Photo lightbox – rozkliknutí diagnostických fotek */}
      {photoLightbox && createPortal(
        <div
          role="dialog"
          aria-label="Zvětšit fotku"
          style={{
            position: "fixed",
            inset: 0,
            zIndex: 10002,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            background: "rgba(0,0,0,0.85)",
            padding: 24,
          }}
          onClick={() => setPhotoLightbox(null)}
        >
          <button
            type="button"
            onClick={() => setPhotoLightbox(null)}
            style={{
              position: "absolute",
              top: 16,
              right: 16,
              width: 40,
              height: 40,
              borderRadius: "50%",
              background: "rgba(255,255,255,0.2)",
              color: "white",
              border: "none",
              cursor: "pointer",
              fontSize: 20,
              fontWeight: 700,
              lineHeight: 1,
            }}
            aria-label="Zavřít"
          >
            ×
          </button>
          <button
            type="button"
            onClick={async (e) => {
              e.stopPropagation();
              const url = photoLightbox.urls[photoLightbox.index];
              const code = photoLightbox.ticketCode || "zakazka";
              const safe = (s: string) => s.replace(/[^a-zA-Z0-9_-]/g, "_");
              const name = `${safe(code)}_pic${photoLightbox.index + 1}.jpg`;
              try {
                const res = await fetch(url, { mode: "cors" });
                const blob = await res.blob();
                const a = document.createElement("a");
                a.href = URL.createObjectURL(blob);
                a.download = name;
                a.click();
                URL.revokeObjectURL(a.href);
                showToast("Fotka stažena", "success");
              } catch {
                window.open(url, "_blank");
              }
            }}
            style={{
              position: "absolute",
              top: 16,
              right: 64,
              padding: "8px 16px",
              borderRadius: 8,
              background: "rgba(255,255,255,0.2)",
              color: "white",
              border: "1px solid rgba(255,255,255,0.4)",
              cursor: "pointer",
              fontSize: 14,
              fontWeight: 600,
            }}
          >
            Stáhnout
          </button>
          <img
            src={photoLightbox.urls[photoLightbox.index]}
            alt={`Diagnostika ${photoLightbox.index + 1}`}
            style={{ maxWidth: "100%", maxHeight: "90vh", objectFit: "contain" }}
            onClick={(e) => e.stopPropagation()}
          />
        </div>,
        document.body
      )}

      {/* ConfirmDialog for low stock warning */}
      <ConfirmDialog
        open={lowStockDialogOpen}
        title="Upozornění na sklad"
        message={`Produkty ${lowStockProducts.join(", ")} budou mít počet na skladě menší než 1. Chcete pokračovat?`}
        confirmLabel="Pokračovat"
        cancelLabel="Zrušit"
        variant="default"
        onConfirm={() => {
          if (lowStockCallback) {
            lowStockCallback();
            setLowStockCallback(null);
          }
          setLowStockDialogOpen(false);
          setLowStockProducts([]);
        }}
        onCancel={() => {
          setLowStockDialogOpen(false);
          setLowStockProducts([]);
          setLowStockCallback(null);
        }}
      />

      {canPrintExport && openQuickPrintTicket && quickPrintDropdownRect && (() => {
        const dropdownWidth = 200;
        const margin = 8;
        let left = quickPrintDropdownRect.left;
        if (left + dropdownWidth > window.innerWidth - margin) left = quickPrintDropdownRect.right - dropdownWidth;
        if (left < margin) left = margin;
        const top = quickPrintDropdownRect.top + 6;
        const maxBottom = window.innerHeight - margin;
        return createPortal(
        <div
          data-quick-print-menu
          role="listbox"
          style={{
            position: "fixed",
            left,
            top: Math.min(top, maxBottom - 120),
            minWidth: dropdownWidth,
            maxHeight: Math.min(240, window.innerHeight - top - margin),
            overflowY: "auto",
            background: "var(--panel)",
            border: "1px solid var(--border)",
            borderRadius: 12,
            boxShadow: "0 10px 25px rgba(0,0,0,0.15)",
            zIndex: 10001,
            padding: 6,
          }}
        >
          {[
            { type: "ticket" as const, label: "Zakázkový list" },
            { type: "warranty" as const, label: "Záruční list" },
            ...((openQuickPrintTicket.diagnosticText?.trim() || (openQuickPrintTicket.diagnosticPhotos && openQuickPrintTicket.diagnosticPhotos.length > 0)) ? [{ type: "diagnostic" as const, label: "Diagnostický protokol" }] : []),
          ].map(({ type, label }) => (
            <button
              key={type}
              type="button"
              onClick={(e) => { e.stopPropagation(); setOpenQuickPrintTicket(null); quickPrintFromList(openQuickPrintTicket, type, activeServiceId); }}
              style={{ display: "block", width: "100%", padding: "10px 14px", textAlign: "left", border: "none", background: "none", borderRadius: 8, cursor: "pointer", fontSize: 13, color: "var(--text)" }}
            >
              {label}
            </button>
          ))}
        </div>,
        document.body
      );
      })()}
    </div>
  );
}
