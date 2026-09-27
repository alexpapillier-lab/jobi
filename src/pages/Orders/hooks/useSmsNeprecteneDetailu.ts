/**
 * Počet nepřečtených příchozích SMS k otevřené zakázce: konverzace podle
 * ticket_id nebo stejného telefonu zákazníka (sdílené vlákno).
 * Vyneseno z Orders.tsx beze změny obsahu.
 */
import { useEffect, useState } from "react";
import { getTypedSupabaseClient } from "../../../lib/typedSupabase";
import { normalizePhone } from "../../../lib/phone";

export function useSmsNeprecteneDetailu(detailId: string | null, activeServiceId: string | null) {
  const [smsUnreadCount, setSmsUnreadCount] = useState(0);
  // SMS unread on detail header: conv linked by ticket_id OR same customer phone (shared thread)
  useEffect(() => {
    const client = getTypedSupabaseClient();
    if (!detailId || !activeServiceId || !client) {
      setSmsUnreadCount(0);
      return;
    }
    let cancelled = false;
    (async () => {
      const convIdSet = new Set<string>();
      const { data: convsTicket } = await client.from("sms_conversations").select("id").eq("ticket_id", detailId);
      convsTicket?.forEach((c) => convIdSet.add(c.id));
      const { data: tick } = await client
        .from("tickets")
        .select("customer_phone")
        .eq("id", detailId)
        .eq("service_id", activeServiceId)
        .maybeSingle();
      const phoneNorm = tick?.customer_phone ? normalizePhone(String(tick.customer_phone)) : null;
      if (phoneNorm) {
        const { data: convPhone } = await client
          .from("sms_conversations")
          .select("id")
          .eq("service_id", activeServiceId)
          .eq("customer_phone", phoneNorm)
          .maybeSingle();
        if (convPhone?.id) convIdSet.add(convPhone.id);
      }
      if (convIdSet.size === 0) {
        if (!cancelled) setSmsUnreadCount(0);
        return;
      }
      const { count, error } = await client
        .from("sms_messages")
        .select("id", { count: "exact", head: true })
        .in("conversation_id", [...convIdSet])
        .eq("direction", "inbound")
        .is("read_at", null);
      if (cancelled) return;
      setSmsUnreadCount(error ? 0 : count ?? 0);
    })();
    return () => { cancelled = true; };
  }, [detailId, activeServiceId]);

  return [smsUnreadCount, setSmsUnreadCount] as const;
}
