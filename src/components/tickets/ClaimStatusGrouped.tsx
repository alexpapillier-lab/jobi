import React, { useMemo } from "react";
import type { StatusMeta } from "../../state/StatusesStore";
import { ClaimBadge, TicketCode, TicketCustomer, TicketDate, TicketDevice } from "./fields";
import { WrenchIcon } from "./icons";

type ClaimLike = {
  id: string;
  code: string;
  status: string | null;
  created_at?: string | null;
  device_label?: string | null;
  customer_name?: string | null;
  notes?: string | null;
};

type Props = {
  claims: ClaimLike[];
  statuses: StatusMeta[];
  normalizeStatus: (raw: any) => string | null;
  onClickDetail: (id: string) => void;
  statusPickerFor: (claim: ClaimLike) => React.ReactNode;
  printButtonFor: (claim: ClaimLike) => React.ReactNode;
  customOrder?: string[];
};

function GroupedClaimRow({
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
      {/* Stejné rozvržení jako řádek zakázky v TicketStatusGrouped / CombinedStatusGrouped. */}
      <TicketCode code={claim.code} dense />
      <ClaimBadge dense />
      <TicketDate value={claim.created_at} />
      <div style={{ display: "flex", alignItems: "center", gap: 4, minWidth: 0, overflow: "hidden" }}>
        <TicketDevice label={claim.device_label} dense iconColor={statusColor} />
      </div>
      <TicketCustomer name={claim.customer_name || "—"} />
      {claim.notes && (
        <div style={{ display: "flex", alignItems: "center", gap: 4, flex: 1, minWidth: 0, overflow: "hidden" }}>
          <WrenchIcon size={10} color="var(--muted)" />
          <span style={{ fontSize: "var(--text-xs)", color: "var(--muted)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{claim.notes}</span>
        </div>
      )}
      <div style={{ display: "flex", alignItems: "center", gap: 4, flexShrink: 0, marginLeft: "auto" }} onClick={(e) => e.stopPropagation()} onMouseDown={(e) => e.stopPropagation()}>
        {statusPicker}
        {printButton}
      </div>
    </div>
  );
}

export function ClaimStatusGrouped({ claims, statuses, normalizeStatus, onClickDetail, statusPickerFor, printButtonFor, customOrder }: Props) {
  const groups = useMemo(() => {
    const result: { status: StatusMeta; claims: ClaimLike[] }[] = [];
    const unassigned: ClaimLike[] = [];

    const orderedStatuses = customOrder && customOrder.length > 0
      ? customOrder
          .map((key) => statuses.find((s) => s.key === key))
          .filter((s): s is StatusMeta => !!s)
      : statuses;

    for (const s of orderedStatuses) {
      const matching = claims.filter((c) => normalizeStatus(c.status) === s.key);
      if (matching.length > 0) {
        result.push({ status: s, claims: matching });
      }
    }

    for (const c of claims) {
      const st = normalizeStatus(c.status);
      if (st === null || !orderedStatuses.some((s) => s.key === st)) {
        unassigned.push(c);
      }
    }

    if (unassigned.length > 0) {
      result.unshift({
        status: { key: "__unassigned__", label: "Bez statusu", bg: "var(--muted)", isFinal: false },
        claims: unassigned,
      });
    }

    return result;
  }, [claims, statuses, normalizeStatus, customOrder]);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      {groups.map(({ status, claims: groupClaims }) => {
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
                {groupClaims.length}
              </span>
            </div>

            <div style={{ display: "flex", flexDirection: "column", gap: 4, paddingLeft: 6, borderLeft: `3px solid ${color}25` }}>
              {groupClaims.map((c) => (
                <GroupedClaimRow
                  key={c.id}
                  claim={c}
                  statusColor={color}
                  onClickDetail={onClickDetail}
                  statusPicker={statusPickerFor(c)}
                  printButton={printButtonFor(c)}
                />
              ))}
            </div>
          </div>
        );
      })}
      {groups.length === 0 && (
        <div style={{ padding: 24, textAlign: "center", color: "var(--muted)" }}>Žádné reklamace</div>
      )}
    </div>
  );
}
