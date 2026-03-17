import React from "react";
import { type TicketCardData, formatCZDate, computeFinalPrice } from "./types";

type Props = {
  tickets: TicketCardData[];
  getByKey: (k: string) => { bg?: string; label?: string; isFinal?: boolean } | undefined;
  normalizeStatus: (raw: any) => string | null;
  onClickDetail: (id: string) => void;
  statusPickerFor: (ticket: TicketCardData, currentStatus: string | null) => React.ReactNode;
  smsUnreadByTicketId?: Record<string, number>;
};

const smsBadge = (n: number) =>
  n > 0 ? (
    <span style={{ marginLeft: 6, minWidth: 18, height: 18, borderRadius: 9, background: "#FF3B30", color: "#fff", fontSize: 10, fontWeight: 700, display: "inline-flex", alignItems: "center", justifyContent: "center", padding: "0 5px" }}>
      {n > 99 ? "99+" : n}
    </span>
  ) : null;

export function TicketTable({ tickets, getByKey, normalizeStatus, onClickDetail, statusPickerFor, smsUnreadByTicketId = {} }: Props) {
  return (
    <div style={{ borderRadius: 12, border: "1px solid var(--border)", overflow: "hidden", background: "var(--panel)" }}>
      <div style={{ overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
          <thead>
            <tr style={{ position: "sticky", top: 0, zIndex: 2 }}>
              {["", "Kód", "Datum", "Zařízení", "Zákazník", "Oprava", "Status", "Cena"].map((h, i) => (
                <th
                  key={`${h}-${i}`}
                  style={{
                    padding: i === 0 ? "10px 0 10px 0" : "10px 12px",
                    textAlign: "left",
                    fontWeight: 700,
                    fontSize: 11,
                    textTransform: "uppercase",
                    letterSpacing: "0.05em",
                    color: "var(--muted)",
                    background: "var(--panel-2)",
                    borderBottom: "2px solid var(--border)",
                    whiteSpace: "nowrap",
                    width: i === 0 ? 4 : "auto",
                    ...(i === 7 ? { textAlign: "right" as const } : {}),
                  }}
                >
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {tickets.map((t, idx) => {
              const currentStatus = normalizeStatus(t.status);
              const meta = currentStatus ? getByKey(currentStatus) : undefined;
              const statusColor = meta?.bg || "var(--border)";
              const finalPrice = computeFinalPrice(t);
              const isEven = idx % 2 === 0;
              return (
                <tr
                  key={t.id}
                  onClick={() => onClickDetail(t.id)}
                  style={{
                    cursor: "pointer",
                    background: isEven ? "transparent" : `${statusColor}04`,
                    transition: "background 0.1s ease",
                  }}
                  onMouseEnter={(e) => { e.currentTarget.style.background = `${statusColor}10`; }}
                  onMouseLeave={(e) => { e.currentTarget.style.background = isEven ? "transparent" : `${statusColor}04`; }}
                >
                  {/* Status color indicator */}
                  <td style={{ padding: 0, borderBottom: "1px solid var(--border)", width: 4 }}>
                    <div style={{ width: 4, height: "100%", minHeight: 36, background: statusColor }} />
                  </td>
                  <td style={{ padding: "8px 12px", fontWeight: 800, fontSize: 13, color: "var(--text)", whiteSpace: "nowrap", borderBottom: "1px solid var(--border)" }}>
                    <span style={{ display: "inline-flex", alignItems: "center" }}>{t.code}{smsBadge(smsUnreadByTicketId[t.id] ?? 0)}</span>
                  </td>
                  <td style={{ padding: "8px 12px", fontSize: 11, color: "var(--muted)", whiteSpace: "nowrap", borderBottom: "1px solid var(--border)" }}>
                    {formatCZDate(t.createdAt)}
                  </td>
                  <td style={{ padding: "8px 12px", fontWeight: 600, fontSize: 12, color: "var(--text)", borderBottom: "1px solid var(--border)", maxWidth: 200, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {t.deviceLabel || "—"}
                  </td>
                  <td style={{ padding: "8px 12px", fontSize: 12, color: "var(--text)", borderBottom: "1px solid var(--border)", maxWidth: 150, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {t.customerName}
                  </td>
                  <td style={{ padding: "8px 12px", fontSize: 11, color: "var(--muted)", borderBottom: "1px solid var(--border)", maxWidth: 200, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {t.requestedRepair || t.issueShort || "—"}
                  </td>
                  <td
                    style={{ padding: "8px 12px", borderBottom: "1px solid var(--border)", whiteSpace: "nowrap" }}
                    onClick={(e) => e.stopPropagation()}
                    onMouseDown={(e) => e.stopPropagation()}
                  >
                    {statusPickerFor(t, currentStatus)}
                  </td>
                  <td style={{ padding: "8px 12px", textAlign: "right", fontWeight: 700, color: finalPrice > 0 ? statusColor : "var(--muted)", borderBottom: "1px solid var(--border)", whiteSpace: "nowrap" }}>
                    {finalPrice > 0 ? `${finalPrice.toLocaleString("cs-CZ")} Kč` : "—"}
                  </td>
                </tr>
              );
            })}
            {tickets.length === 0 && (
              <tr>
                <td colSpan={8} style={{ padding: 24, textAlign: "center", color: "var(--muted)" }}>
                  Žádné zakázky
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
