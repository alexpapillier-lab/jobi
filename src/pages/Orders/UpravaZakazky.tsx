/**
 * Formulář „Upravit zakázku“ v detailu: zákazník (s dohledáním podle telefonu
 * a nabídkou změny zákazníka), zařízení, záruka, převzetí, termín.
 * Vyneseno z Orders.tsx beze změny obsahu; editedTicket drží kontejner.
 */
import type React from "react";
import { SectionHeading } from "../../components/SectionHeading";
import { DateTimePicker } from "../../components/DateTimePicker";
import { DeviceIcon, UserIcon } from "../../components/icons";
import { DeviceAutocomplete, HandoffMethodSelect } from "../../components/orders";
import { supabase } from "../../lib/supabaseClient";
import { devLog } from "../../lib/devLog";
import { normalizePhone } from "../../lib/phone";
import { getDeviceOptions } from "../../lib/deviceOptions";
import { getHandoffOptions } from "../../lib/handoffOptions";
import { chybiPodkladZaruky } from "../../lib/zarizeniHistorie";
import { BARVA_SEKCE, stylSekce } from "../../lib/sekceDetailu";
import type { ModelWithHierarchy, ShodaZakaznika, TicketEx } from "./typy";
import { card, fieldLabel, fieldMuted, baseFieldInput, baseFieldTextArea } from "./styly";

type Props = {
  detailedTicket: TicketEx;
  editedTicket: Partial<TicketEx>;
  setEditedTicket: React.Dispatch<React.SetStateAction<Partial<TicketEx>>>;
  activeServiceId: string | null;
  /** Telefon je povinný (customerPhoneRequired). */
  customerPhoneRequired: boolean;
  lookupCustomerEdit: (phone?: string, name?: string) => Promise<void>;
  matchedCustomerEdit: ShodaZakaznika | null;
  setMatchedCustomerEdit: React.Dispatch<React.SetStateAction<ShodaZakaznika | null>>;
  modelsWithHierarchy: ModelWithHierarchy[];
};

export function UpravaZakazky({
  detailedTicket,
  editedTicket,
  setEditedTicket,
  activeServiceId,
  customerPhoneRequired,
  lookupCustomerEdit,
  matchedCustomerEdit,
  setMatchedCustomerEdit,
  modelsWithHierarchy,
}: Props) {
  return (
    <div style={{ marginTop: 20 }}>
      <div style={{ fontWeight: 950, fontSize: 16, color: "var(--text)", marginBottom: 16 }}>Upravit zakázku</div>

      <div style={{ display: "grid", gap: 16 }}>
        <div style={{ ...card, ...stylSekce("zakaznik") }}>
          <SectionHeading icon={<UserIcon size={16} />} barva={BARVA_SEKCE.zakaznik}>Zákazník</SectionHeading>
          <div style={{ display: "grid", gap: 12 }}>
            <div>
              <div style={fieldLabel}>Jméno *</div>
              <input
                type="text"
                value={editedTicket.customerName || ""}
                onChange={(e) => setEditedTicket((p) => ({ ...p, customerName: e.target.value }))}
                onBlur={async () => {
                  const phone = editedTicket.customerPhone?.trim();
                  const name = editedTicket.customerName?.trim();
                  if (phone && name) {
                    await lookupCustomerEdit(phone, name);
                  }
                }}
                style={baseFieldInput}
                placeholder="Jméno zákazníka"
              />
            </div>
            <div>
              <div style={fieldLabel}>Telefon{customerPhoneRequired ? " *" : ""}</div>
              <input
                type="text"
                value={editedTicket.customerPhone || ""}
                onChange={(e) => {
                  const cleaned = e.target.value.replace(/\D/g, "");
                  setEditedTicket((p) => ({ ...p, customerPhone: cleaned }));
                  // Clear matched customer when phone changes
                  if (matchedCustomerEdit) setMatchedCustomerEdit(null);
                  
                  // Trigger lookup if phone is valid (without waiting for blur)
                  if (cleaned.trim()) {
                    const phoneNorm = normalizePhone(cleaned);
                    if (phoneNorm) {
                      const name = editedTicket.customerName?.trim();
                      lookupCustomerEdit(cleaned, name);
                    }
                  }
                }}
                onKeyDown={async (e) => {
                  if (e.key === "Enter") {
                    const phone = editedTicket.customerPhone?.trim();
                    const name = editedTicket.customerName?.trim();
                    if (phone) {
                      await lookupCustomerEdit(phone, name);
                    }
                  }
                }}
                onBlur={async () => {
                  const phone = editedTicket.customerPhone?.trim();
                  const name = editedTicket.customerName?.trim();
                  if (phone) {
                    await lookupCustomerEdit(phone, name);
                  } else {
                    setMatchedCustomerEdit(null);
                  }
                }}
                style={baseFieldInput}
                placeholder="(+420) xxx xxx xxx"
              />
              
              {/* Customer match panel for Edit */}
              {matchedCustomerEdit && (
                <div
                  style={{
                    marginTop: 12,
                    padding: 12,
                    background: "var(--accent-light)",
                    borderRadius: 8,
                    border: "1px solid var(--accent)",
                  }}
                >
                  <div style={{ fontSize: 13, fontWeight: 600, color: "var(--text)", marginBottom: 8 }}>
                    Chcete změnit zákazníka této zakázky?
                  </div>
                  <div style={{ fontSize: 12, color: "var(--muted)", marginBottom: 10 }}>
                    <div><strong>Jméno:</strong> {matchedCustomerEdit.name}</div>
                    {matchedCustomerEdit.phone && <div><strong>Telefon:</strong> {matchedCustomerEdit.phone}</div>}
                    {matchedCustomerEdit.email && <div><strong>E-mail:</strong> {matchedCustomerEdit.email}</div>}
                    {matchedCustomerEdit.company && <div><strong>Firma:</strong> {matchedCustomerEdit.company}</div>}
                  </div>
                  <div style={{ display: "flex", gap: 8 }}>
                    <button
                      onClick={async () => {
                        // Load full customer data for prefill
                        if (!supabase || !activeServiceId) return;
                        const { data } = await (supabase
                          .from("customers") as any)
                          .select("id,name,phone,email,company,ico,address_street,address_city,address_zip,note")
                          .eq("id", matchedCustomerEdit.id)
                          .eq("service_id", activeServiceId)
                          .single();
                        
                        if (data) {
                          // Audit: Log customer data loaded from DB
                          devLog("[EditTicket] Customer data loaded from DB:", {
                            id: data.id,
                            name: data.name,
                            phone: data.phone,
                            email: data.email,
                            address_street: data.address_street,
                            address_city: data.address_city,
                            address_zip: data.address_zip,
                            company: data.company,
                            ico: data.ico,
                            note: data.note,
                          });
                          
                          // User explicitly confirmed change - update all customer snapshot fields
                          const updatedFields = {
                            customerId: data.id,
                            customerName: data.name || "",
                            customerPhone: data.phone || "",
                            customerEmail: data.email || "",
                            customerAddressStreet: data.address_street || "",
                            customerAddressCity: data.address_city || "",
                            customerAddressZip: data.address_zip || "",
                            customerCompany: data.company || "",
                            customerIco: data.ico || "",
                            customerInfo: data.note || "",
                          };
                          
                          // Audit: Log what we're setting to editedTicket
                          devLog("[EditTicket] Setting to editedTicket:", updatedFields);
                          
                          setEditedTicket((prev) => ({
                            ...prev,
                            ...updatedFields,
                          }));
                        }
                        setMatchedCustomerEdit(null);
                      }}
                      style={{
                        padding: "6px 12px",
                        borderRadius: 6,
                        border: "none",
                        background: "var(--accent)",
                        color: "white",
                        fontWeight: 600,
                        fontSize: 12,
                        cursor: "pointer",
                      }}
                    >
                      Změnit zákazníka
                    </button>
                    <button
                      onClick={() => setMatchedCustomerEdit(null)}
                      style={{
                        padding: "6px 12px",
                        borderRadius: 6,
                        border: "1px solid var(--border)",
                        background: "transparent",
                        color: "var(--text)",
                        fontWeight: 500,
                        fontSize: 12,
                        cursor: "pointer",
                      }}
                    >
                      Ne, ponechat
                    </button>
                  </div>
                </div>
              )}
            </div>
            <div>
              <div style={fieldLabel}>E-mail</div>
              <input
                type="email"
                value={editedTicket.customerEmail || ""}
                onChange={(e) => setEditedTicket((p) => ({ ...p, customerEmail: e.target.value }))}
                style={baseFieldInput}
                placeholder="email@example.com"
              />
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 240px), 1fr))", gap: 12 }}>
              <div>
                <div style={fieldLabel}>Ulice</div>
                <input
                  type="text"
                  value={editedTicket.customerAddressStreet || ""}
                  onChange={(e) => setEditedTicket((p) => ({ ...p, customerAddressStreet: e.target.value }))}
                  style={baseFieldInput}
                  placeholder="Ulice a číslo"
                />
              </div>
              <div>
                <div style={fieldLabel}>Město</div>
                <input
                  type="text"
                  value={editedTicket.customerAddressCity || ""}
                  onChange={(e) => setEditedTicket((p) => ({ ...p, customerAddressCity: e.target.value }))}
                  style={baseFieldInput}
                  placeholder="Město"
                />
              </div>
            </div>
            <div>
              <div style={fieldLabel}>PSČ</div>
              <input
                type="text"
                value={editedTicket.customerAddressZip || ""}
                onChange={(e) => setEditedTicket((p) => ({ ...p, customerAddressZip: e.target.value.replace(/\D/g, "") }))}
                style={baseFieldInput}
                placeholder="123 45"
              />
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 240px), 1fr))", gap: 12 }}>
              <div>
                <div style={fieldLabel}>Firma</div>
                <input
                  type="text"
                  value={editedTicket.customerCompany || ""}
                  onChange={(e) => setEditedTicket((p) => ({ ...p, customerCompany: e.target.value }))}
                  style={baseFieldInput}
                  placeholder="Název firmy"
                />
              </div>
              <div>
                <div style={fieldLabel}>IČO</div>
                <input
                  type="text"
                  value={editedTicket.customerIco || ""}
                  onChange={(e) => setEditedTicket((p) => ({ ...p, customerIco: e.target.value.replace(/\D/g, "") }))}
                  style={baseFieldInput}
                  placeholder="12345678"
                />
              </div>
            </div>
            <div>
              <div style={fieldLabel}>Poznámka o zákazníkovi</div>
              <textarea
                value={editedTicket.customerInfo || ""}
                onChange={(e) => setEditedTicket((p) => ({ ...p, customerInfo: e.target.value }))}
                style={baseFieldTextArea}
                placeholder="Dodatečné informace o zákazníkovi..."
              />
            </div>
          </div>
        </div>

        <div style={{ ...card, ...stylSekce("zarizeni") }}>
          <SectionHeading icon={<DeviceIcon size={16} />} barva={BARVA_SEKCE.zarizeni}>Zařízení</SectionHeading>
          <div style={{ display: "grid", gap: 12 }}>
            <div>
              <div style={fieldLabel}>Zařízení *</div>
              <DeviceAutocomplete
                value={editedTicket.deviceLabel || ""}
                onChange={(value) => setEditedTicket((p) => ({ ...p, deviceLabel: value }))}
                models={modelsWithHierarchy}
                error={undefined}
              />
            </div>
            <div>
              <div style={fieldLabel}>Sériové číslo / IMEI</div>
              <input
                type="text"
                value={editedTicket.serialOrImei || ""}
                onChange={(e) => setEditedTicket((p) => ({ ...p, serialOrImei: e.target.value }))}
                style={baseFieldInput}
                placeholder="SN123456789"
              />
            </div>
            <div>
              <div style={fieldLabel}>Záruka</div>
              <label style={{ display: "inline-flex", alignItems: "center", gap: 8, fontSize: 13, cursor: "pointer", minHeight: 36 }}>
                <input
                  type="checkbox"
                  checked={editedTicket.warrantyClaim === true}
                  onChange={(e) => setEditedTicket((p) => ({ ...p, warrantyClaim: e.target.checked }))}
                />
                Záruční oprava
              </label>
            </div>
            {editedTicket.warrantyClaim === true && (
              <>
                <div>
                  <div style={fieldLabel}>Datum nákupu</div>
                  <input
                    type="date"
                    value={editedTicket.purchaseDate || ""}
                    max={new Date().toISOString().slice(0, 10)}
                    onChange={(e) => setEditedTicket((p) => ({ ...p, purchaseDate: e.target.value }))}
                    style={baseFieldInput}
                  />
                </div>
                <div>
                  <div style={fieldLabel}>Doklad o koupi</div>
                  <input
                    type="text"
                    value={editedTicket.purchaseProof || ""}
                    onChange={(e) => setEditedTicket((p) => ({ ...p, purchaseProof: e.target.value }))}
                    style={baseFieldInput}
                    placeholder="Číslo účtenky, faktura"
                  />
                  {chybiPodkladZaruky(editedTicket) && <div style={fieldMuted}>U záruční opravy vyplňte datum nákupu nebo doklad o koupi.</div>}
                </div>
              </>
            )}
            <div>
              <div style={fieldLabel}>Záruka na opravu do</div>
              {/* Doplní se samo při vydání (datum vydání + nejdelší záruka
                  z provedených oprav); tady jde přepsat nebo smazat. */}
              <input
                type="date"
                value={(editedTicket.warrantyUntil !== undefined ? editedTicket.warrantyUntil : detailedTicket.warrantyUntil) || ""}
                onChange={(e) => setEditedTicket((p) => ({ ...p, warrantyUntil: e.target.value || null }))}
                style={baseFieldInput}
                aria-label="Záruka na provedenou opravu platí do"
              />
              <div style={fieldMuted}>Vyplní se samo při vydání zakázky podle záruky oprav.</div>
            </div>
            <div>
              <div style={fieldLabel}>Požadovaná oprava *</div>
              <input
                type="text"
                value={editedTicket.requestedRepair || ""}
                onChange={(e) => setEditedTicket((p) => ({ ...p, requestedRepair: e.target.value }))}
                style={baseFieldInput}
                placeholder="Popis požadované opravy"
              />
            </div>
            <div>
              <div style={fieldLabel}>Heslo/kód zařízení</div>
              <input
                type="text"
                value={editedTicket.devicePasscode || ""}
                onChange={(e) => setEditedTicket((p) => ({ ...p, devicePasscode: e.target.value }))}
                style={baseFieldInput}
                placeholder="Heslo nebo kód"
              />
            </div>
            <div>
              <div style={fieldLabel}>Popis stavu zařízení</div>
              <input
                list="edit-device-condition-list"
                value={editedTicket.deviceCondition || ""}
                onChange={(e) => setEditedTicket((p) => ({ ...p, deviceCondition: e.target.value }))}
                style={baseFieldInput}
                placeholder="Vyberte nebo napište vlastní..."
              />
              <datalist id="edit-device-condition-list">
                {getDeviceOptions().deviceConditions.map((c, i) => (
                  <option key={i} value={c} />
                ))}
              </datalist>
            </div>
            <div>
              <div style={fieldLabel}>Příslušenství</div>
              <input
                list="edit-device-accessories-list"
                value={editedTicket.deviceAccessories || ""}
                onChange={(e) => setEditedTicket((p) => ({ ...p, deviceAccessories: e.target.value }))}
                style={baseFieldInput}
                placeholder="Vyberte nebo napište vlastní..."
              />
              <datalist id="edit-device-accessories-list">
                {getDeviceOptions().deviceAccessories.map((a, i) => (
                  <option key={i} value={a} />
                ))}
              </datalist>
            </div>
            <div>
              <div style={fieldLabel}>Poznámka k zařízení</div>
              <textarea
                value={editedTicket.deviceNote || ""}
                onChange={(e) => setEditedTicket((p) => ({ ...p, deviceNote: e.target.value }))}
                style={baseFieldTextArea}
                placeholder="Dodatečné poznámky k zařízení..."
              />
            </div>
            <div>
              <div style={fieldLabel}>Způsob převzetí</div>
              <HandoffMethodSelect
                options={getHandoffOptions().receiveMethods}
                value={editedTicket.handoffMethod || ""}
                onChange={(v) => setEditedTicket((p) => ({ ...p, handoffMethod: v }))}
                extraOption={editedTicket.handoffMethod || undefined}
                triggerStyle={baseFieldInput}
              />
            </div>
            <div>
              <div style={fieldLabel}>Způsob předání</div>
              <HandoffMethodSelect
                options={getHandoffOptions().returnMethods}
                value={editedTicket.handbackMethod || ""}
                onChange={(v) => setEditedTicket((p) => ({ ...p, handbackMethod: v }))}
                extraOption={editedTicket.handbackMethod || undefined}
                triggerStyle={baseFieldInput}
              />
            </div>
            <div>
              <div style={fieldLabel}>Externí ID</div>
              <input
                type="text"
                value={editedTicket.externalId || ""}
                onChange={(e) => setEditedTicket((p) => ({ ...p, externalId: e.target.value }))}
                style={baseFieldInput}
                placeholder="Externí identifikátor"
              />
            </div>
            <div>
              <div style={fieldLabel}>Předpokládané datum/čas dokončení</div>
              <DateTimePicker
                value={
                  (editedTicket as any).expectedCompletionAt ?? (detailedTicket as any).expected_completion_at ?? null
                }
                onChange={(v) =>
                  setEditedTicket((p) => ({
                    ...p,
                    expectedCompletionAt: v,
                  } as any))
                }
                inputStyle={baseFieldInput}
              />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
