import { useState, useEffect, useRef, useLayoutEffect } from "react";
import { createPortal } from "react-dom";
import { supabase } from "../../lib/supabaseClient";
import { useAuth } from "../../auth/AuthProvider";
import { showToast } from "../../components/Toast";
import { ConfirmDialog } from "../../components/ConfirmDialog";
import { Card } from "../../lib/settingsUi";

type TeamSettingsProps = {
  activeServiceId: string | null;
  setActiveServiceId: (serviceId: string | null) => void;
  services: Array<{ service_id: string; service_name: string; role: string }>;
};

export function TeamSettings({ activeServiceId, setActiveServiceId, services }: TeamSettingsProps) {
  const { session } = useAuth();
  const [teamMembers, setTeamMembers] = useState<any[]>([]);
  const [pendingInvites, setPendingInvites] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Invite dialog states
  const [inviteDialogOpen, setInviteDialogOpen] = useState(false);
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState<"member" | "admin">("member");
  const [inviteMode, setInviteMode] = useState<"stock" | "custom">("stock");
  const [inviteRolePickerOpen, setInviteRolePickerOpen] = useState(false);
  const inviteRoleButtonRef = useRef<HTMLButtonElement | null>(null);
  const inviteRoleMenuRef = useRef<HTMLDivElement | null>(null);

  // Remove dialog states
  const [removeDialogOpen, setRemoveDialogOpen] = useState(false);
  const [removeUserId, setRemoveUserId] = useState<string | null>(null);
  const [removeServiceId, setRemoveServiceId] = useState<string | null>(null);

  // Role change dialog states
  const [roleChangeDialogOpen, setRoleChangeDialogOpen] = useState(false);
  const [roleChangeUserId, setRoleChangeUserId] = useState<string | null>(null);
  const [roleChangeNewRole, setRoleChangeNewRole] = useState<"member" | "admin" | null>(null);
  const [roleChangeServiceId, setRoleChangeServiceId] = useState<string | null>(null);

  // Capabilities save dialog states
  const [capabilitiesSaveDialogOpen, setCapabilitiesSaveDialogOpen] = useState(false);
  const [capabilitiesSaveUserId, setCapabilitiesSaveUserId] = useState<string | null>(null);
  const [capabilitiesSaveServiceId, setCapabilitiesSaveServiceId] = useState<string | null>(null);

  // Load team members and invites when activeServiceId changes
  useEffect(() => {
    if (!activeServiceId || !session || !supabase) {
      setTeamMembers([]);
      setPendingInvites([]);
      setError(null);
      return;
    }

    const loadTeamData = async () => {
      setLoading(true);
      setError(null);

      try {
        // Load team members
        const { data: membersData, error: membersError } = await supabase.functions.invoke("team-list", {
          body: { serviceId: activeServiceId },
        });

        if (membersError) {
          throw membersError;
        }

        if (membersData?.error) {
          setError(membersData.error);
          setTeamMembers([]);
          setPendingInvites([]);
          setLoading(false);
          return;
        }

        setTeamMembers(membersData?.members || []);

        // Load pending invites
        const { data: invitesData, error: invitesError } = await supabase.functions.invoke("team-invite-list", {
          body: { serviceId: activeServiceId },
        });

        if (invitesError) {
          throw invitesError;
        }

        if (invitesData?.error) {
          setPendingInvites([]);
        } else {
          setPendingInvites(invitesData?.invites || []);
        }
      } catch (err: any) {
        console.error("[TeamSettings] Error loading team data:", err);
        setError(err?.message || "Chyba při načítání dat týmu");
        setTeamMembers([]);
        setPendingInvites([]);
      } finally {
        setLoading(false);
      }
    };

    loadTeamData();
  }, [activeServiceId, session]);

  // Set activeServiceId if null and services exist
  useEffect(() => {
    if (!activeServiceId && services.length > 0) {
      setActiveServiceId(services[0].service_id);
    }
  }, [activeServiceId, services, setActiveServiceId]);

  // Role picker menu positioning
  useLayoutEffect(() => {
    if (!inviteRolePickerOpen || !inviteRoleButtonRef.current || !inviteRoleMenuRef.current) return;

    const btnRect = inviteRoleButtonRef.current.getBoundingClientRect();
    const menu = inviteRoleMenuRef.current;
    const menuHeight = menu.scrollHeight;
    const spaceBelow = window.innerHeight - btnRect.bottom;
    const spaceAbove = btnRect.top;

    let top = btnRect.bottom + 8;
    let maxHeight = Math.min(300, spaceBelow - 16);

    if (spaceBelow < menuHeight && spaceAbove > spaceBelow) {
      top = btnRect.top - menuHeight - 8;
      maxHeight = Math.min(300, spaceAbove - 16);
    }

    menu.style.top = `${top}px`;
    menu.style.left = `${btnRect.left}px`;
    menu.style.width = `${btnRect.width}px`;
    menu.style.maxHeight = `${maxHeight}px`;
  }, [inviteRolePickerOpen]);

  // Close role picker on outside click
  useEffect(() => {
    if (!inviteRolePickerOpen) return;

    const handleClick = (e: MouseEvent) => {
      if (
        inviteRoleMenuRef.current &&
        !inviteRoleMenuRef.current.contains(e.target as Node) &&
        inviteRoleButtonRef.current &&
        !inviteRoleButtonRef.current.contains(e.target as Node)
      ) {
        setInviteRolePickerOpen(false);
      }
    };

    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === "Escape") setInviteRolePickerOpen(false);
    };

    document.addEventListener("mousedown", handleClick);
    document.addEventListener("keydown", handleEscape);
    return () => {
      document.removeEventListener("mousedown", handleClick);
      document.removeEventListener("keydown", handleEscape);
    };
  }, [inviteRolePickerOpen]);

  const handleSendInvite = async () => {
    if (!activeServiceId || !session || !supabase) {
      showToast("Chyba: Nelze poslat pozvánku bez aktivního servisu", "error");
      return;
    }

    if (!inviteEmail.trim()) {
      showToast("Zadejte e-mail", "error");
      return;
    }

    try {
      const { data, error } = await supabase.functions.invoke("team-invite", {
        body: {
          serviceId: activeServiceId,
          email: inviteEmail.trim(),
          role: inviteRole,
        },
      });

      if (error) {
        throw error;
      }

      if (data?.error) {
        showToast(`Chyba při posílání pozvánky: ${data.error}`, "error");
        return;
      }

      showToast("Pozvánka odeslána", "success");
      setInviteDialogOpen(false);
      setInviteEmail("");
      setInviteRole("member");
      setInviteMode("stock");

      // Reload invites
      const { data: invitesData } = await supabase.functions.invoke("team-invite-list", {
        body: { serviceId: activeServiceId },
      });
      if (invitesData && !invitesData.error) {
        setPendingInvites(invitesData.invites || []);
      }
    } catch (err: any) {
      console.error("[TeamSettings] Error sending invite:", err);
      showToast(`Chyba při posílání pozvánky: ${err?.message || "Neznámá chyba"}`, "error");
    }
  };

  const handleRemoveMember = async () => {
    if (!removeUserId || !removeServiceId || !session || !supabase) {
      return;
    }

    try {
      const { data, error } = await supabase.functions.invoke("team-remove-member", {
        body: {
          serviceId: removeServiceId,
          userId: removeUserId,
        },
      });

      if (error) {
        throw error;
      }

      if (data?.error) {
        showToast(`Chyba při odebírání člena: ${data.error}`, "error");
        return;
      }

      showToast("Člen odebrán", "success");
      setRemoveDialogOpen(false);
      setRemoveUserId(null);
      setRemoveServiceId(null);

      // Reload team members
      const { data: membersData } = await supabase.functions.invoke("team-list", {
        body: { serviceId: removeServiceId },
      });
      if (membersData && !membersData.error) {
        setTeamMembers(membersData.members || []);
      }
    } catch (err: any) {
      console.error("[TeamSettings] Error removing member:", err);
      showToast(`Chyba při odebírání člena: ${err?.message || "Neznámá chyba"}`, "error");
    }
  };

  const updateRole = async () => {
    if (!roleChangeUserId || !roleChangeNewRole || !roleChangeServiceId || !session || !supabase) {
      return;
    }

    try {
      const { data, error } = await supabase.functions.invoke("change-role", {
        body: {
          serviceId: roleChangeServiceId,
          userId: roleChangeUserId,
          newRole: roleChangeNewRole,
        },
      });

      if (error) {
        throw error;
      }

      if (data?.error) {
        showToast(`Chyba při změně role: ${data.error}`, "error");
        return;
      }

      showToast("Role změněna", "success");
      setRoleChangeDialogOpen(false);
      setRoleChangeUserId(null);
      setRoleChangeNewRole(null);
      setRoleChangeServiceId(null);

      // Reload team members
      const { data: membersData } = await supabase.functions.invoke("team-list", {
        body: { serviceId: roleChangeServiceId },
      });
      if (membersData && !membersData.error) {
        setTeamMembers(membersData.members || []);
      }
    } catch (err: any) {
      console.error("[TeamSettings] Error updating role:", err);
      showToast(`Chyba při změně role: ${err?.message || "Neznámá chyba"}`, "error");
    }
  };

  const reloadPendingInvites = async () => {
    if (!activeServiceId || !supabase) return;

    try {
      const { data: invitesData } = await supabase.functions.invoke("team-invite-list", {
        body: { serviceId: activeServiceId },
      });
      if (invitesData && !invitesData.error) {
        setPendingInvites(invitesData.invites || []);
      }
    } catch (err) {
      console.error("[TeamSettings] Error reloading invites:", err);
    }
  };

  const border = "1px solid var(--border)";

  return (
    <>
      <Card>
        <div style={{ fontWeight: 950, fontSize: 14, marginBottom: 12, color: "var(--text)" }}>Členové týmu</div>

        {loading && <div style={{ color: "var(--muted)", fontSize: 13, marginBottom: 16 }}>Načítám...</div>}
        {error && <div style={{ color: "rgba(239,68,68,0.9)", fontSize: 13, marginBottom: 16 }}>{error}</div>}

        {!loading && !error && teamMembers.length > 0 && (
          <div style={{ display: "flex", flexDirection: "column", gap: 12, marginBottom: 24 }}>
            {teamMembers.map((member: any) => (
              <div
                key={`${member.user_id}-${member.service_id}`}
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  padding: 12,
                  borderRadius: 10,
                  border,
                  background: "var(--panel)",
                }}
              >
                <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                  <div style={{ fontWeight: 700, fontSize: 13, color: "var(--text)" }}>{member.email || member.user_id}</div>
                  <div style={{ fontSize: 12, color: "var(--muted)" }}>
                    {member.role === "admin" ? "Administrátor" : "Člen"}
                  </div>
                </div>

                <div style={{ display: "flex", gap: 8 }}>
                  <button
                    onClick={() => {
                      setRoleChangeUserId(member.user_id);
                      setRoleChangeNewRole(member.role === "admin" ? "member" : "admin");
                      setRoleChangeServiceId(member.service_id);
                      setRoleChangeDialogOpen(true);
                    }}
                    style={{
                      padding: "6px 12px",
                      borderRadius: 6,
                      border,
                      background: "var(--panel)",
                      color: "var(--text)",
                      fontSize: 11,
                      fontWeight: 600,
                      cursor: "pointer",
                    }}
                  >
                    Změnit roli
                  </button>
                  <button
                    onClick={() => {
                      setRemoveUserId(member.user_id);
                      setRemoveServiceId(member.service_id);
                      setRemoveDialogOpen(true);
                    }}
                    style={{
                      padding: "6px 12px",
                      borderRadius: 6,
                      border: "1px solid rgba(239,68,68,0.3)",
                      background: "rgba(239,68,68,0.1)",
                      color: "rgba(239,68,68,0.9)",
                      fontSize: 11,
                      fontWeight: 600,
                      cursor: "pointer",
                    }}
                  >
                    Odebrat
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}

        <button
          onClick={() => setInviteDialogOpen(true)}
          style={{
            padding: "10px 14px",
            borderRadius: 12,
            border,
            background: "var(--accent)",
            color: "white",
            fontWeight: 900,
            cursor: "pointer",
            fontSize: 13,
          }}
        >
          Pozvat člena
        </button>
      </Card>

      {pendingInvites.length > 0 && (
        <Card style={{ marginTop: 16 }}>
          <div style={{ fontWeight: 950, fontSize: 14, marginBottom: 12, color: "var(--text)" }}>Čekající pozvánky</div>
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            {pendingInvites.map((invite: any) => (
              <div
                key={invite.id}
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  padding: 12,
                  borderRadius: 10,
                  border,
                  background: "var(--panel)",
                }}
              >
                <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                  <div style={{ fontWeight: 700, fontSize: 13, color: "var(--text)" }}>{invite.email}</div>
                  <div style={{ fontSize: 12, color: "var(--muted)" }}>
                    {invite.role === "admin" ? "Administrátor" : "Člen"}
                  </div>
                </div>

                <button
                  onClick={async (e) => {
                    e.preventDefault();
                    e.stopPropagation();

                    if (!activeServiceId || !supabase) {
                      showToast("Chyba: Nelze smazat pozvánku bez aktivního servisu", "error");
                      return;
                    }

                    try {
                      const { data, error } = await supabase.functions.invoke("team-invite-delete", {
                        body: {
                          serviceId: activeServiceId,
                          inviteId: invite.id,
                        },
                      });

                      if (error) {
                        throw error;
                      }

                      if (data?.error) {
                        showToast(`Chyba při mazání pozvánky: ${data.error}`, "error");
                        return;
                      }

                      showToast("Pozvánka smazána", "success");
                      reloadPendingInvites();
                    } catch (err) {
                      console.error("[TeamSettings] Exception deleting invite:", err);
                      showToast(`Chyba při mazání pozvánky: ${err instanceof Error ? err.message : "Neznámá chyba"}`, "error");
                    }
                  }}
                  style={{
                    padding: "6px 10px",
                    borderRadius: 6,
                    border: "1px solid rgba(239,68,68,0.3)",
                    background: "rgba(239,68,68,0.1)",
                    color: "rgba(239,68,68,0.9)",
                    fontSize: 11,
                    fontWeight: 600,
                    cursor: "pointer",
                    whiteSpace: "nowrap",
                  }}
                >
                  Smazat
                </button>
              </div>
            ))}
          </div>
        </Card>
      )}

      {/* Invite Dialog */}
      {inviteDialogOpen && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0,0,0,0.5)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 10000,
          }}
          onClick={() => setInviteDialogOpen(false)}
        >
          <div
            style={{
              background: "var(--panel)",
              borderRadius: 16,
              padding: 24,
              maxWidth: 400,
              width: "90%",
              border,
              boxShadow: "0 25px 60px rgba(0,0,0,0.22)",
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div style={{ fontWeight: 950, fontSize: 16, marginBottom: 16, color: "var(--text)" }}>Pozvat člena</div>

            <div style={{ display: "grid", gap: 12, marginBottom: 20 }}>
              <div>
                <div style={{ fontSize: 12, color: "var(--muted)", marginBottom: 6 }}>E-mail</div>
                <input
                  type="email"
                  value={inviteEmail}
                  onChange={(e) => setInviteEmail(e.target.value)}
                  placeholder="email@priklad.cz"
                  style={{
                    width: "100%",
                    padding: "10px 12px",
                    borderRadius: 12,
                    border,
                    background: "var(--panel)",
                    color: "var(--text)",
                    outline: "none",
                    fontSize: 13,
                  }}
                />
              </div>

              <div>
                <div style={{ fontSize: 12, color: "var(--muted)", marginBottom: 6 }}>Role</div>
                <button
                  ref={inviteRoleButtonRef}
                  type="button"
                  onClick={() => setInviteRolePickerOpen(!inviteRolePickerOpen)}
                  style={{
                    width: "100%",
                    padding: "10px 12px",
                    borderRadius: 12,
                    border,
                    background: "var(--panel)",
                    color: "var(--text)",
                    fontSize: 13,
                    fontWeight: 600,
                    cursor: "pointer",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                  }}
                >
                  <span>{inviteRole === "admin" ? "Administrátor" : "Člen"}</span>
                  <span style={{ fontSize: 10, color: "var(--muted)" }}>▼</span>
                </button>

                {inviteRolePickerOpen &&
                  createPortal(
                    <div
                      ref={inviteRoleMenuRef}
                      role="listbox"
                      style={{
                        position: "fixed",
                        borderRadius: 14,
                        border,
                        background: "var(--panel)",
                        boxShadow: "0 25px 60px rgba(0,0,0,0.22)",
                        padding: 6,
                        zIndex: 10001,
                        overflowY: "auto",
                      }}
                    >
                      <button
                        type="button"
                        onClick={() => {
                          setInviteRole("member");
                          setInviteRolePickerOpen(false);
                        }}
                        style={{
                          width: "100%",
                          textAlign: "left",
                          padding: "12px 14px",
                          borderRadius: 12,
                          border: "none",
                          background: inviteRole === "member" ? "var(--accent-soft)" : "transparent",
                          cursor: "pointer",
                          color: inviteRole === "member" ? "var(--accent)" : "var(--text)",
                          fontWeight: inviteRole === "member" ? 700 : 500,
                          fontSize: 14,
                        }}
                      >
                        Člen
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setInviteRole("admin");
                          setInviteRolePickerOpen(false);
                        }}
                        style={{
                          width: "100%",
                          textAlign: "left",
                          padding: "12px 14px",
                          borderRadius: 12,
                          border: "none",
                          background: inviteRole === "admin" ? "var(--accent-soft)" : "transparent",
                          cursor: "pointer",
                          color: inviteRole === "admin" ? "var(--accent)" : "var(--text)",
                          fontWeight: inviteRole === "admin" ? 700 : 500,
                          fontSize: 14,
                        }}
                      >
                        Administrátor
                      </button>
                    </div>,
                    document.body
                  )}
              </div>
            </div>

            <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
              <button
                onClick={() => {
                  setInviteDialogOpen(false);
                  setInviteEmail("");
                  setInviteRole("member");
                  setInviteMode("stock");
                }}
                style={{
                  padding: "10px 16px",
                  borderRadius: 12,
                  border,
                  background: "var(--panel)",
                  color: "var(--text)",
                  fontWeight: 700,
                  cursor: "pointer",
                  fontSize: 13,
                }}
              >
                Zrušit
              </button>
              <button
                onClick={handleSendInvite}
                style={{
                  padding: "10px 16px",
                  borderRadius: 12,
                  border,
                  background: "var(--accent)",
                  color: "white",
                  fontWeight: 900,
                  cursor: "pointer",
                  fontSize: 13,
                }}
              >
                Pozvat
              </button>
            </div>
          </div>
        </div>
      )}

      <ConfirmDialog
        open={removeDialogOpen}
        title="Odebrat člena"
        message="Opravdu chceš odebrat tohoto člena z týmu?"
        confirmLabel="Odebrat"
        cancelLabel="Zrušit"
        variant="danger"
        onConfirm={handleRemoveMember}
        onCancel={() => {
          setRemoveDialogOpen(false);
          setRemoveUserId(null);
          setRemoveServiceId(null);
        }}
      />

      <ConfirmDialog
        open={roleChangeDialogOpen}
        title="Změnit roli?"
        message={`Opravdu chceš změnit roli na ${roleChangeNewRole === "admin" ? "admin" : "člen"}?`}
        confirmLabel="Změnit"
        cancelLabel="Zrušit"
        variant="default"
        onConfirm={updateRole}
        onCancel={() => {
          setRoleChangeDialogOpen(false);
          setRoleChangeUserId(null);
          setRoleChangeNewRole(null);
          setRoleChangeServiceId(null);
        }}
      />
    </>
  );
}

