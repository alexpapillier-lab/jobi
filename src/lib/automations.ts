/**
 * Stavebnice automatizací: pravidla „když X → udělej Y“ na servis.
 *
 * Datový model sdílí Nastavení (editor pravidel), Zakázky (spouštění při
 * změně stavu) a edge funkce `automations-run` (časové spouštěče přes
 * pg_cron, události portálu, vlastní vykonání akcí). Tenhle soubor je
 * jediné místo s typy a názvy – když se něco přidá, přidá se tady.
 */
import { supabase, getSupabaseClient } from "./supabaseClient";
import { supabaseFetch } from "./supabaseClient";

export type TriggerType = "status_change" | "status_age" | "event" | "ticket_created" | "ticket_issued";
/**
 * Akce obecného editoru pravidel. Žádost o recenzi (`review_request`) sem
 * schválně nepatří: má vlastní kartu, a části, které pracují se všemi
 * akcemi (editor, nápověda v nabídce stavů Zakázek), ji neumějí. Pravidla
 * s ní se poznají přes `isReviewRule` a obecné části je přeskakují.
 */
export type ActionType = "sms" | "email" | "set_status" | "add_fee" | "notify";
export type SpecialActionType = "review_request";
export type AutomationEvent = "quote_approved" | "quote_rejected" | "signed" | "portal_opened";

export type Trigger =
  | { type: "status_change"; status_key: string }
  /** Zakázka je ve stavu déle než `after_hours`; `repeat_hours` = opakovat každých N hodin (null = jednou). */
  | { type: "status_age"; status_key: string; after_hours: number; repeat_hours?: number | null }
  | { type: "event"; event: AutomationEvent }
  | { type: "ticket_created" }
  /**
   * N hodin po vydání zakázky. Neběží hned: přepnutí do vydaného stavu
   * založí databázový trigger řádek v `automation_schedule` s `run_at`
   * a plánovaný tik ho pak zpracuje. `status_keys` = stavy, které se
   * počítají jako vydání; prázdné = koncové stavy kromě storna a vrácení
   * bez opravy (`jeVydanyStav`).
   */
  | { type: "ticket_issued"; after_hours: number; status_keys?: string[] };

export type Action =
  | { type: "sms"; template: string }
  | { type: "email"; subject: string; body: string }
  | { type: "set_status"; status_key: string }
  /** Připíše položku do provedených oprav; `per_day` = částka × dny od spuštěče. */
  | { type: "add_fee"; name: string; amount: number; per_day?: boolean }
  /** Interní poznámka k zakázce (komentář), vidí ji technik. */
  | { type: "notify"; message: string };

/**
 * Poděkování s odkazem na recenze: SMS, a když zákazník nemá telefon
 * (nebo servis SMS neumí), e-mail. `{{review_url}}` dosadí `review_url`.
 * Vykonává edge funkce automations-run (její kopie typu `Action` ji má).
 */
export type ReviewRequestAction = { type: "review_request"; review_url: string; template: string; email_subject: string; email_body: string };

/** Libovolná akce uložená v automation_rules (včetně těch s vlastní kartou). */
export type AnyAction = Action | ReviewRequestAction;

export type Conditions = {
  /** Nespouštět u zakázek v koncovém stavu. */
  skip_final?: boolean;
  /** Každé pravidlo na zakázku jen jednou (u status_age má přednost repeat_hours). */
  once_per_ticket?: boolean;
  /** Přeskočit, když zákazník nemá telefon / e-mail. */
  require_phone?: boolean;
  require_email?: boolean;
  /** Denní okno odeslání v místním čase (celé hodiny, od ≤ h < do). Jen u plánovaných akcí. */
  send_from_hour?: number;
  send_to_hour?: number;
  /** Časová zóna okna (IANA), výchozí Europe/Prague. */
  time_zone?: string;
  /** Žádost o recenzi stejnému zákazníkovi nejvýš jednou za N dní. */
  customer_cooldown_days?: number;
};

export type AutomationRule = {
  id: string;
  service_id: string;
  name: string;
  active: boolean;
  trigger: Trigger;
  action: Action;
  conditions: Conditions;
  sort_order: number;
  created_at?: string;
  updated_at?: string;
};

export type AutomationRun = {
  id: string;
  rule_id: string;
  ticket_id: string | null;
  service_id: string;
  ran_at: string;
  result: "ok" | "skipped" | "error";
  detail: string | null;
};

export const TRIGGER_LABELS: Record<TriggerType, string> = {
  status_change: "Zakázka se přepne do stavu",
  status_age: "Zakázka je ve stavu déle než",
  event: "Zákazník na portálu",
  ticket_created: "Založí se nová zakázka",
  ticket_issued: "Po vydání zakázky",
};

export const ACTION_LABELS: Record<ActionType, string> = {
  sms: "Poslat SMS zákazníkovi",
  email: "Poslat e-mail zákazníkovi",
  set_status: "Přepnout zakázku do stavu",
  add_fee: "Připsat poplatek do oprav",
  notify: "Zapsat poznámku technikovi",
};

export const SPECIAL_ACTION_LABELS: Record<SpecialActionType, string> = {
  review_request: "Požádat o recenzi",
};

/** Spouštěče, které má vlastní karta (Žádost o recenzi), ne obecný editor pravidel. */
export const SPECIAL_TRIGGERS: ReadonlySet<TriggerType> = new Set<TriggerType>(["ticket_issued"]);

/** Pravidlo „Žádost o recenzi“ se spravuje kartou, ne obecným editorem. */
export type ReviewRule = Omit<AutomationRule, "action"> & { action: ReviewRequestAction };

/**
 * Je to pravidlo „Žádost o recenzi“? Řádek z databáze má typ AutomationRule,
 * ale akci review_request – proto se ptá na surový typ akce.
 */
export function isReviewRule(rule: { action?: { type?: string } | null }): rule is ReviewRule {
  return (rule.action as { type?: string } | null | undefined)?.type === "review_request";
}

/** Pravidlo žádosti o recenzi servisu (karta ho spravuje jako jediné; bere se první). */
export function findReviewRule(rules: ReadonlyArray<AutomationRule>): ReviewRule | null {
  for (const r of rules) if (isReviewRule(r)) return r as unknown as ReviewRule;
  return null;
}

export const EVENT_LABELS: Record<AutomationEvent, string> = {
  quote_approved: "schválí cenovou nabídku",
  quote_rejected: "zamítne cenovou nabídku",
  signed: "podepíše příjem",
  portal_opened: "otevře odkaz na stav zakázky",
};

/** Proměnné do šablon SMS a e-mailů. Stejný seznam dosazuje edge funkce. */
export const TEMPLATE_VARIABLES: Array<{ key: string; label: string; sample: string }> = [
  { key: "code", label: "Číslo zakázky", sample: "IRPAZ2601546" },
  { key: "customer_name", label: "Jméno zákazníka", sample: "Jan Novák" },
  { key: "device_label", label: "Zařízení", sample: "iPhone 13 Pro" },
  { key: "status", label: "Stav zakázky", sample: "Připraveno k vyzvednutí" },
  { key: "total_price", label: "Celková cena", sample: "2 490,00" },
  { key: "notes", label: "Požadovaná oprava", sample: "Výměna displeje" },
  { key: "expected_date", label: "Předpokládané dokončení", sample: "8. 9. 2026" },
  { key: "days", label: "Počet dní (u časových pravidel)", sample: "3" },
  { key: "portal_url", label: "Odkaz na stav zakázky", sample: "https://appjobi.com/z/?t=…" },
  { key: "service_name", label: "Název servisu", sample: "iSwap Repair Point Praha" },
  { key: "service_phone", label: "Telefon servisu", sample: "+420 773 118 472" },
];

/** Proměnné žádosti o recenzi: odkaz navíc, stav/cena/dny tam nedávají smysl. */
export const REVIEW_TEMPLATE_VARIABLES: Array<{ key: string; label: string; sample: string }> = [
  { key: "review_url", label: "Odkaz na recenze", sample: "https://g.page/r/CaBcDeF/review" },
  ...TEMPLATE_VARIABLES.filter((v) => ["customer_name", "device_label", "code", "service_name", "service_phone"].includes(v.key)),
];

export function substituteTemplate(template: string, vars: Record<string, string>): string {
  return template.replace(/\{\{\s*(\w+)\s*\}\}/g, (_, k: string) => vars[k] ?? "");
}

/** Lidská věta pro seznam pravidel: „Když … → …“. */
export function describeRule(rule: AutomationRule | ReviewRule, statusLabel: (key: string) => string): string {
  const t = rule.trigger;
  if (isReviewRule(rule)) {
    const po = t.type === "ticket_issued" ? `${formatHours(t.after_hours)} po vydání zakázky` : "Po vydání zakázky";
    return `${po} → ${SPECIAL_ACTION_LABELS.review_request} (SMS, bez telefonu e-mail)`;
  }
  let when: string;
  switch (t.type) {
    case "status_change": when = `${TRIGGER_LABELS.status_change} „${statusLabel(t.status_key)}“`; break;
    case "status_age": when = `${TRIGGER_LABELS.status_age} ${formatHours(t.after_hours)} ve stavu „${statusLabel(t.status_key)}“${t.repeat_hours ? `, opakovat každých ${formatHours(t.repeat_hours)}` : ""}`; break;
    case "event": when = `${TRIGGER_LABELS.event} ${EVENT_LABELS[t.event]}`; break;
    case "ticket_issued": when = `${formatHours(t.after_hours)} po vydání zakázky`; break;
    default: when = TRIGGER_LABELS.ticket_created;
  }
  const a = rule.action;
  let then: string;
  switch (a.type) {
    case "sms": then = ACTION_LABELS.sms; break;
    case "email": then = `${ACTION_LABELS.email} „${a.subject}“`; break;
    case "set_status": then = `${ACTION_LABELS.set_status} „${statusLabel(a.status_key)}“`; break;
    case "add_fee": then = `${ACTION_LABELS.add_fee} „${a.name}“ ${a.amount} Kč${a.per_day ? " za den" : ""}`; break;
    default: then = ACTION_LABELS.notify;
  }
  return `${when} → ${then}`;
}

export function formatHours(h: number): string {
  if (h % 24 === 0) {
    const d = h / 24;
    return `${d} ${d === 1 ? "den" : d < 5 ? "dny" : "dní"}`;
  }
  return `${h} ${h === 1 ? "hodinu" : h < 5 ? "hodiny" : "hodin"}`;
}

export async function loadRules(serviceId: string): Promise<AutomationRule[]> {
  if (!supabase) return [];
  const { data, error } = await (supabase.from("automation_rules") as any)
    .select("*")
    .eq("service_id", serviceId)
    .order("sort_order", { ascending: true });
  if (error || !Array.isArray(data)) return [];
  return data as AutomationRule[];
}

export async function loadRuns(serviceId: string, limit = 50): Promise<AutomationRun[]> {
  if (!supabase) return [];
  const { data, error } = await (supabase.from("automation_runs") as any)
    .select("*")
    .eq("service_id", serviceId)
    .order("ran_at", { ascending: false })
    .limit(limit);
  if (error || !Array.isArray(data)) return [];
  return data as AutomationRun[];
}

/**
 * Okamžité spuštění pravidel pro událost v aplikaci (změna stavu, založení
 * zakázky). Volá edge funkci s JWT uživatele; časová pravidla a události
 * portálu vyhodnocuje server sám.
 */
export async function runAutomations(input: {
  serviceId: string;
  ticketId: string;
  event: "status_change" | "ticket_created";
  statusKey?: string;
}): Promise<{ ok: boolean; ran?: number; error?: string }> {
  const client = getSupabaseClient();
  if (!client) return { ok: false, error: "Supabase není k dispozici" };
  const { data: sessionData } = await client.auth.getSession();
  const token = sessionData?.session?.access_token;
  if (!token) return { ok: false, error: "Nepřihlášeno" };
  const url = (import.meta.env.VITE_SUPABASE_URL as string | undefined) ?? "";
  try {
    const res = await supabaseFetch(`${url}/functions/v1/automations-run`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ service_id: input.serviceId, ticket_id: input.ticketId, event: input.event, status_key: input.statusKey ?? null }),
    });
    const raw = await res.text();
    let data: { ok?: boolean; ran?: number; error?: string } = {};
    try { if (raw) data = JSON.parse(raw); } catch { /* prázdná odpověď */ }
    if (!res.ok) return { ok: false, error: data.error ?? `HTTP ${res.status}` };
    return { ok: true, ran: data.ran };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}
