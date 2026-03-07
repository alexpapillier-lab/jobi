import { useState, useEffect } from "react";
import { supabase, supabaseUrl, supabaseAnonKey, supabaseFetch } from "../../lib/supabaseClient";
import { showToast, showDemoAchievementToast } from "../../components/Toast";
import { Card } from "../../lib/settingsUi";
import { ConfirmDialog } from "../../components/ConfirmDialog";
import { TeamSettings } from "./TeamSettings";
import { formatInviteEmailReason } from "../../utils/errorNormalizer";

type ServiceItem = { service_id: string; service_name: string; role: string; active?: boolean; member_count?: number };

type OwnerSettingsProps = {
  services: ServiceItem[];
  refreshServices: () => Promise<void>;
  setActiveServiceId?: (id: string | null) => void;
};

function shortId(uuid: string): string {
  return uuid.replace(/-/g, "").slice(0, 8);
}

/** Volá Edge Function service-manage přímo přes fetch, aby bylo vždy dostupné tělo odpovědi a skutečná chyba. */
async function callServiceManage(body: { action: string; serviceId: string; name?: string }): Promise<void> {
  const client = supabase;
  if (!client) throw new Error("Supabase není k dispozici.");
  if (!supabaseUrl || !supabaseAnonKey) {
    throw new Error("Chybí konfigurace Supabase (URL nebo anon key).");
  }
  // Aktuální JWT (v Tauri/desktopu getSession() často vrací prošlý token → 401 Invalid JWT)
  const { data: refreshData } = await client.auth.refreshSession();
  const token =
    refreshData?.session?.access_token ??
    (await client.auth.getSession()).data?.session?.access_token;
  if (!token) {
    throw new Error("Nejste přihlášeni.");
  }
  const res = await supabaseFetch(`${supabaseUrl}/functions/v1/service-manage`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
      apikey: supabaseAnonKey,
    },
    body: JSON.stringify(body),
  });
  const raw = await res.text();
  let data: { error?: string; detail?: string; message?: string } = {};
  try {
    if (raw) data = JSON.parse(raw) as typeof data;
  } catch {
    // tělo není JSON (např. HTML od gateway)
  }
  if (!res.ok) {
    const msg =
      data?.error ||
      data?.detail ||
      data?.message ||
      (raw && raw.length < 200 ? raw : null) ||
      res.statusText ||
      `Chyba serveru (${res.status})`;
    console.error("[service-manage] non-2xx:", res.status, res.statusText, { body: data, raw: raw?.slice(0, 500) });
    throw new Error(msg);
  }
  if (data?.error) throw new Error(data.error);
}

export function OwnerSettings({ services, refreshServices, setActiveServiceId }: OwnerSettingsProps) {
  const [ownerSelectedServiceId, setOwnerSelectedServiceId] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [createName, setCreateName] = useState("");
  const [createEmail, setCreateEmail] = useState("");
  const [createRole, setCreateRole] = useState<"admin" | "member">("admin");
  const [createSubmitting, setCreateSubmitting] = useState(false);
  const [deactivateConfirm, setDeactivateConfirm] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState(false);
  const [manageSubmitting, setManageSubmitting] = useState(false);
  const [editNameValue, setEditNameValue] = useState("");
  const [renameSubmitting, setRenameSubmitting] = useState(false);
  const [serviceSearch, setServiceSearch] = useState("");

  const serviceSearchNorm = serviceSearch.trim().toLowerCase();
  const filteredServices =
    serviceSearchNorm === ""
      ? services
      : services.filter(
          (s) =>
            (s.service_name || "").toLowerCase().includes(serviceSearchNorm) ||
            shortId(s.service_id).toLowerCase().includes(serviceSearchNorm)
        );

  const selectedService = ownerSelectedServiceId
    ? services.find((s) => s.service_id === ownerSelectedServiceId)
    : null;
  const selectedIsActive = selectedService?.active !== false;

  useEffect(() => {
    if (!ownerSelectedServiceId && services.length > 0) {
      setOwnerSelectedServiceId(services[0].service_id);
    }
  }, [services, ownerSelectedServiceId]);

  useEffect(() => {
    if (selectedService) {
      setEditNameValue(selectedService.service_name || "");
    }
  }, [selectedService?.service_id, selectedService?.service_name]);

  const handleRenameService = async () => {
    if (!ownerSelectedServiceId || !supabase) return;
    const name = editNameValue.trim() || "Servis";
    setRenameSubmitting(true);
    try {
      await callServiceManage({ action: "rename", serviceId: ownerSelectedServiceId, name });
      await refreshServices();
      showToast("Název servisu byl změněn", "success");
    } catch (e: any) {
      showToast(e?.message || "Nepodařilo se změnit název", "error");
    } finally {
      setRenameSubmitting(false);
    }
  };

  const handleCreateService = async () => {
    if (!supabase) return;
    const name = createName.trim() || "Nový servis";
    setCreateSubmitting(true);
    try {
      const { data: sessionData } = await supabase.auth.getSession();
      const token = sessionData?.session?.access_token;
      const body: { mode: string; serviceName: string; email?: string; role?: string } = {
        mode: "stock",
        serviceName: name,
      };
      if (createEmail.trim()) {
        body.email = createEmail.trim();
        body.role = createRole;
      }
      const { data, error } = await supabase.functions.invoke("invite_create", {
        body,
        ...(token ? { headers: { Authorization: `Bearer ${token}` } } : {}),
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      await refreshServices();
      setCreateOpen(false);
      setCreateName("");
      setCreateEmail("");
      setCreateRole("admin");
      if (data?.service_id) {
        setOwnerSelectedServiceId(data.service_id);
        setActiveServiceId?.(data.service_id);
      }
      if (data?.email_sent === false && (data?.email_skipped_reason || data?.email_error)) {
        const raw = data?.email_skipped_reason || data?.email_error || "";
        const reason = formatInviteEmailReason(raw) || "E-mail se nepodařilo odeslat.";
        showToast(`Servis „${name}" vytvořen, ale e-mail nebyl odeslán: ${reason}`, "error");
      } else {
        showToast(
          data?.inviteLink
            ? `Servis „${name}" vytvořen a pozvánka odeslána.`
            : `Servis „${name}" vytvořen.`,
          "success"
        );
      }
    } catch (e: any) {
      showToast(e?.message || "Nepodařilo se vytvořit servis", "error");
    } finally {
      setCreateSubmitting(false);
    }
  };

  const handleDeactivate = async () => {
    if (!ownerSelectedServiceId || !supabase) return;
    setManageSubmitting(true);
    try {
      await callServiceManage({ action: "deactivate", serviceId: ownerSelectedServiceId });
      await refreshServices();
      setDeactivateConfirm(false);
      showToast("Servis deaktivován", "success");
    } catch (e: any) {
      showToast(e?.message || "Nepodařilo se deaktivovat", "error");
    } finally {
      setManageSubmitting(false);
    }
  };

  const handleActivate = async () => {
    if (!ownerSelectedServiceId || !supabase) return;
    setManageSubmitting(true);
    try {
      await callServiceManage({ action: "activate", serviceId: ownerSelectedServiceId });
      await refreshServices();
      showToast("Servis znovu aktivován", "success");
    } catch (e: any) {
      showToast(e?.message || "Nepodařilo se aktivovat", "error");
    } finally {
      setManageSubmitting(false);
    }
  };

  const handleHardDelete = async () => {
    if (!ownerSelectedServiceId || !supabase) return;
    setManageSubmitting(true);
    try {
      await callServiceManage({ action: "hardDelete", serviceId: ownerSelectedServiceId });
      await refreshServices();
      setOwnerSelectedServiceId(null);
      setDeleteConfirm(false);
      showToast("Servis smazán", "success");
    } catch (e: any) {
      showToast(e?.message || "Nepodařilo se smazat", "error");
    } finally {
      setManageSubmitting(false);
    }
  };

  const copyServiceId = () => {
    if (!selectedService?.service_id) return;
    navigator.clipboard.writeText(selectedService.service_id).then(
      () => showToast("ID zkopírováno do schránky", "success"),
      () => showToast("Kopírování se nezdařilo", "error")
    );
  };

  const border = "1px solid var(--border)";

  return (
    <>
      <div style={{ marginBottom: 16, padding: "12px 16px", border: "1px solid var(--border)", borderRadius: 12, background: "var(--panel)", display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 12 }}>
        <div>
          <div style={{ fontWeight: 700, fontSize: 13, color: "var(--text)", marginBottom: 2 }}>Ukázkový achievement</div>
          <div style={{ fontSize: 12, color: "var(--muted)" }}>Zobrazí demo toast s achievementem (pro testování vzhledu)</div>
        </div>
        <button
          type="button"
          onClick={showDemoAchievementToast}
          style={{
            padding: "8px 16px",
            borderRadius: 10,
            border: "1px solid var(--accent)",
            background: "var(--accent-soft)",
            color: "var(--accent)",
            fontWeight: 600,
            fontSize: 13,
            cursor: "pointer",
          }}
        >
          Poslat ukázkový achievement
        </button>
      </div>

      <Card>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: 12, marginBottom: 20 }}>
          <div>
            <div style={{ fontWeight: 950, fontSize: 14, marginBottom: 4, color: "var(--text)" }}>
              Owner – Správa servisů
            </div>
            <div style={{ fontSize: 13, color: "var(--muted)" }}>
              Seznam servisů, stav, členové a akce. Pouze root owner.
            </div>
          </div>
          <button
            type="button"
            onClick={() => setCreateOpen(true)}
            style={{
              padding: "10px 16px",
              borderRadius: 12,
              border,
              background: "var(--accent)",
              color: "white",
              fontWeight: 700,
              fontSize: 13,
              cursor: "pointer",
            }}
          >
            + Vytvořit nový servis
          </button>
        </div>

        {services.length === 0 ? (
          <div style={{ padding: 32, textAlign: "center", color: "var(--muted)", fontSize: 13 }}>
            Zatím nemáte žádné servisy. Klikněte na „Vytvořit nový servis“.
          </div>
        ) : (
          <div style={{ display: "flex", flexWrap: "wrap", gap: 24, alignItems: "start" }}>
            {/* Seznam servisů – název, ID, stav */}
            <div style={{ minWidth: 280, maxWidth: 340, width: "100%", border, borderRadius: 12, overflow: "hidden", background: "var(--bg)" }}>
              <div style={{ padding: "10px 14px", borderBottom: border, fontSize: 11, fontWeight: 700, color: "var(--muted)", textTransform: "uppercase", letterSpacing: "0.04em" }}>
                Servisy ({filteredServices.length}{serviceSearchNorm ? ` / ${services.length}` : ""})
              </div>
              <div style={{ padding: "8px 10px", borderBottom: border, background: "var(--panel)" }}>
                <input
                  type="text"
                  value={serviceSearch}
                  onChange={(e) => setServiceSearch(e.target.value)}
                  placeholder="Hledat servis (název, ID)…"
                  style={{
                    width: "100%",
                    padding: "8px 10px",
                    borderRadius: 8,
                    border,
                    background: "var(--bg)",
                    color: "var(--text)",
                    fontSize: 13,
                    fontFamily: "inherit",
                  }}
                />
              </div>
              <div style={{ maxHeight: 400, overflowY: "auto" }}>
                {filteredServices.map((s) => {
                  const isSelected = s.service_id === ownerSelectedServiceId;
                  return (
                    <button
                      key={s.service_id}
                      type="button"
                      onClick={() => setOwnerSelectedServiceId(s.service_id)}
                      style={{
                        width: "100%",
                        padding: "12px 14px",
                        border: "none",
                        borderBottom: border,
                        background: isSelected ? "var(--accent-soft)" : "transparent",
                        color: isSelected ? "var(--accent)" : "var(--text)",
                        textAlign: "left",
                        cursor: "pointer",
                        fontFamily: "inherit",
                        transition: "background 0.15s",
                      }}
                      onMouseEnter={(e) => {
                        if (!isSelected) e.currentTarget.style.background = "var(--panel)";
                      }}
                      onMouseLeave={(e) => {
                        if (!isSelected) e.currentTarget.style.background = "transparent";
                      }}
                    >
                      <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 4, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        {s.service_name || "Bez názvu"}
                      </div>
                      <div style={{ fontSize: 11, color: "var(--muted)", marginBottom: 4, fontFamily: "monospace" }}>
                        ID: {shortId(s.service_id)}
                      </div>
                      {typeof s.member_count === "number" && (
                        <div style={{ fontSize: 11, color: "var(--muted)", marginBottom: 6 }}>
                          {s.member_count === 1 ? "1 člen" : `${s.member_count} členové`}
                        </div>
                      )}
                      <span
                        style={{
                          display: "inline-block",
                          padding: "2px 8px",
                          borderRadius: 6,
                          fontSize: 10,
                          fontWeight: 700,
                          textTransform: "uppercase",
                          letterSpacing: "0.03em",
                          background: s.active !== false ? "rgba(34, 197, 94, 0.2)" : "rgba(148, 163, 184, 0.25)",
                          color: s.active !== false ? "rgb(22, 163, 74)" : "var(--muted)",
                        }}
                      >
                        {s.active !== false ? "Aktivní" : "Deaktivovaný"}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Detail vybraného servisu */}
            <div style={{ flex: "1 1 360px", minWidth: 0 }}>
              {selectedService ? (
                <>
                  <div style={{ marginBottom: 16, padding: "14px 16px", border, borderRadius: 12, background: "var(--panel)" }}>
                    <div style={{ fontWeight: 800, fontSize: 15, color: "var(--text)", marginBottom: 8 }}>Název servisu</div>
                    <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", marginBottom: 8 }}>
                      <input
                        type="text"
                        value={editNameValue}
                        onChange={(e) => setEditNameValue(e.target.value)}
                        placeholder="Název servisu"
                        style={{
                          flex: "1 1 200px",
                          minWidth: 0,
                          padding: "8px 12px",
                          borderRadius: 8,
                          border,
                          background: "var(--bg)",
                          color: "var(--text)",
                          fontSize: 14,
                          fontFamily: "inherit",
                        }}
                      />
                      <button
                        type="button"
                        onClick={handleRenameService}
                        disabled={renameSubmitting || (editNameValue.trim() || "Servis") === (selectedService.service_name || "Bez názvu")}
                        style={{
                          padding: "8px 14px",
                          borderRadius: 8,
                          border: "none",
                          background: "var(--accent)",
                          color: "white",
                          fontWeight: 600,
                          fontSize: 13,
                          cursor: renameSubmitting ? "not-allowed" : "pointer",
                        }}
                      >
                        {renameSubmitting ? "Ukládám…" : "Uložit název"}
                      </button>
                    </div>
                    {typeof selectedService.member_count === "number" && (
                      <div style={{ fontSize: 12, color: "var(--muted)", marginBottom: 6 }}>
                        Počet členů: {selectedService.member_count === 1 ? "1 člen" : `${selectedService.member_count} členové`}
                      </div>
                    )}
                    <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8, flexWrap: "wrap" }}>
                      <span style={{ fontSize: 11, color: "var(--muted)", fontFamily: "monospace", wordBreak: "break-all" }}>
                        {selectedService.service_id}
                      </span>
                      <button
                        type="button"
                        onClick={copyServiceId}
                        style={{
                          padding: "4px 10px",
                          borderRadius: 6,
                          border,
                          background: "var(--bg)",
                          color: "var(--text)",
                          fontSize: 11,
                          fontWeight: 600,
                          cursor: "pointer",
                        }}
                      >
                        Kopírovat ID
                      </button>
                    </div>
                    <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                      <span
                        style={{
                          padding: "4px 10px",
                          borderRadius: 8,
                          fontSize: 11,
                          fontWeight: 700,
                          textTransform: "uppercase",
                          letterSpacing: "0.03em",
                          background: selectedIsActive ? "rgba(34, 197, 94, 0.2)" : "rgba(148, 163, 184, 0.25)",
                          color: selectedIsActive ? "rgb(22, 163, 74)" : "var(--muted)",
                        }}
                      >
                        {selectedIsActive ? "Aktivní" : "Deaktivovaný"}
                      </span>
                      {selectedIsActive ? (
                        <button
                          type="button"
                          onClick={() => setDeactivateConfirm(true)}
                          disabled={manageSubmitting}
                          style={{
                            padding: "6px 12px",
                            borderRadius: 8,
                            border: "1px solid rgba(251,191,36,0.5)",
                            background: "rgba(251,191,36,0.15)",
                            color: "rgba(251,191,36,0.95)",
                            fontWeight: 600,
                            fontSize: 12,
                            cursor: manageSubmitting ? "not-allowed" : "pointer",
                          }}
                        >
                          Deaktivovat
                        </button>
                      ) : (
                        <button
                          type="button"
                          onClick={handleActivate}
                          disabled={manageSubmitting}
                          style={{
                            padding: "6px 12px",
                            borderRadius: 8,
                            border: "1px solid rgba(34, 197, 94, 0.5)",
                            background: "rgba(34, 197, 94, 0.15)",
                            color: "rgb(22, 163, 74)",
                            fontWeight: 600,
                            fontSize: 12,
                            cursor: manageSubmitting ? "not-allowed" : "pointer",
                          }}
                        >
                          Znovu aktivovat
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() => setDeleteConfirm(true)}
                        disabled={manageSubmitting}
                        style={{
                          padding: "6px 12px",
                          borderRadius: 8,
                          border: "1px solid rgba(239,68,68,0.3)",
                          background: "rgba(239,68,68,0.1)",
                          color: "rgba(239,68,68,0.9)",
                          fontWeight: 600,
                          fontSize: 12,
                          cursor: manageSubmitting ? "not-allowed" : "pointer",
                        }}
                      >
                        Smazat (hard delete)
                      </button>
                    </div>
                  </div>
                  <TeamSettings
                    activeServiceId={ownerSelectedServiceId}
                    setActiveServiceId={setOwnerSelectedServiceId}
                    services={services}
                  />
                </>
              ) : (
                <div style={{ padding: 24, textAlign: "center", color: "var(--muted)", fontSize: 13 }}>
                  Vyberte servis ze seznamu vlevo.
                </div>
              )}
            </div>
          </div>
        )}
      </Card>

      {createOpen && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0,0,0,0.4)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 10002,
          }}
          onClick={() => !createSubmitting && setCreateOpen(false)}
        >
          <div
            style={{
              background: "var(--panel)",
              border: border,
              borderRadius: 16,
              padding: 24,
              maxWidth: 400,
              width: "90%",
              boxShadow: "var(--shadow)",
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div style={{ fontWeight: 900, fontSize: 16, marginBottom: 16, color: "var(--text)" }}>
              Vytvořit nový servis
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 12, marginBottom: 20 }}>
              <div>
                <label style={{ display: "block", fontSize: 12, fontWeight: 600, color: "var(--muted)", marginBottom: 4 }}>
                  Název servisu
                </label>
                <input
                  type="text"
                  value={createName}
                  onChange={(e) => setCreateName(e.target.value)}
                  placeholder="Nový servis"
                  style={{
                    width: "100%",
                    padding: "10px 12px",
                    borderRadius: 10,
                    border,
                    background: "var(--bg)",
                    color: "var(--text)",
                    fontSize: 13,
                  }}
                />
              </div>
              <div>
                <label style={{ display: "block", fontSize: 12, fontWeight: 600, color: "var(--muted)", marginBottom: 4 }}>
                  První pozvánka (volitelné) – email a role (první = admin)
                </label>
                <input
                  type="email"
                  value={createEmail}
                  onChange={(e) => setCreateEmail(e.target.value)}
                  placeholder="email@example.cz"
                  style={{
                    width: "100%",
                    padding: "10px 12px",
                    borderRadius: 10,
                    border,
                    background: "var(--bg)",
                    color: "var(--text)",
                    fontSize: 13,
                    marginBottom: 8,
                  }}
                />
                <div style={{ display: "flex", gap: 8 }}>
                  {(["admin", "member"] as const).map((r) => (
                    <label key={r} style={{ display: "flex", alignItems: "center", gap: 6, cursor: "pointer", fontSize: 13 }}>
                      <input
                        type="radio"
                        checked={createRole === r}
                        onChange={() => setCreateRole(r)}
                      />
                      {r === "admin" ? "Administrátor" : "Člen"}
                    </label>
                  ))}
                </div>
              </div>
            </div>
            <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
              <button
                type="button"
                onClick={() => !createSubmitting && setCreateOpen(false)}
                style={{
                  padding: "10px 16px",
                  borderRadius: 10,
                  border,
                  background: "var(--panel)",
                  color: "var(--text)",
                  fontWeight: 600,
                  cursor: createSubmitting ? "not-allowed" : "pointer",
                }}
              >
                Zrušit
              </button>
              <button
                type="button"
                onClick={handleCreateService}
                disabled={createSubmitting}
                style={{
                  padding: "10px 16px",
                  borderRadius: 10,
                  border: "none",
                  background: "var(--accent)",
                  color: "white",
                  fontWeight: 600,
                  cursor: createSubmitting ? "not-allowed" : "pointer",
                }}
              >
                {createSubmitting ? "Vytvářím…" : "Vytvořit"}
              </button>
            </div>
          </div>
        </div>
      )}

      <ConfirmDialog
        open={deactivateConfirm}
        title="Deaktivovat servis?"
        message="Servis bude deaktivován. Členové se neodstraní; aplikace může neaktivní servisy skrýt nebo omezit přístup."
        confirmLabel="Deaktivovat"
        onConfirm={handleDeactivate}
        onCancel={() => setDeactivateConfirm(false)}
      />
      <ConfirmDialog
        open={deleteConfirm}
        title="Smazat servis natrvalo?"
        message="Všechna data servisu (zakázky, zákazníci, členové, nastavení) budou nenávratně smazána. Tuto akci nelze vrátit."
        confirmLabel="Smazat"
        variant="danger"
        onConfirm={handleHardDelete}
        onCancel={() => setDeleteConfirm(false)}
      />
    </>
  );
}
