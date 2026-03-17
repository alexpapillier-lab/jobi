import type { StatusMeta } from "../../state/StatusesStore";

export type TicketCardData = {
  id: string;
  code: string;
  customerName: string;
  customerPhone?: string;
  deviceLabel: string;
  serialOrImei?: string;
  issueShort: string;
  requestedRepair?: string;
  createdAt: string;
  status: string | null;
  discountType?: "percentage" | "amount" | null;
  discountValue?: number;
  performedRepairs?: { name?: string; price?: number }[];
  expectedDoneAt?: string;
};

export type TicketCardActions = {
  onClickDetail: (id: string) => void;
  onStatusChange: (id: string, status: string) => void;
  onQuickPrint?: (ticket: TicketCardData) => void;
  canPrintExport?: boolean;
};

export type StatusHelpers = {
  statuses: StatusMeta[];
  getByKey: (k: string) => StatusMeta | undefined;
  normalizeStatus: (raw: any) => string | null;
  isFinal: (key: string) => boolean;
};

export function formatCZDate(dtIso: string): string {
  try {
    const d = new Date(dtIso);
    return `${d.getDate()}.${d.getMonth() + 1}.${d.getFullYear()}`;
  } catch {
    return dtIso;
  }
}

export function formatPhone(value: string): string {
  const digits = value.replace(/\D/g, "");
  if (digits.length === 12 && digits.startsWith("420")) {
    return `+420 ${digits.slice(3, 6)} ${digits.slice(6, 9)} ${digits.slice(9)}`;
  }
  if (digits.length === 9) {
    return `${digits.slice(0, 3)} ${digits.slice(3, 6)} ${digits.slice(6)}`;
  }
  return value;
}

export function computeFinalPrice(t: TicketCardData): number {
  const repairs = t.performedRepairs ?? [];
  const totalPrice = repairs.reduce((sum, r) => sum + (r.price || 0), 0);
  const discountType = t.discountType;
  const discountValue = t.discountValue || 0;
  let discountAmount = 0;
  if (discountType === "percentage") discountAmount = (totalPrice * discountValue) / 100;
  else if (discountType === "amount") discountAmount = discountValue;
  return Math.max(0, totalPrice - discountAmount);
}
