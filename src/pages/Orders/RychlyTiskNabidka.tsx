/**
 * Nabídka rychlého tisku pod tlačítkem tiskárny na kartě v seznamu zakázek.
 * Vyneseno z Orders.tsx beze změny obsahu.
 */
import { createPortal } from "react-dom";
import type { TicketEx } from "./typy";
import { quickPrintFromList } from "./tiskZakazky";

type Props = {
  ticket: TicketEx;
  /** Poloha tlačítka, pod kterým se nabídka otevírá (z getBoundingClientRect). */
  rect: { top: number; left: number; right: number; height: number };
  activeServiceId: string | null;
  onClose: () => void;
};

export function RychlyTiskNabidka({ ticket, rect, activeServiceId, onClose }: Props) {
  const dropdownWidth = 200;
  const margin = 8;
  let left = rect.left;
  if (left + dropdownWidth > window.innerWidth - margin) left = rect.right - dropdownWidth;
  if (left < margin) left = margin;
  const top = rect.top + 6;
  const maxBottom = window.innerHeight - margin;
  return createPortal(
  <div
    data-quick-print-menu
    role="listbox"
    style={{
      position: "fixed",
      left,
      top: Math.min(top, maxBottom - 120),
      minWidth: dropdownWidth,
      maxHeight: Math.min(240, window.innerHeight - top - margin),
      overflowY: "auto",
      background: "var(--panel)",
      border: "1px solid var(--border)",
      borderRadius: 12,
      boxShadow: "0 10px 25px rgba(0,0,0,0.15)",
      zIndex: 10001,
      padding: 6,
    }}
  >
    {[
      { type: "ticket" as const, label: "Zakázkový list" },
      { type: "warranty" as const, label: "Záruční list" },
      ...((ticket.diagnosticText?.trim() || (ticket.diagnosticPhotos && ticket.diagnosticPhotos.length > 0)) ? [{ type: "diagnostic" as const, label: "Diagnostický protokol" }] : []),
    ].map(({ type, label }) => (
      <button
        key={type}
        type="button"
        onClick={(e) => { e.stopPropagation(); onClose(); quickPrintFromList(ticket, type, activeServiceId); }}
        style={{ display: "block", width: "100%", padding: "10px 14px", textAlign: "left", border: "none", background: "none", borderRadius: 8, cursor: "pointer", fontSize: 13, color: "var(--text)" }}
      >
        {label}
      </button>
    ))}
  </div>,
  document.body
);
}
