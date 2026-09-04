import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Button } from "../ui/Button";
import { MenuItem } from "../ui/MenuItem";
import { MoreIcon } from "../icons";

export type OverflowMenuItem = {
  label: ReactNode;
  icon?: ReactNode;
  danger?: boolean;
  /** Oddělovací linka nad položkou. */
  dividerBefore?: boolean;
  disabled?: boolean;
  title?: string;
  onSelect: () => void;
};

/**
 * Tlačítko „⋯“ s malou nabídkou méně častých akcí (Historie, Smazat…).
 *
 * Nabídka se vykresluje do document.body s `position: fixed` (stejně jako
 * DocumentActionPicker), aby ji neořízl rodič s overflow.
 */
export function OverflowMenu({
  items,
  ariaLabel = "Další akce",
  size = "md",
}: {
  items: OverflowMenuItem[];
  ariaLabel?: string;
  size?: "sm" | "md";
}) {
  const [open, setOpen] = useState(false);
  const btnRef = useRef<HTMLSpanElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ left: 0, top: 0 });

  const MENU_WIDTH = 220;

  useLayoutEffect(() => {
    if (!open || !btnRef.current) return;
    const r = btnRef.current.getBoundingClientRect();
    const margin = 10;
    const gap = 6;
    const estimated = 48 * items.length + 12;
    const openUp = window.innerHeight - r.bottom < estimated + margin && r.top > window.innerHeight - r.bottom;
    let left = r.right - MENU_WIDTH;
    left = Math.max(margin, Math.min(left, window.innerWidth - MENU_WIDTH - margin));
    setPos({ left, top: openUp ? Math.max(margin, r.top - gap - estimated) : r.bottom + gap });
  }, [open, items.length]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (menuRef.current?.contains(t) || btnRef.current?.contains(t)) return;
      setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("mousedown", onDown);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("mousedown", onDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const menu = open ? (
    <div
      ref={menuRef}
      role="menu"
      style={{
        position: "fixed",
        left: pos.left,
        top: pos.top,
        width: MENU_WIDTH,
        background: "var(--panel)",
        border: "1px solid var(--border)",
        borderRadius: 12,
        boxShadow: "0 10px 25px rgba(0,0,0,0.15)",
        zIndex: 10000,
        padding: 4,
      }}
    >
      {items.map((it, i) => (
        <div key={i} style={it.dividerBefore ? { borderTop: "1px solid var(--border)", marginTop: 4, paddingTop: 4 } : undefined}>
          <MenuItem
            layout="row"
            role="menuitem"
            variant={it.danger ? "danger" : "default"}
            disabled={it.disabled}
            title={it.title}
            onClick={() => {
              setOpen(false);
              it.onSelect();
            }}
          >
            {it.icon && <span style={{ display: "inline-flex", flex: "0 0 auto" }}>{it.icon}</span>}
            <span>{it.label}</span>
          </MenuItem>
        </div>
      ))}
    </div>
  ) : null;

  return (
    <>
      <span ref={btnRef} style={{ display: "inline-flex", flex: "0 0 auto" }}>
      <Button
        variant="soft"
        size={size}
        iconOnly
        icon={<MoreIcon size={16} />}
        aria-label={ariaLabel}
        title={ariaLabel}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      />
      </span>
      {open ? createPortal(menu, document.body) : null}
    </>
  );
}
