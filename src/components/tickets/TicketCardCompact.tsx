import React from "react";
import { type TicketCardData, computeFinalPrice } from "./types";
import { TicketCode, TicketCustomer, TicketDate, TicketDevice, TicketRepair, MetaSeparator } from "./fields";

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

      {/*
        Jeden řádek místo dvou – stejně jako u režimu "list".
        Oprava sedí ve volném středu a roztahuje se podle místa.
      */}
      <div style={{ flex: 1, minWidth: 0, padding: "var(--space-2) var(--space-3)", display: "flex", alignItems: "center", gap: "var(--space-2)", minHeight: 24, flexWrap: "wrap" }}>
        <TicketCode code={t.code} />
        <TicketDate value={t.createdAt} />
        <MetaSeparator />
        <TicketDevice label={t.deviceLabel} />
        <TicketCustomer name={t.customerName} />

        <div style={{ flex: 1, minWidth: 0, display: "flex", alignItems: "center", overflow: "hidden" }}>
          <TicketRepair text={t.requestedRepair || t.issueShort} />
        </div>

        {/*
          Odznak se stavem tu býval, ale po přechodu na jeden řádek se ocitl
          hned vedle pilulky se stavem – tentýž údaj dvakrát pod sebou.
          Zůstává jen značka dokončení, kterou pilulka neukazuje.
        */}
        {meta?.isFinal && (
          <span style={{
            fontSize: "var(--text-xs)", fontWeight: 800, padding: "1px 5px", borderRadius: "var(--radius-2xs)",
            background: `${bg}18`, color: bg, whiteSpace: "nowrap", flexShrink: 0,
          }}>
            ✓
          </span>
        )}
        {finalPrice > 0 && (
          <span style={{ fontSize: "var(--text-sm)", fontWeight: 700, color: "var(--text)", whiteSpace: "nowrap", flexShrink: 0 }}>
            {finalPrice.toLocaleString("cs-CZ")} Kč
          </span>
        )}
        <div style={{ display: "flex", alignItems: "center", gap: "var(--space-1)", flexShrink: 0, marginLeft: "auto" }} onClick={(e) => e.stopPropagation()} onMouseDown={(e) => e.stopPropagation()}>
          {statusPicker}
          {printButton}
        </div>
      </div>
    </div>
  );
}
