import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { Button, Card, Input, Label, Pill } from "../../../components/ui";
import { SectionHeading } from "../../../components/SectionHeading";
import { LinkIcon } from "../../../components/icons";
import { showToast } from "../../../components/Toast";
import { reportError } from "../../../lib/reportError";
import { supabase } from "../../../lib/supabaseClient";
import { useIsNarrow } from "../../../hooks/useIsNarrow";
import { useSmsEnabled } from "../../../hooks/useSmsEnabled";
import type { StatusMeta } from "../../../state/StatusesStore";
import { REVIEW_TEMPLATE_VARIABLES, type AutomationRule, type ReviewRule } from "../../../lib/automations";
import {
  RECENZE_VYCHOZI,
  mistniCasovaZona,
  nahledRecenze,
  normalizujOdkazRecenze,
  pocetCekajicichZadosti,
  pocetOdeslanychZadosti,
  pravidloZRecenze,
  recenzeZPravidla,
  validujRecenzi,
  vychoziRecenzeDraft,
  type JednotkaZpozdeni,
  type RecenzeDraft,
} from "../../../lib/recenze";
import { TemplateArea } from "./RuleEditor";

const selectStyle: React.CSSProperties = {
  width: "100%",
  padding: "10px var(--space-3)",
  borderRadius: "var(--radius-sm)",
  border: "1px solid var(--border)",
  background: "var(--panel)",
  color: "var(--text)",
  fontFamily: "inherit",
  fontSize: "var(--text-base)",
  minWidth: 0,
};

const checkboxLabelStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: "var(--space-2)",
  fontSize: "var(--text-base)",
  color: "var(--text)",
  cursor: "pointer",
  minHeight: 28,
};

const HODINY = Array.from({ length: 25 }, (_, i) => i);

function Field({ label, children, hint }: { label: ReactNode; children: ReactNode; hint?: ReactNode }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-1)", minWidth: 0 }}>
      <Label>{label}</Label>
      {children}
      {hint ? <div style={{ fontSize: "var(--text-sm)", color: "var(--muted)" }}>{hint}</div> : null}
    </div>
  );
}

/**
 * Nastavení → Komunikace → Automatizace → Žádost o recenzi.
 *
 * Jedno pravidlo na servis (spouštěč `ticket_issued`, akce `review_request`).
 * Obecný editor ho neukazuje – má zpoždění, denní okno a limit na zákazníka,
 * které jinde nedávají smysl. Plánování: přepnutí zakázky do vydaného stavu
 * založí v databázi řádek fronty, tik každých 15 minut ho v okně odešle.
 */
export function ReviewRequestCard({
  serviceId,
  rule,
  statuses,
  nextSortOrder,
  onSaved,
}: {
  serviceId: string;
  rule: ReviewRule | null;
  statuses: StatusMeta[];
  nextSortOrder: number;
  onSaved: (rule: AutomationRule) => void;
}) {
  const narrow = useIsNarrow();
  const smsEnabled = useSmsEnabled(serviceId);
  const initial = useMemo(
    () => (rule ? recenzeZPravidla(rule, statuses) : vychoziRecenzeDraft(statuses)),
    // Znovu jen při jiném pravidle nebo po uložení (updated_at), ne při každém renderu.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [rule?.id, rule?.updated_at, statuses.length],
  );
  const [draft, setDraft] = useState<RecenzeDraft>(initial);
  const [touched, setTouched] = useState(false);
  const [saving, setSaving] = useState(false);
  const [odeslano, setOdeslano] = useState<number | null>(null);
  const [ceka, setCeka] = useState<number | null>(null);

  useEffect(() => { setDraft(initial); setTouched(false); }, [initial]);

  const nactiPocty = useCallback(async () => {
    setOdeslano(await pocetOdeslanychZadosti(serviceId, 30));
    setCeka(rule?.id ? await pocetCekajicichZadosti(serviceId, rule.id) : null);
  }, [serviceId, rule?.id]);

  useEffect(() => { void nactiPocty(); }, [nactiPocty]);

  const set = <K extends keyof RecenzeDraft>(key: K, value: RecenzeDraft[K]) => setDraft((d) => ({ ...d, [key]: value }));
  const dirty = JSON.stringify(draft) !== JSON.stringify(initial);
  const errors = validujRecenzi(draft);
  const odkaz = normalizujOdkazRecenze(draft.reviewUrl);

  // Nabízí se koncové stavy; nekoncový jen tehdy, když už je vybraný.
  const nabizeneStavy = statuses.filter((s) => s.isFinal || draft.statusKeys.includes(s.key));

  const toggleStatus = (key: string, on: boolean) =>
    set("statusKeys", on ? [...draft.statusKeys, key] : draft.statusKeys.filter((k) => k !== key));

  const save = async () => {
    setTouched(true);
    const payload = pravidloZRecenze(draft, mistniCasovaZona());
    if (!payload || !supabase) return;
    setSaving(true);
    try {
      const table = supabase.from("automation_rules") as any;
      const res = draft.id
        ? await table.update(payload).eq("id", draft.id).eq("service_id", serviceId).select("*").single()
        : await table.insert({ ...payload, service_id: serviceId, sort_order: nextSortOrder }).select("*").single();
      if (res.error) throw res.error;
      onSaved(res.data as AutomationRule);
      showToast(payload.active ? "Žádost o recenzi je zapnutá" : "Uloženo (vypnuto)", "success");
      void nactiPocty();
    } catch (e) {
      reportError({ code: "automations.review_save_failed", error: e, userMessage: "Nastavení žádosti o recenzi se nepodařilo uložit", source: "Settings.Automations.Review", serviceId });
    } finally {
      setSaving(false);
    }
  };

  const twoCol: React.CSSProperties = { display: "grid", gridTemplateColumns: narrow ? "1fr" : "1fr 1fr", gap: "var(--space-3)" };
  const zpozdeniText = draft.delayUnit === "days"
    ? `${draft.delayValue || "?"} ${draft.delayValue === "1" ? "den" : "dní"}`
    : `${draft.delayValue || "?"} h`;

  return (
    <Card data-tour="automatizace-recenze">
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: "var(--space-3)", flexWrap: "wrap" }}>
        <div style={{ minWidth: 0, flex: "1 1 280px" }}>
          <SectionHeading icon={<LinkIcon size={18} />}>Žádost o recenzi</SectionHeading>
          <div style={{ fontSize: "var(--text-sm)", color: "var(--muted)", marginTop: -6, marginBottom: "var(--space-3)" }}>
            Po vydání zakázky pošle zákazníkovi SMS s poděkováním a odkazem na vaše recenze (Google, Firmy.cz, Heureka…).
            Kdo nemá telefon, dostane e-mail. Jen v denní době a stejnému zákazníkovi nejvýš jednou za {draft.limitDays || "?"} dní.
          </div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: "var(--space-2)", flexWrap: "wrap" }}>
          <Pill color={rule?.active ? "var(--success-text)" : "var(--muted)"}>{rule?.active ? "Zapnuto" : rule ? "Vypnuto" : "Nenastaveno"}</Pill>
          {odeslano != null && <span style={{ fontSize: "var(--text-sm)", color: "var(--muted)" }}>Odesláno za 30 dní: <b style={{ color: "var(--text)" }}>{odeslano}</b></span>}
          {ceka != null && ceka > 0 && <span style={{ fontSize: "var(--text-sm)", color: "var(--muted)" }}>Čeká na odeslání: <b style={{ color: "var(--text)" }}>{ceka}</b></span>}
        </div>
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-4)" }}>
        <Field
          label="Odkaz na recenze"
          hint={<>Google: Profil firmy → „Získat více recenzí“ → zkopírujte odkaz (tvar <code>g.page/r/…/review</code>). Funguje i Firmy.cz nebo Heureka.</>}
        >
          <Input value={draft.reviewUrl} onChange={(e) => set("reviewUrl", e.target.value)} placeholder="https://g.page/r/…/review" inputMode="url" />
        </Field>

        <div style={twoCol}>
          <Field label="Kdy po vydání" hint="Výchozí je 1 den. Když vyjde mimo denní okno, pošle se na jeho začátku.">
            <div style={{ display: "flex", gap: "var(--space-2)", minWidth: 0 }}>
              <Input type="number" min={0} step={1} inputMode="numeric" value={draft.delayValue} onChange={(e) => set("delayValue", e.target.value)} style={{ flex: "1 1 80px", minWidth: 0 }} />
              <select value={draft.delayUnit} onChange={(e) => set("delayUnit", e.target.value as JednotkaZpozdeni)} style={{ ...selectStyle, width: "auto", flex: "0 0 auto" }}>
                <option value="hours">hodin</option>
                <option value="days">dní</option>
              </select>
            </div>
          </Field>
          <Field label="Posílat jen mezi" hint={`Místní čas (${mistniCasovaZona()}).`}>
            <div style={{ display: "flex", alignItems: "center", gap: "var(--space-2)" }}>
              <select aria-label="Od hodiny" value={draft.fromHour} onChange={(e) => set("fromHour", Number(e.target.value))} style={selectStyle}>
                {HODINY.slice(0, 24).map((h) => <option key={h} value={h}>{h}:00</option>)}
              </select>
              <span style={{ color: "var(--muted)" }}>–</span>
              <select aria-label="Do hodiny" value={draft.toHour} onChange={(e) => set("toHour", Number(e.target.value))} style={selectStyle}>
                {HODINY.slice(1).map((h) => <option key={h} value={h}>{h}:00</option>)}
              </select>
            </div>
          </Field>
          <Field label="Stejnému zákazníkovi nejvýš jednou za" hint="Stálý firemní zákazník s deseti zakázkami měsíčně nedostane deset SMS. 0 = bez limitu.">
            <div style={{ display: "flex", alignItems: "center", gap: "var(--space-2)" }}>
              <Input type="number" min={0} step={1} inputMode="numeric" value={draft.limitDays} onChange={(e) => set("limitDays", e.target.value)} style={{ flex: "1 1 80px", minWidth: 0 }} />
              <span style={{ color: "var(--muted)", flexShrink: 0 }}>dní</span>
            </div>
          </Field>
          <Field label="Vydání znamená stav" hint="Storno a vrácení bez opravy se nepočítají.">
            <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
              {nabizeneStavy.length === 0 && <span style={{ fontSize: "var(--text-sm)", color: "var(--muted)" }}>Servis nemá žádný koncový stav.</span>}
              {nabizeneStavy.map((s) => (
                <label key={s.key} style={checkboxLabelStyle}>
                  <input type="checkbox" checked={draft.statusKeys.includes(s.key)} onChange={(e) => toggleStatus(s.key, e.target.checked)} style={{ width: 18, height: 18, accentColor: "var(--accent)" }} />
                  {s.label}
                </label>
              ))}
            </div>
          </Field>
        </div>

        <Field label="Text SMS" hint="Diakritika se před odesláním odstraní, ať se zpráva vejde do levnější SMS.">
          <TemplateArea
            value={draft.smsTemplate}
            onChange={(v) => set("smsTemplate", v)}
            rows={3}
            counter
            variables={REVIEW_TEMPLATE_VARIABLES}
            preview={nahledRecenze(draft.smsTemplate, draft.reviewUrl)}
            placeholder={RECENZE_VYCHOZI.sms}
          />
        </Field>

        <details>
          <summary style={{ cursor: "pointer", fontWeight: 700, fontSize: "var(--text-base)", color: "var(--text)" }}>E-mail pro zákazníky bez telefonu</summary>
          <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-3)", marginTop: "var(--space-3)" }}>
            <Field label="Předmět">
              <Input value={draft.emailSubject} onChange={(e) => set("emailSubject", e.target.value)} placeholder={RECENZE_VYCHOZI.emailPredmet} />
            </Field>
            <Field label="Text e-mailu">
              <TemplateArea
                value={draft.emailBody}
                onChange={(v) => set("emailBody", v)}
                rows={7}
                variables={REVIEW_TEMPLATE_VARIABLES}
                preview={nahledRecenze(draft.emailBody, draft.reviewUrl)}
              />
            </Field>
          </div>
        </details>

        {!smsEnabled && (
          <div style={{ padding: "var(--space-2) var(--space-3)", borderRadius: "var(--radius-xs)", background: "var(--warning-soft)", color: "var(--warning-text)", fontSize: "var(--text-sm)", fontWeight: 600 }}>
            Modul SMS není aktivní – žádosti půjdou jen e-mailem zákazníkům, kteří e-mail mají.
          </div>
        )}

        <label style={checkboxLabelStyle}>
          <input type="checkbox" checked={draft.active} onChange={(e) => set("active", e.target.checked)} style={{ width: 18, height: 18, accentColor: "var(--accent)" }} />
          Zapnuto – {zpozdeniText} po vydání, {draft.fromHour}:00–{draft.toHour}:00{odkaz ? "" : " (doplňte odkaz)"}
        </label>
        <div style={{ fontSize: "var(--text-sm)", color: "var(--muted)", marginTop: -8 }}>
          Týká se zakázek vydaných po zapnutí; starší zakázky žádost nedostanou. U zákazníka jde žádost vypnout v Zákaznících.
        </div>

        {touched && errors.length > 0 && (
          <div role="alert" style={{ padding: "var(--space-2) var(--space-3)", borderRadius: "var(--radius-xs)", background: "var(--danger-soft)", color: "var(--danger-text)", fontSize: "var(--text-sm)", fontWeight: 600 }}>
            {errors.map((e) => <div key={e}>{e}</div>)}
          </div>
        )}

        <div style={{ display: "flex", justifyContent: "flex-end", gap: "var(--space-2)", flexWrap: "wrap" }}>
          {dirty && <Button variant="ghost" onClick={() => { setDraft(initial); setTouched(false); }} disabled={saving}>Zahodit změny</Button>}
          <Button variant="primary" onClick={() => void save()} disabled={saving || !dirty}>{saving ? "Ukládám…" : "Uložit"}</Button>
        </div>
      </div>
    </Card>
  );
}
