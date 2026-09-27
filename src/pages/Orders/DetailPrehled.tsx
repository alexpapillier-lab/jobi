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
import { jeAppleZarizeni, najdiStejneZarizeni } from "../../lib/zarizeniHistorie";
import type { Branch } from "../../lib/branches";
import type { StatusMeta } from "../../state/StatusesStore";
import type { WarrantyClaimRow } from "./hooks/useWarrantyClaims";
import type { TicketEx } from "./typy";
import { skrytPostupZakazky } from "./uiConfig";
import { formatPhoneNumber } from "./formatovani";
import { card } from "./styly";

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
  ulozFindMy: (ticketId: string, vypnuto: boolean) => Promise<void>;
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
  ulozFindMy,
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

        {(() => {
          const claimsForTicket = detailedTicket ? cloudClaims.filter((c) => c.source_ticket_id === detailedTicket.id) : [];
          return claimsForTicket.length > 0 ? (
            <div style={{ gridColumn: "1 / -1", ...card, border: "2px solid rgba(13,148,136,0.3)", background: "linear-gradient(180deg, rgba(20,184,166,0.05) 0%, rgba(15,118,110,0.03) 100%)" }}>
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
            {/* Štítek Find My s přepnutím na klik – zákazník ho často vypne až po
                telefonátu, tak ať to technik nemusí řešit přes úpravu zakázky. */}
            {(detailedTicket.findMyOff != null || jeAppleZarizeni(detailedTicket.deviceLabel)) && (() => {
              const vypnuto = detailedTicket.findMyOff === true;
              return (
                <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", fontSize: 12 }}>
                  <button
                    type="button"
                    aria-pressed={vypnuto}
                    title={vypnuto ? "Označit Find My jako nevypnuté" : "Označit Find My jako vypnuté"}
                    onClick={() => void ulozFindMy(detailedTicket.id, !vypnuto)}
                    style={{
                      display: "inline-flex",
                      alignItems: "center",
                      gap: 6,
                      padding: "3px 10px",
                      borderRadius: 999,
                      border: `1px solid ${vypnuto ? "rgba(22,163,74,0.45)" : "rgba(220,38,38,0.45)"}`,
                      background: vypnuto ? "rgba(22,163,74,0.12)" : "rgba(220,38,38,0.12)",
                      color: vypnuto ? "#15803d" : "#b91c1c",
                      fontWeight: 700,
                      fontSize: 12,
                      cursor: "pointer",
                    }}
                  >
                    Find My {vypnuto ? "vypnuto" : "NEVYPNUTO"}
                  </button>
                  {!vypnuto && <span style={{ color: "var(--muted)" }}>Bez vypnutého Find My nelze zařízení servisovat u autorizovaných dílů.</span>}
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
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
