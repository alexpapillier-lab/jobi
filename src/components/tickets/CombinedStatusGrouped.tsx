import React, { useMemo } from "react";
import type { StatusMeta } from "../../state/StatusesStore";
import { type TicketCardData, formatCZDate, computeFinalPrice } from "./types";
import { DeviceIcon, WrenchIcon } from "./icons";

export type ClaimLike = {
  id: string;
  code: string;
  status: string | null;
  created_at?: string | null;
  device_label?: string | null;
  customer_name?: string | null;
  notes?: string | null;
};

type Props = {
  tickets: TicketCardData[];
  claims: ClaimLike[];
  statuses: StatusMeta[];
  normalizeStatus: (raw: any) => string | null;
  onClickTicket: (id: string) => void;
  onClickClaim: (id: string) => void;
  statusPickerForTicket: (ticket: TicketCardData, currentStatus: string | null) => React.ReactNode;
  statusPickerForClaim: (claim: ClaimLike) => React.ReactNode;
  printButtonForTicket: (ticket: TicketCardData) => React.ReactNode;
  printButtonForClaim: (claim: ClaimLike) => React.ReactNode;
  customOrder?: string[];
  smsUnreadByTicketId?: Record<string, number>;
};

const smsBadge = (n: number) =>
  n > 0 ? (
    <span style={{ marginLeft: 6, minWidth: 18, height: 18, borderRadius: 9, background: "#FF3B30", color: "#fff", fontSize: 10, fontWeight: 700, display: "inline-flex", alignItems: "center", justifyContent: "center", padding: "0 5px" }}>
      {n > 99 ? "99+" : n}
    </span>
  ) : null;

function formatCZ(dt: string | null | undefined): string {
  if (!dt) return "—";
  try {
    const d = new Date(dt);
    return `${d.getDate()}.${d.getMonth() + 1}.${d.getFullYear()}`;
  } catch {
    return "—";
  }
}

function TicketRow({
  ticket: t,
  statusColor,
  onClickDetail,
  statusPicker,
  printButton,
  smsUnread = 0,
}: {
  ticket: TicketCardData;
  statusColor: string;
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

function ClaimRow({
  claim,
  statusColor,
  onClickDetail,
  statusPicker,
  printButton,
}: {
  claim: ClaimLike;
  statusColor: string;
  onClickDetail: (id: string) => void;
  statusPicker: React.ReactNode;
  printButton: React.ReactNode;
}) {
  return (
    <div
      onClick={() => onClickDetail(claim.id)}
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
      <span style={{ fontWeight: 800, fontSize: 12, color: "#0d9488", whiteSpace: "nowrap", flexShrink: 0 }}>{claim.code}</span>
      <span style={{ fontSize: 10, color: "var(--muted)", whiteSpace: "nowrap", flexShrink: 0 }}>{formatCZ(claim.created_at ?? null)}</span>
      <span style={{ fontWeight: 600, fontSize: 12, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", flex: 1, minWidth: 0 }}>{claim.device_label || "—"}</span>
      <span style={{ fontSize: 11, color: "var(--muted)", whiteSpace: "nowrap", flexShrink: 0 }}>{claim.customer_name || "—"}</span>
      <div style={{ display: "flex", alignItems: "center", gap: 4, flexShrink: 0, marginLeft: "auto" }} onClick={(e) => e.stopPropagation()} onMouseDown={(e) => e.stopPropagation()}>
        {statusPicker}
        {printButton}
      </div>
    </div>
  );
}

type Item = { type: "ticket"; data: TicketCardData } | { type: "claim"; data: ClaimLike };

function itemCreatedAtMs(item: Item): number {
  const raw = item.type === "ticket" ? item.data.createdAt : (item.data.created_at ?? "");
  const ms = new Date(raw || 0).getTime();
  return Number.isFinite(ms) ? ms : 0;
}

export function CombinedStatusGrouped({
  tickets,
  claims,
  statuses,
  normalizeStatus,
  onClickTicket,
  onClickClaim,
  statusPickerForTicket,
  statusPickerForClaim,
  printButtonForTicket,
  printButtonForClaim,
  customOrder,
  smsUnreadByTicketId = {},
}: Props) {
  const groups = useMemo(() => {
    const items: Item[] = [
      ...tickets.map((t) => ({ type: "ticket" as const, data: t })),
      ...claims.map((c) => ({ type: "claim" as const, data: c })),
    ];
    const result: { status: StatusMeta; items: Item[] }[] = [];
    const unassigned: Item[] = [];

    const orderedStatuses = customOrder && customOrder.length > 0
      ? customOrder
          .map((key) => statuses.find((s) => s.key === key))
          .filter((s): s is StatusMeta => !!s)
      : statuses;

    for (const s of orderedStatuses) {
      const matching = items
        .filter((it) => normalizeStatus(it.data.status) === s.key)
        .sort((a, b) => itemCreatedAtMs(b) - itemCreatedAtMs(a));
      if (matching.length > 0) {
        result.push({ status: s, items: matching });
      }
    }

    for (const it of items) {
      const st = normalizeStatus(it.data.status);
      if (st === null || !orderedStatuses.some((s) => s.key === st)) {
        unassigned.push(it);
      }
    }

    if (unassigned.length > 0) {
      unassigned.sort((a, b) => itemCreatedAtMs(b) - itemCreatedAtMs(a));
      result.unshift({
        status: { key: "__unassigned__", label: "Bez statusu", bg: "var(--muted)", isFinal: false },
        items: unassigned,
      });
    }

    return result;
  }, [tickets, claims, statuses, normalizeStatus, customOrder]);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      {groups.map(({ status, items: groupItems }) => {
        const color = status.bg || "var(--muted)";
        return (
          <div key={status.key}>
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
                {groupItems.length}
              </span>
            </div>

            <div style={{ display: "flex", flexDirection: "column", gap: 4, paddingLeft: 6, borderLeft: `3px solid ${color}25` }}>
              {groupItems.map((it) =>
                it.type === "ticket" ? (
                  <TicketRow
                    key={`t-${it.data.id}`}
                    ticket={it.data}
                    statusColor={color}
                    onClickDetail={onClickTicket}
                    statusPicker={statusPickerForTicket(it.data, normalizeStatus(it.data.status))}
                    printButton={printButtonForTicket(it.data)}
                    smsUnread={smsUnreadByTicketId[it.data.id] ?? 0}
                  />
                ) : (
                  <ClaimRow
                    key={`c-${it.data.id}`}
                    claim={it.data}
                    statusColor={color}
                    onClickDetail={onClickClaim}
                    statusPicker={statusPickerForClaim(it.data)}
                    printButton={printButtonForClaim(it.data)}
                  />
                )
              )}
            </div>
          </div>
        );
      })}
      {groups.length === 0 && (
        <div style={{ padding: 24, textAlign: "center", color: "var(--muted)" }}>Žádné zakázky ani reklamace</div>
      )}
    </div>
  );
}
