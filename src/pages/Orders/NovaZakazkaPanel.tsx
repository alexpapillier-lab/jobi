/**
 * Okno „Nová zakázka“ (příjem): portál do body s pozadím, lepivou hlavičkou
 * s výběrem pobočky, kartou Zákazník (našeptávač, telefon s dohledáním
 * zákazníka, další údaje), kartou Zařízení (NovaZakazkaZarizeni), sbalenými
 * dalšími údaji (přijímací fotky, QR focení) a lepivou patičkou.
 *
 * Vyneseno z Orders.tsx beze změny obsahu; stav konceptu, ověření a založení
 * zakázky drží kontejner a přicházejí jako props. Okno je vždy namontované
 * (jen se skrývá), takže rozepsané údaje přežijí zavření.
 */
import type React from "react";
import { createPortal } from "react-dom";
import { Button } from "../../components/ui";
import { SectionHeading } from "../../components/SectionHeading";
import { CameraIcon, ChevronDownIcon, SearchIcon, UserIcon, XIcon } from "../../components/icons";
import { CustomerAutocomplete, type CustomerMatch } from "../../components/orders";
import { FotkaZakazky } from "../../components/FotkaZakazky";
import { VyberFotek } from "../../components/orders/VyberFotek";
import { showToast } from "../../components/Toast";
import { supabase, supabaseUrl, supabaseAnonKey, supabaseFetch } from "../../lib/supabaseClient";
import { normalizePhone } from "../../lib/phone";
import { normalizeError } from "../../utils/errorNormalizer";
import { popisDoOdkazu } from "../../lib/diagnosticPhotoWatermark";
import { BARVA_SEKCE, stylSekce } from "../../lib/sekceDetailu";
import type { Branch } from "../../lib/branches";
import type { DeviceRepair } from "../../lib/catalogStorage";
import type { PravidloOdmeny } from "../../lib/odmeny";
import type { PrednastavenaSleva } from "../../lib/prednastaveneSlevy";
import type { ModelWithHierarchy, NewOrderDraft, ShodaZakaznika, TicketEx } from "./typy";
import { formatIco, formatPhoneNumber, formatZipCode } from "./formatovani";
import { border, borderError, card, fieldLabel, fieldHint, fieldMuted, subHeading, baseFieldInput, baseFieldTextArea } from "./styly";
import { NovaZakazkaZarizeni } from "./NovaZakazkaZarizeni";

type Props = {
  isNewOpen: boolean;
  setIsNewOpen: React.Dispatch<React.SetStateAction<boolean>>;
  newDraft: NewOrderDraft;
  setNewDraft: React.Dispatch<React.SetStateAction<NewOrderDraft>>;
  isNarrow: boolean;
  naTelefonu: boolean;
  activeServiceId: string | null;
  serviceName: string | null;
  hasBranches: boolean;
  branches: Branch[];
  branchForNew: Branch | null;
  closeNewOrder: () => void;
  discardNewOrder: () => void;
  createTicket: () => void;
  canCreate: boolean;
  submitAttempted: boolean;
  createBlockedReason: string | null;
  errors: Record<string, string>;
  showError: (field: string) => boolean;
  showDeviceError: (idx: number) => boolean;
  newOrderBodyRef: React.MutableRefObject<HTMLDivElement | null>;
  newOrderPhotosBeforeInputRef: React.RefObject<HTMLInputElement | null>;
  /** Telefon je povinný (customerPhoneRequired). */
  customerPhoneRequired: boolean;
  searchCustomers: (q: string) => Promise<CustomerMatch[]>;
  applyCustomerMatch: (m: CustomerMatch & { ico?: string | null; address_street?: string | null; address_zip?: string | null; note?: string | null }) => void;
  lookupCustomer: (phone?: string, name?: string) => Promise<void>;
  matchedCustomer: ShodaZakaznika | null;
  setMatchedCustomer: React.Dispatch<React.SetStateAction<ShodaZakaznika | null>>;
  customerMatchDecision: "undecided" | "accepted" | "rejected";
  setCustomerMatchDecision: React.Dispatch<React.SetStateAction<"undecided" | "accepted" | "rejected">>;
  lastLookupPhoneNormRef: React.MutableRefObject<string | null>;
  phoneLookupDebounceTimerRef: React.MutableRefObject<NodeJS.Timeout | null>;
  newOrderMoreOpen: boolean;
  setNewOrderMoreOpen: React.Dispatch<React.SetStateAction<boolean>>;
  newOrderCustomerMoreOpen: boolean;
  setNewOrderCustomerMoreOpen: React.Dispatch<React.SetStateAction<boolean>>;
  newOrderDeviceMoreOpen: boolean;
  setNewOrderDeviceMoreOpen: React.Dispatch<React.SetStateAction<boolean>>;
  expandedDeviceIdx: number;
  setExpandedDeviceIdx: React.Dispatch<React.SetStateAction<number>>;
  modelsWithHierarchy: ModelWithHierarchy[];
  repairsForDeviceLabel: (label: string | undefined | null) => DeviceRepair[];
  dalsiOprava: Record<number, { name: string; price: string }>;
  setDalsiOprava: React.Dispatch<React.SetStateAction<Record<number, { name: string; price: string }>>>;
  addManualPlannedRepair: (idx: number, nazev: string, cenaText: string) => boolean;
  catalogShowAll: Record<number, boolean>;
  setCatalogShowAll: React.Dispatch<React.SetStateAction<Record<number, boolean>>>;
  togglePlannedRepair: (idx: number, repair: DeviceRepair) => void;
  removePlannedRepair: (idx: number, id: string) => void;
  nastavPlannedNabidnuto: (idx: number, id: string, nabidnuto: boolean) => void;
  pravidlaOdmen: PravidloOdmeny[];
  prednastaveneSlevy: PrednastavenaSleva[];
  cloudTickets: TicketEx[];
  /** Fotky z telefonu k rozepsanému příjmu (QR focení ke konceptu). */
  draftCapturePreviewUrls: string[];
  setDraftCapturePreviewUrls: React.Dispatch<React.SetStateAction<string[]>>;
  setDraftCaptureLiveCount: React.Dispatch<React.SetStateAction<number>>;
  draftCaptureTokenRef: React.MutableRefObject<string | null>;
  setCaptureQRItems: React.Dispatch<React.SetStateAction<Array<{ deviceLabel: string; url: string }> | null>>;
  captureQRLoading: boolean;
  setCaptureQRLoading: React.Dispatch<React.SetStateAction<boolean>>;
};

export function NovaZakazkaPanel({
  isNewOpen,
  setIsNewOpen,
  newDraft,
  setNewDraft,
  isNarrow,
  naTelefonu,
  activeServiceId,
  serviceName,
  hasBranches,
  branches,
  branchForNew,
  closeNewOrder,
  discardNewOrder,
  createTicket,
  canCreate,
  submitAttempted,
  createBlockedReason,
  errors,
  showError,
  showDeviceError,
  newOrderBodyRef,
  newOrderPhotosBeforeInputRef,
  customerPhoneRequired,
  searchCustomers,
  applyCustomerMatch,
  lookupCustomer,
  matchedCustomer,
  setMatchedCustomer,
  customerMatchDecision,
  setCustomerMatchDecision,
  lastLookupPhoneNormRef,
  phoneLookupDebounceTimerRef,
  newOrderMoreOpen,
  setNewOrderMoreOpen,
  newOrderCustomerMoreOpen,
  setNewOrderCustomerMoreOpen,
  newOrderDeviceMoreOpen,
  setNewOrderDeviceMoreOpen,
  expandedDeviceIdx,
  setExpandedDeviceIdx,
  modelsWithHierarchy,
  repairsForDeviceLabel,
  dalsiOprava,
  setDalsiOprava,
  addManualPlannedRepair,
  catalogShowAll,
  setCatalogShowAll,
  togglePlannedRepair,
  removePlannedRepair,
  nastavPlannedNabidnuto,
  pravidlaOdmen,
  prednastaveneSlevy,
  cloudTickets,
  draftCapturePreviewUrls,
  setDraftCapturePreviewUrls,
  setDraftCaptureLiveCount,
  draftCaptureTokenRef,
  setCaptureQRItems,
  captureQRLoading,
  setCaptureQRLoading,
}: Props) {
  return createPortal(
    <>
  <div
    onClick={() => {
      setIsNewOpen(false);
      setCustomerMatchDecision("undecided");
      setMatchedCustomer(null);
      lastLookupPhoneNormRef.current = null;
      if (phoneLookupDebounceTimerRef.current) {
        clearTimeout(phoneLookupDebounceTimerRef.current);
        phoneLookupDebounceTimerRef.current = null;
      }
    }}
    style={{
      position: "fixed",
      inset: 0,
      background: "rgba(0,0,0,0.35)",
      opacity: isNewOpen ? 1 : 0,
      pointerEvents: isNewOpen ? "auto" : "none",
      transition: "opacity 180ms ease",
      zIndex: 1140,
    }}
  />
  <div
    // Rozdělaná práce: tichá obnova webu (lib/aktualizaceWebu) čeká, dokud je panel otevřený.
    data-jobi-rozdelano={isNewOpen ? "" : undefined}
    style={{
      position: "fixed",
      // Vystředění okraji, ne translate(-50%, -50%) – viz detail zakázky níž (rozmazaný text ve WebKitu).
      inset: 0,
      margin: "auto",
      height: "fit-content",
      transform: isNewOpen ? "none" : "translateY(2%) scale(0.98)",
      opacity: isNewOpen ? 1 : 0,
      pointerEvents: isNewOpen ? "auto" : "none",
      transition: "transform 180ms ease, opacity 180ms ease",
      width: 920,
      maxWidth: "calc(100vw - 24px)",
      maxHeight: "calc(100dvh / var(--ui-scale, 1) - 24px)",
      overflow: "auto",
      background: "var(--panel)",
      backdropFilter: "var(--blur)",
      WebkitBackdropFilter: "var(--blur)",
      border,
      borderRadius: "var(--radius-lg)",
      boxShadow: "var(--shadow)",
      /* Zdola bez odsazení: patička je lepivá a drží se dna posuvné
         oblasti, ale to dno bylo o 18 px níž než patička. V tom pruhu
         se pod tlačítky „Zrušit / Vytvořit zakázku" posouval formulář
         a byl vidět. Odsazení odspodu si patička dělá sama svým
         vlastním paddingem. */
      padding: "0 18px",
      zIndex: 1150,
    }}
    onClick={(e) => e.stopPropagation()}
  >
    <div style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "center", position: "sticky", top: 0, left: 0, right: 0, zIndex: 3, background: "var(--panel)", margin: "0 -18px 0", padding: "18px 18px 12px", borderBottom: "1px solid var(--border)" }}>
      <div style={{ minWidth: 0 }}>
        <div style={{ fontWeight: 950, fontSize: 16, color: "var(--text)" }}>Nová zakázka</div>
        {/* Hlavička je lepivá, takže tenhle popisek na telefonu ukrajoval
            řádky z každé obrazovky formuláře. Na širokém displeji zůstává. */}
        {!isNarrow && (
          <div style={{ color: "var(--muted)", fontSize: 12, marginTop: 4 }}>
            Stav se automaticky nastaví na <b>Přijato</b>.
          </div>
        )}
      </div>
      {hasBranches && (
        <select
          className="ui-input"
          aria-label="Pobočka nové zakázky"
          title="Pobočka – určí zkratku v čísle zakázky a údaje na dokumentech"
          value={newDraft.branchId ?? branchForNew?.id ?? ""}
          onChange={(e) => setNewDraft((p) => ({ ...p, branchId: e.target.value || null }))}
          style={{ width: "auto", maxWidth: 200, padding: "6px 10px", fontSize: 12, fontWeight: 600 }}
        >
          {branches.map((b) => (
            <option key={b.id} value={b.id}>{b.name}</option>
          ))}
        </select>
      )}
      <Button variant="soft" iconOnly icon={<XIcon size={16} />} aria-label="Zavřít" title="Zavřít (rozpracované údaje zůstanou uložené)" onClick={closeNewOrder} />
    </div>

    <div ref={newOrderBodyRef} style={{ marginTop: 14, display: "grid", gap: 14 }}>
      {/* ===== ZÁKAZNÍK – rychlá část ===== */}
      <div style={{ ...card, ...stylSekce("zakaznik") }}>
        <SectionHeading icon={<UserIcon size={16} />} size="sm" barva={BARVA_SEKCE.zakaznik}>Zákazník</SectionHeading>
        <div style={{ display: "grid", gridTemplateColumns: isNarrow ? "1fr" : "1fr 1fr", gap: 10 }}>
          <div style={{ minWidth: 0 }}>
            <div style={{ ...fieldLabel, marginTop: 0 }}>Jméno</div>
            {newDraft.customerId ? (
              <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "9px 12px", border: "1px solid var(--accent)", borderRadius: 12, background: "var(--accent-soft)", minHeight: 40 }}>
                <span style={{ color: "var(--accent)", display: "inline-flex", flex: "0 0 auto" }}><UserIcon size={15} /></span>
                <div style={{ flex: 1, minWidth: 0, fontSize: 13, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  <span style={{ fontWeight: 700 }}>{newDraft.customerName.trim() || "Bez jména"}</span>
                  {newDraft.customerPhone.trim() && <span style={{ color: "var(--muted)" }}> · {formatPhoneNumber(newDraft.customerPhone)}</span>}
                  {newDraft.customerEmail.trim() && <span style={{ color: "var(--muted)" }}> · {newDraft.customerEmail.trim()}</span>}
                </div>
                <button
                  type="button"
                  onClick={() => {
                    setNewDraft((p) => ({ ...p, customerId: undefined }));
                    setCustomerMatchDecision("undecided");
                    setMatchedCustomer(null);
                  }}
                  style={{ background: "none", border: "none", padding: 0, color: "var(--accent)", fontWeight: 700, fontSize: 12, cursor: "pointer", flex: "0 0 auto" }}
                  title="Vybrat jiného zákazníka nebo zadat nového"
                >
                  Změnit
                </button>
              </div>
            ) : (
              <>
                <CustomerAutocomplete
                  id="new-order-name"
                  value={newDraft.customerName}
                  autoFocus
                  placeholder="Jan Novák"
                  inputStyle={baseFieldInput}
                  search={searchCustomers}
                  onSelect={(m) => applyCustomerMatch(m as CustomerMatch & { ico?: string | null; address_street?: string | null; address_zip?: string | null; note?: string | null })}
                  onChange={(text) => {
                    setNewDraft((p) => ({ ...p, customerName: text }));
                    setCustomerMatchDecision("undecided");
                  }}
                />
                <div style={fieldMuted}>Bez jména bude zakázka anonymní. Začněte psát – existující zákazníky nabídneme.</div>
              </>
            )}
          </div>

          <div style={{ minWidth: 0 }}>
            <div style={{ ...fieldLabel, marginTop: 0 }}>Telefon{customerPhoneRequired ? " *" : ""}</div>
            <input
              id="new-order-phone"
              value={formatPhoneNumber(newDraft.customerPhone)}
              inputMode="tel"
              onChange={(e) => {
                const cleaned = e.target.value.replace(/[^\d+]/g, "");
                setNewDraft((p) => ({ ...p, customerPhone: cleaned }));
                // Vybraný zákazník zůstává vybraný – u něj se hledání podle telefonu nespouští.
                if (newDraft.customerId) return;
                // Clear matched customer and reset decision when phone changes
                if (matchedCustomer) setMatchedCustomer(null);
                setCustomerMatchDecision("undecided");

                // Clear any existing debounce timer
                if (phoneLookupDebounceTimerRef.current) {
                  clearTimeout(phoneLookupDebounceTimerRef.current);
                  phoneLookupDebounceTimerRef.current = null;
                }

                // Don't lookup if user explicitly rejected
                if (customerMatchDecision === "rejected") {
                  return;
                }

                // Calculate normalized phone
                const phoneNorm = normalizePhone(cleaned);

                // Reset lastLookupPhoneNormRef if phone is empty or invalid
                if (!cleaned.trim() || !phoneNorm) {
                  lastLookupPhoneNormRef.current = null;
                }

                // If phone is valid and different from last lookup, trigger lookup
                if (phoneNorm && phoneNorm !== lastLookupPhoneNormRef.current && customerMatchDecision === "undecided") {
                  // Immediate lookup for valid, new phone number
                  lookupCustomer(cleaned, newDraft.customerName);
                } else if (cleaned.trim()) {
                  // Debounce for intermediate states or invalid numbers
                  phoneLookupDebounceTimerRef.current = setTimeout(async () => {
                    const finalPhoneNorm = normalizePhone(cleaned);
                    if (finalPhoneNorm && finalPhoneNorm !== lastLookupPhoneNormRef.current && customerMatchDecision === "undecided") {
                      await lookupCustomer(cleaned, newDraft.customerName);
                    }
                    phoneLookupDebounceTimerRef.current = null;
                  }, 200);
                }
              }}
              onKeyDown={async (e) => {
                if (e.key === "Enter" && !newDraft.customerId) {
                  const phone = newDraft.customerPhone.trim();
                  const name = newDraft.customerName.trim();
                  if (phone || name) {
                    await lookupCustomer(phone || undefined, name || undefined);
                  }
                }
              }}
              onBlur={async () => {
                if (newDraft.customerId) return;
                await lookupCustomer(
                  newDraft.customerPhone.trim() || undefined,
                  newDraft.customerName.trim() || undefined
                );
              }}
              style={{ ...baseFieldInput, border: showError("customerPhone") ? borderError : border }}
              placeholder="+420 777 123 456"
            />
            {showError("customerPhone") && <div style={fieldHint}>{errors.customerPhone}</div>}

            {/* Nalezený zákazník podle telefonu (jen když ještě žádný není vybraný) */}
            {!newDraft.customerId && matchedCustomer && customerMatchDecision === "undecided" && (
              <div
                style={{
                  marginTop: 10,
                  padding: 12,
                  background: "var(--accent-light)",
                  borderRadius: 8,
                  border: "1px solid var(--accent)",
                }}
              >
                <div style={{ fontSize: 13, fontWeight: 600, color: "var(--text)", marginBottom: 8 }}>
                  Chcete zákazníka přiřadit k této zakázce?
                </div>
                <div style={{ fontSize: 12, color: "var(--muted)", marginBottom: 10 }}>
                  <div><strong>Jméno:</strong> {matchedCustomer.name}</div>
                  {matchedCustomer.phone && <div><strong>Telefon:</strong> {matchedCustomer.phone}</div>}
                  {matchedCustomer.email && <div><strong>E-mail:</strong> {matchedCustomer.email}</div>}
                  {matchedCustomer.company && <div><strong>Firma:</strong> {matchedCustomer.company}</div>}
                </div>
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                  <Button
                    variant="primary"
                    size="sm"
                    onClick={() => {
                      // Load full customer data for prefill
                      (async () => {
                        if (!supabase || !activeServiceId) return;
                        const { data } = await (supabase
                          .from("customers") as any)
                          .select("id,name,phone,email,company,ico,address_street,address_city,address_zip,note")
                          .eq("id", matchedCustomer.id)
                          .eq("service_id", activeServiceId)
                          .single();

                        if (data) {
                          // Prefill only empty fields
                          setNewDraft((prev) => ({
                            ...prev,
                            customerId: data.id,
                            customerName: !prev.customerName.trim() ? (data.name || "") : prev.customerName,
                            customerPhone: !prev.customerPhone.trim() ? (data.phone || "") : prev.customerPhone,
                            customerEmail: !prev.customerEmail.trim() ? (data.email || "") : prev.customerEmail,
                            addressStreet: !prev.addressStreet.trim() ? (data.address_street || "") : prev.addressStreet,
                            addressCity: !prev.addressCity.trim() ? (data.address_city || "") : prev.addressCity,
                            addressZip: !prev.addressZip.trim() ? (data.address_zip || "") : prev.addressZip,
                            company: !prev.company.trim() ? (data.company || "") : prev.company,
                            ico: !prev.ico.trim() ? (data.ico || "") : prev.ico,
                            customerInfo: !prev.customerInfo.trim() ? (data.note || "") : prev.customerInfo,
                          }));
                        }
                        setCustomerMatchDecision("accepted");
                        setMatchedCustomer(null);
                      })();
                    }}
                  >
                    Přiřadit zákazníka
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => {
                      setCustomerMatchDecision("rejected");
                      setMatchedCustomer(null);
                    }}
                  >
                    Ne, pokračovat bez přiřazení
                  </Button>
                </div>
              </div>
            )}
          </div>
        </div>

          {/* Další údaje zákazníka (e-mail, firma, IČO, adresa, poznámka).
              Dřív ležely až dole v sekci „Další údaje“ – při příjmu se pak
              přeskakovalo mezi zákazníkem nahoře a jeho údaji o obrazovku
              níž. Patří k zákazníkovi, tak jsou u něj; sbalení si aplikace
              pamatuje stejně jako u zařízení. */}
          <div style={{ marginTop: 12, borderTop: "1px dashed var(--border)", paddingTop: 6 }}>
            <button
              type="button"
              onClick={() => setNewOrderCustomerMoreOpen((v) => !v)}
              aria-expanded={newOrderCustomerMoreOpen}
              aria-controls="new-order-customer-more"
              style={{ width: "100%", display: "flex", alignItems: "center", gap: 8, padding: "6px 0", background: "none", border: "none", cursor: "pointer", color: "var(--text)", textAlign: "left" }}
            >
              <span style={{ display: "inline-flex", color: "var(--muted)", transform: newOrderCustomerMoreOpen ? "rotate(180deg)" : "none", transition: "transform 120ms ease" }}><ChevronDownIcon size={14} /></span>
              <span style={{ ...subHeading, marginBottom: 0 }}>Další údaje zákazníka</span>
              {!newOrderCustomerMoreOpen && (
                <span style={{ color: "var(--muted)", fontSize: 12, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  e-mail, firma, IČO, adresa, poznámka
                </span>
              )}
            </button>
            {newOrderCustomerMoreOpen && (
              <div id="new-order-customer-more">
                <div style={{ display: "grid", gridTemplateColumns: isNarrow ? "1fr" : "1fr 1fr 160px", gap: 10 }}>
                  <div>
                    <div style={{ ...fieldLabel, marginTop: 0 }}>E-mail</div>
                    <input
                      id="new-order-email"
                      type="email"
                      value={newDraft.customerEmail}
                      onChange={(e) => setNewDraft((p) => ({ ...p, customerEmail: e.target.value }))}
                      style={{ ...baseFieldInput, border: showError("customerEmail") ? borderError : border }}
                      placeholder="jan.novak@email.cz"
                    />
                    {showError("customerEmail") && <div style={fieldHint}>{errors.customerEmail}</div>}
                  </div>
                  <div>
                    <div style={{ ...fieldLabel, marginTop: 0 }}>Firma</div>
                    <input
                      value={newDraft.company}
                      onChange={(e) => setNewDraft((p) => ({ ...p, company: e.target.value }))}
                      style={baseFieldInput}
                      placeholder="Novák s.r.o."
                    />
                  </div>
                  <div>
                    <div style={{ ...fieldLabel, marginTop: 0 }}>IČO</div>
                    <input
                      id="new-order-ico"
                      inputMode="numeric"
                      value={formatIco(newDraft.ico)}
                      onChange={(e) => {
                        const cleaned = e.target.value.replace(/[^\d]/g, "");
                        setNewDraft((p) => ({ ...p, ico: cleaned }));
                      }}
                      style={{ ...baseFieldInput, border: showError("ico") ? borderError : border }}
                      placeholder="1234 5678"
                      maxLength={9}
                    />
                    {showError("ico") && <div style={fieldHint}>{errors.ico}</div>}
                  </div>
                </div>

                {/* Třetí sloupec je na desktopu rezerva pro PSČ. Na telefonu
                    by sebral půlku šířky, proto tam jsou dva sloupce. */}
                <div style={{ display: "grid", gridTemplateColumns: isNarrow ? "1fr 1fr" : "2fr 1fr 160px", gap: 10 }}>
                  <div style={{ gridColumn: isNarrow ? "1 / -1" : "auto" }}>
                    <div style={fieldLabel}>Ulice</div>
                    <input
                      value={newDraft.addressStreet}
                      onChange={(e) => setNewDraft((p) => ({ ...p, addressStreet: e.target.value }))}
                      style={baseFieldInput}
                      placeholder="Dlouhá 12"
                    />
                  </div>
                  <div>
                    <div style={fieldLabel}>Město</div>
                    <input
                      value={newDraft.addressCity}
                      onChange={(e) => setNewDraft((p) => ({ ...p, addressCity: e.target.value }))}
                      style={baseFieldInput}
                      placeholder="Praha"
                    />
                  </div>
                  <div>
                    <div style={fieldLabel}>PSČ</div>
                    <input
                      id="new-order-zip"
                      inputMode="numeric"
                      value={formatZipCode(newDraft.addressZip)}
                      onChange={(e) => {
                        const cleaned = e.target.value.replace(/[^\d]/g, "");
                        setNewDraft((p) => ({ ...p, addressZip: cleaned }));
                      }}
                      style={{ ...baseFieldInput, border: showError("addressZip") ? borderError : border }}
                      placeholder="110 00"
                      maxLength={6}
                    />
                    {showError("addressZip") && <div style={fieldHint}>{errors.addressZip}</div>}
                  </div>
                </div>

                <div style={fieldLabel}>Poznámka k zákazníkovi</div>
                <textarea
                  value={newDraft.customerInfo}
                  onChange={(e) => setNewDraft((p) => ({ ...p, customerInfo: e.target.value }))}
                  style={{ ...baseFieldTextArea, minHeight: 64 }}
                  placeholder="Volá jen odpoledne, preferuje SMS"
                />
              </div>
            )}
          </div>
      </div>

      {/* ===== ZAŘÍZENÍ – rychlá část (seznam sbalitelných karet) ===== */}
      <NovaZakazkaZarizeni
        newDraft={newDraft}
        setNewDraft={setNewDraft}
        expandedDeviceIdx={expandedDeviceIdx}
        setExpandedDeviceIdx={setExpandedDeviceIdx}
        errors={errors}
        showError={showError}
        showDeviceError={showDeviceError}
        isNarrow={isNarrow}
        modelsWithHierarchy={modelsWithHierarchy}
        repairsForDeviceLabel={repairsForDeviceLabel}
        dalsiOprava={dalsiOprava}
        setDalsiOprava={setDalsiOprava}
        addManualPlannedRepair={addManualPlannedRepair}
        catalogShowAll={catalogShowAll}
        setCatalogShowAll={setCatalogShowAll}
        togglePlannedRepair={togglePlannedRepair}
        removePlannedRepair={removePlannedRepair}
        nastavPlannedNabidnuto={nastavPlannedNabidnuto}
        pravidlaOdmen={pravidlaOdmen}
        prednastaveneSlevy={prednastaveneSlevy}
        newOrderDeviceMoreOpen={newOrderDeviceMoreOpen}
        setNewOrderDeviceMoreOpen={setNewOrderDeviceMoreOpen}
        cloudTickets={cloudTickets}
      />

      {/* ===== DALŠÍ ÚDAJE – sbalené, stav se pamatuje ===== */}
      <div style={{ ...card, ...stylSekce("diagnostika"), padding: 0, overflow: "hidden" }}>
        <button
          type="button"
          onClick={() => setNewOrderMoreOpen((v) => !v)}
          aria-expanded={newOrderMoreOpen}
          aria-controls="new-order-more"
          style={{ width: "100%", display: "flex", alignItems: "center", gap: 10, padding: 12, background: "none", border: "none", cursor: "pointer", color: "var(--text)", textAlign: "left" }}
        >
          <span style={{ display: "inline-flex", color: "var(--muted)", transform: newOrderMoreOpen ? "rotate(180deg)" : "none", transition: "transform 120ms ease" }}><ChevronDownIcon size={16} /></span>
          <span aria-hidden="true" style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", width: 22, height: 22, borderRadius: 6, background: `${BARVA_SEKCE.diagnostika}22`, color: BARVA_SEKCE.diagnostika, flexShrink: 0 }}><SearchIcon size={14} /></span>
          <span style={{ fontWeight: 950, fontSize: "var(--text-base)" }}>Další údaje</span>
          {!newOrderMoreOpen && (
            <span style={{ color: "var(--muted)", fontSize: 12, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              přijímací fotky
            </span>
          )}
        </button>

        {newOrderMoreOpen && (
          <div id="new-order-more" style={{ padding: 12, paddingTop: 0, display: "grid", gap: 16 }}>
            {/* Přijímací fotky – nahrají se po vytvoření zakázky */}
            <div id="new-order-photos-before">
              <div style={subHeading}>Přijímací fotky</div>
              <div style={{ ...fieldMuted, marginTop: 0, marginBottom: 10 }}>Fotky se po vytvoření zakázky automaticky nahrají a připojí k zakázce.</div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 12 }}>
                {(newDraft.diagnosticPhotosBefore || []).map((dataUrl, idx) => (
                  <div key={idx} style={{ position: "relative" }}>
                    <img
                      src={dataUrl}
                      alt={`Fotka ${idx + 1}`}
                      style={{
                        width: 80,
                        height: 80,
                        objectFit: "cover",
                        borderRadius: 8,
                        border: "1px solid var(--border)",
                      }}
                    />
                    <button
                      type="button"
                      aria-label="Odebrat fotku"
                      onClick={() =>
                        setNewDraft((p) => ({
                          ...p,
                          diagnosticPhotosBefore: (p.diagnosticPhotosBefore || []).filter((_, i) => i !== idx),
                        }))
                      }
                      style={{
                        position: "absolute",
                        top: 4,
                        right: 4,
                        width: 22,
                        height: 22,
                        borderRadius: "50%",
                        background: "rgba(239, 68, 68, 0.9)",
                        color: "white",
                        border: "none",
                        cursor: "pointer",
                        display: "grid",
                        placeItems: "center",
                        padding: 0,
                      }}
                    >
                      <XIcon size={12} />
                    </button>
                  </div>
                ))}
                {draftCapturePreviewUrls.map((photoUrl, idx) => (
                  <div key={`draft-${idx}`} style={{ position: "relative" }}>
                    <FotkaZakazky
                      url={photoUrl}
                      alt={`QR fotka ${idx + 1}`}
                      style={{
                        width: 80,
                        height: 80,
                        objectFit: "cover",
                        borderRadius: 8,
                        border: "1px solid var(--border)",
                      }}
                    />
                    <div
                      style={{
                        position: "absolute",
                        left: 4,
                        right: 4,
                        bottom: 4,
                        fontSize: "var(--text-xs)",
                        fontWeight: 700,
                        borderRadius: 6,
                        background: "rgba(0,0,0,0.55)",
                        color: "white",
                        textAlign: "center",
                        padding: "2px 4px",
                      }}
                    >
                      z mobilu
                    </div>
                  </div>
                ))}
              </div>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 8, alignItems: "center" }}>
                <VyberFotek popisek={<><CameraIcon size={14} /> Nahrát fotky</>} style={{ ...baseFieldInput, width: "auto", padding: "6px 12px", display: "inline-flex", alignItems: "center", gap: 6, fontSize: "var(--text-sm)", fontWeight: 600 }}>
                  <input
                    ref={newOrderPhotosBeforeInputRef}
                    type="file"
                    accept="image/*"
                    multiple
                    style={{ display: "none" }}
                    onChange={(e) => {
                      const files = Array.from(e.target.files || []);
                      e.target.value = "";
                      if (!files.length) return;
                      const reader = (f: File) =>
                        new Promise<string>((resolve, reject) => {
                          const r = new FileReader();
                          r.onload = () => resolve(r.result as string);
                          r.onerror = () => reject(new Error("Načtení selhalo"));
                          r.readAsDataURL(f);
                        });
                      Promise.all(files.map(reader)).then((urls) => {
                        setNewDraft((p) => ({
                          ...p,
                          diagnosticPhotosBefore: [...(p.diagnosticPhotosBefore || []), ...urls],
                        }));
                      });
                    }}
                  />
                </VyberFotek>
                {!naTelefonu && (
                <Button
                  variant="soft"
                  size="sm"
                  onClick={async () => {
                    if (!supabase || !supabaseUrl || !supabaseAnonKey || !activeServiceId) {
                      showToast("Chybí připojení nebo aktivní služba.", "error");
                      return;
                    }
                    setCaptureQRLoading(true);
                    try {
                      const { data: refreshData, error: refreshErr } = await supabase.auth.refreshSession();
                      if (refreshErr) throw new Error("Session vypršela.");
                      const authToken = refreshData?.session?.access_token ?? (await supabase.auth.getSession()).data?.session?.access_token;
                      if (!authToken) throw new Error("Nejste přihlášeni.");
                      const res = await supabaseFetch(`${supabaseUrl}/functions/v1/capture-create-token`, {
                        method: "POST",
                        headers: { "Content-Type": "application/json", Authorization: `Bearer ${authToken}`, apikey: supabaseAnonKey },
                        body: JSON.stringify({ draft: true, serviceId: activeServiceId, isBefore: true }),
                      });
                      const raw = await res.text();
                      const data: { url?: string; token?: string; error?: string } = raw ? JSON.parse(raw) : {};
                      if (!res.ok) throw new Error(data.error || res.statusText);
                      setDraftCapturePreviewUrls([]);
                      setDraftCaptureLiveCount(0);
                      if (data.token) draftCaptureTokenRef.current = data.token;
                      if (data.url) {
                        setCaptureQRItems([{ deviceLabel: "Přijímací fotky (před vytvořením zakázky)", url: popisDoOdkazu(data.url, { servis: serviceName }) }]);
                      }
                    } catch (err) {
                      showToast(normalizeError(err) || "Nepodařilo se vytvořit QR pro focení.", "error");
                    } finally {
                      setCaptureQRLoading(false);
                    }
                  }}
                  disabled={captureQRLoading}
                  title="Zobrazit QR kód pro nafocení přijímacích fotek z telefonu. Zakázka se nevytvoří – fotky se připojí po kliknutí na „Vytvořit zakázku“."
                >
                  {captureQRLoading ? "Vytvářím…" : "Vyfotit z telefonu (QR)"}
                </Button>
                )}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>

    {/* ===== Patička – lepivá ===== */}
    <div style={{ display: "flex", flexDirection: isNarrow ? "column" : "row", alignItems: isNarrow ? "stretch" : "center", gap: 10, justifyContent: "space-between", position: "sticky", bottom: 0, left: 0, right: 0, zIndex: 3, background: "var(--panel)", margin: "14px -18px 0", padding: 18, paddingTop: 12, borderTop: "1px solid var(--border)" }}>
      {!isNarrow && <span style={{ fontSize: 12, color: "var(--muted)" }}>Rozpracované údaje se ukládají automaticky</span>}
      <div style={{ display: "flex", alignItems: "center", gap: 10, justifyContent: "flex-end", flexWrap: "wrap" }}>
        {submitAttempted && createBlockedReason && (
          <span role="status" style={{ fontSize: 12, color: "var(--muted)" }}>{createBlockedReason}</span>
        )}
        <Button variant="soft" onClick={discardNewOrder} title="Zahodit rozpracovanou zakázku">
          Zrušit
        </Button>
        <Button variant="primary" onClick={createTicket} aria-disabled={!canCreate} title="Vytvořit zakázku (⌘/Ctrl+Enter)">
          Vytvořit zakázku
        </Button>
      </div>
    </div>
  </div>
    </>,
    document.body
  );
}
