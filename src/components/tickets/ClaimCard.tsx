import React from "react";
import { DeviceIcon, WrenchIcon } from "./icons";

const CLAIM_ACCENT = "#0d9488";

type ClaimData = {
  id: string;
  code: string;
  status: string;
  created_at?: string;
  device_label?: string;
  device_serial?: string;
  customer_name?: string | null;
  notes?: string | null;
};

type ClaimCardProps = {
  claim: ClaimData;
  displayMode: string;
  statusColor: string;
  statusLabel?: string;
  onClick: () => void;
  statusPicker: React.ReactNode;
  printButton?: React.ReactNode;
};

function formatCZ(dtIso: string): string {
  try {
    const d = new Date(dtIso);
    return `${d.getDate()}.${d.getMonth() + 1}.${d.getFullYear()}`;
  } catch {
    return dtIso;
  }
}

function ClaimBadge({ size = "normal" }: { size?: "small" | "normal" }) {
  const isSmall = size === "small";
  return (
    <span style={{
      fontSize: isSmall ? 8 : 9, fontWeight: 800, padding: isSmall ? "2px 5px" : "2px 6px", borderRadius: 4,
      background: `${CLAIM_ACCENT}12`, color: CLAIM_ACCENT,
      border: `1px solid ${CLAIM_ACCENT}25`,
      textTransform: "uppercase", letterSpacing: "0.5px",
      whiteSpace: "nowrap", flexShrink: 0,
    }}>
      {isSmall ? "R" : "Reklamace"}
    </span>
  );
}

function Controls({ statusPicker, printButton }: { statusPicker: React.ReactNode; printButton?: React.ReactNode }) {
  return (
    /* marginLeft: auto drží dvojici u pravého okraje i tehdy, když se
       řádek na úzké obrazovce zalomí a zbylo na ni málo místa. */
    <div style={{ display: "flex", alignItems: "center", gap: 4, flexShrink: 0, marginLeft: "auto" }} onClick={(e) => e.stopPropagation()} onMouseDown={(e) => e.stopPropagation()}>
      {statusPicker}
      {printButton}
    </div>
  );
}

export function ClaimCard({ claim: c, displayMode, statusColor, statusLabel, onClick, statusPicker, printButton }: ClaimCardProps) {
  const dateStr = c.created_at ? formatCZ(c.created_at) : "—";

  if (displayMode === "compact-extra") {
    return (
      <div
        onClick={onClick}
        style={{
          textAlign: "left", borderRadius: 6,
          border: `1px dashed ${CLAIM_ACCENT}40`, background: `${CLAIM_ACCENT}04`,
          cursor: "pointer", transition: "background 0.1s ease, border-color 0.1s ease",
          color: "var(--text)", overflow: "hidden", display: "flex", alignItems: "center",
        }}
        onMouseEnter={(e) => { e.currentTarget.style.background = `${CLAIM_ACCENT}10`; e.currentTarget.style.borderColor = `${CLAIM_ACCENT}55`; }}
        onMouseLeave={(e) => { e.currentTarget.style.background = `${CLAIM_ACCENT}04`; e.currentTarget.style.borderColor = `${CLAIM_ACCENT}40`; }}
      >
        <div style={{ width: 8, height: 8, borderRadius: 4, background: CLAIM_ACCENT, flexShrink: 0, marginLeft: 10 }} />
        <div style={{ flex: 1, minWidth: 0, padding: "5px 10px", display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
          <span style={{ fontWeight: 800, fontSize: 12, color: CLAIM_ACCENT, whiteSpace: "nowrap", flexShrink: 0, minWidth: 60 }}>{c.code}</span>
          <span style={{ fontSize: "var(--text-xs)", color: "var(--muted)", whiteSpace: "nowrap", flexShrink: 0, minWidth: 70 }}>{dateStr}</span>
          <span style={{ minWidth: 0, maxWidth: 140, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontSize: 12, fontWeight: 600, color: "var(--text)", flexShrink: 1 }}>{c.device_label || "—"}</span>
          <span style={{ fontSize: 11, color: "var(--muted)", maxWidth: 110, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", flexShrink: 0 }}>{c.customer_name ?? "—"}</span>
          {c.notes && (
            <span style={{ flex: 1, minWidth: 0, fontSize: "var(--text-xs)", color: "var(--muted)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {c.notes.slice(0, 60)}
            </span>
          )}
          <ClaimBadge size="small" />
          <Controls statusPicker={statusPicker} printButton={printButton} />
        </div>
      </div>
    );
  }

  if (displayMode === "stripe") {
    return (
      <div
        onClick={onClick}
        style={{
          textAlign: "left", borderRadius: 6,
          border: `1px dashed ${CLAIM_ACCENT}30`, background: `${CLAIM_ACCENT}03`,
          cursor: "pointer", transition: "background 0.1s ease, border-color 0.1s ease",
          color: "var(--text)", overflow: "hidden", display: "flex", alignItems: "stretch",
        }}
        onMouseEnter={(e) => { e.currentTarget.style.background = `${CLAIM_ACCENT}08`; e.currentTarget.style.borderColor = `${CLAIM_ACCENT}50`; }}
        onMouseLeave={(e) => { e.currentTarget.style.background = `${CLAIM_ACCENT}03`; e.currentTarget.style.borderColor = `${CLAIM_ACCENT}30`; }}
      >
        <div style={{ width: 6, background: CLAIM_ACCENT, flexShrink: 0 }} />
        <div style={{ flex: 1, minWidth: 0, padding: "6px 10px", display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
          <span style={{ fontWeight: 800, fontSize: 12, color: CLAIM_ACCENT, whiteSpace: "nowrap", flexShrink: 0, minWidth: 65 }}>{c.code}</span>
          <span style={{ fontSize: "var(--text-xs)", color: "var(--muted)", whiteSpace: "nowrap", flexShrink: 0 }}>{dateStr}</span>
          <span style={{ fontWeight: 700, fontSize: 12, color: "var(--text)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", minWidth: 80, maxWidth: 180, flexShrink: 1 }}>{c.device_label || "—"}</span>
          <span style={{ fontSize: 11, color: "var(--muted)", whiteSpace: "nowrap", flexShrink: 0, maxWidth: 120, overflow: "hidden", textOverflow: "ellipsis" }}>{c.customer_name ?? "—"}</span>
          {c.notes && (
            <span style={{ fontSize: 11, color: "var(--muted)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", flex: 1, minWidth: 0 }}>
              {c.notes.slice(0, 60)}
            </span>
          )}
          <ClaimBadge size="small" />
          <Controls statusPicker={statusPicker} printButton={printButton} />
        </div>
      </div>
    );
  }

  if (displayMode === "list") {
    return (
      <div
        onClick={onClick}
        style={{
          textAlign: "left", padding: 0, borderRadius: 10,
          border: `1px dashed ${CLAIM_ACCENT}35`, background: `${CLAIM_ACCENT}03`,
          cursor: "pointer", boxShadow: "0 1px 2px rgba(0,0,0,0.03)",
          transition: "transform 0.12s ease, box-shadow 0.12s ease, border-color 0.12s ease",
          color: "var(--text)", position: "relative", overflow: "hidden", display: "flex",
        }}
        onMouseEnter={(e) => { e.currentTarget.style.transform = "translateY(-1px)"; e.currentTarget.style.boxShadow = `0 4px 14px ${CLAIM_ACCENT}14`; e.currentTarget.style.borderColor = `${CLAIM_ACCENT}50`; }}
        onMouseLeave={(e) => { e.currentTarget.style.transform = "translateY(0)"; e.currentTarget.style.boxShadow = "0 1px 2px rgba(0,0,0,0.03)"; e.currentTarget.style.borderColor = `${CLAIM_ACCENT}35`; }}
      >
        <div style={{ width: 4, background: CLAIM_ACCENT, flexShrink: 0, borderRadius: "10px 0 0 10px" }} />
        <div style={{ flex: 1, minWidth: 0, padding: "8px 12px", display: "flex", flexDirection: "column", gap: 4 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, minHeight: 24, flexWrap: "wrap" }}>
            <span style={{ fontWeight: 800, fontSize: 13, color: CLAIM_ACCENT, whiteSpace: "nowrap", flexShrink: 0 }}>{c.code}</span>
            <span style={{ fontSize: "var(--text-xs)", color: "var(--muted)", whiteSpace: "nowrap", flexShrink: 0 }}>{dateStr}</span>
            <ClaimBadge />
            <span style={{ color: "var(--border)", flexShrink: 0 }}>·</span>
            <div style={{ display: "flex", alignItems: "center", gap: 4, minWidth: 0, overflow: "hidden" }}>
              <DeviceIcon size={12} color={CLAIM_ACCENT} />
              <span style={{ fontWeight: 700, fontSize: 13, color: "var(--text)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{c.device_label || "—"}</span>
            </div>
            <span style={{ fontWeight: 500, fontSize: 11, color: "var(--muted)", whiteSpace: "nowrap", flexShrink: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis" }}>{c.customer_name ?? "—"}</span>
            <div style={{ flex: 1 }} />
            <Controls statusPicker={statusPicker} printButton={printButton} />
          </div>
          {c.notes && (
            <div style={{ display: "flex", alignItems: "center", gap: 5, minWidth: 0, overflow: "hidden" }}>
              <WrenchIcon size={11} color="var(--muted)" />
              <span style={{ fontSize: 11, fontWeight: 600, color: "var(--muted)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {c.notes.slice(0, 100)}
              </span>
            </div>
          )}
        </div>
      </div>
    );
  }

  if (displayMode === "grid") {
    return (
      <div
        onClick={onClick}
        style={{
          textAlign: "left", borderRadius: 14,
          border: `1px dashed ${CLAIM_ACCENT}35`, background: `${CLAIM_ACCENT}03`,
          cursor: "pointer", boxShadow: "0 1px 4px rgba(0,0,0,0.04)",
          transition: "transform 0.15s ease, box-shadow 0.15s ease",
          color: "var(--text)", overflow: "hidden", display: "flex", flexDirection: "column",
        }}
        onMouseEnter={(e) => { e.currentTarget.style.transform = "translateY(-2px)"; e.currentTarget.style.boxShadow = `0 8px 24px ${CLAIM_ACCENT}14`; }}
        onMouseLeave={(e) => { e.currentTarget.style.transform = "translateY(0)"; e.currentTarget.style.boxShadow = "0 1px 4px rgba(0,0,0,0.04)"; }}
      >
        <div style={{
          padding: "8px 12px",
          background: `linear-gradient(135deg, ${CLAIM_ACCENT}15, ${CLAIM_ACCENT}06)`,
          borderBottom: `1px solid ${CLAIM_ACCENT}18`,
          display: "flex", alignItems: "center", gap: 6, minWidth: 0, flexWrap: "wrap",
        }}>
          <span style={{ fontWeight: 800, fontSize: 12, color: CLAIM_ACCENT, whiteSpace: "nowrap", flexShrink: 0 }}>{c.code}</span>
          <span style={{ fontSize: "var(--text-xs)", color: "var(--muted)", whiteSpace: "nowrap", flexShrink: 0 }}>{dateStr}</span>
          <ClaimBadge size="small" />
          <div style={{ flex: 1 }} />
          <Controls statusPicker={statusPicker} printButton={printButton} />
        </div>
        <div style={{ padding: "10px 12px", display: "flex", flexDirection: "column", gap: 8, flex: 1, minWidth: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 6, minWidth: 0 }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "center", width: 22, height: 22, borderRadius: 6, background: `${CLAIM_ACCENT}12`, color: CLAIM_ACCENT, flexShrink: 0 }}>
              <DeviceIcon size={12} color="currentColor" />
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontWeight: 700, fontSize: 12, color: "var(--text)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{c.device_label || "—"}</div>
              <div style={{ fontWeight: 500, fontSize: "var(--text-xs)", color: "var(--muted)" }}>{c.customer_name ?? "—"}</div>
            </div>
          </div>
          {c.notes && (
            <div style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 11, fontWeight: 600, color: "var(--text)", minWidth: 0 }}>
              <WrenchIcon size={10} color="var(--muted)" />
              <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", minWidth: 0 }}>{c.notes.slice(0, 80)}</span>
            </div>
          )}
        </div>
      </div>
    );
  }



  // Default: compact mode
  return (
    <div
      onClick={onClick}
      style={{
        textAlign: "left", padding: 0, borderRadius: 10,
        border: `1px dashed ${CLAIM_ACCENT}35`, background: `${CLAIM_ACCENT}03`,
        cursor: "pointer", boxShadow: "0 1px 3px rgba(0,0,0,0.03)",
        transition: "transform 0.12s ease, box-shadow 0.12s ease, border-color 0.12s ease",
        color: "var(--text)", overflow: "hidden", display: "flex",
      }}
      onMouseEnter={(e) => { e.currentTarget.style.transform = "translateY(-1px)"; e.currentTarget.style.boxShadow = `0 4px 14px ${CLAIM_ACCENT}12`; e.currentTarget.style.borderColor = `${CLAIM_ACCENT}50`; }}
      onMouseLeave={(e) => { e.currentTarget.style.transform = "translateY(0)"; e.currentTarget.style.boxShadow = "0 1px 3px rgba(0,0,0,0.03)"; e.currentTarget.style.borderColor = `${CLAIM_ACCENT}35`; }}
    >
      <div style={{ width: 4, background: CLAIM_ACCENT, flexShrink: 0 }} />
      <div style={{ flex: 1, minWidth: 0, padding: "8px 12px", display: "flex", flexDirection: "column", gap: 5 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 6, minHeight: 24, flexWrap: "wrap" }}>
          <span style={{ fontWeight: 800, fontSize: 13, color: CLAIM_ACCENT, whiteSpace: "nowrap", flexShrink: 0 }}>{c.code}</span>
          <span style={{ fontSize: "var(--text-xs)", color: "var(--muted)", whiteSpace: "nowrap", flexShrink: 0 }}>{dateStr}</span>
          <ClaimBadge />
          {statusLabel && (
            <span style={{ fontSize: "var(--text-xs)", fontWeight: 700, padding: "2px 5px", borderRadius: 4, background: `${statusColor}15`, color: statusColor, border: `1px solid ${statusColor}25`, whiteSpace: "nowrap", flexShrink: 0 }}>
              {statusLabel}
            </span>
          )}
          <div style={{ flex: 1 }} />
          <Controls statusPicker={statusPicker} printButton={printButton} />
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0, flexWrap: "wrap" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 4, fontWeight: 700, fontSize: 13, color: CLAIM_ACCENT, minWidth: 0, overflow: "hidden" }}>
            <DeviceIcon size={12} color={CLAIM_ACCENT} />
            <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{c.device_label || "—"}</span>
          </div>
          <span style={{ color: "var(--border)" }}>·</span>
          <span style={{ fontWeight: 500, fontSize: 11, color: "var(--muted)", whiteSpace: "nowrap", flexShrink: 0 }}>{c.customer_name ?? "—"}</span>
          {c.notes && (
            <>
              <span style={{ color: "var(--border)" }}>·</span>
              <span style={{ fontSize: 11, fontWeight: 600, color: "var(--text)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", flex: 1, minWidth: 0 }}>
                {c.notes.slice(0, 60)}
              </span>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
