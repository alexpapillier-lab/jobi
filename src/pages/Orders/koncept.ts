/**
 * Rozepsaná nová zakázka (koncept) – klíče v localStorage, výchozí hodnoty,
 * načtení/uložení a zjištění, zda je koncept „špinavý“.
 * Vyneseno z Orders.tsx beze změny obsahu.
 */
import { getHandoffOptions } from "../../lib/handoffOptions";
import type { DeviceRow, NewOrderDraft } from "./typy";

export const NEW_ORDER_DRAFT_KEY = "jobsheet_new_order_draft_v1";
/** Zda je v okně Nová zakázka rozbalená sekce „Další údaje“. */
export const NEW_ORDER_MORE_OPEN_KEY = "jobsheet_new_order_more_open_v1";
/** Zda jsou u zařízení v nové zakázce rozbalené „Další údaje zařízení“. */
export const NEW_ORDER_DEVICE_MORE_OPEN_KEY = "jobsheet_new_order_device_more_open_v1";
export const NEW_ORDER_CUSTOMER_MORE_OPEN_KEY = "jobsheet_new_order_customer_more_open_v1";
export function safeLoadDraft(): NewOrderDraft | null {
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
          // Rozepsaný příjem z doby před zárukou a Find My – pole musí být, jinak by inputy byly neřízené.
          warrantyClaim: d.warrantyClaim ?? false,
          purchaseDate: d.purchaseDate ?? "",
          purchaseProof: d.purchaseProof ?? "",
          findMyOff: d.findMyOff ?? false,
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
        warrantyClaim: def.warrantyClaim,
        purchaseDate: def.purchaseDate,
        purchaseProof: def.purchaseProof,
        findMyOff: def.findMyOff,
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

export function safeSaveDraft(draft: NewOrderDraft | null) {
  try {
    if (!draft) localStorage.removeItem(NEW_ORDER_DRAFT_KEY);
    else localStorage.setItem(NEW_ORDER_DRAFT_KEY, JSON.stringify(draft));
  } catch {
    // ignore
  }
}
export function defaultDeviceRow(): DeviceRow {
  const handoffOpts = getHandoffOptions();
  const defaultReceive = handoffOpts.receiveMethods.includes("Osobně") ? "Osobně" : "";
  const defaultReturn = handoffOpts.returnMethods.includes("Osobně") ? "Osobně" : "";
  return {
    deviceLabel: "",
    serialOrImei: "",
    devicePasscode: "",
    deviceCondition: "",
    deviceAccessories: "",
    warrantyClaim: false,
    purchaseDate: "",
    purchaseProof: "",
    findMyOff: false,
    requestedRepair: "",
    handoffMethod: defaultReceive,
    handbackMethod: defaultReturn,
    deviceNote: "",
    externalId: "",
    estimatedPrice: undefined,
    expectedCompletionAt: undefined,
  };
}

export function defaultDraft(): NewOrderDraft {
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

export function isDraftDirty(d: NewOrderDraft) {
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
