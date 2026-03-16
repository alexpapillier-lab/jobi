import React, { useEffect, useRef, useState } from "react";
import { isJobiDocsRunning, launchJobiDocsApp, openJobiDocsDownload } from "../lib/jobidocs";
import { checkAchievementOnJobiDocsConnected } from "../lib/achievements";
import { STORAGE_KEYS } from "../constants/storageKeys";

const POLL_INTERVAL_MS = 1000;

type JobiDocsStatusProps = {
  onFirstConnect?: () => void;
  /** V sidebaru (sbalený) – jen ikona + stav, bez textu */
  compact?: boolean;
};

export function JobiDocsStatus({ onFirstConnect, compact = false }: JobiDocsStatusProps = {}) {
  const [connected, setConnected] = useState<boolean | null>(null);
  const hasTriggeredFirstConnectGuide = useRef(false);

  const check = async () => {
    const ok = await isJobiDocsRunning();
    setConnected(ok);
  };

  useEffect(() => {
    check();
    const id = setInterval(check, POLL_INTERVAL_MS);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    if (connected !== true) return;
    try {
      (async () => {
        const { supabase } = await import("../lib/supabaseClient");
        if (!supabase) return;
        const { data } = await supabase.auth.getUser();
        const u = data?.user?.id;
        if (u) checkAchievementOnJobiDocsConnected(u);
      })();
      if (localStorage.getItem(STORAGE_KEYS.JOBIDOCS_FIRST_CONNECT_GUIDE_SEEN)) return;
      if (hasTriggeredFirstConnectGuide.current) return;
      hasTriggeredFirstConnectGuide.current = true;
      onFirstConnect?.();
    } catch {
      // ignore
    }
  }, [connected, onFirstConnect]);

  useEffect(() => {
    const onFocus = () => check();
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, []);

  const handleClick = async () => {
    if (connected === true) return;
    const launched = await launchJobiDocsApp();
    if (launched) {
      check();
    } else {
      await openJobiDocsDownload();
    }
  };

  const title =
    connected === true
      ? "JobiDocs připojen – tisk, export PDF a úprava šablon dokumentů"
      : connected === false
        ? "JobiDocs nepřipojen – kliknutím spustíte nebo stáhnete JobiDocs (potřeba pro tisk a úpravu šablon)"
        : "Kontroluji připojení k JobiDocs…";

  const baseStyle: React.CSSProperties = {
    display: "flex",
    alignItems: "center",
    gap: 6,
    padding: compact ? "14px 4px" : "4px 10px",
    borderRadius: compact ? 16 : 8,
    fontSize: 12,
    fontWeight: 600,
    background: connected === true ? "rgba(34,197,94,0.15)" : connected === false ? "rgba(156,163,175,0.2)" : "rgba(251,191,36,0.15)",
    color: connected === true ? "var(--success, #16a34a)" : connected === false ? "var(--muted, #6b7280)" : "var(--warning, #ca8a04)",
    border: `1px solid ${connected === true ? "rgba(34,197,94,0.3)" : connected === false ? "rgba(156,163,175,0.3)" : "rgba(251,191,36,0.3)"}`,
    cursor: connected === true ? "default" : "pointer",
    width: "100%",
    minWidth: 0,
    justifyContent: compact ? "center" : "flex-start",
    boxSizing: "border-box",
    overflow: "hidden",
  };

  return (
    <button
      type="button"
      data-tour="header-jobidocs"
      title={title}
      onClick={handleClick}
      style={baseStyle}
    >
      <img
        src="/logos/jdlogo.png"
        alt=""
        style={{
          width: 18,
          height: 18,
          minWidth: 18,
          minHeight: 18,
          objectFit: "contain",
          flexShrink: 0,
          display: "block",
        }}
      />
      {!compact && <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>JobiDocs {connected === true ? "✓" : connected === false ? "✗" : "..."}</span>}
    </button>
  );
}
