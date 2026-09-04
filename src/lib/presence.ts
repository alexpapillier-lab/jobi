/**
 * Kdo je z týmu servisu právě online a kdo má otevřenou kterou zakázku –
 * přes Supabase Realtime Presence (nic se neukládá do DB, sdílí se to jen
 * mezi otevřenými klienty).
 *
 * Jeden kanál na servis, spuštěný z App hned po přihlášení. Dřív měl každý
 * hook vlastní kanál: tečka „online“ v Nastavení → Tým se tak rozsvítila
 * jen kolegům, kteří měli otevřenou tutéž stránku Nastavení, protože jen
 * ti se na kanál servisu přihlásili. A `supabase.channel(topic)` vrací pro
 * stejný topic existující kanál, takže dvě místa v appce sdílející topic
 * by si ho navzájem odhlašovala.
 *
 * Teď: App volá `startServicePresence`, zakázky hlásí `setPresenceTicket`,
 * a hooky níž jen čtou společný stav.
 */
import { useEffect, useMemo, useState } from "react";
import type { RealtimeChannel } from "@supabase/supabase-js";
import { supabase } from "./supabaseClient";

export type TicketViewer = { userId: string; nickname: string; avatarUrl: string | null };

type PresenceMeta = {
  nickname: string;
  avatarUrl: string | null;
  /** Zakázka, kterou má tenhle klient právě otevřenou v detailu. */
  ticketId: string | null;
  online_at: string;
};

type PresenceState = Record<string, PresenceMeta[]>;

type Store = {
  serviceId: string;
  userId: string;
  channel: RealtimeChannel;
  meta: Omit<PresenceMeta, "online_at">;
  subscribed: boolean;
  state: PresenceState;
};

let store: Store | null = null;
const listeners = new Set<() => void>();

function emit() {
  listeners.forEach((fn) => fn());
}

function track(s: Store) {
  if (!s.subscribed) return;
  void s.channel.track({ ...s.meta, online_at: new Date().toISOString() });
}

/**
 * Spustí sledování přítomnosti pro servis. Volá se jednou z App; vrací
 * funkci pro ukončení (změna servisu, odhlášení).
 */
export function startServicePresence(
  serviceId: string,
  userId: string,
  meta: { nickname: string; avatarUrl: string | null }
): () => void {
  if (!supabase) return () => {};

  // Stejný servis a uživatel – jen doplň jméno/avatar (např. dorazil profil).
  if (store && store.serviceId === serviceId && store.userId === userId) {
    store.meta = { ...store.meta, nickname: meta.nickname, avatarUrl: meta.avatarUrl };
    track(store);
    return () => stopServicePresence(serviceId, userId);
  }

  if (store) stopServicePresence(store.serviceId, store.userId);

  const channel = supabase.channel(`presence:service:${serviceId}`, {
    config: { presence: { key: userId } },
  });
  const s: Store = {
    serviceId,
    userId,
    channel,
    meta: { nickname: meta.nickname, avatarUrl: meta.avatarUrl, ticketId: null },
    subscribed: false,
    state: {},
  };
  store = s;

  channel.on("presence", { event: "sync" }, () => {
    if (store !== s) return;
    s.state = channel.presenceState<PresenceMeta>() as PresenceState;
    emit();
  });

  channel.subscribe((status) => {
    if (store !== s) return;
    if (status === "SUBSCRIBED") {
      s.subscribed = true;
      track(s);
    } else if (status === "CLOSED" || status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
      s.subscribed = false;
    }
  });

  return () => stopServicePresence(serviceId, userId);
}

function stopServicePresence(serviceId: string, userId: string) {
  if (!store || store.serviceId !== serviceId || store.userId !== userId) return;
  const s = store;
  store = null;
  void supabase?.removeChannel(s.channel);
  emit();
}

/** Zakázky hlásí, kterou zakázku má tenhle klient otevřenou (null = žádnou). */
export function setPresenceTicket(ticketId: string | null) {
  if (!store) return;
  if (store.meta.ticketId === ticketId) return;
  store.meta = { ...store.meta, ticketId };
  track(store);
}

function useServicePresenceState(serviceId: string | null): PresenceState {
  const [, bump] = useState(0);
  useEffect(() => {
    const fn = () => bump((n) => n + 1);
    listeners.add(fn);
    return () => {
      listeners.delete(fn);
    };
  }, []);
  if (!store || !serviceId || store.serviceId !== serviceId) return EMPTY_STATE;
  return store.state;
}

const EMPTY_STATE: PresenceState = {};
const EMPTY_VIEWERS: TicketViewer[] = [];

/** Uživatelé servisu, kteří mají appku otevřenou (včetně mě). */
export function useServiceOnlinePresence(serviceId: string | null, _userId: string | null): Set<string> {
  const state = useServicePresenceState(serviceId);
  return useMemo(() => new Set(Object.keys(state)), [state]);
}

function viewersFromState(state: PresenceState, selfUserId: string | null): Record<string, TicketViewer[]> {
  const byTicket: Record<string, TicketViewer[]> = {};
  for (const [userId, entries] of Object.entries(state)) {
    if (userId === selfUserId) continue;
    const seen = new Set<string>();
    for (const e of entries) {
      if (!e.ticketId || seen.has(e.ticketId)) continue;
      seen.add(e.ticketId);
      (byTicket[e.ticketId] ??= []).push({
        userId,
        nickname: e.nickname || "Kolega",
        avatarUrl: e.avatarUrl ?? null,
      });
    }
  }
  return byTicket;
}

/** Kdo jiný má právě otevřenou kterou zakázku – pro bubliny v seznamu. */
export function useTicketViewersMap(serviceId: string | null, selfUserId: string | null): Record<string, TicketViewer[]> {
  const state = useServicePresenceState(serviceId);
  return useMemo(() => viewersFromState(state, selfUserId), [state, selfUserId]);
}

/**
 * Kdo jiný má teď otevřenou tuhle konkrétní zakázku. Ukazuje se dřív, než
 * dojde ke konfliktu verzí při ukládání – jako předchozí varování.
 */
export function useTicketViewers(serviceId: string | null, ticketId: string | null, selfUserId: string | null): TicketViewer[] {
  const map = useTicketViewersMap(serviceId, selfUserId);
  return (ticketId && map[ticketId]) || EMPTY_VIEWERS;
}
