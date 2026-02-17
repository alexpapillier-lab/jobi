import React, { useState, useRef, useEffect, useMemo } from "react";
import { createPortal } from "react-dom";
import { useIsRootOwner } from "../hooks/useIsRootOwner";
import { AppLogo } from "../components/AppLogo";
import { useTheme } from "../theme/ThemeProvider";
import { getLogoColors } from "../lib/logoPresets";

export type NavKey = "orders" | "inventory" | "devices" | "customers" | "statistics" | "settings";

function IconBox({ children, size = 40 }: { children: React.ReactNode; size?: number }) {
  return (
    <div
      style={{
        width: size,
        height: size,
        minWidth: size,
        minHeight: size,
        maxWidth: size,
        maxHeight: size,
        borderRadius: size * 0.4,
        display: "grid",
        placeItems: "center",
        background: "var(--panel-2)",
        backdropFilter: "var(--blur)",
        WebkitBackdropFilter: "var(--blur)",
        border: "1px solid var(--border)",
        transition: "var(--transition-smooth)",
        color: "var(--icon)",
        flexShrink: 0,
      }}
    >
      {children}
    </div>
  );
}

function OrdersIcon({ size = 20 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M9 12h6M9 16h6M10 8h4M5 4h14a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1z"/>
    </svg>
  );
}

function BoxIcon({ size = 20 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/>
      <path d="M3.27 6.96L12 12.01l8.73-5.05M12 22.08V12"/>
    </svg>
  );
}

function UsersIcon({ size = 20 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/>
      <circle cx="9" cy="7" r="4"/>
      <path d="M23 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75"/>
    </svg>
  );
}

function SettingsIcon({ size = 20 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z"/>
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1Z"/>
    </svg>
  );
}

function DevicesIcon({ size = 20 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="5" y="2" width="14" height="20" rx="2" ry="2"/>
      <path d="M12 18h.01"/>
    </svg>
  );
}

function StatisticsIcon({ size = 20 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <line x1="18" y1="20" x2="18" y2="10"/>
      <line x1="12" y1="20" x2="12" y2="4"/>
      <line x1="6" y1="20" x2="6" y2="14"/>
    </svg>
  );
}

// NAV items are created inside the component to access expanded state

export type SidebarProps = {
  expanded: boolean;
  active: NavKey;
  onNavigate: (k: NavKey) => void;
  userEmail: string | null;
  userProfile?: { nickname: string | null; avatarUrl: string | null } | null;
  onSignOut: () => Promise<void>;
  services: Array<{ service_id: string; service_name: string; role: string }>;
  activeServiceId: string | null;
  setActiveServiceId: (serviceId: string | null) => void;
};

export function Sidebar({
  expanded,
  active,
  onNavigate,
  userEmail,
  userProfile,
  onSignOut,
  services,
  activeServiceId,
  setActiveServiceId,
}: SidebarProps) {
  const [userMenuOpen, setUserMenuOpen] = useState(false);
  const [serviceMenuOpen, setServiceMenuOpen] = useState(false);
  const [serviceMenuPosition, setServiceMenuPosition] = useState<{ top: number; left: number; maxHeight: number } | null>(null);

  const PREFERRED_DROPDOWN_MAX = 280;
  const MIN_HEIGHT_BELOW_TO_OPEN_DOWN = 120; // otevřít nahoru jen když dole není aspoň tolik místa
  const computeServiceDropdownPosition = (rect: DOMRect) => {
    const gap = 8;
    const availableBelow = window.innerHeight - rect.bottom - gap;
    const availableAbove = rect.top - gap;
    // Preferovat otevření dolů – těsně pod tlačítkem (max výška podle místa)
    if (availableBelow >= MIN_HEIGHT_BELOW_TO_OPEN_DOWN) {
      return {
        top: rect.bottom + 4,
        left: rect.left,
        maxHeight: Math.min(PREFERRED_DROPDOWN_MAX, Math.max(120, availableBelow)),
      };
    }
    // Dole skoro žádné místo – otevřít nahoru, těsně nad tlačítkem
    const h = Math.min(PREFERRED_DROPDOWN_MAX, availableAbove);
    return {
      top: rect.top - 4 - h,
      left: rect.left,
      maxHeight: Math.max(120, h),
    };
  };
  const userMenuRef = useRef<HTMLDivElement>(null);
  const userMenuDropdownRef = useRef<HTMLDivElement>(null);
  const serviceMenuRef = useRef<HTMLDivElement>(null);
  const serviceMenuButtonRef = useRef<HTMLButtonElement>(null);
  const serviceMenuDropdownRef = useRef<HTMLDivElement>(null);

  const { theme } = useTheme();
  const logoColors = useMemo(() => getLogoColors(theme, "auto"), [theme]);
  const logoBackground = logoColors.background;
  const isLogoBgLight = useMemo(() => {
    const hex = logoBackground.replace(/^#/, "");
    if (hex.length !== 6) return false;
    const r = parseInt(hex.slice(0, 2), 16) / 255;
    const g = parseInt(hex.slice(2, 4), 16) / 255;
    const b = parseInt(hex.slice(4, 6), 16) / 255;
    const luminance = 0.299 * r + 0.587 * g + 0.114 * b;
    return luminance > 0.6;
  }, [logoBackground]);

  const isRootOwner = useIsRootOwner();
  const activeService = services.find(s => s.service_id === activeServiceId);
  const serviceName = activeService?.service_name || "Service desk";
  const hasMultipleServices = services.length > 1;
  const showServiceDropdown = hasMultipleServices || (isRootOwner && services.length === 0);
  const displayName = (userProfile?.nickname?.trim() || userEmail?.split("@")[0] || "Admin").trim() || "Admin";
  const avatarUrl = userProfile?.avatarUrl?.trim() || null;

  // Close user menu when clicking outside
  useEffect(() => {
    if (!userMenuOpen) return;

    const handleClickOutside = (event: MouseEvent) => {
      const target = event.target as Node;
      if (
        userMenuRef.current &&
        !userMenuRef.current.contains(target) &&
        userMenuDropdownRef.current &&
        !userMenuDropdownRef.current.contains(target)
      ) {
        setUserMenuOpen(false);
      }
    };

    // Use click instead of mousedown to avoid conflicts
    document.addEventListener("click", handleClickOutside, true);
    return () => {
      document.removeEventListener("click", handleClickOutside, true);
    };
  }, [userMenuOpen]);

  // Close service menu when sidebar collapses
  useEffect(() => {
    if (!expanded && serviceMenuOpen) {
      setServiceMenuOpen(false);
      setServiceMenuPosition(null);
    }
  }, [expanded, serviceMenuOpen]);

  // Update service menu position on scroll/resize
  useEffect(() => {
    if (!serviceMenuOpen || !serviceMenuButtonRef.current || !expanded) return;

    const updatePosition = () => {
      if (serviceMenuButtonRef.current) {
        const rect = serviceMenuButtonRef.current.getBoundingClientRect();
        setServiceMenuPosition(computeServiceDropdownPosition(rect));
      }
    };

    window.addEventListener("scroll", updatePosition, true);
    window.addEventListener("resize", updatePosition);

    return () => {
      window.removeEventListener("scroll", updatePosition, true);
      window.removeEventListener("resize", updatePosition);
    };
  }, [serviceMenuOpen, expanded]);

  // Close service menu when clicking outside
  useEffect(() => {
    if (!serviceMenuOpen) return;

    const handleClickOutside = (event: MouseEvent) => {
      const target = event.target as Node;
      // Check if click is inside the service menu container, button, or dropdown
      const isInsideContainer = serviceMenuRef.current?.contains(target);
      const isInsideButton = serviceMenuButtonRef.current?.contains(target);
      const isInsideDropdown = serviceMenuDropdownRef.current?.contains(target);
      
      if (!isInsideContainer && !isInsideButton && !isInsideDropdown) {
        setServiceMenuOpen(false);
        setServiceMenuPosition(null);
      }
    };

    // Use a small delay to avoid closing immediately when opening
    const timeoutId = setTimeout(() => {
      document.addEventListener("mousedown", handleClickOutside, true);
    }, 100);

    return () => {
      clearTimeout(timeoutId);
      document.removeEventListener("mousedown", handleClickOutside, true);
    };
  }, [serviceMenuOpen]);
  return (
    <div 
      style={{ 
        padding: "var(--pad-16)", 
        display: "flex", 
        flexDirection: "column", 
        gap: 14,
        transition: "var(--transition-smooth)",
      }}
    >
      {/* Brand – pozadí = barva pozadí aktuálně zvoleného loga Jobi */}
      <div style={{ 
        display: "flex", 
        alignItems: "center", 
        gap: expanded ? 12 : 0, 
        padding: expanded ? "10px 12px" : "8px",
        borderRadius: expanded ? 16 : 14,
        justifyContent: expanded ? "flex-start" : "center",
        background: logoBackground,
        transition: "all 250ms cubic-bezier(0.4, 0, 0.2, 1)",
        boxShadow: "0 4px 16px rgba(0,0,0,0.12)",
        minHeight: expanded ? "auto" : 40,
        position: "relative",
        overflow: "visible"
      }}>
        {/* Expanded content */}
        <div 
          style={{
            minWidth: 0,
            opacity: expanded ? 1 : 0,
            width: expanded ? "auto" : 0,
            maxWidth: expanded ? "100%" : 0,
            transition: "opacity 200ms cubic-bezier(0.4, 0, 0.2, 1), width 250ms cubic-bezier(0.4, 0, 0.2, 1), max-width 250ms cubic-bezier(0.4, 0, 0.2, 1)",
            transitionDelay: expanded ? "50ms" : "0ms",
            display: expanded ? "flex" : "none",
            flexDirection: "column",
            gap: 2,
            flex: expanded ? 1 : 0,
            overflow: "visible",
            pointerEvents: expanded ? "auto" : "none"
          }}
        >
          <div style={{ 
            display: "flex", 
            alignItems: "center", 
            gap: expanded ? 10 : 0, 
            minWidth: 0,
            flex: 1,
          }}>
            <AppLogo size={expanded ? 28 : 24} colors={logoColors} style={{ flexShrink: 0 }} />
            {expanded && (
              <span style={{ 
                fontWeight: 800, 
                lineHeight: 1.2, 
                whiteSpace: "nowrap", 
                overflow: "hidden", 
                textOverflow: "ellipsis", 
                color: isLogoBgLight ? "#111827" : "white",
                fontSize: 20,
                letterSpacing: "-0.02em",
                fontFamily: "system-ui, -apple-system, sans-serif",
                textShadow: isLogoBgLight ? "none" : "0 2px 8px rgba(0,0,0,0.1)"
              }}>
                jobi
              </span>
            )}
          </div>
        </div>
        
        {/* Collapsed content */}
        <div style={{
          position: expanded ? "absolute" : "static",
          opacity: expanded ? 0 : 1,
          width: expanded ? 0 : "100%",
          transition: "opacity 200ms cubic-bezier(0.4, 0, 0.2, 1), width 250ms cubic-bezier(0.4, 0, 0.2, 1)",
          transitionDelay: expanded ? "0ms" : "50ms",
          display: expanded ? "none" : "flex",
          alignItems: "center",
          justifyContent: "center",
          pointerEvents: expanded ? "none" : "auto",
          left: 0,
          right: 0
        }}>
          <AppLogo size={24} colors={logoColors} />
        </div>
      </div>

      <div style={{ height: 1, background: "var(--border)", margin: "6px 0 2px" }} />

      {/* Nav */}
      <nav style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {[
          { key: "orders" as const, label: "Zakázky", icon: OrdersIcon },
          { key: "inventory" as const, label: "Sklad", icon: BoxIcon },
          { key: "devices" as const, label: "Zařízení", icon: DevicesIcon },
          { key: "customers" as const, label: "Zákazníci", icon: UsersIcon },
          { key: "statistics" as const, label: "Statistiky", icon: StatisticsIcon },
          { key: "settings" as const, label: "Nastavení", icon: SettingsIcon },
        ].map((item) => {
          const isActive = item.key === active;
          const IconComponent = item.icon;
          const iconSize = expanded ? 20 : 16;

          return (
            <button
              key={item.key}
              type="button"
              onClick={() => onNavigate(item.key)}
              style={{
                width: "100%",
                border: "none",
                background: isActive ? "var(--accent-soft)" : "transparent",
                color: isActive ? "var(--accent)" : "var(--text)",
                padding: expanded ? "12px 12px" : "14px 4px",
                borderRadius: 16,
                display: "flex",
                alignItems: "center",
                justifyContent: expanded ? "flex-start" : "center",
                gap: expanded ? 14 : 0,
                transition: "all 250ms cubic-bezier(0.4, 0, 0.2, 1)",
                cursor: "pointer",
                textAlign: "left",
                outline: "none",
                boxShadow: isActive ? `0 4px 16px var(--accent-glow)` : "none",
                minWidth: 0,
                overflow: "hidden",
              }}
              onMouseEnter={(e) => {
                if (!isActive) {
                  e.currentTarget.style.background = "var(--panel-2)";
                  e.currentTarget.style.boxShadow = `0 4px 16px var(--accent-glow)`;
                }
              }}
              onMouseLeave={(e) => {
                if (!isActive) {
                  e.currentTarget.style.background = "transparent";
                  e.currentTarget.style.boxShadow = "none";
                }
              }}
            >
              <IconBox size={expanded ? 40 : 28}>
                <IconComponent size={iconSize} />
              </IconBox>

              <div 
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  flex: expanded ? 1 : 0,
                  minWidth: 0,
                  opacity: expanded ? 1 : 0,
                  width: expanded ? "auto" : 0,
                  maxWidth: expanded ? "100%" : 0,
                  transition: "opacity 200ms cubic-bezier(0.4, 0, 0.2, 1), width 250ms cubic-bezier(0.4, 0, 0.2, 1), max-width 250ms cubic-bezier(0.4, 0, 0.2, 1)",
                  transitionDelay: expanded ? "50ms" : "0ms",
                  overflow: "hidden",
                  pointerEvents: expanded ? "auto" : "none"
                }}
              >
                <span style={{ fontWeight: 600, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", color: isActive ? "var(--accent)" : "var(--text)" }}>
                  {item.label}
                </span>
              </div>
            </button>
          );
        })}
      </nav>

      <div style={{ flex: 1 }} />

      {/* Bottom user profile - only show when expanded */}
      {expanded && (
        <div
          ref={userMenuRef}
          style={{
            position: "relative",
            padding: "12px 12px",
            borderRadius: 16,
            background: "var(--panel-2)",
            backdropFilter: "var(--blur)",
            WebkitBackdropFilter: "var(--blur)",
            border: "1px solid var(--border)",
            display: "flex",
            alignItems: "center",
            gap: 14,
            transition: "var(--transition-smooth)",
            boxShadow: "var(--shadow-soft)",
            opacity: expanded ? 1 : 0,
          }}
        >
          <button
            type="button"
            onClick={() => setUserMenuOpen(!userMenuOpen)}
            style={{
              width: "100%",
              display: "flex",
              alignItems: "center",
              gap: 14,
              border: "none",
              background: "transparent",
              cursor: "pointer",
              padding: 0,
            }}
          >
            {avatarUrl ? (
              <img
                src={avatarUrl}
                alt=""
                style={{
                  width: 38,
                  height: 38,
                  borderRadius: 16,
                  objectFit: "cover",
                  border: "1px solid var(--border)",
                  flex: "0 0 auto",
                }}
                onError={(e) => {
                  (e.target as HTMLImageElement).style.display = "none";
                  const fallback = (e.target as HTMLImageElement).nextElementSibling as HTMLElement | null;
                  if (fallback) fallback.style.display = "grid";
                }}
              />
            ) : null}
            <div
              style={{
                width: 38,
                height: 38,
                borderRadius: 16,
                background: "linear-gradient(135deg, var(--accent), var(--accent-hover))",
                color: "white",
                display: avatarUrl ? "none" : "grid",
                placeItems: "center",
                fontWeight: 700,
                transition: "var(--transition-smooth)",
                boxShadow: "var(--shadow-soft)",
                flex: "0 0 auto",
              }}
            >
              {(displayName || "A").charAt(0).toUpperCase()}
            </div>
            <div
              style={{
                minWidth: 0,
                opacity: expanded ? 1 : 0,
                transition: "opacity 0.3s cubic-bezier(0.4, 0, 0.2, 1) 0.1s",
                flex: 1,
              }}
            >
              <div
                style={{
                  fontWeight: 700,
                  fontSize: 13,
                  lineHeight: 1.3,
                  whiteSpace: "nowrap",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  color: "var(--text)",
                }}
              >
                {displayName}
              </div>
              <div
                style={{
                  color: "var(--muted)",
                  fontSize: 12,
                  marginTop: 2,
                  whiteSpace: "nowrap",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                }}
              >
                Local workspace
              </div>
            </div>
          </button>

          {userMenuOpen && (
            <div
              ref={userMenuDropdownRef}
              style={{
                position: "absolute",
                bottom: "100%",
                left: 0,
                marginBottom: 8,
                width: "100%",
                background: "var(--panel)",
                backdropFilter: "var(--blur)",
                WebkitBackdropFilter: "var(--blur)",
                border: "1px solid var(--border)",
                borderRadius: 12,
                boxShadow: "var(--shadow-soft)",
                overflow: "hidden",
                zIndex: 1000,
              }}
            >
              <button
                type="button"
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  console.log("[Sidebar] Sign out button clicked");
                  
                  // Close menu immediately
                  setUserMenuOpen(false);
                  
                  // Call signOut asynchronously
                  onSignOut()
                    .then(() => {
                      console.log("[Sidebar] Sign out completed successfully");
                    })
                    .catch((error) => {
                      console.error("[Sidebar] Error signing out:", error);
                    });
                }}
                style={{
                  width: "100%",
                  padding: "12px 16px",
                  border: "none",
                  background: "transparent",
                  color: "var(--text)",
                  fontSize: 13,
                  fontWeight: 600,
                  textAlign: "left",
                  cursor: "pointer",
                  transition: "var(--transition-smooth)",
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.background = "var(--panel-2)";
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.background = "transparent";
                }}
              >
                Odhlásit se
              </button>
            </div>
          )}
        </div>
      )}

      {/* Výběr servisu – pod účtem */}
      {expanded && showServiceDropdown && (
        <div
          ref={serviceMenuRef}
          style={{
            position: "relative",
            padding: "10px 12px",
            borderRadius: 16,
            background: "var(--panel-2)",
            backdropFilter: "var(--blur)",
            WebkitBackdropFilter: "var(--blur)",
            border: "1px solid var(--border)",
            boxShadow: "var(--shadow-soft)",
            overflow: "visible",
          }}
        >
          <button
            ref={serviceMenuButtonRef}
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              e.preventDefault();
              if (serviceMenuButtonRef.current) {
                const rect = serviceMenuButtonRef.current.getBoundingClientRect();
                setServiceMenuPosition(computeServiceDropdownPosition(rect));
              }
              setServiceMenuOpen((prev) => !prev);
            }}
            style={{
              background: "transparent",
              border: "none",
              color: "var(--text)",
              fontSize: 13,
              fontWeight: 600,
              whiteSpace: "nowrap",
              overflow: "hidden",
              textOverflow: "ellipsis",
              cursor: "pointer",
              padding: "4px 4px",
              borderRadius: "8px",
              display: "flex",
              alignItems: "center",
              gap: 6,
              width: "100%",
              textAlign: "left",
              transition: "background 0.2s",
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = "var(--bg)";
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = "transparent";
            }}
          >
            <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis" }}>{serviceName}</span>
            <span style={{ fontSize: 10, color: "var(--muted)" }}>▼</span>
          </button>
          {serviceMenuOpen && serviceMenuPosition && createPortal(
            <div
              ref={serviceMenuDropdownRef}
              style={{
                position: "fixed",
                top: serviceMenuPosition.top,
                left: serviceMenuPosition.left,
                background: "var(--panel)",
                border: "1px solid var(--border)",
                borderRadius: "var(--radius-md)",
                boxShadow: "var(--shadow-lg)",
                zIndex: 10000,
                minWidth: 200,
                maxWidth: 300,
                maxHeight: serviceMenuPosition.maxHeight,
                overflowX: "hidden",
                overflowY: "auto",
                pointerEvents: "auto",
                opacity: 1,
                visibility: "visible",
                display: "block"
              }}
              onClick={(e) => {
                e.stopPropagation();
              }}
            >
              {services.length === 0 ? (
                <div style={{ padding: "12px 12px", color: "var(--muted)", fontSize: 12 }}>
                  Zatím žádné servisy
                </div>
              ) : (
              services.map((service) => (
                <button
                  key={service.service_id}
                  onClick={(e) => {
                    e.stopPropagation();
                    e.preventDefault();
                    setActiveServiceId(service.service_id);
                    setServiceMenuOpen(false);
                    setServiceMenuPosition(null);
                  }}
                  style={{
                    width: "100%",
                    padding: "10px 12px",
                    background: service.service_id === activeServiceId ? "var(--accent-soft)" : "transparent",
                    border: "none",
                    color: service.service_id === activeServiceId ? "var(--accent)" : "var(--text)",
                    fontSize: 13,
                    fontWeight: service.service_id === activeServiceId ? 600 : 400,
                    textAlign: "left",
                    cursor: "pointer",
                    transition: "all 0.2s",
                    display: "flex",
                    alignItems: "center",
                    gap: 8
                  }}
                  onMouseEnter={(e) => {
                    if (service.service_id !== activeServiceId) {
                      e.currentTarget.style.background = "var(--bg)";
                    }
                  }}
                  onMouseLeave={(e) => {
                    if (service.service_id !== activeServiceId) {
                      e.currentTarget.style.background = "transparent";
                    }
                  }}
                >
                  <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis" }}>
                    {service.service_name}
                  </span>
                  {service.service_id === activeServiceId && (
                    <span style={{ fontSize: 12 }}>✓</span>
                  )}
                </button>
              ))
              )}
            </div>,
            document.body
          )}
        </div>
      )}
    </div>
  );
}
