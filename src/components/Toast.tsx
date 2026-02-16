import { useEffect, useState } from "react";
import { createPortal } from "react-dom";

type Toast = {
  id: string;
  message: string;
  type?: "success" | "error" | "info";
  isClosing?: boolean;
};

let toastId = 0;
const toasts: Toast[] = [];
const listeners: Set<() => void> = new Set();

function notify() {
  listeners.forEach((fn) => fn());
}

export function showToast(message: string, type: "success" | "error" | "info" = "success") {
  const id = `toast-${++toastId}`;
  toasts.push({ id, message, type });
  notify();

  setTimeout(() => {
    const idx = toasts.findIndex((t) => t.id === id);
    if (idx >= 0) {
      toasts.splice(idx, 1);
      notify();
    }
  }, 3000);
}

export function removeToast(id: string) {
  const idx = toasts.findIndex((t) => t.id === id);
  if (idx >= 0) {
    toasts.splice(idx, 1);
    notify();
  }
}

export function ToastContainer() {
  const [, forceUpdate] = useState(0);

  useEffect(() => {
    const listener = () => forceUpdate((n) => n + 1);
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  }, []);

  if (toasts.length === 0) return null;

  return createPortal(
    <div
      style={{
        position: "fixed",
        top: 20,
        right: 20,
        zIndex: 10000,
        display: "flex",
        flexDirection: "column",
        gap: 12,
        pointerEvents: "none",
      }}
    >
      {toasts.map((toast) => (
        <ToastItem key={toast.id} toast={toast} />
      ))}
    </div>,
    document.body
  );
}

function ToastItem({ toast }: { toast: Toast }) {
  const [isClosing, setIsClosing] = useState(toast.isClosing || false);
  const isSuccess = toast.type === "success";
  const isError = toast.type === "error";
  const bg = isSuccess ? "#10b981" : isError ? "#ef4444" : "var(--accent)";

  const handleAnimationEnd = (e: React.AnimationEvent) => {
    if (e.animationName === "toastSlideOut" && isClosing) {
      removeToast(toast.id);
    }
  };

  return (
    <div
      onAnimationEnd={handleAnimationEnd}
      style={{
        background: bg,
        color: isSuccess || isError ? "white" : "var(--accent-fg)",
        padding: "14px 18px",
        borderRadius: 12,
        boxShadow: "0 8px 24px rgba(0,0,0,0.2)",
        display: "flex",
        alignItems: "center",
        gap: 12,
        minWidth: 280,
        maxWidth: 400,
        pointerEvents: "auto",
        fontFamily: "system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif",
        fontSize: 14,
        fontWeight: 500,
        animation: isClosing || toast.isClosing ? "toastSlideOut 0.3s ease-in forwards" : "toastSlideIn 0.3s ease-out",
        cursor: "default",
        userSelect: "text",
        WebkitUserSelect: "text",
      }}
    >
      {isSuccess && (
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
          <polyline points="20 6 9 17 4 12" />
        </svg>
      )}
      {isError && (
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="12" cy="12" r="10" />
          <line x1="12" y1="8" x2="12" y2="12" />
          <line x1="12" y1="16" x2="12.01" y2="16" />
        </svg>
      )}
      {!isSuccess && !isError && (
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="12" cy="12" r="10" />
          <line x1="12" y1="16" x2="12" y2="12" />
          <line x1="12" y1="8" x2="12.01" y2="8" />
        </svg>
      )}
      <span style={{ flex: 1, userSelect: "text" }}>{toast.message}</span>
    </div>
  );
}

