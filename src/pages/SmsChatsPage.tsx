import { useCallback, useEffect, useState } from "react";
import { getTypedSupabaseClient } from "../lib/typedSupabase";
import { showToast } from "../components/Toast";
import { reportError } from "../lib/reportError";
import { SmsChat } from "../components/SmsChat";
import { normalizePhone } from "../lib/phone";
import { smsDoNotNotifyRef } from "../hooks/useSmsNotifications";

type ConversationRow = {
  id: string;
  customer_phone: string;
  customer_name: string | null;
  /** Jméno pro zobrazení (DB + zákazník / zakázka) */
  display_name: string | null;
  ticket_id: string | null;
  updated_at: string;
  archived: boolean;
  ticket_code: string | null;
  unread: number;
};

type OpenSmsIntent = { phone: string; displayName?: string; conversationId?: string };

type Props = {
  activeServiceId: string | null;
  onOpenTicket?: (ticketId: string, openSmsPanel: boolean) => void;
  openSmsIntent?: OpenSmsIntent | null;
  onOpenSmsIntentConsumed?: () => void;
};

function formatPhoneShort(phone: string): string {
  const digits = phone.replace(/\D/g, "");
  if (digits.length >= 9) return digits.slice(-9).replace(/(\d{3})(\d{3})(\d{3})/, "$1 $2 $3");
  return phone;
}

async function enrichDisplayNames(
  client: NonNullable<ReturnType<typeof getTypedSupabaseClient>>,
  activeServiceId: string,
  rows: Array<{
    id: string;
    customer_phone: string;
    customer_name: string | null;
  }>
): Promise<Map<string, string>> {
  const displayById = new Map<string, string>();
  const phones = [...new Set(rows.map((r) => r.customer_phone))];
  const nameByPhone: Record<string, string> = {};

  const { data: custs } = await client
    .from("customers")
    .select("name, phone_norm")
    .eq("service_id", activeServiceId)
    .in("phone_norm", phones);
  for (const c of custs ?? []) {
    const pn = (c as { phone_norm?: string; name?: string }).phone_norm;
    const nm = (c as { name?: string }).name?.trim();
    if (pn && nm) nameByPhone[pn] = nm;
  }

  const needTicket = phones.filter((p) => {
    const row = rows.find((r) => r.customer_phone === p);
    return !(row?.customer_name?.trim()) && !nameByPhone[p];
  });

  if (needTicket.length > 0) {
    const { data: tix } = await client
      .from("tickets")
      .select("customer_phone, customer_name, updated_at")
      .eq("service_id", activeServiceId)
      .not("customer_phone", "is", null)
      .order("updated_at", { ascending: false })
      .limit(4000);
    const ticketNameByNorm: Record<string, string> = {};
    const needSet = new Set(needTicket);
    for (const t of tix ?? []) {
      const raw = (t as { customer_phone?: string; customer_name?: string }).customer_phone;
      const nm = (t as { customer_name?: string }).customer_name?.trim();
      const n = raw ? normalizePhone(raw) : null;
      if (!n || !nm || ticketNameByNorm[n] || !needSet.has(n)) continue;
      ticketNameByNorm[n] = nm;
    }
    for (const p of needTicket) {
      if (ticketNameByNorm[p]) nameByPhone[p] = ticketNameByNorm[p];
    }
  }

  for (const r of rows) {
    const d = r.customer_name?.trim() || nameByPhone[r.customer_phone] || null;
    displayById.set(r.id, d ?? "");
  }
  return displayById;
}

export default function SmsChatsPage({ activeServiceId, onOpenTicket, openSmsIntent, onOpenSmsIntentConsumed }: Props) {
  const [conversations, setConversations] = useState<ConversationRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [showArchived, setShowArchived] = useState(false);
  const [selected, setSelected] = useState<ConversationRow | null>(null);
  const [synthetic, setSynthetic] = useState<{ phone: string; displayName: string } | null>(null);

  const loadConversations = useCallback(async (): Promise<ConversationRow[]> => {
    const client = getTypedSupabaseClient();
    if (!activeServiceId || !client) {
      setConversations([]);
      setLoading(false);
      return [];
    }
    const { data: rows, error } = await client
      .from("sms_conversations")
      .select("id, customer_phone, customer_name, ticket_id, updated_at, archived")
      .eq("service_id", activeServiceId)
      .eq("archived", showArchived)
      .order("updated_at", { ascending: false });

    if (error || !rows?.length) {
      setConversations([]);
      setLoading(false);
      return [];
    }

    const list = rows as ConversationRow[];
    const displayMap = await enrichDisplayNames(client, activeServiceId, list);

    const ticketIds = list.map((r) => r.ticket_id).filter(Boolean) as string[];
    let codes: Record<string, string> = {};
    if (ticketIds.length > 0) {
      const { data: tickets } = await client.from("tickets").select("id, code").in("id", ticketIds);
      if (tickets) codes = Object.fromEntries(tickets.map((t) => [t.id, t.code ?? ""]));
    }

    const convIds = list.map((c) => c.id);
    const unreadMap: Record<string, number> = {};
    if (convIds.length > 0) {
      const { data: msgRows } = await client
        .from("sms_messages")
        .select("conversation_id")
        .in("conversation_id", convIds)
        .eq("direction", "inbound")
        .is("read_at", null);
      if (msgRows) {
        for (const r of msgRows) {
          unreadMap[r.conversation_id] = (unreadMap[r.conversation_id] ?? 0) + 1;
        }
      }
    }

    const enriched: ConversationRow[] = list.map((c) => ({
      ...c,
      display_name: displayMap.get(c.id) || c.customer_name?.trim() || null,
      ticket_code: c.ticket_id ? codes[c.ticket_id] ?? null : null,
      unread: unreadMap[c.id] ?? 0,
    }));

    setConversations(enriched);
    setLoading(false);

    for (const c of enriched) {
      const disp = c.display_name?.trim();
      if (disp && !c.customer_name?.trim()) {
        client.from("sms_conversations").update({ customer_name: disp }).eq("id", c.id).then(() => {});
      }
    }

    return enriched;
  }, [activeServiceId, showArchived]);

  useEffect(() => {
    setLoading(true);
    void loadConversations();
  }, [loadConversations]);

  useEffect(() => {
    smsDoNotNotifyRef.conversationId = selected?.id ?? null;
    return () => {
      smsDoNotNotifyRef.conversationId = null;
    };
  }, [selected?.id]);

  useEffect(() => {
    if (!openSmsIntent || !activeServiceId || loading) return;

    if (openSmsIntent.conversationId) {
      const cid = openSmsIntent.conversationId;
      const row = conversations.find((c) => c.id === cid);
      if (row) {
        setSelected(row);
        setSynthetic(null);
        onOpenSmsIntentConsumed?.();
        return;
      }
      let cancelled = false;
      void (async () => {
        const client = getTypedSupabaseClient();
        if (!client) {
          onOpenSmsIntentConsumed?.();
          return;
        }
        const { data: conv } = await client
          .from("sms_conversations")
          .select("id, customer_phone, customer_name, ticket_id, updated_at, archived")
          .eq("id", cid)
          .eq("service_id", activeServiceId)
          .maybeSingle();
        if (cancelled) return;
        if (!conv) {
          onOpenSmsIntentConsumed?.();
          return;
        }
        if (conv.archived !== showArchived) {
          setShowArchived(conv.archived);
          return;
        }
        const enriched = await loadConversations();
        if (cancelled) return;
        const r = enriched.find((c) => c.id === cid);
        if (r) {
          setSelected(r);
          setSynthetic(null);
        } else {
          const norm = normalizePhone(openSmsIntent.phone || conv.customer_phone);
          if (norm) {
            setSelected(null);
            setSynthetic({
              phone: norm,
              displayName: (openSmsIntent.displayName ?? conv.customer_name ?? "").trim(),
            });
          }
        }
        onOpenSmsIntentConsumed?.();
      })();
      return () => {
        cancelled = true;
      };
    }

    const norm = normalizePhone(openSmsIntent.phone);
    if (!norm) {
      onOpenSmsIntentConsumed?.();
      return;
    }
    const row = conversations.find((c) => c.customer_phone === norm);
    if (row) {
      setSelected(row);
      setSynthetic(null);
    } else {
      setSelected(null);
      setSynthetic({
        phone: norm,
        displayName: (openSmsIntent.displayName ?? "").trim(),
      });
    }
    onOpenSmsIntentConsumed?.();
  }, [
    openSmsIntent,
    loading,
    conversations,
    activeServiceId,
    onOpenSmsIntentConsumed,
    showArchived,
    loadConversations,
  ]);

  const handleArchive = async (id: string, archive: boolean) => {
    const client = getTypedSupabaseClient();
    if (!client) return;
    const { error } = await client.from("sms_conversations").update({ archived: archive }).eq("id", id);
    if (error) {
      reportError({
        code: "smschatspage.client_failed",
        error: undefined,
        userMessage: "Nepodařilo archivovat",
        source: "SmsChatsPage.client",
      });
      return;
    }
    setConversations((prev) => prev.filter((c) => c.id !== id));
    setSelected((s) => (s?.id === id ? null : s));
    showToast(archive ? "Přesunuto do archivu" : "Vyjmuto z archivu", "success");
  };

  const selectRow = (c: ConversationRow) => {
    setSynthetic(null);
    setSelected(c);
  };

  const handleConversationCreated = async (newId: string) => {
    const enriched = await loadConversations();
    let row = enriched.find((r) => r.id === newId);
    const client = getTypedSupabaseClient();
    if (!row && client && activeServiceId) {
      const { data: raw } = await client
        .from("sms_conversations")
        .select("id, customer_phone, customer_name, ticket_id, updated_at, archived")
        .eq("id", newId)
        .maybeSingle();
      if (raw) {
        const dm = await enrichDisplayNames(client, activeServiceId, [raw as { id: string; customer_phone: string; customer_name: string | null }]);
        let ticket_code: string | null = null;
        if (raw.ticket_id) {
          const { data: tk } = await client.from("tickets").select("code").eq("id", raw.ticket_id).maybeSingle();
          ticket_code = (tk as { code?: string })?.code ?? null;
        }
        row = {
          ...(raw as ConversationRow),
          display_name: dm.get(raw.id) || (raw as { customer_name?: string }).customer_name?.trim() || null,
          ticket_code,
          unread: 0,
        };
        if ((raw as { archived?: boolean }).archived === showArchived) {
          setConversations((prev) => [row!, ...prev.filter((c) => c.id !== newId)]);
        }
      }
    }
    if (row) {
      setSelected(row);
      setSynthetic(null);
    }
  };

  if (!activeServiceId) {
    return (
      <div style={{ padding: 24, color: "var(--muted)", textAlign: "center" }}>
        Vyberte servis v sidebaru.
      </div>
    );
  }

  const panelTitle = selected
    ? selected.display_name?.trim() || selected.customer_name?.trim() || "Zákazník"
    : synthetic
      ? synthetic.displayName || "Zákazník"
      : "";
  const panelPhone = selected?.customer_phone ?? synthetic?.phone ?? "";
  const panelTicketId = selected?.ticket_id ?? null;
  const panelTicketCode = selected?.ticket_code ?? null;

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", minHeight: 0, padding: "var(--pad-24)" }}>
      <div style={{ flexShrink: 0, marginBottom: 16 }}>
        <h1 style={{ fontSize: 22, fontWeight: 950, color: "var(--text)", margin: 0 }}>SMS chaty</h1>
        <p style={{ fontSize: 13, color: "var(--muted)", marginTop: 4 }}>
          Vyberte konverzaci – chat se zobrazí zde. Archivované zůstávají u zakázky, jen se tu neschovávají.
        </p>
      </div>

      <div style={{ display: "flex", gap: 24, flex: 1, minHeight: 0 }}>
        <div style={{ display: "flex", flexDirection: "column", minWidth: 0, flex: "0 0 320px" }}>
          <label style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12, fontSize: 13, color: "var(--text)", cursor: "pointer" }}>
            <input type="checkbox" checked={showArchived} onChange={(e) => setShowArchived(e.target.checked)} />
            Zobrazit archivované
          </label>
          {loading ? (
            <div style={{ padding: 24, textAlign: "center", color: "var(--muted)" }}>Načítám…</div>
          ) : conversations.length === 0 && !synthetic ? (
            <div style={{ padding: 24, textAlign: "center", color: "var(--muted)", borderRadius: 12, background: "var(--panel-2)" }}>
              {showArchived ? "Žádné archivované chaty." : "Žádné SMS konverzace."}
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 6, overflowY: "auto", flex: 1, minHeight: 0 }}>
              {synthetic && !conversations.some((c) => c.customer_phone === synthetic.phone) && (
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 12,
                    padding: "12px 16px",
                    borderRadius: 12,
                    border: "2px solid var(--accent)",
                    background: "var(--panel-2)",
                  }}
                >
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontWeight: 700, fontSize: 13, color: "var(--text)" }}>
                      {synthetic.displayName || formatPhoneShort(synthetic.phone)}
                    </div>
                    <div style={{ fontSize: 11, color: "var(--muted)", marginTop: 2 }}>{synthetic.phone}</div>
                    <div style={{ fontSize: 11, color: "var(--accent)", marginTop: 4 }}>Nový chat – pošlete první zprávu</div>
                  </div>
                </div>
              )}
              {conversations.map((c) => (
                <div
                  key={c.id}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 12,
                    padding: "12px 16px",
                    borderRadius: 12,
                    border: "1px solid var(--border)",
                    background: selected?.id === c.id ? "var(--panel-2)" : "var(--panel)",
                    cursor: "pointer",
                  }}
                  onClick={() => selectRow(c)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      selectRow(c);
                    }
                  }}
                  role="button"
                  tabIndex={0}
                >
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                      <span style={{ fontWeight: 700, fontSize: 13, color: "var(--text)" }}>
                        {c.display_name?.trim() || c.customer_name?.trim() || formatPhoneShort(c.customer_phone)}
                      </span>
                      {c.ticket_code && (
                        <span
                          style={{
                            fontSize: 11,
                            color: "var(--muted)",
                            background: "var(--panel-2)",
                            padding: "2px 6px",
                            borderRadius: 6,
                          }}
                        >
                          {c.ticket_code}
                        </span>
                      )}
                      {c.unread > 0 && (
                        <span
                          style={{
                            minWidth: 20,
                            height: 20,
                            borderRadius: 10,
                            background: "#FF3B30",
                            color: "#fff",
                            fontSize: 11,
                            fontWeight: 700,
                            display: "inline-flex",
                            alignItems: "center",
                            justifyContent: "center",
                          }}
                        >
                          {c.unread > 99 ? "99+" : c.unread}
                        </span>
                      )}
                    </div>
                    <div style={{ fontSize: 11, color: "var(--muted)", marginTop: 2 }}>{c.customer_phone}</div>
                  </div>
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      handleArchive(c.id, !showArchived);
                    }}
                    style={{
                      padding: "6px 12px",
                      fontSize: 12,
                      border: "1px solid var(--border)",
                      borderRadius: 8,
                      background: "var(--panel-2)",
                      color: "var(--muted)",
                      cursor: "pointer",
                      flexShrink: 0,
                    }}
                    title={showArchived ? "Vyjmout z archivu" : "Archivovat"}
                  >
                    {showArchived ? "Vyjmout" : "Archivovat"}
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>

        <div
          style={{
            flex: 1,
            minWidth: 0,
            display: "flex",
            flexDirection: "column",
            border: "1px solid var(--border)",
            borderRadius: 12,
            background: "var(--panel)",
            overflow: "hidden",
          }}
        >
          {selected || synthetic ? (
            <>
              <div
                style={{
                  flexShrink: 0,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  gap: 12,
                  padding: "12px 16px",
                  borderBottom: "1px solid var(--border)",
                }}
              >
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontWeight: 700, fontSize: 15, color: "var(--text)" }}>{panelTitle}</div>
                  <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 2 }}>
                    {panelTicketCode && panelTicketId && (
                      <>
                        {onOpenTicket ? (
                          <button
                            type="button"
                            onClick={() => onOpenTicket(panelTicketId, true)}
                            style={{
                              fontSize: 12,
                              color: "var(--accent)",
                              background: "none",
                              border: "none",
                              cursor: "pointer",
                              textDecoration: "underline",
                              padding: 0,
                              marginRight: 8,
                            }}
                          >
                            Zakázka {panelTicketCode}
                          </button>
                        ) : (
                          <span style={{ marginRight: 8 }}>Zakázka {panelTicketCode}</span>
                        )}
                      </>
                    )}
                    <span>{panelPhone}</span>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    setSelected(null);
                    setSynthetic(null);
                  }}
                  style={{
                    width: 36,
                    height: 36,
                    border: "none",
                    background: "var(--panel-2)",
                    borderRadius: 8,
                    cursor: "pointer",
                    fontSize: 18,
                    lineHeight: 1,
                    color: "var(--muted)",
                  }}
                  aria-label="Zavřít chat"
                >
                  ×
                </button>
              </div>
              <div style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column" }}>
                <SmsChat
                  conversationId={selected?.id}
                  ticketId={selected?.ticket_id ?? null}
                  serviceId={activeServiceId}
                  customerPhone={panelPhone}
                  customerName={selected?.display_name?.trim() || selected?.customer_name?.trim() || synthetic?.displayName || null}
                  onConversationCreated={handleConversationCreated}
                />
              </div>
            </>
          ) : (
            <div
              style={{
                flex: 1,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                color: "var(--muted)",
                fontSize: 14,
              }}
            >
              Vyberte konverzaci v seznamu vlevo
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
