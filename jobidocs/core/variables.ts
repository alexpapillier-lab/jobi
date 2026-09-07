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
import type { DocumentData, LineItem } from "./types.js";

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
  { key: "title", label: "Nadpis dokladu (Faktura / Zálohová faktura / Dobropis)", group: G.doc, sample: "Faktura – daňový doklad" },
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
  { key: "loaner.name", label: "Náhradní zařízení", group: G.device, sample: "iPhone SE 2020, černý" },
  { key: "loaner.serial", label: "Náhradní zařízení – sériové číslo / IMEI", group: G.device, sample: "DNPZK0ABCD12" },
  { key: "loaner.accessories", label: "Náhradní zařízení – příslušenství", group: G.device, sample: "Nabíječka, kryt" },
  { key: "loaner.deposit", label: "Náhradní zařízení – kauce", group: G.price, sample: "2 000,00 Kč" },
  { key: "loaner.depositText", label: "Náhradní zařízení – kauce (jen když je; do textu)", group: G.price, sample: "2 000,00 Kč" },
  { key: "loaner.lentAt", label: "Náhradní zařízení – půjčeno dne", group: G.dates, sample: "1. 9. 2026" },
  { key: "loaner.returnedAt", label: "Náhradní zařízení – vráceno dne", group: G.dates, sample: "4. 9. 2026" },
  { key: "loaner.note", label: "Náhradní zařízení – poznámka", group: G.other, sample: "Drobné škrábance na krytu." },
  { key: "checklist.summary", label: "Kontrola po opravě – shrnutí", group: G.other, sample: "Ověřeno 8 z 8, vše v pořádku" },
  { key: "checklist.list", label: "Kontrola po opravě – položky po řádcích", group: G.other, sample: "✓ Displej a dotyk po celé ploše\n✓ Nabíjení a přenos dat\n✗ Tlačítka a vibrace – vibrace slabší" },
  { key: "note", label: "Poznámka", group: G.other, sample: "" },
  { key: "warranty.months", label: "Záruka (měsíce)", group: G.other, sample: "12" },
  { key: "warranty.days", label: "Záruka (dny)", group: G.other, sample: "" },
  { key: "warranty.duration", label: "Záruční doba", group: G.other, sample: "12 měsíců" },
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
  checklist_summary: "checklist.summary",
  checklist_list: "checklist.list",
  inv_notes: "note",
  inv_title: "title",
  doc_title: "title",
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

/**
 * Zaokrouhlení na haléře, půlka vždy od nuly.
 *
 * Kopie `naHalere` z `src/lib/invoiceMath.ts` – jádro dokladů je záměrně bez
 * závislosti na Jobi (běží i v Electronu a v JobiDocs samostatně), takže se
 * vzorec musí opsat. Shodu obou implementací hlídá `src/lib/penize.test.ts`.
 *
 * Proč ne holé `Math.round(x * 100) / 100`: to posílá půlku k plus nekonečnu
 * a nemá epsilon. Zakázka za 100,75 Kč se slevou 10 % pak měla na dokladu
 * „Sleva −10,07 Kč“, kdežto Jobi počítalo 10,08 Kč – řádky na papíře
 * nesečetly „Celkem k úhradě“, které přišlo z Jobi.
 */
export function naHalere(n: number): number {
  if (!Number.isFinite(n)) return 0;
  const setiny = Math.abs(n) * 100;
  const zaokrouhleno = Math.round(setiny + setiny * Number.EPSILON) / 100;
  return zaokrouhleno === 0 ? 0 : n < 0 ? -zaokrouhleno : zaokrouhleno;
}

/** Částka → „1 890,00 Kč“. */
export function formatMoney(value: number | undefined | null, currency = "CZK"): string {
  if (value == null || !Number.isFinite(value)) return "";
  /* Záporná nula a zbytky pod půl haléře: dobropis na −0,004 Kč se dřív
     vytiskl jako „−0,00 Kč“, zatímco v aplikaci svítilo „0,00 Kč“.
     Stejné tlumení má `formatCurrency` v src/lib/invoiceMath.ts. */
  const v = Math.abs(value) < 0.005 ? 0 : value;
  try {
    return new Intl.NumberFormat("cs-CZ", { style: "currency", currency, minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(v);
  } catch {
    /* Neznámý kód měny nesmí shodit tisk. Formát musí i tady zůstat český
       včetně oddělovače tisíců – `toFixed` dřív vyrobil „1234,50 CZZ“,
       zatímco aplikace psala „1 234,50 CZZ“. */
    return `${new Intl.NumberFormat("cs-CZ", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(v)} ${currency}`;
  }
}

export function formatQty(value: number | undefined | null): string {
  if (value == null || !Number.isFinite(value)) return "";
  return new Intl.NumberFormat("cs-CZ", { maximumFractionDigits: 3 }).format(value);
}

/**
 * České skloňování: 1 měsíc, 2–4 měsíce, jinak měsíců.
 *
 * Pozor na číslovky nad dvacet zapsané číslicí: čte se „dvacet jedna
 * měsíců“, ne „dvacet jedna měsíc“, takže se řídí celé číslo, ne jeho
 * poslední číslice (jako v ruštině nebo polštině). Proto „21 měsíců“
 * i „24 měsíců“ – dřív z toho na záručním listu bylo „24 měsíce“.
 */
export function monthsText(n: number): string {
  if (n === 1) return `${n} měsíc`;
  if (n >= 2 && n <= 4) return `${n} měsíce`;
  return `${n} měsíců`;
}

/** Totéž pro dny: 1 den, 2–4 dny, jinak dnů. */
export function daysText(n: number): string {
  if (n === 1) return `${n} den`;
  if (n >= 2 && n <= 4) return `${n} dny`;
  return `${n} dnů`;
}

/**
 * Záruční doba do věty („24 měsíců“, „45 dnů“).
 *
 * Když servis délku záruky nemá nastavenou, nesmí v právním textu zůstat
 * díra („poskytuje servis záruku  měsíců“). Vypsat místo ní nějaké číslo by
 * znamenalo slíbit zákazníkovi dobu, kterou servis nesjednal, proto se
 * použije zákonná délka – ta platí i bez ujednání a nic navíc neslibuje.
 */
export function warrantyDurationText(warranty: DocumentData["warranty"]): string {
  if (warranty?.months != null && warranty.months > 0) return monthsText(warranty.months);
  if (warranty?.days != null && warranty.days > 0) return daysText(warranty.days);
  return "v zákonné délce";
}

/** Cena řádku: buď je vyplněná, nebo se spočítá z ceny za jednotku. */
function lineTotal(it: LineItem): number | undefined {
  return it.total ?? (it.unitPrice != null ? it.unitPrice * (it.qty ?? 1) : undefined);
}

/** Součet oceněných položek – tatáž hrubá cena, se kterou počítá Jobi. */
function soucetOcenenych(data: DocumentData): number | undefined {
  let sum = 0;
  let ocenenych = 0;
  for (const it of data.items ?? []) {
    const line = lineTotal(it);
    if (line == null) continue;
    sum += line;
    ocenenych += 1;
  }
  return ocenenych > 0 ? naHalere(sum) : undefined;
}

/** Součet položek před slevou; `undefined`, když u některé chybí cena. */
export function itemsSubtotal(data: DocumentData): number | undefined {
  const items = data.items ?? [];
  if (items.length === 0) return undefined;
  // Chybí-li cena u jediné opravy, součet by tvrdil, že je zdarma.
  if (items.some((it) => lineTotal(it) == null)) return undefined;
  return soucetOcenenych(data);
}

/**
 * Kolik sleva doopravdy ubere – nikdy víc, než kolik stojí oprava.
 *
 * Sleva 5 000 na zakázce za 1 500 znamená překlep nebo slevu z jiné
 * zakázky. Vytisknout „Sleva −5 000, Celkem 0,00“ znamená napsat na doklad
 * dvě čísla, která si odporují, a zákazník u pultu právem chce doplatek.
 * Stejný strop má i výpočet v Jobi (castkaSlevy v src/lib/slevaZakazky.ts).
 */
export function discountAmount(data: DocumentData): number | undefined {
  const d = data.discount;
  if (!d || !(d.value > 0)) return undefined;
  // Když má cenu jen část oprav, řádek Celkem stejně přijde z Jobi už po
  // slevě – sleva se proto počítá ze součtu oceněných oprav, aby na dokladu
  // nechyběl řádek, který nižší částku vysvětluje.
  const subtotal = soucetOcenenych(data);
  // Bez jediné ceny se sleva ověřit nedá; radši ji netisknout než tisknout
  // částku, ke které na dokladu není z čeho dojít.
  if (subtotal == null || subtotal <= 0) return undefined;
  const raw = d.type === "percentage" ? (subtotal * d.value) / 100 : d.value;
  return Math.min(subtotal, naHalere(raw));
}

/**
 * Rekapitulace DPH po sazbách.
 *
 * Přednost má rozpis poslaný z Jobi; když chybí (starší šablona, doklad
 * poslaný e-mailem přes proměnné), odvodí se z položek. Bez toho se na
 * faktuře s 21% i 12% položkou tiskl jediný slitý řádek „DPH“ a účetní
 * si daň zpětně nerozpočítala.
 */
export function vatRozpis(data: DocumentData): Array<{ rate: number; base: number; vat: number }> {
  const poslany = data.totals?.vatBreakdown;
  if (poslany && poslany.length > 0) return [...poslany].sort((a, b) => a.rate - b.rate);
  const podleSazby = new Map<number, { base: number; vat: number }>();
  for (const it of data.items ?? []) {
    const rate = it.vatRate;
    const line = lineTotal(it);
    if (rate == null || !Number.isFinite(rate) || line == null) continue;
    const e = podleSazby.get(rate) ?? { base: 0, vat: 0 };
    const zaklad = naHalere(line);
    e.base = naHalere(e.base + zaklad);
    e.vat = naHalere(e.vat + naHalere(zaklad * (rate / 100)));
    podleSazby.set(rate, e);
  }
  return Array.from(podleSazby.entries())
    .sort((a, b) => a[0] - b[0])
    .map(([rate, v]) => ({ rate, base: v.base, vat: v.vat }));
}

/** Součet položek po slevě, když Jobi neposlalo totals.total. */
export function itemsTotal(data: DocumentData): number | undefined {
  if (data.totals?.total != null) return data.totals.total;
  const subtotal = itemsSubtotal(data);
  if (subtotal == null) return undefined;
  return Math.max(0, naHalere(subtotal - (discountAmount(data) ?? 0)));
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
    case "title": return data.title ?? "";
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
    case "warranty.duration": return warrantyDurationText(data.warranty);
    case "warranty.until": return formatDate(data.warranty?.until);
    case "warranty.text": return data.warranty?.text ?? "";
    case "diagnostic": return data.diagnostic ?? "";
    case "loaner.name": return data.loaner?.name ?? "";
    case "loaner.serial": return data.loaner?.serial ?? "";
    case "loaner.accessories": return data.loaner?.accessories ?? "";
    case "loaner.deposit": return data.loaner?.deposit ? formatMoney(data.loaner.deposit, data.totals?.currency) : data.loaner ? "bez kauce" : "";
    case "loaner.depositText": return data.loaner?.deposit ? formatMoney(data.loaner.deposit, data.totals?.currency) : "";
    case "loaner.lentAt": return formatDate(data.loaner?.lentAt);
    case "loaner.returnedAt": return formatDate(data.loaner?.returnedAt);
    case "loaner.note": return data.loaner?.note ?? "";
    case "checklist.summary": {
      const items = data.checklist?.items ?? [];
      if (items.length === 0) return "";
      const overeno = items.filter((i) => i.status).length;
      const chyb = items.filter((i) => i.status === "fail").length;
      const zaklad = `Ověřeno ${overeno} z ${items.length}`;
      return chyb > 0 ? `${zaklad}, ${chyb} s chybou` : overeno === items.length ? `${zaklad}, vše v pořádku` : zaklad;
    }
    case "checklist.list": {
      const items = data.checklist?.items ?? [];
      return items
        .map((i) => `${i.status === "ok" ? "✓" : i.status === "fail" ? "✗" : "–"} ${i.text}${i.note ? ` – ${i.note}` : ""}`)
        .join("\n");
    }
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
