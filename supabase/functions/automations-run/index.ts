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
 *     a zpracuje splatné řádky fronty automation_schedule (run_at ≤ teď):
 *       - ticket_issued „N hodin po vydání zakázky“ – řádek zakládá databázový
 *         trigger při přepnutí do vydaného stavu; tady se hlídá denní okno
 *         (mimo okno se run_at posune na jeho začátek) a vyhodnotí pravidlo,
 *         typicky akce review_request (žádost o recenzi).
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
import { SMS_MAX_BODY_LENGTH, normalizeE164, segmentu, textProSms, zkontrolujBalicek, type SmsKlient } from "../_shared/sms.ts";
import { escapeHtml } from "../_shared/html.ts";
import { castkaBezMeny, cenaZakazky, formatujCastku, naHalere } from "../_shared/penize.ts";
import {
  RECENZE_VYCHOZI,
  dalsiCasOdeslani,
  maEmail,
  normalizujOdkazRecenze,
  sablonaSOdkazem,
  platneOkno,
  platnyLimitDni,
  posudKandidata,
  stavSpoustiRecenzi,
  zacatekLimitu,
} from "../_shared/recenze.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const PORTAL_BASE_URL = "https://appjobi.com/z/";
const TWILIO_BASE = "https://api.twilio.com/2010-04-01";
/** Kolik zakázek na pravidlo a tik – ať jeden servis s tisíci zakázkami nezablokuje ostatní. */
const MAX_TICKETS_PER_RULE = 200;
/** Události portálu se berou o něco starší než interval tiku (15 min), překryv řeší dedupe. */
const EVENT_LOOKBACK_MS = 20 * 60 * 1000;
/** Přeskočená / chybná status_age pravidla se zkusí znovu nejdřív za den (jinak by log rostl každých 15 minut). */
const RETRY_SKIPPED_HOURS = 24;
/** Kolik řádků fronty automation_schedule na jeden tik (všechny servisy dohromady). */
const MAX_SCHEDULED_PER_TICK = 200;
/** Řádek, který zůstal „processing“ déle (pád funkce uprostřed), se vrátí do fronty. */
const STALE_CLAIM_MS = 60 * 60 * 1000;
/** Naplánovaná akce, která skončí chybou (Twilio, Resend), se zkusí nejvýš tolikrát, vždy za hodinu. */
const MAX_SCHEDULE_ATTEMPTS = 3;
const SCHEDULE_RETRY_MS = 60 * 60 * 1000;

// ---------------------------------------------------------------------------
// Typy (kopie kontraktu ze src/lib/automations.ts – edge funkce ze src importovat nemůže)

type AutomationEvent = "quote_approved" | "quote_rejected" | "signed" | "portal_opened";

type Trigger =
  | { type: "status_change"; status_key: string }
  | { type: "status_age"; status_key: string; after_hours: number; repeat_hours?: number | null }
  | { type: "event"; event: AutomationEvent }
  | { type: "ticket_created" }
  | { type: "ticket_issued"; after_hours: number; status_keys?: string[] };

type Action =
  | { type: "sms"; template: string }
  | { type: "email"; subject: string; body: string }
  | { type: "set_status"; status_key: string }
  | { type: "add_fee"; name: string; amount: number; per_day?: boolean }
  | { type: "notify"; message: string }
  | { type: "review_request"; review_url: string; template: string; email_subject: string; email_body: string };

type Conditions = {
  skip_final?: boolean;
  once_per_ticket?: boolean;
  require_phone?: boolean;
  require_email?: boolean;
  send_from_hour?: number;
  send_to_hour?: number;
  time_zone?: string;
  customer_cooldown_days?: number;
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
  branch_id?: string | null;
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
  customer_id?: string | null;
};

const TICKET_COLUMNS =
  "id, service_id, code, status, notes, created_at, updated_at, deleted_at, expected_completion_at, " +
  "customer_name, customer_phone, customer_email, device_label, device_brand, device_model, " +
  "performed_repairs, discount_type, discount_value, portal_token, branch_id, customer_id";

type StatusInfo = { key: string; label: string; is_final: boolean };

/** Co se k servisu načte jednou a sdílí mezi pravidly. */
type ServiceCtx = {
  serviceId: string;
  statuses: Map<string, StatusInfo>;
  serviceName: string;
  servicePhone: string;
  serviceEmail: string;
  /** Kontakty poboček – telefon pobočky má v šablonách přednost před firemním. */
  branches: Map<string, { phone: string; email: string }>;
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

/**
 * „2 490,50“ – stejný formát jako v aplikaci i na dokladu, bez měny.
 *
 * Měnu si do šablony píše servis sám („{{total_price}} Kč“), proto se tu
 * nepřidává. Dřív se zaokrouhlovalo na celé koruny, takže SMS zákazníkovi
 * hlásila „1 235 Kč“, kdežto doklad zněl na 1 234,50 Kč. Nedělitelné mezery
 * z Intl převádí `textProSms` na obyčejné, takže se SMS nepřeklopí do UCS-2.
 */
function formatPrice(n: number): string {
  return castkaBezMeny(n);
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

/**
 * Konečná cena zakázky. Sdílený vzorec (_shared/penize.ts), aby SMS říkala
 * totéž co karta zakázky, portál i doklad. Vlastní kopie, která tu byla,
 * neuměla strop ani zaokrouhlení: záporná sleva cenu zvýšila a 33,33 %
 * z 1 000 Kč dalo 666,6700000000001.
 */
function computeFinalPrice(repairs: Repair[], discountType: string | null, discountValue: number | null): number {
  return cenaZakazky(repairs, discountType as "percentage" | "amount" | null, discountValue);
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
  const [statusRes, settingsRes, serviceRes, branchesRes] = await Promise.all([
    svc.from("service_statuses").select("key, label, is_final").eq("service_id", serviceId),
    svc.from("service_settings").select("config").eq("service_id", serviceId).maybeSingle(),
    svc.from("services").select("name").eq("id", serviceId).maybeSingle(),
    svc.from("branches").select("id, phone, email").eq("service_id", serviceId),
  ]);
  const branches = new Map<string, { phone: string; email: string }>();
  for (const b of (branchesRes.data ?? []) as { id: string; phone: string | null; email: string | null }[]) {
    branches.set(b.id, { phone: strOrNull(b.phone) ?? "", email: strOrNull(b.email) ?? "" });
  }

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
    branches,
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
  extraVars: Record<string, string> = {},
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
    service_phone: (ticket.branch_id && ctx.branches.get(ticket.branch_id)?.phone) || ctx.servicePhone,
    ...extraVars,
  };
}

// ---------------------------------------------------------------------------
// Akce – každá vrací [výsledek, detail]; nikdy nevyhazují.

type ActionOutcome = [RunResult, string | null];

/** Umí servis poslat SMS? Nárok na modul a aktivní číslo; výsledek se drží v kontextu. */
async function smsUnavailableReason(svc: SupabaseClient, ctx: ServiceCtx): Promise<string | null> {
  // Nárok na modul SMS – stejně jako sms-send, ověřuje se na serveru.
  if (ctx.smsEntitled === null) {
    const { data, error } = await svc.rpc("has_entitlement", { p_service_id: ctx.serviceId, p_module: "sms" });
    ctx.smsEntitled = !error && data === true;
  }
  if (!ctx.smsEntitled) return "Modul SMS není pro servis aktivní";

  if (ctx.twilioNumber === undefined) {
    const { data } = await svc
      .from("service_phone_numbers")
      .select("twilio_number")
      .eq("service_id", ctx.serviceId)
      .eq("active", true)
      .maybeSingle();
    ctx.twilioNumber = (data as { twilio_number?: string } | null)?.twilio_number ?? null;
  }
  if (!ctx.twilioNumber) return "Servis nemá aktivní telefonní číslo pro SMS";
  return null;
}

async function actionSms(
  svc: SupabaseClient,
  ctx: ServiceCtx,
  ticket: TicketRow,
  template: string,
  days: number,
  extraVars: Record<string, string> = {},
): Promise<ActionOutcome> {
  const phoneRaw = strOrNull(ticket.customer_phone);
  if (!phoneRaw) return ["skipped", "Zákazník nemá telefon"];

  const unavailable = await smsUnavailableReason(svc, ctx);
  if (unavailable || !ctx.twilioNumber) return ["skipped", unavailable ?? "Servis nemá aktivní telefonní číslo pro SMS"];

  const accountSid = Deno.env.get("TWILIO_ACCOUNT_SID");
  const authToken = Deno.env.get("TWILIO_AUTH_TOKEN");
  if (!accountSid || !authToken) return ["error", "SMS není nakonfigurována (TWILIO_ACCOUNT_SID / TWILIO_AUTH_TOKEN)"];

  const vars = await buildVars(svc, ctx, ticket, days, template, extraVars);
  /* Text se posílá stejně jako z chatu: bez diakritiky a bez typografických
     znaků. Automatizace to dřív nedělala, takže česká zpráva letěla v UCS-2
     po 70 znacích – dvakrát dražší, než co ukazoval chat u téhož textu. */
  const body = textProSms(substituteTemplate(template, vars)).trim().slice(0, SMS_MAX_BODY_LENGTH);
  if (!body) return ["skipped", "Prázdná zpráva po dosazení proměnných"];

  /* Balíček SMS. Tohle tu dřív nebylo: automatizace posílaly mimo strop, a
     protože přes ně jde většina zpráv (změna stavu → SMS zákazníkovi), byl
     zaplacený balíček jen číslo na obrazovce. Servis se stovkou zakázek za
     měsíc tak mohl protelefonovat mnohonásobek toho, co si koupil. */
  const potreba = segmentu(body);
  const balicek = await zkontrolujBalicek(svc as unknown as SmsKlient, ctx.serviceId, potreba);
  // Když se balíček nepodařilo spočítat, zpráva se neodesílá – běh skončí
  // jako chyba, ať je to v `automation_runs` vidět a dá se to zopakovat.
  if (balicek.chyba) return ["error", `Balíček SMS se nepodařilo ověřit: ${balicek.chyba}`];
  if (balicek.prekroceno) return ["skipped", balicek.zprava ?? "Balíček SMS je vyčerpaný"];

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
  extraVars: Record<string, string> = {},
): Promise<ActionOutcome> {
  const to = strOrNull(ticket.customer_email);
  if (!to || !to.includes("@")) return ["skipped", "Zákazník nemá e-mail"];

  const resendKey = Deno.env.get("RESEND_API_KEY")?.trim();
  if (!resendKey) return ["error", "E-mail není nakonfigurován (RESEND_API_KEY)"];
  const fromEmail = Deno.env.get("RESEND_FROM_EMAIL")?.trim() || "Jobi <onboarding@resend.dev>";

  const vars = await buildVars(svc, ctx, ticket, days, `${subjectTpl}\n${bodyTpl}`, extraVars);
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
  // Poplatek jde do provedených oprav, odkud se počítá cena zakázky i doklad –
  // musí se proto zaokrouhlovat týmž vzorcem, ne vlastní kopií.
  const price = naHalere(amount * multiplier);
  if (!Number.isFinite(price) || price <= 0) return ["skipped", `Poplatek vyšel na ${price} Kč – nepřipisuje se`];

  // Aktuální seznam oprav znovu z DB, ať se nepřepíše, co mezitím přidal technik.
  const { data: fresh, error: readErr } = await svc.from("tickets").select("performed_repairs").eq("id", ticket.id).maybeSingle();
  if (readErr || !fresh) return ["error", `Nepodařilo se načíst opravy: ${readErr?.message ?? "zakázka nenalezena"}`];
  const current = Array.isArray((fresh as { performed_repairs?: unknown }).performed_repairs)
    ? ((fresh as { performed_repairs: unknown[] }).performed_repairs)
    : [];

  const label = perDay && days > 0 ? `${name} (${days} × ${formatujCastku(amount, "CZK")})` : name;
  const item = { id: `auto-${rule.id.slice(0, 8)}-${Date.now().toString(36)}`, name: label, type: "manual", price };
  const next = [...current, item];

  const { error } = await svc.from("tickets").update({ performed_repairs: next }).eq("id", ticket.id);
  if (error) return ["error", `Připsání poplatku selhalo: ${error.message}`];
  ticket.performed_repairs = next;
  return ["ok", `Připsáno „${label}“ ${formatujCastku(price, "CZK")}`];
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
// Žádost o recenzi (akce review_request)

/**
 * Zákazník zakázky – podle customer_id, bez něj podle normalizovaného
 * telefonu. Chyba dotazu se vyhodí: když nevíme, jestli zákazník žádosti
 * nechce, neposílá se (běh skončí jako error a zkusí se ručně / příště).
 */
async function findReviewCustomer(
  svc: SupabaseClient,
  ctx: ServiceCtx,
  ticket: TicketRow,
  phoneE164: string | null,
): Promise<{ id: string; optOut: boolean } | null> {
  type Row = { id: string; neposilat_zadost_o_recenzi: boolean | null };
  if (ticket.customer_id) {
    const { data, error } = await svc
      .from("customers")
      .select("id, neposilat_zadost_o_recenzi")
      .eq("id", ticket.customer_id)
      .eq("service_id", ctx.serviceId)
      .maybeSingle();
    if (error) throw new Error(`Zákazníka se nepodařilo načíst: ${error.message}`);
    if (data) return { id: (data as Row).id, optOut: (data as Row).neposilat_zadost_o_recenzi === true };
  }
  if (phoneE164) {
    const { data, error } = await svc
      .from("customers")
      .select("id, neposilat_zadost_o_recenzi")
      .eq("service_id", ctx.serviceId)
      .eq("phone_norm", phoneE164)
      .limit(1);
    if (error) throw new Error(`Zákazníka se nepodařilo načíst: ${error.message}`);
    const row = ((data ?? []) as Row[])[0];
    if (row) return { id: row.id, optOut: row.neposilat_zadost_o_recenzi === true };
  }
  return null;
}

/** Poslední žádost stejnému zákazníkovi od `since` – přes zákazníka, telefon i e-mail. */
async function lastReviewRequestAt(
  svc: SupabaseClient,
  serviceId: string,
  since: Date,
  keys: { customerId: string | null; phone: string | null; email: string | null },
): Promise<Date | null> {
  const lookups: Array<[string, string]> = [];
  if (keys.customerId) lookups.push(["customer_id", keys.customerId]);
  if (keys.phone) lookups.push(["telefon", keys.phone]);
  if (keys.email) lookups.push(["email", keys.email]);
  let latest: Date | null = null;
  for (const [column, value] of lookups) {
    const { data, error } = await svc
      .from("zadosti_o_recenzi")
      .select("odeslano_at")
      .eq("service_id", serviceId)
      .eq(column, value)
      .gte("odeslano_at", since.toISOString())
      .order("odeslano_at", { ascending: false })
      .limit(1);
    if (error) throw new Error(`Předchozí žádosti se nepodařilo načíst: ${error.message}`);
    const at = ((data ?? []) as Array<{ odeslano_at: string }>)[0]?.odeslano_at;
    if (at && (!latest || new Date(at) > latest)) latest = new Date(at);
  }
  return latest;
}

async function actionReviewRequest(
  svc: SupabaseClient,
  ctx: ServiceCtx,
  rule: Rule,
  ticket: TicketRow,
  a: Extract<Action, { type: "review_request" }>,
): Promise<ActionOutcome> {
  const c = rule.conditions ?? {};
  const now = new Date();
  const link = normalizujOdkazRecenze(a.review_url);
  const phoneRaw = strOrNull(ticket.customer_phone);
  const phoneE164 = phoneRaw ? normalizeE164(phoneRaw) : null;
  const email = maEmail(ticket.customer_email) ? String(ticket.customer_email).trim().toLowerCase() : null;
  const limitDays = platnyLimitDni(c.customer_cooldown_days ?? RECENZE_VYCHOZI.limitDni);

  const customer = await findReviewCustomer(svc, ctx, ticket, phoneE164);

  const { data: sentRows, error: sentErr } = await svc
    .from("zadosti_o_recenzi")
    .select("id")
    .eq("service_id", ctx.serviceId)
    .eq("ticket_id", ticket.id)
    .limit(1);
  if (sentErr) throw new Error(`Předchozí žádosti se nepodařilo načíst: ${sentErr.message}`);

  const last = await lastReviewRequestAt(svc, ctx.serviceId, zacatekLimitu(now, limitDays), {
    customerId: customer?.id ?? null,
    phone: phoneE164,
    email,
  });

  // Pravidlo s jiným spouštěčem než „po vydání“ (ručně přes API) stav nehlídá.
  const issued = rule.trigger.type === "ticket_issued"
    ? stavSpoustiRecenzi(ticket.status, [...ctx.statuses.values()], rule.trigger.status_keys)
    : true;

  const smsReason = phoneE164 ? await smsUnavailableReason(svc, ctx) : null;

  const verdict = posudKandidata({
    ted: now,
    smazana: !!ticket.deleted_at,
    vydanyStav: issued,
    odkaz: link,
    telefon: phoneE164,
    email,
    zakaznikNechce: customer?.optOut === true,
    odeslanoNaZakazku: Array.isArray(sentRows) && sentRows.length > 0,
    posledniZadost: last,
    limitDni: limitDays,
    smsDostupna: smsReason === null,
  });
  if (!verdict.ok) return ["skipped", verdict.duvod];

  const extraVars = { review_url: link ?? "" };
  let outcome: ActionOutcome;
  if (verdict.kanal === "sms") {
    outcome = await actionSms(svc, ctx, ticket, sablonaSOdkazem(String(a.template ?? "") || RECENZE_VYCHOZI.sms), 0, extraVars);
  } else {
    outcome = await actionEmail(
      svc,
      ctx,
      ticket,
      String(a.email_subject ?? "") || RECENZE_VYCHOZI.emailPredmet,
      sablonaSOdkazem(String(a.email_body ?? "") || RECENZE_VYCHOZI.emailText),
      0,
      extraVars,
    );
  }
  if (outcome[0] !== "ok") return outcome;

  // Záznam „odesláno“ – podle něj se hlídá limit N dní. Zpráva už odešla,
  // takže chyba zápisu běh neshodí, jen se ukáže v detailu.
  const { error: logErr } = await svc.from("zadosti_o_recenzi").insert({
    service_id: ctx.serviceId,
    rule_id: rule.id,
    ticket_id: ticket.id,
    customer_id: customer?.id ?? null,
    telefon: phoneE164,
    email,
    kanal: verdict.kanal,
  });
  const note = logErr ? ` (záznam o odeslání se neuložil: ${logErr.message})` : "";
  return ["ok", `Žádost o recenzi – ${outcome[1] ?? verdict.kanal}${note}`];
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
): Promise<ActionOutcome> {
  const days = extra.days ?? 0;
  const depth = extra.depth ?? 0;
  const prefix = extra.eventId ? `event:${extra.eventId} ` : "";
  const log = async (result: RunResult, detail: string | null): Promise<ActionOutcome> => {
    await logRun(svc, rule, ticket.id, result, detail ? `${prefix}${detail}` : prefix || null, counters);
    return [result, detail];
  };

  try {
    const c = rule.conditions ?? {};

    if (ticket.deleted_at) {
      return await log("skipped", "Zakázka je smazaná");
    }
    // skip_final se netýká stavu, na který pravidlo samo míří („při přepnutí
    // do Vyzvednuto → SMS“ by se jinak nikdy nespustilo).
    // Totéž platí pro „po vydání“ – vydaný stav je koncový z definice.
    const targetsCurrentStatus =
      ((rule.trigger.type === "status_change" || rule.trigger.type === "status_age") &&
        rule.trigger.status_key === ticket.status) ||
      rule.trigger.type === "ticket_issued";
    if (c.skip_final !== false && !targetsCurrentStatus && ctx.statuses.get(ticket.status)?.is_final) {
      return await log("skipped", `Zakázka je v koncovém stavu „${ctx.statuses.get(ticket.status)?.label ?? ticket.status}“`);
    }
    // U status_age s repeat_hours rozhoduje odstup opakování (řeší se před voláním), ne once_per_ticket.
    const repeating = rule.trigger.type === "status_age" && !!rule.trigger.repeat_hours;
    if (c.once_per_ticket !== false && !repeating && (await hasOkRun(svc, rule.id, ticket.id))) {
      return await log("skipped", "Pravidlo už na této zakázce proběhlo");
    }
    if (c.require_phone && !strOrNull(ticket.customer_phone)) {
      return await log("skipped", "Zákazník nemá telefon");
    }
    if (c.require_email && !strOrNull(ticket.customer_email)?.includes("@")) {
      return await log("skipped", "Zákazník nemá e-mail");
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
      case "review_request":
        outcome = await actionReviewRequest(svc, ctx, rule, ticket, a);
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
    return outcome;
  } catch (e) {
    return await log("error", errMsg(e));
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
// Plánovaný běh: fronta automation_schedule
//
// Řádky zakládá trigger public.automation_schedule_po_vydani (přepnutí do
// vydaného stavu). Tik vezme splatné (run_at ≤ teď), každý si „zamkne“
// přepnutím pending → processing (podmíněný UPDATE, takže dva souběžné tiky
// tentýž řádek nezpracují), ověří pravidlo, zakázku a denní okno a pravidlo
// vyhodnotí stejnou cestou jako ostatní spouštěče (evaluateRule → log v
// automation_runs). Výsledek se zapíše zpátky do řádku.

type ScheduleRow = {
  id: string;
  service_id: string;
  rule_id: string | null;
  ticket_id: string | null;
  kind: string;
  run_at: string;
  attempts: number;
};

async function finishSchedule(
  svc: SupabaseClient,
  id: string,
  status: "pending" | "done" | "skipped" | "error" | "cancelled",
  detail: string | null,
  extra: Record<string, unknown> = {},
): Promise<void> {
  const { error } = await svc
    .from("automation_schedule")
    .update({
      status,
      detail: detail ? detail.slice(0, 2000) : null,
      processed_at: status === "pending" ? null : new Date().toISOString(),
      claimed_at: status === "pending" ? null : undefined,
      ...extra,
    })
    .eq("id", id);
  if (error) console.error("[automations-run] automation_schedule update:", error.message);
}

async function loadRuleById(svc: SupabaseClient, ruleId: string): Promise<Rule | null> {
  const { data, error } = await svc
    .from("automation_rules")
    .select("id, service_id, name, active, trigger, action, conditions, sort_order")
    .eq("id", ruleId)
    .maybeSingle();
  if (error) throw new Error(`automation_rules: ${error.message}`);
  const r = data as Rule | null;
  if (!r || !r.trigger || typeof r.trigger !== "object" || !r.action || typeof r.action !== "object") return null;
  return r;
}

/** Hlídá se denní okno? U žádosti o recenzi vždy, jinak jen když ho pravidlo má. */
function usesSendWindow(rule: Rule): boolean {
  const c = rule.conditions ?? {};
  return rule.action.type === "review_request" || c.send_from_hour != null || c.send_to_hour != null;
}

async function processScheduleRow(
  svc: SupabaseClient,
  row: ScheduleRow,
  ctxCache: Map<string, ServiceCtx>,
  ruleCache: Map<string, Rule | null>,
  now: Date,
  counters: Counters,
): Promise<void> {
  if (row.kind !== "rule" || !row.rule_id || !row.ticket_id) {
    await finishSchedule(svc, row.id, "cancelled", `Neznámý druh naplánované akce „${row.kind}“`);
    return;
  }

  if (!ruleCache.has(row.rule_id)) ruleCache.set(row.rule_id, await loadRuleById(svc, row.rule_id));
  const rule = ruleCache.get(row.rule_id) ?? null;
  // Pravidlo cizího servisu nad naší zakázkou se nesmí spustit ani omylem.
  if (!rule || rule.service_id !== row.service_id) {
    await finishSchedule(svc, row.id, "cancelled", "Pravidlo neexistuje");
    return;
  }
  if (!rule.active) {
    await finishSchedule(svc, row.id, "cancelled", "Pravidlo je vypnuté");
    return;
  }

  const ticket = await loadTicket(svc, row.ticket_id);
  if (!ticket || ticket.service_id !== row.service_id) {
    await finishSchedule(svc, row.id, "cancelled", "Zakázka nenalezena");
    return;
  }

  let ctx = ctxCache.get(row.service_id);
  if (!ctx) {
    ctx = await loadServiceCtx(svc, row.service_id);
    ctxCache.set(row.service_id, ctx);
  }

  // Zakázka mezitím odešla z vydaného stavu (reklamace, omyl) – nic neposílat.
  if (rule.trigger.type === "ticket_issued" && !ticket.deleted_at &&
      !stavSpoustiRecenzi(ticket.status, [...ctx.statuses.values()], rule.trigger.status_keys)) {
    const detail = `Zakázka už není ve vydaném stavu („${ctx.statuses.get(ticket.status)?.label ?? ticket.status}“)`;
    await logRun(svc, rule, ticket.id, "skipped", detail, counters);
    await finishSchedule(svc, row.id, "skipped", detail);
    return;
  }

  // Mimo denní okno se jen posune na jeho začátek – bez řádku v logu.
  if (usesSendWindow(rule)) {
    const c = rule.conditions ?? {};
    const window = platneOkno(c.send_from_hour ?? RECENZE_VYCHOZI.oknoOd, c.send_to_hour ?? RECENZE_VYCHOZI.oknoDo);
    const next = dalsiCasOdeslani(now, window, c.time_zone);
    if (next.getTime() > now.getTime()) {
      await finishSchedule(svc, row.id, "pending", "Mimo denní okno – posunuto", { run_at: next.toISOString() });
      return;
    }
  }

  const [result, detail] = await evaluateRule(svc, ctx, rule, ticket, {}, counters);
  const attempts = row.attempts + 1;
  if (result === "error" && attempts < MAX_SCHEDULE_ATTEMPTS) {
    await finishSchedule(svc, row.id, "pending", detail, {
      run_at: new Date(now.getTime() + SCHEDULE_RETRY_MS).toISOString(),
      attempts,
    });
    return;
  }
  await finishSchedule(svc, row.id, result === "ok" ? "done" : result, detail);
}

async function runSchedule(svc: SupabaseClient, ctxCache: Map<string, ServiceCtx>, now: Date, counters: Counters): Promise<void> {
  // Řádky, které zůstaly rozpracované po pádu funkce, vrátit do fronty.
  const { error: staleErr } = await svc
    .from("automation_schedule")
    .update({ status: "pending", claimed_at: null })
    .eq("status", "processing")
    .lt("claimed_at", new Date(now.getTime() - STALE_CLAIM_MS).toISOString());
  if (staleErr) {
    // Typicky: migrace 20260927140000 ještě není nasazená. Ostatní spouštěče běží dál.
    console.error("[automations-run] automation_schedule:", staleErr.message);
    return;
  }

  const { data, error } = await svc
    .from("automation_schedule")
    .select("id, service_id, rule_id, ticket_id, kind, run_at, attempts")
    .eq("status", "pending")
    .lte("run_at", now.toISOString())
    .order("run_at", { ascending: true })
    .limit(MAX_SCHEDULED_PER_TICK);
  if (error) {
    console.error("[automations-run] automation_schedule select:", error.message);
    counters.errors += 1;
    return;
  }

  const ruleCache = new Map<string, Rule | null>();
  for (const row of (data ?? []) as ScheduleRow[]) {
    // Zámek: jen když je řádek pořád pending (souběžný tik ho mohl vzít).
    const { data: claimed, error: claimErr } = await svc
      .from("automation_schedule")
      .update({ status: "processing", claimed_at: now.toISOString() })
      .eq("id", row.id)
      .eq("status", "pending")
      .select("id");
    if (claimErr || !Array.isArray(claimed) || claimed.length === 0) continue;

    try {
      await processScheduleRow(svc, row, ctxCache, ruleCache, now, counters);
    } catch (e) {
      counters.errors += 1;
      await finishSchedule(svc, row.id, "error", errMsg(e));
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

  const ctxCache = new Map<string, ServiceCtx>();
  for (const [serviceId, serviceRules] of byService) {
    let ctx: ServiceCtx;
    try {
      ctx = await loadServiceCtx(svc, serviceId);
      ctxCache.set(serviceId, ctx);
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

  // Fronta naplánovaných akcí (žádost o recenzi po vydání…) – nezávisle na
  // tom, jestli má servis pravidla status_age / event.
  try {
    await runSchedule(svc, ctxCache, now, counters);
  } catch (e) {
    console.error("[automations-run] fronta automation_schedule:", errMsg(e));
    counters.errors += 1;
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
  // `status_key` z těla se schválně ignoruje – viz komentář u volání níž.
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

  /* Zakázka se načítá pod `service_role`, tedy mimo RLS – členství samo
     nestačí. Kdo je omezený na jednu pobočku, nesmí spouštět pravidla nad
     zakázkou z cizí pobočky: rozeslaly by zákazníkovi SMS a e-mail
     „zařízení je hotové" a akce `set_status` by mu zakázku i přepnula. */
  const { data: pobockaOk, error: pobockaErr } = await userClient.rpc("pobocka_povolena", {
    p_service_id: serviceId,
    p_branch_id: (ticket as { branch_id?: string | null }).branch_id ?? null,
  });
  if (pobockaErr || pobockaOk === false) {
    return json({ error: "Zakázka patří jiné pobočce" }, 403);
  }

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
    /* Stav se bere ze zakázky, ne z těla požadavku. Dřív si volající mohl
       zvolit libovolný a spustit tím pravidla pro stav, ve kterém zakázka
       vůbec není – tedy třeba poslat zákazníkovi „zařízení je hotové“. */
    await runStatusChange(svc, ctx, ticket, ticket.status, 0, counters, rules);
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
