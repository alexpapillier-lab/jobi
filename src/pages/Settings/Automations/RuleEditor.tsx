import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Button, Input, Label } from "../../../components/ui";
import { XIcon } from "../../../components/icons";
import { useIsNarrow } from "../../../hooks/useIsNarrow";
import type { StatusMeta } from "../../../state/StatusesStore";
import {
  ACTION_LABELS,
  EVENT_LABELS,
  TEMPLATE_VARIABLES,
  TRIGGER_LABELS,
  describeRule,
  substituteTemplate,
  type ActionType,
  type AutomationEvent,
  type AutomationRule,
  type TriggerType,
} from "../../../lib/automations";
import {
  SAMPLE_VARS,
  SMS_SINGLE_LIMIT,
  SMS_UNICODE_LIMIT,
  draftToRulePayload,
  smsSegments,
  validateDraft,
  type HourUnit,
  type RuleDraft,
} from "./helpers";

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

const textareaStyle: React.CSSProperties = {
  ...selectStyle,
  resize: "vertical",
  lineHeight: 1.45,
  minHeight: 88,
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

function Field({ label, children, hint }: { label: ReactNode; children: ReactNode; hint?: ReactNode }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-1)", minWidth: 0 }}>
      <Label>{label}</Label>
      {children}
      {hint ? <div style={{ fontSize: "var(--text-sm)", color: "var(--muted)" }}>{hint}</div> : null}
    </div>
  );
}

function StatusSelect({ value, onChange, statuses }: { value: string; onChange: (v: string) => void; statuses: StatusMeta[] }) {
  return (
    <select value={value} onChange={(e) => onChange(e.target.value)} style={selectStyle}>
      {!value && <option value="">– vyberte stav –</option>}
      {value && !statuses.some((s) => s.key === value) && <option value={value}>(neznámý stav: {value})</option>}
      {statuses.map((s) => (
        <option key={s.key} value={s.key}>{s.label}{s.isFinal ? " (koncový)" : ""}</option>
      ))}
    </select>
  );
}

function HoursInput({
  value, unit, onValue, onUnit, placeholder,
}: { value: string; unit: HourUnit; onValue: (v: string) => void; onUnit: (u: HourUnit) => void; placeholder?: string }) {
  return (
    <div style={{ display: "flex", gap: "var(--space-2)", minWidth: 0 }}>
      <Input type="number" min={1} step={1} inputMode="numeric" value={value} placeholder={placeholder} onChange={(e) => onValue(e.target.value)} style={{ flex: "1 1 80px", minWidth: 0 }} />
      <select value={unit} onChange={(e) => onUnit(e.target.value as HourUnit)} style={{ ...selectStyle, width: "auto", flex: "0 0 auto" }}>
        <option value="hours">hodin</option>
        <option value="days">dní</option>
      </select>
    </div>
  );
}

/**
 * Textové pole se šablonou: čipy proměnných vloží `{{klíč}}` na pozici
 * kurzoru a pod polem je náhled se vzorovými hodnotami.
 */
function TemplateArea({
  value, onChange, rows = 4, counter, placeholder,
}: { value: string; onChange: (v: string) => void; rows?: number; counter?: boolean; placeholder?: string }) {
  const ref = useRef<HTMLTextAreaElement | null>(null);
  const insert = (key: string) => {
    const el = ref.current;
    const token = `{{${key}}}`;
    if (!el) { onChange(value + token); return; }
    const start = el.selectionStart ?? value.length;
    const end = el.selectionEnd ?? value.length;
    const next = value.slice(0, start) + token + value.slice(end);
    onChange(next);
    requestAnimationFrame(() => {
      el.focus();
      const pos = start + token.length;
      el.setSelectionRange(pos, pos);
    });
  };
  const seg = smsSegments(value);
  const preview = substituteTemplate(value, SAMPLE_VARS);
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-2)" }}>
      <textarea ref={ref} value={value} rows={rows} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} style={textareaStyle} />
      <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
        {TEMPLATE_VARIABLES.map((v) => (
          <button
            key={v.key}
            type="button"
            title={`${v.label} – např. ${v.sample}`}
            onClick={() => insert(v.key)}
            style={{
              padding: "3px 8px",
              borderRadius: "var(--radius-pill)",
              border: "1px solid var(--border)",
              background: "var(--panel-2)",
              color: "var(--text)",
              fontSize: "var(--text-xs)",
              fontWeight: 600,
              cursor: "pointer",
              fontFamily: "inherit",
            }}
          >
            {v.label}
          </button>
        ))}
      </div>
      {counter && (
        <div style={{ fontSize: "var(--text-sm)", color: seg.segments > 1 ? "var(--warning-text)" : "var(--muted)" }}>
          {seg.length} znaků
          {seg.length > 0 && <> · {seg.segments} SMS</>}
          {" · "}
          {seg.unicode
            ? `Text obsahuje diakritiku, do jedné SMS se vejde ${SMS_UNICODE_LIMIT} znaků.`
            : `Bez diakritiky se do jedné SMS vejde ${SMS_SINGLE_LIMIT} znaků, s diakritikou ${SMS_UNICODE_LIMIT}.`}
        </div>
      )}
      {value.trim() && (
        <div style={{ padding: "var(--space-2) var(--space-3)", borderRadius: "var(--radius-xs)", background: "var(--panel-2)", border: "1px dashed var(--border)", fontSize: "var(--text-base)", color: "var(--text)", whiteSpace: "pre-wrap", wordBreak: "break-word" }}>
          <div style={{ fontSize: "var(--text-xs)", color: "var(--muted)", fontWeight: 700, marginBottom: 2 }}>Náhled se vzorovými údaji</div>
          {preview}
        </div>
      )}
    </div>
  );
}

export function RuleEditor({
  initial,
  statuses,
  saving,
  onCancel,
  onSave,
}: {
  initial: RuleDraft;
  statuses: StatusMeta[];
  saving: boolean;
  onCancel: () => void;
  onSave: (draft: RuleDraft) => void;
}) {
  const [draft, setDraft] = useState<RuleDraft>(initial);
  const [touched, setTouched] = useState(false);
  const narrow = useIsNarrow();
  const statusLabel = (key: string) => statuses.find((s) => s.key === key)?.label ?? key;

  useEffect(() => setDraft(initial), [initial]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") { e.preventDefault(); onCancel(); } };
    document.addEventListener("keydown", onKey, true);
    return () => document.removeEventListener("keydown", onKey, true);
  }, [onCancel]);

  const set = <K extends keyof RuleDraft>(key: K, value: RuleDraft[K]) => setDraft((d) => ({ ...d, [key]: value }));

  const payload = useMemo(() => draftToRulePayload(draft), [draft]);
  const autoName = useMemo(() => {
    if (!payload) return "";
    const fake: AutomationRule = { id: "", service_id: "", name: "", active: true, sort_order: 0, ...payload };
    return describeRule(fake, statusLabel);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [payload, statuses]);
  const errors = validateDraft(draft);
  const repeating = draft.triggerType === "status_age" && !!draft.repeatValue.trim();

  const submit = () => {
    setTouched(true);
    if (errors.length) return;
    onSave({ ...draft, name: draft.name.trim() || autoName });
  };

  const twoCol: React.CSSProperties = narrow
    ? { display: "grid", gridTemplateColumns: "1fr", gap: "var(--space-3)" }
    : { display: "grid", gridTemplateColumns: "1fr 1fr", gap: "var(--space-3)" };

  const overlay = (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={draft.id ? "Upravit pravidlo" : "Nové pravidlo"}
      style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", display: "flex", alignItems: narrow ? "flex-end" : "center", justifyContent: "center", zIndex: 10000, padding: narrow ? 0 : "var(--space-4)" }}
      onClick={onCancel}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: "var(--panel)",
          border: "1px solid var(--border)",
          borderRadius: narrow ? "var(--radius-lg) var(--radius-lg) 0 0" : "var(--radius-lg)",
          boxShadow: "var(--shadow)",
          width: narrow ? "100%" : "min(760px, 100%)",
          maxHeight: narrow ? "92vh" : "90vh",
          display: "flex",
          flexDirection: "column",
          overflow: "hidden",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "var(--space-3)", padding: "var(--space-4) var(--space-5)", borderBottom: "1px solid var(--border)" }}>
          <div style={{ fontWeight: 900, fontSize: "var(--text-lg)", color: "var(--text)" }}>{draft.id ? "Upravit pravidlo" : "Nové pravidlo"}</div>
          <Button variant="ghost" size="sm" iconOnly aria-label="Zavřít" icon={<XIcon size={16} />} onClick={onCancel} />
        </div>

        <div style={{ overflowY: "auto", padding: "var(--space-4) var(--space-5)", display: "flex", flexDirection: "column", gap: "var(--space-5)" }}>
          {/* KDY */}
          <section style={{ display: "flex", flexDirection: "column", gap: "var(--space-3)" }}>
            <div style={{ fontWeight: 800, fontSize: "var(--text-base)", color: "var(--text)" }}>Kdy</div>
            <select value={draft.triggerType} onChange={(e) => set("triggerType", e.target.value as TriggerType)} style={selectStyle}>
              {(Object.keys(TRIGGER_LABELS) as TriggerType[]).map((k) => (
                <option key={k} value={k}>{TRIGGER_LABELS[k]}</option>
              ))}
            </select>
            {draft.triggerType === "status_change" && (
              <Field label="Stav zakázky">
                <StatusSelect value={draft.triggerStatusKey} onChange={(v) => set("triggerStatusKey", v)} statuses={statuses} />
              </Field>
            )}
            {draft.triggerType === "status_age" && (
              <div style={twoCol}>
                <Field label="Stav zakázky">
                  <StatusSelect value={draft.triggerStatusKey} onChange={(v) => set("triggerStatusKey", v)} statuses={statuses} />
                </Field>
                <Field label="Déle než">
                  <HoursInput value={draft.afterValue} unit={draft.afterUnit} onValue={(v) => set("afterValue", v)} onUnit={(u) => set("afterUnit", u)} placeholder="3" />
                </Field>
                <Field label="Opakovat každých" hint="Prázdné = spustí se jen jednou.">
                  <HoursInput value={draft.repeatValue} unit={draft.repeatUnit} onValue={(v) => set("repeatValue", v)} onUnit={(u) => set("repeatUnit", u)} placeholder="jednou" />
                </Field>
              </div>
            )}
            {draft.triggerType === "event" && (
              <Field label="Událost">
                <select value={draft.event} onChange={(e) => set("event", e.target.value as AutomationEvent)} style={selectStyle}>
                  {(Object.keys(EVENT_LABELS) as AutomationEvent[]).map((k) => (
                    <option key={k} value={k}>{EVENT_LABELS[k]}</option>
                  ))}
                </select>
              </Field>
            )}
          </section>

          {/* CO */}
          <section style={{ display: "flex", flexDirection: "column", gap: "var(--space-3)" }}>
            <div style={{ fontWeight: 800, fontSize: "var(--text-base)", color: "var(--text)" }}>Co</div>
            <select value={draft.actionType} onChange={(e) => set("actionType", e.target.value as ActionType)} style={selectStyle}>
              {(Object.keys(ACTION_LABELS) as ActionType[]).map((k) => (
                <option key={k} value={k}>{ACTION_LABELS[k]}</option>
              ))}
            </select>
            {draft.actionType === "sms" && (
              <Field label="Text SMS">
                <TemplateArea value={draft.smsTemplate} onChange={(v) => set("smsTemplate", v)} counter placeholder="Dobrý den, zakázka {{code}} je ve stavu {{status}}." />
              </Field>
            )}
            {draft.actionType === "email" && (
              <>
                <Field label="Předmět">
                  <Input value={draft.emailSubject} onChange={(e) => set("emailSubject", e.target.value)} placeholder="Zakázka {{code}} – {{status}}" />
                </Field>
                <Field label="Text e-mailu">
                  <TemplateArea value={draft.emailBody} onChange={(v) => set("emailBody", v)} rows={7} placeholder="Dobrý den {{customer_name}}, …" />
                </Field>
              </>
            )}
            {draft.actionType === "set_status" && (
              <Field label="Cílový stav">
                <StatusSelect value={draft.actionStatusKey} onChange={(v) => set("actionStatusKey", v)} statuses={statuses} />
              </Field>
            )}
            {draft.actionType === "add_fee" && (
              <div style={twoCol}>
                <Field label="Název položky">
                  <Input value={draft.feeName} onChange={(e) => set("feeName", e.target.value)} placeholder="Skladné" />
                </Field>
                <Field label="Částka (Kč)">
                  <Input type="number" min={1} step={1} inputMode="decimal" value={draft.feeAmount} onChange={(e) => set("feeAmount", e.target.value)} placeholder="50" />
                </Field>
                <label style={checkboxLabelStyle}>
                  <input type="checkbox" checked={draft.feePerDay} onChange={(e) => set("feePerDay", e.target.checked)} style={{ width: 18, height: 18, accentColor: "var(--accent)" }} />
                  Za každý den ve stavu
                </label>
              </div>
            )}
            {draft.actionType === "notify" && (
              <Field label="Poznámka technikovi">
                <TemplateArea value={draft.notifyMessage} onChange={(v) => set("notifyMessage", v)} rows={3} placeholder="Zakázka {{code}} čeká už {{days}} dní." />
              </Field>
            )}
          </section>

          {/* PODMÍNKY */}
          <section style={{ display: "flex", flexDirection: "column", gap: "var(--space-2)" }}>
            <div style={{ fontWeight: 800, fontSize: "var(--text-base)", color: "var(--text)" }}>Podmínky</div>
            <label style={checkboxLabelStyle}>
              <input type="checkbox" checked={draft.skipFinal} onChange={(e) => set("skipFinal", e.target.checked)} style={{ width: 18, height: 18, accentColor: "var(--accent)" }} />
              Nespouštět u zakázek v koncovém stavu
            </label>
            {!repeating && (
              <label style={checkboxLabelStyle}>
                <input type="checkbox" checked={draft.oncePerTicket} onChange={(e) => set("oncePerTicket", e.target.checked)} style={{ width: 18, height: 18, accentColor: "var(--accent)" }} />
                Na každou zakázku jen jednou
              </label>
            )}
            {draft.actionType === "sms" && (
              <label style={checkboxLabelStyle}>
                <input type="checkbox" checked={draft.requirePhone} onChange={(e) => set("requirePhone", e.target.checked)} style={{ width: 18, height: 18, accentColor: "var(--accent)" }} />
                Přeskočit, když zákazník nemá telefon
              </label>
            )}
            {draft.actionType === "email" && (
              <label style={checkboxLabelStyle}>
                <input type="checkbox" checked={draft.requireEmail} onChange={(e) => set("requireEmail", e.target.checked)} style={{ width: 18, height: 18, accentColor: "var(--accent)" }} />
                Přeskočit, když zákazník nemá e-mail
              </label>
            )}
          </section>

          {/* NÁZEV + ZAPNUTO */}
          <section style={{ display: "flex", flexDirection: "column", gap: "var(--space-3)" }}>
            <Field label="Název pravidla" hint={!draft.name.trim() && autoName ? `Doplní se automaticky: ${autoName}` : undefined}>
              <Input value={draft.name} onChange={(e) => set("name", e.target.value)} placeholder={autoName || "Např. Připomínka vyzvednutí"} />
            </Field>
            <label style={checkboxLabelStyle}>
              <input type="checkbox" checked={draft.active} onChange={(e) => set("active", e.target.checked)} style={{ width: 18, height: 18, accentColor: "var(--accent)" }} />
              Zapnuto
            </label>
          </section>

          {touched && errors.length > 0 && (
            <div role="alert" style={{ padding: "var(--space-2) var(--space-3)", borderRadius: "var(--radius-xs)", background: "var(--danger-soft)", color: "var(--danger-text)", fontSize: "var(--text-sm)", fontWeight: 600 }}>
              {errors.map((e) => <div key={e}>{e}</div>)}
            </div>
          )}
        </div>

        <div style={{ display: "flex", justifyContent: "flex-end", gap: "var(--space-2)", padding: "var(--space-3) var(--space-5)", borderTop: "1px solid var(--border)", flexWrap: "wrap" }}>
          <Button variant="ghost" onClick={onCancel} disabled={saving}>Zrušit</Button>
          <Button variant="primary" onClick={submit} disabled={saving}>{saving ? "Ukládám…" : "Uložit"}</Button>
        </div>
      </div>
    </div>
  );

  return createPortal(overlay, document.body);
}
