import React from "react";
import { DeviceIcon, WrenchIcon } from "./icons";
import { ClaimBadge, MetaSeparator, TicketCode, TicketCustomer, TicketDate, TicketDevice, TicketRepair } from "./fields";

/**
 * Karta reklamace v seznamu zakázek.
 *
 * Rozvržení je záměrně řádek po řádku stejné jako u zakázky – každý režim
 * zobrazení kopíruje odpovídající TicketCard*, včetně rámečku, odsazení,
 * pořadí údajů i sdílených prvků z fields.tsx. Reklamace se dřív kreslila
 * po svém (čárkovaný rámeček, jiné velikosti písma, v režimech compact
 * a list dva řádky místo jednoho), takže ve smíšeném seznamu měla jinou
 * výšku i jinak posazené sloupce.
 *
 * Jediný rozdíl proti zakázce je teď odznak "Reklamace" na místě, kde má
 * zakázka cenu. Ta reklamace nemá, takže se sloupce nikam neposunou.
 */

type ClaimData = {
  id: string;
  code: string;
  status: string;
  created_at?: string;
  device_label?: string;
  device_serial?: string;
  customer_name?: string | null;
  notes?: string | null;
};

type ClaimCardProps = {
  claim: ClaimData;
  displayMode: string;
  statusColor: string;
  onClick: () => void;
  statusPicker: React.ReactNode;
  printButton?: React.ReactNode;
};

function Controls({ statusPicker, printButton, gap, marginLeftAuto }: { statusPicker: React.ReactNode; printButton?: React.ReactNode; gap: number | string; marginLeftAuto?: boolean }) {
  return (
    <div
      style={{ display: "flex", alignItems: "center", gap, flexShrink: 0, ...(marginLeftAuto ? { marginLeft: "auto" } : null) }}
      onClick={(e) => e.stopPropagation()}
      onMouseDown={(e) => e.stopPropagation()}
    >
      {statusPicker}
      {printButton}
    </div>
  );
}

export function ClaimCard({ claim: c, displayMode, statusColor, onClick, statusPicker, printButton }: ClaimCardProps) {
  const bg = statusColor || "var(--border)";
  const customerName = c.customer_name ?? "—";

  if (displayMode === "compact-extra") {
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
          <TicketCode code={c.code} dense />
          <TicketDate value={c.created_at} />
          <TicketDevice label={c.device_label} dense />
          <TicketCustomer name={customerName} />
          <div style={{ flex: 1, minWidth: 0, display: "flex", alignItems: "center", overflow: "hidden" }}>
            <TicketRepair text={c.notes} />
          </div>
          <ClaimBadge dense />
          <Controls statusPicker={statusPicker} printButton={printButton} gap={5} />
        </div>
      </div>
    );
  }

  if (displayMode === "stripe") {
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
        <div style={{ width: 6, background: bg, flexShrink: 0 }} />

        <div style={{ flex: 1, minWidth: 0, padding: "6px 10px", display: "flex", alignItems: "center", gap: 12 }}>
          <TicketCode code={c.code} dense />
          <TicketDate value={c.created_at} />
          <TicketDevice label={c.device_label} dense />
          <TicketCustomer name={customerName} />
          <div style={{ flex: 1, minWidth: 0, display: "flex", alignItems: "center", overflow: "hidden" }}>
            <TicketRepair text={c.notes} />
          </div>
          <ClaimBadge dense />
          <Controls statusPicker={statusPicker} printButton={printButton} gap={4} marginLeftAuto />
        </div>
      </div>
    );
  }

  if (displayMode === "grid") {
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
          <TicketCode code={c.code} dense />
          <TicketDate value={c.created_at} />
          <div style={{ flex: 1 }} />
          <ClaimBadge dense />
          <Controls statusPicker={statusPicker} printButton={printButton} gap={4} />
        </div>

        <div style={{ padding: "10px 12px", display: "flex", flexDirection: "column", gap: 8, flex: 1, minWidth: 0 }}>
          {/* Device + customer */}
          <div style={{ display: "flex", alignItems: "center", gap: 6, minWidth: 0 }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "center", width: 22, height: 22, borderRadius: 6, background: "var(--accent-soft)", color: "var(--accent)", flexShrink: 0 }}>
              <DeviceIcon size={12} color="currentColor" />
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontWeight: 700, fontSize: 12, color: "var(--text)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{c.device_label || "—"}</div>
              <div style={{ fontWeight: 500, fontSize: "var(--text-xs)", color: "var(--muted)" }}>{customerName}</div>
            </div>
          </div>

          {/* Notes */}
          {c.notes && (
            <div style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 11, fontWeight: 600, color: "var(--text)", minWidth: 0 }}>
              <WrenchIcon size={10} color="var(--muted)" />
              <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", minWidth: 0 }}>{c.notes}</span>
            </div>
          )}

          <div style={{ flex: 1 }} />
        </div>
      </div>
    );
  }

  if (displayMode === "list") {
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

        <div style={{ flex: 1, minWidth: 0, padding: "var(--space-2) var(--space-3)", display: "flex", alignItems: "center", gap: "var(--space-2)", minHeight: 24, flexWrap: "wrap" }}>
          <TicketCode code={c.code} />
          <TicketDate value={c.created_at} />
          <MetaSeparator />
          <TicketDevice label={c.device_label} />
          <TicketCustomer name={customerName} />

          <div style={{ flex: 1, minWidth: 0, display: "flex", alignItems: "center", overflow: "hidden" }}>
            <TicketRepair text={c.notes} />
          </div>

          <ClaimBadge />
          <Controls statusPicker={statusPicker} printButton={printButton} gap="var(--space-1)" marginLeftAuto />
        </div>
      </div>
    );
  }

  // Default: compact mode
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

      <div style={{ flex: 1, minWidth: 0, padding: "var(--space-2) var(--space-3)", display: "flex", alignItems: "center", gap: "var(--space-2)", minHeight: 24 }}>
        <TicketCode code={c.code} />
        <TicketDate value={c.created_at} />
        <MetaSeparator />
        <TicketDevice label={c.device_label} />
        <TicketCustomer name={customerName} />

        <div style={{ flex: 1, minWidth: 0, display: "flex", alignItems: "center", overflow: "hidden" }}>
          <TicketRepair text={c.notes} />
        </div>

        <ClaimBadge />
        <Controls statusPicker={statusPicker} printButton={printButton} gap="var(--space-1)" />
      </div>
    </div>
  );
}
