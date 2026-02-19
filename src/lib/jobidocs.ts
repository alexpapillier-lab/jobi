/**
 * JobiDocs API client – tisk a export dokumentů přes lokální HTTP API.
 * JobiDocs musí být spuštěn na http://127.0.0.1:3847
 *
 * V Tauri webviewu blokuje CORS POST na localhost. Používáme @tauri-apps/plugin-http,
 * který volá z Rustu a CORS obejde.
 */

const JOBIDOCS_API = "http://127.0.0.1:3847";

/** URL pro stažení JobiDocs (stránka release / konkrétní instalátor). */
export const JOBIDOCS_DOWNLOAD_URL = "https://github.com/alexpapillier-lab/jobi/releases";

/** Otevře URL v prohlížeči (v Tauri přes plugin-opener, jinak window.open). */
export async function openJobiDocsDownload(): Promise<void> {
  try {
    const { openUrl } = await import("@tauri-apps/plugin-opener");
    await openUrl(JOBIDOCS_DOWNLOAD_URL);
  } catch {
    window.open(JOBIDOCS_DOWNLOAD_URL, "_blank", "noopener,noreferrer");
  }
}

/** Spustí aplikaci JobiDocs (na macOS volá open -a JobiDocs). Vrací true pokud se příkaz provedl. */
export async function launchJobiDocsApp(): Promise<boolean> {
  try {
    const { invoke } = await import("@tauri-apps/api/core");
    const ok = await invoke<boolean>("launch_jobidocs");
    return ok === true;
  } catch {
    return false;
  }
}

let _jobidocsFetch: typeof fetch | null = null;

async function getJobiDocsFetch(): Promise<typeof fetch> {
  if (_jobidocsFetch) return _jobidocsFetch;
  try {
    const { fetch: tauriFetch } = await import("@tauri-apps/plugin-http");
    _jobidocsFetch = tauriFetch;
  } catch {
    _jobidocsFetch = fetch;
  }
  return _jobidocsFetch;
}

export async function isJobiDocsRunning(): Promise<boolean> {
  try {
    const f = await getJobiDocsFetch();
    const r = await f(`${JOBIDOCS_API}/v1/context`, {
      method: "GET",
      connectTimeout: 2000,
    } as RequestInit & { connectTimeout?: number });
    return r.ok;
  } catch {
    return false;
  }
}

/** Pro zobrazení uživateli: u „not found“ a podobných chyb přidá návod. */
export function formatJobiDocsErrorForUser(error: string | undefined): string {
  if (!error || !error.trim()) return "Neznámá chyba JobiDocs.";
  const lower = error.toLowerCase();
  if (lower.includes("not found") || lower.includes("nenalezen") || lower.includes("not_found")) {
    return `${error} — V aplikaci JobiDocs zkontrolujte, že je vybraný správný servis a že existuje šablona dokumentu. Případně restartujte JobiDocs a zkuste znovu.`;
  }
  return error;
}

export async function printViaJobiDocs(
  html: string,
  serviceId?: string
): Promise<{ ok: boolean; error?: string }> {
  try {
    const f = await getJobiDocsFetch();
    const r = await f(`${JOBIDOCS_API}/v1/print`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ html, service_id: serviceId }),
      connectTimeout: 30000,
    } as RequestInit & { connectTimeout?: number });
    const d = await r.json();
    if (!r.ok) {
      return { ok: false, error: (d as { error?: string }).error || r.statusText };
    }
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

export async function getProfileFromJobiDocs(
  serviceId: string,
  docType: "zakazkovy_list" | "zarucni_list" | "diagnosticky_protokol"
): Promise<Record<string, unknown> | null> {
  try {
    const f = await getJobiDocsFetch();
    const r = await f(
      `${JOBIDOCS_API}/v1/profiles?service_id=${encodeURIComponent(serviceId)}&doc_type=${encodeURIComponent(docType)}`,
      { method: "GET", connectTimeout: 2000 } as RequestInit & { connectTimeout?: number }
    );
    if (!r.ok) return null;
    const d = await r.json();
    const p = (d as { profile_json?: unknown }).profile_json;
    return p && typeof p === "object" && p !== null ? (p as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

export type JobiDocsLogoColors = { background: string; jInner: string; foreground: string };

/** Supabase credentials pro JobiDocs – umožní mu ukládat document config do DB. */
export type JobiDocsSupabaseAuth = {
  supabaseUrl: string;
  supabaseAnonKey: string;
  supabaseAccessToken: string | null;
};

export async function pushContextToJobiDocs(
  services: Array<{ service_id: string; service_name: string; role: string }>,
  activeServiceId: string | null,
  options?: {
    documentsConfig?: Record<string, unknown> | null;
    companyData?: Record<string, unknown> | null;
    jobidocsLogo?: JobiDocsLogoColors | null;
    /** Má aktuální uživatel oprávnění měnit nastavení dokumentů? (owner/admin nebo can_manage_documents) */
    canManageDocuments?: boolean;
    /** Pokud uvedeno, JobiDocs může ukládat document config do DB pod tímto uživatelským tokenem. */
    supabaseAuth?: JobiDocsSupabaseAuth | null;
  }
): Promise<void> {
  try {
    const f = await getJobiDocsFetch();
    const body: Record<string, unknown> = {
      services,
      activeServiceId,
      documentsConfig: options?.documentsConfig ?? null,
      companyData: options?.companyData ?? null,
      jobidocsLogo: options?.jobidocsLogo ?? null,
      canManageDocuments: options?.canManageDocuments ?? true,
    };
    if (options?.supabaseAuth) {
      body.supabaseUrl = options.supabaseAuth.supabaseUrl;
      body.supabaseAnonKey = options.supabaseAuth.supabaseAnonKey;
      body.supabaseAccessToken = options.supabaseAuth.supabaseAccessToken ?? null;
    }
    await f(`${JOBIDOCS_API}/v1/context`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      connectTimeout: 2000,
    } as RequestInit & { connectTimeout?: number });
  } catch {
    // JobiDocs not running, ignore
  }
}

export type DocTypeForPrint = "zakazkovy_list" | "zarucni_list" | "diagnosticky_protokol" | "prijemka_reklamace" | "vydejka_reklamace";

/**
 * Tisk přes vzor v JobiDocs – data se vloží do šablony JobiDocs, takže vzhled odpovídá nastavení v JobiDocs.
 */
export async function printDocumentViaJobiDocs(
  docType: DocTypeForPrint,
  serviceId: string,
  companyData: Record<string, unknown>,
  sections: Partial<Record<string, string>>,
  options?: { repair_date?: string; variables?: Record<string, string> }
): Promise<{ ok: boolean; error?: string }> {
  try {
    const f = await getJobiDocsFetch();
    const body: Record<string, unknown> = {
      doc_type: docType,
      service_id: serviceId,
      company_data: companyData,
      sections,
    };
    if (options?.repair_date != null) body.repair_date = options.repair_date;
    if (options?.variables != null && typeof options.variables === "object") body.variables = options.variables;
    const r = await f(`${JOBIDOCS_API}/v1/print-document`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      connectTimeout: 30000,
    } as RequestInit & { connectTimeout?: number });
    const d = await r.json();
    if (!r.ok) {
      return { ok: false, error: (d as { error?: string }).error || r.statusText };
    }
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

/**
 * Export dokumentu do PDF souboru – stejná šablona a data jako u tisku (JobiDocs),
 * ale PDF se uloží do zvolené cesty místo odeslání na tiskárnu.
 */
export async function exportDocumentViaJobiDocs(
  docType: DocTypeForPrint,
  serviceId: string,
  companyData: Record<string, unknown>,
  sections: Partial<Record<string, string>>,
  targetPath: string,
  options?: { repair_date?: string; variables?: Record<string, string> }
): Promise<{ ok: boolean; error?: string }> {
  try {
    const f = await getJobiDocsFetch();
    const body: Record<string, unknown> = {
      doc_type: docType,
      service_id: serviceId,
      company_data: companyData,
      sections,
      target_path: targetPath,
    };
    if (options?.repair_date != null) body.repair_date = options.repair_date;
    if (options?.variables != null && typeof options.variables === "object") body.variables = options.variables;
    const r = await f(`${JOBIDOCS_API}/v1/export-document`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      connectTimeout: 60000,
    } as RequestInit & { connectTimeout?: number });
    const d = await r.json();
    if (!r.ok) {
      return { ok: false, error: (d as { error?: string }).error || r.statusText };
    }
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

export async function exportViaJobiDocs(
  html: string,
  targetPath: string
): Promise<{ ok: boolean; error?: string }> {
  try {
    const f = await getJobiDocsFetch();
    const r = await f(`${JOBIDOCS_API}/v1/export`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ html, target_path: targetPath }),
      connectTimeout: 60000,
    } as RequestInit & { connectTimeout?: number });
    const d = await r.json();
    if (!r.ok) {
      return { ok: false, error: (d as { error?: string }).error || r.statusText };
    }
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}
