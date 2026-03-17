import type { Database } from "../types/supabase";
import type { CompanyData } from "./companyData";
import { formatCurrency } from "./invoiceMath";

type Invoice = Database["public"]["Tables"]["invoices"]["Row"];
type InvoiceItem = Database["public"]["Tables"]["invoice_items"]["Row"];

export function invoiceToJobiDocsVariables(
  inv: Invoice,
  items: InvoiceItem[],
): Record<string, string> {
  const fmtDate = (d: string | null) => {
    if (!d) return "";
    try {
      return new Date(d).toLocaleDateString("cs-CZ");
    } catch {
      return d;
    }
  };

  const itemsJson = JSON.stringify(
    items
      .sort((a, b) => a.sort_order - b.sort_order)
      .map((it) => ({
        name: it.name,
        qty: it.qty,
        unit: it.unit,
        unit_price: it.unit_price,
        vat_rate: it.vat_rate,
        line_total: it.line_total,
      })),
  );

  return {
    inv_number: inv.number || "",
    inv_vs: inv.variable_symbol || "",
    inv_issue_date: fmtDate(inv.issue_date),
    inv_due_date: fmtDate(inv.due_date),
    inv_taxable_date: fmtDate(inv.taxable_date),

    inv_supplier_name: inv.supplier_name || "",
    inv_supplier_ico: inv.supplier_ico || "",
    inv_supplier_dic: inv.supplier_dic || "",
    inv_supplier_address: inv.supplier_address || "",
    inv_supplier_email: inv.supplier_email || "",
    inv_supplier_phone: inv.supplier_phone || "",
    inv_supplier_bank: inv.supplier_bank_account || "",
    inv_supplier_iban: inv.supplier_iban || "",
    inv_supplier_swift: inv.supplier_swift || "",

    inv_customer_name: inv.customer_name || "",
    inv_customer_ico: inv.customer_ico || "",
    inv_customer_dic: inv.customer_dic || "",
    inv_customer_address: inv.customer_address || "",
    inv_customer_email: inv.customer_email || "",

    inv_items_json: itemsJson,
    inv_subtotal: formatCurrency(inv.subtotal, inv.currency),
    inv_vat: formatCurrency(inv.vat_amount, inv.currency),
    inv_total: formatCurrency(inv.total, inv.currency),
    inv_rounding: formatCurrency(inv.rounding, inv.currency),
    inv_currency: inv.currency,

    inv_notes: inv.notes || "",
    inv_spayd_qr: generateSpaydString(inv),
  };
}

/**
 * Generates a SPAYD (Short Payment Descriptor) string for CZ QR payment codes.
 * Format: SPD*1.0*ACC:{IBAN}*AM:{amount}*CC:{currency}*X-VS:{vs}*MSG:{message}
 */
function generateSpaydString(inv: Invoice): string {
  const iban = (inv.supplier_iban || "").replace(/\s/g, "");
  if (!iban) return "";

  const parts = ["SPD*1.0"];
  parts.push(`ACC:${iban}`);
  parts.push(`AM:${inv.total.toFixed(2)}`);
  parts.push(`CC:${inv.currency || "CZK"}`);
  if (inv.variable_symbol) parts.push(`X-VS:${inv.variable_symbol}`);
  const msg = `Faktura ${inv.number || ""}`.trim();
  if (msg) parts.push(`MSG:${msg}`);

  return parts.join("*");
}

export function companyDataToJobiDocsPayload(cd: CompanyData): Record<string, unknown> {
  return {
    name: cd.name,
    abbreviation: cd.abbreviation,
    ico: cd.ico,
    dic: cd.dic,
    addressStreet: cd.addressStreet,
    addressCity: cd.addressCity,
    addressZip: cd.addressZip,
    phone: cd.phone,
    email: cd.email,
    website: cd.website,
    bankAccount: cd.bankAccount,
    iban: cd.iban,
    swift: cd.swift,
  };
}
