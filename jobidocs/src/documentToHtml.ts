/**
 * Generate print-ready A4 HTML for JobiDocs API /v1/render.
 * Uses Electron Chromium for proper PDF rendering – single page, centered, no overflow.
 * Design tokeny a layout spec ze sdíleného modulu documentDesign.
 */

import { getDesignStyles, type DocumentDesign, type SectionStyle } from "./documentDesign";

type DocTypeKey = "zakazkovy_list" | "zarucni_list" | "diagnosticky_protokol" | "prijemka_reklamace" | "vydejka_reklamace";
type DocTypeUI = "ticketList" | "diagnosticProtocol" | "warrantyCertificate" | "prijemkaReklamace" | "vydejkaReklamace";

const DOC_TYPE_TO_UI: Record<DocTypeKey, DocTypeUI> = {
  zakazkovy_list: "ticketList",
  zarucni_list: "warrantyCertificate",
  diagnosticky_protokol: "diagnosticProtocol",
  prijemka_reklamace: "prijemkaReklamace",
  vydejka_reklamace: "vydejkaReklamace",
};

const DOC_TYPE_LABELS: Record<DocTypeKey, string> = {
  zakazkovy_list: "Zakázkový list",
  zarucni_list: "Záruční list",
  diagnosticky_protokol: "Diagnostický protokol",
  prijemka_reklamace: "Příjemka reklamace",
  vydejka_reklamace: "Výdejka reklamace",
};

const DEFAULT_SECTION_ORDER: Record<DocTypeUI, string[]> = {
  ticketList: ["service", "customer", "device", "repairs", "diag", "photos", "dates"],
  diagnosticProtocol: ["service", "customer", "device", "diag", "photos", "dates"],
  warrantyCertificate: ["service", "customer", "device", "repairs", "warranty", "dates"],
  prijemkaReklamace: ["service", "customer", "device", "dates"],
  vydejkaReklamace: ["service", "customer", "device", "dates"],
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
  if (show("name") && name) parts.push(`<div>${escapeHtml(name)}</div>`);
  if (show("ico") || show("dic")) {
    const icoDic = [show("ico") && ico && `IČO: ${escapeHtml(ico)}`, show("dic") && dic && `DIČ: ${escapeHtml(dic)}`].filter(Boolean).join(" • ");
    if (icoDic) parts.push(`<div>${icoDic}</div>`);
  }
  if (show("address") && address) parts.push(`<div>${escapeHtml(address)}</div>`);
  if (show("phone") || show("email") || show("website")) {
    const contact = [show("phone") && phone, show("email") && email, show("website") && website].filter((x): x is string => !!x).map(escapeHtml).join(" • ");
    if (contact) parts.push(`<div>${contact}</div>`);
  }
  if (parts.length === 0) return '<div style="color:#9ca3af;font-size:9px">Vyplňte údaje v Jobi → Nastavení → Servis</div>';
  return parts.join("");
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

type CustomerSectionFields = { name?: boolean; phone?: boolean; email?: boolean; address?: boolean };
type DeviceSectionFields = { name?: boolean; serial?: boolean; imei?: boolean; state?: boolean; problem?: boolean };

function customerContentHtml(data: Record<string, unknown>, visibleFields?: CustomerSectionFields | null): string {
  const show = (k: keyof CustomerSectionFields) => visibleFields?.[k] !== false;
  const n = (v: unknown) => (v != null && String(v).trim() ? String(v) : null);
  const name = n(data.customer_name) || "Jan Novák";
  const phone = n(data.customer_phone) || "+420 123 456 789";
  const email = n(data.customer_email) || "jan.novak@email.cz";
  const address = n(data.customer_address) || "Havlíčkova 45, 110 00 Praha 1";
  const parts: string[] = [];
  if (show("name")) parts.push(`<div>${escapeHtml(name)}</div>`);
  if (show("phone")) parts.push(`<div>${escapeHtml(phone)}</div>`);
  if (show("email")) parts.push(`<div>${escapeHtml(email)}</div>`);
  if (show("address")) parts.push(`<div>${escapeHtml(address)}</div>`);
  return parts.join("");
}

function deviceContentHtml(data: Record<string, unknown>, visibleFields?: DeviceSectionFields | null): string {
  const show = (k: keyof DeviceSectionFields) => visibleFields?.[k] !== false;
  const n = (v: unknown) => (v != null && String(v).trim() ? String(v) : null);
  const name = n(data.device_name) || "iPhone 13 Pro, 128 GB";
  const serial = n(data.device_serial) || "SN123456789012";
  const imei = n(data.device_imei) || "35 123456 789012 3";
  const state = n(data.device_state) || "Poškozený displej, prasklina v rohu";
  const problem = n(data.device_problem) || "Nefunguje dotyková vrstva v levém dolním rohu";
  const parts: string[] = [];
  if (show("name")) parts.push(`<div>${escapeHtml(name)}</div>`);
  if (show("serial")) parts.push(`<div>SN: ${escapeHtml(serial)}</div>`);
  if (show("imei")) parts.push(`<div>IMEI: ${escapeHtml(imei)}</div>`);
  if (show("state")) parts.push(`<div>Stav: ${escapeHtml(state)}</div>`);
  if (show("problem")) parts.push(`<div>Problém: ${escapeHtml(problem)}</div>`);
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
  const thead = columns.map((col) => `<th style="text-align:left;padding:6px 10px;border-bottom:1px solid ${styles.sectionBorder};font-weight:600;font-size:10px">${escapeHtml(REPAIRS_COLUMN_LABELS[col] ?? col)}</th>`).join("");
  const rows = repairItems.map((row) =>
    columns.map((col) => {
      const val = row[col];
      const text = val != null ? String(val) : "";
      return `<td style="padding:6px 10px;border-bottom:1px solid ${styles.sectionBorder};font-size:10px;color:${styles.contentColor}">${escapeHtml(text)}</td>`;
    }).join("")
  ).map((row) => `<tr>${row}</tr>`).join("");
  return `<table style="width:100%;border-collapse:collapse"><thead><tr>${thead}</tr></thead><tbody>${rows}</tbody></table>`;
}

const SECTION_CONTENT_HTML: Record<string, string> = {
  customer: "", // použije se customerContentHtml s visibleFields
  device: "", // použije se deviceContentHtml s visibleFields
  repairs: `<div style="display:flex;justify-content:space-between;gap:12px;width:100%"><span>Výměna displeje</span><span style="white-space:nowrap">2 500 Kč</span></div><div style="display:flex;justify-content:space-between;gap:12px;width:100%"><span>Kalibrace dotykové vrstvy</span><span style="white-space:nowrap">500 Kč</span></div><div style="margin-top:8px;padding-top:6px;border-top:1px solid rgba(0,0,0,0.12);display:flex;justify-content:space-between;gap:12px;width:100%;font-weight:600;font-size:12px"><span>Celková cena</span><span style="white-space:nowrap">3 000 Kč</span></div>`,
  diag: `<div>Displej je mechanicky poškozený v levém dolním rohu. Dotyková vrstva nefunguje v oblasti cca 2×2 cm.</div><div style="margin-top:4px">Doporučena výměna displeje. Záruka na opravu 12 měsíců.</div>`,
  photos: `<div style="display:flex;gap:8px;flex-wrap:wrap"><div style="width:60px;height:60px;background:#e5e7eb;border-radius:6px;display:flex;align-items:center;justify-content:center;font-size:9px;color:#9ca3af">Foto 1</div><div style="width:60px;height:60px;background:#e5e7eb;border-radius:6px;display:flex;align-items:center;justify-content:center;font-size:9px;color:#9ca3af">Foto 2</div></div>`,
  dates: `<div>Přijato: 8. 2. 2025</div><div>Předpokládané dokončení: 10. 2. 2025</div><div>Kód zakázky: DEMO-001</div>`,
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
};

/** Optional override HTML for each section (customer, device, repairs, diag, photos, dates). Used when printing from Jobi with real ticket data. */
export type SectionOverrides = Partial<Record<string, string>>;

/** Při tisku záručního listu z Jobi: datum opravy (ISO). variables: substituce pro vlastní texty. templateMode: místo dat zobrazit placeholdery {{var}}. */
export type GenerateDocumentHtmlOptions = { repairDate?: string; variables?: Record<string, string>; templateMode?: boolean };

const TEMPLATE_PLACEHOLDERS_BY_SECTION: Record<string, string[]> = {
  service: ["service_name", "service_ico", "service_dic", "service_address", "service_phone", "service_email"],
  customer: ["customer_name", "customer_phone", "customer_email", "customer_address"],
  device: ["device_name", "device_serial", "device_imei", "device_state", "device_problem"],
  repairs: ["total_price"],
  diag: ["diagnostic_text"],
  dates: ["ticket_code", "repair_date", "repair_completion_date"],
  warranty: ["warranty_until"],
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
  const includeCustomerSignature = (docConfig.includeCustomerSignature as boolean) !== false;
  const includeStamp = (docConfig.includeStamp as boolean) === true && !!config.stampUrl;
  const includeStampRight = (docConfig.includeStamp as boolean) === true;
  const includeSignatureOnHandover = (docConfig.includeSignatureOnHandover as boolean) !== false;
  const includeSignatureOnPickup = (docConfig.includeSignatureOnPickup as boolean) !== false;

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
  };

  const repairDate = options?.repairDate ? new Date(options.repairDate) : new Date();
  const sectionVisibility = (docConfig.sectionVisibility as Record<string, string> | undefined) ?? {};
  const variables = options?.variables ?? {};

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
  const sectionStyles = (docConfig.sectionStyles as Record<string, string>) || {};
  const DEFAULT_WIDTHS: Record<string, string> = {
    service: "full", customer: "full", device: "full", repairs: "full",
    warranty: "full", diag: "full", photos: "half", dates: "half",
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
  const titleFontSize = spec.sectionHeaderStyle === "capsule" ? 14 : 13;
  const titleFontWeight = spec.sectionHeaderStyle === "underline" ? 500 : 700;
  const customBlocks = (docConfig.customBlocks as Record<string, { type?: string; content?: string }>) || {};
  const sectionsHtml = orderedSections
    .map((key) => {
      if (key.startsWith("custom-")) {
        const blockId = key.slice(7);
        const block = customBlocks[blockId];
        const blockType = (block?.type as string) || "text";
        if (blockType === "separator") {
          return `<div style="padding:4px 0;flex:1 1 680px;width:680px;min-width:680px;max-width:680px;box-sizing:border-box;flex-shrink:0"><hr style="margin:0;border:none;border-top:1px solid ${styles.sectionBorder}"/></div>`;
        }
        if (blockType === "spacer") {
          const raw = (block?.content as string)?.trim() ?? "";
          const h = Math.max(8, parseInt(raw, 10) || 24);
          return `<div style="height:${h}px;flex:1 1 680px;width:680px;min-width:680px;max-width:680px;box-sizing:border-box;flex-shrink:0"></div>`;
        }
        let content = (block?.content as string)?.trim() ?? "";
        const vars = options?.variables ?? {};
        content = content.replace(/\{\{(\w+)\}\}/g, (_, name) => (vars[name] != null ? String(vars[name]) : `{{${name}}}`));
        const titleStyle = spec.sectionHeaderStyle === "uppercase" ? `font-size:${titleFontSize}px;font-weight:${titleFontWeight};margin-bottom:0;padding-bottom:6px;border-bottom:1px solid ${styles.secondaryColor};color:${styles.secondaryColor};text-transform:uppercase;letter-spacing:0.05em` : `font-size:${titleFontSize}px;font-weight:${titleFontWeight};margin-bottom:0;padding-bottom:6px;border-bottom:1px solid ${styles.secondaryColor};color:${styles.secondaryColor}`;
        if (blockType === "heading") {
          const escapedContent = escapeHtml(content || "Nadpis");
          return `<div style="padding:${sectionPadding}px;background:${styles.sectionBg};border-radius:${defaultSectionRadius}px;border:${defaultSectionBorderCss};border-left:${defaultSectionBorderLeft};flex:1 1 680px;width:680px;min-width:680px;max-width:680px;box-sizing:border-box;flex-shrink:0"><div style="font-size:16px;font-weight:700;line-height:1.3;color:${styles.contentColor}">${escapedContent}</div></div>`;
        }
        if (content === "") return "";
        const escapedContent = escapeHtml(content).replace(/\n/g, "<br/>");
        return `<div style="padding:${sectionPadding}px;background:${styles.sectionBg};border-radius:${defaultSectionRadius}px;border:${defaultSectionBorderCss};border-left:${defaultSectionBorderLeft};flex:1 1 680px;width:680px;min-width:680px;max-width:680px;box-sizing:border-box;flex-shrink:0"><div style="${titleStyle}">⋮⋮ Vlastní text</div><div style="font-size:10px;line-height:1.5;color:${styles.contentColor};white-space:pre-wrap">${escapedContent}</div></div>`;
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
                      if (items.length > 0 && validCols.length > 0)
                        return repairsTableHtml(items, validCols, { sectionBorder: styles.sectionBorder, contentColor: styles.contentColor });
                      if (sectionOverrides) return "";
                      return SECTION_CONTENT_HTML.repairs;
                    })()
                  : sectionOverrides && ["repairs", "diag", "photos"].includes(key)
                    ? ""
                  : key === "service"
                    ? serviceContentHtml(companyData, sectionFields?.service)
                    : key === "customer"
                      ? customerContentHtml(variablesForContent, sectionFields?.customer)
                      : key === "device"
                        ? deviceContentHtml(variablesForContent, sectionFields?.device)
                        : (SECTION_CONTENT_HTML[key] || "");
      if (typeof content === "string" && content.trim() === "") return "";
      const width = sectionWidths[key] ?? DEFAULT_WIDTHS[key] ?? "full";
      const halfWidth = width === "half";
      const w = halfWidth ? "334px" : "680px";
      const titleStyle = spec.sectionHeaderStyle === "uppercase" ? `font-size:${titleFontSize}px;font-weight:${titleFontWeight};margin-bottom:0;padding-bottom:6px;border-bottom:1px solid ${styles.secondaryColor};color:${styles.secondaryColor};text-transform:uppercase;letter-spacing:0.05em` : `font-size:${titleFontSize}px;font-weight:${titleFontWeight};margin-bottom:0;padding-bottom:6px;border-bottom:1px solid ${styles.secondaryColor};color:${styles.secondaryColor}`;
      return `<div style="padding:${sectionPadding}px;background:${styles.sectionBg};border-radius:${sectionRadius}px;border:${sectionBorderCss};border-left:${sectionBorderLeft};flex:${halfWidth ? `0 0 ${w}` : "1 1 680px"};width:${w};min-width:${w};max-width:${w};box-sizing:border-box;flex-shrink:0"><div style="${titleStyle}">⋮⋮ ${escapeHtml(label)}</div><div style="font-size:10px;line-height:1.5;color:${styles.contentColor}">${content}</div></div>`;
    })
    .join("");

  const headerRadius = spec.headerLayout === "splitBox" ? 8 : 0;
  const headerTitleSize = spec.headerLayout === "splitBox" ? 16 : 14;
  const headerTitleWeight = spec.headerLayout === "splitBox" ? 800 : 700;
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
      ? `<div style="position:absolute;left:${qrX}px;top:${qrY}px;display:flex;align-items:center;gap:12px;">
          <div style="text-align:right;font-size:10px;color:${styles.secondaryColor};max-width:140px;line-height:1.3">${escapeHtml(reviewText)}</div>
          <img src="https://api.qrserver.com/v1/create-qr-code/?size=${qrCodeSize}x${qrCodeSize}&ecc=L&data=${encodeURIComponent(reviewUrl)}" alt="QR" style="width:${qrCodeSize}px;height:${qrCodeSize}px;display:block;flex-shrink:0" />
        </div>`
      : "";
  const ticketCode =
    docType === "zakazkovy_list"
      ? extractTicketCodeFromDates(sectionOverrides?.dates) ?? extractTicketCodeFromDates(SECTION_CONTENT_HTML.dates)
      : null;
  const headerTitleLine =
    docType === "zakazkovy_list" && ticketCode
      ? `<div style="display:flex;align-items:baseline;justify-content:center;gap:10px;flex-wrap:wrap">
          <span style="color:${styles.headerText};font-weight:700;font-size:14px">${escapeHtml(DOC_TYPE_LABELS[docType])}</span>
          <span style="color:${styles.headerText};font-weight:800;font-size:18px;letter-spacing:0.05em">${escapeHtml(ticketCode)}</span>
        </div>`
      : `<div style="color:${styles.headerText};font-weight:700;font-size:14px">${escapeHtml(DOC_TYPE_LABELS[docType])}</div>`;
  const logoInHeader = hasLogo && !hasCustomLogoPos;
  const headerHtml = `
    <div style="position:relative;min-height:50px;margin-bottom:12px;padding-bottom:10px;border-bottom:${styles.headerBorder};background:${styles.headerBg !== "transparent" ? styles.headerBg : "transparent"};padding:${styles.headerBg !== "transparent" ? "8px 12px 10px 0" : 0};border-radius:${headerRadius}px;${headerLeftStripe}">
      ${logoInHeader ? `<img src="${config.logoUrl as string}" alt="Logo" style="position:absolute;left:0;top:50%;transform:translateY(-50%);max-width:${120 * logoSize}px;max-height:${50 * logoSize}px;object-fit:contain" />` : !hasLogo ? `<div style="position:absolute;left:0;top:50%;transform:translateY(-50%);width:${120 * logoSize}px;height:${50 * logoSize}px;background:#f3f4f6;border-radius:4px;display:flex;align-items:center;justify-content:center;color:#9ca3af;font-size:9px">Logo</div>` : ""}
      <div style="position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);text-align:center;display:flex;flex-direction:column;gap:2px">
        ${headerTitleLine}
        <div style="color:${styles.headerText};font-weight:${headerTitleWeight};font-size:${headerTitleSize}px">${escapeHtml(String(companyData?.name ?? "Název servisu"))}</div>
      </div>
      ${qrBlockHtml}
    </div>`;
  const logoBlockHtml = hasLogo && hasCustomLogoPos
    ? `<div style="position:absolute;left:${logoPos!.x}px;top:${logoPos!.y}px;width:${120 * logoSize}px;height:${50 * logoSize}px"><img src="${(config.logoUrl as string).replace(/"/g, "&quot;")}" alt="Logo" style="max-width:100%;max-height:100%;object-fit:contain" /></div>`
    : "";
  const stampBlockHtml = hasCustomStampPos && (config.stampUrl || includeStampRight || includeStamp)
    ? `<div style="position:absolute;left:${stampPos!.x}px;top:${stampPos!.y}px">${config.stampUrl ? `<img src="${String(config.stampUrl).replace(/"/g, "&quot;")}" alt="Razítko" style="max-width:70px;max-height:35px;object-fit:contain" />` : `<div style="width:70px;height:35px;background:#f3f4f6;border-radius:4px;display:flex;align-items:center;justify-content:center;font-size:8px;color:#9ca3af">Razítko</div>`}</div>`
    : "";

  const isTicketList = docType === "zakazkovy_list";
  const hasTicketListSignatures = isTicketList && (includeSignatureOnHandover || includeSignatureOnPickup || includeStampRight);
  const hasOtherSignatures = !isTicketList && (includeCustomerSignature || includeStamp);

  const labelHandover = String(docConfig.signatureLabelHandover ?? "Podpis při předání zákazníkem").trim() || "Podpis při předání zákazníkem";
  const labelPickup = String(docConfig.signatureLabelPickup ?? "Podpis při vyzvednutí zákazníkem").trim() || "Podpis při vyzvednutí zákazníkem";
  const labelService = String(docConfig.signatureLabelService ?? "Podpis / razítko servisu").trim() || "Podpis / razítko servisu";
  const pos = (v: unknown) => (v === "center" || v === "right" ? v : "left");
  const posHandover = pos(docConfig.signaturePositionHandover);
  const posPickup = pos(docConfig.signaturePositionPickup);
  const posService = pos(docConfig.signaturePositionService);

  const stampImgHtml = config.stampUrl ? `<img src="${String(config.stampUrl).replace(/"/g, "&quot;")}" alt="Razítko" style="max-width:70px;max-height:35px;object-fit:contain" />` : `<div style="width:70px;height:35px;background:#f3f4f6;border-radius:4px;display:flex;align-items:center;justify-content:center;font-size:8px;color:#9ca3af">Razítko</div>`;

  const blockHandover = includeSignatureOnHandover
    ? `<div style="width:100%;max-width:140px;border-bottom:1px solid #000;margin-bottom:4px"></div><div style="font-size:9px;color:${styles.contentColor}">${escapeHtml(labelHandover)}</div>`
    : "";
  const blockPickup = includeSignatureOnPickup
    ? `<div style="width:100%;max-width:140px;border-bottom:1px solid #000;margin-bottom:4px"></div><div style="font-size:9px;color:${styles.contentColor}">${escapeHtml(labelPickup)}</div>`
    : "";
  const blockService = includeStampRight
    ? `${hasCustomStampPos ? "" : stampImgHtml}<div style="font-size:9px;color:${styles.contentColor};margin-top:4px">${escapeHtml(labelService)}</div>`
    : "";

  const slot = (align: "left" | "center" | "right", ...blocks: string[]) => {
    const filtered = blocks.filter(Boolean);
    if (filtered.length === 0) return `<div style="flex:1;min-width:0"></div>`;
    const alignStyle = align === "center" ? "align-items:center" : align === "right" ? "align-items:flex-end" : "align-items:flex-start";
    const inner = filtered.map((b) => `<div>${b}</div>`).join("");
    return `<div style="flex:1;min-width:0;display:flex;flex-direction:column;${alignStyle};gap:8px">${inner}</div>`;
  };

  const byPos = { left: [] as string[], center: [] as string[], right: [] as string[] };
  if (blockHandover) byPos[posHandover].push(blockHandover);
  if (blockPickup) byPos[posPickup].push(blockPickup);
  if (blockService) byPos[posService].push(blockService);

  const signaturesHtml = hasTicketListSignatures
    ? `
    <div style="margin-top:auto;padding-top:28px;display:flex;justify-content:space-between;align-items:flex-end;border-top:1px solid ${styles.sectionBorder};flex-shrink:0;gap:24px">
      ${slot("left", ...byPos.left)}
      ${slot("center", ...byPos.center)}
      ${slot("right", ...byPos.right)}
    </div>`
    : hasOtherSignatures
      ? `
    <div style="margin-top:auto;padding-top:28px;display:flex;justify-content:space-around;border-top:1px solid ${styles.sectionBorder};flex-shrink:0">
      ${includeCustomerSignature ? `<div><div style="width:100px;border-bottom:1px solid #000;margin-bottom:4px"></div><div style="font-size:9px;color:${styles.contentColor}">Podpis zákazníka</div></div>` : ""}
      ${includeStamp && !hasCustomStampPos ? `<div>${config.stampUrl ? `<img src="${String(config.stampUrl).replace(/"/g, "&quot;")}" alt="Razítko" style="max-width:70px;max-height:35px;object-fit:contain" />` : `<div style="width:70px;height:35px;background:#f3f4f6;border-radius:4px;display:flex;align-items:center;justify-content:center;font-size:8px;color:#9ca3af">Razítko</div>`}</div>` : ""}
    </div>`
      : "";

  const legalRadius = spec.sectionStyle === "underlineTitles" ? 0 : styles.sectionRadius;
  const legalHtml = legalText ? `<div style="margin-top:12px;padding:10px;background:${styles.sectionBg};border-radius:${legalRadius}px;font-size:9px;color:${styles.contentColor};border:1px solid ${styles.sectionBorder}">${escapeHtml(legalText)}</div>` : "";

  const bodyHtml = `
    <div style="position:relative;width:794px;height:1123px;background:#ffffff;padding:57px;box-sizing:border-box;display:flex;flex-direction:column;font-size:10px;line-height:1.4;color:${styles.contentColor}">
      ${headerHtml}
      ${logoBlockHtml}
      ${stampBlockHtml}
      <div style="flex:1;min-height:0;margin-bottom:12px;display:flex;flex-wrap:wrap;gap:12px;align-content:flex-start">
        ${sectionsHtml}
      </div>
      ${legalHtml}
      ${signaturesHtml}
    </div>`;

  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    html, body { width: 100%; height: 100%; overflow: hidden; font-family: system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif; }
    body { display: flex; align-items: center; justify-content: center; background: white; }
    @page { size: A4; margin: 0; }
  </style>
</head>
<body>
  ${bodyHtml}
</body>
</html>`;
}
