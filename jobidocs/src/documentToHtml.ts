/**
 * Generate print-ready A4 HTML for JobiDocs API /v1/render.
 * Uses Electron Chromium for proper PDF rendering – single page, centered, no overflow.
 * Design tokeny a layout spec ze sdíleného modulu documentDesign.
 */

import { getDesignStyles, type DocumentDesign, type SectionStyle } from "./documentDesign";
import { sanitizeRichText } from "./richText";

type DocTypeKey = "zakazkovy_list" | "zarucni_list" | "diagnosticky_protokol" | "prijemka_reklamace" | "vydejka_reklamace" | "faktura";
type DocTypeUI = "ticketList" | "diagnosticProtocol" | "warrantyCertificate" | "prijemkaReklamace" | "vydejkaReklamace" | "faktura";

const DOC_TYPE_TO_UI: Record<DocTypeKey, DocTypeUI> = {
  zakazkovy_list: "ticketList",
  zarucni_list: "warrantyCertificate",
  diagnosticky_protokol: "diagnosticProtocol",
  prijemka_reklamace: "prijemkaReklamace",
  vydejka_reklamace: "vydejkaReklamace",
  faktura: "faktura",
};

const DOC_TYPE_LABELS: Record<DocTypeKey, string> = {
  zakazkovy_list: "Zakázkový list",
  zarucni_list: "Záruční list",
  diagnosticky_protokol: "Diagnostický protokol",
  prijemka_reklamace: "Příjemka reklamace",
  vydejka_reklamace: "Výdejka reklamace",
  faktura: "Faktura",
};

const DEFAULT_SECTION_ORDER: Record<DocTypeUI, string[]> = {
  ticketList: ["service", "customer", "device", "repairs", "diag", "photos", "dates"],
  diagnosticProtocol: ["device", "service", "diag", "photos", "dates", "custom-adca988a-f92e-497d-8910-3d904936ed61"],
  warrantyCertificate: ["device", "service", "repairs", "warranty", "dates", "custom-5bbd72cc-33a7-405b-a0a3-e726af943779"],
  prijemkaReklamace: ["service", "customer", "device", "dates"],
  vydejkaReklamace: ["service", "customer", "dates", "device", "repairs"],
  faktura: ["invoice_supplier", "invoice_customer", "invoice_meta", "invoice_items", "invoice_summary", "invoice_payment"],
};

type ServiceSectionFields = { name?: boolean; ico?: boolean; dic?: boolean; address?: boolean; phone?: boolean; email?: boolean; website?: boolean };

function serviceContentHtml(companyData: Record<string, unknown>, visibleFields?: ServiceSectionFields | null): string {
  const show = (key: keyof ServiceSectionFields) => visibleFields?.[key] !== false;
  const n = (v: unknown) => (v && String(v).trim() ? String(v) : null);
  const name = n(companyData.name) || n(companyData.abbreviation);
  const ico = n(companyData.ico);
  const dic = n(companyData.dic);
  const address = [n(companyData.addressStreet), n(companyData.addressCity), n(companyData.addressZip)].filter(Boolean).join(", ");
  const phone = n(companyData.phone);
  const email = n(companyData.email);
  const website = n(companyData.website);
  const parts: string[] = [];
  if (show("name") && name) parts.push(`<div style="font-weight:600;margin-bottom:2px">${escapeHtml(name)}</div>`);
  if (show("ico") || show("dic")) {
    const icoDic = [show("ico") && ico && `IČO: ${escapeHtml(ico)}`, show("dic") && dic && `DIČ: ${escapeHtml(dic)}`].filter(Boolean).join(" · ");
    if (icoDic) parts.push(`<div style="opacity:0.7">${icoDic}</div>`);
  }
  if (show("address") && address) parts.push(`<div>${escapeHtml(address)}</div>`);
  if (show("phone") || show("email") || show("website")) {
    const contact = [show("phone") && phone, show("email") && email, show("website") && website].filter((x): x is string => !!x).map(escapeHtml).join(" · ");
    if (contact) parts.push(`<div style="opacity:0.7">${contact}</div>`);
  }
  if (parts.length === 0) return '<div style="color:#9ca3af;font-size:9px">Vyplňte údaje v Jobi → Nastavení → Servis</div>';
  return parts.join("");
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

type CustomerSectionFields = { name?: boolean; phone?: boolean; email?: boolean; address?: boolean };
type DeviceSectionFields = { name?: boolean; serial?: boolean; imei?: boolean; state?: boolean; problem?: boolean };

function customerContentHtml(data: Record<string, unknown>, visibleFields?: CustomerSectionFields | null, useSampleFallbacks: boolean = true): string {
  const show = (k: keyof CustomerSectionFields) => visibleFields?.[k] !== false;
  const n = (v: unknown) => (v != null && String(v).trim() ? String(v) : null);
  const name = n(data.customer_name) || (useSampleFallbacks ? "Jan Novák" : null);
  const phone = n(data.customer_phone) || (useSampleFallbacks ? "+420 123 456 789" : null);
  const email = n(data.customer_email) || (useSampleFallbacks ? "jan.novak@email.cz" : null);
  const address = n(data.customer_address) || (useSampleFallbacks ? "Havlíčkova 45, 110 00 Praha 1" : null);
  const parts: string[] = [];
  if (show("name") && name) parts.push(`<div style="font-weight:600;margin-bottom:2px">${escapeHtml(name)}</div>`);
  if (show("phone") && phone) parts.push(`<div>${escapeHtml(phone)}</div>`);
  if (show("email") && email) parts.push(`<div style="opacity:0.7">${escapeHtml(email)}</div>`);
  if (show("address") && address) parts.push(`<div>${escapeHtml(address)}</div>`);
  return parts.join("");
}

function deviceContentHtml(data: Record<string, unknown>, visibleFields?: DeviceSectionFields | null, useSampleFallbacks: boolean = true): string {
  const show = (k: keyof DeviceSectionFields) => visibleFields?.[k] !== false;
  const n = (v: unknown) => (v != null && String(v).trim() ? String(v) : null);
  const name = n(data.device_name) || (useSampleFallbacks ? "iPhone 13 Pro, 128 GB" : null);
  const serial = n(data.device_serial) || (useSampleFallbacks ? "SN123456789012" : null);
  const imei = n(data.device_imei) || (useSampleFallbacks ? "35 123456 789012 3" : null);
  const state = n(data.device_state) || (useSampleFallbacks ? "Poškozený displej, prasklina v rohu" : null);
  const problem = n(data.device_problem) || (useSampleFallbacks ? "Nefunguje dotyková vrstva v levém dolním rohu" : null);
  const parts: string[] = [];
  if (show("name") && name) parts.push(`<div style="font-weight:600;margin-bottom:2px">${escapeHtml(name)}</div>`);
  if (show("serial") && serial) parts.push(`<div><span style="opacity:0.5;font-size:9px">SN</span> <span style="font-variant-numeric:tabular-nums">${escapeHtml(serial)}</span></div>`);
  if (show("imei") && imei) parts.push(`<div><span style="opacity:0.5;font-size:9px">IMEI</span> <span style="font-variant-numeric:tabular-nums">${escapeHtml(imei)}</span></div>`);
  if (show("state") && state) parts.push(`<div style="margin-top:4px"><span style="opacity:0.5;font-size:9px">Stav:</span> ${escapeHtml(state)}</div>`);
  if (show("problem") && problem) parts.push(`<div><span style="opacity:0.5;font-size:9px">Problém:</span> ${escapeHtml(problem)}</div>`);
  return parts.join("");
}

/** Sloupce tabulky „Provedené opravy“ – Jobi pošle repair_items (JSON pole objektů s name, price, quantity). */
const REPAIRS_COLUMN_LABELS: Record<string, string> = {
  name: "Název",
  price: "Cena",
  quantity: "Množství",
  unit: "Jednotka",
  total: "Celkem",
};

function repairsTableHtml(
  repairItems: Array<Record<string, unknown>>,
  columns: string[],
  styles: { sectionBorder: string; contentColor: string }
): string {
  if (repairItems.length === 0 || columns.length === 0) return "";
  const isNumeric = (col: string) => col === "price" || col === "quantity" || col === "total";
  const thead = columns.map((col) => `<th style="text-align:${isNumeric(col) ? "right" : "left"};padding:8px 10px;border-bottom:2px solid ${styles.sectionBorder};font-weight:700;font-size:9px;text-transform:uppercase;letter-spacing:0.04em;color:${styles.contentColor};opacity:0.7">${escapeHtml(REPAIRS_COLUMN_LABELS[col] ?? col)}</th>`).join("");
  const rows = repairItems.map((row, idx) =>
    columns.map((col) => {
      const val = row[col];
      const text = val != null ? String(val) : "";
      return `<td style="text-align:${isNumeric(col) ? "right" : "left"};padding:7px 10px;border-bottom:1px solid ${styles.sectionBorder};font-size:10px;color:${styles.contentColor};${idx % 2 === 1 ? `background:rgba(0,0,0,0.02)` : ""}">${escapeHtml(text)}</td>`;
    }).join("")
  ).map((row) => `<tr>${row}</tr>`).join("");
  return `<table style="width:100%;border-collapse:collapse"><thead><tr>${thead}</tr></thead><tbody>${rows}</tbody></table>`;
}

const SECTION_CONTENT_HTML: Record<string, string> = {
  customer: "",
  device: "",
  repairs: `<div style="display:flex;justify-content:space-between;gap:12px;width:100%;padding:4px 0;border-bottom:1px solid rgba(0,0,0,0.06)"><span>Výměna displeje</span><span style="white-space:nowrap;font-variant-numeric:tabular-nums">2 500 Kč</span></div><div style="display:flex;justify-content:space-between;gap:12px;width:100%;padding:4px 0;border-bottom:1px solid rgba(0,0,0,0.06)"><span>Kalibrace dotykové vrstvy</span><span style="white-space:nowrap;font-variant-numeric:tabular-nums">500 Kč</span></div><div style="margin-top:8px;padding-top:8px;border-top:2px solid rgba(0,0,0,0.15);display:flex;justify-content:space-between;gap:12px;width:100%;font-weight:700;font-size:12px"><span>Celková cena</span><span style="white-space:nowrap;font-variant-numeric:tabular-nums">3 000 Kč</span></div>`,
  diag: `<div>Displej je mechanicky poškozený v levém dolním rohu. Dotyková vrstva nefunguje v oblasti cca 2×2 cm.</div><div style="margin-top:4px">Doporučena výměna displeje. Záruka na opravu 12 měsíců.</div>`,
  photos: `<div style="display:flex;gap:8px;flex-wrap:wrap"><div style="width:56px;height:56px;background:#f3f4f6;border:1px dashed #d1d5db;border-radius:4px;display:flex;align-items:center;justify-content:center;font-size:8px;color:#9ca3af">Foto 1</div><div style="width:56px;height:56px;background:#f3f4f6;border:1px dashed #d1d5db;border-radius:4px;display:flex;align-items:center;justify-content:center;font-size:8px;color:#9ca3af">Foto 2</div></div>`,
  dates: `<div style="display:flex;justify-content:space-between;padding:3px 0;border-bottom:1px solid rgba(0,0,0,0.04)"><span style="opacity:0.5">Přijato</span><span>8. 2. 2025</span></div><div style="display:flex;justify-content:space-between;padding:3px 0;border-bottom:1px solid rgba(0,0,0,0.04)"><span style="opacity:0.5">Dokončení</span><span>10. 2. 2025</span></div><div style="display:flex;justify-content:space-between;padding:3px 0"><span style="opacity:0.5">Kód zakázky</span><span style="font-weight:600">DEMO-001</span></div>`,
};

/** Z řetězce sekce dates (HTML) vytáhne číslo zakázky (Kód zakázky: XXX nebo Číslo zakázky: XXX). */
function extractTicketCodeFromDates(datesHtml: string | undefined): string | null {
  if (!datesHtml || typeof datesHtml !== "string") return null;
  const match = datesHtml.match(/(?:Kód zakázky|Číslo zakázky):\s*([^<]+)/);
  return match ? match[1].trim() || null : null;
}

const SECTION_LABELS: Record<string, string> = {
  service: "Údaje o servisu",
  customer: "Údaje o zákazníkovi",
  device: "Údaje o zařízení",
  repairs: "Provedené opravy",
  warranty: "Záruka",
  diag: "Diagnostika",
  photos: "Fotky",
  dates: "Data",
  invoice_supplier: "Dodavatel",
  invoice_customer: "Odběratel",
  invoice_meta: "Fakturační údaje",
  invoice_items: "Položky",
  invoice_summary: "Rekapitulace DPH",
  invoice_payment: "Platební údaje",
};

/** Optional override HTML for each section (customer, device, repairs, diag, photos, dates). Used when printing from Jobi with real ticket data. */
export type SectionOverrides = Partial<Record<string, string>>;

/** Při tisku záručního listu z Jobi: datum opravy (ISO). variables: substituce pro vlastní texty. templateMode: místo dat zobrazit placeholdery {{var}}. useSampleFallbacks: false = tisk z Jobi – žádné ukázkové texty, prázdné sekce se nevykreslí (výstup = stejný vzhled jako náhled). */
export type GenerateDocumentHtmlOptions = { repairDate?: string; variables?: Record<string, string>; templateMode?: boolean; useSampleFallbacks?: boolean; interactive?: boolean };

const TEMPLATE_PLACEHOLDERS_BY_SECTION: Record<string, string[]> = {
  service: ["service_name", "service_ico", "service_dic", "service_address", "service_phone", "service_email"],
  customer: ["customer_name", "customer_phone", "customer_email", "customer_address"],
  device: ["device_name", "device_serial", "device_imei", "device_state", "device_problem"],
  repairs: ["total_price"],
  diag: ["diagnostic_text"],
  dates: ["ticket_code", "repair_date", "repair_completion_date", "complaint_code", "original_ticket_code"],
  warranty: ["warranty_until"],
  invoice_supplier: ["inv_supplier_name", "inv_supplier_ico", "inv_supplier_dic", "inv_supplier_address"],
  invoice_customer: ["inv_customer_name", "inv_customer_ico", "inv_customer_dic", "inv_customer_address"],
  invoice_meta: ["inv_number", "inv_date_issued", "inv_date_due", "inv_date_taxable", "inv_vs", "inv_order_number"],
  invoice_items: ["inv_items_json"],
  invoice_summary: ["inv_subtotal", "inv_vat_amount", "inv_total"],
  invoice_payment: ["inv_iban", "inv_bank_code", "inv_account_number", "inv_vs"],
};
const SECTION_FIELD_KEY_TO_VAR_INDEX: Record<string, Record<string, number>> = {
  service: { name: 0, ico: 1, dic: 2, address: 3, phone: 4, email: 5 },
  customer: { name: 0, phone: 1, email: 2, address: 3 },
  device: { name: 0, serial: 1, imei: 2, state: 3, problem: 4 },
};

function templateSectionContentHtml(
  key: string,
  docConfig: Record<string, unknown>
): string {
  const varsList = TEMPLATE_PLACEHOLDERS_BY_SECTION[key];
  if (!varsList) return "";
  const sectionFields = (docConfig.sectionFields as Record<string, Record<string, boolean>> | undefined)?.[key];
  const fieldToIndex = SECTION_FIELD_KEY_TO_VAR_INDEX[key];
  let placeholders = varsList;
  if (sectionFields && fieldToIndex) {
    placeholders = varsList.filter((_, i) => {
      const fieldKey = Object.keys(fieldToIndex).find((k) => fieldToIndex[k] === i);
      return fieldKey == null || sectionFields[fieldKey] !== false;
    });
  }
  if (placeholders.length === 0 && key !== "photos") return "";
  if (key === "photos") return '<div style="font-size:10px;color:#9ca3af">Fotky z Jobi</div>';
  return placeholders.map((v) => `<div style="font-family:monospace;font-size:10px;color:#6b7280">{{${v}}}</div>`).join("");
}

/** České skloňování: 1 měsíc, 2 měsíce, 5 měsíců, 21 měsíc, 22 měsíce, 12 měsíců. */
function warrantyUnitText(n: number, unit: "days" | "months" | "years"): string {
  const mod10 = n % 10;
  const mod100 = n % 100;
  const singular = mod10 === 1 && mod100 !== 11; // 1, 21, 31, 101 … ale ne 11, 111
  const few = mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14); // 2–4, 22–24, 32–34 …
  if (unit === "days") {
    if (singular) return "den";
    if (few) return "dny";
    return "dnů";
  }
  if (unit === "months") {
    if (singular) return "měsíc";
    if (few) return "měsíce";
    return "měsíců";
  }
  if (singular) return "rok";
  if (few) return "roky";
  return "let";
}

type WarrantyItem = { label: string; duration: number; unit: "days" | "months" | "years" };

function warrantySectionHtml(docConfig: Record<string, unknown>, repairDate: Date): string {
  const duration = (docConfig.warrantyUnifiedDuration as number) ?? 24;
  const unit = (docConfig.warrantyUnifiedUnit as "days" | "months" | "years") ?? "months";
  const showEndDate = (docConfig.warrantyShowEndDate as boolean) !== false;
  const extraText = (docConfig.warrantyExtraText as string)?.trim() ?? "";
  const items = (docConfig.warrantyItems as WarrantyItem[] | undefined) ?? [];

  let html = "";

  const unitText = warrantyUnitText(duration, unit);
  const sentence = `Záruční doba činí ${duration} ${unitText}.`;
  html += `<div>${escapeHtml(sentence)}</div>`;
  if (showEndDate) {
    let days = 0;
    if (unit === "days") days = duration;
    else if (unit === "months") days = duration * 30;
    else days = duration * 365;
    const warrantyUntil = new Date(repairDate.getTime() + days * 24 * 60 * 60 * 1000);
    html += `<div style="margin-top:8px"><span style="font-weight:600">Záruka do: </span><span>${escapeHtml(warrantyUntil.toLocaleDateString("cs-CZ"))}</span></div>`;
  }

  if (extraText) {
    html += `<div style="margin-top:10px">${escapeHtml(extraText)}</div>`;
  }

  items.forEach((it) => {
    const d = typeof it.duration === "number" ? it.duration : 12;
    const u = (it.unit === "days" || it.unit === "months" || it.unit === "years" ? it.unit : "months") as "days" | "months" | "years";
    const ut = warrantyUnitText(d, u);
    const label = (it.label && String(it.label).trim()) || "Záruka";
    const itemShowEndDate = (it as { showEndDate?: boolean }).showEndDate !== false;
    let line = `${label}: ${d} ${ut}.`;
    if (itemShowEndDate) {
      let addDays = 0;
      if (u === "days") addDays = d;
      else if (u === "months") addDays = d * 30;
      else addDays = d * 365;
      const until = new Date(repairDate.getTime() + addDays * 24 * 60 * 60 * 1000);
      line += ` Záruka do: ${until.toLocaleDateString("cs-CZ")}`;
    }
    html += `<div style="margin-top:6px">${escapeHtml(line)}</div>`;
  });

  return html;
}

function invoiceSupplierHtml(companyData: Record<string, unknown>, vars: Record<string, string>, useSample: boolean): string {
  const n = (v: unknown) => (v && String(v).trim() ? String(v).trim() : null);
  const name = n(vars.inv_supplier_name) || n(companyData.name) || (useSample ? "Servis Praha s.r.o." : null);
  const ico = n(vars.inv_supplier_ico) || n(companyData.ico) || (useSample ? "12345678" : null);
  const dic = n(vars.inv_supplier_dic) || n(companyData.dic) || (useSample ? "CZ12345678" : null);
  const addr = n(vars.inv_supplier_address) || [n(companyData.addressStreet), n(companyData.addressCity), n(companyData.addressZip)].filter(Boolean).join(", ") || (useSample ? "Havlíčkova 45, 110 00 Praha 1" : null);
  const parts: string[] = [];
  if (name) parts.push(`<div style="font-weight:700;font-size:12px;margin-bottom:2px">${escapeHtml(name)}</div>`);
  if (ico) parts.push(`<div>IČO: ${escapeHtml(ico)}</div>`);
  if (dic) parts.push(`<div>DIČ: ${escapeHtml(dic)}</div>`);
  if (addr) parts.push(`<div>${escapeHtml(addr)}</div>`);
  return parts.join("");
}

function invoiceCustomerHtml(vars: Record<string, string>, useSample: boolean): string {
  const n = (k: string) => (vars[k] && String(vars[k]).trim()) || null;
  const name = n("inv_customer_name") || n("customer_name") || (useSample ? "Jan Novák" : null);
  const ico = n("inv_customer_ico") || (useSample ? "87654321" : null);
  const dic = n("inv_customer_dic") || (useSample ? "CZ87654321" : null);
  const addr = n("inv_customer_address") || n("customer_address") || (useSample ? "Karlova 12, 120 00 Praha 2" : null);
  const parts: string[] = [];
  if (name) parts.push(`<div style="font-weight:700;font-size:12px;margin-bottom:2px">${escapeHtml(name)}</div>`);
  if (ico) parts.push(`<div>IČO: ${escapeHtml(ico)}</div>`);
  if (dic) parts.push(`<div>DIČ: ${escapeHtml(dic)}</div>`);
  if (addr) parts.push(`<div>${escapeHtml(addr)}</div>`);
  return parts.join("");
}

function invoiceMetaHtml(vars: Record<string, string>, useSample: boolean): string {
  const n = (k: string) => vars[k]?.trim() || null;
  const rows: [string, string][] = [];
  const invNum = n("inv_number") || (useSample ? "FV-2026-001" : null);
  const issued = n("inv_date_issued") || n("inv_issue_date") || (useSample ? new Date().toLocaleDateString("cs-CZ") : null);
  const due = n("inv_date_due") || n("inv_due_date") || (useSample ? new Date(Date.now() + 14 * 86400000).toLocaleDateString("cs-CZ") : null);
  const taxable = n("inv_date_taxable") || n("inv_taxable_date") || (useSample ? new Date().toLocaleDateString("cs-CZ") : null);
  const vs = n("inv_vs") || (useSample ? "2026001" : null);
  const order = n("inv_order_number");
  if (invNum) rows.push(["Číslo faktury", invNum]);
  if (issued) rows.push(["Datum vystavení", issued]);
  if (taxable) rows.push(["Datum zdaň. plnění", taxable]);
  if (due) rows.push(["Datum splatnosti", due]);
  if (vs) rows.push(["Variabilní symbol", vs]);
  if (order) rows.push(["Číslo objednávky", order]);
  return rows.map(([l, v]) => `<div style="display:flex;justify-content:space-between;padding:3px 0;border-bottom:1px solid rgba(0,0,0,0.06)"><span style="color:rgba(0,0,0,0.5)">${escapeHtml(l)}</span><span style="font-weight:600;font-variant-numeric:tabular-nums">${escapeHtml(v)}</span></div>`).join("");
}

interface InvoiceItem { name: string; qty: number; unit: string; unitPrice: number; vatRate: number; total: number }

function invoiceItemsTableHtml(vars: Record<string, string>, styles: { sectionBorder: string; contentColor: string }, useSample: boolean): string {
  let items: InvoiceItem[] = [];
  try {
    const raw = vars.inv_items_json;
    if (raw) {
      const parsed = JSON.parse(raw) as Array<Record<string, unknown> | null | undefined>;
      items = (parsed || [])
        .filter((it): it is Record<string, unknown> => it != null && typeof it === "object")
        .map((it) => {
          const up = it.unitPrice ?? it.unit_price;
          const tot = it.total ?? it.line_total;
          const vr = it.vatRate ?? it.vat_rate;
          return {
            name: String(it.name ?? it.nazev ?? ""),
            qty: Number(it.qty ?? it.mnozstvi ?? 0) || 0,
            unit: String(it.unit ?? it.jednotka ?? "ks"),
            unitPrice: typeof up === "number" && !Number.isNaN(up) ? up : Number(up) || 0,
            vatRate: typeof vr === "number" && !Number.isNaN(vr) ? vr : Number(vr) || 0,
            total: typeof tot === "number" && !Number.isNaN(tot) ? tot : Number(tot) || 0,
          };
        });
    }
  } catch { /* ignore */ }
  if (items.length === 0 && useSample) {
    items = [
      { name: "Výměna displeje iPhone 13 Pro", qty: 1, unit: "ks", unitPrice: 3500, vatRate: 21, total: 4235 },
      { name: "Ochranné sklo", qty: 1, unit: "ks", unitPrice: 299, vatRate: 21, total: 361.79 },
      { name: "Práce - diagnostika a montáž", qty: 1.5, unit: "hod", unitPrice: 500, vatRate: 21, total: 907.5 },
    ];
  }
  if (items.length === 0) return "";
  try {
  const fmt = (n: unknown) => {
    const num = typeof n === "number" && !Number.isNaN(n) ? n : Number(n);
    return (Number.isFinite(num) ? num : 0).toLocaleString("cs-CZ", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  };
  const thead = `<tr><th style="text-align:left;padding:8px 10px;border-bottom:2px solid ${styles.sectionBorder};font-weight:700;font-size:9px;text-transform:uppercase;letter-spacing:0.04em;opacity:0.7">Položka</th><th style="text-align:right;padding:8px 6px;border-bottom:2px solid ${styles.sectionBorder};font-weight:700;font-size:9px;text-transform:uppercase;letter-spacing:0.04em;opacity:0.7">Množství</th><th style="text-align:center;padding:8px 6px;border-bottom:2px solid ${styles.sectionBorder};font-weight:700;font-size:9px;text-transform:uppercase;letter-spacing:0.04em;opacity:0.7">Jedn.</th><th style="text-align:right;padding:8px 6px;border-bottom:2px solid ${styles.sectionBorder};font-weight:700;font-size:9px;text-transform:uppercase;letter-spacing:0.04em;opacity:0.7">Cena/ks</th><th style="text-align:right;padding:8px 6px;border-bottom:2px solid ${styles.sectionBorder};font-weight:700;font-size:9px;text-transform:uppercase;letter-spacing:0.04em;opacity:0.7">DPH</th><th style="text-align:right;padding:8px 10px;border-bottom:2px solid ${styles.sectionBorder};font-weight:700;font-size:9px;text-transform:uppercase;letter-spacing:0.04em;opacity:0.7">Celkem</th></tr>`;
  const rows = items.map((it, idx) => `<tr${idx % 2 === 1 ? ' style="background:rgba(0,0,0,0.02)"' : ""}><td style="padding:7px 10px;border-bottom:1px solid ${styles.sectionBorder};font-size:10px">${escapeHtml(it.name)}</td><td style="text-align:right;padding:7px 6px;border-bottom:1px solid ${styles.sectionBorder};font-size:10px;font-variant-numeric:tabular-nums">${it.qty}</td><td style="text-align:center;padding:7px 6px;border-bottom:1px solid ${styles.sectionBorder};font-size:10px">${escapeHtml(it.unit)}</td><td style="text-align:right;padding:7px 6px;border-bottom:1px solid ${styles.sectionBorder};font-size:10px;font-variant-numeric:tabular-nums">${fmt(it.unitPrice)} Kč</td><td style="text-align:right;padding:7px 6px;border-bottom:1px solid ${styles.sectionBorder};font-size:10px">${it.vatRate}%</td><td style="text-align:right;padding:7px 10px;border-bottom:1px solid ${styles.sectionBorder};font-size:10px;font-weight:600;font-variant-numeric:tabular-nums">${fmt(it.total)} Kč</td></tr>`).join("");
  return `<table style="width:100%;border-collapse:collapse"><thead>${thead}</thead><tbody>${rows}</tbody></table>`;
  } catch (e) {
    return `<p style="font-size:10px;color:rgba(0,0,0,0.5)">Položky se nepodařilo zobrazit.</p>`;
  }
}

function invoiceSummaryHtml(vars: Record<string, string>, styles: { contentColor: string }, useSample: boolean): string {
  const n = (k: string) => vars[k]?.trim() || null;
  const subtotal = n("inv_subtotal") || (useSample ? "4 299,00" : null);
  const vatAmount = n("inv_vat_amount") || (useSample ? "904,79" : null);
  const total = n("inv_total") || (useSample ? "5 203,79" : null);
  const rows: string[] = [];
  if (subtotal) rows.push(`<div style="display:flex;justify-content:space-between;padding:4px 0"><span>Základ</span><span style="font-variant-numeric:tabular-nums">${escapeHtml(subtotal)} Kč</span></div>`);
  if (vatAmount) rows.push(`<div style="display:flex;justify-content:space-between;padding:4px 0"><span>DPH 21%</span><span style="font-variant-numeric:tabular-nums">${escapeHtml(vatAmount)} Kč</span></div>`);
  if (total) rows.push(`<div style="display:flex;justify-content:space-between;padding:8px 0;margin-top:4px;border-top:2px solid ${styles.contentColor};font-weight:800;font-size:13px"><span>Celkem k úhradě</span><span style="font-variant-numeric:tabular-nums">${escapeHtml(total)} Kč</span></div>`);
  return rows.join("");
}

function invoicePaymentHtml(vars: Record<string, string>, companyData: Record<string, unknown>, useSample: boolean): string {
  const n = (v: unknown) => (v && String(v).trim() ? String(v).trim() : null);
  const iban = n(vars.inv_supplier_iban) || n(companyData.iban) || (useSample ? "CZ65 0800 0000 1920 0014 5399" : null);
  const bankAccount = n(vars.inv_supplier_bank) || n(companyData.bankAccount) || (useSample ? "19-2000145399/0800" : null);
  const swift = n(vars.inv_supplier_swift) || n(companyData.swift) || null;
  const vs = n(vars.inv_vs) || (useSample ? "2026001" : null);
  const spayd = n(vars.inv_spayd_qr);

  const rows: string[] = [];
  if (bankAccount) rows.push(`<div style="display:flex;justify-content:space-between;padding:3px 0"><span style="color:rgba(0,0,0,0.5)">Číslo účtu</span><span style="font-weight:600">${escapeHtml(bankAccount)}</span></div>`);
  if (iban) rows.push(`<div style="display:flex;justify-content:space-between;padding:3px 0"><span style="color:rgba(0,0,0,0.5)">IBAN</span><span style="font-weight:600;font-variant-numeric:tabular-nums;font-size:9px;letter-spacing:0.05em">${escapeHtml(iban)}</span></div>`);
  if (swift) rows.push(`<div style="display:flex;justify-content:space-between;padding:3px 0"><span style="color:rgba(0,0,0,0.5)">SWIFT</span><span style="font-weight:600">${escapeHtml(swift)}</span></div>`);
  if (vs) rows.push(`<div style="display:flex;justify-content:space-between;padding:3px 0"><span style="color:rgba(0,0,0,0.5)">VS</span><span style="font-weight:600;font-variant-numeric:tabular-nums">${escapeHtml(vs)}</span></div>`);

  if (spayd) {
    rows.push(`<div style="margin-top:10px;text-align:center"><img src="https://api.qrserver.com/v1/create-qr-code/?size=120x120&ecc=M&data=${encodeURIComponent(spayd)}" alt="QR Platba" style="width:120px;height:120px;display:inline-block" /><div style="font-size:8px;color:rgba(0,0,0,0.4);margin-top:4px">QR Platba</div></div>`);
  }

  return rows.join("");
}

export function generateDocumentHtml(
  config: Record<string, unknown>,
  docType: DocTypeKey,
  companyData: Record<string, unknown>,
  sectionOverrides?: SectionOverrides,
  options?: GenerateDocumentHtmlOptions
): string {
  const docConfig = (config[DOC_TYPE_TO_UI[docType]] || {}) as Record<string, unknown>;
  const design = (docConfig.design as DocumentDesign) || "classic";
  const colorMode = (config.colorMode as "color" | "bw") || "color";
  const accentOverride = (config.designAccentColor as string) || "";
  const logoSize = ((config.logoSize as number) ?? 100) / 100;
  const stampSize = ((config.stampSize as number) ?? 100) / 100;
  const hasLogo = !!config.logoUrl;
  const reviewUrl =
    (config.reviewUrlType as string) === "google" && config.googlePlaceId
      ? `https://search.google.com/local/writereview?placeid=${config.googlePlaceId}`
      : (config.reviewUrl as string) || "";
  const reviewText = (config.reviewText as string) || "Zde nám můžete napsat recenzi";
  const qrCodeSize = (config.qrCodeSize as number) ?? 120;
  const showQr =
    !!reviewUrl &&
    (docType === "zakazkovy_list"
      ? (config.qrOnTicketList as boolean) === true
      : docType === "diagnosticky_protokol"
        ? (config.qrOnDiagnostic as boolean) === true
        : docType === "zarucni_list"
          ? (config.qrOnWarranty as boolean) !== false
          : docType === "prijemka_reklamace"
            ? (config.qrOnPrijemka as boolean) === true
            : docType === "vydejka_reklamace"
              ? (config.qrOnVydejka as boolean) === true
              : false);
  const legalText = (docConfig.legalText as string) || "";
  const includeStamp = (docConfig.includeStamp as boolean) === true && !!config.stampUrl;
  const includeStampRight = (docConfig.includeStamp as boolean) === true;

  const colorOverrides =
    design === "modern" || design === "professional"
      ? {
          primary: (config.designPrimaryColor as string) || undefined,
          secondary: (config.designSecondaryColor as string) || undefined,
          headerBg: (config.designHeaderBg as string) || undefined,
          sectionBorder: (config.designSectionBorder as string) || undefined,
        }
      : undefined;
  const { tokens: styles, spec } = getDesignStyles(design, colorMode, accentOverride || undefined, colorOverrides);
  const order = (docConfig.sectionOrder as string[] | undefined) ?? DEFAULT_SECTION_ORDER[DOC_TYPE_TO_UI[docType]];

  const sectionKeyToInclude: Record<string, string> = {
    service: "includeServiceInfo",
    customer: "includeCustomerInfo",
    device: "includeDeviceInfo",
    repairs: "includeRepairs",
    warranty: "includeWarranty",
    diag: docType === "diagnosticky_protokol" ? "includeDiagnosticText" : "includeDiagnostic",
    photos: "includePhotos",
    dates: "includeDates",
    invoice_supplier: "includeInvSupplier",
    invoice_customer: "includeInvCustomer",
    invoice_meta: "includeInvMeta",
    invoice_items: "includeInvItems",
    invoice_summary: "includeInvSummary",
    invoice_payment: "includeInvPayment",
  };

  const repairDate = options?.repairDate ? new Date(options.repairDate) : new Date();
  const sectionVisibility = (docConfig.sectionVisibility as Record<string, string> | undefined) ?? {};
  const variables = options?.variables ?? {};
  const useSampleFallbacks = options?.useSampleFallbacks !== false;

  const orderedSections = order.filter((key) => {
    if (key.startsWith("custom-")) return true;
    const includeKey = sectionKeyToInclude[key];
    if (!includeKey || (docConfig[includeKey] as boolean) === false) return false;
    if (key === "warranty" && sectionVisibility.warranty === "when_repair_date_set") {
      const repairDateVar = variables.repair_date;
      if (repairDateVar == null || String(repairDateVar).trim() === "") return false;
    }
    return true;
  });

  const sectionWidths = (docConfig.sectionWidths as Record<string, string>) || {};
  const sectionSide = (docConfig.sectionSide as Record<string, "left" | "right">) || {};
  const sectionStyles = (docConfig.sectionStyles as Record<string, string>) || {};
  const DEFAULT_WIDTHS: Record<string, string> = {
    service: "full", customer: "full", device: "full", repairs: "full",
    warranty: "full", diag: "full", photos: "half", dates: "half",
    invoice_supplier: "half", invoice_customer: "half",
    invoice_meta: "full", invoice_items: "full",
    invoice_summary: "half", invoice_payment: "half",
  };

  function getEffectiveSectionStyle(sectionKey: string): SectionStyle {
    const v = sectionStyles[sectionKey];
    if (v === "boxed" || v === "ruled" || v === "cards" || v === "underlineTitles" || v === "leftStripe") return v;
    return spec.sectionStyle;
  }

  const sectionPadding = spec.density === "compact" ? 8 : 12;
  const defaultSectionRadius = spec.sectionStyle === "underlineTitles" ? 0 : styles.sectionRadius;
  const defaultSectionBorderCss = spec.sectionStyle === "underlineTitles" ? "none" : styles.sectionBorder;
  const defaultSectionBorderLeft = spec.sectionStyle === "leftStripe" ? `3px solid ${styles.secondaryColor}` : "none";
  const customBlocks = (docConfig.customBlocks as Record<string, { type?: string; content?: string; showHeading?: boolean; headingText?: string; showHeadingLine?: boolean }>) || {};
  const sigPositions = (docConfig.signaturePositions as Record<string, { x: number; y: number }>) || {};
  const orderedForDisplay = (() => {
    const out: string[] = [];
    for (let i = 0; i < orderedSections.length; i++) {
      const key = orderedSections[i];
      const w = key.startsWith("custom-") ? (sectionWidths[key] ?? "full") : (sectionWidths[key] ?? DEFAULT_WIDTHS[key] ?? "full");
      if (w === "half" && i + 1 < orderedSections.length) {
        const next = orderedSections[i + 1];
        const nextW = next.startsWith("custom-") ? (sectionWidths[next] ?? "full") : (sectionWidths[next] ?? DEFAULT_WIDTHS[next] ?? "full");
        if (nextW === "half") {
          const side = sectionSide[key] ?? "left";
          const nextSide = sectionSide[next] ?? "right";
          if (side === "right" && nextSide === "left") {
            out.push(next, key);
          } else {
            out.push(key, next);
          }
          i += 1;
          continue;
        }
      }
      out.push(key);
    }
    return out;
  })();
  const sectionsHtml = orderedForDisplay
    .map((key) => {
      if (key.startsWith("custom-")) {
        const blockId = key.slice(7);
        const block = customBlocks[blockId];
        const blockType = (block?.type as string) || "text";
        if (blockType === "separator") {
          return `<div data-section-key="${key}" style="padding:4px 0;flex:1 1 680px;width:680px;min-width:680px;max-width:680px;box-sizing:border-box;flex-shrink:0"><hr style="margin:0;border:none;border-top:1px solid ${styles.sectionBorder}"/></div>`;
        }
        if (blockType === "spacer") {
          const raw = (block?.content as string)?.trim() ?? "";
          const h = Math.max(8, parseInt(raw, 10) || 24);
          return `<div data-section-key="${key}" style="height:${h}px;flex:1 1 680px;width:680px;min-width:680px;max-width:680px;box-sizing:border-box;flex-shrink:0"></div>`;
        }
        let content = (block?.content as string)?.trim() ?? "";
        const vars = options?.variables ?? {};
        content = content.replace(/\{\{(\w+)\}\}/g, (_, name) => (vars[name] != null ? String(vars[name]) : `{{${name}}}`));
        if (blockType === "heading") {
          const escapedContent = escapeHtml(content || "Nadpis");
          return `<div data-section-key="${key}" style="padding:${sectionPadding}px;background:${styles.sectionBg};border-radius:${defaultSectionRadius}px;border:${defaultSectionBorderCss};border-left:${defaultSectionBorderLeft};flex:1 1 680px;width:680px;min-width:680px;max-width:680px;box-sizing:border-box;flex-shrink:0"><div style="font-size:16px;font-weight:700;line-height:1.3;color:${styles.contentColor}">${escapedContent}</div></div>`;
        }
        if (blockType === "signature") {
          const hasSigPos = sigPositions[blockId] && typeof sigPositions[blockId].x === "number";
          if (hasSigPos) return "";
          const sigLabel = escapeHtml(content || "podpis");
          const sigWidth = sectionWidths[key] ?? "full";
          const sigHalf = sigWidth === "half";
          const sigW = sigHalf ? "334px" : "680px";
          return `<div data-section-key="${key}" style="padding:${sectionPadding}px;flex:${sigHalf ? `0 0 ${sigW}` : `1 1 680px`};width:${sigW};min-width:${sigW};max-width:${sigW};box-sizing:border-box;flex-shrink:0"><div style="width:100%;max-width:140px;height:1px;border-bottom:1px solid ${styles.contentColor};margin-bottom:4px"></div><div style="font-size:9px;color:${styles.contentColor}">${sigLabel}</div></div>`;
        }
        if (content === "") return "";
        const safeContent = sanitizeRichText(content).replace(/\n/g, "<br/>");
        const showHeading = (block?.showHeading as boolean) !== false;
        let headingText = (block?.headingText as string)?.trim() || "Vlastní text";
        headingText = headingText.replace(/\{\{(\w+)\}\}/g, (_, name) => (vars[name] != null ? String(vars[name]) : `{{${name}}}`));
        const showHeadingLine = (block?.showHeadingLine as boolean) !== false;
        const headingHtml = showHeading
          ? `<div style="font-size:9px;font-weight:700;text-transform:uppercase;letter-spacing:0.08em;color:${styles.secondaryColor};${showHeadingLine ? `padding-bottom:6px;border-bottom:1px solid ${styles.sectionBorder};` : ""}margin-bottom:8px">${escapeHtml(headingText)}</div>`
          : "";
        return `<div data-section-key="${key}" style="padding:${sectionPadding}px;background:${styles.sectionBg};border-radius:${defaultSectionRadius}px;border:${defaultSectionBorderCss};border-left:${defaultSectionBorderLeft};flex:1 1 680px;width:680px;min-width:680px;max-width:680px;box-sizing:border-box;flex-shrink:0">${headingHtml}<div style="font-size:10px;line-height:1.5;color:${styles.contentColor};white-space:pre-wrap">${safeContent}</div></div>`;
      }
      const label = SECTION_LABELS[key] || key;
      const effectiveStyle = getEffectiveSectionStyle(key);
      const sectionRadius = effectiveStyle === "underlineTitles" ? 0 : styles.sectionRadius;
      const sectionBorderCss = effectiveStyle === "underlineTitles" ? "none" : styles.sectionBorder;
      const sectionBorderLeft = effectiveStyle === "leftStripe" ? `3px solid ${styles.secondaryColor}` : "none";
      const overridden = sectionOverrides && key in sectionOverrides ? sectionOverrides[key] : undefined;
      const sectionFields = docConfig.sectionFields as Record<string, CustomerSectionFields | DeviceSectionFields | ServiceSectionFields> | undefined;
      const variablesForContent = options?.variables ?? {};
      const templateContent = options?.templateMode === true ? templateSectionContentHtml(key, docConfig) : null;
      const content =
        overridden !== undefined
          ? overridden
          : (templateContent != null && templateContent !== "")
            ? templateContent
            : key === "warranty"
              ? (docType === "zarucni_list" && (docConfig.includeWarranty as boolean) === true
                  ? warrantySectionHtml(docConfig, repairDate)
                  : "")
              : key === "repairs"
                  ? (() => {
                      const raw = variablesForContent.repair_items;
                      let items: Array<Record<string, unknown>> = [];
                      if (typeof raw === "string" && raw.trim()) {
                        try {
                          const parsed = JSON.parse(raw) as unknown;
                          if (Array.isArray(parsed)) items = parsed.filter((x): x is Record<string, unknown> => x != null && typeof x === "object");
                        } catch { /* ignore */ }
                      }
                      const columns = (docConfig.repairsTableColumns as string[] | undefined) ?? ["name", "price"];
                      const validCols = columns.filter((c) => typeof c === "string");
                      if (items.length === 0 || validCols.length === 0) return "";
                      const tableHtml = repairsTableHtml(items, validCols, { sectionBorder: styles.sectionBorder, contentColor: styles.contentColor });
                      const totalPrice = variablesForContent.total_price != null ? String(variablesForContent.total_price).trim() : "";
                      const totalRow =
                        totalPrice !== ""
                          ? `<div style="margin-top:8px;padding-top:6px;border-top:1px solid ${styles.sectionBorder};display:flex;justify-content:space-between;gap:12px;width:100%;font-weight:600;font-size:12px;color:${styles.contentColor}"><span>Celková cena</span><span style="white-space:nowrap">${escapeHtml(totalPrice)}</span></div>`
                          : "";
                      return tableHtml + totalRow;
                    })()
                  : sectionOverrides && ["repairs", "diag", "photos"].includes(key)
                    ? ""
                  : key === "dates" && (docType === "prijemka_reklamace" || docType === "vydejka_reklamace")
                    ? (() => {
                        const complaintCode = String(variablesForContent.complaint_code ?? variablesForContent.reclamation_code ?? "").trim();
                        const originalTicket = String(variablesForContent.original_ticket_code ?? variablesForContent.ticket_code ?? "").trim();
                        const c = useSampleFallbacks ? (complaintCode || "R-2025-001") : complaintCode;
                        const o = useSampleFallbacks ? (originalTicket || "DEMO-001") : originalTicket;
                        if (!useSampleFallbacks && !c && !o) return "";
                        return `<div>Číslo reklamace: ${escapeHtml(c)}</div><div>Číslo původní zakázky: ${escapeHtml(o)}</div>`;
                      })()
                  : key === "dates" && (docType === "zakazkovy_list" || docType === "zarucni_list" || docType === "diagnosticky_protokol")
                    ? (() => {
                        const repairDateStr = String(variablesForContent.repair_date ?? "").trim();
                        const completionStr = String(variablesForContent.repair_completion_date ?? "").trim();
                        const codeStr = String(variablesForContent.ticket_code ?? "").trim();
                        if (!useSampleFallbacks && !repairDateStr && !completionStr && !codeStr) return "";
                        const repairDateOut = repairDateStr || (useSampleFallbacks ? "8. 2. 2025" : "");
                        const completionOut = completionStr || (useSampleFallbacks ? "10. 2. 2025" : "");
                        const codeOut = codeStr || (useSampleFallbacks ? "DEMO-001" : "");
                        if (!repairDateOut && !completionOut && !codeOut) return "";
                        let out = "";
                        if (repairDateOut) out += `<div>Přijato: ${escapeHtml(repairDateOut)}</div>`;
                        if (completionOut) out += `<div>Předpokládané dokončení: ${escapeHtml(completionOut)}</div>`;
                        if (codeOut) out += `<div>Kód zakázky: ${escapeHtml(codeOut)}</div>`;
                        return out || "";
                      })()
                  : key === "diag"
                    ? (() => {
                        const t = String(variablesForContent.diagnostic_text ?? "").trim();
                        if (!useSampleFallbacks && !t) return "";
                        const text = t || (useSampleFallbacks ? "Displej je mechanicky poškozený v levém dolním rohu. Dotyková vrstva nefunguje v oblasti cca 2×2 cm." : "");
                        return text ? `<div>${escapeHtml(text)}</div>` : "";
                      })()
                  : key === "photos"
                    ? (() => {
                        const raw = variablesForContent.photo_urls;
                        let urls: string[] = [];
                        if (typeof raw === "string" && raw.trim()) {
                          try {
                            const parsed = JSON.parse(raw) as unknown;
                            if (Array.isArray(parsed)) urls = parsed.filter((u): u is string => typeof u === "string" && u.trim().length > 0).map((u) => u.trim());
                          } catch { /* ignore */ }
                        }
                        if (!useSampleFallbacks && urls.length === 0) return "";
                        if (urls.length > 0) {
                          return `<div style="display:flex;gap:8px;flex-wrap:wrap">${urls.map((url) => `<img src="${escapeHtml(url)}" alt="Foto" style="width:60px;height:60px;object-fit:cover;border-radius:6px" />`).join("")}</div>`;
                        }
                        return useSampleFallbacks ? (SECTION_CONTENT_HTML.photos || "") : "";
                      })()
                  : key === "service"
                    ? serviceContentHtml(companyData, sectionFields?.service)
                    : key === "customer"
                      ? customerContentHtml(variablesForContent, sectionFields?.customer, useSampleFallbacks)
                      : key === "device"
                        ? deviceContentHtml(variablesForContent, sectionFields?.device, useSampleFallbacks)
                        : key === "invoice_supplier"
                          ? invoiceSupplierHtml(companyData, variablesForContent, useSampleFallbacks)
                          : key === "invoice_customer"
                            ? invoiceCustomerHtml(variablesForContent, useSampleFallbacks)
                            : key === "invoice_meta"
                              ? invoiceMetaHtml(variablesForContent, useSampleFallbacks)
                              : key === "invoice_items"
                                ? invoiceItemsTableHtml(variablesForContent, { sectionBorder: styles.sectionBorder, contentColor: styles.contentColor }, useSampleFallbacks)
                                : key === "invoice_summary"
                                  ? invoiceSummaryHtml(variablesForContent, { contentColor: styles.contentColor }, useSampleFallbacks)
                                  : key === "invoice_payment"
                                    ? invoicePaymentHtml(variablesForContent, companyData, useSampleFallbacks)
                                    : (SECTION_CONTENT_HTML[key] || "");
      if (typeof content === "string" && content.trim() === "") return "";
      const width = sectionWidths[key] ?? DEFAULT_WIDTHS[key] ?? "full";
      const halfWidth = width === "half";
      const w = halfWidth ? "334px" : "680px";
      let titleHtml = "";
      if (effectiveStyle === "leftStripe") {
        titleHtml = `<div style="font-size:9px;font-weight:700;text-transform:uppercase;letter-spacing:0.08em;color:${styles.secondaryColor};margin-bottom:8px">${escapeHtml(label)}</div>`;
      } else if (spec.sectionHeaderStyle === "uppercase" || effectiveStyle === "ruled") {
        titleHtml = `<div style="font-size:9px;font-weight:700;text-transform:uppercase;letter-spacing:0.08em;color:${styles.secondaryColor};padding-bottom:6px;border-bottom:1px solid ${styles.sectionBorder};margin-bottom:8px">${escapeHtml(label)}</div>`;
      } else if (spec.sectionHeaderStyle === "capsule") {
        titleHtml = `<div style="display:inline-block;font-size:9px;font-weight:700;text-transform:uppercase;letter-spacing:0.06em;color:${styles.accentColor};background:${styles.accentColor}12;padding:3px 10px;border-radius:4px;margin-bottom:8px">${escapeHtml(label)}</div>`;
      } else {
        titleHtml = `<div style="font-size:9px;font-weight:700;text-transform:uppercase;letter-spacing:0.08em;color:${styles.secondaryColor};padding-bottom:6px;border-bottom:1px solid ${styles.sectionBorder};margin-bottom:8px">${escapeHtml(label)}</div>`;
      }
      return `<div data-section-key="${key}" style="padding:${sectionPadding}px;background:${styles.sectionBg};border-radius:${sectionRadius}px;border:${sectionBorderCss};border-left:${sectionBorderLeft};flex:${halfWidth ? `0 0 ${w}` : "1 1 680px"};width:${w};min-width:${w};max-width:${w};box-sizing:border-box;flex-shrink:0">${titleHtml}<div style="font-size:10px;line-height:1.6;color:${styles.contentColor}">${content}</div></div>`;
    })
    .join("");

  const headerRadius = (docConfig.headerBorderRadius as number) ?? (spec.headerLayout === "splitBox" ? 8 : 0);
  const headerTitleSize = (docConfig.headerSubtitleFontSize as number) ?? (spec.headerLayout === "splitBox" ? 16 : 14);
  const headerTitleWeight = spec.headerLayout === "splitBox" ? 800 : 700;
  const headerDocTypeSize = (docConfig.headerTitleFontSize as number) ?? 14;
  const headerTicketCodeSize = (docConfig.headerTicketCodeFontSize as number) ?? 18;
  const headerLeftStripe = spec.headerLayout === "splitBox" && styles.accentColor ? `border-left:6px solid ${styles.accentColor};` : "";
  const logoPos = config.logoPosition as { x: number; y: number } | undefined;
  const hasCustomLogoPos = !!logoPos && typeof logoPos.x === "number" && typeof logoPos.y === "number";
  const stampPos = config.stampPosition as { x: number; y: number } | undefined;
  const hasCustomStampPos = !!stampPos && typeof stampPos.x === "number" && typeof stampPos.y === "number";

  const qrPos = (config.qrPosition as { x: number; y: number } | undefined);
  const qrX = qrPos && typeof qrPos.x === "number" ? qrPos.x : 620;
  const qrY = qrPos && typeof qrPos.y === "number" ? qrPos.y : 15;
  const qrBlockHtml =
    showQr && reviewUrl
      ? `<div data-element="qr" style="position:absolute;left:${qrX}px;top:${qrY}px;display:flex;align-items:center;gap:12px;">
          <div style="text-align:right;font-size:10px;color:${styles.secondaryColor};max-width:140px;line-height:1.3">${escapeHtml(reviewText)}</div>
          <img src="https://api.qrserver.com/v1/create-qr-code/?size=${qrCodeSize}x${qrCodeSize}&ecc=L&data=${encodeURIComponent(reviewUrl)}" alt="QR" style="width:${qrCodeSize}px;height:${qrCodeSize}px;display:block;flex-shrink:0" />
        </div>`
      : "";
  const ticketCode =
    docType === "zakazkovy_list"
      ? (variables.ticket_code != null && String(variables.ticket_code).trim() ? String(variables.ticket_code).trim() : null)
        ?? extractTicketCodeFromDates(sectionOverrides?.dates)
        ?? (useSampleFallbacks ? extractTicketCodeFromDates(SECTION_CONTENT_HTML.dates) : null)
      : null;
  const complaintCode =
    docType === "prijemka_reklamace" || docType === "vydejka_reklamace"
      ? (String(variables.complaint_code ?? variables.reclamation_code ?? "").trim() || (useSampleFallbacks ? "R-2025-001" : ""))
      : null;
  const invoiceNumber = docType === "faktura"
    ? (String(variables.inv_number ?? "").trim() || (useSampleFallbacks ? "FV-2026-001" : ""))
    : null;
  const headerTitleLine =
    docType === "zakazkovy_list" && ticketCode
      ? `<div style="display:flex;align-items:baseline;justify-content:center;gap:10px;flex-wrap:wrap">
          <span style="color:${styles.headerText};font-weight:700;font-size:${headerDocTypeSize}px">${escapeHtml(DOC_TYPE_LABELS[docType])}</span>
          <span style="color:${styles.headerText};font-weight:800;font-size:${headerTicketCodeSize}px;letter-spacing:0.05em">${escapeHtml(ticketCode)}</span>
        </div>`
      : (docType === "prijemka_reklamace" || docType === "vydejka_reklamace") && complaintCode
        ? `<div style="display:flex;align-items:baseline;justify-content:center;gap:10px;flex-wrap:wrap">
            <span style="color:${styles.headerText};font-weight:700;font-size:${headerDocTypeSize}px">${escapeHtml(DOC_TYPE_LABELS[docType])}</span>
            <span style="color:${styles.headerText};font-weight:800;font-size:${headerTicketCodeSize}px;letter-spacing:0.05em">${escapeHtml(complaintCode)}</span>
          </div>`
        : docType === "faktura" && invoiceNumber
          ? `<div style="display:flex;align-items:baseline;justify-content:center;gap:10px;flex-wrap:wrap">
              <span style="color:${styles.headerText};font-weight:700;font-size:${headerDocTypeSize}px">Faktura</span>
              <span style="color:${styles.headerText};font-weight:800;font-size:${headerTicketCodeSize}px;letter-spacing:0.05em">${escapeHtml(invoiceNumber)}</span>
            </div>`
          : `<div style="color:${styles.headerText};font-weight:700;font-size:${headerDocTypeSize}px">${escapeHtml(DOC_TYPE_LABELS[docType])}</div>`;
  const logoInHeader = hasLogo && !hasCustomLogoPos;
  const headerHtml = `
    <div style="position:relative;min-height:54px;margin-bottom:16px;padding-bottom:12px;border-bottom:${styles.headerBorder};background:${styles.headerBg !== "transparent" ? styles.headerBg : "transparent"};padding:${styles.headerBg !== "transparent" ? "10px 14px 12px 0" : "0 0 12px 0"};border-radius:${headerRadius}px;${headerLeftStripe}">
      ${logoInHeader ? `<img src="${config.logoUrl as string}" alt="Logo" style="position:absolute;left:0;top:50%;transform:translateY(-50%);max-width:${120 * logoSize}px;max-height:${50 * logoSize}px;object-fit:contain" />` : !hasLogo ? `<div style="position:absolute;left:0;top:50%;transform:translateY(-50%);width:${120 * logoSize}px;height:${50 * logoSize}px;border:1px dashed #d1d5db;border-radius:4px;display:flex;align-items:center;justify-content:center;color:#9ca3af;font-size:8px;letter-spacing:0.04em">LOGO</div>` : ""}
      <div style="position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);text-align:center;display:flex;flex-direction:column;gap:3px">
        ${headerTitleLine}
        <div style="color:${styles.headerText};font-weight:${headerTitleWeight};font-size:${headerTitleSize}px;letter-spacing:0.01em">${escapeHtml(String(companyData?.name ?? "Název servisu"))}</div>
      </div>
      ${qrBlockHtml}
    </div>`;
  const logoBlockHtml = hasLogo && hasCustomLogoPos
    ? `<div data-element="logo" style="position:absolute;left:${logoPos!.x}px;top:${logoPos!.y}px;width:${120 * logoSize}px;height:${50 * logoSize}px"><img src="${(config.logoUrl as string).replace(/"/g, "&quot;")}" alt="Logo" style="max-width:100%;max-height:100%;object-fit:contain" /></div>`
    : "";
  const showStamp = !!(config.stampUrl || includeStampRight || includeStamp);
  const stampW = Math.round(70 * stampSize);
  const stampH = Math.round(35 * stampSize);
  const stampPosEffective = hasCustomStampPos && stampPos ? stampPos : { x: 362, y: 1050 };
  const stampBlockHtml = showStamp
    ? `<div data-element="stamp" style="position:absolute;left:${stampPosEffective.x}px;top:${stampPosEffective.y}px">${config.stampUrl ? `<img src="${String(config.stampUrl).replace(/"/g, "&quot;")}" alt="Razítko" style="max-width:${stampW}px;max-height:${stampH}px;object-fit:contain" />` : `<div style="width:${stampW}px;height:${stampH}px;background:#f3f4f6;border-radius:4px;display:flex;align-items:center;justify-content:center;font-size:8px;color:#9ca3af">Razítko</div>`}</div>`
    : "";

  const signatureBlockEntries = orderedSections
    .map((key) => (key.startsWith("custom-") ? { key, blockId: key.slice(7) } : null))
    .filter((x): x is { key: string; blockId: string } => x != null)
    .filter(({ blockId }) => (customBlocks[blockId] as { type?: string })?.type === "signature");
  const signatureBlocksHtml = signatureBlockEntries
    .map(({ blockId }, idx) => {
      const pos = sigPositions[blockId] ?? { x: 50, y: 500 + idx * 40 };
      const label = escapeHtml(((customBlocks[blockId] as { content?: string })?.content as string)?.trim() || "podpis");
      return `<div data-element="signature" data-block-id="${blockId}" style="position:absolute;left:${pos.x}px;top:${pos.y}px;width:100px"><div style="width:100%;height:1px;border-bottom:1px solid ${styles.contentColor};margin-bottom:2px"></div><div style="font-size:9px;color:${styles.contentColor}">${label}</div></div>`;
    })
    .join("");

  const signaturesHtml = "";

  const legalRadius = spec.sectionStyle === "underlineTitles" ? 0 : styles.sectionRadius;
  const legalHtml = legalText ? `<div style="margin-top:12px;padding:10px 12px;background:${styles.sectionBg};border-radius:${legalRadius}px;font-size:8.5px;line-height:1.5;color:${styles.contentColor};opacity:0.7;border:1px solid ${styles.sectionBorder}">${escapeHtml(legalText)}</div>` : "";

  const footerContactParts: string[] = [];
  const cn = (v: unknown) => (v && String(v).trim() ? String(v).trim() : null);
  const footerName = cn(companyData.name) || cn(companyData.abbreviation);
  const footerPhone = cn(companyData.phone);
  const footerEmail = cn(companyData.email);
  const footerWeb = cn(companyData.website);
  if (footerName) footerContactParts.push(escapeHtml(footerName));
  if (footerPhone) footerContactParts.push(escapeHtml(footerPhone));
  if (footerEmail) footerContactParts.push(escapeHtml(footerEmail));
  if (footerWeb) footerContactParts.push(escapeHtml(footerWeb));
  const footerHtml = footerContactParts.length > 0
    ? `<div style="margin-top:auto;padding-top:8px;border-top:1px solid ${styles.sectionBorder};display:flex;justify-content:center;gap:6px;font-size:7.5px;color:${styles.contentColor};opacity:0.45;letter-spacing:0.02em">${footerContactParts.join(' <span style="opacity:0.5">·</span> ')}</div>`
    : "";

  const bodyHtml = `
    <div style="position:relative;width:794px;height:1123px;background:#ffffff;padding:57px 57px 40px;box-sizing:border-box;display:flex;flex-direction:column;font-size:10px;line-height:1.5;color:${styles.contentColor};letter-spacing:0.01em">
      ${headerHtml}
      ${logoBlockHtml}
      ${stampBlockHtml}
      ${signatureBlocksHtml}
      <div style="flex:1;min-height:0;margin-bottom:12px;display:flex;flex-wrap:wrap;gap:12px;align-content:flex-start">
        ${sectionsHtml}
      </div>
      ${legalHtml}
      ${signaturesHtml}
      ${footerHtml}
    </div>`;

  const interactiveScript = options?.interactive ? `<script>
(function(){
  var hovered = null;
  document.addEventListener('mouseover', function(e) {
    var el = e.target.closest('[data-section-key],[data-element]');
    if (hovered && hovered !== el) { hovered.style.outline = ''; hovered.style.outlineOffset = ''; }
    if (el) { el.style.outline = '2px solid rgba(37,99,235,0.5)'; el.style.outlineOffset = '-1px'; el.style.cursor = 'pointer'; }
    hovered = el;
  });
  document.addEventListener('mouseout', function(e) {
    if (hovered && !e.relatedTarget?.closest('[data-section-key],[data-element]')) { hovered.style.outline = ''; hovered.style.outlineOffset = ''; hovered = null; }
  });
  document.addEventListener('click', function(e) {
    var sec = e.target.closest('[data-section-key]');
    if (sec) { window.parent.postMessage({type:'section-click',key:sec.getAttribute('data-section-key')},'*'); return; }
    var el = e.target.closest('[data-element]');
    if (el) { window.parent.postMessage({type:'element-click',element:el.getAttribute('data-element'),blockId:el.getAttribute('data-block-id')},'*'); }
  });
  document.addEventListener('contextmenu', function(e) {
    var sec = e.target.closest('[data-section-key]');
    if (sec) { e.preventDefault(); window.parent.postMessage({type:'section-context',key:sec.getAttribute('data-section-key'),x:e.clientX,y:e.clientY},'*'); return; }
    var el = e.target.closest('[data-element]');
    if (el) { e.preventDefault(); window.parent.postMessage({type:'element-context',element:el.getAttribute('data-element'),x:e.clientX,y:e.clientY},'*'); }
  });
})();
</script>` : "";

  return `<!DOCTYPE html>
<html lang="cs">
<head>
  <meta charset="utf-8">
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    html, body { width: 100%; height: 100%; overflow: hidden; font-family: "Inter", ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif; -webkit-font-smoothing: antialiased; -moz-osx-font-smoothing: grayscale; }
    body { display: flex; align-items: center; justify-content: center; background: white; }
    @page { size: A4; margin: 0; }
    table { font-variant-numeric: tabular-nums; }
    ${options?.interactive ? '[data-section-key]:hover,[data-element]:hover { cursor: pointer; }' : ''}
  </style>
  ${interactiveScript}
</head>
<body>
  ${bodyHtml}
</body>
</html>`;
}
