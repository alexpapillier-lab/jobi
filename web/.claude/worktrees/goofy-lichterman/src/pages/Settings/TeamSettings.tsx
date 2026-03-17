import { useState, useEffect, useRef, useLayoutEffect } from "react";
import { createPortal } from "react-dom";
import { supabase } from "../../lib/supabaseClient";
import { devLog, devWarn } from "../../lib/devLog";
import { useAuth } from "../../auth/AuthProvider";
import { useIsRootOwner, getRootOwnerId } from "../../hooks/useIsRootOwner";
import { showToast } from "../../components/Toast";
import { ConfirmDialog } from "../../components/ConfirmDialog";
import { Card } from "../../lib/settingsUi";
import { normalizeError, formatInviteEmailReason } from "../../utils/errorNormalizer";
import { checkAchievementOnTeamSize } from "../../lib/achievements";

const CAPABILITY_KEYS = [
  "can_manage_tickets_basic",
  "can_change_ticket_status",
  "can_delete_tickets",
  "can_manage_ticket_archive",
  "can_manage_customers",
  "can_manage_statuses",
  "can_manage_documents",
  "can_print_export",
  "can_edit_devices",
  "can_edit_inventory",
  "can_adjust_inventory_quantity",
  "can_edit_service_settings",
] as const;

type CapabilityInfo = { label: string; description: string; group?: string };

const CAPABILITY_INFO: Record<string, CapabilityInfo> = {
  can_manage_tickets_basic: {
    label: "Úpravy zakázek",
    description: "Může měnit text, ceny a další údaje u zakázek (kromě stavu a mazání).",
    group: "Zakázky",
  },
  can_change_ticket_status: {
    label: "Změna stavu zakázky",
    description: "Může přepínat stavy zakázky (např. V opravě → Hotovo).",
    group: "Zakázky",
  },
  can_delete_tickets: {
    label: "Mazat zakázky",
    description: "Může přesunout zakázku do archivu (soft delete). Pro obnovení ze archivu je potřeba „Archiv a mazání“.",
    group: "Zakázky",
  },
  can_manage_ticket_archive: {
    label: "Archiv a mazání zakázek",
    description: "Může mazat zakázky a obnovovat je z archivu (plná správa smazaných zakázek).",
    group: "Zakázky",
  },
  can_manage_customers: {
    label: "Úpravy zákazníků",
    description: "Může měnit údaje u existujících zákazníků (jméno, kontakt, adresa atd.).",
    group: "Zákazníci",
  },
  can_manage_statuses: {
    label: "Statusy zakázek v nastavení",
    description: "Může v Nastavení přidávat, měnit a mazat stavy zakázek (V opravě, Hotovo, …).",
    group: "Nastavení",
  },
  can_manage_documents: {
    label: "Dokumenty a šablony",
    description: "Může upravovat šablony dokumentů, nastavení dokumentů a údaje firmy v JobiDocs.",
    group: "Nastavení",
  },
  can_print_export: {
    label: "Tisk a export",
    description: "Může tisknout a exportovat dokumenty (záruční list, diagnostika, seznam zakázek).",
    group: "Nastavení",
  },
  can_edit_service_settings: {
    label: "Nastavení servisu",
    description: "Může měnit základní a kontaktní údaje servisu v Nastavení.",
    group: "Nastavení",
  },
  can_edit_devices: {
    label: "Stránka Zařízení",
    description: "Může měnit údaje na stránce Zařízení.",
    group: "Sklad a zařízení",
  },
  can_edit_inventory: {
    label: "Sklad (úpravy)",
    description: "Může upravovat skladové položky (název, cena atd.) na stránce Sklad.",
    group: "Sklad a zařízení",
  },
  can_adjust_inventory_quantity: {
    label: "Úprava množství na skladu",
    description: "Může přidávat a odebírat kusy produktů na skladě. Odpočet při přidání opravy do zakázky probíhá vždy.",
    group: "Sklad a zařízení",
  },
};

type TeamSettingsProps = {
  activeServiceId: string | null;
  setActiveServiceId: (serviceId: string | null) => void;
  services: Array<{ service_id: string; service_name: string; role: string }>;
};

export function TeamSettings({ activeServiceId, setActiveServiceId, services }: TeamSettingsProps) {
  const { session } = useAuth();
  const isRootOwner = useIsRootOwner();
  const rootOwnerId = getRootOwnerId();
  const [teamMembers, setTeamMembers] = useState<any[]>([]);
  const [pendingInvites, setPendingInvites] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Invite dialog states
  const [inviteDialogOpen, setInviteDialogOpen] = useState(false);
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState<"member" | "admin">("member");
  const [_inviteMode, setInviteMode] = useState<"stock" | "custom">("stock");
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

  // Capabilities dialog – úprava povolení u membera
  const [capabilitiesDialogOpen, setCapabilitiesDialogOpen] = useState(false);
  const [capabilitiesMember, setCapabilitiesMember] = useState<{
    user_id: string;
    service_id: string;
    email: string | null;
    capabilities: Record<string, boolean>;
  } | null>(null);
  const [capabilitiesEdit, setCapabilitiesEdit] = useState<Record<string, boolean>>({});
  const [capabilitiesSaving, setCapabilitiesSaving] = useState(false);

  const loadTeamDataInProgressRef = useRef(false);

  // Service dropdown (Tým / Přístupy)
  const [serviceDropdownOpen, setServiceDropdownOpen] = useState(false);
  const serviceDropdownRef = useRef<HTMLDivElement | null>(null);
  const serviceDropdownButtonRef = useRef<HTMLButtonElement | null>(null);
  const serviceDropdownMenuRef = useRef<HTMLDivElement | null>(null);

  // Kódy pozvánek dočtené přes invite-get-token (když team-list token nevrátí)
  const [fetchedInviteTokens, setFetchedInviteTokens] = useState<Record<string, string>>({});
  const [loadingTokenForInviteId, setLoadingTokenForInviteId] = useState<string | null>(null);

  // Profily členů (nickname, avatar) pro zobrazení v Tým
  const [memberProfiles, setMemberProfiles] = useState<Record<string, { nickname: string | null; avatarUrl: string | null }>>({});

  // Load profiles (nickname, avatar) for team members
  useEffect(() => {
    if (!supabase || teamMembers.length === 0) {
      setMemberProfiles({});
      return;
    }
    const userIds = [...new Set(teamMembers.map((m: any) => m.user_id).filter(Boolean))];
    if (userIds.length === 0) {
      setMemberProfiles({});
      return;
    }
    (async () => {
      const { data } = await (supabase as any).from("profiles").select("id, nickname, avatar_url").in("id", userIds);
      const map: Record<string, { nickname: string | null; avatarUrl: string | null }> = {};
      for (const p of data ?? []) {
        map[p.id] = {
          nickname: typeof p.nickname === "string" ? p.nickname : null,
          avatarUrl: typeof p.avatar_url === "string" ? p.avatar_url : null,
        };
      }
      setMemberProfiles(map);
    })();
  }, [teamMembers]);

  // Load team members and invites when activeServiceId or token changes (ne na celý session – ten mění referenci a spouští smyčku)
  useEffect(() => {
    const client = supabase;
    const accessToken = session?.access_token ?? null;
    if (!activeServiceId || !accessToken || !client) {
      setTeamMembers([]);
      setPendingInvites([]);
      setFetchedInviteTokens({});
      setError(null);
      return;
    }

    loadTeamDataInProgressRef.current = false; // umožní načtení při přepnutí servisu (jinak ref z předchozího requestu blokuje)

    const loadTeamData = async () => {
      if (loadTeamDataInProgressRef.current) return;
      loadTeamDataInProgressRef.current = true;
      setLoading(true);
      setError(null);
      let lastStep = "init";

      try {
        const { data: { session: clientSession } } = await client.auth.getSession();
        devLog("[TeamSettings] loadTeamData: session from useAuth:", !!session, "clientSession:", !!clientSession, "access_token:", !!session?.access_token, "activeServiceId:", activeServiceId);
        if (!clientSession?.access_token && session?.access_token) {
          await client.auth.setSession({
            access_token: session.access_token,
            refresh_token: session.refresh_token ?? "",
          });
          devLog("[TeamSettings] loadTeamData: setSession called (client neměl token)");
        }

        lastStep = "team-list";
        const accessToken = clientSession?.access_token ?? session?.access_token;
        // Load team members (explicitní JWT kvůli Tauri webview – jinak 401 / failed to send)
        const { data: membersData, error: membersError } = await client.functions.invoke("team-list", {
          body: { serviceId: activeServiceId },
          ...(accessToken ? { headers: { Authorization: `Bearer ${accessToken}` } } : {}),
        });

        if (membersError) {
          (membersError as any).__step = lastStep;
          throw membersError;
        }

        if (membersData?.error) {
          setError(normalizeError(new Error(String(membersData.error))));
          setTeamMembers([]);
          setPendingInvites([]);
          setLoading(false);
          return;
        }

        // team-list vrací členy i pozvánky v jednom requestu (obchází 401 u druhého volání team-invite-list)
        let members = membersData?.members || [];
        if (rootOwnerId) members = members.filter((m: any) => m.user_id !== rootOwnerId);
        // Admin a member nesmí vidět nikoho s rolí owner (majitel aplikace) v seznamu týmu
        if (!isRootOwner) members = members.filter((m: any) => m.role !== "owner");
        setTeamMembers(members);
        setPendingInvites(membersData?.invites ?? []);
        const uid = session?.user?.id;
        if (uid && activeServiceId && members.length >= 3) checkAchievementOnTeamSize(uid, activeServiceId, members.length);
      } catch (err: any) {
        const step = err?.__step ?? lastStep;
        // Podrobné logování pro diagnostiku (Tauri / Edge Function)
        const res = err?.context as Response | undefined;
        console.error("[TeamSettings] Error loading team data (raw):", {
          step,
          name: err?.name,
          message: err?.message,
          cause: err?.cause != null ? (err.cause instanceof Error ? { message: err.cause.message, name: err.cause.name } : err.cause) : undefined,
          hasContext: !!res,
          contextType: res?.constructor?.name,
          contextStatus: res?.status,
          contextStatusText: res?.statusText,
          errKeys: err && typeof err === "object" ? Object.keys(err) : [],
        });
        if (res) {
          res.clone().text().then(
            (bodyText) => console.error("[TeamSettings] Error response body:", bodyText?.slice?.(0, 500)),
            () => console.error("[TeamSettings] Could not read error response body")
          );
        }
        if (res) {
          const status = res.status;
          const statusText = res.statusText;
          let bodyText: string;
          try {
            bodyText = await res.clone().text();
          } catch {
            bodyText = "(nelze přečíst tělo)";
          }
          try {
            const contentType = res.headers.get("Content-Type") || "";
            let body: { error?: string; message?: string; detail?: string } | null = null;
            if (contentType.includes("application/json")) {
              try {
                body = JSON.parse(bodyText);
              } catch {
                body = { error: bodyText };
              }
            } else {
              body = bodyText ? { error: bodyText } : null;
            }
            if (status === 401 && body) {
              console.error("[TeamSettings] 401 detail (Edge Function / Auth):", body.detail ?? body.message ?? body.error);
            }
            console.error("[TeamSettings] Edge Function response:", { status, statusText, body: bodyText });
            let message = normalizeError(err);
            if (body && typeof body.error === "string" && body.error.trim()) {
              message = body.error;
            } else if (body && typeof body.message === "string" && body.message.trim()) {
              message = body.message;
            }
            if (status === 403) {
              message = "Nemáte oprávnění k tomuto servisu (owner nebo admin).";
            } else if (status === 401) {
              const detail = body && typeof body.detail === "string" && body.detail.trim() ? ` (${body.detail})` : "";
              message = `Nejste přihlášeni nebo vypršela relace${detail}. Zkuste se odhlásit a znovu přihlásit.`;
            }
            setError(message || "Chyba při načítání dat týmu");
          } catch (_) {
            setError(res.status === 403 ? "Nemáte oprávnění k tomuto servisu." : (bodyText || "Chyba při načítání dat týmu"));
          }
        } else {
          setError(normalizeError(err) || "Chyba při načítání dat týmu");
        }
        setTeamMembers([]);
        setPendingInvites([]);
      } finally {
        setLoading(false);
        loadTeamDataInProgressRef.current = false;
      }
    };

    loadTeamData();
  }, [activeServiceId, session?.access_token, rootOwnerId]);

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

  // Escape zavře otevřený dialog (pozvat / odebrat / změna role / oprávnění)
  useEffect(() => {
    const anyOpen = inviteDialogOpen || removeDialogOpen || roleChangeDialogOpen || capabilitiesDialogOpen;
    if (!anyOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.preventDefault();
      if (capabilitiesDialogOpen) setCapabilitiesDialogOpen(false);
      else if (roleChangeDialogOpen) setRoleChangeDialogOpen(false);
      else if (removeDialogOpen) {
        setRemoveDialogOpen(false);
        setRemoveUserId(null);
        setRemoveServiceId(null);
      }
      else if (inviteDialogOpen) setInviteDialogOpen(false);
    };
    document.addEventListener("keydown", onKey, true);
    return () => document.removeEventListener("keydown", onKey, true);
  }, [inviteDialogOpen, removeDialogOpen, roleChangeDialogOpen, capabilitiesDialogOpen]);

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
      const accessToken = session?.access_token;
      const { data, error } = await supabase.functions.invoke("invite_create", {
        body: {
          mode: "current",
          serviceId: activeServiceId,
          email: inviteEmail.trim(),
          role: inviteRole,
        },
        ...(accessToken ? { headers: { Authorization: `Bearer ${accessToken}` } } : {}),
      });

      if (error) {
        let msg = (error as Error).message;
        const ctx = (error as { context?: Response })?.context;
        if (ctx && typeof (ctx as Response).text === "function") {
          try {
            const raw = await (ctx as Response).text();
            if (raw) {
              try {
                const body = JSON.parse(raw) as { error?: string; detail?: string; message?: string; code?: string };
                if (body?.error) msg = body.error;
                else if (body?.message) msg = body.message + (body?.code ? ` (${body.code})` : "");
                else if (body?.detail) msg = body.detail;
                else msg = raw.slice(0, 300);
              } catch {
                msg = raw.slice(0, 300);
              }
            }
          } catch (e) {
            devWarn("[TeamSettings] Could not read invite-create error body", e);
          }
        }
        console.error("[TeamSettings] invite-create error:", msg, "context:", ctx ? "has Response" : "no context", "error keys:", error && typeof error === "object" ? Object.keys(error) : []);
        showToast(`Chyba při posílání pozvánky: ${msg}`, "error");
        return;
      }

      if (data?.error) {
        showToast(`Chyba při posílání pozvánky: ${data.error}`, "error");
        return;
      }

      const inviteToken = data?.token ?? null;
      if (inviteToken) {
        navigator.clipboard.writeText(inviteToken).then(
          () => showToast("Pozvánka vytvořena. Kód pro registraci byl zkopírován do schránky – předejte ho pozvanému.", "success"),
          () => showToast(`Pozvánka vytvořena. Kód pro registraci: ${inviteToken}`, "success")
        );
      } else if (data?.email_sent === false) {
        const raw = data?.email_skipped_reason || data?.email_error || "";
        const reason = formatInviteEmailReason(raw) || "E-mail se nepodařilo odeslat.";
        showToast(`Pozvánka vytvořena, ale e-mail nebyl odeslán: ${reason}`, "error");
      } else {
        showToast("Pozvánka odeslána", "success");
      }
      setInviteDialogOpen(false);
      setInviteEmail("");
      setInviteRole("member");
      setInviteMode("stock");

      // Reload členy i pozvánky (jeden request team-list)
      const { data: listData } = await supabase.functions.invoke("team-list", {
        body: { serviceId: activeServiceId },
        ...(accessToken ? { headers: { Authorization: `Bearer ${accessToken}` } } : {}),
      });
      if (listData && !listData.error) {
        setTeamMembers(listData.members || []);
        setPendingInvites(listData.invites ?? []);
      }
    } catch (err: any) {
      console.error("[TeamSettings] Error sending invite:", err);
      showToast(`Chyba při posílání pozvánky: ${normalizeError(err)}`, "error");
    }
  };

  const handleRemoveMember = async () => {
    if (!removeUserId || !removeServiceId || !session || !supabase) {
      return;
    }

    try {
      const accessToken = session.access_token;
      const { data, error } = await supabase.functions.invoke("team-remove-member", {
        body: {
          serviceId: removeServiceId,
          userId: removeUserId,
        },
        ...(accessToken ? { headers: { Authorization: `Bearer ${accessToken}` } } : {}),
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
        ...(session?.access_token ? { headers: { Authorization: `Bearer ${session.access_token}` } } : {}),
      });
      if (membersData && !membersData.error) {
        setTeamMembers(membersData.members || []);
      }
    } catch (err: any) {
      console.error("[TeamSettings] Error removing member:", err);
      showToast(`Chyba při odebírání člena: ${normalizeError(err)}`, "error");
    }
  };

  const updateRole = async () => {
    if (!roleChangeUserId || !roleChangeNewRole || !roleChangeServiceId || !session || !supabase) {
      return;
    }

    try {
      const accessToken = session.access_token;
      const { data, error } = await supabase.functions.invoke("team-update-role", {
        body: {
          serviceId: roleChangeServiceId,
          userId: roleChangeUserId,
          role: roleChangeNewRole,
        },
        ...(accessToken ? { headers: { Authorization: `Bearer ${accessToken}` } } : {}),
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
        ...(session?.access_token ? { headers: { Authorization: `Bearer ${session.access_token}` } } : {}),
      });
      if (membersData && !membersData.error) {
        setTeamMembers(membersData.members || []);
      }
    } catch (err: any) {
      console.error("[TeamSettings] Error updating role:", err);
      showToast(`Chyba při změně role: ${normalizeError(err)}`, "error");
    }
  };

  const reloadPendingInvites = async () => {
    if (!activeServiceId || !supabase) return;

    try {
      const accessToken = session?.access_token;
      const { data: listData } = await supabase.functions.invoke("team-list", {
        body: { serviceId: activeServiceId },
        ...(accessToken ? { headers: { Authorization: `Bearer ${accessToken}` } } : {}),
      });
      if (listData && !listData.error) {
        setTeamMembers(listData.members || []);
        setPendingInvites(listData.invites ?? []);
      }
    } catch (err) {
      console.error("[TeamSettings] Error reloading team data:", err);
    }
  };

  const border = "1px solid var(--border)";
  const activeServiceName = services.find((s) => s.service_id === activeServiceId)?.service_name ?? "Bez názvu";

  // Click outside: close service dropdown (menu je v portalu, takže musíme kontrolovat i serviceDropdownMenuRef)
  useEffect(() => {
    if (!serviceDropdownOpen) return;
    const onDocClick = (e: MouseEvent) => {
      const target = e.target as Node;
      if (
        serviceDropdownRef.current?.contains(target) ||
        serviceDropdownButtonRef.current?.contains(target) ||
        serviceDropdownMenuRef.current?.contains(target)
      ) return;
      setServiceDropdownOpen(false);
    };
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, [serviceDropdownOpen]);

  return (
    <>
      <Card>
        {isRootOwner && services.length > 1 && (
          <div ref={serviceDropdownRef} style={{ marginBottom: 16, position: "relative" }}>
            <label style={{ display: "block", fontSize: 12, fontWeight: 600, color: "var(--muted)", marginBottom: 6 }}>Servis</label>
            <button
              ref={serviceDropdownButtonRef}
              type="button"
              onClick={() => setServiceDropdownOpen((o) => !o)}
              style={{
                width: "100%",
                maxWidth: 360,
                padding: "10px 14px",
                borderRadius: "var(--radius-sm)",
                border,
                background: "var(--panel)",
                color: "var(--text)",
                fontSize: 13,
                fontWeight: 500,
                cursor: "pointer",
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                gap: 8,
                transition: "border-color 0.2s, background 0.2s",
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.borderColor = "var(--accent)";
                e.currentTarget.style.background = "var(--accent-soft)";
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.borderColor = "var(--border)";
                e.currentTarget.style.background = "var(--panel)";
              }}
            >
              <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{activeServiceName}</span>
              <span style={{ flexShrink: 0, fontSize: 10, opacity: 0.8 }}>▼</span>
            </button>
            {serviceDropdownOpen && createPortal(
              <div
                ref={serviceDropdownMenuRef}
                style={{
                  position: "fixed",
                  top: serviceDropdownButtonRef.current
                    ? serviceDropdownButtonRef.current.getBoundingClientRect().bottom + 6
                    : 0,
                  left: serviceDropdownButtonRef.current
                    ? serviceDropdownButtonRef.current.getBoundingClientRect().left
                    : 0,
                  background: "var(--panel)",
                  border: "1px solid var(--border)",
                  borderRadius: "var(--radius-md)",
                  boxShadow: "var(--shadow)",
                  zIndex: 10000,
                  minWidth: Math.min(360, serviceDropdownButtonRef.current?.offsetWidth ?? 360),
                  maxWidth: 360,
                  overflow: "hidden",
                }}
                onClick={(e) => e.stopPropagation()}
              >
                {services.map((s) => (
                  <button
                    key={s.service_id}
                    type="button"
                    onClick={() => {
                      setActiveServiceId(s.service_id);
                      setServiceDropdownOpen(false);
                    }}
                    style={{
                      width: "100%",
                      padding: "10px 14px",
                      background: s.service_id === activeServiceId ? "var(--accent-soft)" : "transparent",
                      border: "none",
                      color: s.service_id === activeServiceId ? "var(--accent)" : "var(--text)",
                      fontSize: 13,
                      fontWeight: s.service_id === activeServiceId ? 600 : 400,
                      textAlign: "left",
                      cursor: "pointer",
                      transition: "background 0.2s",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "space-between",
                      gap: 8,
                    }}
                    onMouseEnter={(e) => {
                      if (s.service_id !== activeServiceId) e.currentTarget.style.background = "var(--bg)";
                    }}
                    onMouseLeave={(e) => {
                      if (s.service_id !== activeServiceId) e.currentTarget.style.background = "transparent";
                    }}
                  >
                    <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{s.service_name || "Bez názvu"}</span>
                    {s.service_id === activeServiceId && <span style={{ fontSize: 12 }}>✓</span>}
                  </button>
                ))}
              </div>,
              document.body
            )}
          </div>
        )}
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
                <div style={{ display: "flex", alignItems: "center", gap: 12, flex: 1, minWidth: 0 }}>
                  <div style={{ position: "relative", flexShrink: 0 }}>
                    {memberProfiles[member.user_id]?.avatarUrl ? (
                      <img
                        src={memberProfiles[member.user_id].avatarUrl!}
                        alt=""
                        style={{ width: 36, height: 36, borderRadius: 10, objectFit: "cover" }}
                        onError={(e) => {
                          const fallback = (e.target as HTMLImageElement).nextElementSibling as HTMLElement | null;
                          if (fallback) fallback.style.display = "grid";
                          (e.target as HTMLImageElement).style.display = "none";
                        }}
                      />
                    ) : null}
                    <div
                      style={{
                        width: 36,
                        height: 36,
                        borderRadius: 10,
                        background: "linear-gradient(135deg, var(--accent), var(--accent-hover))",
                        color: "white",
                        display: memberProfiles[member.user_id]?.avatarUrl ? "none" : "grid",
                        placeItems: "center",
                        fontWeight: 700,
                        fontSize: 14,
                      }}
                    >
                      {(memberProfiles[member.user_id]?.nickname?.trim() || member.email || "?").charAt(0).toUpperCase()}
                    </div>
                  </div>
                  <div style={{ display: "flex", flexDirection: "column", gap: 2, minWidth: 0 }}>
                    <div style={{ fontWeight: 700, fontSize: 13, color: "var(--text)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {memberProfiles[member.user_id]?.nickname?.trim() || member.email || member.user_id}
                    </div>
                    {memberProfiles[member.user_id]?.nickname?.trim() && member.email && (
                      <div style={{ fontSize: 11, color: "var(--muted)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{member.email}</div>
                    )}
                    <div style={{ fontSize: 12, color: "var(--muted)" }}>
                      {member.role === "owner" ? "Owner" : member.role === "admin" ? "Administrátor" : "Člen"}
                    </div>
                  </div>
                </div>

                <div style={{ display: "flex", gap: 8 }}>
                  {member.role === "member" && (
                  <button
                    onClick={() => {
                      const caps = (member.capabilities as Record<string, boolean>) || {};
                      const initial: Record<string, boolean> = {};
                      CAPABILITY_KEYS.forEach((k) => {
                        initial[k] = caps[k] === true;
                      });
                      setCapabilitiesEdit(initial);
                      setCapabilitiesMember({
                        user_id: member.user_id,
                        service_id: member.service_id,
                        email: member.email ?? null,
                        capabilities: caps,
                      });
                      setCapabilitiesDialogOpen(true);
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
                    Povolení
                  </button>
                  )}
                  {member.role !== "owner" && (
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
                  )}
                  {member.role !== "owner" && (
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
                  )}
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
        <div style={{ marginTop: 16 }}>
          <Card>
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
                <div style={{ display: "flex", flexDirection: "column", gap: 4, flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: 700, fontSize: 13, color: "var(--text)" }}>{invite.email}</div>
                  <div style={{ fontSize: 12, color: "var(--muted)" }}>
                    {invite.role === "admin" ? "Administrátor" : "Člen"}
                  </div>
                  <div style={{ marginTop: 6, display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                    <span style={{ fontSize: 11, color: "var(--muted)" }}>Kód pro registraci:</span>
                    {(invite.token ?? fetchedInviteTokens[invite.id]) ? (
                      <>
                        <code style={{ fontSize: 12, fontFamily: "monospace", background: "var(--bg)", padding: "4px 8px", borderRadius: 6, letterSpacing: "0.04em" }}>
                          {invite.token ?? fetchedInviteTokens[invite.id]}
                        </code>
                        <button
                          type="button"
                          onClick={() => {
                            const code = invite.token ?? fetchedInviteTokens[invite.id];
                            if (code) {
                              navigator.clipboard.writeText(code).then(
                                () => showToast("Kód zkopírován do schránky", "success"),
                                () => showToast("Kopírování se nezdařilo", "error")
                              );
                            }
                          }}
                          style={{
                            padding: "4px 10px",
                            borderRadius: 6,
                            border: "1px solid var(--border)",
                            background: "var(--bg)",
                            color: "var(--text)",
                            fontSize: 11,
                            fontWeight: 600,
                            cursor: "pointer",
                          }}
                        >
                          Kopírovat kód
                        </button>
                      </>
                    ) : (
                      <button
                        type="button"
                        onClick={async () => {
                          if (!activeServiceId || !supabase || loadingTokenForInviteId) return;
                          setLoadingTokenForInviteId(invite.id);
                          try {
                            const { data: sessionData } = await supabase.auth.getSession();
                            const accessToken = sessionData?.session?.access_token ?? session?.access_token;
                            const { data, error } = await supabase.functions.invoke("invite-get-token", {
                              body: { serviceId: activeServiceId, inviteId: invite.id },
                              ...(accessToken ? { headers: { Authorization: `Bearer ${accessToken}` } } : {}),
                            });
                            if (error) throw error;
                            if (data?.error) {
                              devWarn("[TeamSettings] invite-get-token data.error:", data.error, "detail:", (data as { detail?: string }).detail);
                              showToast(data.error, "error");
                              return;
                            }
                            if (data?.token) {
                              setFetchedInviteTokens((prev) => ({ ...prev, [invite.id]: data.token }));
                            }
                          } catch (err: any) {
                            const res = err?.context as Response | undefined;
                            if (res?.status === 401) {
                              res.clone().text().then(
                                (body) => devWarn("[TeamSettings] invite-get-token 401 body:", body),
                                () => {}
                              );
                            }
                            if (res?.status === 404) {
                              res.clone().text().then(
                                (body) => {
                                  try {
                                    const parsed = JSON.parse(body) as { error?: string };
                                    showToast(parsed?.error || "Pozvánka nebyla nalezena nebo již byla přijata.", "error");
                                  } catch {
                                    showToast("Pozvánka nebyla nalezena nebo již byla přijata.", "error");
                                  }
                                },
                                () => showToast("Pozvánka nebyla nalezena nebo již byla přijata.", "error")
                              );
                              return;
                            }
                            showToast(normalizeError(err) || "Nepodařilo načíst kód", "error");
                          } finally {
                            setLoadingTokenForInviteId(null);
                          }
                        }}
                        disabled={!!loadingTokenForInviteId}
                        style={{
                          padding: "4px 10px",
                          borderRadius: 6,
                          border: "1px solid var(--border)",
                          background: "var(--bg)",
                          color: "var(--text)",
                          fontSize: 11,
                          fontWeight: 600,
                          cursor: loadingTokenForInviteId ? "not-allowed" : "pointer",
                          opacity: loadingTokenForInviteId ? 0.7 : 1,
                        }}
                      >
                        {loadingTokenForInviteId === invite.id ? "Načítám…" : "Zobrazit kód"}
                      </button>
                    )}
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
                      const accessToken = session?.access_token;
                      const { data, error } = await supabase.functions.invoke("invite-delete", {
                        body: {
                          serviceId: activeServiceId,
                          inviteId: invite.id,
                        },
                        ...(accessToken ? { headers: { Authorization: `Bearer ${accessToken}` } } : {}),
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
                      showToast(`Chyba při mazání pozvánky: ${normalizeError(err)}`, "error");
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
        </div>
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
                  placeholder="email@example.cz"
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

      {/* Dialog úpravy povolení (capabilities) u membera */}
      {capabilitiesDialogOpen && capabilitiesMember && (
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
          onClick={() => {
            if (!capabilitiesSaving) {
              setCapabilitiesDialogOpen(false);
              setCapabilitiesMember(null);
            }
          }}
        >
          <div
            style={{
              background: "var(--panel)",
              border: "1px solid var(--border)",
              borderRadius: "var(--radius-md)",
              padding: 24,
              maxWidth: 420,
              width: "90%",
              maxHeight: "85vh",
              overflow: "auto",
              boxShadow: "var(--shadow)",
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div style={{ fontWeight: 900, fontSize: 18, marginBottom: 4, color: "var(--text)" }}>
              Povolení pro člena
            </div>
            <div style={{ fontSize: 13, color: "var(--muted)", marginBottom: 20 }}>
              {capabilitiesMember.email || capabilitiesMember.user_id} · zaškrtnutá povolení platí v tomto servisu pro roli Člen.
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 20, marginBottom: 24 }}>
              {(["Zakázky", "Zákazníci", "Nastavení", "Sklad a zařízení"] as const).map((group) => {
                const keysInGroup = CAPABILITY_KEYS.filter((k) => CAPABILITY_INFO[k]?.group === group);
                if (keysInGroup.length === 0) return null;
                return (
                  <div key={group}>
                    <div
                      style={{
                        fontSize: 11,
                        fontWeight: 700,
                        color: "var(--muted)",
                        textTransform: "uppercase",
                        letterSpacing: "0.05em",
                        marginBottom: 10,
                      }}
                    >
                      {group}
                    </div>
                    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                      {keysInGroup.map((key) => {
                        const info = CAPABILITY_INFO[key];
                        return (
                          <label
                            key={key}
                            style={{
                              display: "flex",
                              alignItems: "flex-start",
                              gap: 12,
                              cursor: "pointer",
                              padding: "12px 14px",
                              borderRadius: 10,
                              border: "1px solid var(--border)",
                              background: capabilitiesEdit[key] ? "var(--accent-soft)" : "var(--bg)",
                              transition: "background 0.15s, border-color 0.15s",
                            }}
                            onMouseEnter={(e) => {
                              if (!capabilitiesEdit[key]) {
                                e.currentTarget.style.background = "var(--panel)";
                                e.currentTarget.style.borderColor = "var(--accent)";
                              }
                            }}
                            onMouseLeave={(e) => {
                              if (!capabilitiesEdit[key]) {
                                e.currentTarget.style.background = "var(--bg)";
                                e.currentTarget.style.borderColor = "var(--border)";
                              }
                            }}
                          >
                            <input
                              type="checkbox"
                              checked={capabilitiesEdit[key] === true}
                              onChange={(e) => {
                                setCapabilitiesEdit((prev) => ({ ...prev, [key]: e.target.checked }));
                              }}
                              style={{ marginTop: 2, flexShrink: 0 }}
                            />
                            <div style={{ flex: 1, minWidth: 0 }}>
                              <div style={{ fontWeight: 600, fontSize: 13, color: "var(--text)", marginBottom: 2 }}>
                                {info?.label ?? key}
                              </div>
                              <div style={{ fontSize: 12, color: "var(--muted)", lineHeight: 1.4 }}>
                                {info?.description ?? ""}
                              </div>
                            </div>
                          </label>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </div>
            <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
              <button
                type="button"
                onClick={() => {
                  if (!capabilitiesSaving) {
                    setCapabilitiesDialogOpen(false);
                    setCapabilitiesMember(null);
                  }
                }}
                style={{
                  padding: "8px 16px",
                  borderRadius: 8,
                  border: "1px solid var(--border)",
                  background: "var(--panel)",
                  color: "var(--text)",
                  fontWeight: 600,
                  cursor: capabilitiesSaving ? "not-allowed" : "pointer",
                }}
              >
                Zrušit
              </button>
              <button
                type="button"
                disabled={capabilitiesSaving}
                onClick={async () => {
                  if (!supabase || !capabilitiesMember || !session) return;
                  setCapabilitiesSaving(true);
                  try {
                    if (isRootOwner) {
                      const { data: sessionData } = await supabase.auth.getSession();
                      const token = sessionData?.session?.access_token;
                      const { data, error: fnError } = await supabase.functions.invoke("team-set-capabilities", {
                        body: {
                          serviceId: capabilitiesMember.service_id,
                          userId: capabilitiesMember.user_id,
                          capabilities: capabilitiesEdit,
                        },
                        ...(token ? { headers: { Authorization: `Bearer ${token}` } } : {}),
                      });
                      if (fnError) throw fnError;
                      if (data?.error) throw new Error(data.error);
                    } else {
                      const { error: rpcError } = await (supabase as any).rpc("set_member_capabilities", {
                        p_service_id: capabilitiesMember.service_id,
                        p_user_id: capabilitiesMember.user_id,
                        p_capabilities: capabilitiesEdit,
                      });
                      if (rpcError) throw rpcError;
                    }
                    showToast("Povolení uložena", "success");
                    setCapabilitiesDialogOpen(false);
                    setCapabilitiesMember(null);
                    setTeamMembers((prev) =>
                      prev.map((m) =>
                        m.user_id === capabilitiesMember.user_id && m.service_id === capabilitiesMember.service_id
                          ? { ...m, capabilities: { ...capabilitiesEdit } }
                          : m
                      )
                    );
                  } catch (err) {
                    showToast(normalizeError(err) || "Chyba při ukládání povolení", "error");
                  } finally {
                    setCapabilitiesSaving(false);
                  }
                }}
                style={{
                  padding: "8px 16px",
                  borderRadius: 8,
                  border: "none",
                  background: "var(--accent)",
                  color: "white",
                  fontWeight: 600,
                  cursor: capabilitiesSaving ? "not-allowed" : "pointer",
                }}
              >
                {capabilitiesSaving ? "Ukládám…" : "Uložit"}
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



