import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useIsNarrow } from "../hooks/useIsNarrow";
import { Button, Segmented } from "../components/ui";
import { createPortal } from "react-dom";
import type { Ticket } from "../mock/tickets";
import { useStatuses } from "../state/StatusesStore";
import { useServiceVat, sazbaProNovouPolozku } from "../hooks/useServiceVat";
import { type ZvyrazneniStavu } from "../lib/zvyrazneniStavu";
import { TicketCardList, TicketCardGrid, TicketCardCompact, TicketCardCompactExtra, TicketCardStripe, TicketTimeline, TicketStatusGrouped, ClaimStatusGrouped, CombinedStatusGrouped, ClaimCard, TicketComments, formatCZ, type TicketCardData, type TicketComment } from "../components/tickets";
import { computeFinalPrice } from "../components/tickets/types";
import { showToast, showPersistentToast } from "../components/Toast";
import { reportSilent, reportError } from "../lib/reportError";
import { isJobiDocsRunning, printDocument, exportDocument, formatJobiDocsErrorForUser, type DocTypeForPrint } from "../lib/jobidocs";
import { ticketDocumentData, claimDocumentData, type DocumentData } from "../lib/documentData";
import { normalizeError } from "../utils/errorNormalizer";
import type { NavKey } from "../layout/Sidebar";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { DateTimePicker } from "../components/DateTimePicker";
import { supabase, supabaseUrl, supabaseAnonKey, supabaseFetch, resetTauriFetchState } from "../lib/supabaseClient";
import { typedSupabase, getTypedSupabaseClient } from "../lib/typedSupabase";
import { devLog } from "../lib/devLog";
import { fetchAllPages } from "../lib/fetchAllPages";
import {
  uploadDiagnosticPhotoWithWatermark,
  deleteDiagnosticPhotoFromStorage,
  isDiagnosticPhotoStorageUrl,
} from "../lib/diagnosticPhotosStorage";
import { normalizePhone } from "../lib/phone";
import { STORAGE_KEYS } from "../constants/storageKeys";
import { useOrderActions } from "./Orders/hooks/useOrderActions";
import { useStatusActionsMap, runStatusChangeAutomations, runTicketCreatedAutomations } from "./Orders/hooks/useAutomations";
import { type WarrantyClaimRow, useWarrantyClaims } from "./Orders/hooks/useWarrantyClaims";
import { CreateWarrantyClaimModal } from "./Orders/components/CreateWarrantyClaimModal";
import { SmsChat } from "../components/SmsChat";
import { useAuth } from "../auth/AuthProvider";
import { useUserProfile } from "../hooks/useUserProfile";
import { isWeb } from "../lib/platform";
import { SectionHeading } from "../components/SectionHeading";
import { CameraIcon, ChatIcon, CheckIcon, ChevronDownIcon, CoinsIcon, DeviceIcon, DocumentIcon, EditIcon, HashIcon, HistoryIcon, InboxIcon, LinkIcon, MailIcon, NoteIcon, OutboxIcon, PhoneIcon, PinIcon, PlusIcon, PrintIcon, SaveIcon, SearchIcon, TrashIcon, UserIcon, WrenchIcon, XIcon } from "../components/icons";
import { type PerformedRepair } from "../components/orders/types";
import { PortalCard } from "../components/orders/PortalCard";
import { ensurePortalToken, mapPortalTicketFields, portalUrl, type PortalTicketFields } from "../lib/portal";
import { useBranches, filterByBranch } from "../context/BranchContext";
import { companyDataForBranch, getCachedBranch, setTicketBranch, type Branch } from "../lib/branches";
import { BranchPickerDialog } from "../components/orders/BranchPickerDialog";
import { loadDevicesFromDb } from "../lib/devicesDb";
import {
  type DevicesData,
  type InventoryData,
  type DeviceRepair,
  type DeviceModel,
  safeLoadDevicesData,
  safeLoadInventoryData,
} from "../lib/catalogStorage";
import {
  reserveForRepair,
  releaseReservations,
  consumeTicketReservations,
  loadTicketReservations,
  jenUuid,
  type TicketReservation,
  type ReserveShortage,
} from "../lib/purchaseOrders";
import {
  PerformedRepairItem,
  PerformedRepairAdder,
  DeviceAutocomplete,
  HandoffMethodSelect,
  DiscountPicker,
  StatusPicker,
  PrintMenu,
  OverflowMenu,
  CustomerAutocomplete,
  type CustomerMatch,
} from "../components/orders";
import { printDocumentInBrowser, type WebPrintDocType } from "../lib/webPrint";
import { useActiveRole } from "../hooks/useActiveRole";
import { smsDoNotNotifyRef } from "../hooks/useSmsNotifications";
import { registerShortcut } from "../lib/keyboardShortcuts";
import { getDeviceOptions } from "../lib/deviceOptions";
import { getHandoffOptions } from "../lib/handoffOptions";
import { safeLoadCompanyData } from "../lib/companyData";
import { trackDocumentAction } from "../lib/documentTelemetry";
import { useTicketViewers, useTicketViewersMap, setPresenceTicket } from "../lib/presence";
import { PresenceAvatars } from "../components/PresenceAvatars";
import { OnboardingChecklist } from "../components/OnboardingChecklist";
import {
  loadDocumentsConfigFromDB,
  safeLoadDocumentsConfig,
} from "../lib/documentHelpers";

export { safeLoadCompanyData } from "../lib/companyData";
export { safeLoadDocumentsConfig } from "../lib/documentHelpers";
export { generateTicketHTML, generateDiagnosticProtocolHTML, generateWarrantyHTML, generatePrijetiReklamaceHTML } from "../lib/documentGenerators";


type GroupKey = "all" | "active" | "final" | "reklamace";
type ClaimsSubGroup = "all" | "active" | "final";

const VALID_PAGE_SIZES = [0, 25, 50, 100, 200] as const;
type DisplayMode = "list" | "grid" | "compact" | "compact-extra" | "timeline" | "stripe" | "status-grouped";
type UIConfig = {
  app: { fabNewOrderEnabled: boolean; uiScale: number };
  sidebar: { position: "left" | "right" | "bottom" };
  home: { orderFilters: { selectedQuickStatusFilters: string[] } };
  orders: { displayMode: DisplayMode; pageSize: number; customerPhoneRequired: boolean; statusGroupedOrder?: string[]; zvyrazneniStavu?: ZvyrazneniStavu };
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
    branchId?: string | null;
    items?: { name: string; qty: number; unit: string; unit_price: number; vat_rate: number }[];
  }) => void;
  /** When ticket already has an invoice, open that invoice (navigate to Faktury and open editor). */
  onOpenInvoice?: (invoiceId: string) => void;

  /** When true, detail panel (ticket/claim) is closed. Used when navigating to e.g. Faktury so the preview does not stay on top. */
  closeDetailWhen?: boolean;
  /**
   * SMS jsou pro servis dostupné: má aktivní číslo A ZÁROVEŇ zaplacený modul.
   * App to počítá jako smsProvisioned && hasModule("sms"); Orders si dřív
   * ověřovaly jen to číslo, takže se SMS tlačítko ukazovalo i servisům
   * s vypnutým modulem. Bez propu radši skryté – modul je placený.
   */
  smsEnabled?: boolean;
};

const NEW_ORDER_DRAFT_KEY = "jobsheet_new_order_draft_v1";
/** Zda je v okně Nová zakázka rozbalená sekce „Další údaje“. */
const NEW_ORDER_MORE_OPEN_KEY = "jobsheet_new_order_more_open_v1";

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
  /** Pobočka, kde zakázka leží (null = bez pobočky / starší záznam). */
  branchId?: string | null;
} & PortalTicketFields; // zákaznický portál: portalToken, quoteAmount, quoteNote, quoteStatus, quoteSentAt, quoteDecidedAt, quoteDecisionMeta, intakeSignatureUrl, intakeSignedAt, portalLastOpenedAt

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
  /** Opravy vybrané z ceníku už při příjmu – do zakázky jdou jako provedené opravy s cenou z ceníku. */
  plannedRepairs?: PerformedRepair[];
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
  /** Pobočka nové zakázky; bez hodnoty se použije aktivní / domovská / výchozí. */
  branchId?: string | null;
};

// ========================
// Utils: storage
// ========================
const VALID_DISPLAY_MODES: DisplayMode[] = ["list", "grid", "compact", "compact-extra", "timeline", "stripe", "status-grouped"];

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

type SupabaseTicketCommentRow = {
  id: string;
  ticket_id: string;
  author: string;
  author_id: string | null;
  author_nickname: string | null;
  author_avatar_url: string | null;
  content: string;
  pinned: boolean;
  created_at: string;
};

function mapSupabaseCommentRow(row: SupabaseTicketCommentRow): TicketComment {
  return {
    id: row.id,
    ticketId: row.ticket_id,
    author: row.author,
    text: row.content,
    createdAt: row.created_at,
    pinned: row.pinned,
    author_id: row.author_id,
    author_nickname: row.author_nickname,
    author_avatar_url: row.author_avatar_url,
  };
}

// ========================
// Utils: formatting
// ========================

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
    branchId: typeof supabaseTicket.branch_id === "string" ? supabaseTicket.branch_id : null,
    // Portálové sloupce: v hlavních selectech nejsou (migrace může chybět), přijdou z realtime nebo z PortalCard.
    ...mapPortalTicketFields(supabaseTicket),
  };
  (ticket as any).service_id = supabaseTicket.service_id;
  (ticket as any).expected_completion_at = supabaseTicket.expected_completion_at ?? null;
  (ticket as any).completed_at = supabaseTicket.completed_at ?? null;
  return ticket;
}

// Tisk a export PDF probíhají přes JobiDocs (localhost:3847); ve webové verzi přes tiskový dialog prohlížeče.
// Jobi posílá typovaná data dokumentu, šablonu i formátování drží JobiDocs.

type DocMode = "print" | "export";

function ticketDocData(ticket: TicketEx, docType: DocTypeForPrint): DocumentData {
  const t = ticket as TicketEx & { completed_at?: string | null };
  const completedAt = t.completed_at ?? (docType === "zarucni_list" ? new Date().toISOString() : undefined);
  // Adresa, telefon a e-mail pobočky mají na dokumentu přednost před firemními.
  const branch = getCachedBranch((ticket as any).service_id, ticket.branchId);
  return ticketDocumentData(ticket, companyDataForBranch(safeLoadCompanyData(), branch), { completedAt });
}

async function runWebDocument(mode: DocMode, docType: WebPrintDocType, sid: string, data: DocumentData) {
  const start = performance.now();
  try {
    if (mode === "export") showToast("V tiskovém dialogu zvolte cíl „Uložit jako PDF“.", "info");
    await printDocumentInBrowser(docType, sid, data);
    trackDocumentAction({ action: mode, docType, result: "success", durationMs: Math.round(performance.now() - start) });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    trackDocumentAction({ action: mode, docType, result: "error", durationMs: Math.round(performance.now() - start), errorMessage: msg });
    showToast(`${mode === "print" ? "Tisk" : "Export"} se nezdařil: ${msg}`, "error");
  }
}

async function runDesktopDocument(mode: DocMode, docType: DocTypeForPrint, sid: string, data: DocumentData, defaultFileName: string) {
  if (!(await isJobiDocsRunning())) {
    showToast(mode === "print" ? "Spusťte JobiDocs pro tisk." : "Spusťte JobiDocs pro export do PDF.", "error");
    return;
  }
  const start = performance.now();
  try {
    if (mode === "print") {
      const res = await printDocument(docType, sid, data);
      const durationMs = Math.round(performance.now() - start);
      if (res.ok) {
        trackDocumentAction({ action: "print", docType, result: "success", durationMs });
        showToast("Úloha odeslána do fronty", "success");
      } else {
        trackDocumentAction({ action: "print", docType, result: "error", durationMs, errorMessage: res.error });
        showToast(`JobiDocs: ${formatJobiDocsErrorForUser(res.error)}`, "error");
      }
      return;
    }
    const { save } = await import("@tauri-apps/plugin-dialog");
    const filePath = await save({
      defaultPath: defaultFileName,
      filters: [{ name: "PDF", extensions: ["pdf"] }, { name: "All Files", extensions: ["*"] }],
    });
    if (!filePath) return;
    const res = await exportDocument(docType, sid, data, filePath);
    const durationMs = Math.round(performance.now() - start);
    if (res.ok) {
      trackDocumentAction({ action: "export", docType, result: "success", durationMs });
      showExportSuccessToast(filePath);
    } else {
      trackDocumentAction({ action: "export", docType, result: "error", durationMs, errorMessage: res.error });
      showToast(`JobiDocs: ${formatJobiDocsErrorForUser(res.error)}`, "error");
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    trackDocumentAction({ action: mode, docType, result: "error", durationMs: Math.round(performance.now() - start), errorMessage: msg });
    showToast(`Chyba ${mode === "print" ? "tisku" : "exportu"}: ${msg}`, "error");
  }
}

const TICKET_DOC_FILE_PREFIX: Partial<Record<DocTypeForPrint, string>> = {
  zakazkovy_list: "zakazka",
  zarucni_list: "zarucni-list",
  diagnosticky_protokol: "diagnostika",
};

async function runTicketDocument(mode: DocMode, docType: DocTypeForPrint, ticket: TicketEx, serviceId?: string | null) {
  const sid = serviceId ?? undefined;
  if (!sid) {
    showToast(mode === "print" ? "Vyberte servis pro tisk." : "Vyberte servis pro export.", "error");
    return;
  }
  // Odkaz na zákaznický portál do dokumentu (QR „Stav zakázky online“ v JobiDocs).
  // Token vzniká při prvním tisku; když RPC selže (starší server), tiskne se bez něj.
  let withToken = ticket;
  if (!ticket.portalToken) {
    try {
      const token = await ensurePortalToken(ticket.id);
      withToken = { ...ticket, portalToken: token };
    } catch {
      /* bez portálu */
    }
  }
  const data = ticketDocData(withToken, docType);
  if (isWeb()) return runWebDocument(mode, docType, sid, data);
  return runDesktopDocument(mode, docType, sid, data, `${TICKET_DOC_FILE_PREFIX[docType] ?? docType}-${ticket.code}.pdf`);
}

async function exportTicketToPDF(ticket: TicketEx, serviceId?: string | null) {
  return runTicketDocument("export", "zakazkovy_list", ticket, serviceId);
}

async function printTicket(ticket: TicketEx, serviceId?: string | null) {
  return runTicketDocument("print", "zakazkovy_list", ticket, serviceId);
}

async function exportDiagnosticProtocolToPDF(ticket: TicketEx, serviceId?: string | null) {
  return runTicketDocument("export", "diagnosticky_protokol", ticket, serviceId);
}

async function printDiagnosticProtocol(ticket: TicketEx, serviceId?: string | null) {
  return runTicketDocument("print", "diagnosticky_protokol", ticket, serviceId);
}

async function exportWarrantyToPDF(ticket: TicketEx, serviceId?: string | null) {
  return runTicketDocument("export", "zarucni_list", ticket, serviceId);
}

async function printWarranty(ticket: TicketEx, serviceId?: string | null) {
  return runTicketDocument("print", "zarucni_list", ticket, serviceId);
}

function showExportSuccessToast(filePath: string) {
  const shortPath = filePath.replace(/^.*[/\\]/, "");
  // Ve webu soubor jen spadne do složky Stažené – není co otevírat ve Finderu.
  if (isWeb()) {
    showToast(`PDF uložen: ${shortPath}`, "success");
    return;
  }
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

async function quickPrintFromList(
  ticket: TicketEx,
  docType: "ticket" | "diagnostic" | "warranty",
  serviceId: string | null
) {
  if (docType === "ticket") await printTicket(ticket, serviceId);
  else if (docType === "diagnostic") await printDiagnosticProtocol(ticket, serviceId);
  else await printWarranty(ticket, serviceId);
}


// Document Action Picker Component (for each document type) – pořadí: Tisk, Export
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
  smsEnabled = false,
}: OrdersProps) {
  const isNarrow = useIsNarrow();
  const { statuses, loading: statusesLoading, error: statusesError, getByKey, isFinal, fallbackKey } = useStatuses();
  const dph = useServiceVat(activeServiceId);
  const { session } = useAuth();
  const { profile: userProfile } = useUserProfile();
  const { hasCapability, isAdmin } = useActiveRole(activeServiceId);
  const canPrintExport = hasCapability("can_print_export");

  const [uiCfg, setUiCfg] = useState<UIConfig>(() => safeLoadUIConfig());
  const [cloudTickets, setCloudTickets] = useState<TicketEx[]>([]);
  const [ticketsLoading, setTicketsLoading] = useState(false);
  const [ticketsError, setTicketsError] = useState<string | null>(null);
  const [cloudClaims, setCloudClaims] = useState<WarrantyClaimRow[]>([]);
  const [claimsLoading, setClaimsLoading] = useState(false);
  const [claimsError, setClaimsError] = useState<string | null>(null);
  const [commentsByTicket, setCommentsByTicket] = useState<Record<string, TicketComment[]>>({});
  /** Živé profily autorů komentářů (fotka a přezdívka) – viz TicketComments. */
  const [commentAuthorProfiles, setCommentAuthorProfiles] = useState<Record<string, { nickname: string | null; avatarUrl: string | null }>>({});

  const [, setDocumentsConfig] = useState<any>(() => safeLoadDocumentsConfig());

  // Refs for race condition protection
  const ticketsReqIdRef = useRef(0);
  const claimsReqIdRef = useRef(0);
  const commentsReqIdRef = useRef(0);
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
        const { data, error } = await fetchAllPages((from, to) =>
          (supabase!
            .from("tickets") as any)
            .select("id,service_id,code,title,status,notes,customer_id,customer_name,customer_phone,customer_email,customer_address_street,customer_address_city,customer_address_zip,customer_company,customer_ico,customer_info,device_serial,device_passcode,device_condition,device_accessories,device_note,external_id,handoff_method,handback_method,estimated_price,performed_repairs,diagnostic_text,diagnostic_photos,diagnostic_photos_before,discount_type,discount_value,created_at,updated_at,version,branch_id")
            .eq("service_id", activeServiceId)
            .is("deleted_at", null)
            .order("created_at", { ascending: false })
            .order("id", { ascending: false })
            .range(from, to)
        );

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
        const { data, error } = await fetchAllPages<WarrantyClaimRow>((from, to) =>
          (client
            .from("warranty_claims") as any)
            .select("*")
            .eq("service_id", activeServiceId)
            .order("created_at", { ascending: false })
            .order("id", { ascending: false })
            .range(from, to)
        );
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

  // Interní komentáře (chat) k zakázkám – dřív jen v localStorage, teď sdílená
  // tabulka ticket_comments. Načtou se všechny najednou pro aktivní servis a
  // seskupí podle ticket_id, stejně jako u tickets/claims výše.
  const refetchComments = useCallback(async () => {
    if (!activeServiceId || !supabase) {
      setCommentsByTicket({});
      return;
    }
    const myReqId = ++commentsReqIdRef.current;
    const { data, error } = await fetchAllPages<SupabaseTicketCommentRow>((from, to) =>
      (supabase!.from("ticket_comments") as any)
        .select("id,ticket_id,author,author_id,author_nickname,author_avatar_url,content,pinned,created_at")
        .eq("service_id", activeServiceId)
        .order("created_at", { ascending: true })
        .range(from, to)
    );
    if (myReqId !== commentsReqIdRef.current) return;
    if (error) {
      console.error("[Orders] Error loading ticket comments:", error);
      return;
    }
    const grouped: Record<string, TicketComment[]> = {};
    for (const row of data) {
      const c = mapSupabaseCommentRow(row);
      (grouped[c.ticketId] ??= []).push(c);
    }
    setCommentsByTicket(grouped);
  }, [activeServiceId, supabase]);

  useEffect(() => {
    void refetchComments();
    return () => { commentsReqIdRef.current++; };
  }, [refetchComments]);

  // Realtime subscription for ticket_comments – ať se nové/připnuté komentáře
  // objeví u všech kolegů na všech zařízeních, ne jen tam, kde vznikly.
  useEffect(() => {
    if (!activeServiceId || !supabase) return;
    const topic = `ticket_comments:${activeServiceId}`;
    const client = supabase;
    const channel = client
      .channel(topic)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "ticket_comments", filter: `service_id=eq.${activeServiceId}` },
        () => void refetchComments()
      )
      .subscribe();
    return () => {
      if (client) client.removeChannel(channel);
    };
  }, [activeServiceId, supabase, refetchComments]);

  const refetchClaims = useCallback(async () => {
    if (!activeServiceId || !supabase) return;
    const { data, error } = await fetchAllPages<WarrantyClaimRow>((from, to) =>
      (supabase!.from("warranty_claims") as any)
        .select("*")
        .eq("service_id", activeServiceId)
        .order("created_at", { ascending: false })
        .order("id", { ascending: false })
        .range(from, to)
    );
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
  const ticketViewers = useTicketViewers(activeServiceId, detailId, session?.user?.id ?? null);
  const viewersByTicket = useTicketViewersMap(activeServiceId, session?.user?.id ?? null);
  // Kolegům se ukáže, že tuhle zakázku máme otevřenou.
  useEffect(() => {
    setPresenceTicket(detailId);
    return () => setPresenceTicket(null);
  }, [detailId]);

  // Rezervace dílů otevřené zakázky (řádek „Díly: …“ pod provedenými opravami).
  // Klíčované id zakázky, aby pozdní odpověď nepřepsala data jiné zakázky.
  const [ticketReservations, setTicketReservations] = useState<{ ticketId: string | null; rows: TicketReservation[] }>({ ticketId: null, rows: [] });
  const refreshTicketReservations = useCallback(async (ticketId: string) => {
    const rows = await loadTicketReservations(ticketId);
    if (!rows) return;
    // Volá se po vlastní akci na otevřené zakázce; render si stejně hlídá shodu ticketId.
    setTicketReservations({ ticketId, rows });
  }, []);
  useEffect(() => {
    if (!detailId) return;
    let cancelled = false;
    void loadTicketReservations(detailId).then((rows) => {
      if (cancelled || !rows) return;
      setTicketReservations({ ticketId: detailId, rows });
    });
    return () => {
      cancelled = true;
    };
  }, [detailId]);

  /** Jedno upozornění na díly, které po rezervaci nejsou skladem. Není to chyba – zakázka jde dál. */
  const toastReserveShortages = useCallback((shortages: ReserveShortage[]) => {
    if (shortages.length === 0) return;
    const text = shortages
      .map((s) => `Díl „${s.name}“ není skladem (rezervováno ${s.reservedTotal}, skladem ${s.stock})`)
      .join("; ");
    showToast(text, "info");
  }, []);

  /** Zarezervuje díly jedné opravy na zakázce; tiché, když RPC na serveru není. */
  const reserveEntryProducts = useCallback(
    async (ticketId: string, entryId: string, productIds: string[] | undefined) => {
      const ids = jenUuid(productIds);
      if (ids.length === 0) return null;
      const res = await reserveForRepair(ticketId, entryId, ids);
      if (res && res.reserved > 0) void refreshTicketReservations(ticketId);
      return res;
    },
    [refreshTicketReservations]
  );
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

  /**
   * Při odchodu na jinou stránku zavřít všechno, co Orders vykresluje portálem.
   *
   * App drží Orders namountované a jen skryté (App.tsx: display: none podle
   * activePage). Potomci uvnitř se skryjí s ním, ale co jde přes createPortal
   * do document.body, tomu skrytí unikne a zůstane viset nad další stránkou.
   * Ověřeno: detail → Historie → Sklad, i tisková nabídka na řádku seznamu.
   *
   * Modaly vykreslené vevnitř (např. CreateWarrantyClaimModal) se schovají
   * samy a rozepsaná data v nich zůstanou – ty tu proto schválně nejsou.
   */
  useEffect(() => {
    if (closeDetailWhen) {
      setDetailId(null);
      setDetailClaimId(null);
      setTicketHistoryModalOpen(false);
      setClaimHistoryModalOpen(false);
      setOpenQuickPrintTicket(null);
      setQuickPrintDropdownRect(null);
      setCaptureQRItems(null);
      setPhotoLightbox(null);
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
  const { activeBranchId, isMulti: hasBranches, branches, branchById, branchForNew } = useBranches();
  const [moveBranchOpen, setMoveBranchOpen] = useState(false);
  const tickets = useMemo(() => filterByBranch(cloudTickets, activeBranchId), [cloudTickets, activeBranchId]);

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
  /** Sekce „Další údaje“ v nové zakázce – stav se pamatuje v localStorage. */
  const [newOrderMoreOpen, setNewOrderMoreOpen] = useState<boolean>(() => {
    try {
      // Výchozí otevřené – servis při příjmu většinou vyplňuje i IMEI, heslo
      // a stav zařízení; sbalení si pamatujeme, jen když ho uživatel zavře.
      const v = localStorage.getItem(NEW_ORDER_MORE_OPEN_KEY);
      return v === null ? true : v === "1";
    } catch {
      return false;
    }
  });
  /** Které zařízení v nové zakázce je rozbalené (ostatní jsou sbalené karty). */
  const [expandedDeviceIdx, setExpandedDeviceIdx] = useState<number>(0);
  /** Rozbalený úplný seznam oprav z ceníku u zařízení (index → true). */
  const [catalogShowAll, setCatalogShowAll] = useState<Record<number, boolean>>({});
  const createTicketRef = useRef<() => void>(() => {});
  const newOrderBodyRef = useRef<HTMLDivElement | null>(null);
  /**
   * Co se při přepnutí stavu stane automaticky (tisk podle nastavení
   * dokumentů, pravidla automatizací) – ukazuje se v nabídce stavů.
   * Obnovuje se při otevření detailu a každých 5 minut.
   */
  const statusLabelForHint = useCallback((key: string) => getByKey(key)?.label ?? key, [getByKey]);
  const { statusActionsMap, hasRulesFor: hasAutomationRulesFor } = useStatusActionsMap(activeServiceId, detailId, statusLabelForHint);

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
  /** Aktuální stav detailu pro `enabled` u zkratek (čte se při stisku, ne při registraci). */
  const detailIdRef = useRef<string | null>(null);
  const isEditingRef = useRef(false);
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
  const [smsPanelOpen, setSmsPanelOpen] = useState(false);
  const [smsUnreadCount, setSmsUnreadCount] = useState(0);
  const [smsUnreadByTicketId, setSmsUnreadByTicketId] = useState<Record<string, number>>({});
  const [smsUnreadListBump, setSmsUnreadListBump] = useState(0);
  const [smsActivatedForService, setSmsActivatedForService] = useState(false);
  /** Číslo i modul zároveň – jen tak se SMS smí kdekoli objevit. */
  const smsAvailable = smsActivatedForService && smsEnabled;

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

  // SMS unread on detail header: conv linked by ticket_id OR same customer phone (shared thread)
  useEffect(() => {
    const client = getTypedSupabaseClient();
    if (!detailId || !activeServiceId || !client) {
      setSmsUnreadCount(0);
      return;
    }
    let cancelled = false;
    (async () => {
      const convIdSet = new Set<string>();
      const { data: convsTicket } = await client.from("sms_conversations").select("id").eq("ticket_id", detailId);
      convsTicket?.forEach((c) => convIdSet.add(c.id));
      const { data: tick } = await client
        .from("tickets")
        .select("customer_phone")
        .eq("id", detailId)
        .eq("service_id", activeServiceId)
        .maybeSingle();
      const phoneNorm = tick?.customer_phone ? normalizePhone(String(tick.customer_phone)) : null;
      if (phoneNorm) {
        const { data: convPhone } = await client
          .from("sms_conversations")
          .select("id")
          .eq("service_id", activeServiceId)
          .eq("customer_phone", phoneNorm)
          .maybeSingle();
        if (convPhone?.id) convIdSet.add(convPhone.id);
      }
      if (convIdSet.size === 0) {
        if (!cancelled) setSmsUnreadCount(0);
        return;
      }
      const { count, error } = await client
        .from("sms_messages")
        .select("id", { count: "exact", head: true })
        .in("conversation_id", [...convIdSet])
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

  // Ceník oprav (Zařízení a opravy) žije v DB. Dřív se tu četl jednou při
  // startu z localStorage, kam ho zapisovala jen stará verze stránky
  // Zařízení – v čistém prohlížeči byl proto katalog v zakázkách prázdný
  // („Vybrat z katalogu“ nic nenabídlo). Teď se načte z DB a při změně
  // ceníku se obnoví.
  const [devicesData, setDevicesData] = useState<DevicesData>(() => safeLoadDevicesData());
  useEffect(() => {
    if (!activeServiceId) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const load = async () => {
      const res = await loadDevicesFromDb(activeServiceId);
      if (cancelled || res.error) return;
      setDevicesData(res.data);
    };
    const scheduleReload = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => { void load(); }, 800);
    };
    void load();
    const channel = supabase
      ? supabase
          .channel(`orders-devices:${activeServiceId}`)
          .on("postgres_changes", { event: "*", schema: "public", table: "device_repairs", filter: `service_id=eq.${activeServiceId}` }, scheduleReload)
          .on("postgres_changes", { event: "*", schema: "public", table: "device_models", filter: `service_id=eq.${activeServiceId}` }, scheduleReload)
          .subscribe()
      : null;
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
      if (channel && supabase) void supabase.removeChannel(channel);
    };
  }, [activeServiceId]);
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

  useEffect(() => {
    try {
      localStorage.setItem(NEW_ORDER_MORE_OPEN_KEY, newOrderMoreOpen ? "1" : "0");
    } catch {
      // ignore
    }
  }, [newOrderMoreOpen]);

  /**
   * Našeptávač zákazníků v nové zakázce: jméno, telefon, e-mail nebo firma.
   * Vrací i adresu a poznámku, aby výběr vyplnil celý blok bez dalšího dotazu.
   */
  const searchCustomers = useCallback(async (q: string): Promise<CustomerMatch[]> => {
    if (!supabase || !activeServiceId) return [];
    const safe = q.replace(/[,()*%\\]/g, " ").trim();
    if (safe.length < 2) return [];
    const digits = q.replace(/\D/g, "");
    const ors = [
      `name.ilike.*${safe}*`,
      `email.ilike.*${safe}*`,
      `company.ilike.*${safe}*`,
      `phone.ilike.*${safe}*`,
    ];
    if (digits.length >= 3) {
      ors.push(`phone_norm.ilike.*${digits}*`);
      ors.push(`phone.ilike.*${digits}*`);
    }
    const { data, error } = await (supabase.from("customers") as any)
      .select("id,name,phone,email,company,ico,address_street,address_city,address_zip,note")
      .eq("service_id", activeServiceId)
      .or(ors.join(","))
      .order("name", { ascending: true })
      .limit(16);
    if (error || !Array.isArray(data)) return [];
    // „Jan“ má nabídnout Jana Nováka dřív než Aramise Tochjana: nejdřív
    // shoda na začátku jména, pak na začátku slova, pak zbytek.
    const fold = (v: string) => v.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
    const needle = fold(safe);
    const rank = (c: any) => {
      const name = fold(String(c.name || ""));
      if (name.startsWith(needle)) return 0;
      if (name.split(/\s+/).some((w) => w.startsWith(needle))) return 1;
      if (fold(String(c.company || "")).startsWith(needle)) return 2;
      return 3;
    };
    data.sort((a: any, b: any) => rank(a) - rank(b));
    return data.slice(0, 8).map((c: any) => ({
      id: String(c.id),
      name: c.name || "",
      phone: c.phone || null,
      email: c.email || null,
      company: c.company || null,
      city: c.address_city || null,
      // navíc pro vyplnění formuláře
      ico: c.ico || null,
      address_street: c.address_street || null,
      address_zip: c.address_zip || null,
      note: c.note || null,
    }));
  }, [supabase, activeServiceId]);

  /** Výběr zákazníka z našeptávače – vyplní celý blok a nastaví customerId. */
  const applyCustomerMatch = useCallback((m: CustomerMatch & { ico?: string | null; address_street?: string | null; address_zip?: string | null; note?: string | null }) => {
    setNewDraft((prev) => ({
      ...prev,
      customerId: m.id,
      customerName: m.name || "",
      customerPhone: m.phone || "",
      customerEmail: m.email || "",
      addressStreet: m.address_street || "",
      addressCity: m.city || "",
      addressZip: (m.address_zip || "").replace(/\D/g, ""),
      company: m.company || "",
      ico: (m.ico || "").replace(/\D/g, ""),
      customerInfo: m.note || "",
    }));
    setCustomerMatchDecision("accepted");
    setMatchedCustomer(null);
    lastLookupPhoneNormRef.current = normalizePhone(m.phone || "") ?? null;
    if (phoneLookupDebounceTimerRef.current) {
      clearTimeout(phoneLookupDebounceTimerRef.current);
      phoneLookupDebounceTimerRef.current = null;
    }
  }, []);

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
    const qDigits = q.replace(/\D/g, "");

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
        // Telefon se porovnává i po číslicích, aby „777123“ našlo „+420 777 123 456“.
        const phoneDigits = (t.customerPhone ?? "").replace(/\D/g, "");
        return (
          t.code.toLowerCase().includes(q) ||
          t.customerName.toLowerCase().includes(q) ||
          (t.customerPhone ?? "").toLowerCase().includes(q) ||
          (qDigits.length >= 3 && phoneDigits.includes(qDigits)) ||
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

  /** Reklamace podle aktivní pobočky – stejné pravidlo jako u zakázek (bez pobočky = vidět všude). */
  const claimsInBranch = useMemo(
    () => (activeBranchId ? cloudClaims.filter((c) => !(c as any).branch_id || (c as any).branch_id === activeBranchId) : cloudClaims),
    [cloudClaims, activeBranchId],
  );
  const filteredClaims = useMemo(() => {
    const q = query.trim().toLowerCase();
    const base = !q
      ? claimsInBranch
      : claimsInBranch.filter(
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
  }, [claimsInBranch, query]);

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

  /** Počty do přepínače skupin – stejná pravidla jako seznam, jen bez textového hledání. */
  const groupCounts = useMemo(() => {
    let active = 0;
    let final = 0;
    let all = 0;
    for (const t of tickets) {
      const raw = (t.status as any) ?? statusById[t.id];
      const st = normalizeStatus(raw);
      if (showSecondaryFiltersRow && activeStatusKey && st !== null && st !== activeStatusKey) continue;
      all += 1;
      if (st === null || !isFinal(st)) active += 1;
      else final += 1;
    }
    if (ordersShowClaimsInList) {
      for (const c of claimsInBranch) {
        const st = normalizeStatus((c.status as string) ?? "");
        all += 1;
        if (st === null || !isFinal(st)) active += 1;
        else final += 1;
      }
    }
    return { all, active, final, reklamace: claimsInBranch.length };
  }, [tickets, statusById, normalizeStatus, isFinal, showSecondaryFiltersRow, activeStatusKey, ordersShowClaimsInList, claimsInBranch]);

  const groupLabel = (label: string, count: number) => (
    <>
      {label}
      <span style={{ marginLeft: 6, fontSize: "var(--text-xs)", color: "var(--muted)", fontWeight: 600 }}>{count}</span>
    </>
  );

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

  /** Zakázky, u kterých má smysl načíst SMS badge (shodné s tím, co je ve výpisu) */
  const ticketsForSmsUnread = useMemo(() => {
    if (activeGroup === "reklamace") return [];
    const mode = uiCfg.orders.displayMode;
    if (mode === "status-grouped") {
      if (showClaimsInOrdersList) {
        return paginatedCombined.filter((r) => r.type === "ticket").map((r) => r.data);
      }
      return filtered;
    }
    return paginatedTickets;
  }, [
    activeGroup,
    uiCfg.orders.displayMode,
    showClaimsInOrdersList,
    paginatedCombined,
    filtered,
    paginatedTickets,
  ]);

  // Realtime: po příchozí SMS nebo označení přečteného přepočíst badge u řádků
  useEffect(() => {
    const client = getTypedSupabaseClient();
    if (!smsAvailable || !activeServiceId || !client) return;
    const topic = `orders_sms_unread_rt:${activeServiceId}`;
    const channel = client
      .channel(topic)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "sms_messages" },
        (payload) => {
          if ((payload.new as { direction?: string })?.direction === "inbound") {
            setSmsUnreadListBump((n) => n + 1);
          }
        }
      )
      .subscribe();
    return () => {
      client.removeChannel(channel);
    };
  }, [smsAvailable, activeServiceId]);

  /**
   * Klíč z obsahu, ne z identity pole.
   *
   * ticketsForSmsUnread je nové pole při každém renderu, takže efekt níž se
   * spouštěl při každém úhozu ve vyhledávání – naměřeno 6 úhozů = 15 dotazů
   * do Supabase, i když se seznam zakázek vůbec nezměnil.
   */
  const smsUnreadKey = useMemo(
    () => ticketsForSmsUnread.map((t) => `${t.id}|${normalizePhone(t.customerPhone) ?? ""}`).join(","),
    [ticketsForSmsUnread]
  );
  const ticketsForSmsUnreadRef = useRef(ticketsForSmsUnread);
  ticketsForSmsUnreadRef.current = ticketsForSmsUnread;

  // SMS unread per řádek: konverzace podle ticket_id nebo stejného telefonu jako u detailu
  useEffect(() => {
    const client = getTypedSupabaseClient();
    const ticketRowsAll = ticketsForSmsUnreadRef.current;
    if (!smsAvailable || !activeServiceId || !client || ticketRowsAll.length === 0) {
      // Nový prázdný objekt by byl pokaždé jiná reference a vynutil další render.
      setSmsUnreadByTicketId((prev) => (Object.keys(prev).length === 0 ? prev : {}));
      return;
    }
    const ticketRows = ticketRowsAll;
    const ticketIds = ticketRows.map((t) => t.id);
    const idSet = new Set(ticketIds);
    const chunk = 180;
    let cancelled = false;
    // Rychlé psaní jinak spustí dotaz na každý mezistav.
    const timer = setTimeout(() => {
    (async () => {
      const convsByTicket: { id: string; ticket_id: string | null; customer_phone: string }[] = [];
      for (let i = 0; i < ticketIds.length; i += chunk) {
        const { data } = await client
          .from("sms_conversations")
          .select("id, ticket_id, customer_phone")
          .eq("service_id", activeServiceId)
          .in("ticket_id", ticketIds.slice(i, i + chunk));
        convsByTicket.push(...((data ?? []) as typeof convsByTicket));
      }
      const phones = [
        ...new Set(ticketRows.map((t) => normalizePhone(t.customerPhone)).filter((p): p is string => !!p)),
      ];
      const convsByPhone: { id: string; ticket_id: string | null; customer_phone: string }[] = [];
      for (let i = 0; i < phones.length; i += chunk) {
        const { data } = await client
          .from("sms_conversations")
          .select("id, ticket_id, customer_phone")
          .eq("service_id", activeServiceId)
          .in("customer_phone", phones.slice(i, i + chunk));
        for (const row of data ?? []) {
          convsByPhone.push(row as (typeof convsByPhone)[number]);
        }
      }
      const convMap = new Map<string, { id: string; ticket_id: string | null; customer_phone: string }>();
      for (const c of [...convsByTicket, ...convsByPhone]) {
        convMap.set(c.id, c);
      }
      const convIds = [...convMap.keys()];
      if (convIds.length === 0) {
        if (!cancelled) setSmsUnreadByTicketId((prev) => (Object.keys(prev).length === 0 ? prev : {}));
        return;
      }
      const countByConv: Record<string, number> = {};
      for (let i = 0; i < convIds.length; i += chunk) {
        const slice = convIds.slice(i, i + chunk);
        const { data: messages } = await client
          .from("sms_messages")
          .select("conversation_id")
          .in("conversation_id", slice)
          .eq("direction", "inbound")
          .is("read_at", null);
        if (cancelled) return;
        (messages ?? []).forEach((m) => {
          countByConv[m.conversation_id] = (countByConv[m.conversation_id] ?? 0) + 1;
        });
      }
      const phonesMatch = (a: string | null | undefined, b: string | null | undefined) => {
        const na = normalizePhone(a);
        const nb = normalizePhone(b);
        if (na && nb && na === nb) return true;
        const da = String(a ?? "").replace(/\D/g, "");
        const db = String(b ?? "").replace(/\D/g, "");
        return da.length >= 9 && db.length >= 9 && da.slice(-9) === db.slice(-9);
      };
      const byTicket: Record<string, number> = {};
      for (const [cid, n] of Object.entries(countByConv)) {
        const conv = convMap.get(cid);
        if (!conv) continue;
        if (conv.ticket_id && idSet.has(conv.ticket_id)) {
          byTicket[conv.ticket_id] = (byTicket[conv.ticket_id] ?? 0) + n;
        } else {
          for (const t of ticketRows) {
            if (phonesMatch(t.customerPhone, conv.customer_phone)) {
              byTicket[t.id] = (byTicket[t.id] ?? 0) + n;
            }
          }
        }
      }
      if (!cancelled) setSmsUnreadByTicketId(byTicket);
    })();
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [smsAvailable, activeServiceId, smsUnreadKey, smsUnreadListBump]);

  useEffect(() => {
    setOrdersPage(0);
  }, [query, activeStatusKey, activeGroup, claimsSubGroup]);

  useEffect(() => {
    setOrdersPage(0);
  }, [pageSize]);

  useEffect(() => {
    if (ordersPage >= totalOrdersPages && totalOrdersPages > 0) setOrdersPage(totalOrdersPages - 1);
  }, [ordersPage, totalOrdersPages]);

  /**
   * Otevřený detail se hledá v NEfiltrovaném seznamu.
   *
   * Kdyby se hledal v `tickets` (filtrované podle pobočky), zmizela by
   * zakázka ze seznamu ve chvíli, kdy ji přesunu na jinou pobočku – a
   * z detailu by zbylo prázdné okno s pomlčkami a tlačítkem Upravit.
   */
  const detailedTicket: TicketEx | undefined = useMemo(
    () => (detailId ? cloudTickets.find((t) => t.id === detailId) : undefined),
    [detailId, cloudTickets]
  );

  // After detailedTicket exists: sync ref so SMS OS notifications skip this thread when panel is open
  useEffect(() => {
    if (smsPanelOpen && detailId && detailedTicket?.customerPhone?.trim()) {
      smsDoNotNotifyRef.panelTicketId = detailId;
      smsDoNotNotifyRef.panelCustomerPhoneNorm = normalizePhone(detailedTicket.customerPhone) ?? null;
    } else {
      smsDoNotNotifyRef.panelTicketId = null;
      smsDoNotNotifyRef.panelCustomerPhoneNorm = null;
    }
    return () => {
      smsDoNotNotifyRef.panelTicketId = null;
      smsDoNotNotifyRef.panelCustomerPhoneNorm = null;
    };
  }, [smsPanelOpen, detailId, detailedTicket?.customerPhone]);

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

  /** Opravy z ceníku pro zařízení podle názvu – stejné párování pro detail i pro příjem. */
  const repairsForDeviceLabel = useCallback(
    (label: string | undefined | null): DeviceRepair[] => {
      const trimmed = (label || "").trim();
      if (!trimmed) return [];
      if (!devicesData || !Array.isArray(devicesData.models) || !Array.isArray(devicesData.repairs)) return [];
      const deviceName = trimmed.toLowerCase();
      const matchingModels = devicesData.models.filter(
        (m) => m && m.name && (m.name.toLowerCase().includes(deviceName) || deviceName.includes(m.name.toLowerCase()))
      );
      const modelIds = matchingModels.map((m) => m.id).filter(Boolean);
      if (modelIds.length === 0) return [];
      return devicesData.repairs.filter((r) => r && r.modelIds && r.modelIds.some((mid: string) => modelIds.includes(mid)));
    },
    [devicesData]
  );

  const availableRepairs = useMemo(
    () => repairsForDeviceLabel(detailedTicket?.deviceLabel),
    [detailedTicket?.deviceLabel, repairsForDeviceLabel]
  );

  /** Přepne opravu z ceníku u zařízení v nové zakázce: text požadované opravy, seznam oprav i předschválenou cenu. */
  const togglePlannedRepair = useCallback((idx: number, repair: DeviceRepair) => {
    setNewDraft((p) => ({
      ...p,
      devices: p.devices.map((d, i) => {
        if (i !== idx) return d;
        const planned = d.plannedRepairs ?? [];
        const has = planned.some((r) => r.repairId === repair.id);
        const nextPlanned = has
          ? planned.filter((r) => r.repairId !== repair.id)
          : [
              ...planned,
              {
                id: `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
                name: repair.name,
                type: "selected" as const,
                repairId: repair.id,
                price: repair.price,
                costs: repair.costs,
                estimatedTime: repair.estimatedTime,
                productIds: repair.productIds,
              },
            ];
        const oldSum = planned.reduce((a, r) => a + (r.price || 0), 0);
        const newSum = nextPlanned.reduce((a, r) => a + (r.price || 0), 0);
        // Text požadované opravy: jména z ceníku oddělená čárkou, ruční text zůstává.
        const parts = (d.requestedRepair || "").split(",").map((x) => x.trim()).filter(Boolean);
        const nextParts = has ? parts.filter((x) => x !== repair.name) : parts.includes(repair.name) ? parts : [...parts, repair.name];
        // Předschválenou cenu přepisujeme jen dokud ji uživatel nezadal ručně.
        const priceUntouched = d.estimatedPrice === undefined || d.estimatedPrice === oldSum;
        return {
          ...d,
          plannedRepairs: nextPlanned,
          requestedRepair: nextParts.join(", "),
          estimatedPrice: priceUntouched ? (newSum > 0 ? newSum : undefined) : d.estimatedPrice,
        };
      }),
    }));
  }, []);

  /**
   * Zákazník schválil nabídku – její položky se stanou provedenými opravami.
   * Nahrazují se, ne přidávají: schválený rozpis je to, na čem se obě strany
   * dohodly, a dvojitý zápis by se objevil na faktuře.
   *
   * Zapisuje se rovnou do databáze, ne přes běžné automatické ukládání, které
   * čeká na zavření detailu. Uživatel klikl na jednu akci a dostal hlášku, že
   * je hotovo – to musí platit i když hned zavře okno.
   */
  const applyQuoteRepairs = useCallback(
    async (ticketId: string, repairs: PerformedRepair[]) => {
      setCloudTickets((prev) =>
        prev.map((t) => (t.id === ticketId ? { ...t, performedRepairs: repairs } : t))
      );
      if (!supabase) {
        setDirtyFlags((prev) => ({ ...prev, performedRepairs: true }));
        return;
      }
      const { error } = await (supabase.from("tickets") as any)
        .update({ performed_repairs: repairs })
        .eq("id", ticketId);
      if (error) {
        // Zůstane rozpracované – uloží se při zavření detailu jako každá jiná změna.
        setDirtyFlags((prev) => ({ ...prev, performedRepairs: true }));
        throw error;
      }
    },
    []
  );

  const addPerformedRepair = useCallback(
    (ticketId: string, repair: { name: string; type: "selected" | "manual"; repairId?: string }) => {
      // Mark performed repairs as dirty
      setDirtyFlags((prev) => ({ ...prev, performedRepairs: true }));
      // Oprava z ceníku: cena, náklady, čas a navázané produkty (díly).
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
      }

      const entryId = `${Date.now()}_${Math.random()}`;

      // Díly se rezervují ve skladu (DB); ze skladu se odečtou až v koncovém stavu zakázky.
      if (repairProductIds && repairProductIds.length > 0) {
        void reserveEntryProducts(ticketId, entryId, repairProductIds).then((res) => {
          if (res) toastReserveShortages(res.shortages);
        });
      }

      setCloudTickets((prev) =>
        prev.map((t) => {
          if (t.id !== ticketId) return t;
          const newRepair: PerformedRepair = {
            id: entryId,
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
    [devicesData, reserveEntryProducts, toastReserveShortages]
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
    // Odebraná oprava už díly nedrží – rezervace se uvolní (tiché, když RPC chybí).
    void releaseReservations(ticketId, repairId).then((released) => {
      if (released) void refreshTicketReservations(ticketId);
    });
  }, [refreshTicketReservations]);

  const border = "1px solid var(--border)";
  const borderError = "1px solid rgba(239,68,68,0.9)";

  const inputStyle: React.CSSProperties = useMemo(
    () => ({
      // 360 px byla pevná šířka – na 375px displeji přetékala ven.
      // Takhle zůstává na desktopu stejná a na mobilu se smrští.
      width: 360,
      maxWidth: "100%",
      minWidth: 0,
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





  const fieldLabel: React.CSSProperties = useMemo(() => ({ fontSize: 12, color: "var(--muted)", marginTop: 10 }), []);
  const fieldHint: React.CSSProperties = useMemo(() => ({ fontSize: 12, marginTop: 6, color: "rgba(239,68,68,0.95)" }), []);
  /** Vysvětlivka pod polem (12 px, tlumená) – místo dlouhých popisků nad polem. */
  const fieldMuted: React.CSSProperties = useMemo(() => ({ fontSize: 12, marginTop: 6, color: "var(--muted)" }), []);
  /** Drobný podnadpis skupiny polí v sekci „Další údaje“. */
  const subHeading: React.CSSProperties = useMemo(
    () => ({ fontSize: 11, fontWeight: 800, color: "var(--muted)", textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 6 }),
    []
  );

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

        // Koncový stav: rezervované díly se odečtou ze skladu. Zpět z koncového
        // stavu se nic nevrací – odečtené zůstává odečtené.
        if (isFinal(next)) {
          void consumeTicketReservations(ticketId).then((res) => {
            if (!res) return;
            if (res.shortages.length > 0) {
              const chybelo = res.shortages.map((s) => `${s.name} ×${s.missing}`).join(", ");
              showToast(`Odečteno ze skladu, chybělo: ${chybelo}`, "info");
            }
            if (res.consumed > 0) void refreshTicketReservations(ticketId);
          });
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
        // Automatizace (stavebnice pravidel) – na pozadí, po úspěšné změně stavu.
        if (ticketUpdated && activeServiceId) {
          const tu = ticketUpdated as TicketEx;
          const sid = activeServiceId;
          void runStatusChangeAutomations({
            serviceId: sid,
            ticketId,
            statusKey: next,
            statusLabel: statuses.find((s) => s.key === next)?.label ?? next,
            ticket: tu,
            totalPrice: computeFinalPrice(toCardData(tu as (typeof filtered)[number])),
            resolvePortalUrl: async () => portalUrl(tu.portalToken || (await ensurePortalToken(ticketId))),
            hasRules: hasAutomationRulesFor(next),
          });
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
          showToast("Nemáte oprávnění měnit status zakázky", "error");
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
      // Otevřená nabídka (našeptávač, stavy, Tisk, ⋯) si Escape zpracuje sama – nezavírat kvůli ní celé okno.
      if (document.querySelector('[role="listbox"], [role="menu"]')) return;
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
    return registerShortcut("order_print", () => printTicket(detailedTicket, activeServiceId), { priority: 20 });
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
    detailIdRef.current = detailId;
    isEditingRef.current = isEditing;
  });

  /**
   * Zkratky stránky Zakázky. Priorita 10 – přebijí globální navigaci, ale jen
   * dokud je stránka vidět (App drží Orders namountované i skryté).
   */
  useEffect(() => {
    const naStrance = () => !closeDetailWhen;
    const offs = [
      registerShortcut("orders_search", () => searchInputRef.current?.focus(), {
        priority: 10,
        allowInInput: true,
        enabled: naStrance,
      }),
      registerShortcut("orders_new", () => openNewOrderRef.current(), { priority: 10, enabled: naStrance }),
      registerShortcut("order_detail_edit", () => startEditingRef.current(), {
        priority: 10,
        enabled: () => naStrance() && !!detailIdRef.current && !isEditingRef.current,
      }),
      registerShortcut("order_detail_save", () => saveTicketChangesRef.current(), {
        priority: 10,
        allowInInput: true,
        enabled: () => naStrance() && !!detailIdRef.current && isEditingRef.current,
      }),
    ];
    return () => { for (const off of offs) off(); };
  }, [closeDetailWhen]);

  const errors = useMemo(() => {
    const e: Record<string, string> = {};
    newDraft.devices.forEach((dev, i) => {
      if (!dev.deviceLabel.trim()) e[`deviceLabel_${i}`] = "Vyplňte zařízení.";
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

  /** Krátký důvod, proč nejde vytvořit – k tlačítku v patičce. */
  const createBlockedReason = useMemo(() => {
    const keys = Object.keys(errors);
    if (keys.length === 0) return null;
    if (keys.some((k) => k.startsWith("deviceLabel_"))) return "Chybí zařízení";
    if (errors.customerPhone) return errors.customerPhone === "Telefon je povinný." ? "Chybí telefon" : "Neplatný telefon";
    if (errors.customerEmail) return "Neplatný e-mail";
    if (errors.addressZip) return "Neplatné PSČ";
    if (errors.ico) return "Neplatné IČO";
    return "Zkontrolujte vyplněné údaje";
  }, [errors]);

  /**
   * Při pokusu o vytvoření s chybami: rozbalí, co je třeba, a přesune fokus
   * do prvního chybného pole. Pořadí odpovídá pořadí polí ve formuláři.
   */
  const focusFirstInvalidField = () => {
    const deviceIdx = newDraft.devices.findIndex((_, i) => !!errors[`deviceLabel_${i}`]);
    let selector: string | null = null;
    let needsMore = false;
    if (errors.customerPhone) selector = "#new-order-phone";
    else if (deviceIdx >= 0) {
      setExpandedDeviceIdx(deviceIdx);
      selector = `#new-order-device-${deviceIdx} input`;
    } else if (errors.customerEmail) { selector = "#new-order-email"; needsMore = true; }
    else if (errors.addressZip) { selector = "#new-order-zip"; needsMore = true; }
    else if (errors.ico) { selector = "#new-order-ico"; needsMore = true; }
    if (!selector) return;
    if (needsMore) setNewOrderMoreOpen(true);
    const sel = selector;
    window.setTimeout(() => {
      const root = newOrderBodyRef.current ?? document;
      const el = root.querySelector<HTMLElement>(sel);
      if (el) {
        el.focus();
        el.scrollIntoView({ block: "center", behavior: "smooth" });
      }
    }, 60);
  };

  const createTicket = () => {
    setSubmitAttempted(true);
    if (!canCreate) {
      focusFirstInvalidField();
      return;
    }

    const chosenBranch = branchById(newDraft.branchId) ?? branchForNew;
    createTicketAction({
      newDraft,
      branch: chosenBranch ? { id: chosenBranch.id, code: chosenBranch.code } : null,
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
        if (activeServiceId) {
          for (const t of tickets) void runTicketCreatedAutomations(activeServiceId, t.id);
        }
        // Opravy vybrané už při příjmu: díly se rezervují po vzniku zakázky.
        void (async () => {
          const shortages = new Map<string, ReserveShortage>();
          for (const t of tickets) {
            for (const r of t.performedRepairs ?? []) {
              if (!r.productIds || r.productIds.length === 0) continue;
              const res = await reserveEntryProducts(t.id, r.id, r.productIds);
              for (const s of res?.shortages ?? []) shortages.set(s.productId, s);
            }
          }
          toastReserveShortages(Array.from(shortages.values()));
        })();
      },
    });
  };

  createTicketRef.current = createTicket;

  /** Tisk / export dokumentu „Přijetí reklamace“ z hlavičky detailu reklamace. */
  const runClaimDocument = async (action: DocMode) => {
    if (!detailedClaim) return;
    const sid = activeServiceId ?? undefined;
    if (!sid) {
      showToast("Vyberte servis pro tisk.", "error");
      return;
    }
    const original = cloudTickets.find((t) => t.id === detailedClaim.source_ticket_id) as TicketEx | undefined;
    const data = claimDocumentData(detailedClaim, safeLoadCompanyData(), original?.code ?? "");
    if (isWeb()) {
      await runWebDocument(action, "prijemka_reklamace", sid, data);
      return;
    }
    await runDesktopDocument(action, "prijemka_reklamace", sid, data, `prijemka-reklamace-${detailedClaim.code}.pdf`);
  };

  /** Zavře okno Nová zakázka; rozpracované údaje zůstávají uložené. */
  const closeNewOrder = () => {
    setIsNewOpen(false);
    setCustomerMatchDecision("undecided");
    setMatchedCustomer(null);
    lastLookupPhoneNormRef.current = null;
    if (phoneLookupDebounceTimerRef.current) {
      clearTimeout(phoneLookupDebounceTimerRef.current);
      phoneLookupDebounceTimerRef.current = null;
    }
  };

  /** Zruší rozpracovanou zakázku – zahodí koncept i přijímací fotky. */
  const discardNewOrder = () => {
    draftCaptureTokenRef.current = null;
    setDraftCapturePreviewUrls([]);
    setDraftCaptureLiveCount(0);
    setNewDraft(defaultDraft());
    safeSaveDraft(null);
    window.dispatchEvent(new CustomEvent("jobsheet:draft-count", { detail: { count: 0 } }));
    setExpandedDeviceIdx(0);
    closeNewOrder();
  };

  // ⌘/Ctrl+Enter v okně Nová zakázka = Vytvořit zakázku
  useEffect(() => {
    if (!isNewOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Enter" || !(e.metaKey || e.ctrlKey)) return;
      e.preventDefault();
      createTicketRef.current();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [isNewOpen]);

  // Nově přidané zařízení je rozbalené; po smazání drží index v mezích.
  useEffect(() => {
    setExpandedDeviceIdx((idx) => Math.min(idx, Math.max(0, newDraft.devices.length - 1)));
  }, [newDraft.devices.length]);

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
    const all = (commentsByTicket[ticketId] ?? []).slice();

    all.sort((a, b) => {
      const ap = !!a.pinned;
      const bp = !!b.pinned;
      if (ap !== bp) return ap ? -1 : 1;
      return (a.createdAt ?? "").localeCompare(b.createdAt ?? "");
    });

    return all;
  };

  const addComment = async (ticketId: string) => {
    const text = (commentDraftByTicket[ticketId] ?? "").trim();
    if (!text || !supabase || !activeServiceId) return;

    const displayName = userProfile?.nickname?.trim() || session?.user?.email?.split("@")[0] || "Servis";
    const payload = {
      ticket_id: ticketId,
      service_id: activeServiceId,
      author: displayName,
      author_id: session?.user?.id ?? null,
      author_nickname: userProfile?.nickname?.trim() || null,
      author_avatar_url: userProfile?.avatarUrl?.trim() || null,
      content: text,
      pinned: false,
    };

    setCommentDraftByTicket((p) => ({ ...p, [ticketId]: "" }));

    const { data, error } = await (supabase.from("ticket_comments") as any)
      .insert(payload)
      .select("id,ticket_id,author,author_id,author_nickname,author_avatar_url,content,pinned,created_at")
      .single();

    if (error || !data) {
      console.error("[Orders] Error adding comment:", error);
      showToast("Nepodařilo se uložit komentář.", "error");
      setCommentDraftByTicket((p) => ({ ...p, [ticketId]: text }));
      return;
    }

    const c = mapSupabaseCommentRow(data as SupabaseTicketCommentRow);
    setCommentsByTicket((p) => ({ ...p, [ticketId]: [...(p[ticketId] ?? []), c] }));
  };

  const editComment = async (ticketId: string, commentId: string, text: string) => {
    if (!supabase) return;
    const prev = commentsByTicket[ticketId]?.find((c) => c.id === commentId);
    if (!prev || prev.text === text) return;
    setCommentsByTicket((p) => ({
      ...p,
      [ticketId]: (p[ticketId] ?? []).map((c) => (c.id === commentId ? { ...c, text } : c)),
    }));
    const { error } = await (supabase.from("ticket_comments") as any).update({ content: text }).eq("id", commentId);
    if (error) {
      setCommentsByTicket((p) => ({
        ...p,
        [ticketId]: (p[ticketId] ?? []).map((c) => (c.id === commentId ? { ...c, text: prev.text } : c)),
      }));
      reportError({ code: "orders.comment_edit_failed", error, userMessage: "Komentář se nepodařilo upravit.", source: "Orders.editComment", serviceId: activeServiceId });
    }
  };

  // Fotky a přezdívky autorů komentářů z aktuálních profilů (komentář má
  // jen snímek z doby uložení – kdo si fotku přidal později, byl bez ní).
  const commentAuthorIdsKey = useMemo(() => {
    const ids = new Set<string>();
    for (const list of Object.values(commentsByTicket)) for (const c of list) if (c.author_id) ids.add(c.author_id);
    return [...ids].sort().join(",");
  }, [commentsByTicket]);
  useEffect(() => {
    if (!supabase || !commentAuthorIdsKey) return;
    const ids = commentAuthorIdsKey.split(",");
    let cancelled = false;
    (async () => {
      const { data, error } = await (supabase.from("profiles") as any).select("id, nickname, avatar_url").in("id", ids);
      if (cancelled || error || !Array.isArray(data)) return;
      const map: Record<string, { nickname: string | null; avatarUrl: string | null }> = {};
      for (const p of data) map[p.id] = { nickname: p.nickname ?? null, avatarUrl: p.avatar_url ?? null };
      setCommentAuthorProfiles(map);
    })();
    return () => { cancelled = true; };
  }, [commentAuthorIdsKey]);

  const togglePin = async (ticketId: string, commentId: string) => {
    if (!supabase) return;
    const current = commentsByTicket[ticketId]?.find((c) => c.id === commentId);
    const nextPinned = !current?.pinned;

    setCommentsByTicket((p) => ({
      ...p,
      [ticketId]: (p[ticketId] ?? []).map((c) => (c.id === commentId ? { ...c, pinned: nextPinned } : c)),
    }));

    const { error } = await (supabase.from("ticket_comments") as any).update({ pinned: nextPinned }).eq("id", commentId);
    if (error) {
      console.error("[Orders] Error toggling comment pin:", error);
      setCommentsByTicket((p) => ({
        ...p,
        [ticketId]: (p[ticketId] ?? []).map((c) => (c.id === commentId ? { ...c, pinned: !nextPinned } : c)),
      }));
    }
  };

  const handleCommentDraftChange = useCallback((ticketId: string, value: string) => {
    setCommentDraftByTicket((p) => ({ ...p, [ticketId]: value }));
  }, []);

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
      return <StatusPicker value={currentStatus} statuses={statuses as any} getByKey={getByKey as any} onChange={(next) => setTicketStatus(ticketId, next)} size="sm" actionsByStatus={statusActionsMap} />;
    }
    return <div style={{ fontSize: 11, padding: "4px 8px", borderRadius: 6, background: "var(--panel-2)", color: "var(--muted)", fontWeight: 600 }}>…</div>;
  }, [statuses, getByKey, setTicketStatus, statusActionsMap]);

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
      ><PrintIcon size={small ? 13 : 15} /></button>
    );
  }, [canPrintExport, setOpenQuickPrintTicket]);

  const smsUnreadForTicket = (ticketId: string) => {
    if (smsPanelOpen && detailId === ticketId) return 0;
    return smsUnreadByTicketId[ticketId] ?? 0;
  };

  const smsUnreadByTicketIdDisplay = useMemo(() => {
    const o = { ...smsUnreadByTicketId };
    if (smsPanelOpen && detailId) o[detailId] = 0;
    return o;
  }, [smsUnreadByTicketId, smsPanelOpen, detailId]);

  const smsBadge = (ticketId: string) => {
    const n = smsUnreadForTicket(ticketId);
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
    const viewers = viewersByTicket[t.id];
    const statusNode = viewers && viewers.length > 0 ? (
      <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
        <PresenceAvatars viewers={viewers} size={18} />
        {renderStatusPicker(t.id, currentStatus)}
      </span>
    ) : renderStatusPicker(t.id, currentStatus);
    const metaOrNull = meta ?? null;
    const wrap = (node: React.ReactNode) =>
      smsUnreadForTicket(t.id) > 0 ? (
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
      case "stripe":
        return wrap(<TicketCardStripe ticket={cardData} meta={metaOrNull} onClick={onClick} statusPicker={statusNode} printButton={renderPrintButton(cardData, true)} />);
      case "list":
      default:
        return wrap(<TicketCardList ticket={cardData} meta={metaOrNull} onClick={onClick} statusPicker={statusNode} printButton={renderPrintButton(cardData, true)} zvyrazneni={uiCfg.orders.zvyrazneniStavu} />);
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
      {/* První kroky nového servisu – jen pro majitele a správce, sám zmizí. */}
      {activeServiceId && isAdmin && (
        <OnboardingChecklist activeServiceId={activeServiceId} ticketCount={cloudTickets.length} />
      )}
      {/* Header */}
      <div>
        <div style={{ fontSize: 22, fontWeight: 950, color: "var(--text)" }}>Zakázky</div>
      </div>

      {/* Toolbar */}
      <div style={{ display: "flex", justifyContent: "space-between", gap: 16, alignItems: "flex-start", flexWrap: "wrap" }}>
        <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap", flex: 1, minWidth: 0 }}>
          <input ref={searchInputRef} data-tour="orders-search" placeholder="Vyhledávání…" value={query} onChange={(e) => setQuery(e.target.value)} style={inputStyle} />
          <Button variant="primary" data-tour="orders-new-btn" onClick={openNewOrder}>
            + Nová zakázka
          </Button>
          <Button variant="primary"
            data-tour="orders-new-claim-btn"
            onClick={() => setCreateClaimModalOpen(true)}
          >
            + Nová reklamace
          </Button>
        </div>
      </div>

      {/* Group tabs */}
      <div data-tour="orders-groups">
        <Segmented<GroupKey>
          dataTour="orders-filters"
          ariaLabel="Filtr zakázek"
          value={activeGroup}
          onChange={setActiveGroup}
          options={[
            { value: "all", label: groupLabel("Vše", groupCounts.all) },
            { value: "active", label: groupLabel("Aktivní", groupCounts.active) },
            { value: "final", label: groupLabel("Dokončené", groupCounts.final) },
            { value: "reklamace", label: groupLabel("Reklamace", groupCounts.reklamace) },
          ]}
        />
      </div>

      {/* Reklamace sub-filter: Aktivní / Final */}
      {activeGroup === "reklamace" && (
          <div data-tour="orders-claims-subfilter" style={{ marginTop: 10 }}>
            <Segmented<ClaimsSubGroup>
              size="sm"
              ariaLabel="Filtr reklamací"
              value={claimsSubGroup}
              onChange={setClaimsSubGroup}
              options={[
                { value: "all", label: "Vše" },
                { value: "active", label: "Aktivní" },
                { value: "final", label: "Dokončené" },
              ]}
            />
          </div>
      )}

      {/* Secondary quick status filters */}
      {showSecondaryFiltersRow && (
          <Segmented
            dataTour="orders-filters"
            ariaLabel="Filtr stavů"
            size="sm"
            value={activeStatusKey ?? ""}
            onChange={(key) => setActiveStatusKey(key === "" ? null : key)}
            options={[
              { value: "", label: "Všechny stavy" },
              ...quickStatuses.map((st) => ({ value: st.key, label: st.label, title: st.label })),
            ]}
          />
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
        ...(uiCfg.orders.displayMode === "timeline" || uiCfg.orders.displayMode === "status-grouped"
          ? { minWidth: 0 }
          : {
              display: "grid",
              gridTemplateColumns: uiCfg.orders.displayMode === "grid" ? "repeat(auto-fill, minmax(min(100%, 280px), 1fr))" : "minmax(min(100%, 260px), 1fr)",
              gap: uiCfg.orders.displayMode === "grid" ? 12 : uiCfg.orders.displayMode === "compact-extra" || uiCfg.orders.displayMode === "stripe" ? 2 : 6,
              minWidth: 0,
            }),
      }}>
        {/* Timeline a seskupení podle stavu: pohledy přes celý kontejner */}
        {activeGroup !== "reklamace" && uiCfg.orders.displayMode === "timeline" && (
          <TicketTimeline
            tickets={paginatedTickets.map(toCardData)}
            getByKey={getByKey as any}
            normalizeStatus={normalizeStatus}
            onClickDetail={(id) => { setDetailId(id); setDetailClaimId(null); }}
            smsUnreadByTicketId={smsUnreadByTicketIdDisplay}
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
              smsUnreadByTicketId={smsUnreadByTicketIdDisplay}
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
              smsUnreadByTicketId={smsUnreadByTicketIdDisplay}
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
        {activeGroup === "reklamace" && uiCfg.orders.displayMode !== "timeline" && uiCfg.orders.displayMode !== "status-grouped"
          ? paginatedClaims.map((c) => renderClaimCard(c))
          : uiCfg.orders.displayMode !== "timeline" && uiCfg.orders.displayMode !== "status-grouped" && showClaimsInOrdersList
            ? paginatedCombined.map((row) =>
                row.type === "claim"
                  ? renderClaimCard(row.data, "claim-")
                  : renderTicketCard(row.data)
              )
          : uiCfg.orders.displayMode !== "timeline" && uiCfg.orders.displayMode !== "status-grouped"
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
            <div style={{ fontSize: 48, opacity: 0.5 }}>{activeGroup === "reklamace" ? "—" : <DocumentIcon size={48} />}</div>
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

      {/* ===== Nová zakázka (portál do body, aby fixed byl vůči viewportu,
             ne vůči <main> s transformem – jinak si okno nechá přes sebe
             ležet spodní navigaci a plovoucí "+") ===== */}
      {createPortal(
        <>
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
          zIndex: 1140,
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
          maxHeight: "calc(100dvh / var(--ui-scale, 1) - 24px)",
          overflow: "auto",
          background: "var(--panel)",
          backdropFilter: "var(--blur)",
          WebkitBackdropFilter: "var(--blur)",
          border,
          borderRadius: "var(--radius-lg)",
          boxShadow: "var(--shadow)",
          /* Zdola bez odsazení: patička je lepivá a drží se dna posuvné
             oblasti, ale to dno bylo o 18 px níž než patička. V tom pruhu
             se pod tlačítky „Zrušit / Vytvořit zakázku" posouval formulář
             a byl vidět. Odsazení odspodu si patička dělá sama svým
             vlastním paddingem. */
          padding: "0 18px",
          zIndex: 1150,
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "center", position: "sticky", top: 0, left: 0, right: 0, zIndex: 3, background: "var(--panel)", margin: "0 -18px 0", padding: "18px 18px 12px", borderBottom: "1px solid var(--border)" }}>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontWeight: 950, fontSize: 16, color: "var(--text)" }}>Nová zakázka</div>
            {/* Hlavička je lepivá, takže tenhle popisek na telefonu ukrajoval
                řádky z každé obrazovky formuláře. Na širokém displeji zůstává. */}
            {!isNarrow && (
              <div style={{ color: "var(--muted)", fontSize: 12, marginTop: 4 }}>
                Stav se automaticky nastaví na <b>Přijato</b>.
              </div>
            )}
          </div>
          {hasBranches && (
            <select
              className="ui-input"
              aria-label="Pobočka nové zakázky"
              title="Pobočka – určí zkratku v čísle zakázky a údaje na dokumentech"
              value={newDraft.branchId ?? branchForNew?.id ?? ""}
              onChange={(e) => setNewDraft((p) => ({ ...p, branchId: e.target.value || null }))}
              style={{ width: "auto", maxWidth: 200, padding: "6px 10px", fontSize: 12, fontWeight: 600 }}
            >
              {branches.map((b) => (
                <option key={b.id} value={b.id}>{b.name}</option>
              ))}
            </select>
          )}
          <Button variant="soft" iconOnly icon={<XIcon size={16} />} aria-label="Zavřít" title="Zavřít (rozpracované údaje zůstanou uložené)" onClick={closeNewOrder} />
        </div>

        <div ref={newOrderBodyRef} style={{ marginTop: 14, display: "grid", gap: 14 }}>
          {/* ===== ZÁKAZNÍK – rychlá část ===== */}
          <div style={card}>
            <SectionHeading icon={<UserIcon size={16} />} size="sm">Zákazník</SectionHeading>
            <div style={{ display: "grid", gridTemplateColumns: isNarrow ? "1fr" : "1fr 1fr", gap: 10 }}>
              <div style={{ minWidth: 0 }}>
                <div style={{ ...fieldLabel, marginTop: 0 }}>Jméno</div>
                {newDraft.customerId ? (
                  <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "9px 12px", border: "1px solid var(--accent)", borderRadius: 12, background: "var(--accent-soft)", minHeight: 40 }}>
                    <span style={{ color: "var(--accent)", display: "inline-flex", flex: "0 0 auto" }}><UserIcon size={15} /></span>
                    <div style={{ flex: 1, minWidth: 0, fontSize: 13, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      <span style={{ fontWeight: 700 }}>{newDraft.customerName.trim() || "Bez jména"}</span>
                      {newDraft.customerPhone.trim() && <span style={{ color: "var(--muted)" }}> · {formatPhoneNumber(newDraft.customerPhone)}</span>}
                      {newDraft.customerEmail.trim() && <span style={{ color: "var(--muted)" }}> · {newDraft.customerEmail.trim()}</span>}
                    </div>
                    <button
                      type="button"
                      onClick={() => {
                        setNewDraft((p) => ({ ...p, customerId: undefined }));
                        setCustomerMatchDecision("undecided");
                        setMatchedCustomer(null);
                      }}
                      style={{ background: "none", border: "none", padding: 0, color: "var(--accent)", fontWeight: 700, fontSize: 12, cursor: "pointer", flex: "0 0 auto" }}
                      title="Vybrat jiného zákazníka nebo zadat nového"
                    >
                      Změnit
                    </button>
                  </div>
                ) : (
                  <>
                    <CustomerAutocomplete
                      id="new-order-name"
                      value={newDraft.customerName}
                      autoFocus
                      placeholder="Jan Novák"
                      inputStyle={baseFieldInput}
                      search={searchCustomers}
                      onSelect={(m) => applyCustomerMatch(m as CustomerMatch & { ico?: string | null; address_street?: string | null; address_zip?: string | null; note?: string | null })}
                      onChange={(text) => {
                        setNewDraft((p) => ({ ...p, customerName: text }));
                        setCustomerMatchDecision("undecided");
                      }}
                    />
                    <div style={fieldMuted}>Bez jména bude zakázka anonymní. Začněte psát – existující zákazníky nabídneme.</div>
                  </>
                )}
              </div>

              <div style={{ minWidth: 0 }}>
                <div style={{ ...fieldLabel, marginTop: 0 }}>Telefon{uiCfg.orders.customerPhoneRequired ? " *" : ""}</div>
                <input
                  id="new-order-phone"
                  value={formatPhoneNumber(newDraft.customerPhone)}
                  inputMode="tel"
                  onChange={(e) => {
                    const cleaned = e.target.value.replace(/[^\d+]/g, "");
                    setNewDraft((p) => ({ ...p, customerPhone: cleaned }));
                    // Vybraný zákazník zůstává vybraný – u něj se hledání podle telefonu nespouští.
                    if (newDraft.customerId) return;
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
                    if (e.key === "Enter" && !newDraft.customerId) {
                      const phone = newDraft.customerPhone.trim();
                      const name = newDraft.customerName.trim();
                      if (phone || name) {
                        await lookupCustomer(phone || undefined, name || undefined);
                      }
                    }
                  }}
                  onBlur={async () => {
                    if (newDraft.customerId) return;
                    await lookupCustomer(
                      newDraft.customerPhone.trim() || undefined,
                      newDraft.customerName.trim() || undefined
                    );
                  }}
                  style={{ ...baseFieldInput, border: showError("customerPhone") ? borderError : border }}
                  placeholder="+420 777 123 456"
                />
                {showError("customerPhone") && <div style={fieldHint}>{errors.customerPhone}</div>}

                {/* Nalezený zákazník podle telefonu (jen když ještě žádný není vybraný) */}
                {!newDraft.customerId && matchedCustomer && customerMatchDecision === "undecided" && (
                  <div
                    style={{
                      marginTop: 10,
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
                    <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                      <Button
                        variant="primary"
                        size="sm"
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
                      >
                        Přiřadit zákazníka
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => {
                          setCustomerMatchDecision("rejected");
                          setMatchedCustomer(null);
                        }}
                      >
                        Ne, pokračovat bez přiřazení
                      </Button>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* ===== ZAŘÍZENÍ – rychlá část (seznam sbalitelných karet) ===== */}
          <div style={card}>
            <SectionHeading icon={<DeviceIcon size={16} />} size="sm">Zařízení</SectionHeading>
            <div style={{ display: "grid", gap: 8 }}>
              {newDraft.devices.map((dev, idx) => {
                const multi = newDraft.devices.length > 1;
                const expanded = !multi || idx === expandedDeviceIdx;
                const summary = [dev.deviceLabel.trim(), dev.requestedRepair.trim().split("\n")[0]].filter(Boolean).join(" · ") || `Zařízení ${idx + 1}`;
                return (
                  <div
                    key={idx}
                    id={`new-order-device-${idx}`}
                    style={multi ? { border, borderRadius: "var(--radius-md)", padding: 10, background: expanded ? "var(--panel)" : "var(--panel-2)" } : undefined}
                  >
                    {multi && (
                      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                        <button
                          type="button"
                          onClick={() => setExpandedDeviceIdx(expanded ? -1 : idx)}
                          aria-expanded={expanded}
                          style={{ flex: 1, minWidth: 0, textAlign: "left", background: "none", border: "none", padding: 0, cursor: "pointer", color: "var(--text)", fontWeight: 700, fontSize: 13, display: "flex", alignItems: "center", gap: 8 }}
                        >
                          <span style={{ display: "inline-flex", color: "var(--muted)", transform: expanded ? "rotate(180deg)" : "none", transition: "transform 120ms ease" }}><ChevronDownIcon size={14} /></span>
                          <span style={{ color: "var(--muted)", fontWeight: 600, fontSize: 12, flex: "0 0 auto" }}>{idx + 1}.</span>
                          <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{summary}</span>
                          {!expanded && showDeviceError(idx) && <span style={{ color: "rgba(239,68,68,0.95)", fontSize: 12, fontWeight: 600, flex: "0 0 auto" }}>chybí zařízení</span>}
                        </button>
                        <Button
                          variant="ghost"
                          size="sm"
                          iconOnly
                          icon={<XIcon size={14} />}
                          aria-label="Odebrat zařízení"
                          title="Odebrat zařízení"
                          onClick={() => setNewDraft((p) => ({ ...p, devices: p.devices.filter((_, i) => i !== idx) }))}
                        />
                      </div>
                    )}
                    {expanded && (
                      <div style={{ marginTop: multi ? 8 : 0 }}>
                        <div style={{ ...fieldLabel, marginTop: 0 }}>Zařízení *</div>
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

                        <div style={{ display: "grid", gridTemplateColumns: isNarrow ? "1fr" : "1fr 260px", gap: 10 }}>
                          <div>
                            <div style={fieldLabel}>Požadovaná oprava</div>
                            <textarea
                              value={dev.requestedRepair}
                              onChange={(e) =>
                                setNewDraft((p) => ({
                                  ...p,
                                  devices: p.devices.map((d, i) => (i === idx ? { ...d, requestedRepair: e.target.value } : d)),
                                }))
                              }
                              style={{ ...baseFieldTextArea, minHeight: 64 }}
                              placeholder="Výměna displeje, výměna baterie, diagnostika"
                            />
                            {(() => {
                              const catalog = repairsForDeviceLabel(dev.deviceLabel);
                              if (catalog.length === 0) return null;
                              const planned = dev.plannedRepairs ?? [];
                              const plannedIds = new Set(planned.map((r) => r.repairId));
                              const sorted = [...catalog].sort((a, b) => a.name.localeCompare(b.name, "cs"));
                              const showAll = !!catalogShowAll[idx];
                              const visible = showAll ? sorted : sorted.slice(0, 8);
                              const sum = planned.reduce((a, r) => a + (r.price || 0), 0);
                              return (
                                <div style={{ marginTop: 8, display: "grid", gap: 6 }}>
                                  <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: "0.04em", textTransform: "uppercase", color: "var(--muted)" }}>
                                    Z ceníku
                                  </div>
                                  <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                                    {visible.map((r) => {
                                      const on = plannedIds.has(r.id);
                                      return (
                                        <button
                                          key={r.id}
                                          type="button"
                                          aria-pressed={on}
                                          onClick={() => togglePlannedRepair(idx, r)}
                                          title={on ? "Odebrat z požadované opravy" : "Přidat do požadované opravy"}
                                          style={{
                                            display: "inline-flex",
                                            alignItems: "center",
                                            gap: 6,
                                            padding: "5px 10px",
                                            borderRadius: 999,
                                            border: `1px solid ${on ? "var(--accent)" : "var(--border)"}`,
                                            background: on ? "var(--accent-soft)" : "var(--panel)",
                                            color: on ? "var(--accent)" : "var(--text)",
                                            fontSize: 12,
                                            fontWeight: 600,
                                            cursor: "pointer",
                                          }}
                                        >
                                          {on && <CheckIcon size={12} />}
                                          <span>{r.name}</span>
                                          {r.price > 0 && (
                                            <span style={{ color: on ? "var(--accent)" : "var(--muted)", fontWeight: 500 }}>
                                              {r.price.toLocaleString("cs-CZ")} Kč
                                            </span>
                                          )}
                                        </button>
                                      );
                                    })}
                                    {sorted.length > 8 && (
                                      <button
                                        type="button"
                                        onClick={() => setCatalogShowAll((p) => ({ ...p, [idx]: !showAll }))}
                                        style={{ padding: "5px 10px", borderRadius: 999, border: "1px dashed var(--border)", background: "transparent", color: "var(--muted)", fontSize: 12, fontWeight: 600, cursor: "pointer" }}
                                      >
                                        {showAll ? "Méně" : `Dalších ${sorted.length - 8}`}
                                      </button>
                                    )}
                                  </div>
                                  {planned.length > 0 && (
                                    <div style={{ fontSize: 12, color: "var(--muted)" }}>
                                      {planned.length === 1 ? "1 oprava" : planned.length < 5 ? `${planned.length} opravy` : `${planned.length} oprav`} z ceníku
                                      {sum > 0 ? ` · ${sum.toLocaleString("cs-CZ")} Kč` : ""} · přidají se do zakázky s cenou z ceníku, v detailu je upravíte.
                                    </div>
                                  )}
                                </div>
                              );
                            })()}
                          </div>
                          <div>
                            <div style={fieldLabel}>Předpokládaný termín dokončení</div>
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
                            {multi && idx === 0 && <div style={fieldMuted}>Termín prvního zařízení se přenese na ostatní.</div>}
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
            <Button
              variant="soft"
              size="sm"
              icon={<PlusIcon size={14} />}
              style={{ marginTop: 10 }}
              disabled={!newDraft.devices[newDraft.devices.length - 1]?.deviceLabel?.trim()}
              onClick={() => {
                setNewDraft((p) => ({
                  ...p,
                  devices: [
                    ...p.devices,
                    { ...defaultDeviceRow(), expectedCompletionAt: p.devices[0]?.expectedCompletionAt ?? undefined },
                  ],
                }));
                setExpandedDeviceIdx(newDraft.devices.length);
              }}
              title={!newDraft.devices[newDraft.devices.length - 1]?.deviceLabel?.trim() ? "Nejdřív vyplňte název posledního zařízení" : "Přidat další zařízení"}
            >
              Přidat další zařízení
            </Button>
          </div>

          {/* ===== DALŠÍ ÚDAJE – sbalené, stav se pamatuje ===== */}
          <div style={{ ...card, padding: 0, overflow: "hidden" }}>
            <button
              type="button"
              onClick={() => setNewOrderMoreOpen((v) => !v)}
              aria-expanded={newOrderMoreOpen}
              aria-controls="new-order-more"
              style={{ width: "100%", display: "flex", alignItems: "center", gap: 10, padding: 12, background: "none", border: "none", cursor: "pointer", color: "var(--text)", textAlign: "left" }}
            >
              <span style={{ display: "inline-flex", color: "var(--muted)", transform: newOrderMoreOpen ? "rotate(180deg)" : "none", transition: "transform 120ms ease" }}><ChevronDownIcon size={16} /></span>
              <span style={{ fontWeight: 950, fontSize: "var(--text-base)" }}>Další údaje</span>
              {!newOrderMoreOpen && (
                <span style={{ color: "var(--muted)", fontSize: 12, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  e-mail, adresa, firma · IMEI, heslo, příslušenství, cena · přijímací fotky
                </span>
              )}
            </button>

            {newOrderMoreOpen && (
              <div id="new-order-more" style={{ padding: 12, paddingTop: 0, display: "grid", gap: 16 }}>
                {/* Zákazník – doplňující */}
                <div>
                  <div style={subHeading}>Zákazník</div>
                  <div style={{ display: "grid", gridTemplateColumns: isNarrow ? "1fr" : "1fr 1fr 160px", gap: 10 }}>
                    <div>
                      <div style={{ ...fieldLabel, marginTop: 0 }}>E-mail</div>
                      <input
                        id="new-order-email"
                        type="email"
                        value={newDraft.customerEmail}
                        onChange={(e) => setNewDraft((p) => ({ ...p, customerEmail: e.target.value }))}
                        style={{ ...baseFieldInput, border: showError("customerEmail") ? borderError : border }}
                        placeholder="jan.novak@email.cz"
                      />
                      {showError("customerEmail") && <div style={fieldHint}>{errors.customerEmail}</div>}
                    </div>
                    <div>
                      <div style={{ ...fieldLabel, marginTop: 0 }}>Firma</div>
                      <input
                        value={newDraft.company}
                        onChange={(e) => setNewDraft((p) => ({ ...p, company: e.target.value }))}
                        style={baseFieldInput}
                        placeholder="Novák s.r.o."
                      />
                    </div>
                    <div>
                      <div style={{ ...fieldLabel, marginTop: 0 }}>IČO</div>
                      <input
                        id="new-order-ico"
                        inputMode="numeric"
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

                  {/* Třetí sloupec je na desktopu rezerva pro PSČ. Na telefonu
                      by sebral půlku šířky, proto tam jsou dva sloupce. */}
                  <div style={{ display: "grid", gridTemplateColumns: isNarrow ? "1fr 1fr" : "2fr 1fr 160px", gap: 10 }}>
                    <div style={{ gridColumn: isNarrow ? "1 / -1" : "auto" }}>
                      <div style={fieldLabel}>Ulice</div>
                      <input
                        value={newDraft.addressStreet}
                        onChange={(e) => setNewDraft((p) => ({ ...p, addressStreet: e.target.value }))}
                        style={baseFieldInput}
                        placeholder="Dlouhá 12"
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
                        id="new-order-zip"
                        inputMode="numeric"
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

                  <div style={fieldLabel}>Poznámka k zákazníkovi</div>
                  <textarea
                    value={newDraft.customerInfo}
                    onChange={(e) => setNewDraft((p) => ({ ...p, customerInfo: e.target.value }))}
                    style={{ ...baseFieldTextArea, minHeight: 64 }}
                    placeholder="Volá jen odpoledne, preferuje SMS"
                  />
                </div>

                {/* Zařízení – doplňující, pro každé zařízení zvlášť */}
                {newDraft.devices.map((dev, idx) => (
                  <div key={idx}>
                    <div style={subHeading}>
                      Zařízení
                      {newDraft.devices.length > 1 && <span style={{ fontWeight: 600, textTransform: "none", letterSpacing: 0 }}> {idx + 1} · {dev.deviceLabel.trim() || "bez názvu"}</span>}
                      {newDraft.devices.length === 1 && dev.deviceLabel.trim() && <span style={{ fontWeight: 600, textTransform: "none", letterSpacing: 0 }}> · {dev.deviceLabel.trim()}</span>}
                    </div>
                    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 220px), 1fr))", gap: 10 }}>
                      <div>
                        <div style={{ ...fieldLabel, marginTop: 0 }}>IMEI / SN</div>
                        <input
                          value={dev.serialOrImei}
                          onChange={(e) =>
                            setNewDraft((p) => ({
                              ...p,
                              devices: p.devices.map((d, i) => (i === idx ? { ...d, serialOrImei: e.target.value } : d)),
                            }))
                          }
                          style={baseFieldInput}
                          placeholder="35-123456-789012-3"
                        />
                      </div>
                      <div>
                        <div style={{ ...fieldLabel, marginTop: 0 }}>Heslo / kód</div>
                        <input
                          value={dev.devicePasscode}
                          onChange={(e) =>
                            setNewDraft((p) => ({
                              ...p,
                              devices: p.devices.map((d, i) => (i === idx ? { ...d, devicePasscode: e.target.value } : d)),
                            }))
                          }
                          style={baseFieldInput}
                          placeholder="1234"
                        />
                      </div>
                    </div>

                    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 220px), 1fr))", gap: 10 }}>
                      <div>
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
                          placeholder="Rozbitý displej, oděrky"
                        />
                      </div>
                      <div>
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
                          placeholder="Nabíječka, pouzdro"
                        />
                      </div>
                    </div>

                    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 220px), 1fr))", gap: 10 }}>
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

                    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 220px), 1fr))", gap: 10 }}>
                      <div>
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
                          placeholder="Číslo zakázky partnera"
                        />
                      </div>
                      <div>
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
                          placeholder="2 500"
                          min="0"
                          step="1"
                        />
                        <div style={fieldMuted}>V Kč. Cena, se kterou zákazník předem souhlasí.</div>
                      </div>
                    </div>

                    <div style={fieldLabel}>Poznámka pro technika</div>
                    <textarea
                      value={dev.deviceNote}
                      onChange={(e) =>
                        setNewDraft((p) => ({
                          ...p,
                          devices: p.devices.map((d, i) => (i === idx ? { ...d, deviceNote: e.target.value } : d)),
                        }))
                      }
                      style={{ ...baseFieldTextArea, minHeight: 64 }}
                      placeholder="Zákazník si přeje zachovat data"
                    />
                  </div>
                ))}

                {/* Přijímací fotky – nahrají se po vytvoření zakázky */}
                <div id="new-order-photos-before">
                  <div style={subHeading}>Přijímací fotky</div>
                  <div style={{ ...fieldMuted, marginTop: 0, marginBottom: 10 }}>Fotky se po vytvoření zakázky automaticky nahrají a připojí k zakázce.</div>
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
                          aria-label="Odebrat fotku"
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
                            display: "grid",
                            placeItems: "center",
                            padding: 0,
                          }}
                        >
                          <XIcon size={12} />
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
                            fontSize: "var(--text-xs)",
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
                  <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 8, alignItems: "center" }}>
                    <label style={{ ...baseFieldInput, width: "auto", padding: "6px 12px", cursor: "pointer", display: "inline-flex", alignItems: "center", gap: 6, fontSize: "var(--text-sm)", fontWeight: 600 }}>
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
                      <CameraIcon size={14} /> Nahrát fotky
                    </label>
                    <Button
                      variant="soft"
                      size="sm"
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
                          showToast(normalizeError(err) || "Nepodařilo se vytvořit QR pro focení.", "error");
                        } finally {
                          setCaptureQRLoading(false);
                        }
                      }}
                      disabled={captureQRLoading}
                      title="Zobrazit QR kód pro nafocení přijímacích fotek z telefonu. Zakázka se nevytvoří – fotky se připojí po kliknutí na „Vytvořit zakázku“."
                    >
                      {captureQRLoading ? "Vytvářím…" : "Vyfotit z telefonu (QR)"}
                    </Button>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* ===== Patička – lepivá ===== */}
        <div style={{ display: "flex", flexDirection: isNarrow ? "column" : "row", alignItems: isNarrow ? "stretch" : "center", gap: 10, justifyContent: "space-between", position: "sticky", bottom: 0, left: 0, right: 0, zIndex: 3, background: "var(--panel)", margin: "14px -18px 0", padding: 18, paddingTop: 12, borderTop: "1px solid var(--border)" }}>
          {!isNarrow && <span style={{ fontSize: 12, color: "var(--muted)" }}>Rozpracované údaje se ukládají automaticky</span>}
          <div style={{ display: "flex", alignItems: "center", gap: 10, justifyContent: "flex-end", flexWrap: "wrap" }}>
            {submitAttempted && createBlockedReason && (
              <span role="status" style={{ fontSize: 12, color: "var(--muted)" }}>{createBlockedReason}</span>
            )}
            <Button variant="soft" onClick={discardNewOrder} title="Zahodit rozpracovanou zakázku">
              Zrušit
            </Button>
            <Button variant="primary" onClick={createTicket} aria-disabled={!canCreate} title="Vytvořit zakázku (⌘/Ctrl+Enter)">
              Vytvořit zakázku
            </Button>
          </div>
        </div>
      </div>
        </>,
        document.body
      )}

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
              zIndex: 1200,
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
          maxHeight: "calc(100dvh / var(--ui-scale, 1) - 24px)",
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
          zIndex: 1210,
          fontFamily: "system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif",
          willChange: (detailId || detailClaimId) ? "transform" : "auto",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div style={{ flex: "0 0 auto", display: "flex", flexDirection: isNarrow ? "column" : "row", justifyContent: "space-between", gap: isNarrow ? 10 : 12, alignItems: isNarrow ? "stretch" : "flex-start", zIndex: 5, background: "var(--panel)", padding: 18, paddingBottom: 12, borderBottom: "1px solid var(--border)" }}>
          <div style={{ minWidth: 0, paddingRight: 44 }}>
            <div style={{ fontWeight: 950, fontSize: 18, color: "var(--text)", display: "flex", alignItems: "center", gap: 8 }}>
              {detailedClaim ? detailedClaim.code : (detailedTicket ? detailedTicket.code : "—")}
              {detailedClaim && <span style={{ fontSize: 12, padding: "4px 10px", borderRadius: 8, background: "linear-gradient(180deg, rgba(20,184,166,0.4) 0%, rgba(15,118,110,0.3) 100%)", color: "#134e4a", fontWeight: 800, border: "1px solid rgba(13,148,136,0.5)", boxShadow: "0 1px 3px rgba(0,0,0,0.08)" }}>Reklamace</span>}
              {/* Stav přímo v hlavičce – pilulka je zároveň přepínač stavu. */}
              {detailedClaim && !isEditingClaim && (
                <span onClick={(e) => e.stopPropagation()} onMouseDown={(e) => e.stopPropagation()} style={{ display: "inline-flex" }}>
                  <StatusPicker value={detailedClaim.status ?? ""} statuses={statuses as any} getByKey={getByKey as any} onChange={(next) => setClaimStatus(detailedClaim.id, next)} size="sm" actionsByStatus={statusActionsMap} />
                </span>
              )}
              {!detailedClaim && detailedTicket && !isEditing && (() => {
                const detailStatus = normalizeStatus((detailedTicket.status as any) ?? statusById[detailedTicket.id]);
                if (detailStatus === null) return null;
                return (
                  <span onClick={(e) => e.stopPropagation()} onMouseDown={(e) => e.stopPropagation()} style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                    <StatusPicker value={detailStatus} statuses={statuses as any} getByKey={getByKey as any} onChange={(next) => setTicketStatus(detailedTicket.id, next)} size="sm" actionsByStatus={statusActionsMap} />
                    {isFinal(detailStatus) && <span title="Dokončená zakázka" style={{ display: "inline-flex", color: "var(--accent)" }}><CheckIcon size={14} /></span>}
                  </span>
                );
              })()}
              {!detailedClaim && ticketViewers.length > 0 && (
                <span style={{ marginLeft: 4, display: "inline-flex" }}><PresenceAvatars viewers={ticketViewers} /></span>
              )}
              {!detailedClaim && detailedTicket && hasBranches && (() => {
                const b = branchById(detailedTicket.branchId);
                return (
                  <button
                    type="button"
                    onClick={(e) => { e.stopPropagation(); setMoveBranchOpen(true); }}
                    title="Pobočka zakázky – kliknutím přesunout"
                    style={{ display: "inline-flex", alignItems: "center", gap: 4, padding: "3px 8px", borderRadius: 999, border: "1px solid var(--border)", background: "var(--panel-2)", color: "var(--muted)", fontSize: 11, fontWeight: 600, cursor: "pointer" }}
                  >
                    <PinIcon size={11} />
                    {b?.name ?? "Bez pobočky"}
                  </button>
                );
              })()}
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

          <div style={{ display: "flex", gap: 10, alignItems: "center", /* Na mobilu se tlačítka nesmí lámat pod sebe – sloupec sežral šířku a název zakázky se zmáčkl na pár znaků. Radši jedna řada, kterou lze posunout. */ flexWrap: isNarrow ? "nowrap" : "wrap", overflowX: isNarrow ? "auto" : "visible", paddingRight: isNarrow ? 0 : 70, paddingBottom: isNarrow ? 2 : 0 }}>
            {detailedClaim ? (
              isEditingClaim ? (
                <>
                  <Button variant="primary" onClick={() => saveClaimChanges().then((ok) => ok && showToast("Změny uloženy", "success"))} title="Uložit změny" icon={<SaveIcon size={16} />}>
                    Uložit
                  </Button>
                  <Button variant="soft" onClick={() => { setIsEditingClaim(false); setEditedClaim({}); }} title="Zrušit úpravy">Zrušit</Button>
                </>
              ) : (
                <>
                  <Button variant="primary" onClick={startEditingClaim} title="Upravit reklamaci" icon={<EditIcon size={16} />}>
                    Upravit
                  </Button>
                  {canPrintExport && (
                    <PrintMenu
                      rows={[
                        {
                          key: "prijemka_reklamace",
                          label: "Přijetí reklamace",
                          icon: <DocumentIcon size={14} />,
                          onPrint: () => runClaimDocument("print"),
                          onExport: () => runClaimDocument("export"),
                        },
                      ]}
                    />
                  )}
                  {detailedClaim.source_ticket_id && (
                    <Button
                      variant="soft"
                      onClick={() => { setDetailId(detailedClaim.source_ticket_id!); setDetailClaimId(null); }}
                      title="Otevřít původní zakázku"
                      icon={<LinkIcon size={14} />}
                    >
                      Otevřít zakázku
                    </Button>
                  )}
                  <OverflowMenu
                    ariaLabel="Další akce"
                    items={[
                      { label: "Historie", icon: <HistoryIcon size={14} />, onSelect: () => setClaimHistoryModalOpen(true) },
                      {
                        label: "Smazat reklamaci",
                        icon: <TrashIcon size={14} />,
                        danger: true,
                        dividerBefore: true,
                        onSelect: () => { setDeleteClaimId(detailedClaim.id); setDeleteClaimDialogOpen(true); },
                      },
                    ]}
                  />
                </>
              )
            ) : isEditing ? (
              <>
                <Button variant="primary" onClick={saveTicketChanges} title="Uložit změny" icon={<SaveIcon size={16} />}>
                  Uložit
                </Button>
                <Button
                  variant="soft"
                  onClick={() => {
                    setIsEditing(false);
                    setEditedTicket({});
                  }}
                  title="Zrušit úpravy"
                >
                  Zrušit
                </Button>
              </>
            ) : (
              <>
                <Button variant="primary" onClick={startEditing} title="Upravit zakázku" icon={<EditIcon size={16} />}>
                  Upravit
                </Button>

                {detailedTicket && canPrintExport && (
                  <PrintMenu
                    rows={[
                      {
                        key: "ticket",
                        label: "Zakázkový list",
                        icon: <DocumentIcon size={14} />,
                        onPrint: () => { printTicket(detailedTicket, activeServiceId); },
                        onExport: () => { exportTicketToPDF(detailedTicket, activeServiceId); },
                      },
                      ...((detailedTicket.diagnosticText || (detailedTicket.diagnosticPhotos && detailedTicket.diagnosticPhotos.length > 0))
                        ? [{
                            key: "diagnostic",
                            label: "Diagnostický protokol",
                            icon: <SearchIcon size={14} />,
                            onPrint: () => { printDiagnosticProtocol(detailedTicket, activeServiceId); },
                            onExport: () => { exportDiagnosticProtocolToPDF(detailedTicket, activeServiceId); },
                          }]
                        : []),
                      {
                        key: "warranty",
                        label: "Záruční list",
                        icon: <DocumentIcon size={14} />,
                        onPrint: () => { printWarranty(detailedTicket, activeServiceId); },
                        onExport: () => { exportWarrantyToPDF(detailedTicket, activeServiceId); },
                      },
                    ]}
                  />
                )}

                {detailedTicket && smsAvailable && (
                  <Button variant="soft"
                    onClick={() => { setSmsPanelOpen(true); }} style={{ position: "relative" }}
                    title="SMS chat se zákazníkem"
                    icon={<ChatIcon size={16} />}
                  >
                    SMS
                    {smsUnreadCount > 0 && !smsPanelOpen && (
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
                  </Button>
                )}

                {detailedTicket && (onCreateInvoice || onOpenInvoice) && (() => {
                  const existingInvoiceId = invoiceIdByTicketId[detailedTicket.id];
                  return existingInvoiceId && onOpenInvoice ? (
                    <Button
                      key="open-invoice"
                      variant="soft"
                      onClick={() => onOpenInvoice(existingInvoiceId)}
                      title="Otevřít fakturu k této zakázce"
                      icon={<CoinsIcon size={14} />}
                    >
                      Přejít na fakturu
                    </Button>
                  ) : onCreateInvoice ? (
                    <Button variant="soft"
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
                          branchId: t.branchId ?? null,
                          items: repairs.length > 0 ? repairs.map((r) => ({
                            name: r.name,
                            qty: 1,
                            unit: "ks",
                            unit_price: r.price ?? 0,
                            // Neplátce DPH má 0; dřív tu bylo napevno 21 %.
                            vat_rate: sazbaProNovouPolozku(dph),
                          })) : undefined,
                        });
                      }}
                      title="Vytvořit fakturu z této zakázky"
                      icon={<CoinsIcon size={14} />}
                    >
                      Vystavit fakturu
                    </Button>
                  ) : null;
                })()}

                {detailedTicket && (
                  <OverflowMenu
                    ariaLabel="Další akce"
                    items={[
                      { label: "Historie", icon: <HistoryIcon size={14} />, onSelect: () => setTicketHistoryModalOpen(true) },
                      ...(hasBranches ? [{ label: "Přesunout na pobočku…", icon: <PinIcon size={14} />, onSelect: () => setMoveBranchOpen(true) }] : []),
                      {
                        label: "Smazat zakázku",
                        icon: <TrashIcon size={14} />,
                        danger: true,
                        dividerBefore: true,
                        onSelect: () => {
                          setDeleteTicketId(detailedTicket.id);
                          setDeleteDialogOpen(true);
                        },
                      },
                    ]}
                  />
                )}
              </>
            )}
          </div>

          {/* Close button - uvnitř náhledu, s odsazením aby nezasahoval mimo */}
          <Button variant="soft"
            onClick={handleCloseDetail} style={{ position: "absolute", top: 10, right: 10, zIndex: 2 }}
            aria-label="Zavřít"
          >
            ×
          </Button>
        </div>

        <div style={{ flex: 1, minHeight: 0, overflow: "auto", padding: 18 }}>
        {detailedClaim && (() => {
          const c = { ...detailedClaim, ...editedClaim };
          const sourceTicket = detailedClaim.source_ticket_id ? cloudTickets.find((t) => t.id === detailedClaim.source_ticket_id) : undefined;
          return (
          <>
          <div style={{ marginTop: 20, display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 240px), 1fr))", gap: 16 }}>
            <div style={card}>
              <SectionHeading icon={<UserIcon size={16} />}>Zákazník</SectionHeading>
              {!isEditingClaim ? (
                <div style={{ display: "grid", gap: 8 }}>
                  <div style={{ fontSize: 15, fontWeight: 800, color: "var(--text)" }}>{c.customer_name ?? "—"}</div>
                  {c.customer_phone && (
                    <div style={{ fontSize: 13, color: "var(--text)", display: "flex", alignItems: "center", gap: 6 }}>
                      <PhoneIcon size={14} />
                      <span>{formatPhoneNumber(c.customer_phone)}</span>
                    </div>
                  )}
                  {c.customer_email && (
                    <div style={{ fontSize: 13, color: "var(--text)", display: "flex", alignItems: "center", gap: 6 }}>
                      <MailIcon size={14} />
                      <span>{c.customer_email}</span>
                    </div>
                  )}
                  {[c.customer_address_street, c.customer_address_city, c.customer_address_zip].filter(Boolean).length > 0 && (
                    <div style={{ fontSize: 13, color: "var(--text)", display: "flex", alignItems: "center", gap: 6, marginTop: 4 }}>
                      <PinIcon size={14} />
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
              <SectionHeading icon={<DeviceIcon size={16} />}>Zařízení</SectionHeading>
              {!isEditingClaim ? (
                <div style={{ display: "grid", gap: 8 }}>
                  <div style={{ fontSize: 15, fontWeight: 800, color: "var(--text)" }}>{c.device_label || c.device_serial || "—"}</div>
                  {c.device_serial && (
                    <div style={{ fontSize: 13, color: "var(--text)", display: "flex", alignItems: "center", gap: 6 }}>
                      <HashIcon size={14} />
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
              <div style={{ fontWeight: 950, fontSize: 14, color: "var(--text)", marginBottom: 12 }}><NoteIcon size={14} /> Poznámka / důvod reklamace</div>
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
                      <Button variant="primary"
                        disabled={resolutionItems.length > 0 && !resolutionItems[resolutionItems.length - 1]?.name?.trim()}
                        onClick={() => setResolutionItems([...resolutionItems, { id: (crypto as any).randomUUID?.() ?? `z-${Date.now()}`, name: "" }])}
                        title={resolutionItems.length > 0 && !resolutionItems[resolutionItems.length - 1]?.name?.trim() ? "Vyplňte název posledního zákroku" : "Přidat zákrok"}>
                        <span>+</span> Přidat zákrok
                      </Button>
                      {claimResolutionDraft !== null && (
                        <Button variant="primary"
                          onClick={() => {
                            saveClaimResolutionItems(detailedClaim!.id, claimResolutionDraft!).then((ok) => ok && showToast("Zákroky uloženy", "success"));
                          }} style={{ display: "inline-flex", alignItems: "center", gap: 8,  background: "var(--accent)", color: "var(--accent-fg)" }}
                        >
                          Uložit zákroky
                        </Button>
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
                {/* Mimo úpravy je přepínač stavu v hlavičce; tady zůstává jen pro režim úprav. */}
                {isEditingClaim ? (
                  <StatusPicker value={c.status ?? "received"} statuses={statuses as any} getByKey={getByKey as any} onChange={(next) => setEditedClaim((p) => ({ ...p, status: next }))} size="sm" actionsByStatus={statusActionsMap} />
                ) : (
                  <span style={{ fontSize: 13, fontWeight: 700, color: "var(--text)" }}>{getByKey(String(c.status ?? ""))?.label ?? "—"}</span>
                )}
              </div>
              <span style={{ fontSize: 12, color: "var(--muted)" }}>Vytvořeno: {formatCZ(c.created_at)}</span>
              {c.updated_at && <span style={{ fontSize: 12, color: "var(--muted)" }}>· Upraveno: {formatCZ(c.updated_at)}</span>}
            </div>
          </div>

          {sourceTicket ? (
            <>
              <div style={{ ...card, marginTop: 16 }}>
                <SectionHeading icon={<SearchIcon size={16} />}>Diagnostika</SectionHeading>
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
                                    try {
                                      await deleteDiagnosticPhotoFromStorage(supabase, url);
                                    } catch (e) {
                                      // Fotka zůstane v úložišti jako sirotek – uživateli
                                      // to nevadí, ale hromadí se to a nikdo by si toho
                                      // nevšiml. Proto se to aspoň zaloguje.
                                      reportSilent({ code: "orders.photo_delete_failed", error: e, source: "Orders.deleteDiagnosticPhoto" });
                                    }
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
                                } catch (e) {
                                  reportSilent({ code: "orders.photo_delete_failed", error: e, source: "Orders.deleteDiagnosticPhoto" });
                                }
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
                      <Button variant="soft"
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
                        disabled={!supabase || !activeServiceId || !sourceTicket?.id || diagnosticPhotosUploading || captureQRLoading} style={{ fontSize: 13 }}
                      >
                        {captureQRLoading ? "Vytvářím…" : "Vyfotit z telefonu"}
                      </Button>
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

              <TicketComments
                ticketId={sourceTicket.id}
                comments={commentsFor(sourceTicket.id)}
                draft={commentDraftByTicket[sourceTicket.id] ?? ""}
                onDraftChange={handleCommentDraftChange}
                onAdd={addComment}
                onTogglePin={togglePin}
                onEdit={editComment}
                currentUserId={session?.user?.id ?? null}
                authorProfiles={commentAuthorProfiles}
                card={card}
                baseFieldTextArea={baseFieldTextArea}
              />
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
                <div style={{ marginTop: 20, display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 240px), 1fr))", gap: 16 }}>
                  <div style={card}>
                    <SectionHeading icon={<UserIcon size={16} />}>Zákazník</SectionHeading>
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
                          <PhoneIcon size={14} />
                          <span>{formatPhoneNumber(detailedTicket.customerPhone)}</span>
                        </div>
                      )}
                      {detailedTicket.customerEmail && (
                        <div style={{ fontSize: 13, color: "var(--text)", display: "flex", alignItems: "center", gap: 6 }}>
                          <MailIcon size={14} />
                          <span>{detailedTicket.customerEmail}</span>
                        </div>
                      )}
                      {[detailedTicket.customerAddressStreet, detailedTicket.customerAddressCity, detailedTicket.customerAddressZip].filter(Boolean).length >
                        0 && (
                        <div style={{ fontSize: 13, color: "var(--text)", display: "flex", alignItems: "center", gap: 6, marginTop: 4 }}>
                          <PinIcon size={14} />
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
                    <SectionHeading icon={<DeviceIcon size={16} />}>Zařízení</SectionHeading>
                    <div style={{ display: "grid", gap: 8 }}>
                      <div style={{ fontSize: 15, fontWeight: 800, color: "var(--text)" }}>{detailedTicket.deviceLabel}</div>
                      {detailedTicket.serialOrImei && (
                        <div style={{ fontSize: 13, color: "var(--text)", display: "flex", alignItems: "center", gap: 6 }}>
                          <HashIcon size={14} />
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
                        <WrenchIcon size={14} /> {detailedTicket.requestedRepair ?? detailedTicket.issueShort}
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
                    <SectionHeading icon={<UserIcon size={16} />}>Zákazník</SectionHeading>
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
                      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 240px), 1fr))", gap: 12 }}>
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
                      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 240px), 1fr))", gap: 12 }}>
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
                    <SectionHeading icon={<DeviceIcon size={16} />}>Zařízení</SectionHeading>
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
                {/* Stav zakázky je v hlavičce (pilulka = přepínač), tady už se neopakuje. */}
                <div style={{ marginTop: 20, display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 240px), 1fr))", gap: 16 }}>
                  {(detailedTicket.customerCompany || detailedTicket.customerIco || detailedTicket.customerInfo) && (
                  <div style={{ ...card, opacity: 0.85 }}>
                    <SectionHeading size="sm">Dodatečné informace o zákazníkovi</SectionHeading>
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
                  )}

                  <div style={{ ...card, opacity: 0.85 }}>
                    <SectionHeading size="sm">Technické detaily</SectionHeading>
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
                            <InboxIcon size={14} /> Převzetí: {detailedTicket.handoffMethod}
                          </div>
                        )}
                        {detailedTicket.handbackMethod && (
                          <div style={{ fontSize: 12, color: "var(--muted)" }}>
                            <OutboxIcon size={14} /> Předání: {detailedTicket.handbackMethod}
                          </div>
                        )}
                        {detailedTicket.externalId && (
                          <div style={{ fontSize: 12, color: "var(--muted)" }}>
                            <LinkIcon size={14} /> Ext: {detailedTicket.externalId}
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                </div>

                <div style={{ ...card, marginTop: 16 }}>
                  <SectionHeading icon={<WrenchIcon size={16} />}>Provedené opravy</SectionHeading>

                  <div style={{ display: "grid", gap: 8, marginBottom: 12 }}>
                    {(detailedTicket.performedRepairs ?? []).map((repair) => {
                      // Rezervované/odečtené díly této opravy; uvolněné se neukazují.
                      const dily = ticketReservations.ticketId === detailedTicket.id
                        ? ticketReservations.rows.filter((r) => r.repairEntryId === repair.id && r.status !== "released")
                        : [];
                      return (
                        <div key={repair.id} style={{ display: "grid", gap: 2 }}>
                          <PerformedRepairItem
                            repair={repair}
                            onRemove={(repairId) => removePerformedRepair(detailedTicket.id, repairId)}
                            onUpdatePrice={(repairId, price) => updatePerformedRepairPrice(detailedTicket.id, repairId, price)}
                            onUpdateCosts={(repairId, costs) => updatePerformedRepairCosts(detailedTicket.id, repairId, costs)}
                            onUpdateTime={(repairId, time) => updatePerformedRepairTime(detailedTicket.id, repairId, time)}
                            onUpdateProducts={(repairId, productIds) => updatePerformedRepairProducts(detailedTicket.id, repairId, productIds)}
                            devicesData={devicesData}
                            inventoryData={inventoryData}
                          />
                          {dily.length > 0 && (
                            <div style={{ color: "var(--muted)", fontSize: 12, paddingLeft: 12 }}>
                              Díly:{" "}
                              {dily
                                .map((r) => `${r.productName} ×${r.qty} (${r.status === "consumed" ? "odečteno" : "rezervováno"})`)
                                .join(", ")}
                            </div>
                          )}
                        </div>
                      );
                    })}
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

                {activeServiceId && (
                  <PortalCard
                    key={detailedTicket.id}
                    ticket={detailedTicket}
                    serviceId={activeServiceId}
                    smsAvailable={smsAvailable}
                    availableRepairs={availableRepairs}
                    onQuoteApprovedRepairs={applyQuoteRepairs}
                    style={{ marginTop: 16 }}
                    onFieldsChange={(ticketId, fields) =>
                      setCloudTickets((prev) => prev.map((t) => (t.id === ticketId ? { ...t, ...fields } : t)))
                    }
                  />
                )}

                <div style={{ ...card, marginTop: 16 }}>
                  <SectionHeading icon={<SearchIcon size={16} />}>Diagnostika</SectionHeading>
                  
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
                                    } catch (e) {
                                      reportSilent({ code: "orders.photo_delete_failed", error: e, source: "Orders.deleteDiagnosticPhoto" });
                                    }
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
                        <Button variant="soft"
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
                          disabled={!supabase || !activeServiceId || !detailedTicket?.id || diagnosticPhotosUploading || captureQRLoading} style={{ fontSize: 13 }}
                        >
                          {captureQRLoading ? "Vytvářím…" : "Vyfotit z telefonu"}
                        </Button>
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
                        <Button variant="soft"
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
                        disabled={!supabase || !activeServiceId || !detailedTicket?.id || diagnosticPhotosUploading || captureQRLoading} style={{ fontSize: 13 }}
                        >
                          {captureQRLoading ? "Vytvářím…" : "Vyfotit z telefonu"}
                        </Button>
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
            <TicketComments
              ticketId={detailedTicket.id}
              comments={commentsFor(detailedTicket.id)}
              draft={commentDraftByTicket[detailedTicket.id] ?? ""}
              onDraftChange={handleCommentDraftChange}
              onAdd={addComment}
              onTogglePin={togglePin}
              onEdit={editComment}
              currentUserId={session?.user?.id ?? null}
              authorProfiles={commentAuthorProfiles}
              card={card}
              baseFieldTextArea={baseFieldTextArea}
            />
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
          height: isSidebarBottom ? "calc(100dvh / var(--ui-scale, 1) - var(--sidebar-bottom-collapsed))" : "calc(100dvh / var(--ui-scale, 1))",
          background: "var(--panel)",
          borderLeft: "1px solid var(--border)",
          boxShadow: "var(--shadow)",
          zIndex: 1321,
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
            style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.3)", zIndex: 1320 }}
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
              <Button variant="soft" onClick={() => setSmsPanelOpen(false)} style={{ width: 36, height: 36 }} aria-label="Zavřít">×</Button>
            </div>
            <div style={{ flex: 1, minHeight: 0, overflow: "hidden" }}>
              <SmsChat
                ticketId={detailedTicket.id}
                serviceId={(detailedTicket as { service_id?: string }).service_id ?? activeServiceId ?? undefined}
                customerPhone={detailedTicket.customerPhone ?? null}
                customerName={detailedTicket.customerName ?? null}
                onInboundMarkedRead={() => {
                  setSmsUnreadCount(0);
                  setSmsUnreadListBump((n) => n + 1);
                }}
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
        message="Opravdu chcete tuto zakázku přesunout do smazaných?"
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
          // Smazaná zakázka díly nedrží.
          void releaseReservations(deleteTicketId);

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
        message="Opravdu chcete smazat tuto reklamaci? Tato akce je nevratná."
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
            if (config?.autoPrint?.prijetiReklamaceOnCreate && activeServiceId) {
              const data = claimDocumentData(claim, safeLoadCompanyData(), "");
              if (isWeb()) await runWebDocument("print", "prijemka_reklamace", activeServiceId, data);
              else await runDesktopDocument("print", "prijemka_reklamace", activeServiceId, data, `prijemka-reklamace-${claim.code}.pdf`);
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
              <Button variant="soft" size="sm" onClick={() => setTicketHistoryModalOpen(false)}>Zavřít</Button>
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
                  // V databázi je stav anglický klíč ("received"). Zbytek aplikace
                  // ho překládá přes getByKey; historie ho vypisovala surový, takže
                  // uživatel četl "received → ready" místo "Přijato → Připraveno".
                  if (key === "status") return getByKey(String(val))?.label ?? String(val);
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
                      out.push({
                        label: "Stav",
                        oldVal: formatHistoryVal("status", details.status_old),
                        newVal: formatHistoryVal("status", details.status_new),
                      });
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
                              {e.action === "updated" && changes.length === 0 && (
                                // Starší záznamy vznikly před migrací s plným diffem, takže
                                // co se změnilo, se nikam neuložilo. Bez téhle věty vidí
                                // uživatel jen „Upravena" a nemá jak zjistit proč.
                                <div style={{ color: "var(--muted)", marginTop: 2, fontSize: 12, fontStyle: "italic" }}>
                                  Podrobnosti u tohoto záznamu nejsou – zaznamenávají se až u novějších změn.
                                </div>
                              )}
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
      <BranchPickerDialog
        open={moveBranchOpen && !!detailedTicket}
        branches={branches}
        currentId={detailedTicket?.branchId ?? null}
        onClose={() => setMoveBranchOpen(false)}
        onSelect={(b: Branch) => {
          const t = detailedTicket;
          if (!t) return;
          const prev = t.branchId ?? null;
          setCloudTickets((list) => list.map((x) => (x.id === t.id ? { ...x, branchId: b.id } : x)));
          void setTicketBranch(t.id, b.id).then((res) => {
            if (res.error) {
              setCloudTickets((list) => list.map((x) => (x.id === t.id ? { ...x, branchId: prev } : x)));
              showToast(`Přesun se nepodařil: ${res.error}`, "error");
            } else {
              showToast(`Zakázka přesunuta na pobočku ${b.name}`, "success");
            }
          });
        }}
      />
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
              <Button variant="soft" size="sm" onClick={() => setClaimHistoryModalOpen(false)}>Zavřít</Button>
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
                            Stav: {getByKey(String(statusOld))?.label ?? String(statusOld)} → {getByKey(String(statusNew))?.label ?? String(statusNew)}
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
            <SectionHeading icon={<DeviceIcon size={18} />}>Vyfotit z telefonu</SectionHeading>
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
                  <Button variant="soft"
                    onClick={() => {
                      navigator.clipboard?.writeText(item.url).then(() => showToast("Odkaz zkopírován", "success"));
                    }} style={{ fontSize: 12 }}
                  >
                    Kopírovat odkaz
                  </Button>
                </div>
              ))}
            </div>
            {draftCaptureTokenRef.current && (
              <div style={{ fontSize: 12, color: "var(--muted)", textAlign: "center" }}>
                Aktuálně nafoceno: <b style={{ color: "var(--text)" }}>{draftCaptureLiveCount}</b>. Zavřete až po nafocení všech fotek.
              </div>
            )}
            <Button variant="soft" onClick={closeCaptureQrModal} style={{ marginTop: 8 }}>
              {draftCaptureTokenRef.current
                ? `Zavřít (${draftCaptureLiveCount} ${draftCaptureLiveCount === 1 ? "fotka" : draftCaptureLiveCount >= 2 && draftCaptureLiveCount <= 4 ? "fotky" : "fotek"})`
                : "Zavřít"}
            </Button>
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
