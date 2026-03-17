import { useCallback, useEffect, useRef, useState } from "react";
import { supabase, supabaseUrl, supabaseFetch } from "../lib/supabaseClient";
import { getTypedSupabaseClient } from "../lib/typedSupabase";
import { showToast } from "./Toast";

/** E.164 for Twilio. Czech: +420 + 9 digits (no leading 0). */
function normalizeE164(phone: string): string {
  const digits = phone.replace(/\D/g, "");
  if (!digits.length) return phone.trim().startsWith("+") ? phone.trim() : `+${phone.trim()}`;
  if (digits.length === 9 && /^[79]/.test(digits)) return `+420${digits}`;
  if (digits.length === 10 && digits.startsWith("0") && /^0[79]/.test(digits)) return `+420${digits.slice(1)}`;
  if (digits.startsWith("420") && digits.length === 12) return `+${digits}`;
  if (digits.startsWith("00420") && digits.length === 14) return `+420${digits.slice(5)}`;
  const withPlus = digits.startsWith("+") ? digits : `+${digits}`;
  return withPlus.replace(/^\+0+/, "+") || "+";
}

function formatMessageTime(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);
  const weekAgo = new Date(today);
  weekAgo.setDate(weekAgo.getDate() - 7);
  const yearAgo = new Date(today);
  yearAgo.setFullYear(yearAgo.getFullYear() - 1);

  const time = d.toLocaleTimeString("cs-CZ", { hour: "2-digit", minute: "2-digit" });
  if (d >= today) return time;
  if (d >= yesterday) return `včera ${time}`;
  if (d >= weekAgo) {
    const day = ["Ne", "Po", "Út", "St", "Čt", "Pá", "So"][d.getDay()];
    return `${day} ${time}`;
  }
  if (d >= yearAgo) return `${d.getDate()}. ${d.getMonth() + 1}. ${time}`;
  return `${d.getDate()}. ${d.getMonth() + 1}. ${d.getFullYear()} ${time}`;
}

export type SmsMessage = {
  id: string;
  direction: "inbound" | "outbound";
  body: string;
  sent_at: string;
  read_at: string | null;
  status?: string | null;
  pending?: boolean;
};

type SmsChatProps = {
  /** When provided (e.g. on Sms Chats page), load this conversation directly instead of looking up by phone. */
  conversationId?: string | null;
  /** Optional – used when opening from Orders to link sent messages to the ticket. */
  ticketId?: string | null;
  serviceId: string;
  customerPhone: string | null;
  customerName: string | null;
};

export function SmsChat({ conversationId: conversationIdProp, ticketId, serviceId, customerPhone, customerName: _customerName }: SmsChatProps) {
  const [active, setActive] = useState(false);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [messages, setMessages] = useState<SmsMessage[]>([]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [loading, setLoading] = useState(true);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const phoneNorm = customerPhone ? normalizeE164(customerPhone) : "";

  const scrollToBottom = useCallback((smooth = true) => {
    messagesEndRef.current?.scrollIntoView({ behavior: smooth ? "smooth" : "auto", block: "end" });
  }, []);

  useEffect(() => {
    const client = getTypedSupabaseClient();
    if (!client || !serviceId) {
      setActive(false);
      setLoading(false);
      return;
    }
    const hasConversationId = !!conversationIdProp;
    if (!hasConversationId && !phoneNorm) {
      setActive(false);
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    (async () => {
      const { data: phoneRow } = await client
        .from("service_phone_numbers")
        .select("id")
        .eq("service_id", serviceId)
        .eq("active", true)
        .maybeSingle();
      if (cancelled) return;
      if (!phoneRow) {
        setActive(false);
        setLoading(false);
        return;
      }
      setActive(true);

      let convId: string | null = null;
      if (hasConversationId) {
        convId = conversationIdProp;
      } else {
        const { data: conv } = await client
          .from("sms_conversations")
          .select("id")
          .eq("service_id", serviceId)
          .eq("customer_phone", phoneNorm)
          .maybeSingle();
        if (cancelled) return;
        convId = conv?.id ?? null;
      }
      setConversationId(convId);

      if (convId) {
        const { data: rows } = await client
          .from("sms_messages")
          .select("id, direction, body, sent_at, read_at, status")
          .eq("conversation_id", convId)
          .order("sent_at", { ascending: true });
        if (!cancelled) setMessages((rows ?? []).map((r) => ({ ...r, direction: r.direction as "inbound" | "outbound", pending: false })));

        await client
          .from("sms_messages")
          .update({ read_at: new Date().toISOString() })
          .eq("conversation_id", convId)
          .is("read_at", null)
          .eq("direction", "inbound");
      } else {
        if (!cancelled) setMessages([]);
      }
      if (!cancelled) setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [serviceId, phoneNorm, conversationIdProp]);

  useEffect(() => {
    const client = getTypedSupabaseClient();
    if (!conversationId || !client) return;
    const topic = `sms_messages:${conversationId}`;
    const channel = client
      .channel(topic)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "sms_messages", filter: `conversation_id=eq.${conversationId}` },
        (payload) => {
          const row = (payload.new as Record<string, unknown>);
          setMessages((prev) => {
            const exists = prev.some((m) => m.id === row.id);
            if (exists) return prev;
            return [...prev, {
              id: row.id as string,
              direction: row.direction as "inbound" | "outbound",
              body: row.body as string,
              sent_at: row.sent_at as string,
              read_at: (row.read_at as string) ?? null,
              status: row.status as string | null,
              pending: false,
            }];
          });
          scrollToBottom();
        }
      )
      .subscribe();
    return () => { client.removeChannel(channel); };
  }, [conversationId, scrollToBottom]);

  useEffect(() => {
    scrollToBottom(false);
  }, [messages.length, scrollToBottom]);

  const sendMessage = useCallback(async () => {
    const body = input.trim();
    if (!body || !active || !phoneNorm || sending || !supabase) return;

    setInput("");
    const tempId = `pending-${Date.now()}`;
    const optimistic: SmsMessage = {
      id: tempId,
      direction: "outbound",
      body,
      sent_at: new Date().toISOString(),
      read_at: null,
      pending: true,
    };
    setMessages((prev) => [...prev, optimistic]);
    scrollToBottom();
    setSending(true);

    try {
      const { data: sessionData } = await supabase.auth.getSession();
      const token = sessionData?.session?.access_token;
      if (!token) {
        throw new Error("Nejste přihlášeni");
      }
      const res = await supabaseFetch(`${supabaseUrl}/functions/v1/sms-send`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          service_id: serviceId,
          to: phoneNorm,
          body,
          ticket_id: ticketId ?? null,
        }),
      });
      const raw = await res.text();
      let data: { error?: string; detail?: string; message_id?: string; conversation_id?: string } = {};
      try {
        if (raw) data = JSON.parse(raw);
      } catch {
        if (!res.ok) data = { error: raw || `HTTP ${res.status}` };
      }
      if (!res.ok) {
        const msg = (data.detail ?? data.error ?? raw) || `Chyba ${res.status}`;
        throw new Error(msg);
      }
      const errMsg = data.error;
      if (errMsg) throw new Error(data.detail ? `${errMsg}: ${data.detail}` : errMsg);

      const messageId = data.message_id;
      const newConvId = data.conversation_id;
      if (newConvId && !conversationId) setConversationId(newConvId);

      setMessages((prev) =>
        prev.map((m) =>
          m.id === tempId && m.pending ? { ...m, id: messageId ?? tempId, pending: false } : m
        )
      );
    } catch (e) {
      setMessages((prev) => prev.filter((m) => m.id !== tempId));
      setInput(body);
      const msg = e instanceof Error ? e.message : "Zpráva se neodeslala";
      showToast(msg, "error");
      console.error("[SmsChat] send error", e);
    } finally {
      setSending(false);
    }
  }, [active, conversationId, input, phoneNorm, sending, serviceId, ticketId ?? null, scrollToBottom]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        sendMessage();
      }
    },
    [sendMessage]
  );

  if (!customerPhone || !customerPhone.trim()) {
    return (
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: 48, color: "var(--muted)", textAlign: "center" }}>
        <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" style={{ marginBottom: 12, opacity: 0.6 }} />
        <p style={{ fontSize: 13 }}>Zákazník nemá uložené telefonní číslo.</p>
      </div>
    );
  }

  if (loading) {
    return (
      <div style={{ padding: 24, textAlign: "center", color: "var(--muted)" }}>Načítám…</div>
    );
  }

  if (!active) {
    return (
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: 48, color: "var(--muted)", textAlign: "center" }}>
        <p style={{ fontSize: 13, marginBottom: 12 }}>SMS pro tento servis nejsou aktivované.</p>
        <a href="#/settings" style={{ fontSize: 13, color: "var(--accent)", textDecoration: "underline" }}>Aktivovat SMS v nastavení</a>
      </div>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", minHeight: 280 }}>
      <div
        ref={scrollContainerRef}
        style={{
          flex: 1,
          overflowY: "auto",
          padding: "12px 12px 8px",
          display: "flex",
          flexDirection: "column",
          gap: 4,
        }}
      >
        {messages.map((msg, idx) => {
          const prev = messages[idx - 1];
          const sameSender = prev && prev.direction === msg.direction;
          const showTime = !sameSender || (prev && formatMessageTime(prev.sent_at) !== formatMessageTime(msg.sent_at));
          const isOut = msg.direction === "outbound";
          return (
            <div key={msg.id} style={{ display: "flex", flexDirection: "column", alignItems: isOut ? "flex-end" : "flex-start", marginTop: sameSender ? 4 : 12 }}>
              <div
                style={{
                  maxWidth: "75%",
                  padding: "10px 14px",
                  borderRadius: 18,
                  borderBottomRightRadius: isOut ? 4 : 18,
                  borderBottomLeftRadius: isOut ? 18 : 4,
                  background: isOut ? "var(--accent)" : "var(--panel-2)",
                  color: isOut ? "var(--accent-fg)" : "var(--text)",
                  fontSize: 14,
                  opacity: msg.pending ? 0.85 : 1,
                }}
              >
                {msg.body}
              </div>
              {showTime && (
                <span style={{ fontSize: 10, color: "var(--muted)", marginTop: 2, marginLeft: 2 }}>
                  {formatMessageTime(msg.sent_at)}
                </span>
              )}
            </div>
          );
        })}
        <div ref={messagesEndRef} />
      </div>

      <div style={{ padding: "8px 12px 12px", borderTop: "1px solid var(--border)", background: "var(--panel)" }}>
        <div style={{ display: "flex", alignItems: "flex-end", gap: 8 }}>
          <textarea
            ref={textareaRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Napište zprávu…"
            rows={1}
            style={{
              flex: 1,
              minHeight: 40,
              maxHeight: 120,
              padding: "10px 14px",
              borderRadius: 20,
              border: "1px solid var(--border)",
              background: "var(--panel-2)",
              color: "var(--text)",
              fontSize: 14,
              resize: "none",
              outline: "none",
            }}
          />
          <button
            type="button"
            disabled={!input.trim() || sending}
            onClick={sendMessage}
            style={{
              width: 40,
              height: 40,
              borderRadius: "50%",
              border: "none",
              background: input.trim() && !sending ? "var(--accent)" : "var(--panel-2)",
              color: input.trim() && !sending ? "var(--accent-fg)" : "var(--muted)",
              cursor: input.trim() && !sending ? "pointer" : "not-allowed",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
            aria-label="Odeslat"
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
              <path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z" />
            </svg>
          </button>
        </div>
      </div>
    </div>
  );
}
