import type { Database } from "../../types/supabase";
import type { InvoiceLineItem } from "../../lib/invoiceMath";

export type Invoice = Database["public"]["Tables"]["invoices"]["Row"];
export type InvoiceItem = Database["public"]["Tables"]["invoice_items"]["Row"];
export type InvoiceEvent = Database["public"]["Tables"]["invoice_events"]["Row"];

export type InvoiceStatus = "draft" | "issued" | "sent" | "paid" | "overdue" | "cancelled";

/** Řádek položky v editoru – u existující faktury nese i id z databáze. */
export type EditorLineItem = InvoiceLineItem & { id?: string };

/**
 * Filtr seznamu. „issued“ zahrnuje vystavené i odeslané faktury – pro
 * uživatele je to jedna hromádka „čeká na zaplacení“.
 */
export type ListFilter = "all" | "draft" | "issued" | "paid" | "overdue" | "cancelled";

export const STATUS_LABELS: Record<InvoiceStatus, string> = {
  draft: "Koncept",
  issued: "Vystaveno",
  sent: "Odesláno",
  paid: "Zaplaceno",
  overdue: "Po splatnosti",
  cancelled: "Stornováno",
};

export const STATUS_COLORS: Record<InvoiceStatus, { bg: string; fg: string }> = {
  draft: { bg: "rgba(107,114,128,0.15)", fg: "var(--muted)" },
  issued: { bg: "rgba(37,99,235,0.15)", fg: "#2563eb" },
  sent: { bg: "rgba(139,92,246,0.15)", fg: "#8b5cf6" },
  paid: { bg: "var(--success-soft)", fg: "var(--success-text)" },
  overdue: { bg: "var(--danger-soft)", fg: "var(--danger-text)" },
  cancelled: { bg: "var(--panel-2)", fg: "var(--muted)" },
};

/** Stavy, ve kterých faktura čeká na zaplacení. */
export const UNPAID_STATUSES: InvoiceStatus[] = ["issued", "sent", "overdue"];

export function asStatus(s: string): InvoiceStatus {
  return (s in STATUS_LABELS ? s : "draft") as InvoiceStatus;
}

export function matchesFilter(inv: Invoice, filter: ListFilter): boolean {
  if (filter === "all") return true;
  if (filter === "issued") return inv.status === "issued" || inv.status === "sent";
  return inv.status === filter;
}

/** Dnešní datum jako YYYY-MM-DD (lokální čas). */
export function todayIso(): string {
  const d = new Date();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${m}-${day}`;
}

export function addDaysIso(iso: string, days: number): string {
  const [y, m, d] = iso.split("-").map(Number);
  const dt = new Date(y, (m || 1) - 1, (d || 1) + days);
  const mm = String(dt.getMonth() + 1).padStart(2, "0");
  const dd = String(dt.getDate()).padStart(2, "0");
  return `${dt.getFullYear()}-${mm}-${dd}`;
}

/** Počet dní po splatnosti; 0, když faktura ještě není po splatnosti. */
export function daysOverdue(dueDate: string | null | undefined, today = todayIso()): number {
  if (!dueDate) return 0;
  const parse = (iso: string) => {
    const [y, m, d] = iso.slice(0, 10).split("-").map(Number);
    return Date.UTC(y, (m || 1) - 1, d || 1);
  };
  const diff = Math.floor((parse(today) - parse(dueDate)) / 86400000);
  return diff > 0 ? diff : 0;
}

export function formatDate(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString("cs-CZ");
}

export function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString("cs-CZ", { day: "numeric", month: "numeric", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

/** „1 faktura“, „3 faktury“, „12 faktur“. */
export function pluralFaktury(n: number): string {
  if (n === 1) return "1 faktura";
  if (n >= 2 && n <= 4) return `${n} faktury`;
  return `${n} faktur`;
}

/** „o 1 den“, „o 3 dny“, „o 12 dní“. */
export function pluralDny(n: number): string {
  if (n === 1) return "1 den";
  if (n >= 2 && n <= 4) return `${n} dny`;
  return `${n} dní`;
}
