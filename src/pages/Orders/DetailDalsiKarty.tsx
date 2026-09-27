/**
 * Karty detailu zakázky mimo úpravy: dodatečné informace o zákazníkovi,
 * technické detaily, [Provedené opravy – slot], zákaznický portál,
 * [Diagnostika – slot], Kde je zakázka, náhradní zařízení, technik,
 * čas na opravě a kontrola po opravě.
 *
 * Vyneseno z Orders.tsx beze změny obsahu. Opravy a diagnostika přicházejí
 * jako hotové prvky (sloty), aby jejich props zůstaly u stavu v kontejneru.
 */
import type React from "react";
import { SectionHeading } from "../../components/SectionHeading";
import { CheckIcon, DeviceIcon, HistoryIcon, InboxIcon, LinkIcon, OutboxIcon, PinIcon, UserIcon } from "../../components/icons";
import { PortalCard } from "../../components/orders/PortalCard";
import { KdeJeZakazka } from "../../components/orders/KdeJeZakazka";
import { ZapujckaKarta } from "../../components/orders/ZapujckaKarta";
import { TechnikZakazky } from "../../components/orders/TechnikZakazky";
import { CasNaOprave } from "../../components/orders/CasNaOprave";
import { KontrolaPoOprave } from "../../components/orders/KontrolaPoOprave";
import type { PerformedRepair } from "../../components/orders/types";
import type { ClenServisu } from "../../hooks/useClenoveServisu";
import { BARVA_SEKCE, stylSekce, type SkrytelnaSekce } from "../../lib/sekceDetailu";
import { dniBezZmenyJinde, type NastaveniZasilek, type Zasilka } from "../../lib/zasilky";
import type { Branch } from "../../lib/branches";
import type { DeviceRepair } from "../../lib/catalogStorage";
import type { NahradniZarizeni, ZapujckaData } from "../../lib/zapujcka";
import type { KontrolaPoOpraveData, SablonaKontroly } from "../../lib/kontrolniSeznamy";
import type { NovaProvedenaOprava, TicketEx } from "./typy";
import { printZapujcku } from "./tiskZakazky";
import { card } from "./styly";

type Props = {
  detailedTicket: TicketEx;
  activeServiceId: string | null;
  skryteSekce: Set<SkrytelnaSekce>;
  /** Slot: karta Provedené opravy (DetailOpravy). */
  opravy: React.ReactNode;
  /** Slot: karta Diagnostika (DetailDiagnostika). */
  diagnostika: React.ReactNode;
  smsAvailable: boolean;
  availableRepairs: DeviceRepair[];
  applyQuoteRepairs: (ticketId: string, repairs: PerformedRepair[]) => Promise<void>;
  setCloudTickets: React.Dispatch<React.SetStateAction<TicketEx[]>>;
  detailPortalOpen: boolean;
  prepnoutDetailPortal: () => void;
  zasilkyZapnuty: boolean;
  hasBranches: boolean;
  branches: Branch[];
  branchById: (id: string | null | undefined) => Branch | null;
  setHistorieZasilek: React.Dispatch<React.SetStateAction<{ ticketId: string; zasilky: Zasilka[] } | null>>;
  nastaveniZasilek: NastaveniZasilek;
  ulozZapujcku: (ticketId: string, zapujcka: ZapujckaData | null) => Promise<void>;
  nahradniZarizeni: NahradniZarizeni[];
  /** Náhradní zařízení právě půjčená na jiných zakázkách. */
  pujceneKusy: { id: string; code: string | null; katalogId: string }[];
  pridelovaniTechnika: boolean;
  clenoveServisu: ClenServisu[];
  ulozTechnika: (ticketId: string, userId: string | null) => Promise<void>;
  casNaOpraveZapnuto: boolean;
  currentUserId: string | undefined;
  currentUserNickname: string | null | undefined;
  hodinovaSazba: number | null;
  zaokrouhleniPrace: number;
  addPerformedRepair: (ticketId: string, repair: NovaProvedenaOprava) => void;
  kontrolniSeznamy: SablonaKontroly[];
  ulozKontrolu: (ticketId: string, kontrola: KontrolaPoOpraveData | null) => Promise<void>;
};

export function DetailDalsiKarty({
  detailedTicket,
  activeServiceId,
  skryteSekce,
  opravy,
  diagnostika,
  smsAvailable,
  availableRepairs,
  applyQuoteRepairs,
  setCloudTickets,
  detailPortalOpen,
  prepnoutDetailPortal,
  zasilkyZapnuty,
  hasBranches,
  branches,
  branchById,
  setHistorieZasilek,
  nastaveniZasilek,
  ulozZapujcku,
  nahradniZarizeni,
  pujceneKusy,
  pridelovaniTechnika,
  clenoveServisu,
  ulozTechnika,
  casNaOpraveZapnuto,
  currentUserId,
  currentUserNickname,
  hodinovaSazba,
  zaokrouhleniPrace,
  addPerformedRepair,
  kontrolniSeznamy,
  ulozKontrolu,
}: Props) {
  return (
    <>
      {/* Stav zakázky je v hlavičce (pilulka = přepínač), tady už se neopakuje. */}
      <div style={{ marginTop: 20, display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 240px), 1fr))", gap: 16 }}>
        {(detailedTicket.customerCompany || detailedTicket.customerIco || detailedTicket.customerInfo) && (
        <div style={{ ...card, opacity: 0.85 }}>
          <SectionHeading size="sm">Dodatečné informace o zákazníkovi</SectionHeading>
          <div style={{ display: "grid", gap: 6, fontSize: 13 }}>
            {detailedTicket.customerCompany && (
              <div>
                <span style={{ color: "var(--muted)" }}>Firma:</span> {detailedTicket.customerCompany}
              </div>
            )}
            {detailedTicket.customerIco && (
              <div>
                <span style={{ color: "var(--muted)" }}>IČO:</span> {detailedTicket.customerIco}
              </div>
            )}
            {detailedTicket.customerInfo && (
              <div
                style={{
                  marginTop: 6,
                  padding: 10,
                  borderRadius: 10,
                  background: "var(--panel-2)",
                  color: "var(--text)",
                  fontSize: 12,
                  lineHeight: 1.5,
                }}
              >
                {detailedTicket.customerInfo}
              </div>
            )}
          </div>
        </div>
        )}

        <div style={{ ...card, opacity: 0.85 }}>
          <SectionHeading size="sm">Technické detaily</SectionHeading>
          <div style={{ display: "grid", gap: 6, fontSize: 13 }}>
            {detailedTicket.devicePasscode && (
              <div>
                <span style={{ color: "var(--muted)" }}>Heslo/kód:</span> {detailedTicket.devicePasscode}
              </div>
            )}
            {detailedTicket.deviceCondition && (
              <div style={{ marginTop: 4 }}>
                <div style={{ color: "var(--muted)", marginBottom: 4 }}>Popis stavu:</div>
                <div style={{ padding: 8, borderRadius: 8, background: "var(--panel-2)", fontSize: 12, lineHeight: 1.4 }}>
                  {detailedTicket.deviceCondition}
                </div>
              </div>
            )}
            {detailedTicket.deviceAccessories && (
              <div style={{ marginTop: 4 }}>
                <div style={{ color: "var(--muted)", marginBottom: 4 }}>Příslušenství:</div>
                <div style={{ padding: 8, borderRadius: 8, background: "var(--panel-2)", fontSize: 12, lineHeight: 1.4 }}>
                  {detailedTicket.deviceAccessories}
                </div>
              </div>
            )}
            {detailedTicket.deviceNote && (
              <div style={{ marginTop: 4 }}>
                <div style={{ color: "var(--muted)", marginBottom: 4 }}>Poznámka:</div>
                <div style={{ padding: 8, borderRadius: 8, background: "var(--panel-2)", fontSize: 12, lineHeight: 1.4 }}>
                  {detailedTicket.deviceNote}
                </div>
              </div>
            )}
            <div style={{ marginTop: 6, display: "flex", gap: 8, flexWrap: "wrap" }}>
              {detailedTicket.handoffMethod && (
                <div style={{ fontSize: 12, color: "var(--muted)" }}>
                  <InboxIcon size={14} /> Převzetí: {detailedTicket.handoffMethod}
                </div>
              )}
              {detailedTicket.handbackMethod && (
                <div style={{ fontSize: 12, color: "var(--muted)" }}>
                  <OutboxIcon size={14} /> Předání: {detailedTicket.handbackMethod}
                </div>
              )}
              {detailedTicket.externalId && (
                <div style={{ fontSize: 12, color: "var(--muted)" }}>
                  <LinkIcon size={14} /> Ext: {detailedTicket.externalId}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {opravy}

      {activeServiceId && !skryteSekce.has("portal") && (
        <div id="detail-portal" data-tour="detail-portal">
        <PortalCard
          key={detailedTicket.id}
          ticket={detailedTicket}
          serviceId={activeServiceId}
          smsAvailable={smsAvailable}
          availableRepairs={availableRepairs}
          onQuoteApprovedRepairs={applyQuoteRepairs}
          style={{ marginTop: 16, ...stylSekce("portal") }}
          barva={BARVA_SEKCE.portal}
          onFieldsChange={(ticketId, fields) =>
            setCloudTickets((prev) => prev.map((t) => (t.id === ticketId ? { ...t, ...fields } : t)))
          }
          otevreno={detailPortalOpen}
          onToggle={prepnoutDetailPortal}
        />
        </div>
      )}

      {diagnostika}

      {zasilkyZapnuty && hasBranches && activeServiceId && (
        <div id="detail-presun" style={{ ...card, ...stylSekce("presun"), marginTop: 16 }}>
          <SectionHeading icon={<PinIcon size={16} />} barva={BARVA_SEKCE.presun}>Kde je zakázka</SectionHeading>
          <KdeJeZakazka
            key={detailedTicket.id}
            ticket={detailedTicket}
            serviceId={activeServiceId}
            branches={branches}
            nazevPobocky={(id) => branchById(id)?.name ?? "jiná pobočka"}
            onOtevritZasilky={() => window.dispatchEvent(new CustomEvent("jobsheet:navigate", { detail: { page: "zasilky" } }))}
            onHistorie={(zasilky) => setHistorieZasilek({ ticketId: detailedTicket.id, zasilky })}
            dniBezZmeny={dniBezZmenyJinde(detailedTicket, nastaveniZasilek.upozorneniDni)}
          />
        </div>
      )}

      {!skryteSekce.has("nahradni") && (
      <div id="detail-zapujcka" style={{ ...card, ...stylSekce("nahradni"), marginTop: 16 }}>
        <SectionHeading icon={<DeviceIcon size={16} />} barva={BARVA_SEKCE.nahradni}>Náhradní zařízení</SectionHeading>
        <ZapujckaKarta
          zapujcka={detailedTicket.loaner}
          onChange={(z) => void ulozZapujcku(detailedTicket.id, z)}
          onTisk={() => void printZapujcku(detailedTicket, activeServiceId)}
          katalog={nahradniZarizeni}
          branchId={hasBranches ? detailedTicket.branchId ?? null : null}
          nazevPobocky={(id) => branchById(id)?.name ?? "jiná pobočka"}
          pujcenaJinde={(() => {
            // Které zařízení je právě u jiného zákazníka (viz pujceneKusy).
            const out: Record<string, string> = {};
            for (const p of pujceneKusy) {
              if (p.id === detailedTicket.id) continue;
              out[p.katalogId] = p.code ?? "jiná zakázka";
            }
            return out;
          })()}
        />
      </div>
      )}

      {pridelovaniTechnika && (
        <div id="detail-technik" data-tour="detail-technik" style={{ ...card, ...stylSekce("technik"), marginTop: 16 }}>
          <SectionHeading icon={<UserIcon size={16} />} barva={BARVA_SEKCE.technik}>Technik</SectionHeading>
          <TechnikZakazky
            clenove={clenoveServisu}
            hodnota={detailedTicket.assignedTo}
            jaId={currentUserId ?? null}
            onChange={(userId) => void ulozTechnika(detailedTicket.id, userId)}
          />
        </div>
      )}

      {casNaOpraveZapnuto && activeServiceId && (
        <div id="detail-cas" data-tour="detail-cas" style={{ ...card, ...stylSekce("cas"), marginTop: 16 }}>
          <SectionHeading icon={<HistoryIcon size={16} />} barva={BARVA_SEKCE.cas}>Čas na opravě</SectionHeading>
          <CasNaOprave
            serviceId={activeServiceId}
            ticketId={detailedTicket.id}
            userId={currentUserId ?? null}
            jmena={currentUserId && currentUserNickname ? { [currentUserId]: currentUserNickname } : {}}
            sazba={hodinovaSazba}
            zaokrouhleniMinut={zaokrouhleniPrace}
            uzPridano={(detailedTicket.performedRepairs ?? []).some((r) => r.type === "hourly" && r.zMereni)}
            onPridatHodinovouPraci={(prace) => addPerformedRepair(detailedTicket.id, { name: "Práce technika", type: "hourly", zMereni: true, ...prace })}
          />
        </div>
      )}

      {!skryteSekce.has("kontrola") && (
      <div id="detail-kontrola" data-tour="detail-kontrola" style={{ ...card, ...stylSekce("kontrola"), marginTop: 16 }}>
        <SectionHeading icon={<CheckIcon size={16} />} barva={BARVA_SEKCE.kontrola}>Kontrola po opravě</SectionHeading>
        <KontrolaPoOprave
          kontrola={detailedTicket.testChecklist}
          sablony={kontrolniSeznamy}
          nazevZarizeni={detailedTicket.deviceLabel}
          onChange={(k) => void ulozKontrolu(detailedTicket.id, k)}
        />
      </div>
      )}
    </>
  );
}
