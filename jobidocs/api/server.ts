import Fastify from "fastify";
import cors from "@fastify/cors";
import path from "path";
import fs from "fs/promises";
import { listPrinters } from "./printers.js";
import { getSettings, putSettings, setSettingsPath } from "./settings.js";
import { getProfile, putProfile, setProfilesPath } from "./profiles.js";
import { getDocumentsConfig, putDocumentsConfig, setDocumentsConfigPath } from "./documentsConfig.js";
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
} = {
  services: [],
  activeServiceId: null,
  documentsConfig: null,
  companyData: null,
  jobidocsLogo: null,
};

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
    };
  }>("/v1/context", async (req) => {
    const body = req.body || {};
    if (Array.isArray(body.services)) jobiContext.services = body.services;
    if (body.activeServiceId !== undefined) jobiContext.activeServiceId = body.activeServiceId ?? null;
    if (body.documentsConfig !== undefined) jobiContext.documentsConfig = body.documentsConfig ?? null;
    if (body.companyData !== undefined) jobiContext.companyData = body.companyData ?? null;
    if (body.jobidocsLogo !== undefined) jobiContext.jobidocsLogo = body.jobidocsLogo ?? null;
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

  // Documents config (full config per service) – lokálně
  fastify.get<{
    Querystring: { service_id: string };
  }>("/v1/documents-config", async (req, reply) => {
    const serviceId = req.query?.service_id;
    if (!serviceId) {
      return reply.status(400).send({ error: "service_id required" });
    }
    const result = await getDocumentsConfig(serviceId);
    return result ?? { config: null, version: 0 };
  });

  fastify.put<{
    Querystring: { service_id: string };
    Body: { config?: unknown };
  }>("/v1/documents-config", async (req, reply) => {
    const serviceId = req.query?.service_id;
    if (!serviceId) {
      return reply.status(400).send({ error: "service_id required" });
    }
    const { config } = req.body || {};
    const result = await putDocumentsConfig(serviceId, config);
    return result;
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

  // Render HTML to PDF (returns base64)
  fastify.post<{ Body: { html: string } }>("/v1/render", async (req, reply) => {
    if (!htmlToPdf) {
      return reply.status(503).send({ error: "PDF rendering requires JobiDocs (Electron)" });
    }
    const { html } = req.body || {};
    if (!html || typeof html !== "string") {
      return reply.status(400).send({ error: "html required" });
    }
    const PDF_TIMEOUT_MS = 60000;
    try {
      let timeoutId: ReturnType<typeof setTimeout>;
      const pdfBuffer = await Promise.race([
        htmlToPdf(html).finally(() => clearTimeout(timeoutId!)),
        new Promise<never>((_, reject) => {
          timeoutId = setTimeout(
            () => reject(new Error("PDF render timeout")),
            PDF_TIMEOUT_MS
          );
        }),
      ]);
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
  };
  fastify.post<{ Body: PrintDocumentBody }>("/v1/print-document", async (req, reply) => {
    if (!htmlToPdf) {
      return reply.status(503).send({ error: "PDF rendering requires JobiDocs (Electron)" });
    }
    const { doc_type, service_id, company_data, sections, repair_date } = req.body || {};
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
      const options = repair_date && typeof repair_date === "string" ? { repairDate: repair_date } : undefined;
      const html = generateDocumentHtml(config, doc_type, companyData, sections ?? undefined, options);
      fastify.log.info("[print-document] html length=%d", html.length);
      const PDF_TIMEOUT_MS = 60000;
      let timeoutId: ReturnType<typeof setTimeout>;
      const pdfBuffer = await Promise.race([
        htmlToPdf(html).finally(() => clearTimeout(timeoutId!)),
        new Promise<never>((_, reject) => {
          timeoutId = setTimeout(() => reject(new Error("PDF render timeout")), PDF_TIMEOUT_MS);
        }),
      ]);
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

  // Export: render HTML to PDF, save to path
  fastify.post<{
    Body: { html: string; target_path: string };
  }>("/v1/export", async (req, reply) => {
    if (!htmlToPdf) {
      return reply.status(503).send({ error: "PDF rendering requires JobiDocs (Electron)" });
    }
    const { html, target_path } = req.body || {};
    if (!html || typeof html !== "string") {
      return reply.status(400).send({ error: "html required" });
    }
    if (!target_path || typeof target_path !== "string") {
      return reply.status(400).send({ error: "target_path required" });
    }
    const PDF_TIMEOUT_MS = 60000;
    try {
      let timeoutId: ReturnType<typeof setTimeout>;
      const pdfBuffer = await Promise.race([
        htmlToPdf(html).finally(() => clearTimeout(timeoutId!)),
        new Promise<never>((_, reject) => {
          timeoutId = setTimeout(() => reject(new Error("PDF render timeout")), PDF_TIMEOUT_MS);
        }),
      ]);
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
