import { supabase } from "./supabaseClient";

/**
 * Čas na opravě – stopky technika na zakázce (tabulka ticket_work_sessions).
 * Volitelná funkce servisu; každý zapisuje jen své úseky, vidí je všichni.
 */
export type UsekPrace = {
  id: string;
  ticket_id: string;
  user_id: string;
  started_at: string;
  ended_at: string | null;
  note: string | null;
};

export async function nactiUseky(ticketId: string): Promise<UsekPrace[]> {
  if (!supabase) return [];
  const { data, error } = await (supabase.from("ticket_work_sessions") as any)
    .select("id, ticket_id, user_id, started_at, ended_at, note")
    .eq("ticket_id", ticketId)
    .order("started_at", { ascending: false });
  if (error) throw error;
  return (data ?? []) as UsekPrace[];
}

/** Spustí práci na zakázce; běžící úsek téhož člověka (kdekoli) nejdřív ukončí. */
export async function spustPraci(serviceId: string, ticketId: string, userId: string): Promise<UsekPrace> {
  if (!supabase) throw new Error("Bez připojení");
  const ted = new Date().toISOString();
  await (supabase.from("ticket_work_sessions") as any).update({ ended_at: ted }).eq("user_id", userId).is("ended_at", null);
  const { data, error } = await (supabase.from("ticket_work_sessions") as any)
    .insert({ service_id: serviceId, ticket_id: ticketId, user_id: userId, started_at: ted })
    .select("id, ticket_id, user_id, started_at, ended_at, note")
    .single();
  if (error) throw error;
  return data as UsekPrace;
}

export async function zastavPraci(usekId: string): Promise<void> {
  if (!supabase) return;
  const { error } = await (supabase.from("ticket_work_sessions") as any).update({ ended_at: new Date().toISOString() }).eq("id", usekId);
  if (error) throw error;
}

export async function smazUsek(usekId: string): Promise<void> {
  if (!supabase) return;
  const { error } = await (supabase.from("ticket_work_sessions") as any).delete().eq("id", usekId);
  if (error) throw error;
}

export function sledujUseky(ticketId: string, onZmena: () => void): () => void {
  if (!supabase) return () => {};
  const channel = supabase
    .channel(`work:${ticketId}`)
    .on("postgres_changes", { event: "*", schema: "public", table: "ticket_work_sessions", filter: `ticket_id=eq.${ticketId}` }, () => onZmena())
    .subscribe();
  return () => {
    void supabase?.removeChannel(channel);
  };
}

/** Délka úseku v sekundách; běžící se počítá do teď. */
export function delkaSekund(u: Pick<UsekPrace, "started_at" | "ended_at">, ted = Date.now()): number {
  const od = new Date(u.started_at).getTime();
  const do_ = u.ended_at ? new Date(u.ended_at).getTime() : ted;
  return Math.max(0, Math.round((do_ - od) / 1000));
}

/** „1 h 05 min“, „12 min“, „0 min“. */
export function formatDelka(sekund: number): string {
  const min = Math.round(sekund / 60);
  const h = Math.floor(min / 60);
  const m = min % 60;
  if (h === 0) return `${m} min`;
  return `${h} h ${String(m).padStart(2, "0")} min`;
}
