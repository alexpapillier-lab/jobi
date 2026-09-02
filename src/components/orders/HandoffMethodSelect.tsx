import React, { useState, useEffect, useLayoutEffect, useRef } from "react";
import { MenuItem } from "../ui";
import { createPortal } from "react-dom";

type HandoffMethodSelectProps = {
  options: string[];
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  extraOption?: string;
  triggerStyle?: React.CSSProperties;
};

export function HandoffMethodSelect({ options, value, onChange, placeholder = "—", extraOption, triggerStyle }: HandoffMethodSelectProps) {
  const [open, setOpen] = useState(false);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ left: 0, top: 0, width: 0, maxHeight: 280 });

  const displayValue = value || placeholder;
  const listOptions = [
    ...(extraOption && !options.includes(extraOption) ? [extraOption] : []),
    ...options,
  ];

  useLayoutEffect(() => {
    if (open && buttonRef.current) {
      const rect = buttonRef.current.getBoundingClientRect();
      const viewportHeight = window.innerHeight;
      const spaceBelow = viewportHeight - rect.bottom;
      const spaceAbove = rect.top;
      const estimatedHeight = Math.min(280, listOptions.length * 48 + 24);
      const gap = 8;
      const margin = 10;
      const openUp = spaceBelow < estimatedHeight + margin && spaceAbove > spaceBelow;
      const maxHeight = Math.max(120, Math.min(280, openUp ? spaceAbove - gap - margin : spaceBelow - gap - margin));
      setPos({
        left: rect.left,
        top: openUp ? rect.top - maxHeight - gap : rect.bottom + gap,
        width: rect.width,
        maxHeight,
      });
    }
  }, [open, listOptions.length]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node) && buttonRef.current && !buttonRef.current.contains(e.target as Node)) {
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

  const border = "1px solid var(--border)";
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
        boxShadow: "0 16px 48px rgba(0,0,0,0.18)",
        padding: 6,
        zIndex: 10000,
        maxHeight: pos.maxHeight,
        overflowY: "auto",
      }}
    >
      <MenuItem
        size="md"
        selected={!value}
        onClick={() => { onChange(""); setOpen(false); }}
      >
        {placeholder}
      </MenuItem>
      {listOptions.map((opt, i) => {
        const active = opt === value;
        return (
          <MenuItem
            size="md"
            selected={active}
            key={i}
            onClick={() => { onChange(opt); setOpen(false); }}
          >
            {opt}
          </MenuItem>
        );
      })}
    </div>
  ) : null;

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        onClick={() => setOpen(!open)}
        style={{
          ...triggerStyle,
          width: "100%",
          padding: "10px 36px 10px 12px",
          borderRadius: 12,
          border: open ? "1px solid var(--accent)" : border,
          outline: "none",
          background: open ? "var(--panel-2)" : "var(--panel)",
          backdropFilter: "var(--blur)",
          WebkitBackdropFilter: "var(--blur)",
          color: "var(--text)",
          fontFamily: "system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif",
          fontSize: 13,
          cursor: "pointer",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          boxShadow: open ? "0 0 0 3px var(--accent-soft)" : "var(--shadow-soft)",
          transition: "var(--transition-smooth)",
        }}
        onMouseEnter={(e) => {
          if (!open) { e.currentTarget.style.borderColor = "var(--accent)"; e.currentTarget.style.boxShadow = "0 4px 12px rgba(0,0,0,0.08)"; }
        }}
        onMouseLeave={(e) => {
          if (!open) { e.currentTarget.style.borderColor = ""; e.currentTarget.style.boxShadow = ""; }
        }}
      >
        <span style={{ color: value ? "var(--text)" : "var(--muted)" }}>{displayValue}</span>
        <span style={{ opacity: 0.6, fontSize: 10, marginLeft: 8 }}>▾</span>
      </button>
      {open ? createPortal(menu, document.body) : null}
    </>
  );
}

// ========================
// Discount Picker (custom dropdown)
// ========================
