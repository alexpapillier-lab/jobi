/**
 * Firemní údaje a nabídky (stavy zařízení, způsoby předání) sdílené mezi
 * všemi na servisu, v reálném čase.
 *
 * Do teď žily jen v localStorage – firemní údaje (IČO, DIČ, adresa,
 * bankovní účet) se přitom používají přímo při generování faktur, takže
 * se dvěma lidmi na dvou počítačích šlo mít na fakturách různé údaje.
 * Nabídky stavů/předání navíc neznaly ani servis – jeden seznam pro
 * všechny servisy na tom samém zařízení.
 *
 * Tabulka service_settings, RPC update_service_settings i RLS už
 * existovaly (config JSONB, merge, oprávnění owner/admin nebo member
 * s can_manage_documents pro kontaktní pole) – používaly se ale jen na
 * abbreviation a orders_show_claims_in_list. Tenhle modul přidává zbytek
 * jako další klíče ve stejném configu, žádná nová tabulka.
 *
 * localStorage zůstává jako rychlá čtecí cache pro místa, která dnes
 * čtou synchronně (Orders.tsx přes getDeviceOptions/getHandoffOptions,
 * dokumenty přes safeLoadCompanyData) – DB je zdroj pravdy, cache se
 * přepisuje při načtení i při realtime události.
 */
import { supabase } from "./supabaseClient";

export type ServiceConfig = {
  abbreviation?: string;
  orders_show_claims_in_list?: boolean;
  companyData?: Record<string, unknown>;
  deviceOptions?: Record<string, unknown>;
  handoffOptions?: Record<string, unknown>;
  [key: string]: unknown;
};

/** Aktuální config servisu. `null` při chybě/neexistenci – volající drží výchozí hodnoty. */
export async function loadServiceConfig(serviceId: string): Promise<ServiceConfig | null> {
  if (!supabase) return null;
  const { data, error } = await (supabase.from("service_settings") as any)
    .select("config")
    .eq("service_id", serviceId)
    .maybeSingle();
  if (error || !data) return null;
  return (data.config as ServiceConfig) ?? {};
}

/**
 * Uloží (merge) část configu. Stejná RPC, jaká se dnes používá pro
 * abbreviation – merguje se v databázi, ne read-modify-write z klienta,
 * takže dva lidi editující ve stejnou chvíli různá pole si nepřepíšou
 * navzájem změny.
 */
export async function mergeServiceConfig(
  serviceId: string,
  patch: Partial<ServiceConfig>,
): Promise<{ error?: string }> {
  if (!supabase) return { error: "Supabase není k dispozici" };
  const { error } = await (supabase as any).rpc("update_service_settings", {
    p_service_id: serviceId,
    p_patch: { config: patch },
  });
  return error ? { error: error.message } : {};
}

/**
 * Realtime odběr změn configu daného servisu. Vrací funkci na odhlášení.
 * `onChange` dostane celý nový config (ne jen patch) při KAŽDÉ změně –
 * i té, kterou právě udělal tenhle klient, aby se nemuselo řešit
 * rozlišování "moje" vs "cizí" změna.
 */
export function subscribeServiceConfig(
  serviceId: string,
  onChange: (config: ServiceConfig) => void,
): () => void {
  if (!supabase) return () => {};
  const channel = supabase
    .channel(`service_settings:${serviceId}`)
    .on(
      "postgres_changes",
      { event: "*", schema: "public", table: "service_settings", filter: `service_id=eq.${serviceId}` },
      (payload: any) => {
        const config = payload.new?.config;
        if (config) onChange(config as ServiceConfig);
      },
    )
    .subscribe();
  return () => { void supabase!.removeChannel(channel); };
}
