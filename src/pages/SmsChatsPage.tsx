import { useEffect, useState } from "react";
import { supabase } from "../lib/supabaseClient";
import { showToast } from "../components/Toast";
import { SmsChat } from "../components/SmsChat";

type ConversationRow = {
  id: string;
  customer_phone: string;
  customer_name: string | null;
  ticket_id: string | null;
  updated_at: string;
  archived: boolean;
  ticket_code: string | null;
  unread: number;
};

type Props = {
  activeServiceId: string | null;
  /** Optional – used for "Otevřít zakázku" when conversation is linked to a ticket. */
  onOpenTicket?: (ticketId: string, openSmsPanel: boolean) => void;
};

function formatPhoneShort(phone: string): string {
  const digits = phone.replace(/\D/g, "");
  if (digits.length >= 9) return digits.slice(-9).replace(/(\d{3})(\d{3})(\d{3})/, "$1 $2 $3");
  return phone;
}

export default function SmsChatsPage({ activeServiceId, onOpenTicket }: Props) {
  const [conversations, setConversations] = useState<ConversationRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [showArchived, setShowArchived] = useState(false);
  const [selected, setSelected] = useState<ConversationRow | null>(null);

  useEffect(() => {
    if (!activeServiceId || !supabase) {
      setConversations([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    (async () => {
      const { data: rows, error } = await supabase
        .from("sms_conversations")
        .select("id, customer_phone, customer_name, ticket_id, updated_at, archived")
        .eq("service_id", activeServiceId)
        .eq("archived", showArchived)
        .order("updated_at", { ascending: false });

      if (error) {
        setConversations([]);
        setLoading(false);
        return;
      }

      const list = rows ?? [];
      const ticketIds = list.map((r) => r.ticket_id).filter(Boolean) as string[];
      let codes: Record<string, string> = {};
      if (ticketIds.length > 0) {
        const { data: tickets } = await supabase.from("tickets").select("id, code").in("id", ticketIds);
        if (tickets) codes = Object.fromEntries(tickets.map((t) => [t.id, t.code ?? ""]));
      }

      const convIds = list.map((c) => c.id);
      let unreadMap: Record<string, number> = {};
      if (convIds.length > 0) {
        const { data: msgRows } = await supabase
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

      setConversations(
        list.map((c) => ({
          ...c,
          ticket_code: c.ticket_id ? codes[c.ticket_id] ?? null : null,
          unread: unreadMap[c.id] ?? 0,
        }))
      );
      setLoading(false);
    })();
  }, [activeServiceId, showArchived]);

  const handleArchive = async (id: string, archive: boolean) => {
    if (!supabase) return;
    const { error } = await supabase.from("sms_conversations").update({ archived: archive }).eq("id", id);
    if (error) {
      showToast("Nepodařilo archivovat", "error");
      return;
    }
    setConversations((prev) => prev.filter((c) => c.id !== id));
    setSelected((s) => (s?.id === id ? null : s));
    showToast(archive ? "Přesunuto do archivu" : "Vyjmuto z archivu", "success");
  };

  if (!activeServiceId) {
    return (
      <div style={{ padding: 24, color: "var(--muted)", textAlign: "center" }}>
        Vyberte servis v sidebaru.
      </div>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", minHeight: 0, padding: "var(--pad-24)" }}>
      <div style={{ flexShrink: 0, marginBottom: 16 }}>
        <h1 style={{ fontSize: 22, fontWeight: 950, color: "var(--text)", margin: 0 }}>SMS chaty</h1>
        <p style={{ fontSize: 13, color: "var(--muted)", marginTop: 4 }}>
          Vyberte konverzaci – chat se zobrazí zde. Archivované zůstávají u zakázky, jen se tu neschovávají.
        </p>
      </div>

      <div style={{ display: "flex", gap: 24, flex: 1, minHeight: 0 }}>
        {/* Seznam konverzací */}
        <div style={{ display: "flex", flexDirection: "column", minWidth: 0, flex: "0 0 320px" }}>
          <label style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12, fontSize: 13, color: "var(--text)", cursor: "pointer" }}>
            <input
              type="checkbox"
              checked={showArchived}
              onChange={(e) => setShowArchived(e.target.checked)}
            />
            Zobrazit archivované
          </label>
          {loading ? (
            <div style={{ padding: 24, textAlign: "center", color: "var(--muted)" }}>Načítám…</div>
          ) : conversations.length === 0 ? (
            <div style={{ padding: 24, textAlign: "center", color: "var(--muted)", borderRadius: 12, background: "var(--panel-2)" }}>
              {showArchived ? "Žádné archivované chaty." : "Žádné SMS konverzace."}
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 6, overflowY: "auto", flex: 1, minHeight: 0 }}>
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
                  onClick={() => setSelected(c)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      setSelected(c);
                    }
                  }}
                  role="button"
                  tabIndex={0}
                >
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                      <span style={{ fontWeight: 700, fontSize: 13, color: "var(--text)" }}>
                        {c.customer_name || formatPhoneShort(c.customer_phone)}
                      </span>
                      {c.ticket_code && (
                        <span style={{ fontSize: 11, color: "var(--muted)", background: "var(--panel-2)", padding: "2px 6px", borderRadius: 6 }}>
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

        {/* Chat panel */}
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
          {selected ? (
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
                  <div style={{ fontWeight: 700, fontSize: 15, color: "var(--text)" }}>
                    {selected.customer_name?.trim() || "Zákazník"}
                  </div>
                  <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 2 }}>
                    {selected.ticket_code && (
                      <>
                        {onOpenTicket && selected.ticket_id ? (
                          <button
                            type="button"
                            onClick={() => onOpenTicket(selected.ticket_id!, true)}
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
                            Zakázka {selected.ticket_code}
                          </button>
                        ) : (
                          <span style={{ marginRight: 8 }}>Zakázka {selected.ticket_code}</span>
                        )}
                      </>
                    )}
                    <span>{selected.customer_phone}</span>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setSelected(null)}
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
                  conversationId={selected.id}
                  ticketId={selected.ticket_id}
                  serviceId={activeServiceId}
                  customerPhone={selected.customer_phone}
                  customerName={selected.customer_name}
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
