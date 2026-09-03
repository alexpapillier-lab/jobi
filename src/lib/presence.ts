/**
 * Kdo je z týmu servisu právě online (appka otevřená) – přes Supabase
 * Realtime Presence, ne postgres_changes jako zbytek appky (nic se tu
 * neukládá do DB, jen se sdílí mezi otevřenými klienty přes kanál).
 */
import { useEffect, useState } from "react";
import { supabase } from "./supabaseClient";

export type TicketViewer = { userId: string; nickname: string };

/**
 * Kdo jiný má teď otevřenou tuhle konkrétní zakázku k editaci. Ukazuje se
 * dřív, než dojde ke konfliktu verzí při ukládání (viz saveTicketChanges
 * v useOrderActions.ts) – ne místo něj, jen jako předchozí varování.
 */
export function useTicketViewers(ticketId: string | null, userId: string | null, nickname: string): TicketViewer[] {
  const [viewers, setViewers] = useState<TicketViewer[]>([]);

  useEffect(() => {
    setViewers([]);
    if (!ticketId || !userId || !supabase) return;

    const channel = supabase.channel(`presence:ticket:${ticketId}`, {
      config: { presence: { key: userId } },
    });

    channel.on("presence", { event: "sync" }, () => {
      const state = channel.presenceState<{ nickname: string }>();
      setViewers(
        Object.entries(state)
          .filter(([key]) => key !== userId)
          .map(([key, entries]) => ({ userId: key, nickname: entries[0]?.nickname || "Kolega" }))
      );
    });

    channel.subscribe((status) => {
      if (status === "SUBSCRIBED") void channel.track({ nickname });
    });

    return () => {
      void supabase!.removeChannel(channel);
    };
  }, [ticketId, userId, nickname]);

  return viewers;
}

export function useServiceOnlinePresence(serviceId: string | null, userId: string | null): Set<string> {
  const [online, setOnline] = useState<Set<string>>(new Set());

  useEffect(() => {
    setOnline(new Set());
    if (!serviceId || !userId || !supabase) return;

    const channel = supabase.channel(`presence:service:${serviceId}`, {
      config: { presence: { key: userId } },
    });

    channel.on("presence", { event: "sync" }, () => {
      setOnline(new Set(Object.keys(channel.presenceState())));
    });

    channel.subscribe((status) => {
      if (status === "SUBSCRIBED") void channel.track({ online_at: new Date().toISOString() });
    });

    return () => {
      void supabase!.removeChannel(channel);
    };
  }, [serviceId, userId]);

  return online;
}
