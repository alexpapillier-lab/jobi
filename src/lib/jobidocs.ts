/**
 * JobiDocs API client – tisk a export dokumentů přes lokální HTTP API.
 * JobiDocs musí být spuštěn na http://127.0.0.1:3847
 *
 * V Tauri webviewu blokuje CORS POST na localhost. Používáme @tauri-apps/plugin-http,
 * který volá z Rustu a CORS obejde.
 */

const JOBIDOCS_API = "http://127.0.0.1:3847";

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

export async function pushContextToJobiDocs(
  services: Array<{ service_id: string; service_name: string; role: string }>,
  activeServiceId: string | null,
  options?: { documentsConfig?: Record<string, unknown> | null; companyData?: Record<string, unknown> | null }
): Promise<void> {
  try {
    const f = await getJobiDocsFetch();
    await f(`${JOBIDOCS_API}/v1/context`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        services,
        activeServiceId,
        documentsConfig: options?.documentsConfig ?? null,
        companyData: options?.companyData ?? null,
      }),
      connectTimeout: 2000,
    } as RequestInit & { connectTimeout?: number });
  } catch {
    // JobiDocs not running, ignore
  }
}

export type DocTypeForPrint = "zakazkovy_list" | "zarucni_list" | "diagnosticky_protokol";

/**
 * Tisk přes vzor v JobiDocs – data se vloží do šablony JobiDocs, takže vzhled odpovídá nastavení v JobiDocs.
 */
export async function printDocumentViaJobiDocs(
  docType: DocTypeForPrint,
  serviceId: string,
  companyData: Record<string, unknown>,
  sections: Partial<Record<string, string>>
): Promise<{ ok: boolean; error?: string }> {
  try {
    const f = await getJobiDocsFetch();
    const r = await f(`${JOBIDOCS_API}/v1/print-document`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        doc_type: docType,
        service_id: serviceId,
        company_data: companyData,
        sections,
      }),
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
