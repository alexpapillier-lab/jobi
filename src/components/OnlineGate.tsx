import { useEffect, useState, useCallback, useRef } from "react";
import { supabaseUrl, supabaseAnonKey, supabaseFetch, resetTauriFetchState } from "../lib/supabaseClient";
import { showToast } from "./Toast";

type OnlineGateProps = {
  children: React.ReactNode;
};

/** Vrátí uživatelsky srozumitelnou chybovou zprávu podle typu chyby */
function getConnectionErrorMessage(err: unknown): string {
  const msg = err instanceof Error ? err.message : String(err);
  const lower = msg.toLowerCase();

  // Supabase projekt obnovuje / maintenance (503, 502, service unavailable)
  if (
    lower.includes("503") ||
    lower.includes("502") ||
    lower.includes("service unavailable") ||
    lower.includes("bad gateway") ||
    lower.includes("maintenance") ||
    lower.includes("restoring") ||
    lower.includes("dočasně nedostupn")
  ) {
    return "Cloud je dočasně nedostupný (pravděpodobně probíhá obnova projektu). Zkuste to za několik minut.";
  }

  // Timeout kontrolního dotazu (zejména v Tauri při zavěšení)
  if (lower.includes("timeout")) {
    return "Kontrola připojení trvá příliš dlouho. Zkuste to znovu (tlačítko níže).";
  }

  // Síťové chyby (offline, connection refused)
  if (
    lower.includes("fetch") ||
    lower.includes("network") ||
    lower.includes("failed to fetch") ||
    lower.includes("load failed") ||
    lower.includes("connection") ||
    lower.includes("err_connection") ||
    lower.includes("pgrst301")
  ) {
    return "Nelze se připojit k cloudu. Zkontrolujte připojení k internetu a zkuste to znovu.";
  }

  return "Cloud je nedostupný. Zkuste to za chvíli nebo zkontrolujte připojení k internetu.";
}

/**
 * OnlineGate komponenta kontroluje dostupnost Supabase připojení.
 * Pokud není cloud dostupný, zobrazí chybovou zprávu místo aplikace.
 */
export function OnlineGate({ children }: OnlineGateProps) {
  const [isOnline, setIsOnline] = useState<boolean | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isChecking, setIsChecking] = useState(false);
  const wasOnlineRef = useRef<boolean | null>(null);

  const CONNECTION_TIMEOUT_MS = 45_000;
  const MAX_RETRIES = 2;

  const checkConnection = useCallback(async () => {
    if (!supabaseUrl || !supabaseAnonKey) {
      setError("Supabase není nakonfigurován. Zkontrolujte VITE_SUPABASE_URL a VITE_SUPABASE_ANON_KEY v .env souboru.");
      setIsOnline(false);
      return;
    }

    try {
      for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
        try {
          // auth/health je lehký endpoint (ne-probouzí DB), vhodnější než services pro connectivity check
          const res = await Promise.race([
            supabaseFetch(`${supabaseUrl}/auth/v1/health`, {
              headers: { apikey: supabaseAnonKey },
            }),
            new Promise<never>((_, reject) =>
              setTimeout(() => reject(new Error("timeout")), CONNECTION_TIMEOUT_MS)
            ),
          ]);

          if (res.ok) {
            wasOnlineRef.current = true;
            setIsOnline(true);
            setError(null);
            return;
          }
          const err = new Error(`HTTP ${res.status}`);
          setError(getConnectionErrorMessage(err));
          if (wasOnlineRef.current === true) showToast("Připojení k cloudu ztraceno", "error");
          setIsOnline(false);
          return;
        } catch (err) {
          console.warn(`[OnlineGate] Connection check attempt ${attempt}/${MAX_RETRIES} failed:`, err);
          if (attempt === MAX_RETRIES) {
            setError(getConnectionErrorMessage(err));
            if (wasOnlineRef.current === true) showToast("Připojení k cloudu ztraceno", "error");
            setIsOnline(false);
          }
          if (attempt < MAX_RETRIES) {
            resetTauriFetchState();
            await new Promise((r) => setTimeout(r, 2000));
          }
        }
      }
    } finally {
      setIsChecking(false);
    }
  }, []);

  useEffect(() => {
    wasOnlineRef.current = isOnline;
  }, [isOnline]);

  useEffect(() => {
    setIsChecking(true);
    checkConnection();
    const interval = setInterval(() => {
      checkConnection();
    }, 30000);
    return () => clearInterval(interval);
  }, [checkConnection]);

  // Show loading state while checking
  if (isOnline === null) {
    return (
      <div
        style={{
          position: "fixed",
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "var(--bg, #f5f5f5)",
          color: "var(--text, #333)",
        }}
      >
        <div style={{ textAlign: "center" }}>
          <div style={{ fontSize: 16, marginBottom: 12 }}>Kontrola připojení k cloudu...</div>
        </div>
      </div>
    );
  }

  // Show error if offline
  if (!isOnline) {
    return (
      <div
        style={{
          position: "fixed",
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "var(--bg, #f5f5f5)",
          padding: 24,
        }}
      >
        <div
          style={{
            maxWidth: 500,
            width: "100%",
            background: "var(--panel, white)",
            borderRadius: 20,
            padding: 32,
            boxShadow: "0 20px 60px rgba(0,0,0,0.15)",
            border: "1px solid var(--border, #e5e5e5)",
            textAlign: "center",
          }}
        >
          <div
            style={{
              width: 64,
              height: 64,
              margin: "0 auto 24px",
              borderRadius: "50%",
              background: "rgba(239,68,68,0.1)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <svg
              width="32"
              height="32"
              viewBox="0 0 24 24"
              fill="none"
              stroke="rgba(239,68,68,0.9)"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <circle cx="12" cy="12" r="10" />
              <line x1="12" y1="8" x2="12" y2="12" />
              <line x1="12" y1="16" x2="12.01" y2="16" />
            </svg>
          </div>
          <h2
            style={{
              fontSize: 24,
              fontWeight: 900,
              color: "var(--text, #333)",
              margin: "0 0 12px 0",
            }}
          >
            Cloud není dostupný
          </h2>
          <p
            style={{
              fontSize: 15,
              color: "var(--muted, #666)",
              margin: "0 0 24px 0",
              lineHeight: 1.6,
            }}
          >
            {error || "Cloud je nedostupný. Zkuste to za chvíli nebo zkontrolujte připojení k internetu."}
          </p>
          <button
            onClick={() => {
              if (isChecking) return;
              resetTauriFetchState(); // reset Tauri HTTP stav před opětovným pokusem
              setIsChecking(true);
              checkConnection();
            }}
            disabled={isChecking}
            style={{
              padding: "12px 24px",
              borderRadius: 12,
              border: "none",
              background: isChecking ? "var(--muted, #999)" : "var(--accent, #2563eb)",
              color: "white",
              fontSize: 14,
              fontWeight: 700,
              cursor: isChecking ? "wait" : "pointer",
              fontFamily: "system-ui, -apple-system, sans-serif",
            }}
          >
            {isChecking ? "Kontroluji připojení…" : "Zkusit znovu"}
          </button>
          <p style={{ marginTop: 12, fontSize: 12, color: "var(--muted)" }}>
            Připojení se kontroluje každých 30 s. Při obnovení se aplikace znovu načte automaticky.
          </p>
        </div>
      </div>
    );
  }

  // Connection is OK, render children
  return <>{children}</>;
}


