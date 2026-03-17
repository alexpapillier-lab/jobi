import React from "react";
import { type TicketCardData, formatCZDate } from "./types";

type Props = {
  ticket: TicketCardData;
  meta: { bg?: string; label?: string; isFinal?: boolean } | null;
  onClick: () => void;
  statusPicker: React.ReactNode;
  printButton?: React.ReactNode;
};

export function TicketCardCompactExtra({ ticket: t, meta, onClick, statusPicker, printButton }: Props) {
  const bg = meta?.bg || "var(--border)";

  return (
    <div
      onClick={onClick}
      style={{
        textAlign: "left",
        padding: 0,
        borderRadius: 6,
        border: `1px solid ${bg}25`,
        background: "var(--panel)",
        cursor: "pointer",
        transition: "background 0.1s ease, border-color 0.1s ease",
        color: "var(--text)",
        overflow: "hidden",
        display: "flex",
        alignItems: "center",
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.background = `${bg}08`;
        e.currentTarget.style.borderColor = `${bg}40`;
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.background = "var(--panel)";
        e.currentTarget.style.borderColor = `${bg}25`;
      }}
    >
      {/* Status dot */}
      <div style={{
        width: 8, height: 8, borderRadius: 4, background: bg,
        flexShrink: 0, marginLeft: 10,
      }} />

      <div style={{ flex: 1, minWidth: 0, padding: "5px 10px", display: "flex", alignItems: "center", gap: 10 }}>
        <span style={{ fontWeight: 800, fontSize: 12, color: "var(--text)", whiteSpace: "nowrap", flexShrink: 0, minWidth: 60 }}>{t.code}</span>
        <span style={{ fontSize: 10, color: "var(--muted)", whiteSpace: "nowrap", flexShrink: 0, minWidth: 70 }}>{formatCZDate(t.createdAt)}</span>
        <span style={{ minWidth: 0, maxWidth: 140, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontSize: 12, fontWeight: 600, color: "var(--text)", flexShrink: 1 }}>{t.deviceLabel || "—"}</span>
        <span style={{ fontSize: 11, color: "var(--muted)", maxWidth: 110, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", flexShrink: 0 }}>{t.customerName}</span>
        {(t.requestedRepair || t.issueShort) && (
          <span style={{ flex: 1, minWidth: 0, fontSize: 10, color: "var(--muted)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {(t.requestedRepair || t.issueShort || "").slice(0, 60)}
          </span>
        )}
        {meta?.isFinal && <span style={{ fontSize: 8, fontWeight: 800, padding: "1px 4px", borderRadius: 4, background: `${bg}18`, color: bg, flexShrink: 0 }}>✓</span>}
        <div style={{ display: "flex", alignItems: "center", gap: 5, flexShrink: 0 }} onClick={(e) => e.stopPropagation()} onMouseDown={(e) => e.stopPropagation()}>
          {statusPicker}
          {printButton}
        </div>
      </div>
    </div>
  );
}
