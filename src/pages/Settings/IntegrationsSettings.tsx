import { useEffect, useState } from "react";
import { Button, Pill } from "../../components/ui";
import { Card, FieldLabel, TextInput } from "../../lib/settingsUi";
import { SectionHeading } from "../../components/SectionHeading";
import { showToast } from "../../components/Toast";
import { useIsNarrow } from "../../hooks/useIsNarrow";
import { deleteIntegration, loadIntegration, saveIntegration, testIntegration, type IntegrationRow } from "../../lib/integrations";

/**
 * Nastavení → Fakturace a DPH → Propojení s fakturační aplikací.
 *
 * iDoklad: Client ID a Client Secret z iDokladu (Nastavení → API →
 * Přidat aplikaci, typ Client Credentials). Tajemství se po uložení
 * neukazuje, jen stav „nastaveno“. Export dělá edge funkce `invoice-export`.
 */
export function IntegrationsSettings({ activeServiceId }: { activeServiceId: string }) {
  const narrow = useIsNarrow();
  const [row, setRow] = useState<IntegrationRow | null>(null);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(false);
  const [clientId, setClientId] = useState("");
  const [clientSecret, setClientSecret] = useState("");
  const [busy, setBusy] = useState<"save" | "test" | "delete" | null>(null);

  const reload = async () => {
    setLoading(true);
    const r = await loadIntegration(activeServiceId, "idoklad");
    setRow(r);
    setClientId(typeof r?.config?.client_id === "string" ? (r!.config.client_id as string) : "");
    setClientSecret("");
    setLoading(false);
  };

  useEffect(() => { void reload(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [activeServiceId]);

  const save = async () => {
    if (!clientId.trim() || (!clientSecret.trim() && !row)) {
      showToast("Vyplňte Client ID i Client Secret z iDokladu.", "error");
      return;
    }
    setBusy("save");
    const config: Record<string, unknown> = { ...(row?.config ?? {}), client_id: clientId.trim() };
    if (clientSecret.trim()) config.client_secret = clientSecret.trim();
    const res = await saveIntegration(activeServiceId, "idoklad", config, true);
    if (res.error) {
      showToast(res.error, "error");
      setBusy(null);
      return;
    }
    const test = await testIntegration(activeServiceId, "idoklad");
    setBusy(null);
    if (!test.ok) {
      showToast(`Uloženo, ale připojení selhalo: ${test.error ?? "neznámá chyba"}`, "error");
    } else {
      showToast("iDoklad připojen", "success");
    }
    setEditing(false);
    void reload();
  };

  const test = async () => {
    setBusy("test");
    const res = await testIntegration(activeServiceId, "idoklad");
    setBusy(null);
    showToast(res.ok ? "Připojení k iDokladu funguje" : `Připojení selhalo: ${res.error ?? "neznámá chyba"}`, res.ok ? "success" : "error");
    void reload();
  };

  const remove = async () => {
    setBusy("delete");
    const res = await deleteIntegration(activeServiceId, "idoklad");
    setBusy(null);
    if (res.error) showToast(res.error, "error");
    else {
      showToast("Propojení s iDokladem zrušeno", "success");
      setEditing(false);
      void reload();
    }
  };

  const connected = !!row && row.active;

  return (
    <Card>
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
        <div style={{ minWidth: 0 }}>
          <SectionHeading size="sm">Propojení s fakturační aplikací</SectionHeading>
          <div style={{ color: "var(--muted)", fontSize: "var(--text-sm)", marginTop: "calc(-1 * var(--space-2))" }}>
            Vystavenou fakturu pošlete jedním klikem do iDokladu i s odběratelem a položkami. Jobi si pamatuje, které faktury už odešly.
            Fakturoid a Pohoda přibudou stejným způsobem.
          </div>
        </div>
        {connected && !editing && (
          <Pill color={row?.last_error ? "var(--danger-text)" : "var(--success-text, #16a34a)"}>
            {row?.last_error ? "Chyba připojení" : "iDoklad připojen"}
          </Pill>
        )}
      </div>

      {loading ? (
        <div style={{ color: "var(--muted)", fontSize: "var(--text-sm)", marginTop: 12 }}>Načítání…</div>
      ) : connected && !editing ? (
        <div style={{ marginTop: 14, display: "grid", gap: 8 }}>
          <div style={{ fontSize: "var(--text-sm)", color: "var(--text)" }}>
            <b>iDoklad</b> · Client ID <code style={{ fontSize: "var(--text-xs)" }}>{clientId}</code>
            {row?.last_ok_at && <span style={{ color: "var(--muted)" }}> · naposledy ověřeno {new Date(row.last_ok_at).toLocaleString("cs-CZ")}</span>}
          </div>
          {row?.last_error && <div style={{ fontSize: "var(--text-sm)", color: "var(--danger-text)" }}>{row.last_error}</div>}
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <Button size="sm" variant="soft" onClick={test} disabled={busy !== null}>{busy === "test" ? "Ověřuji…" : "Ověřit připojení"}</Button>
            <Button size="sm" variant="soft" onClick={() => setEditing(true)} disabled={busy !== null}>Změnit údaje</Button>
            <Button size="sm" variant="ghost" onClick={remove} disabled={busy !== null} style={{ color: "var(--danger-text)" }}>Odpojit</Button>
          </div>
        </div>
      ) : (
        <div style={{ marginTop: 14, display: "grid", gap: 12 }}>
          <div style={{ fontSize: "var(--text-sm)", color: "var(--muted)" }}>
            V iDokladu otevřete <b>Nastavení → API → Přidat aplikaci</b>, zvolte typ <b>Client Credentials</b> a zkopírujte Client ID a Client Secret.
          </div>
          <div style={{ display: "grid", gridTemplateColumns: narrow ? "1fr" : "1fr 1fr", gap: 12 }}>
            <div>
              <FieldLabel>Client ID</FieldLabel>
              <TextInput value={clientId} onChange={(e) => setClientId(e.target.value)} placeholder="např. 1a2b3c4d-…" style={{ width: "100%" }} autoComplete="off" />
            </div>
            <div>
              <FieldLabel>Client Secret</FieldLabel>
              <TextInput type="password" value={clientSecret} onChange={(e) => setClientSecret(e.target.value)} placeholder={row ? "Beze změny" : "…"} style={{ width: "100%" }} autoComplete="new-password" />
            </div>
          </div>
          <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
            {row && <Button variant="soft" onClick={() => { setEditing(false); void reload(); }} disabled={busy !== null}>Zrušit</Button>}
            <Button variant="primary" onClick={save} disabled={busy !== null}>{busy === "save" ? "Ukládám a ověřuji…" : "Uložit a ověřit"}</Button>
          </div>
        </div>
      )}
    </Card>
  );
}
