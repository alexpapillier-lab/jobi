/**
 * Napojení stavebnice automatizací (`lib/automations`) na stránku Zakázky:
 *
 * - `useStatusActionsMap` – nápověda do nabídky stavů („co se stane, když
 *   zakázku přepnu“): tisk podle nastavení dokumentů + aktivní pravidla
 *   `automation_rules` se spouštěčem status_change. Když pravidla nejsou
 *   (tabulka ještě neexistuje / prázdná), sáhne se na starou `sms_automations`.
 * - `runStatusChangeAutomations` – po úspěšné změně stavu zavolá edge funkci
 *   `automations-run`; když ještě není nasazená (HTTP 404), pošle SMS postaru
 *   klientsky (`legacySmsAutomation`), aby nic neregredovalo před deployem.
 * - `runTicketCreatedAutomations` – totéž po založení zakázky (bez fallbacku,
 *   starý kód nic při založení neposílal).
 *
 * Nikdy nesmí shodit UI: chyby jdou do `reportSilent`, jediný toast pro
 * uživatele je tlumené „Automatizace se nespustila“ a jen když pro daný stav
 * nějaká pravidla existují.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { ACTION_LABELS, loadRules, runAutomations, type ActionType, type AutomationRule } from "../../../lib/automations";
import { loadDocumentsConfigRawFromDB } from "../../../lib/documentSettings";
import { supabase, supabaseUrl, supabaseFetch } from "../../../lib/supabaseClient";
import { reportSilent } from "../../../lib/reportError";
import { normalizePhone } from "../../../lib/phone";
import { showToast } from "../../../components/Toast";

/** Interval pravidelného obnovení nápovědy stavů (5 minut). */
const REFRESH_MS = 5 * 60 * 1000;

/**
 * Věty do nabídky stavů – stejný tvar jako u tisku („Vytiskne se …“).
 * `ACTION_LABELS` jsou infinitivy pro editor pravidel; sem patří budoucí čas.
 */
const STATUS_HINT_LABELS: Record<ActionType, string> = {
  sms: "Odešle se SMS zákazníkovi",
  email: "Odešle se e-mail zákazníkovi",
  set_status: "Přepne se stav zakázky",
  add_fee: "Připíše se poplatek do oprav",
  notify: "Zapíše se poznámka technikovi",
};

function hintForRule(rule: AutomationRule, statusLabel?: (key: string) => string): string {
  const a = rule.action;
  if (a.type === "set_status" && statusLabel) return `Přepne se stav na „${statusLabel(a.status_key)}“`;
  return STATUS_HINT_LABELS[a.type] ?? ACTION_LABELS[a.type] ?? rule.name;
}

export type StatusActionsState = {
  /** Popisky do `StatusPicker actionsByStatus` (klíč stavu → věty). */
  statusActionsMap: Record<string, string[]>;
  /** Aktivní pravidla status_change podle klíče stavu (pro rozhodnutí o toastu). */
  rulesByStatus: Record<string, AutomationRule[]>;
  /** Existuje pro stav nějaká automatizace (pravidlo nebo stará SMS)? */
  hasRulesFor: (statusKey: string) => boolean;
  /** Ruční obnovení (např. po uložení pravidel v Nastavení). */
  refresh: () => void;
};

/**
 * Sestaví nápovědu do nabídky stavů. Obnovuje se při změně servisu, při
 * otevření detailu (`refreshKey` = id otevřené zakázky) a každých 5 minut.
 */
export function useStatusActionsMap(
  activeServiceId: string | null,
  refreshKey: unknown,
  statusLabel?: (key: string) => string
): StatusActionsState {
  const [statusActionsMap, setStatusActionsMap] = useState<Record<string, string[]>>({});
  const [rulesByStatus, setRulesByStatus] = useState<Record<string, AutomationRule[]>>({});
  /** Klíče stavů, které mají alespoň jednu automatizaci (pravidlo nebo starou SMS). */
  const keysWithRulesRef = useRef<Set<string>>(new Set());
  const [tick, setTick] = useState(0);
  const statusLabelRef = useRef(statusLabel);
  statusLabelRef.current = statusLabel;

  const refresh = useCallback(() => setTick((t) => t + 1), []);

  useEffect(() => {
    if (!activeServiceId) {
      setStatusActionsMap({});
      setRulesByStatus({});
      keysWithRulesRef.current = new Set();
      return;
    }
    let cancelled = false;

    const load = async () => {
      const map: Record<string, Set<string>> = {};
      const rules: Record<string, AutomationRule[]> = {};
      const keysWithRules = new Set<string>();
      const add = (key: string | null | undefined, label: string) => {
        if (!key) return;
        (map[key] ||= new Set()).add(label);
      };

      // 1) Tisk podle nastavení dokumentů.
      try {
        const raw = await loadDocumentsConfigRawFromDB(activeServiceId);
        const ap = raw?.config?.autoPrint ?? {};
        add(ap.ticketListOnStatusKey, "Vytiskne se zakázkový list");
        add(ap.warrantyOnStatusKey, "Vytiskne se záruční list");
        add(ap.prijetiReklamaceOnStatusKey, "Vytiskne se přijetí reklamace");
        add(ap.vydaniReklamaceOnStatusKey, "Vytiskne se vydání reklamace");
      } catch {
        // bez nastavení dokumentů se nic netiskne
      }

      // 2) Pravidla stavebnice (loadRules při chybě/neexistující tabulce vrací []).
      let ruleCount = 0;
      try {
        const all = await loadRules(activeServiceId);
        for (const r of all) {
          if (!r.active || r.trigger?.type !== "status_change" || !r.trigger.status_key) continue;
          ruleCount += 1;
          const key = r.trigger.status_key;
          (rules[key] ||= []).push(r);
          keysWithRules.add(key);
          add(key, hintForRule(r, statusLabelRef.current));
        }
      } catch (error) {
        reportSilent({ code: "automations.rules_load_failed", error, source: "Orders.useStatusActionsMap", serviceId: activeServiceId });
      }

      // 3) Fallback: stará tabulka sms_automations, dokud nejsou pravidla.
      if (ruleCount === 0) {
        try {
          if (supabase) {
            const { data } = await (supabase.from("sms_automations") as any)
              .select("trigger_status_key, active")
              .eq("service_id", activeServiceId);
            for (const row of (data ?? []) as Array<{ trigger_status_key: string | null; active: boolean | null }>) {
              if (row.active !== false && row.trigger_status_key) {
                keysWithRules.add(row.trigger_status_key);
                add(row.trigger_status_key, STATUS_HINT_LABELS.sms);
              }
            }
          }
        } catch {
          // tabulka nemusí existovat / chybí oprávnění – nabídka jen nic neukáže
        }
      }

      if (cancelled) return;
      const out: Record<string, string[]> = {};
      for (const [k, set] of Object.entries(map)) out[k] = Array.from(set);
      keysWithRulesRef.current = keysWithRules;
      setStatusActionsMap(out);
      setRulesByStatus(rules);
    };

    void load();
    const timer = window.setInterval(() => { void load(); }, REFRESH_MS);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
    // refreshKey/tick jen vynucují nové načtení
  }, [activeServiceId, refreshKey, tick]);

  const hasRulesFor = useCallback((statusKey: string) => keysWithRulesRef.current.has(statusKey), []);

  return { statusActionsMap, rulesByStatus, hasRulesFor, refresh };
}

/** Pole zakázky potřebná pro dosazení do starých SMS šablon. */
export type LegacySmsTicket = {
  code?: string | null;
  customerName?: string | null;
  customerPhone?: string | null;
  deviceLabel?: string | null;
  issueShort?: string | null;
  portalToken?: string | null;
};

export type LegacySmsInput = {
  serviceId: string;
  ticketId: string;
  statusKey: string;
  statusLabel: string;
  ticket: LegacySmsTicket;
  totalPrice: number;
  /** Vrátí URL portálu (založí token, když chybí). Volá se jen když ho některá šablona používá. */
  resolvePortalUrl: () => Promise<string>;
};

/**
 * Původní klientské odesílání SMS podle `sms_automations` (před nasazením
 * edge funkce `automations-run`). Chování zachováno včetně červeného toastu,
 * když se SMS nepodaří odeslat.
 */
export async function legacySmsAutomation(input: LegacySmsInput): Promise<void> {
  const { serviceId, ticketId, statusKey, ticket } = input;
  if (!supabase || !ticket.customerPhone?.trim()) return;
  const { data: automations } = await (supabase.from("sms_automations") as any)
    .select("id, message_template")
    .eq("service_id", serviceId)
    .eq("trigger_status_key", statusKey)
    .eq("active", true);
  const rows = (automations ?? []) as Array<{ id: string; message_template: string | null }>;
  if (rows.length === 0) return;

  // {{portal_url}} – token se zakládá jen když ho některá šablona používá; bez portálu na serveru zůstane prázdný.
  let portalUrlVar = "";
  if (rows.some((a) => (a.message_template || "").includes("{{portal_url}}"))) {
    try {
      portalUrlVar = await input.resolvePortalUrl();
    } catch (error) {
      reportSilent({ code: "portal.automation_token_failed", error, source: "Orders.setTicketStatus", serviceId, context: { ticketId } });
    }
  }
  const vars: Record<string, string> = {
    code: ticket.code ?? "",
    customer_name: ticket.customerName ?? "",
    device_label: ticket.deviceLabel ?? "",
    total_price: String(input.totalPrice),
    status: input.statusLabel,
    notes: ticket.issueShort ?? "",
    portal_url: portalUrlVar,
  };
  const phoneNorm = normalizePhone(ticket.customerPhone);
  if (!phoneNorm) return;
  const { data: sessionData } = await supabase.auth.getSession();
  const token = sessionData?.session?.access_token;
  if (!token) return;
  for (const a of rows) {
    const body = (a.message_template || "").replace(/\{\{(\w+)\}\}/g, (_: string, k: string) => vars[k] ?? "");
    if (!body.trim()) continue;
    supabaseFetch(`${supabaseUrl}/functions/v1/sms-send`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ service_id: serviceId, to: phoneNorm, body, ticket_id: ticketId }),
    }).then(async (res) => {
      const raw = await res.text();
      let data: { error?: string } = {};
      try { if (raw) data = JSON.parse(raw); } catch { /* prázdná odpověď */ }
      if (!res.ok || data.error) showToast(data.error ?? "SMS automatizace se nepodařila odeslat", "error");
    }).catch(() => showToast("SMS automatizace se nepodařila odeslat", "error"));
  }
}

/** Edge funkce ještě není nasazená (nebo route neexistuje). */
function isNotDeployed(error: string | undefined): boolean {
  return typeof error === "string" && error.startsWith("HTTP 404");
}

/**
 * Po úspěšné změně stavu: spustí pravidla na serveru; při HTTP 404 (funkce
 * nenasazená) pošle SMS postaru. Jiná chyba → `reportSilent` a jeden tlumený
 * toast, ale jen když pro stav nějaké automatizace existují.
 */
export async function runStatusChangeAutomations(input: LegacySmsInput & { hasRules: boolean }): Promise<void> {
  try {
    const res = await runAutomations({ serviceId: input.serviceId, ticketId: input.ticketId, event: "status_change", statusKey: input.statusKey });
    if (res.ok) return;
    if (isNotDeployed(res.error)) {
      await legacySmsAutomation(input);
      return;
    }
    const message = res.error || "Neznámá chyba";
    reportSilent({ code: "automations.status_change_failed", error: new Error(message), source: "Orders.setTicketStatus", serviceId: input.serviceId, context: { ticketId: input.ticketId, statusKey: input.statusKey } });
    if (input.hasRules) showToast(`Automatizace se nespustila: ${message}`, "info");
  } catch (error) {
    reportSilent({ code: "automations.status_change_failed", error, source: "Orders.setTicketStatus", serviceId: input.serviceId, context: { ticketId: input.ticketId, statusKey: input.statusKey } });
  }
}

/** Po založení zakázky: spustí pravidla „Založí se nová zakázka“. Bez toastu – uživatel nic nečeká. */
export async function runTicketCreatedAutomations(serviceId: string, ticketId: string): Promise<void> {
  try {
    const res = await runAutomations({ serviceId, ticketId, event: "ticket_created" });
    if (res.ok || isNotDeployed(res.error)) return;
    reportSilent({ code: "automations.ticket_created_failed", error: new Error(res.error || "Neznámá chyba"), source: "Orders.createTicket", serviceId, context: { ticketId } });
  } catch (error) {
    reportSilent({ code: "automations.ticket_created_failed", error, source: "Orders.createTicket", serviceId, context: { ticketId } });
  }
}
