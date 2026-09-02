import { useState, useEffect, useLayoutEffect, useRef } from "react";
import { MenuItem } from "../ui";
import { createPortal } from "react-dom";

type RepairPickerProps = {
  value: string;
  repairs: Array<{ id: string; name: string; price: number }>;
  placeholder?: string;
  onChange: (repairId: string) => void;
};

export function RepairPicker({ value, repairs, placeholder = "Vyberte opravu...", onChange }: RepairPickerProps) {
  const [open, setOpen] = useState(false);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ left: 0, top: 0, width: 0, maxHeight: 300 });

  const selected = repairs.find((r) => r.id === value);

  useLayoutEffect(() => {
    if (open && buttonRef.current) {
      const rect = buttonRef.current.getBoundingClientRect();
      const viewportHeight = window.innerHeight;
      const spaceBelow = viewportHeight - rect.bottom;
      const spaceAbove = rect.top;

      const estimatedMenuHeight = Math.min(300, repairs.length * 50 + 20);
      const gap = 8;
      const margin = 10;

      const openUp = spaceBelow < estimatedMenuHeight + margin && spaceAbove > spaceBelow;

      const maxHeight = Math.max(100, Math.min(400, openUp ? spaceAbove - gap - margin : spaceBelow - gap - margin));

      setPos({
        left: rect.left,
        top: openUp ? rect.top - maxHeight - gap : rect.bottom + gap,
        width: rect.width,
        maxHeight,
      });
    }
  }, [open, repairs.length]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (
        menuRef.current &&
        !menuRef.current.contains(e.target as Node) &&
        buttonRef.current &&
        !buttonRef.current.contains(e.target as Node)
      ) {
        setOpen(false);
      }
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
      role="listbox"
      style={{
        position: "fixed",
        left: pos.left,
        top: pos.top,
        width: pos.width,
        borderRadius: 14,
        border: "1px solid var(--border)",
        background: "var(--panel)",
        backdropFilter: "var(--blur)",
        WebkitBackdropFilter: "var(--blur)",
        boxShadow: "0 25px 60px rgba(0,0,0,0.22)",
        padding: 6,
        zIndex: 10000,
        maxHeight: pos.maxHeight,
        overflowY: "auto",
      }}
    >
      {repairs.length === 0 ? (
        <div style={{ padding: "12px 14px", color: "var(--muted)", fontSize: 13, textAlign: "center" }}>
          Žádné opravy k dispozici
        </div>
      ) : (
        repairs.map((repair) => {
          const active = repair.id === value;
          return (
            <MenuItem
              layout="between"
              size="md"
              selected={active}
              key={repair.id}
              onClick={() => {
                onChange(repair.id);
                setOpen(false);
              }}
            >
              <span>{repair.name}</span>
              {repair.price > 0 && (
                <span style={{ fontSize: 12, opacity: 0.7, marginLeft: "auto" }}>
                  {repair.price} Kč
                </span>
              )}
              {active && <span style={{ marginLeft: 8, fontSize: 16, opacity: 0.8 }}>✓</span>}
            </MenuItem>
          );
        })
      )}
    </div>
  ) : null;

  const border = "1px solid var(--border)";

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        onClick={() => setOpen(!open)}
        style={{
          width: "100%",
          padding: "12px 40px 12px 14px",
          borderRadius: 12,
          border: open ? "1px solid var(--accent)" : border,
          outline: "none",
          background: open ? "var(--panel-2)" : "var(--panel)",
          backdropFilter: "var(--blur)",
          WebkitBackdropFilter: "var(--blur)",
          color: selected ? "var(--text)" : "var(--muted)",
          fontFamily: "system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif",
          fontWeight: 500,
          fontSize: 14,
          cursor: "pointer",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          boxShadow: open ? "0 0 0 3px var(--accent-soft)" : "var(--shadow-soft)",
          transition: "var(--transition-smooth)",
        }}
        onMouseEnter={(e) => {
          if (!open) e.currentTarget.style.borderColor = "var(--accent)";
          if (!open) e.currentTarget.style.boxShadow = "0 4px 16px var(--accent-glow)";
        }}
        onMouseLeave={(e) => {
          if (!open) e.currentTarget.style.borderColor = "var(--border)";
          if (!open) e.currentTarget.style.boxShadow = "var(--shadow-soft)";
        }}
      >
        <span>{selected ? selected.name : placeholder}</span>
        <span style={{ opacity: 0.65, fontWeight: 900, fontSize: 12 }}>▾</span>
      </button>
      {open ? createPortal(menu, document.body) : null}
    </>
  );
}

// ========================
// Handoff method select (modern dropdown)
// ========================
