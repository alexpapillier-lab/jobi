export type CustomerRecord = {
  id: string;
  name: string;
  phone?: string;
  email?: string;
  addressStreet?: string;
  addressCity?: string;
  addressZip?: string;
  company?: string;
  ico?: string;
  info?: string;
  ticketIds: string[];
  createdAt: string;
  updatedAt: string;
  version?: number;
};

type CustomerListProps = {
  customers: CustomerRecord[];
  selectedCustomerId: string | null;
  onSelect: (customerId: string) => void;
  loading: boolean;
  error: string | null;
};

export function CustomerList({ customers, selectedCustomerId, onSelect, loading, error }: CustomerListProps) {
  const border = "1px solid var(--border)";

  return (
    <div
      style={{
        border: border,
        borderRadius: "var(--radius-lg)",
        background: "var(--panel)",
        backdropFilter: "var(--blur)",
        WebkitBackdropFilter: "var(--blur)",
        boxShadow: "var(--shadow-soft)",
        overflow: "hidden",
      }}
    >
      <div style={{ padding: 12, borderBottom: border, color: "var(--muted)", fontSize: 12 }}>
        {customers.length} zákazníků
      </div>

      {loading && (
        <div style={{ padding: 24, textAlign: "center", color: "var(--muted)" }}>
          Načítání zákazníků...
        </div>
      )}
      {error && (
        <div style={{ padding: 16, textAlign: "center", color: "rgba(239,68,68,0.9)", background: "rgba(239,68,68,0.1)", borderRadius: 12, border: "1px solid rgba(239,68,68,0.3)", margin: 12 }}>
          {error}
        </div>
      )}

      {!loading && !error && (
        <div style={{ display: "grid" }}>
          {customers.map((c) => {
            const active = c.id === selectedCustomerId;
            return (
              <button
                key={c.id}
                onClick={() => onSelect(c.id)}
                style={{
                  textAlign: "left",
                  padding: 12,
                  border: "none",
                  borderBottom: "1px solid rgba(0,0,0,0.06)",
                  background: active ? "var(--accent-soft)" : "transparent",
                  backdropFilter: active ? "var(--blur)" : "none",
                  WebkitBackdropFilter: active ? "var(--blur)" : "none",
                  cursor: "pointer",
                  color: "var(--text)",
                }}
              >
                <div style={{ fontWeight: 900, display: "flex", justifyContent: "space-between", gap: 10 }}>
                  <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{c.name}</span>
                  <span style={{ color: "var(--muted)", fontWeight: 800 }}>{(c.ticketIds ?? []).length}</span>
                </div>
                <div style={{ marginTop: 4, color: "var(--muted)", fontSize: 12 }}>
                  {[c.phone, c.email, c.company].filter(Boolean).join(" · ")}
                </div>
              </button>
            );
          })}

          {customers.length === 0 && <div style={{ padding: 14, color: "var(--muted)" }}>Nic nenalezeno.</div>}
        </div>
      )}
    </div>
  );
}

