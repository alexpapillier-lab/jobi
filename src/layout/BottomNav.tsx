import React, { useEffect, useState } from "react";
import type { NavKey } from "./Sidebar";

/**
 * Spodní navigace pro úzké obrazovky (webová verze na telefonu).
 *
 * Boční lišta zabírá 68 px, což je na 375px displeji pětina šířky – obsah
 * se pak nevejde a ořízne se. Vychází z BottomNav v iOS forku, ale Jobi má
 * víc sekcí (SMS, kalendář, faktury), a šest záložek se do spodní lišty
 * nevejde. Proto čtyři hlavní a zbytek pod "Více".
 *
 * Panel "Více" nese i účet, přepínač servisu a odhlášení. Ty totiž bydlí
 * jenom v boční liště, a tu AppLayout na telefonu vůbec nevykresluje –
 * bez tohohle se na mobilu nedalo přepnout servis ani se odhlásit.
 */

type Tab = { key: NavKey; label: string; icon: React.ReactNode };

const icon = (d: string) => (
  <svg width={22} height={22} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
    <path d={d} />
  </svg>
);

const ORDERS: Tab = { key: "orders", label: "Zakázky", icon: icon("M9 12h6M9 16h6M10 8h4M5 4h14a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1z") };
const CUSTOMERS: Tab = { key: "customers", label: "Zákazníci", icon: icon("M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2M23 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8z") };
const CALENDAR: Tab = { key: "calendar", label: "Kalendář", icon: icon("M3 6a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2zM16 2v4M8 2v4M3 10h18") };
const INVENTORY: Tab = { key: "inventory", label: "Sklad", icon: icon("M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16zM3.27 6.96L12 12.01l8.73-5.05M12 22.08V12") };
const DEVICES: Tab = { key: "devices", label: "Zařízení", icon: icon("M5 4a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v16a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2zM12 18h.01") };
const SMS: Tab = { key: "sms", label: "SMS", icon: icon("M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z") };
const INVOICES: Tab = { key: "invoices", label: "Faktury", icon: icon("M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8zM14 2v6h6M8 13h8M8 17h5") };
const STATS: Tab = { key: "statistics", label: "Statistiky", icon: icon("M18 20V10M12 20V4M6 20v-6") };
const SETTINGS: Tab = { key: "settings", label: "Nastavení", icon: icon("M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z") };

const PRIMARY: Tab[] = [ORDERS, CUSTOMERS, CALENDAR, INVENTORY];

export type BottomNavProps = {
  active: NavKey;
  onNavigate: (k: NavKey) => void;
  invoicingEnabled?: boolean;
  smsEnabled?: boolean;
  smsUnreadCount?: number;
  services?: Array<{ service_id: string; service_name: string; role: string }>;
  activeServiceId?: string | null;
  setActiveServiceId?: (serviceId: string | null) => void;
  userEmail?: string | null;
  userProfile?: { nickname: string | null; avatarUrl: string | null } | null;
  onSignOut?: () => Promise<void> | void;
};

export function BottomNav({
  active,
  onNavigate,
  invoicingEnabled = true,
  smsEnabled = false,
  smsUnreadCount = 0,
  services = [],
  activeServiceId = null,
  setActiveServiceId,
  userEmail = null,
  userProfile = null,
  onSignOut,
}: BottomNavProps) {
  const [moreOpen, setMoreOpen] = useState(false);
  const [servicesOpen, setServicesOpen] = useState(false);

  // Zavřený panel si nemá pamatovat, že v něm byl rozbalený seznam servisů.
  useEffect(() => {
    if (!moreOpen) setServicesOpen(false);
  }, [moreOpen]);

  const secondary: Tab[] = [
    ...(smsEnabled ? [SMS] : []),
    DEVICES,
    ...(invoicingEnabled ? [INVOICES] : []),
    STATS,
    SETTINGS,
  ];

  const moreActive = secondary.some((t) => t.key === active);

  const activeService = services.find((s) => s.service_id === activeServiceId);
  const serviceName = activeService?.service_name || "Servis";
  const canSwitchService = services.length > 1 && !!setActiveServiceId;

  const displayName = userProfile?.nickname || userEmail || "Účet";
  const avatarUrl = userProfile?.avatarUrl;

  const tabButton = (tab: Tab, isActive: boolean, onClick: () => void, badge = 0) => (
    <button
      key={tab.key}
      type="button"
      onClick={onClick}
      aria-current={isActive ? "page" : undefined}
      style={{
        flex: 1,
        minWidth: 0,
        position: "relative",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: 2,
        padding: "6px 2px",
        border: "none",
        background: "none",
        color: isActive ? "var(--accent)" : "var(--muted)",
        cursor: "pointer",
        fontFamily: "inherit",
        fontSize: 10,
        fontWeight: isActive ? 700 : 500,
        minHeight: "var(--touch-min)",
        transition: "color 0.2s ease",
      }}
    >
      <span style={{ opacity: isActive ? 1 : 0.75, position: "relative" }}>
        {tab.icon}
        {badge > 0 && (
          <span
            style={{
              position: "absolute",
              top: -4,
              right: -8,
              minWidth: 16,
              height: 16,
              padding: "0 4px",
              borderRadius: 8,
              background: "var(--danger)",
              color: "#fff",
              fontSize: 10,
              fontWeight: 700,
              display: "grid",
              placeItems: "center",
            }}
          >
            {badge > 99 ? "99+" : badge}
          </span>
        )}
      </span>
      {/* Delší popisky ("Zákazníci") se do pětiny šířky nevejdou – ať se
          zkrátí tečkami místo toho, aby roztlačily sousední záložky. */}
      <span style={{ maxWidth: "100%", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
        {tab.label}
      </span>
    </button>
  );

  const rowStyle: React.CSSProperties = {
    display: "flex",
    alignItems: "center",
    gap: 10,
    width: "100%",
    minHeight: "var(--touch-min)",
    padding: "8px 10px",
    borderRadius: 12,
    border: "none",
    background: "transparent",
    color: "var(--text)",
    font: "inherit",
    fontSize: 13,
    textAlign: "left",
    cursor: "pointer",
  };

  return (
    <>
      {moreOpen && (
        <div
          onClick={() => setMoreOpen(false)}
          /* Nad plovoucím "+" (1050), pod okny (1100+) – viz pásma v theme.css. */
          style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.35)", zIndex: 1060 }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              position: "fixed",
              left: 0,
              right: 0,
              bottom: `calc(var(--bottom-nav-h) + var(--safe-bottom))`,
              background: "var(--panel)",
              backdropFilter: "var(--blur)",
              WebkitBackdropFilter: "var(--blur)",
              borderTop: "1px solid var(--border)",
              padding: "8px 8px 12px",
              display: "flex",
              flexDirection: "column",
              gap: 8,
              /* Se seznamem servisů panel vyroste; ať se dá dorolovat
                 místo toho, aby zmizel za horním okrajem displeje. */
              maxHeight: "calc(100dvh - var(--bottom-nav-h) - var(--safe-bottom) - 24px)",
              overflowY: "auto",
              zIndex: 1061,
            }}
          >
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fit, minmax(84px, 1fr))",
                gap: 4,
              }}
            >
              {secondary.map((t) =>
                tabButton(t, active === t.key, () => {
                  onNavigate(t.key);
                  setMoreOpen(false);
                }, t.key === "sms" ? smsUnreadCount : 0)
              )}
            </div>

            <div style={{ height: 1, background: "var(--border)", margin: "2px 0" }} />

            {/* Účet */}
            <div style={{ ...rowStyle, cursor: "default" }}>
              {avatarUrl ? (
                <img
                  src={avatarUrl}
                  alt=""
                  style={{ width: 32, height: 32, borderRadius: 12, objectFit: "cover", border: "1px solid var(--border)", flex: "0 0 auto" }}
                />
              ) : (
                <div
                  style={{
                    width: 32, height: 32, borderRadius: 12, flex: "0 0 auto",
                    background: "linear-gradient(135deg, var(--accent), var(--accent-hover))",
                    color: "#fff", display: "grid", placeItems: "center", fontWeight: 700,
                  }}
                >
                  {displayName.charAt(0).toUpperCase()}
                </div>
              )}
              <div style={{ minWidth: 0, flex: 1 }}>
                <div style={{ fontWeight: 700, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {displayName}
                </div>
                {userEmail && userEmail !== displayName && (
                  <div style={{ fontSize: 11, color: "var(--muted)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {userEmail}
                  </div>
                )}
              </div>
            </div>

            {/* Servis */}
            {services.length > 0 && (
              <button
                type="button"
                disabled={!canSwitchService}
                aria-expanded={canSwitchService ? servicesOpen : undefined}
                onClick={() => canSwitchService && setServicesOpen((v) => !v)}
                style={{ ...rowStyle, background: "var(--panel-2)", cursor: canSwitchService ? "pointer" : "default" }}
              >
                <span style={{ color: "var(--muted)", flex: "0 0 auto" }}>Servis</span>
                <span style={{ flex: 1, minWidth: 0, fontWeight: 700, textAlign: "right", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {serviceName}
                </span>
                {canSwitchService && <span style={{ fontSize: 10, color: "var(--muted)", flex: "0 0 auto" }}>{servicesOpen ? "▲" : "▼"}</span>}
              </button>
            )}

            {servicesOpen && canSwitchService && (
              <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                {services.map((s) => (
                  <button
                    key={s.service_id}
                    type="button"
                    onClick={() => {
                      setActiveServiceId?.(s.service_id);
                      setServicesOpen(false);
                      setMoreOpen(false);
                    }}
                    style={{
                      ...rowStyle,
                      paddingLeft: 18,
                      color: s.service_id === activeServiceId ? "var(--accent)" : "var(--text)",
                      fontWeight: s.service_id === activeServiceId ? 700 : 500,
                    }}
                  >
                    <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {s.service_name}
                    </span>
                    {s.service_id === activeServiceId && <span style={{ flex: "0 0 auto" }}>✓</span>}
                  </button>
                ))}
              </div>
            )}

            {onSignOut && (
              <button
                type="button"
                onClick={() => {
                  setMoreOpen(false);
                  void onSignOut();
                }}
                style={{ ...rowStyle, color: "var(--danger-text)", fontWeight: 600 }}
              >
                Odhlásit se
              </button>
            )}
          </div>
        </div>
      )}

      <nav
        aria-label="Hlavní navigace"
        style={{
          position: "fixed",
          bottom: 0,
          left: 0,
          right: 0,
          height: `calc(var(--bottom-nav-h) + var(--safe-bottom))`,
          paddingBottom: "var(--safe-bottom)",
          background: "var(--panel)",
          backdropFilter: "var(--blur)",
          WebkitBackdropFilter: "var(--blur)",
          borderTop: "1px solid var(--border)",
          display: "flex",
          justifyContent: "space-around",
          alignItems: "center",
          zIndex: 1002,
        }}
      >
        {PRIMARY.map((t) => tabButton(t, active === t.key, () => onNavigate(t.key)))}
        {tabButton(
          { key: "settings", label: "Více", icon: icon("M4 12h.01M12 12h.01M20 12h.01") },
          moreActive || moreOpen,
          () => setMoreOpen((v) => !v),
          smsEnabled && !moreOpen ? smsUnreadCount : 0
        )}
      </nav>
    </>
  );
}
