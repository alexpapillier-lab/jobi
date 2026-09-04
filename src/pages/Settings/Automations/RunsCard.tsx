import { useCallback, useEffect, useState } from "react";
import { Button, Card, Pill } from "../../../components/ui";
import { SectionHeading } from "../../../components/SectionHeading";
import { HistoryIcon } from "../../../components/icons";
import { useIsNarrow } from "../../../hooks/useIsNarrow";
import type { AutomationRule, AutomationRun } from "../../../lib/automations";
import { fetchRuns, fetchTicketCodes, formatRunTime } from "./helpers";

const RESULT_META: Record<AutomationRun["result"], { label: string; color: string }> = {
  ok: { label: "Provedeno", color: "var(--success-text)" },
  skipped: { label: "Přeskočeno", color: "var(--muted)" },
  error: { label: "Chyba", color: "var(--danger-text)" },
};

const REFRESH_MS = 60_000;

/**
 * Posledních 50 spuštění. Pravidla i kódy zakázek se dopojují na klientovi –
 * `automation_runs` nese jen id, a joiny přes PostgREST by chtěly FK, které
 * se pro smazaná pravidla nehodí (řádek historie má přežít smazání).
 */
export function RunsCard({ serviceId, rules }: { serviceId: string; rules: AutomationRule[] }) {
  const [runs, setRuns] = useState<AutomationRun[]>([]);
  const [codes, setCodes] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(false);
  const [unavailable, setUnavailable] = useState(false);
  const narrow = useIsNarrow();

  const refresh = useCallback(async () => {
    setLoading(true);
    const res = await fetchRuns(serviceId, 50);
    setUnavailable(!!res.error);
    setRuns(res.data);
    const ids = Array.from(new Set(res.data.map((r) => r.ticket_id).filter((x): x is string => !!x)));
    setCodes(await fetchTicketCodes(ids));
    setLoading(false);
  }, [serviceId]);

  useEffect(() => {
    let cancelled = false;
    const tick = () => { if (!cancelled) void refresh(); };
    tick();
    const id = setInterval(tick, REFRESH_MS);
    return () => { cancelled = true; clearInterval(id); };
  }, [refresh]);

  const ruleName = (id: string) => rules.find((r) => r.id === id)?.name ?? "Smazané pravidlo";

  return (
    <Card>
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: "var(--space-3)", flexWrap: "wrap" }}>
        <div>
          <SectionHeading icon={<HistoryIcon size={18} />}>Historie spuštění</SectionHeading>
          <div style={{ fontSize: "var(--text-sm)", color: "var(--muted)", marginTop: -6, marginBottom: "var(--space-3)" }}>
            Posledních 50 spuštění. Obnovuje se automaticky každou minutu.
          </div>
        </div>
        <Button size="sm" onClick={() => void refresh()} disabled={loading}>{loading ? "Načítám…" : "Obnovit"}</Button>
      </div>

      {unavailable ? (
        <div style={{ color: "var(--muted)", fontSize: "var(--text-base)", padding: "var(--space-3) 0" }}>Automatizace nejsou na serveru zapnuté.</div>
      ) : runs.length === 0 ? (
        <div style={{ color: "var(--muted)", fontSize: "var(--text-base)", padding: "var(--space-3) 0" }}>
          {loading ? "Načítám…" : "Zatím se žádné pravidlo nespustilo."}
        </div>
      ) : narrow ? (
        <div style={{ display: "flex", flexDirection: "column" }}>
          {runs.map((run) => {
            const meta = RESULT_META[run.result] ?? RESULT_META.skipped;
            return (
              <div key={run.id} style={{ padding: "var(--space-2) 0", borderTop: "1px solid var(--border)", display: "flex", flexDirection: "column", gap: 2 }}>
                <div style={{ display: "flex", justifyContent: "space-between", gap: "var(--space-2)", alignItems: "center" }}>
                  <span style={{ fontSize: "var(--text-sm)", color: "var(--muted)" }}>{formatRunTime(run.ran_at)}</span>
                  <Pill color={meta.color} dot>{meta.label}</Pill>
                </div>
                <div style={{ fontSize: "var(--text-base)", color: "var(--text)", fontWeight: 600 }}>{ruleName(run.rule_id)}</div>
                <div style={{ fontSize: "var(--text-sm)", color: "var(--muted)" }}>
                  {run.ticket_id ? (codes[run.ticket_id] || "–") : "–"}
                  {run.detail ? ` · ${run.detail}` : ""}
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "var(--text-base)" }}>
            <thead>
              <tr style={{ color: "var(--muted)", fontSize: "var(--text-xs)", textTransform: "uppercase", letterSpacing: 0.4 }}>
                <th style={{ textAlign: "left", padding: "6px 8px 6px 0", fontWeight: 700 }}>Čas</th>
                <th style={{ textAlign: "left", padding: "6px 8px", fontWeight: 700 }}>Pravidlo</th>
                <th style={{ textAlign: "left", padding: "6px 8px", fontWeight: 700 }}>Zakázka</th>
                <th style={{ textAlign: "left", padding: "6px 8px", fontWeight: 700 }}>Výsledek</th>
                <th style={{ textAlign: "left", padding: "6px 0 6px 8px", fontWeight: 700 }}>Detail</th>
              </tr>
            </thead>
            <tbody>
              {runs.map((run) => {
                const meta = RESULT_META[run.result] ?? RESULT_META.skipped;
                return (
                  <tr key={run.id} style={{ borderTop: "1px solid var(--border)" }}>
                    <td style={{ padding: "8px 8px 8px 0", whiteSpace: "nowrap", color: "var(--muted)" }}>{formatRunTime(run.ran_at)}</td>
                    <td style={{ padding: "8px", color: "var(--text)", fontWeight: 600 }}>{ruleName(run.rule_id)}</td>
                    <td style={{ padding: "8px", whiteSpace: "nowrap", color: "var(--text)" }}>{run.ticket_id ? (codes[run.ticket_id] || "–") : "–"}</td>
                    <td style={{ padding: "8px" }}><Pill color={meta.color} dot>{meta.label}</Pill></td>
                    <td style={{ padding: "8px 0 8px 8px", color: "var(--muted)", maxWidth: 320, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={run.detail ?? undefined}>{run.detail ?? ""}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}
