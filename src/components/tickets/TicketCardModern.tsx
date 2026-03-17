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

function CustomerAvatar({ name }: { name: string }) {
  const initials = name
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w.charAt(0).toUpperCase())
    .join("");
  return (
    <div style={{
      width: 28, height: 28, borderRadius: 8,
      background: "linear-gradient(135deg, var(--accent), var(--accent-hover))",
      color: "white", display: "grid", placeItems: "center",
      fontWeight: 700, fontSize: 11, flexShrink: 0,
    }}>
      {initials || "?"}
    </div>
  );
}

export function TicketCardModern({ ticket: t, meta, onClick, statusPicker, printButton }: Props) {
  const bg = meta?.bg || "var(--accent)";
  const finalPrice = computeFinalPrice(t);
  const repairs = t.performedRepairs ?? [];

  return (
    <div
      onClick={onClick}
      style={{
        textAlign: "left",
        borderRadius: 14,
        border: `1px solid ${bg}25`,
        background: "var(--panel)",
        cursor: "pointer",
        boxShadow: "0 2px 6px rgba(0,0,0,0.04)",
        transition: "transform 0.15s ease, box-shadow 0.15s ease",
        color: "var(--text)",
        overflow: "hidden",
        display: "flex",
        flexDirection: "column",
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.transform = "translateY(-2px) scale(1.005)";
        e.currentTarget.style.boxShadow = `0 8px 24px ${bg}14`;
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.transform = "translateY(0) scale(1)";
        e.currentTarget.style.boxShadow = "0 2px 6px rgba(0,0,0,0.04)";
      }}
    >
      {/* Status color top bar */}
      <div style={{ height: 4, background: `linear-gradient(90deg, ${bg}, ${bg}aa)` }} />

      <div style={{ padding: "10px 12px", display: "flex", flexDirection: "column", gap: 8, flex: 1 }}>
        {/* Header: code + date */}
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <span style={{ fontWeight: 800, fontSize: 12, color: "var(--text)", flexShrink: 0 }}>{t.code}</span>
          <span style={{ fontSize: 10, color: "var(--muted)", flexShrink: 0 }}>{formatCZDate(t.createdAt)}</span>
          {meta?.label && (
            <span style={{
              fontSize: 9, fontWeight: 700, padding: "1px 5px", borderRadius: 4,
              background: `${bg}18`, color: bg, whiteSpace: "nowrap",
            }}>
              {meta.isFinal ? "✓ " : ""}{meta.label}
            </span>
          )}
        </div>

        {/* Customer + device */}
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <CustomerAvatar name={t.customerName} />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontWeight: 700, fontSize: 12, color: "var(--text)" }}>{t.customerName}</div>
            <div style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 11, color: "var(--accent)", fontWeight: 600 }}>
              <DeviceIcon size={11} color="var(--accent)" />
              <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{t.deviceLabel || "—"}</span>
            </div>
          </div>
        </div>

        {/* Repair */}
        {(t.requestedRepair || t.issueShort) && (
          <div style={{ display: "flex", alignItems: "center", gap: 6, padding: "5px 8px", background: "var(--panel-2)", borderRadius: 6, border: "1px solid var(--border)" }}>
            <WrenchIcon size={11} color="var(--muted)" />
            <span style={{ fontSize: 11, fontWeight: 600, color: "var(--text)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", minWidth: 0 }}>{t.requestedRepair || t.issueShort}</span>
          </div>
        )}

        <div style={{ flex: 1 }} />

        {/* Footer: price + controls */}
        <div style={{ display: "flex", alignItems: "center", gap: 6, paddingTop: 6, borderTop: "1px solid var(--border)" }}>
          {repairs.length > 0 && (
            <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
              <div style={{ width: 32, height: 3, borderRadius: 2, background: "var(--border)", overflow: "hidden" }}>
                <div style={{ height: "100%", borderRadius: 2, background: bg, width: meta?.isFinal ? "100%" : `${Math.min(100, repairs.length * 25)}%` }} />
              </div>
              <span style={{ fontSize: 9, color: "var(--muted)" }}>{repairs.length}</span>
            </div>
          )}
          {finalPrice > 0 && (
            <span style={{ fontSize: 12, fontWeight: 800, color: bg }}>
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
