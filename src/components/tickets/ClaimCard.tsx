import React from "react";
import { DeviceIcon, WrenchIcon } from "./icons";
import { promenneOvladani, promenneRadku, stylStavu, type ZvyrazneniStavu } from "../../lib/zvyrazneniStavu";

/**
 * Karta reklamace ve výpisu zakázek.
 *
 * Barvy bere ze stavu stejně jako karta zakázky (stylStavu + zvýraznění
 * z Nastavení) – dřív měla vlastní zelenomodrý nádech bez ohledu na stav,
 * takže vedle plně obarvených zakázek vypadala jako cizí prvek. Reklamaci
 * od zakázky odlišuje odznak „Reklamace“ a čárkovaný rámeček.
 */
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
  /** Koncový stav – u „výrazného“ se ztlumí stejně jako hotová zakázka. */
  isFinal?: boolean;
  /** Jak výrazně se propíše barva stavu do řádku. */
  zvyrazneni?: ZvyrazneniStavu;
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

function ClaimBadge({ size = "normal", plna = false }: { size?: "small" | "normal"; plna?: boolean }) {
  const isSmall = size === "small";
  /* Na plné výplni by zelenomodrý odznak splynul; použije se písmo řádku. */
  const barva = plna ? "currentColor" : CLAIM_ACCENT;
  return (
    <span style={{
      fontSize: isSmall ? 8 : 9, fontWeight: 800, padding: isSmall ? "2px 5px" : "2px 6px", borderRadius: 4,
      background: plna ? "rgba(0,0,0,0.12)" : `${CLAIM_ACCENT}12`, color: barva,
      border: `1px solid ${plna ? "currentColor" : `${CLAIM_ACCENT}25`}`,
      textTransform: "uppercase", letterSpacing: "0.5px",
      whiteSpace: "nowrap", flexShrink: 0,
    }}>
      {isSmall ? "R" : "Reklamace"}
    </span>
  );
}

export function ClaimCard({ claim: c, displayMode, statusColor, statusLabel, isFinal = false, zvyrazneni = "jemne", onClick, statusPicker, printButton }: ClaimCardProps) {
  const dateStr = c.created_at ? formatCZ(c.created_at) : "—";
  const stav = stylStavu(statusColor.startsWith("#") ? statusColor : undefined, zvyrazneni, isFinal);
  const plna = stav.plnaVyplne;
  /* Kód reklamace zelenomodře jen tam, kde je na světlém podkladu čitelný. */
  const barvaKodu = plna ? "var(--text)" : CLAIM_ACCENT;
  const ikona = plna ? "currentColor" : CLAIM_ACCENT;
  const ovladani = (
    /* marginLeft: auto drží dvojici u pravého okraje i tehdy, když se
       řádek na úzké obrazovce zalomí a zbylo na ni málo místa. */
    <div style={{ ...promenneOvladani(stav), display: "flex", alignItems: "center", gap: 4, flexShrink: 0, marginLeft: "auto" }} onClick={(e) => e.stopPropagation()} onMouseDown={(e) => e.stopPropagation()}>
      {statusPicker}
      {printButton}
    </div>
  );
  const zaklad: React.CSSProperties = {
    ...promenneRadku(stav),
    textAlign: "left",
    border: `1px dashed ${stav.ramecek}`,
    background: stav.pozadi,
    color: stav.barvaPisma,
    cursor: "pointer",
    overflow: "hidden",
    display: "flex",
  };
  const hover = {
    onMouseEnter: (e: React.MouseEvent<HTMLDivElement>) => {
      e.currentTarget.style.transform = "translateY(-1px)";
      e.currentTarget.style.boxShadow = `0 4px 14px ${statusColor}14`;
    },
    onMouseLeave: (e: React.MouseEvent<HTMLDivElement>) => {
      e.currentTarget.style.transform = "translateY(0)";
      e.currentTarget.style.boxShadow = "none";
    },
  };
  const pruh = <div style={{ width: stav.sirkaProuzku, background: statusColor, flexShrink: 0 }} />;

  if (displayMode === "compact-extra") {
    return (
      <div onClick={onClick} style={{ ...zaklad, borderRadius: 6, alignItems: "center", transition: "transform 0.1s ease, box-shadow 0.1s ease" }} {...hover}>
        <div style={{ width: 8, height: 8, borderRadius: 4, background: plna ? stav.barvaPisma : statusColor, flexShrink: 0, marginLeft: 10 }} />
        <div style={{ flex: 1, minWidth: 0, padding: "5px 10px", display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
          <span style={{ fontWeight: 800, fontSize: 12, color: barvaKodu, whiteSpace: "nowrap", flexShrink: 0, minWidth: 60 }}>{c.code}</span>
          <span style={{ fontSize: "var(--text-xs)", color: "var(--muted)", whiteSpace: "nowrap", flexShrink: 0, minWidth: 70 }}>{dateStr}</span>
          <span style={{ minWidth: 0, maxWidth: 140, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontSize: 12, fontWeight: 600, color: "var(--text)", flexShrink: 1 }}>{c.device_label || "—"}</span>
          <span style={{ fontSize: 11, color: "var(--muted)", maxWidth: 110, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", flexShrink: 0 }}>{c.customer_name ?? "—"}</span>
          {c.notes && (
            <span style={{ flex: 1, minWidth: 0, fontSize: "var(--text-xs)", color: "var(--muted)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {c.notes.slice(0, 60)}
            </span>
          )}
          <ClaimBadge size="small" plna={plna} />
          {ovladani}
        </div>
      </div>
    );
  }

  if (displayMode === "stripe") {
    return (
      <div onClick={onClick} style={{ ...zaklad, borderRadius: 6, alignItems: "stretch", transition: "transform 0.1s ease, box-shadow 0.1s ease" }} {...hover}>
        {pruh}
        <div style={{ flex: 1, minWidth: 0, padding: "6px 10px", display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
          <span style={{ fontWeight: 800, fontSize: 12, color: barvaKodu, whiteSpace: "nowrap", flexShrink: 0, minWidth: 65 }}>{c.code}</span>
          <span style={{ fontSize: "var(--text-xs)", color: "var(--muted)", whiteSpace: "nowrap", flexShrink: 0 }}>{dateStr}</span>
          <span style={{ fontWeight: 700, fontSize: 12, color: "var(--text)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", minWidth: 80, maxWidth: 180, flexShrink: 1 }}>{c.device_label || "—"}</span>
          <span style={{ fontSize: 11, color: "var(--muted)", whiteSpace: "nowrap", flexShrink: 0, maxWidth: 120, overflow: "hidden", textOverflow: "ellipsis" }}>{c.customer_name ?? "—"}</span>
          {c.notes && (
            <span style={{ fontSize: 11, color: "var(--muted)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", flex: 1, minWidth: 0 }}>
              {c.notes.slice(0, 60)}
            </span>
          )}
          <ClaimBadge size="small" plna={plna} />
          {ovladani}
        </div>
      </div>
    );
  }

  if (displayMode === "list") {
    return (
      <div onClick={onClick} style={{ ...zaklad, padding: 0, borderRadius: 10, position: "relative", boxShadow: "0 1px 2px rgba(0,0,0,0.03)", transition: "transform 0.12s ease, box-shadow 0.12s ease" }} {...hover}>
        <div style={{ width: stav.sirkaProuzku, background: statusColor, flexShrink: 0, borderRadius: "10px 0 0 10px" }} />
        <div style={{ flex: 1, minWidth: 0, padding: "var(--space-2) var(--space-3)", display: "flex", alignItems: "center", gap: 8, minHeight: 24, flexWrap: "wrap" }}>
          <span style={{ fontWeight: 800, fontSize: 13, color: barvaKodu, whiteSpace: "nowrap", flexShrink: 0 }}>{c.code}</span>
          <span style={{ fontSize: "var(--text-xs)", color: "var(--muted)", whiteSpace: "nowrap", flexShrink: 0 }}>{dateStr}</span>
          <ClaimBadge plna={plna} />
          <span style={{ color: "var(--border)", flexShrink: 0 }}>·</span>
          <div style={{ display: "flex", alignItems: "center", gap: 4, minWidth: 0, overflow: "hidden" }}>
            <DeviceIcon size={12} color={ikona} />
            <span style={{ fontWeight: 700, fontSize: 13, color: "var(--text)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{c.device_label || "—"}</span>
          </div>
          <span style={{ fontWeight: 500, fontSize: 11, color: "var(--muted)", whiteSpace: "nowrap", flexShrink: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis" }}>{c.customer_name ?? "—"}</span>
          {c.notes && (
            <div style={{ flex: 1, minWidth: 0, display: "flex", alignItems: "center", gap: 5, overflow: "hidden" }}>
              <WrenchIcon size={11} color="var(--muted)" />
              <span style={{ fontSize: 11, fontWeight: 600, color: "var(--muted)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {c.notes.slice(0, 100)}
              </span>
            </div>
          )}
          {ovladani}
        </div>
      </div>
    );
  }

  if (displayMode === "grid") {
    const hlavicka = plna
      ? { background: "rgba(0,0,0,0.12)", borderBottom: `1px solid ${stav.ramecek}` }
      : { background: `linear-gradient(135deg, ${statusColor}15, ${statusColor}06)`, borderBottom: `1px solid ${statusColor}18` };
    return (
      <div onClick={onClick} style={{ ...zaklad, borderRadius: 14, flexDirection: "column", boxShadow: "0 1px 4px rgba(0,0,0,0.04)", transition: "transform 0.15s ease, box-shadow 0.15s ease" }} {...hover}>
        <div style={{ padding: "8px 12px", ...hlavicka, display: "flex", alignItems: "center", gap: 6, minWidth: 0, flexWrap: "wrap" }}>
          <span style={{ fontWeight: 800, fontSize: 12, color: barvaKodu, whiteSpace: "nowrap", flexShrink: 0 }}>{c.code}</span>
          <span style={{ fontSize: "var(--text-xs)", color: "var(--muted)", whiteSpace: "nowrap", flexShrink: 0 }}>{dateStr}</span>
          <ClaimBadge size="small" plna={plna} />
          {ovladani}
        </div>
        <div style={{ padding: "10px 12px", display: "flex", flexDirection: "column", gap: 8, flex: 1, minWidth: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 6, minWidth: 0 }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "center", width: 22, height: 22, borderRadius: 6, background: plna ? "rgba(0,0,0,0.12)" : `${CLAIM_ACCENT}12`, color: ikona, flexShrink: 0 }}>
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

  // Výchozí: kompaktní režim
  return (
    <div onClick={onClick} style={{ ...zaklad, padding: 0, borderRadius: 10, boxShadow: "0 1px 3px rgba(0,0,0,0.03)", transition: "transform 0.12s ease, box-shadow 0.12s ease" }} {...hover}>
      <div style={{ width: 4, background: statusColor, flexShrink: 0 }} />
      <div style={{ flex: 1, minWidth: 0, padding: "8px 12px", display: "flex", flexDirection: "column", gap: 5 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 6, minHeight: 24, flexWrap: "wrap" }}>
          <span style={{ fontWeight: 800, fontSize: 13, color: barvaKodu, whiteSpace: "nowrap", flexShrink: 0 }}>{c.code}</span>
          <span style={{ fontSize: "var(--text-xs)", color: "var(--muted)", whiteSpace: "nowrap", flexShrink: 0 }}>{dateStr}</span>
          <ClaimBadge plna={plna} />
          {statusLabel && !plna && (
            <span style={{ fontSize: "var(--text-xs)", fontWeight: 700, padding: "2px 5px", borderRadius: 4, background: `${statusColor}15`, color: statusColor, border: `1px solid ${statusColor}25`, whiteSpace: "nowrap", flexShrink: 0 }}>
              {statusLabel}
            </span>
          )}
          {ovladani}
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0, flexWrap: "wrap" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 4, fontWeight: 700, fontSize: 13, color: plna ? "var(--text)" : CLAIM_ACCENT, minWidth: 0, overflow: "hidden" }}>
            <DeviceIcon size={12} color={ikona} />
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
