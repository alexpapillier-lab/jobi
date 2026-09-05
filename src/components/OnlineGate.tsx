import { useEffect, useState, useCallback, useRef } from "react";
import { supabase, supabaseUrl, supabaseAnonKey, supabaseFetch, resetTauriFetchState, msSinceSupabaseResponse } from "../lib/supabaseClient";

type OnlineGateProps = {
  children: React.ReactNode;
};

/** Vrátí uživatelsky srozumitelnou chybovou zprávu podle typu chyby */
function getConnectionErrorMessage(err: unknown): string {
  const msg = err instanceof Error ? err.message : String(err);
  const lower = msg.toLowerCase();

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
  if (lower.includes("timeout")) {
    return "Kontrola připojení trvá příliš dlouho. Zkuste to znovu (tlačítko níže).";
  }
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

/** Drží se realtime spojení? Pak je Supabase dosažitelné, ať kontrola dopadne jakkoli. */
function realtimeConnected(): boolean {
  try {
    const rt = (supabase as unknown as { realtime?: { isConnected?: () => boolean } } | null)?.realtime;
    return rt?.isConnected?.() === true;
  } catch {
    return false;
  }
}

/**
 * OnlineGate hlídá dostupnost Supabase.
 *
 * Blokuje jen první start: dokud se cloud aspoň jednou neozve, aplikace se
 * nevykreslí. Jakmile byla aplikace online, při výpadku už se NEODMONTUJE –
 * ukáže se jen tenký proužek nahoře a kontrola běží dál. Dřív každý
 * neúspěšný kontrolní dotaz (uspané připojení, zaseknutý HTTP klient v
 * Tauri, chvilkový výpadek) shodil celou aplikaci na obrazovku „Cloud není
 * dostupný“ a zpátky pomohl často jen restart – přitom vlastní dotazy do
 * databáze mezitím dál fungovaly.
 */
export function OnlineGate({ children }: OnlineGateProps) {
  const [isOnline, setIsOnline] = useState<boolean | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isChecking, setIsChecking] = useState(false);
  /** Aplikace už jednou běžela online – výpadek řešit proužkem, ne odmontováním. */
  const everOnlineRef = useRef(false);
  const failStreakRef = useRef(0);

  const CONNECTION_TIMEOUT_MS = 20_000;
  const MAX_RETRIES = 2;
  /** Kolik kontrol po sobě musí selhat, než se proužek ukáže (jedna chybějící odpověď není výpadek). */
  const BANNER_AFTER_FAILS = 3;
  /** Když Supabase odpověděl na běžný dotaz aplikace v posledních 90 s, je online – ping se vůbec nepouští. */
  const RECENT_TRAFFIC_MS = 90_000;

  const checkConnection = useCallback(async () => {
    if (!supabaseUrl || !supabaseAnonKey) {
      setError("Supabase není nakonfigurován. Zkontrolujte VITE_SUPABASE_URL a VITE_SUPABASE_ANON_KEY v .env souboru.");
      setIsOnline(false);
      setIsChecking(false);
      return;
    }
    // Aplikace právě normálně komunikuje – kontrolní ping je zbytečný a jen
    // vyrábí falešné poplachy, když se v Tauri zasekne jedno spojení.
    if (msSinceSupabaseResponse() < RECENT_TRAFFIC_MS) {
      everOnlineRef.current = true;
      failStreakRef.current = 0;
      setIsOnline(true);
      setError(null);
      setIsChecking(false);
      return;
    }

    // Prohlížeč / systém hlásí offline – nemá smysl čekat na timeout.
    if (typeof navigator !== "undefined" && navigator.onLine === false) {
      failStreakRef.current += 1;
      if (!everOnlineRef.current || failStreakRef.current >= BANNER_AFTER_FAILS) {
        setError("Zařízení je offline. Zkontrolujte připojení k internetu.");
        setIsOnline(false);
      }
      setIsChecking(false);
      return;
    }

    try {
      for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
        try {
          // auth/health je lehký endpoint (neprobouzí DB), vhodnější než services pro connectivity check
          const res = await Promise.race([
            supabaseFetch(`${supabaseUrl}/auth/v1/health`, {
              headers: { apikey: supabaseAnonKey },
            }),
            new Promise<never>((_, reject) =>
              setTimeout(() => reject(new Error("timeout")), CONNECTION_TIMEOUT_MS)
            ),
          ]);

          // Jakákoli odpověď znamená, že cloud odpověděl. Kontrolní endpoint
          // umí vrátit 401 (klíč, rate limit) nebo 429, aniž by to o dostupnosti
          // dat cokoli říkalo – hlásit kvůli tomu výpadek byl planý poplach.
          // Skutečný výpadek pozná jen 5xx (projekt se obnovuje) nebo to, že
          // spojení vůbec nevznikne.
          if (res.status < 500) {
            if (!res.ok) console.warn(`[OnlineGate] health vrátil HTTP ${res.status} – server ale odpovídá, beru jako online`);
            everOnlineRef.current = true;
            failStreakRef.current = 0;
            setIsOnline(true);
            setError(null);
            return;
          }
          throw new Error(`HTTP ${res.status}`);
        } catch (err) {
          console.warn(`[OnlineGate] Connection check attempt ${attempt}/${MAX_RETRIES} failed:`, err);
          if (attempt < MAX_RETRIES) {
            // V Tauri se HTTP klient umí zaseknout – před opakováním ho resetovat.
            resetTauriFetchState();
            await new Promise((r) => setTimeout(r, 1500));
            continue;
          }
          failStreakRef.current += 1;
          // Živé realtime spojení je důkaz, že se k Supabase dostaneme –
          // v desktopu se umí zaseknout HTTP klient, zatímco WebSocket běží dál.
          if (realtimeConnected()) {
            console.warn("[OnlineGate] kontrola selhala, ale realtime spojení běží – neohlašuji výpadek");
            everOnlineRef.current = true;
            failStreakRef.current = 0;
            setIsOnline(true);
            setError(null);
            return;
          }
          // Poslední kontrola: mezitím mohl projít běžný dotaz aplikace.
          if (msSinceSupabaseResponse() < RECENT_TRAFFIC_MS) {
            everOnlineRef.current = true;
            failStreakRef.current = 0;
            setIsOnline(true);
            setError(null);
            return;
          }
          if (!everOnlineRef.current || failStreakRef.current >= BANNER_AFTER_FAILS) {
            setError(getConnectionErrorMessage(err));
            setIsOnline(false);
          }
        }
      }
    } finally {
      setIsChecking(false);
    }
  }, []);

  useEffect(() => {
    setIsChecking(true);
    checkConnection();
    // Kontrola jen když je okno vidět – na pozadí se spojení uspává a
    // probuzený ping selže, i když je všechno v pořádku.
    const interval = setInterval(() => {
      if (typeof document !== "undefined" && document.visibilityState !== "visible") return;
      checkConnection();
    }, 60000);
    // Návrat online / probuzení okna: nečekat na další tik.
    const onOnline = () => { resetTauriFetchState(); checkConnection(); };
    const onVisible = () => { if (document.visibilityState === "visible") checkConnection(); };
    window.addEventListener("online", onOnline);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      clearInterval(interval);
      window.removeEventListener("online", onOnline);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [checkConnection]);

  const retry = () => {
    if (isChecking) return;
    resetTauriFetchState();
    setIsChecking(true);
    checkConnection();
  };

  // První start: čekat na cloud.
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

  // Aplikace už běžela: výpadek jen ohlásit proužkem, obsah nechat.
  if (!isOnline && everOnlineRef.current) {
    return (
      <>
        <div
          role="alert"
          style={{
            position: "fixed",
            top: 0,
            left: 0,
            right: 0,
            zIndex: 20000,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            gap: 12,
            padding: "8px 16px",
            background: "rgba(239,68,68,0.95)",
            color: "#fff",
            fontSize: 13,
            fontWeight: 600,
            fontFamily: "system-ui, -apple-system, sans-serif",
            boxShadow: "0 2px 8px rgba(0,0,0,0.2)",
          }}
        >
          <span>Připojení k cloudu se nedaří. {error ?? ""} Rozdělaná práce zůstane, ale změny se nemusí uložit.</span>
          <button
            type="button"
            onClick={retry}
            disabled={isChecking}
            style={{
              padding: "4px 12px",
              borderRadius: 8,
              border: "1px solid rgba(255,255,255,0.7)",
              background: "transparent",
              color: "#fff",
              fontSize: 12,
              fontWeight: 700,
              cursor: isChecking ? "wait" : "pointer",
            }}
          >
            {isChecking ? "Kontroluji…" : "Zkusit znovu"}
          </button>
        </div>
        {children}
      </>
    );
  }

  // Cloud nebyl dostupný ani jednou od startu.
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
            <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="rgba(239,68,68,0.9)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="10" />
              <line x1="12" y1="8" x2="12" y2="12" />
              <line x1="12" y1="16" x2="12.01" y2="16" />
            </svg>
          </div>
          <h2 style={{ fontSize: 24, fontWeight: 900, color: "var(--text, #333)", margin: "0 0 12px 0" }}>Cloud není dostupný</h2>
          <p style={{ fontSize: 15, color: "var(--muted, #666)", margin: "0 0 24px 0", lineHeight: 1.6 }}>
            {error || "Cloud je nedostupný. Zkuste to za chvíli nebo zkontrolujte připojení k internetu."}
          </p>
          <button
            onClick={retry}
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
            Připojení se kontroluje každých 30 s. Při obnovení se aplikace načte automaticky.
          </p>
        </div>
      </div>
    );
  }

  return <>{children}</>;
}
