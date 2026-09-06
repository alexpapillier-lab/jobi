import type { StatusMeta } from "../../state/StatusesStore";
import { konecnaCena } from "../../lib/slevaZakazky";

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

/**
 * Datum na kartě zakázky. `new Date("nesmysl")` nevyhazuje, vrací Invalid
 * Date – `try/catch` proto nikdy nezabral a na kartě se objevilo
 * „NaN.NaN.NaN". Nečitelné datum se radši vypíše, jak přišlo.
 */
export function formatCZDate(dtIso: string): string {
  const d = new Date(dtIso);
  if (Number.isNaN(d.getTime())) return dtIso;
  return `${d.getDate()}. ${d.getMonth() + 1}. ${d.getFullYear()}`;
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
  return konecnaCena(totalPrice, t.discountType, t.discountValue);
}

export type TicketComment = {
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

export function formatCZ(dtIso: string) {
  const d = new Date(dtIso);
  return d.toLocaleString("cs-CZ", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}
