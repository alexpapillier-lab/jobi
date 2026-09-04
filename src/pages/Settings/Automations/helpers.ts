/**
 * Pomocníci pro editor automatizací v Nastavení. Typy a názvy jsou
 * v src/lib/automations.ts (sdílený kontrakt) – tady jsou jen věci,
 * které potřebuje rozhraní: rozpracované pravidlo, validace, šablony,
 * počítání SMS a načítání s rozlišením „tabulka na serveru není“.
 */
import { supabase } from "../../../lib/supabaseClient";
import {
  TEMPLATE_VARIABLES,
  type Action,
  type ActionType,
  type AutomationEvent,
  type AutomationRule,
  type AutomationRun,
  type Conditions,
  type Trigger,
  type TriggerType,
} from "../../../lib/automations";
import type { StatusMeta } from "../../../state/StatusesStore";

export type HourUnit = "hours" | "days";

/** Rozpracované pravidlo v editoru – ploché, aby se dalo vázat na pole. */
export type RuleDraft = {
  id: string | null;
  name: string;
  active: boolean;
  triggerType: TriggerType;
  triggerStatusKey: string;
  afterValue: string;
  afterUnit: HourUnit;
  repeatValue: string;
  repeatUnit: HourUnit;
  event: AutomationEvent;
  actionType: ActionType;
  smsTemplate: string;
  emailSubject: string;
  emailBody: string;
  actionStatusKey: string;
  feeName: string;
  feeAmount: string;
  feePerDay: boolean;
  notifyMessage: string;
  skipFinal: boolean;
  oncePerTicket: boolean;
  requirePhone: boolean;
  requireEmail: boolean;
};

export const SMS_SINGLE_LIMIT = 160;
export const SMS_UNICODE_LIMIT = 70;

/** Znaky mimo GSM-7 (diakritika) přepnou SMS do Unicode – vejde se jen 70 znaků. */
export function hasNonGsmChars(text: string): boolean {
  // Zjednodušeně: cokoli mimo základní ASCII a pár GSM znaků.
  return /[^\x20-\x7E\n\r]/.test(text);
}

export function smsSegments(text: string): { length: number; segments: number; unicode: boolean } {
  const unicode = hasNonGsmChars(text);
  const length = text.length;
  if (length === 0) return { length: 0, segments: 0, unicode };
  const single = unicode ? SMS_UNICODE_LIMIT : SMS_SINGLE_LIMIT;
  const multi = unicode ? 67 : 153;
  const segments = length <= single ? 1 : Math.ceil(length / multi);
  return { length, segments, unicode };
}

export const SAMPLE_VARS: Record<string, string> = Object.fromEntries(
  TEMPLATE_VARIABLES.map((v) => [v.key, v.sample])
);

export function hoursToDraft(h: number | null | undefined): { value: string; unit: HourUnit } {
  if (!h || h <= 0) return { value: "", unit: "hours" };
  if (h % 24 === 0) return { value: String(h / 24), unit: "days" };
  return { value: String(h), unit: "hours" };
}

export function draftToHours(value: string, unit: HourUnit): number | null {
  const n = Number(value.replace(",", "."));
  if (!Number.isFinite(n) || n <= 0) return null;
  return Math.round(unit === "days" ? n * 24 : n);
}

export function emptyDraft(firstStatusKey: string): RuleDraft {
  return {
    id: null,
    name: "",
    active: true,
    triggerType: "status_change",
    triggerStatusKey: firstStatusKey,
    afterValue: "3",
    afterUnit: "days",
    repeatValue: "",
    repeatUnit: "days",
    event: "quote_approved",
    actionType: "sms",
    smsTemplate: "",
    emailSubject: "",
    emailBody: "",
    actionStatusKey: firstStatusKey,
    feeName: "Skladné",
    feeAmount: "",
    feePerDay: true,
    notifyMessage: "",
    skipFinal: true,
    oncePerTicket: true,
    requirePhone: true,
    requireEmail: true,
  };
}

export function ruleToDraft(rule: AutomationRule, firstStatusKey: string): RuleDraft {
  const d = emptyDraft(firstStatusKey);
  d.id = rule.id;
  d.name = rule.name ?? "";
  d.active = rule.active;
  const t = rule.trigger;
  d.triggerType = t.type;
  if (t.type === "status_change") d.triggerStatusKey = t.status_key;
  if (t.type === "status_age") {
    d.triggerStatusKey = t.status_key;
    const a = hoursToDraft(t.after_hours);
    d.afterValue = a.value; d.afterUnit = a.unit;
    const r = hoursToDraft(t.repeat_hours);
    d.repeatValue = r.value; d.repeatUnit = r.unit;
  }
  if (t.type === "event") d.event = t.event;
  const a = rule.action;
  d.actionType = a.type;
  if (a.type === "sms") d.smsTemplate = a.template;
  if (a.type === "email") { d.emailSubject = a.subject; d.emailBody = a.body; }
  if (a.type === "set_status") d.actionStatusKey = a.status_key;
  if (a.type === "add_fee") { d.feeName = a.name; d.feeAmount = String(a.amount); d.feePerDay = !!a.per_day; }
  if (a.type === "notify") d.notifyMessage = a.message;
  const c = rule.conditions ?? {};
  d.skipFinal = c.skip_final !== false;
  d.oncePerTicket = c.once_per_ticket !== false;
  d.requirePhone = c.require_phone !== false;
  d.requireEmail = c.require_email !== false;
  return d;
}

export function draftTrigger(d: RuleDraft): Trigger | null {
  switch (d.triggerType) {
    case "status_change":
      return d.triggerStatusKey ? { type: "status_change", status_key: d.triggerStatusKey } : null;
    case "status_age": {
      const after = draftToHours(d.afterValue, d.afterUnit);
      if (!d.triggerStatusKey || after == null) return null;
      const repeat = d.repeatValue.trim() ? draftToHours(d.repeatValue, d.repeatUnit) : null;
      return { type: "status_age", status_key: d.triggerStatusKey, after_hours: after, repeat_hours: repeat };
    }
    case "event":
      return { type: "event", event: d.event };
    default:
      return { type: "ticket_created" };
  }
}

export function draftAction(d: RuleDraft): Action | null {
  switch (d.actionType) {
    case "sms":
      return d.smsTemplate.trim() ? { type: "sms", template: d.smsTemplate.trim() } : null;
    case "email":
      return d.emailSubject.trim() && d.emailBody.trim()
        ? { type: "email", subject: d.emailSubject.trim(), body: d.emailBody.trim() }
        : null;
    case "set_status":
      return d.actionStatusKey ? { type: "set_status", status_key: d.actionStatusKey } : null;
    case "add_fee": {
      const amount = Number(d.feeAmount.replace(",", "."));
      if (!d.feeName.trim() || !Number.isFinite(amount) || amount <= 0) return null;
      return { type: "add_fee", name: d.feeName.trim(), amount, per_day: d.feePerDay };
    }
    default:
      return d.notifyMessage.trim() ? { type: "notify", message: d.notifyMessage.trim() } : null;
  }
}

export function draftConditions(d: RuleDraft): Conditions {
  const repeating = d.triggerType === "status_age" && !!d.repeatValue.trim();
  const c: Conditions = {
    skip_final: d.skipFinal,
    once_per_ticket: repeating ? false : d.oncePerTicket,
  };
  if (d.actionType === "sms") c.require_phone = d.requirePhone;
  if (d.actionType === "email") c.require_email = d.requireEmail;
  return c;
}

/** Chyby k zobrazení; prázdné pole = pravidlo lze uložit. */
export function validateDraft(d: RuleDraft): string[] {
  const errors: string[] = [];
  if ((d.triggerType === "status_change" || d.triggerType === "status_age") && !d.triggerStatusKey) {
    errors.push("Vyberte stav zakázky.");
  }
  if (d.triggerType === "status_age") {
    if (draftToHours(d.afterValue, d.afterUnit) == null) errors.push("Doba ve stavu musí být větší než 0.");
    if (d.repeatValue.trim() && draftToHours(d.repeatValue, d.repeatUnit) == null) errors.push("Interval opakování musí být větší než 0.");
  }
  switch (d.actionType) {
    case "sms": if (!d.smsTemplate.trim()) errors.push("Vyplňte text SMS."); break;
    case "email":
      if (!d.emailSubject.trim()) errors.push("Vyplňte předmět e-mailu.");
      if (!d.emailBody.trim()) errors.push("Vyplňte text e-mailu.");
      break;
    case "set_status": if (!d.actionStatusKey) errors.push("Vyberte cílový stav."); break;
    case "add_fee": {
      if (!d.feeName.trim()) errors.push("Vyplňte název poplatku.");
      const amount = Number(d.feeAmount.replace(",", "."));
      if (!Number.isFinite(amount) || amount <= 0) errors.push("Částka musí být větší než 0.");
      break;
    }
    default: if (!d.notifyMessage.trim()) errors.push("Vyplňte text poznámky.");
  }
  return errors;
}

/** Kompletní pravidlo z konceptu (bez id/service_id). Null = nevalidní. */
export function draftToRulePayload(d: RuleDraft): { trigger: Trigger; action: Action; conditions: Conditions } | null {
  const trigger = draftTrigger(d);
  const action = draftAction(d);
  if (!trigger || !action) return null;
  return { trigger, action, conditions: draftConditions(d) };
}

// ---------------------------------------------------------------------------
// Předpřipravené šablony pro prázdný stav

export type PresetId = "pickup_reminder" | "review_request" | "quote_no_reply";

export const PRESETS: Array<{ id: PresetId; title: string; description: string }> = [
  { id: "pickup_reminder", title: "Připomínka vyzvednutí", description: "Po 3 dnech ve stavu k vyzvednutí pošle SMS a každé 3 dny ji zopakuje." },
  { id: "review_request", title: "Žádost o recenzi", description: "Po dokončení zakázky poděkuje SMS a požádá o hodnocení." },
  { id: "quote_no_reply", title: "Nabídka bez odpovědi", description: "Když zákazník 2 dny neschválí nabídku, pošle mu odkaz znovu." },
];

/** Najde stav podle části názvu; nekoncové stavy mají přednost (např. „Nevyzvednuto“ je koncový, „Připraveno k vyzvednutí“ ne). */
function findStatus(statuses: StatusMeta[], needles: string[]): StatusMeta | undefined {
  const norm = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
  const match = (s: StatusMeta) => needles.some((n) => norm(s.label).includes(norm(n)) || norm(s.key).includes(norm(n)));
  return statuses.find((s) => !s.isFinal && match(s)) ?? statuses.find(match);
}

export function presetDraft(id: PresetId, statuses: StatusMeta[]): RuleDraft {
  const first = statuses[0]?.key ?? "";
  const firstNonFinal = statuses.find((s) => !s.isFinal)?.key ?? first;
  const d = emptyDraft(first);
  switch (id) {
    case "pickup_reminder": {
      const s = findStatus(statuses, ["vyzved", "hotov", "převz", "připrav"])?.key ?? firstNonFinal;
      d.name = "Připomínka vyzvednutí";
      d.triggerType = "status_age";
      d.triggerStatusKey = s;
      d.afterValue = "3"; d.afterUnit = "days";
      d.repeatValue = "3"; d.repeatUnit = "days";
      d.actionType = "sms";
      d.smsTemplate = "Dobrý den, zakázka {{code}} ({{device_label}}) je připravena k vyzvednutí už {{days}} dní. {{service_name}}, {{service_phone}}";
      d.oncePerTicket = false;
      break;
    }
    case "review_request": {
      const s = statuses.find((x) => x.isFinal)?.key ?? findStatus(statuses, ["vyd", "dokon", "uzav"])?.key ?? first;
      d.name = "Žádost o recenzi";
      d.triggerType = "status_change";
      d.triggerStatusKey = s;
      d.actionType = "sms";
      d.smsTemplate = "Děkujeme za návštěvu {{service_name}}. Budeme rádi za hodnocení.";
      d.skipFinal = false;
      break;
    }
    default: {
      const s = findStatus(statuses, ["nabíd", "nabid", "cenov", "schval", "čeká"])?.key ?? first;
      d.name = "Nabídka bez odpovědi";
      d.triggerType = "status_age";
      d.triggerStatusKey = s;
      d.afterValue = "2"; d.afterUnit = "days";
      d.actionType = "sms";
      d.smsTemplate = "Čekáme na vaše schválení nabídky k zakázce {{code}}: {{portal_url}}";
    }
  }
  return d;
}

// ---------------------------------------------------------------------------
// Načítání s rozlišením chyby (loadRules z kontraktu vrací při chybě jen [])

export type LoadResult<T> = { data: T[]; error: string | null; missingTable: boolean };

function isMissingTable(error: { code?: string; message?: string } | null): boolean {
  if (!error) return false;
  const msg = (error.message ?? "").toLowerCase();
  return error.code === "42P01" || error.code === "PGRST205" || msg.includes("does not exist") || msg.includes("could not find the table") || msg.includes("schema cache");
}

export async function fetchRules(serviceId: string): Promise<LoadResult<AutomationRule>> {
  if (!supabase) return { data: [], error: "Supabase není k dispozici", missingTable: false };
  try {
    const { data, error } = await (supabase.from("automation_rules") as any)
      .select("*")
      .eq("service_id", serviceId)
      .order("sort_order", { ascending: true });
    if (error) return { data: [], error: error.message ?? "Chyba načtení", missingTable: isMissingTable(error) };
    return { data: Array.isArray(data) ? (data as AutomationRule[]) : [], error: null, missingTable: false };
  } catch (e) {
    return { data: [], error: e instanceof Error ? e.message : String(e), missingTable: false };
  }
}

export async function fetchRuns(serviceId: string, limit = 50): Promise<LoadResult<AutomationRun>> {
  if (!supabase) return { data: [], error: "Supabase není k dispozici", missingTable: false };
  try {
    const { data, error } = await (supabase.from("automation_runs") as any)
      .select("*")
      .eq("service_id", serviceId)
      .order("ran_at", { ascending: false })
      .limit(limit);
    if (error) return { data: [], error: error.message ?? "Chyba načtení", missingTable: isMissingTable(error) };
    return { data: Array.isArray(data) ? (data as AutomationRun[]) : [], error: null, missingTable: false };
  } catch (e) {
    return { data: [], error: e instanceof Error ? e.message : String(e), missingTable: false };
  }
}

/** Kódy zakázek pro historii – jedním dotazem. */
export async function fetchTicketCodes(ticketIds: string[]): Promise<Record<string, string>> {
  if (!supabase || ticketIds.length === 0) return {};
  try {
    const { data, error } = await (supabase.from("tickets") as any)
      .select("id, code")
      .in("id", ticketIds);
    if (error || !Array.isArray(data)) return {};
    const out: Record<string, string> = {};
    for (const row of data as Array<{ id: string; code: string | null }>) out[row.id] = row.code ?? "";
    return out;
  } catch {
    return {};
  }
}

export function formatRunTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString("cs-CZ", { day: "numeric", month: "numeric", hour: "2-digit", minute: "2-digit" });
}
