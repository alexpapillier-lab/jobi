/**
 * Edge Function: automations-run
 * Vykonavatel stavebnice automatizací (tabulky automation_rules / automation_runs,
 * typy v src/lib/automations.ts).
 *
 * Dva vstupy, oba POST JSON:
 *
 *  1) { mode: "scheduled", secret }
 *     Volá pg_cron přes pg_net (public.automations_tick) každých 15 minut.
 *     Tajemství se porovná s Vaultem (RPC automations_cron_secret). Projde
 *     všechny servisy s aktivními pravidly a vyhodnotí:
 *       - status_age  „zakázka je ve stavu déle než N hodin“
 *       - event       události zákaznického portálu (ticket_portal_events)
 *
 *  2) { service_id, ticket_id, event: "status_change" | "ticket_created", status_key? }
 *     Volá Jobi s JWT uživatele hned po změně stavu / založení zakázky.
 *     Ověří členství v servisu a vyhodnotí pravidla status_change pro daný
 *     stav (resp. ticket_created).
 *
 * Každé vyhodnocení skončí řádkem v automation_runs (ok / skipped / error).
 * Chyba jednoho pravidla nikdy nezastaví ostatní.
 *
 * Nasazuje se s --no-verify-jwt (plánovaný běh JWT nemá).
 */
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient, SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const PORTAL_BASE_URL = "https://appjobi.com/z/";
const TWILIO_BASE = "https://api.twilio.com/2010-04-01";
const SMS_MAX_BODY_LENGTH = 1600;
/** Kolik zakázek na pravidlo a tik – ať jeden servis s tisíci zakázkami nezablokuje ostatní. */
const MAX_TICKETS_PER_RULE = 200;
/** Události portálu se berou o něco starší než interval tiku (15 min), překryv řeší dedupe. */
const EVENT_LOOKBACK_MS = 20 * 60 * 1000;
/** Přeskočená / chybná status_age pravidla se zkusí znovu nejdřív za den (jinak by log rostl každých 15 minut). */
const RETRY_SKIPPED_HOURS = 24;

// ---------------------------------------------------------------------------
// Typy (kopie kontraktu ze src/lib/automations.ts – edge funkce ze src importovat nemůže)

type AutomationEvent = "quote_approved" | "quote_rejected" | "signed" | "portal_opened";

type Trigger =
  | { type: "status_change"; status_key: string }
  | { type: "status_age"; status_key: string; after_hours: number; repeat_hours?: number | null }
  | { type: "event"; event: AutomationEvent }
  | { type: "ticket_created" };

type Action =
  | { type: "sms"; template: string }
  | { type: "email"; subject: string; body: string }
  | { type: "set_status"; status_key: string }
  | { type: "add_fee"; name: string; amount: number; per_day?: boolean }
  | { type: "notify"; message: string };

type Conditions = {
  skip_final?: boolean;
  once_per_ticket?: boolean;
  require_phone?: boolean;
  require_email?: boolean;
};

type Rule = {
  id: string;
  service_id: string;
  name: string;
  active: boolean;
  trigger: Trigger;
  action: Action;
  conditions: Conditions | null;
  sort_order: number;
};

type RunResult = "ok" | "skipped" | "error";

type TicketRow = {
  id: string;
  service_id: string;
  code: string | null;
  status: string;
  notes: string | null;
  created_at: string;
  updated_at: string | null;
  deleted_at: string | null;
  expected_completion_at: string | null;
  customer_name: string | null;
  customer_phone: string | null;
  customer_email: string | null;
  device_label: string | null;
  device_brand: string | null;
  device_model: string | null;
  performed_repairs: unknown;
  discount_type: string | null;
  discount_value: number | string | null;
  portal_token: string | null;
};

const TICKET_COLUMNS =
  "id, service_id, code, status, notes, created_at, updated_at, deleted_at, expected_completion_at, " +
  "customer_name, customer_phone, customer_email, device_label, device_brand, device_model, " +
  "performed_repairs, discount_type, discount_value, portal_token";

type StatusInfo = { key: string; label: string; is_final: boolean };

/** Co se k servisu načte jednou a sdílí mezi pravidly. */
type ServiceCtx = {
  serviceId: string;
  statuses: Map<string, StatusInfo>;
  serviceName: string;
  servicePhone: string;
  serviceEmail: string;
  /** null = ještě nezjišťováno */
  smsEntitled: boolean | null;
  twilioNumber: string | null | undefined; // undefined = ještě nezjišťováno
};

type Counters = { ran: number; skipped: number; errors: number };

/** Doplňky k vyhodnocení jednoho pravidla nad jednou zakázkou. */
type EvalExtra = {
  /** Počet dní ve stavu (status_age); u ostatních 0. */
  days?: number;
  /** Id události portálu – uloží se do detailu kvůli dedupe. */
  eventId?: string;
  /** Hloubka řetězení set_status → status_change (0 = přímé volání). */
  depth?: number;
};

// ---------------------------------------------------------------------------
// Odpovědi a drobnosti

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json; charset=utf-8" },
  });
}

function errMsg(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

function toNumber(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}

function strOrNull(v: unknown): string | null {
  return typeof v === "string" && v.trim() ? v.trim() : null;
}

/** Porovnání tajemství bez rozdílu v čase podle první neshody. */
function secretsEqual(a: string, b: string): boolean {
  const ea = new TextEncoder().encode(a);
  const eb = new TextEncoder().encode(b);
  if (ea.length !== eb.length) return false;
  let diff = 0;
  for (let i = 0; i < ea.length; i++) diff |= ea[i] ^ eb[i];
  return diff === 0;
}

/** Stejné jako substituteTemplate v src/lib/automations.ts. */
function substituteTemplate(template: string, vars: Record<string, string>): string {
  return template.replace(/\{\{\s*(\w+)\s*\}\}/g, (_, k: string) => vars[k] ?? "");
}

/** Stejné jako v sms-send: E.164 pro Twilio, výchozí +420. */
function normalizeE164(phone: string): string {
  const digits = phone.replace(/\D/g, "");
  if (!digits.length) return phone.trim().startsWith("+") ? phone.trim() : `+${phone.trim()}`;
  if (digits.length === 9 && /^[79]/.test(digits)) return `+420${digits}`;
  if (digits.length === 10 && digits.startsWith("0") && /^0[79]/.test(digits)) return `+420${digits.slice(1)}`;
  if (digits.startsWith("420") && digits.length === 12) return `+${digits}`;
  if (digits.startsWith("00420") && digits.length === 14) return `+420${digits.slice(5)}`;
  const withPlus = digits.startsWith("+") ? digits : `+${digits}`;
  return withPlus.replace(/^\+0+/, "+") || "+";
}

function escapeHtml(s: string): string {
  return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/** „2 490“ – celé koruny s mezerou po tisících (obyčejná mezera, ne NBSP, kvůli SMS). */
function formatPrice(n: number): string {
  const rounded = Math.round(n);
  const sign = rounded < 0 ? "-" : "";
  return sign + String(Math.abs(rounded)).replace(/\B(?=(\d{3})+(?!\d))/g, " ");
}

/** „8. 9. 2026“ v pražském čase. */
function formatDateCz(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  try {
    const parts = new Intl.DateTimeFormat("cs-CZ", {
      timeZone: "Europe/Prague",
      day: "numeric",
      month: "numeric",
      year: "numeric",
    }).formatToParts(d);
    const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
    return `${get("day")}. ${get("month")}. ${get("year")}`;
  } catch {
    return `${d.getUTCDate()}. ${d.getUTCMonth() + 1}. ${d.getUTCFullYear()}`;
  }
}

type Repair = { name: string; price: number };

function parseRepairs(v: unknown): Repair[] {
  if (!Array.isArray(v)) return [];
  const out: Repair[] = [];
  for (const r of v) {
    if (!r || typeof r !== "object") continue;
    const o = r as Record<string, unknown>;
    out.push({ name: typeof o.name === "string" ? o.name : "", price: toNumber(o.price) ?? 0 });
  }
  return out;
}

/** Stejné pravidlo jako computeFinalPrice v src/components/tickets/types.ts. */
function computeFinalPrice(repairs: Repair[], discountType: string | null, discountValue: number | null): number {
  const total = repairs.reduce((s, r) => s + (r.price || 0), 0);
  const value = discountValue || 0;
  let discount = 0;
  if (discountType === "percentage") discount = (total * value) / 100;
  else if (discountType === "amount") discount = value;
  return Math.max(0, total - discount);
}

function deviceLabel(t: TicketRow): string {
  if (t.device_label && t.device_label.trim()) return t.device_label.trim();
  return [t.device_brand, t.device_model].filter((x) => x && x.trim()).join(" ").trim();
}

function hoursBetween(from: Date, to: Date): number {
  return (to.getTime() - from.getTime()) / 3_600_000;
}

// ---------------------------------------------------------------------------
// Kontext servisu

async function loadServiceCtx(svc: SupabaseClient, serviceId: string): Promise<ServiceCtx> {
  const [statusRes, settingsRes, serviceRes] = await Promise.all([
    svc.from("service_statuses").select("key, label, is_final").eq("service_id", serviceId),
    svc.from("service_settings").select("config").eq("service_id", serviceId).maybeSingle(),
    svc.from("services").select("name").eq("id", serviceId).maybeSingle(),
  ]);

  const statuses = new Map<string, StatusInfo>();
  for (const s of (statusRes.data ?? []) as StatusInfo[]) {
    statuses.set(s.key, { key: s.key, label: s.label || s.key, is_final: s.is_final === true });
  }

  const config = (settingsRes.data?.config ?? {}) as Record<string, unknown>;
  const cd = (config.companyData && typeof config.companyData === "object"
    ? config.companyData
    : {}) as Record<string, unknown>;

  return {
    serviceId,
    statuses,
    serviceName: strOrNull(cd.name) ?? strOrNull(serviceRes.data?.name) ?? "",
    servicePhone: strOrNull(cd.phone) ?? "",
    serviceEmail: strOrNull(cd.email) ?? "",
    smsEntitled: null,
    twilioNumber: undefined,
  };
}

async function loadTicket(svc: SupabaseClient, ticketId: string): Promise<TicketRow | null> {
  const { data, error } = await svc.from("tickets").select(TICKET_COLUMNS).eq("id", ticketId).maybeSingle();
  if (error || !data) return null;
  return data as unknown as TicketRow;
}

/** Aktivní pravidla servisu (nebo všech servisů, když serviceId chybí). */
async function loadActiveRules(svc: SupabaseClient, serviceId?: string): Promise<Rule[]> {
  let q = svc
    .from("automation_rules")
    .select("id, service_id, name, active, trigger, action, conditions, sort_order")
    .eq("active", true)
    .order("service_id", { ascending: true })
    .order("sort_order", { ascending: true });
  if (serviceId) q = q.eq("service_id", serviceId);
  const { data, error } = await q;
  if (error) throw new Error(`automation_rules: ${error.message}`);
  return ((data ?? []) as Rule[]).filter((r) => r.trigger && typeof r.trigger === "object" && r.action && typeof r.action === "object");
}

// ---------------------------------------------------------------------------
// Log spuštění

async function logRun(
  svc: SupabaseClient,
  rule: Rule,
  ticketId: string | null,
  result: RunResult,
  detail: string | null,
  counters: Counters,
): Promise<void> {
  if (result === "ok") counters.ran += 1;
  else if (result === "skipped") counters.skipped += 1;
  else counters.errors += 1;

  const { error } = await svc.from("automation_runs").insert({
    rule_id: rule.id,
    ticket_id: ticketId,
    service_id: rule.service_id,
    result,
    detail: detail ? detail.slice(0, 2000) : null,
  });
  if (error) console.error("[automations-run] automation_runs insert:", error.message);
}

/** Existuje k pravidlu a zakázce úspěšné spuštění? */
async function hasOkRun(svc: SupabaseClient, ruleId: string, ticketId: string): Promise<boolean> {
  const { data } = await svc
    .from("automation_runs")
    .select("id")
    .eq("rule_id", ruleId)
    .eq("ticket_id", ticketId)
    .eq("result", "ok")
    .limit(1);
  return Array.isArray(data) && data.length > 0;
}

// ---------------------------------------------------------------------------
// Proměnné šablon

async function ensurePortalToken(svc: SupabaseClient, ticket: TicketRow): Promise<string | null> {
  if (ticket.portal_token) return ticket.portal_token;
  // Stejný tvar jako RPC ensure_portal_token: 24 bajtů → base64url bez '='.
  for (let attempt = 0; attempt < 3; attempt++) {
    const bytes = new Uint8Array(24);
    crypto.getRandomValues(bytes);
    const token = btoa(String.fromCharCode(...bytes)).replace(/=+$/, "").replace(/\+/g, "-").replace(/\//g, "_");
    const { error } = await svc
      .from("tickets")
      .update({ portal_token: token })
      .eq("id", ticket.id)
      .is("portal_token", null);
    if (!error) break;
    if (error.code !== "23505") break; // jiná chyba než kolize – nemá smysl opakovat
  }
  const { data } = await svc.from("tickets").select("portal_token").eq("id", ticket.id).maybeSingle();
  const token = (data as { portal_token?: string | null } | null)?.portal_token ?? null;
  if (token) ticket.portal_token = token;
  return token;
}

async function buildVars(
  svc: SupabaseClient,
  ctx: ServiceCtx,
  ticket: TicketRow,
  days: number,
  templateText: string,
): Promise<Record<string, string>> {
  const repairs = parseRepairs(ticket.performed_repairs);
  const total = computeFinalPrice(repairs, ticket.discount_type, toNumber(ticket.discount_value));

  // Token portálu se zakládá jen když ho šablona opravdu používá.
  let portalUrl = "";
  if (templateText.includes("portal_url")) {
    const token = await ensurePortalToken(svc, ticket);
    if (token) portalUrl = `${PORTAL_BASE_URL}?t=${encodeURIComponent(token)}`;
  }

  return {
    code: ticket.code ?? "",
    customer_name: ticket.customer_name ?? "",
    device_label: deviceLabel(ticket),
    status: ctx.statuses.get(ticket.status)?.label ?? ticket.status,
    total_price: formatPrice(total),
    notes: ticket.notes ?? "",
    expected_date: formatDateCz(ticket.expected_completion_at),
    days: String(days),
    portal_url: portalUrl,
    service_name: ctx.serviceName,
    service_phone: ctx.servicePhone,
  };
}

// ---------------------------------------------------------------------------
// Akce – každá vrací [výsledek, detail]; nikdy nevyhazují.

type ActionOutcome = [RunResult, string | null];

async function actionSms(svc: SupabaseClient, ctx: ServiceCtx, ticket: TicketRow, template: string, days: number): Promise<ActionOutcome> {
  const phoneRaw = strOrNull(ticket.customer_phone);
  if (!phoneRaw) return ["skipped", "Zákazník nemá telefon"];

  // Nárok na modul SMS – stejně jako sms-send, ověřuje se na serveru.
  if (ctx.smsEntitled === null) {
    const { data, error } = await svc.rpc("has_entitlement", { p_service_id: ctx.serviceId, p_module: "sms" });
    ctx.smsEntitled = !error && data === true;
  }
  if (!ctx.smsEntitled) return ["skipped", "Modul SMS není pro servis aktivní"];

  if (ctx.twilioNumber === undefined) {
    const { data } = await svc
      .from("service_phone_numbers")
      .select("twilio_number")
      .eq("service_id", ctx.serviceId)
      .eq("active", true)
      .maybeSingle();
    ctx.twilioNumber = (data as { twilio_number?: string } | null)?.twilio_number ?? null;
  }
  if (!ctx.twilioNumber) return ["skipped", "Servis nemá aktivní telefonní číslo pro SMS"];

  const accountSid = Deno.env.get("TWILIO_ACCOUNT_SID");
  const authToken = Deno.env.get("TWILIO_AUTH_TOKEN");
  if (!accountSid || !authToken) return ["error", "SMS není nakonfigurována (TWILIO_ACCOUNT_SID / TWILIO_AUTH_TOKEN)"];

  const vars = await buildVars(svc, ctx, ticket, days, template);
  const body = substituteTemplate(template, vars).trim().slice(0, SMS_MAX_BODY_LENGTH);
  if (!body) return ["skipped", "Prázdná zpráva po dosazení proměnných"];

  const to = normalizeE164(phoneRaw);

  // Konverzace – stejně jako sms-send, ať se zpráva ukáže v chatu.
  let conversationId: string | null = null;
  const { data: existingConv } = await svc
    .from("sms_conversations")
    .select("id, customer_name")
    .eq("service_id", ctx.serviceId)
    .eq("customer_phone", to)
    .maybeSingle();
  if (existingConv) {
    conversationId = (existingConv as { id: string }).id;
    const updates: Record<string, unknown> = { ticket_id: ticket.id };
    const cn = (existingConv as { customer_name?: string | null }).customer_name;
    if (!cn?.trim() && ticket.customer_name?.trim()) updates.customer_name = ticket.customer_name.trim().slice(0, 200);
    await svc.from("sms_conversations").update(updates).eq("id", conversationId);
  } else {
    const { data: newConv, error: convErr } = await svc
      .from("sms_conversations")
      .insert({
        service_id: ctx.serviceId,
        customer_phone: to,
        ticket_id: ticket.id,
        customer_name: ticket.customer_name?.trim().slice(0, 200) || null,
      })
      .select("id")
      .single();
    if (convErr || !newConv) return ["error", `Nepodařilo se založit konverzaci: ${convErr?.message ?? "?"}`];
    conversationId = (newConv as { id: string }).id;
  }

  let twilioData: Record<string, unknown> = {};
  let twilioOk = false;
  let twilioStatusText = "";
  try {
    const res = await fetch(`${TWILIO_BASE}/Accounts/${accountSid}/Messages.json`, {
      method: "POST",
      headers: {
        Authorization: `Basic ${btoa(`${accountSid}:${authToken}`)}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({ From: ctx.twilioNumber, To: to, Body: body }).toString(),
    });
    twilioOk = res.ok;
    twilioStatusText = res.statusText;
    twilioData = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  } catch (e) {
    return ["error", `Twilio: ${errMsg(e)}`];
  }

  if (!twilioOk) {
    const msg = strOrNull(twilioData.message) ?? twilioStatusText ?? "neznámá chyba";
    const code = twilioData.code != null ? ` (${twilioData.code})` : "";
    return ["error", `Twilio${code}: ${msg}`];
  }

  const twilioSid = strOrNull(twilioData.sid);
  const { error: msgErr } = await svc.from("sms_messages").insert({
    conversation_id: conversationId,
    direction: "outbound",
    body,
    twilio_sid: twilioSid,
    status: strOrNull(twilioData.status),
  });
  if (msgErr) return ["ok", `SMS odeslána (${twilioSid ?? "bez SID"}), ale nezapsala se do chatu: ${msgErr.message}`];
  return ["ok", `SMS na ${to}${twilioSid ? ` (${twilioSid})` : ""}`];
}

async function actionEmail(
  svc: SupabaseClient,
  ctx: ServiceCtx,
  ticket: TicketRow,
  subjectTpl: string,
  bodyTpl: string,
  days: number,
): Promise<ActionOutcome> {
  const to = strOrNull(ticket.customer_email);
  if (!to || !to.includes("@")) return ["skipped", "Zákazník nemá e-mail"];

  const resendKey = Deno.env.get("RESEND_API_KEY")?.trim();
  if (!resendKey) return ["error", "E-mail není nakonfigurován (RESEND_API_KEY)"];
  const fromEmail = Deno.env.get("RESEND_FROM_EMAIL")?.trim() || "Jobi <onboarding@resend.dev>";

  const vars = await buildVars(svc, ctx, ticket, days, `${subjectTpl}\n${bodyTpl}`);
  const subject = substituteTemplate(subjectTpl, vars).trim() || `Zakázka ${vars.code}`.trim();
  const text = substituteTemplate(bodyTpl, vars).trim();
  if (!text) return ["skipped", "Prázdný text e-mailu po dosazení proměnných"];

  const html = [
    '<!DOCTYPE html><html><head><meta charset="utf-8"></head>',
    '<body style="margin:0;padding:24px 16px;font-family:-apple-system,BlinkMacSystemFont,Segoe UI,Roboto,Arial,sans-serif;background:#f9fafb">',
    '<div style="max-width:520px;margin:0 auto;background:#fff;border-radius:12px;padding:32px 24px;font-size:14px;color:#374151;line-height:1.6">',
    escapeHtml(text).replace(/\n/g, "<br>"),
    "</div>",
    `<p style="text-align:center;margin-top:16px;font-size:11px;color:#9ca3af">${escapeHtml(ctx.serviceName || "Odesláno přes Jobi")}</p>`,
    "</body></html>",
  ].join("");

  const payload: Record<string, unknown> = { from: fromEmail, to: [to], subject, text, html };
  if (ctx.serviceEmail.includes("@")) payload.reply_to = ctx.serviceEmail;

  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${resendKey}` },
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      const errText = await res.text().catch(() => "");
      return ["error", `Resend ${res.status}: ${errText.slice(0, 300)}`];
    }
    const data = (await res.json().catch(() => ({}))) as { id?: string };
    return ["ok", `E-mail na ${to}${data?.id ? ` (${data.id})` : ""}`];
  } catch (e) {
    return ["error", `Resend: ${errMsg(e)}`];
  }
}

async function actionSetStatus(svc: SupabaseClient, ctx: ServiceCtx, ticket: TicketRow, statusKey: string): Promise<ActionOutcome> {
  if (!ctx.statuses.has(statusKey)) return ["error", `Stav „${statusKey}“ v servisu neexistuje`];
  if (ticket.status === statusKey) return ["skipped", `Zakázka už je ve stavu „${ctx.statuses.get(statusKey)?.label ?? statusKey}“`];

  // Trigger ticket_history_log zapíše změnu do historie (changed_by = NULL = automatizace).
  const { error } = await svc.from("tickets").update({ status: statusKey }).eq("id", ticket.id).is("deleted_at", null);
  if (error) return ["error", `Změna stavu selhala: ${error.message}`];
  const from = ctx.statuses.get(ticket.status)?.label ?? ticket.status;
  ticket.status = statusKey;
  return ["ok", `Stav „${from}“ → „${ctx.statuses.get(statusKey)?.label ?? statusKey}“`];
}

async function actionAddFee(
  svc: SupabaseClient,
  rule: Rule,
  ticket: TicketRow,
  name: string,
  amount: number,
  perDay: boolean,
  days: number,
): Promise<ActionOutcome> {
  // Poplatek vždy jen jednou na zakázku – i když once_per_ticket vypnul.
  if (await hasOkRun(svc, rule.id, ticket.id)) return ["skipped", "Poplatek už byl připsán"];

  const multiplier = perDay ? Math.max(0, days) : 1;
  const price = Math.round(amount * multiplier * 100) / 100;
  if (!Number.isFinite(price) || price <= 0) return ["skipped", `Poplatek vyšel na ${price} Kč – nepřipisuje se`];

  // Aktuální seznam oprav znovu z DB, ať se nepřepíše, co mezitím přidal technik.
  const { data: fresh, error: readErr } = await svc.from("tickets").select("performed_repairs").eq("id", ticket.id).maybeSingle();
  if (readErr || !fresh) return ["error", `Nepodařilo se načíst opravy: ${readErr?.message ?? "zakázka nenalezena"}`];
  const current = Array.isArray((fresh as { performed_repairs?: unknown }).performed_repairs)
    ? ((fresh as { performed_repairs: unknown[] }).performed_repairs)
    : [];

  const label = perDay && days > 0 ? `${name} (${days} × ${formatPrice(amount)} Kč)` : name;
  const item = { id: `auto-${rule.id.slice(0, 8)}-${Date.now().toString(36)}`, name: label, type: "manual", price };
  const next = [...current, item];

  const { error } = await svc.from("tickets").update({ performed_repairs: next }).eq("id", ticket.id);
  if (error) return ["error", `Připsání poplatku selhalo: ${error.message}`];
  ticket.performed_repairs = next;
  return ["ok", `Připsáno „${label}“ ${formatPrice(price)} Kč`];
}

async function actionNotify(svc: SupabaseClient, ctx: ServiceCtx, ticket: TicketRow, messageTpl: string, days: number): Promise<ActionOutcome> {
  const vars = await buildVars(svc, ctx, ticket, days, messageTpl);
  const content = substituteTemplate(messageTpl, vars).trim();
  if (!content) return ["skipped", "Prázdná poznámka po dosazení proměnných"];

  // ticket_comments: author text, author_id nullable (auth.users) → automatizace bez autora.
  const { error } = await svc.from("ticket_comments").insert({
    ticket_id: ticket.id,
    service_id: ctx.serviceId,
    author: "Automatizace",
    content,
  });
  if (error) return ["error", `Zápis poznámky selhal: ${error.message}`];
  return ["ok", `Poznámka: ${content.slice(0, 120)}`];
}

// ---------------------------------------------------------------------------
// Vyhodnocení jednoho pravidla nad jednou zakázkou

async function evaluateRule(
  svc: SupabaseClient,
  ctx: ServiceCtx,
  rule: Rule,
  ticket: TicketRow,
  extra: EvalExtra,
  counters: Counters,
): Promise<void> {
  const days = extra.days ?? 0;
  const depth = extra.depth ?? 0;
  const prefix = extra.eventId ? `event:${extra.eventId} ` : "";
  const log = (result: RunResult, detail: string | null) =>
    logRun(svc, rule, ticket.id, result, detail ? `${prefix}${detail}` : prefix || null, counters);

  try {
    const c = rule.conditions ?? {};

    if (ticket.deleted_at) {
      await log("skipped", "Zakázka je smazaná");
      return;
    }
    // skip_final se netýká stavu, na který pravidlo samo míří („při přepnutí
    // do Vyzvednuto → SMS“ by se jinak nikdy nespustilo).
    const targetsCurrentStatus =
      (rule.trigger.type === "status_change" || rule.trigger.type === "status_age") &&
      rule.trigger.status_key === ticket.status;
    if (c.skip_final !== false && !targetsCurrentStatus && ctx.statuses.get(ticket.status)?.is_final) {
      await log("skipped", `Zakázka je v koncovém stavu „${ctx.statuses.get(ticket.status)?.label ?? ticket.status}“`);
      return;
    }
    // U status_age s repeat_hours rozhoduje odstup opakování (řeší se před voláním), ne once_per_ticket.
    const repeating = rule.trigger.type === "status_age" && !!rule.trigger.repeat_hours;
    if (c.once_per_ticket !== false && !repeating && (await hasOkRun(svc, rule.id, ticket.id))) {
      await log("skipped", "Pravidlo už na této zakázce proběhlo");
      return;
    }
    if (c.require_phone && !strOrNull(ticket.customer_phone)) {
      await log("skipped", "Zákazník nemá telefon");
      return;
    }
    if (c.require_email && !strOrNull(ticket.customer_email)?.includes("@")) {
      await log("skipped", "Zákazník nemá e-mail");
      return;
    }

    const a = rule.action;
    let outcome: ActionOutcome;
    switch (a.type) {
      case "sms":
        outcome = await actionSms(svc, ctx, ticket, String(a.template ?? ""), days);
        break;
      case "email":
        outcome = await actionEmail(svc, ctx, ticket, String(a.subject ?? ""), String(a.body ?? ""), days);
        break;
      case "set_status":
        outcome = await actionSetStatus(svc, ctx, ticket, String(a.status_key ?? ""));
        break;
      case "add_fee":
        outcome = await actionAddFee(svc, rule, ticket, String(a.name ?? "Poplatek"), toNumber(a.amount) ?? 0, a.per_day === true, days);
        break;
      case "notify":
        outcome = await actionNotify(svc, ctx, ticket, String(a.message ?? ""), days);
        break;
      default:
        outcome = ["error", `Neznámá akce „${(a as { type?: string }).type}“`];
    }

    await log(outcome[0], outcome[1]);

    // Přepnutí stavu spustí pravidla „při stavu“ pro nový stav – jen o jednu
    // úroveň, ať se dva vzájemně přepínající pravidla netočí donekonečna.
    if (a.type === "set_status" && outcome[0] === "ok" && depth === 0) {
      await runStatusChange(svc, ctx, ticket, ticket.status, depth + 1, counters);
    }
  } catch (e) {
    await log("error", errMsg(e));
  }
}

/** Pravidla status_change pro daný stav nad jednou zakázkou. */
async function runStatusChange(
  svc: SupabaseClient,
  ctx: ServiceCtx,
  ticket: TicketRow,
  statusKey: string,
  depth: number,
  counters: Counters,
  preloaded?: Rule[],
): Promise<void> {
  const rules = (preloaded ?? (await loadActiveRules(svc, ctx.serviceId))).filter(
    (r) => r.trigger.type === "status_change" && r.trigger.status_key === statusKey,
  );
  for (const rule of rules) {
    await evaluateRule(svc, ctx, rule, ticket, { depth }, counters);
  }
}

// ---------------------------------------------------------------------------
// Plánovaný běh: status_age

async function runStatusAgeRule(svc: SupabaseClient, ctx: ServiceCtx, rule: Rule, now: Date, counters: Counters): Promise<void> {
  const t = rule.trigger as Extract<Trigger, { type: "status_age" }>;
  const afterHours = toNumber(t.after_hours) ?? 0;
  const repeatHours = toNumber(t.repeat_hours);
  if (!t.status_key || afterHours <= 0) return;

  const { data: ticketsData, error } = await svc
    .from("tickets")
    .select(TICKET_COLUMNS)
    .eq("service_id", ctx.serviceId)
    .eq("status", t.status_key)
    .is("deleted_at", null)
    .order("updated_at", { ascending: true })
    .limit(MAX_TICKETS_PER_RULE);
  if (error) {
    await logRun(svc, rule, null, "error", `Načtení zakázek: ${error.message}`, counters);
    return;
  }
  const tickets = (ticketsData ?? []) as unknown as TicketRow[];
  if (!tickets.length) return;
  const ids = tickets.map((x) => x.id);

  // Od kdy je zakázka ve stavu: poslední záznam historie, kde se stav přepnul
  // na status_key. Bez záznamu (import, starší data) updated_at, pak created_at.
  const since = new Map<string, Date>();
  const { data: hist } = await svc
    .from("ticket_history")
    .select("ticket_id, created_at")
    .in("ticket_id", ids)
    .eq("details->changes->status->>new", t.status_key)
    .order("created_at", { ascending: false });
  for (const h of (hist ?? []) as Array<{ ticket_id: string; created_at: string }>) {
    if (!since.has(h.ticket_id)) since.set(h.ticket_id, new Date(h.created_at));
  }

  // Poslední spuštění pravidla na každé zakázce (jakýkoli výsledek).
  const lastRun = new Map<string, { ran_at: Date; result: RunResult }>();
  const { data: runs } = await svc
    .from("automation_runs")
    .select("ticket_id, ran_at, result")
    .eq("rule_id", rule.id)
    .in("ticket_id", ids)
    .order("ran_at", { ascending: false });
  for (const r of (runs ?? []) as Array<{ ticket_id: string; ran_at: string; result: RunResult }>) {
    if (!lastRun.has(r.ticket_id)) lastRun.set(r.ticket_id, { ran_at: new Date(r.ran_at), result: r.result });
  }

  for (const ticket of tickets) {
    const from = since.get(ticket.id) ?? new Date(ticket.updated_at ?? ticket.created_at);
    const hoursInStatus = hoursBetween(from, now);
    if (!Number.isFinite(hoursInStatus) || hoursInStatus < afterHours) continue;

    // Dedupe potichu (bez řádku v logu), jinak by log rostl každých 15 minut.
    const last = lastRun.get(ticket.id);
    if (last) {
      const sinceRun = hoursBetween(last.ran_at, now);
      if (last.result === "ok") {
        if (!repeatHours || repeatHours <= 0) continue; // jednou na zakázku
        if (sinceRun < repeatHours) continue; // ještě neuběhl odstup opakování
      } else {
        // skipped / error: zkusit znovu nejdřív po odstupu opakování, resp. za den
        const retryAfter = repeatHours && repeatHours > 0 ? Math.min(repeatHours, RETRY_SKIPPED_HOURS) : RETRY_SKIPPED_HOURS;
        if (sinceRun < retryAfter) continue;
      }
    }

    await evaluateRule(svc, ctx, rule, ticket, { days: Math.floor(hoursInStatus / 24) }, counters);
  }
}

// ---------------------------------------------------------------------------
// Plánovaný běh: události portálu

const EVENT_MAP: Record<string, AutomationEvent> = {
  opened: "portal_opened",
  quote_approved: "quote_approved",
  quote_rejected: "quote_rejected",
  signed: "signed",
};

type PortalEvent = { id: string; ticket_id: string; type: string; created_at: string };

async function runEventRules(svc: SupabaseClient, ctx: ServiceCtx, rules: Rule[], now: Date, counters: Counters): Promise<void> {
  if (!rules.length) return;
  const sinceIso = new Date(now.getTime() - EVENT_LOOKBACK_MS).toISOString();
  const { data, error } = await svc
    .from("ticket_portal_events")
    .select("id, ticket_id, type, created_at")
    .eq("service_id", ctx.serviceId)
    .in("type", Object.keys(EVENT_MAP))
    .gte("created_at", sinceIso)
    .order("created_at", { ascending: true })
    .limit(MAX_TICKETS_PER_RULE * rules.length);
  if (error) {
    for (const rule of rules) await logRun(svc, rule, null, "error", `Načtení událostí portálu: ${error.message}`, counters);
    return;
  }
  const events = (data ?? []) as PortalEvent[];
  if (!events.length) return;

  const ticketCache = new Map<string, TicketRow | null>();

  for (const rule of rules) {
    const wanted = (rule.trigger as Extract<Trigger, { type: "event" }>).event;
    const mine = events.filter((e) => EVENT_MAP[e.type] === wanted);
    if (!mine.length) continue;

    // Už zpracované události tohoto pravidla (detail začíná „event:<id>“).
    const { data: done } = await svc
      .from("automation_runs")
      .select("detail")
      .eq("rule_id", rule.id)
      .gte("ran_at", new Date(now.getTime() - 2 * EVENT_LOOKBACK_MS).toISOString())
      .like("detail", "event:%");
    const doneIds = new Set<string>();
    for (const r of (done ?? []) as Array<{ detail: string | null }>) {
      const m = /^event:([0-9a-f-]{36})/i.exec(r.detail ?? "");
      if (m) doneIds.add(m[1].toLowerCase());
    }

    let processed = 0;
    for (const ev of mine) {
      if (doneIds.has(ev.id.toLowerCase())) continue;
      if (processed >= MAX_TICKETS_PER_RULE) break;
      processed += 1;

      if (!ticketCache.has(ev.ticket_id)) ticketCache.set(ev.ticket_id, await loadTicket(svc, ev.ticket_id));
      const ticket = ticketCache.get(ev.ticket_id);
      if (!ticket) {
        await logRun(svc, rule, null, "skipped", `event:${ev.id} Zakázka nenalezena`, counters);
        continue;
      }
      await evaluateRule(svc, ctx, rule, ticket, { eventId: ev.id }, counters);
    }
  }
}

// ---------------------------------------------------------------------------
// Vstupy

async function handleScheduled(svc: SupabaseClient, body: Record<string, unknown>): Promise<Response> {
  const secret = typeof body.secret === "string" ? body.secret : "";
  const { data: expected, error: secretErr } = await svc.rpc("automations_cron_secret");
  if (secretErr || typeof expected !== "string" || !expected) {
    console.error("[automations-run] automations_cron_secret:", secretErr?.message ?? "prázdné");
    return json({ error: "Plánovač není nastaven" }, 503);
  }
  if (!secret || !secretsEqual(secret, expected)) return json({ error: "Forbidden" }, 403);

  const counters: Counters = { ran: 0, skipped: 0, errors: 0 };
  const now = new Date();

  let rules: Rule[];
  try {
    rules = (await loadActiveRules(svc)).filter((r) => r.trigger.type === "status_age" || r.trigger.type === "event");
  } catch (e) {
    return json({ error: errMsg(e) }, 500);
  }

  const byService = new Map<string, Rule[]>();
  for (const r of rules) {
    const list = byService.get(r.service_id) ?? [];
    list.push(r);
    byService.set(r.service_id, list);
  }

  for (const [serviceId, serviceRules] of byService) {
    let ctx: ServiceCtx;
    try {
      ctx = await loadServiceCtx(svc, serviceId);
    } catch (e) {
      console.error(`[automations-run] kontext servisu ${serviceId}:`, errMsg(e));
      counters.errors += 1;
      continue;
    }

    for (const rule of serviceRules.filter((r) => r.trigger.type === "status_age")) {
      try {
        await runStatusAgeRule(svc, ctx, rule, now, counters);
      } catch (e) {
        await logRun(svc, rule, null, "error", errMsg(e), counters);
      }
    }

    try {
      await runEventRules(svc, ctx, serviceRules.filter((r) => r.trigger.type === "event"), now, counters);
    } catch (e) {
      console.error(`[automations-run] události portálu ${serviceId}:`, errMsg(e));
      counters.errors += 1;
    }
  }

  return json({ ok: true, ...counters });
}

async function handleImmediate(req: Request, svc: SupabaseClient, body: Record<string, unknown>): Promise<Response> {
  const authHeader = req.headers.get("Authorization") ?? req.headers.get("authorization") ?? "";
  if (!authHeader.startsWith("Bearer ")) return json({ error: "Missing or invalid authorization header" }, 401);
  const token = authHeader.replace(/^Bearer\s+/i, "").trim();

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
  const userClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false },
  });
  const { data: userRes, error: userErr } = await userClient.auth.getUser();
  if (userErr || !userRes?.user) return json({ error: "Unauthorized", detail: userErr?.message }, 401);
  const userId = userRes.user.id;

  const serviceId = strOrNull(body.service_id);
  const ticketId = strOrNull(body.ticket_id);
  const event = strOrNull(body.event);
  const statusKey = strOrNull(body.status_key);
  if (!serviceId || !ticketId) return json({ error: "Missing required fields: service_id, ticket_id" }, 400);
  if (event !== "status_change" && event !== "ticket_created") {
    return json({ error: "event musí být status_change nebo ticket_created" }, 400);
  }

  // Členství: pod RLS uživatel vidí jen vlastní řádek (nebo jako owner/admin celý servis).
  const { data: membership, error: memErr } = await userClient
    .from("service_memberships")
    .select("service_id")
    .eq("service_id", serviceId)
    .eq("user_id", userId)
    .maybeSingle();
  if (memErr || !membership) return json({ error: "Nejste členem tohoto servisu" }, 403);

  const ticket = await loadTicket(svc, ticketId);
  if (!ticket || ticket.service_id !== serviceId) return json({ error: "Zakázka nenalezena" }, 404);

  const counters: Counters = { ran: 0, skipped: 0, errors: 0 };
  let rules: Rule[];
  let ctx: ServiceCtx;
  try {
    [rules, ctx] = await Promise.all([loadActiveRules(svc, serviceId), loadServiceCtx(svc, serviceId)]);
  } catch (e) {
    return json({ error: errMsg(e) }, 500);
  }

  if (event === "ticket_created") {
    for (const rule of rules.filter((r) => r.trigger.type === "ticket_created")) {
      await evaluateRule(svc, ctx, rule, ticket, { depth: 0 }, counters);
    }
  } else {
    await runStatusChange(svc, ctx, ticket, statusKey ?? ticket.status, 0, counters, rules);
  }

  return json({ ok: true, ...counters });
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  try {
    const body = ((await req.json().catch(() => ({}))) ?? {}) as Record<string, unknown>;
    const svc = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
      auth: { persistSession: false },
    });

    if (body.mode === "scheduled") return await handleScheduled(svc, body);
    return await handleImmediate(req, svc, body);
  } catch (e) {
    console.error("[automations-run]", e);
    return json({ error: "Internal error", detail: errMsg(e) }, 500);
  }
});
