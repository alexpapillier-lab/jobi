import { useEffect, useState, useRef, useCallback } from "react";
import { createPortal } from "react-dom";
import { playSaved, playDeleted, playAchievementUnlock, areSoundsEnabled } from "../lib/sounds";
import { resetTauriFetchState } from "../lib/supabaseClient";
import { TrophyIcon } from "./TrophyIcon";
import type { TrophyTier } from "../lib/achievements";

type Toast = {
  id: string;
  message: string;
  type?: "success" | "error" | "info" | "achievement";
  isClosing?: boolean;
  persistent?: boolean;
  actionLabel?: string;
  onAction?: () => void;
  achievement?: { title: string; description: string; trophy: TrophyTier };
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

export function showDemoAchievementToast() {
  playAchievementUnlock();
  const id = `toast-ach-demo-${++toastId}`;
  toasts.push({
    id,
    message: "Ukázkový achievement",
    type: "achievement",
    achievement: {
      title: "Ukázkový achievement",
      description: "Tohle je jen demo. Skutečné achievementy získáte plněním úkolů.",
      trophy: "gold",
    },
    createdAt: Date.now(),
    duration: 4500,
  });
  notify();
}

export function showAchievementToast(title: string, description: string, trophy: TrophyTier) {
  if (!areAchievementsEnabled()) return;
  playAchievementUnlock();
  const id = `toast-ach-${++toastId}`;
  toasts.push({
    id,
    message: title,
    type: "achievement",
    achievement: { title, description, trophy },
    createdAt: Date.now(),
    duration: 4500,
  });
  notify();
}

function areAchievementsEnabled(): boolean {
  try {
    const raw = localStorage.getItem("jobsheet_ui_settings_v1");
    if (!raw) return true;
    const parsed = JSON.parse(raw);
    return parsed?.achievementsEnabled !== false;
  } catch {
    return true;
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
  const isAchievement = toast.type === "achievement";
  const isPersistent = toast.persistent === true;
  const bg = isAchievement ? "var(--panel)" : isSuccess ? "#10b981" : isError ? "#ef4444" : "var(--accent)";

  const [hovered, setHovered] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const remainingRef = useRef(toast.duration);
  const lastTickRef = useRef(Date.now());

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
      onClick={isPersistent ? undefined : dismiss}
      onKeyDown={isPersistent ? undefined : (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); dismiss(); } }}
      style={{
        background: bg,
        color: isAchievement ? "var(--text)" : isSuccess || isError ? "white" : "var(--accent-fg)",
        border: isAchievement ? "1px solid var(--border)" : undefined,
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
      title={isPersistent ? undefined : "Kliknutím zavřete"}
    >
      {isAchievement && toast.achievement && (
        <TrophyIcon tier={toast.achievement.trophy} size={28} />
      )}
      {isSuccess && !isAchievement && (
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
      {!isSuccess && !isError && !isAchievement && (
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="12" cy="12" r="10" />
          <line x1="12" y1="16" x2="12" y2="12" />
          <line x1="12" y1="8" x2="12.01" y2="8" />
        </svg>
      )}
      <span style={{ flex: 1, userSelect: "text" }}>
        {isAchievement && toast.achievement ? (
          <div>
            <div style={{ fontWeight: 800, fontSize: 14, marginBottom: 2 }}>{toast.achievement.title}</div>
            <div style={{ fontSize: 12, opacity: 0.85 }}>{toast.achievement.description}</div>
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
