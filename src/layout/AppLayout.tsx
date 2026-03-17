import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Sidebar, type NavKey, type SidebarProps } from "./Sidebar";
import { supabase } from "../lib/supabaseClient";
import { clearOnSignOut } from "../lib/storageInvalidation";
import { JobiDocsGuideModal } from "../components/JobiDocsGuideModal";
import { STORAGE_KEYS } from "../constants/storageKeys";

type SidebarPosition = "left" | "right" | "bottom";

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
  achievementsEnabled = true,
  invoicingEnabled = true,
  sidebarPosition = "left",
  smsUnreadCount = 0,
  smsEnabled = false,
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
  achievementsEnabled?: boolean;
  invoicingEnabled?: boolean;
  sidebarPosition?: SidebarPosition;
  smsUnreadCount?: number;
  smsEnabled?: boolean;
}) {
  const handleSignOut = async () => {
    clearOnSignOut();
    
    if (supabase) {
      await supabase.auth.signOut();
    }
    await onSignOut();
  };
  const [sidebarExpanded, setSidebarExpanded] = useState(false);
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
  const sidebarTransition = "180ms cubic-bezier(0.4, 0, 0.2, 1)";

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
      boxShadow: "var(--shadow-soft)",
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
  }, [isBottom, isRight]);

  const contentStyle = useMemo<React.CSSProperties>(() => {
    if (isBottom) {
      return {
        paddingBottom: "var(--sidebar-bottom-collapsed)",
      };
    }
    if (isRight) {
      return {
        paddingRight: "var(--sidebar-collapsed)",
      };
    }
    return {
      paddingLeft: "var(--sidebar-collapsed)",
    };
  }, [isBottom, isRight]);

  return (
    <div style={{ display: "flex", flexDirection: isBottom ? "column" : "row", height: "100%", position: "relative" }}>
      <aside
        style={{
          ...sidebarStyle,
          ...asidePositionStyle,
        }}
        onMouseEnter={() => setSidebarExpanded(true)}
        onMouseLeave={() => setSidebarExpanded(false)}
        onFocusCapture={() => setSidebarExpanded(true)}
        onBlurCapture={(e) => {
          const next = e.relatedTarget as Node | null;
          if (next && e.currentTarget.contains(next)) return;
          setSidebarExpanded(false);
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
            achievementsEnabled,
            invoicingEnabled,
            onJobiDocsFirstConnect: () => setShowJobiDocsGuide(true),
            horizontal: isBottom,
            smsUnreadCount,
            smsEnabled,
          } satisfies SidebarProps)}
        />
      </aside>

      <div
        data-app-content
        style={{
          flex: 1,
          display: "flex",
          flexDirection: "column",
          minWidth: 0,
          minHeight: 0,
          ...contentStyle,
          position: "relative",
          background: "var(--bg)",
        }}
      >
        <JobiDocsGuideModal open={showJobiDocsGuide} onClose={handleCloseJobiDocsGuide} />
        <main
          ref={mainRef}
          style={{
            flex: 1,
            padding: "var(--pad-24)",
            paddingBottom: isBottom ? "calc(var(--pad-24) + 8px)" : "calc(var(--pad-24) + 8px)",
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
