import React, { useEffect, useMemo, useState } from "react";
import { useStatuses } from "../../../state/StatusesStore";
import { useWarrantyClaims } from "../hooks/useWarrantyClaims";
import type { TicketEx } from "../../Orders";
import type { WarrantyClaimInsert } from "../hooks/useWarrantyClaims";

type CreateWarrantyClaimModalProps = {
  open: boolean;
  onClose: () => void;
  activeServiceId: string | null;
  tickets: TicketEx[];
  existingClaimCodes: { code: string | null }[];
  onCreated?: (claimCode: string, claim?: import("../hooks/useWarrantyClaims").WarrantyClaimRow) => void;
};

/** Draft pro údaje zákazníka a zařízení (jako u nové zakázky), editovatelné před odesláním */
type ClaimDraft = {
  customer_name: string;
  customer_phone: string;
  customer_email: string;
  customer_address_street: string;
  customer_address_city: string;
  customer_address_zip: string;
  customer_company: string;
  customer_ico: string;
  customer_info: string;
  device_label: string;
  device_serial: string;
  device_passcode: string;
  device_condition: string;
  device_accessories: string;
  device_note: string;
};

const emptyDraft: ClaimDraft = {
  customer_name: "",
  customer_phone: "",
  customer_email: "",
  customer_address_street: "",
  customer_address_city: "",
  customer_address_zip: "",
  customer_company: "",
  customer_ico: "",
  customer_info: "",
  device_label: "",
  device_serial: "",
  device_passcode: "",
  device_condition: "",
  device_accessories: "",
  device_note: "",
};

function ticketToDraft(t: TicketEx): ClaimDraft {
  return {
    customer_name: t.customerName ?? "",
    customer_phone: t.customerPhone ?? "",
    customer_email: t.customerEmail ?? "",
    customer_address_street: t.customerAddressStreet ?? "",
    customer_address_city: t.customerAddressCity ?? "",
    customer_address_zip: t.customerAddressZip ?? "",
    customer_company: t.customerCompany ?? "",
    customer_ico: t.customerIco ?? "",
    customer_info: t.customerInfo ?? "",
    device_label: t.deviceLabel ?? "",
    device_serial: t.serialOrImei ?? "",
    device_passcode: t.devicePasscode ?? "",
    device_condition: t.deviceCondition ?? "",
    device_accessories: t.deviceAccessories ?? "",
    device_note: t.deviceNote ?? "",
  };
}

function draftToPayload(d: ClaimDraft): Partial<WarrantyClaimInsert> {
  return {
    customer_name: d.customer_name.trim() || null,
    customer_phone: d.customer_phone.trim() || null,
    customer_email: d.customer_email.trim() || null,
    customer_address_street: d.customer_address_street.trim() || null,
    customer_address_city: d.customer_address_city.trim() || null,
    customer_address_zip: d.customer_address_zip.trim() || null,
    customer_company: d.customer_company.trim() || null,
    customer_ico: d.customer_ico.trim() || null,
    customer_info: d.customer_info.trim() || null,
    device_label: d.device_label.trim() || null,
    device_serial: d.device_serial.trim() || null,
    device_passcode: d.device_passcode.trim() || null,
    device_condition: d.device_condition.trim() || null,
    device_accessories: d.device_accessories.trim() || null,
    device_note: d.device_note.trim() || null,
  };
}

const inputStyle: React.CSSProperties = {
  width: "100%",
  padding: "10px 12px",
  borderRadius: 10,
  border: "1px solid var(--border)",
  background: "var(--panel-2)",
  color: "var(--text)",
  fontSize: 13,
};

export function CreateWarrantyClaimModal({
  open,
  onClose,
  activeServiceId,
  tickets,
  existingClaimCodes,
  onCreated,
}: CreateWarrantyClaimModalProps) {
  const { statuses } = useStatuses();
  const { createFromTicket, createWithoutTicket } = useWarrantyClaims(activeServiceId);
  const [query, setQuery] = useState("");
  const [selectedTicket, setSelectedTicket] = useState<TicketEx | null>(null);
  const [withoutTicket, setWithoutTicket] = useState(false);
  const [draft, setDraft] = useState<ClaimDraft>(() => emptyDraft);
  const [notes, setNotes] = useState("");
  const [creating, setCreating] = useState(false);

  const statusReceived = useMemo(() => statuses.some((s) => s.key === "received") ? "received" : statuses[0]?.key ?? "received", [statuses]);

  useEffect(() => {
    if (selectedTicket) {
      setDraft(ticketToDraft(selectedTicket));
    } else if (withoutTicket) {
      setDraft(emptyDraft);
    }
  }, [selectedTicket, withoutTicket]);

  const matchingTickets = useMemo(() => {
    if (!query.trim()) return tickets.slice(0, 20);
    const q = query.trim().toLowerCase();
    return tickets
      .filter(
        (t) =>
          (t.code?.toLowerCase().includes(q)) ||
          (t.customerName?.toLowerCase().includes(q)) ||
          (t.serialOrImei?.toLowerCase().includes(q)) ||
          (t.customerPhone?.replace(/\s/g, "").includes(q.replace(/\s/g, "")))
      )
      .slice(0, 20);
  }, [query, tickets]);

  const handleCreateFromTicket = async () => {
    if (!selectedTicket) return;
    setCreating(true);
    try {
      const claim = await createFromTicket(
        selectedTicket,
        statusReceived,
        notes,
        existingClaimCodes,
        draftToPayload(draft)
      );
      if (claim) {
        onCreated?.(claim.code, claim);
        handleClose();
      }
    } finally {
      setCreating(false);
    }
  };

  const handleCreateWithoutTicket = async () => {
    setCreating(true);
    try {
      const claim = await createWithoutTicket(
        statusReceived,
        notes,
        draftToPayload(draft),
        existingClaimCodes
      );
      if (claim) {
        onCreated?.(claim.code, claim);
        handleClose();
      }
    } finally {
      setCreating(false);
    }
  };

  const handleClose = () => {
    setSelectedTicket(null);
    setWithoutTicket(false);
    setQuery("");
    setDraft(emptyDraft);
    setNotes("");
    onClose();
  };

  const updateDraft = (key: keyof ClaimDraft, value: string) => {
    setDraft((prev) => ({ ...prev, [key]: value }));
  };

  if (!open) return null;

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 10000,
        background: "rgba(0,0,0,0.5)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 24,
      }}
      onClick={handleClose}
    >
      <div
        style={{
          background: "var(--panel)",
          borderRadius: 16,
          boxShadow: "0 20px 60px rgba(0,0,0,0.2)",
          maxWidth: 560,
          width: "100%",
          maxHeight: "90vh",
          overflow: "auto",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div style={{ padding: 20, borderBottom: "1px solid var(--border)" }}>
          <h2 style={{ margin: 0, fontSize: 18, fontWeight: 700, color: "var(--text)" }}>Vytvořit reklamaci</h2>
          <p style={{ margin: "8px 0 0", fontSize: 13, color: "var(--muted)" }}>
            Vyhledejte zakázku nebo založte reklamaci bez zakázky. Údaje zákazníka a zařízení můžete upravit. Stav bude automaticky „Přijato“.
          </p>
        </div>

        <div style={{ padding: 20 }}>
          {!selectedTicket && !withoutTicket ? (
            <>
              <input
                type="text"
                placeholder="Vyhledat zakázku (kód, zákazník, SN, telefon…)"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                style={{ ...inputStyle, marginBottom: 12 }}
              />
              <div style={{ maxHeight: 220, overflowY: "auto", marginBottom: 12 }}>
                {matchingTickets.length === 0 ? (
                  <div style={{ padding: 16, color: "var(--muted)", fontSize: 13 }}>
                    {query.trim() ? "Žádná zakázka nevyhovuje. Zadejte jiný výraz nebo založte reklamaci bez zakázky." : "Zadejte hledaný výraz nebo založte reklamaci bez zakázky."}
                  </div>
                ) : (
                  matchingTickets.map((t) => (
                    <button
                      key={t.id}
                      type="button"
                      onClick={() => setSelectedTicket(t)}
                      style={{
                        display: "block",
                        width: "100%",
                        padding: "12px 14px",
                        textAlign: "left",
                        border: "1px solid var(--border)",
                        borderRadius: 10,
                        background: "var(--panel-2)",
                        color: "var(--text)",
                        fontSize: 13,
                        marginBottom: 6,
                        cursor: "pointer",
                      }}
                    >
                      <span style={{ fontWeight: 600 }}>{t.code ?? "—"}</span>
                      {" · "}
                      {t.customerName ?? "—"}
                      {t.deviceLabel ? ` · ${t.deviceLabel}` : ""}
                    </button>
                  ))
                )}
              </div>
              <button
                type="button"
                onClick={() => setWithoutTicket(true)}
                style={{
                  padding: "10px 16px",
                  borderRadius: 10,
                  border: "1px solid var(--border)",
                  background: "transparent",
                  color: "var(--muted)",
                  fontSize: 13,
                  cursor: "pointer",
                }}
              >
                Reklamace bez propojení na zakázku
              </button>
            </>
          ) : (
            <>
              <div style={{ marginBottom: 16, display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 8 }}>
                {selectedTicket ? (
                  <span style={{ fontSize: 13, color: "var(--muted)" }}>
                    Zakázka: <strong style={{ color: "var(--text)" }}>{selectedTicket.code}</strong>
                  </span>
                ) : (
                  <span style={{ fontSize: 13, color: "var(--muted)" }}>Bez propojení na zakázku</span>
                )}
                <button
                  type="button"
                  onClick={() => { setSelectedTicket(null); setWithoutTicket(false); }}
                  style={{ fontSize: 12, color: "var(--accent)", background: "none", border: "none", cursor: "pointer", padding: 4 }}
                >
                  Zpět na výběr
                </button>
              </div>

              <div style={{ fontSize: 12, color: "var(--muted)", marginBottom: 12, padding: "8px 10px", background: "rgba(234,179,8,0.08)", borderRadius: 8, border: "1px solid rgba(234,179,8,0.3)" }}>
                Stav reklamace: <strong>Přijato</strong> (automaticky)
              </div>

              {/* Zákazník */}
              <div style={{ marginBottom: 16 }}>
                <div style={{ fontSize: 14, fontWeight: 700, color: "var(--text)", marginBottom: 10 }}>Zákazník</div>
                <div style={{ display: "grid", gap: 10 }}>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                    <div>
                      <label style={{ display: "block", fontSize: 12, color: "var(--muted)", marginBottom: 4 }}>Jméno</label>
                      <input type="text" value={draft.customer_name} onChange={(e) => updateDraft("customer_name", e.target.value)} placeholder="Jméno zákazníka" style={inputStyle} />
                    </div>
                    <div>
                      <label style={{ display: "block", fontSize: 12, color: "var(--muted)", marginBottom: 4 }}>Firma</label>
                      <input type="text" value={draft.customer_company} onChange={(e) => updateDraft("customer_company", e.target.value)} placeholder="Název firmy" style={inputStyle} />
                    </div>
                  </div>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                    <div>
                      <label style={{ display: "block", fontSize: 12, color: "var(--muted)", marginBottom: 4 }}>Telefon</label>
                      <input type="tel" value={draft.customer_phone} onChange={(e) => updateDraft("customer_phone", e.target.value)} style={inputStyle} />
                    </div>
                    <div>
                      <label style={{ display: "block", fontSize: 12, color: "var(--muted)", marginBottom: 4 }}>E-mail</label>
                      <input type="email" value={draft.customer_email} onChange={(e) => updateDraft("customer_email", e.target.value)} style={inputStyle} />
                    </div>
                  </div>
                  <div>
                    <label style={{ display: "block", fontSize: 12, color: "var(--muted)", marginBottom: 4 }}>Ulice a číslo</label>
                    <input type="text" value={draft.customer_address_street} onChange={(e) => updateDraft("customer_address_street", e.target.value)} placeholder="Ulice, č.p." style={inputStyle} />
                  </div>
                  <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr", gap: 10 }}>
                    <div>
                      <label style={{ display: "block", fontSize: 12, color: "var(--muted)", marginBottom: 4 }}>Město</label>
                      <input type="text" value={draft.customer_address_city} onChange={(e) => updateDraft("customer_address_city", e.target.value)} style={inputStyle} />
                    </div>
                    <div>
                      <label style={{ display: "block", fontSize: 12, color: "var(--muted)", marginBottom: 4 }}>PSČ</label>
                      <input type="text" value={draft.customer_address_zip} onChange={(e) => updateDraft("customer_address_zip", e.target.value)} style={inputStyle} />
                    </div>
                  </div>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                    <div>
                      <label style={{ display: "block", fontSize: 12, color: "var(--muted)", marginBottom: 4 }}>IČO</label>
                      <input type="text" value={draft.customer_ico} onChange={(e) => updateDraft("customer_ico", e.target.value)} style={inputStyle} />
                    </div>
                    <div>
                      <label style={{ display: "block", fontSize: 12, color: "var(--muted)", marginBottom: 4 }}>Poznámka k zákazníkovi</label>
                      <input type="text" value={draft.customer_info} onChange={(e) => updateDraft("customer_info", e.target.value)} style={inputStyle} />
                    </div>
                  </div>
                </div>
              </div>

              {/* Zařízení */}
              <div style={{ marginBottom: 16 }}>
                <div style={{ fontSize: 14, fontWeight: 700, color: "var(--text)", marginBottom: 10 }}>Zařízení</div>
                <div style={{ display: "grid", gap: 10 }}>
                  <div>
                    <label style={{ display: "block", fontSize: 12, color: "var(--muted)", marginBottom: 4 }}>Zařízení / popis</label>
                    <input type="text" value={draft.device_label} onChange={(e) => updateDraft("device_label", e.target.value)} placeholder="např. iPhone 13, notebook" style={inputStyle} />
                  </div>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                    <div>
                      <label style={{ display: "block", fontSize: 12, color: "var(--muted)", marginBottom: 4 }}>Sériové číslo / IMEI</label>
                      <input type="text" value={draft.device_serial} onChange={(e) => updateDraft("device_serial", e.target.value)} style={inputStyle} />
                    </div>
                    <div>
                      <label style={{ display: "block", fontSize: 12, color: "var(--muted)", marginBottom: 4 }}>Heslo / kód</label>
                      <input type="text" value={draft.device_passcode} onChange={(e) => updateDraft("device_passcode", e.target.value)} style={inputStyle} />
                    </div>
                  </div>
                  <div>
                    <label style={{ display: "block", fontSize: 12, color: "var(--muted)", marginBottom: 4 }}>Stav zařízení</label>
                    <input type="text" value={draft.device_condition} onChange={(e) => updateDraft("device_condition", e.target.value)} placeholder="např. poškozený displej" style={inputStyle} />
                  </div>
                  <div>
                    <label style={{ display: "block", fontSize: 12, color: "var(--muted)", marginBottom: 4 }}>Příslušenství</label>
                    <input type="text" value={draft.device_accessories} onChange={(e) => updateDraft("device_accessories", e.target.value)} style={inputStyle} />
                  </div>
                  <div>
                    <label style={{ display: "block", fontSize: 12, color: "var(--muted)", marginBottom: 4 }}>Poznámka k zařízení</label>
                    <input type="text" value={draft.device_note} onChange={(e) => updateDraft("device_note", e.target.value)} style={inputStyle} />
                  </div>
                </div>
              </div>

              <div style={{ marginBottom: 16 }}>
                <label style={{ display: "block", fontSize: 13, fontWeight: 600, marginBottom: 6, color: "var(--text)" }}>Poznámka / důvod reklamace</label>
                <textarea
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  rows={3}
                  placeholder="Volitelně"
                  style={{ ...inputStyle, resize: "vertical" }}
                />
              </div>

              <div style={{ display: "flex", gap: 10, justifyContent: "flex-end", flexWrap: "wrap" }}>
                <button type="button" onClick={handleClose} style={{ padding: "10px 18px", borderRadius: 10, border: "1px solid var(--border)", background: "var(--panel-2)", color: "var(--text)", cursor: "pointer" }}>
                  Zrušit
                </button>
                <button
                  type="button"
                  disabled={creating}
                  onClick={selectedTicket ? handleCreateFromTicket : handleCreateWithoutTicket}
                  style={{ padding: "10px 18px", borderRadius: 10, border: "none", background: "var(--accent)", color: "white", fontWeight: 600, cursor: creating ? "not-allowed" : "pointer" }}
                >
                  {creating ? "Vytvářím…" : "Vytvořit reklamaci"}
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
