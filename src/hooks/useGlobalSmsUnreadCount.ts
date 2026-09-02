import { useEffect, useRef, useState } from "react";
import { showIncomingSmsToast } from "../components/Toast";
import { getTypedSupabaseClient } from "../lib/typedSupabase";
import { normalizePhone } from "../lib/phone";
import { smsDoNotNotifyRef } from "./useSmsNotifications";

export type InboundSmsNavigatePayload = {
  phone: string;
  displayName?: string;
  conversationId: string;
};

function formatPhoneShort(phone: string): string {
  const digits = phone.replace(/\D/g, "");
  if (digits.length >= 9) return digits.slice(-9).replace(/(\d{3})(\d{3})(\d{3})/, "$1 $2 $3");
  return phone;
}

/**
 * Returns total count of unread inbound SMS for the current service.
 * Subscribes to Realtime INSERT/UPDATE on sms_messages.
 * Toast u příchozí SMS je ve stejném kanálu (stejná událost jako refresh badge).
 */
export function useGlobalSmsUnreadCount(
  activeServiceId: string | null,
  options?: { onInboundSmsNavigate?: (p: InboundSmsNavigatePayload) => void }
): number {
  const [count, setCount] = useState(0);
  const navigateRef = useRef(options?.onInboundSmsNavigate);
  const serviceRef = useRef(activeServiceId);

  // Refy se aktualizují v efektu, ne během renderu – realtime handler níž pak
  // vždy sáhne na aktuální hodnotu, aniž by se odběr musel znovu vytvářet.
  useEffect(() => {
    navigateRef.current = options?.onInboundSmsNavigate;
    serviceRef.current = activeServiceId;
  });

  useEffect(() => {
    const client = getTypedSupabaseClient();
    if (!activeServiceId || !client) {
      setCount(0);
      return;
    }
    let cancelled = false;

    const load = async () => {
      const { data: convs } = await client
        .from("sms_conversations")
        .select("id")
        .eq("service_id", activeServiceId);
      if (cancelled || !convs?.length) {
        if (!cancelled) setCount(0);
        return;
      }
      const convIds = convs.map((c) => c.id);
      const { count: n, error } = await client
        .from("sms_messages")
        .select("id", { count: "exact", head: true })
        .in("conversation_id", convIds)
        .eq("direction", "inbound")
        .is("read_at", null);
      if (!cancelled) setCount(error ? 0 : n ?? 0);
    };

    load();

    const onInsert = async (payload: { new?: Record<string, unknown> }) => {
      void load();
      const nav = navigateRef.current;
      if (!nav) return;
      try {
        const row = (payload.new ?? {}) as {
          direction?: string;
          conversation_id?: string;
          body?: string | null;
        };
        if (row.direction !== "inbound") return;
        const convId = row.conversation_id;
        if (!convId) return;
        if (smsDoNotNotifyRef.conversationId === convId) return;

        const { data: conv, error: convErr } = await client
          .from("sms_conversations")
          .select("service_id, customer_phone, customer_name")
          .eq("id", convId)
          .maybeSingle();
        if (convErr || !conv || conv.service_id !== serviceRef.current) return;

        const phoneNorm = normalizePhone(conv.customer_phone);
        if (
          smsDoNotNotifyRef.panelCustomerPhoneNorm &&
          phoneNorm &&
          phoneNorm === smsDoNotNotifyRef.panelCustomerPhoneNorm
        ) {
          return;
        }

        let preview = String(row.body ?? "").trim().replace(/\s+/g, " ");
        if (preview.length > 120) preview = preview.slice(0, 117) + "…";
        if (!preview) preview = "(prázdná zpráva)";

        const name = conv.customer_name?.trim();
        const title = name
          ? `Nová SMS · ${name}`
          : `Nová SMS · ${formatPhoneShort(conv.customer_phone)}`;

        showIncomingSmsToast(title, preview, () => {
          navigateRef.current?.({
            phone: conv.customer_phone,
            displayName: name || undefined,
            conversationId: convId,
          });
        });
      } catch (e) {
        console.warn("[sms toast]", e);
      }
    };

    const topic = `sms_global_unread:${activeServiceId}`;
    const channel = client
      .channel(topic)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "sms_messages" },
        (payload) => {
          void onInsert(payload);
        }
      )
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "sms_messages" },
        () => {
          void load();
        }
      )
      .subscribe();

    return () => {
      cancelled = true;
      void client.removeChannel(channel);
    };
  }, [activeServiceId]);

  return count;
}
