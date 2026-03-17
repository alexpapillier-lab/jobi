import React from "react";
import { type TicketCardData, formatCZDate, computeFinalPrice } from "./types";

type Props = {
  ticket: TicketCardData;
  meta: { bg?: string; label?: string; isFinal?: boolean } | null;
  onClick: () => void;
  statusPicker: React.ReactNode;
  printButton?: React.ReactNode;
};

export function TicketCardStripe({ ticket: t, meta, onClick, statusPicker, printButton }: Props) {
  const bg = meta?.bg || "var(--border)";
  const finalPrice = computeFinalPrice(t);

  return (
    <div
      onClick={onClick}
      style={{
        textAlign: "left",
        borderRadius: 6,
        border: `1px solid ${bg}20`,
        background: "var(--panel)",
        cursor: "pointer",
        transition: "background 0.1s ease, border-color 0.1s ease",
        color: "var(--text)",
        overflow: "hidden",
        display: "flex",
        alignItems: "stretch",
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.background = `${bg}06`;
        e.currentTarget.style.borderColor = `${bg}40`;
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.background = "var(--panel)";
        e.currentTarget.style.borderColor = `${bg}20`;
      }}
    >
      {/* Status color bar */}
      <div style={{
        width: 6,
        background: bg,
        flexShrink: 0,
      }} />

      {/* Content row */}
      <div style={{ flex: 1, minWidth: 0, padding: "6px 10px", display: "flex", alignItems: "center", gap: 12 }}>
        <span style={{ fontWeight: 800, fontSize: 12, color: "var(--text)", whiteSpace: "nowrap", flexShrink: 0, minWidth: 65 }}>{t.code}</span>
        <span style={{ fontSize: 10, color: "var(--muted)", whiteSpace: "nowrap", flexShrink: 0 }}>{formatCZDate(t.createdAt)}</span>
        <span style={{ fontWeight: 700, fontSize: 12, color: "var(--text)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", minWidth: 80, maxWidth: 180, flexShrink: 1 }}>{t.deviceLabel || "—"}</span>
        <span style={{ fontSize: 11, color: "var(--muted)", whiteSpace: "nowrap", flexShrink: 0, maxWidth: 120, overflow: "hidden", textOverflow: "ellipsis" }}>{t.customerName}</span>
        {(t.requestedRepair || t.issueShort) && (
          <span style={{ fontSize: 11, color: "var(--muted)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", flex: 1, minWidth: 0 }}>
            {t.requestedRepair || t.issueShort}
          </span>
        )}
        {finalPrice > 0 && (
          <span style={{ fontSize: 12, fontWeight: 700, color: bg, whiteSpace: "nowrap", flexShrink: 0 }}>
            {finalPrice.toLocaleString("cs-CZ")} Kč
          </span>
        )}
        <div style={{ display: "flex", alignItems: "center", gap: 4, flexShrink: 0, marginLeft: "auto" }} onClick={(e) => e.stopPropagation()} onMouseDown={(e) => e.stopPropagation()}>
          {statusPicker}
          {printButton}
        </div>
      </div>
    </div>
  );
}
