import React from "react";
import { type TicketCardData, formatCZDate, computeFinalPrice } from "./types";
import { DeviceIcon, WrenchIcon } from "./icons";

type Props = {
  ticket: TicketCardData;
  meta: { bg?: string; label?: string; isFinal?: boolean } | null;
  onClick: () => void;
  statusPicker: React.ReactNode;
  printButton?: React.ReactNode;
};

export function TicketCardGrid({ ticket: t, meta, onClick, statusPicker, printButton }: Props) {
  const bg = meta?.bg || "var(--border)";
  const finalPrice = computeFinalPrice(t);

  return (
    <div
      onClick={onClick}
      style={{
        textAlign: "left",
        borderRadius: 14,
        border: `1px solid ${bg}30`,
        background: "var(--panel)",
        cursor: "pointer",
        boxShadow: "0 1px 4px rgba(0,0,0,0.04)",
        transition: "transform 0.15s ease, box-shadow 0.15s ease",
        color: "var(--text)",
        overflow: "hidden",
        display: "flex",
        flexDirection: "column",
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.transform = "translateY(-2px)";
        e.currentTarget.style.boxShadow = `0 8px 24px ${bg}14`;
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.transform = "translateY(0)";
        e.currentTarget.style.boxShadow = "0 1px 4px rgba(0,0,0,0.04)";
      }}
    >
      {/* Status color header */}
      <div style={{
        padding: "8px 12px",
        background: `linear-gradient(135deg, ${bg}15, ${bg}06)`,
        borderBottom: `1px solid ${bg}18`,
        display: "flex",
        alignItems: "center",
        gap: 6,
        minWidth: 0,
      }}>
        <span style={{ fontWeight: 800, fontSize: 12, color: "var(--text)", whiteSpace: "nowrap", flexShrink: 0 }}>{t.code}</span>
        <span style={{ fontSize: 10, color: "var(--muted)", whiteSpace: "nowrap", flexShrink: 0 }}>{formatCZDate(t.createdAt)}</span>
        <div style={{ flex: 1 }} />
        <div style={{ display: "flex", alignItems: "center", gap: 4, flexShrink: 0 }} onClick={(e) => e.stopPropagation()} onMouseDown={(e) => e.stopPropagation()}>
          {statusPicker}
          {printButton}
        </div>
      </div>

      <div style={{ padding: "10px 12px", display: "flex", flexDirection: "column", gap: 8, flex: 1, minWidth: 0 }}>
        {/* Device + customer */}
        <div style={{ display: "flex", alignItems: "center", gap: 6, minWidth: 0 }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "center", width: 22, height: 22, borderRadius: 6, background: "var(--accent-soft)", color: "var(--accent)", flexShrink: 0 }}>
            <DeviceIcon size={12} color="currentColor" />
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontWeight: 700, fontSize: 12, color: "var(--text)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{t.deviceLabel || "—"}</div>
            <div style={{ fontWeight: 500, fontSize: 10, color: "var(--muted)" }}>{t.customerName}</div>
          </div>
        </div>

        {/* Repair */}
        {(t.requestedRepair || t.issueShort) && (
          <div style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 11, fontWeight: 600, color: "var(--text)", minWidth: 0 }}>
            <WrenchIcon size={10} color="var(--muted)" />
            <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", minWidth: 0 }}>{t.requestedRepair || t.issueShort}</span>
          </div>
        )}

        <div style={{ flex: 1 }} />

        {/* Footer: price */}
        {finalPrice > 0 && (
          <div style={{ display: "flex", justifyContent: "flex-end", paddingTop: 6, borderTop: "1px solid var(--border)" }}>
            <span style={{ fontWeight: 700, color: bg, fontSize: 12 }}>{finalPrice.toLocaleString("cs-CZ")} Kč</span>
          </div>
        )}
      </div>
    </div>
  );
}
