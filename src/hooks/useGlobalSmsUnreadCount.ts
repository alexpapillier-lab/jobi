import { useEffect, useState } from "react";
import { getTypedSupabaseClient } from "../lib/typedSupabase";

/**
 * Returns total count of unread inbound SMS for the current service.
 * Subscribes to Realtime INSERT on sms_messages to update the count.
 */
export function useGlobalSmsUnreadCount(activeServiceId: string | null): number {
  const [count, setCount] = useState(0);

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

    const topic = `sms_global_unread:${activeServiceId}`;
    const channel = client
      .channel(topic)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "sms_messages" },
        () => { load(); }
      )
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "sms_messages" },
        () => { load(); }
      )
      .subscribe();

    return () => {
      cancelled = true;
      client.removeChannel(channel);
    };
  }, [activeServiceId]);

  return count;
}
