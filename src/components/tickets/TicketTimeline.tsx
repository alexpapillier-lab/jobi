import { useMemo } from "react";
import { type TicketCardData, computeFinalPrice } from "./types";
import { DeviceIcon, WrenchIcon } from "./icons";

type Props = {
  tickets: TicketCardData[];
  getByKey: (k: string) => { bg?: string; label?: string; isFinal?: boolean } | undefined;
  normalizeStatus: (raw: any) => string | null;
  onClickDetail: (id: string) => void;
  smsUnreadByTicketId?: Record<string, number>;
};

const smsBadge = (n: number) =>
  n > 0 ? (
    <span style={{ marginLeft: 6, minWidth: 18, height: 18, borderRadius: 9, background: "#FF3B30", color: "#fff", fontSize: 10, fontWeight: 700, display: "inline-flex", alignItems: "center", justifyContent: "center", padding: "0 5px" }}>
      {n > 99 ? "99+" : n}
    </span>
  ) : null;

function groupByDay(tickets: TicketCardData[]): { date: string; label: string; tickets: TicketCardData[] }[] {
  const map = new Map<string, TicketCardData[]>();
  for (const t of tickets) {
    const d = new Date(t.createdAt);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    if (!map.has(key)) map.set(key, []);
    map.get(key)!.push(t);
  }
  const today = new Date();
  const todayKey = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);
  const yesterdayKey = `${yesterday.getFullYear()}-${String(yesterday.getMonth() + 1).padStart(2, "0")}-${String(yesterday.getDate()).padStart(2, "0")}`;

  return Array.from(map.entries())
    .sort((a, b) => b[0].localeCompare(a[0]))
    .map(([key, tix]) => {
      let label: string;
      if (key === todayKey) label = "Dnes";
      else if (key === yesterdayKey) label = "Včera";
      else {
        const d = new Date(key);
        const dayNames = ["Ne", "Po", "Út", "St", "Čt", "Pá", "So"];
        label = `${dayNames[d.getDay()]} ${d.getDate()}.${d.getMonth() + 1}.${d.getFullYear()}`;
      }
      return { date: key, label, tickets: tix };
    });
}

export function TicketTimeline({ tickets, getByKey, normalizeStatus, onClickDetail, smsUnreadByTicketId = {} }: Props) {
  const groups = useMemo(() => groupByDay(tickets), [tickets]);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 0, position: "relative", paddingLeft: 32 }}>
      {/* Vertical line */}
      <div style={{ position: "absolute", left: 11, top: 0, bottom: 0, width: 2, background: "var(--border)", borderRadius: 1 }} />

      {groups.map((group, gi) => (
        <div key={group.date} style={{ marginBottom: gi < groups.length - 1 ? 24 : 0 }}>
          {/* Day label */}
          <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 12, position: "relative" }}>
            <div
              style={{
                position: "absolute",
                left: -32 + 11 - 6,
                width: 14,
                height: 14,
                borderRadius: 7,
                background: gi === 0 ? "var(--accent)" : "var(--panel-2)",
                border: gi === 0 ? "2px solid var(--accent)" : "2px solid var(--border)",
                boxShadow: gi === 0 ? "0 0 8px var(--accent-glow)" : "none",
              }}
            />
            <span style={{ fontWeight: 800, fontSize: 14, color: gi === 0 ? "var(--accent)" : "var(--text)", letterSpacing: "-0.01em" }}>
              {group.label}
            </span>
            <span style={{ fontSize: 11, color: "var(--muted)" }}>
              {group.tickets.length} {group.tickets.length === 1 ? "zakázka" : group.tickets.length < 5 ? "zakázky" : "zakázek"}
            </span>
          </div>

          {/* Tickets */}
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {group.tickets.map((t) => {
              const st = normalizeStatus(t.status);
              const meta = st !== null ? getByKey(st) : undefined;
              const statusColor = meta?.bg || "var(--muted)";
              const finalPrice = computeFinalPrice(t);

              return (
                <div
                  key={t.id}
                  onClick={() => onClickDetail(t.id)}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 12,
                    padding: "10px 14px",
                    borderRadius: 10,
                    border: `1px solid ${statusColor}20`,
                    background: "var(--panel)",
                    cursor: "pointer",
                    transition: "transform 0.12s ease, box-shadow 0.12s ease",
                    position: "relative",
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.transform = "translateX(4px)";
                    e.currentTarget.style.boxShadow = "0 3px 10px rgba(0,0,0,0.06)";
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.transform = "translateX(0)";
                    e.currentTarget.style.boxShadow = "none";
                  }}
                >
                  {/* Connector dot */}
                  <div
                    style={{
                      position: "absolute",
                      left: -32 + 11 - 3 - 1,
                      width: 8,
                      height: 8,
                      borderRadius: 4,
                      background: statusColor,
                      border: "2px solid var(--panel)",
                      boxShadow: `0 0 4px ${statusColor}50`,
                    }}
                  />

                  {/* Status dot */}
                  <div style={{ width: 6, height: 6, borderRadius: 3, background: statusColor, flexShrink: 0, boxShadow: `0 0 4px ${statusColor}60` }} />

                  <span style={{ fontWeight: 800, fontSize: 12, color: "var(--text)", whiteSpace: "nowrap", flexShrink: 0, display: "inline-flex", alignItems: "center" }}>{t.code}{smsBadge(smsUnreadByTicketId[t.id] ?? 0)}</span>

                  <div style={{ display: "flex", alignItems: "center", gap: 5, flex: 1, minWidth: 0, overflow: "hidden" }}>
                    <DeviceIcon size={13} color={statusColor} />
                    <span style={{ fontWeight: 600, fontSize: 12, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{t.deviceLabel || "—"}</span>
                  </div>

                  <span style={{ fontSize: 11, color: "var(--muted)", whiteSpace: "nowrap", flexShrink: 0, maxWidth: 120, overflow: "hidden", textOverflow: "ellipsis" }}>{t.customerName}</span>

                  {(t.requestedRepair || t.issueShort) && (
                    <div style={{ display: "flex", alignItems: "center", gap: 4, flex: 1, minWidth: 0, overflow: "hidden" }}>
                      <WrenchIcon size={10} color="var(--muted)" />
                      <span style={{ fontSize: 10, color: "var(--muted)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{(t.requestedRepair || t.issueShort || "").slice(0, 60)}</span>
                    </div>
                  )}

                  {meta?.label && (
                    <span style={{ fontSize: 10, fontWeight: 700, color: statusColor, padding: "2px 7px", borderRadius: 5, background: `${statusColor}18`, border: `1px solid ${statusColor}30`, whiteSpace: "nowrap", flexShrink: 0 }}>
                      {meta.isFinal ? "✓ " : ""}{meta.label}
                    </span>
                  )}

                  {finalPrice > 0 && (
                    <span style={{ fontSize: 12, fontWeight: 700, color: "var(--accent)", whiteSpace: "nowrap", flexShrink: 0 }}>
                      {finalPrice.toLocaleString("cs-CZ")} Kč
                    </span>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      ))}

      {groups.length === 0 && (
        <div style={{ padding: 24, textAlign: "center", color: "var(--muted)" }}>Žádné zakázky</div>
      )}
    </div>
  );
}
