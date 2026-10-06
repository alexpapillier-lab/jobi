/**
 * Hlavička detailu zakázky / reklamace: číslo, stav (pilulka = přepínač),
 * kolegové v detailu, pobočka, zákazník a telefon, tlačítka (Upravit / Uložit,
 * tisk, SMS, faktura, další akce) a zavření.
 * Vyneseno z Orders.tsx beze změny obsahu.
 */
import type React from "react";
import { Button } from "../../components/ui";
import { StatusPicker, PrintMenu, OverflowMenu } from "../../components/orders";
import { CopyButton } from "../../components/CopyButton";
import { PresenceAvatars } from "../../components/PresenceAvatars";
import { ChatIcon, CheckIcon, CoinsIcon, DeviceIcon, DocumentIcon, EditIcon, HistoryIcon, InboxIcon, LinkIcon, PhoneIcon, PinIcon, SaveIcon, SearchIcon, TrashIcon } from "../../components/icons";
import { formatCZ } from "../../components/tickets";
import { showToast } from "../../components/Toast";
import { sazbaProNovouPolozku, type ServiceVat } from "../../hooks/useServiceVat";
import type { StatusMeta } from "../../state/StatusesStore";
import type { TicketViewer } from "../../lib/presence";
import { casHodiny, popisKolegu, type PritomnostVDetailu } from "../../lib/editaceZamek";
import type { Branch } from "../../lib/branches";
import type { WarrantyClaimRow } from "./hooks/useWarrantyClaims";
import type { OrdersProps, TicketEx } from "./typy";
import { formatPhoneNumber } from "./formatovani";
import {
  type DocMode,
  exportTicketToPDF,
  printTicket,
  exportDiagnosticProtocolToPDF,
  printDiagnosticProtocol,
  printZapujcku,
  exportZapujckuToPDF,
  exportWarrantyToPDF,
  printWarranty,
} from "./tiskZakazky";

type Props = {
  isNarrow: boolean;
  activeServiceId: string | null;
  detailedClaim: WarrantyClaimRow | undefined;
  /** Otevřená zakázka tak, jak ji zná seznam – číslo umí i bez dotažení. */
  otevrenaZeSeznamu: TicketEx | undefined;
  detailedTicket: TicketEx | undefined;
  isEditing: boolean;
  isEditingClaim: boolean;
  statuses: StatusMeta[];
  getByKey: (key: string) => StatusMeta | undefined;
  isFinal: (key: string) => boolean;
  normalizeStatus: (key: string) => string | null;
  statusById: Record<string, string>;
  statusActionsMap: Record<string, string[]>;
  setTicketStatus: (ticketId: string, next: string) => Promise<void>;
  setClaimStatus: (claimId: string, next: string) => Promise<void>;
  ticketViewers: TicketViewer[];
  /** Kdo další má tenhle detail otevřený / upravuje (useEditaceZakazky). */
  kolegoveVDetailu: PritomnostVDetailu[];
  hasBranches: boolean;
  branchById: (id: string | null | undefined) => Branch | null;
  setMoveBranchOpen: React.Dispatch<React.SetStateAction<boolean>>;
  onOpenCustomer?: (customerId: string) => void;
  saveClaimChanges: () => Promise<boolean>;
  setIsEditingClaim: React.Dispatch<React.SetStateAction<boolean>>;
  setEditedClaim: React.Dispatch<React.SetStateAction<Partial<WarrantyClaimRow>>>;
  startEditingClaim: () => void;
  canPrintExport: boolean;
  runClaimDocument: (action: DocMode) => Promise<void>;
  setDetailId: React.Dispatch<React.SetStateAction<string | null>>;
  setDetailClaimId: React.Dispatch<React.SetStateAction<string | null>>;
  setClaimHistoryModalOpen: React.Dispatch<React.SetStateAction<boolean>>;
  setDeleteClaimId: React.Dispatch<React.SetStateAction<string | null>>;
  setDeleteClaimDialogOpen: React.Dispatch<React.SetStateAction<boolean>>;
  saveTicketChanges: () => Promise<boolean>;
  setIsEditing: React.Dispatch<React.SetStateAction<boolean>>;
  setEditedTicket: React.Dispatch<React.SetStateAction<Partial<TicketEx>>>;
  startEditing: () => void;
  smsAvailable: boolean;
  smsPanelOpen: boolean;
  setSmsPanelOpen: React.Dispatch<React.SetStateAction<boolean>>;
  smsUnreadCount: number;
  onCreateInvoice?: OrdersProps["onCreateInvoice"];
  onOpenInvoice?: OrdersProps["onOpenInvoice"];
  invoiceIdByTicketId: Record<string, string>;
  dph: ServiceVat;
  setTicketHistoryModalOpen: React.Dispatch<React.SetStateAction<boolean>>;
  /** Otevře okno Nová reklamace předvyplněné touto zakázkou. */
  onNovaReklamaceZeZakazky: (ticket: TicketEx) => void;
  chatZapnuty: boolean;
  setDeleteTicketId: React.Dispatch<React.SetStateAction<string | null>>;
  setDeleteDialogOpen: React.Dispatch<React.SetStateAction<boolean>>;
  handleCloseDetail: () => Promise<void>;
};

export function DetailHlavicka({
  isNarrow,
  activeServiceId,
  detailedClaim,
  otevrenaZeSeznamu,
  detailedTicket,
  isEditing,
  isEditingClaim,
  statuses,
  getByKey,
  isFinal,
  normalizeStatus,
  statusById,
  statusActionsMap,
  setTicketStatus,
  setClaimStatus,
  ticketViewers,
  kolegoveVDetailu,
  hasBranches,
  branchById,
  setMoveBranchOpen,
  onOpenCustomer,
  saveClaimChanges,
  setIsEditingClaim,
  setEditedClaim,
  startEditingClaim,
  canPrintExport,
  runClaimDocument,
  setDetailId,
  setDetailClaimId,
  setClaimHistoryModalOpen,
  setDeleteClaimId,
  setDeleteClaimDialogOpen,
  saveTicketChanges,
  setIsEditing,
  setEditedTicket,
  startEditing,
  smsAvailable,
  smsPanelOpen,
  setSmsPanelOpen,
  smsUnreadCount,
  onCreateInvoice,
  onOpenInvoice,
  invoiceIdByTicketId,
  dph,
  setTicketHistoryModalOpen,
  onNovaReklamaceZeZakazky,
  chatZapnuty,
  setDeleteTicketId,
  setDeleteDialogOpen,
  handleCloseDetail,
}: Props) {
  return (
    <div style={{ flex: "0 0 auto", display: "flex", flexDirection: isNarrow ? "column" : "row", justifyContent: "space-between", gap: isNarrow ? 10 : 12, alignItems: isNarrow ? "stretch" : "flex-start", zIndex: 5, background: "var(--panel)", padding: 18, paddingBottom: 12, borderBottom: "1px solid var(--border)" }}>
      <div style={{ minWidth: 0, paddingRight: 44 }}>
        <div style={{ fontWeight: 950, fontSize: 18, color: "var(--text)", display: "flex", alignItems: "center", gap: 8 }}>
          {/* Číslo zakázky umí i řádek seznamu, takže v hlavičce nebliká pomlčka,
              než se dotáhne zbytek sloupců. */}
          {detailedClaim ? detailedClaim.code : (otevrenaZeSeznamu?.code ?? "—")}
          <CopyButton value={detailedClaim ? detailedClaim.code : otevrenaZeSeznamu?.code} label={detailedClaim ? "číslo reklamace" : "číslo zakázky"} size={14} />
          {detailedClaim && <span style={{ fontSize: 12, padding: "4px 10px", borderRadius: 8, background: "linear-gradient(180deg, rgba(20,184,166,0.4) 0%, rgba(15,118,110,0.3) 100%)", color: "#134e4a", fontWeight: 800, border: "1px solid rgba(13,148,136,0.5)", boxShadow: "0 1px 3px rgba(0,0,0,0.08)" }}>Reklamace</span>}
          {/* Stav přímo v hlavičce – pilulka je zároveň přepínač stavu. */}
          {detailedClaim && !isEditingClaim && (
            <span onClick={(e) => e.stopPropagation()} onMouseDown={(e) => e.stopPropagation()} style={{ display: "inline-flex" }}>
              <StatusPicker value={detailedClaim.status ?? ""} statuses={statuses as any} getByKey={getByKey as any} onChange={(next) => setClaimStatus(detailedClaim.id, next)} size="sm" actionsByStatus={statusActionsMap} />
            </span>
          )}
          {!detailedClaim && detailedTicket && !isEditing && (() => {
            const detailStatus = normalizeStatus((detailedTicket.status as any) ?? statusById[detailedTicket.id]);
            if (detailStatus === null) return null;
            return (
              <span data-tour="detail-stav" onClick={(e) => e.stopPropagation()} onMouseDown={(e) => e.stopPropagation()} style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                <StatusPicker value={detailStatus} statuses={statuses as any} getByKey={getByKey as any} onChange={(next) => setTicketStatus(detailedTicket.id, next)} size="sm" actionsByStatus={statusActionsMap} />
                {isFinal(detailStatus) && <span title="Dokončená zakázka" style={{ display: "inline-flex", color: "var(--accent)" }}><CheckIcon size={14} /></span>}
              </span>
            );
          })()}
          {!detailedClaim && (() => {
            /* Bubliny (kdo má zakázku otevřenou, presence servisu) a štítek
               „Otevřeno / Upravuje“ (presence detailu, useEditaceZakazky).
               Bez kolegů se nic nevykreslí – průvodce pak ukáže kartu bez
               zvýraznění. */
            const stitek = popisKolegu(kolegoveVDetailu);
            if (ticketViewers.length === 0 && !stitek) return null;
            return (
              <span data-tour="detail-kolega" style={{ marginLeft: 4, display: "inline-flex", alignItems: "center", gap: 6 }}>
                {ticketViewers.length > 0 && <PresenceAvatars viewers={ticketViewers} />}
                {stitek && (
                  <span
                    role="status"
                    title={kolegoveVDetailu
                      .map((k) => `${k.jmeno}: ${k.upravuje ? "upravuje" : "má otevřeno"}${casHodiny(k.od) ? ` od ${casHodiny(k.od)}` : ""}`)
                      .join("\n")}
                    style={{
                      display: "inline-flex",
                      alignItems: "center",
                      padding: "3px 8px",
                      borderRadius: 999,
                      fontSize: 11,
                      fontWeight: 700,
                      whiteSpace: "nowrap",
                      border: `1px solid ${stitek.upravuje ? "var(--warning)" : "var(--border)"}`,
                      background: stitek.upravuje ? "var(--warning-soft)" : "var(--panel-2)",
                      color: stitek.upravuje ? "var(--warning-text)" : "var(--muted)",
                    }}
                  >
                    {stitek.text}
                  </span>
                )}
              </span>
            );
          })()}
          {!detailedClaim && detailedTicket && hasBranches && (() => {
            const b = branchById(detailedTicket.branchId);
            return (
              <button
                type="button"
                onClick={(e) => { e.stopPropagation(); setMoveBranchOpen(true); }}
                title="Pobočka zakázky – kliknutím přesunout"
                style={{ display: "inline-flex", alignItems: "center", gap: 4, padding: "3px 8px", borderRadius: 999, border: "1px solid var(--border)", background: "var(--panel-2)", color: "var(--muted)", fontSize: 11, fontWeight: 600, cursor: "pointer" }}
              >
                <PinIcon size={11} />
                {b?.name ?? "Bez pobočky"}
              </button>
            );
          })()}
        </div>
        <div style={{ color: "var(--muted)", marginTop: 4 }}>
          {detailedClaim ? (
            <>{detailedClaim.customer_name ?? "—"} · {formatCZ(detailedClaim.created_at)}</>
          ) : detailedTicket ? (
            <>
              <span
                onClick={() => {
                  const customerId = detailedTicket.customerId;
                  if (customerId && onOpenCustomer) {
                    onOpenCustomer(customerId);
                  }
                }}
                style={{
                  cursor: detailedTicket.customerId ? "pointer" : "default",
                  color: "var(--muted)",
                }}
                title={detailedTicket.customerId ? "Otevřít profil zákazníka" : undefined}
                onMouseEnter={(e) => {
                  if (detailedTicket.customerId) {
                    e.currentTarget.style.color = "var(--text)";
                  }
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.color = "var(--muted)";
                }}
              >
                {detailedTicket.customerName}
              </span>
              {" · "}
              {formatCZ(detailedTicket.createdAt)}
            </>
          ) : (
            "—"
          )}
        </div>
        {/* Telefon v hlavičce, ať je po ruce i po odscrollování ke komentářům. */}
        {(() => {
          const tel = detailedClaim ? detailedClaim.customer_phone : detailedTicket?.customerPhone;
          if (!tel) return null;
          return (
            <div style={{ marginTop: 2, display: "flex", alignItems: "center", gap: 6, color: "var(--muted)", fontSize: 13 }}>
              <PhoneIcon size={13} />
              <a href={`tel:${tel.replace(/\s/g, "")}`} style={{ color: "var(--text)", fontWeight: 600, textDecoration: "none" }}>
                {formatPhoneNumber(tel)}
              </a>
              <CopyButton value={tel} label="telefon" />
            </div>
          );
        })()}
      </div>

      <div style={{ display: "flex", gap: 10, alignItems: "center", /* Na mobilu se tlačítka nesmí lámat pod sebe – sloupec sežral šířku a název zakázky se zmáčkl na pár znaků. Radši jedna řada, kterou lze posunout. */ flexWrap: isNarrow ? "nowrap" : "wrap", overflowX: isNarrow ? "auto" : "visible", paddingRight: isNarrow ? 0 : 70, paddingBottom: isNarrow ? 2 : 0 }}>
        {detailedClaim ? (
          isEditingClaim ? (
            <>
              <Button variant="primary" onClick={() => saveClaimChanges().then((ok) => ok && showToast("Změny uloženy", "success"))} title="Uložit změny" icon={<SaveIcon size={16} />}>
                Uložit
              </Button>
              <Button variant="soft" onClick={() => { setIsEditingClaim(false); setEditedClaim({}); }} title="Zrušit úpravy">Zrušit</Button>
            </>
          ) : (
            <>
              <Button variant="primary" onClick={startEditingClaim} title="Upravit reklamaci" icon={<EditIcon size={16} />}>
                Upravit
              </Button>
              {canPrintExport && (
                <PrintMenu
                  rows={[
                    {
                      key: "prijemka_reklamace",
                      label: "Přijetí reklamace",
                      icon: <DocumentIcon size={14} />,
                      onPrint: () => runClaimDocument("print"),
                      onExport: () => runClaimDocument("export"),
                    },
                  ]}
                />
              )}
              {detailedClaim.source_ticket_id && (
                <Button
                  variant="soft"
                  onClick={() => { setDetailId(detailedClaim.source_ticket_id!); setDetailClaimId(null); }}
                  title="Otevřít původní zakázku"
                  icon={<LinkIcon size={14} />}
                >
                  Otevřít zakázku
                </Button>
              )}
              <OverflowMenu
                ariaLabel="Další akce"
                items={[
                  { label: "Historie", icon: <HistoryIcon size={14} />, onSelect: () => setClaimHistoryModalOpen(true) },
                  {
                    label: "Smazat reklamaci",
                    icon: <TrashIcon size={14} />,
                    danger: true,
                    dividerBefore: true,
                    onSelect: () => { setDeleteClaimId(detailedClaim.id); setDeleteClaimDialogOpen(true); },
                  },
                ]}
              />
            </>
          )
        ) : isEditing ? (
          <>
            <Button variant="primary" onClick={saveTicketChanges} title="Uložit změny" icon={<SaveIcon size={16} />}>
              Uložit
            </Button>
            <Button
              variant="soft"
              onClick={() => {
                setIsEditing(false);
                setEditedTicket({});
              }}
              title="Zrušit úpravy"
            >
              Zrušit
            </Button>
          </>
        ) : (
          <>
            <Button variant="primary" onClick={startEditing} title="Upravit zakázku" data-tour="detail-upravit" icon={<EditIcon size={16} />}>
              Upravit
            </Button>

            {detailedTicket && canPrintExport && (
              <PrintMenu
                dataTour="detail-tisk"
                rows={[
                  {
                    key: "ticket",
                    label: "Zakázkový list",
                    icon: <DocumentIcon size={14} />,
                    onPrint: () => { printTicket(detailedTicket, activeServiceId); },
                    onExport: () => { exportTicketToPDF(detailedTicket, activeServiceId); },
                  },
                  ...((detailedTicket.diagnosticText || (detailedTicket.diagnosticPhotos && detailedTicket.diagnosticPhotos.length > 0))
                    ? [{
                        key: "diagnostic",
                        label: "Diagnostický protokol",
                        icon: <SearchIcon size={14} />,
                        onPrint: () => { printDiagnosticProtocol(detailedTicket, activeServiceId); },
                        onExport: () => { exportDiagnosticProtocolToPDF(detailedTicket, activeServiceId); },
                      }]
                    : []),
                  {
                    key: "warranty",
                    label: "Záruční list",
                    icon: <DocumentIcon size={14} />,
                    onPrint: () => { printWarranty(detailedTicket, activeServiceId); },
                    onExport: () => { exportWarrantyToPDF(detailedTicket, activeServiceId); },
                  },
                  ...(detailedTicket.loaner
                    ? [{
                        key: "zapujcka",
                        label: "Smlouva o zápůjčce",
                        icon: <DeviceIcon size={14} />,
                        onPrint: () => { printZapujcku(detailedTicket, activeServiceId); },
                        onExport: () => { exportZapujckuToPDF(detailedTicket, activeServiceId); },
                      }]
                    : []),
                ]}
              />
            )}

            {detailedTicket && smsAvailable && (
              <Button variant="soft"
                onClick={() => { setSmsPanelOpen(true); }} style={{ position: "relative" }}
                title="SMS chat se zákazníkem"
                data-tour="detail-sms"
                icon={<ChatIcon size={16} />}
              >
                SMS
                {smsUnreadCount > 0 && !smsPanelOpen && (
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
                    }}
                  >
                    {smsUnreadCount > 99 ? "99+" : smsUnreadCount}
                  </span>
                )}
              </Button>
            )}

            {detailedTicket && (onCreateInvoice || onOpenInvoice) && (() => {
              const existingInvoiceId = invoiceIdByTicketId[detailedTicket.id];
              return existingInvoiceId && onOpenInvoice ? (
                <Button
                  key="open-invoice"
                  variant="soft"
                  onClick={() => onOpenInvoice(existingInvoiceId)}
                  title="Otevřít fakturu k této zakázce"
                  icon={<CoinsIcon size={14} />}
                >
                  Přejít na fakturu
                </Button>
              ) : onCreateInvoice ? (
                <span id="detail-vystavit-fakturu" style={{ display: "contents" }}>
                <Button data-tour="detail-vystavit-fakturu" variant="soft"
                  key="create-invoice"
                  onClick={() => {
                    const t = detailedTicket;
                    const repairs = (t.performedRepairs || []).filter((r) => r.name);
                    onCreateInvoice({
                      ticketId: t.id,
                      customerId: t.customerId || undefined,
                      customerName: t.customerName || t.customerCompany || undefined,
                      customerEmail: t.customerEmail || undefined,
                      customerPhone: t.customerPhone || undefined,
                      customerIco: t.customerIco || undefined,
                      customerAddress: [t.customerAddressStreet, t.customerAddressCity, t.customerAddressZip].filter(Boolean).join(", ") || undefined,
                      branchId: t.branchId ?? null,
                      items: repairs.length > 0 ? repairs.map((r) => ({
                        // Hodinová práce jde na fakturu jako hodiny × sazba, ne 1 ks.
                        name: r.type === "hourly" && r.technik ? `${r.name} (${r.technik})` : r.name,
                        qty: r.type === "hourly" && (r.hodiny ?? 0) > 0 ? r.hodiny! : 1,
                        unit: r.type === "hourly" ? "h" : "ks",
                        unit_price: r.type === "hourly" && (r.hodiny ?? 0) > 0 ? (r.sazba ?? 0) : (r.price ?? 0),
                        // Neplátce DPH má 0; dřív tu bylo napevno 21 %.
                        vat_rate: sazbaProNovouPolozku(dph),
                      })) : undefined,
                    });
                  }}
                  title="Vytvořit fakturu z této zakázky"
                  icon={<CoinsIcon size={14} />}
                >
                  Vystavit fakturu
                </Button>
                </span>
              ) : null;
            })()}

            {detailedTicket && (
              <OverflowMenu
                ariaLabel="Další akce"
                items={[
                  { label: "Historie", icon: <HistoryIcon size={14} />, onSelect: () => setTicketHistoryModalOpen(true) },
                  {
                    label: "Založit reklamaci z této zakázky",
                    icon: <InboxIcon size={14} />,
                    onSelect: () => onNovaReklamaceZeZakazky(detailedTicket),
                  },
                  ...(hasBranches ? [{ label: "Přesunout na pobočku…", icon: <PinIcon size={14} />, onSelect: () => setMoveBranchOpen(true) }] : []),
                  // Karta zakázky do chatu místo opisování čísla – nejčastější důvod, proč si lidé v servisu píšou.
                  ...(chatZapnuty ? [{
                    label: "Sdílet do chatu",
                    icon: <ChatIcon size={14} />,
                    onSelect: () => {
                      const kod = detailedTicket.code || "";
                      window.dispatchEvent(new CustomEvent("jobi:chat-otevrit", {
                        detail: {
                          text: `#${kod} – ${detailedTicket.deviceLabel || "zakázka"}, ${detailedTicket.customerName || ""} `,
                          zminka: { typ: "zakazka", id: detailedTicket.id, popis: kod },
                        },
                      }));
                    },
                  }] : []),
                  {
                    label: "Smazat zakázku",
                    icon: <TrashIcon size={14} />,
                    danger: true,
                    dividerBefore: true,
                    onSelect: () => {
                      setDeleteTicketId(detailedTicket.id);
                      setDeleteDialogOpen(true);
                    },
                  },
                ]}
              />
            )}
          </>
        )}
      </div>

      {/* Close button - uvnitř náhledu, s odsazením aby nezasahoval mimo */}
      <Button variant="soft"
        onClick={handleCloseDetail} style={{ position: "absolute", top: 10, right: 10, zIndex: 2 }}
        aria-label="Zavřít"
      >
        ×
      </Button>
    </div>
  );
}
