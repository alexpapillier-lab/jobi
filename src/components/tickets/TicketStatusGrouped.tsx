import React, { useMemo } from "react";
import type { StatusMeta } from "../../state/StatusesStore";
import { type TicketCardData, formatCZDate, computeFinalPrice } from "./types";
import { DeviceIcon, WrenchIcon } from "./icons";

type Props = {
  tickets: TicketCardData[];
  statuses: StatusMeta[];
  normalizeStatus: (raw: any) => string | null;
  onClickDetail: (id: string) => void;
  statusPickerFor: (ticket: TicketCardData, currentStatus: string | null) => React.ReactNode;
  printButtonFor: (ticket: TicketCardData) => React.ReactNode;
  customOrder?: string[];
  smsUnreadByTicketId?: Record<string, number>;
};

const smsBadge = (n: number) =>
  n > 0 ? (
    <span style={{ marginLeft: 6, minWidth: 18, height: 18, borderRadius: 9, background: "#FF3B30", color: "#fff", fontSize: 10, fontWeight: 700, display: "inline-flex", alignItems: "center", justifyContent: "center", padding: "0 5px" }}>
      {n > 99 ? "99+" : n}
    </span>
  ) : null;

function GroupedCard({
  ticket: t,
  statusColor,
  currentStatus: _currentStatus,
  onClickDetail,
  statusPicker,
  printButton,
  smsUnread = 0,
}: {
  ticket: TicketCardData;
  statusColor: string;
  currentStatus: string | null;
  onClickDetail: (id: string) => void;
  statusPicker: React.ReactNode;
  printButton: React.ReactNode;
  smsUnread?: number;
}) {
  const finalPrice = computeFinalPrice(t);
  return (
    <div
      onClick={() => onClickDetail(t.id)}
      style={{
        padding: "8px 12px",
        borderRadius: 8,
        border: `1px solid ${statusColor}20`,
        background: "var(--panel)",
        cursor: "pointer",
        transition: "transform 0.1s ease, box-shadow 0.1s ease",
        display: "flex",
        alignItems: "center",
        gap: 10,
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.transform = "translateX(3px)";
        e.currentTarget.style.boxShadow = `0 2px 8px ${statusColor}12`;
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.transform = "translateX(0)";
        e.currentTarget.style.boxShadow = "none";
      }}
    >
      <span style={{ fontWeight: 800, fontSize: 12, color: "var(--text)", whiteSpace: "nowrap", flexShrink: 0, display: "inline-flex", alignItems: "center" }}>{t.code}{smsBadge(smsUnread)}</span>
      <span style={{ fontSize: 10, color: "var(--muted)", whiteSpace: "nowrap", flexShrink: 0 }}>{formatCZDate(t.createdAt)}</span>
      <div style={{ display: "flex", alignItems: "center", gap: 4, minWidth: 0, overflow: "hidden" }}>
        <DeviceIcon size={11} color={statusColor} />
        <span style={{ fontWeight: 600, fontSize: 12, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{t.deviceLabel || "—"}</span>
      </div>
      <span style={{ fontSize: 11, color: "var(--muted)", whiteSpace: "nowrap", flexShrink: 0 }}>{t.customerName}</span>
      {(t.requestedRepair || t.issueShort) && (
        <div style={{ display: "flex", alignItems: "center", gap: 4, flex: 1, minWidth: 0, overflow: "hidden" }}>
          <WrenchIcon size={10} color="var(--muted)" />
          <span style={{ fontSize: 10, color: "var(--muted)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{t.requestedRepair || t.issueShort}</span>
        </div>
      )}
      {finalPrice > 0 && (
        <span style={{ fontSize: 12, fontWeight: 700, color: statusColor, whiteSpace: "nowrap", flexShrink: 0 }}>
          {finalPrice.toLocaleString("cs-CZ")} Kč
        </span>
      )}
      <div style={{ display: "flex", alignItems: "center", gap: 4, flexShrink: 0, marginLeft: "auto" }} onClick={(e) => e.stopPropagation()} onMouseDown={(e) => e.stopPropagation()}>
        {statusPicker}
        {printButton}
      </div>
    </div>
  );
}

export function TicketStatusGrouped({ tickets, statuses, normalizeStatus, onClickDetail, statusPickerFor, printButtonFor, customOrder, smsUnreadByTicketId = {} }: Props) {
  const groups = useMemo(() => {
    const result: { status: StatusMeta; tickets: TicketCardData[] }[] = [];
    const unassigned: TicketCardData[] = [];

    const orderedStatuses = customOrder && customOrder.length > 0
      ? customOrder
          .map((key) => statuses.find((s) => s.key === key))
          .filter((s): s is StatusMeta => !!s)
      : statuses;

    for (const s of orderedStatuses) {
      const matching = tickets.filter((t) => normalizeStatus(t.status) === s.key);
      if (matching.length > 0) {
        result.push({ status: s, tickets: matching });
      }
    }

    for (const t of tickets) {
      const st = normalizeStatus(t.status);
      if (st === null || !orderedStatuses.some((s) => s.key === st)) {
        unassigned.push(t);
      }
    }

    if (unassigned.length > 0) {
      result.unshift({
        status: { key: "__unassigned__", label: "Bez statusu", bg: "var(--muted)", isFinal: false },
        tickets: unassigned,
      });
    }

    return result;
  }, [tickets, statuses, normalizeStatus, customOrder]);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      {groups.map(({ status, tickets: groupTickets }) => {
        const color = status.bg || "var(--muted)";
        return (
          <div key={status.key}>
            {/* Status section header */}
            <div style={{
              display: "flex",
              alignItems: "center",
              gap: 10,
              padding: "8px 14px",
              borderRadius: 10,
              background: `${color}10`,
              border: `1px solid ${color}20`,
              marginBottom: 8,
            }}>
              <div style={{ width: 10, height: 10, borderRadius: 5, background: color, boxShadow: `0 0 6px ${color}50` }} />
              <span style={{ fontWeight: 800, fontSize: 14, color: "var(--text)" }}>{status.label}</span>
              <span style={{
                fontSize: 11, fontWeight: 700, color: color,
                padding: "2px 8px", borderRadius: 6,
                background: `${color}12`,
              }}>
                {groupTickets.length}
              </span>
            </div>

            {/* Tickets in this group */}
            <div style={{ display: "flex", flexDirection: "column", gap: 4, paddingLeft: 6, borderLeft: `3px solid ${color}25` }}>
              {groupTickets.map((t) => {
                const currentStatus = normalizeStatus(t.status);
                return (
                  <GroupedCard
                    key={t.id}
                    ticket={t}
                    statusColor={color}
                    currentStatus={currentStatus}
                    onClickDetail={onClickDetail}
                    statusPicker={statusPickerFor(t, currentStatus)}
                    printButton={printButtonFor(t)}
                    smsUnread={smsUnreadByTicketId[t.id] ?? 0}
                  />
                );
              })}
            </div>
          </div>
        );
      })}
      {groups.length === 0 && (
        <div style={{ padding: 24, textAlign: "center", color: "var(--muted)" }}>Žádné zakázky</div>
      )}
    </div>
  );
}
