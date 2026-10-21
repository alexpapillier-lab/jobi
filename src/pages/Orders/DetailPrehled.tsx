/**
 * Náhled zakázky (mimo úpravy): asistent postupu, karta Zákazník, reklamace
 * k této zakázce a karta Zařízení (záruka, Find My, historie zařízení,
 * požadovaná oprava). Vyneseno z Orders.tsx beze změny obsahu.
 */
import type React from "react";
import { SectionHeading } from "../../components/SectionHeading";
import { CopyButton } from "../../components/CopyButton";
import { DeviceIcon, HashIcon, MailIcon, PhoneIcon, PinIcon, UserIcon, WrenchIcon } from "../../components/icons";
import { formatCZ } from "../../components/tickets";
import { formatCZDate } from "../../components/tickets/types";
import { PostupZakazky, sjetNaKartu } from "../../components/orders/PostupZakazky";
import { shrnutiKontroly } from "../../lib/kontrolniSeznamy";
import { krokyPresunu, type NastaveniZasilek, type Zasilka } from "../../lib/zasilky";
import { BARVA_SEKCE, stylSekce, type SkrytelnaSekce } from "../../lib/sekceDetailu";
import { najdiStejneZarizeni } from "../../lib/zarizeniHistorie";
import type { Branch } from "../../lib/branches";
import type { StatusMeta } from "../../state/StatusesStore";
import type { WarrantyClaimRow } from "./hooks/useWarrantyClaims";
import type { TicketEx } from "./typy";
import { skrytPostupZakazky } from "./uiConfig";
import { formatPhoneNumber } from "./formatovani";
import { card } from "./styly";
import { stavZarukyOpravy, textZarukyOpravy } from "../../lib/zarukaOpravy";
import { formatCurrency } from "../../lib/invoiceMath";

type Props = {
  detailedTicket: TicketEx;
  /** Asistent postupu zapnutý (uiCfg.app.postupZakazky). */
  postupZakazky: boolean | undefined;
  invoiceIdByTicketId: Record<string, string>;
  isFinal: (key: string) => boolean;
  getByKey: (key: string) => StatusMeta | undefined;
  zasilkyZapnuty: boolean;
  hasBranches: boolean;
  nastaveniZasilek: NastaveniZasilek;
  historieZasilek: { ticketId: string; zasilky: Zasilka[] } | null;
  branchById: (id: string | null | undefined) => Branch | null;
  skryteSekce: Set<SkrytelnaSekce>;
  sjetNaSbalenouKartu: (id: "detail-portal" | "detail-diagnostika") => void;
  onOpenCustomer?: (customerId: string) => void;
  cloudClaims: WarrantyClaimRow[];
  cloudTickets: TicketEx[];
  setDetailId: React.Dispatch<React.SetStateAction<string | null>>;
  setDetailClaimId: React.Dispatch<React.SetStateAction<string | null>>;
};

export function DetailPrehled({
  detailedTicket,
  postupZakazky,
  invoiceIdByTicketId,
  isFinal,
  getByKey,
  zasilkyZapnuty,
  hasBranches,
  nastaveniZasilek,
  historieZasilek,
  branchById,
  skryteSekce,
  sjetNaSbalenouKartu,
  onOpenCustomer,
  cloudClaims,
  cloudTickets,
  setDetailId,
  setDetailClaimId,
}: Props) {
  return (
    <>
      {/* Kde zakázka je a co je na řadě. Kroky se čtou z dat, nic se neukládá.
          Zkušený člověk si řádek skryje křížkem nebo v Nastavení → Rozhraní. */}
      {postupZakazky !== false && (() => {
        const t = detailedTicket;
        const maFotky = (t.diagnosticPhotosBefore?.length ?? 0) + (t.diagnosticPhotos?.length ?? 0) > 0;
        const maOpravy = (t.performedRepairs ?? []).some((r) => !!r.name);
        const nabidka = t.quoteStatus ?? "none";
        const maFakturu = !!invoiceIdByTicketId[t.id];
        const hotovo = isFinal(t.status);
        /* Kroky přesunu (zásilky mezi pobočkami): jen když zakázka někam
           jela nebo je v konceptu; opravená doma je nedostane. */
        const presun = zasilkyZapnuty && hasBranches && nastaveniZasilek.postup
          ? krokyPresunu(t, historieZasilek?.ticketId === t.id ? historieZasilek.zasilky : [], (id) => branchById(id)?.name ?? "jiná pobočka", maOpravy || hotovo)
          : { predOpravou: [], poOprave: [] };
        const krokPresunu = (k: (typeof presun.predOpravou)[number]) => ({
          id: k.id,
          label: k.label,
          hotovo: k.hotovo,
          poznamka: k.poznamka,
          akce: k.akce ? "Přidat do zásilky" : undefined,
          onAkce: k.akce ? () => sjetNaKartu("detail-presun") : undefined,
        });
        return (
          <div style={{ marginTop: 16 }}>
            <PostupZakazky
              onSkryt={skrytPostupZakazky}
              kroky={[
                { id: "prijato", label: "Přijato", hotovo: true },
                { id: "fotky", label: "Fotky při převzetí", hotovo: maFotky, volitelny: true, akce: "Přejít na fotky", onAkce: () => sjetNaSbalenouKartu("detail-diagnostika") },
                ...presun.predOpravou.map(krokPresunu),
                { id: "opravy", label: "Opravy a cena", hotovo: maOpravy, akce: "Přejít na opravy", onAkce: () => sjetNaKartu("detail-opravy") },
                /* Vypnutá sekce (Nastavení → Detail zakázky) nemá v postupu co nabízet. */
                ...(skryteSekce.has("kontrola") ? [] : [
                  { id: "kontrola", label: "Kontrola po opravě", hotovo: shrnutiKontroly(t.testChecklist).dokonceno, volitelny: true, akce: "Přejít na kontrolu", onAkce: () => sjetNaKartu("detail-kontrola") },
                ]),
                ...(skryteSekce.has("portal") ? [] : [{
                  id: "nabidka",
                  label: "Nabídka zákazníkovi",
                  hotovo: nabidka === "approved",
                  volitelny: true,
                  akce: nabidka === "sent" ? undefined : "Přejít na nabídku",
                  onAkce: nabidka === "sent" ? undefined : () => sjetNaSbalenouKartu("detail-portal"),
                  poznamka: nabidka === "sent" ? "Čeká na schválení zákazníkem" : undefined,
                }]),
                ...presun.poOprave.map(krokPresunu),
                {
                  id: "faktura",
                  label: "Faktura",
                  hotovo: maFakturu,
                  volitelny: true,
                  akce: "Vystavit fakturu",
                  onAkce: () => document.getElementById("detail-vystavit-fakturu")?.querySelector("button")?.click(),
                },
                { id: "hotovo", label: "Dokončeno a předáno", hotovo, poznamka: "Přepněte stav v hlavičce, až bude oprava hotová" },
              ]}
            />
          </div>
        );
      })()}
      <div style={{ marginTop: 20, display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 240px), 1fr))", gap: 16 }}>
        <div style={{ ...card, ...stylSekce("zakaznik") }}>
          <SectionHeading icon={<UserIcon size={16} />} barva={BARVA_SEKCE.zakaznik}>Zákazník</SectionHeading>
          <div style={{ display: "grid", gap: 8 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 6, minWidth: 0 }}>
            <div
              onClick={() => {
                const customerId = detailedTicket.customerId;
                if (customerId && onOpenCustomer) {
                  onOpenCustomer(customerId);
                }
              }}
              style={{
                fontSize: 15,
                fontWeight: 800,
                color: "var(--text)",
                cursor: detailedTicket.customerId ? "pointer" : "default",
              }}
              title={detailedTicket.customerId ? "Otevřít profil zákazníka" : undefined}
              onMouseEnter={(e) => {
                if (detailedTicket.customerId) {
                  e.currentTarget.style.opacity = "0.8";
                }
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.opacity = "1";
              }}
            >
              {detailedTicket.customerName}
            </div>
            <CopyButton value={detailedTicket.customerName} label="jméno" />
            </div>
            {detailedTicket.customerPhone && (
              <div style={{ fontSize: 13, color: "var(--text)", display: "flex", alignItems: "center", gap: 6 }}>
                <PhoneIcon size={14} />
                <span>{formatPhoneNumber(detailedTicket.customerPhone)}</span>
                <CopyButton value={detailedTicket.customerPhone} label="telefon" />
              </div>
            )}
            {detailedTicket.customerEmail && (
              <div style={{ fontSize: 13, color: "var(--text)", display: "flex", alignItems: "center", gap: 6 }}>
                <MailIcon size={14} />
                <span>{detailedTicket.customerEmail}</span>
                <CopyButton value={detailedTicket.customerEmail} label="e-mail" />
              </div>
            )}
            {[detailedTicket.customerAddressStreet, detailedTicket.customerAddressCity, detailedTicket.customerAddressZip].filter(Boolean).length >
              0 && (
              <div style={{ fontSize: 13, color: "var(--text)", display: "flex", alignItems: "center", gap: 6, marginTop: 4 }}>
                <PinIcon size={14} />
                <span>
                  {[detailedTicket.customerAddressStreet, detailedTicket.customerAddressCity, detailedTicket.customerAddressZip]
                    .filter(Boolean)
                    .join(", ")}
                </span>
                <CopyButton
                  value={[detailedTicket.customerAddressStreet, detailedTicket.customerAddressCity, detailedTicket.customerAddressZip].filter(Boolean).join(", ")}
                  label="adresu"
                />
              </div>
            )}
          </div>
        </div>

        <div style={{ ...card, ...stylSekce("zarizeni") }}>
          <SectionHeading icon={<DeviceIcon size={16} />} barva={BARVA_SEKCE.zarizeni}>Zařízení</SectionHeading>
          <div style={{ display: "grid", gap: 8 }}>
            <div style={{ fontSize: 15, fontWeight: 800, color: "var(--text)", display: "flex", alignItems: "center", gap: 6 }}>
              <span>{detailedTicket.deviceLabel}</span>
              <CopyButton value={detailedTicket.deviceLabel} label="název zařízení" />
            </div>
            {detailedTicket.serialOrImei && (
              <div style={{ fontSize: 13, color: "var(--text)", display: "flex", alignItems: "center", gap: 6 }}>
                <HashIcon size={14} />
                <span>SN: {detailedTicket.serialOrImei}</span>
                <CopyButton value={detailedTicket.serialOrImei} label="sériové číslo" />
              </div>
            )}
            {/* Záruka z příjmu; u starších zakázek (null) se řádek nevykreslí. */}
            {detailedTicket.warrantyClaim != null && (
              <div style={{ fontSize: 13, color: "var(--text)", display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                <span style={{ fontWeight: 600 }}>{detailedTicket.warrantyClaim ? "Záruční oprava" : "Pozáruční oprava"}</span>
                {detailedTicket.warrantyClaim && detailedTicket.purchaseDate && <span style={{ color: "var(--muted)" }}>· nákup {formatCZDate(detailedTicket.purchaseDate)}</span>}
                {detailedTicket.warrantyClaim && detailedTicket.purchaseProof && <span style={{ color: "var(--muted)" }}>· doklad: {detailedTicket.purchaseProof}</span>}
              </div>
            )}
            {/* Záruka na provedenou opravu – datum zapisuje databáze při vydání. */}
            {(() => {
              const zaruka = stavZarukyOpravy(detailedTicket.warrantyUntil);
              if (!zaruka) return null;
              return (
                <div
                  style={{ fontSize: 13, color: zaruka.platna ? "var(--text)" : "var(--muted)", display: "flex", alignItems: "center", gap: 6 }}
                  title={zaruka.platna ? "Reklamace do tohoto dne je v záruce" : "Záruka na opravu už prošla"}
                >
                  <span>{textZarukyOpravy(zaruka)}</span>
                </div>
              );
            })()}
            {(() => {
              const drive = najdiStejneZarizeni(cloudTickets, detailedTicket.serialOrImei, detailedTicket.id);
              if (drive.length === 0) return null;
              return (
                <div style={{ fontSize: 12, color: "var(--muted)", display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                  <span>Toto zařízení u vás už bylo ({drive.length}×):</span>
                  {drive.slice(0, 4).map((t) => (
                    <button
                      key={t.id}
                      type="button"
                      onClick={() => { setDetailId(t.id); setDetailClaimId(null); }}
                      style={{ background: "transparent", border: "none", padding: 0, color: "var(--accent)", fontWeight: 700, cursor: "pointer", fontSize: 12, fontFamily: "inherit" }}
                    >
                      {t.code ?? "—"} · {formatCZ(t.createdAt)}
                    </button>
                  ))}
                </div>
              );
            })()}
            <div
              style={{
                fontSize: 14,
                fontWeight: 700,
                color: "var(--text)",
                marginTop: 8,
                padding: 10,
                borderRadius: 12,
                background: "var(--panel-2)",
                border: "1px solid var(--border)",
              }}
            >
              <WrenchIcon size={14} /> {detailedTicket.requestedRepair ?? detailedTicket.issueShort}
              {/* Předpokládaná cena a termín z příjmu – obojí se tiskne na zakázkový list. */}
              {(detailedTicket.estimatedPrice ?? 0) > 0 && (
                <div style={{ marginTop: 6, fontSize: 13, fontWeight: 600, color: "var(--muted)" }}>
                  Předpokládaná cena: <span style={{ color: "var(--text)", fontWeight: 800 }}>{formatCurrency(detailedTicket.estimatedPrice ?? 0)}</span>
                </div>
              )}
              {(() => {
                // V paměti pod jménem sloupce (mapSupabaseTicketToTicketEx).
                const termin = (detailedTicket as { expected_completion_at?: string | null }).expected_completion_at;
                if (!termin) return null;
                const poTerminu = !isFinal(detailedTicket.status) && new Date(termin).getTime() < Date.now();
                return (
                  <div style={{ marginTop: 4, fontSize: 13, fontWeight: 600, color: "var(--muted)" }}>
                    Předpokládané dokončení:{" "}
                    <span style={{ color: poTerminu ? "#b91c1c" : "var(--text)", fontWeight: 800 }}>
                      {formatCZ(termin)}{poTerminu ? " · po termínu" : ""}
                    </span>
                  </div>
                );
              })()}
            </div>
          </div>
        </div>
      </div>
      {/* Reklamace mimo mřížku Zákazník/Zařízení: karta přes celou šíři v
          mřížce s auto-fit by roztáhla mřížku na pět sloupců a obě karty
          zúžila na pětinu. */}
      {(() => {
        // Zakázka vznikla převodem reklamace („Není to reklamace“).
        const zReklamace = cloudClaims.find((c) => c.converted_ticket_id === detailedTicket.id);
        if (!zReklamace) return null;
        return (
          <div style={{ marginTop: 16, fontSize: 13, color: "var(--muted)", display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
            <span>Vzniklo z reklamace</span>
            <button
              type="button"
              onClick={() => { setDetailClaimId(zReklamace.id); setDetailId(null); }}
              title="Otevřít původní reklamaci"
              style={{ padding: "2px 8px", borderRadius: 6, border: "1px solid rgba(13,148,136,0.45)", background: "rgba(20,184,166,0.1)", color: "var(--text)", fontWeight: 800, fontSize: 12, cursor: "pointer" }}
            >
              {zReklamace.code}
            </button>
          </div>
        );
      })()}

      {(() => {
        const claimsForTicket = detailedTicket ? cloudClaims.filter((c) => c.source_ticket_id === detailedTicket.id) : [];
        return claimsForTicket.length > 0 ? (
          <div style={{ marginTop: 16, ...card, border: "2px solid rgba(13,148,136,0.3)", background: "linear-gradient(180deg, rgba(20,184,166,0.05) 0%, rgba(15,118,110,0.03) 100%)" }}>
            <div style={{ fontWeight: 950, fontSize: 14, color: "var(--text)", marginBottom: 12, display: "flex", alignItems: "center", gap: 8 }}>
              <span style={{ padding: "3px 8px", borderRadius: 6, background: "rgba(13,148,136,0.18)", color: "#134e4a", fontWeight: 800, fontSize: 12 }}>Reklamace k této zakázce</span>
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {claimsForTicket.map((c) => (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => { setDetailClaimId(c.id); setDetailId(null); }}
                  style={{ textAlign: "left", padding: "12px 14px", borderRadius: 10, border: "2px solid rgba(13,148,136,0.45)", background: "linear-gradient(135deg, rgba(20,184,166,0.1) 0%, rgba(15,118,110,0.05) 100%)", color: "var(--text)", fontSize: 13, cursor: "pointer", display: "flex", justifyContent: "space-between", alignItems: "center", fontWeight: 700, boxShadow: "0 1px 4px rgba(13,148,136,0.12)" }}
                >
                  <span style={{ fontWeight: 800 }}>{c.code}</span>
                  <span style={{ color: "#134e4a", fontSize: 12, fontWeight: 600 }}>{getByKey(c.status)?.label ?? c.status}</span>
                </button>
              ))}
            </div>
          </div>
        ) : null;
      })()}
    </>
  );
}
