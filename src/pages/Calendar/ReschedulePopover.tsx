import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { Button } from "../../components/ui";
import { DateTimePicker } from "../../components/DateTimePicker";
import { addDays } from "./model";

/**
 * Bublina „Změnit termín“ u řádku agendy.
 *
 * Rychlé volby (Dnes 17:00, Zítra 10:00, +1 den, Bez termínu) se uloží
 * hned – na to se sem uživatel nejčastěji chodí. Výběr v kalendáři je
 * dvoufázový (vybrat → Uložit), aby klikání po dnech nesypalo zápisy
 * do databáze.
 *
 * Kotví se k tlačítku, ze kterého se otevřela; když se pod ním nevejde,
 * vyskočí nad něj.
 */

type Props = {
  anchor: HTMLElement | null;
  /** Aktuální termín (ISO) nebo null. */
  value: string | null;
  onCommit: (iso: string | null) => void;
  onClose: () => void;
};

const POPOVER_WIDTH = 340;
const POPOVER_EST_HEIGHT = 250;

function computePosition(anchor: HTMLElement | null): { top: number; left: number } | null {
  if (!anchor) return null;
  const rect = anchor.getBoundingClientRect();
  const margin = 12;
  let left = rect.right - POPOVER_WIDTH;
  if (left < margin) left = margin;
  if (left + POPOVER_WIDTH > window.innerWidth - margin) left = window.innerWidth - POPOVER_WIDTH - margin;
  let top = rect.bottom + 6;
  if (top + POPOVER_EST_HEIGHT > window.innerHeight - margin) {
    top = Math.max(margin, rect.top - POPOVER_EST_HEIGHT - 6);
  }
  return { top, left };
}

export function ReschedulePopover({ anchor, value, onCommit, onClose }: Props) {
  const [draft, setDraft] = useState<string | null>(value);
  // Kotva se po otevření nemění (bublina se pro každý řádek znovu připojí),
  // takže se poloha spočítá jednou při vzniku a nepotřebuje efekt.
  const [pos] = useState(() => computePosition(anchor));

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  const commit = (iso: string | null) => {
    onCommit(iso);
    onClose();
  };

  const quickToday = () => {
    const t = new Date();
    t.setHours(17, 0, 0, 0);
    commit(t.toISOString());
  };
  const quickTomorrow = () => {
    const t = addDays(new Date(), 1);
    t.setHours(10, 0, 0, 0);
    commit(t.toISOString());
  };
  const quickPlusDay = () => {
    const base = value ? new Date(value) : new Date();
    commit(addDays(base, 1).toISOString());
  };
  const quickClear = () => commit(null);

  const dirty = draft !== value;

  return createPortal(
    <>
      <div
        role="presentation"
        style={{ position: "fixed", inset: 0, zIndex: 9998 }}
        onClick={onClose}
      />
      <div
        role="dialog"
        aria-label="Změnit termín"
        style={{
          position: "fixed",
          top: pos?.top ?? 0,
          left: pos?.left ?? 0,
          width: POPOVER_WIDTH,
          zIndex: 9999,
          padding: "var(--space-3)",
          background: "var(--panel)",
          border: "1px solid var(--border)",
          borderRadius: "var(--radius-sm)",
          boxShadow: "0 12px 32px rgba(0,0,0,0.16)",
          display: "flex",
          flexDirection: "column",
          gap: "var(--space-3)",
          visibility: pos ? "visible" : "hidden",
        }}
      >
        <div
          style={{
            fontSize: "var(--text-xs)",
            fontWeight: 700,
            color: "var(--muted)",
            textTransform: "uppercase",
            letterSpacing: "0.04em",
          }}
        >
          Změnit termín
        </div>

        <div style={{ display: "flex", gap: "var(--space-1)", flexWrap: "wrap" }}>
          <Button size="sm" variant="soft" onClick={quickToday}>Dnes 17:00</Button>
          <Button size="sm" variant="soft" onClick={quickTomorrow}>Zítra 10:00</Button>
          <Button size="sm" variant="soft" onClick={quickPlusDay}>+1 den</Button>
          <Button size="sm" variant="ghost" onClick={quickClear} disabled={value === null}>
            Bez termínu
          </Button>
        </div>

        <DateTimePicker
          value={draft}
          onChange={setDraft}
          inputStyle={{ fontSize: "var(--text-base)", padding: "8px 10px" }}
        />

        <div style={{ display: "flex", justifyContent: "flex-end", gap: "var(--space-2)" }}>
          <Button size="sm" variant="ghost" onClick={onClose}>Zrušit</Button>
          <Button size="sm" variant="primary" onClick={() => commit(draft)} disabled={!dirty}>
            Uložit
          </Button>
        </div>
      </div>
    </>,
    document.body
  );
}
