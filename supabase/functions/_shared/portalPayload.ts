/**
 * Co zákaznický portál vydává ven.
 *
 * Portál je jediná stránka Jobi, kterou otevře kdokoli s odkazem, bez
 * přihlášení. Za tokenem jsou osobní údaje zákazníka, ceny a podpis
 * převzetí – a v `tickets` leží vedle nich i věci, které zákazník vidět
 * nesmí: telefon a e-mail zákazníka, IMEI, kód zámku, interní diagnostika,
 * u položek oprav nákupní cena (`costs`) a jméno technika.
 *
 * Proto je skládání odpovědi tady, a ne v těle `serve` v portal-ticket:
 * `_shared` umí spustit i vitest, takže nad **stejným** kódem, jaký běží
 * na serveru, hlídá test, že se do odpovědi nedostane nic navíc. Kdo přidá
 * sloupec do `TICKET_COLUMNS`, srazí se s testem, který porovnává přesný
 * seznam klíčů odpovědi.
 *
 * Sem se nesmí dostat nic, co sahá na síť nebo na Deno – čtení z databáze
 * zůstává v portal-ticket/index.ts.
 */
import { buildSpayd } from "./spayd.ts";
import { cenaZakazky, type TypSlevy } from "./penize.ts";

/**
 * Sloupce `tickets`, které portál vůbec načítá. Nic mimo tenhle seznam
 * k odpovědi nemá přístup.
 */
export const TICKET_COLUMNS_ZAKLAD =
  "id, service_id, code, status, notes, created_at, expected_completion_at, " +
  "device_label, device_brand, device_model, estimated_price, performed_repairs, " +
  "diagnostic_photos, diagnostic_photos_before, discount_type, discount_value, " +
  "handoff_method, handback_method, quote_amount, quote_items, quote_note, quote_status, " +
  "quote_sent_at, quote_decided_at, intake_signature_url, intake_signed_at, branch_id, " +
  "portal_last_opened_at";

/**
 * Totéž plus platnost odkazu. Sloupec přidává migrace `portal_platnost_odkazu`;
 * dokud nasazená není, select s ním skončí chybou a portál se přepne na
 * `TICKET_COLUMNS_ZAKLAD` (viz `loadTicket`). Nasazení funkce a migrace se tak
 * nemusí trefit do stejné minuty – při opačném pořadí by portál přestal
 * vydávat cokoli a zákazník by neměl jinou cestu k zakázce.
 */
export const TICKET_COLUMNS = `${TICKET_COLUMNS_ZAKLAD}, portal_token_expires_at`;

export type TicketRow = {
  id: string;
  service_id: string;
  branch_id?: string | null;
  code: string | null;
  status: string;
  notes: string | null;
  created_at: string;
  expected_completion_at: string | null;
  device_label: string | null;
  device_brand: string | null;
  device_model: string | null;
  estimated_price: number | string | null;
  performed_repairs: unknown;
  diagnostic_photos: unknown;
  diagnostic_photos_before: unknown;
  discount_type: string | null;
  discount_value: number | string | null;
  handoff_method: string | null;
  handback_method: string | null;
  quote_amount: number | string | null;
  quote_items: unknown;
  quote_note: string | null;
  quote_status: string;
  quote_sent_at: string | null;
  quote_decided_at: string | null;
  intake_signature_url: string | null;
  intake_signed_at: string | null;
  portal_last_opened_at?: string | null;
  /** Do kdy odkaz platí. NULL = odkazy založené před zavedením platnosti, ty nevyprší. */
  portal_token_expires_at?: string | null;
};

export type StavRow = { key: string; label: string; bg: string | null; fg: string | null; is_final: boolean } | null;

export type PobockaRow = {
  name: string;
  phone: string | null;
  email: string | null;
  address_street: string | null;
  address_city: string | null;
  address_zip: string | null;
  opening_hours: string | null;
  is_default: boolean;
  company_name: string | null;
  ico: string | null;
  bank_account: string | null;
  iban: string | null;
} | null;

export type Repair = { name: string; price: number };

// ---------------------------------------------------------------------------
// Pomocné

export function toNumber(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}

export function stringArray(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  return v.filter((x): x is string => typeof x === "string" && x.length > 0);
}

/**
 * Z položky opravy vezme JEN název a cenu.
 *
 * V `performed_repairs` i `quote_items` sedí vedle ceny i `costs` (nákupní
 * cena, tedy marže servisu), `technik` a `sazba`. Kdyby se položky poslaly
 * tak, jak jsou, zákazník by v odpovědi četl, kolik na něm servis vydělá.
 */
export function parseRepairs(v: unknown): Repair[] {
  if (!Array.isArray(v)) return [];
  const out: Repair[] = [];
  for (const r of v) {
    if (!r || typeof r !== "object") continue;
    const o = r as Record<string, unknown>;
    out.push({
      name: typeof o.name === "string" ? o.name : "",
      price: toNumber(o.price) ?? 0,
    });
  }
  return out;
}

/**
 * Konečná cena zakázky – sdílený vzorec (_shared/penize.ts), shodný
 * s `konecnaCena` v aplikaci. Číslo odsud vidí zákazník v portálu a nese
 * ho i QR platba, takže se od karty zakázky nesmí lišit ani o haléř.
 */
export function computeFinalPrice(repairs: Repair[], discountType: string | null, discountValue: number | null): number {
  return cenaZakazky(repairs, discountType as TypSlevy, discountValue);
}

export function deviceLabel(t: TicketRow): string {
  if (t.device_label && t.device_label.trim()) return t.device_label.trim();
  return [t.device_brand, t.device_model].filter((x) => x && x.trim()).join(" ").trim();
}

export function strOrNull(v: unknown): string | null {
  return typeof v === "string" && v.trim() ? v.trim() : null;
}

/**
 * Vypršel odkaz?
 *
 * Bez data platnosti (odkazy z doby před jejím zavedením) platí dál – zákazník
 * s rozdělanou zakázkou nesmí ze dne na den přijít o jedinou cestu k ní.
 */
export function odkazVyprsel(t: Pick<TicketRow, "portal_token_expires_at">, ted: Date = new Date()): boolean {
  const s = t.portal_token_expires_at;
  if (!s) return false;
  const d = new Date(s);
  return !Number.isNaN(d.getTime()) && d.getTime() <= ted.getTime();
}

export type Zdroje = {
  ticket: TicketRow;
  stav: StavRow;
  /** `service_settings.config` servisu. */
  config: Record<string, unknown>;
  /** `services.name` – použije se, když firemní ani pobočkový název nejsou vyplněné. */
  nazevServisu: string | null;
  pobocka: PobockaRow;
};

/**
 * Odpověď pro zákazníka. Čistá funkce – co není tady, portál nevydá.
 */
export function sestavPayload(z: Zdroje) {
  const t = z.ticket;
  const branch = z.pobocka;
  const branchHasAddress = !!(branch && (strOrNull(branch.address_street) || strOrNull(branch.address_city) || strOrNull(branch.address_zip)));

  // Zákazníkovi jde jen „uzavřeno / neuzavřeno“; interní název a barva
  // stavu jsou pracovní členění servisu a na portál nepatří.
  const status = { isFinal: z.stav?.is_final === true };

  const cd = (z.config.companyData && typeof z.config.companyData === "object"
    ? z.config.companyData
    : {}) as Record<string, unknown>;
  // Pobočka jako vlastní subjekt: název a účet pobočky mají přednost před firemními.
  const serviceName = (branch && strOrNull(branch.company_name)) ?? strOrNull(cd.name) ?? strOrNull(z.nazevServisu) ?? "";
  const branchHasBank = !!(branch && (strOrNull(branch.bank_account) || strOrNull(branch.iban)));

  const service = {
    name: serviceName,
    // Název pobočky jen u vedlejších poboček – u výchozí („Hlavní pobočka“) by za názvem servisu jen překážel.
    branch: branch && !branch.is_default ? strOrNull(branch.name) : null,
    openingHours: branch ? strOrNull(branch.opening_hours) : null,
    phone: (branch && strOrNull(branch.phone)) ?? strOrNull(cd.phone),
    email: (branch && strOrNull(branch.email)) ?? strOrNull(cd.email),
    website: strOrNull(cd.website),
    addressStreet: branchHasAddress ? strOrNull(branch!.address_street) : strOrNull(cd.addressStreet),
    addressCity: branchHasAddress ? strOrNull(branch!.address_city) : strOrNull(cd.addressCity),
    addressZip: branchHasAddress ? strOrNull(branch!.address_zip) : strOrNull(cd.addressZip),
    bankAccount: branchHasBank ? strOrNull(branch!.bank_account) : strOrNull(cd.bankAccount),
    iban: branchHasBank ? strOrNull(branch!.iban) : strOrNull(cd.iban),
  };

  const repairs = parseRepairs(t.performed_repairs);
  const discountValue = toNumber(t.discount_value);
  const discount =
    t.discount_type && discountValue !== null ? { type: t.discount_type, value: discountValue } : null;
  const totalPrice = computeFinalPrice(repairs, t.discount_type, discountValue);
  const quoteAmount = toNumber(t.quote_amount);

  const ticket = {
    code: t.code ?? "",
    createdAt: t.created_at,
    expectedCompletionAt: t.expected_completion_at,
    deviceLabel: deviceLabel(t),
    requestedRepair: t.notes ?? "",
    status,
    photosBefore: stringArray(t.diagnostic_photos_before),
    photos: stringArray(t.diagnostic_photos),
    performedRepairs: repairs,
    discount,
    totalPrice,
    estimatedPrice: toNumber(t.estimated_price),
    quote: {
      amount: quoteAmount,
      // Rozpis nabídky – zákazník má vidět, za co platí, ne jen součet.
      items: parseRepairs(t.quote_items),
      note: t.quote_note,
      status: t.quote_status ?? "none",
      sentAt: t.quote_sent_at,
      decidedAt: t.quote_decided_at,
    },
    intakeSignedAt: t.intake_signed_at,
    intakeSignatureUrl: t.intake_signature_url,
    handoffMethod: t.handoff_method,
    handbackMethod: t.handback_method,
  };

  // Platba: schválená nabídka má přednost, jinak cena provedených oprav
  let amount: number | null = null;
  if (t.quote_status === "approved" && quoteAmount !== null && quoteAmount > 0) amount = quoteAmount;
  else if (totalPrice > 0) amount = totalPrice;

  let payment: { amount: number; vs: string; spayd: string | null } | null = null;
  if (amount !== null && (service.iban || service.bankAccount)) {
    const vs = (t.code ?? "").replace(/\D/g, "").slice(-10);
    payment = {
      amount,
      vs,
      spayd: buildSpayd({
        iban: service.iban,
        bankAccount: service.bankAccount,
        amount,
        vs,
        message: `Zakazka ${t.code ?? ""}`.trim(),
      }),
    };
  }

  return { ok: true as const, ticket, service, payment };
}

// ---------------------------------------------------------------------------
// Otisk akce zákazníka

/**
 * Hlavička `User-Agent` chodí od klienta a nikdo ji neomezuje: brána pustí
 * i šestnáct kilobajtů. Bez zkrácení by se to celé uložilo do
 * `quote_decision_meta` a `ticket_portal_events.meta`, tedy do jsonb, který
 * se pak vykresluje v zakázce. Na rozpoznání prohlížeče stačí 300 znaků.
 */
export const MAX_USER_AGENT = 300;

export function otiskAkce(ip: string | null, userAgent: string | null, note: string | null) {
  return {
    ip,
    userAgent: typeof userAgent === "string" ? userAgent.slice(0, MAX_USER_AGENT) : null,
    note: note || null,
  };
}
