/**
 * SMS chat se zákazníkem – vysouvací panel přes detail zakázky.
 * Respektuje polohu postranní lišty (dole / vpravo), aby nebyl překryt.
 * Vyneseno z Orders.tsx beze změny obsahu.
 */
import type React from "react";
import { Button } from "../../components/ui";
import { SmsChat } from "../../components/SmsChat";
import type { TicketEx, UIConfig } from "./typy";

type Props = {
  detailedTicket: TicketEx;
  activeServiceId: string;
  /** Poloha postranní lišty z předvoleb rozhraní (uiCfg.sidebar?.position). */
  sidebarPosition: UIConfig["sidebar"]["position"] | undefined;
  onClose: () => void;
  onInboundMarkedRead: () => void;
};

export function SmsPanel({ detailedTicket, activeServiceId, sidebarPosition, onClose, onInboundMarkedRead }: Props) {
  const sidebarPos = sidebarPosition ?? "left";
  const isSidebarBottom = sidebarPos === "bottom";
  const isSidebarRight = sidebarPos === "right";
  const panelStyle: React.CSSProperties = {
    position: "fixed",
    top: 0,
    right: isSidebarRight ? "var(--sidebar-collapsed)" : 0,
    width: 380,
    maxWidth: "100vw",
    height: isSidebarBottom ? "calc(100dvh / var(--ui-scale, 1) - var(--sidebar-bottom-collapsed))" : "calc(100dvh / var(--ui-scale, 1))",
    background: "var(--panel)",
    borderLeft: "1px solid var(--border)",
    boxShadow: "var(--shadow)",
    zIndex: 1321,
    display: "flex",
    flexDirection: "column",
    transform: "translateX(0)",
    transition: "transform 400ms ease",
  };
  return (
  <>
    <div
      role="presentation"
      onClick={onClose}
      style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.3)", zIndex: 1320 }}
    />
    <div
      style={panelStyle}
      onClick={(e) => e.stopPropagation()}
    >
      <div style={{ flex: "0 0 auto", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, padding: 12, borderBottom: "1px solid var(--border)" }}>
        <div style={{ minWidth: 0, flex: 1 }}>
          <div style={{ fontWeight: 700, fontSize: 15, color: "var(--text)" }}>
            {detailedTicket.customerName?.trim() || "Zákazník"}
          </div>
          <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 2 }}>
            {detailedTicket.code && <span style={{ marginRight: 8 }}>Zakázka {detailedTicket.code}</span>}
            {detailedTicket.customerPhone?.trim() && <span>{detailedTicket.customerPhone.trim()}</span>}
          </div>
        </div>
        <Button variant="soft" onClick={onClose} style={{ width: 36, height: 36 }} aria-label="Zavřít">×</Button>
      </div>
      <div style={{ flex: 1, minHeight: 0, overflow: "hidden" }}>
        <SmsChat
          ticketId={detailedTicket.id}
          serviceId={(detailedTicket as { service_id?: string }).service_id ?? activeServiceId ?? undefined}
          customerPhone={detailedTicket.customerPhone ?? null}
          customerName={detailedTicket.customerName ?? null}
          onInboundMarkedRead={onInboundMarkedRead}
        />
      </div>
    </div>
  </>
  );
}
