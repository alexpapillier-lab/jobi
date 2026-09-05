import { useEffect, useState } from "react";
import { Button, Pill } from "../../components/ui";
import { Card, FieldLabel, TextInput } from "../../lib/settingsUi";
import { SectionHeading } from "../../components/SectionHeading";
import { showToast } from "../../components/Toast";
import { useIsNarrow } from "../../hooks/useIsNarrow";
import {
  deleteIntegration,
  loadIntegration,
  saveIntegration,
  testIntegration,
  PROVIDER_FIELDS,
  PROVIDER_HELP,
  PROVIDER_LABELS,
  type IntegrationProvider,
  type IntegrationRow,
} from "../../lib/integrations";

const PROVIDERS: IntegrationProvider[] = ["idoklad", "fakturoid"];

/**
 * Nastavení → Firma → Fakturace a DPH → Propojení s fakturační aplikací.
 *
 * Vystavenou fakturu pošle jedním klikem do iDokladu nebo Fakturoidu i s
 * odběratelem a položkami. Přihlašovací údaje leží v `service_integrations`,
 * kam vidí jen majitel a správce; vlastní odeslání dělá edge funkce
 * `invoice-export`. Nové napojení = přidat pole do PROVIDER_FIELDS a větev
 * do té funkce.
 */
export function IntegrationsSettings({ activeServiceId }: { activeServiceId: string }) {
  const narrow = useIsNarrow();
  const [rows, setRows] = useState<Partial<Record<IntegrationProvider, IntegrationRow>>>({});
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<IntegrationProvider | null>(null);
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);

  const reload = async () => {
    setLoading(true);
    const nactene = await Promise.all(PROVIDERS.map((p) => loadIntegration(activeServiceId, p)));
    const map: Partial<Record<IntegrationProvider, IntegrationRow>> = {};
    PROVIDERS.forEach((p, i) => {
      const r = nactene[i];
      if (r) map[p] = r;
    });
    setRows(map);
    setLoading(false);
  };

  useEffect(() => { void reload(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [activeServiceId]);

  const otevrit = (p: IntegrationProvider) => {
    const cfg = (rows[p]?.config ?? {}) as Record<string, unknown>;
    const d: Record<string, string> = {};
    for (const f of PROVIDER_FIELDS[p]) {
      // Tajemství se nikdy nevrací zpátky do pole – prázdné = beze změny.
      d[f.key] = f.secret ? "" : typeof cfg[f.key] === "string" ? (cfg[f.key] as string) : "";
    }
    setDraft(d);
    setEditing(p);
  };

  const ulozit = async (p: IntegrationProvider) => {
    const puvodni = (rows[p]?.config ?? {}) as Record<string, unknown>;
    const chybi = PROVIDER_FIELDS[p].filter((f) => {
      if (!f.required) return false;
      const hodnota = (draft[f.key] ?? "").trim();
      if (hodnota) return false;
      // U tajemství stačí, že už uložené je.
      return !(f.secret && typeof puvodni[f.key] === "string" && puvodni[f.key]);
    });
    if (chybi.length > 0) {
      showToast(`Vyplňte ${chybi.map((f) => f.label).join(", ")}.`, "error");
      return;
    }
    setBusy(p);
    const config: Record<string, unknown> = { ...puvodni };
    for (const f of PROVIDER_FIELDS[p]) {
      const hodnota = (draft[f.key] ?? "").trim();
      if (hodnota) config[f.key] = hodnota;
      else if (!f.secret) delete config[f.key];
    }
    const res = await saveIntegration(activeServiceId, p, config, true);
    if (res.error) {
      setBusy(null);
      showToast(res.error, "error");
      return;
    }
    const test = await testIntegration(activeServiceId, p);
    setBusy(null);
    showToast(
      test.ok ? `${PROVIDER_LABELS[p]} připojen` : `Uloženo, ale připojení selhalo: ${test.error ?? "neznámá chyba"}`,
      test.ok ? "success" : "error",
    );
    setEditing(null);
    void reload();
  };

  const overit = async (p: IntegrationProvider) => {
    setBusy(p);
    const res = await testIntegration(activeServiceId, p);
    setBusy(null);
    showToast(res.ok ? `Připojení k ${PROVIDER_LABELS[p]} funguje` : `Připojení selhalo: ${res.error ?? "neznámá chyba"}`, res.ok ? "success" : "error");
    void reload();
  };

  const odpojit = async (p: IntegrationProvider) => {
    setBusy(p);
    const res = await deleteIntegration(activeServiceId, p);
    setBusy(null);
    if (res.error) showToast(res.error, "error");
    else {
      showToast(`Propojení s ${PROVIDER_LABELS[p]} zrušeno`, "success");
      setEditing(null);
      void reload();
    }
  };

  return (
    <Card>
      <SectionHeading size="sm">Propojení s fakturační aplikací</SectionHeading>
      <div style={{ color: "var(--muted)", fontSize: "var(--text-sm)", marginTop: "calc(-1 * var(--space-2))" }}>
        Vystavenou fakturu pošlete jedním klikem i s odběratelem a položkami. Jobi si pamatuje, které faktury už odešly,
        takže se doklad nezaloží dvakrát. Propojit můžete i obě služby, tlačítko se pak v detailu faktury ukáže u každé.
      </div>

      {loading && Object.keys(rows).length === 0 ? (
        <div style={{ color: "var(--muted)", fontSize: "var(--text-sm)", marginTop: 12 }}>Načítání…</div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 10, marginTop: 16 }}>
          {PROVIDERS.map((p) => {
            const row = rows[p];
            const pripojeno = !!row && row.active;
            const jeOtevreny = editing === p;
            return (
              <div key={p} style={{ border: "1px solid var(--border)", borderRadius: 10, background: "var(--panel-2)", padding: "10px 12px" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                  <span style={{ fontWeight: 700, color: "var(--text)", flex: 1, minWidth: 0 }}>{PROVIDER_LABELS[p]}</span>
                  {pripojeno && (
                    <Pill color={row?.last_error ? "var(--danger-text)" : "var(--success-text, #16a34a)"}>
                      {row?.last_error ? "Chyba připojení" : "Připojeno"}
                    </Pill>
                  )}
                  {pripojeno && !jeOtevreny && (
                    <>
                      <Button size="sm" variant="soft" onClick={() => void overit(p)} disabled={busy !== null}>Ověřit</Button>
                      <Button size="sm" variant="soft" onClick={() => otevrit(p)} disabled={busy !== null}>Změnit údaje</Button>
                      <Button size="sm" variant="ghost" onClick={() => void odpojit(p)} disabled={busy !== null} style={{ color: "var(--danger-text)" }}>Odpojit</Button>
                    </>
                  )}
                  {!pripojeno && !jeOtevreny && (
                    <Button size="sm" variant="primary" onClick={() => otevrit(p)} disabled={busy !== null}>Připojit</Button>
                  )}
                </div>

                {pripojeno && !jeOtevreny && row?.last_error && (
                  <div style={{ fontSize: "var(--text-sm)", color: "var(--danger-text)", marginTop: 6 }}>{row.last_error}</div>
                )}
                {pripojeno && !jeOtevreny && row?.last_ok_at && !row?.last_error && (
                  <div style={{ fontSize: "var(--text-xs)", color: "var(--muted)", marginTop: 4 }}>
                    Naposledy ověřeno {new Date(row.last_ok_at).toLocaleString("cs-CZ")}
                  </div>
                )}

                {jeOtevreny && (
                  <div style={{ marginTop: 12, display: "grid", gap: 12 }}>
                    <div style={{ fontSize: "var(--text-sm)", color: "var(--muted)" }}>{PROVIDER_HELP[p]}</div>
                    <div style={{ display: "grid", gridTemplateColumns: narrow ? "1fr" : "1fr 1fr", gap: 12 }}>
                      {PROVIDER_FIELDS[p].map((f) => (
                        <div key={f.key}>
                          <FieldLabel>{f.required ? `${f.label} *` : f.label}</FieldLabel>
                          <TextInput
                            type={f.secret ? "password" : "text"}
                            value={draft[f.key] ?? ""}
                            onChange={(e) => setDraft((d) => ({ ...d, [f.key]: e.target.value }))}
                            placeholder={f.secret && row ? "Beze změny" : f.placeholder}
                            autoComplete={f.secret ? "new-password" : "off"}
                            style={{ width: "100%" }}
                          />
                          {f.hint && <div style={{ fontSize: "var(--text-xs)", color: "var(--muted)", marginTop: 4 }}>{f.hint}</div>}
                        </div>
                      ))}
                    </div>
                    <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
                      <Button variant="soft" onClick={() => { setEditing(null); void reload(); }} disabled={busy !== null}>Zrušit</Button>
                      <Button variant="primary" onClick={() => void ulozit(p)} disabled={busy !== null}>
                        {busy === p ? "Ukládám a ověřuji…" : "Uložit a ověřit"}
                      </Button>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </Card>
  );
}
