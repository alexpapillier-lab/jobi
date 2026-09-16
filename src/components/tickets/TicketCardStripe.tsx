import React from "react";
import { type TicketCardData, computeFinalPrice, korunami } from "./types";
import { TicketCode, TicketCustomer, TicketDate, TicketDevice, TicketRepair, TicketPobocka, TicketTechnik, TicketUmisteni } from "./fields";
import { promenneOvladani, promenneRadku, stylStavu, type ZvyrazneniStavu } from "../../lib/zvyrazneniStavu";

type Props = {
  ticket: TicketCardData;
  meta: { bg?: string; label?: string; isFinal?: boolean } | null;
  onClick: () => void;
  statusPicker: React.ReactNode;
  printButton?: React.ReactNode;
  /** Jak výrazně se propíše barva stavu do řádku. */
  zvyrazneni?: ZvyrazneniStavu;
};

export function TicketCardStripe({ ticket: t, meta, onClick, statusPicker, printButton, zvyrazneni = "jemne" }: Props) {
  const bg = meta?.bg || "var(--border)";
  const finalPrice = computeFinalPrice(t);
  const stav = stylStavu(meta?.bg, zvyrazneni, meta?.isFinal);
  const hoverBg = stav.plnaVyplne ? stav.pozadi : `${bg}06`;

  return (
    <div
      onClick={onClick}
      style={{
        ...promenneRadku(stav),
        textAlign: "left",
        borderRadius: 6,
        border: `1px solid ${stav.ramecek}`,
        background: stav.pozadi,
        cursor: "pointer",
        transition: "background 0.1s ease, border-color 0.1s ease",
        color: stav.barvaPisma,
        overflow: "hidden",
        display: "flex",
        alignItems: "stretch",
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
      {/* Status color bar – na plné výplni by splynul, tak se přebarví písmem. */}
      <div style={{
        width: 6,
        background: stav.plnaVyplne ? stav.barvaPisma : bg,
        opacity: stav.plnaVyplne ? 0.55 : 1,
        flexShrink: 0,
      }} />

      {/* Content row */}
      <div style={{ flex: 1, minWidth: 0, padding: "6px 10px", display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
        <TicketCode code={t.code} dense />
        <TicketDate value={t.createdAt} />
        <TicketDevice label={t.deviceLabel} dense />
        <TicketCustomer name={t.customerName} />
        <TicketTechnik name={t.technik} />
        <TicketPobocka label={t.pobocka} /><TicketUmisteni label={t.umisteni} varovani={t.umisteniVaruje} />
        <div style={{ flex: 1, minWidth: 0, display: "flex", alignItems: "center", overflow: "hidden" }}>
          <TicketRepair text={t.requestedRepair || t.issueShort} />
        </div>
        {finalPrice > 0 && (
          <span style={{ fontSize: "var(--text-sm)", fontWeight: 700, color: "var(--text)", whiteSpace: "nowrap", flexShrink: 0 }}>
            {korunami(finalPrice)}
          </span>
        )}
        <div style={{ ...promenneOvladani(stav), display: "flex", alignItems: "center", gap: 4, flexShrink: 0, marginLeft: "auto" }} onClick={(e) => e.stopPropagation()} onMouseDown={(e) => e.stopPropagation()}>
          {statusPicker}
          {printButton}
        </div>
      </div>
    </div>
  );
}
