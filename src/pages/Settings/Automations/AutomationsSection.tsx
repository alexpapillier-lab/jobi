import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Button, Card, MenuItem, Pill, useSavedHint } from "../../../components/ui";
import { SectionHeading } from "../../../components/SectionHeading";
import { BoltIcon, EditIcon, MoreIcon, PlusIcon } from "../../../components/icons";
import { ConfirmDialog } from "../../../components/ConfirmDialog";
import { showToast } from "../../../components/Toast";
import { reportError } from "../../../lib/reportError";
import { supabase } from "../../../lib/supabaseClient";
import { useStatuses } from "../../../state/StatusesStore";
import { useIsNarrow } from "../../../hooks/useIsNarrow";
import { ACTION_LABELS, describeRule, type AutomationRule } from "../../../lib/automations";
import { RuleEditor } from "./RuleEditor";
import { RunsCard } from "./RunsCard";
import {
  PRESETS,
  draftToRulePayload,
  emptyDraft,
  fetchRules,
  presetDraft,
  ruleToDraft,
  type PresetId,
  type RuleDraft,
} from "./helpers";

const ACTION_COLORS: Record<AutomationRule["action"]["type"], string> = {
  sms: "var(--info-text)",
  email: "var(--info-text)",
  set_status: "var(--warning-text)",
  add_fee: "var(--warning-text)",
  notify: "var(--muted)",
};

function ArrowIcon({ dir }: { dir: "up" | "down" }) {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {dir === "up" ? <path d="M12 19V5M5 12l7-7 7 7" /> : <path d="M12 5v14M19 12l-7 7-7-7" />}
    </svg>
  );
}

function rulesTable() {
  return supabase ? (supabase.from("automation_rules") as any) : null;
}

/**
 * Nastavení → Komunikace → Automatizace. Seznam pravidel, editor a historie.
 * Tabulky nemusí na serveru existovat – pak se ukáže tlumená poznámka
 * a nic dalšího (žádná chyba, žádný toast).
 */
export function AutomationsSection({ activeServiceId }: { activeServiceId: string }) {
  const { statuses } = useStatuses();
  const narrow = useIsNarrow();
  const hint = useSavedHint();
  const [rules, setRules] = useState<AutomationRule[]>([]);
  const [loading, setLoading] = useState(true);
  const [unavailable, setUnavailable] = useState(false);
  const [editing, setEditing] = useState<RuleDraft | null>(null);
  const [saving, setSaving] = useState(false);
  const [menuFor, setMenuFor] = useState<string | null>(null);
  const [deleteFor, setDeleteFor] = useState<AutomationRule | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);

  const statusLabel = useCallback((key: string) => statuses.find((s) => s.key === key)?.label ?? key, [statuses]);
  const firstStatusKey = statuses[0]?.key ?? "";

  const reload = useCallback(async () => {
    setLoading(true);
    const res = await fetchRules(activeServiceId);
    setUnavailable(!!res.error);
    setRules(res.data);
    setLoading(false);
  }, [activeServiceId]);

  useEffect(() => { void reload(); }, [reload]);

  // Zavření nabídky ⋯ klikem mimo
  useEffect(() => {
    if (!menuFor) return;
    const onDown = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuFor(null);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [menuFor]);

  const sorted = useMemo(() => [...rules].sort((a, b) => a.sort_order - b.sort_order), [rules]);

  const fail = (code: string, error: unknown, userMessage: string) =>
    reportError({ code, error, userMessage, source: "Settings.Automations", serviceId: activeServiceId });

  const openNew = () => setEditing(emptyDraft(firstStatusKey));
  const openPreset = (id: PresetId) => setEditing(presetDraft(id, statuses));
  const openEdit = (rule: AutomationRule) => { setMenuFor(null); setEditing(ruleToDraft(rule, firstStatusKey)); };

  const save = async (draft: RuleDraft) => {
    const table = rulesTable();
    const payload = draftToRulePayload(draft);
    if (!table || !payload) return;
    setSaving(true);
    try {
      if (draft.id) {
        const { data, error } = await table
          .update({ name: draft.name, active: draft.active, trigger: payload.trigger, action: payload.action, conditions: payload.conditions })
          .eq("id", draft.id)
          .select("*")
          .single();
        if (error) throw error;
        setRules((prev) => prev.map((r) => (r.id === draft.id ? (data as AutomationRule) : r)));
        showToast("Pravidlo uloženo", "success");
      } else {
        const sort_order = rules.length ? Math.max(...rules.map((r) => r.sort_order)) + 1 : 0;
        const { data, error } = await table
          .insert({ service_id: activeServiceId, name: draft.name, active: draft.active, trigger: payload.trigger, action: payload.action, conditions: payload.conditions, sort_order })
          .select("*")
          .single();
        if (error) throw error;
        setRules((prev) => [...prev, data as AutomationRule]);
        showToast("Pravidlo vytvořeno", "success");
      }
      setEditing(null);
    } catch (e) {
      fail("automations.save_failed", e, "Pravidlo se nepodařilo uložit");
    } finally {
      setSaving(false);
    }
  };

  const toggleActive = async (rule: AutomationRule) => {
    const table = rulesTable();
    if (!table) return;
    const next = !rule.active;
    setRules((prev) => prev.map((r) => (r.id === rule.id ? { ...r, active: next } : r)));
    const { error } = await table.update({ active: next }).eq("id", rule.id);
    if (error) {
      setRules((prev) => prev.map((r) => (r.id === rule.id ? { ...r, active: rule.active } : r)));
      fail("automations.toggle_failed", error, "Změnu se nepodařilo uložit");
      return;
    }
    hint.show();
  };

  const duplicate = async (rule: AutomationRule) => {
    setMenuFor(null);
    const table = rulesTable();
    if (!table) return;
    const sort_order = rules.length ? Math.max(...rules.map((r) => r.sort_order)) + 1 : 0;
    const { data, error } = await table
      .insert({ service_id: activeServiceId, name: `${rule.name} (kopie)`, active: false, trigger: rule.trigger, action: rule.action, conditions: rule.conditions, sort_order })
      .select("*")
      .single();
    if (error) { fail("automations.duplicate_failed", error, "Pravidlo se nepodařilo zkopírovat"); return; }
    setRules((prev) => [...prev, data as AutomationRule]);
    showToast("Kopie vytvořena (vypnutá)", "success");
  };

  const remove = async (rule: AutomationRule) => {
    const table = rulesTable();
    if (!table) return;
    const { error } = await table.delete().eq("id", rule.id);
    if (error) throw error;
    setRules((prev) => prev.filter((r) => r.id !== rule.id));
    setDeleteFor(null);
    showToast("Pravidlo smazáno", "success");
  };

  const move = async (index: number, dir: -1 | 1) => {
    const table = rulesTable();
    const other = index + dir;
    if (!table || other < 0 || other >= sorted.length) return;
    const a = sorted[index];
    const b = sorted[other];
    // Když mají shodné sort_order (např. po ručním vložení), přečíslovat celé pořadí.
    const next = [...sorted];
    next[index] = b; next[other] = a;
    const renumbered = next.map((r, i) => ({ ...r, sort_order: i }));
    setRules(renumbered);
    const changed = renumbered.filter((r) => rules.find((x) => x.id === r.id)?.sort_order !== r.sort_order);
    const results = await Promise.all(changed.map((r) => table.update({ sort_order: r.sort_order }).eq("id", r.id)));
    const err = results.find((r: { error: unknown }) => r.error)?.error;
    if (err) { fail("automations.reorder_failed", err, "Pořadí se nepodařilo uložit"); void reload(); return; }
    hint.show();
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-6)" }}>
      <Card>
        <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: "var(--space-3)", flexWrap: "wrap" }}>
          <div style={{ minWidth: 0 }}>
            <SectionHeading icon={<BoltIcon size={18} />}>Pravidla {hint.node}</SectionHeading>
            <div style={{ fontSize: "var(--text-sm)", color: "var(--muted)", marginTop: -6, marginBottom: "var(--space-3)" }}>
              Když se něco stane se zakázkou, Jobi za vás pošle zprávu, přepne stav nebo připíše poplatek.
            </div>
          </div>
          {!unavailable && (
            <Button variant="primary" size="sm" icon={<PlusIcon size={14} />} onClick={openNew}>Nové pravidlo</Button>
          )}
        </div>

        {unavailable ? (
          <div style={{ color: "var(--muted)", fontSize: "var(--text-base)", padding: "var(--space-3) 0" }}>Automatizace nejsou na serveru zapnuté.</div>
        ) : loading ? (
          <div style={{ color: "var(--muted)", fontSize: "var(--text-base)", padding: "var(--space-3) 0" }}>Načítám…</div>
        ) : sorted.length === 0 ? (
          <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-3)" }}>
            <div style={{ fontSize: "var(--text-base)", color: "var(--text)" }}>Zatím nemáte žádné pravidlo. Začněte jednou z šablon – text si pak upravíte.</div>
            <div style={{ display: "grid", gridTemplateColumns: narrow ? "1fr" : "repeat(3, minmax(0, 1fr))", gap: "var(--space-3)" }}>
              {PRESETS.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => openPreset(p.id)}
                  style={{
                    textAlign: "left",
                    padding: "var(--space-3) var(--space-4)",
                    borderRadius: "var(--radius-sm)",
                    border: "1px solid var(--border)",
                    background: "var(--panel-2)",
                    color: "var(--text)",
                    cursor: "pointer",
                    fontFamily: "inherit",
                    display: "flex",
                    flexDirection: "column",
                    gap: 4,
                  }}
                >
                  <span style={{ fontWeight: 800, fontSize: "var(--text-base)" }}>{p.title}</span>
                  <span style={{ fontSize: "var(--text-sm)", color: "var(--muted)" }}>{p.description}</span>
                </button>
              ))}
            </div>
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column" }}>
            {sorted.map((rule, i) => {
              const sentence = describeRule(rule, statusLabel);
              const showName = rule.name && rule.name !== sentence;
              return (
                <div
                  key={rule.id}
                  style={{
                    display: "flex",
                    alignItems: narrow ? "stretch" : "center",
                    flexDirection: narrow ? "column" : "row",
                    gap: "var(--space-3)",
                    padding: "var(--space-3) 0",
                    borderTop: i === 0 ? "none" : "1px solid var(--border)",
                    opacity: rule.active ? 1 : 0.65,
                  }}
                >
                  <div style={{ display: "flex", flexDirection: "column", gap: 2, flexShrink: 0 }}>
                    <Button size="sm" variant="ghost" iconOnly aria-label="Posunout výš" icon={<ArrowIcon dir="up" />} disabled={i === 0} onClick={() => void move(i, -1)} />
                    <Button size="sm" variant="ghost" iconOnly aria-label="Posunout níž" icon={<ArrowIcon dir="down" />} disabled={i === sorted.length - 1} onClick={() => void move(i, 1)} />
                  </div>
                  <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 4 }}>
                    <div style={{ fontSize: "var(--text-base)", color: "var(--text)", fontWeight: 600, lineHeight: 1.4, wordBreak: "break-word" }}>{sentence}</div>
                    <div style={{ display: "flex", alignItems: "center", gap: "var(--space-2)", flexWrap: "wrap" }}>
                      <Pill color={ACTION_COLORS[rule.action.type]}>{ACTION_LABELS[rule.action.type]}</Pill>
                      {showName && <span style={{ fontSize: "var(--text-sm)", color: "var(--muted)" }}>{rule.name}</span>}
                    </div>
                  </div>
                  <div style={{ display: "flex", alignItems: "center", gap: "var(--space-2)", flexShrink: 0, flexWrap: "wrap" }}>
                    <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: "var(--text-sm)", color: "var(--muted)", cursor: "pointer" }}>
                      <input type="checkbox" checked={rule.active} onChange={() => void toggleActive(rule)} style={{ width: 18, height: 18, accentColor: "var(--accent)" }} />
                      Zapnuto
                    </label>
                    <Button size="sm" icon={<EditIcon size={14} />} onClick={() => openEdit(rule)}>Upravit</Button>
                    <div style={{ position: "relative" }} ref={menuFor === rule.id ? menuRef : undefined}>
                      <Button size="sm" variant="ghost" iconOnly aria-label="Další akce" aria-expanded={menuFor === rule.id} icon={<MoreIcon size={16} />} onClick={() => setMenuFor((m) => (m === rule.id ? null : rule.id))} />
                      {menuFor === rule.id && (
                        <div style={{ position: "absolute", right: 0, top: "calc(100% + 4px)", minWidth: 160, background: "var(--panel)", border: "1px solid var(--border)", borderRadius: "var(--radius-sm)", boxShadow: "var(--shadow)", zIndex: 50, overflow: "hidden" }}>
                          <MenuItem onClick={() => void duplicate(rule)}>Duplikovat</MenuItem>
                          <MenuItem variant="danger" onClick={() => { setMenuFor(null); setDeleteFor(rule); }}>Smazat</MenuItem>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </Card>

      {!unavailable && <RunsCard serviceId={activeServiceId} rules={rules} />}

      {editing && (
        <RuleEditor initial={editing} statuses={statuses} saving={saving} onCancel={() => setEditing(null)} onSave={(d) => void save(d)} />
      )}

      <ConfirmDialog
        open={!!deleteFor}
        title="Smazat pravidlo?"
        message={deleteFor ? `„${deleteFor.name}“ se smaže. Historie spuštění zůstane.` : ""}
        confirmLabel="Smazat"
        variant="danger"
        onConfirm={() => (deleteFor ? remove(deleteFor) : undefined)}
        onCancel={() => setDeleteFor(null)}
      />
    </div>
  );
}
