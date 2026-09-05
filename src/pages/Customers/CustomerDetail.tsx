import { useState, useMemo, useEffect } from "react";
import { createPortal } from "react-dom";
import { Button, Input, Label } from "../../components/ui";
import { ChatIcon } from "../../components/icons";
import { ConfirmDialog } from "../../components/ConfirmDialog";
import { useStatuses } from "../../state/StatusesStore";
import { CustomerRecord } from "./CustomerList";
import { useCustomerActions } from "./hooks/useCustomerActions";
import { useSmsEnabled } from "../../hooks/useSmsEnabled";

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
  onOpenSmsChat?: (phone: string, displayName: string) => void;
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
  onOpenSmsChat,
  onSave,
  onDelete,
  onHistoryRefresh,
}: CustomerDetailProps) {
  const smsEnabled = useSmsEnabled(activeServiceId);
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
              {/*
                Hlavička se musí umět zalomit. Skupina tlačítek se nesmršťuje,
                takže na telefonu vytlačila jméno do sloupce o šířce jednoho
                písmene – a stejně přetekla ven z karty.
              */}
              <div style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "flex-start", flexWrap: "wrap" }}>
                <div style={{ minWidth: 0, flex: "1 1 220px" }}>
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

                <div style={{ display: "grid", gap: 8, justifyItems: "end", minWidth: 0, flex: "0 1 auto" }}>
                  <div style={{ color: "var(--muted)", fontSize: 12, fontWeight: 800, whiteSpace: "nowrap" }}>
                    Aktualizováno: {formatCZ(customer.updatedAt)}
                  </div>

                  <div style={{ display: "flex", gap: 10, flexWrap: "wrap", justifyContent: "flex-end" }}>
                    <Button variant="soft"
                      onClick={openEdit}>
                      Upravit
                    </Button>

                    <Button variant="danger"
                      onClick={() => {
                        setDeleteCustomerId(customer.id);
                        setDeleteDialogOpen(true);
                      }}>
                      Smazat
                    </Button>

                    <Button variant="primary"
                      onClick={() =>
                        window.dispatchEvent(
                          new CustomEvent("jobsheet:request-new-order", { detail: { customerId: customer.id } })
                        )
                      }>
                      + Vytvořit zakázku
                    </Button>
                    {smsEnabled && onOpenSmsChat && (customer.phone?.trim() ?? "") !== "" && (
                      <Button variant="soft"
                        onClick={() => onOpenSmsChat(customer.phone!.trim(), (customer.name ?? "").trim())}
                        title="Otevřít SMS chaty s tímto číslem">
                        <ChatIcon size={14} /> SMS
                      </Button>
                    )}
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
                      {/* minWidth: 0 – bez něj dlouhý název zařízení roztáhne
                          kartu přes okraj místo toho, aby se zalomil. */}
                      <div style={{ flex: 1, minWidth: 0, padding: 12 }}>
                        <div style={{ display: "flex", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
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
      {/* =====  Úprava zákazníka  =====

           Přes portál do <body>: <main> má transform kvůli plynulému
           posouvání, a ten dělá z prvku vztažný rámec pro position: fixed.
           Okno vykreslené uvnitř by se tak posouvalo s obsahem a spodní
           navigace by ho překryla, i když má nižší z-index. */}
      {createPortal(
        <>
      <div
        onClick={() => setEditOpen(false)}
        style={{
          position: "fixed",
          inset: 0,
          background: "rgba(0,0,0,0.35)",
          opacity: editOpen ? 1 : 0,
          pointerEvents: editOpen ? "auto" : "none",
          transition: "opacity 180ms ease",
          zIndex: 1200,
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
          maxHeight: "calc(100dvh / var(--ui-scale, 1) - 24px)",
          overflow: "auto",
          background: "var(--panel)",
          backdropFilter: "var(--blur)",
          WebkitBackdropFilter: "var(--blur)",
          border: border,
          borderRadius: "var(--radius-lg)",
          boxShadow: "var(--shadow)",
          padding: 18,
          zIndex: 1210,
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* (zbytek tvého modalu nechávám beze změn) */}
        <div style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "center" }}>
          <div>
            <div style={{ fontWeight: 900, fontSize: 16 }}>Upravit zákazníka</div>
            <div style={{ color: "var(--muted)", fontSize: 12, marginTop: 4 }}>Ukládá se do localStorage.</div>
          </div>
          <Button variant="soft"
            onClick={() => setEditOpen(false)}>
            Zavřít
          </Button>
        </div>

        {/* --- form (beze změn, jen zkráceno v komentáři) --- */}
        <div style={{ marginTop: 14 }}>
          <Label>Jméno a příjmení *</Label>
          <Input
            value={editDraft.name}
            onChange={(e) => setEditDraft((p) => ({ ...p, name: e.target.value }))}
              invalid={submitAttempted && !!errors.name} />
          {submitAttempted && errors.name && (
            <div style={{ fontSize: 12, marginTop: 6, color: "var(--danger-text)" }}>{errors.name}</div>
          )}

          <div style={{ marginTop: 14 }}>
            <Label>Telefon</Label>
            <Input
              value={editDraft.phone}
              onChange={(e) => setEditDraft((p) => ({ ...p, phone: e.target.value }))}
              invalid={submitAttempted && !!errors.phone} />
            {submitAttempted && errors.phone && (
              <div style={{ fontSize: 12, marginTop: 6, color: "var(--danger-text)" }}>{errors.phone}</div>
            )}
          </div>

          <div style={{ marginTop: 14 }}>
            <Label>E-mail</Label>
            <Input
              type="email"
              value={editDraft.email}
              onChange={(e) => setEditDraft((p) => ({ ...p, email: e.target.value }))}
              invalid={submitAttempted && !!errors.email} />
            {submitAttempted && errors.email && (
              <div style={{ fontSize: 12, marginTop: 6, color: "var(--danger-text)" }}>{errors.email}</div>
            )}
          </div>

          <div style={{ marginTop: 14 }}>
            <Label>Firma</Label>
            <Input
              value={editDraft.company}
              onChange={(e) => setEditDraft((p) => ({ ...p, company: e.target.value }))} />
          </div>

          <div style={{ marginTop: 14 }}>
            <Label>IČO</Label>
            <Input
              value={editDraft.ico}
              onChange={(e) => setEditDraft((p) => ({ ...p, ico: e.target.value }))}
              invalid={submitAttempted && !!errors.ico} />
            {submitAttempted && errors.ico && (
              <div style={{ fontSize: 12, marginTop: 6, color: "var(--danger-text)" }}>{errors.ico}</div>
            )}
          </div>

          <div style={{ marginTop: 14 }}>
            <Label>Adresa – ulice</Label>
            <Input
              value={editDraft.addressStreet}
              onChange={(e) => setEditDraft((p) => ({ ...p, addressStreet: e.target.value }))} />
          </div>

          <div style={{ marginTop: 14, display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 240px), 1fr))", gap: 12 }}>
            <div>
              <Label>Město</Label>
              <Input
                value={editDraft.addressCity}
                onChange={(e) => setEditDraft((p) => ({ ...p, addressCity: e.target.value }))} />
            </div>

            <div>
              <Label>PSČ</Label>
              <Input
                value={editDraft.addressZip}
                onChange={(e) => setEditDraft((p) => ({ ...p, addressZip: e.target.value }))}
                invalid={submitAttempted && !!errors.zip} />
              {submitAttempted && errors.zip && (
                <div style={{ fontSize: 12, marginTop: 6, color: "var(--danger-text)" }}>{errors.zip}</div>
              )}
            </div>
          </div>

          <div style={{ marginTop: 14 }}>
            <Label>Informace</Label>
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
            <Button variant="soft"
              onClick={() => setEditOpen(false)}>
              Zrušit
            </Button>

            <Button variant="primary" aria-disabled={!canSave}
              onClick={saveEdit}>
              Uložit
            </Button>
          </div>
        </div>
      </div>
        </>,
        document.body
      )}
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