import { createPortal } from "react-dom";
import { Button, MenuItem } from "../ui";
import { PinIcon } from "../icons";
import type { Branch } from "../../lib/branches";

/**
 * Přesun zakázky na jinou pobočku – seznam poboček v malém dialogu.
 * Číslo zakázky se nemění (zůstává historie), mění se jen místo, filtr
 * a údaje pobočky na dokumentech.
 */
export function BranchPickerDialog({
  open,
  branches,
  currentId,
  onSelect,
  onClose,
  title = "Přesunout na pobočku",
}: {
  open: boolean;
  branches: Branch[];
  currentId: string | null | undefined;
  onSelect: (branch: Branch) => void;
  onClose: () => void;
  title?: string;
}) {
  if (!open) return null;
  return createPortal(
    <div
      role="dialog"
      aria-label={title}
      style={{ position: "fixed", inset: 0, zIndex: 10000, display: "flex", alignItems: "center", justifyContent: "center", background: "rgba(0,0,0,0.4)", padding: 24 }}
      onClick={onClose}
    >
      <div
        style={{ background: "var(--panel)", border: "1px solid var(--border)", borderRadius: "var(--radius-lg)", boxShadow: "var(--shadow-soft)", maxWidth: 380, width: "100%", maxHeight: "80vh", overflow: "hidden", display: "flex", flexDirection: "column", color: "var(--text)" }}
        onClick={(e) => e.stopPropagation()}
      >
        <div style={{ padding: "14px 16px 10px", borderBottom: "1px solid var(--border)", display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ color: "var(--accent)", display: "inline-flex" }}><PinIcon size={16} /></span>
          <div style={{ fontWeight: 800, flex: 1 }}>{title}</div>
          <Button variant="soft" size="sm" onClick={onClose} aria-label="Zavřít">×</Button>
        </div>
        <div style={{ padding: 8, overflowY: "auto", display: "flex", flexDirection: "column", gap: 2 }}>
          {branches.map((b) => (
            <MenuItem
              key={b.id}
              layout="row"
              selected={b.id === currentId}
              onClick={() => { if (b.id !== currentId) onSelect(b); onClose(); }}
            >
              <span style={{ flex: 1, minWidth: 0 }}>
                <span style={{ display: "block", fontWeight: 600 }}>{b.name}</span>
                {(b.addressCity || b.addressStreet) && (
                  <span style={{ display: "block", fontSize: "var(--text-xs)", color: "var(--muted)" }}>{[b.addressStreet, b.addressCity].filter(Boolean).join(", ")}</span>
                )}
              </span>
              {b.id === currentId && <span style={{ fontSize: "var(--text-sm)" }}>✓</span>}
            </MenuItem>
          ))}
        </div>
      </div>
    </div>,
    document.body,
  );
}
