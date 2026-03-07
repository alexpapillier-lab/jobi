import { useState, useEffect, useCallback } from "react";
import { createPortal } from "react-dom";
import { normalizeError } from "../utils/errorNormalizer";

type ConfirmDialogProps = {
  open: boolean;
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  onConfirm: () => Promise<void> | void;
  onCancel?: () => void;
  variant?: "default" | "danger";
};

export function ConfirmDialog({
  open,
  title,
  message,
  confirmLabel = "Potvrdit",
  cancelLabel = "Zrušit",
  onConfirm,
  onCancel,
  variant = "default",
}: ConfirmDialogProps) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) {
      setError(null);
      setPending(false);
    }
  }, [open]);

  const handleConfirm = useCallback(async () => {
    setPending(true);
    setError(null);
    try {
      await onConfirm();
    } catch (err) {
      const errorMessage = normalizeError(err);
      setError(errorMessage);
      setPending(false);
    }
  }, [onConfirm]);

  const handleCancel = useCallback(() => {
    if (onCancel) onCancel();
  }, [onCancel]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        handleCancel();
      } else if (e.key === "Enter") {
        e.preventDefault();
        if (!pending) handleConfirm();
      }
    };
    document.addEventListener("keydown", onKey, true);
    return () => document.removeEventListener("keydown", onKey, true);
  }, [open, pending, handleCancel, handleConfirm]);

  if (!open) return null;

  const overlay = (
    <div
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.5)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 10000,
      }}
      onClick={handleCancel}
    >
      <div
        style={{
          background: "var(--panel)",
          borderRadius: 16,
          padding: 24,
          maxWidth: 400,
          width: "90%",
          boxShadow: "0 25px 60px rgba(0,0,0,0.3)",
          border: "1px solid var(--border)",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div style={{ fontWeight: 900, fontSize: 18, marginBottom: 12, color: "var(--text)" }}>
          {title}
        </div>
        <div style={{ fontSize: 14, color: "var(--muted)", marginBottom: 20 }}>{message}</div>
        {error && (
          <div style={{ color: "rgba(239,68,68,0.9)", fontSize: 13, marginBottom: 16, padding: 12, background: "rgba(239,68,68,0.1)", borderRadius: 8 }}>
            {error}
          </div>
        )}
        <div style={{ display: "flex", gap: 12, justifyContent: "flex-end" }}>
          <button
            onClick={handleCancel}
            disabled={pending}
            style={{
              padding: "10px 20px",
              borderRadius: 10,
              border: "1px solid var(--border)",
              background: "var(--panel)",
              color: "var(--text)",
              fontSize: 14,
              fontWeight: 700,
              cursor: pending ? "not-allowed" : "pointer",
              opacity: pending ? 0.5 : 1,
            }}
          >
            {cancelLabel}
          </button>
          <button
            onClick={handleConfirm}
            disabled={pending}
            style={{
              padding: "10px 20px",
              borderRadius: 10,
              border: "none",
              background: variant === "danger" ? "rgba(239,68,68,0.9)" : "var(--accent)",
              color: "white",
              fontSize: 14,
              fontWeight: 900,
              cursor: pending ? "not-allowed" : "pointer",
              opacity: pending ? 0.5 : 1,
              display: "flex",
              alignItems: "center",
              gap: 8,
            }}
          >
            {pending && (
              <span style={{ width: 14, height: 14, border: "2px solid white", borderTopColor: "transparent", borderRadius: "50%", animation: "spin 0.6s linear infinite" }} />
            )}
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );

  return createPortal(overlay, document.body);
}

