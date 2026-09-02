import React from "react";
import { type TicketCardData, computeFinalPrice } from "./types";
import { TicketCode, TicketDate, TicketDevice, TicketCustomer, TicketRepair, MetaSeparator } from "./fields";

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

      {/*
        Jeden řádek na zakázku.

        Dřív to byly dva: na prvním kód, datum, zařízení a zákazník,
        na druhém oprava a cena. Mezi jménem zákazníka a stavem přitom
        zůstávalo několik set pixelů prázdna, zatímco oprava kvůli tomu
        zabírala celou další výšku řádku.

        Teď oprava sedí v tom volném středu a roztahuje se podle místa;
        když se nevejde, zkrátí se třemi tečkami. Na velké obrazovce se
        tím vejde zhruba dvakrát tolik zakázek.
      */}
      <div style={{ flex: 1, minWidth: 0, padding: "var(--space-2) var(--space-3)", display: "flex", alignItems: "center", gap: "var(--space-2)", minHeight: 24 }}>
        <TicketCode code={t.code} />
        <TicketDate value={t.createdAt} />
        <MetaSeparator />
        <TicketDevice label={t.deviceLabel} />
        <TicketCustomer name={t.customerName} />

        {/* Volný střed: oprava se roztáhne podle dostupného místa */}
        <div style={{ flex: 1, minWidth: 0, display: "flex", alignItems: "center", overflow: "hidden" }}>
          <TicketRepair text={t.requestedRepair || t.issueShort} />
        </div>

        {/*
          Cena je barvou textu, ne stavu. Dřív používala barvu stavu (bg),
          jenže stavové barvy mají na světlém pozadí kontrast jen 2,1–3,5:1
          – měřeno v docs/AUDIT_UI_2026-09.md. Na tečku u stavu stačí,
          na částku ne. Navíc cena se stavem nesouvisí.
        */}
        {finalPrice > 0 && (
          <span style={{ fontSize: "var(--text-sm)", fontWeight: 700, color: "var(--text)", whiteSpace: "nowrap", flexShrink: 0 }}>
            {finalPrice.toLocaleString("cs-CZ")} Kč
          </span>
        )}
        <div style={{ display: "flex", alignItems: "center", gap: "var(--space-1)", flexShrink: 0 }} onClick={(e) => e.stopPropagation()} onMouseDown={(e) => e.stopPropagation()}>
          {statusPicker}
          {printButton}
        </div>
      </div>
    </div>
  );
}
