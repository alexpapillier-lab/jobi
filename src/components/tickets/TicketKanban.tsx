import React, { useCallback, useRef, useState } from "react";
import type { StatusMeta } from "../../state/StatusesStore";
import { type TicketCardData, formatCZDate } from "./types";
import { DeviceIcon } from "./icons";

type Props = {
  tickets: TicketCardData[];
  statuses: StatusMeta[];
  getByKey: (k: string) => StatusMeta | undefined;
  normalizeStatus: (raw: any) => string | null;
  onClickDetail: (id: string) => void;
  onStatusChange: (ticketId: string, newStatus: string) => void;
};

function KanbanCard({
  ticket: t,
  statusColor,
  onClickDetail,
  onDragStart,
}: {
  ticket: TicketCardData;
  statusColor: string;
  onClickDetail: (id: string) => void;
  onDragStart: (e: React.DragEvent, ticketId: string) => void;
}) {
  return (
    <div
      draggable
      onDragStart={(e) => onDragStart(e, t.id)}
      onClick={() => onClickDetail(t.id)}
      style={{
        padding: "10px 12px",
        borderRadius: 10,
        background: "var(--panel)",
        border: `1px solid ${statusColor}25`,
        borderLeft: `3px solid ${statusColor}`,
        cursor: "grab",
        transition: "transform 0.12s ease, box-shadow 0.12s ease",
        display: "flex",
        flexDirection: "column",
        gap: 6,
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.transform = "translateY(-1px)";
        e.currentTarget.style.boxShadow = `0 4px 12px ${statusColor}15`;
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.transform = "translateY(0)";
        e.currentTarget.style.boxShadow = "none";
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 6 }}>
        <span style={{ fontWeight: 800, fontSize: 12, color: "var(--text)" }}>{t.code}</span>
        <span style={{ fontSize: 10, color: "var(--muted)" }}>{formatCZDate(t.createdAt)}</span>
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 12, fontWeight: 600, color: "var(--text)" }}>
        <DeviceIcon size={12} color={statusColor} />
        <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{t.deviceLabel || "—"}</span>
      </div>
      <div style={{ fontSize: 11, color: "var(--muted)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
        {t.customerName}
      </div>
    </div>
  );
}

export function TicketKanban({ tickets, statuses, normalizeStatus, onClickDetail, onStatusChange }: Props) {
  const [dragOverColumn, setDragOverColumn] = useState<string | null>(null);
  const draggedTicketId = useRef<string | null>(null);

  const handleDragStart = useCallback((_e: React.DragEvent, ticketId: string) => {
    draggedTicketId.current = ticketId;
  }, []);

  const handleDragOver = useCallback((e: React.DragEvent, statusKey: string) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    setDragOverColumn(statusKey);
  }, []);

  const handleDragLeave = useCallback(() => {
    setDragOverColumn(null);
  }, []);

  const handleDrop = useCallback((e: React.DragEvent, targetStatus: string) => {
    e.preventDefault();
    setDragOverColumn(null);
    const ticketId = draggedTicketId.current;
    if (!ticketId) return;
    const ticket = tickets.find((t) => t.id === ticketId);
    if (!ticket) return;
    const currentStatus = normalizeStatus(ticket.status);
    if (currentStatus !== targetStatus) {
      onStatusChange(ticketId, targetStatus);
    }
    draggedTicketId.current = null;
  }, [tickets, normalizeStatus, onStatusChange]);

  const columns = statuses.map((s) => {
    const columnTickets = tickets.filter((t) => {
      const st = normalizeStatus(t.status);
      return st === s.key;
    });
    return { status: s, tickets: columnTickets };
  });

  const unassigned = tickets.filter((t) => {
    const st = normalizeStatus(t.status);
    return st === null || !statuses.some((s) => s.key === st);
  });

  return (
    <div
      style={{
        display: "flex",
        gap: 12,
        overflowX: "auto",
        paddingBottom: 8,
        minHeight: 300,
      }}
    >
      {unassigned.length > 0 && (
        <div style={{ minWidth: 260, maxWidth: 320, flex: "0 0 280px", display: "flex", flexDirection: "column", gap: 8 }}>
          <div style={{ padding: "8px 12px", borderRadius: 10, background: "var(--panel-2)", border: "1px solid var(--border)", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <span style={{ fontWeight: 700, fontSize: 13, color: "var(--muted)" }}>Bez statusu</span>
            <span style={{ fontSize: 11, fontWeight: 700, color: "var(--muted)", padding: "2px 6px", borderRadius: 6, background: "var(--panel)" }}>{unassigned.length}</span>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 6, flex: 1 }}>
            {unassigned.map((t) => (
              <KanbanCard key={t.id} ticket={t} statusColor="var(--muted)" onClickDetail={onClickDetail} onDragStart={handleDragStart} />
            ))}
          </div>
        </div>
      )}

      {columns.map(({ status, tickets: colTickets }) => {
        const isDragOver = dragOverColumn === status.key;
        return (
          <div
            key={status.key}
            onDragOver={(e) => handleDragOver(e, status.key)}
            onDragLeave={handleDragLeave}
            onDrop={(e) => handleDrop(e, status.key)}
            style={{
              minWidth: 260,
              maxWidth: 320,
              flex: "0 0 280px",
              display: "flex",
              flexDirection: "column",
              gap: 8,
              borderRadius: 12,
              padding: isDragOver ? 6 : 0,
              background: isDragOver ? `${status.bg}10` : "transparent",
              border: isDragOver ? `2px dashed ${status.bg}60` : "2px solid transparent",
              transition: "background 0.15s ease, border-color 0.15s ease, padding 0.15s ease",
            }}
          >
            {/* Column header */}
            <div
              style={{
                padding: "8px 12px",
                borderRadius: 10,
                background: `${status.bg}15`,
                border: `1px solid ${status.bg}30`,
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                gap: 8,
              }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <div style={{ width: 8, height: 8, borderRadius: 4, background: status.bg, boxShadow: `0 0 6px ${status.bg}60` }} />
                <span style={{ fontWeight: 700, fontSize: 13, color: "var(--text)" }}>{status.label}</span>
              </div>
              <span
                style={{
                  fontSize: 11,
                  fontWeight: 700,
                  color: status.bg,
                  padding: "2px 6px",
                  borderRadius: 6,
                  background: `${status.bg}15`,
                }}
              >
                {colTickets.length}
              </span>
            </div>

            {/* Cards */}
            <div style={{ display: "flex", flexDirection: "column", gap: 6, flex: 1, minHeight: 40 }}>
              {colTickets.length === 0 && (
                <div style={{ padding: "20px 12px", textAlign: "center", fontSize: 11, color: "var(--muted)", opacity: 0.5 }}>
                  Přetáhněte sem zakázku
                </div>
              )}
              {colTickets.map((t) => (
                <KanbanCard key={t.id} ticket={t} statusColor={status.bg || "var(--muted)"} onClickDetail={onClickDetail} onDragStart={handleDragStart} />
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}
