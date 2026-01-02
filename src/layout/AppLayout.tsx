import React, { useMemo, useState } from "react";
import { Sidebar, type NavKey } from "./Sidebar";
import { supabase } from "../lib/supabaseClient";
import { clearOnSignOut } from "../lib/storageInvalidation";

export function AppLayout({
  children,
  pageTitle: _pageTitle,
  activePage,
  onNavigate,
  userEmail,
  onSignOut,
  services,
  activeServiceId,
  setActiveServiceId,
}: {
  children: React.ReactNode;
  pageTitle: string;
  activePage: NavKey;
  onNavigate: (k: NavKey) => void;
  userEmail: string | null;
  onSignOut: () => Promise<void>;
  services: Array<{ service_id: string; service_name: string; role: string }>;
  activeServiceId: string | null;
  setActiveServiceId: (serviceId: string | null) => void;
}) {
  const handleSignOut = async () => {
    // Clear business data from localStorage before sign out
    clearOnSignOut();
    
    if (supabase) {
      await supabase.auth.signOut();
    }
    await onSignOut();
  };
  const [sidebarExpanded, setSidebarExpanded] = useState(false);

  const sidebarStyle = useMemo<React.CSSProperties>(() => {
    return {
      width: sidebarExpanded ? "var(--sidebar-expanded)" : "var(--sidebar-collapsed)",
      transition: "width 250ms cubic-bezier(0.4, 0, 0.2, 1)",
    };
  }, [sidebarExpanded]);

  return (
    <div style={{ display: "flex", height: "100%", position: "relative" }}>
      <aside
        style={{
          ...sidebarStyle,
          position: "fixed",
          left: 0,
          top: 0,
          bottom: 0,
          background: "var(--panel)",
          backdropFilter: "var(--blur)",
          WebkitBackdropFilter: "var(--blur)",
          borderRight: "1px solid var(--border)",
          boxShadow: "var(--shadow-soft)",
          display: "flex",
          flexDirection: "column",
          overflow: "hidden",
          zIndex: 1000,
        }}
        onMouseEnter={() => setSidebarExpanded(true)}
        onMouseLeave={() => setSidebarExpanded(false)}
        onFocusCapture={() => setSidebarExpanded(true)}
        onBlurCapture={(e) => {
          // pokud focus odešel mimo sidebar, zavři
          const next = e.relatedTarget as Node | null;
          if (next && e.currentTarget.contains(next)) return;
          setSidebarExpanded(false);
        }}
      >
        <Sidebar 
          expanded={sidebarExpanded} 
          active={activePage} 
          onNavigate={onNavigate}
          userEmail={userEmail}
          onSignOut={handleSignOut}
          services={services}
          activeServiceId={activeServiceId}
          setActiveServiceId={setActiveServiceId}
        />
      </aside>

      <div style={{ 
        flex: 1, 
        display: "flex", 
        flexDirection: "column", 
        minWidth: 0,
        marginLeft: "var(--sidebar-collapsed)",
        transition: "margin-left 180ms ease",
      }}>
        <main style={{ flex: 1, padding: "var(--pad-24)", overflow: "auto" }}>
          {children}
        </main>
      </div>
    </div>
  );
}
