import { useEffect, useState, useRef, useCallback } from "react";
import { createPortal } from "react-dom";
import { playSaved, playDeleted, areSoundsEnabled } from "../lib/sounds";
import { resetTauriFetchState } from "../lib/supabaseClient";

type Toast = {
  id: string;
  message: string;
  type?: "success" | "error" | "info";
  isClosing?: boolean;
  persistent?: boolean;
  actionLabel?: string;
  onAction?: () => void;
  /** Druhý řádek (např. náhled SMS) */
  subtitle?: string;
  /** Klik na toast (místo jen zavření) – např. otevřít SMS chat */
  onNavigate?: () => void;
  createdAt: number;
  duration: number;
};

let toastId = 0;
const toasts: Toast[] = [];
const listeners: Set<() => void> = new Set();

function notify() {
  listeners.forEach((fn) => fn());
}

function playToastSound(type: "success" | "error" | "info") {
  if (!areSoundsEnabled()) return;
  if (type === "success") playSaved();
  if (type === "error") playDeleted();
}

const NETWORK_MODULE_ERR = "Nelze načíst síťový modul";

export function showToast(message: string, type: "success" | "error" | "info" = "success") {
  playToastSound(type);

  if (type === "error" && message.includes(NETWORK_MODULE_ERR)) {
    showPersistentToast(message, "error", {
      actionLabel: "Zkusit znovu",
      onAction: () => resetTauriFetchState(),
    });
    return;
  }

  const id = `toast-${++toastId}`;
  toasts.push({ id, message, type, createdAt: Date.now(), duration: 3000 });
  notify();
}

/** Příchozí SMS: náhled + klik otevře chat */
export function showIncomingSmsToast(title: string, bodyPreview: string, onOpenChat: () => void) {
  if (areSoundsEnabled()) playSaved();
  const id = `toast-${++toastId}`;
  toasts.push({
    id,
    message: title,
    subtitle: bodyPreview,
    type: "info",
    onNavigate: onOpenChat,
    createdAt: Date.now(),
    duration: 10000,
  });
  notify();
}

export function showPersistentToast(
  message: string,
  type: "success" | "error" | "info",
  options: { actionLabel: string; onAction: () => void }
): string {
  playToastSound(type);
  const id = `toast-${++toastId}`;
  toasts.push({
    id,
    message,
    type,
    persistent: true,
    actionLabel: options.actionLabel,
    onAction: options.onAction,
    createdAt: Date.now(),
    duration: 0,
  });
  notify();
  return id;
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
  const isClosing = toast.isClosing ?? false;
  const isSuccess = toast.type === "success";
  const isError = toast.type === "error";
  const isPersistent = toast.persistent === true;
  // Pozadí toastu. Text je bílý, takže se používají TMAVŠÍ varianty stavových
  // barev – syté odstíny mají pod bílým textem kontrast jen 2,5:1 (zelená)
  // a 3,8:1 (červená), tedy pod hranicí čitelnosti. Tmavší dávají 5,0:1 a 6,5:1.
  // Používají se -strong (ne -text): -text se přizpůsobuje pozadí motivu
  // a v tmavém režimu je světlý, což by pod bílým písmem propadlo.
  const bg = isSuccess
    ? "var(--success-strong)"
    : isError
      ? "var(--danger-strong)"
      : "var(--accent)";

  const [hovered, setHovered] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const remainingRef = useRef(toast.duration);
  // Nastaví se v scheduleRemoval; Date.now() nesmí být volané během renderu.
  const lastTickRef = useRef(0);

  const scheduleRemoval = useCallback(() => {
    if (isPersistent || remainingRef.current <= 0) return;
    lastTickRef.current = Date.now();
    timerRef.current = setTimeout(() => {
      removeToast(toast.id);
    }, remainingRef.current);
  }, [toast.id, isPersistent]);

  useEffect(() => {
    if (isPersistent) return;
    remainingRef.current = toast.duration;
    scheduleRemoval();
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [toast.id, toast.duration, isPersistent, scheduleRemoval]);

  useEffect(() => {
    if (isPersistent) return;
    if (hovered) {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
      const elapsed = Date.now() - lastTickRef.current;
      remainingRef.current = Math.max(0, remainingRef.current - elapsed);
    } else {
      if (remainingRef.current > 0) {
        scheduleRemoval();
      } else {
        removeToast(toast.id);
      }
    }
  }, [hovered, isPersistent, toast.id, scheduleRemoval]);

  const handleAnimationEnd = (e: React.AnimationEvent) => {
    if (e.animationName === "toastSlideOut" && isClosing) {
      removeToast(toast.id);
    }
  };

  const dismiss = () => {
    if (isClosing) return;
    removeToast(toast.id);
  };

  const handleToastClick = () => {
    if (toast.onNavigate) {
      toast.onNavigate();
      removeToast(toast.id);
      return;
    }
    dismiss();
  };

  const handleAction = (e: React.MouseEvent) => {
    e.stopPropagation();
    toast.onAction?.();
    removeToast(toast.id);
  };

  return (
    <div
      role={isPersistent ? "alert" : "button"}
      tabIndex={0}
      onAnimationEnd={handleAnimationEnd}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onClick={isPersistent ? undefined : handleToastClick}
      onKeyDown={isPersistent ? undefined : (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); handleToastClick(); } }}
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
        cursor: isPersistent ? "default" : "pointer",
        userSelect: "text",
        WebkitUserSelect: "text",
      }}
      title={isPersistent ? undefined : toast.onNavigate ? "Kliknutím otevřít chat" : "Kliknutím zavřete"}
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
      <span style={{ flex: 1, userSelect: "text" }}>
        {toast.subtitle ? (
          <div style={{ display: "flex", flexDirection: "column", gap: 4, textAlign: "left" }}>
            <div style={{ fontWeight: 700 }}>{toast.message}</div>
            <div style={{ fontSize: 13, opacity: 0.92, lineHeight: 1.35, wordBreak: "break-word" }}>{toast.subtitle}</div>
          </div>
        ) : (
          toast.message
        )}
      </span>
      {isPersistent && toast.actionLabel && (
        <button
          type="button"
          onClick={handleAction}
          style={{
            flexShrink: 0,
            padding: "6px 12px",
            borderRadius: 8,
            border: "none",
            background: "rgba(255,255,255,0.25)",
            color: "inherit",
            fontSize: 13,
            fontWeight: 600,
            cursor: "pointer",
          }}
        >
          {toast.actionLabel}
        </button>
      )}
    </div>
  );
}
