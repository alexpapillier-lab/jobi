/**
 * Proměnné {{…}} v šablonách: katalog, dosazení a formátování.
 *
 * Cesta proměnné odpovídá struktuře DocumentData ({{customer.name}},
 * {{dates.received}}). Data a částky se formátují až tady, takže Jobi posílá
 * čísla a ISO řetězce a všechny dokumenty je zobrazují stejně.
 *
 * Staré názvy z v1 ({{customer_name}}, {{ticket_code}}…) dál fungují přes
 * tabulku aliasů, aby se nerozbily vlastní texty, které si servisy napsaly.
 */
import type { DocumentData } from "./types.js";

export type VariableDef = {
  key: string;
  label: string;
  group: string;
  /** Ukázková hodnota pro editor. */
  sample: string;
};

const G = {
  doc: "Dokument",
  customer: "Zákazník",
  device: "Zařízení",
  dates: "Data",
  service: "Servis",
  price: "Ceny",
  other: "Ostatní",
  invoice: "Faktura",
};

export const VARIABLES: VariableDef[] = [
  { key: "number", label: "Číslo dokumentu (zakázky)", group: G.doc, sample: "Z26000123" },
  { key: "relatedNumber", label: "Číslo původní zakázky", group: G.doc, sample: "Z26000098" },
  { key: "pin", label: "PIN zakázky", group: G.doc, sample: "9398" },
  { key: "portalUrl", label: "Odkaz na stav zakázky online", group: G.doc, sample: "https://appjobi.com/z/?t=ukazka" },
  { key: "today", label: "Dnešní datum", group: G.doc, sample: "3. 9. 2026" },

  { key: "customer.name", label: "Jméno zákazníka", group: G.customer, sample: "Jan Novák" },
  { key: "customer.company", label: "Firma zákazníka", group: G.customer, sample: "Novák s.r.o." },
  { key: "customer.ico", label: "IČO zákazníka", group: G.customer, sample: "87654321" },
  { key: "customer.dic", label: "DIČ zákazníka", group: G.customer, sample: "CZ87654321" },
  { key: "customer.phone", label: "Telefon zákazníka", group: G.customer, sample: "+420 777 123 456" },
  { key: "customer.email", label: "E-mail zákazníka", group: G.customer, sample: "jan.novak@email.cz" },
  { key: "customer.address", label: "Adresa zákazníka", group: G.customer, sample: "Havlíčkova 45, 110 00 Praha 1" },
  { key: "customer.contact", label: "Kontakt (jméno + telefon)", group: G.customer, sample: "Jan Novák, Tel.: +420 777 123 456" },
  { key: "customer.note", label: "Poznámka k zákazníkovi", group: G.customer, sample: "" },

  { key: "device.name", label: "Zařízení", group: G.device, sample: "iPhone 13 Pro 128 GB" },
  { key: "device.serial", label: "Sériové číslo", group: G.device, sample: "F2LXK1ABCD9" },
  { key: "device.imei", label: "IMEI", group: G.device, sample: "35 123456 789012 3" },
  { key: "device.serialOrImei", label: "Sériové číslo / IMEI", group: G.device, sample: "F2LXK1ABCD9" },
  { key: "device.passcode", label: "Heslo zařízení / kód obrazovky", group: G.device, sample: "1234" },
  { key: "device.condition", label: "Popis stavu zařízení", group: G.device, sample: "Škrábance na rámu" },
  { key: "device.accessories", label: "Příslušenství", group: G.device, sample: "Kryt, nabíjecí kabel" },
  { key: "device.issue", label: "Požadovaná oprava / závada", group: G.device, sample: "Nefunguje dotyk v rohu displeje" },
  { key: "device.note", label: "Poznámka k zařízení", group: G.device, sample: "" },

  { key: "dates.received", label: "Přijetí zařízení do opravy", group: G.dates, sample: "1. 9. 2026" },
  { key: "dates.eta", label: "Předpokládané dokončení", group: G.dates, sample: "5. 9. 2026" },
  { key: "dates.completed", label: "Zakázka dokončena", group: G.dates, sample: "3. 9. 2026" },
  { key: "dates.diagnosed", label: "Datum vytvoření diagnostiky", group: G.dates, sample: "3. 9. 2026" },
  { key: "dates.released", label: "Vydáno zákazníkovi", group: G.dates, sample: "4. 9. 2026" },
  { key: "dates.issued", label: "Datum vystavení", group: G.dates, sample: "3. 9. 2026" },
  { key: "dates.due", label: "Datum splatnosti", group: G.dates, sample: "17. 9. 2026" },
  { key: "dates.taxable", label: "Datum zdanitelného plnění", group: G.dates, sample: "3. 9. 2026" },
  { key: "handoff.receive", label: "Převzetí zařízení servisem", group: G.dates, sample: "Osobně" },
  { key: "handoff.return", label: "Převzetí zařízení zákazníkem", group: G.dates, sample: "Pomocí poštovní zásilky" },

  { key: "service.name", label: "Název servisu", group: G.service, sample: "iSwap Repair Point Praha" },
  { key: "service.person", label: "Kontaktní osoba", group: G.service, sample: "Jakub Zima" },
  { key: "service.ico", label: "IČO servisu", group: G.service, sample: "01028359" },
  { key: "service.dic", label: "DIČ servisu", group: G.service, sample: "" },
  { key: "service.address", label: "Adresa servisu", group: G.service, sample: "U Vokovické školy 299/4, 160 00 Praha" },
  { key: "service.phone", label: "Telefon servisu", group: G.service, sample: "+420 773 118 472" },
  { key: "service.email", label: "E-mail servisu", group: G.service, sample: "servis@iswap.cz" },
  { key: "service.web", label: "Web servisu", group: G.service, sample: "www.servis.iswap.cz" },

  { key: "totals.total", label: "Celková cena", group: G.price, sample: "5 990,00 Kč" },
  { key: "totals.subtotal", label: "Základ daně", group: G.price, sample: "4 950,41 Kč" },
  { key: "totals.vat", label: "DPH", group: G.price, sample: "1 039,59 Kč" },
  { key: "totals.estimated", label: "Odhadovaná cena", group: G.price, sample: "6 000,00 Kč" },
  { key: "items.summary", label: "Položky v jednom řádku", group: G.price, sample: "Výměna displeje iPhone 13 Pro – 5 990,00 Kč" },
  { key: "items.count", label: "Počet položek", group: G.price, sample: "1" },

  { key: "diagnostic", label: "Text diagnostiky", group: G.other, sample: "Telefon přijat s nefunkční dotykovou vrstvou…" },
  { key: "note", label: "Poznámka", group: G.other, sample: "" },
  { key: "warranty.months", label: "Záruka (měsíce)", group: G.other, sample: "12" },
  { key: "warranty.until", label: "Záruka do", group: G.other, sample: "3. 9. 2027" },
  { key: "warranty.text", label: "Text záruky", group: G.other, sample: "" },

  { key: "payment.account", label: "Číslo účtu", group: G.invoice, sample: "19-2000145399/0800" },
  { key: "payment.iban", label: "IBAN", group: G.invoice, sample: "CZ65 0800 0000 1920 0014 5399" },
  { key: "payment.swift", label: "SWIFT", group: G.invoice, sample: "GIBACZPX" },
  { key: "payment.vs", label: "Variabilní symbol", group: G.invoice, sample: "2026001" },
];

/** Staré názvy proměnných z v1 → nové cesty. */
export const LEGACY_ALIASES: Record<string, string> = {
  ticket_code: "number",
  order_code: "number",
  complaint_code: "number",
  reclamation_code: "number",
  inv_number: "number",
  original_ticket_code: "relatedNumber",
  customer_name: "customer.name",
  customer_phone: "customer.phone",
  customer_email: "customer.email",
  customer_address: "customer.address",
  inv_customer_name: "customer.name",
  inv_customer_ico: "customer.ico",
  inv_customer_dic: "customer.dic",
  inv_customer_address: "customer.address",
  inv_customer_email: "customer.email",
  device_name: "device.name",
  device_serial: "device.serial",
  device_imei: "device.imei",
  device_state: "device.condition",
  device_problem: "device.issue",
  service_name: "service.name",
  service_phone: "service.phone",
  service_email: "service.email",
  service_address: "service.address",
  service_ico: "service.ico",
  service_dic: "service.dic",
  inv_supplier_name: "service.name",
  inv_supplier_ico: "service.ico",
  inv_supplier_dic: "service.dic",
  inv_supplier_address: "service.address",
  inv_supplier_email: "service.email",
  inv_supplier_phone: "service.phone",
  repair_date: "dates.received",
  repair_completion_date: "dates.eta",
  inv_issue_date: "dates.issued",
  inv_date_issued: "dates.issued",
  inv_due_date: "dates.due",
  inv_date_due: "dates.due",
  inv_taxable_date: "dates.taxable",
  inv_date_taxable: "dates.taxable",
  total_price: "totals.total",
  inv_total: "totals.total",
  inv_subtotal: "totals.subtotal",
  inv_vat: "totals.vat",
  inv_vat_amount: "totals.vat",
  warranty_until: "warranty.until",
  diagnostic_text: "diagnostic",
  inv_notes: "note",
  inv_vs: "payment.vs",
  inv_supplier_bank: "payment.account",
  inv_supplier_iban: "payment.iban",
  inv_supplier_swift: "payment.swift",
  inv_iban: "payment.iban",
  inv_account_number: "payment.account",
};

// ---------------------------------------------------------------------------
// Formátování
// ---------------------------------------------------------------------------

const ISO_DATE = /^\d{4}-\d{2}-\d{2}(?:[T ].*)?$/;

/** ISO datum → „1. 9. 2026“. Už naformátovaný text projde beze změny. */
export function formatDate(value: string | undefined | null): string {
  if (!value) return "";
  const s = String(value).trim();
  if (!ISO_DATE.test(s)) return s;
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return s;
  return `${d.getDate()}. ${d.getMonth() + 1}. ${d.getFullYear()}`;
}

/** Částka → „1 890,00 Kč“. */
export function formatMoney(value: number | undefined | null, currency = "CZK"): string {
  if (value == null || !Number.isFinite(value)) return "";
  try {
    return new Intl.NumberFormat("cs-CZ", { style: "currency", currency, minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(value);
  } catch {
    return `${value.toFixed(2).replace(".", ",")} ${currency}`;
  }
}

export function formatQty(value: number | undefined | null): string {
  if (value == null || !Number.isFinite(value)) return "";
  return new Intl.NumberFormat("cs-CZ", { maximumFractionDigits: 3 }).format(value);
}

/** České skloňování měsíců: 1 měsíc, 2 měsíce, 5 měsíců (i 21, 22, 25). */
export function monthsText(n: number): string {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return `${n} měsíc`;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return `${n} měsíce`;
  return `${n} měsíců`;
}

/** Součet položek, když Jobi neposlalo totals.total. */
export function itemsTotal(data: DocumentData): number | undefined {
  if (data.totals?.total != null) return data.totals.total;
  const items = data.items ?? [];
  if (items.length === 0) return undefined;
  let sum = 0;
  for (const it of items) {
    const line = it.total ?? (it.unitPrice != null ? it.unitPrice * (it.qty ?? 1) : undefined);
    if (line == null) return undefined;
    sum += line;
  }
  if (data.discount) {
    sum = data.discount.type === "percentage" ? sum * (1 - data.discount.value / 100) : sum - data.discount.value;
  }
  return Math.max(0, Math.round(sum * 100) / 100);
}

// ---------------------------------------------------------------------------
// Dosazení
// ---------------------------------------------------------------------------

function joinParts(parts: Array<string | undefined>, sep: string): string {
  return parts.map((p) => (p ?? "").trim()).filter(Boolean).join(sep);
}

/** Hodnota proměnné jako text; prázdný řetězec = není k dispozici. */
export function resolveVariable(key: string, data: DocumentData): string {
  const k = LEGACY_ALIASES[key] ?? key;
  const currency = data.totals?.currency ?? "CZK";
  switch (k) {
    case "number": return data.number ?? "";
    case "relatedNumber": return data.relatedNumber ?? "";
    case "pin": return data.pin ?? "";
    case "portalUrl": return data.portalUrl ?? "";
    case "today": return formatDate(new Date().toISOString());
    case "customer.contact": return joinParts([data.customer?.name, data.customer?.phone ? `Tel.: ${data.customer.phone}` : undefined], ", ");
    case "device.serialOrImei": return data.device?.serial || data.device?.imei || "";
    case "totals.total": return formatMoney(itemsTotal(data), currency);
    case "totals.subtotal": return formatMoney(data.totals?.subtotal, currency);
    case "totals.vat": return formatMoney(data.totals?.vat, currency);
    case "totals.estimated": return formatMoney(data.totals?.estimated, currency);
    case "items.count": return String(data.items?.length ?? 0);
    case "items.summary": {
      const items = data.items ?? [];
      if (items.length === 0) return "";
      return items.map((it) => joinParts([it.name, it.total != null || it.unitPrice != null ? formatMoney(it.total ?? (it.unitPrice ?? 0) * (it.qty ?? 1), currency) : undefined], " – ")).join("; ");
    }
    case "warranty.months": return data.warranty?.months != null ? String(data.warranty.months) : "";
    case "warranty.until": return formatDate(data.warranty?.until);
    case "warranty.text": return data.warranty?.text ?? "";
    case "diagnostic": return data.diagnostic ?? "";
    case "note": return data.note ?? "";
  }
  if (k.startsWith("dates.")) {
    const field = k.slice(6) as keyof NonNullable<DocumentData["dates"]>;
    return formatDate(data.dates?.[field]);
  }
  if (k.startsWith("extra.")) return data.extra?.[k.slice(6)] ?? "";
  const [root, field] = k.split(".");
  if (!field) return "";
  const obj = (data as unknown as Record<string, Record<string, unknown> | undefined>)[root];
  const v = obj?.[field];
  if (v == null) return "";
  if (typeof v === "number") return String(v);
  return String(v);
}

const VAR_RE = /\{\{\s*([\w.]+)\s*\}\}/g;

export function hasVariables(text: string): boolean {
  return /\{\{\s*[\w.]+\s*\}\}/.test(text);
}

/** Dosadí proměnné. Neznámá proměnná zůstane jako {{název}}, aby si jí uživatel všiml. */
export function substitute(text: string, data: DocumentData): string {
  return text.replace(VAR_RE, (_m, key: string) => {
    const known = isKnownVariable(key);
    const val = resolveVariable(key, data);
    if (val === "" && !known) return `{{${key}}}`;
    return val;
  });
}

/**
 * Text je „prázdný“, když obsahuje proměnné a po dosazení zbyl jen text,
 * který by tam byl i bez nich (např. „Tel.: “). Používá se na skrývání
 * řádků bez dat.
 */
export function isEmptyAfterSubstitution(text: string, data: DocumentData): boolean {
  if (!hasVariables(text)) return text.trim() === "";
  const filled = text.replace(VAR_RE, (_m, key: string) => resolveVariable(key, data));
  const blank = text.replace(VAR_RE, "");
  return filled.trim() === blank.trim();
}

/** V editoru: proměnné jako čitelné zástupné texty (štítek proměnné). */
export function substitutePlaceholders(text: string): string {
  return text.replace(VAR_RE, (_m, key: string) => {
    const k = LEGACY_ALIASES[key] ?? key;
    const def = VARIABLES.find((v) => v.key === k);
    return `⟨${def?.label ?? key}⟩`;
  });
}

export function isKnownVariable(key: string): boolean {
  const k = LEGACY_ALIASES[key] ?? key;
  if (k.startsWith("extra.")) return true;
  return VARIABLES.some((v) => v.key === k);
}

export function variableGroups(): Array<{ group: string; items: VariableDef[] }> {
  const out: Array<{ group: string; items: VariableDef[] }> = [];
  for (const v of VARIABLES) {
    let g = out.find((x) => x.group === v.group);
    if (!g) {
      g = { group: v.group, items: [] };
      out.push(g);
    }
    g.items.push(v);
  }
  return out;
}
