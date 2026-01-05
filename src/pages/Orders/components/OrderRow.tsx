import type { TicketEx } from "../../Orders";
import type { StatusMeta } from "../../../state/StatusesStore";
import { formatCZ, formatPhoneNumber, DeviceIcon, WrenchIcon } from "../../../lib/ordersUi";
import { StatusPicker } from "./StatusPicker";

type OrderRowProps = {
  ticket: TicketEx;
  statusById: Record<string, string>;
  normalizeStatus: (key: string) => string | null;
  getByKey: (k: string) => StatusMeta | undefined;
  onSelect: (id: string) => void;
  onStatusChange: (id: string, status: string) => void;
  statuses: StatusMeta[];
  displayMode: "list" | "grid" | "compact";
};

export function OrderRow({
  ticket: t,
  statusById,
  normalizeStatus,
  getByKey,
  onSelect,
  onStatusChange,
  statuses,
  displayMode,
}: OrderRowProps) {
  const raw = (t.status as any) ?? statusById[t.id];
  const currentStatus = normalizeStatus(raw);
  const meta = currentStatus !== null ? getByKey(currentStatus) : null;
  const cardKey = t.id;

  return (
    <div
      key={cardKey}
      onClick={() => onSelect(t.id)}
      style={{
        textAlign: "left",
        padding: 0,
        borderRadius: 16,
        border: meta?.bg ? `2px solid ${meta.bg}80` : "1px solid var(--border)",
        background: meta?.bg ? `${meta.bg}30` : "var(--panel)",
        backdropFilter: "var(--blur)",
        WebkitBackdropFilter: "var(--blur)",
        cursor: "pointer",
        boxShadow: meta?.bg ? `0 4px 16px ${meta.bg}40, 0 0 0 1px ${meta.bg}20` : "var(--shadow-soft)",
        transition: "var(--transition-smooth)",
        color: "var(--text)",
        fontFamily: "system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif",
        position: "relative",
        overflow: "hidden",
        display: "flex",
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.transform = "translateY(-1px)";
        e.currentTarget.style.boxShadow = meta?.bg ? `0 6px 20px ${meta.bg}50, 0 0 0 1px ${meta.bg}30` : "var(--shadow-hover)";
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.transform = "translateY(0)";
        e.currentTarget.style.boxShadow = meta?.bg ? `0 4px 16px ${meta.bg}40, 0 0 0 1px ${meta.bg}20` : "var(--shadow-soft)";
      }}
    >
      <div
        style={{
          width: 10,
          background: meta?.bg || "var(--border)",
          flexShrink: 0,
          boxShadow: meta?.bg ? `0 0 24px ${meta.bg}90, inset 0 0 12px ${meta.bg}60, 0 0 8px ${meta.bg}50` : "none",
        }}
      />

      <div style={{ 
        flex: 1, 
        padding: displayMode === "grid" ? 14 : 16, 
        display: "flex", 
        flexDirection: "column", 
        gap: displayMode === "grid" ? 10 : 12 
      }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12, marginBottom: displayMode === "grid" ? 8 : 4 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10, minWidth: 0, flex: 1 }}>
            <div
              style={{
                fontWeight: 950,
                fontSize: 15,
                letterSpacing: "-0.01em",
                color: "var(--text)",
                whiteSpace: "nowrap",
              }}
            >
              {t.code}
            </div>
            <div style={{ fontSize: 12, color: "var(--muted)", whiteSpace: "nowrap" }}>{formatCZ(t.createdAt)}</div>
            {meta?.isFinal && (
              <span
                style={{
                  fontSize: 9,
                  fontWeight: 900,
                  padding: "2px 5px",
                  borderRadius: 4,
                  background: "var(--accent-soft)",
                  color: "var(--accent)",
                  textTransform: "uppercase",
                  letterSpacing: "0.5px",
                  whiteSpace: "nowrap",
                }}
              >
                ✓
              </span>
            )}
          </div>

          <div onClick={(e) => e.stopPropagation()} onMouseDown={(e) => e.stopPropagation()}>
            {currentStatus !== null ? (
            <StatusPicker
              value={currentStatus}
              statuses={statuses as any}
              getByKey={getByKey as any}
              onChange={(next) => onStatusChange(t.id, next)}
              size="sm"
            />
            ) : (
              <div
                style={{
                  fontSize: 12,
                  padding: "6px 10px",
                  borderRadius: 8,
                  background: "var(--panel-2)",
                  color: "var(--muted)",
                  fontWeight: 600,
                }}
              >
                …
              </div>
            )}
          </div>
        </div>

        {displayMode === "compact" ? (
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          <div style={{ display: "flex", alignItems: "baseline", gap: 8, flexWrap: "wrap" }}>
            <div
              style={{
                fontWeight: 950,
                fontSize: 15,
                color: "var(--accent)",
                minWidth: 0,
                flex: 1,
                display: "flex",
                alignItems: "center",
                gap: 6,
              }}
            >
              <DeviceIcon size={14} color="var(--accent)" />
              <span>{t.deviceLabel || "—"}</span>
            </div>
            <div style={{ fontWeight: 600, fontSize: 12, color: "var(--muted)", whiteSpace: "nowrap" }}>
              {t.customerName}
            </div>
          </div>
          {(t.requestedRepair || t.issueShort) && (
            <div
              style={{
                fontSize: 13,
                fontWeight: 700,
                color: "var(--text)",
                minWidth: 0,
                display: "flex",
                alignItems: "center",
                gap: 6,
              }}
            >
              <WrenchIcon size={12} color="var(--text)" />
              <span>{t.requestedRepair || t.issueShort}</span>
            </div>
          )}
            {(() => {
              const repairs = t.performedRepairs ?? [];
              const totalPrice = repairs.reduce((sum: number, r: any) => sum + (r.price || 0), 0);
              const discountType = t.discountType;
              const discountValue = t.discountValue || 0;
              let discountAmount = 0;
              if (discountType === "percentage") {
                discountAmount = (totalPrice * discountValue) / 100;
              } else if (discountType === "amount") {
                discountAmount = discountValue;
              }
              const finalPrice = Math.max(0, totalPrice - discountAmount);
              const hasRepairs = repairs.length > 0;
              const hasPrice = finalPrice > 0;

              if (hasRepairs || hasPrice) {
                return (
                  <div style={{ 
                    display: "flex", 
                    alignItems: "center", 
                    gap: 6,
                    fontSize: 10,
                    color: "var(--muted)",
                    whiteSpace: "nowrap",
                  }}>
                    {hasRepairs && <span>{repairs.length} oprav</span>}
                    {hasRepairs && hasPrice && <span>•</span>}
                    {hasPrice && <span style={{ fontWeight: 700, color: "var(--accent)" }}>{finalPrice.toLocaleString("cs-CZ")} Kč</span>}
              </div>
                );
              }
              return null;
            })()}
          </div>
        ) : (
          <>
            <div style={{ 
              display: "flex", 
              alignItems: "flex-start", 
              gap: 10,
            }}>
              <div style={{ 
                display: "flex", 
                alignItems: "center", 
                justifyContent: "center",
                width: 28,
                height: 28,
                borderRadius: 6,
                background: "var(--accent-soft)",
                color: "var(--accent)",
                flexShrink: 0,
                marginTop: 2,
              }}>
                <DeviceIcon size={16} color="currentColor" />
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ 
                  display: "flex",
                  alignItems: "baseline",
                  gap: 8,
                  flexWrap: "wrap",
                  marginBottom: 4,
                }}>
                  <div style={{ 
                    fontWeight: 950, 
                    fontSize: 16, 
                    color: "var(--text)",
                    lineHeight: 1.4,
                  }}>
                    {t.deviceLabel || "—"}
                  </div>
                  <div style={{ 
                    fontWeight: 600, 
                    fontSize: 12, 
                    color: "var(--muted)",
                    whiteSpace: "nowrap",
                  }}>
                    {t.customerName}
                  </div>
                </div>
                {t.serialOrImei && (
                  <div style={{ fontSize: 11, color: "var(--muted)" }}>
                    SN: {t.serialOrImei}
                  </div>
                )}
              </div>
            </div>

            {(t.requestedRepair || t.issueShort) && (
              <div style={{ 
                display: "flex", 
                alignItems: "flex-start", 
                gap: 10,
                marginTop: 4,
              }}>
                <div style={{ 
                  display: "flex", 
                  alignItems: "center", 
                  justifyContent: "center",
                  width: 28,
                  height: 28,
                  borderRadius: 6,
                  background: "var(--panel)",
                  border: "1px solid var(--border)",
                  color: "var(--text)",
                  flexShrink: 0,
                  marginTop: 2,
                }}>
                  <WrenchIcon size={16} color="currentColor" />
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ 
                    fontSize: 14, 
                    fontWeight: 700, 
                    color: "var(--text)",
                    lineHeight: 1.4,
                  }}>
                    {t.requestedRepair || t.issueShort}
                  </div>
                </div>
              </div>
            )}

            {(() => {
              const repairs = t.performedRepairs ?? [];
              const totalPrice = repairs.reduce((sum: number, r: any) => sum + (r.price || 0), 0);
              const discountType = t.discountType;
              const discountValue = t.discountValue || 0;
              let discountAmount = 0;
              if (discountType === "percentage") {
                discountAmount = (totalPrice * discountValue) / 100;
              } else if (discountType === "amount") {
                discountAmount = discountValue;
              }
              const finalPrice = Math.max(0, totalPrice - discountAmount);
              const hasRepairs = repairs.length > 0;
              const hasPrice = finalPrice > 0;

              return (
                <>
                  {(hasRepairs || hasPrice) && (
                    <div style={{ 
                      display: "flex", 
                      alignItems: "center", 
                      gap: 8,
                      padding: "8px 10px",
                      background: "var(--panel)",
                      borderRadius: 8,
                      border: "1px solid var(--border)",
                      marginTop: 8,
                    }}>
                      {hasRepairs && (
                        <div style={{ 
                          display: "flex", 
                          alignItems: "center", 
                          gap: 6,
                          fontSize: 11,
                          color: "var(--muted)",
                        }}>
                          <WrenchIcon size={12} color="currentColor" />
                          <span>{repairs.length} {repairs.length === 1 ? "oprava" : repairs.length < 5 ? "opravy" : "oprav"}</span>
                        </div>
                      )}
                      {hasPrice && (
                        <div style={{ 
                          display: "flex", 
                          alignItems: "center", 
                          gap: 6,
                          fontSize: 13,
                          fontWeight: 700,
                          color: "var(--accent)",
                          marginLeft: hasRepairs ? "auto" : 0,
                        }}>
                          <span>{finalPrice.toLocaleString("cs-CZ")} Kč</span>
                        </div>
                      )}
                    </div>
                  )}
                  {t.customerPhone && (
                    <div style={{ 
                      display: "flex", 
                      alignItems: "center", 
                      gap: 12, 
                      flexWrap: "wrap",
                      paddingTop: 8,
                      borderTop: "1px solid var(--border)",
                      marginTop: 8,
                    }}>
                      <div style={{ fontSize: 11, color: "var(--muted)", whiteSpace: "nowrap" }}>
                        {formatPhoneNumber(t.customerPhone)}
                      </div>
                    </div>
                  )}
                </>
              );
            })()}
          </>
        )}
      </div>
    </div>
  );
}

