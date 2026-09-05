/**
 * Propojení na fakturační aplikace (iDoklad; později Fakturoid).
 *
 * Tajemství (Client ID / Secret) leží v `service_integrations`, kterou smí
 * číst jen majitel a správce. Členové se ptají RPC
 * `service_integration_providers`, jestli je propojení zapnuté – jen kvůli
 * tlačítku v detailu faktury. Vlastní export dělá edge funkce
 * `invoice-export`, klient jí dá jen id faktury.
 */
import { supabase, getSupabaseClient, supabaseFetch } from "./supabaseClient";

export type IntegrationProvider = "idoklad" | "fakturoid";

export const PROVIDER_LABELS: Record<IntegrationProvider, string> = {
  idoklad: "iDoklad",
  fakturoid: "Fakturoid",
};

export type IntegrationRow = {
  service_id: string;
  provider: IntegrationProvider;
  config: Record<string, unknown>;
  active: boolean;
  last_ok_at: string | null;
  last_error: string | null;
};

export async function loadIntegration(serviceId: string, provider: IntegrationProvider): Promise<IntegrationRow | null> {
  if (!supabase) return null;
  const { data, error } = await (supabase.from("service_integrations") as any)
    .select("*")
    .eq("service_id", serviceId)
    .eq("provider", provider)
    .maybeSingle();
  if (error || !data) return null;
  return data as IntegrationRow;
}

export async function saveIntegration(serviceId: string, provider: IntegrationProvider, config: Record<string, unknown>, active = true): Promise<{ error?: string }> {
  if (!supabase) return { error: "Supabase není k dispozici" };
  const { error } = await (supabase.from("service_integrations") as any)
    .upsert({ service_id: serviceId, provider, config, active, last_error: null }, { onConflict: "service_id,provider" });
  return error ? { error: error.message } : {};
}

export async function deleteIntegration(serviceId: string, provider: IntegrationProvider): Promise<{ error?: string }> {
  if (!supabase) return { error: "Supabase není k dispozici" };
  const { error } = await (supabase.from("service_integrations") as any)
    .delete()
    .eq("service_id", serviceId)
    .eq("provider", provider);
  return error ? { error: error.message } : {};
}

/** Zapnutá propojení servisu (pro každého člena, bez tajemství). */
export async function loadActiveProviders(serviceId: string): Promise<IntegrationProvider[]> {
  if (!supabase) return [];
  const { data, error } = await (supabase as any).rpc("service_integration_providers", { p_service_id: serviceId });
  if (error || !Array.isArray(data)) return [];
  return data.filter((p: unknown): p is IntegrationProvider => p === "idoklad" || p === "fakturoid");
}

export type ExportResult = {
  ok: boolean;
  error?: string;
  external_id?: string;
  external_number?: string;
  external_url?: string;
  /** Už bylo exportováno dřív – vrací se uložená stopa. */
  already?: boolean;
};

async function callExport(body: Record<string, unknown>): Promise<ExportResult> {
  const client = getSupabaseClient();
  if (!client) return { ok: false, error: "Supabase není k dispozici" };
  const { data: sessionData } = await client.auth.getSession();
  const token = sessionData?.session?.access_token;
  if (!token) return { ok: false, error: "Nepřihlášeno" };
  const url = (import.meta.env.VITE_SUPABASE_URL as string | undefined) ?? "";
  try {
    const res = await supabaseFetch(`${url}/functions/v1/invoice-export`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify(body),
    });
    const raw = await res.text();
    let data: ExportResult = { ok: false };
    try { if (raw) data = JSON.parse(raw); } catch { /* prázdná odpověď */ }
    if (!res.ok) return { ok: false, error: data.error ?? `HTTP ${res.status}` };
    return { ...data, ok: data.ok !== false };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

/** Odešle vystavenou fakturu do fakturační aplikace. */
export function exportInvoice(serviceId: string, invoiceId: string, provider: IntegrationProvider): Promise<ExportResult> {
  return callExport({ service_id: serviceId, invoice_id: invoiceId, provider });
}

/** Ověří přihlašovací údaje (bez odeslání dokladu). */
export function testIntegration(serviceId: string, provider: IntegrationProvider): Promise<ExportResult> {
  return callExport({ service_id: serviceId, provider, action: "test" });
}
