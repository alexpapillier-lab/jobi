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

/**
 * Spustí práci na zakázce. Běžící úsek téhož člověka (kdekoli) ukončí
 * databáze ve stejné transakci (RPC spust_praci), takže nikdy nevzniknou
 * dva běžící úseky ani při dvou otevřených oknech.
 */
export async function spustPraci(serviceId: string, ticketId: string): Promise<UsekPrace> {
  if (!supabase) throw new Error("Bez připojení");
  const { data, error } = await (supabase as any).rpc("spust_praci", { p_service_id: serviceId, p_ticket_id: ticketId });
  if (error) throw error;
  return data as UsekPrace;
}

/** Zastaví všechny běžící úseky přihlášeného (server má vždy nejvýš jeden). */
export async function zastavPraci(): Promise<void> {
  if (!supabase) return;
  const { error } = await (supabase as any).rpc("zastav_praci");
  if (error) throw error;
}

/** Přezdívky lidí z úseků – ať karta říká, kdo pracuje, ne jen „Kolega“. */
export async function nactiPrezdivky(userIds: string[]): Promise<Record<string, string>> {
  if (!supabase || userIds.length === 0) return {};
  const { data } = await (supabase.from("profiles") as any).select("id, nickname").in("id", userIds);
  const out: Record<string, string> = {};
  for (const p of (data ?? []) as Array<{ id: string; nickname: string | null }>) {
    if (p.nickname) out[p.id] = p.nickname;
  }
  return out;
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
