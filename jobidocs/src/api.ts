/**
 * Klient lokálního API JobiDocs (běží v Electron main procesu).
 * Náhled dokumentu se nerenderuje přes API, ale přímo z jádra (core/) –
 * je to tatáž funkce, kterou API používá pro PDF.
 */
import type { DocType, DocumentData, DocumentsV2, SampleKind } from "../core/index";

/** Ve vývoji lze API přesměrovat: http://localhost:5173/?api=http://127.0.0.1:3848 */
export const API_BASE = (typeof location !== "undefined" && new URLSearchParams(location.search).get("api")) || "http://127.0.0.1:3847";

export type ServiceEntry = { service_id: string; service_name: string; role: string };
export type Context = {
  services: ServiceEntry[];
  activeServiceId: string | null;
  companyData: Record<string, unknown> | null;
  canManageDocuments: boolean;
};
export type Printer = { name: string; status: string; available: boolean };
export type ActivityEntry = { ts: string; action: "print" | "export"; status: "ok" | "error" | "pending"; detail?: string };
export type LoadedDocuments = {
  documents: DocumentsV2;
  version: number;
  updated_at: string | null;
  source: "supabase" | "context" | "local" | "default";
  canManage: boolean;
  online: boolean;
};

async function json<T>(res: Response): Promise<T> {
  const text = await res.text();
  let body: unknown = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = { error: text };
  }
  if (!res.ok) {
    const err = new Error((body as { error?: string })?.error || res.statusText) as Error & { status: number; body: unknown };
    err.status = res.status;
    err.body = body;
    throw err;
  }
  return body as T;
}

export const api = {
  async health(): Promise<{ ok: boolean; version: string }> {
    return json(await fetch(`${API_BASE}/v1/health`));
  },
  async context(): Promise<Context> {
    const d = await json<Partial<Context>>(await fetch(`${API_BASE}/v1/context`));
    return {
      services: d.services ?? [],
      activeServiceId: d.activeServiceId ?? null,
      companyData: d.companyData ?? null,
      canManageDocuments: d.canManageDocuments !== false,
    };
  },
  async printers(): Promise<Printer[]> {
    const d = await json<{ printers: Printer[] }>(await fetch(`${API_BASE}/v1/printers`));
    return d.printers ?? [];
  },
  async settings(serviceId: string): Promise<{ preferred_printer_name?: string }> {
    return json(await fetch(`${API_BASE}/v1/settings?service_id=${encodeURIComponent(serviceId)}`));
  },
  async saveSettings(serviceId: string, preferred_printer_name: string): Promise<void> {
    await json(await fetch(`${API_BASE}/v1/settings?service_id=${encodeURIComponent(serviceId)}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ preferred_printer_name }) }));
  },
  async activity(): Promise<ActivityEntry[]> {
    const d = await json<{ entries: ActivityEntry[] }>(await fetch(`${API_BASE}/v1/activity`));
    return d.entries ?? [];
  },
  async recent(serviceId: string, docType: DocType): Promise<{ items: { id: string; label: string; data: DocumentData }[]; online: boolean }> {
    return json(await fetch(`${API_BASE}/v2/recent?service_id=${encodeURIComponent(serviceId)}&doc_type=${docType}`));
  },
  async documents(serviceId: string): Promise<LoadedDocuments> {
    return json(await fetch(`${API_BASE}/v2/documents?service_id=${encodeURIComponent(serviceId)}`));
  },
  async saveDocuments(serviceId: string, documents: DocumentsV2, ifVersion?: number): Promise<{ ok: true; version: number; updated_at: string | null; documents: DocumentsV2; savedTo: "supabase" | "local" }> {
    return json(await fetch(`${API_BASE}/v2/documents?service_id=${encodeURIComponent(serviceId)}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ documents, ifVersion }) }));
  },
  async pdf(body: { service_id: string; doc_type: DocType; sample?: SampleKind; data?: DocumentData; documents?: DocumentsV2 }): Promise<Blob> {
    const res = await fetch(`${API_BASE}/v2/pdf`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    if (!res.ok) throw new Error(((await res.json().catch(() => ({}))) as { error?: string }).error || res.statusText);
    return res.blob();
  },
  async print(body: { service_id: string; doc_type: DocType; sample?: SampleKind; data?: DocumentData; documents?: DocumentsV2; printer?: string }): Promise<{ ok: boolean; printer?: string }> {
    return json(await fetch(`${API_BASE}/v2/print`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }));
  },
  async exportPdf(body: { service_id: string; doc_type: DocType; sample?: SampleKind; data?: DocumentData; documents?: DocumentsV2; target_path: string }): Promise<{ ok: boolean; path: string }> {
    return json(await fetch(`${API_BASE}/v2/export`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }));
  },
};

/** Bridge z preloadu (Electron). Ve vývoji v prohlížeči chybí. */
export type ElectronBridge = {
  showSaveDialog: (defaultName: string) => Promise<string | null>;
  openPrintDialog: (html: string) => Promise<void>;
  update: {
    check: () => Promise<string | null>;
    getState: () => Promise<{ version: string; downloaded: boolean; progress: number } | null>;
    getError: () => Promise<string | null>;
    download: () => Promise<boolean>;
    quitAndInstall: () => Promise<void>;
    getChannel: () => Promise<"stable" | "beta">;
    setChannel: (channel: "stable" | "beta") => Promise<"stable" | "beta">;
    onState: (cb: (s: { version: string; downloaded: boolean; progress: number } | null) => void) => () => void;
    onError: (cb: (e: string | null) => void) => () => void;
  };
};

export function electron(): ElectronBridge | null {
  return (window as unknown as { electron?: ElectronBridge }).electron ?? null;
}
