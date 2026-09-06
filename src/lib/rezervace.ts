import { supabase } from "./supabaseClient";

/**
 * Rezervace z webu servisu (tabulka bookings). Zvenku je zakládá edge funkce
 * public-booking; servis je tady čte, potvrzuje, převádí na zakázku a ruší.
 */
export type StavRezervace = "new" | "confirmed" | "converted" | "cancelled";

export type Rezervace = {
  id: string;
  service_id: string;
  status: StavRezervace;
  customer_name: string;
  customer_phone: string;
  customer_email: string | null;
  device_label: string;
  repair_name: string | null;
  note: string | null;
  preferred_at: string | null;
  ticket_id: string | null;
  created_at: string;
};

/** Nastavení online rezervací v service_settings.config.rezervace. */
export type NastaveniRezervaci = {
  zapnuto: boolean;
  /** 1 = pondělí … 7 = neděle. */
  dny: number[];
  od: string;
  do: string;
  krokMin: number;
  uvod: string;
};

export const VYCHOZI_NASTAVENI_REZERVACI: NastaveniRezervaci = { zapnuto: false, dny: [1, 2, 3, 4, 5], od: "09:00", do: "17:00", krokMin: 30, uvod: "" };

export function nastaveniRezervaciZConfigu(raw: unknown): NastaveniRezervaci {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const cas = (v: unknown, def: string) => (typeof v === "string" && /^\d{1,2}:\d{2}$/.test(v) ? v.padStart(5, "0") : def);
  const d = VYCHOZI_NASTAVENI_REZERVACI;
  return {
    zapnuto: r.zapnuto === true,
    dny: Array.isArray(r.dny) ? r.dny.filter((x): x is number => typeof x === "number" && x >= 1 && x <= 7) : d.dny,
    od: cas(r.od, d.od),
    do: cas(r.do, d.do),
    krokMin: typeof r.krokMin === "number" && r.krokMin >= 10 && r.krokMin <= 120 ? r.krokMin : d.krokMin,
    uvod: typeof r.uvod === "string" ? r.uvod : "",
  };
}

/** Nevyřízené rezervace (nové a potvrzené) plus posledních pár uzavřených, nejnovější první. */
export async function nactiRezervace(serviceId: string): Promise<Rezervace[]> {
  if (!supabase) return [];
  const { data, error } = await (supabase.from("bookings") as any)
    .select("id, service_id, status, customer_name, customer_phone, customer_email, device_label, repair_name, note, preferred_at, ticket_id, created_at")
    .eq("service_id", serviceId)
    .order("created_at", { ascending: false })
    .limit(200);
  if (error) throw error;
  return (data ?? []) as Rezervace[];
}

export async function nastavStavRezervace(id: string, status: StavRezervace, ticketId?: string | null): Promise<void> {
  if (!supabase) return;
  const patch: Record<string, unknown> = { status };
  if (ticketId !== undefined) patch.ticket_id = ticketId;
  const { error } = await (supabase.from("bookings") as any).update(patch).eq("id", id);
  if (error) throw error;
}

/** Realtime: každá změna v rezervacích servisu zavolá callback (stačí znovu načíst). */
export function sledujRezervace(serviceId: string, onZmena: (typ: "INSERT" | "UPDATE" | "DELETE") => void): () => void {
  if (!supabase) return () => {};
  const channel = supabase
    .channel(`bookings:${serviceId}`)
    .on("postgres_changes", { event: "*", schema: "public", table: "bookings", filter: `service_id=eq.${serviceId}` }, (payload) => {
      onZmena(payload.eventType as "INSERT" | "UPDATE" | "DELETE");
    })
    .subscribe();
  return () => {
    void supabase?.removeChannel(channel);
  };
}

export function popisTerminu(r: Pick<Rezervace, "preferred_at">): string {
  if (!r.preferred_at) return "kdykoliv";
  return new Date(r.preferred_at).toLocaleString("cs-CZ", { weekday: "short", day: "numeric", month: "numeric", hour: "2-digit", minute: "2-digit" });
}
