/**
 * Přeprava DPD ze Zásilek – klientská část.
 *
 * Volání DPD dělá edge funkce zasilka-dpd (klíč servisu je ve Vaultu, klient
 * ho nevidí). Tady je načtení nastavení a objednávek, volání funkce a texty
 * pro UI. Viz supabase/migrations/20261023150000_zasilky_dpd.sql.
 */
import { supabase, supabaseUrl, supabaseAnonKey, supabaseFetch } from "./supabaseClient";
import { stahnoutSoubor } from "./stahnoutSoubor";

export type StavDpd = "created" | "pickup_ordered" | "in_transit" | "delivered" | "cancelled";
export type RezimDpd = "label" | "courier";

export type ObjednavkaDpd = {
  id: string;
  shipmentId: string;
  mode: RezimDpd;
  /** standard_shop / standard / return / collection; starší objednávky null. */
  varianta: string | null;
  parcels: number;
  testovaci: boolean;
  parcelNumbers: string[];
  pickupOrderId: string | null;
  pickupDate: string | null;
  status: StavDpd;
  statusText: string | null;
  deliveredAt: string | null;
  trackingAt: string | null;
  createdAt: string;
  cancelledAt: string | null;
};

export type NastaveniDpd = { serviceId: string; zapnuto: boolean; dsw: string | null; testovaci: boolean; maKlic: boolean; updatedAt: string | null };

const SLOUPCE = "id, shipment_id, mode, varianta, parcels, testovaci, parcel_numbers, pickup_order_id, pickup_date, status, status_text, delivered_at, tracking_at, created_at, cancelled_at";

function mapObjednavka(r: Record<string, any>): ObjednavkaDpd {
  return {
    id: String(r.id),
    shipmentId: String(r.shipment_id),
    mode: r.mode === "courier" ? "courier" : "label",
    varianta: r.varianta ?? null,
    parcels: Number(r.parcels) || 1,
    testovaci: !!r.testovaci,
    parcelNumbers: Array.isArray(r.parcel_numbers) ? r.parcel_numbers.map(String) : [],
    pickupOrderId: r.pickup_order_id ?? null,
    pickupDate: r.pickup_date ?? null,
    status: r.status as StavDpd,
    statusText: r.status_text ?? null,
    deliveredAt: r.delivered_at ?? null,
    trackingAt: r.tracking_at ?? null,
    createdAt: String(r.created_at),
    cancelledAt: r.cancelled_at ?? null,
  };
}

function mapNastaveni(r: Record<string, any>): NastaveniDpd {
  return { serviceId: String(r.service_id), zapnuto: !!r.zapnuto, dsw: r.dsw ?? null, testovaci: !!r.testovaci, maKlic: !!r.ma_klic, updatedAt: r.updated_at ?? null };
}

/** Je přeprava pro servis zapnutá? Bez řádku (nebo bez přístupu) = ne. */
export async function nactiNastaveniDpd(serviceId: string): Promise<NastaveniDpd | null> {
  if (!supabase) return null;
  const { data, error } = await (supabase.from("preprava_dpd") as any).select("service_id, zapnuto, dsw, testovaci, ma_klic, updated_at").eq("service_id", serviceId).maybeSingle();
  if (error || !data) return null;
  return mapNastaveni(data);
}

/** Všechna nastavení (Owner – root owner vidí všechny servisy). */
export async function nactiVsechnaNastaveniDpd(): Promise<NastaveniDpd[]> {
  if (!supabase) return [];
  const { data, error } = await (supabase.from("preprava_dpd") as any).select("service_id, zapnuto, dsw, testovaci, ma_klic, updated_at");
  if (error) throw new Error(error.message);
  return ((data ?? []) as Record<string, any>[]).map(mapNastaveni);
}

/** Uloží nastavení servisu; klíč jen když je vyplněný (prázdný = nechat stávající). */
export async function ulozNastaveniDpd(v: { serviceId: string; zapnuto: boolean; dsw: string; testovaci: boolean; klic?: string }): Promise<void> {
  if (!supabase) throw new Error("Není připojení k databázi.");
  const { error } = await (supabase as any).rpc("preprava_dpd_nastav", {
    p_service_id: v.serviceId,
    p_zapnuto: v.zapnuto,
    p_dsw: v.dsw,
    p_testovaci: v.testovaci,
    p_klic: v.klic?.trim() || null,
  });
  if (error) throw new Error(error.message);
}

/** Objednávky DPD k zásilkám servisu: ke každé zásilce ta poslední (živá má přednost). */
export async function nactiObjednavkyDpd(serviceId: string): Promise<Map<string, ObjednavkaDpd>> {
  const out = new Map<string, ObjednavkaDpd>();
  if (!supabase) return out;
  const { data, error } = await (supabase.from("ticket_shipment_dpd") as any).select(SLOUPCE).eq("service_id", serviceId).order("created_at", { ascending: true }).limit(2000);
  if (error) throw new Error(error.message);
  for (const r of (data ?? []) as Record<string, any>[]) {
    const o = mapObjednavka(r);
    const dosavadni = out.get(o.shipmentId);
    if (!dosavadni || dosavadni.status === "cancelled" || o.status !== "cancelled") out.set(o.shipmentId, o);
  }
  return out;
}

async function token(): Promise<string> {
  if (!supabase) throw new Error("Není připojení k databázi.");
  const { data } = await supabase.auth.getSession();
  const s = data?.session;
  if (s?.access_token && (s.expires_at ?? 0) * 1000 > Date.now() + 60_000) return s.access_token;
  const { data: obnovena } = await supabase.auth.refreshSession();
  const t = obnovena?.session?.access_token ?? s?.access_token;
  if (!t) throw new Error("Nejste přihlášeni.");
  return t;
}

async function zavolej<T>(body: Record<string, unknown>): Promise<T> {
  const r = await supabaseFetch(`${supabaseUrl}/functions/v1/zasilka-dpd`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${await token()}`, apikey: supabaseAnonKey },
    body: JSON.stringify(body),
  });
  const d = (await r.json().catch(() => ({}))) as { error?: string } & T;
  if (!r.ok) throw new Error(d.error ?? `Server odpověděl ${r.status}.`);
  return d;
}

export async function objednatDpd(v: { shipmentId: string; mode: RezimDpd; parcels: number; pickupDate?: string; note?: string }): Promise<{ objednavka: ObjednavkaDpd; labelBase64: string | null; varovani: string | null }> {
  const d = await zavolej<{ objednavka: Record<string, any>; labelBase64: string | null; varovani: string | null }>({ action: "create", ...v });
  return { objednavka: mapObjednavka(d.objednavka), labelBase64: d.labelBase64, varovani: d.varovani };
}

export async function sledovatDpd(shipmentId: string): Promise<ObjednavkaDpd> {
  const d = await zavolej<{ objednavka: Record<string, any> }>({ action: "track", shipmentId });
  return mapObjednavka(d.objednavka);
}

export async function zrusitDpd(shipmentId: string): Promise<void> {
  await zavolej({ action: "cancel", shipmentId });
}

export async function stitekDpd(shipmentId: string): Promise<string> {
  const d = await zavolej<{ labelBase64: string }>({ action: "label", shipmentId });
  return d.labelBase64;
}

/** Otevře štítek (PDF) v novém okně k tisku; když prohlížeč okno zablokuje, stáhne ho. */
export function otevritStitek(base64: string, nazev: string): void {
  const bin = atob(base64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  const blob = new Blob([bytes], { type: "application/pdf" });
  const url = URL.createObjectURL(blob);
  const okno = window.open(url, "_blank");
  if (!okno) stahnoutSoubor(blob, nazev, "application/pdf");
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

export function stavDpdText(o: Pick<ObjednavkaDpd, "status" | "mode" | "pickupDate">): string {
  switch (o.status) {
    case "created": return o.mode === "label" ? "štítek připraven – podejte na výdejním místě DPD" : "zásilka založena, svoz neobjednán";
    case "pickup_ordered": return o.pickupDate ? `kurýr objednán na ${new Date(`${o.pickupDate}T12:00:00`).toLocaleDateString("cs-CZ", { weekday: "short", day: "numeric", month: "numeric" })}` : "kurýr objednán";
    case "in_transit": return "na cestě";
    case "delivered": return "doručeno";
    case "cancelled": return "zrušeno";
  }
}

/** Štítek jde tisknout u všeho kromě svozu z adresy pobočky (Collection) – ten přiveze kurýr. */
export function maStitek(o: Pick<ObjednavkaDpd, "varianta" | "mode">): boolean {
  return (o.varianta ?? (o.mode === "courier" ? "collection" : "return")) !== "collection";
}

/** Zrušit jde jen dokud se balík nehnul. */
export function jdeZrusit(o: Pick<ObjednavkaDpd, "status">): boolean {
  return o.status === "created" || o.status === "pickup_ordered";
}
