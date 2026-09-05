/**
 * Zákaznický portál – vazba Jobi na veřejnou stránku https://appjobi.com/z/?t=<token>.
 *
 * Sloupce `tickets.portal_*` / `quote_*` / `intake_*` a tabulka
 * `ticket_portal_events` vznikají samostatnou migrací. Do jejího nasazení
 * se proto nesmí dostat do hlavních selectů zakázek – tady se načítají
 * zvlášť (viz `loadPortalTicketFields`) a chybějící sloupec jen znamená
 * „portál není zapnutý“, ne rozbitý detail.
 */
import { supabase, supabaseUrl, supabaseFetch } from "./supabaseClient";
import { reportSilent } from "./reportError";

export const PORTAL_BASE_URL = "https://appjobi.com/z/";

export type QuoteStatus = "none" | "sent" | "approved" | "rejected";

/**
 * Položka nabídky. Tvar je schválně shodný s `PerformedRepair`, aby se po
 * schválení dala nabídka přenést do provedených oprav beze změny.
 */
export type QuoteItem = {
  id: string;
  name: string;
  price?: number;
  costs?: number;
  estimatedTime?: number;
  repairId?: string;
  productIds?: string[];
  type?: "selected" | "manual";
};

export type QuoteDecisionMeta = {
  ip?: string;
  userAgent?: string;
  note?: string;
};

export type PortalEventType =
  | "opened"
  | "quote_approved"
  | "quote_rejected"
  | "signed"
  | "pickup_confirmed"
  | "link_sent"
  | "quote_sent";

export type PortalEvent = {
  id: string;
  ticketId: string;
  serviceId: string;
  type: PortalEventType | string;
  meta: Record<string, unknown> | null;
  createdAt: string;
};

/** Sloupce zakázky, které patří portálu. Vybírají se jen tudy, nikdy v hlavním selectu. */
export const PORTAL_TICKET_COLUMNS = [
  "portal_token",
  "quote_amount",
  "quote_note",
  "quote_status",
  "quote_sent_at",
  "quote_decided_at",
  "quote_decision_meta",
  "quote_items",
  "intake_signature_url",
  "intake_signed_at",
  "portal_last_opened_at",
] as const;

export type PortalTicketFields = {
  portalToken?: string;
  quoteAmount?: number;
  quoteNote?: string;
  quoteStatus?: QuoteStatus;
  quoteSentAt?: string;
  quoteDecidedAt?: string;
  quoteDecisionMeta?: QuoteDecisionMeta;
  quoteItems?: QuoteItem[];
  intakeSignatureUrl?: string;
  intakeSignedAt?: string;
  portalLastOpenedAt?: string;
};

export const PORTAL_EVENT_LABELS: Record<PortalEventType, string> = {
  opened: "Zákazník otevřel portál",
  quote_sent: "Cenová nabídka odeslána",
  quote_approved: "Zákazník schválil nabídku",
  quote_rejected: "Zákazník nabídku zamítl",
  signed: "Zákazník podepsal převzetí",
  pickup_confirmed: "Zákazník potvrdil vyzvednutí",
  link_sent: "Odkaz odeslán SMS",
};

export function portalEventLabel(type: string): string {
  return (PORTAL_EVENT_LABELS as Record<string, string>)[type] ?? type;
}

export function portalUrl(token: string): string {
  return `${PORTAL_BASE_URL}?t=${encodeURIComponent(token)}`;
}

/** „4. 9. 10:22“; rok jen když se liší od letošního. */
export function formatPortalDateTime(iso: string | undefined | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  const year = d.getFullYear() === new Date().getFullYear() ? "" : ` ${d.getFullYear()}`;
  return `${d.getDate()}. ${d.getMonth() + 1}.${year} ${hh}:${mm}`;
}

function isQuoteStatus(v: unknown): v is QuoteStatus {
  return v === "none" || v === "sent" || v === "approved" || v === "rejected";
}

function str(v: unknown): string | undefined {
  return typeof v === "string" && v.length > 0 ? v : undefined;
}

/**
 * Mapování řádku `tickets` na portálová pole. Bezpečné vůči chybějícím
 * sloupcům – do výsledku jdou jen klíče, které v řádku skutečně jsou,
 * aby spread do TicketEx nepřepsal už načtené hodnoty prázdnem.
 */
export function mapPortalTicketFields(row: Record<string, unknown> | null | undefined): PortalTicketFields {
  if (!row || typeof row !== "object") return {};
  const out: PortalTicketFields = {};
  if ("portal_token" in row) out.portalToken = str(row.portal_token);
  if ("quote_amount" in row) {
    const n = row.quote_amount == null ? NaN : Number(row.quote_amount);
    out.quoteAmount = Number.isFinite(n) ? n : undefined;
  }
  if ("quote_note" in row) out.quoteNote = str(row.quote_note);
  if ("quote_status" in row) out.quoteStatus = isQuoteStatus(row.quote_status) ? row.quote_status : "none";
  if ("quote_sent_at" in row) out.quoteSentAt = str(row.quote_sent_at);
  if ("quote_decided_at" in row) out.quoteDecidedAt = str(row.quote_decided_at);
  if ("quote_items" in row) {
    out.quoteItems = Array.isArray(row.quote_items) ? (row.quote_items as QuoteItem[]) : [];
  }
  if ("quote_decision_meta" in row) {
    const m = row.quote_decision_meta;
    out.quoteDecisionMeta = m && typeof m === "object" ? (m as QuoteDecisionMeta) : undefined;
  }
  if ("intake_signature_url" in row) out.intakeSignatureUrl = str(row.intake_signature_url);
  if ("intake_signed_at" in row) out.intakeSignedAt = str(row.intake_signed_at);
  if ("portal_last_opened_at" in row) out.portalLastOpenedAt = str(row.portal_last_opened_at);
  return out;
}

function client() {
  if (!supabase) throw new Error("Supabase není k dispozici");
  // Nové tabulky/sloupce nejsou v generovaných typech – stejně jako jinde v Orders se jde přes any.
  return supabase as any;
}

/** Vrátí token portálu; když chybí, RPC ho založí. Vyhodí chybu, když RPC na serveru není. */
export async function ensurePortalToken(ticketId: string): Promise<string> {
  const { data, error } = await client().rpc("ensure_portal_token", { p_ticket_id: ticketId });
  if (error) throw error;
  if (typeof data !== "string" || !data) throw new Error("ensure_portal_token nevrátilo token");
  return data;
}

/**
 * Načte portálová pole zakázky samostatným selectem.
 * Chybějící sloupce (migrace ještě nenasazená) → null, bez toastu.
 */
export async function loadPortalTicketFields(ticketId: string): Promise<PortalTicketFields | null> {
  try {
    const { data, error } = await client()
      .from("tickets")
      .select(PORTAL_TICKET_COLUMNS.join(","))
      .eq("id", ticketId)
      .maybeSingle();
    if (error) throw error;
    return data ? mapPortalTicketFields(data) : null;
  } catch (error) {
    reportSilent({ code: "portal.fields_load_failed", error, source: "portal.loadPortalTicketFields", context: { ticketId } });
    return null;
  }
}

/** Uloží nabídku a přepne ji do stavu „čeká na schválení“. Verzi zakázky zvedá trigger v DB. */
export async function sendQuote(params: { ticketId: string; amount: number; note?: string; items?: QuoteItem[] }): Promise<PortalTicketFields> {
  const { ticketId, amount, note, items } = params;
  const { data, error } = await client()
    .from("tickets")
    .update({
      quote_amount: amount,
      quote_items: items ?? [],
      quote_note: note?.trim() || null,
      quote_status: "sent",
      quote_sent_at: new Date().toISOString(),
      quote_decided_at: null,
      quote_decision_meta: null,
    })
    .eq("id", ticketId)
    .select(PORTAL_TICKET_COLUMNS.join(","))
    .single();
  if (error) throw error;
  return mapPortalTicketFields(data);
}

/** Zruší rozeslanou nabídku (stav zpět na `none`). */
export async function cancelQuote(ticketId: string): Promise<PortalTicketFields> {
  const { data, error } = await client()
    .from("tickets")
    .update({ quote_status: "none", quote_sent_at: null, quote_decided_at: null, quote_decision_meta: null })
    .eq("id", ticketId)
    .select(PORTAL_TICKET_COLUMNS.join(","))
    .single();
  if (error) throw error;
  return mapPortalTicketFields(data);
}

/** Zapíše událost portálu. Selhání se jen zaloguje – nesmí zastavit akci, po které se volá. */
export async function logPortalEvent(
  ticketId: string,
  serviceId: string,
  type: PortalEventType,
  meta?: Record<string, unknown>
): Promise<void> {
  try {
    const { error } = await client()
      .from("ticket_portal_events")
      .insert({ ticket_id: ticketId, service_id: serviceId, type, meta: meta ?? {} });
    if (error) throw error;
  } catch (error) {
    reportSilent({ code: "portal.event_log_failed", error, source: "portal.logPortalEvent", serviceId, context: { ticketId, type } });
  }
}

/** Posledních 20 událostí, nejnovější první. Chybějící tabulka → prázdný seznam. */
export async function loadPortalEvents(ticketId: string): Promise<PortalEvent[]> {
  try {
    const { data, error } = await client()
      .from("ticket_portal_events")
      .select("id, ticket_id, service_id, type, meta, created_at")
      .eq("ticket_id", ticketId)
      .order("created_at", { ascending: false })
      .limit(20);
    if (error) throw error;
    return ((data ?? []) as Array<Record<string, unknown>>).map(mapPortalEventRow);
  } catch (error) {
    reportSilent({ code: "portal.events_load_failed", error, source: "portal.loadPortalEvents", context: { ticketId } });
    return [];
  }
}

export function mapPortalEventRow(row: Record<string, unknown>): PortalEvent {
  return {
    id: String(row.id ?? ""),
    ticketId: String(row.ticket_id ?? ""),
    serviceId: String(row.service_id ?? ""),
    type: String(row.type ?? ""),
    meta: row.meta && typeof row.meta === "object" ? (row.meta as Record<string, unknown>) : null,
    createdAt: String(row.created_at ?? ""),
  };
}

/** Odešle SMS přes edge funkci `sms-send` (stejně jako automatizace stavů v Orders). Vyhodí chybu se zprávou pro uživatele. */
export async function sendPortalSms(params: { serviceId: string; to: string; body: string; ticketId: string }): Promise<void> {
  if (!supabase) throw new Error("Supabase není k dispozici");
  const { data: sessionData } = await supabase.auth.getSession();
  const token = sessionData?.session?.access_token;
  if (!token) throw new Error("Nejste přihlášeni");
  const res = await supabaseFetch(`${supabaseUrl}/functions/v1/sms-send`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({ service_id: params.serviceId, to: params.to, body: params.body, ticket_id: params.ticketId }),
  });
  const raw = await res.text();
  let data: { error?: string } = {};
  try {
    if (raw) data = JSON.parse(raw);
  } catch {
    // tělo není JSON – rozhoduje HTTP status
  }
  if (!res.ok || data.error) throw new Error(data.error ?? "SMS se nepodařilo odeslat");
}
