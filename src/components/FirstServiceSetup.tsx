import { useState } from "react";
import { supabase, supabaseUrl, supabaseFetch } from "../lib/supabaseClient";
import { ThemeLogo } from "./ThemeLogo";
import { showToast } from "./Toast";

/**
 * Obrazovka po registraci, dokud člověk nemá žádný servis.
 *
 * Do teď mohl servis založit jen majitel aplikace, takže nový zákazník
 * skončil v prázdné aplikaci bez jediného tlačítka a musel čekat, až mu
 * někdo servis vytvoří ručně. Tady si ho založí sám a rovnou je jeho
 * majitelem. Servis se pak dá kdykoli přejmenovat v Nastavení.
 */
export function FirstServiceSetup({ email, onCreated, onSignOut }: {
  email: string | null;
  onCreated: (serviceId: string) => void;
  onSignOut: () => void;
}) {
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const create = async () => {
    const nazev = name.trim();
    if (!nazev) {
      setError("Zadejte název servisu.");
      return;
    }
    if (!supabase || !supabaseUrl) {
      setError("Aplikace není připojená ke cloudu.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const { data: sessionData } = await supabase.auth.getSession();
      const token = sessionData?.session?.access_token;
      const res = await supabaseFetch(`${supabaseUrl}/functions/v1/service-create`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        body: JSON.stringify({ name: nazev }),
      });
      const raw = await res.text();
      const data = raw ? JSON.parse(raw) : {};
      if (!res.ok || data?.error) throw new Error(data?.error || `Chyba ${res.status}`);
      showToast(`Servis „${nazev}“ je připravený`, "success");
      onCreated(data.service_id as string);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div style={{ position: "fixed", inset: 0, display: "grid", placeItems: "center", background: "var(--bg)", padding: 24, overflow: "auto" }}>
      <div style={{ width: "100%", maxWidth: 440, background: "var(--panel)", border: "1px solid var(--border)", borderRadius: 20, padding: 28, boxShadow: "var(--shadow-soft)" }}>
        <div style={{ display: "flex", justifyContent: "center", marginBottom: 18 }}>
          <ThemeLogo size={64} />
        </div>
        <h1 style={{ margin: 0, fontSize: 22, fontWeight: 900, color: "var(--text)", textAlign: "center" }}>Založte si servis</h1>
        <p style={{ margin: "10px 0 22px", fontSize: 14, lineHeight: 1.6, color: "var(--muted)", textAlign: "center" }}>
          Servis je vaše provozovna: zakázky, zákazníci, sklad i ceník patří k němu. Stačí název, zbytek doplníte později v Nastavení. Prvních 30 dní máte celou aplikaci bez omezení a bez karty, pak si vyberete tarif.
        </p>

        <label style={{ display: "block", fontSize: 12, fontWeight: 700, color: "var(--muted)", marginBottom: 6 }}>Název servisu</label>
        <input
          className="ui-input"
          value={name}
          onChange={(e) => { setName(e.target.value); setError(null); }}
          onKeyDown={(e) => { if (e.key === "Enter" && !busy) void create(); }}
          placeholder="např. Servis Novák"
          autoFocus
          maxLength={80}
          style={{ width: "100%", marginBottom: 6 }}
        />
        <div style={{ fontSize: 12, color: "var(--muted)", marginBottom: 16 }}>
          Uvidí ho zákazníci na dokumentech a v odkazu na stav zakázky. Změnit ho jde kdykoli.
        </div>

        {error && (
          <div style={{ padding: "10px 12px", borderRadius: 10, background: "var(--danger-soft)", color: "var(--danger-text)", fontSize: 13, marginBottom: 14 }}>
            {error}
          </div>
        )}

        <button
          type="button"
          onClick={() => void create()}
          disabled={busy}
          style={{ width: "100%", padding: "12px 16px", borderRadius: 12, border: "none", background: busy ? "var(--muted)" : "var(--accent)", color: "#fff", fontWeight: 800, fontSize: 15, cursor: busy ? "wait" : "pointer" }}
        >
          {busy ? "Zakládám…" : "Založit servis"}
        </button>

        <div style={{ marginTop: 18, paddingTop: 14, borderTop: "1px solid var(--border)", display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
          <span style={{ fontSize: 12, color: "var(--muted)", overflow: "hidden", textOverflow: "ellipsis" }}>
            Přihlášen{email ? ` jako ${email}` : ""}
          </span>
          <button type="button" onClick={onSignOut} style={{ background: "none", border: "none", color: "var(--muted)", fontSize: 12, textDecoration: "underline", cursor: "pointer", padding: 0 }}>
            Odhlásit se
          </button>
        </div>
        <div style={{ marginTop: 10, fontSize: 12, color: "var(--muted)", textAlign: "center" }}>
          Máte pozvánku do cizího servisu? Otevřete odkaz z e-mailu, servis se přidá sám.
        </div>
      </div>
    </div>
  );
}
