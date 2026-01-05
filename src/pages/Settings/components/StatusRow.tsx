import type { StatusMeta } from "../../../state/StatusesStore";

type StatusRowProps = {
  status: StatusMeta;
  fallbackKey: string;
  border: string;
  softBtn: React.CSSProperties;
  onEdit: (status: StatusMeta) => void;
  onDelete: (key: string) => void;
};

export function StatusRow({ status: s, fallbackKey, border, softBtn, onEdit, onDelete }: StatusRowProps) {
  return (
    <div
      key={s.key}
      style={{
        display: "flex",
        justifyContent: "space-between",
        alignItems: "center",
        padding: 12,
        borderRadius: 10,
        border,
        background: "var(--panel)",
      }}
    >
      <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
        <div
          style={{
            padding: "6px 12px",
            borderRadius: 999,
            border,
            background: s.bg || "var(--panel)",
            color: s.fg || "var(--text)",
            fontWeight: 900,
            fontSize: 12,
          }}
        >
          {s.label}
        </div>
        {s.isFinal && <div style={{ fontSize: 11, fontWeight: 900, color: "var(--muted)" }}>FINAL</div>}
        {s.key === fallbackKey && (
          <div style={{ fontSize: 11, fontWeight: 900, color: "var(--accent)" }}>FALLBACK</div>
        )}
      </div>

      <div style={{ display: "flex", gap: 6 }}>
        <button onClick={() => onEdit(s)} style={softBtn}>
          Upravit
        </button>
        <button
          onClick={() => onDelete(s.key)}
          disabled={s.key === fallbackKey}
          style={{
            ...softBtn,
            opacity: s.key === fallbackKey ? 0.4 : 1,
            cursor: s.key === fallbackKey ? "not-allowed" : "pointer",
            color: s.key === fallbackKey ? "var(--muted)" : "rgba(239,68,68,0.9)",
          }}
        >
          Smazat
        </button>
      </div>
    </div>
  );
}


