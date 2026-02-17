import { useLayoutEffect, useState } from "react";
import { createPortal } from "react-dom";
import type { NavKey } from "../layout/Sidebar";

export type TourStep = {
  page: NavKey;
  title: string;
  description: string;
  /** CSS selector for element to highlight (e.g. [data-tour="orders-new-btn"]). */
  selector?: string;
  /** When page is "settings", switch to this category and subsection so the target selector is visible. */
  settingsSection?: { category: string; subsection: string };
};

type AppTourOverlayProps = {
  active: boolean;
  stepIndex: number;
  steps: TourStep[];
  activePage: NavKey;
  onNext: () => void;
  onPrev: () => void;
  onClose: () => void;
};

const SPOTLIGHT_PADDING = 8;
const BACKDROP_COLOR = "rgba(0, 0, 0, 0.45)";

function useTourTarget(active: boolean, page: NavKey, selector: string | undefined) {
  const [rect, setRect] = useState<DOMRect | null>(null);

  useLayoutEffect(() => {
    if (!active || !selector || !page) {
      setRect(null);
      return;
    }
    const el = document.querySelector(selector);
    if (!el) {
      setRect(null);
      return;
    }
    el.scrollIntoView({ behavior: "smooth", block: "center" });
    const update = () => {
      const r = el.getBoundingClientRect();
      setRect(new DOMRect(r.x, r.y, r.width, r.height));
    };
    update();
    const ro = new ResizeObserver(update);
    ro.observe(document.documentElement);
    window.addEventListener("scroll", update, true);
    const t = requestAnimationFrame(update);
    return () => {
      ro.disconnect();
      window.removeEventListener("scroll", update, true);
      cancelAnimationFrame(t);
      setRect(null);
    };
  }, [active, page, selector]);

  return rect;
}

export function AppTourOverlay({
  active,
  stepIndex,
  steps,
  activePage,
  onNext,
  onPrev,
  onClose,
}: AppTourOverlayProps) {
  if (!active || steps.length === 0) return null;

  const step = steps[stepIndex];
  if (!step) return null;

  const isFirst = stepIndex === 0;
  const isLast = stepIndex === steps.length - 1;
  const onStepPage = activePage === step.page;
  const targetRect = useTourTarget(active && onStepPage, step.page, step.selector);

  const showSpotlight = !!step.selector && !!targetRect && targetRect.width > 0 && targetRect.height > 0;

  const card = (
    <div
      style={{
        pointerEvents: "auto",
        maxWidth: 420,
        width: "100%",
        background: "var(--panel)",
        border: "1px solid var(--border)",
        borderRadius: "var(--radius-lg)",
        boxShadow: "var(--shadow-lg)",
        padding: 24,
      }}
    >
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12, marginBottom: 12 }}>
        <h3 style={{ margin: 0, fontSize: 18, fontWeight: 700, color: "var(--text)" }}>
          {step.title}
        </h3>
        <button
          type="button"
          onClick={onClose}
          aria-label="Zavřít průvodce"
          style={{
            background: "none",
            border: "none",
            color: "var(--muted)",
            cursor: "pointer",
            padding: 4,
            fontSize: 20,
            lineHeight: 1,
          }}
        >
          ×
        </button>
      </div>
      <p style={{ margin: "0 0 20px 0", fontSize: 14, color: "var(--text)", lineHeight: 1.6 }}>
        {step.description}
      </p>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
        <div style={{ fontSize: 12, color: "var(--muted)" }}>
          Krok {stepIndex + 1} / {steps.length}
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          {!isFirst && (
            <button
              type="button"
              onClick={onPrev}
              style={{
                padding: "8px 16px",
                background: "var(--panel-2)",
                color: "var(--text)",
                border: "1px solid var(--border)",
                borderRadius: "var(--radius-md)",
                cursor: "pointer",
                fontWeight: 600,
                fontSize: 14,
              }}
            >
              ← Předchozí
            </button>
          )}
          {isLast ? (
            <button
              type="button"
              onClick={onClose}
              style={{
                padding: "8px 16px",
                background: "var(--accent)",
                color: "white",
                border: "none",
                borderRadius: "var(--radius-md)",
                cursor: "pointer",
                fontWeight: 600,
                fontSize: 14,
              }}
            >
              Ukončit průvodce
            </button>
          ) : (
            <button
              type="button"
              onClick={onNext}
              style={{
                padding: "8px 16px",
                background: "var(--accent)",
                color: "white",
                border: "none",
                borderRadius: "var(--radius-md)",
                cursor: "pointer",
                fontWeight: 600,
                fontSize: 14,
              }}
            >
              Další →
            </button>
          )}
        </div>
      </div>
    </div>
  );

  return createPortal(
    <div
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 9998,
        pointerEvents: "auto",
        display: "flex",
        alignItems: "flex-end",
        justifyContent: "center",
        padding: 24,
        paddingBottom: 48,
      }}
    >
      {showSpotlight && (
        <div
          aria-hidden
          style={{
            position: "fixed",
            left: targetRect!.x - SPOTLIGHT_PADDING,
            top: targetRect!.y - SPOTLIGHT_PADDING,
            width: targetRect!.width + SPOTLIGHT_PADDING * 2,
            height: targetRect!.height + SPOTLIGHT_PADDING * 2,
            borderRadius: 12,
            boxShadow: `0 0 0 9999px ${BACKDROP_COLOR}`,
            pointerEvents: "none",
            border: "2px solid var(--accent)",
            boxSizing: "border-box",
          }}
        />
      )}
      {card}
    </div>,
    document.body
  );
}
