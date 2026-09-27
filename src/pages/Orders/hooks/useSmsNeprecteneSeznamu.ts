/**
 * Odznaky nepřečtených SMS u řádků seznamu: realtime po příchozí SMS,
 * dotazy po dávkách a přepočet podle zakázky nebo telefonu.
 * Vyneseno z Orders.tsx beze změny obsahu (včetně klíče z obsahu pole).
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { getTypedSupabaseClient } from "../../../lib/typedSupabase";
import { normalizePhone } from "../../../lib/phone";
import type { TicketEx } from "../typy";

type Vstup = {
  smsAvailable: boolean;
  activeServiceId: string | null;
  /** Zakázky, u kterých má smysl načíst SMS badge (shodné s tím, co je ve výpisu). */
  ticketsForSmsUnread: TicketEx[];
};

export function useSmsNeprecteneSeznamu({ smsAvailable, activeServiceId, ticketsForSmsUnread }: Vstup) {
  const [smsUnreadByTicketId, setSmsUnreadByTicketId] = useState<Record<string, number>>({});
  const [smsUnreadListBump, setSmsUnreadListBump] = useState(0);
  // Realtime: po příchozí SMS nebo označení přečteného přepočíst badge u řádků
  useEffect(() => {
    const client = getTypedSupabaseClient();
    if (!smsAvailable || !activeServiceId || !client) return;
    const topic = `orders_sms_unread_rt:${activeServiceId}`;
    const channel = client
      .channel(topic)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "sms_messages" },
        (payload) => {
          if ((payload.new as { direction?: string })?.direction === "inbound") {
            setSmsUnreadListBump((n) => n + 1);
          }
        }
      )
      .subscribe();
    return () => {
      client.removeChannel(channel);
    };
  }, [smsAvailable, activeServiceId]);

  /**
   * Klíč z obsahu, ne z identity pole.
   *
   * ticketsForSmsUnread je nové pole při každém renderu, takže efekt níž se
   * spouštěl při každém úhozu ve vyhledávání – naměřeno 6 úhozů = 15 dotazů
   * do Supabase, i když se seznam zakázek vůbec nezměnil.
   */
  const smsUnreadKey = useMemo(
    () => ticketsForSmsUnread.map((t) => `${t.id}|${normalizePhone(t.customerPhone) ?? ""}`).join(","),
    [ticketsForSmsUnread]
  );
  const ticketsForSmsUnreadRef = useRef(ticketsForSmsUnread);
  // Zápis do ref při vykreslení je záměr (stejně jako dřív v Orders.tsx): efekt níž čte aktuální pole, ale závisí jen na klíči z obsahu.
  // eslint-disable-next-line react-hooks/refs
  ticketsForSmsUnreadRef.current = ticketsForSmsUnread;

  // SMS unread per řádek: konverzace podle ticket_id nebo stejného telefonu jako u detailu
  useEffect(() => {
    const client = getTypedSupabaseClient();
    const ticketRowsAll = ticketsForSmsUnreadRef.current;
    if (!smsAvailable || !activeServiceId || !client || ticketRowsAll.length === 0) {
      // Nový prázdný objekt by byl pokaždé jiná reference a vynutil další render.
      setSmsUnreadByTicketId((prev) => (Object.keys(prev).length === 0 ? prev : {}));
      return;
    }
    const ticketRows = ticketRowsAll;
    const ticketIds = ticketRows.map((t) => t.id);
    const idSet = new Set(ticketIds);
    const chunk = 180;
    let cancelled = false;
    // Rychlé psaní jinak spustí dotaz na každý mezistav.
    const timer = setTimeout(() => {
    (async () => {
      const convsByTicket: { id: string; ticket_id: string | null; customer_phone: string }[] = [];
      for (let i = 0; i < ticketIds.length; i += chunk) {
        const { data } = await client
          .from("sms_conversations")
          .select("id, ticket_id, customer_phone")
          .eq("service_id", activeServiceId)
          .in("ticket_id", ticketIds.slice(i, i + chunk));
        convsByTicket.push(...((data ?? []) as typeof convsByTicket));
      }
      const phones = [
        ...new Set(ticketRows.map((t) => normalizePhone(t.customerPhone)).filter((p): p is string => !!p)),
      ];
      const convsByPhone: { id: string; ticket_id: string | null; customer_phone: string }[] = [];
      for (let i = 0; i < phones.length; i += chunk) {
        const { data } = await client
          .from("sms_conversations")
          .select("id, ticket_id, customer_phone")
          .eq("service_id", activeServiceId)
          .in("customer_phone", phones.slice(i, i + chunk));
        for (const row of data ?? []) {
          convsByPhone.push(row as (typeof convsByPhone)[number]);
        }
      }
      const convMap = new Map<string, { id: string; ticket_id: string | null; customer_phone: string }>();
      for (const c of [...convsByTicket, ...convsByPhone]) {
        convMap.set(c.id, c);
      }
      const convIds = [...convMap.keys()];
      if (convIds.length === 0) {
        if (!cancelled) setSmsUnreadByTicketId((prev) => (Object.keys(prev).length === 0 ? prev : {}));
        return;
      }
      const countByConv: Record<string, number> = {};
      for (let i = 0; i < convIds.length; i += chunk) {
        const slice = convIds.slice(i, i + chunk);
        const { data: messages } = await client
          .from("sms_messages")
          .select("conversation_id")
          .in("conversation_id", slice)
          .eq("direction", "inbound")
          .is("read_at", null);
        if (cancelled) return;
        (messages ?? []).forEach((m) => {
          countByConv[m.conversation_id] = (countByConv[m.conversation_id] ?? 0) + 1;
        });
      }
      const phonesMatch = (a: string | null | undefined, b: string | null | undefined) => {
        const na = normalizePhone(a);
        const nb = normalizePhone(b);
        if (na && nb && na === nb) return true;
        const da = String(a ?? "").replace(/\D/g, "");
        const db = String(b ?? "").replace(/\D/g, "");
        return da.length >= 9 && db.length >= 9 && da.slice(-9) === db.slice(-9);
      };
      const byTicket: Record<string, number> = {};
      for (const [cid, n] of Object.entries(countByConv)) {
        const conv = convMap.get(cid);
        if (!conv) continue;
        if (conv.ticket_id && idSet.has(conv.ticket_id)) {
          byTicket[conv.ticket_id] = (byTicket[conv.ticket_id] ?? 0) + n;
        } else {
          for (const t of ticketRows) {
            if (phonesMatch(t.customerPhone, conv.customer_phone)) {
              byTicket[t.id] = (byTicket[t.id] ?? 0) + n;
            }
          }
        }
      }
      if (!cancelled) setSmsUnreadByTicketId(byTicket);
    })();
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [smsAvailable, activeServiceId, smsUnreadKey, smsUnreadListBump]);

  return { smsUnreadByTicketId, setSmsUnreadListBump };
}
