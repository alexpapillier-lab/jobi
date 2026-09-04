/**
 * JobiDocs API client – tisk a export dokumentů přes lokální HTTP API.
 * JobiDocs musí být spuštěn na http://127.0.0.1:3847
 *
 * V Tauri webviewu blokuje CORS POST na localhost. Používáme @tauri-apps/plugin-http,
 * který volá z Rustu a CORS obejde.
 *
 * Od JobiDocs 2 posílá Jobi typovaná data dokumentu (DocumentData) na /v2/*.
 * Šablonu, vzhled i formátování drží JobiDocs; Jobi jen dodá čísla a texty.
 */
import type { DocumentData } from "./documentData";
import { isWeb } from "./platform";

const JOBIDOCS_API = "http://127.0.0.1:3847";

/** URL pro stažení JobiDocs – stránka appjobi s sekcí Stáhnout (Jobi + JobiDocs zvlášť). */
export const JOBIDOCS_DOWNLOAD_URL = "https://appjobi.com/#stazeni";

export type DocTypeForPrint = "zakazkovy_list" | "zarucni_list" | "diagnosticky_protokol" | "prijemka_reklamace" | "vydejka_reklamace" | "faktura";

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

type Req = RequestInit & { connectTimeout?: number };

export async function isJobiDocsRunning(): Promise<boolean> {
  // Ve webové verzi JobiDocs neběží a dotaz na localhost:3847 by jen čekal
  // na timeout. Zároveň to umlčí opakované dotazy z JobiDocsStatus.
  if (isWeb()) return false;
  try {
    const f = await getJobiDocsFetch();
    const r = await f(`${JOBIDOCS_API}/v1/context`, { method: "GET", connectTimeout: 2000 } as Req);
    return r.ok;
  } catch {
    return false;
  }
}

/** Verze API JobiDocs; 2 = umí /v2 (typovaná data). null = neběží. */
export async function jobiDocsApiVersion(): Promise<number | null> {
  if (isWeb()) return null;
  try {
    const f = await getJobiDocsFetch();
    const r = await f(`${JOBIDOCS_API}/v1/health`, { method: "GET", connectTimeout: 2000 } as Req);
    if (!r.ok) return null;
    const d = (await r.json()) as { api?: number };
    return typeof d.api === "number" ? d.api : 1;
  } catch {
    return null;
  }
}

/** Pro zobrazení uživateli: u „not found“ a podobných chyb přidá návod. */
export function formatJobiDocsErrorForUser(error: string | undefined): string {
  if (!error || !error.trim()) return "Neznámá chyba JobiDocs.";
  const lower = error.toLowerCase();
  if (lower.includes("not found") || lower.includes("nenalezen") || lower.includes("not_found")) {
    return `${error} — V aplikaci JobiDocs zkontrolujte, že je vybraný správný servis a že je šablona dokumentu uložená. Případně restartujte JobiDocs a zkuste znovu.`;
  }
  if (lower.includes("requires jobidocs") || lower.includes("503")) {
    return "JobiDocs neběží v plné verzi (chybí Electron). Spusťte nainstalovanou aplikaci JobiDocs.";
  }
  return error;
}

export type JobiDocsLogoColors = { background: string; jInner: string; foreground: string };

/** Supabase credentials pro JobiDocs – umožní mu ukládat šablony do DB. */
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
    canManageDocuments?: boolean;
    supabaseAuth?: JobiDocsSupabaseAuth | null;
  }
): Promise<void> {
  if (isWeb()) return;
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
    const json = JSON.stringify(body);
    // Rust část Jobi posílá tentýž kontext každých 5 s i ve chvíli, kdy macOS
    // uspí JavaScript v okně na pozadí (jinak by JobiDocs po restartu čekal
    // na kontext, dokud uživatel nepřepne do Jobi).
    try {
      const { invoke } = await import("@tauri-apps/api/core");
      await invoke("set_jobidocs_context", { payload: json });
    } catch {
      // starší Jobi bez příkazu / web – posílá jen JS
    }
    await f(`${JOBIDOCS_API}/v1/context`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: json,
      connectTimeout: 2000,
    } as Req);
  } catch {
    // JobiDocs not running, ignore
  }
}

type Result = { ok: boolean; error?: string };

async function postJson(path: string, body: unknown, timeoutMs: number): Promise<Response> {
  const f = await getJobiDocsFetch();
  return f(`${JOBIDOCS_API}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    connectTimeout: timeoutMs,
  } as Req);
}

async function toResult(r: Response): Promise<Result> {
  const d = (await r.json().catch(() => ({}))) as { error?: string };
  if (!r.ok) return { ok: false, error: d.error || r.statusText };
  return { ok: true };
}

/** Tisk dokumentu: JobiDocs vloží data do šablony servisu a pošle na tiskárnu. */
export async function printDocument(docType: DocTypeForPrint, serviceId: string, data: DocumentData): Promise<Result> {
  try {
    return await toResult(await postJson("/v2/print", { doc_type: docType, service_id: serviceId, data }, 30000));
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

/** Export do PDF souboru na dané cestě (stejná šablona a data jako tisk). */
export async function exportDocument(docType: DocTypeForPrint, serviceId: string, data: DocumentData, targetPath: string): Promise<Result> {
  try {
    return await toResult(await postJson("/v2/export", { doc_type: docType, service_id: serviceId, data, target_path: targetPath }, 60000));
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

/** PDF jako data (náhled v Jobi, příloha e-mailu). */
export async function renderPdf(docType: DocTypeForPrint, serviceId: string, data: DocumentData): Promise<{ ok: boolean; data?: ArrayBuffer; error?: string }> {
  try {
    const r = await postJson("/v2/pdf", { doc_type: docType, service_id: serviceId, data }, 60000);
    if (!r.ok) {
      const d = (await r.json().catch(() => ({}))) as { error?: string };
      return { ok: false, error: d.error || r.statusText };
    }
    return { ok: true, data: await r.arrayBuffer() };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

/** HTML dokumentu (rychlý náhled v Jobi bez PDF). */
export async function renderHtml(docType: DocTypeForPrint, serviceId: string, data: DocumentData): Promise<{ ok: boolean; html?: string; error?: string }> {
  try {
    const r = await postJson("/v2/html", { doc_type: docType, service_id: serviceId, data }, 15000);
    if (!r.ok) {
      const d = (await r.json().catch(() => ({}))) as { error?: string };
      return { ok: false, error: d.error || r.statusText };
    }
    return { ok: true, html: await r.text() };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

// ---------------------------------------------------------------------------
// Starší cesta (surové HTML). Ponecháno pro případ nouzového tisku.
// ---------------------------------------------------------------------------

export async function printViaJobiDocs(html: string, serviceId?: string): Promise<Result> {
  try {
    return await toResult(await postJson("/v1/print", { html, service_id: serviceId }, 30000));
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

export async function exportViaJobiDocs(html: string, targetPath: string): Promise<Result> {
  try {
    return await toResult(await postJson("/v1/export", { html, target_path: targetPath }, 60000));
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}
