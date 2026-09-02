import { useState, useEffect, useLayoutEffect, useRef } from "react";
import { MenuItem } from "../ui";
import { createPortal } from "react-dom";

type DiscountPickerProps = {
  discountType: "percentage" | "amount" | null;
  discountValue: number;
  onChange: (type: "percentage" | "amount" | null, value: number) => void;
};

export function DiscountPicker({ discountType, discountValue, onChange }: DiscountPickerProps) {
  const [open, setOpen] = useState(false);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ left: 0, top: 0, width: 0, maxHeight: 300 });
  const [inputValue, setInputValue] = useState(String(discountValue || ""));

  useEffect(() => {
    setInputValue(String(discountValue || ""));
  }, [discountValue]);

  const options: Array<{ value: "percentage" | "amount" | null; label: string }> = [
    { value: null, label: "Bez slevy" },
    { value: "percentage", label: "Sleva %" },
    { value: "amount", label: "Sleva (Kč)" },
  ];

  const selected = options.find((o) => o.value === discountType) ?? options[0];

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
        top: openUp ? rect.top - maxHeight - gap : rect.bottom + gap,
        width: rect.width,
        maxHeight,
      });
    }
  }, [open]);

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

  const handleOptionSelect = (type: "percentage" | "amount" | null) => {
    onChange(type, type ? discountValue : 0);
    setOpen(false);
  };

  const handleInputChange = (value: string) => {
    setInputValue(value);
    const numValue = parseFloat(value) || 0;
    onChange(discountType, numValue);
  };

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
      {options.map((opt) => {
        const active = opt.value === discountType;
        return (
          <MenuItem
            layout="between"
            size="md"
            selected={active}
            key={opt.value ?? "none"}
            onClick={() => handleOptionSelect(opt.value)}
          >
            <span>{opt.label}</span>
            {active && <span style={{ marginLeft: "auto", fontSize: 16, opacity: 0.8 }}>✓</span>}
          </MenuItem>
        );
      })}
    </div>
  ) : null;

  const border = "1px solid var(--border)";

  return (
    <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
      <div style={{ position: "relative", flex: discountType ? "0 0 auto" : "1 1 auto" }}>
        <button
          ref={buttonRef}
          type="button"
          onClick={() => setOpen(!open)}
          style={{
            padding: "6px 10px",
            minWidth: 120,
            borderRadius: 6,
            border: open ? "1px solid var(--accent)" : border,
            outline: "none",
            background: open ? "var(--panel-2)" : "var(--panel)",
            backdropFilter: "var(--blur)",
            WebkitBackdropFilter: "var(--blur)",
            color: "var(--text)",
            fontFamily: "system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif",
            fontWeight: 500,
            fontSize: 12,
            cursor: "pointer",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 8,
            boxShadow: open ? "0 0 0 3px var(--accent-soft)" : "var(--shadow-soft)",
            transition: "var(--transition-smooth)",
          }}
          onMouseEnter={(e) => {
            if (!open) e.currentTarget.style.borderColor = "var(--accent)";
          }}
          onMouseLeave={(e) => {
            if (!open) e.currentTarget.style.borderColor = "var(--border)";
          }}
        >
          <span>{selected.label}</span>
          <span style={{ opacity: 0.65, fontWeight: 900, fontSize: 10 }}>▾</span>
        </button>
        {open ? createPortal(menu, document.body) : null}
      </div>

      {discountType && (
        <input
          type="number"
          value={inputValue}
          onChange={(e) => handleInputChange(e.target.value)}
          placeholder={discountType === "percentage" ? "%" : "Kč"}
          style={{
            padding: "6px 10px",
            borderRadius: 6,
            border: border,
            background: "var(--panel)",
            color: "var(--text)",
            fontSize: 12,
            width: 80,
            outline: "none",
            fontFamily: "system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif",
          }}
          onFocus={(e) => {
            e.currentTarget.style.borderColor = "var(--accent)";
            e.currentTarget.style.boxShadow = "0 0 0 3px var(--accent-soft)";
          }}
          onBlur={(e) => {
            e.currentTarget.style.borderColor = "var(--border)";
            e.currentTarget.style.boxShadow = "none";
          }}
        />
      )}
    </div>
  );
}

// ========================
// Modern Status Picker (PORTAL)
// ========================
