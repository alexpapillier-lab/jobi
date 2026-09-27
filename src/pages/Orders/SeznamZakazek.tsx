/**
 * Seznam zakázek: hlavička, hledání, záložky a filtry, stavy načítání,
 * karty / časová osa / seskupení podle stavu, stránkování, blok aktivních
 * reklamací a prázdný stav.
 *
 * Vyneseno z Orders.tsx beze změny obsahu. Stav i výpočty (filtrování,
 * stránkování, počty) zůstávají v kontejneru a přicházejí jako props; tady
 * jsou jen vykreslovací pomocníci karet, které nikdo jiný nepotřebuje.
 */
import React, { useCallback, useMemo } from "react";
import { Button, Segmented } from "../../components/ui";
import { TicketCardList, TicketCardGrid, TicketCardCompact, TicketCardCompactExtra, TicketCardStripe, TicketTimeline, TicketStatusGrouped, ClaimStatusGrouped, CombinedStatusGrouped, ClaimCard, type TicketCardData } from "../../components/tickets";
import { StatusPicker } from "../../components/orders";
import { StatusFilter, type StatusFilterOption } from "../../components/orders/StatusFilter";
import { OnboardingChecklist } from "../../components/OnboardingChecklist";
import { SectionHeading } from "../../components/SectionHeading";
import { PresenceAvatars } from "../../components/PresenceAvatars";
import { DocumentIcon, PrintIcon, XIcon } from "../../components/icons";
import type { StatusMeta } from "../../state/StatusesStore";
import type { TicketViewer } from "../../lib/presence";
import type { WarrantyClaimRow } from "./hooks/useWarrantyClaims";
import type { ClaimsSubGroup, GroupKey, TicketEx, UIConfig } from "./typy";
import { inputStyle } from "./styly";

/** Řádek smíšeného seznamu (Vše / Dokončené se zapnutým míšením reklamací). */
export type RadekSeznamu =
  | { type: "ticket"; data: TicketEx; created_at: string }
  | { type: "claim"; data: WarrantyClaimRow; created_at: string };

type Props = {
  activeServiceId: string | null;
  isAdmin: boolean;
  /** Id všech zakázek – pro kartu První kroky. */
  ticketIds: string[];
  searchInputRef: React.RefObject<HTMLInputElement | null>;
  query: string;
  setQuery: React.Dispatch<React.SetStateAction<string>>;
  openNewOrder: () => void;
  onNovaReklamace: () => void;
  activeGroup: GroupKey;
  setActiveGroup: React.Dispatch<React.SetStateAction<GroupKey>>;
  groupCounts: { all: number; active: number; final: number; moje: number; presun: number; reklamace: number };
  pridelovaniTechnika: boolean;
  filtrPresunu: boolean;
  activeStatusKey: string | null;
  setActiveStatusKey: React.Dispatch<React.SetStateAction<string | null>>;
  statusFilterOptions: { options: StatusFilterOption[]; total: number };
  claimsSubGroup: ClaimsSubGroup;
  setClaimsSubGroup: React.Dispatch<React.SetStateAction<ClaimsSubGroup>>;
  showSecondaryFiltersRow: boolean;
  quickStatuses: StatusMeta[];
  statusesLoading: boolean;
  statusesError: string | null;
  statusesReady: boolean;
  ticketsLoading: boolean;
  ticketsPartial: boolean;
  ticketsError: string | null;
  claimsLoading: boolean;
  claimsError: string | null;
  /** Předvolby seznamu (uiCfg.orders): režim zobrazení, zvýraznění stavu, pořadí skupin. */
  ordersCfg: UIConfig["orders"];
  statuses: StatusMeta[];
  getByKey: (key: string) => StatusMeta | undefined;
  normalizeStatus: (key: string) => string | null;
  statusById: Record<string, string>;
  toCardData: (t: TicketEx) => TicketCardData;
  filtered: TicketEx[];
  combinedList: RadekSeznamu[];
  showClaimsInOrdersList: boolean;
  paginatedTickets: TicketEx[];
  paginatedClaims: WarrantyClaimRow[];
  paginatedCombined: RadekSeznamu[];
  aktivniReklamace: WarrantyClaimRow[];
  pageSize: number;
  listLength: number;
  effectivePageSize: number;
  totalOrdersPages: number;
  ordersPage: number;
  setOrdersPage: React.Dispatch<React.SetStateAction<number>>;
  /** Servis nemá vůbec žádné zakázky / reklamace (prázdný stav bez filtru). */
  zadneZakazky: boolean;
  zadneReklamace: boolean;
  setDetailId: React.Dispatch<React.SetStateAction<string | null>>;
  setDetailClaimId: React.Dispatch<React.SetStateAction<string | null>>;
  setTicketStatus: (ticketId: string, next: string) => Promise<void>;
  setClaimStatus: (claimId: string, next: string) => Promise<void>;
  statusActionsMap: Record<string, string[]>;
  canPrintExport: boolean;
  zajistiPlnouZakazku: (ticketId: string) => Promise<TicketEx | null>;
  openQuickPrintTicketRef: React.MutableRefObject<TicketEx | null>;
  setOpenQuickPrintTicket: React.Dispatch<React.SetStateAction<TicketEx | null>>;
  viewersByTicket: Record<string, TicketViewer[]>;
  smsPanelOpen: boolean;
  detailId: string | null;
  smsUnreadByTicketId: Record<string, number>;
};

export function SeznamZakazek({
  activeServiceId,
  isAdmin,
  ticketIds,
  searchInputRef,
  query,
  setQuery,
  openNewOrder,
  onNovaReklamace,
  activeGroup,
  setActiveGroup,
  groupCounts,
  pridelovaniTechnika,
  filtrPresunu,
  activeStatusKey,
  setActiveStatusKey,
  statusFilterOptions,
  claimsSubGroup,
  setClaimsSubGroup,
  showSecondaryFiltersRow,
  quickStatuses,
  statusesLoading,
  statusesError,
  statusesReady,
  ticketsLoading,
  ticketsPartial,
  ticketsError,
  claimsLoading,
  claimsError,
  ordersCfg,
  statuses,
  getByKey,
  normalizeStatus,
  statusById,
  toCardData,
  filtered,
  combinedList,
  showClaimsInOrdersList,
  paginatedTickets,
  paginatedClaims,
  paginatedCombined,
  aktivniReklamace,
  pageSize,
  listLength,
  effectivePageSize,
  totalOrdersPages,
  ordersPage,
  setOrdersPage,
  zadneZakazky,
  zadneReklamace,
  setDetailId,
  setDetailClaimId,
  setTicketStatus,
  setClaimStatus,
  statusActionsMap,
  canPrintExport,
  zajistiPlnouZakazku,
  openQuickPrintTicketRef,
  setOpenQuickPrintTicket,
  viewersByTicket,
  smsPanelOpen,
  detailId,
  smsUnreadByTicketId,
}: Props) {
  const groupLabel = (label: string, count: number) => (
    <>
      {label}
      <span style={{ marginLeft: 6, fontSize: "var(--text-xs)", color: "var(--muted)", fontWeight: 600 }}>{count}</span>
    </>
  );
  const renderStatusPicker = useCallback((ticketId: string, currentStatus: string | null) => {
    if (currentStatus !== null) {
      return <StatusPicker value={currentStatus} statuses={statuses as any} getByKey={getByKey as any} onChange={(next) => setTicketStatus(ticketId, next)} size="sm" actionsByStatus={statusActionsMap} />;
    }
    return <div style={{ fontSize: 11, padding: "4px 8px", borderRadius: 6, background: "var(--panel-2)", color: "var(--muted)", fontWeight: 600 }}>…</div>;
  }, [statuses, getByKey, setTicketStatus, statusActionsMap]);

  const renderPrintButton = useCallback((t: TicketCardData, small?: boolean) => {
    if (!canPrintExport) return null;
    const sz = small ? 26 : 32;
    return (
      <button
        type="button"
        data-quick-print-trigger-id={t.id}
        /* Z karty se tisknou celé dokumenty – zakázkový list chce adresu, stav
           zařízení i kontrolu po opravě, tedy sloupce, které seznam nečte.
           Dřív se do nabídky posílala jen data karty, takže se tisklo bez nich
           a „Diagnostický protokol" se v nabídce nikdy neobjevil. */
        onClick={(e) => {
          e.stopPropagation();
          if (openQuickPrintTicketRef.current?.id === t.id) { setOpenQuickPrintTicket(null); return; }
          void zajistiPlnouZakazku(t.id).then((plna) => setOpenQuickPrintTicket(plna));
        }}
        title="Tisk"
        style={{ display: "flex", alignItems: "center", justifyContent: "center", width: sz, height: sz, minWidth: sz, minHeight: sz, borderRadius: small ? 6 : 8, border: "1px solid var(--border)", background: "var(--panel)", color: "var(--text)", cursor: "pointer", fontSize: small ? 12 : 14, flexShrink: 0 }}
      ><PrintIcon size={small ? 13 : 15} /></button>
    );
  }, [canPrintExport, setOpenQuickPrintTicket, zajistiPlnouZakazku]);

  const smsUnreadForTicket = (ticketId: string) => {
    if (smsPanelOpen && detailId === ticketId) return 0;
    return smsUnreadByTicketId[ticketId] ?? 0;
  };

  const smsUnreadByTicketIdDisplay = useMemo(() => {
    const o = { ...smsUnreadByTicketId };
    if (smsPanelOpen && detailId) o[detailId] = 0;
    return o;
  }, [smsUnreadByTicketId, smsPanelOpen, detailId]);

  const smsBadge = (ticketId: string) => {
    const n = smsUnreadForTicket(ticketId);
    if (n <= 0) return null;
    return (
      <span
        style={{
          position: "absolute",
          top: -8,
          right: -8,
          minWidth: 20,
          height: 20,
          borderRadius: "50%",
          background: "#FF3B30",
          color: "#fff",
          fontSize: 11,
          fontWeight: 700,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          padding: "0 6px",
          zIndex: 1,
        }}
      >
        {n > 99 ? "99+" : n}
      </span>
    );
  };

  const renderTicketCard = (t: TicketEx) => {
    const raw = (t.status as any) ?? statusById[t.id];
    const currentStatus = normalizeStatus(raw);
    const meta = currentStatus !== null ? getByKey(currentStatus) : null;
    const cardData = toCardData(t);
    const mode = ordersCfg.displayMode;
    const onClick = () => { setDetailId(t.id); setDetailClaimId(null); };
    const viewers = viewersByTicket[t.id];
    const statusNode = viewers && viewers.length > 0 ? (
      <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
        <PresenceAvatars viewers={viewers} size={18} />
        {renderStatusPicker(t.id, currentStatus)}
      </span>
    ) : renderStatusPicker(t.id, currentStatus);
    const metaOrNull = meta ?? null;
    const wrap = (node: React.ReactNode) =>
      smsUnreadForTicket(t.id) > 0 ? (
        <div key={t.id} style={{ position: "relative" }}>
          {smsBadge(t.id)}
          {node}
        </div>
      ) : (
        <React.Fragment key={t.id}>{node}</React.Fragment>
      );

    /* Síla zvýraznění stavu platí pro všechny režimy zobrazení – dřív ji
       znal jen Seznam a v ostatních režimech volba v Nastavení nic nedělala. */
    const zvyrazneni = ordersCfg.zvyrazneniStavu;
    switch (mode) {
      case "compact":
        return wrap(<TicketCardCompact ticket={cardData} meta={metaOrNull} onClick={onClick} statusPicker={statusNode} printButton={renderPrintButton(cardData, true)} zvyrazneni={zvyrazneni} />);
      case "compact-extra":
        return wrap(<TicketCardCompactExtra ticket={cardData} meta={metaOrNull} onClick={onClick} statusPicker={statusNode} printButton={renderPrintButton(cardData, true)} zvyrazneni={zvyrazneni} />);
      case "grid":
        return wrap(<TicketCardGrid ticket={cardData} meta={metaOrNull} onClick={onClick} statusPicker={statusNode} printButton={renderPrintButton(cardData, true)} zvyrazneni={zvyrazneni} />);
      case "stripe":
        return wrap(<TicketCardStripe ticket={cardData} meta={metaOrNull} onClick={onClick} statusPicker={statusNode} printButton={renderPrintButton(cardData, true)} zvyrazneni={zvyrazneni} />);
      case "list":
      default:
        return wrap(<TicketCardList ticket={cardData} meta={metaOrNull} onClick={onClick} statusPicker={statusNode} printButton={renderPrintButton(cardData, true)} zvyrazneni={zvyrazneni} />);
    }
  };

  const renderClaimCard = (c: any, keyPrefix = "") => {
    const rawStatus = (c.status as string | null) ?? "";
    const currentStatus = normalizeStatus(rawStatus);
    const claimMeta = currentStatus !== null ? getByKey(currentStatus) : null;
    const statusColor = claimMeta?.bg || "var(--border)";
    const isSmall = ordersCfg.displayMode === "compact" || ordersCfg.displayMode === "compact-extra";
    const claimAsCardData: TicketCardData = {
      id: c.id, code: c.code, customerName: c.customer_name ?? "—",
      deviceLabel: c.device_label ?? "—", issueShort: c.notes ?? "",
      createdAt: c.created_at ?? "", status: c.status,
    };
    return (
      <ClaimCard
        key={`${keyPrefix}${c.id}`}
        claim={c}
        displayMode={ordersCfg.displayMode}
        statusColor={statusColor}
        statusLabel={claimMeta?.label}
        isFinal={claimMeta?.isFinal === true}
        zvyrazneni={ordersCfg.zvyrazneniStavu}
        onClick={() => { setDetailClaimId(c.id); setDetailId(null); }}
        statusPicker={<StatusPicker value={c.status} statuses={statuses as any} getByKey={getByKey as any} onChange={(next) => setClaimStatus(c.id, next)} size="sm" />}
        printButton={renderPrintButton(claimAsCardData, isSmall)}
      />
    );
  };
  return (
    <>
      {/* První kroky nového servisu – jen pro majitele a správce, sám zmizí. */}
      {activeServiceId && isAdmin && (
        <OnboardingChecklist activeServiceId={activeServiceId} ticketIds={ticketIds} />
      )}
      {/* Header */}
      <div>
        <div style={{ fontSize: 22, fontWeight: 950, color: "var(--text)" }}>Zakázky</div>
      </div>

      {/* Toolbar */}
      <div style={{ display: "flex", justifyContent: "space-between", gap: 16, alignItems: "flex-start", flexWrap: "wrap" }}>
        <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap", flex: 1, minWidth: 0 }}>
          <div style={{ position: "relative", width: 360, maxWidth: "100%", minWidth: 0 }}>
            <input
              ref={searchInputRef}
              data-tour="orders-search"
              placeholder="Vyhledávání…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                // Esc v poli s textem jen vymaže hledání – nesmí dojít ke globální zkratce, která zavírá okna.
                if (e.key === "Escape" && query) {
                  e.preventDefault();
                  e.stopPropagation();
                  setQuery("");
                }
              }}
              style={{ ...inputStyle, width: "100%", paddingRight: query ? 38 : 12 }}
            />
            {query && (
              <button
                type="button"
                aria-label="Vymazat hledání"
                title="Vymazat hledání (Esc)"
                onClick={() => {
                  setQuery("");
                  searchInputRef.current?.focus();
                }}
                style={{ position: "absolute", right: 7, top: "50%", transform: "translateY(-50%)", width: 26, height: 26, display: "grid", placeItems: "center", border: "none", borderRadius: 8, background: "var(--panel-2)", color: "var(--muted)", cursor: "pointer" }}
              >
                <XIcon size={14} />
              </button>
            )}
          </div>
          <Button variant="primary" data-tour="orders-new-btn" onClick={openNewOrder}>
            + Nová zakázka
          </Button>
          <Button variant="primary"
            data-tour="orders-new-claim-btn"
            onClick={onNovaReklamace}
          >
            + Nová reklamace
          </Button>
        </div>
      </div>

      {/* Group tabs + filtr podle stavu */}
      <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
      <div data-tour="orders-groups">
        <Segmented<GroupKey>
          dataTour="orders-filters"
          ariaLabel="Filtr zakázek"
          value={activeGroup}
          onChange={setActiveGroup}
          options={[
            { value: "all", label: groupLabel("Vše", groupCounts.all) },
            { value: "active", label: groupLabel("Aktivní", groupCounts.active) },
            ...(pridelovaniTechnika ? [{ value: "moje" as GroupKey, label: groupLabel("Moje", groupCounts.moje) }] : []),
            ...(filtrPresunu ? [{ value: "presun" as GroupKey, label: groupLabel("Přesuny", groupCounts.presun) }] : []),
            { value: "final", label: groupLabel("Dokončené", groupCounts.final) },
            { value: "reklamace", label: groupLabel("Reklamace", groupCounts.reklamace) },
          ]}
        />
      </div>
      {activeGroup !== "reklamace" && (
        <StatusFilter value={activeStatusKey} onChange={setActiveStatusKey} options={statusFilterOptions.options} total={statusFilterOptions.total} />
      )}
      </div>

      {/* Reklamace sub-filter: Aktivní / Final */}
      {activeGroup === "reklamace" && (
          <div data-tour="orders-claims-subfilter" style={{ marginTop: 10 }}>
            <Segmented<ClaimsSubGroup>
              size="sm"
              ariaLabel="Filtr reklamací"
              value={claimsSubGroup}
              onChange={setClaimsSubGroup}
              options={[
                { value: "all", label: "Vše" },
                { value: "active", label: "Aktivní" },
                { value: "final", label: "Dokončené" },
              ]}
            />
          </div>
      )}

      {/* Secondary quick status filters */}
      {showSecondaryFiltersRow && (
          <Segmented
            dataTour="orders-filters"
            ariaLabel="Filtr stavů"
            size="sm"
            value={activeStatusKey ?? ""}
            onChange={(key) => setActiveStatusKey(key === "" ? null : key)}
            options={[
              { value: "", label: "Všechny stavy" },
              ...quickStatuses.map((st) => ({ value: st.key, label: st.label, title: st.label })),
            ]}
          />
      )}

      {/* Loading/Error states */}
      {statusesLoading && (
        <div style={{ padding: 24, textAlign: "center", color: "var(--muted)" }}>
          Načítání statusů...
        </div>
      )}
      {statusesError && (
        <div style={{ padding: 24, textAlign: "center", color: "rgba(239,68,68,0.9)", background: "rgba(239,68,68,0.1)", borderRadius: 12, border: "1px solid rgba(239,68,68,0.3)" }}>
          Chyba při načítání statusů: {statusesError}
        </div>
      )}
      {ticketsLoading && (
        <div style={{ padding: 24, textAlign: "center", color: "var(--muted)" }}>
          Načítání zakázek...
        </div>
      )}
      {/* Seznam je vidět dřív, než dojedou všechny zakázky. Bez téhle věty by
          se počty u záložek beze slova změnily pod rukama a hledání by chvíli
          tvrdilo, že starší zakázka neexistuje. */}
      {!ticketsLoading && ticketsPartial && (
        <div style={{ padding: "4px 2px 8px", fontSize: "var(--text-xs)", color: "var(--muted)" }}>
          Načítají se starší zakázky – počty a hledání zatím nemusí být úplné.
        </div>
      )}
      {ticketsError && activeGroup !== "reklamace" && (
        <div style={{ padding: 24, textAlign: "center", color: "rgba(239,68,68,0.9)", background: "rgba(239,68,68,0.1)", borderRadius: 12, border: "1px solid rgba(239,68,68,0.3)" }}>
          {ticketsError}
        </div>
      )}
      {claimsLoading && activeGroup === "reklamace" && (
        <div style={{ padding: 24, textAlign: "center", color: "var(--muted)" }}>Načítání reklamací…</div>
      )}
      {claimsError && (
        <div style={{ padding: 24, textAlign: "center", color: "rgba(239,68,68,0.9)", background: "rgba(239,68,68,0.1)", borderRadius: 12, border: "1px solid rgba(239,68,68,0.3)" }}>
          {claimsError}
        </div>
      )}

      {/* List/Grid - only render if statuses are ready and not loading and no error */}
      {statusesReady && (activeGroup === "reklamace" ? !claimsLoading && !claimsError : !ticketsLoading && !ticketsError) && (
      <div data-tour="orders-list" style={{ 
        marginTop: 16, 
        ...(ordersCfg.displayMode === "timeline" || ordersCfg.displayMode === "status-grouped"
          ? { minWidth: 0 }
          : {
              display: "grid",
              gridTemplateColumns: ordersCfg.displayMode === "grid" ? "repeat(auto-fill, minmax(min(100%, 280px), 1fr))" : "minmax(min(100%, 260px), 1fr)",
              /* U plné výplně řádky těsně u sebe jako v Zakázkovém listu – mezery
                 mezi sytě barevnými pruhy by rozbily dojem souvislého seznamu. */
              gap: ordersCfg.displayMode === "grid" ? 12
                : ordersCfg.displayMode === "compact-extra" || ordersCfg.displayMode === "stripe" || ordersCfg.zvyrazneniStavu === "plne" ? 2
                : 6,
              minWidth: 0,
            }),
      }}>
        {/* Timeline a seskupení podle stavu: pohledy přes celý kontejner */}
        {activeGroup !== "reklamace" && ordersCfg.displayMode === "timeline" && (
          <TicketTimeline
            tickets={paginatedTickets.map(toCardData)}
            getByKey={getByKey as any}
            normalizeStatus={normalizeStatus}
            onClickDetail={(id) => { setDetailId(id); setDetailClaimId(null); }}
            smsUnreadByTicketId={smsUnreadByTicketIdDisplay}
            zvyrazneni={ordersCfg.zvyrazneniStavu}
          />
        )}
        {activeGroup !== "reklamace" && ordersCfg.displayMode === "status-grouped" && (
          showClaimsInOrdersList ? (
            <CombinedStatusGrouped
              tickets={combinedList.filter((r) => r.type === "ticket").map((r) => toCardData((r as { type: "ticket"; data: TicketEx }).data))}
              claims={combinedList.filter((r) => r.type === "claim").map((r) => (r as { type: "claim"; data: WarrantyClaimRow }).data)}
              statuses={statuses as any}
              normalizeStatus={normalizeStatus}
              onClickTicket={(id) => { setDetailId(id); setDetailClaimId(null); }}
              onClickClaim={(id) => { setDetailClaimId(id); setDetailId(null); }}
              statusPickerForTicket={(t, st) => renderStatusPicker(t.id, st)}
              statusPickerForClaim={(c) => <StatusPicker value={c.status ?? ""} statuses={statuses as any} getByKey={getByKey as any} onChange={(next) => setClaimStatus(c.id, next)} size="sm" />}
              printButtonForTicket={(t) => renderPrintButton(t, true)}
              printButtonForClaim={(c) => renderPrintButton({ id: c.id, code: c.code, customerName: c.customer_name ?? "—", deviceLabel: c.device_label ?? "—", issueShort: c.notes ?? "", createdAt: c.created_at ?? "", status: c.status }, true)}
              customOrder={ordersCfg.statusGroupedOrder}
              smsUnreadByTicketId={smsUnreadByTicketIdDisplay}
              zvyrazneni={ordersCfg.zvyrazneniStavu}
            />
          ) : (
            <TicketStatusGrouped
              tickets={filtered.map(toCardData)}
              statuses={statuses as any}
              normalizeStatus={normalizeStatus}
              onClickDetail={(id) => { setDetailId(id); setDetailClaimId(null); }}
              statusPickerFor={(t, st) => renderStatusPicker(t.id, st)}
              printButtonFor={(t) => renderPrintButton(t, true)}
              customOrder={ordersCfg.statusGroupedOrder}
              smsUnreadByTicketId={smsUnreadByTicketIdDisplay}
              zvyrazneni={ordersCfg.zvyrazneniStavu}
            />
          )
        )}
        {activeGroup === "reklamace" && ordersCfg.displayMode === "status-grouped" && (
          <ClaimStatusGrouped
            claims={paginatedClaims}
            statuses={statuses as any}
            normalizeStatus={normalizeStatus}
            onClickDetail={(id) => { setDetailClaimId(id); setDetailId(null); }}
            statusPickerFor={(c) => <StatusPicker value={c.status ?? ""} statuses={statuses as any} getByKey={getByKey as any} onChange={(next) => setClaimStatus(c.id, next)} size="sm" />}
            printButtonFor={(c) => renderPrintButton({ id: c.id, code: c.code, customerName: c.customer_name ?? "—", deviceLabel: c.device_label ?? "—", issueShort: c.notes ?? "", createdAt: c.created_at ?? "", status: c.status }, true)}
            customOrder={ordersCfg.statusGroupedOrder}
            zvyrazneni={ordersCfg.zvyrazneniStavu}
          />
        )}
        {/* Card-based modes: render individual cards (skip if table/timeline/status-grouped already rendered above) */}
        {activeGroup === "reklamace" && ordersCfg.displayMode !== "timeline" && ordersCfg.displayMode !== "status-grouped"
          ? paginatedClaims.map((c) => renderClaimCard(c))
          : ordersCfg.displayMode !== "timeline" && ordersCfg.displayMode !== "status-grouped" && showClaimsInOrdersList
            ? paginatedCombined.map((row) =>
                row.type === "claim"
                  ? renderClaimCard(row.data, "claim-")
                  : renderTicketCard(row.data)
              )
          : ordersCfg.displayMode !== "timeline" && ordersCfg.displayMode !== "status-grouped"
            ? paginatedTickets.map((t) => renderTicketCard(t))
            : null
        }

        {pageSize > 0 && listLength > pageSize && (() => {
          const from = ordersPage * effectivePageSize + 1;
          const to = Math.min((ordersPage + 1) * effectivePageSize, listLength);
          const label = activeGroup === "reklamace" ? "reklamací" : "zakázek";
          const maxPageButtons = 7;
          const showPageNumbers = totalOrdersPages <= maxPageButtons;
          const getPageNumbers = (): number[] => {
            if (totalOrdersPages <= maxPageButtons) {
              return Array.from({ length: totalOrdersPages }, (_, i) => i);
            }
            const cur = ordersPage;
            const last = totalOrdersPages - 1;
            const pages: number[] = [0];
            if (cur > 2) pages.push(-1);
            for (let i = Math.max(1, cur - 1); i <= Math.min(last - 1, cur + 1); i++) {
              if (!pages.includes(i)) pages.push(i);
            }
            if (cur < last - 2) pages.push(-2);
            if (last > 0 && !pages.includes(last)) pages.push(last);
            return pages;
          };
          const pageNumbers = getPageNumbers();
          const btnBase = {
            minWidth: 36,
            height: 36,
            padding: "0 10px",
            borderRadius: 10,
            border: "1px solid var(--border)",
            background: "var(--panel)",
            color: "var(--text)",
            fontWeight: 600,
            fontSize: 13,
            cursor: "pointer" as const,
            transition: "background 0.15s ease, border-color 0.15s ease, box-shadow 0.15s ease",
          };
          const btnDisabled = { opacity: 0.45, cursor: "not-allowed" as const };
          return (
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                gap: 16,
                marginTop: 20,
                /* Pruh pod stránkováním: plovoucí „+“ a bublina chatu sedí
                   v pravém dolním rohu přesně přes šipky stránek. Takhle se
                   stránkování doscrolluje nad ně. */
                marginBottom: 72,
                padding: "14px 20px",
                background: "var(--panel)",
                border: "1px solid var(--border)",
                borderRadius: 14,
                boxShadow: "0 1px 3px rgba(0,0,0,0.04)",
                flexWrap: "wrap",
              }}
            >
              <span style={{ fontSize: 13, color: "var(--muted)", fontWeight: 500 }}>
                Zobrazeno <strong style={{ color: "var(--text)", fontWeight: 700 }}>{from}–{to}</strong> z {listLength} {label}
              </span>
              <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                <button
                  type="button"
                  aria-label="Předchozí stránka"
                  onClick={() => setOrdersPage((p) => Math.max(0, p - 1))}
                  disabled={ordersPage === 0}
                  style={{
                    ...btnBase,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    ...(ordersPage === 0 ? btnDisabled : {}),
                  }}
                  onMouseEnter={(e) => { if (ordersPage > 0) { e.currentTarget.style.background = "var(--panel-2)"; e.currentTarget.style.borderColor = "var(--accent)"; e.currentTarget.style.boxShadow = "0 0 0 1px var(--accent)"; } }}
                  onMouseLeave={(e) => { e.currentTarget.style.background = "var(--panel)"; e.currentTarget.style.borderColor = "var(--border)"; e.currentTarget.style.boxShadow = "none"; }}
                >
                  ‹
                </button>
                {showPageNumbers ? (
                  pageNumbers.map((p) => {
                    if (p === -1) return <span key="ell-left" style={{ padding: "0 4px", color: "var(--muted)", fontSize: 12 }}>…</span>;
                    if (p === -2) return <span key="ell-right" style={{ padding: "0 4px", color: "var(--muted)", fontSize: 12 }}>…</span>;
                    const isCurrent = p === ordersPage;
                    return (
                      <button
                        key={p}
                        type="button"
                        aria-label={`Stránka ${p + 1}`}
                        aria-current={isCurrent ? "page" : undefined}
                        onClick={() => setOrdersPage(p)}
                        style={{
                          ...btnBase,
                          background: isCurrent ? "var(--accent)" : "var(--panel)",
                          color: isCurrent ? "white" : "var(--text)",
                          borderColor: isCurrent ? "var(--accent)" : "var(--border)",
                          ...(isCurrent ? { boxShadow: "0 2px 8px var(--accent-glow)" } : {}),
                        }}
                        onMouseEnter={(e) => { if (!isCurrent) { e.currentTarget.style.background = "var(--panel-2)"; e.currentTarget.style.borderColor = "var(--accent)"; } }}
                        onMouseLeave={(e) => { if (!isCurrent) { e.currentTarget.style.background = "var(--panel)"; e.currentTarget.style.borderColor = "var(--border)"; } }}
                      >
                        {p + 1}
                      </button>
                    );
                  })
                ) : (
                  <span style={{ fontSize: 13, color: "var(--muted)", minWidth: 72, textAlign: "center", fontWeight: 600 }}>
                    {ordersPage + 1} / {totalOrdersPages}
                  </span>
                )}
                <button
                  type="button"
                  aria-label="Další stránka"
                  onClick={() => setOrdersPage((p) => Math.min(totalOrdersPages - 1, p + 1))}
                  disabled={ordersPage >= totalOrdersPages - 1}
                  style={{
                    ...btnBase,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    ...(ordersPage >= totalOrdersPages - 1 ? btnDisabled : {}),
                  }}
                  onMouseEnter={(e) => { if (ordersPage < totalOrdersPages - 1) { e.currentTarget.style.background = "var(--panel-2)"; e.currentTarget.style.borderColor = "var(--accent)"; e.currentTarget.style.boxShadow = "0 0 0 1px var(--accent)"; } }}
                  onMouseLeave={(e) => { e.currentTarget.style.background = "var(--panel)"; e.currentTarget.style.borderColor = "var(--border)"; e.currentTarget.style.boxShadow = "none"; }}
                >
                  ›
                </button>
              </div>
            </div>
          );
        })()}

        {/* Aktivní reklamace: v záložce Aktivní vždy pod zakázkami, všechny
            najednou bez ohledu na stránkování. Reklamací bývá pár a nesmí se
            ztratit na třetí stránce mezi zakázkami. */}
        {activeGroup === "active" && aktivniReklamace.length > 0 && (
          <div data-testid="aktivni-reklamace" style={{ gridColumn: "1 / -1", marginTop: 16, minWidth: 0 }}>
            <SectionHeading size="sm">
              Aktivní reklamace
              <span style={{ marginLeft: 6, fontSize: "var(--text-xs)", color: "var(--muted)", fontWeight: 600 }}>{aktivniReklamace.length}</span>
            </SectionHeading>
            {ordersCfg.displayMode === "status-grouped" ? (
              <ClaimStatusGrouped
                claims={aktivniReklamace}
                statuses={statuses as any}
                normalizeStatus={normalizeStatus}
                onClickDetail={(id) => { setDetailClaimId(id); setDetailId(null); }}
                statusPickerFor={(c) => <StatusPicker value={c.status ?? ""} statuses={statuses as any} getByKey={getByKey as any} onChange={(next) => setClaimStatus(c.id, next)} size="sm" />}
                printButtonFor={(c) => renderPrintButton({ id: c.id, code: c.code, customerName: c.customer_name ?? "—", deviceLabel: c.device_label ?? "—", issueShort: c.notes ?? "", createdAt: c.created_at ?? "", status: c.status }, true)}
                customOrder={ordersCfg.statusGroupedOrder}
                zvyrazneni={ordersCfg.zvyrazneniStavu}
              />
            ) : (
              <div style={{
                display: "grid",
                gridTemplateColumns: ordersCfg.displayMode === "grid" ? "repeat(auto-fill, minmax(min(100%, 280px), 1fr))" : "minmax(min(100%, 260px), 1fr)",
                gap: ordersCfg.displayMode === "grid" ? 12
                  : ordersCfg.displayMode === "compact-extra" || ordersCfg.displayMode === "stripe" || ordersCfg.zvyrazneniStavu === "plne" ? 2
                  : 6,
                minWidth: 0,
              }}>
                {aktivniReklamace.map((c) => renderClaimCard(c, "aktivni-"))}
              </div>
            )}
          </div>
        )}

        {listLength === 0 && (
          <div
            style={{
              padding: 48,
              borderRadius: "var(--radius-lg)",
              border: "1px solid var(--border)",
              background: "var(--panel)",
              backdropFilter: "var(--blur)",
              WebkitBackdropFilter: "var(--blur)",
              boxShadow: "var(--shadow-soft)",
              textAlign: "center",
              color: "var(--muted)",
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              gap: 12,
            }}
          >
            {/*
              Prázdný seznam má dvě úplně různé příčiny a nový servis potkává tu
              druhou: buď filtr nic nenašel, nebo servis ještě nic nemá. Do teď
              se v obou případech psalo „neodpovídají filtru“ – zákazník první
              den v aplikaci tak četl, že má něco špatně nastaveného, a hledal
              filtr, který nezapnul.
            */}
            {(() => {
              const jeReklamace = activeGroup === "reklamace";
              const nicNeexistuje = jeReklamace ? zadneReklamace : zadneZakazky;
              return (
                <>
                  <div style={{ fontSize: 48, opacity: 0.5 }}>{jeReklamace ? "—" : <DocumentIcon size={48} />}</div>
                  <div style={{ fontSize: 16, fontWeight: 700, color: "var(--text)" }}>
                    {nicNeexistuje
                      ? jeReklamace
                        ? "Zatím žádné reklamace"
                        : "Zatím žádné zakázky"
                      : jeReklamace
                        ? "Žádné reklamace neodpovídají filtru"
                        : "Žádné zakázky neodpovídají filtru"}
                  </div>
                  <div style={{ fontSize: 13, maxWidth: 460 }}>
                    {nicNeexistuje
                      ? jeReklamace
                        ? "Reklamaci založíte tlačítkem „+ Nová reklamace“ nahoře – navazuje na už dokončenou zakázku."
                        : "Začněte příjmem prvního zařízení: jméno, telefon a co je rozbité. Číslo zakázky i doklad k tisku vzniknou samy."
                      : jeReklamace
                        ? "Zkuste změnit vyhledávání nebo vytvořte reklamaci"
                        : "Zkuste změnit filtry nebo vytvořte novou zakázku"}
                  </div>
                  {nicNeexistuje && !jeReklamace && (
                    // Jiný popis než tlačítko v liště schválně: dvě tlačítka se
                    // stejným názvem na jedné obrazovce se nedají rozlišit ani
                    // odečítačkou, ani testem.
                    <Button variant="primary" onClick={openNewOrder}>Přijmout první zakázku</Button>
                  )}
                </>
              );
            })()}
          </div>
        )}
      </div>
      )}
    </>
  );
}
