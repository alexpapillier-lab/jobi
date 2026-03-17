import React from "react";
import { type TicketCardData, formatCZDate, computeFinalPrice } from "./types";
import { DeviceIcon } from "./icons";

type Props = {
  ticket: TicketCardData;
  meta: { bg?: string; label?: string; isFinal?: boolean } | null;
  onClick: () => void;
  statusPicker: React.ReactNode;
  printButton?: React.ReactNode;
};

export function TicketCardCompact({ ticket: t, meta, onClick, statusPicker, printButton }: Props) {
  const bg = meta?.bg || "var(--border)";
  const finalPrice = computeFinalPrice(t);

  return (
    <div
      onClick={onClick}
      style={{
        textAlign: "left",
        padding: 0,
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
        e.currentTarget.style.boxShadow = `0 4px 12px ${bg}14`;
        e.currentTarget.style.borderColor = `${bg}50`;
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.transform = "translateY(0)";
        e.currentTarget.style.boxShadow = "0 1px 3px rgba(0,0,0,0.03)";
        e.currentTarget.style.borderColor = `${bg}30`;
      }}
    >
      <div style={{ width: 4, background: bg, flexShrink: 0 }} />

      <div style={{ flex: 1, minWidth: 0, padding: "8px 12px", display: "flex", flexDirection: "column", gap: 5 }}>
        {/* Header: code + date left, status + print right */}
        <div style={{ display: "flex", alignItems: "center", gap: 6, minHeight: 24 }}>
          <span style={{ fontWeight: 800, fontSize: 13, color: "var(--text)", whiteSpace: "nowrap", flexShrink: 0 }}>{t.code}</span>
          <span style={{ fontSize: 10, color: "var(--muted)", whiteSpace: "nowrap", flexShrink: 0 }}>{formatCZDate(t.createdAt)}</span>
          {meta?.label && (
            <span style={{
              fontSize: 9, fontWeight: 700, padding: "1px 5px", borderRadius: 4,
              background: `${bg}18`, color: bg, whiteSpace: "nowrap", flexShrink: 0,
            }}>
              {meta.isFinal ? "✓ " : ""}{meta.label}
            </span>
          )}
          <div style={{ flex: 1 }} />
          <div style={{ display: "flex", alignItems: "center", gap: 5, flexShrink: 0 }} onClick={(e) => e.stopPropagation()} onMouseDown={(e) => e.stopPropagation()}>
            {statusPicker}
            {printButton}
          </div>
        </div>

        {/* Device + customer + repair in one row */}
        <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 4, fontWeight: 700, fontSize: 13, color: "var(--accent)", minWidth: 0, overflow: "hidden" }}>
            <DeviceIcon size={12} color="var(--accent)" />
            <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{t.deviceLabel || "—"}</span>
          </div>
          <span style={{ color: "var(--border)" }}>·</span>
          <span style={{ fontWeight: 500, fontSize: 11, color: "var(--muted)", whiteSpace: "nowrap", flexShrink: 0 }}>{t.customerName}</span>
          {(t.requestedRepair || t.issueShort) && (
            <>
              <span style={{ color: "var(--border)" }}>·</span>
              <span style={{ fontSize: 11, fontWeight: 600, color: "var(--text)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", minWidth: 0, flex: 1 }}>
                {t.requestedRepair || t.issueShort}
              </span>
            </>
          )}
          {finalPrice > 0 && (
            <span style={{ fontSize: 12, fontWeight: 700, color: bg, whiteSpace: "nowrap", flexShrink: 0 }}>
              {finalPrice.toLocaleString("cs-CZ")} Kč
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
