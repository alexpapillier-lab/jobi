import type { TicketEx } from "../Orders";
import type { StatusMeta } from "../../state/StatusesStore";
import { OrderRow } from "./components/OrderRow";

type OrderListProps = {
  tickets: TicketEx[];
  onSelect: (id: string) => void;
  statusById: Record<string, string>;
  normalizeStatus: (key: string) => string | null;
  getByKey: (k: string) => StatusMeta | undefined;
  onStatusChange: (id: string, status: string) => void;
  statuses: StatusMeta[];
  displayMode: "list" | "grid" | "compact";
};

export function OrderList({
  tickets,
  onSelect,
  statusById,
  normalizeStatus,
  getByKey,
  onStatusChange,
  statuses,
  displayMode,
}: OrderListProps) {
  return (
    <div style={{ 
      marginTop: 16, 
      display: displayMode === "grid" ? "grid" : "grid",
      gridTemplateColumns: displayMode === "grid" ? "repeat(auto-fill, minmax(350px, 1fr))" : "1fr",
      gap: displayMode === "grid" ? 16 : 8,
    }}>
      {tickets.map((t) => (
        <OrderRow
          key={t.id}
          ticket={t}
          statusById={statusById}
          normalizeStatus={normalizeStatus}
          getByKey={getByKey}
          onSelect={onSelect}
          onStatusChange={onStatusChange}
          statuses={statuses}
          displayMode={displayMode}
        />
      ))}

      {tickets.length === 0 && (
        <div
          style={{
            padding: 48,
            borderRadius: "var(--radius-lg)",
            border: "1px solid var(--border)",
            background: "var(--panel)",
            boxShadow: "var(--shadow-soft)",
            textAlign: "center",
            color: "var(--muted)",
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            gap: 12,
          }}
        >
          <div style={{ fontSize: 48, opacity: 0.5 }}>📋</div>
          <div style={{ fontSize: 16, fontWeight: 700, color: "var(--text)" }}>Žádné zakázky neodpovídají filtru</div>
          <div style={{ fontSize: 13 }}>Zkuste změnit filtry nebo vytvořte novou zakázku</div>
        </div>
      )}
    </div>
  );
}

