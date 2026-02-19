/**
 * Uložení document config do Supabase (service_document_settings).
 * Logo a razítko: pokud jsou v configu jako data URL (base64), nahrají se do
 * Supabase Storage (bucket service-document-assets) a v configu zůstanou jen URL.
 */
import { createClient } from "@supabase/supabase-js";

const DOCUMENT_ASSETS_BUCKET = "service-document-assets";

function isDataUrl(s: unknown): s is string {
  return typeof s === "string" && /^data:image\/\w+;base64,/.test(s);
}

function isPdfDataUrl(s: unknown): s is string {
  return typeof s === "string" && /^data:application\/pdf;base64,/.test(s);
}

function dataUrlToBufferAndMime(dataUrl: string): { buffer: Buffer; mime: string; ext: string } | null {
  const match = dataUrl.match(/^data:(image\/\w+);base64,(.+)$/);
  if (!match) return null;
  const mime = match[1];
  const base64 = match[2];
  const buffer = Buffer.from(base64, "base64");
  const extMap: Record<string, string> = {
    "image/png": "png",
    "image/jpeg": "jpg",
    "image/jpg": "jpg",
    "image/gif": "gif",
    "image/webp": "webp",
  };
  const ext = extMap[mime] ?? "png";
  return { buffer, mime, ext };
}

/**
 * Nahraje obrázek (logo nebo razítko) z data URL do Supabase Storage.
 * Cesta: {service_id}/logo.{ext} nebo {service_id}/stamp.{ext}.
 * Vyžaduje, aby bucket service-document-assets existoval a byl veřejný pro čtení.
 */
export async function uploadDocumentAssetToStorage(
  serviceId: string,
  type: "logo" | "stamp",
  dataUrl: string,
  supabaseUrl: string,
  supabaseAnonKey: string,
  accessToken: string
): Promise<string | null> {
  const parsed = dataUrlToBufferAndMime(dataUrl);
  if (!parsed) return null;
  const { buffer, mime, ext } = parsed;
  const path = `${serviceId}/${type}.${ext}`;
  try {
    const supabase = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: `Bearer ${accessToken}` } },
    });
    const { error } = await supabase.storage
      .from(DOCUMENT_ASSETS_BUCKET)
      .upload(path, buffer, { contentType: mime, upsert: true });
    if (error) return null;
    const { data } = supabase.storage.from(DOCUMENT_ASSETS_BUCKET).getPublicUrl(path);
    return data?.publicUrl ?? null;
  } catch {
    return null;
  }
}

/**
 * Nahraje PDF (hlavičkový papír) z data URL do Storage. Cesta: {service_id}/letterhead.pdf
 */
export async function uploadLetterheadToStorage(
  serviceId: string,
  dataUrl: string,
  supabaseUrl: string,
  supabaseAnonKey: string,
  accessToken: string
): Promise<string | null> {
  const match = dataUrl.match(/^data:application\/pdf;base64,(.+)$/);
  if (!match) return null;
  const buffer = Buffer.from(match[1], "base64");
  const path = `${serviceId}/letterhead.pdf`;
  try {
    const supabase = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: `Bearer ${accessToken}` } },
    });
    const { error } = await supabase.storage
      .from(DOCUMENT_ASSETS_BUCKET)
      .upload(path, buffer, { contentType: "application/pdf", upsert: true });
    if (error) return null;
    const { data } = supabase.storage.from(DOCUMENT_ASSETS_BUCKET).getPublicUrl(path);
    return data?.publicUrl ?? null;
  } catch {
    return null;
  }
}

/**
 * Provede migraci base64 → Storage: logo, razítko, letterhead PDF.
 */
export async function migrateConfigAssetsToStorage(
  serviceId: string,
  config: Record<string, unknown>,
  supabaseUrl: string,
  supabaseAnonKey: string,
  accessToken: string
): Promise<Record<string, unknown>> {
  const out = JSON.parse(JSON.stringify(config)) as Record<string, unknown>;
  if (isDataUrl(out.logoUrl)) {
    const url = await uploadDocumentAssetToStorage(
      serviceId,
      "logo",
      out.logoUrl,
      supabaseUrl,
      supabaseAnonKey,
      accessToken
    );
    if (url) out.logoUrl = url;
  }
  if (isDataUrl(out.stampUrl)) {
    const url = await uploadDocumentAssetToStorage(
      serviceId,
      "stamp",
      out.stampUrl,
      supabaseUrl,
      supabaseAnonKey,
      accessToken
    );
    if (url) out.stampUrl = url;
  }
  if (isPdfDataUrl(out.letterheadPdfUrl)) {
    const url = await uploadLetterheadToStorage(
      serviceId,
      out.letterheadPdfUrl,
      supabaseUrl,
      supabaseAnonKey,
      accessToken
    );
    if (url) out.letterheadPdfUrl = url;
  }
  return out;
}

export async function saveDocumentsConfigToSupabase(
  serviceId: string,
  config: unknown,
  supabaseUrl: string,
  supabaseAnonKey: string,
  accessToken: string
): Promise<{ ok: boolean; error?: string; updated_at?: string; version?: number }> {
  try {
    const supabase = createClient(supabaseUrl, supabaseAnonKey, {
      global: {
        headers: { Authorization: `Bearer ${accessToken}` },
      },
    });
    const { error } = await supabase
      .from("service_document_settings")
      .upsert(
        { service_id: serviceId, config: config ?? {} },
        { onConflict: "service_id" }
      );
    if (error) return { ok: false, error: error.message };
    const { data } = await supabase
      .from("service_document_settings")
      .select("updated_at, version")
      .eq("service_id", serviceId)
      .single();
    const updated_at = data && typeof (data as { updated_at?: string }).updated_at === "string" ? (data as { updated_at: string }).updated_at : undefined;
    const version = data && typeof (data as { version?: number }).version === "number" ? (data as { version: number }).version : undefined;
    return { ok: true, updated_at, version };
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : String(e),
    };
  }
}

export async function loadDocumentsConfigFromSupabase(
  serviceId: string,
  supabaseUrl: string,
  supabaseAnonKey: string,
  accessToken: string
): Promise<{ config: unknown; version: number; updated_at?: string } | null> {
  try {
    const supabase = createClient(supabaseUrl, supabaseAnonKey, {
      global: {
        headers: { Authorization: `Bearer ${accessToken}` },
      },
    });
    const { data, error } = await supabase
      .from("service_document_settings")
      .select("config, version, updated_at")
      .eq("service_id", serviceId)
      .single();
    if (error || !data) return null;
    const config = (data as { config: unknown }).config;
    const version = typeof (data as { version?: number }).version === "number" ? (data as { version: number }).version : 1;
    const updated_at = typeof (data as { updated_at?: string }).updated_at === "string" ? (data as { updated_at: string }).updated_at : undefined;
    return config != null ? { config, version, updated_at } : null;
  } catch {
    return null;
  }
}
