/**
 * Poslední zakázky, reklamace a faktury servisu ze Supabase – pro náhled
 * na reálných datech v editoru. Mapování řádků tabulek na DocumentData
 * odpovídá tomu, co posílá Jobi (src/lib/documentData.ts).
 */
import { createClient } from "@supabase/supabase-js";
import type { DocType, DocumentData, LineItem, Party } from "../core/index.js";
import type { SupabaseAuth } from "./documentsStore.js";

type Rec = Record<string, unknown>;
const s = (v: unknown): string | undefined => (typeof v === "string" && v.trim() ? v.trim() : undefined);
const n = (v: unknown): number | undefined => (typeof v === "number" && Number.isFinite(v) ? v : undefined);

export type RecentDocument = { id: string; label: string; data: DocumentData };

function address(street: unknown, city: unknown, zip: unknown): string | undefined {
  const out = [s(street), [s(zip), s(city)].filter(Boolean).join(" ")].filter(Boolean).join(", ");
  return out || undefined;
}

function ticketToData(row: Rec, service: Party): DocumentData {
  const repairs = Array.isArray(row.performed_repairs) ? (row.performed_repairs as Rec[]) : [];
  const items: LineItem[] = repairs.filter((r) => s(r.name)).map((r) => ({ name: String(r.name), qty: 1, unit: "ks", unitPrice: n(r.price), total: n(r.price) }));
  const hasPrices = items.some((i) => i.total != null);
  const total = items.reduce((sum, i) => sum + (i.total ?? 0), 0);
  const photos = Array.isArray(row.diagnostic_photos) ? (row.diagnostic_photos as unknown[]).filter((u): u is string => typeof u === "string" && u.trim().length > 0) : [];
  return {
    number: s(row.code),
    service,
    customer: {
      name: s(row.customer_name),
      company: s(row.customer_company),
      ico: s(row.customer_ico),
      phone: s(row.customer_phone),
      email: s(row.customer_email),
      address: address(row.customer_address_street, row.customer_address_city, row.customer_address_zip),
      note: s(row.customer_info),
    },
    device: {
      name: s(row.device_label) ?? [s(row.device_brand), s(row.device_model)].filter(Boolean).join(" ") ?? undefined,
      serial: s(row.device_serial),
      imei: s(row.device_imei),
      passcode: s(row.device_passcode),
      condition: s(row.device_condition),
      accessories: s(row.device_accessories),
      issue: s(row.title) ?? s(row.notes),
      note: s(row.device_note),
    },
    dates: { received: s(row.created_at), eta: s(row.expected_completion_at), completed: s(row.completed_at), diagnosed: s(row.diagnostic_text) ? s(row.updated_at) ?? s(row.created_at) : undefined },
    handoff: { receive: s(row.handoff_method), return: s(row.handback_method) },
    items,
    totals: { total: hasPrices ? total : undefined, estimated: n(row.estimated_price), currency: "CZK" },
    diagnostic: s(row.diagnostic_text),
    note: s(row.notes),
    photos,
    warranty: { months: 12 },
  };
}

function claimToData(row: Rec, service: Party): DocumentData {
  return {
    number: s(row.code),
    service,
    customer: {
      name: s(row.customer_name),
      phone: s(row.customer_phone),
      email: s(row.customer_email),
      address: address(row.customer_address_street, row.customer_address_city, row.customer_address_zip),
    },
    device: { name: s(row.device_label), serial: s(row.device_serial), imei: s(row.device_imei), condition: s(row.device_condition), issue: s(row.notes) },
    dates: { received: s(row.received_at) ?? s(row.created_at), released: s(row.released_at), completed: s(row.completed_at) },
    note: s(row.resolution_summary),
    totals: { currency: "CZK" },
  };
}

function invoiceToData(row: Rec, items: Rec[], service: Party): DocumentData {
  const iban = (s(row.supplier_iban) ?? "").replace(/\s/g, "");
  const total = n(row.total) ?? 0;
  return {
    number: s(row.number),
    service: { ...service, name: s(row.supplier_name) ?? service.name, ico: s(row.supplier_ico) ?? service.ico, dic: s(row.supplier_dic) ?? service.dic, address: s(row.supplier_address) ?? service.address },
    customer: { name: s(row.customer_name), ico: s(row.customer_ico), dic: s(row.customer_dic), address: s(row.customer_address), email: s(row.customer_email), phone: s(row.customer_phone) },
    dates: { issued: s(row.issue_date), due: s(row.due_date), taxable: s(row.taxable_date) },
    items: items.map((it) => ({ name: String(it.name ?? ""), qty: n(it.qty), unit: s(it.unit), unitPrice: n(it.unit_price), vatRate: n(it.vat_rate), total: n(it.line_total) })),
    totals: { subtotal: n(row.subtotal), vat: n(row.vat_amount), total: n(row.total), rounding: n(row.rounding) || undefined, currency: s(row.currency) ?? "CZK", vatPayer: true },
    note: s(row.notes),
    payment: {
      account: s(row.supplier_bank_account),
      iban: s(row.supplier_iban),
      swift: s(row.supplier_swift),
      vs: s(row.variable_symbol),
      spayd: iban ? ["SPD*1.0", `ACC:${iban}`, `AM:${total.toFixed(2)}`, `CC:${s(row.currency) ?? "CZK"}`, s(row.variable_symbol) ? `X-VS:${s(row.variable_symbol)}` : "", `MSG:Faktura ${s(row.number) ?? ""}`].filter(Boolean).join("*") : undefined,
    },
  };
}

export async function loadRecent(serviceId: string, docType: DocType, service: Party, auth: SupabaseAuth, limit = 6): Promise<RecentDocument[]> {
  const sb = createClient(auth.supabaseUrl, auth.supabaseAnonKey, {
    global: { headers: { Authorization: `Bearer ${auth.supabaseAccessToken}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  try {
    if (docType === "faktura") {
      const { data } = await sb.from("invoices").select("*").eq("service_id", serviceId).is("deleted_at", null).order("created_at", { ascending: false }).limit(limit);
      const rows = (data ?? []) as Rec[];
      const out: RecentDocument[] = [];
      for (const row of rows) {
        const { data: items } = await sb.from("invoice_items").select("*").eq("invoice_id", String(row.id)).order("sort_order");
        out.push({ id: String(row.id), label: `${s(row.number) ?? "?"} · ${s(row.customer_name) ?? ""}`.trim(), data: invoiceToData(row, (items ?? []) as Rec[], service) });
      }
      return out;
    }
    if (docType === "prijemka_reklamace" || docType === "vydejka_reklamace") {
      const { data } = await sb.from("warranty_claims").select("*").eq("service_id", serviceId).order("created_at", { ascending: false }).limit(limit);
      return ((data ?? []) as Rec[]).map((row) => ({ id: String(row.id), label: `${s(row.code) ?? "?"} · ${s(row.customer_name) ?? ""} · ${s(row.device_label) ?? ""}`.trim(), data: claimToData(row, service) }));
    }
    const { data } = await sb.from("tickets").select("*").eq("service_id", serviceId).is("deleted_at", null).order("created_at", { ascending: false }).limit(limit);
    return ((data ?? []) as Rec[]).map((row) => ({ id: String(row.id), label: `${s(row.code) ?? "?"} · ${s(row.customer_name) ?? ""} · ${s(row.device_label) ?? ""}`.trim(), data: ticketToData(row, service) }));
  } catch {
    return [];
  }
}
