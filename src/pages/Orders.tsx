import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { Ticket } from "../mock/tickets";
import { useStatuses, type StatusMeta } from "../state/StatusesStore";
import { showToast } from "../components/Toast";
import type { NavKey } from "../layout/Sidebar";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { supabase } from "../lib/supabaseClient";
import { normalizePhone } from "../lib/phone";
// Removed: useActiveRole import - not used

import { STORAGE_KEYS } from "../constants/storageKeys";

// Dynamic import for Tauri WebviewWindow (only when needed)
// In Tauri v2, WebviewWindow is imported from @tauri-apps/api/webviewWindow
let WebviewWindowClass: any = null;
async function getWebviewWindow() {
  if (WebviewWindowClass) return WebviewWindowClass;
  try {
    // In Tauri v2, the correct import path is @tauri-apps/api/webviewWindow
    const webviewModule = await import('@tauri-apps/api/webviewWindow');
    
    // WebviewWindow should be a named export
    WebviewWindowClass = webviewModule.WebviewWindow;
    
    // If not found as named export, try default
    if (!WebviewWindowClass || typeof WebviewWindowClass !== 'function') {
      WebviewWindowClass = (webviewModule as any).default;
    }
    
    // Log available exports for debugging
    if (!WebviewWindowClass || typeof WebviewWindowClass !== 'function') {
      console.error('[getWebviewWindow] Module structure:', {
        keys: Object.keys(webviewModule),
        module: webviewModule,
      });
      throw new Error('WebviewWindow class not found in @tauri-apps/api/webviewWindow. Check Tauri v2 documentation.');
    }
    
    return WebviewWindowClass;
  } catch (err) {
    console.error('[getWebviewWindow] Failed to import WebviewWindow:', err);
    // Provide helpful error message
    const errorMsg = err instanceof Error ? err.message : String(err);
    throw new Error(`Failed to import WebviewWindow: ${errorMsg}. Make sure you're using Tauri v2 and @tauri-apps/api is installed.`);
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

function defaultCompanyData(): CompanyData {
  return {
    abbreviation: "",
    name: "",
    ico: "",
    dic: "",
    language: "cs",
    defaultPhonePrefix: "+420",
    addressStreet: "",
    addressCity: "",
    addressZip: "",
    phone: "",
    email: "",
    website: "",
  };
}

export function safeLoadCompanyData(): CompanyData {
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.COMPANY);
    if (!raw) return defaultCompanyData();
    const parsed = JSON.parse(raw);
    const d = defaultCompanyData();
    return {
      abbreviation: typeof parsed?.abbreviation === "string" ? parsed.abbreviation : d.abbreviation,
      name: typeof parsed?.name === "string" ? parsed.name : d.name,
      ico: typeof parsed?.ico === "string" ? parsed.ico : d.ico,
      dic: typeof parsed?.dic === "string" ? parsed.dic : d.dic,
      language: typeof parsed?.language === "string" ? parsed.language : d.language,
      defaultPhonePrefix: typeof parsed?.defaultPhonePrefix === "string" ? parsed.defaultPhonePrefix : d.defaultPhonePrefix,
      addressStreet: typeof parsed?.addressStreet === "string" ? parsed.addressStreet : d.addressStreet,
      addressCity: typeof parsed?.addressCity === "string" ? parsed.addressCity : d.addressCity,
      addressZip: typeof parsed?.addressZip === "string" ? parsed.addressZip : d.addressZip,
      phone: typeof parsed?.phone === "string" ? parsed.phone : d.phone,
      email: typeof parsed?.email === "string" ? parsed.email : d.email,
      website: typeof parsed?.website === "string" ? parsed.website : d.website,
    };
  } catch {
    return defaultCompanyData();
  }
}

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

type GroupKey = "all" | "active" | "final";

type UIConfig = {
  app: { fabNewOrderEnabled: boolean; uiScale: number };
  home: { orderFilters: { selectedQuickStatusFilters: string[] } };
  orders: { displayMode: "list" | "grid" | "compact" };
};

type OpenTicketIntent = {
  ticketId: string;
  mode?: "panel" | "detail";
  returnToPage?: NavKey;
  returnToCustomerId?: string;
};

type OrdersProps = {
  activeServiceId: string | null;
  newOrderPrefill: { customerId?: string } | null;
  onNewOrderPrefillConsumed: () => void;

  openTicketIntent: OpenTicketIntent | null;
  onOpenTicketIntentConsumed: () => void;

  onOpenCustomer?: (customerId: string) => void;
  onReturnToPage?: (page: NavKey, customerId?: string) => void;
};

const NEW_ORDER_DRAFT_KEY = "jobsheet_new_order_draft_v1";
const COMMENTS_STORAGE_KEY = "jobsheet_ticket_comments_v1";

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
  
  discountType?: "percentage" | "amount" | null; // typ slevy: procenta, částka, nebo žádná
  discountValue?: number; // hodnota slevy (% nebo Kč)
  requestedRepair?: string;
  handoffMethod?: "branch" | "courier" | "post";
  deviceNote?: string;
  externalId?: string;
  estimatedPrice?: number;
  performedRepairs?: PerformedRepair[];
  
  diagnosticText?: string; // text diagnostiky
  diagnosticPhotos?: string[]; // URL diagnostických fotek
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

  deviceLabel: string;
  serialOrImei: string;
  devicePasscode: string;
  deviceCondition: string;
  requestedRepair: string;
  handoffMethod: "branch" | "courier" | "post";
  deviceNote: string;
  externalId: string;
  estimatedPrice?: number;
};

type TicketComment = {
  id: string;
  ticketId: string;
  author: string;
  text: string;
  createdAt: string;
  pinned?: boolean;
};

// ========================
// Utils: storage
// ========================
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
        fabNewOrderEnabled: typeof fab === "boolean" ? !!fab : d.app.fabNewOrderEnabled,
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


function safeLoadDraft(): NewOrderDraft | null {
  try {
    const raw = localStorage.getItem(NEW_ORDER_DRAFT_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return null;
    return parsed as NewOrderDraft;
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

function normalizePrefix(raw: string): string {
  if (!raw || typeof raw !== "string") {
    return "SRV";
  }
  
  // trim
  let normalized = raw.trim();
  
  // toUpperCase
  normalized = normalized.toUpperCase();
  
  // Remove diacritics (normalize NFD and remove combining marks)
  normalized = normalized
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
  
  // Allow only [A-Z0-9]
  normalized = normalized.replace(/[^A-Z0-9]/g, "");
  
  // Max length 6 characters
  normalized = normalized.slice(0, 6);
  
  // Fallback if empty
  if (!normalized) {
    return "SRV";
  }
  
  return normalized;
}

async function loadServiceSettingsForCode(
  supabase: any,
  activeServiceId: string | null
): Promise<string> {
  if (!supabase || !activeServiceId) {
    return "SRV";
  }
  
  try {
    const { data, error } = await supabase
      .from("service_settings")
      .select("config")
      .eq("service_id", activeServiceId)
      .single();
    
    if (error || !data) {
      return "SRV";
    }
    
    const typedData = data as { config: any };
    if (!typedData.config) {
      return "SRV";
    }
    
    const abbreviation = typedData.config.abbreviation;
    if (typeof abbreviation === "string") {
      return normalizePrefix(abbreviation);
    }
    
    return "SRV";
  } catch (err) {
    console.error("[makeCode] Error loading service settings:", err);
    return "SRV";
  }
}

async function makeCode(
  cloudTickets: TicketEx[],
  supabase: any,
  activeServiceId: string | null
): Promise<string> {
  // Load and normalize prefix from DB
  const prefix = await loadServiceSettingsForCode(supabase, activeServiceId);
  
  // Get year (YY)
  const year = new Date().getFullYear().toString().slice(-2);
  const prefixYear = `${prefix}${year}`;
  
  // Find existing codes with same prefix + year
  let existingCodes: string[] = [];
  
  if (cloudTickets.length > 0) {
    // Use tickets from memory - filter by prefix + year pattern
    existingCodes = cloudTickets
      .map(t => t.code || "")
      .filter(code => code.startsWith(prefixYear));
  } else if (supabase && activeServiceId) {
    // Query Supabase for codes matching prefix + year pattern
    // Note: includes deleted tickets (deleted_at IS NOT NULL) for sequence number calculation
    try {
      const { data, error } = await (supabase
        .from("tickets") as any)
        .select("code")
        .eq("service_id", activeServiceId)
        .like("code", `${prefixYear}%`)
        // Note: includes deleted tickets (deleted_at IS NOT NULL) for sequence number calculation
        .order("code", { ascending: false })
        .limit(100);
      
      if (!error && data) {
        existingCodes = data
          .map((t: any) => t.code || "")
          .filter((code: string) => code.startsWith(prefixYear));
      }
    } catch (err) {
      console.error("[makeCode] Error querying tickets:", err);
      // Continue with empty array (will default to 000001)
    }
  }
  
  // Extract sequence numbers from existing codes
  // Format: PREFIXYY######, extract last 6 digits
  const existingNumbers = existingCodes
    .map(code => {
      // Get last 6 characters (should be the sequence number)
      const seqPart = code.slice(-6);
      const num = parseInt(seqPart, 10);
      return isNaN(num) ? 0 : num;
    })
    .filter(n => n > 0);
  
  // Find the next number
  const nextNumber = existingNumbers.length > 0 
    ? Math.max(...existingNumbers) + 1 
    : 1;
  
  // Format as PREFIXYY######
  const sequence = String(nextNumber).padStart(6, "0");
  return `${prefixYear}${sequence}`;
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

    deviceLabel: "",
    serialOrImei: "",
    devicePasscode: "",
    deviceCondition: "",
    requestedRepair: "",
    handoffMethod: "branch",
    deviceNote: "",
    externalId: "",
    estimatedPrice: undefined,
  };
}

function isDraftDirty(d: NewOrderDraft) {
  const def = defaultDraft();
  const norm = (v: any) => (typeof v === "string" ? v.trim() : v);

  for (const k of Object.keys(def) as (keyof NewOrderDraft)[]) {
    if (norm(d[k]) !== norm(def[k])) return true;
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


function isAnonymousCustomerName(name: string | null | undefined): boolean {
  if (!name) return false;
  
  // Normalize: trim, lowercase, remove diacritics, remove spaces
  const normalized = name
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "") // Remove diacritics
    .replace(/\s+/g, ""); // Remove spaces
  
  return normalized === "anonymnizakaznik" || normalized === "anonymouscustomer";
}

/**
 * Ensures a customer exists in the database and returns its ID.
 * Creates the customer if it doesn't exist (based on phone_norm).
 * Only works in cloud mode (requires supabase and activeServiceId).
 * 
 * @param snapshot - Ticket snapshot with customer data
 * @param activeServiceId - Service ID for filtering
 * @returns Customer ID or null if customer cannot be created/found
 */
async function ensureCustomerIdForTicketSnapshot(
  snapshot: {
    customer_phone?: string | null;
    customer_name?: string | null;
    customer_email?: string | null;
    customer_company?: string | null;
    customer_ico?: string | null;
    customer_address_street?: string | null;
    customer_address_city?: string | null;
    customer_address_zip?: string | null;
  },
  activeServiceId: string
): Promise<string | null> {
  if (!supabase) return null;
  
  // Skip if no phone - phone is required for lookup
  if (!snapshot.customer_phone) return null;

  const phoneNorm = normalizePhone(snapshot.customer_phone);
  if (!phoneNorm) return null;

  // 1) Try to find existing customer by phone_norm (priority: phone > name)
  const found = await (supabase
    .from("customers") as any)
    .select("id")
    .eq("service_id", activeServiceId)
    .eq("phone_norm", phoneNorm)
    .maybeSingle();

  if (found.data?.id) {
    // Found existing customer - return ID even if name is anonymous
    return found.data.id;
  }

  // 2) Try to create new customer (only if name is not anonymous)
  const isAnonymous = isAnonymousCustomerName(snapshot.customer_name);
  if (isAnonymous) {
    // Don't create new customer if name is anonymous
    return null;
  }

  const payload = {
    service_id: activeServiceId,
    name: snapshot.customer_name ?? "Zákazník",
    phone: snapshot.customer_phone ?? null,
    phone_norm: phoneNorm,
    email: snapshot.customer_email ?? null,
    company: snapshot.customer_company ?? null,
    ico: snapshot.customer_ico ?? null,
    address_street: snapshot.customer_address_street ?? null,
    address_city: snapshot.customer_address_city ?? null,
    address_zip: snapshot.customer_address_zip ?? null,
    note: null,
  };

  const created = await (supabase
    .from("customers") as any)
    .insert([payload])
    .select("id")
    .single();

  if (created.data?.id) {
    return created.data.id;
  }

  // 3) On conflict (23505), retry find
  if (created.error?.code === "23505") {
    const retry = await (supabase
      .from("customers") as any)
      .select("id")
      .eq("service_id", activeServiceId)
      .eq("phone_norm", phoneNorm)
      .maybeSingle();

    return retry.data?.id ?? null;
  }

  return null;
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
    requestedRepair: supabaseTicket.notes || undefined,
    handoffMethod: supabaseTicket.handoff_method || undefined,
    deviceNote: supabaseTicket.device_note || undefined,
    externalId: supabaseTicket.external_id || undefined,
    estimatedPrice: supabaseTicket.estimated_price || undefined,
    performedRepairs: supabaseTicket.performed_repairs || [],
    diagnosticText: supabaseTicket.diagnostic_text || undefined,
    diagnosticPhotos: supabaseTicket.diagnostic_photos || undefined,
    discountType: supabaseTicket.discount_type ?? null,
    discountValue: supabaseTicket.discount_value == null ? undefined : Number(supabaseTicket.discount_value),
  };
  // Store service_id for debugging (not part of TicketEx type)
  (ticket as any).service_id = supabaseTicket.service_id;
  return ticket;
}

function uuid() {
  return (crypto as any)?.randomUUID ? (crypto as any).randomUUID() : `${Date.now()}_${Math.random()}`;
}

function handoffLabel(m?: TicketEx["handoffMethod"]) {
  if (m === "courier") return "Kurýrem";
  if (m === "post") return "Poštou";
  return "Na pobočce";
}

async function previewDocument(ticketId: string, docType: "ticket" | "diagnostic" | "warranty", autoPrint: boolean = false) {
  // Check if running in Tauri
  const isTauri = typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
  
  const origin = typeof window !== 'undefined' ? window.location.origin : 'http://localhost:1420';
  const params = new URLSearchParams({
    ticketId,
    docType,
  });
  if (autoPrint) {
    params.set('autoPrint', '1');
  }
  const previewUrl = `${origin}/preview?${params.toString()}`;
  
  console.log("[previewDocument] Opening preview URL:", previewUrl);
  
  if (isTauri) {
    try {
      const WebviewWindow = await getWebviewWindow();
      
      // Check if preview window already exists and close it
      try {
        const existingPreview = await WebviewWindow.getByLabel("preview");
        if (existingPreview) {
          console.log("[previewDocument] Closing existing preview window");
          await existingPreview.close();
          // Wait a bit for window to close
          await new Promise(resolve => setTimeout(resolve, 100));
        }
      } catch (err) {
        // Window doesn't exist, that's fine
        console.log("[previewDocument] No existing preview window to close");
      }
      
      const win = new WebviewWindow("preview", {
        url: previewUrl,
        title: "Náhled dokumentu",
        width: 900,
        height: 700,
        center: true,
        closable: true,
      });
      
      console.log("[previewDocument] Creating preview webview window with URL");
      
      // Listen for window creation
      win.once("tauri://created", async () => {
        console.log("[previewDocument] Preview window created successfully");
        try {
          await win.show();
          await win.setFocus();
          await win.center();
          console.log("[previewDocument] Preview window shown, focused, and centered");
        } catch (err) {
          console.error("[previewDocument] Error showing/focusing window:", err);
        }
      });
      
      // Listen for window errors
      win.once("tauri://error", (e: any) => {
        console.error("[previewDocument] Preview window error:", e);
      });
    } catch (error) {
      console.error('[previewDocument] Error opening preview:', error);
      const errorMsg = error instanceof Error ? error.message : String(error);
      showToast(`Chyba při otevírání náhledu: ${errorMsg}. Zkontrolujte oprávnění aplikace.`, "error");
    }
  } else {
    // Browser method - open URL in new window
    const previewWindow = window.open(previewUrl, "_blank", "width=900,height=700,scrollbars=yes");
    if (!previewWindow) {
      showToast("Nelze otevřít okno pro náhled. Zkontrolujte, zda není blokováno vyskakovací okna.", "error");
      return;
    }
  }
}

async function exportDocumentToPDF(htmlContent: string, filename: string) {
  // Check if running in Tauri
  const isTauri = typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
  
  if (isTauri) {
    try {
      // Use Tauri API for saving file
      const { save } = await import('@tauri-apps/plugin-dialog');
      const { writeTextFile } = await import('@tauri-apps/plugin-fs');
      
      // Save as HTML file (user can open in browser and print to PDF)
      const filePath = await save({
        defaultPath: filename.replace('.pdf', '.html'),
        filters: [{
          name: 'HTML',
          extensions: ['html']
        }, {
          name: 'All Files',
          extensions: ['*']
        }]
      });
      
      if (filePath) {
        await writeTextFile(filePath, htmlContent);
        showToast('Dokument uložen', 'success');
      }
    } catch (error) {
      console.error('Error saving document in Tauri:', error);
      // Fallback to browser method
      const printWindow = window.open("", "_blank");
      if (printWindow) {
        printWindow.document.write(htmlContent);
        printWindow.document.close();
        printWindow.onload = () => {
          setTimeout(() => {
            printWindow.print();
          }, 250);
        };
      } else {
        showToast("Nelze otevřít okno pro export. Zkontrolujte, zda není blokováno vyskakovací okna.", "error");
      }
    }
  } else {
    // Browser method: Open in new window and trigger print dialog
    const printWindow = window.open("", "_blank");
    if (!printWindow) {
      showToast("Nelze otevřít okno pro export. Zkontrolujte, zda není blokováno vyskakovací okna.", "error");
      return;
    }

    printWindow.document.write(htmlContent);
    printWindow.document.close();

    printWindow.onload = () => {
      setTimeout(() => {
        printWindow.print();
      }, 250);
    };
  }
}

// printDocument() removed - all print functions now use previewDocument() with autoPrint=true
// This ensures consistent behavior and avoids permission issues with opener.openPath()

function previewTicket(ticket: TicketEx) {
  previewDocument(ticket.id, "ticket", false);
}

async function loadDocumentsConfigFromDB(serviceId: string | null): Promise<any | null> {
  if (!supabase || !serviceId) return null;
  
  try {
    const { data, error } = await supabase
      .from("service_document_settings")
      .select("config")
      .eq("service_id", serviceId)
      .single();
    
    if (error || !data) return null;
    
    // Validate and merge with defaults
    const typedData = data as { config: any };
    if (!typedData.config) return null;
    const parsed = typedData.config as any;
    const defaultConfig = {
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
    
    return {
      ticketList: {
        includeServiceInfo: typeof parsed?.ticketList?.includeServiceInfo === "boolean" ? parsed.ticketList.includeServiceInfo : defaultConfig.ticketList.includeServiceInfo,
        includeCustomerInfo: typeof parsed?.ticketList?.includeCustomerInfo === "boolean" ? parsed.ticketList.includeCustomerInfo : defaultConfig.ticketList.includeCustomerInfo,
        includeDeviceInfo: typeof parsed?.ticketList?.includeDeviceInfo === "boolean" ? parsed.ticketList.includeDeviceInfo : defaultConfig.ticketList.includeDeviceInfo,
        includeRepairs: typeof parsed?.ticketList?.includeRepairs === "boolean" ? parsed.ticketList.includeRepairs : defaultConfig.ticketList.includeRepairs,
        includeDiagnostic: typeof parsed?.ticketList?.includeDiagnostic === "boolean" ? parsed.ticketList.includeDiagnostic : defaultConfig.ticketList.includeDiagnostic,
        includePhotos: typeof parsed?.ticketList?.includePhotos === "boolean" ? parsed.ticketList.includePhotos : defaultConfig.ticketList.includePhotos,
        includeDates: typeof parsed?.ticketList?.includeDates === "boolean" ? parsed.ticketList.includeDates : defaultConfig.ticketList.includeDates,
      },
      diagnosticProtocol: {
        includeServiceInfo: typeof parsed?.diagnosticProtocol?.includeServiceInfo === "boolean" ? parsed.diagnosticProtocol.includeServiceInfo : defaultConfig.diagnosticProtocol.includeServiceInfo,
        includeCustomerInfo: typeof parsed?.diagnosticProtocol?.includeCustomerInfo === "boolean" ? parsed.diagnosticProtocol.includeCustomerInfo : defaultConfig.diagnosticProtocol.includeCustomerInfo,
        includeDeviceInfo: typeof parsed?.diagnosticProtocol?.includeDeviceInfo === "boolean" ? parsed.diagnosticProtocol.includeDeviceInfo : defaultConfig.diagnosticProtocol.includeDeviceInfo,
        includeDiagnosticText: typeof parsed?.diagnosticProtocol?.includeDiagnosticText === "boolean" ? parsed.diagnosticProtocol.includeDiagnosticText : defaultConfig.diagnosticProtocol.includeDiagnosticText,
        includePhotos: typeof parsed?.diagnosticProtocol?.includePhotos === "boolean" ? parsed.diagnosticProtocol.includePhotos : defaultConfig.diagnosticProtocol.includePhotos,
        includeDates: typeof parsed?.diagnosticProtocol?.includeDates === "boolean" ? parsed.diagnosticProtocol.includeDates : defaultConfig.diagnosticProtocol.includeDates,
      },
      warrantyCertificate: {
        includeServiceInfo: typeof parsed?.warrantyCertificate?.includeServiceInfo === "boolean" ? parsed.warrantyCertificate.includeServiceInfo : defaultConfig.warrantyCertificate.includeServiceInfo,
        includeCustomerInfo: typeof parsed?.warrantyCertificate?.includeCustomerInfo === "boolean" ? parsed.warrantyCertificate.includeCustomerInfo : defaultConfig.warrantyCertificate.includeCustomerInfo,
        includeDeviceInfo: typeof parsed?.warrantyCertificate?.includeDeviceInfo === "boolean" ? parsed.warrantyCertificate.includeDeviceInfo : defaultConfig.warrantyCertificate.includeDeviceInfo,
        includeRepairs: typeof parsed?.warrantyCertificate?.includeRepairs === "boolean" ? parsed.warrantyCertificate.includeRepairs : defaultConfig.warrantyCertificate.includeRepairs,
        includeDates: typeof parsed?.warrantyCertificate?.includeDates === "boolean" ? parsed.warrantyCertificate.includeDates : defaultConfig.warrantyCertificate.includeDates,
      },
    };
  } catch {
    return null;
  }
}

export function safeLoadDocumentsConfig(): any {
  try {
    const raw = localStorage.getItem("jobsheet_documents_config_v1");
    if (!raw) return {
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
    return {
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
  }
}

export function generateTicketHTML(ticket: TicketEx, forPrint: boolean = true, config?: any, _includeActions: boolean = false): string {
  const documentsConfig = config || safeLoadDocumentsConfig();
  const companyData = safeLoadCompanyData();
  const design = documentsConfig.ticketList?.design || "classic";
  const colorMode = documentsConfig.colorMode || "color";
  
  // Get design-specific styles
  const getDesignStyles = (designType: string) => {
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
  };
  
  const styles = getDesignStyles(design);
  
  return `
    <!DOCTYPE html>
    <html>
      <head>
        <meta charset="UTF-8">
        <title>Zakázkový list - ${ticket.code}</title>
        <style>
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
          ${forPrint ? `
            @media print {
              @page {
                size: A4;
                margin: 0;
              }
              html, body {
                margin: 0 !important;
                padding: 0 !important;
              }
              .page {
                width: 210mm;
                height: 297mm;
                padding: 12mm;
                margin: 0;
                box-sizing: border-box;
                overflow: visible;
                display: flex !important;
                flex-direction: column !important;
              }
              .content {
                flex: 1 !important;
                display: flex !important;
                flex-direction: column !important;
                overflow: hidden !important;
                min-height: 0 !important;
              }
              .footer {
                flex: 0 0 auto !important;
                position: relative !important;
                overflow: visible !important;
                z-index: 10 !important;
              }
              .document-footer {
                position: relative !important;
                overflow: visible !important;
              }
              .signatures {
                overflow: visible !important;
              }
              .signature-box {
                position: relative !important;
                overflow: visible !important;
              }
              .signature-line {
                overflow: visible !important;
              }
              .card {
                box-shadow: none !important;
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
          ` : ""}
          * {
            box-sizing: border-box;
          }
          body {
            font-family: system-ui, -apple-system, sans-serif;
            padding: ${forPrint ? "0" : "20px"};
            margin: 0 auto;
            color: ${styles.primaryColor};
            background: ${forPrint ? "#fff" : styles.bgColor};
            line-height: 1.4;
            font-size: 11px;
            ${forPrint ? `
              min-height: 100vh;
              display: flex;
              flex-direction: column;
            ` : ""}
          }
          ${forPrint ? `
            @media screen {
              body {
                padding: 16px;
                background: #eee;
              }
              .page {
                width: 210mm;
                margin: 0 auto;
                background: #fff;
              }
            }
          ` : `
            body {
              max-width: 210mm;
              width: 210mm;
            }
          `}
          .page {
            ${forPrint ? `
              height: 297mm;
              display: flex;
              flex-direction: column;
            ` : ""}
          }
          .content {
            ${forPrint ? `
              flex: 1;
              display: flex;
              flex-direction: column;
              overflow: hidden;
              min-height: 0;
            ` : ""}
          }
          .document-content {
            ${forPrint ? `
              flex: 1;
              display: flex;
              flex-direction: column;
              overflow-y: auto;
              min-height: 0;
            ` : ""}
          }
          .footer {
            ${forPrint ? `
              flex: 0 0 auto;
              padding-top: 20px;
              padding-bottom: 5mm;
              position: relative !important;
              overflow: visible !important;
              z-index: 10 !important;
            ` : ""}
          }
          .document-footer {
            ${forPrint ? `
              position: relative !important;
              overflow: visible !important;
            ` : ""}
          }
          .signatures {
            ${forPrint ? `
              overflow: visible !important;
            ` : ""}
          }
          .signature-box {
            ${forPrint ? `
              overflow: visible !important;
            ` : ""}
          }
          .signature-line {
            ${forPrint ? `
              overflow: visible !important;
            ` : ""}
          }
          .header {
            display: flex;
            justify-content: space-between;
            align-items: flex-start;
            margin-bottom: 12px;
            padding: ${design === "modern" ? "15px 20px" : design === "professional" ? "20px" : "8px 0"};
            padding-bottom: ${design === "minimal" ? "8px" : "12px"};
            border-bottom: ${design === "minimal" ? "1px" : design === "modern" ? "3px" : "2px"} solid ${styles.borderColor};
            ${design === "modern" ? `border-bottom-color: ${styles.secondaryColor};` : ""}
            ${design === "professional" ? `border-bottom: 3px solid ${styles.primaryColor};` : ""}
          }
          .header-right {
            flex-shrink: 0;
            margin-left: 20px;
            display: flex;
            flex-direction: column;
            align-items: flex-end;
            justify-content: flex-start;
          }
          .header-left {
            flex: 1;
          }
          .logo {
            max-width: ${((documentsConfig.logoSize ?? 100) / 100) * 120}px;
            max-height: ${((documentsConfig.logoSize ?? 100) / 100) * 50}px;
            width: auto;
            height: auto;
            object-fit: contain;
            margin-bottom: 6px;
          }
          h1 {
            font-size: ${design === "modern" ? "20px" : design === "professional" ? "18px" : "16px"};
            margin: 0;
            font-weight: ${design === "minimal" ? "500" : design === "modern" ? "800" : "700"};
            color: ${design === "modern" || design === "professional" ? styles.headerText : styles.primaryColor};
            ${design === "modern" ? "letter-spacing: -0.5px;" : ""}
          }
          .section {
            margin-bottom: 10px;
            background: ${forPrint ? "transparent" : (design === "minimal" ? "transparent" : styles.sectionBg)};
            padding: ${forPrint ? (design === "minimal" ? "0" : design === "modern" ? "15px" : "12px") : (design === "minimal" ? "0" : design === "modern" ? "15px" : "12px")};
            border-radius: ${forPrint ? (design === "minimal" ? "0" : design === "modern" ? "8px" : "6px") : (design === "minimal" ? "0" : design === "modern" ? "8px" : "6px")};
            border: ${forPrint ? (design === "minimal" ? "none" : styles.sectionBorder) : (design === "minimal" ? "none" : styles.sectionBorder)};
            box-shadow: ${forPrint ? "none" : (design === "minimal" ? "none" : design === "modern" ? "0 2px 8px rgba(59, 130, 246, 0.1)" : design === "professional" ? "0 1px 3px rgba(0,0,0,0.08)" : "0 1px 3px rgba(0,0,0,0.1)")};
            overflow: visible;
            ${design === "professional" ? "border-left: 4px solid " + styles.accentColor + ";" : ""}
            ${design === "modern" ? "border: 2px solid " + styles.borderColor + ";" : ""}
          }
          ${forPrint ? `
            @media print {
              .section {
                border-radius: ${design === "minimal" ? "0" : design === "modern" ? "8px" : "6px"} !important;
                border: ${design === "minimal" ? "none" : styles.sectionBorder} !important;
                overflow: visible !important;
                ${design === "professional" ? "border-left: 4px solid " + styles.accentColor + " !important;" : ""}
                ${design === "modern" ? "border: 2px solid " + styles.borderColor + " !important;" : ""}
              }
            }
          ` : ""}
          .section-title {
            font-size: ${design === "modern" ? "13px" : "12px"};
            font-weight: ${design === "minimal" ? "500" : design === "modern" ? "800" : "bold"};
            margin-bottom: ${design === "modern" ? "10px" : "6px"};
            color: ${design === "modern" ? styles.secondaryColor : styles.secondaryColor};
            ${design === "modern" ? "text-transform: uppercase; letter-spacing: 1px; color: " + styles.secondaryColor + ";" : ""}
            ${design === "professional" ? "color: " + styles.primaryColor + "; border-bottom: 2px solid " + styles.borderColor + "; padding-bottom: 4px;" : ""}
          }
          .field {
            margin-bottom: 4px;
            font-size: 11px;
          }
          .field-label {
            font-weight: 600;
            display: inline-block;
            min-width: 140px;
            color: ${styles.secondaryColor};
            font-size: 11px;
          }
          .field-value {
            color: ${styles.primaryColor};
            font-size: 11px;
          }
          .field-price {
            margin-bottom: 4px;
            font-size: 11px;
            display: flex;
            justify-content: space-between;
            align-items: baseline;
            gap: 10px;
          }
          .field-price .field-label {
            font-weight: 600;
            color: ${styles.secondaryColor};
            font-size: 11px;
            flex-shrink: 0;
            min-width: auto;
          }
          .field-price .field-value {
            color: ${styles.primaryColor};
            font-size: 11px;
            text-align: right;
            flex: 1;
          }
          .divider {
            border-top: 1px solid ${styles.borderColor};
            margin: 8px 0;
          }
          .legal-text {
            margin-top: 12px;
            padding: 10px;
            background: ${styles.bgColor};
            border: 1px solid ${styles.borderColor};
            border-radius: 6px;
            font-size: 9px;
            color: ${styles.secondaryColor};
            line-height: 1.4;
          }
          .signatures {
            margin-top: 12px;
            margin-bottom: 0;
            display: grid;
            grid-template-columns: 1fr 1fr 1fr;
            gap: 20px;
            padding-top: 10px;
            padding-bottom: 0;
            border-top: 1px solid ${styles.borderColor};
          }
          .signature-box {
            text-align: center;
            display: flex;
            flex-direction: column;
            align-items: center;
            justify-content: flex-end;
            min-height: 80px;
          }
          .signature-line {
            border-top: 1px solid ${styles.primaryColor};
            margin-top: auto;
            margin-bottom: 3px;
            height: 1px;
            width: 200px;
            margin-left: auto;
            margin-right: auto;
            flex-shrink: 0;
          }
          .signature-label {
            font-size: 9px;
            color: ${styles.secondaryColor};
            margin-top: 0;
          }
          .signature-box img {
            max-width: ${((documentsConfig.stampSize ?? 100) / 100) * 120}px;
            max-height: ${((documentsConfig.stampSize ?? 100) / 100) * 60}px;
            width: auto;
            height: auto;
            object-fit: contain;
            margin-bottom: auto;
            margin-top: 0;
            order: -1;
          }
          .stamp {
            max-width: 100px;
            max-height: 100px;
            margin: 10px auto;
            display: block;
          }
          ${!forPrint ? `
            .actions {
              position: fixed;
              top: 20px;
              right: 20px;
              display: flex;
              gap: 10px;
              z-index: 1000;
            }
            @media print {
              .actions {
                display: none !important;
              }
            }
            .action-btn {
              padding: 10px 16px;
              border: 1px solid #ddd;
              border-radius: 8px;
              background: white;
              cursor: pointer;
              font-size: 14px;
              font-weight: 600;
              box-shadow: 0 2px 8px rgba(0,0,0,0.1);
            }
            .action-btn:hover {
              background: #f5f5f5;
            }
          ` : ""}
        </style>
      </head>
      <body>
        ${!forPrint ? `
          <div class="actions">
            <button class="action-btn" onclick="window.print()">🖨️ Tisknout</button>
          </div>
        ` : ""}
        <div class="page">
        <div class="content">
        <div class="header">
          <div class="header-left">
            ${documentsConfig.logoUrl ? `<img src="${documentsConfig.logoUrl}" alt="Logo servisu" class="logo" />` : ""}
        <h1>Zakázkový list - ${ticket.code}</h1>
        <div style="font-size: 11px; color: ${styles.secondaryColor}; margin-top: 4px;">Datum: ${new Date(ticket.createdAt).toLocaleDateString("cs-CZ")}</div>
          </div>
        </div>
        
        ${documentsConfig.ticketList.includeServiceInfo && (companyData.name || companyData.addressStreet) ? `
          <div class="section">
            <div class="section-title">Servis</div>
            ${companyData.name ? `<div class="field"><span class="field-label">Název:</span><span class="field-value">${companyData.name}</span></div>` : ""}
            ${companyData.addressStreet || companyData.addressCity || companyData.addressZip 
              ? `<div class="field"><span class="field-label">Adresa:</span><span class="field-value">${[companyData.addressStreet, companyData.addressCity, companyData.addressZip].filter(Boolean).join(", ")}</span></div>` 
              : ""}
            ${companyData.phone ? `<div class="field"><span class="field-label">Telefon:</span><span class="field-value">${companyData.phone}</span></div>` : ""}
            ${companyData.email ? `<div class="field"><span class="field-label">E-mail:</span><span class="field-value">${companyData.email}</span></div>` : ""}
            ${companyData.ico ? `<div class="field"><span class="field-label">IČO:</span><span class="field-value">${companyData.ico}</span></div>` : ""}
            ${companyData.dic ? `<div class="field"><span class="field-label">DIČ:</span><span class="field-value">${companyData.dic}</span></div>` : ""}
          </div>
          <div class="divider"></div>
        ` : ""}
        
        ${documentsConfig.ticketList.includeCustomerInfo ? `
        <div class="section">
          <div class="section-title">Zákazník</div>
          <div class="field"><span class="field-label">Jméno:</span><span class="field-value">${ticket.customerName || "—"}</span></div>
          ${ticket.customerPhone ? `<div class="field"><span class="field-label">Telefon:</span><span class="field-value">${ticket.customerPhone}</span></div>` : ""}
          ${ticket.customerEmail ? `<div class="field"><span class="field-label">E-mail:</span><span class="field-value">${ticket.customerEmail}</span></div>` : ""}
          ${ticket.customerAddressStreet || ticket.customerAddressCity || ticket.customerAddressZip 
            ? `<div class="field"><span class="field-label">Adresa:</span><span class="field-value">${[ticket.customerAddressStreet, ticket.customerAddressCity, ticket.customerAddressZip].filter(Boolean).join(", ")}</span></div>` 
            : ""}
          ${ticket.customerCompany ? `<div class="field"><span class="field-label">Firma:</span><span class="field-value">${ticket.customerCompany}</span></div>` : ""}
          ${ticket.customerIco ? `<div class="field"><span class="field-label">IČO:</span><span class="field-value">${ticket.customerIco}</span></div>` : ""}
        </div>
        
        <div class="divider"></div>
        ` : ""}
        
        ${documentsConfig.ticketList.includeDeviceInfo ? `
        <div class="section">
          <div class="section-title">Zařízení</div>
          ${documentsConfig.deviceInfoConfig?.deviceLabel !== false ? `<div class="field"><span class="field-label">Zařízení:</span><span class="field-value">${ticket.deviceLabel || "—"}</span></div>` : ""}
          ${documentsConfig.deviceInfoConfig?.serialOrImei !== false && ticket.serialOrImei ? `<div class="field"><span class="field-label">SN/IMEI:</span><span class="field-value">${ticket.serialOrImei}</span></div>` : ""}
          ${documentsConfig.deviceInfoConfig?.devicePasscode !== false && ticket.devicePasscode ? `<div class="field"><span class="field-label">Heslo/kód:</span><span class="field-value">${documentsConfig.deviceInfoConfig?.devicePasscodeVisible ? ticket.devicePasscode : "••••"}</span></div>` : ""}
          ${documentsConfig.deviceInfoConfig?.deviceCondition !== false && ticket.deviceCondition ? `<div class="field"><span class="field-label">Popis stavu:</span><span class="field-value">${ticket.deviceCondition}</span></div>` : ""}
          ${documentsConfig.deviceInfoConfig?.requestedRepair !== false ? `<div class="field"><span class="field-label">Požadovaná oprava:</span><span class="field-value">${ticket.requestedRepair || ticket.issueShort || "—"}</span></div>` : ""}
          ${documentsConfig.deviceInfoConfig?.deviceNote !== false && ticket.deviceNote ? `<div class="field"><span class="field-label">Poznámka:</span><span class="field-value">${ticket.deviceNote}</span></div>` : ""}
          ${documentsConfig.deviceInfoConfig?.handoffMethod !== false && ticket.handoffMethod ? `<div class="field"><span class="field-label">Předání/převzetí:</span><span class="field-value">${handoffLabel(ticket.handoffMethod)}</span></div>` : ""}
          ${documentsConfig.deviceInfoConfig?.externalId !== false && ticket.externalId ? `<div class="field"><span class="field-label">Externí ID:</span><span class="field-value">${ticket.externalId}</span></div>` : ""}
        </div>
        
          <div class="divider"></div>
        ` : ""}
        
        ${documentsConfig.ticketList.includeRepairs && ticket.performedRepairs && ticket.performedRepairs.length > 0 ? `
          <div class="section">
            <div class="section-title">Provedené opravy</div>
            ${ticket.performedRepairs.map((repair) => {
              const priceText = repair.price ? `${repair.price} Kč` : "";
              return `<div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 6px; font-size: 11px;">
                <span style="color: ${styles.primaryColor};">• ${repair.name}</span>
                ${priceText ? `<span style="color: ${styles.primaryColor}; font-weight: 600; text-align: right;">${priceText}</span>` : ""}
              </div>`;
            }).join("")}
            ${(() => {
              const totalPrice = ticket.performedRepairs?.reduce((sum, r) => sum + (r.price || 0), 0) || 0;
              const discountAmount = ticket.discountType === "percentage" && ticket.discountValue 
                ? totalPrice * (ticket.discountValue / 100)
                : ticket.discountType === "amount" && ticket.discountValue
                ? ticket.discountValue
                : 0;
              const finalPrice = totalPrice - discountAmount;
              if (totalPrice > 0) {
                let result = `<div class="field-price" style="margin-top: 8px; padding-top: 8px; border-top: 1px solid ${styles.borderColor};"><span class="field-label">Celkem:</span><span class="field-value">${totalPrice} Kč</span></div>`;
                if (discountAmount > 0) {
                  const discountText = ticket.discountType === "percentage" 
                    ? `Sleva ${ticket.discountValue}%`
                    : `Sleva ${ticket.discountValue} Kč`;
                  result += `<div class="field-price"><span class="field-label">${discountText}:</span><span class="field-value">-${discountAmount.toFixed(2)} Kč</span></div>`;
                  result += `<div class="field-price" style="margin-top: 10px; padding-top: 10px; border-top: 2px solid ${styles.primaryColor}; font-weight: 700; font-size: 13px;"><span class="field-label" style="font-size: 13px; font-weight: 700;">Konečná cena:</span><span class="field-value" style="font-size: 14px; font-weight: 800; color: ${styles.primaryColor};">${finalPrice.toFixed(2)} Kč</span></div>`;
                } else {
                  result += `<div class="field-price" style="margin-top: 10px; padding-top: 10px; border-top: 2px solid ${styles.primaryColor}; font-weight: 700; font-size: 13px;"><span class="field-label" style="font-size: 13px; font-weight: 700;">Konečná cena:</span><span class="field-value" style="font-size: 14px; font-weight: 800; color: ${styles.primaryColor};">${totalPrice} Kč</span></div>`;
                }
                return result;
              }
              return "";
            })()}
          </div>
          <div class="divider"></div>
        ` : ""}
        
        ${documentsConfig.ticketList.includeDiagnostic && ticket.diagnosticText ? `
          <div class="section">
            <div class="section-title">Diagnostika</div>
            <div style="font-size: 11px; color: ${styles.primaryColor}; white-space: pre-wrap; text-align: left;">${ticket.diagnosticText}</div>
          </div>
        <div class="divider"></div>
        ` : ""}
        
        ${documentsConfig.ticketList.includePhotos && ticket.diagnosticPhotos && ticket.diagnosticPhotos.length > 0 ? `
          <div class="section">
            <div class="section-title">Diagnostické fotografie</div>
            <div style="display: grid; grid-template-columns: repeat(auto-fill, minmax(200px, 1fr)); gap: 15px; margin: 15px 0;">
              ${ticket.diagnosticPhotos.map((photoUrl) => `
                <div style="border: 1px solid #ddd; border-radius: 8px; overflow: hidden;">
                  <img src="${photoUrl}" alt="Diagnostická fotografie" style="width: 100%; height: auto; display: block;" />
                </div>
              `).join("")}
            </div>
          </div>
          <div class="divider"></div>
        ` : ""}
        
        ${documentsConfig.ticketList.includeDates ? `
        <div class="section">
          <div class="field"><span class="field-label">Datum vytvoření:</span><span class="field-value">${new Date(ticket.createdAt).toLocaleString("cs-CZ")}</span></div>
        </div>
        ` : ""}
        
        ${documentsConfig.ticketList?.legalText ? `
          <div class="legal-text">
            ${documentsConfig.ticketList.legalText}
          </div>
        ` : ""}
        
        </div>
        </div>
        <div class="footer">
        <div class="document-footer">
        <div class="signatures">
          <div class="signature-box">
            <div class="signature-line"></div>
            <div class="signature-label">Podpis zákazníka - při předání</div>
          </div>
          <div class="signature-box">
            <div class="signature-line"></div>
            <div class="signature-label">Podpis zákazníka - při odevzdání servisem</div>
          </div>
          <div class="signature-box">
            ${documentsConfig.ticketList.includeStamp && documentsConfig.stampUrl ? `
              <img src="${documentsConfig.stampUrl}" alt="Razítko servisu" />
            ` : ""}
            <div class="signature-line"></div>
            <div class="signature-label">Razítko servisu</div>
          </div>
          </div>
        </div>
        </div>
        </div>
        </div>
      </body>
    </html>
  `;
}

function exportTicketToPDF(ticket: TicketEx) {
  const htmlContent = generateTicketHTML(ticket, true);
  exportDocumentToPDF(htmlContent, `zakazka-${ticket.code}.pdf`);
}

function printTicket(ticket: TicketEx) {
  // Use previewDocument with autoPrint for consistency with other documents
  previewDocument(ticket.id, "ticket", true);
}

export function generateDiagnosticProtocolHTML(ticket: TicketEx, companyData: any, forPrint: boolean = true, config?: any, _includeActions: boolean = false): string {
  const documentsConfig = config || safeLoadDocumentsConfig();
  const design = documentsConfig.diagnosticProtocol?.design || "classic";
  const colorMode = documentsConfig.colorMode || "color";
  
  // Get design-specific styles (same as ticket)
  const getDesignStyles = (designType: string) => {
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
  };
  
  const styles = getDesignStyles(design);
  
  return `
    <!DOCTYPE html>
    <html>
      <head>
        <meta charset="UTF-8">
        <title>Diagnostický protokol - ${ticket.code}</title>
        <style>
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
          ${forPrint ? `
            @media print {
              @page {
                size: A4;
                margin: 0;
              }
              html, body {
                margin: 0 !important;
                padding: 0 !important;
              }
              .page {
                width: 210mm;
                height: 297mm;
                padding: 12mm;
                margin: 0;
                box-sizing: border-box;
                overflow: visible;
                display: flex !important;
                flex-direction: column !important;
              }
              .content {
                flex: 1 !important;
                display: flex !important;
                flex-direction: column !important;
                overflow: hidden !important;
                min-height: 0 !important;
              }
              .footer {
                flex: 0 0 auto !important;
                position: relative !important;
                overflow: visible !important;
                z-index: 10 !important;
              }
              .document-footer {
                position: relative !important;
                overflow: visible !important;
              }
              .signatures {
                overflow: visible !important;
              }
              .signature-box {
                position: relative !important;
                overflow: visible !important;
              }
              .signature-line {
                overflow: visible !important;
              }
              .card {
                box-shadow: none !important;
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
          ` : ""}
          * {
            box-sizing: border-box;
          }
          body {
            font-family: system-ui, -apple-system, sans-serif;
            padding: ${forPrint ? "0" : "20px"};
            margin: 0 auto;
            color: ${styles.primaryColor};
            background: ${forPrint ? "#fff" : styles.bgColor};
            line-height: 1.4;
            font-size: 11px;
            ${forPrint ? `
              min-height: 100vh;
              display: flex;
              flex-direction: column;
            ` : ""}
          }
          ${forPrint ? `
            @media screen {
              body {
                padding: 16px;
                background: #eee;
              }
              .page {
                width: 210mm;
                margin: 0 auto;
                background: #fff;
              }
            }
          ` : `
            body {
              max-width: 210mm;
              width: 210mm;
            }
          `}
          .page {
            ${forPrint ? `
              height: 297mm;
              display: flex;
              flex-direction: column;
            ` : ""}
          }
          .content {
            ${forPrint ? `
              flex: 1;
              display: flex;
              flex-direction: column;
              overflow: hidden;
              min-height: 0;
            ` : ""}
          }
          .document-content {
            ${forPrint ? `
              flex: 1;
              display: flex;
              flex-direction: column;
              overflow-y: auto;
              min-height: 0;
            ` : ""}
          }
          .footer {
            ${forPrint ? `
              flex: 0 0 auto;
              padding-top: 20px;
              padding-bottom: 5mm;
              position: relative !important;
              overflow: visible !important;
              z-index: 10 !important;
            ` : ""}
          }
          .document-footer {
            ${forPrint ? `
              position: relative !important;
              overflow: visible !important;
            ` : ""}
          }
          .signatures {
            ${forPrint ? `
              overflow: visible !important;
            ` : ""}
          }
          .signature-box {
            ${forPrint ? `
              overflow: visible !important;
            ` : ""}
          }
          .signature-line {
            ${forPrint ? `
              overflow: visible !important;
            ` : ""}
          }
          .header {
            display: flex;
            justify-content: space-between;
            align-items: flex-start;
            margin-bottom: 12px;
            padding: ${design === "modern" ? "15px 20px" : design === "professional" ? "20px" : "8px 0"};
            padding-bottom: ${design === "minimal" ? "8px" : "12px"};
            border-bottom: ${design === "minimal" ? "1px" : design === "modern" ? "3px" : "2px"} solid ${styles.borderColor};
            ${design === "modern" ? `border-bottom-color: ${styles.secondaryColor};` : ""}
            ${design === "professional" ? `border-bottom: 3px solid ${styles.primaryColor};` : ""}
          }
          .header-right {
            flex-shrink: 0;
            margin-left: 20px;
            display: flex;
            flex-direction: column;
            align-items: flex-end;
            justify-content: flex-start;
          }
          .header-left {
            flex: 1;
          }
          .logo {
            max-width: ${((documentsConfig.logoSize ?? 100) / 100) * 120}px;
            max-height: ${((documentsConfig.logoSize ?? 100) / 100) * 50}px;
            width: auto;
            height: auto;
            object-fit: contain;
            margin-bottom: 6px;
          }
          h1 {
            font-size: ${design === "modern" ? "20px" : design === "professional" ? "18px" : "16px"};
            margin: 0;
            font-weight: ${design === "minimal" ? "500" : design === "modern" ? "800" : "700"};
            color: ${design === "modern" || design === "professional" ? styles.headerText : styles.primaryColor};
            ${design === "modern" ? "letter-spacing: -0.5px;" : ""}
          }
          .section {
            margin-bottom: 10px;
            background: ${forPrint ? "transparent" : (design === "minimal" ? "transparent" : styles.sectionBg)};
            padding: ${forPrint ? (design === "minimal" ? "0" : design === "modern" ? "15px" : "12px") : (design === "minimal" ? "0" : design === "modern" ? "15px" : "12px")};
            border-radius: ${forPrint ? (design === "minimal" ? "0" : design === "modern" ? "8px" : "6px") : (design === "minimal" ? "0" : design === "modern" ? "8px" : "6px")};
            border: ${forPrint ? (design === "minimal" ? "none" : styles.sectionBorder) : (design === "minimal" ? "none" : styles.sectionBorder)};
            box-shadow: ${forPrint ? "none" : (design === "minimal" ? "none" : design === "modern" ? "0 2px 8px rgba(59, 130, 246, 0.1)" : design === "professional" ? "0 1px 3px rgba(0,0,0,0.08)" : "0 1px 3px rgba(0,0,0,0.1)")};
            overflow: visible;
            ${design === "professional" ? "border-left: 4px solid " + styles.accentColor + ";" : ""}
            ${design === "modern" ? "border: 2px solid " + styles.borderColor + ";" : ""}
          }
          ${forPrint ? `
            @media print {
              .section {
                border-radius: ${design === "minimal" ? "0" : design === "modern" ? "8px" : "6px"} !important;
                border: ${design === "minimal" ? "none" : styles.sectionBorder} !important;
                overflow: visible !important;
                ${design === "professional" ? "border-left: 4px solid " + styles.accentColor + " !important;" : ""}
                ${design === "modern" ? "border: 2px solid " + styles.borderColor + " !important;" : ""}
              }
            }
          ` : ""}
          .section-title {
            font-size: ${design === "modern" ? "13px" : "12px"};
            font-weight: ${design === "minimal" ? "500" : design === "modern" ? "800" : "bold"};
            margin-bottom: ${design === "modern" ? "10px" : "6px"};
            color: ${design === "modern" ? styles.secondaryColor : styles.secondaryColor};
            ${design === "modern" ? "text-transform: uppercase; letter-spacing: 1px; color: " + styles.secondaryColor + ";" : ""}
            ${design === "professional" ? "color: " + styles.primaryColor + "; border-bottom: 2px solid " + styles.borderColor + "; padding-bottom: 4px;" : ""}
          }
          .field {
            margin-bottom: 4px;
            font-size: 11px;
          }
          .field-label {
            font-weight: 600;
            display: inline-block;
            min-width: 140px;
            color: ${styles.secondaryColor};
            font-size: 11px;
          }
          .field-value {
            color: ${styles.primaryColor};
            font-size: 11px;
          }
          .field-price {
            margin-bottom: 4px;
            font-size: 11px;
            display: flex;
            justify-content: space-between;
            align-items: baseline;
            gap: 10px;
          }
          .field-price .field-label {
            font-weight: 600;
            color: ${styles.secondaryColor};
            font-size: 11px;
            flex-shrink: 0;
            min-width: auto;
          }
          .field-price .field-value {
            color: ${styles.primaryColor};
            font-size: 11px;
            text-align: right;
            flex: 1;
          }
          .divider {
            border-top: 1px solid ${styles.borderColor};
            margin: 8px 0;
          }
          .diagnostic-text {
            padding: 8px;
            background: ${styles.bgColor};
            border-radius: 6px;
            white-space: pre-wrap;
            line-height: 1.4;
            margin: 6px 0;
            font-size: 11px;
          }
          .legal-text {
            margin-top: 12px;
            padding: 10px;
            background: ${styles.bgColor};
            border: 1px solid ${styles.borderColor};
            border-radius: 6px;
            font-size: 9px;
            color: ${styles.secondaryColor};
            line-height: 1.4;
          }
          .signature-box {
            text-align: center;
            margin-top: 12px;
            padding-top: 10px;
            border-top: 1px solid ${styles.borderColor};
          }
          .signature-line {
            border-top: 1px solid ${styles.primaryColor};
            margin-top: ${design === "minimal" ? "20px" : "30px"};
            margin-bottom: 3px;
            height: 1px;
            width: 200px;
            margin-left: auto;
            margin-right: auto;
          }
          .signature-label {
            font-size: 9px;
            color: ${styles.secondaryColor};
          }
          .signature-box img {
            max-width: ${((documentsConfig.stampSize ?? 100) / 100) * 120}px;
            max-height: ${((documentsConfig.stampSize ?? 100) / 100) * 60}px;
            width: auto;
            height: auto;
            object-fit: contain;
          }
          .stamp {
            max-width: 100px;
            max-height: 100px;
            margin: 10px auto;
            display: block;
          }
          .photo-grid {
            display: grid;
            grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
            gap: 15px;
            margin: 15px 0;
          }
          .photo-item {
            border: 1px solid #ddd;
            border-radius: 8px;
            overflow: hidden;
          }
          .photo-item img {
            width: 100%;
            height: auto;
            display: block;
          }
          ${!forPrint ? `
            .actions {
              position: fixed;
              top: 20px;
              right: 20px;
              display: flex;
              gap: 10px;
              z-index: 1000;
            }
            @media print {
              .actions {
                display: none !important;
              }
            }
            .action-btn {
              padding: 10px 16px;
              border: 1px solid #ddd;
              border-radius: 8px;
              background: white;
              cursor: pointer;
              font-size: 14px;
              font-weight: 600;
              box-shadow: 0 2px 8px rgba(0,0,0,0.1);
            }
            .action-btn:hover {
              background: #f5f5f5;
            }
          ` : ""}
        </style>
      </head>
      <body>
        ${!forPrint ? `
          <div class="actions">
            <button class="action-btn" onclick="window.print()">🖨️ Tisknout</button>
          </div>
        ` : ""}
        <div class="page">
        <div class="content">
        <div class="document-content">
        <div class="header">
          <div class="header-left">
            ${documentsConfig.logoUrl ? `<img src="${documentsConfig.logoUrl}" alt="Logo servisu" class="logo" />` : ""}
        <h1>Diagnostický protokol - ${ticket.code}</h1>
        <div style="font-size: 11px; color: ${styles.secondaryColor}; margin-top: 4px;">Datum: ${new Date(ticket.createdAt).toLocaleDateString("cs-CZ")}</div>
          </div>
        </div>
        
        ${documentsConfig.diagnosticProtocol.includeServiceInfo && companyData && (companyData.name || companyData.addressStreet) ? `
          <div class="section">
            <div class="section-title">Servis</div>
            ${companyData.name ? `<div class="field"><span class="field-label">Název:</span><span class="field-value">${companyData.name}</span></div>` : ""}
            ${companyData.addressStreet || companyData.addressCity || companyData.addressZip 
              ? `<div class="field"><span class="field-label">Adresa:</span><span class="field-value">${[companyData.addressStreet, companyData.addressCity, companyData.addressZip].filter(Boolean).join(", ")}</span></div>` 
              : ""}
            ${companyData.phone ? `<div class="field"><span class="field-label">Telefon:</span><span class="field-value">${companyData.phone}</span></div>` : ""}
            ${companyData.email ? `<div class="field"><span class="field-label">E-mail:</span><span class="field-value">${companyData.email}</span></div>` : ""}
            ${companyData.ico ? `<div class="field"><span class="field-label">IČO:</span><span class="field-value">${companyData.ico}</span></div>` : ""}
            ${companyData.dic ? `<div class="field"><span class="field-label">DIČ:</span><span class="field-value">${companyData.dic}</span></div>` : ""}
          </div>
          <div class="divider"></div>
        ` : ""}
        
        ${documentsConfig.diagnosticProtocol.includeCustomerInfo ? `
        <div class="section">
          <div class="section-title">Zákazník</div>
          <div class="field"><span class="field-label">Jméno:</span><span class="field-value">${ticket.customerName || "—"}</span></div>
          ${ticket.customerPhone ? `<div class="field"><span class="field-label">Telefon:</span><span class="field-value">${ticket.customerPhone}</span></div>` : ""}
          ${ticket.customerEmail ? `<div class="field"><span class="field-label">E-mail:</span><span class="field-value">${ticket.customerEmail}</span></div>` : ""}
        </div>
        
        <div class="divider"></div>
        ` : ""}
        
        ${documentsConfig.diagnosticProtocol.includeDeviceInfo ? `
        <div class="section">
          <div class="section-title">Zařízení</div>
          ${documentsConfig.deviceInfoConfig?.deviceLabel !== false ? `<div class="field"><span class="field-label">Zařízení:</span><span class="field-value">${ticket.deviceLabel || "—"}</span></div>` : ""}
          ${documentsConfig.deviceInfoConfig?.serialOrImei !== false && ticket.serialOrImei ? `<div class="field"><span class="field-label">SN/IMEI:</span><span class="field-value">${ticket.serialOrImei}</span></div>` : ""}
          ${documentsConfig.diagnosticProtocol.includeDates ? `<div class="field"><span class="field-label">Datum:</span><span class="field-value">${new Date(ticket.createdAt).toLocaleString("cs-CZ")}</span></div>` : ""}
        </div>
        
        <div class="divider"></div>
        ` : ""}
        
        ${documentsConfig.diagnosticProtocol.includeDiagnosticText ? `
        <div class="section">
          <div class="section-title">Výsledky diagnostiky</div>
          ${ticket.diagnosticText ? `
            <div class="diagnostic-text">${ticket.diagnosticText}</div>
          ` : `
            <div class="field"><span class="field-value">Diagnostika nebyla zadána.</span></div>
          `}
        </div>
        
        <div class="divider"></div>
        ` : ""}
        
        ${documentsConfig.diagnosticProtocol.includePhotos && ticket.diagnosticPhotos && ticket.diagnosticPhotos.length > 0 ? `
          <div class="section">
            <div class="section-title">Diagnostické fotografie</div>
            <div class="photo-grid">
              ${ticket.diagnosticPhotos.map((photoUrl) => `
                <div class="photo-item">
                  <img src="${photoUrl}" alt="Diagnostická fotografie" />
                </div>
              `).join("")}
            </div>
          </div>
          <div class="divider"></div>
        ` : ""}
        
        ${documentsConfig.diagnosticProtocol.includeDates ? `
        <div class="section" style="padding-left: 50px;">
          <div class="field"><span class="field-label">Datum vytvoření protokolu:</span><span class="field-value">${new Date().toLocaleString("cs-CZ")}</span></div>
        </div>
        ` : ""}
        
        ${documentsConfig.diagnosticProtocol?.legalText ? `
          <div class="legal-text">
            ${documentsConfig.diagnosticProtocol.legalText}
          </div>
        ` : ""}
        
        </div>
        </div>
        <div class="footer">
        <div class="document-footer">
        <div class="signatures" style="display: flex; justify-content: flex-end;">
          <div class="signature-box" style="position: relative;">
            ${documentsConfig.stampUrl ? `
              <img src="${documentsConfig.stampUrl}" alt="Razítko servisu" style="position: relative !important; bottom: auto !important; left: auto !important; transform: none !important; max-width: ${((documentsConfig.stampSize ?? 100) / 100) * 120}px; max-height: ${((documentsConfig.stampSize ?? 100) / 100) * 60}px; width: auto; height: auto; object-fit: contain; margin: 0 auto; margin-bottom: 3px;" />
            ` : ""}
            <div class="signature-line"></div>
            <div class="signature-label">Podpis servisu</div>
          </div>
        </div>
        </div>
        </div>
        </div>
        </div>
      </body>
    </html>
  `;
}

function previewDiagnosticProtocol(ticket: TicketEx) {
  previewDocument(ticket.id, "diagnostic", false);
}

function exportDiagnosticProtocolToPDF(ticket: TicketEx) {
  const companyData = safeLoadCompanyData();
  const htmlContent = generateDiagnosticProtocolHTML(ticket, companyData, true);
  exportDocumentToPDF(htmlContent, `diagnostika-${ticket.code}.pdf`);
}

function printDiagnosticProtocol(ticket: TicketEx) {
  previewDocument(ticket.id, "diagnostic", true);
}

export function generateWarrantyHTML(ticket: TicketEx, companyData: any, forPrint: boolean = true, config?: any, _includeActions: boolean = false): string {
  const documentsConfig = config || safeLoadDocumentsConfig();
  const design = documentsConfig.warrantyCertificate?.design || "classic";
  const colorMode = documentsConfig.colorMode || "color";
  
  // Get design-specific styles (same as ticket)
  const getDesignStyles = (designType: string) => {
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
  };
  
  const styles = getDesignStyles(design);
  
  return `
    <!DOCTYPE html>
    <html>
      <head>
        <meta charset="UTF-8">
        <title>Záruční list - ${ticket.code}</title>
        <style>
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
          ${forPrint ? `
            @media print {
              @page {
                size: A4;
                margin: 0;
              }
              html, body {
                margin: 0 !important;
                padding: 0 !important;
              }
              .page {
                width: 210mm;
                height: 297mm;
                padding: 12mm;
                margin: 0;
                box-sizing: border-box;
                overflow: visible;
                display: flex !important;
                flex-direction: column !important;
              }
              .content {
                flex: 1 !important;
                display: flex !important;
                flex-direction: column !important;
                overflow: hidden !important;
                min-height: 0 !important;
              }
              .footer {
                flex: 0 0 auto !important;
                position: relative !important;
                overflow: visible !important;
                z-index: 10 !important;
              }
              .document-footer {
                position: relative !important;
                overflow: visible !important;
              }
              .signatures {
                overflow: visible !important;
              }
              .signature-box {
                position: relative !important;
                overflow: visible !important;
              }
              .signature-line {
                overflow: visible !important;
              }
              .card {
                box-shadow: none !important;
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
          ` : ""}
          * {
            box-sizing: border-box;
          }
          body {
            font-family: system-ui, -apple-system, sans-serif;
            padding: ${forPrint ? "0" : "20px"};
            margin: 0 auto;
            color: ${styles.primaryColor};
            background: ${forPrint ? "#fff" : styles.bgColor};
            line-height: 1.4;
            font-size: 11px;
            ${forPrint ? `
              min-height: 100vh;
              display: flex;
              flex-direction: column;
            ` : ""}
          }
          ${forPrint ? `
            @media screen {
              body {
                padding: 16px;
                background: #eee;
              }
              .page {
                width: 210mm;
                margin: 0 auto;
                background: #fff;
              }
            }
          ` : `
            body {
              max-width: 210mm;
              width: 210mm;
            }
          `}
          .page {
            ${forPrint ? `
              height: 297mm;
              display: flex;
              flex-direction: column;
            ` : ""}
          }
          .content {
            ${forPrint ? `
              flex: 1;
              display: flex;
              flex-direction: column;
              overflow: hidden;
              min-height: 0;
            ` : ""}
          }
          .document-content {
            ${forPrint ? `
              flex: 1;
              display: flex;
              flex-direction: column;
              overflow-y: auto;
              min-height: 0;
            ` : ""}
          }
          .footer {
            ${forPrint ? `
              flex: 0 0 auto;
              padding-top: 20px;
              padding-bottom: 5mm;
              position: relative !important;
              overflow: visible !important;
              z-index: 10 !important;
            ` : ""}
          }
          .document-footer {
            ${forPrint ? `
              position: relative !important;
              overflow: visible !important;
            ` : ""}
          }
          .signatures {
            ${forPrint ? `
              overflow: visible !important;
            ` : ""}
          }
          .signature-box {
            ${forPrint ? `
              overflow: visible !important;
            ` : ""}
          }
          .signature-line {
            ${forPrint ? `
              overflow: visible !important;
            ` : ""}
          }
          .header {
            display: flex;
            justify-content: space-between;
            align-items: flex-start;
            margin-bottom: 12px;
            padding: ${design === "modern" ? "15px 20px" : design === "professional" ? "20px" : "8px 0"};
            padding-bottom: ${design === "minimal" ? "8px" : "12px"};
            border-bottom: ${design === "minimal" ? "1px" : design === "modern" ? "3px" : "2px"} solid ${styles.borderColor};
            ${design === "modern" ? `border-bottom-color: ${styles.secondaryColor};` : ""}
            ${design === "professional" ? `border-bottom: 3px solid ${styles.primaryColor};` : ""}
          }
          .header-right {
            flex-shrink: 0;
            margin-left: 20px;
            display: flex;
            flex-direction: column;
            align-items: flex-end;
            justify-content: flex-start;
          }
          .header-left {
            flex: 1;
          }
          .logo {
            max-width: ${((documentsConfig.logoSize ?? 100) / 100) * 120}px;
            max-height: ${((documentsConfig.logoSize ?? 100) / 100) * 50}px;
            width: auto;
            height: auto;
            object-fit: contain;
            margin-bottom: 6px;
          }
          h1 {
            font-size: ${design === "modern" ? "20px" : design === "professional" ? "18px" : "16px"};
            margin: 0;
            font-weight: ${design === "minimal" ? "500" : design === "modern" ? "800" : "700"};
            color: ${design === "modern" || design === "professional" ? styles.headerText : styles.primaryColor};
            ${design === "modern" ? "letter-spacing: -0.5px;" : ""}
          }
          .section {
            margin-bottom: 10px;
            background: ${forPrint ? "transparent" : (design === "minimal" ? "transparent" : styles.sectionBg)};
            padding: ${forPrint ? (design === "minimal" ? "0" : design === "modern" ? "15px" : "12px") : (design === "minimal" ? "0" : design === "modern" ? "15px" : "12px")};
            border-radius: ${forPrint ? (design === "minimal" ? "0" : design === "modern" ? "8px" : "6px") : (design === "minimal" ? "0" : design === "modern" ? "8px" : "6px")};
            border: ${forPrint ? (design === "minimal" ? "none" : styles.sectionBorder) : (design === "minimal" ? "none" : styles.sectionBorder)};
            box-shadow: ${forPrint ? "none" : (design === "minimal" ? "none" : design === "modern" ? "0 2px 8px rgba(59, 130, 246, 0.1)" : design === "professional" ? "0 1px 3px rgba(0,0,0,0.08)" : "0 1px 3px rgba(0,0,0,0.1)")};
            overflow: visible;
            ${design === "professional" ? "border-left: 4px solid " + styles.accentColor + ";" : ""}
            ${design === "modern" ? "border: 2px solid " + styles.borderColor + ";" : ""}
          }
          ${forPrint ? `
            @media print {
              .section {
                border-radius: ${design === "minimal" ? "0" : design === "modern" ? "8px" : "6px"} !important;
                border: ${design === "minimal" ? "none" : styles.sectionBorder} !important;
                overflow: visible !important;
                ${design === "professional" ? "border-left: 4px solid " + styles.accentColor + " !important;" : ""}
                ${design === "modern" ? "border: 2px solid " + styles.borderColor + " !important;" : ""}
              }
            }
          ` : ""}
          .section-title {
            font-size: ${design === "modern" ? "13px" : "12px"};
            font-weight: ${design === "minimal" ? "500" : design === "modern" ? "800" : "bold"};
            margin-bottom: ${design === "modern" ? "10px" : "6px"};
            color: ${design === "modern" ? styles.secondaryColor : styles.secondaryColor};
            ${design === "modern" ? "text-transform: uppercase; letter-spacing: 1px; color: " + styles.secondaryColor + ";" : ""}
            ${design === "professional" ? "color: " + styles.primaryColor + "; border-bottom: 2px solid " + styles.borderColor + "; padding-bottom: 4px;" : ""}
          }
          .field {
            margin-bottom: 4px;
            font-size: 11px;
          }
          .field-label {
            font-weight: 600;
            display: inline-block;
            min-width: 140px;
            color: ${styles.secondaryColor};
            font-size: 11px;
          }
          .field-value {
            color: ${styles.primaryColor};
            font-size: 11px;
          }
          .field-price {
            margin-bottom: 4px;
            font-size: 11px;
            display: flex;
            justify-content: space-between;
            align-items: baseline;
            gap: 10px;
          }
          .field-price .field-label {
            font-weight: 600;
            color: ${styles.secondaryColor};
            font-size: 11px;
            flex-shrink: 0;
            min-width: auto;
          }
          .field-price .field-value {
            color: ${styles.primaryColor};
            font-size: 11px;
            text-align: right;
            flex: 1;
          }
          .divider {
            border-top: 1px solid ${styles.borderColor};
            margin: 8px 0;
          }
          .legal-text {
            margin-top: 12px;
            padding: 10px;
            background: ${styles.bgColor};
            border: 1px solid ${styles.borderColor};
            border-radius: 6px;
            font-size: 9px;
            color: ${styles.secondaryColor};
            line-height: 1.4;
          }
          .signature-box {
            text-align: center;
            margin-top: 12px;
            padding-top: 10px;
            border-top: 1px solid ${styles.borderColor};
          }
          .signature-line {
            border-top: 1px solid ${styles.primaryColor};
            margin-top: ${design === "minimal" ? "20px" : "30px"};
            margin-bottom: 3px;
            height: 1px;
            width: 200px;
            margin-left: auto;
            margin-right: auto;
          }
          .signature-label {
            font-size: 9px;
            color: ${styles.secondaryColor};
          }
          .signature-box img {
            max-width: ${((documentsConfig.stampSize ?? 100) / 100) * 120}px;
            max-height: ${((documentsConfig.stampSize ?? 100) / 100) * 60}px;
            width: auto;
            height: auto;
            object-fit: contain;
          }
          .stamp {
            max-width: 100px;
            max-height: 100px;
            margin: 10px auto;
            display: block;
          }
          ${!forPrint ? `
            .actions {
              position: fixed;
              top: 20px;
              right: 20px;
              display: flex;
              gap: 10px;
              z-index: 1000;
            }
            @media print {
              .actions {
                display: none !important;
              }
            }
            .action-btn {
              padding: 10px 16px;
              border: 1px solid #ddd;
              border-radius: 8px;
              background: white;
              cursor: pointer;
              font-size: 14px;
              font-weight: 600;
              box-shadow: 0 2px 8px rgba(0,0,0,0.1);
            }
            .action-btn:hover {
              background: #f5f5f5;
            }
          ` : ""}
        </style>
      </head>
      <body>
        ${!forPrint ? `
          <div class="actions">
            <button class="action-btn" onclick="window.print()">🖨️ Tisknout</button>
          </div>
        ` : ""}
        <div class="page">
        <div class="content">
        <div class="document-content">
        <div class="header">
          <div class="header-left">
            ${documentsConfig.logoUrl ? `<img src="${documentsConfig.logoUrl}" alt="Logo servisu" class="logo" />` : ""}
        <h1>Záruční list - ${ticket.code}</h1>
        <div style="font-size: 11px; color: ${styles.secondaryColor}; margin-top: 4px;">Datum: ${new Date(ticket.createdAt).toLocaleDateString("cs-CZ")}</div>
          </div>
          ${(() => {
            const reviewUrl = documentsConfig.reviewUrlType === "google" && documentsConfig.googlePlaceId
              ? `https://search.google.com/local/writereview?placeid=${documentsConfig.googlePlaceId}`
              : documentsConfig.reviewUrl;
            return reviewUrl ? `
            <div class="header-right" style="display: flex; align-items: center; gap: 12px;">
              <div style="text-align: right; font-size: 11px; color: ${styles.secondaryColor}; max-width: 150px;">
                ${documentsConfig.reviewText || "Budeme rádi za Vaši recenzi"}
              </div>
              <img src="https://api.qrserver.com/v1/create-qr-code/?size=${documentsConfig.qrCodeSize ?? 120}x${documentsConfig.qrCodeSize ?? 120}&ecc=L&data=${encodeURIComponent(reviewUrl)}" alt="QR" style="width: ${documentsConfig.qrCodeSize ?? 120}px; height: ${documentsConfig.qrCodeSize ?? 120}px; display: block; flex-shrink: 0;" />
            </div>
          ` : "";
          })()}
        </div>
        
        ${documentsConfig.warrantyCertificate?.includeServiceInfo && companyData && (companyData.name || companyData.addressStreet) ? `
          <div class="section">
            <div class="section-title">Servis</div>
            ${companyData.name ? `<div class="field"><span class="field-label">Název:</span><span class="field-value">${companyData.name}</span></div>` : ""}
            ${companyData.addressStreet || companyData.addressCity || companyData.addressZip 
              ? `<div class="field"><span class="field-label">Adresa:</span><span class="field-value">${[companyData.addressStreet, companyData.addressCity, companyData.addressZip].filter(Boolean).join(", ")}</span></div>` 
              : ""}
            ${companyData.phone ? `<div class="field"><span class="field-label">Telefon:</span><span class="field-value">${companyData.phone}</span></div>` : ""}
            ${companyData.email ? `<div class="field"><span class="field-label">E-mail:</span><span class="field-value">${companyData.email}</span></div>` : ""}
            ${companyData.ico ? `<div class="field"><span class="field-label">IČO:</span><span class="field-value">${companyData.ico}</span></div>` : ""}
            ${companyData.dic ? `<div class="field"><span class="field-label">DIČ:</span><span class="field-value">${companyData.dic}</span></div>` : ""}
          </div>
          <div class="divider"></div>
        ` : ""}
        
        ${documentsConfig.warrantyCertificate?.includeCustomerInfo ? `
        <div class="section">
          <div class="section-title">Zákazník</div>
          <div class="field"><span class="field-label">Jméno:</span><span class="field-value">${ticket.customerName || "—"}</span></div>
          ${ticket.customerPhone ? `<div class="field"><span class="field-label">Telefon:</span><span class="field-value">${ticket.customerPhone}</span></div>` : ""}
          ${ticket.customerEmail ? `<div class="field"><span class="field-label">E-mail:</span><span class="field-value">${ticket.customerEmail}</span></div>` : ""}
        </div>
        
        <div class="divider"></div>
        ` : ""}
        
        ${documentsConfig.warrantyCertificate?.includeDeviceInfo ? `
        <div class="section">
          <div class="section-title">Zařízení</div>
          ${documentsConfig.deviceInfoConfig?.deviceLabel !== false ? `<div class="field"><span class="field-label">Zařízení:</span><span class="field-value">${ticket.deviceLabel || "—"}</span></div>` : ""}
          ${documentsConfig.deviceInfoConfig?.serialOrImei !== false && ticket.serialOrImei ? `<div class="field"><span class="field-label">SN/IMEI:</span><span class="field-value">${ticket.serialOrImei}</span></div>` : ""}
        </div>
        
        <div class="divider"></div>
        ` : ""}
        
        ${documentsConfig.warrantyCertificate?.includeRepairs && ticket.performedRepairs && ticket.performedRepairs.length > 0 ? `
          <div class="section">
            <div class="section-title">Provedené opravy</div>
            ${ticket.performedRepairs.map((repair) => {
              const priceText = repair.price ? `${repair.price} Kč` : "";
              return `<div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 6px; font-size: 11px;">
                <span style="color: ${styles.primaryColor};">• ${repair.name}</span>
                ${priceText ? `<span style="color: ${styles.primaryColor}; font-weight: 600; text-align: right;">${priceText}</span>` : ""}
              </div>`;
            }).join("")}
            ${(() => {
              const totalPrice = ticket.performedRepairs?.reduce((sum, r) => sum + (r.price || 0), 0) || 0;
              const discountAmount = ticket.discountType === "percentage" && ticket.discountValue 
                ? totalPrice * (ticket.discountValue / 100)
                : ticket.discountType === "amount" && ticket.discountValue
                ? ticket.discountValue
                : 0;
              const finalPrice = totalPrice - discountAmount;
              if (totalPrice > 0) {
                let result = `<div class="field-price" style="margin-top: 8px; padding-top: 8px; border-top: 1px solid ${styles.borderColor};"><span class="field-label">Celkem:</span><span class="field-value">${totalPrice} Kč</span></div>`;
                if (discountAmount > 0) {
                  const discountText = ticket.discountType === "percentage" 
                    ? `Sleva ${ticket.discountValue}%`
                    : `Sleva ${ticket.discountValue} Kč`;
                  result += `<div class="field-price"><span class="field-label">${discountText}:</span><span class="field-value">-${discountAmount.toFixed(2)} Kč</span></div>`;
                  result += `<div class="field-price" style="margin-top: 10px; padding-top: 10px; border-top: 2px solid ${styles.primaryColor}; font-weight: 700; font-size: 13px;"><span class="field-label" style="font-size: 13px; font-weight: 700;">Konečná cena:</span><span class="field-value" style="font-size: 14px; font-weight: 800; color: ${styles.primaryColor};">${finalPrice.toFixed(2)} Kč</span></div>`;
                } else {
                  result += `<div class="field-price" style="margin-top: 10px; padding-top: 10px; border-top: 2px solid ${styles.primaryColor}; font-weight: 700; font-size: 13px;"><span class="field-label" style="font-size: 13px; font-weight: 700;">Konečná cena:</span><span class="field-value" style="font-size: 14px; font-weight: 800; color: ${styles.primaryColor};">${totalPrice} Kč</span></div>`;
                }
                return result;
              }
              return "";
            })()}
          </div>
          <div class="divider"></div>
        ` : ""}
        
        ${documentsConfig.warrantyCertificate?.includeWarranty ? `
        <div class="section">
          <div class="section-title">Záruční podmínky</div>
          ${documentsConfig.warrantyCertificate.warrantyType === "unified" ? (() => {
            const duration = documentsConfig.warrantyCertificate.warrantyUnifiedDuration || 12;
            const unit = documentsConfig.warrantyCertificate.warrantyUnifiedUnit || "months";
            let days = 0;
            if (unit === "days") days = duration;
            else if (unit === "months") days = duration * 30;
            else if (unit === "years") days = duration * 365;
            const warrantyUntil = new Date(new Date(ticket.createdAt).getTime() + days * 24 * 60 * 60 * 1000);
            let unitText = "";
            if (unit === "days") {
              if (duration === 1) unitText = "den";
              else if (duration >= 2 && duration <= 4) unitText = "dny";
              else unitText = "dnů";
            } else if (unit === "months") {
              if (duration === 1) unitText = "měsíc";
              else if (duration >= 2 && duration <= 4) unitText = "měsíce";
              else unitText = "měsíců";
            } else if (unit === "years") {
              if (duration === 1) unitText = "rok";
              else if (duration >= 2 && duration <= 4) unitText = "roky";
              else unitText = "let";
            }
            return `
              <div class="field"><span class="field-value">Tento záruční list potvrzuje provedení opravy uvedeného zařízení. Záruční doba činí ${duration} ${unitText} od data opravy.</span></div>
              <div class="field" style="margin-top: 8px;"><span class="field-label">Záruka do:</span><span class="field-value">${warrantyUntil.toLocaleDateString("cs-CZ")}</span></div>
            `;
          })() : (() => {
            const items = documentsConfig.warrantyCertificate.warrantyItems || [];
            const repairDate = new Date(ticket.createdAt);
            return `
              <div class="field"><span class="field-value">Tento záruční list potvrzuje provedení opravy uvedeného zařízení. Záruční doby:</span></div>
              ${items.map((item: { name: string; duration: number; unit: "days" | "months" | "years" }) => {
                let days = 0;
                if (item.unit === "days") days = item.duration;
                else if (item.unit === "months") days = item.duration * 30;
                else if (item.unit === "years") days = item.duration * 365;
                const warrantyUntil = new Date(repairDate.getTime() + days * 24 * 60 * 60 * 1000);
                let unitText = "";
                if (item.unit === "days") {
                  if (item.duration === 1) unitText = "den";
                  else if (item.duration >= 2 && item.duration <= 4) unitText = "dny";
                  else unitText = "dnů";
                } else if (item.unit === "months") {
                  if (item.duration === 1) unitText = "měsíc";
                  else if (item.duration >= 2 && item.duration <= 4) unitText = "měsíce";
                  else unitText = "měsíců";
                } else if (item.unit === "years") {
                  if (item.duration === 1) unitText = "rok";
                  else if (item.duration >= 2 && item.duration <= 4) unitText = "roky";
                  else unitText = "let";
                }
                return `
                  <div class="field" style="margin-top: 6px;">
                    <span class="field-label">${item.name || "Záruka"} (${item.duration} ${unitText}):</span>
                    <span class="field-value">do ${warrantyUntil.toLocaleDateString("cs-CZ")}</span>
        </div>
                `;
              }).join("")}
            `;
          })()}
        </div>
        <div class="divider"></div>
        ` : ""}
        
        ${documentsConfig.warrantyCertificate?.includeDates && !documentsConfig.warrantyCertificate?.includeWarranty ? `
        <div class="divider"></div>
        <div class="section">
          <div class="field"><span class="field-label">Datum opravy:</span><span class="field-value">${new Date(ticket.createdAt).toLocaleString("cs-CZ")}</span></div>
        </div>
        ` : ""}
        
        ${documentsConfig.warrantyCertificate?.legalText ? `
          <div class="legal-text">
            ${documentsConfig.warrantyCertificate.legalText}
          </div>
        ` : ""}
        
        </div>
        </div>
        <div class="footer">
        <div class="document-footer">
        <div class="signatures" style="display: flex; justify-content: flex-end;">
          <div class="signature-box" style="position: relative;">
            ${documentsConfig.stampUrl ? `
              <img src="${documentsConfig.stampUrl}" alt="Razítko servisu" style="position: relative !important; bottom: auto !important; left: auto !important; transform: none !important; max-width: ${((documentsConfig.stampSize ?? 100) / 100) * 120}px; max-height: ${((documentsConfig.stampSize ?? 100) / 100) * 60}px; width: auto; height: auto; object-fit: contain; margin: 0 auto; margin-bottom: 3px;" />
            ` : ""}
            <div class="signature-line"></div>
            <div class="signature-label">Razítko servisu</div>
          </div>
        </div>
        </div>
        </div>
        </div>
        </div>
      </body>
    </html>
  `;
}

function previewWarranty(ticket: TicketEx) {
  previewDocument(ticket.id, "warranty", false);
}

function exportWarrantyToPDF(ticket: TicketEx) {
  const companyData = safeLoadCompanyData();
  const htmlContent = generateWarrantyHTML(ticket, companyData, true);
  exportDocumentToPDF(htmlContent, `zarucni-list-${ticket.code}.pdf`);
}

function printWarranty(ticket: TicketEx) {
  previewDocument(ticket.id, "warranty", true);
}

// Document Action Picker Component (for each document type)
function DocumentActionPicker({ 
  label,
  onSelect
}: { 
  label: string;
  onSelect: (action: "preview" | "export" | "print") => void;
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
    { value: "preview" as const, label: "👁️ Náhled" },
    { value: "export" as const, label: "💾 Export" },
    { value: "print" as const, label: "🖨️ Tisk" },
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
                    } catch (e) {
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
        placeholder="Např. iPhone 13 Pro / Dyson V15 / MacBook Air M1…"
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

// Modern Handoff Method Picker
type HandoffMethodPickerProps = {
  value: "branch" | "courier" | "post";
  onChange: (value: "branch" | "courier" | "post") => void;
};

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

function HandoffMethodPicker({ value, onChange }: HandoffMethodPickerProps) {
  const [open, setOpen] = useState(false);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ left: 0, top: 0, width: 0, maxHeight: 300 });

  const options: Array<{ value: "branch" | "courier" | "post"; label: string; icon: string }> = [
    { value: "branch", label: "Na pobočce", icon: "🏢" },
    { value: "courier", label: "Kurýrem", icon: "🚚" },
    { value: "post", label: "Poštou", icon: "📮" },
  ];

  const selected = options.find((o) => o.value === value) ?? options[0];

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
      const actualMenuHeight = Math.min(maxHeight, estimatedMenuHeight);

      setPos({
        left: rect.left,
        top: openUp ? rect.top - actualMenuHeight - gap : rect.bottom + gap,
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
    window.addEventListener("mousedown", onDown);
    return () => window.removeEventListener("mousedown", onDown);
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
              gap: 10,
              padding: "12px 14px",
              borderRadius: 12,
              border: "none",
              background: active ? "var(--accent-soft)" : "transparent",
              cursor: "pointer",
              color: active ? "var(--accent)" : "var(--text)",
              fontFamily: "system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif",
              fontWeight: active ? 700 : 600,
              fontSize: 13,
              transition: "var(--transition-smooth)",
            }}
            onMouseEnter={(e) => {
              if (!active) e.currentTarget.style.background = "var(--panel-2)";
            }}
            onMouseLeave={(e) => {
              if (!active) e.currentTarget.style.background = "transparent";
            }}
          >
            <span style={{ fontSize: 18 }}>{opt.icon}</span>
            <span>{opt.label}</span>
            {active && <span style={{ marginLeft: "auto", fontSize: 16, opacity: 0.8 }}>✓</span>}
          </button>
        );
      })}
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
          padding: "10px 12px",
          borderRadius: 12,
          border: open ? "1px solid var(--accent)" : border,
          outline: "none",
          background: open ? "var(--panel-2)" : "var(--panel)",
          backdropFilter: "var(--blur)",
          WebkitBackdropFilter: "var(--blur)",
          color: "var(--text)",
          fontFamily: "system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif",
          cursor: "pointer",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 8,
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
        <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ fontSize: 16 }}>{selected.icon}</span>
          <span>{selected.label}</span>
        </span>
        <span style={{ opacity: 0.65, fontWeight: 900, fontSize: 12 }}>▾</span>
      </button>
      {open ? createPortal(menu, document.body) : null}
    </>
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
// Icons
// ========================
function DeviceIcon({ size = 16, color = "currentColor" }: { size?: number; color?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="5" y="2" width="14" height="20" rx="2" ry="2"/>
      <path d="M12 18h.01"/>
    </svg>
  );
}

function WrenchIcon({ size = 16, color = "currentColor" }: { size?: number; color?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"/>
    </svg>
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
  onOpenCustomer,
  onReturnToPage,
}: OrdersProps) {
  const { statuses, getByKey, isFinal, fallbackKey } = useStatuses();

  const [uiCfg, setUiCfg] = useState<UIConfig>(() => safeLoadUIConfig());
  const [cloudTickets, setCloudTickets] = useState<TicketEx[]>([]);
  const [ticketsLoading, setTicketsLoading] = useState(false);
  const [ticketsError, setTicketsError] = useState<string | null>(null);
  
  const [, setDocumentsConfig] = useState<any>(() => safeLoadDocumentsConfig());
  
  // Refs for race condition protection
  const ticketsReqIdRef = useRef(0);
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
          console.log("[Orders] service_document_settings changed", payload);
          // Use ref to get current activeServiceId (not closure value)
          const sid = activeServiceIdRef.current;
          if (!sid) return;
          
          // Reload config from DB
          const dbConfig = await loadDocumentsConfigFromDB(sid);
          if (dbConfig) {
            setDocumentsConfig(dbConfig);
            // Sync to localStorage as fallback
            localStorage.setItem("jobsheet_documents_config_v1", JSON.stringify(dbConfig));
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
          .select("id,service_id,code,title,status,notes,customer_id,customer_name,customer_phone,customer_email,customer_address_street,customer_address_city,customer_address_zip,customer_company,customer_ico,customer_info,device_serial,device_passcode,device_condition,device_note,external_id,handoff_method,estimated_price,performed_repairs,diagnostic_text,diagnostic_photos,discount_type,discount_value,created_at,updated_at")
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
        setTicketsError(err instanceof Error ? err.message : "Neznámá chyba při načítání zakázek");
        setCloudTickets([]);
        setTicketsLoading(false);
      }
    };

    loadTickets();
    
    return () => {
      ticketsReqIdRef.current++;
    };
  }, [activeServiceId, supabase]);

  // Realtime subscription for tickets
  useEffect(() => {
    if (!activeServiceId || !supabase) return;

    const topic = `tickets:${activeServiceId}`;
    console.log("[RT] subscribe", topic, new Date().toISOString());

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
          console.log("[Orders] tickets changed", payload);
          
          if (payload.eventType === "INSERT" || payload.eventType === "UPDATE") {
            console.log("[RT tickets] event", payload.eventType, {
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
                console.log("[RT tickets] setCloudTickets (restore)", {
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
                console.log("[RT tickets] setCloudTickets (upsert)", {
                  id: newTicket.id,
                  hadExisting: !!existing,
                  prevLen: prev.length,
                  newStatus: newTicket.status,
                  oldStatus: existing?.status,
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
      console.log("[RT] unsubscribe", topic, new Date().toISOString());
      if (supabase) {
        supabase.removeChannel(channel);
      }
    };
  }, [activeServiceId]);

  // Cloud mode only: show only cloud tickets
  const tickets = useMemo(() => {
      return cloudTickets;
  }, [cloudTickets]);

  const [activeGroup, setActiveGroup] = useState<GroupKey>("active");
  const [activeStatusKey, setActiveStatusKey] = useState<string | null>(null);

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

  const [detailId, setDetailId] = useState<string | null>(null);
  const [isEditing, setIsEditing] = useState(false);
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

  // Dirty tracking for diagnostic text, photos, and performed repairs
  const [dirtyFlags, setDirtyFlags] = useState({
    diagnosticText: false,
    diagnosticPhotos: false,
    performedRepairs: false,
  });

  const [commentDraftByTicket, setCommentDraftByTicket] = useState<Record<string, string>>({});

  // Delete ticket dialog states
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [deleteTicketId, setDeleteTicketId] = useState<string | null>(null);
  const [lowStockDialogOpen, setLowStockDialogOpen] = useState(false);
  const [lowStockProducts, setLowStockProducts] = useState<string[]>([]);
  const [lowStockCallback, setLowStockCallback] = useState<(() => void) | null>(null);

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

  useEffect(() => {
    if (!openTicketIntent) return;

    const { ticketId, mode, returnToPage: returnPage, returnToCustomerId } = openTicketIntent;
    const exists = tickets.some((t) => t.id === ticketId);

    if (exists) {
      if ((mode ?? "detail") === "detail") {
        setDetailId(ticketId);
        setReturnToPage(returnPage || null);
        // Store returnToCustomerId for later use in close handler
        returnToCustomerIdRef.current = returnToCustomerId;
    } else {
      setDetailId(null);
        setReturnToPage(null);
        returnToCustomerIdRef.current = undefined;
      }
    } else {
      setDetailId(null);
      setReturnToPage(null);
      returnToCustomerIdRef.current = undefined;
    }

    onOpenTicketIntentConsumed();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openTicketIntent, tickets]);

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
    return (
      newDraft.deviceLabel.trim().length > 0 &&
      newDraft.requestedRepair.trim().length > 0 &&
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
    onNewOrderPrefillConsumed();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [newOrderPrefill]);

  // Load customer detail and prefill form when newOrderPrefill.customerId is set
  useEffect(() => {
    if (!newOrderPrefill?.customerId || !supabase || !activeServiceId) return;

    (async () => {
      try {
        const { data, error } = await (supabase
          .from("customers") as any)
          .select("id,name,phone,email,company,ico,address_street,address_city,address_zip,note")
          .eq("id", newOrderPrefill.customerId)
          .eq("service_id", activeServiceId)
          .single();

        if (error || !data) {
          console.error("[Orders] Error loading customer for prefill:", error);
          return;
        }

        // Prefill only empty fields, or if customerId is not set (draft not yet linked to customer)
        setNewDraft((prev) => {
          const shouldPrefill = !prev.customerId; // If draft not linked to customer, prefill everything
          
          return {
            ...prev,
            customerId: data.id,
            // Prefill only if field is empty OR draft not linked to customer
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
  }, [newOrderPrefill?.customerId, supabase, activeServiceId]);

  useEffect(() => {
    const onReq = () => setShouldOpenNew(true);
    window.addEventListener("jobsheet:request-new-order" as any, onReq);
    return () => window.removeEventListener("jobsheet:request-new-order" as any, onReq);
    // eslint-disable-next-line react-hooks/exhaustive-deps
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

    // No match found
    setMatchedCustomerEdit(null);
  };

  const statusKeysSet = useMemo(() => new Set(statuses.map((s) => s.key)), [statuses]);
  const statusesReady = statuses.length > 0;

  const normalizeStatus = useCallback(
    (key: string): string | null => {
      // If statuses are not loaded yet (empty array), return null to indicate placeholder
      if (!statusesReady) {
        return null;
      }
      return statusKeysSet.has(key) ? key : fallbackKey;
    },
    [statusKeysSet, fallbackKey, statusesReady]
  );

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

    return tickets
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
  }, [tickets, activeGroup, query, statusById, isFinal, showSecondaryFiltersRow, activeStatusKey, normalizeStatus]);

  const detailedTicket: TicketEx | undefined = useMemo(
    () => (detailId ? tickets.find((t) => t.id === detailId) : undefined),
    [detailId, tickets]
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
    console.log("[Save] started", { ticketId: detailedTicket?.id });
    console.log("[SaveTicket] START", { 
      activeServiceId, 
      hasSupabase: !!supabase, 
      ticketId: detailedTicket?.id 
    });
    
    if (!detailedTicket) {
      console.log("[SaveTicket] END (no detailedTicket)");
      return false;
    }

    // Použij aktuální hodnoty z detailedTicket (které mohou obsahovat změny z diagnostiky)
    // nebo hodnoty z editedTicket pokud jsou definované (v edit módu)
        const updated: TicketEx = {
      ...detailedTicket,
      customerId: editedTicket.customerId !== undefined ? editedTicket.customerId : detailedTicket.customerId,
      customerName: editedTicket.customerName !== undefined ? editedTicket.customerName : detailedTicket.customerName,
      customerPhone: editedTicket.customerPhone !== undefined ? (editedTicket.customerPhone.trim() || undefined) : detailedTicket.customerPhone,
      customerEmail: editedTicket.customerEmail !== undefined ? (editedTicket.customerEmail.trim() || undefined) : detailedTicket.customerEmail,
      customerAddressStreet: editedTicket.customerAddressStreet !== undefined ? (editedTicket.customerAddressStreet.trim() || undefined) : detailedTicket.customerAddressStreet,
      customerAddressCity: editedTicket.customerAddressCity !== undefined ? (editedTicket.customerAddressCity.trim() || undefined) : detailedTicket.customerAddressCity,
      customerAddressZip: editedTicket.customerAddressZip !== undefined ? (editedTicket.customerAddressZip.trim() || undefined) : detailedTicket.customerAddressZip,
      customerCompany: editedTicket.customerCompany !== undefined ? (editedTicket.customerCompany.trim() || undefined) : detailedTicket.customerCompany,
      customerIco: editedTicket.customerIco !== undefined ? (editedTicket.customerIco.trim() || undefined) : detailedTicket.customerIco,
      customerInfo: editedTicket.customerInfo !== undefined ? (editedTicket.customerInfo.trim() || undefined) : detailedTicket.customerInfo,
      deviceLabel: editedTicket.deviceLabel !== undefined ? editedTicket.deviceLabel : detailedTicket.deviceLabel,
      serialOrImei: editedTicket.serialOrImei !== undefined ? (editedTicket.serialOrImei.trim() || undefined) : detailedTicket.serialOrImei,
      devicePasscode: editedTicket.devicePasscode !== undefined ? (editedTicket.devicePasscode.trim() || undefined) : detailedTicket.devicePasscode,
      deviceCondition: editedTicket.deviceCondition !== undefined ? (editedTicket.deviceCondition.trim() || undefined) : detailedTicket.deviceCondition,
      requestedRepair: editedTicket.requestedRepair !== undefined ? (editedTicket.requestedRepair.trim() || undefined) : detailedTicket.requestedRepair,
      handoffMethod: editedTicket.handoffMethod !== undefined ? editedTicket.handoffMethod : detailedTicket.handoffMethod,
      deviceNote: editedTicket.deviceNote !== undefined ? (editedTicket.deviceNote.trim() || undefined) : detailedTicket.deviceNote,
      externalId: editedTicket.externalId !== undefined ? (editedTicket.externalId.trim() || undefined) : detailedTicket.externalId,
      diagnosticText: editedTicket.diagnosticText !== undefined 
        ? (editedTicket.diagnosticText.trim() || undefined) 
        : (detailedTicket.diagnosticText?.trim() || undefined),
      diagnosticPhotos: editedTicket.diagnosticPhotos !== undefined 
        ? editedTicket.diagnosticPhotos 
        : detailedTicket.diagnosticPhotos,
      performedRepairs: editedTicket.performedRepairs !== undefined
        ? editedTicket.performedRepairs
        : (detailedTicket.performedRepairs ?? []),
      discountType: editedTicket.discountType !== undefined
        ? editedTicket.discountType
        : (detailedTicket.discountType ?? null),
      discountValue: editedTicket.discountValue !== undefined
        ? editedTicket.discountValue
        : (detailedTicket.discountValue ?? undefined),
    };

    if (activeServiceId && supabase && detailedTicket.id) {
      try {
        // Resolve customer_id: editedTicket has priority (explicit customer change)
        let resolvedCustomerId: string | null = null;
        if (editedTicket.customerId !== undefined) {
          // editedTicket.customerId has priority (explicit change via "Změnit zákazníka")
          resolvedCustomerId = editedTicket.customerId;
        } else if (updated.customerId) {
          // Use customerId from updated (which may be from detailedTicket)
          resolvedCustomerId = updated.customerId;
        } else {
          // Try to find/create customer from snapshot
          resolvedCustomerId = await ensureCustomerIdForTicketSnapshot(
            {
              customer_phone: updated.customerPhone || null,
              customer_name: updated.customerName || null,
              customer_email: updated.customerEmail || null,
              customer_company: updated.customerCompany || null,
              customer_ico: updated.customerIco || null,
              customer_address_street: updated.customerAddressStreet || null,
              customer_address_city: updated.customerAddressCity || null,
              customer_address_zip: updated.customerAddressZip || null,
            },
            activeServiceId
          );
        }

        const payload: any = {
          title: updated.deviceLabel || "Nová zakázka",
          status: updated.status,
          notes: updated.requestedRepair || updated.issueShort || "",
          customer_id: resolvedCustomerId ?? null,
          customer_name: updated.customerName || null,
          customer_phone: updated.customerPhone || null,
          customer_email: updated.customerEmail || null,
          customer_address_street: updated.customerAddressStreet || null,
          customer_address_city: updated.customerAddressCity || null,
          customer_address_zip: updated.customerAddressZip || null,
          customer_company: updated.customerCompany || null,
          customer_ico: updated.customerIco || null,
          customer_info: updated.customerInfo || null,
          device_serial: updated.serialOrImei || null,
          device_passcode: updated.devicePasscode || null,
          device_condition: updated.deviceCondition || null,
          device_note: updated.deviceNote || null,
          external_id: updated.externalId || null,
          handoff_method: updated.handoffMethod || null,
          estimated_price: updated.estimatedPrice || null,
          performed_repairs: updated.performedRepairs ?? [],
          diagnostic_text: updated.diagnosticText ?? "",
          diagnostic_photos: updated.diagnosticPhotos ?? [],
          discount_type: updated.discountType ?? null,
          discount_value: updated.discountValue ?? null,
        };
        
        // Audit: Log customer snapshot fields in payload
        console.log("[SaveTicket] PAYLOAD - Customer snapshot fields:", {
          customer_id: payload.customer_id,
          customer_name: payload.customer_name,
          customer_phone: payload.customer_phone,
          customer_email: payload.customer_email,
          customer_address_street: payload.customer_address_street,
          customer_address_city: payload.customer_address_city,
          customer_address_zip: payload.customer_address_zip,
          customer_company: payload.customer_company,
          customer_ico: payload.customer_ico,
          customer_info: payload.customer_info,
        });
        console.log("[SaveTicket] PAYLOAD (full)", payload);
        
        const { data, error } = await (supabase
          .from("tickets") as any)
          .update(payload)
          .eq("id", detailedTicket.id)
          .eq("service_id", activeServiceId)
          .select("id,service_id,code,title,status,notes,customer_id,customer_name,customer_phone,customer_email,customer_address_street,customer_address_city,customer_address_zip,customer_company,customer_ico,customer_info,device_serial,device_passcode,device_condition,device_note,external_id,handoff_method,estimated_price,performed_repairs,diagnostic_text,diagnostic_photos,discount_type,discount_value,created_at,updated_at")
          .single();

        console.log("[SaveTicket] RESULT", { data, error });

        if (error) {
          console.error("[SaveTicket] update error", error);
          showToast(`Chyba při ukládání zakázky: ${error.message}`, "error");
          console.log("[SaveTicket] END (error)");
          return false;
        }

        if (!data) {
          console.error("[SaveTicket] update returned no data");
          showToast("Chyba: server nevrátil data", "error");
          console.log("[SaveTicket] END (no data)");
          return false;
        }

        // Check if customer_id changed and dispatch refresh event
        const oldCustomerId = detailedTicket.customerId || null;
        const newCustomerId = data.customer_id || null;
        if (oldCustomerId !== newCustomerId) {
          console.log("[SaveTicket] Customer ID changed:", { oldCustomerId, newCustomerId });
          window.dispatchEvent(
            new CustomEvent("jobsheet:customer-tickets-refresh", {
              detail: { customerId: newCustomerId, oldCustomerId },
            })
          );
        }

        const updatedTicket = mapSupabaseTicketToTicketEx(data);
        console.log("[SaveTicket] cloudTickets updated:", {
          ticketId: updatedTicket.id,
          performedRepairs: updatedTicket.performedRepairs,
          diagnosticText: updatedTicket.diagnosticText,
          diagnosticPhotos: updatedTicket.diagnosticPhotos,
          fromSelect: true
        });
        setCloudTickets((prev) => prev.map((t) => (t.id === detailedTicket.id ? updatedTicket : t)));
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
        console.log("[SaveTicket] END");
        return true;
      } catch (err) {
        const errorMessage = err instanceof Error ? err.message : "Neznámá chyba";
        console.error("[SaveTicket] update exception", err);
        showToast(`Chyba při ukládání zakázky: ${errorMessage}`, "error");
        console.log("[SaveTicket] END");
        return false;
      }
    } else {
      // Missing requirements
      setCloudTickets((prev) => prev.map((t) => (t.id === detailedTicket.id ? updated : t)));
      showToast("Úpravy nejsou k dispozici - chybí požadavky na cloud", "info");
      console.log("[SaveTicket] END");
      return false;
    }
  }, [detailedTicket, editedTicket, activeServiceId, supabase]);

  const handleCloseDetail = useCallback(async () => {
    console.log("[Close] clicked - about to save?");
    
    // Check if there are any unsaved changes
    const hasUnsavedChanges = dirtyFlags.diagnosticText || dirtyFlags.diagnosticPhotos || dirtyFlags.performedRepairs;
    
    if (hasUnsavedChanges) {
      try {
        const saved = await saveTicketChanges();
        if (!saved) {
          console.error("[Close] saveTicketChanges returned false");
          // Error already shown in saveTicketChanges via toast
          return;
        }
        // Show success toast only if there were unsaved changes and save succeeded
        showToast("Změny uloženy", "success");
      } catch (err) {
        console.error("[Close] saveTicketChanges threw error", err);
        showToast("Chyba při ukládání změn: " + (err instanceof Error ? err.message : "Neznámá chyba"), "error");
        return;
      }
    }

    // Close detail view (either no changes or save succeeded)
    const page = returnToPage;
    const customerId = returnToCustomerIdRef.current;
    setDetailId(null);
    setReturnToPage(null);
    returnToCustomerIdRef.current = undefined;
    if (page && onReturnToPage) {
      onReturnToPage(page, customerId);
    }
  }, [saveTicketChanges, returnToPage, onReturnToPage, dirtyFlags]);

  useEffect(() => {
    const onKey = async (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      if (detailId) {
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
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [detailId, isNewOpen, handleCloseDetail]);

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
      requestedRepair: detailedTicket.requestedRepair || detailedTicket.issueShort || "",
      handoffMethod: detailedTicket.handoffMethod,
      deviceNote: detailedTicket.deviceNote || "",
      externalId: detailedTicket.externalId || "",
    });
    setIsEditing(true);
  }, [detailedTicket]);

  const errors = useMemo(() => {
    const e: Record<string, string> = {};
    if (!newDraft.deviceLabel.trim()) e.deviceLabel = "Vyplň zařízení.";
    if (!newDraft.requestedRepair.trim()) e.requestedRepair = "Vyplň požadovanou opravu.";
    if (!isPhoneValid(newDraft.customerPhone)) e.customerPhone = "Telefon vypadá neplatně.";
    if (!isEmailValid(newDraft.customerEmail)) e.customerEmail = "E-mail vypadá neplatně.";
    if (!isZipValid(newDraft.addressZip)) e.addressZip = "PSČ musí mít 5 číslic.";
    if (!isIcoValid(newDraft.ico)) e.ico = "IČO musí mít 8 číslic.";
    return e;
  }, [newDraft]);

  const canCreate = Object.keys(errors).length === 0;
  const showError = (field: string) => submitAttempted && !!errors[field];

  const createTicket = () => {
    setSubmitAttempted(true);
    if (!canCreate) {
      return;
    }

    // Ensure statuses are loaded before creating ticket
    if (!statusesReady || statuses.length === 0) {
      showToast("Statusy se ještě načítají. Zkuste to prosím za chvíli.", "error");
      return;
    }

    // Create cloud ticket if activeServiceId exists
    if (activeServiceId && supabase) {
      (async () => {
        try {
    // Use first available status if "received" doesn't exist, otherwise use "received"
    const preferredStatus = statusKeysSet.has("received") ? "received" : statuses[0]?.key;
    if (!preferredStatus) {
      showToast("Chyba: žádné statusy nejsou k dispozici. Kontaktujte administrátora.", "error");
      return;
    }
    const statusKey = normalizeStatus(preferredStatus);
    if (statusKey === null) {
      showToast("Načítání statusů... Zkuste to prosím znovu za chvíli.", "error");
      return;
    }

    const customerName = newDraft.customerName.trim() || "Anonymní zákazník";
    const issueShort = newDraft.requestedRepair.trim() || "—";

          // Generate code asynchronously using cloud data
          const code = await makeCode(cloudTickets, supabase, activeServiceId);
          // Ensure customer exists and get customer_id
          // If user explicitly rejected customer match, don't lookup/create customer
          let customerId: string | null = null;
          if (customerMatchDecision === "rejected" && !newDraft.customerId) {
            // User rejected match and no customer_id is set - don't assign customer
            customerId = null;
          } else {
            // Normal flow: lookup or create customer
            customerId = await ensureCustomerIdForTicketSnapshot(
            {
              customer_phone: newDraft.customerPhone.trim() || null,
              customer_name: customerName,
              customer_email: newDraft.customerEmail.trim() || null,
              customer_company: newDraft.company.trim() || null,
              customer_ico: newDraft.ico.trim() || null,
              customer_address_street: newDraft.addressStreet.trim() || null,
              customer_address_city: newDraft.addressCity.trim() || null,
              customer_address_zip: newDraft.addressZip.trim() || null,
            },
            activeServiceId
          );
          }

          const payload = {
            service_id: activeServiceId,
            code,
            title: newDraft.deviceLabel.trim() || "Nová zakázka",
            status: statusKey,
            notes: issueShort || "",
            customer_id: customerId ?? newDraft.customerId ?? null,
            customer_name: customerName,
            customer_phone: newDraft.customerPhone.trim() || null,
            customer_email: newDraft.customerEmail.trim() || null,
            customer_address_street: newDraft.addressStreet.trim() || null,
            customer_address_city: newDraft.addressCity.trim() || null,
            customer_address_zip: newDraft.addressZip.trim() || null,
            customer_company: newDraft.company.trim() || null,
            customer_ico: newDraft.ico.trim() || null,
            customer_info: newDraft.customerInfo.trim() || null,
            device_serial: newDraft.serialOrImei.trim() || null,
            device_passcode: newDraft.devicePasscode.trim() || null,
            device_condition: newDraft.deviceCondition.trim() || null,
            device_note: newDraft.deviceNote.trim() || null,
            external_id: newDraft.externalId.trim() || null,
            handoff_method: newDraft.handoffMethod || null,
            estimated_price: newDraft.estimatedPrice || null,
            performed_repairs: (newDraft as any).performedRepairs ?? [],
            diagnostic_text: (newDraft as any).diagnosticText?.trim() || "",
            diagnostic_photos: (newDraft as any).diagnosticPhotos ?? [],
            discount_type: (newDraft as any).discountType ?? null,
            discount_value: (newDraft as any).discountValue ?? null,
          };
          
          const { data, error } = await (supabase
            .from("tickets") as any)
            .insert(payload)
            .select()
            .single();

          if (error) {
            console.error("[SaveTicket] create error", error);
            showToast(`Chyba při vytváření zakázky: ${error.message}`, "error");
            return;
          }

          const newTicket = mapSupabaseTicketToTicketEx(data);
          setCloudTickets((prev) => [newTicket, ...prev]);
          setStatusById((prev) => ({ ...prev, [newTicket.id]: statusKey }));
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
          setDetailId(newTicket.id);
          showToast("Zakázka vytvořena", "success");
        } catch (err) {
          const errorMessage = err instanceof Error ? err.message : "Neznámá chyba";
          console.error("[SaveTicket] create exception", err);
          showToast(`Chyba při vytváření zakázky: ${errorMessage}`, "error");
        }
      })();
      return;
    }

    // Cloud mode required - should not reach here due to early return check
    showToast("Vytváření zakázek vyžaduje přihlášení a aktivní službu", "error");
  };

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

    const c: TicketComment = {
      id: uuid(),
      ticketId,
      author: "Servis",
      text,
      createdAt: new Date().toISOString(),
      pinned: false,
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
          <input placeholder="Vyhledávání…" value={query} onChange={(e) => setQuery(e.target.value)} style={inputStyle} />
          <button style={primaryBtn} onClick={openNewOrder}>
            + Nová zakázka
          </button>
        </div>
      </div>

      {/* Group tabs */}
      <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
        {[
          { key: "all" as const, label: "Vše" },
          { key: "active" as const, label: "Aktivní" },
          { key: "final" as const, label: "Final" },
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

      {/* Secondary quick status filters */}
      {showSecondaryFiltersRow && (
        <div style={{ marginTop: 10, display: "flex", flexWrap: "wrap", gap: 8 }}>
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
      {!statusesReady && (
        <div style={{ padding: 24, textAlign: "center", color: "var(--muted)" }}>
          Načítání statusů...
        </div>
      )}
      {ticketsLoading && (
        <div style={{ padding: 24, textAlign: "center", color: "var(--muted)" }}>
          Načítání zakázek...
        </div>
      )}
      {ticketsError && (
        <div style={{ padding: 24, textAlign: "center", color: "rgba(239,68,68,0.9)", background: "rgba(239,68,68,0.1)", borderRadius: 12, border: "1px solid rgba(239,68,68,0.3)" }}>
          {ticketsError}
        </div>
      )}

      {/* List/Grid - only render if statuses are ready and not loading and no error */}
      {statusesReady && !ticketsLoading && !ticketsError && (
      <div style={{ 
        marginTop: 16, 
        display: uiCfg.orders.displayMode === "grid" ? "grid" : "grid",
        gridTemplateColumns: uiCfg.orders.displayMode === "grid" ? "repeat(auto-fill, minmax(350px, 1fr))" : "1fr",
        gap: uiCfg.orders.displayMode === "grid" ? 16 : 8,
      }}>
        {filtered.map((t) => {
          const raw = (t.status as any) ?? statusById[t.id];
          const currentStatus = normalizeStatus(raw);
          const meta = currentStatus !== null ? getByKey(currentStatus) : null;
          const cardKey = t.id;

          return (
            <div
              key={cardKey}
              onClick={() => setDetailId(t.id)}
              style={{
                textAlign: "left",
                padding: 0,
                borderRadius: 16,
                border: meta?.bg ? `2px solid ${meta.bg}80` : "1px solid var(--border)",
                background: meta?.bg ? `${meta.bg}30` : "var(--panel)",
                backdropFilter: "var(--blur)",
                WebkitBackdropFilter: "var(--blur)",
                cursor: "pointer",
                boxShadow: meta?.bg ? `0 4px 16px ${meta.bg}40, 0 0 0 1px ${meta.bg}20` : "var(--shadow-soft)",
                transition: "var(--transition-smooth)",
                color: "var(--text)",
                fontFamily: "system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif",
                position: "relative",
                overflow: "hidden",
                display: "flex",
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.transform = "translateY(-1px)";
                e.currentTarget.style.boxShadow = meta?.bg ? `0 6px 20px ${meta.bg}50, 0 0 0 1px ${meta.bg}30` : "var(--shadow-hover)";
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.transform = "translateY(0)";
                e.currentTarget.style.boxShadow = meta?.bg ? `0 4px 16px ${meta.bg}40, 0 0 0 1px ${meta.bg}20` : "var(--shadow-soft)";
              }}
            >
              <div
                style={{
                  width: 10,
                  background: meta?.bg || "var(--border)",
                  flexShrink: 0,
                  boxShadow: meta?.bg ? `0 0 24px ${meta.bg}90, inset 0 0 12px ${meta.bg}60, 0 0 8px ${meta.bg}50` : "none",
                }}
              />

              <div style={{ 
                flex: 1, 
                padding: uiCfg.orders.displayMode === "grid" ? 14 : 16, 
                display: "flex", 
                flexDirection: "column", 
                gap: uiCfg.orders.displayMode === "grid" ? 10 : 12 
              }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12, marginBottom: uiCfg.orders.displayMode === "grid" ? 8 : 4 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 10, minWidth: 0, flex: 1 }}>
                    <div
                      style={{
                        fontWeight: 950,
                        fontSize: 15,
                        letterSpacing: "-0.01em",
                        color: "var(--text)",
                        whiteSpace: "nowrap",
                      }}
                    >
                      {t.code}
                    </div>
                    <div style={{ fontSize: 12, color: "var(--muted)", whiteSpace: "nowrap" }}>{formatCZ(t.createdAt)}</div>
                    {meta?.isFinal && (
                      <span
                        style={{
                          fontSize: 9,
                          fontWeight: 900,
                          padding: "2px 5px",
                          borderRadius: 4,
                          background: "var(--accent-soft)",
                          color: "var(--accent)",
                          textTransform: "uppercase",
                          letterSpacing: "0.5px",
                          whiteSpace: "nowrap",
                        }}
                      >
                        ✓
                      </span>
                    )}
                  </div>

                  <div onClick={(e) => e.stopPropagation()} onMouseDown={(e) => e.stopPropagation()}>
                    {currentStatus !== null ? (
                    <StatusPicker
                      value={currentStatus}
                      statuses={statuses as any}
                      getByKey={getByKey as any}
                      onChange={(next) => setTicketStatus(t.id, next)}
                      size="sm"
                    />
                    ) : (
                      <div
                        style={{
                          fontSize: 12,
                          padding: "6px 10px",
                          borderRadius: 8,
                          background: "var(--panel-2)",
                          color: "var(--muted)",
                          fontWeight: 600,
                        }}
                      >
                        …
                      </div>
                    )}
                  </div>
                </div>

                {uiCfg.orders.displayMode === "compact" ? (
                <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                  <div style={{ display: "flex", alignItems: "baseline", gap: 8, flexWrap: "wrap" }}>
                    <div
                      style={{
                        fontWeight: 950,
                        fontSize: 15,
                        color: "var(--accent)",
                        minWidth: 0,
                        flex: 1,
                        display: "flex",
                        alignItems: "center",
                        gap: 6,
                      }}
                    >
                      <DeviceIcon size={14} color="var(--accent)" />
                      <span>{t.deviceLabel || "—"}</span>
                    </div>
                    <div style={{ fontWeight: 600, fontSize: 12, color: "var(--muted)", whiteSpace: "nowrap" }}>
                      {t.customerName}
                    </div>
                  </div>
                  {(t.requestedRepair || t.issueShort) && (
                    <div
                      style={{
                        fontSize: 13,
                        fontWeight: 700,
                        color: "var(--text)",
                        minWidth: 0,
                        display: "flex",
                        alignItems: "center",
                        gap: 6,
                      }}
                    >
                      <WrenchIcon size={12} color="var(--text)" />
                      <span>{t.requestedRepair || t.issueShort}</span>
                    </div>
                  )}
                    {(() => {
                      const repairs = t.performedRepairs ?? [];
                      const totalPrice = repairs.reduce((sum, r) => sum + (r.price || 0), 0);
                      const discountType = t.discountType;
                      const discountValue = t.discountValue || 0;
                      let discountAmount = 0;
                      if (discountType === "percentage") {
                        discountAmount = (totalPrice * discountValue) / 100;
                      } else if (discountType === "amount") {
                        discountAmount = discountValue;
                      }
                      const finalPrice = Math.max(0, totalPrice - discountAmount);
                      const hasRepairs = repairs.length > 0;
                      const hasPrice = finalPrice > 0;

                      if (hasRepairs || hasPrice) {
                        return (
                          <div style={{ 
                            display: "flex", 
                            alignItems: "center", 
                            gap: 6,
                            fontSize: 10,
                            color: "var(--muted)",
                            whiteSpace: "nowrap",
                          }}>
                            {hasRepairs && <span>{repairs.length} oprav</span>}
                            {hasRepairs && hasPrice && <span>•</span>}
                            {hasPrice && <span style={{ fontWeight: 700, color: "var(--accent)" }}>{finalPrice.toLocaleString("cs-CZ")} Kč</span>}
              </div>
                        );
                      }
                      return null;
                    })()}
                  </div>
                ) : (
                  <>
                    <div style={{ 
                      display: "flex", 
                      alignItems: "flex-start", 
                      gap: 10,
                    }}>
                      <div style={{ 
                        display: "flex", 
                        alignItems: "center", 
                        justifyContent: "center",
                        width: 28,
                        height: 28,
                        borderRadius: 6,
                        background: "var(--accent-soft)",
                        color: "var(--accent)",
                        flexShrink: 0,
                        marginTop: 2,
                      }}>
                        <DeviceIcon size={16} color="currentColor" />
                      </div>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ 
                          display: "flex",
                          alignItems: "baseline",
                          gap: 8,
                          flexWrap: "wrap",
                          marginBottom: 4,
                        }}>
                          <div style={{ 
                            fontWeight: 950, 
                            fontSize: 16, 
                            color: "var(--text)",
                            lineHeight: 1.4,
                          }}>
                            {t.deviceLabel || "—"}
                          </div>
                          <div style={{ 
                            fontWeight: 600, 
                            fontSize: 12, 
                            color: "var(--muted)",
                            whiteSpace: "nowrap",
                          }}>
                            {t.customerName}
                          </div>
                        </div>
                        {t.serialOrImei && (
                          <div style={{ fontSize: 11, color: "var(--muted)" }}>
                            SN: {t.serialOrImei}
                          </div>
                        )}
                      </div>
                    </div>

                    {(t.requestedRepair || t.issueShort) && (
                      <div style={{ 
                        display: "flex", 
                        alignItems: "flex-start", 
                        gap: 10,
                        marginTop: 4,
                      }}>
                        <div style={{ 
                          display: "flex", 
                          alignItems: "center", 
                          justifyContent: "center",
                          width: 28,
                          height: 28,
                          borderRadius: 6,
                          background: "var(--panel)",
                          border: "1px solid var(--border)",
                          color: "var(--text)",
                          flexShrink: 0,
                          marginTop: 2,
                        }}>
                          <WrenchIcon size={16} color="currentColor" />
                        </div>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ 
                            fontSize: 14, 
                            fontWeight: 700, 
                            color: "var(--text)",
                            lineHeight: 1.4,
                          }}>
                            {t.requestedRepair || t.issueShort}
                          </div>
                        </div>
                      </div>
                    )}

                    {(() => {
                      const repairs = t.performedRepairs ?? [];
                      const totalPrice = repairs.reduce((sum, r) => sum + (r.price || 0), 0);
                      const discountType = t.discountType;
                      const discountValue = t.discountValue || 0;
                      let discountAmount = 0;
                      if (discountType === "percentage") {
                        discountAmount = (totalPrice * discountValue) / 100;
                      } else if (discountType === "amount") {
                        discountAmount = discountValue;
                      }
                      const finalPrice = Math.max(0, totalPrice - discountAmount);
                      const hasRepairs = repairs.length > 0;
                      const hasPrice = finalPrice > 0;

                      return (
                        <>
                          {(hasRepairs || hasPrice) && (
                            <div style={{ 
                              display: "flex", 
                              alignItems: "center", 
                              gap: 8,
                              padding: "8px 10px",
                              background: "var(--panel)",
                              borderRadius: 8,
                              border: "1px solid var(--border)",
                              marginTop: 8,
                            }}>
                              {hasRepairs && (
                                <div style={{ 
                                  display: "flex", 
                                  alignItems: "center", 
                                  gap: 6,
                                  fontSize: 11,
                                  color: "var(--muted)",
                                }}>
                                  <WrenchIcon size={12} color="currentColor" />
                                  <span>{repairs.length} {repairs.length === 1 ? "oprava" : repairs.length < 5 ? "opravy" : "oprav"}</span>
                                </div>
                              )}
                              {hasPrice && (
                                <div style={{ 
                                  display: "flex", 
                                  alignItems: "center", 
                                  gap: 6,
                                  fontSize: 13,
                                  fontWeight: 700,
                                  color: "var(--accent)",
                                  marginLeft: hasRepairs ? "auto" : 0,
                                }}>
                                  <span>{finalPrice.toLocaleString("cs-CZ")} Kč</span>
                                </div>
                              )}
                            </div>
                          )}
                          {t.customerPhone && (
                            <div style={{ 
                              display: "flex", 
                              alignItems: "center", 
                              gap: 12, 
                              flexWrap: "wrap",
                              paddingTop: 8,
                              borderTop: "1px solid var(--border)",
                              marginTop: 8,
                            }}>
                              <div style={{ fontSize: 11, color: "var(--muted)", whiteSpace: "nowrap" }}>
                                {formatPhoneNumber(t.customerPhone)}
                              </div>
                            </div>
                          )}
                        </>
                      );
                    })()}
                  </>
                )}
              </div>
            </div>
          );
        })}

        {filtered.length === 0 && (
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
            <div style={{ fontSize: 48, opacity: 0.5 }}>📋</div>
            <div style={{ fontSize: 16, fontWeight: 700, color: "var(--text)" }}>Žádné zakázky neodpovídají filtru</div>
            <div style={{ fontSize: 13 }}>Zkuste změnit filtry nebo vytvořte novou zakázku</div>
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
        <div style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "center" }}>
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
                if (newDraft.customerName.trim() && newDraft.customerPhone.trim()) {
                  await lookupCustomer(newDraft.customerPhone, newDraft.customerName);
                }
              }}
              style={{
                ...baseFieldInput,
                border: submitAttempted && !newDraft.customerName.trim() ? borderError : border,
              }}
              placeholder="Např. Jan Novák"
              autoFocus
            />
            {submitAttempted && !newDraft.customerName.trim() && (
              <div style={fieldHint}>Doporučeno vyplnit. Pokud ne, uloží se jako „Anonymní zákazník".</div>
            )}

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
              <div>
                <div style={fieldLabel}>Telefon</div>
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
                      if (phone) {
                        await lookupCustomer(phone, name);
                      }
                    }
                  }}
                  onBlur={async () => {
                    if (newDraft.customerPhone.trim()) {
                      await lookupCustomer(newDraft.customerPhone, newDraft.customerName);
                    } else {
                      setMatchedCustomer(null);
                    }
                  }}
                  style={{ ...baseFieldInput, border: showError("customerPhone") ? borderError : border }}
                  placeholder="+420 123 456 789"
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
                  placeholder="např. jan@firma.cz"
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
                  placeholder="Praha"
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
            <div style={{ fontWeight: 950, fontSize: 13, color: "var(--text)" }}>Zařízení</div>

            <div style={fieldLabel}>Zařízení *</div>
            <DeviceAutocomplete
              value={newDraft.deviceLabel}
              onChange={(value) => setNewDraft((p) => ({ ...p, deviceLabel: value }))}
              models={modelsWithHierarchy}
              error={showError("deviceLabel")}
            />
            {showError("deviceLabel") && <div style={fieldHint}>{errors.deviceLabel}</div>}

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
              <div>
                <div style={fieldLabel}>IMEI / SN</div>
                <input
                  value={newDraft.serialOrImei}
                  onChange={(e) => setNewDraft((p) => ({ ...p, serialOrImei: e.target.value }))}
                  style={baseFieldInput}
                  placeholder="Volitelné"
                />
              </div>

              <div>
                <div style={fieldLabel}>Heslo / kód (volitelné)</div>
                <input
                  value={newDraft.devicePasscode}
                  onChange={(e) => setNewDraft((p) => ({ ...p, devicePasscode: e.target.value }))}
                  style={baseFieldInput}
                  placeholder="např. 1234 / 0000"
                />
              </div>
            </div>

            <div style={fieldLabel}>Popis stavu</div>
            <textarea
              value={newDraft.deviceCondition}
              onChange={(e) => setNewDraft((p) => ({ ...p, deviceCondition: e.target.value }))}
              style={baseFieldTextArea}
              placeholder="Např. rozbitý displej, prasklé zadní sklo, oděrky…"
            />

            <div style={fieldLabel}>Požadovaná oprava *</div>
            <textarea
              value={newDraft.requestedRepair}
              onChange={(e) => setNewDraft((p) => ({ ...p, requestedRepair: e.target.value }))}
              style={{ ...baseFieldTextArea, border: showError("requestedRepair") ? borderError : border }}
              placeholder="Např. výměna displeje, výměna baterie, diagnostika…"
            />
            {showError("requestedRepair") && <div style={fieldHint}>{errors.requestedRepair}</div>}

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
              <div>
                <div style={fieldLabel}>Způsob převzetí a předání</div>
                <HandoffMethodPicker value={newDraft.handoffMethod} onChange={(value) => setNewDraft((p) => ({ ...p, handoffMethod: value }))} />
              </div>

              <div>
                <div style={fieldLabel}>Externí identifikace</div>
                <input
                  value={newDraft.externalId}
                  onChange={(e) => setNewDraft((p) => ({ ...p, externalId: e.target.value }))}
                  style={baseFieldInput}
                  placeholder="Např. číslo zakázky partnera"
                />
              </div>
            </div>

            <div style={fieldLabel}>Předschválená cena</div>
            <input
              type="number"
              value={newDraft.estimatedPrice ?? ""}
              onChange={(e) => setNewDraft((p) => ({ ...p, estimatedPrice: e.target.value ? Number(e.target.value) : undefined }))}
              style={baseFieldInput}
              placeholder="Kč"
              min="0"
              step="1"
            />

            <div style={fieldLabel}>Poznámka k zařízení</div>
            <textarea
              value={newDraft.deviceNote}
              onChange={(e) => setNewDraft((p) => ({ ...p, deviceNote: e.target.value }))}
              style={baseFieldTextArea}
              placeholder="Poznámka pro technika…"
            />
          </div>
        </div>

        <div style={{ marginTop: 14, display: "flex", gap: 10, justifyContent: "flex-end" }}>
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
            Zrušit
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

      {/* ===== Full detail modal ===== */}
      <div
        onClick={handleCloseDetail}
        style={{
          position: "fixed",
          inset: 0,
          background: "rgba(0,0,0,0.42)",
          opacity: detailId ? 1 : 0,
          pointerEvents: detailId ? "auto" : "none",
          transition: "opacity 160ms ease",
          zIndex: 300,
        }}
      />

      <div
        style={{
          position: "fixed",
          left: "50%",
          top: "50%",
          transform: detailId ? "translate(-50%, -50%) scale(1)" : "translate(-50%, -48%) scale(0.99)",
          opacity: detailId ? 1 : 0,
          pointerEvents: detailId ? "auto" : "none",
          transition: "transform 160ms ease, opacity 160ms ease",
          width: 1080,
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
          zIndex: 310,
          fontFamily: "system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "flex-start" }}>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontWeight: 950, fontSize: 18, color: "var(--text)" }}>{detailedTicket ? detailedTicket.code : "—"}</div>
            <div style={{ color: "var(--muted)", marginTop: 4 }}>
              {detailedTicket ? (
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

          <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
            {!isEditing ? (
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

            {detailedTicket && (
              <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
                <DocumentActionPicker
                  label="📄 Zakázkový list"
                  onSelect={(action) => {
                    if (action === "preview") previewTicket(detailedTicket);
                    else if (action === "export") exportTicketToPDF(detailedTicket);
                    else if (action === "print") printTicket(detailedTicket);
                  }}
                />
                {(detailedTicket.diagnosticText || (detailedTicket.diagnosticPhotos && detailedTicket.diagnosticPhotos.length > 0)) && (
                  <DocumentActionPicker
                    label="🔍 Diagnostický protokol"
                    onSelect={(action) => {
                      if (action === "preview") previewDiagnosticProtocol(detailedTicket);
                      else if (action === "export") exportDiagnosticProtocolToPDF(detailedTicket);
                      else if (action === "print") printDiagnosticProtocol(detailedTicket);
                    }}
                  />
                )}
                <DocumentActionPicker
                  label="📋 Záruční list"
                  onSelect={(action) => {
                    if (action === "preview") previewWarranty(detailedTicket);
                    else if (action === "export") exportWarrantyToPDF(detailedTicket);
                    else if (action === "print") printWarranty(detailedTicket);
                  }}
                />
              </div>
            )}

            <button
              onClick={handleCloseDetail}
              style={softBtn}
            >
              Zavřít
            </button>
          </div>
        </div>

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
                        <div style={fieldLabel}>Telefon</div>
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
                                    console.log("[EditTicket] Customer data loaded from DB:", {
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
                                    console.log("[EditTicket] Setting to editedTicket:", updatedFields);
                                    
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
                        <textarea
                          value={editedTicket.deviceCondition || ""}
                          onChange={(e) => setEditedTicket((p) => ({ ...p, deviceCondition: e.target.value }))}
                          style={baseFieldTextArea}
                          placeholder="Popis fyzického stavu zařízení..."
                        />
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
                        <div style={fieldLabel}>Způsob předání</div>
                        <HandoffMethodPicker
                          value={editedTicket.handoffMethod || "branch"}
                          onChange={(value) => setEditedTicket((p) => ({ ...p, handoffMethod: value }))}
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
                      {detailedTicket.deviceNote && (
                        <div style={{ marginTop: 4 }}>
                          <div style={{ color: "var(--muted)", marginBottom: 4 }}>Poznámka:</div>
                          <div style={{ padding: 8, borderRadius: 8, background: "var(--panel-2)", fontSize: 12, lineHeight: 1.4 }}>
                            {detailedTicket.deviceNote}
                          </div>
                        </div>
                      )}
                      <div style={{ marginTop: 6, display: "flex", gap: 8, flexWrap: "wrap" }}>
                        <div style={{ fontSize: 12, color: "var(--muted)" }}>
                          <span>📦</span> {handoffLabel(detailedTicket.handoffMethod)}
                        </div>
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
                      } catch (e) {
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
                      <div style={fieldLabel}>Diagnostické fotografie</div>
                      <div style={{ display: "flex", flexWrap: "wrap", gap: 12, marginTop: 8 }}>
                        {(detailedTicket.diagnosticPhotos || []).map((photoUrl, idx) => (
                          <div key={idx} style={{ position: "relative" }}>
                            <img 
                              src={photoUrl} 
                              alt={`Diagnostika ${idx + 1}`}
                              style={{
                                width: 120, 
                                height: 120, 
                                objectFit: "cover", 
                                borderRadius: 8,
                                border: "1px solid var(--border)" 
                              }}
                            />
                            <button
                              onClick={() => {
                                setDirtyFlags((prev) => ({ ...prev, diagnosticPhotos: true }));
                                setCloudTickets((prev) =>
                                  prev.map((t) =>
                                    t.id === detailedTicket.id
                                      ? { ...t, diagnosticPhotos: (t.diagnosticPhotos || []).filter((_, i) => i !== idx) }
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
                      <input
                        type="file"
                        accept="image/*"
                        multiple
                        onChange={(e) => {
                          const files = Array.from(e.target.files || []);
                          files.forEach((file) => {
                            const reader = new FileReader();
                            reader.onload = (event) => {
                              const result = event.target?.result as string;
                              setDirtyFlags((prev) => ({ ...prev, diagnosticPhotos: true }));
                              setCloudTickets((prev) =>
                                prev.map((t) =>
                                  t.id === detailedTicket.id
                                    ? { ...t, diagnosticPhotos: [...(t.diagnosticPhotos || []), result] }
                                    : t
                                )
                              );
                            };
                            reader.readAsDataURL(file);
                          });
                          e.target.value = "";
                        }}
                        style={{ ...baseFieldInput, marginTop: 8, padding: "8px 12px", cursor: "pointer" }}
                      />
                    </div>
                  </div>
                </div>
              </>
            )}

            {/* Komentáře - vždy viditelné */}
            <div style={{ ...card, marginTop: 16 }}>
              <div style={{ fontWeight: 950, fontSize: 13, color: "var(--text)" }}>💬 Interní komentáře (chat)</div>

              <div style={{ marginTop: 10, display: "grid", gap: 10 }}>
                {commentsFor(detailedTicket.id).map((c) => (
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
                        <div style={{ fontWeight: 950 }}>{c.author || "Servis"}</div>
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
                ))}

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
    </div>
  );
}
