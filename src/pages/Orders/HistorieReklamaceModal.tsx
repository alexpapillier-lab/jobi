/**
 * Modál „Historie reklamace“ – záznamy z warranty_claim_history.
 * Vyneseno z Orders.tsx beze změny obsahu.
 */
import { createPortal } from "react-dom";
import { Button } from "../../components/ui";
import { formatCZ } from "../../components/tickets";
import type { StatusMeta } from "../../state/StatusesStore";
import type { ZaznamHistorie } from "./HistorieZakazkyModal";

type Props = {
  entries: ZaznamHistorie[];
  loading: boolean;
  error: string | null;
  onClose: () => void;
  getByKey: (key: string) => StatusMeta | undefined;
};

export function HistorieReklamaceModal({ entries, loading, error, onClose, getByKey }: Props) {
  return createPortal(
    <div
      role="dialog"
      aria-label="Historie reklamace"
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 10000,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: "rgba(0,0,0,0.4)",
        padding: 24,
      }}
      onClick={onClose}
    >
      <div
        style={{
          background: "var(--panel)",
          border: "1px solid var(--border)",
          borderRadius: "var(--radius-lg)",
          boxShadow: "var(--shadow-soft)",
          maxWidth: 480,
          width: "100%",
          maxHeight: "80vh",
          overflow: "hidden",
          display: "flex",
          flexDirection: "column",
          color: "var(--text)",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div style={{ padding: "16px 20px", borderBottom: "1px solid var(--border)", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div style={{ fontWeight: 950, fontSize: 16 }}>Historie reklamace</div>
          <Button variant="soft" size="sm" onClick={onClose}>Zavřít</Button>
        </div>
        <div style={{ padding: 16, overflowY: "auto", flex: 1 }}>
          {loading && <div style={{ color: "var(--muted)", padding: 12 }}>Načítám…</div>}
          {error && <div style={{ color: "rgba(239,68,68,0.9)", padding: 12 }}>{error}</div>}
          {!loading && !error && entries.length === 0 && (
            <div style={{ color: "var(--muted)", padding: 12 }}>Žádné záznamy v historii.</div>
          )}
          {!loading && !error && entries.length > 0 && (
            <ul style={{ listStyle: "none", margin: 0, padding: 0 }}>
              {entries.map((e) => {
                const actionLabel = e.action === "created" ? "Vytvořena" : e.action === "status_changed" ? "Změna stavu" : e.action === "updated" ? "Upravena" : e.action;
                const who = e.nickname || (e.changed_by ? "Kolega bez přezdívky" : "Systém");
                const details = (e.details || {}) as Record<string, unknown>;
                const statusOld = details.status_old;
                const statusNew = details.status_new;
                return (
                  <li key={e.id} style={{ padding: "10px 0", borderBottom: "1px solid var(--border)", fontSize: 13 }}>
                    <div style={{ fontWeight: 700 }}>{actionLabel}</div>
                    {e.action === "status_changed" && statusOld != null && statusNew != null && (
                      <div style={{ fontWeight: 600, color: "var(--muted)", marginTop: 4 }}>
                        Stav: {getByKey(String(statusOld))?.label ?? String(statusOld)} → {getByKey(String(statusNew))?.label ?? String(statusNew)}
                      </div>
                    )}
                    <div style={{ color: "var(--muted)", marginTop: 2 }}>{formatCZ(e.created_at)} · {who}</div>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </div>
    </div>,
    document.body
  );
}
