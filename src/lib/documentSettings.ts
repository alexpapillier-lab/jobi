import { supabase } from "./supabaseClient";
import type { AutoPrintConfig } from "./documentHelpers";

export type { AutoPrintConfig } from "./documentHelpers";

/** Načte surový config + version z DB. */
export async function loadDocumentsConfigRawFromDB(
  serviceId: string | null
): Promise<{ config: any; version: number } | null> {
  if (!supabase || !serviceId) return null;
  try {
    const { data, error } = await supabase
      .from("service_document_settings")
      .select("config, version")
      .eq("service_id", serviceId)
      .single();
    if (error || !data) return null;
    const config = (data as any).config;
    const version = typeof (data as any).version === "number" ? (data as any).version : 1;
    return config != null ? { config, version } : null;
  } catch {
    return null;
  }
}

/** Uloží do DB config s aktualizovaným autoPrint (sloučí s existujícím configem). */
export async function saveDocumentsConfigAutoPrint(
  serviceId: string | null,
  autoPrint: Partial<AutoPrintConfig>
): Promise<boolean> {
  if (!supabase || !serviceId) return false;
  try {
    const raw = await loadDocumentsConfigRawFromDB(serviceId);
    const nextConfig = raw ? { ...raw.config, autoPrint } : { autoPrint };
    const { error } = await (supabase
      .from("service_document_settings") as any)
      .upsert({ service_id: serviceId, config: nextConfig }, { onConflict: "service_id" });
    return !error;
  } catch {
    return false;
  }
}

import type { WarrantyCertificateExtras } from "./documentHelpers";
type WarrantyCertificateConfig = WarrantyCertificateExtras;

/** Uloží do DB config s aktualizovaným warrantyCertificate (sloučí s existujícím). */
export async function saveDocumentsConfigWarrantyCertificate(
  serviceId: string | null,
  warrantyCertificate: Partial<WarrantyCertificateConfig>
): Promise<boolean> {
  if (!supabase || !serviceId) return false;
  try {
    const raw = await loadDocumentsConfigRawFromDB(serviceId);
    const existing = raw?.config?.warrantyCertificate ?? {};
    const nextWarranty = { ...existing, ...warrantyCertificate };
    const nextConfig = raw ? { ...raw.config, warrantyCertificate: nextWarranty } : { warrantyCertificate: nextWarranty };
    const { error } = await (supabase
      .from("service_document_settings") as any)
      .upsert({ service_id: serviceId, config: nextConfig }, { onConflict: "service_id" });
    return !error;
  } catch {
    return false;
  }
}
