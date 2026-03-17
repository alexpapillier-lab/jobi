import React, { useCallback, useRef, useEffect, useState } from "react";
import { BottomNav } from "./BottomNav";
import type { NavKey } from "./Sidebar";
import { supabase } from "../lib/supabaseClient";
import { clearOnSignOut } from "../lib/storageInvalidation";
import { AppLogo } from "../components/AppLogo";

export function AppLayoutMobile({
  children,
  activePage,
  onNavigate,
  userEmail,
  userProfile,
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
  userProfile?: { nickname: string | null; avatarUrl: string | null } | null;
  onSignOut: () => Promise<void>;
  services: Array<{ service_id: string; service_name: string; role: string }>;
  activeServiceId: string | null;
  setActiveServiceId: (serviceId: string | null) => void;
}) {
  const handleSignOut = async () => {
    clearOnSignOut();
    if (supabase) {
      await supabase.auth.signOut();
    }
    await onSignOut();
  };

  const mainRef = useRef<HTMLElement | null>(null);
  const [headerMenuOpen, setHeaderMenuOpen] = useState(false);

  useEffect(() => {
    mainRef.current?.scrollTo(0, 0);
  }, [activePage]);

  const activeService = services.find((s) => s.service_id === activeServiceId);
  const serviceName = activeService?.service_name || "Servis";
  const hasMultipleServices = services.length > 1;
  const displayName = (userProfile?.nickname?.trim() || userEmail?.split("@")[0] || "Uživatel").trim() || "Uživatel";

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        minHeight: "100dvh",
        paddingTop: "var(--safe-top)",
        background: "var(--bg)",
      }}
    >
      {/* Top header */}
      <header
        style={{
          flexShrink: 0,
          height: "var(--topbar-h-mobile)",
          paddingLeft: "max(var(--pad-16), var(--safe-left))",
          paddingRight: "max(var(--pad-16), var(--safe-right))",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          background: "var(--panel)",
          backdropFilter: "var(--blur)",
          WebkitBackdropFilter: "var(--blur)",
          borderBottom: "1px solid var(--border)",
          zIndex: 100,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <AppLogo size={32} />
          <span
            style={{
              fontSize: 17,
              fontWeight: 700,
              color: "var(--text)",
            }}
          >
            {serviceName}
          </span>
        </div>

        <div style={{ position: "relative" }}>
          <button
            type="button"
            onClick={() => setHeaderMenuOpen((o) => !o)}
            style={{
              width: 40,
              height: 40,
              borderRadius: "50%",
              border: "none",
              background: "var(--panel-2)",
              color: "var(--icon)",
              display: "grid",
              placeItems: "center",
              cursor: "pointer",
            }}
          >
            <svg width={20} height={20} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
              <circle cx={12} cy={12} r={1} />
              <circle cx={12} cy={5} r={1} />
              <circle cx={12} cy={19} r={1} />
            </svg>
          </button>

          {headerMenuOpen && (
            <>
              <div
                style={{
                  position: "fixed",
                  inset: 0,
                  zIndex: 999,
                }}
                onClick={() => setHeaderMenuOpen(false)}
              />
              <div
                style={{
                  position: "absolute",
                  top: "100%",
                  right: 0,
                  marginTop: 8,
                  minWidth: 200,
                  background: "var(--panel)",
                  border: "1px solid var(--border)",
                  borderRadius: 12,
                  boxShadow: "var(--shadow-soft)",
                  padding: 8,
                  zIndex: 1000,
                }}
              >
                {hasMultipleServices && (
                  <div style={{ padding: "8px 12px", fontSize: 12, color: "var(--muted)", borderBottom: "1px solid var(--border)", marginBottom: 8 }}>
                    Vyber servis
                  </div>
                )}
                {hasMultipleServices &&
                  services.map((s) => (
                    <button
                      key={s.service_id}
                      type="button"
                      onClick={() => {
                        setActiveServiceId(s.service_id);
                        setHeaderMenuOpen(false);
                      }}
                      style={{
                        width: "100%",
                        padding: "12px 16px",
                        textAlign: "left",
                        border: "none",
                        background: activeServiceId === s.service_id ? "var(--accent-soft)" : "transparent",
                        color: "var(--text)",
                        borderRadius: 8,
                        fontSize: 15,
                        fontWeight: 500,
                        cursor: "pointer",
                      }}
                    >
                      {s.service_name}
                    </button>
                  ))}
                <button
                  type="button"
                  onClick={() => {
                    setHeaderMenuOpen(false);
                    handleSignOut();
                  }}
                  style={{
                    width: "100%",
                    padding: "12px 16px",
                    textAlign: "left",
                    border: "none",
                    background: "transparent",
                    color: "#dc2626",
                    borderRadius: 8,
                    fontSize: 15,
                    fontWeight: 500,
                    cursor: "pointer",
                    marginTop: 8,
                    borderTop: "1px solid var(--border)",
                  }}
                >
                  Odhlásit se
                </button>
              </div>
            </>
          )}
        </div>
      </header>

      {/* Main content */}
      <main
        ref={mainRef}
        style={{
          flex: 1,
          overflow: "auto",
          padding: "var(--pad-16)",
          paddingLeft: "max(var(--pad-16), var(--safe-left))",
          paddingRight: "max(var(--pad-16), var(--safe-right))",
          paddingBottom: "calc(var(--bottom-nav-h) + var(--safe-bottom) + var(--pad-16))",
          WebkitOverflowScrolling: "touch",
        }}
      >
        {children}
      </main>

      {/* Bottom navigation */}
      <BottomNav active={activePage} onNavigate={onNavigate} />
    </div>
  );
}
