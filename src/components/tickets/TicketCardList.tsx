import React from "react";
import { type TicketCardData, computeFinalPrice } from "./types";
import { WrenchIcon } from "./icons";
import { TicketCode, TicketDate, TicketDevice, TicketCustomer, MetaSeparator } from "./fields";

type Props = {
  ticket: TicketCardData;
  meta: { bg?: string; label?: string; isFinal?: boolean } | null;
  onClick: () => void;
  statusPicker: React.ReactNode;
  printButton?: React.ReactNode;
};

export function TicketCardList({ ticket: t, meta, onClick, statusPicker, printButton }: Props) {
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
        boxShadow: "0 1px 2px rgba(0,0,0,0.03)",
        transition: "transform 0.12s ease, box-shadow 0.12s ease, border-color 0.12s ease",
        color: "var(--text)",
        position: "relative",
        overflow: "hidden",
        display: "flex",
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.transform = "translateY(-1px)";
        e.currentTarget.style.boxShadow = `0 4px 14px ${bg}14`;
        e.currentTarget.style.borderColor = `${bg}50`;
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.transform = "translateY(0)";
        e.currentTarget.style.boxShadow = "0 1px 2px rgba(0,0,0,0.03)";
        e.currentTarget.style.borderColor = `${bg}30`;
      }}
    >
      <div style={{ width: 4, background: bg, flexShrink: 0, borderRadius: "10px 0 0 10px" }} />

      <div style={{ flex: 1, minWidth: 0, padding: "8px 12px", display: "flex", flexDirection: "column", gap: 4 }}>
        {/* Row 1: code, date, device, customer */}
        <div style={{ display: "flex", alignItems: "center", gap: 8, minHeight: 24 }}>
          <TicketCode code={t.code} />
          <TicketDate value={t.createdAt} />
          <MetaSeparator />
          <TicketDevice label={t.deviceLabel} />
          <TicketCustomer name={t.customerName} />
          <div style={{ flex: 1 }} />
          <div style={{ display: "flex", alignItems: "center", gap: 5, flexShrink: 0 }} onClick={(e) => e.stopPropagation()} onMouseDown={(e) => e.stopPropagation()}>
            {statusPicker}
            {printButton}
          </div>
        </div>

        {/* Row 2: repair + price (only if data exists) */}
        {(t.requestedRepair || t.issueShort || finalPrice > 0) && (
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            {(t.requestedRepair || t.issueShort) && (
              <div style={{ display: "flex", alignItems: "center", gap: 5, flex: 1, minWidth: 0, overflow: "hidden" }}>
                <WrenchIcon size={11} color="var(--muted)" />
                <span style={{ fontSize: 11, fontWeight: 600, color: "var(--muted)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {t.requestedRepair || t.issueShort}
                </span>
              </div>
            )}
            {finalPrice > 0 && (
              <span style={{ fontSize: 12, fontWeight: 700, color: bg, whiteSpace: "nowrap", flexShrink: 0 }}>
                {finalPrice.toLocaleString("cs-CZ")} Kč
              </span>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
