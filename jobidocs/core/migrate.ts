/**
 * Převody ze starého světa (v1):
 *
 *  - migrateV1Config: starý plochý config (logoUrl, ticketList.legalText, …)
 *    → DocumentsV2. Bere se z něj značka, barevný režim, právní texty, záruka
 *    a vlastní textové bloky; rozložení se přebírá z výchozích šablon.
 *  - variablesToDocumentData: `variables` z /v1/print-document (řetězce,
 *    JSON ve stringu) → DocumentData, aby starší Jobi dál tisklo.
 */
import { DEFAULT_THEME, defaultDocuments, defaultTemplate, newId } from "./defaults.js";
import type { Block, DocType, DocumentData, DocumentsV2, LineItem, Party, Template } from "./types.js";
import { LEGACY_ALIASES } from "./variables.js";

const V1_SECTION_KEYS: Record<DocType, string> = {
  zakazkovy_list: "ticketList",
  zarucni_list: "warrantyCertificate",
  diagnosticky_protokol: "diagnosticProtocol",
  prijemka_reklamace: "prijemkaReklamace",
  vydejka_reklamace: "vydejkaReklamace",
  faktura: "faktura",
};

type Rec = Record<string, unknown>;
const str = (v: unknown): string | undefined => (typeof v === "string" && v.trim() ? v.trim() : undefined);
const isHex = (v: unknown): v is string => typeof v === "string" && /^#[0-9a-fA-F]{6}$/.test(v);

/** Už je to v2? */
export function isV2(raw: unknown): raw is DocumentsV2 {
  return !!raw && typeof raw === "object" && (raw as Rec).schemaVersion === 2 && typeof (raw as Rec).templates === "object";
}

/**
 * Vytáhne DocumentsV2 z uloženého configu servisu. Config může být:
 *  - { v2: DocumentsV2, autoPrint: … }   (nový stav)
 *  - starý plochý v1 config              (migruje se)
 *  - null / {}                           (výchozí)
 */
export function documentsFromConfig(config: unknown): DocumentsV2 {
  if (!config || typeof config !== "object") return defaultDocuments();
  const c = config as Rec;
  if (isV2(c.v2)) return c.v2;
  if (isV2(c)) return c;
  return migrateV1Config(c);
}

export function migrateV1Config(v1: Rec): DocumentsV2 {
  const docs = defaultDocuments();
  docs.brand = {
    logoUrl: str(v1.logoUrl),
    stampUrl: str(v1.stampUrl),
    letterheadPdfUrl: str(v1.letterheadPdfUrl),
    reviewUrl:
      v1.reviewUrlType === "google" && str(v1.googlePlaceId)
        ? `https://search.google.com/local/writereview?placeid=${str(v1.googlePlaceId)}`
        : str(v1.reviewUrl),
    reviewText: str(v1.reviewText) ?? docs.brand.reviewText,
  };
  docs.theme = {
    ...DEFAULT_THEME,
    color: v1.colorMode === "bw" ? "bw" : "color",
    accent: isHex(v1.designAccentColor) ? v1.designAccentColor : DEFAULT_THEME.accent,
  };

  const hasAnyV1Doc = Object.values(V1_SECTION_KEYS).some((k) => v1[k] && typeof v1[k] === "object");
  if (!hasAnyV1Doc) return docs;

  for (const docType of Object.keys(V1_SECTION_KEYS) as DocType[]) {
    const old = v1[V1_SECTION_KEYS[docType]] as Rec | undefined;
    if (!old || typeof old !== "object") continue;
    const t = defaultTemplate(docType);
    let changed = false;

    // Právní text → první malý text blok v šabloně.
    const legal = str(old.legalText);
    if (legal) {
      const target = t.blocks.find((b): b is Extract<Block, { type: "text" }> => b.type === "text" && b.size === "small" && b.content.length > 80);
      if (target) {
        target.content = legal;
        changed = true;
      }
    }

    // Vlastní textové bloky (customBlocks typu text / heading).
    const custom = (old.customBlocks as Record<string, Rec> | undefined) ?? {};
    const order = Array.isArray(old.sectionOrder) ? (old.sectionOrder as string[]) : Object.keys(custom).map((k) => `custom-${k}`);
    for (const key of order) {
      if (!key.startsWith("custom-")) continue;
      const blk = custom[key.slice(7)];
      if (!blk) continue;
      const content = str(blk.content);
      if (blk.type === "heading" && content) {
        t.blocks.push({ id: newId(), type: "heading", text: content, level: 2 });
        changed = true;
      } else if ((blk.type === "text" || blk.type == null) && content) {
        t.blocks.push({ id: newId(), type: "text", title: blk.showHeading === false ? undefined : str(blk.headingText), content: plainFromV1Rich(content), size: "normal" });
        changed = true;
      }
    }

    // QR na hodnocení, pokud bylo ve v1 zapnuté a je odkaz.
    const qrFlag: Record<DocType, unknown> = {
      zakazkovy_list: v1.qrOnTicketList,
      zarucni_list: v1.qrOnWarranty,
      diagnosticky_protokol: v1.qrOnDiagnostic,
      prijemka_reklamace: v1.qrOnPrijemka,
      vydejka_reklamace: v1.qrOnVydejka,
      faktura: false,
    };
    if (docs.brand.reviewUrl && qrFlag[docType] === true) {
      t.slots.bottomCenter.push({ id: newId("s"), type: "qr", size: 22 });
      changed = true;
    }

    if (changed) docs.templates[docType] = t;
  }
  return docs;
}

/** v1 povolovalo <b> a <br>; v2 má odstavce z nových řádků. */
function plainFromV1Rich(html: string): string {
  return html.replace(/<br\s*\/?>/gi, "\n").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");
}

// ---------------------------------------------------------------------------
// v1 variables → DocumentData
// ---------------------------------------------------------------------------

function parseMoney(v: unknown): number | undefined {
  if (typeof v === "number") return Number.isFinite(v) ? v : undefined;
  if (typeof v !== "string") return undefined;
  const cleaned = v.replace(/[^\d,.-]/g, "").replace(/\s/g, "");
  if (!cleaned) return undefined;
  // „3 490,00“ → 3490.00 ; „3490.5“ → 3490.5
  const normalized = cleaned.includes(",") && !cleaned.includes(".") ? cleaned.replace(",", ".") : cleaned.replace(/,/g, "");
  const n = Number(normalized);
  return Number.isFinite(n) ? n : undefined;
}

function parseJsonArray(v: unknown): unknown[] {
  if (Array.isArray(v)) return v;
  if (typeof v !== "string" || !v.trim()) return [];
  try {
    const parsed = JSON.parse(v);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function itemsFromV1(raw: unknown): LineItem[] {
  return parseJsonArray(raw)
    .filter((x): x is Rec => !!x && typeof x === "object")
    .map((it) => {
      const qty = parseMoney(it.qty ?? it.quantity ?? it.mnozstvi) ?? 1;
      const unitPrice = parseMoney(it.unitPrice ?? it.unit_price ?? it.price);
      const total = parseMoney(it.total ?? it.line_total) ?? (unitPrice != null ? unitPrice * qty : undefined);
      const vatRate = parseMoney(it.vatRate ?? it.vat_rate);
      return {
        name: String(it.name ?? it.nazev ?? ""),
        description: str(it.description),
        qty,
        unit: str(it.unit ?? it.jednotka) ?? "ks",
        unitPrice,
        vatRate,
        total,
      };
    })
    .filter((it) => it.name);
}

/**
 * Převod starých `variables` (a company_data) na DocumentData.
 * Data přicházejí už naformátovaná („3. 9. 2026“, „3 490 Kč“) – necháme je tak,
 * formátovač je pozná a nechá projít.
 */
export function variablesToDocumentData(variables: Record<string, string> | undefined, companyData: Rec | undefined, docType: DocType): DocumentData {
  const v = variables ?? {};
  const g = (...keys: string[]): string | undefined => {
    for (const k of keys) {
      const s = str(v[k]);
      if (s) return s;
    }
    return undefined;
  };
  const cd = companyData ?? {};
  const service: Party = {
    name: g("inv_supplier_name", "service_name") ?? str(cd.name) ?? str(cd.abbreviation),
    ico: g("inv_supplier_ico", "service_ico") ?? str(cd.ico),
    dic: g("inv_supplier_dic", "service_dic") ?? str(cd.dic),
    address:
      g("inv_supplier_address", "service_address") ??
      [str(cd.addressStreet), [str(cd.addressZip), str(cd.addressCity)].filter(Boolean).join(" ")].filter(Boolean).join(", ") ??
      undefined,
    phone: g("inv_supplier_phone", "service_phone") ?? str(cd.phone),
    email: g("inv_supplier_email", "service_email") ?? str(cd.email),
    web: str(cd.website)?.replace(/^https?:\/\//, ""),
  };
  if (!service.address) service.address = undefined;

  const items = itemsFromV1(v.inv_items_json ?? v.repair_items);
  const vatPayer = v.inv_vat_payer == null ? undefined : String(v.inv_vat_payer).trim() !== "0";
  const isClaim = docType === "prijemka_reklamace" || docType === "vydejka_reklamace";

  const data: DocumentData = {
    number: isClaim ? g("complaint_code", "reclamation_code") : docType === "faktura" ? g("inv_number") : g("ticket_code", "order_code"),
    relatedNumber: isClaim ? g("original_ticket_code", "ticket_code") : g("inv_order_number", "original_ticket_code"),
    service,
    customer: {
      name: g("inv_customer_name", "customer_name"),
      ico: g("inv_customer_ico"),
      dic: g("inv_customer_dic"),
      phone: g("customer_phone"),
      email: g("inv_customer_email", "customer_email"),
      address: g("inv_customer_address", "customer_address"),
    },
    device: {
      name: g("device_name"),
      serial: g("device_serial"),
      imei: g("device_imei") !== g("device_serial") ? g("device_imei") : undefined,
      condition: g("device_state"),
      issue: g("device_problem"),
    },
    dates: {
      received: g("repair_date"),
      eta: g("repair_completion_date"),
      issued: g("inv_issue_date", "inv_date_issued"),
      due: g("inv_due_date", "inv_date_due"),
      taxable: g("inv_taxable_date", "inv_date_taxable"),
    },
    items,
    totals: {
      subtotal: parseMoney(v.inv_subtotal),
      vat: parseMoney(v.inv_vat_amount ?? v.inv_vat),
      total: parseMoney(v.inv_total ?? v.total_price),
      rounding: parseMoney(v.inv_rounding),
      currency: g("inv_currency") ?? "CZK",
      vatPayer,
    },
    diagnostic: g("diagnostic_text"),
    note: g("inv_notes", "note"),
    photos: parseJsonArray(v.photo_urls).filter((u): u is string => typeof u === "string" && u.trim().length > 0),
    warranty: g("warranty_until") ? { until: g("warranty_until") } : undefined,
    payment: {
      account: g("inv_supplier_bank", "inv_account_number") ?? str(cd.bankAccount),
      iban: g("inv_supplier_iban", "inv_iban") ?? str(cd.iban),
      swift: g("inv_supplier_swift") ?? str(cd.swift),
      vs: g("inv_vs"),
      spayd: g("inv_spayd_qr"),
    },
    extra: {},
  };
  // Neznámé proměnné dáme do extra, aby {{název}} ve vlastních textech dál fungoval.
  for (const [k, val] of Object.entries(v)) {
    if (!(k in LEGACY_ALIASES) && typeof val === "string" && val.trim()) data.extra![k] = val;
  }
  return data;
}

/** Použije se, když v editoru chceme vidět šablonu tak, jak ji uložil starý config. */
export function templateOrDefault(docs: DocumentsV2, docType: DocType): Template {
  return docs.templates[docType] ?? defaultTemplate(docType);
}
