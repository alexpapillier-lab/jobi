import { useEffect, useState } from "react";
import { isJobiDocsRunning } from "../lib/jobidocs";

const POLL_INTERVAL_MS = 1000;

export function JobiDocsStatus() {
  const [connected, setConnected] = useState<boolean | null>(null);

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
    const onFocus = () => check();
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, []);

  return (
    <div
      title={
        connected === true
          ? "JobiDocs připojen – tisk a export PDF přes JobiDocs"
          : connected === false
            ? "JobiDocs není připojen – spusťte JobiDocs pro tisk/export PDF"
            : "Kontroluji připojení k JobiDocs..."
      }
      style={{
        display: "flex",
        alignItems: "center",
        gap: 6,
        padding: "4px 10px",
        borderRadius: 8,
        fontSize: 12,
        fontWeight: 600,
        background: connected === true ? "rgba(34,197,94,0.15)" : connected === false ? "rgba(156,163,175,0.2)" : "rgba(251,191,36,0.15)",
        color: connected === true ? "var(--success, #16a34a)" : connected === false ? "var(--muted, #6b7280)" : "var(--warning, #ca8a04)",
        border: `1px solid ${connected === true ? "rgba(34,197,94,0.3)" : connected === false ? "rgba(156,163,175,0.3)" : "rgba(251,191,36,0.3)"}`,
      }}
    >
      <span style={{ width: 8, height: 8, borderRadius: "50%", background: "currentColor" }} />
      JobiDocs {connected === true ? "✓" : connected === false ? "✗" : "..."}
    </div>
  );
}
