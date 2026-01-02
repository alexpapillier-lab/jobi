import { useEffect, useState } from "react";
import { supabase } from "../lib/supabaseClient";

type OnlineGateProps = {
  children: React.ReactNode;
};

/**
 * OnlineGate komponenta kontroluje dostupnost Supabase připojení.
 * Pokud není cloud dostupný, zobrazí chybovou zprávu místo aplikace.
 */
export function OnlineGate({ children }: OnlineGateProps) {
  const [isOnline, setIsOnline] = useState<boolean | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const checkConnection = async () => {
      // Check if Supabase client exists
      if (!supabase) {
        setError("Supabase není nakonfigurován. Zkontrolujte VITE_SUPABASE_URL a VITE_SUPABASE_ANON_KEY v .env souboru.");
        setIsOnline(false);
        return;
      }

      try {
        // Try to ping Supabase (simple query to check connectivity)
        const { error: pingError } = await supabase
          .from("services")
          .select("id")
          .limit(1);

        // If we get here, connection is available (even if query fails due to permissions)
        // We only care about network/connection errors
        if (pingError) {
          // Check if it's a network/connection error
          if (pingError.message.includes("fetch") || 
              pingError.message.includes("network") || 
              pingError.message.includes("Failed to fetch") ||
              pingError.code === "PGRST301") {
            setError("Nelze se připojit k cloudu. Zkontrolujte připojení k internetu.");
            setIsOnline(false);
            return;
          }
          // Other errors (like permissions) are fine - connection works
        }

        setIsOnline(true);
        setError(null);
      } catch (err) {
        console.error("[OnlineGate] Connection check error:", err);
        setError("Nelze se připojit k cloudu. Zkontrolujte připojení k internetu.");
        setIsOnline(false);
      }
    };

    checkConnection();

    // Re-check connection periodically (every 30 seconds)
    const interval = setInterval(checkConnection, 30000);

    return () => clearInterval(interval);
  }, []);

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
            {error || "Nelze se připojit k cloudu. Zkontrolujte připojení k internetu."}
          </p>
          <button
            onClick={() => window.location.reload()}
            style={{
              padding: "12px 24px",
              borderRadius: 12,
              border: "none",
              background: "var(--accent, #2563eb)",
              color: "white",
              fontSize: 14,
              fontWeight: 700,
              cursor: "pointer",
              fontFamily: "system-ui, -apple-system, sans-serif",
            }}
          >
            Zkusit znovu
          </button>
        </div>
      </div>
    );
  }

  // Connection is OK, render children
  return <>{children}</>;
}


