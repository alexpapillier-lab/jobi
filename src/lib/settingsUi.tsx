import { useState, useEffect, useRef, useLayoutEffect } from "react";
import { createPortal } from "react-dom";

export function Card({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        background: "var(--panel)",
        backdropFilter: "var(--blur)",
        WebkitBackdropFilter: "var(--blur)",
        border: "1px solid var(--border)",
        borderRadius: "var(--radius-lg)",
        padding: 16,
        boxShadow: "var(--shadow-soft)",
        color: "var(--text)",
      }}
    >
      {children}
    </div>
  );
}

export function FieldLabel({ children }: { children: string }) {
  return <div style={{ color: "var(--muted)", fontSize: 12, paddingTop: 10 }}>{children}</div>;
}

export function TextInput(props: React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      {...props}
      style={{
        width: "100%",
        padding: "10px 12px",
        borderRadius: 12,
        border: "1px solid var(--border)",
        background: "var(--panel)",
        backdropFilter: "var(--blur)",
        WebkitBackdropFilter: "var(--blur)",
        color: "var(--text)",
        outline: "none",
        transition: "var(--transition-smooth)",
        boxShadow: "var(--shadow-soft)",
        ...props.style,
      }}
    />
  );
}

export function LanguagePicker({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  const [open, setOpen] = useState(false);
  const buttonRef = useRef<HTMLButtonElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);

  const options = [
    { value: "cs", label: "Čeština" },
    { value: "sk", label: "Slovenština" },
    { value: "en", label: "Angličtina" },
  ];

  const selected = options.find((o) => o.value === value) || options[0];

  useEffect(() => {
    if (!open) return;

    const handleClick = (e: MouseEvent) => {
      if (
        menuRef.current &&
        !menuRef.current.contains(e.target as Node) &&
        buttonRef.current &&
        !buttonRef.current.contains(e.target as Node)
      ) {
        setOpen(false);
      }
    };

    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };

    document.addEventListener("mousedown", handleClick);
    document.addEventListener("keydown", handleEscape);
    return () => {
      document.removeEventListener("mousedown", handleClick);
      document.removeEventListener("keydown", handleEscape);
    };
  }, [open]);

  useLayoutEffect(() => {
    if (!open || !buttonRef.current || !menuRef.current) return;

    const btnRect = buttonRef.current.getBoundingClientRect();
    const menu = menuRef.current;
    const menuHeight = menu.scrollHeight;
    const spaceBelow = window.innerHeight - btnRect.bottom;
    const spaceAbove = btnRect.top;

    let top = btnRect.bottom + 8;
    let maxHeight = Math.min(300, spaceBelow - 16);

    if (spaceBelow < menuHeight && spaceAbove > spaceBelow) {
      top = btnRect.top - menuHeight - 8;
      maxHeight = Math.min(300, spaceAbove - 16);
    }

    menu.style.top = `${top}px`;
    menu.style.left = `${btnRect.left}px`;
    menu.style.width = `${btnRect.width}px`;
    menu.style.maxHeight = `${maxHeight}px`;
  }, [open]);

  const border = "1px solid var(--border)";

  const menu = open ? (
    <div
      ref={menuRef}
      role="listbox"
      style={{
        position: "fixed",
        borderRadius: 14,
        border: "1px solid var(--border)",
        background: "var(--panel)",
        boxShadow: "0 25px 60px rgba(0,0,0,0.22)",
        padding: 6,
        zIndex: 10000,
        overflowY: "auto",
      }}
    >
      {options.map((opt) => {
        const active = opt.value === value;
        return (
          <button
            key={opt.value}
            type="button"
            onClick={() => {
              onChange(opt.value);
              setOpen(false);
            }}
            style={{
              width: "100%",
              textAlign: "left",
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              gap: 10,
              padding: "12px 14px",
              borderRadius: 12,
              border: "none",
              background: active ? "var(--accent-soft)" : "transparent",
              cursor: "pointer",
              color: active ? "var(--accent)" : "var(--text)",
              fontFamily: "system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif",
              fontWeight: active ? 700 : 500,
              fontSize: 14,
              transition: "var(--transition-smooth)",
            }}
            onMouseEnter={(e) => {
              if (!active) e.currentTarget.style.background = "var(--panel-2)";
            }}
            onMouseLeave={(e) => {
              if (!active) e.currentTarget.style.background = "transparent";
            }}
          >
            <span>{opt.label}</span>
            {active && <span style={{ marginLeft: "auto", fontSize: 16, opacity: 0.8 }}>✓</span>}
          </button>
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
          width: "100%",
          padding: "10px 40px 10px 12px",
          borderRadius: 12,
          border: open ? "1px solid var(--accent)" : border,
          outline: "none",
          background: open ? "var(--panel-2)" : "var(--panel)",
          backdropFilter: "var(--blur)",
          WebkitBackdropFilter: "var(--blur)",
          color: "var(--text)",
          fontFamily: "system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif",
          fontWeight: 500,
          fontSize: 13,
          cursor: "pointer",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          boxShadow: open ? "0 0 0 3px var(--accent-soft)" : "var(--shadow-soft)",
          transition: "var(--transition-smooth)",
        }}
      >
        <span>{selected.label}</span>
        <span style={{ opacity: 0.65, fontWeight: 900, fontSize: 12 }}>▾</span>
      </button>
      {open ? createPortal(menu, document.body) : null}
    </>
  );
}

