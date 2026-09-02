import { useState, useEffect, useLayoutEffect, useRef, type ReactNode } from "react";
import { MenuItem } from "../ui";
import { PrintIcon, DownloadIcon } from "../icons";
import { createPortal } from "react-dom";

export function DocumentActionPicker({
  label,
  onSelect,
}: {
  label: ReactNode;
  onSelect: (action: "print" | "export") => void;
}) {
  const [open, setOpen] = useState(false);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ left: 0, top: 0, width: 0, maxHeight: 300 });

  useLayoutEffect(() => {
    if (open && buttonRef.current) {
      const rect = buttonRef.current.getBoundingClientRect();
      const viewportHeight = window.innerHeight;
      const spaceBelow = viewportHeight - rect.bottom;
      const spaceAbove = rect.top;
      const estimatedMenuHeight = 150;
      const gap = 8;
      const margin = 10;
      const openUp = spaceBelow < estimatedMenuHeight + margin && spaceAbove > spaceBelow;
      const maxHeight = Math.max(100, Math.min(300, openUp ? spaceAbove - gap - margin : spaceBelow - gap - margin));

      setPos({
        left: rect.left,
        top: openUp ? rect.top - estimatedMenuHeight - gap : rect.bottom + gap,
        width: rect.width,
        maxHeight,
      });
    }
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const handleClick = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node) && buttonRef.current && !buttonRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [open]);

  const actions = [
    { value: "print" as const, label: <><PrintIcon size={14} /> Tisk</> },
    { value: "export" as const, label: <><DownloadIcon size={14} /> Export</> },
  ];

  const menu = open ? (
    <div
      ref={menuRef}
      role="listbox"
      style={{
        position: "fixed",
        left: pos.left,
        top: pos.top,
        width: pos.width,
        maxHeight: pos.maxHeight,
        background: "var(--panel)",
        border: "1px solid var(--border)",
        borderRadius: 12,
        boxShadow: "0 10px 25px rgba(0,0,0,0.15)",
        zIndex: 10000,
        overflowY: "auto",
        padding: 4,
      }}
    >
      {actions.map((action) => (
        <MenuItem
          key={action.value}
          onClick={() => {
            onSelect(action.value);
            setOpen(false);
          }}
        >
          {action.label}
        </MenuItem>
      ))}
    </div>
  ) : null;

  return (
    <div style={{ position: "relative" }}>
      <button
        ref={buttonRef}
        type="button"
        onClick={() => setOpen(!open)}
        style={{
          padding: "10px 14px",
          background: "var(--panel)",
          border: "1px solid var(--border)",
          borderRadius: 10,
          color: "var(--text)",
          fontSize: 13,
          fontWeight: 600,
          cursor: "pointer",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 8,
          minWidth: 140,
          boxShadow: open ? "0 0 0 3px var(--accent-soft)" : "var(--shadow-soft)",
          transition: "var(--transition-smooth)",
        }}
        onMouseEnter={(e) => {
          if (!open) e.currentTarget.style.background = "var(--panel-2)";
        }}
        onMouseLeave={(e) => {
          if (!open) e.currentTarget.style.background = "var(--panel)";
        }}
      >
        <span>{label}</span>
        <span style={{ opacity: 0.65, fontWeight: 900, fontSize: 10 }}>▾</span>
      </button>
      {open ? createPortal(menu, document.body) : null}
    </div>
  );
}

// ========================
// PerformedRepairItem Component
// ========================
