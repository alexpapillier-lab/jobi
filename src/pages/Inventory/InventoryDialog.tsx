import { useEffect, useRef, type ReactNode, type RefObject } from "react";
import { createPortal } from "react-dom";
import { Button } from "../../components/ui";
import { XIcon } from "../../components/icons";

/**
 * Modální okno pro stránku Sklad (naskladnění, nový produkt).
 *
 * Vlastní místo ConfirmDialogu: ten má pevný text a dvě tlačítka, tady je
 * potřeba libovolný obsah s posuvníkem. Escape zavírá (posluchač je v
 * bublající fázi, takže vnořené pole může Escape zastavit přes
 * stopPropagation a jen zrušit vlastní úpravu). Po otevření dostane fokus
 * `initialFocusRef`, jinak samotný panel.
 */
export function InventoryDialog({
  open,
  title,
  subtitle,
  onClose,
  children,
  width = 640,
  initialFocusRef,
}: {
  open: boolean;
  title: ReactNode;
  subtitle?: ReactNode;
  onClose: () => void;
  children: ReactNode;
  width?: number;
  initialFocusRef?: RefObject<HTMLElement | null>;
}) {
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !e.defaultPrevented) {
        e.preventDefault();
        onClose();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  useEffect(() => {
    if (!open) return;
    const el = initialFocusRef?.current ?? panelRef.current;
    const t = window.setTimeout(() => el?.focus(), 0);
    return () => window.clearTimeout(t);
  }, [open, initialFocusRef]);

  if (!open) return null;

  return createPortal(
    <div
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.5)",
        display: "flex",
        alignItems: "flex-start",
        justifyContent: "center",
        padding: "var(--space-6) var(--space-4)",
        zIndex: 9000,
        overflowY: "auto",
      }}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={typeof title === "string" ? title : undefined}
        tabIndex={-1}
        style={{
          background: "var(--panel)",
          border: "1px solid var(--border)",
          borderRadius: "var(--radius-lg)",
          boxShadow: "0 25px 60px rgba(0,0,0,0.3)",
          width: "100%",
          maxWidth: width,
          maxHeight: "calc(100vh / var(--ui-scale, 1) - 2 * var(--space-6))",
          display: "flex",
          flexDirection: "column",
          outline: "none",
          color: "var(--text)",
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "flex-start",
            gap: "var(--space-3)",
            padding: "var(--space-4) var(--space-5)",
            borderBottom: "1px solid var(--border)",
          }}
        >
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontWeight: 950, fontSize: "var(--text-lg)", color: "var(--text)" }}>{title}</div>
            {subtitle && (
              <div style={{ fontSize: "var(--text-sm)", color: "var(--muted)", marginTop: "var(--space-1)" }}>{subtitle}</div>
            )}
          </div>
          <Button variant="ghost" size="sm" iconOnly aria-label="Zavřít" icon={<XIcon size={16} />} onClick={onClose} />
        </div>
        <div style={{ padding: "var(--space-5)", overflowY: "auto", minHeight: 0 }}>{children}</div>
      </div>
    </div>,
    document.body,
  );
}
