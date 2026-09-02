import { useCallback, useEffect, useState } from "react";
import { supabase, supabaseUrl, supabaseAnonKey, supabaseFetch } from "../../lib/supabaseClient";
import { Card } from "../../lib/settingsUi";

/**
 * Přehled chyb ze všech servisů. Jen pro root ownera.
 *
 * Data jdou přes Edge Function error-logs-list – tabulka error_logs má RLS,
 * která čtení nikomu nepovoluje, takže se k ní nedá dostat přímo z klienta.
 */

type ErrorLogRow = {
  id: string;
  service_id: string | null;
  service_name: string | null;
  code: string;
  message: string;
  source: string | null;
  app_version: string | null;
  platform: string | null;
  created_at: string;
};

const PLATFORMS = [
  { value: "", label: "Vše" },
  { value: "macos", label: "macOS" },
  { value: "windows", label: "Windows" },
  { value: "web", label: "Web" },
];

const RANGES = [
  { value: 24, label: "24 hodin" },
  { value: 24 * 7, label: "7 dní" },
  { value: 24 * 30, label: "30 dní" },
];

function formatWhen(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleString("cs-CZ", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
}

export function ErrorLogsPanel() {
  const [logs, setLogs] = useState<ErrorLogRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [platform, setPlatform] = useState("");
  const [sinceHours, setSinceHours] = useState(24 * 7);

  const load = useCallback(async () => {
    const client = supabase;
    if (!client || !supabaseUrl || !supabaseAnonKey) {
      setError("Chybí konfigurace Supabase.");
      return;
    }
    setLoading(true);
    setError(null);
    try {
      // refreshSession: v desktopu getSession() často vrací prošlý token -> 401
      const { data: refreshed } = await client.auth.refreshSession();
      const token =
        refreshed?.session?.access_token ??
        (await client.auth.getSession()).data?.session?.access_token;
      if (!token) throw new Error("Nejste přihlášeni.");

      const res = await supabaseFetch(`${supabaseUrl}/functions/v1/error-logs-list`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
          apikey: supabaseAnonKey,
        },
        body: JSON.stringify({ platform: platform || undefined, sinceHours }),
      });
      const raw = await res.text();
      const data = raw ? JSON.parse(raw) : {};
      if (!res.ok) throw new Error(data?.error || `Chyba ${res.status}`);
      setLogs(Array.isArray(data.logs) ? data.logs : []);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [platform, sinceHours]);

  useEffect(() => {
    void load();
  }, [load]);

  // Kolikrát se který kód objevil – ať je hned vidět, co je nejčastější.
  const counts = logs.reduce<Record<string, number>>((acc, l) => {
    acc[l.code] = (acc[l.code] ?? 0) + 1;
    return acc;
  }, {});
  const topCodes = Object.entries(counts).sort((a, b) => b[1] - a[1]).slice(0, 5);

  const selectStyle = {
    padding: "7px 10px",
    borderRadius: 8,
    border: "1px solid var(--border)",
    background: "var(--panel)",
    color: "var(--text)",
    fontSize: 13,
  } as const;

  return (
    <Card>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: 12, marginBottom: 16 }}>
        <div>
          <div style={{ fontWeight: 950, fontSize: 14, marginBottom: 4, color: "var(--text)" }}>
            Chyby napříč servisy
          </div>
          <div style={{ fontSize: 13, color: "var(--muted)" }}>
            Co komu nefunguje. Hlášky jsou zbavené osobních údajů zákazníků, starší 30 dní se mažou.
          </div>
        </div>
        <button
          type="button"
          onClick={() => void load()}
          disabled={loading}
          style={{
            padding: "8px 16px", borderRadius: 10, border: "1px solid var(--border)",
            background: "var(--panel)", color: "var(--text)", fontWeight: 600, fontSize: 13,
            cursor: loading ? "default" : "pointer", opacity: loading ? 0.6 : 1,
          }}
        >
          {loading ? "Načítám…" : "Obnovit"}
        </button>
      </div>

      <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginBottom: 16 }}>
        <select value={platform} onChange={(e) => setPlatform(e.target.value)} style={selectStyle}>
          {PLATFORMS.map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}
        </select>
        <select value={sinceHours} onChange={(e) => setSinceHours(Number(e.target.value))} style={selectStyle}>
          {RANGES.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
        </select>
      </div>

      {error && (
        <div style={{ padding: 12, borderRadius: 10, background: "rgba(239,68,68,0.12)", color: "#ef4444", fontSize: 13, marginBottom: 14 }}>
          {error}
        </div>
      )}

      {topCodes.length > 0 && (
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 16 }}>
          {topCodes.map(([code, n]) => (
            <span key={code} style={{
              fontSize: 12, padding: "5px 10px", borderRadius: 999,
              background: "var(--accent-soft)", color: "var(--accent)", fontWeight: 600,
            }}>
              {code} · {n}×
            </span>
          ))}
        </div>
      )}

      {!loading && logs.length === 0 && !error && (
        <div style={{ fontSize: 13, color: "var(--muted)", padding: "18px 0" }}>
          Za zvolené období žádné chyby. To je dobrá zpráva.
        </div>
      )}

      {logs.length > 0 && (
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
            <thead>
              <tr style={{ textAlign: "left", color: "var(--muted)" }}>
                <th style={{ padding: "8px 10px", fontWeight: 600 }}>Kdy</th>
                <th style={{ padding: "8px 10px", fontWeight: 600 }}>Servis</th>
                <th style={{ padding: "8px 10px", fontWeight: 600 }}>Kód</th>
                <th style={{ padding: "8px 10px", fontWeight: 600 }}>Hláška</th>
                <th style={{ padding: "8px 10px", fontWeight: 600 }}>Kde</th>
                <th style={{ padding: "8px 10px", fontWeight: 600 }}>Verze</th>
              </tr>
            </thead>
            <tbody>
              {logs.map((l) => (
                <tr key={l.id} style={{ borderTop: "1px solid var(--border)" }}>
                  <td style={{ padding: "8px 10px", whiteSpace: "nowrap", color: "var(--muted)" }}>{formatWhen(l.created_at)}</td>
                  <td style={{ padding: "8px 10px" }}>{l.service_name ?? "—"}</td>
                  <td style={{ padding: "8px 10px", fontWeight: 600 }}>{l.code}</td>
                  <td style={{ padding: "8px 10px", maxWidth: 380, wordBreak: "break-word" }}>{l.message}</td>
                  <td style={{ padding: "8px 10px", color: "var(--muted)" }}>{l.source ?? "—"}</td>
                  <td style={{ padding: "8px 10px", whiteSpace: "nowrap", color: "var(--muted)" }}>
                    {[l.platform, l.app_version].filter(Boolean).join(" · ") || "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}
