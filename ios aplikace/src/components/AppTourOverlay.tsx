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
  /** Icon key for card (welcome, orders, customers, inventory, devices, statistics, settings, jobidocs, doc, team, profile, keyboard). */
  icon?: string;
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

const SPOTLIGHT_PADDING = 10;
const BACKDROP_COLOR = "rgba(15, 23, 42, 0.55)";

const STEP_ICONS: Record<string, string> = {
  welcome: "👋",
  orders: "📋",
  customers: "👥",
  inventory: "📦",
  devices: "📱",
  statistics: "📊",
  settings: "⚙️",
  jobidocs: "🖨️",
  doc: "📄",
  team: "🤝",
  profile: "👤",
  keyboard: "⌨️",
  reklamace: "🔄",
};

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
  const step = steps[stepIndex] ?? null;
  const onStepPage = step ? activePage === step.page : false;
  const targetRect = useTourTarget(active && !!step && onStepPage, step?.page ?? "home", step?.selector);

  if (!active || steps.length === 0) return null;
  if (!step) return null;

  const isFirst = stepIndex === 0;
  const isLast = stepIndex === steps.length - 1;

  const showSpotlight = !!step.selector && !!targetRect && targetRect.width > 0 && targetRect.height > 0;
  const iconEmoji = step.icon ? STEP_ICONS[step.icon] ?? "◦" : "◦";

  const card = (
    <div
      style={{
        pointerEvents: "auto",
        maxWidth: 440,
        width: "100%",
        background: "var(--panel)",
        border: "1px solid var(--border)",
        borderLeft: "4px solid var(--accent)",
        borderRadius: 20,
        boxShadow: "0 24px 48px rgba(0,0,0,0.2), 0 0 0 1px rgba(255,255,255,0.05)",
        padding: 0,
        overflow: "hidden",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "flex-start",
          gap: 16,
          padding: "24px 24px 16px",
        }}
      >
        <div
          style={{
            width: 52,
            height: 52,
            minWidth: 52,
            minHeight: 52,
            borderRadius: 14,
            background: "var(--accent-soft)",
            color: "var(--accent)",
            fontSize: 26,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            flexShrink: 0,
          }}
        >
          {iconEmoji}
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 8 }}>
            <h3
              style={{
                margin: 0,
                fontSize: 20,
                fontWeight: 800,
                color: "var(--text)",
                letterSpacing: "-0.02em",
                lineHeight: 1.25,
              }}
            >
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
                fontSize: 22,
                lineHeight: 1,
                borderRadius: 8,
                flexShrink: 0,
              }}
            >
              ×
            </button>
          </div>
          <p
            style={{
              margin: "10px 0 0 0",
              fontSize: 15,
              color: "var(--muted)",
              lineHeight: 1.6,
              fontWeight: 500,
            }}
          >
            {step.description}
          </p>
        </div>
      </div>

      {/* Progress dots */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          gap: 6,
          padding: "12px 24px 8px",
          flexWrap: "wrap",
        }}
      >
        {steps.map((_, i) => (
          <div
            key={i}
            style={{
              width: i === stepIndex ? 20 : 8,
              height: 8,
              borderRadius: 4,
              background: i === stepIndex ? "var(--accent)" : "var(--border)",
              opacity: i === stepIndex ? 1 : 0.6,
              transition: "width 0.2s ease, background 0.2s ease",
            }}
          />
        ))}
      </div>

      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 12,
          padding: "16px 24px 24px",
          borderTop: "1px solid var(--border)",
          background: "rgba(0,0,0,0.02)",
        }}
      >
        <button
          type="button"
          onClick={onClose}
          style={{
            background: "none",
            border: "none",
            color: "var(--muted)",
            fontSize: 13,
            cursor: "pointer",
            fontWeight: 500,
            padding: "4px 0",
          }}
        >
          Přeskočit průvodce
        </button>
        <div style={{ display: "flex", gap: 10 }}>
          {!isFirst && (
            <button
              type="button"
              onClick={onPrev}
              style={{
                padding: "10px 18px",
                background: "var(--panel-2)",
                color: "var(--text)",
                border: "1px solid var(--border)",
                borderRadius: 12,
                cursor: "pointer",
                fontWeight: 600,
                fontSize: 14,
              }}
            >
              ← Zpět
            </button>
          )}
          {isLast ? (
            <button
              type="button"
              onClick={onClose}
              style={{
                padding: "10px 22px",
                background: "var(--accent)",
                color: "white",
                border: "none",
                borderRadius: 12,
                cursor: "pointer",
                fontWeight: 700,
                fontSize: 14,
                boxShadow: "0 4px 14px var(--accent-glow)",
              }}
            >
              Hotovo, začít
            </button>
          ) : (
            <button
              type="button"
              onClick={onNext}
              style={{
                padding: "10px 22px",
                background: "var(--accent)",
                color: "white",
                border: "none",
                borderRadius: 12,
                cursor: "pointer",
                fontWeight: 700,
                fontSize: 14,
                boxShadow: "0 4px 14px var(--accent-glow)",
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
            borderRadius: 16,
            boxShadow: `0 0 0 9999px ${BACKDROP_COLOR}`,
            pointerEvents: "none",
            border: "3px solid var(--accent)",
            boxSizing: "border-box",
          }}
        />
      )}
      {card}
    </div>,
    document.body
  );
}
