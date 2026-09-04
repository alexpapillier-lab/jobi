import type { TicketViewer } from "../lib/presence";

/**
 * Bubliny „kdo tu je“: avatary kolegů, kteří mají otevřenou stejnou
 * zakázku. Překrývají se, max. tři, zbytek jako +N. Fotka když je, jinak
 * iniciála.
 */
export function PresenceAvatars({ viewers, size = 22 }: { viewers: TicketViewer[]; size?: number }) {
  if (viewers.length === 0) return null;
  const shown = viewers.slice(0, 3);
  const rest = viewers.length - shown.length;
  const overlap = Math.round(size * 0.35);
  return (
    <div
      title={`Právě tu je i: ${viewers.map((v) => v.nickname).join(", ")}`}
      aria-label={`Zakázku má otevřenou i ${viewers.map((v) => v.nickname).join(", ")}`}
      style={{ display: "inline-flex", alignItems: "center", flexShrink: 0 }}
    >
      {shown.map((v, i) => (
        <div
          key={v.userId}
          style={{
            width: size,
            height: size,
            borderRadius: "50%",
            background: v.avatarUrl ? "var(--panel-2)" : "linear-gradient(135deg, var(--accent), var(--accent-hover))",
            color: "white",
            display: "grid",
            placeItems: "center",
            fontSize: Math.max(9, Math.round(size * 0.45)),
            fontWeight: 800,
            border: "2px solid var(--panel)",
            marginLeft: i === 0 ? 0 : -overlap,
            overflow: "hidden",
            boxSizing: "content-box",
          }}
        >
          {v.avatarUrl ? (
            <img src={v.avatarUrl} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
          ) : (
            v.nickname.charAt(0).toUpperCase()
          )}
        </div>
      ))}
      {rest > 0 && (
        <div
          style={{
            width: size,
            height: size,
            borderRadius: "50%",
            background: "var(--panel-2)",
            color: "var(--text)",
            display: "grid",
            placeItems: "center",
            fontSize: Math.max(9, Math.round(size * 0.4)),
            fontWeight: 800,
            border: "2px solid var(--panel)",
            marginLeft: -overlap,
            boxSizing: "content-box",
          }}
        >
          +{rest}
        </div>
      )}
    </div>
  );
}
