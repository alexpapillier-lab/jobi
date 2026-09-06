import { supabase } from "./supabaseClient";
import type { AutoPrintConfig } from "./documentHelpers";
import { logError } from "./errorLog";

export type { AutoPrintConfig } from "./documentHelpers";

/**
 * Nastavení dokumentů servisu (šablony, firemní údaje, automatický tisk)
 * je jeden JSON sloupec. Zápis proto vždy nejdřív načte, co v databázi je,
 * a teprve pak přepíše svou část.
 *
 * Kritické místo: „nepodařilo se načíst“ a „servis ještě nic nemá“ se
 * nesmí splést. Dřív obojí vracelo `null` a zápis pak uložil jen svůj
 * kousek – jediný výpadek sítě při přepnutí automatického tisku smazal
 * servisu všechny šablony i firemní údaje.
 */
type NactenyConfig =
  | { stav: "ok"; config: Record<string, unknown>; version: number }
  | { stav: "prazdno" }
  | { stav: "chyba"; chyba: unknown };

async function nactiConfig(serviceId: string): Promise<NactenyConfig> {
  if (!supabase) return { stav: "chyba", chyba: new Error("Supabase není k dispozici") };
  try {
    // maybeSingle, ne single: nový servis řádek s nastavením dokumentů ještě
    // nemá a `single` vrací 406, takže konzole nového zákazníka svítí červeně.
    const { data, error } = await supabase
      .from("service_document_settings")
      .select("config, version")
      .eq("service_id", serviceId)
      .maybeSingle();
    if (error) return { stav: "chyba", chyba: error };
    const config = (data as any)?.config;
    if (config == null) return { stav: "prazdno" };
    const version = typeof (data as any).version === "number" ? (data as any).version : 1;
    return { stav: "ok", config, version };
  } catch (chyba) {
    return { stav: "chyba", chyba };
  }
}

/** Načte surový config + version z DB. `null` = nic tam není, nebo se nepodařilo načíst. */
export async function loadDocumentsConfigRawFromDB(
  serviceId: string | null
): Promise<{ config: any; version: number } | null> {
  if (!serviceId) return null;
  const r = await nactiConfig(serviceId);
  return r.stav === "ok" ? { config: r.config, version: r.version } : null;
}

/** Uloží změnu jedné části configu; zbytek nechá být. Vrací, jestli to prošlo. */
async function ulozCast(
  serviceId: string | null,
  klic: string,
  uprav: (stavajici: any) => unknown,
  kdo: string,
): Promise<boolean> {
  if (!supabase || !serviceId) return false;
  const nactene = await nactiConfig(serviceId);
  if (nactene.stav === "chyba") {
    // Zápis by přepsal celý config tím, co zrovna měníme – radši neuložit nic.
    void logError({
      code: "documentSettings.nacteni_selhalo",
      error: nactene.chyba,
      source: kdo,
      serviceId,
      context: { klic },
    });
    return false;
  }
  const stavajici = nactene.stav === "ok" ? nactene.config : {};
  const nextConfig = { ...stavajici, [klic]: uprav((stavajici as any)[klic]) };
  const { error } = await (supabase.from("service_document_settings") as any)
    .upsert({ service_id: serviceId, config: nextConfig }, { onConflict: "service_id" });
  if (error) {
    void logError({ code: "documentSettings.zapis_selhal", error, source: kdo, serviceId, context: { klic } });
    return false;
  }
  return true;
}

/** Uloží do DB config s aktualizovaným autoPrint (sloučí s existujícím configem). */
export async function saveDocumentsConfigAutoPrint(
  serviceId: string | null,
  autoPrint: Partial<AutoPrintConfig>
): Promise<boolean> {
  return ulozCast(serviceId, "autoPrint", () => autoPrint, "documentSettings.saveAutoPrint");
}

import type { WarrantyCertificateExtras } from "./documentHelpers";
type WarrantyCertificateConfig = WarrantyCertificateExtras;

/** Uloží do DB config s aktualizovaným warrantyCertificate (sloučí s existujícím). */
export async function saveDocumentsConfigWarrantyCertificate(
  serviceId: string | null,
  warrantyCertificate: Partial<WarrantyCertificateConfig>
): Promise<boolean> {
  return ulozCast(
    serviceId,
    "warrantyCertificate",
    (stavajici) => ({ ...((stavajici as object) ?? {}), ...warrantyCertificate }),
    "documentSettings.saveWarrantyCertificate",
  );
}
