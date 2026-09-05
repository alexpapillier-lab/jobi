import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Sidebar, type NavKey, type SidebarProps } from "./Sidebar";
import { supabase } from "../lib/supabaseClient";
import { clearOnSignOut } from "../lib/storageInvalidation";
import { TrialBanner } from "../components/TrialBanner";
import { JobiDocsGuideModal } from "../components/JobiDocsGuideModal";
import { useIsNarrow } from "../hooks/useIsNarrow";
import { BottomNav } from "./BottomNav";
import { STORAGE_KEYS } from "../constants/storageKeys";

type SidebarPosition = "left" | "right" | "bottom";

/** Klíč je záměrně doslovný – storageKeys.ts spravuje jiný tým (viz zadání). */
const SIDEBAR_PINNED_KEY = "jobsheet_sidebar_pinned";
/** Prodlevy rozbalení/sbalení po najetí – přejetí myší přes hranu lištu neroztřese. */
const HOVER_OPEN_DELAY_MS = 180;
const HOVER_CLOSE_DELAY_MS = 250;
const sidebarTransition = "180ms cubic-bezier(0.4, 0, 0.2, 1)";

function readPinned(fallback: boolean): boolean {
  try {
    const raw = localStorage.getItem(SIDEBAR_PINNED_KEY);
    if (raw === "1") return true;
    if (raw === "0") return false;
  } catch {
    // ignore
  }
  return fallback;
}

export function AppLayout({
  children,
  pageTitle: _pageTitle,
  activePage,
  onNavigate,
  userEmail,
  userProfile,
  onSignOut,
  services,
  activeServiceId,
  setActiveServiceId,
  invoicingEnabled = true,
  sidebarPosition = "left",
  smsUnreadCount = 0,
  smsEnabled = false,
  sidebarPinned = false,
  onSidebarPinnedChange,
}: {
  children: React.ReactNode;
  pageTitle: string;
  activePage: NavKey;
  onNavigate: (k: NavKey) => void;
  userEmail: string | null;
  userProfile?: { nickname: string | null; avatarUrl: string | null } | null;
  onSignOut: () => Promise<void>;
  services: Array<{ service_id: string; service_name: string; role: string }>;
  activeServiceId: string | null;
  setActiveServiceId: (serviceId: string | null) => void;
  invoicingEnabled?: boolean;
  sidebarPosition?: SidebarPosition;
  smsUnreadCount?: number;
  smsEnabled?: boolean;
  /** Výchozí hodnota z uiCfg – localStorage klíč lišty má přednost. */
  sidebarPinned?: boolean;
  onSidebarPinnedChange?: (pinned: boolean) => void;
}) {
  const handleSignOut = async () => {
    clearOnSignOut();
    
    if (supabase) {
      await supabase.auth.signOut();
    }
    await onSignOut();
  };
  /** Rozbalení najetím myší / fokusem. Připnutá lišta ho nepotřebuje. */
  const [hoverExpanded, setHoverExpanded] = useState(false);
  const [pinned, setPinned] = useState<boolean>(() => readPinned(sidebarPinned));
  /** Otevřená nabídka servisů drží lištu rozbalenou – viz Sidebar. */
  const [serviceMenuOpen, setServiceMenuOpen] = useState(false);
  const isNarrow = useIsNarrow();

  // Změna zvenku (např. z Nastavení) – reagovat jen na skutečnou změnu prop,
  // ne při připojení, kdy má přednost hodnota z localStorage. Úprava stavu
  // přímo při vykreslení je doporučený vzor místo effectu se setState.
  const [lastPinnedProp, setLastPinnedProp] = useState(sidebarPinned);
  if (lastPinnedProp !== sidebarPinned) {
    setLastPinnedProp(sidebarPinned);
    setPinned(sidebarPinned);
  }

  const openTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const clearHoverTimers = useCallback(() => {
    if (openTimer.current) { clearTimeout(openTimer.current); openTimer.current = null; }
    if (closeTimer.current) { clearTimeout(closeTimer.current); closeTimer.current = null; }
  }, []);
  useEffect(() => clearHoverTimers, [clearHoverTimers]);

  const expandSoon = useCallback(() => {
    if (closeTimer.current) { clearTimeout(closeTimer.current); closeTimer.current = null; }
    if (openTimer.current) return;
    openTimer.current = setTimeout(() => {
      openTimer.current = null;
      setHoverExpanded(true);
    }, HOVER_OPEN_DELAY_MS);
  }, []);
  const collapseSoon = useCallback(() => {
    if (openTimer.current) { clearTimeout(openTimer.current); openTimer.current = null; }
    if (closeTimer.current) return;
    closeTimer.current = setTimeout(() => {
      closeTimer.current = null;
      setHoverExpanded(false);
    }, HOVER_CLOSE_DELAY_MS);
  }, []);
  const expandNow = useCallback(() => {
    clearHoverTimers();
    setHoverExpanded(true);
  }, [clearHoverTimers]);
  const collapseNow = useCallback(() => {
    clearHoverTimers();
    setHoverExpanded(false);
  }, [clearHoverTimers]);

  const togglePinned = useCallback(() => {
    const next = !pinned;
    setPinned(next);
    try {
      localStorage.setItem(SIDEBAR_PINNED_KEY, next ? "1" : "0");
    } catch {
      // ignore
    }
    onSidebarPinnedChange?.(next);
    // Po odepnutí kurzor stále leží na liště – sbalí se, až ji opustí.
    if (!next) setHoverExpanded(true);
  }, [pinned, onSidebarPinnedChange]);
  const [showJobiDocsGuide, setShowJobiDocsGuide] = useState(false);
  const mainRef = useRef<HTMLElement | null>(null);

  const handleCloseJobiDocsGuide = useCallback(() => {
    try {
      localStorage.setItem(STORAGE_KEYS.JOBIDOCS_FIRST_CONNECT_GUIDE_SEEN, "1");
    } catch {
      // ignore
    }
    setShowJobiDocsGuide(false);
  }, []);

  useEffect(() => {
    mainRef.current?.scrollTo(0, 0);
  }, [activePage]);

  const isBottom = sidebarPosition === "bottom";
  const isRight = sidebarPosition === "right";
  /* Připnutí nemá u spodní lišty smysl – má jednu výšku. */
  const effectivePinned = pinned && !isBottom;
  const sidebarExpanded = effectivePinned || hoverExpanded;
  /* Rozbalená jen najetím = leží přes obsah, ať to i vypadá jako výsuvný panel. */
  const isFlyout = sidebarExpanded && !effectivePinned && !isBottom;

  const sidebarStyle = useMemo<React.CSSProperties>(() => {
    if (isBottom) {
      return {
        height: sidebarExpanded ? "var(--sidebar-bottom-expanded)" : "var(--sidebar-bottom-collapsed)",
        width: "100%",
        transition: `height ${sidebarTransition}`,
      };
    }
    return {
      width: sidebarExpanded ? "var(--sidebar-expanded)" : "var(--sidebar-collapsed)",
      transition: `width ${sidebarTransition}`,
    };
  }, [sidebarExpanded, isBottom]);

  const asidePositionStyle = useMemo<React.CSSProperties>(() => {
    const base: React.CSSProperties = {
      position: "fixed",
      background: "var(--panel)",
      backdropFilter: "var(--blur)",
      WebkitBackdropFilter: "var(--blur)",
      boxShadow: isFlyout ? "var(--sidebar-shadow-flyout)" : "var(--shadow-soft)",
      display: "flex",
      overflow: "hidden",
      zIndex: 1000,
    };
    if (isBottom) {
      return {
        ...base,
        left: 0, right: 0, bottom: 0,
        flexDirection: "row",
        borderTop: "1px solid var(--border)",
      };
    }
    if (isRight) {
      return {
        ...base,
        right: 0, top: 0, bottom: 0,
        flexDirection: "column",
        borderLeft: "1px solid var(--border)",
      };
    }
    return {
      ...base,
      left: 0, top: 0, bottom: 0,
      flexDirection: "column",
      borderRight: "1px solid var(--border)",
    };
  }, [isBottom, isRight, isFlyout]);

  const contentStyle = useMemo<React.CSSProperties>(() => {
    if (isBottom) {
      return {
        paddingBottom: "var(--sidebar-bottom-collapsed)",
      };
    }
    const inset = effectivePinned ? "var(--sidebar-expanded)" : "var(--sidebar-collapsed)";
    const transition = `padding ${sidebarTransition}`;
    if (isRight) {
      return { paddingRight: inset, transition };
    }
    return { paddingLeft: inset, transition };
  }, [isBottom, isRight, effectivePinned]);

  return (
    <div style={{ display: "flex", flexDirection: isBottom ? "column" : "row", height: "100%", position: "relative" }}>
      {/* Na úzké obrazovce boční lištu nevykreslujeme vůbec – zabírala by
          68 px z 375, obsah by se nevešel. Navigaci přebírá BottomNav. */}
      {!isNarrow && (
      <aside
        style={{
          ...sidebarStyle,
          ...asidePositionStyle,
        }}
        onMouseEnter={effectivePinned ? undefined : expandSoon}
        onMouseLeave={effectivePinned || serviceMenuOpen ? undefined : collapseSoon}
        onFocusCapture={effectivePinned ? undefined : expandNow}
        onBlurCapture={(e) => {
          const next = e.relatedTarget as Node | null;
          if (next && e.currentTarget.contains(next)) return;
          if (!effectivePinned && !serviceMenuOpen) collapseNow();
        }}
      >
        <Sidebar 
          {...({
            expanded: sidebarExpanded,
            active: activePage,
            onNavigate,
            userEmail,
            userProfile: userProfile ?? null,
            onSignOut: handleSignOut,
            services,
            activeServiceId,
            setActiveServiceId,
            onServiceMenuOpenChange: setServiceMenuOpen,
            invoicingEnabled,
            onJobiDocsFirstConnect: () => setShowJobiDocsGuide(true),
            horizontal: isBottom,
            side: isRight ? "right" : "left",
            pinned: effectivePinned,
            onTogglePin: isBottom ? undefined : togglePinned,
            smsUnreadCount,
            smsEnabled,
          } satisfies SidebarProps)}
        />
      </aside>
      )}

      {isNarrow && (
        <BottomNav
          active={activePage}
          onNavigate={onNavigate}
          invoicingEnabled={invoicingEnabled}
          smsEnabled={smsEnabled}
          smsUnreadCount={smsUnreadCount}
          services={services}
          activeServiceId={activeServiceId}
          setActiveServiceId={setActiveServiceId}
          userEmail={userEmail}
          userProfile={userProfile ?? null}
          onSignOut={handleSignOut}
        />
      )}

      <div
        data-app-content
        style={{
          flex: 1,
          display: "flex",
          flexDirection: "column",
          minWidth: 0,
          minHeight: 0,
          ...(isNarrow ? {} : contentStyle),
          position: "relative",
          background: "var(--bg)",
        }}
      >
        <TrialBanner activeServiceId={activeServiceId} />
        <JobiDocsGuideModal open={showJobiDocsGuide} onClose={handleCloseJobiDocsGuide} />
        <main
          ref={mainRef}
          style={{
            flex: 1,
            /* Na telefonu ubírá 24 px po stranách 13 % šířky displeje.
               Karty pak nemají kam růst a obsah se v nich mačká.

               Dlouhé zápisy místo zkratky `padding`: React varuje, když se
               v jednom stylu míchá zkratka s `paddingBottom` a jedna z nich
               se mezi vykresleními mění. */
            paddingTop: isNarrow ? "var(--pad-16)" : "var(--pad-24)",
            paddingRight: isNarrow ? "var(--pad-12)" : "var(--pad-24)",
            paddingLeft: isNarrow ? "var(--pad-12)" : "var(--pad-24)",
            paddingBottom: isNarrow
              ? "calc(var(--bottom-nav-h) + var(--safe-bottom) + 12px)"
              : "calc(var(--pad-24) + 8px)",
            overflow: "auto",
            transform: "translateZ(0)",
            contain: "paint",
            background: "var(--bg)",
          }}
        >
          {children}
        </main>
      </div>
    </div>
  );
}
