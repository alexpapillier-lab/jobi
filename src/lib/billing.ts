/**
 * Předplatné servisu (Stripe).
 *
 * Aplikace se Stripe nikdy neptá přímo – co je zapnuté, ví z nároků
 * (`service_entitlements`). Tenhle modul jen ukáže stav a pošle člověka do
 * Stripe Checkout nebo do zákaznického portálu.
 *
 * Dokud nejsou klíče nastavené, edge funkce vrací 503 a `notConfigured`;
 * obrazovky s tím počítají a nabídnou napsat nám.
 */
import { supabase, supabaseUrl, supabaseFetch } from "./supabaseClient";

export type BillingRow = {
  service_id: string;
  stripe_customer_id: string | null;
  stripe_subscription_id: string | null;
  status: string | null;
  plan: string | null;
  branches_quantity: number;
  current_period_end: string | null;
  cancel_at_period_end: boolean;
};

export const PODPORA_EMAIL = "podpora@appjobi.com";

export async function loadBilling(serviceId: string): Promise<BillingRow | null> {
  if (!supabase) return null;
  const { data, error } = await (supabase.from("service_billing") as any)
    .select("*")
    .eq("service_id", serviceId)
    .maybeSingle();
  if (error || !data) return null;
  return data as BillingRow;
}

type Odpoved = { url?: string; error?: string; notConfigured?: boolean };

async function volat(fn: "billing-checkout" | "billing-portal", body: Record<string, unknown>): Promise<Odpoved> {
  if (!supabase || !supabaseUrl) return { error: "Aplikace není připojená ke cloudu." };
  const { data: sessionData } = await supabase.auth.getSession();
  const token = sessionData?.session?.access_token;
  if (!token) return { error: "Nepřihlášeno." };
  try {
    const res = await supabaseFetch(`${supabaseUrl}/functions/v1/${fn}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ return_url: window.location.origin + window.location.pathname, ...body }),
    });
    const raw = await res.text();
    const data = raw ? JSON.parse(raw) : {};
    if (res.status === 503) return { error: data?.error ?? "Platby zatím nejsou spuštěné.", notConfigured: true };
    if (!res.ok) return { error: data?.error ?? `Chyba ${res.status}` };
    return { url: data?.url as string | undefined };
  } catch (e) {
    return { error: e instanceof Error ? e.message : String(e) };
  }
}

/** Vytvoří platební sezení a vrátí adresu Stripe Checkout. */
export function startCheckout(serviceId: string, opts?: { plan?: string; branches?: number }): Promise<Odpoved> {
  return volat("billing-checkout", { service_id: serviceId, plan: opts?.plan, branches: opts?.branches });
}

/** Odkaz do zákaznického portálu Stripe (karta, faktury, zrušení). */
export function openPortal(serviceId: string): Promise<Odpoved> {
  return volat("billing-portal", { service_id: serviceId });
}

export const STATUS_LABELS: Record<string, string> = {
  trialing: "Zkušební období",
  active: "Aktivní",
  past_due: "Po splatnosti",
  canceled: "Zrušeno",
  unpaid: "Nezaplaceno",
  incomplete: "Nedokončeno",
  incomplete_expired: "Vypršelo",
};
