/**
 * Data dokumentu pro JobiDocs (v2): typovaný objekt místo řetězců.
 *
 * Čísla jsou čísla, data ISO; formátování (Kč, datum, skloňování) dělá
 * renderer v JobiDocs, takže vypadá stejně v náhledu, na tiskárně
 * i ve webové verzi.
 */
import type { DocumentData, LineItem, Party } from "../../jobidocs/core/types";
import { ibanZCislaUctu } from "./banka";
import type { TicketEx } from "../pages/Orders";
import type { WarrantyClaimRow } from "../pages/Orders/hooks/useWarrantyClaims";
import type { CompanyData } from "./companyData";
import { portalUrl } from "./portal";
import type { Database } from "../types/supabase";

export type { DocumentData } from "../../jobidocs/core/types";

type Invoice = Database["public"]["Tables"]["invoices"]["Row"];
type InvoiceItem = Database["public"]["Tables"]["invoice_items"]["Row"];

const s = (v: unknown): string | undefined => (typeof v === "string" && v.trim() ? v.trim() : undefined);

export function serviceParty(cd: CompanyData | Record<string, unknown>): Party {
  const c = cd as Record<string, unknown>;
  const address = [s(c.addressStreet), [s(c.addressZip), s(c.addressCity)].filter(Boolean).join(" ")].filter(Boolean).join(", ");
  return {
    name: s(c.name) ?? s(c.abbreviation),
    ico: s(c.ico),
    dic: s(c.dic),
    address: address || undefined,
    phone: s(c.phone),
    email: s(c.email),
    web: s(c.website)?.replace(/^https?:\/\//, ""),
  };
}

function addressOf(street?: string | null, city?: string | null, zip?: string | null): string | undefined {
  const out = [s(street), [s(zip), s(city)].filter(Boolean).join(" ")].filter(Boolean).join(", ");
  return out || undefined;
}

/** Kontrola po opravě pro tisk; bez založené kontroly se blok v šabloně nevykreslí. */
function kontrolaDoDokumentu(kontrola: TicketEx["testChecklist"]): DocumentData["checklist"] {
  if (!kontrola || kontrola.polozky.length === 0) return undefined;
  const stav = { ok: "ok", chyba: "fail", neoverovano: "skipped" } as const;
  return {
    title: kontrola.sablonaNazev,
    items: kontrola.polozky.map((p) => ({ text: p.text, status: p.stav ? stav[p.stav] : null, note: p.poznamka?.trim() || undefined })),
  };
}

function repairsToItems(ticket: TicketEx): LineItem[] {
  return (ticket.performedRepairs ?? [])
    .filter((r) => r && (r.name ?? "").trim())
    .map((r) =>
      // Hodinová práce: hodiny × sazba, aby zákazník viděl, za co platí.
      r.type === "hourly" && (r.hodiny ?? 0) > 0
        ? { name: r.technik ? `${r.name} (${r.technik})` : r.name, qty: r.hodiny!, unit: "h", unitPrice: r.sazba ?? undefined, total: r.price ?? undefined }
        : { name: r.name, qty: 1, unit: "ks", unitPrice: r.price ?? undefined, total: r.price ?? undefined },
    );
}

/** Zakázkový list, záruční list, diagnostika. */
export function ticketDocumentData(ticket: TicketEx, cd: CompanyData | Record<string, unknown>, opts?: { completedAt?: string; warrantyMonths?: number }): DocumentData {
  const items = repairsToItems(ticket);
  const total = items.reduce((sum, it) => sum + (it.total ?? 0), 0);
  const hasPrices = items.some((it) => it.total != null);
  const t = ticket as TicketEx & { completedAt?: string | null; notes?: string; warrantyMonths?: number };
  const completed = opts?.completedAt ?? t.completedAt ?? undefined;
  const warrantyMonths = opts?.warrantyMonths ?? t.warrantyMonths;
  let warrantyUntil: string | undefined;
  if (warrantyMonths && completed) {
    const d = new Date(completed);
    d.setMonth(d.getMonth() + warrantyMonths);
    warrantyUntil = d.toISOString();
  }
  const portalToken = (ticket as TicketEx & { portalToken?: string | null }).portalToken;
  return {
    number: ticket.code ?? undefined,
    // Odkaz na zákaznický portál – tiskne se jako QR, když si to servis v JobiDocs zapne.
    portalUrl: portalToken ? portalUrl(portalToken) : undefined,
    service: serviceParty(cd),
    customer: {
      name: s(ticket.customerName),
      company: s(ticket.customerCompany),
      ico: s(ticket.customerIco),
      phone: s(ticket.customerPhone),
      email: s(ticket.customerEmail),
      address: addressOf(ticket.customerAddressStreet, ticket.customerAddressCity, ticket.customerAddressZip),
      note: s(ticket.customerInfo),
    },
    device: {
      name: s(ticket.deviceLabel),
      serial: s(ticket.serialOrImei),
      passcode: s(ticket.devicePasscode),
      condition: s(ticket.deviceCondition),
      accessories: s(ticket.deviceAccessories),
      issue: s(ticket.requestedRepair) ?? s(ticket.issueShort),
      note: s(ticket.deviceNote),
    },
    dates: {
      received: ticket.createdAt,
      eta: s(ticket.expectedDoneAt),
      completed,
      diagnosed: ticket.diagnosticText ? new Date().toISOString() : undefined,
    },
    handoff: { receive: s(ticket.handoffMethod), return: s(ticket.handbackMethod) },
    items,
    discount: ticket.discountType && ticket.discountValue ? { type: ticket.discountType, value: ticket.discountValue } : undefined,
    totals: {
      total: hasPrices ? total : undefined,
      estimated: ticket.estimatedPrice ?? undefined,
      currency: "CZK",
    },
    diagnostic: s(ticket.diagnosticText),
    checklist: kontrolaDoDokumentu(ticket.testChecklist),
    note: s(t.notes),
    photos: (ticket.diagnosticPhotos ?? []).filter((u) => typeof u === "string" && u.trim()),
    warranty: warrantyMonths ? { months: warrantyMonths, until: warrantyUntil } : undefined,
    extra: { external_id: ticket.externalId ?? "" },
  };
}

/** Příjemka / výdejka reklamace. */
export function claimDocumentData(claim: WarrantyClaimRow, cd: CompanyData | Record<string, unknown>, originalTicketCode = ""): DocumentData {
  let items: LineItem[] = [];
  if (claim.resolution_summary?.trim().startsWith("[")) {
    try {
      const arr = JSON.parse(claim.resolution_summary) as Array<{ name?: string; price?: number }>;
      items = arr.filter((x) => x && x.name).map((x) => ({ name: String(x.name), qty: 1, unit: "ks", unitPrice: x.price, total: x.price }));
    } catch {
      items = [];
    }
  }
  return {
    number: claim.code,
    relatedNumber: originalTicketCode || undefined,
    service: serviceParty(cd),
    customer: {
      name: s(claim.customer_name),
      company: s(claim.customer_company),
      ico: s(claim.customer_ico),
      phone: s(claim.customer_phone),
      email: s(claim.customer_email),
      address: addressOf(claim.customer_address_street, claim.customer_address_city, claim.customer_address_zip),
    },
    device: {
      name: s(claim.device_label) ?? [s(claim.device_brand), s(claim.device_model)].filter(Boolean).join(" ") ?? undefined,
      serial: s(claim.device_serial),
      imei: s(claim.device_imei),
      passcode: s(claim.device_passcode),
      condition: s(claim.device_condition),
      accessories: s(claim.device_accessories),
      issue: s(claim.notes),
      note: s(claim.device_note),
    },
    dates: {
      received: s(claim.received_at) ?? claim.created_at,
      released: s(claim.released_at),
      completed: s(claim.completed_at),
      eta: s(claim.expected_completion_at),
    },
    items,
    totals: { currency: "CZK" },
    note: items.length ? undefined : s(claim.resolution_summary),
  };
}

type InvoiceKind = "invoice" | "proforma" | "credit_note";

/** Nadpis dokladu podle druhu; „daňový doklad“ smí na fakturu psát jen plátce DPH. */
export function nadpisDokladu(kind: InvoiceKind, vatPayer: boolean): string {
  if (kind === "proforma") return "Zálohová faktura";
  if (kind === "credit_note") return "Dobropis";
  return vatPayer ? "Faktura – daňový doklad" : "Faktura";
}

/**
 * Faktura, zálohová faktura nebo dobropis (podle inv.kind).
 *
 * `souvisejiciCislo` je číslo původní faktury u dobropisu, resp. zálohy
 * u vyúčtovací faktury – jde do textu dokladu a do {{extra.souvisejiciDoklad}}.
 */
export function invoiceDocumentData(inv: Invoice, items: InvoiceItem[], cd: CompanyData, vatPayer = true, ticketCode?: string, souvisejiciCislo?: string): DocumentData {
  const kind: InvoiceKind = inv.kind === "proforma" || inv.kind === "credit_note" ? inv.kind : "invoice";
  const sorted = [...items].sort((a, b) => a.sort_order - b.sort_order);
  // QR platba chce IBAN; když servis vyplnil jen číslo účtu, odvodí se z něj.
  const iban = (inv.supplier_iban || cd.iban || "").replace(/\s/g, "") || ibanZCislaUctu(inv.supplier_bank_account ?? cd.bankAccount) || "";
  // SPAYD jen pro kladnou částku – dobropis (a vyúčtování na nulu) nikdo neplatí.
  const spayd = iban && inv.total > 0
    ? ["SPD*1.0", `ACC:${iban}`, `AM:${inv.total.toFixed(2)}`, `CC:${inv.currency || "CZK"}`, inv.variable_symbol ? `X-VS:${inv.variable_symbol}` : "", `MSG:${kind === "proforma" ? "Zaloha" : "Faktura"} ${inv.number}`].filter(Boolean).join("*")
    : undefined;
  // Vazba na původní doklad musí být na dobropisu vždy, i když si uživatel poznámku přepsal.
  const vazba = kind === "credit_note" && souvisejiciCislo ? `Dobropis k faktuře ${souvisejiciCislo}` : undefined;
  const poznamka = s(inv.notes);
  const note = vazba && !poznamka?.includes(souvisejiciCislo!) ? [vazba, poznamka].filter(Boolean).join("\n") : poznamka ?? vazba;
  return {
    title: nadpisDokladu(kind, vatPayer),
    number: inv.number,
    relatedNumber: ticketCode,
    service: {
      name: s(inv.supplier_name) ?? s(cd.name),
      ico: s(inv.supplier_ico) ?? s(cd.ico),
      dic: s(inv.supplier_dic) ?? s(cd.dic),
      address: s(inv.supplier_address) ?? serviceParty(cd).address,
      phone: s(inv.supplier_phone) ?? s(cd.phone),
      email: s(inv.supplier_email) ?? s(cd.email),
      web: s(cd.website)?.replace(/^https?:\/\//, ""),
    },
    customer: {
      name: s(inv.customer_name),
      ico: s(inv.customer_ico),
      dic: s(inv.customer_dic),
      address: s(inv.customer_address),
      email: s(inv.customer_email),
      phone: s(inv.customer_phone),
    },
    // Záloha není zdanitelné plnění – DUZP na ní být nesmí.
    dates: { issued: inv.issue_date, due: inv.due_date, taxable: kind === "proforma" ? undefined : s(inv.taxable_date) },
    items: sorted.map((it) => ({ name: it.name, qty: it.qty, unit: it.unit, unitPrice: it.unit_price, vatRate: it.vat_rate, total: it.line_total })),
    totals: { subtotal: inv.subtotal, vat: inv.vat_amount, total: inv.total, rounding: inv.rounding || undefined, currency: inv.currency || "CZK", vatPayer },
    note,
    payment: {
      account: s(inv.supplier_bank_account) ?? s(cd.bankAccount),
      iban: s(inv.supplier_iban) ?? s(cd.iban),
      swift: s(inv.supplier_swift) ?? s(cd.swift),
      vs: s(inv.variable_symbol),
      spayd,
    },
    extra: { druhDokladu: kind, souvisejiciDoklad: souvisejiciCislo ?? "" },
  };
}
