import { useState, useEffect, useLayoutEffect, useMemo, useRef } from "react";
import { MenuItem } from "../ui";
import { createPortal } from "react-dom";

type DeviceAutocompleteProps = {
  value: string;
  onChange: (value: string) => void;
  models: Array<{
    id: string;
    name: string;
    fullName: string;
    brandName: string;
    categoryName: string;
  }>;
  error?: boolean;
};

export function DeviceAutocomplete({ value, onChange, models, error }: DeviceAutocompleteProps) {
  const [open, setOpen] = useState(false);
  const [focusedIndex, setFocusedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ left: 0, top: 0, width: 0, maxHeight: 300 });

  const filteredModels = useMemo(() => {
    if (!value.trim()) return models.slice(0, 10);
    const query = value.toLowerCase();
    return models
      .filter(
        (m) =>
          m.fullName.toLowerCase().includes(query) ||
          m.name.toLowerCase().includes(query) ||
          m.brandName.toLowerCase().includes(query) ||
          m.categoryName.toLowerCase().includes(query)
      )
      .slice(0, 10);
  }, [value, models]);

  useLayoutEffect(() => {
    if (open && inputRef.current) {
      const rect = inputRef.current.getBoundingClientRect();
      const viewportHeight = window.innerHeight;
      const spaceBelow = viewportHeight - rect.bottom;
      const spaceAbove = rect.top;
      const estimatedMenuHeight = Math.min(300, filteredModels.length * 50 + 20);
      const gap = 8;
      const margin = 10;
      const openUp = spaceBelow < estimatedMenuHeight + margin && spaceAbove > spaceBelow;
      const maxHeight = Math.max(100, Math.min(300, openUp ? spaceAbove - gap - margin : spaceBelow - gap - margin));
      const actualMenuHeight = Math.min(maxHeight, estimatedMenuHeight);

      setPos({
        left: rect.left,
        top: openUp ? rect.top - actualMenuHeight - gap : rect.bottom + gap,
        width: rect.width,
        maxHeight,
      });
    }
  }, [open, filteredModels.length]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (
        menuRef.current &&
        !menuRef.current.contains(e.target as Node) &&
        inputRef.current &&
        !inputRef.current.contains(e.target as Node)
      ) {
        setOpen(false);
      }
    };
    window.addEventListener("mousedown", onDown);
    return () => window.removeEventListener("mousedown", onDown);
  }, [open]);

  const border = "1px solid var(--border)";
  const borderError = "1px solid rgba(239,68,68,0.9)";

  return (
    <div style={{ position: "relative" }}>
      <input
        ref={inputRef}
        type="text"
        value={value}
        onChange={(e) => {
          onChange(e.target.value);
          setOpen(true);
          setFocusedIndex(0);
        }}
        onFocus={() => setOpen(true)}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown") {
            e.preventDefault();
            setFocusedIndex((prev) => Math.min(prev + 1, filteredModels.length - 1));
            setOpen(true);
          } else if (e.key === "ArrowUp") {
            e.preventDefault();
            setFocusedIndex((prev) => Math.max(prev - 1, 0));
            setOpen(true);
          } else if (e.key === "Enter" && filteredModels[focusedIndex]) {
            e.preventDefault();
            onChange(filteredModels[focusedIndex].fullName);
            setOpen(false);
            inputRef.current?.blur();
          } else if (e.key === "Escape") {
            setOpen(false);
            inputRef.current?.blur();
          }
        }}
        placeholder="Název nebo typ zařízení…"
        style={{
          width: "100%",
          padding: "10px 12px",
          borderRadius: 12,
          border: error ? borderError : border,
          outline: "none",
          background: "var(--panel)",
          color: "var(--text)",
          fontFamily: "system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif",
        }}
      />

      {open &&
        filteredModels.length > 0 &&
        createPortal(
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
            {filteredModels.map((model, idx) => {
              const isFocused = idx === focusedIndex;
              const isSelected = value === model.fullName;

              return (
                <MenuItem
                  highlighted={isFocused || isSelected}
                  key={model.id}
                  onClick={() => {
                    onChange(model.fullName);
                    setOpen(false);
                    inputRef.current?.blur();
                  }}
                  onMouseEnter={() => setFocusedIndex(idx)}
                >
                  <div style={{ fontWeight: isSelected ? 700 : 500 }}>{model.fullName}</div>
                </MenuItem>
              );
            })}
          </div>,
          document.body
        )}
    </div>
  );
}

// ========================
// Repair Picker (custom dropdown)
// ========================
