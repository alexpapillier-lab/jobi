/**
 * Tělo detailu reklamace: zákazník, zařízení, poznámka, provedené zákroky,
 * stav, a u napojené zakázky její diagnostika (zapisuje se rovnou do ní)
 * a komentáře. Vyneseno z Orders.tsx beze změny obsahu.
 */
import type React from "react";
import { Button } from "../../components/ui";
import { SectionHeading } from "../../components/SectionHeading";
import { DateTimePicker } from "../../components/DateTimePicker";
import { DeviceIcon, HashIcon, MailIcon, NoteIcon, PhoneIcon, PinIcon, SearchIcon, UserIcon } from "../../components/icons";
import { StatusPicker } from "../../components/orders";
import { TicketComments, formatCZ, type TicketComment } from "../../components/tickets";
import { FotkaZakazky } from "../../components/FotkaZakazky";
import { VyberFotek } from "../../components/orders/VyberFotek";
import { showToast } from "../../components/Toast";
import { supabase, supabaseUrl, supabaseAnonKey, supabaseFetch, resetTauriFetchState } from "../../lib/supabaseClient";
import { uploadDiagnosticPhotoWithWatermark, deleteDiagnosticPhotoFromStorage, isDiagnosticPhotoStorageUrl } from "../../lib/diagnosticPhotosStorage";
import { reportSilent } from "../../lib/reportError";
import { normalizeError } from "../../utils/errorNormalizer";
import { popisDoOdkazu } from "../../lib/diagnosticPhotoWatermark";
import { BARVA_SEKCE, stylSekce } from "../../lib/sekceDetailu";
import type { StatusMeta } from "../../state/StatusesStore";
import type { WarrantyClaimRow } from "./hooks/useWarrantyClaims";
import type { FotoLightboxStav, PolozkaQrFoceni, TicketEx } from "./typy";
import { formatPhoneNumber } from "./formatovani";
import { stavZarukyOpravy } from "../../lib/zarukaOpravy";
import { type ClaimResolutionItem, parseClaimResolutionItems } from "./reklamaceZakroky";
import { card, fieldLabel, baseFieldInput, baseFieldTextArea } from "./styly";

type Props = {
  detailedClaim: WarrantyClaimRow;
  editedClaim: Partial<WarrantyClaimRow>;
  setEditedClaim: React.Dispatch<React.SetStateAction<Partial<WarrantyClaimRow>>>;
  isEditingClaim: boolean;
  cloudTickets: TicketEx[];
  setCloudTickets: React.Dispatch<React.SetStateAction<TicketEx[]>>;
  claimResolutionDraft: ClaimResolutionItem[] | null;
  setClaimResolutionDraft: React.Dispatch<React.SetStateAction<ClaimResolutionItem[] | null>>;
  saveClaimResolutionItems: (claimId: string, items: ClaimResolutionItem[]) => Promise<boolean>;
  statuses: StatusMeta[];
  getByKey: (key: string) => StatusMeta | undefined;
  statusActionsMap: Record<string, string[]>;
  ulozDiagnostikuZakazky: (ticketId: string, patch: { diagnostic_text?: string; diagnostic_photos?: string[]; diagnostic_photos_before?: string[] }, hned: boolean) => void;
  setPhotoLightbox: React.Dispatch<React.SetStateAction<FotoLightboxStav | null>>;
  naTelefonu: boolean;
  activeServiceId: string | null;
  serviceName: string | null;
  captureQRLoading: boolean;
  setCaptureQRLoading: React.Dispatch<React.SetStateAction<boolean>>;
  diagnosticPhotosUploading: boolean;
  setDiagnosticPhotosUploading: React.Dispatch<React.SetStateAction<boolean>>;
  setCaptureQRItems: React.Dispatch<React.SetStateAction<PolozkaQrFoceni[] | null>>;
  commentsFor: (ticketId: string) => TicketComment[];
  commentDraftByTicket: Record<string, string>;
  handleCommentDraftChange: (ticketId: string, value: string) => void;
  addComment: (ticketId: string) => Promise<void>;
  togglePin: (ticketId: string, commentId: string) => Promise<void>;
  editComment: (ticketId: string, commentId: string, text: string) => Promise<void>;
  currentUserId: string | null;
  commentAuthorProfiles: Record<string, { nickname: string | null; avatarUrl: string | null }>;
};

export function DetailReklamace({
  detailedClaim,
  editedClaim,
  setEditedClaim,
  isEditingClaim,
  cloudTickets,
  setCloudTickets,
  claimResolutionDraft,
  setClaimResolutionDraft,
  saveClaimResolutionItems,
  statuses,
  getByKey,
  statusActionsMap,
  ulozDiagnostikuZakazky,
  setPhotoLightbox,
  naTelefonu,
  activeServiceId,
  serviceName,
  captureQRLoading,
  setCaptureQRLoading,
  diagnosticPhotosUploading,
  setDiagnosticPhotosUploading,
  setCaptureQRItems,
  commentsFor,
  commentDraftByTicket,
  handleCommentDraftChange,
  addComment,
  togglePin,
  editComment,
  currentUserId,
  commentAuthorProfiles,
}: Props) {
  const c = { ...detailedClaim, ...editedClaim };
  /* Diagnostika napojené zakázky se odsud rovnou zapisuje, takže se
     ukáže až s celou zakázkou – z řádku seznamu by byla prázdná a
     první úhoz by tu původní přepsal. */
  const zdrojZeSeznamu = detailedClaim.source_ticket_id ? cloudTickets.find((t) => t.id === detailedClaim.source_ticket_id) : undefined;
  const sourceTicket = zdrojZeSeznamu?.uplna ? zdrojZeSeznamu : undefined;
  const zdrojSeNacita = !!zdrojZeSeznamu && !sourceTicket;
  return (
  <>
  <div style={{ marginTop: 20, display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 240px), 1fr))", gap: 16 }}>
    <div style={{ ...card, ...stylSekce("zakaznik") }}>
      <SectionHeading icon={<UserIcon size={16} />} barva={BARVA_SEKCE.zakaznik}>Zákazník</SectionHeading>
      {!isEditingClaim ? (
        <div style={{ display: "grid", gap: 8 }}>
          <div style={{ fontSize: 15, fontWeight: 800, color: "var(--text)" }}>{c.customer_name ?? "—"}</div>
          {c.customer_phone && (
            <div style={{ fontSize: 13, color: "var(--text)", display: "flex", alignItems: "center", gap: 6 }}>
              <PhoneIcon size={14} />
              <span>{formatPhoneNumber(c.customer_phone)}</span>
            </div>
          )}
          {c.customer_email && (
            <div style={{ fontSize: 13, color: "var(--text)", display: "flex", alignItems: "center", gap: 6 }}>
              <MailIcon size={14} />
              <span>{c.customer_email}</span>
            </div>
          )}
          {[c.customer_address_street, c.customer_address_city, c.customer_address_zip].filter(Boolean).length > 0 && (
            <div style={{ fontSize: 13, color: "var(--text)", display: "flex", alignItems: "center", gap: 6, marginTop: 4 }}>
              <PinIcon size={14} />
              <span>{[c.customer_address_street, c.customer_address_city, c.customer_address_zip].filter(Boolean).join(", ")}</span>
            </div>
          )}
          {(c.customer_company || c.customer_ico) && (
            <div style={{ fontSize: 13, color: "var(--text)", marginTop: 4 }}>{[c.customer_company, c.customer_ico].filter(Boolean).join(" · ")}</div>
          )}
          {c.customer_info && <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 4, whiteSpace: "pre-wrap" }}>{c.customer_info}</div>}
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <input value={c.customer_name ?? ""} onChange={(e) => setEditedClaim((p) => ({ ...p, customer_name: e.target.value }))} placeholder="Jméno / firma" style={baseFieldInput} />
          <input value={c.customer_phone ?? ""} onChange={(e) => setEditedClaim((p) => ({ ...p, customer_phone: e.target.value }))} placeholder="Telefon" style={baseFieldInput} />
          <input value={c.customer_email ?? ""} onChange={(e) => setEditedClaim((p) => ({ ...p, customer_email: e.target.value }))} placeholder="E-mail" style={baseFieldInput} />
          <input value={c.customer_address_street ?? ""} onChange={(e) => setEditedClaim((p) => ({ ...p, customer_address_street: e.target.value }))} placeholder="Ulice, č.p." style={baseFieldInput} />
          <input value={c.customer_address_city ?? ""} onChange={(e) => setEditedClaim((p) => ({ ...p, customer_address_city: e.target.value }))} placeholder="Město" style={baseFieldInput} />
          <input value={c.customer_address_zip ?? ""} onChange={(e) => setEditedClaim((p) => ({ ...p, customer_address_zip: e.target.value }))} placeholder="PSČ" style={baseFieldInput} />
          <input value={c.customer_company ?? ""} onChange={(e) => setEditedClaim((p) => ({ ...p, customer_company: e.target.value }))} placeholder="Firma" style={baseFieldInput} />
          <input value={c.customer_ico ?? ""} onChange={(e) => setEditedClaim((p) => ({ ...p, customer_ico: e.target.value }))} placeholder="IČO" style={baseFieldInput} />
          <textarea value={c.customer_info ?? ""} onChange={(e) => setEditedClaim((p) => ({ ...p, customer_info: e.target.value }))} placeholder="Poznámka k zákazníkovi" rows={2} style={{ ...baseFieldInput, minHeight: 60 }} />
        </div>
      )}
    </div>
    <div style={{ ...card, ...stylSekce("zarizeni") }}>
      <SectionHeading icon={<DeviceIcon size={16} />} barva={BARVA_SEKCE.zarizeni}>Zařízení</SectionHeading>
      {!isEditingClaim ? (
        <div style={{ display: "grid", gap: 8 }}>
          <div style={{ fontSize: 15, fontWeight: 800, color: "var(--text)" }}>{c.device_label || c.device_serial || "—"}</div>
          {c.device_serial && (
            <div style={{ fontSize: 13, color: "var(--text)", display: "flex", alignItems: "center", gap: 6 }}>
              <HashIcon size={14} />
              <span>SN: {c.device_serial}</span>
            </div>
          )}
          {(c.device_brand || c.device_model) && (
            <div style={{ fontSize: 13, color: "var(--text)" }}>{[c.device_brand, c.device_model].filter(Boolean).join(" ")}</div>
          )}
          {c.device_condition && <div style={{ fontSize: 13, color: "var(--text)" }}>{c.device_condition}</div>}
          {(c.device_accessories || c.device_note) && (
            <div style={{ fontSize: 13, color: "var(--text)" }}>{[c.device_accessories, c.device_note].filter(Boolean).join(" · ")}</div>
          )}
          {c.device_passcode && <div style={{ fontSize: 13, color: "var(--text)" }}>Heslo/kód: {c.device_passcode}</div>}
          {/* Záruka na opravu napojené zakázky – jestli jde reklamace uznat.
              Rozhoduje den přijetí reklamace, ne dnešek: reklamace přijatá
              v záruce zůstává v záruce, i když se vyřizuje déle. */}
          {(() => {
            const prijato = new Date(c.received_at || c.created_at);
            const zaruka = stavZarukyOpravy(sourceTicket?.warrantyUntil, Number.isNaN(prijato.getTime()) ? new Date() : prijato);
            if (!zaruka) return null;
            return (
              <div style={{ fontSize: 13, fontWeight: 600, color: zaruka.platna ? "var(--success-text)" : "var(--warning-text)" }}>
                {zaruka.platna ? `V záruce do ${zaruka.datum}` : `Po záruce (skončila ${zaruka.datum})`}
              </div>
            );
          })()}
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <input value={c.device_label ?? ""} onChange={(e) => setEditedClaim((p) => ({ ...p, device_label: e.target.value }))} placeholder="Popis zařízení" style={baseFieldInput} />
          <input value={c.device_serial ?? ""} onChange={(e) => setEditedClaim((p) => ({ ...p, device_serial: e.target.value }))} placeholder="SN / IMEI" style={baseFieldInput} />
          <input value={c.device_condition ?? ""} onChange={(e) => setEditedClaim((p) => ({ ...p, device_condition: e.target.value }))} placeholder="Stav zařízení" style={baseFieldInput} />
          <input value={c.device_accessories ?? ""} onChange={(e) => setEditedClaim((p) => ({ ...p, device_accessories: e.target.value }))} placeholder="Příslušenství" style={baseFieldInput} />
          <input value={c.device_note ?? ""} onChange={(e) => setEditedClaim((p) => ({ ...p, device_note: e.target.value }))} placeholder="Poznámka k zařízení" style={baseFieldInput} />
          <input value={c.device_passcode ?? ""} onChange={(e) => setEditedClaim((p) => ({ ...p, device_passcode: e.target.value }))} placeholder="Heslo/kód" style={baseFieldInput} />
          <div>
            <div style={fieldLabel}>Předpokládané datum/čas dokončení</div>
            <DateTimePicker
              value={(c as any).expected_completion_at ?? null}
              onChange={(v) => setEditedClaim((p) => ({ ...p, expected_completion_at: v }))}
              inputStyle={baseFieldInput}
            />
          </div>
        </div>
      )}
    </div>
    <div style={{ ...card, gridColumn: "1 / -1" }}>
      <div style={{ fontWeight: 950, fontSize: 14, color: "var(--text)", marginBottom: 12 }}><NoteIcon size={14} /> Poznámka / důvod reklamace</div>
      {!isEditingClaim ? (
        <div style={{ fontSize: 14, color: "var(--text)", whiteSpace: "pre-wrap" }}>{c.notes || "—"}</div>
      ) : (
        <textarea value={c.notes ?? ""} onChange={(e) => setEditedClaim((p) => ({ ...p, notes: e.target.value }))} placeholder="Poznámka / důvod reklamace" rows={4} style={{ ...baseFieldInput, minHeight: 100 }} />
      )}
    </div>
    <div style={{ ...card, gridColumn: "1 / -1" }}>
      <div style={{ fontWeight: 950, fontSize: 14, color: "var(--text)", marginBottom: 12 }}>Provedené zákroky</div>
      {(() => {
        const resolutionItems = claimResolutionDraft ?? parseClaimResolutionItems(detailedClaim?.resolution_summary ?? null);
        const setResolutionItems = (next: ClaimResolutionItem[]) => setClaimResolutionDraft(next);
        return (
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {resolutionItems.length === 0 ? (
              <div style={{ fontSize: 14, color: "var(--muted)" }}>Zatím nebyly přidány žádné zákroky. Přidejte zákrok nebo opravu a u každého můžete nastavit cenu (0 Kč = zdarma při uznané reklamaci).</div>
            ) : (
              resolutionItems.map((item) => (
                <div key={item.id} style={{ display: "flex", flexDirection: "column", gap: 8, padding: 12, borderRadius: 10, background: "var(--panel)", border: "1px solid var(--border)" }}>
                  <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "flex-start" }}>
                    <input
                      value={item.name}
                      onChange={(e) => setResolutionItems(resolutionItems.map((x) => (x.id === item.id ? { ...x, name: e.target.value } : x)))}
                      placeholder="Název zákroku / opravy"
                      style={{ ...baseFieldInput, flex: 1, minWidth: 180 }}
                    />
                    <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                      <label style={{ fontSize: 12, color: "var(--muted)", whiteSpace: "nowrap" }}>Cena (Kč)</label>
                      <input
                        type="number"
                        min={0}
                        value={item.price ?? ""}
                        onChange={(e) => {
                          const v = e.target.value;
                          const num = v === "" ? undefined : Number(v);
                          setResolutionItems(resolutionItems.map((x) => (x.id === item.id ? { ...x, price: num } : x)));
                        }}
                        placeholder="0 = zdarma"
                        title="Při uznané reklamaci 0 Kč, při neuznané uvedte cenu opravy"
                        style={{ ...baseFieldInput, width: 100, fontWeight: 700 }}
                      />
                    </div>
                    <button
                      type="button"
                      onClick={() => setResolutionItems(resolutionItems.filter((x) => x.id !== item.id))}
                      style={{ padding: "8px 12px", borderRadius: 8, border: "1px solid var(--border)", background: "var(--panel)", color: "var(--text)", fontWeight: 600, cursor: "pointer", fontSize: 12 }}
                    >
                      Odstranit
                    </button>
                  </div>
                  <textarea
                    value={item.description ?? ""}
                    onChange={(e) => setResolutionItems(resolutionItems.map((x) => (x.id === item.id ? { ...x, description: e.target.value || undefined } : x)))}
                    placeholder="Popis (volitelné)"
                    rows={2}
                    style={{ ...baseFieldInput, minHeight: 50, fontSize: 12 }}
                  />
                </div>
              ))
            )}
            <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
              <Button variant="primary"
                disabled={resolutionItems.length > 0 && !resolutionItems[resolutionItems.length - 1]?.name?.trim()}
                onClick={() => setResolutionItems([...resolutionItems, { id: (crypto as any).randomUUID?.() ?? `z-${Date.now()}`, name: "" }])}
                title={resolutionItems.length > 0 && !resolutionItems[resolutionItems.length - 1]?.name?.trim() ? "Vyplňte název posledního zákroku" : "Přidat zákrok"}>
                <span>+</span> Přidat zákrok
              </Button>
              {claimResolutionDraft !== null && (
                <Button variant="primary"
                  onClick={() => {
                    saveClaimResolutionItems(detailedClaim!.id, claimResolutionDraft!).then((ok) => ok && showToast("Zákroky uloženy", "success"));
                  }} style={{ display: "inline-flex", alignItems: "center", gap: 8,  background: "var(--accent)", color: "var(--accent-fg)" }}
                >
                  Uložit zákroky
                </Button>
              )}
            </div>
            {resolutionItems.length > 0 && (() => {
              const total = resolutionItems.reduce((sum, r) => sum + (r.price || 0), 0);
              return (
                <div style={{ marginTop: 4, paddingTop: 8, borderTop: "1px solid var(--border)", fontSize: 14, fontWeight: 800, color: "var(--text)" }}>
                  Celkem: {total.toLocaleString("cs-CZ")} Kč
                  {total === 0 && resolutionItems.some((r) => r.price === 0 || r.price === undefined) && (
                    <span style={{ fontSize: 12, fontWeight: 500, color: "var(--muted)", marginLeft: 8 }}>(vše zdarma)</span>
                  )}
                </div>
              );
            })()}
          </div>
        );
      })()}
    </div>
    <div style={{ ...card, gridColumn: "1 / -1", display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
      <div style={{ fontWeight: 950, fontSize: 14, color: "var(--text)", marginBottom: 0 }}>Stav</div>
      <div onClick={(e) => e.stopPropagation()} onMouseDown={(e) => e.stopPropagation()}>
        {/* Mimo úpravy je přepínač stavu v hlavičce; tady zůstává jen pro režim úprav. */}
        {isEditingClaim ? (
          <StatusPicker value={c.status ?? "received"} statuses={statuses as any} getByKey={getByKey as any} onChange={(next) => setEditedClaim((p) => ({ ...p, status: next }))} size="sm" actionsByStatus={statusActionsMap} />
        ) : (
          <span style={{ fontSize: 13, fontWeight: 700, color: "var(--text)" }}>{getByKey(String(c.status ?? ""))?.label ?? "—"}</span>
        )}
      </div>
      <span style={{ fontSize: 12, color: "var(--muted)" }}>Vytvořeno: {formatCZ(c.created_at)}</span>
      {c.updated_at && <span style={{ fontSize: 12, color: "var(--muted)" }}>· Upraveno: {formatCZ(c.updated_at)}</span>}
    </div>
  </div>

  {sourceTicket ? (
    <>
      <div style={{ ...card, ...stylSekce("diagnostika"), marginTop: 16 }}>
        <SectionHeading icon={<SearchIcon size={16} />} barva={BARVA_SEKCE.diagnostika}>Diagnostika</SectionHeading>
        <div style={{ fontSize: 12, color: "var(--muted)", marginBottom: 10 }}>Údaje napojené zakázky {sourceTicket.code ? `(${sourceTicket.code})` : ""}. Změny se ukládají rovnou do ní.</div>
        <div style={{ display: "grid", gap: 12 }}>
          <div>
            <div style={fieldLabel}>Diagnostický protokol</div>
            <textarea
              value={sourceTicket.diagnosticText || ""}
              onChange={(e) => {
                const text = e.target.value;
                setCloudTickets((prev) =>
                  prev.map((t) => (t.id === sourceTicket.id ? { ...t, diagnosticText: text } : t))
                );
                ulozDiagnostikuZakazky(sourceTicket.id, { diagnostic_text: text }, false);
              }}
              style={baseFieldTextArea}
              placeholder="Zadejte výsledky diagnostiky zařízení..."
              rows={6}
            />
          </div>
          {(sourceTicket.diagnosticPhotosBefore?.length ?? 0) > 0 && (
            <div>
              <div style={fieldLabel}>Fotky před</div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 12, marginTop: 8 }}>
                {(sourceTicket.diagnosticPhotosBefore || []).map((photoUrl, idx) => (
                  <div key={idx} style={{ position: "relative" }}>
                    <FotkaZakazky
                      url={photoUrl}
                      alt={`Fotka před ${idx + 1}`}
                      role="button"
                      tabIndex={0}
                      onClick={() => setPhotoLightbox({ urls: sourceTicket.diagnosticPhotosBefore || [], index: idx, ticketCode: sourceTicket.code })}
                      onKeyDown={(e) => e.key === "Enter" && setPhotoLightbox({ urls: sourceTicket.diagnosticPhotosBefore || [], index: idx, ticketCode: sourceTicket.code })}
                      style={{ width: 120, height: 120, objectFit: "cover", borderRadius: 8, border: "1px solid var(--border)", cursor: "pointer" }}
                    />
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        (async () => {
                          const url = (sourceTicket.diagnosticPhotosBefore || [])[idx];
                          if (url && isDiagnosticPhotoStorageUrl(url) && supabase) {
                            try {
                              await deleteDiagnosticPhotoFromStorage(supabase, url);
                            } catch (e) {
                              // Fotka zůstane v úložišti jako sirotek – uživateli
                              // to nevadí, ale hromadí se to a nikdo by si toho
                              // nevšiml. Proto se to aspoň zaloguje.
                              reportSilent({ code: "orders.photo_delete_failed", error: e, source: "Orders.deleteDiagnosticPhoto" });
                            }
                          }
                          const zbyva = (sourceTicket.diagnosticPhotosBefore || []).filter((_, i) => i !== idx);
                          ulozDiagnostikuZakazky(sourceTicket.id, { diagnostic_photos_before: zbyva }, true);
                          setCloudTickets((prev) =>
                            prev.map((t) =>
                              t.id === sourceTicket.id
                                ? { ...t, diagnosticPhotosBefore: (t.diagnosticPhotosBefore || []).filter((_, i) => i !== idx) }
                                : t
                            )
                          );
                        })();
                      }}
                      style={{
                        position: "absolute", top: 4, right: 4, width: 24, height: 24, borderRadius: "50%",
                        background: "rgba(239, 68, 68, 0.9)", color: "white", border: "none", cursor: "pointer",
                        display: "flex", alignItems: "center", justifyContent: "center", fontSize: 14, fontWeight: 700,
                      }}
                    >
                      ×
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}
          <div>
            <div style={fieldLabel}>Diagnostické fotografie</div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 12, marginTop: 8 }}>
              {(sourceTicket.diagnosticPhotos || []).map((photoUrl, idx) => (
                <div key={idx} style={{ position: "relative" }}>
                  <FotkaZakazky
                    url={photoUrl}
                    alt={`Diagnostika ${idx + 1}`}
                    role="button"
                    tabIndex={0}
                    onClick={() => setPhotoLightbox({ urls: sourceTicket.diagnosticPhotos || [], index: idx, ticketCode: sourceTicket.code })}
                    onKeyDown={(e) => e.key === "Enter" && setPhotoLightbox({ urls: sourceTicket.diagnosticPhotos || [], index: idx, ticketCode: sourceTicket.code })}
                    style={{ width: 120, height: 120, objectFit: "cover", borderRadius: 8, border: "1px solid var(--border)", cursor: "pointer" }}
                  />
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      (async () => {
                      const url = (sourceTicket.diagnosticPhotos || [])[idx];
                      if (url && isDiagnosticPhotoStorageUrl(url) && supabase) {
                        try {
                          await deleteDiagnosticPhotoFromStorage(supabase, url);
                        } catch (e) {
                          reportSilent({ code: "orders.photo_delete_failed", error: e, source: "Orders.deleteDiagnosticPhoto" });
                        }
                      }
                      const zbyva = (sourceTicket.diagnosticPhotos || []).filter((_, i) => i !== idx);
                      ulozDiagnostikuZakazky(sourceTicket.id, { diagnostic_photos: zbyva }, true);
                      setCloudTickets((prev) =>
                        prev.map((t) =>
                          t.id === sourceTicket.id ? { ...t, diagnosticPhotos: (t.diagnosticPhotos || []).filter((_, i) => i !== idx) } : t
                        )
                      );
                    })();
                    }}
                    style={{
                      position: "absolute",
                      top: 4,
                      right: 4,
                      width: 24,
                      height: 24,
                      borderRadius: "50%",
                      background: "rgba(239, 68, 68, 0.9)",
                      color: "white",
                      border: "none",
                      cursor: "pointer",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      fontSize: 14,
                      fontWeight: 700,
                    }}
                  >
                    ×
                  </button>
                </div>
              ))}
            </div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 8, alignItems: "center" }}>
              {!naTelefonu && (
              <Button variant="soft"
                onClick={async () => {
                  if (!supabase || !supabaseUrl || !supabaseAnonKey || !activeServiceId || !sourceTicket?.id) return;
                  const client = supabase!;
                  setCaptureQRLoading(true);
                  try {
                  let lastErr: unknown = null;
                  for (let attempt = 0; attempt < 2; attempt++) {
                    try {
                      const doRequest = async (retry = false): Promise<Response> => {
                        const { data: refreshData, error: refreshErr } = await client.auth.refreshSession();
                        if (refreshErr && !retry) {
                          throw new Error("Session vypršela. Odhlaste se a přihlaste znovu.");
                        }
                        const token = refreshData?.session?.access_token ?? (await client.auth.getSession()).data?.session?.access_token;
                        if (!token) {
                          throw new Error("Nejste přihlášeni.");
                        }
                        return supabaseFetch(`${supabaseUrl}/functions/v1/capture-create-token`, {
                          method: "POST",
                          headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}`, apikey: supabaseAnonKey },
                          body: JSON.stringify({ ticketId: sourceTicket.id }),
                        });
                      };
                      let res = await doRequest();
                      if (res.status === 401) {
                        res = await doRequest(true);
                      }
                      const raw = await res.text();
                      let data: { url?: string; error?: string; detail?: string } = {};
                      try { if (raw) data = JSON.parse(raw); } catch {}
                      if (!res.ok) {
                        if (res.status === 401) throw new Error("Přihlášení vypršelo. Odhlaste se a přihlaste znovu.");
                        throw new Error(data?.error || data?.detail || res.statusText || "Chyba serveru");
                      }
                      if (data?.error) throw new Error(data.error);
                      if (!data?.url) throw new Error("Chybí URL v odpovědi");
                      setCaptureQRItems([{ deviceLabel: sourceTicket.deviceLabel || c.device_label || "Zakázka", url: popisDoOdkazu(data.url, { cislo: sourceTicket.code, servis: serviceName }) }]);
                      return;
                    } catch (err) {
                      lastErr = err;
                      const msg = err instanceof Error ? err.message : String(err);
                      if (attempt === 0 && (msg.includes("síťový modul") || msg.includes("Nelze načíst"))) {
                        resetTauriFetchState();
                        continue;
                      }
                      break;
                    }
                  }
                    showToast(normalizeError(lastErr) || "Nepodařilo vytvořit QR odkaz.", "error");
                  } finally {
                    setCaptureQRLoading(false);
                  }
                }}
                disabled={!supabase || !activeServiceId || !sourceTicket?.id || diagnosticPhotosUploading || captureQRLoading} style={{ fontSize: 13 }}
              >
                {captureQRLoading ? "Vytvářím…" : "Vyfotit z telefonu"}
              </Button>
              )}
              <VyberFotek popisek="Nahrát soubory" disabled={diagnosticPhotosUploading} style={{ ...baseFieldInput, padding: "8px 12px", margin: 0 }}>
                <input
                  type="file"
                  accept="image/*"
                  multiple
                  disabled={diagnosticPhotosUploading}
                  style={{ display: "none" }}
                  onChange={async (e) => {
                    const files = Array.from(e.target.files || []);
                    e.target.value = "";
                    if (!files.length) return;
                    const hasId = !!(activeServiceId && sourceTicket.id);
                    if (hasId && supabase) {
                      setDiagnosticPhotosUploading(true);
                      try {
                        const urls: string[] = [];
                        for (const file of files) {
                          const url = await uploadDiagnosticPhotoWithWatermark(supabase, activeServiceId!, sourceTicket.id!, file, { cislo: sourceTicket.code, servis: serviceName });
                          urls.push(url);
                        }
                        const vsechny = [...(sourceTicket.diagnosticPhotos || []), ...urls];
                        ulozDiagnostikuZakazky(sourceTicket.id, { diagnostic_photos: vsechny }, true);
                        setCloudTickets((prev) =>
                          prev.map((t) =>
                            t.id === sourceTicket.id ? { ...t, diagnosticPhotos: [...(t.diagnosticPhotos || []), ...urls] } : t
                          )
                        );
                      } catch (err) {
                        showToast(`Nahrání fotky se nezdařilo: ${normalizeError(err) || "neznámá chyba"}`, "error");
                      } finally {
                        setDiagnosticPhotosUploading(false);
                      }
                    } else {
                      const reader = (file: File) =>
                        new Promise<string>((resolve, reject) => {
                          const r = new FileReader();
                          r.onload = () => resolve(r.result as string);
                          r.onerror = () => reject(new Error("Načtení souboru selhalo"));
                          r.readAsDataURL(file);
                        });
                      try {
                        const results = await Promise.all(files.map(reader));
                        const vsechny = [...(sourceTicket.diagnosticPhotos || []), ...results];
                        ulozDiagnostikuZakazky(sourceTicket.id, { diagnostic_photos: vsechny }, true);
                        setCloudTickets((prev) =>
                          prev.map((t) =>
                            t.id === sourceTicket.id ? { ...t, diagnosticPhotos: [...(t.diagnosticPhotos || []), ...results] } : t
                          )
                        );
                      } catch (_) {
                        showToast("Nepodařilo se načíst vybrané soubory.", "error");
                      }
                    }
                  }}
                />
              </VyberFotek>
              {diagnosticPhotosUploading && (
                <span style={{ fontSize: 12, color: "var(--text-secondary)" }}>Nahrávám…</span>
              )}
            </div>
          </div>
        </div>
      </div>

      <TicketComments
        ticketId={sourceTicket.id}
        comments={commentsFor(sourceTicket.id)}
        draft={commentDraftByTicket[sourceTicket.id] ?? ""}
        onDraftChange={handleCommentDraftChange}
        onAdd={addComment}
        onTogglePin={togglePin}
        onEdit={editComment}
        currentUserId={currentUserId}
        authorProfiles={commentAuthorProfiles}
        card={card}
        baseFieldTextArea={baseFieldTextArea}
      />
    </>
  ) : zdrojSeNacita ? (
    <div data-detail-nacita style={{ ...card, marginTop: 16, color: "var(--muted)", fontSize: 13 }}>
      Načítám zakázku…
    </div>
  ) : (
    <div style={{ ...card, marginTop: 16, color: "var(--muted)", fontSize: 13 }}>
      Reklamace není napojená na zakázku. Diagnostiku a komentáře lze přidat u navázané zakázky.
    </div>
  )}
  </>
  );
}
