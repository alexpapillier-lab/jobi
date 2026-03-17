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

export function TicketCardSplit({ ticket: t, meta, onClick, statusPicker, printButton }: Props) {
  const bg = meta?.bg || "var(--border)";
  const finalPrice = computeFinalPrice(t);

  return (
    <div
      onClick={onClick}
      style={{
        textAlign: "left",
        borderRadius: 10,
        border: `1px solid ${bg}30`,
        background: "var(--panel)",
        cursor: "pointer",
        boxShadow: "0 1px 3px rgba(0,0,0,0.03)",
        transition: "transform 0.12s ease, box-shadow 0.12s ease, border-color 0.12s ease",
        color: "var(--text)",
        overflow: "hidden",
        display: "flex",
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.transform = "translateY(-1px)";
        e.currentTarget.style.boxShadow = `0 4px 14px ${bg}12`;
        e.currentTarget.style.borderColor = `${bg}45`;
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.transform = "translateY(0)";
        e.currentTarget.style.boxShadow = "0 1px 3px rgba(0,0,0,0.03)";
        e.currentTarget.style.borderColor = `${bg}30`;
      }}
    >
      {/* Status bar */}
      <div style={{ width: 4, background: bg, flexShrink: 0 }} />

      {/* Left: device + customer info */}
      <div style={{ flex: 1, minWidth: 0, padding: "8px 12px", borderRight: "1px solid var(--border)", display: "flex", flexDirection: "column", gap: 3 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <span style={{ fontWeight: 800, fontSize: 13, color: "var(--text)", whiteSpace: "nowrap", flexShrink: 0 }}>{t.code}</span>
          <span style={{ fontSize: 10, color: "var(--muted)", whiteSpace: "nowrap", flexShrink: 0 }}>{formatCZDate(t.createdAt)}</span>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 5 }}>
          <DeviceIcon size={12} color="var(--accent)" />
          <span style={{ fontWeight: 700, fontSize: 12, color: "var(--text)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", minWidth: 0 }}>{t.deviceLabel || "—"}</span>
        </div>
        <span style={{ fontSize: 11, color: "var(--muted)" }}>{t.customerName}</span>
      </div>

      {/* Right: repair + price + controls */}
      <div style={{ flex: 1, minWidth: 0, padding: "8px 12px", display: "flex", flexDirection: "column", gap: 3 }}>
        {(t.requestedRepair || t.issueShort) && (
          <div style={{ display: "flex", alignItems: "center", gap: 5, minWidth: 0 }}>
            <WrenchIcon size={11} color="var(--muted)" />
            <span style={{ fontSize: 11, fontWeight: 600, color: "var(--text)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", minWidth: 0 }}>
              {t.requestedRepair || t.issueShort}
            </span>
          </div>
        )}
        <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: "auto" }}>
          {finalPrice > 0 && (
            <span style={{ fontSize: 12, fontWeight: 700, color: bg }}>
              {finalPrice.toLocaleString("cs-CZ")} Kč
            </span>
          )}
          <div style={{ flex: 1 }} />
          <div style={{ display: "flex", alignItems: "center", gap: 4, flexShrink: 0 }} onClick={(e) => e.stopPropagation()} onMouseDown={(e) => e.stopPropagation()}>
            {statusPicker}
            {printButton}
          </div>
        </div>
      </div>
    </div>
  );
}
