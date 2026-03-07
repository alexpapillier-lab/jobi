import { useState, useMemo, useEffect } from "react";
import { ConfirmDialog } from "../../components/ConfirmDialog";
import { useStatuses } from "../../state/StatusesStore";
import { CustomerRecord } from "./CustomerList";
import { useCustomerActions } from "./hooks/useCustomerActions";

type TicketLite = {
  id: string;
  code: string;
  deviceLabel: string;
  serialOrImei?: string;
  issueShort: string;
  createdAt: string;
  status: string;
};

type EditDraft = {
  name: string;
  phone: string;
  email: string;
  addressStreet: string;
  addressCity: string;
  addressZip: string;
  company: string;
  ico: string;
  info: string;
};

type CustomerHistoryEntry = {
  id: string;
  changed_at: string;
  changed_by: string | null;
  change_type: string;
  diff: Record<string, { old: any; new: any }>;
};

function formatCZ(dtIso: string) {
  const d = new Date(dtIso);
  return d.toLocaleString("cs-CZ", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function isEmailValid(v: string) {
  const s = v.trim();
  if (!s) return true;
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s);
}
function isPhoneValid(v: string) {
  const s = v.trim();
  if (!s) return true;
  const digits = s.replace(/[^\d]/g, "");
  return digits.length >= 9 && digits.length <= 15;
}
function isZipValid(v: string) {
  const s = v.trim();
  if (!s) return true;
  const digits = s.replace(/[^\d]/g, "");
  return digits.length === 5;
}
function isIcoValid(v: string) {
  const s = v.trim();
  if (!s) return true;
  const digits = s.replace(/[^\d]/g, "");
  return digits.length === 8;
}

function draftFromCustomer(c: CustomerRecord): EditDraft {
  return {
    name: c.name ?? "",
    phone: c.phone ?? "",
    email: c.email ?? "",
    addressStreet: c.addressStreet ?? "",
    addressCity: c.addressCity ?? "",
    addressZip: c.addressZip ?? "",
    company: c.company ?? "",
    ico: c.ico ?? "",
    info: c.info ?? "",
  };
}

type CustomerDetailProps = {
  customer: CustomerRecord | null;
  tickets: TicketLite[];
  ticketsLoading: boolean;
  customerHistory: CustomerHistoryEntry[];
  customerHistoryLoading: boolean;
  activeServiceId: string | null;
  onOpenTicket: (ticketId: string, mode?: "panel" | "detail", returnToCustomerId?: string) => void;
  onSave: (updatedCustomer: CustomerRecord, finalCustomerId: string) => void;
  onDelete: (customerId: string) => void;
  onHistoryRefresh?: () => void;
};

export function CustomerDetail({
  customer,
  tickets,
  ticketsLoading,
  customerHistory,
  customerHistoryLoading,
  activeServiceId,
  onOpenTicket,
  onSave,
  onDelete,
  onHistoryRefresh,
}: CustomerDetailProps) {
  const { getByKey } = useStatuses();
  const normalizeStatus = (key: string): string | null => {
    if (!key || typeof key !== "string") return null;
    const trimmed = key.trim();
    return trimmed || null;
  };

  const { saveEdit: saveEditFromHook } = useCustomerActions({
    activeServiceId,
    onSave,
  });

  const [editOpen, setEditOpen] = useState(false);
  const [submitAttempted, setSubmitAttempted] = useState(false);
  const [editDraft, setEditDraft] = useState<EditDraft>({
    name: "",
    phone: "",
    email: "",
    addressStreet: "",
    addressCity: "",
    addressZip: "",
    company: "",
    ico: "",
    info: "",
  });

  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [deleteCustomerId, setDeleteCustomerId] = useState<string | null>(null);

  useEffect(() => {
    if (!editOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        setEditOpen(false);
      }
    };
    document.addEventListener("keydown", onKey, true);
    return () => document.removeEventListener("keydown", onKey, true);
  }, [editOpen]);

  const openEdit = () => {
    if (!customer) return;
    setSubmitAttempted(false);
    setEditDraft(draftFromCustomer(customer));
    setEditOpen(true);
  };

  const errors = useMemo(() => {
    const e: Record<string, string> = {};
    if (!editDraft.name.trim()) e.name = "Jméno je povinné.";
    if (!isPhoneValid(editDraft.phone)) e.phone = "Telefon vypadá neplatně.";
    if (!isEmailValid(editDraft.email)) e.email = "E-mail vypadá neplatně.";
    if (!isZipValid(editDraft.addressZip)) e.zip = "PSČ musí mít 5 číslic.";
    if (!isIcoValid(editDraft.ico)) e.ico = "IČO musí mít 8 číslic.";
    return e;
  }, [editDraft]);

  const canSave = Object.keys(errors).length === 0;

  const border = "1px solid var(--border)";
  const borderError = "1px solid rgba(239,68,68,0.9)";

  const saveEdit = async () => {
    if (!customer) return;
    setSubmitAttempted(true);
    if (!canSave) return;

    const success = await saveEditFromHook(customer, editDraft, (draft) => {
      setEditDraft(draft);
    });

    // Only close modal if save was successful
    if (!success) {
      return; // Error or conflict - don't close modal
    }

    setEditOpen(false);
    setSubmitAttempted(false);

    // Refresh customer history after successful update
    if (customer.id && activeServiceId && onHistoryRefresh) {
      onHistoryRefresh();
    }
  };

  // Sort tickets by creation date
  const sortedTickets = useMemo(() => {
    return [...tickets].sort((a, b) => (b.createdAt ?? "").localeCompare(a.createdAt ?? ""));
  }, [tickets]);

  return (
    <>
        {/* Detail */}
        <div
          style={{
            border: border,
            borderRadius: "var(--radius-lg)",
            background: "var(--panel)",
            backdropFilter: "var(--blur)",
            WebkitBackdropFilter: "var(--blur)",
            boxShadow: "var(--shadow-soft)",
            padding: 14,
            minHeight: 240,
          }}
        >
          {!customer ? (
            <div style={{ color: "var(--muted)" }}>Vyber zákazníka vlevo.</div>
          ) : (
            <>
              <div style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "flex-start" }}>
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontWeight: 900, fontSize: 16 }}>{customer.name}</div>
                  <div style={{ color: "var(--muted)", marginTop: 4, fontSize: 12 }}>
                    {[customer.phone, customer.email].filter(Boolean).join(" · ")}
                  </div>
                  <div style={{ color: "var(--muted)", marginTop: 4, fontSize: 12 }}>
                    {[customer.company, customer.ico].filter(Boolean).join(" · ")}
                  </div>
                  <div style={{ color: "var(--muted)", marginTop: 4, fontSize: 12 }}>
                    {[customer.addressStreet, customer.addressCity, customer.addressZip].filter(Boolean).join(", ")}
                  </div>
                </div>

                <div style={{ display: "grid", gap: 8, justifyItems: "end" }}>
                  <div style={{ color: "var(--muted)", fontSize: 12, fontWeight: 800, whiteSpace: "nowrap" }}>
                    Aktualizováno: {formatCZ(customer.updatedAt)}
                  </div>

                  <div style={{ display: "flex", gap: 10 }}>
                    <button
                      onClick={openEdit}
                      style={{
                        padding: "10px 12px",
                        borderRadius: 12,
                        border: border,
                        background: "var(--panel)",
                        backdropFilter: "var(--blur)",
                        WebkitBackdropFilter: "var(--blur)",
                        color: "var(--text)",
                        fontWeight: 900,
                        cursor: "pointer",
                        boxShadow: "var(--shadow-soft)",
                        transition: "var(--transition-smooth)",
                      }}
                    >
                      Upravit
                    </button>

                    <button
                      onClick={() => {
                        setDeleteCustomerId(customer.id);
                        setDeleteDialogOpen(true);
                      }}
                      style={{
                        padding: "10px 12px",
                        borderRadius: 12,
                        border: "1px solid rgba(239,68,68,0.3)",
                        background: "rgba(239,68,68,0.1)",
                        color: "rgba(239,68,68,0.9)",
                        fontWeight: 900,
                        cursor: "pointer",
                        boxShadow: "var(--shadow-soft)",
                        transition: "var(--transition-smooth)",
                      }}
                    >
                      Smazat
                    </button>

                    <button
                      onClick={() =>
                        window.dispatchEvent(
                          new CustomEvent("jobsheet:request-new-order", { detail: { customerId: customer.id } })
                        )
                      }
                      style={{
                        padding: "10px 12px",
                        borderRadius: 12,
                        border: border,
                        background: "var(--accent)",
                        color: "white",
                        fontWeight: 900,
                        cursor: "pointer",
                        boxShadow: "var(--shadow-soft)",
                      }}
                    >
                      + Vytvořit zakázku
                    </button>
                  </div>
                </div>
              </div>

              {customer.info && (
                <div
                  style={{
                    marginTop: 12,
                    border: border,
                    borderRadius: 12,
                    background: "var(--panel)",
                    backdropFilter: "var(--blur)",
                    WebkitBackdropFilter: "var(--blur)",
                    padding: 12,
                    color: "var(--text)",
                    boxShadow: "var(--shadow-soft)",
                  }}
                >
                  <div style={{ fontWeight: 900, fontSize: 12, color: "var(--muted)" }}>Informace</div>
                  <div style={{ marginTop: 6 }}>{customer.info}</div>
                </div>
              )}

              <div style={{ marginTop: 12, fontWeight: 900, fontSize: 13 }}>Zakázky</div>

              {ticketsLoading && (
                <div style={{ padding: 16, textAlign: "center", color: "var(--muted)", fontSize: 13 }}>
                  Načítání zakázek...
                </div>
              )}

              {!ticketsLoading && (
              <div style={{ marginTop: 8, display: "grid", gap: 10 }}>
                {sortedTickets.map((t) => {
                  const currentStatus = normalizeStatus(t.status);
                  const meta = currentStatus !== null ? getByKey(currentStatus) : null;

                  return (
                    <button
                      key={t.id}
                      onClick={() => onOpenTicket(t.id, "detail", customer?.id || undefined)}
                      style={{
                        textAlign: "left",
                        border: meta?.bg ? `2px solid ${meta.bg}80` : border,
                        borderRadius: 14,
                        background: meta?.bg ? `${meta.bg}30` : "var(--panel)",
                        backdropFilter: "var(--blur)",
                        WebkitBackdropFilter: "var(--blur)",
                        padding: 0,
                        cursor: "pointer",
                        color: "var(--text)",
                        boxShadow: meta?.bg ? `0 4px 16px ${meta.bg}40, 0 0 0 1px ${meta.bg}20` : "var(--shadow-soft)",
                        transition: "var(--transition-smooth)",
                        display: "flex",
                        position: "relative",
                        overflow: "hidden",
                      }}
                      onMouseEnter={(e) => {
                        e.currentTarget.style.transform = "translateY(-1px)";
                        e.currentTarget.style.boxShadow = meta?.bg ? `0 6px 20px ${meta.bg}50, 0 0 0 1px ${meta.bg}30` : "var(--shadow-hover)";
                      }}
                      onMouseLeave={(e) => {
                        e.currentTarget.style.transform = "translateY(0)";
                        e.currentTarget.style.boxShadow = meta?.bg ? `0 4px 16px ${meta.bg}40, 0 0 0 1px ${meta.bg}20` : "var(--shadow-soft)";
                      }}
                      title="Otevřít zakázku"
                    >
                      <div
                        style={{
                          width: 10,
                          background: meta?.bg || "var(--border)",
                          flexShrink: 0,
                          boxShadow: meta?.bg ? `0 0 24px ${meta.bg}90, inset 0 0 12px ${meta.bg}60, 0 0 8px ${meta.bg}50` : "none",
                        }}
                      />
                      <div style={{ flex: 1, padding: 12 }}>
                        <div style={{ display: "flex", justifyContent: "space-between", gap: 10 }}>
                          <div style={{ fontWeight: 900 }}>{t.code}</div>
                          <div style={{ color: "var(--muted)", fontSize: 12 }}>{formatCZ(t.createdAt)}</div>
                        </div>
                        <div style={{ marginTop: 6, fontWeight: 850 }}>{t.deviceLabel}</div>
                        <div style={{ marginTop: 4, color: "var(--muted)", fontSize: 12 }}>
                          {[t.serialOrImei, meta?.label || t.status].filter(Boolean).join(" · ")}
                        </div>
                        <div style={{ marginTop: 6, opacity: 0.92 }}>{t.issueShort}</div>
                      </div>
                    </button>
                  );
                })}

                {sortedTickets.length === 0 && <div style={{ color: "var(--muted)" }}>Zatím žádné zakázky.</div>}
              </div>
              )}

              {/* Customer History */}
              <div style={{ marginTop: 12 }}>
                <div style={{ fontWeight: 900, fontSize: 13, marginBottom: 8 }}>Historie změn</div>
                {customerHistoryLoading ? (
                  <div style={{ padding: 16, textAlign: "center", color: "var(--muted)", fontSize: 13 }}>
                    Načítání historie...
                  </div>
                ) : customerHistory.length === 0 ? (
                  <div style={{ padding: 16, textAlign: "center", color: "var(--muted)", fontSize: 13 }}>
                    Zatím žádné změny.
                  </div>
                ) : (
                  <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                    {customerHistory.map((entry) => {
                      const fieldLabels: Record<string, string> = {
                        name: "Jméno",
                        phone: "Telefon",
                        email: "E-mail",
                        address_street: "Ulice",
                        address_city: "Město",
                        address_zip: "PSČ",
                        company: "Firma",
                        ico: "IČO",
                        note: "Poznámka",
                      };

                      return (
                        <div
                          key={entry.id}
                          style={{
                            border: border,
                            borderRadius: 8,
                            background: "var(--panel)",
                            backdropFilter: "var(--blur)",
                            WebkitBackdropFilter: "var(--blur)",
                            padding: 12,
                            color: "var(--text)",
                            boxShadow: "var(--shadow-soft)",
                          }}
                        >
                          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12 }}>
                            <div style={{ flex: 1 }}>
                              <div style={{ fontWeight: 900, fontSize: 12, color: "var(--text)" }}>
                                Změna údajů zákazníka
                              </div>
                              <div style={{ fontSize: 11, color: "var(--muted)", marginTop: 4 }}>
                                {formatCZ(entry.changed_at)}
                              </div>
                            </div>
                          </div>
                          <div style={{ marginTop: 10, display: "flex", flexDirection: "column", gap: 6 }}>
                            {Object.entries(entry.diff || {}).map(([field, change]) => (
                              <div key={field} style={{ fontSize: 12 }}>
                                <div style={{ fontWeight: 700, color: "var(--muted)", marginBottom: 2 }}>
                                  {fieldLabels[field] || field}
                                </div>
                                <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                                  <span style={{ color: "var(--text)", textDecoration: change.old ? "none" : "line-through" }}>
                                    {change.old || "(prázdné)"}
                                  </span>
                                  <span style={{ color: "var(--muted)" }}>→</span>
                                  <span style={{ color: "var(--accent)", fontWeight: 600 }}>
                                    {change.new || "(prázdné)"}
                                  </span>
                                </div>
                              </div>
                            ))}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </>
          )}
        </div>
      {/* ===== Edit customer modal ===== */}
      <div
        onClick={() => setEditOpen(false)}
        style={{
          position: "fixed",
          inset: 0,
          background: "rgba(0,0,0,0.35)",
          opacity: editOpen ? 1 : 0,
          pointerEvents: editOpen ? "auto" : "none",
          transition: "opacity 180ms ease",
          zIndex: 200,
        }}
      />

      <div
        style={{
          position: "fixed",
          left: "50%",
          top: "50%",
          transform: editOpen ? "translate(-50%, -50%) scale(1)" : "translate(-50%, -48%) scale(0.98)",
          opacity: editOpen ? 1 : 0,
          pointerEvents: editOpen ? "auto" : "none",
          transition: "transform 180ms ease, opacity 180ms ease",
          width: 820,
          maxWidth: "calc(100vw - 24px)",
          maxHeight: "calc(100vh - 24px)",
          overflow: "auto",
          background: "var(--panel)",
          backdropFilter: "var(--blur)",
          WebkitBackdropFilter: "var(--blur)",
          border: border,
          borderRadius: "var(--radius-lg)",
          boxShadow: "var(--shadow)",
          padding: 18,
          zIndex: 210,
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* (zbytek tvého modalu nechávám beze změn) */}
        <div style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "center" }}>
          <div>
            <div style={{ fontWeight: 900, fontSize: 16 }}>Upravit zákazníka</div>
            <div style={{ color: "var(--muted)", fontSize: 12, marginTop: 4 }}>Ukládá se do localStorage.</div>
          </div>
          <button
            onClick={() => setEditOpen(false)}
            style={{
              padding: "10px 12px",
              borderRadius: 12,
              border: border,
              background: "var(--panel)",
              color: "var(--text)",
              fontWeight: 900,
              cursor: "pointer",
            }}
          >
            Zavřít
          </button>
        </div>

        {/* --- form (beze změn, jen zkráceno v komentáři) --- */}
        <div style={{ marginTop: 14 }}>
          <div style={{ fontSize: 12, color: "var(--muted)" }}>Jméno a příjmení *</div>
          <input
            value={editDraft.name}
            onChange={(e) => setEditDraft((p) => ({ ...p, name: e.target.value }))}
            style={{
              width: "100%",
              padding: "10px 12px",
              borderRadius: 12,
              outline: "none",
              border: submitAttempted && !!errors.name ? borderError : border,
              background: "var(--panel)",
              backdropFilter: "var(--blur)",
              WebkitBackdropFilter: "var(--blur)",
              color: "var(--text)",
              transition: "var(--transition-smooth)",
              boxShadow: "var(--shadow-soft)",
            }}
          />
          {submitAttempted && errors.name && (
            <div style={{ fontSize: 12, marginTop: 6, color: "rgba(239,68,68,0.95)" }}>{errors.name}</div>
          )}

          <div style={{ marginTop: 14 }}>
            <div style={{ fontSize: 12, color: "var(--muted)" }}>Telefon</div>
            <input
              value={editDraft.phone}
              onChange={(e) => setEditDraft((p) => ({ ...p, phone: e.target.value }))}
              style={{
                width: "100%",
                padding: "10px 12px",
                borderRadius: 12,
                outline: "none",
                border: submitAttempted && !!errors.phone ? borderError : border,
                background: "var(--panel)",
                backdropFilter: "var(--blur)",
                WebkitBackdropFilter: "var(--blur)",
                color: "var(--text)",
                transition: "var(--transition-smooth)",
                boxShadow: "var(--shadow-soft)",
              }}
            />
            {submitAttempted && errors.phone && (
              <div style={{ fontSize: 12, marginTop: 6, color: "rgba(239,68,68,0.95)" }}>{errors.phone}</div>
            )}
          </div>

          <div style={{ marginTop: 14 }}>
            <div style={{ fontSize: 12, color: "var(--muted)" }}>E-mail</div>
            <input
              type="email"
              value={editDraft.email}
              onChange={(e) => setEditDraft((p) => ({ ...p, email: e.target.value }))}
              style={{
                width: "100%",
                padding: "10px 12px",
                borderRadius: 12,
                outline: "none",
                border: submitAttempted && !!errors.email ? borderError : border,
                background: "var(--panel)",
                backdropFilter: "var(--blur)",
                WebkitBackdropFilter: "var(--blur)",
                color: "var(--text)",
                transition: "var(--transition-smooth)",
                boxShadow: "var(--shadow-soft)",
              }}
            />
            {submitAttempted && errors.email && (
              <div style={{ fontSize: 12, marginTop: 6, color: "rgba(239,68,68,0.95)" }}>{errors.email}</div>
            )}
          </div>

          <div style={{ marginTop: 14 }}>
            <div style={{ fontSize: 12, color: "var(--muted)" }}>Firma</div>
            <input
              value={editDraft.company}
              onChange={(e) => setEditDraft((p) => ({ ...p, company: e.target.value }))}
              style={{
                width: "100%",
                padding: "10px 12px",
                borderRadius: 12,
                outline: "none",
                border,
                background: "var(--panel)",
                backdropFilter: "var(--blur)",
                WebkitBackdropFilter: "var(--blur)",
                color: "var(--text)",
                transition: "var(--transition-smooth)",
                boxShadow: "var(--shadow-soft)",
              }}
            />
          </div>

          <div style={{ marginTop: 14 }}>
            <div style={{ fontSize: 12, color: "var(--muted)" }}>IČO</div>
            <input
              value={editDraft.ico}
              onChange={(e) => setEditDraft((p) => ({ ...p, ico: e.target.value }))}
              style={{
                width: "100%",
                padding: "10px 12px",
                borderRadius: 12,
                outline: "none",
                border: submitAttempted && !!errors.ico ? borderError : border,
                background: "var(--panel)",
                backdropFilter: "var(--blur)",
                WebkitBackdropFilter: "var(--blur)",
                color: "var(--text)",
                transition: "var(--transition-smooth)",
                boxShadow: "var(--shadow-soft)",
              }}
            />
            {submitAttempted && errors.ico && (
              <div style={{ fontSize: 12, marginTop: 6, color: "rgba(239,68,68,0.95)" }}>{errors.ico}</div>
            )}
          </div>

          <div style={{ marginTop: 14 }}>
            <div style={{ fontSize: 12, color: "var(--muted)" }}>Adresa – ulice</div>
            <input
              value={editDraft.addressStreet}
              onChange={(e) => setEditDraft((p) => ({ ...p, addressStreet: e.target.value }))}
              style={{
                width: "100%",
                padding: "10px 12px",
                borderRadius: 12,
                outline: "none",
                border,
                background: "var(--panel)",
                backdropFilter: "var(--blur)",
                WebkitBackdropFilter: "var(--blur)",
                color: "var(--text)",
                transition: "var(--transition-smooth)",
                boxShadow: "var(--shadow-soft)",
              }}
            />
          </div>

          <div style={{ marginTop: 14, display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            <div>
              <div style={{ fontSize: 12, color: "var(--muted)" }}>Město</div>
              <input
                value={editDraft.addressCity}
                onChange={(e) => setEditDraft((p) => ({ ...p, addressCity: e.target.value }))}
                style={{
                  width: "100%",
                  padding: "10px 12px",
                  borderRadius: 12,
                  outline: "none",
                  border,
                  background: "var(--panel)",
                  backdropFilter: "var(--blur)",
                  WebkitBackdropFilter: "var(--blur)",
                  color: "var(--text)",
                  transition: "var(--transition-smooth)",
                  boxShadow: "var(--shadow-soft)",
                }}
              />
            </div>

            <div>
              <div style={{ fontSize: 12, color: "var(--muted)" }}>PSČ</div>
              <input
                value={editDraft.addressZip}
                onChange={(e) => setEditDraft((p) => ({ ...p, addressZip: e.target.value }))}
                style={{
                  width: "100%",
                  padding: "10px 12px",
                  borderRadius: 12,
                  outline: "none",
                  border: submitAttempted && !!errors.zip ? borderError : border,
                  background: "var(--panel)",
                  backdropFilter: "var(--blur)",
                  WebkitBackdropFilter: "var(--blur)",
                  color: "var(--text)",
                  transition: "var(--transition-smooth)",
                  boxShadow: "var(--shadow-soft)",
                }}
              />
              {submitAttempted && errors.zip && (
                <div style={{ fontSize: 12, marginTop: 6, color: "rgba(239,68,68,0.95)" }}>{errors.zip}</div>
              )}
            </div>
          </div>

          <div style={{ marginTop: 14 }}>
            <div style={{ fontSize: 12, color: "var(--muted)" }}>Informace</div>
            <textarea
              value={editDraft.info}
              onChange={(e) => setEditDraft((p) => ({ ...p, info: e.target.value }))}
              rows={4}
              style={{
                width: "100%",
                padding: "10px 12px",
                borderRadius: 12,
                outline: "none",
                border,
                background: "var(--panel)",
                backdropFilter: "var(--blur)",
                WebkitBackdropFilter: "var(--blur)",
                color: "var(--text)",
                transition: "var(--transition-smooth)",
                boxShadow: "var(--shadow-soft)",
                resize: "vertical",
                fontFamily: "inherit",
              }}
            />
          </div>

          <div style={{ marginTop: 14, display: "flex", justifyContent: "flex-end", gap: 10 }}>
            <button
              onClick={() => setEditOpen(false)}
              style={{
                padding: "10px 12px",
                borderRadius: 12,
                border: border,
                background: "var(--panel)",
                backdropFilter: "var(--blur)",
                WebkitBackdropFilter: "var(--blur)",
                color: "var(--text)",
                fontWeight: 900,
                cursor: "pointer",
                transition: "var(--transition-smooth)",
                boxShadow: "var(--shadow-soft)",
              }}
            >
              Zrušit
            </button>

            <button
              onClick={saveEdit}
              style={{
                padding: "10px 12px",
                borderRadius: 12,
                border: "none",
                background: "linear-gradient(135deg, var(--accent), var(--accent-hover))",
                color: "white",
                fontWeight: 900,
                cursor: canSave ? "pointer" : "not-allowed",
                opacity: canSave ? 1 : 0.55,
                boxShadow: canSave ? `0 4px 12px var(--accent-glow)` : "none",
                transition: "var(--transition-smooth)",
              }}
            >
              Uložit
            </button>
          </div>
        </div>
      </div>
      {/* Confirm Dialog for Delete Customer */}
      <ConfirmDialog
        open={deleteDialogOpen}
        title="Smazat zákazníka?"
        message="Opravdu chceš smazat tohoto zákazníka? Všechny jeho zakázky budou odpojeny (customer_id bude nastaveno na NULL). Tato akce je nevratná."
        confirmLabel="Smazat"
        cancelLabel="Zrušit"
        variant="danger"
        onConfirm={async () => {
          if (!deleteCustomerId) return;
          try {
            await onDelete(deleteCustomerId);
            setDeleteDialogOpen(false);
            setDeleteCustomerId(null);
          } catch (err) {
            console.error("[Customers] Error deleting customer:", err);
            // Error toast is shown by onDelete
          }
        }}
        onCancel={() => {
          setDeleteDialogOpen(false);
          setDeleteCustomerId(null);
        }}
      />
    </>
  );
}