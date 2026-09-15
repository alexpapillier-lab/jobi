import React from "react";
import { type TicketCardData } from "./types";
import { TicketCode, TicketCustomer, TicketDate, TicketDevice, TicketRepair, TicketTechnik } from "./fields";
import { CheckIcon } from "../icons";
import { promenneRadku, stylStavu, type ZvyrazneniStavu } from "../../lib/zvyrazneniStavu";

type Props = {
  ticket: TicketCardData;
  meta: { bg?: string; label?: string; isFinal?: boolean } | null;
  onClick: () => void;
  statusPicker: React.ReactNode;
  printButton?: React.ReactNode;
  /** Jak výrazně se propíše barva stavu do řádku. */
  zvyrazneni?: ZvyrazneniStavu;
};

export function TicketCardCompactExtra({ ticket: t, meta, onClick, statusPicker, printButton, zvyrazneni = "jemne" }: Props) {
  const bg = meta?.bg || "var(--border)";
  const stav = stylStavu(meta?.bg, zvyrazneni, meta?.isFinal);
  /* Podklad se při najetí jen o chlup ztmaví; u plné výplně nechat barvu stavu. */
  const hoverBg = stav.plnaVyplne ? stav.pozadi : `${bg}08`;

  return (
    <div
      onClick={onClick}
      style={{
        ...promenneRadku(stav),
        textAlign: "left",
        padding: 0,
        borderRadius: 6,
        border: `1px solid ${stav.ramecek}`,
        background: stav.pozadi,
        cursor: "pointer",
        transition: "background 0.1s ease, border-color 0.1s ease",
        color: stav.barvaPisma,
        overflow: "hidden",
        display: "flex",
        alignItems: "center",
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.background = hoverBg;
        e.currentTarget.style.borderColor = stav.plnaVyplne ? stav.ramecek : `${bg}40`;
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.background = stav.pozadi;
        e.currentTarget.style.borderColor = stav.ramecek;
      }}
    >
      {/* Status dot */}
      <div style={{
        width: 8, height: 8, borderRadius: 4, background: stav.plnaVyplne ? stav.barvaPisma : bg,
        flexShrink: 0, marginLeft: 10,
      }} />

      <div style={{ flex: 1, minWidth: 0, padding: "5px 10px", display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
        <TicketCode code={t.code} dense />
        <TicketDate value={t.createdAt} />
        <TicketDevice label={t.deviceLabel} dense />
        <TicketCustomer name={t.customerName} />
        <TicketTechnik name={t.technik} />
        <div style={{ flex: 1, minWidth: 0, display: "flex", alignItems: "center", overflow: "hidden" }}>
          <TicketRepair text={t.requestedRepair || t.issueShort} />
        </div>
        {meta?.isFinal && <span style={{ fontSize: "var(--text-xs)", fontWeight: 800, padding: "1px 4px", borderRadius: 4, background: `${bg}18`, color: bg, flexShrink: 0, display: "inline-flex", alignItems: "center" }}><CheckIcon size={10} /></span>}
        <div style={{ display: "flex", alignItems: "center", gap: 5, flexShrink: 0, marginLeft: "auto" }} onClick={(e) => e.stopPropagation()} onMouseDown={(e) => e.stopPropagation()}>
          {statusPicker}
          {printButton}
        </div>
      </div>
    </div>
  );
}
