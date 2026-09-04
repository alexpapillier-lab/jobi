/**
 * Kde je šablona: jeden zdroj pravdy.
 *
 * Pořadí při čtení:
 *  1. Supabase (když Jobi poslalo přihlášení) – sdílené v rámci servisu,
 *  2. config, který Jobi pushuje v kontextu (čte ho z DB, hodí se offline),
 *  3. lokální cache v userData,
 *  4. výchozí šablony z jádra.
 *
 * Zápis jde do Supabase s kontrolou verze (409 při konfliktu) a do lokální
 * cache. Šablona v2 leží v `service_document_settings.config.v2`; ostatní
 * klíče configu (autoPrint z Jobi) se zachovají.
 */
import { createClient } from "@supabase/supabase-js";
import { documentsFromConfig, normalizeDocuments, type DocumentsV2 } from "../core/index.js";
import { getDocumentsConfig, putDocumentsConfig } from "./documentsConfig.js";
import { uploadDocumentAssetToStorage, uploadLetterheadToStorage } from "./supabaseSync.js";

export type SupabaseAuth = { supabaseUrl: string; supabaseAnonKey: string; supabaseAccessToken: string | null };

export type LoadedDocuments = {
  documents: DocumentsV2;
  version: number;
  updated_at: string | null;
  source: "supabase" | "context" | "local" | "default";
};

type Rec = Record<string, unknown>;

function client(auth: SupabaseAuth) {
  return createClient(auth.supabaseUrl, auth.supabaseAnonKey, {
    global: { headers: { Authorization: `Bearer ${auth.supabaseAccessToken}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

async function loadRowFromSupabase(serviceId: string, auth: SupabaseAuth): Promise<{ config: Rec; version: number; updated_at: string | null } | null> {
  try {
    const { data, error } = await client(auth).from("service_document_settings").select("config, version, updated_at").eq("service_id", serviceId).maybeSingle();
    if (error || !data) return null;
    const row = data as { config: unknown; version?: number; updated_at?: string };
    return {
      config: (row.config && typeof row.config === "object" ? row.config : {}) as Rec,
      version: typeof row.version === "number" ? row.version : 1,
      updated_at: typeof row.updated_at === "string" ? row.updated_at : null,
    };
  } catch {
    return null;
  }
}

export async function loadDocuments(serviceId: string, auth: SupabaseAuth | null, contextConfig: unknown): Promise<LoadedDocuments> {
  if (auth?.supabaseAccessToken) {
    const row = await loadRowFromSupabase(serviceId, auth);
    if (row) {
      const documents = normalizeDocuments(documentsFromConfig(row.config));
      // lokální cache pro offline tisk
      await putDocumentsConfig(serviceId, row.config).catch(() => {});
      return { documents, version: row.version, updated_at: row.updated_at, source: "supabase" };
    }
  }
  if (contextConfig && typeof contextConfig === "object" && Object.keys(contextConfig as Rec).length > 0) {
    return { documents: normalizeDocuments(documentsFromConfig(contextConfig)), version: 0, updated_at: null, source: "context" };
  }
  const local = await getDocumentsConfig(serviceId).catch(() => null);
  if (local?.config && typeof local.config === "object" && Object.keys(local.config as Rec).length > 0) {
    return { documents: normalizeDocuments(documentsFromConfig(local.config)), version: 0, updated_at: null, source: "local" };
  }
  return { documents: normalizeDocuments(documentsFromConfig(null)), version: 0, updated_at: null, source: "default" };
}

/** Data URL v brandu → Storage, v JSONu zůstane jen URL. */
export async function uploadBrandAssets(serviceId: string, docs: DocumentsV2, auth: SupabaseAuth): Promise<DocumentsV2> {
  const token = auth.supabaseAccessToken;
  if (!token) return docs;
  const brand = { ...docs.brand };
  if (brand.logoUrl?.startsWith("data:image/")) {
    const url = await uploadDocumentAssetToStorage(serviceId, "logo", brand.logoUrl, auth.supabaseUrl, auth.supabaseAnonKey, token);
    if (url) brand.logoUrl = `${url}?v=${Date.now()}`;
  }
  if (brand.stampUrl?.startsWith("data:image/")) {
    const url = await uploadDocumentAssetToStorage(serviceId, "stamp", brand.stampUrl, auth.supabaseUrl, auth.supabaseAnonKey, token);
    if (url) brand.stampUrl = `${url}?v=${Date.now()}`;
  }
  if (brand.letterheadPdfUrl?.startsWith("data:application/pdf")) {
    const url = await uploadLetterheadToStorage(serviceId, brand.letterheadPdfUrl, auth.supabaseUrl, auth.supabaseAnonKey, token);
    if (url) brand.letterheadPdfUrl = `${url}?v=${Date.now()}`;
  }
  return { ...docs, brand };
}

export type SaveResult =
  | { ok: true; version: number; updated_at: string | null; documents: DocumentsV2; savedTo: "supabase" | "local" }
  | { ok: false; conflict: true; version: number; updated_at: string | null }
  | { ok: false; conflict?: false; error: string };

export async function saveDocuments(serviceId: string, docs: DocumentsV2, ifVersion: number | undefined, auth: SupabaseAuth | null): Promise<SaveResult> {
  let documents = normalizeDocuments(docs);

  if (auth?.supabaseAccessToken) {
    try {
      documents = await uploadBrandAssets(serviceId, documents, auth);
    } catch {
      // assety zůstanou jako data URL; uloží se, jen budou větší
    }
    const sb = client(auth);
    const row = await loadRowFromSupabase(serviceId, auth);
    if (row && ifVersion != null && row.version !== ifVersion) {
      return { ok: false, conflict: true, version: row.version, updated_at: row.updated_at };
    }
    // Zachovat ostatní klíče (autoPrint z Jobi), staré v1 klíče šablon už nepotřebujeme.
    const keep: Rec = {};
    if (row?.config && typeof row.config.autoPrint === "object") keep.autoPrint = row.config.autoPrint;
    const nextConfig = { ...keep, v2: documents };
    const { error } = await sb.from("service_document_settings").upsert({ service_id: serviceId, config: nextConfig }, { onConflict: "service_id" });
    if (error) return { ok: false, error: error.message };
    const after = await loadRowFromSupabase(serviceId, auth);
    await putDocumentsConfig(serviceId, nextConfig).catch(() => {});
    return { ok: true, version: after?.version ?? (row?.version ?? 0) + 1, updated_at: after?.updated_at ?? null, documents, savedTo: "supabase" };
  }

  const local = await getDocumentsConfig(serviceId).catch(() => null);
  const prev = (local?.config && typeof local.config === "object" ? local.config : {}) as Rec;
  const nextConfig = { ...(prev.autoPrint ? { autoPrint: prev.autoPrint } : {}), v2: documents };
  const res = await putDocumentsConfig(serviceId, nextConfig);
  return { ok: true, version: res.version, updated_at: null, documents, savedTo: "local" };
}
