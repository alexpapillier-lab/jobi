import Fastify from "fastify";
import cors from "@fastify/cors";
import path from "path";
import fs from "fs/promises";
import { listPrinters } from "./printers.js";
import { getSettings, putSettings, setSettingsPath } from "./settings.js";
import { getProfile, putProfile, setProfilesPath } from "./profiles.js";
import { getDocumentsConfig, putDocumentsConfig, setDocumentsConfigPath } from "./documentsConfig.js";
import { saveDocumentsConfigToSupabase, loadDocumentsConfigFromSupabase, migrateConfigAssetsToStorage } from "./supabaseSync.js";
import { printPdf } from "./print.js";
import { generateDocumentHtml } from "../src/documentToHtml.js";

const PORT = 3847;
const HOST = "127.0.0.1";

async function getAppVersion(): Promise<string> {
  try {
    const pkgPath = path.join(process.cwd(), "package.json");
    const pkg = JSON.parse(await fs.readFile(pkgPath, "utf-8")) as { version?: string };
    return pkg.version ?? "0.0.0";
  } catch {
    return "0.0.0";
  }
}

type ActivityEntry = { ts: string; action: "print" | "export"; status: "ok" | "error" | "pending"; detail?: string };
const activityLog: ActivityEntry[] = [];
const MAX_ACTIVITY = 20;

type ServiceEntry = { service_id: string; service_name: string; role: string };
type CompanyData = Record<string, unknown>;
type DocumentsConfig = Record<string, unknown>;
type JobiDocsLogoColors = { background: string; jInner: string; foreground: string };
let jobiContext: {
  services: ServiceEntry[];
  activeServiceId: string | null;
  documentsConfig?: DocumentsConfig | null;
  companyData?: CompanyData | null;
  jobidocsLogo?: JobiDocsLogoColors | null;
  /** Má uživatel oprávnění měnit nastavení dokumentů (z Jobi). Když false, JobiDocs zobrazí customizaci jako read-only. */
  canManageDocuments?: boolean;
} = {
  services: [],
  activeServiceId: null,
  documentsConfig: null,
  companyData: null,
  jobidocsLogo: null,
  canManageDocuments: true,
};

/** Supabase auth z Jobi – pro zápis document config do DB. Neposíláme do GET /v1/context. */
let supabaseAuth: {
  supabaseUrl: string;
  supabaseAnonKey: string;
  supabaseAccessToken: string | null;
} | null = null;

function pushActivity(action: "print" | "export", status: "ok" | "error" | "pending", detail?: string) {
  activityLog.unshift({ ts: new Date().toISOString(), action, status, detail });
  if (activityLog.length > MAX_ACTIVITY) activityLog.pop();
}

type StartOptions = { htmlToPdf?: (html: string) => Promise<Buffer> };

export async function startApiServer(
  port: number = PORT,
  userDataPath?: string,
  options?: StartOptions
) {
  const htmlToPdf = options?.htmlToPdf;
  const fastify = Fastify({ logger: true, bodyLimit: 10 * 1024 * 1024 });

  fastify.addHook("onRequest", async (request, _reply) => {
    const p = request.url?.split("?")[0];
    if (request.method === "POST" && p === "/v1/print") {
      pushActivity("print", "pending", "zpracovává se…");
    } else if (request.method === "POST" && p === "/v1/export") {
      pushActivity("export", "pending", "zpracovává se…");
    }
  });

  await fastify.register(cors, {
    origin: true, // allow Jobi (Tauri webview: tauri://localhost, asset://localhost) + dev
  });

  // Init paths (Electron provides userData, fallback to cwd)
  const baseDir = userDataPath || path.join(process.cwd(), ".jobidocs-data");
  setSettingsPath(baseDir);
  setProfilesPath(baseDir);
  setDocumentsConfigPath(baseDir);

  // Activity log (pro UI – co Jobi posílá)
  fastify.get("/v1/activity", async () => {
    return { entries: [...activityLog] };
  });

  // Context from Jobi (services + activeServiceId)
  fastify.get("/v1/context", async () => {
    return jobiContext;
  });

  fastify.put<{
    Body: {
      services?: ServiceEntry[];
      activeServiceId?: string | null;
      documentsConfig?: DocumentsConfig | null;
      companyData?: CompanyData | null;
      jobidocsLogo?: JobiDocsLogoColors | null;
      canManageDocuments?: boolean;
      supabaseUrl?: string;
      supabaseAnonKey?: string;
      supabaseAccessToken?: string | null;
    };
  }>("/v1/context", async (req) => {
    const body = req.body || {};
    if (Array.isArray(body.services)) jobiContext.services = body.services;
    if (body.activeServiceId !== undefined) jobiContext.activeServiceId = body.activeServiceId ?? null;
    if (body.documentsConfig !== undefined) jobiContext.documentsConfig = body.documentsConfig ?? null;
    if (body.companyData !== undefined) jobiContext.companyData = body.companyData ?? null;
    if (body.jobidocsLogo !== undefined) jobiContext.jobidocsLogo = body.jobidocsLogo ?? null;
    if (body.canManageDocuments !== undefined) jobiContext.canManageDocuments = body.canManageDocuments;
    if (
      body.supabaseUrl &&
      body.supabaseAnonKey &&
      typeof body.supabaseUrl === "string" &&
      typeof body.supabaseAnonKey === "string"
    ) {
      supabaseAuth = {
        supabaseUrl: body.supabaseUrl,
        supabaseAnonKey: body.supabaseAnonKey,
        supabaseAccessToken: body.supabaseAccessToken ?? null,
      };
    } else {
      supabaseAuth = null;
    }
    return jobiContext;
  });

  // Health check
  fastify.get("/v1/health", async () => {
    const version = await getAppVersion();
    return { ok: true, app: "jobidocs", version };
  });

  // List printers (macOS: lpstat -p)
  fastify.get("/v1/printers", async () => {
    const printers = await listPrinters();
    return { printers };
  });

  // Get settings for service
  fastify.get<{
    Querystring: { service_id: string };
  }>("/v1/settings", async (req, reply) => {
    const serviceId = req.query?.service_id;
    if (!serviceId) {
      return reply.status(400).send({ error: "service_id required" });
    }
    const settings = await getSettings(serviceId);
    return settings;
  });

  // Put settings for service (preferred printer)
  fastify.put<{
    Querystring: { service_id: string };
    Body: { preferred_printer_name?: string };
  }>("/v1/settings", async (req, reply) => {
    const serviceId = req.query?.service_id;
    if (!serviceId) {
      return reply.status(400).send({ error: "service_id required" });
    }
    const updates = req.body || {};
    const settings = await putSettings(serviceId, {
      preferred_printer_name: updates.preferred_printer_name,
    });
    return settings;
  });

  // Documents config (full config per service) – z DB když máme auth, jinak lokálně
  fastify.get<{
    Querystring: { service_id: string };
  }>("/v1/documents-config", async (req, reply) => {
    const serviceId = req.query?.service_id;
    if (!serviceId) {
      return reply.status(400).send({ error: "service_id required" });
    }
    if (supabaseAuth?.supabaseAccessToken) {
      const fromDb = await loadDocumentsConfigFromSupabase(
        serviceId,
        supabaseAuth.supabaseUrl,
        supabaseAuth.supabaseAnonKey,
        supabaseAuth.supabaseAccessToken
      );
      if (fromDb) {
        return { config: fromDb.config, version: fromDb.version, updated_at: fromDb.updated_at ?? null };
      }
    }
    const result = await getDocumentsConfig(serviceId);
    const out = result ?? { config: null, version: 0 };
    return { config: out.config, version: out.version, updated_at: null };
  });

  fastify.put<{
    Querystring: { service_id: string };
    Body: { config?: unknown };
  }>("/v1/documents-config", async (req, reply) => {
    if (jobiContext.canManageDocuments === false) {
      return reply.status(403).send({ error: "Nemáte oprávnění měnit nastavení dokumentů." });
    }
    const serviceId = req.query?.service_id;
    if (!serviceId) {
      return reply.status(400).send({ error: "service_id required" });
    }
    let config = req.body?.config as unknown;
    if (supabaseAuth?.supabaseAccessToken && config && typeof config === "object" && !Array.isArray(config)) {
      try {
        config = await migrateConfigAssetsToStorage(
          serviceId,
          config as Record<string, unknown>,
          supabaseAuth.supabaseUrl,
          supabaseAuth.supabaseAnonKey,
          supabaseAuth.supabaseAccessToken
        );
      } catch (e) {
        fastify.log.warn({ serviceId, err: e }, "Asset migration to storage failed, saving as-is");
      }
    }
    const configToSave = config ?? {};
    const result = await putDocumentsConfig(serviceId, configToSave);
    let updated_at: string | null = null;
    let version = result.version;
    if (supabaseAuth?.supabaseAccessToken) {
      const sync = await saveDocumentsConfigToSupabase(
        serviceId,
        configToSave,
        supabaseAuth.supabaseUrl,
        supabaseAuth.supabaseAnonKey,
        supabaseAuth.supabaseAccessToken
      );
      if (!sync.ok && sync.error) {
        fastify.log.warn({ serviceId, error: sync.error }, "Supabase sync failed");
      } else if (sync.updated_at) {
        updated_at = sync.updated_at;
        if (typeof sync.version === "number") version = sync.version;
      }
    }
    return { ...result, updated_at, version };
  });

  // Profiles (per-service per-doc-type) – lokálně, později Supabase
  fastify.get<{
    Querystring: { service_id: string; doc_type: string };
  }>("/v1/profiles", async (req, reply) => {
    const serviceId = req.query?.service_id;
    const docType = req.query?.doc_type;
    if (!serviceId || !docType) {
      return reply.status(400).send({ error: "service_id and doc_type required" });
    }
    const valid = ["zakazkovy_list", "zarucni_list", "diagnosticky_protokol"];
    if (!valid.includes(docType)) {
      return reply.status(400).send({ error: "doc_type must be zakazkovy_list, zarucni_list or diagnosticky_protokol" });
    }
    const profile = await getProfile(serviceId, docType);
    return profile ?? { profile_json: null, version: 0 };
  });

  fastify.put<{
    Querystring: { service_id: string; doc_type: string };
    Body: { profile_json?: unknown };
  }>("/v1/profiles", async (req, reply) => {
    const serviceId = req.query?.service_id;
    const docType = req.query?.doc_type;
    if (!serviceId || !docType) {
      return reply.status(400).send({ error: "service_id and doc_type required" });
    }
    const valid = ["zakazkovy_list", "zarucni_list", "diagnosticky_protokol"];
    if (!valid.includes(docType)) {
      return reply.status(400).send({ error: "doc_type must be zakazkovy_list, zarucni_list or diagnosticky_protokol" });
    }
    const { profile_json } = req.body || {};
    const result = await putProfile(serviceId, docType, profile_json);
    return result;
  });

  async function mergeLetterheadIfNeeded(
    contentBuffer: Buffer,
    letterheadPdfUrl: string | undefined
  ): Promise<Buffer> {
    if (!letterheadPdfUrl || typeof letterheadPdfUrl !== "string" || !letterheadPdfUrl.trim())
      return contentBuffer;
    let letterheadBuffer: Buffer | null = null;
    if (letterheadPdfUrl.startsWith("data:application/pdf;base64,")) {
      const b64 = letterheadPdfUrl.replace(/^data:application\/pdf;base64,/, "");
      letterheadBuffer = Buffer.from(b64, "base64");
    } else if (letterheadPdfUrl.startsWith("http://") || letterheadPdfUrl.startsWith("https://")) {
      const res = await fetch(letterheadPdfUrl);
      if (!res.ok) return contentBuffer;
      const ab = await res.arrayBuffer();
      letterheadBuffer = Buffer.from(ab);
    }
    if (!letterheadBuffer) return contentBuffer;
    const { PDFDocument } = await import("pdf-lib");
    const letterheadPdf = await PDFDocument.load(letterheadBuffer);
    const contentPdf = await PDFDocument.load(contentBuffer);
    if (letterheadPdf.getPageCount() === 0 || contentPdf.getPageCount() === 0) return contentBuffer;
    const mergedPdf = await PDFDocument.create();
    const [letterheadPage] = await mergedPdf.copyPages(letterheadPdf, [0]);
    mergedPdf.addPage(letterheadPage);
    const [contentPageRef] = await mergedPdf.embedPdf(contentPdf);
    if (contentPageRef) mergedPdf.getPage(0).drawPage(contentPageRef, { x: 0, y: 0 });
    return Buffer.from(await mergedPdf.save());
  }

  // Render HTML to PDF (returns base64). Optional letterhead_pdf_url: merge content on top of first page.
  fastify.post<{ Body: { html: string; letterhead_pdf_url?: string } }>("/v1/render", async (req, reply) => {
    if (!htmlToPdf) {
      return reply.status(503).send({ error: "PDF rendering requires JobiDocs (Electron)" });
    }
    const { html, letterhead_pdf_url } = req.body || {};
    if (!html || typeof html !== "string") {
      return reply.status(400).send({ error: "html required" });
    }
    const PDF_TIMEOUT_MS = 60000;
    try {
      let timeoutId: ReturnType<typeof setTimeout>;
      const contentBuffer = await Promise.race([
        htmlToPdf(html).finally(() => clearTimeout(timeoutId!)),
        new Promise<never>((_, reject) => {
          timeoutId = setTimeout(
            () => reject(new Error("PDF render timeout")),
            PDF_TIMEOUT_MS
          );
        }),
      ]);
      let pdfBuffer = contentBuffer;
      pdfBuffer = await mergeLetterheadIfNeeded(pdfBuffer, letterhead_pdf_url);
      return { pdf_base64: pdfBuffer.toString("base64") };
    } catch (err: unknown) {
      fastify.log.error(err);
      const msg = err instanceof Error ? err.message : "Render failed";
      const status = msg === "PDF render timeout" ? 504 : 500;
      return reply.status(status).send({ error: msg });
    }
  });

  // Print using JobiDocs template + data from Jobi (so layout matches JobiDocs design)
  type PrintDocumentBody = {
    doc_type: "zakazkovy_list" | "zarucni_list" | "diagnosticky_protokol";
    service_id: string;
    company_data: Record<string, unknown>;
    sections?: Partial<Record<string, string>>;
    repair_date?: string;
    variables?: Record<string, string>;
  };
  fastify.post<{ Body: PrintDocumentBody }>("/v1/print-document", async (req, reply) => {
    if (!htmlToPdf) {
      return reply.status(503).send({ error: "PDF rendering requires JobiDocs (Electron)" });
    }
    const { doc_type, service_id, company_data, sections, repair_date, variables } = req.body || {};
    if (!doc_type || !service_id || !company_data || typeof company_data !== "object") {
      return reply.status(400).send({ error: "doc_type, service_id and company_data required" });
    }
    const validDocTypes = ["zakazkovy_list", "zarucni_list", "diagnosticky_protokol"];
    if (!validDocTypes.includes(doc_type)) {
      return reply.status(400).send({ error: "doc_type must be zakazkovy_list, zarucni_list or diagnosticky_protokol" });
    }
    try {
      const rawBase = (await getDocumentsConfig(service_id))?.config ?? jobiContext.documentsConfig ?? {};
      const baseConfig = (typeof rawBase === "object" && rawBase !== null ? rawBase : {}) as Record<string, unknown>;
      const profile = await getProfile(service_id, doc_type);
      const profileJson = (profile?.profile_json as Record<string, unknown>) ?? {};
      const sectionKey =
        doc_type === "zakazkovy_list" ? "ticketList" : doc_type === "zarucni_list" ? "warrantyCertificate" : "diagnosticProtocol";
      const existing = (baseConfig[sectionKey] as Record<string, unknown>) || {};
      const config = { ...baseConfig, [sectionKey]: { ...existing, ...profileJson } };
      const companyData = typeof company_data === "object" && company_data !== null ? company_data : {};
      const options: { repairDate?: string; variables?: Record<string, string> } = {};
      if (repair_date && typeof repair_date === "string") options.repairDate = repair_date;
      if (variables && typeof variables === "object" && !Array.isArray(variables)) options.variables = variables;
      const html = generateDocumentHtml(config, doc_type, companyData, sections ?? undefined, Object.keys(options).length ? options : undefined);
      fastify.log.info("[print-document] html length=%d", html.length);
      const PDF_TIMEOUT_MS = 60000;
      let timeoutId: ReturnType<typeof setTimeout>;
      let pdfBuffer = await Promise.race([
        htmlToPdf(html).finally(() => clearTimeout(timeoutId!)),
        new Promise<never>((_, reject) => {
          timeoutId = setTimeout(() => reject(new Error("PDF render timeout")), PDF_TIMEOUT_MS);
        }),
      ]);
      pdfBuffer = await mergeLetterheadIfNeeded(pdfBuffer, config.letterheadPdfUrl as string | undefined);
      let printer = (await getSettings(service_id)).preferred_printer_name;
      fastify.log.info("[print-document] calling lp, printer=%s", printer ?? "default");
      const jobId = await printPdf(pdfBuffer, printer);
      pushActivity("print", "ok", [printer ?? "default", jobId ? `(${jobId})` : ""].filter(Boolean).join(" "));
      return { ok: true, status: "queued", job_id: jobId || undefined };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      pushActivity("print", "error", msg);
      fastify.log.error(err);
      return reply.status(500).send({ error: msg || "Print failed" });
    }
  });

  // Print: render HTML to PDF, send to printer (legacy – raw HTML from Jobi)
  fastify.post<{
    Body: { html: string; printer?: string; service_id?: string };
  }>("/v1/print", async (req, reply) => {
    if (!htmlToPdf) {
      return reply.status(503).send({ error: "PDF rendering requires JobiDocs (Electron)" });
    }
    const { html, printer: explicitPrinter, service_id } = req.body || {};
    if (!html || typeof html !== "string") {
      return reply.status(400).send({ error: "html required" });
    }
    fastify.log.info("[print] start, html length=%d", html.length);
    const PDF_TIMEOUT_MS = 60000;
    try {
      let timeoutId: ReturnType<typeof setTimeout>;
      const pdfBuffer = await Promise.race([
        htmlToPdf(html).finally(() => clearTimeout(timeoutId!)),
        new Promise<never>((_, reject) => {
          timeoutId = setTimeout(() => reject(new Error("PDF render timeout")), PDF_TIMEOUT_MS);
        }),
      ]);
      fastify.log.info("[print] pdf done, size=%d", pdfBuffer.length);
      let printer = explicitPrinter;
      if (!printer && service_id) {
        const settings = await getSettings(service_id);
        printer = settings.preferred_printer_name;
      }
      fastify.log.info("[print] calling lp, printer=%s", printer ?? "default");
      const jobId = await printPdf(pdfBuffer, printer);
      fastify.log.info("[print] lp ok, jobId=%s", jobId);
      const detail = [printer ? printer : "default", jobId ? `(${jobId})` : ""].filter(Boolean).join(" ");
      pushActivity("print", "ok", detail.trim());
      return { ok: true, status: "queued", job_id: jobId || undefined };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      pushActivity("print", "error", msg);
      fastify.log.error(err);
      return reply.status(500).send({
        error: msg || "Print failed",
      });
    }
  });

  // Export: render HTML to PDF, save to path. Optional letterhead_pdf_url for merge.
  fastify.post<{
    Body: { html: string; target_path: string; letterhead_pdf_url?: string };
  }>("/v1/export", async (req, reply) => {
    if (!htmlToPdf) {
      return reply.status(503).send({ error: "PDF rendering requires JobiDocs (Electron)" });
    }
    const { html, target_path, letterhead_pdf_url } = req.body || {};
    if (!html || typeof html !== "string") {
      return reply.status(400).send({ error: "html required" });
    }
    if (!target_path || typeof target_path !== "string") {
      return reply.status(400).send({ error: "target_path required" });
    }
    const PDF_TIMEOUT_MS = 60000;
    try {
      let timeoutId: ReturnType<typeof setTimeout>;
      let pdfBuffer = await Promise.race([
        htmlToPdf(html).finally(() => clearTimeout(timeoutId!)),
        new Promise<never>((_, reject) => {
          timeoutId = setTimeout(() => reject(new Error("PDF render timeout")), PDF_TIMEOUT_MS);
        }),
      ]);
      pdfBuffer = await mergeLetterheadIfNeeded(pdfBuffer, letterhead_pdf_url);
      await fs.writeFile(target_path, pdfBuffer);
      pushActivity("export", "ok", target_path);
      return { ok: true, path: target_path };
    } catch (err: unknown) {
      pushActivity("export", "error", err instanceof Error ? err.message : String(err));
      fastify.log.error(err);
      return reply.status(500).send({
        error: err instanceof Error ? err.message : "Export failed",
      });
    }
  });

  try {
    await fastify.listen({ port, host: HOST });
    return { fastify, port };
  } catch (err) {
    fastify.log.error(err);
    throw err;
  }
}
