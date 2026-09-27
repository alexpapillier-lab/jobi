/**
 * Obal detailu zakázky / reklamace: portál do body s pozadím, panel
 * (vystředěný okraji, viz komentář uvnitř) a posuvné tělo. Obsah přichází
 * jako sloty z kontejneru (Orders.tsx), aby props jednotlivých karet zůstaly
 * u stavu, který je řídí:
 *   hlavicka   – DetailHlavicka
 *   reklamace  – DetailReklamace (jen když je otevřená reklamace)
 *   prehled    – DetailPrehled (náhled zakázky mimo úpravy)
 *   uprava     – UpravaZakazky (režim úprav)
 *   dalsiKarty – DetailDalsiKarty (opravy, portál, diagnostika, …)
 *   komentare  – TicketComments
 *   smsPanel   – SmsPanel
 *
 * Panel je vždy namontovaný (jen se skrývá), stejně jako dřív v Orders.tsx.
 * Vyneseno beze změny obsahu.
 */
import type React from "react";
import { createPortal } from "react-dom";
import { Button } from "../../components/ui";
import type { WarrantyClaimRow } from "./hooks/useWarrantyClaims";
import type { TicketEx } from "./typy";
import { border, card } from "./styly";

type Props = {
  detailId: string | null;
  detailClaimId: string | null;
  detailedTicket: TicketEx | undefined;
  detailedClaim: WarrantyClaimRow | undefined;
  /** Zakázku ze seznamu známe, ale chybí jí sloupce detailu – dotahuje se. */
  detailSeNacita: boolean;
  /** Zakázka, které se nepovedlo dotáhnout zbytek sloupců. */
  nedotazenaZakazka: string | null;
  setNedotazenaZakazka: React.Dispatch<React.SetStateAction<string | null>>;
  zajistiPlnouZakazku: (ticketId: string) => Promise<TicketEx | null>;
  isEditing: boolean;
  handleCloseDetail: () => Promise<void>;
  hlavicka: React.ReactNode;
  reklamace: React.ReactNode;
  prehled: React.ReactNode;
  uprava: React.ReactNode;
  dalsiKarty: React.ReactNode;
  komentare: React.ReactNode;
  smsPanel: React.ReactNode;
};

export function DetailZakazky({
  detailId,
  detailClaimId,
  detailedTicket,
  detailedClaim,
  detailSeNacita,
  nedotazenaZakazka,
  setNedotazenaZakazka,
  zajistiPlnouZakazku,
  isEditing,
  handleCloseDetail,
  hlavicka,
  reklamace,
  prehled,
  uprava,
  dalsiKarty,
  komentare,
  smsPanel,
}: Props) {
  return createPortal(
    <>
      <div
        onClick={handleCloseDetail}
        style={{
          position: "fixed",
          inset: 0,
          background: "rgba(0,0,0,0.42)",
          opacity: (detailId || detailClaimId) ? 1 : 0,
          pointerEvents: (detailId || detailClaimId) ? "auto" : "none",
          transition: "opacity 160ms ease",
          zIndex: 1200,
        }}
      />

      <div
    // Rozdělaná práce: tichá obnova webu (lib/aktualizaceWebu) čeká, dokud je detail otevřený.
    data-jobi-rozdelano={(detailId || detailClaimId) ? "" : undefined}
    style={{
      position: "fixed",
      /* Vystředění okraji, ne translate(-50%, -50%): posun o půlku
         vlastní výšky vychází na půl pixelu a WebKit (desktopová appka,
         Safari) pak při posouvání obsahu překreslí celou vrstvu jako
         bitmapu mimo mřížku – hlavička s číslem zakázky se rozmazala.
         Otevřený panel proto nemá žádný transform ani will-change. */
      inset: 0,
      margin: "auto",
      height: "fit-content",
      transform: (detailId || detailClaimId) ? "none" : "translateY(2%) scale(0.99)",
      opacity: (detailId || detailClaimId) ? 1 : 0,
      pointerEvents: (detailId || detailClaimId) ? "auto" : "none",
      transition: "transform 160ms ease, opacity 160ms ease",
      width: 1080,
      maxWidth: "calc(100vw - 24px)",
      maxHeight: "calc(100dvh / var(--ui-scale, 1) - 24px)",
      display: "flex",
      flexDirection: "column",
      overflow: "hidden",
      background: "var(--panel)",
      backdropFilter: "var(--blur)",
      WebkitBackdropFilter: "var(--blur)",
      border,
      borderRadius: "var(--radius-lg)",
      boxShadow: "var(--shadow)",
      padding: 0,
      zIndex: 1210,
      fontFamily: "system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif",
    }}
    onClick={(e) => e.stopPropagation()}
  >
    {hlavicka}

    <div style={{ flex: 1, minHeight: 0, overflow: "auto", padding: 18 }}>
    {reklamace}
    {/* Zbytek sloupců zakázky se dotahuje jedním dotazem podle `id`.
        Trvá to desítky milisekund, ale prázdné okno by v tu chvíli vypadalo
        jako chyba. */}
    {detailSeNacita && !detailedClaim && (
      <div data-detail-nacita style={{ ...card, marginTop: 16, color: "var(--muted)", fontSize: 13, display: "flex", alignItems: "center", gap: 10 }}>
        {nedotazenaZakazka === detailId ? (
          <>
            <span>Zakázku se nepodařilo načíst – zkontrolujte připojení.</span>
            <Button variant="soft" onClick={() => { setNedotazenaZakazka(null); void zajistiPlnouZakazku(detailId!); }}>Zkusit znovu</Button>
          </>
        ) : (
          <span>Načítám zakázku…</span>
        )}
      </div>
    )}
    {detailedTicket && (
      <>
        {!isEditing ? prehled : uprava}

        {!isEditing && dalsiKarty}
        {komentare}
      </>
    )}
    </div>
  </div>

      {smsPanel}
    </>,
    document.body
  );
}
