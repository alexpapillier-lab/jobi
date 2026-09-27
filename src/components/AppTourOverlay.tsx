import { useLayoutEffect, useState, type CSSProperties, type ReactNode } from "react";
import { createPortal } from "react-dom";
import type { NavKey } from "../layout/Sidebar";
import {
  BoltIcon,
  BoxIcon,
  DeviceIcon,
  DocumentIcon,
  HashIcon,
  PrintIcon,
  TrendIcon,
  UserIcon,
  WarningIcon,
  WrenchIcon,
} from "./icons";

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
  /** Co má aplikace udělat při vstupu na krok (App.tsx): otevřít ukázkovou (nebo poslední) zakázku. */
  akce?: "otevrit-ukazkovou-zakazku";
  /**
   * Kotvy (hodnoty data-tour), na které průvodce před zobrazením kroku
   * klikne, v tomto pořadí: otevře dialog, přepne záložku, rozbalí sekci.
   * Klik se vynechá, když už je hotový – přepínač (aria-pressed/selected)
   * je zapnutý, nebo je na stránce vidět to, co má klik ukázat (další kotva
   * v řadě, u poslední cíl kroku). Už otevřený dialog se tak nezavře a krok
   * Zpět nic nerozbije. Klikat jen na věci, které nic neukládají.
   */
  klik?: string[];
};

/** První viditelný prvek (stránky zůstávají připojené skryté přes display:none). */
function najdiViditelny(selector: string): HTMLElement | null {
  if (typeof document === "undefined") return null;
  for (const el of Array.from(document.querySelectorAll<HTMLElement>(selector))) {
    if (el.getClientRects().length > 0) return el;
  }
  return null;
}

const kotvaSel = (kotva: string) => `[data-tour="${kotva}"]`;

/**
 * Je klik na prvek zbytečný? U přepínače (záložka, volba) rozhoduje, jestli
 * je zapnutý; u ostatního, jestli už je vidět, co má klik ukázat.
 */
function klikUzHotovy(el: HTMLElement, vysledek: string | undefined): boolean {
  const pressed = el.getAttribute("aria-pressed") ?? el.getAttribute("aria-selected");
  if (pressed != null) return pressed === "true";
  if (el instanceof HTMLDetailsElement) return el.open;
  return !!vysledek && !!najdiViditelny(vysledek);
}

/**
 * Kliky kroku (TourStep.klik): postupně počká na každý prvek (až ~5 s –
 * stránka nebo dialog se teprve vykresluje) a klikne na něj, pokud klik
 * ještě není hotový. Při odchodu z kroku se nic nezavírá – uživatel vidí,
 * co průvodce otevřel, a může v tom pokračovat.
 */
function useKlikyKroku(active: boolean, step: TourStep | null) {
  const kliky = step?.klik;
  const cil = step?.selector;
  const klic = active && kliky && kliky.length > 0 ? `${kliky.join("|")}>${cil ?? ""}` : "";
  useLayoutEffect(() => {
    if (!klic || !kliky) return;
    let zruseno = false;
    let t = 0;
    const cekej = (ms: number) => new Promise<void>((r) => { t = window.setTimeout(r, ms); });
    void (async () => {
      for (let i = 0; i < kliky.length; i++) {
        const sel = kotvaSel(kliky[i]);
        const vysledek = i + 1 < kliky.length ? kotvaSel(kliky[i + 1]) : cil;
        let el: HTMLElement | null = najdiViditelny(sel);
        // Tlačítko není vidět, ale jeho výsledek ano (dialog už je otevřený
        // a tlačítko pod ním schované): není na co čekat.
        if (!el && vysledek && najdiViditelny(vysledek)) continue;
        for (let pokus = 0; !el && pokus < 25 && !zruseno; pokus++) {
          await cekej(200);
          el = najdiViditelny(sel);
        }
        if (zruseno || !el) return;
        if (!klikUzHotovy(el, vysledek)) {
          // <details> se klikem na sebe sama nerozbalí (jen klikem na summary).
          if (el instanceof HTMLDetailsElement) el.open = true;
          else el.click();
          // React potřebuje chvíli na vykreslení dialogu nebo záložky.
          await cekej(250);
        }
      }
    })();
    return () => {
      zruseno = true;
      window.clearTimeout(t);
    };
    // klic shrnuje kliky i cíl kroku
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [klic]);
}

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

/** CSS zoom dokumentu (web: --ui-scale / style.zoom), 1 když se nezvětšuje. */
function meritkoDokumentu(): number {
  if (typeof document === "undefined") return 1;
  const html = document.documentElement;
  const zStyle = parseFloat(html.style.zoom || "");
  if (Number.isFinite(zStyle) && zStyle > 0) return zStyle;
  const zVar = parseFloat(getComputedStyle(html).getPropertyValue("--ui-scale"));
  return Number.isFinite(zVar) && zVar > 0 ? zVar : 1;
}

/*
 * Ikony kroků. Dřív emoji – ta ale každý systém vykreslí jinak (Windows
 * vs. macOS), jsou barevná tam, kde má být jednobarevná ikona, a nedají
 * se obarvit motivem. SVG ze sady v icons.tsx dědí barvu z --accent.
 */
const STEP_ICONS: Record<string, ReactNode> = {
  welcome: <BoltIcon size={26} />,
  orders: <DocumentIcon size={26} />,
  customers: <UserIcon size={26} />,
  inventory: <BoxIcon size={26} />,
  devices: <DeviceIcon size={26} />,
  statistics: <TrendIcon size={26} />,
  settings: <WrenchIcon size={26} />,
  jobidocs: <PrintIcon size={26} />,
  doc: <DocumentIcon size={26} />,
  team: <UserIcon size={26} />,
  profile: <UserIcon size={26} />,
  keyboard: <HashIcon size={26} />,
  reklamace: <WarningIcon size={26} />,
};

function useTourTarget(active: boolean, page: NavKey, selector: string | undefined) {
  const [rect, setRect] = useState<DOMRect | null>(null);

  useLayoutEffect(() => {
    if (!active || !selector || !page) {
      setRect(null);
      return;
    }
    /*
     * Prvek nemusí existovat hned – detail zakázky, dialog nebo podsekce
     * Nastavení se teprve otevírá (i klikem kroku). Proto se prvek hledá
     * průběžně: objeví se později, vymění se (React ho vykreslí znovu),
     * nebo zmizí (uživatel zavřel dialog) – spotlight jde vždy za ním.
     */
    let el: HTMLElement | null = null;
    let raf = 0;
    const update = () => {
      const najity = najdiViditelny(selector);
      if (najity !== el) {
        el = najity;
        el?.scrollIntoView({ behavior: "smooth", block: "center" });
      }
      if (!el) {
        setRect(null);
        return;
      }
      const r = el.getBoundingClientRect();
      // Na webu se rozhraní zvětšuje CSS `zoom`em na <html> (--ui-scale).
      // getBoundingClientRect vrací souřadnice v pixelech obrazovky, ale
      // spotlight leží uvnitř zoomovaného dokumentu, kde se `left`/`top`
      // násobí měřítkem – bez přepočtu je rámeček posunutý a menší
      // (viděno v Safari při 115 %). Na desktopu je měřítko 1.
      const z = meritkoDokumentu();
      setRect((prev) => {
        const next = new DOMRect(r.x / z, r.y / z, r.width / z, r.height / z);
        return prev && prev.x === next.x && prev.y === next.y && prev.width === next.width && prev.height === next.height ? prev : next;
      });
    };
    const naScroll = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(update);
    };
    update();
    const interval = window.setInterval(update, 250);
    window.addEventListener("scroll", naScroll, true);
    window.addEventListener("resize", naScroll);
    return () => {
      window.clearInterval(interval);
      window.removeEventListener("scroll", naScroll, true);
      window.removeEventListener("resize", naScroll);
      cancelAnimationFrame(raf);
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
  useKlikyKroku(active && onStepPage, step);

  if (!active || steps.length === 0) return null;
  if (!step) return null;

  const isFirst = stepIndex === 0;
  const isLast = stepIndex === steps.length - 1;

  const showSpotlight = !!step.selector && !!targetRect && targetRect.width > 0 && targetRect.height > 0;
  const stepIcon: ReactNode = (step.icon && STEP_ICONS[step.icon]) || <DocumentIcon size={26} />;

  const card = (
    <div
      style={{
        pointerEvents: "auto",
        // Spotlight je pozicovaný sourozenec a jeho stín (ztmavení stránky)
        // by se jinak vykreslil přes tuhle nepozicovanou kartu – proto byla
        // karta průvodce šedá a špatně čitelná.
        position: "relative",
        zIndex: 1,
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
          {stepIcon}
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
              Hotovo
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

  /*
   * Ztmavení kolem zvýrazněného prvku chytá kliky, ale prvek sám zůstává
   * klikací: uživatel udělá to, co krok říká (klikne na Nová zásilka,
   * vyplní pole), a pokračuje Další. Bez zvýraznění se stránka neblokuje
   * vůbec – krok pak obvykle říká, co otevřít.
   */
  const r = showSpotlight ? targetRect! : null;
  const dira = r
    ? { x: r.x - SPOTLIGHT_PADDING, y: r.y - SPOTLIGHT_PADDING, w: r.width + SPOTLIGHT_PADDING * 2, h: r.height + SPOTLIGHT_PADDING * 2 }
    : null;
  const blok = (style: CSSProperties, key: string) => (
    <div key={key} aria-hidden style={{ position: "fixed", pointerEvents: "auto", ...style }} />
  );
  // Karta dole zakrývá prvky u spodního okraje – pak jde nahoru.
  const vyskaOkna = typeof window !== "undefined" ? window.innerHeight / meritkoDokumentu() : 800;
  const kartaNahore = !!r && r.y + r.height / 2 > vyskaOkna * 0.55;

  const vrstva: CSSProperties = { position: "fixed", inset: 0, pointerEvents: "none" };
  return (
    <>
      {createPortal(
        // Ztmavení a zvýraznění: nad rozbalovacími okny stránek (9998 pozadí,
        // 9999 okno – termín v Kalendáři, filtr statusů), jejichž pozadí by
        // jinak spolklo klik; okno samo je v DOM později, takže zůstane nad ním.
        <div style={{ ...vrstva, zIndex: 9999 }}>
          {dira && [
            blok({ left: 0, top: 0, right: 0, height: Math.max(0, dira.y) }, "n"),
            blok({ left: 0, top: dira.y + dira.h, right: 0, bottom: 0 }, "s"),
            blok({ left: 0, top: dira.y, width: Math.max(0, dira.x), height: dira.h }, "w"),
            blok({ left: dira.x + dira.w, top: dira.y, right: 0, height: dira.h }, "e"),
          ]}
          {dira && (
            <div
              aria-hidden
              style={{
                position: "fixed",
                left: dira.x,
                top: dira.y,
                width: dira.w,
                height: dira.h,
                borderRadius: 16,
                boxShadow: `0 0 0 9999px ${BACKDROP_COLOR}`,
                pointerEvents: "none",
                border: "3px solid var(--accent)",
                boxSizing: "border-box",
              }}
            />
          )}
        </div>,
        document.body
      )}
      {createPortal(
        // Karta zvlášť a výš (nad dialogy 10000 – pozvánka, potvrzení): ať ji
        // dialog, který si uživatel podle kroku otevřel, nepřekryje a Další
        // jde vždycky kliknout.
        <div
          style={{
            ...vrstva,
            zIndex: 10500,
            display: "flex",
            alignItems: kartaNahore ? "flex-start" : "flex-end",
            justifyContent: "center",
            padding: 24,
            paddingBottom: kartaNahore ? 24 : 48,
            paddingTop: kartaNahore ? 48 : 24,
          }}
        >
          {card}
        </div>,
        document.body
      )}
    </>
  );
}
