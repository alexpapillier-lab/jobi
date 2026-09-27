/**
 * Žádost o recenzi po vydání zakázky – strana aplikace.
 *
 * Rozhodování (vydaný stav, denní okno, kandidát, kanál) je v
 * `supabase/functions/_shared/recenze.ts`, aby ho edge funkce
 * `automations-run` a aplikace měly na řádek stejné. Tady je navíc:
 * koncept pravidla pro kartu v Nastavení (pravidlo ↔ formulář), náhled
 * textu a drobná čtení/zápisy (počet odeslaných, příznak u zákazníka).
 *
 * Jak to běží: přepnutí zakázky do vydaného stavu založí databázový
 * trigger řádek ve frontě `automation_schedule` (run_at = vydání +
 * zpoždění). Tik pg_cron každých 15 minut zavolá `automations-run`, ta
 * splatné řádky vezme, mimo denní okno je posune na jeho začátek a jinak
 * pošle SMS (bez telefonu e-mail) a zapíše `zadosti_o_recenzi`.
 */
import { supabase } from "./supabaseClient";
import type { AutomationRule, Conditions, ReviewRequestAction, ReviewRule, Trigger } from "./automations";
import { REVIEW_TEMPLATE_VARIABLES, isReviewRule, substituteTemplate } from "./automations";
import {
  RECENZE_VYCHOZI,
  normalizujOdkazRecenze,
  platneOkno,
  platnyLimitDni,
  sablonaSOdkazem,
  vychoziVydaneStavy,
} from "../../supabase/functions/_shared/recenze";

export {
  RECENZE_VYCHOZI,
  dalsiCasOdeslani,
  jeVydanyStav,
  normalizujOdkazRecenze,
  planovanyCasZadosti,
  platneOkno,
  posudKandidata,
  sablonaSOdkazem,
  stavSpoustiRecenzi,
  vychoziVydaneStavy,
  zvolKanal,
  type FaktaKandidata,
  type KanalRecenze,
  type OknoOdeslani,
  type PosudekKandidata,
} from "../../supabase/functions/_shared/recenze";

type Stav = { key: string; label: string; isFinal: boolean };

export type JednotkaZpozdeni = "hours" | "days";

/** Formulář karty „Žádost o recenzi“. */
export type RecenzeDraft = {
  id: string | null;
  active: boolean;
  reviewUrl: string;
  delayValue: string;
  delayUnit: JednotkaZpozdeni;
  fromHour: number;
  toHour: number;
  limitDays: string;
  /** Stavy, které se počítají jako vydání. */
  statusKeys: string[];
  smsTemplate: string;
  emailSubject: string;
  emailBody: string;
};

export const NAZEV_PRAVIDLA_RECENZE = "Žádost o recenzi";

export function vychoziRecenzeDraft(stavy: Stav[]): RecenzeDraft {
  return {
    id: null,
    active: false,
    reviewUrl: "",
    delayValue: "1",
    delayUnit: "days",
    fromHour: RECENZE_VYCHOZI.oknoOd,
    toHour: RECENZE_VYCHOZI.oknoDo,
    limitDays: String(RECENZE_VYCHOZI.limitDni),
    statusKeys: vychoziVydaneStavy(stavy),
    smsTemplate: RECENZE_VYCHOZI.sms,
    emailSubject: RECENZE_VYCHOZI.emailPredmet,
    emailBody: RECENZE_VYCHOZI.emailText,
  };
}

/** Pravidlo z databáze → formulář. Chybějící hodnoty doplní výchozí. */
export function recenzeZPravidla(rule: AutomationRule | ReviewRule, stavy: Stav[]): RecenzeDraft {
  const d = vychoziRecenzeDraft(stavy);
  d.id = rule.id;
  d.active = rule.active;
  const t = rule.trigger;
  if (t.type === "ticket_issued") {
    const h = Number(t.after_hours);
    if (Number.isFinite(h) && h >= 0) {
      if (h > 0 && h % 24 === 0) { d.delayValue = String(h / 24); d.delayUnit = "days"; }
      else { d.delayValue = String(h); d.delayUnit = "hours"; }
    }
    if (Array.isArray(t.status_keys) && t.status_keys.length) d.statusKeys = [...t.status_keys];
  }
  if (isReviewRule(rule)) {
    const a = rule.action;
    d.reviewUrl = a.review_url ?? "";
    d.smsTemplate = a.template ?? d.smsTemplate;
    d.emailSubject = a.email_subject ?? d.emailSubject;
    d.emailBody = a.email_body ?? d.emailBody;
  }
  const c = rule.conditions ?? {};
  const okno = platneOkno(c.send_from_hour ?? RECENZE_VYCHOZI.oknoOd, c.send_to_hour ?? RECENZE_VYCHOZI.oknoDo);
  d.fromHour = okno.od;
  d.toHour = okno.do;
  d.limitDays = String(platnyLimitDni(c.customer_cooldown_days ?? RECENZE_VYCHOZI.limitDni));
  return d;
}

/** Zpoždění ve formuláři → hodiny. Null = nesmysl. Nula je povolená („hned v nejbližším okně“). */
export function zpozdeniHodin(value: string, unit: JednotkaZpozdeni): number | null {
  const n = Number(value.replace(",", ".").trim());
  if (!value.trim() || !Number.isFinite(n) || n < 0) return null;
  const h = Math.round(unit === "days" ? n * 24 : n);
  return h > 24 * 60 ? null : h;
}

export function validujRecenzi(d: RecenzeDraft): string[] {
  const chyby: string[] = [];
  if (!normalizujOdkazRecenze(d.reviewUrl)) chyby.push("Vyplňte platný odkaz na recenze (https://…).");
  if (zpozdeniHodin(d.delayValue, d.delayUnit) == null) chyby.push("Zpoždění musí být 0 až 60 dní.");
  if (!(Number.isInteger(d.fromHour) && Number.isInteger(d.toHour) && d.fromHour >= 0 && d.toHour <= 24 && d.fromHour < d.toHour)) {
    chyby.push("Denní okno: „od“ musí být dřív než „do“.");
  }
  const limit = Number(d.limitDays);
  if (!d.limitDays.trim() || !Number.isInteger(limit) || limit < 0 || limit > 3650) chyby.push("Limit dní musí být celé číslo 0 až 3650.");
  if (!d.statusKeys.length) chyby.push("Vyberte aspoň jeden stav, který znamená vydání.");
  if (!d.smsTemplate.trim()) chyby.push("Vyplňte text SMS.");
  if (!d.emailSubject.trim() || !d.emailBody.trim()) chyby.push("Vyplňte předmět i text e-mailu (pro zákazníky bez telefonu).");
  return chyby;
}

/** Formulář → řádek automation_rules (bez id a service_id). Null = nevalidní. */
export function pravidloZRecenze(
  d: RecenzeDraft,
  casovaZona?: string,
): { name: string; active: boolean; trigger: Trigger; action: ReviewRequestAction; conditions: Conditions } | null {
  if (validujRecenzi(d).length) return null;
  const odkaz = normalizujOdkazRecenze(d.reviewUrl)!;
  return {
    name: NAZEV_PRAVIDLA_RECENZE,
    active: d.active,
    trigger: { type: "ticket_issued", after_hours: zpozdeniHodin(d.delayValue, d.delayUnit)!, status_keys: [...d.statusKeys] },
    action: {
      type: "review_request",
      review_url: odkaz,
      template: sablonaSOdkazem(d.smsTemplate),
      email_subject: d.emailSubject.trim(),
      email_body: sablonaSOdkazem(d.emailBody),
    },
    conditions: {
      skip_final: false,
      once_per_ticket: true,
      send_from_hour: d.fromHour,
      send_to_hour: d.toHour,
      time_zone: casovaZona || RECENZE_VYCHOZI.casovaZona,
      customer_cooldown_days: Number(d.limitDays),
    },
  };
}

/** Vzorové hodnoty pro náhled; odkaz je ten skutečný z formuláře. */
export function nahledRecenze(sablona: string, odkaz: string, servis?: { name?: string; phone?: string }): string {
  const vzor: Record<string, string> = Object.fromEntries(REVIEW_TEMPLATE_VARIABLES.map((v) => [v.key, v.sample]));
  if (servis?.name) vzor.service_name = servis.name;
  if (servis?.phone) vzor.service_phone = servis.phone;
  vzor.review_url = normalizujOdkazRecenze(odkaz) ?? vzor.review_url;
  return substituteTemplate(sablonaSOdkazem(sablona), vzor);
}

/** Časová zóna prohlížeče – okno se počítá v ní (servis nastavuje z místa, kde sedí). */
export function mistniCasovaZona(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || RECENZE_VYCHOZI.casovaZona;
  } catch {
    return RECENZE_VYCHOZI.casovaZona;
  }
}

// ---------------------------------------------------------------------------
// Čtení a zápis

/** Kolik žádostí odešlo za posledních `dni` dní. Null = nejde zjistit (tabulka chybí, bez práva). */
export async function pocetOdeslanychZadosti(serviceId: string, dni = 30): Promise<number | null> {
  if (!supabase) return null;
  try {
    const od = new Date(Date.now() - dni * 86_400_000).toISOString();
    const { count, error } = await (supabase.from("zadosti_o_recenzi") as any)
      .select("id", { count: "exact", head: true })
      .eq("service_id", serviceId)
      .gte("odeslano_at", od);
    if (error) return null;
    return typeof count === "number" ? count : 0;
  } catch {
    return null;
  }
}

/** Kolik žádostí čeká ve frontě (vydané zakázky, kterým se teprve pošle). */
export async function pocetCekajicichZadosti(serviceId: string, ruleId: string): Promise<number | null> {
  if (!supabase) return null;
  try {
    const { count, error } = await (supabase.from("automation_schedule") as any)
      .select("id", { count: "exact", head: true })
      .eq("service_id", serviceId)
      .eq("rule_id", ruleId)
      .in("status", ["pending", "processing"]);
    if (error) return null;
    return typeof count === "number" ? count : 0;
  } catch {
    return null;
  }
}

/**
 * Příznak „Neposílat žádosti o recenzi“ u zákazníka. Čte se zvlášť, ne ve
 * velkém výběru zákazníků: dokud migrace není nasazená, sloupec neexistuje
 * a celý seznam zákazníků by kvůli němu spadl. Null = nejde zjistit.
 */
export async function nactiNeposilatRecenze(customerId: string): Promise<boolean | null> {
  if (!supabase) return null;
  try {
    const { data, error } = await (supabase.from("customers") as any)
      .select("neposilat_zadost_o_recenzi")
      .eq("id", customerId)
      .maybeSingle();
    if (error || !data) return null;
    return (data as { neposilat_zadost_o_recenzi?: boolean | null }).neposilat_zadost_o_recenzi === true;
  } catch {
    return null;
  }
}

export async function ulozNeposilatRecenze(
  customerId: string,
  serviceId: string,
  hodnota: boolean,
): Promise<{ ok: true; version: number | null } | { ok: false; error: unknown }> {
  if (!supabase) return { ok: false, error: new Error("Supabase není k dispozici") };
  const { data, error } = await (supabase.from("customers") as any)
    .update({ neposilat_zadost_o_recenzi: hodnota })
    .eq("id", customerId)
    .eq("service_id", serviceId)
    .select("version")
    .maybeSingle();
  if (error) return { ok: false, error };
  if (!data) return { ok: false, error: new Error("Zákazníka nelze upravit (chybí oprávnění, nebo byl smazán).") };
  const v = (data as { version?: unknown }).version;
  return { ok: true, version: typeof v === "number" ? v : null };
}
