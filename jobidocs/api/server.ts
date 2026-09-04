/**
 * Lokální API JobiDocs (127.0.0.1:3847).
 *
 * Tisk, export a náhled jdou přes jádro (core/): šablona servisu + data
 * → HTML → PDF v Chromiu → tiskárna / soubor. Editor i Jobi používají
 * stejnou cestu, takže neexistuje „jiný“ tisk než ten, co je vidět v náhledu.
 *
 * v1 endpointy zůstávají kvůli starším verzím Jobi; jejich `variables` se
 * převedou na DocumentData adaptérem.
 */
import Fastify, { type FastifyReply } from "fastify";
import cors from "@fastify/cors";
import path from "path";
import fs from "fs/promises";
import { listPrinters } from "./printers.js";
import { getSettings, putSettings, setSettingsPath } from "./settings.js";
import { setProfilesPath } from "./profiles.js";
import { setDocumentsConfigPath } from "./documentsConfig.js";
import { printPdf } from "./print.js";
import { loadDocuments, saveDocuments, type SupabaseAuth } from "./documentsStore.js";
import { loadRecent } from "./recent.js";
import {
  DOC_TYPES,
  renderDocument,
  sampleData,
  serviceFromCompanyData,
  templateFor,
  variablesToDocumentData,
  normalizeDocuments,
  type DocType,
  type DocumentData,
  type DocumentsV2,
  type SampleKind,
} from "../core/index.js";

const PORT = 3847;
const HOST = "127.0.0.1";
const PDF_TIMEOUT_MS = 60000;

type ActivityEntry = { ts: string; action: "print" | "export"; status: "ok" | "error" | "pending"; detail?: string };
const activityLog: ActivityEntry[] = [];
const MAX_ACTIVITY = 50;

type ServiceEntry = { service_id: string; service_name: string; role: string };
type Rec = Record<string, unknown>;
type JobiDocsLogoColors = { background: string; jInner: string; foreground: string };

const jobiContext: {
  services: ServiceEntry[];
  activeServiceId: string | null;
  documentsConfig?: Rec | null;
  companyData?: Rec | null;
  jobidocsLogo?: JobiDocsLogoColors | null;
  canManageDocuments?: boolean;
} = {
  services: [],
  activeServiceId: null,
  documentsConfig: null,
  companyData: null,
  jobidocsLogo: null,
  canManageDocuments: true,
};

/** Přihlášení z Jobi – jen pro zápis/čtení šablon v Supabase. Nikdy se nevrací v GET /v1/context. */
let supabaseAuth: SupabaseAuth | null = null;

function pushActivity(action: "print" | "export", status: "ok" | "error" | "pending", detail?: string) {
  activityLog.unshift({ ts: new Date().toISOString(), action, status, detail });
  if (activityLog.length > MAX_ACTIVITY) activityLog.pop();
}

type PrinterInfo = { name: string; status: string; available: boolean };

export type StartOptions = {
  htmlToPdf?: (html: string) => Promise<Buffer>;
  /** Nativní tisk pro platformy bez CUPS (Windows). Bez něj se použije lp. */
  printPdfNative?: (pdf: Buffer, printerName?: string) => Promise<string>;
  listPrintersNative?: () => Promise<PrinterInfo[]>;
  appVersion?: string;
};

function isDocType(v: unknown): v is DocType {
  return typeof v === "string" && (DOC_TYPES as string[]).includes(v);
}

function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  let t: ReturnType<typeof setTimeout>;
  return Promise.race([
    p.finally(() => clearTimeout(t)),
    new Promise<never>((_, reject) => {
      t = setTimeout(() => reject(new Error(label)), ms);
    }),
  ]);
}

/** Hlavičkový papír pod každou stranu obsahu. */
async function mergeLetterhead(content: Buffer, letterheadUrl: string | undefined): Promise<Buffer> {
  if (!letterheadUrl || !letterheadUrl.trim()) return content;
  let letterhead: Buffer | null = null;
  if (letterheadUrl.startsWith("data:application/pdf;base64,")) {
    letterhead = Buffer.from(letterheadUrl.replace(/^data:application\/pdf;base64,/, ""), "base64");
  } else if (/^https?:\/\//.test(letterheadUrl)) {
    const res = await fetch(letterheadUrl);
    if (!res.ok) return content;
    letterhead = Buffer.from(await res.arrayBuffer());
  }
  if (!letterhead) return content;
  const { PDFDocument } = await import("pdf-lib");
  const lh = await PDFDocument.load(letterhead);
  const doc = await PDFDocument.load(content);
  if (lh.getPageCount() === 0 || doc.getPageCount() === 0) return content;
  const out = await PDFDocument.create();
  const embedded = await out.embedPdf(doc, doc.getPageIndices());
  for (let i = 0; i < doc.getPageCount(); i++) {
    const [bg] = await out.copyPages(lh, [Math.min(i, lh.getPageCount() - 1)]);
    const page = out.addPage(bg);
    const emb = embedded[i];
    if (emb) page.drawPage(emb, { x: 0, y: 0, width: page.getWidth(), height: page.getHeight() });
  }
  return Buffer.from(await out.save());
}

function normalizeData(raw: unknown): DocumentData {
  const d = (raw && typeof raw === "object" ? raw : {}) as Partial<DocumentData>;
  return { ...d, service: { ...(d.service ?? {}) } };
}

export async function startApiServer(port: number = PORT, userDataPath?: string, options?: StartOptions) {
  const htmlToPdf = options?.htmlToPdf;
  const printPdfFn = options?.printPdfNative ?? printPdf;
  const listPrintersFn = options?.listPrintersNative ?? listPrinters;
  const appVersion = options?.appVersion ?? "dev";
  const fastify = Fastify({ logger: true, bodyLimit: 50 * 1024 * 1024 });

  fastify.addHook("onRequest", async (request) => {
    const p = request.url?.split("?")[0] ?? "";
    if (request.method !== "POST") return;
    if (p === "/v1/print" || p === "/v1/print-document" || p === "/v2/print") pushActivity("print", "pending", "zpracovává se…");
    else if (p === "/v1/export" || p === "/v1/export-document" || p === "/v2/export") pushActivity("export", "pending", "zpracovává se…");
  });

  await fastify.register(cors, { origin: true });

  const baseDir = userDataPath || path.join(process.cwd(), ".jobidocs-data");
  setSettingsPath(baseDir);
  setProfilesPath(baseDir);
  setDocumentsConfigPath(baseDir);

  // Poslední kontext z Jobi přežije restart JobiDocs. Jobi ho posílá z webview,
  // které macOS na pozadí uspává, takže po restartu by JobiDocs mohl dlouho
  // čekat na první PUT. Token má omezenou platnost; Jobi ho obnoví, jakmile běží.
  const contextPath = path.join(baseDir, "last-context.json");
  try {
    const raw = JSON.parse(await fs.readFile(contextPath, "utf-8")) as { context?: typeof jobiContext; auth?: SupabaseAuth | null; savedAt?: string };
    if (raw?.context && Array.isArray(raw.context.services)) {
      Object.assign(jobiContext, raw.context);
      supabaseAuth = raw.auth ?? null;
      fastify.log.info("[context] obnoven z disku (%s)", raw.savedAt ?? "?");
    }
  } catch {
    // první spuštění nebo poškozený soubor – počkáme na Jobi
  }
  let contextSaveTimer: ReturnType<typeof setTimeout> | null = null;
  function persistContext() {
    if (contextSaveTimer) clearTimeout(contextSaveTimer);
    contextSaveTimer = setTimeout(() => {
      fs.mkdir(baseDir, { recursive: true })
        .then(() => fs.writeFile(contextPath, JSON.stringify({ context: jobiContext, auth: supabaseAuth, savedAt: new Date().toISOString() }), "utf-8"))
        .catch((e) => fastify.log.warn({ err: e }, "[context] uložení selhalo"));
    }, 1000);
  }

  // -------------------------------------------------------------------------
  // Společná cesta: šablona + data → HTML → PDF
  // -------------------------------------------------------------------------

  type RenderRequest = {
    serviceId: string;
    docType: DocType;
    data?: DocumentData;
    sample?: SampleKind;
    /** Neuložený návrh z editoru – náhled má odpovídat tomu, co uživatel právě vidí. */
    documents?: DocumentsV2;
    mode?: "print" | "editor";
    showPlaceholders?: boolean;
  };

  async function resolveDocuments(serviceId: string, override?: DocumentsV2) {
    if (override) return { documents: normalizeDocuments(override), source: "draft" as const };
    const loaded = await loadDocuments(serviceId, supabaseAuth, jobiContext.documentsConfig);
    return { documents: loaded.documents, source: loaded.source };
  }

  async function buildHtml(req: RenderRequest): Promise<string> {
    const { documents } = await resolveDocuments(req.serviceId, req.documents);
    const template = templateFor(documents, req.docType);
    const contextService = serviceFromCompanyData(jobiContext.companyData);
    let data: DocumentData;
    if (req.sample) {
      data = sampleData(req.docType, req.sample, contextService);
    } else {
      data = normalizeData(req.data);
      data.service = { ...contextService, ...Object.fromEntries(Object.entries(data.service).filter(([, v]) => v != null && v !== "")) };
    }
    return renderDocument({ template, data, brand: documents.brand, theme: documents.theme, options: { mode: req.mode ?? "print", showPlaceholders: req.showPlaceholders } });
  }

  async function buildPdf(req: RenderRequest): Promise<Buffer> {
    if (!htmlToPdf) throw Object.assign(new Error("PDF rendering requires JobiDocs (Electron)"), { statusCode: 503 });
    const { documents } = await resolveDocuments(req.serviceId, req.documents);
    const html = await buildHtml({ ...req, mode: "print", showPlaceholders: false });
    const pdf = await withTimeout(htmlToPdf(html), PDF_TIMEOUT_MS, "PDF render timeout");
    return mergeLetterhead(pdf, documents.brand.letterheadPdfUrl);
  }

  async function printBuffer(serviceId: string, pdf: Buffer, explicitPrinter?: string): Promise<{ printer: string; jobId: string }> {
    const printer = explicitPrinter || (await getSettings(serviceId)).preferred_printer_name;
    const jobId = await printPdfFn(pdf, printer);
    return { printer: printer ?? "default", jobId };
  }

  function sendError(reply: FastifyReply, err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    const status = (err as { statusCode?: number })?.statusCode ?? (msg === "PDF render timeout" ? 504 : 500);
    fastify.log.error(err);
    return reply.status(status).send({ error: msg || "Failed" });
  }

  // -------------------------------------------------------------------------
  // Základ
  // -------------------------------------------------------------------------

  fastify.get("/v1/health", async () => ({ ok: true, app: "jobidocs", version: appVersion, api: 2 }));
  fastify.get("/v1/activity", async () => ({ entries: [...activityLog] }));
  fastify.get("/v1/context", async () => jobiContext);

  fastify.put<{
    Body: {
      services?: ServiceEntry[];
      activeServiceId?: string | null;
      documentsConfig?: Rec | null;
      companyData?: Rec | null;
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
    if (typeof body.supabaseUrl === "string" && typeof body.supabaseAnonKey === "string" && body.supabaseUrl && body.supabaseAnonKey) {
      supabaseAuth = { supabaseUrl: body.supabaseUrl, supabaseAnonKey: body.supabaseAnonKey, supabaseAccessToken: body.supabaseAccessToken ?? null };
    } else if (body.supabaseUrl !== undefined || body.supabaseAnonKey !== undefined) {
      supabaseAuth = null;
    }
    persistContext();
    return jobiContext;
  });

  fastify.get("/v1/printers", async () => ({ printers: await listPrintersFn() }));

  fastify.get<{ Querystring: { service_id: string } }>("/v1/settings", async (req, reply) => {
    const serviceId = req.query?.service_id;
    if (!serviceId) return reply.status(400).send({ error: "service_id required" });
    return getSettings(serviceId);
  });

  fastify.put<{ Querystring: { service_id: string }; Body: { preferred_printer_name?: string } }>("/v1/settings", async (req, reply) => {
    const serviceId = req.query?.service_id;
    if (!serviceId) return reply.status(400).send({ error: "service_id required" });
    return putSettings(serviceId, { preferred_printer_name: req.body?.preferred_printer_name });
  });

  // Starší Jobi si přes /v1/profiles doplňovalo šablonu pro tisk z prohlížeče. Už není co doplňovat.
  fastify.get("/v1/profiles", async () => ({ profile_json: null, version: 0 }));

  // -------------------------------------------------------------------------
  // v2: šablony
  // -------------------------------------------------------------------------

  fastify.get<{ Querystring: { service_id: string } }>("/v2/documents", async (req, reply) => {
    const serviceId = req.query?.service_id;
    if (!serviceId) return reply.status(400).send({ error: "service_id required" });
    const loaded = await loadDocuments(serviceId, supabaseAuth, jobiContext.documentsConfig);
    return { ...loaded, canManage: jobiContext.canManageDocuments !== false, online: !!supabaseAuth?.supabaseAccessToken };
  });

  fastify.put<{ Querystring: { service_id: string }; Body: { documents: DocumentsV2; ifVersion?: number } }>("/v2/documents", async (req, reply) => {
    const serviceId = req.query?.service_id;
    if (!serviceId) return reply.status(400).send({ error: "service_id required" });
    if (jobiContext.canManageDocuments === false) return reply.status(403).send({ error: "Nemáte oprávnění měnit nastavení dokumentů." });
    const docs = req.body?.documents;
    if (!docs || typeof docs !== "object") return reply.status(400).send({ error: "documents required" });
    const result = await saveDocuments(serviceId, docs, req.body?.ifVersion, supabaseAuth);
    if (!result.ok && "conflict" in result && result.conflict) return reply.status(409).send({ error: "Šablonu mezitím změnil někdo jiný.", version: result.version, updated_at: result.updated_at });
    if (!result.ok) return reply.status(500).send({ error: (result as { error: string }).error });
    return result;
  });

  // Poslední skutečné zakázky / reklamace / faktury pro náhled v editoru.
  fastify.get<{ Querystring: { service_id: string; doc_type: string } }>("/v2/recent", async (req, reply) => {
    const serviceId = req.query?.service_id;
    if (!serviceId) return reply.status(400).send({ error: "service_id required" });
    if (!isDocType(req.query?.doc_type)) return reply.status(400).send({ error: "doc_type invalid" });
    if (!supabaseAuth?.supabaseAccessToken) return { items: [], online: false };
    const items = await loadRecent(serviceId, req.query.doc_type, serviceFromCompanyData(jobiContext.companyData), supabaseAuth);
    return { items, online: true };
  });

  // -------------------------------------------------------------------------
  // v2: náhled, PDF, tisk, export
  // -------------------------------------------------------------------------

  type V2Body = {
    service_id?: string;
    doc_type?: string;
    data?: DocumentData;
    sample?: SampleKind;
    documents?: DocumentsV2;
    mode?: "print" | "editor";
    show_placeholders?: boolean;
    printer?: string;
    target_path?: string;
  };

  function parseV2(body: V2Body | undefined, reply: FastifyReply): RenderRequest | null {
    const serviceId = body?.service_id || jobiContext.activeServiceId || "";
    if (!serviceId) {
      reply.status(400).send({ error: "service_id required" });
      return null;
    }
    if (!isDocType(body?.doc_type)) {
      reply.status(400).send({ error: `doc_type must be one of ${DOC_TYPES.join(", ")}` });
      return null;
    }
    return {
      serviceId,
      docType: body!.doc_type as DocType,
      data: body?.data,
      sample: body?.sample,
      documents: body?.documents,
      mode: body?.mode,
      showPlaceholders: body?.show_placeholders,
    };
  }

  fastify.post<{ Body: V2Body }>("/v2/html", async (req, reply) => {
    const r = parseV2(req.body, reply);
    if (!r) return;
    try {
      return reply.type("text/html; charset=utf-8").send(await buildHtml(r));
    } catch (err) {
      return sendError(reply, err);
    }
  });

  fastify.post<{ Body: V2Body }>("/v2/pdf", async (req, reply) => {
    const r = parseV2(req.body, reply);
    if (!r) return;
    try {
      return reply.type("application/pdf").send(await buildPdf(r));
    } catch (err) {
      return sendError(reply, err);
    }
  });

  fastify.post<{ Body: V2Body }>("/v2/print", async (req, reply) => {
    const r = parseV2(req.body, reply);
    if (!r) return;
    try {
      const pdf = await buildPdf(r);
      const { printer, jobId } = await printBuffer(r.serviceId, pdf, req.body?.printer);
      pushActivity("print", "ok", [printer, jobId ? `(${jobId})` : ""].filter(Boolean).join(" "));
      return { ok: true, status: "queued", job_id: jobId || undefined, printer };
    } catch (err) {
      pushActivity("print", "error", err instanceof Error ? err.message : String(err));
      return sendError(reply, err);
    }
  });

  fastify.post<{ Body: V2Body }>("/v2/export", async (req, reply) => {
    const r = parseV2(req.body, reply);
    if (!r) return;
    const target = req.body?.target_path;
    if (!target || typeof target !== "string") return reply.status(400).send({ error: "target_path required" });
    try {
      const pdf = await buildPdf(r);
      await fs.writeFile(target, pdf);
      pushActivity("export", "ok", target);
      return { ok: true, path: target };
    } catch (err) {
      pushActivity("export", "error", err instanceof Error ? err.message : String(err));
      return sendError(reply, err);
    }
  });

  // -------------------------------------------------------------------------
  // v1: kompatibilita se starším Jobi
  // -------------------------------------------------------------------------

  type PrintDocumentBody = {
    doc_type: string;
    service_id: string;
    company_data: Rec;
    sections?: Partial<Record<string, string>>;
    repair_date?: string;
    variables?: Record<string, string>;
    target_path?: string;
  };

  function parseV1(body: PrintDocumentBody | undefined, reply: FastifyReply): RenderRequest | null {
    if (!body?.doc_type || !body.service_id) {
      reply.status(400).send({ error: "doc_type and service_id required" });
      return null;
    }
    if (!isDocType(body.doc_type)) {
      reply.status(400).send({ error: `doc_type must be one of ${DOC_TYPES.join(", ")}` });
      return null;
    }
    const data = variablesToDocumentData(body.variables, body.company_data, body.doc_type);
    if (body.doc_type === "zarucni_list" && body.repair_date && !data.dates?.completed) {
      data.dates = { ...(data.dates ?? {}), completed: body.repair_date };
    }
    return { serviceId: body.service_id, docType: body.doc_type, data };
  }

  fastify.post<{ Body: PrintDocumentBody }>("/v1/print-document", async (req, reply) => {
    const r = parseV1(req.body, reply);
    if (!r) return;
    try {
      const pdf = await buildPdf(r);
      const { printer, jobId } = await printBuffer(r.serviceId, pdf);
      pushActivity("print", "ok", [printer, jobId ? `(${jobId})` : ""].filter(Boolean).join(" "));
      return { ok: true, status: "queued", job_id: jobId || undefined };
    } catch (err) {
      pushActivity("print", "error", err instanceof Error ? err.message : String(err));
      return sendError(reply, err);
    }
  });

  fastify.post<{ Body: PrintDocumentBody }>("/v1/export-document", async (req, reply) => {
    const r = parseV1(req.body, reply);
    if (!r) return;
    const target = req.body?.target_path;
    if (!target || typeof target !== "string") return reply.status(400).send({ error: "target_path required" });
    try {
      const pdf = await buildPdf(r);
      await fs.writeFile(target, pdf);
      pushActivity("export", "ok", target);
      return { ok: true, path: target };
    } catch (err) {
      pushActivity("export", "error", err instanceof Error ? err.message : String(err));
      return sendError(reply, err);
    }
  });

  fastify.post<{ Body: PrintDocumentBody }>("/v1/render-pdf", async (req, reply) => {
    const r = parseV1(req.body, reply);
    if (!r) return;
    try {
      return reply.type("application/pdf").send(await buildPdf(r));
    } catch (err) {
      return sendError(reply, err);
    }
  });

  // Surové HTML → PDF (base64). Používá se pro věci mimo šablony.
  fastify.post<{ Body: { html: string; letterhead_pdf_url?: string } }>("/v1/render", async (req, reply) => {
    if (!htmlToPdf) return reply.status(503).send({ error: "PDF rendering requires JobiDocs (Electron)" });
    const { html, letterhead_pdf_url } = req.body || {};
    if (!html || typeof html !== "string") return reply.status(400).send({ error: "html required" });
    try {
      let pdf = await withTimeout(htmlToPdf(html), PDF_TIMEOUT_MS, "PDF render timeout");
      pdf = await mergeLetterhead(pdf, letterhead_pdf_url);
      return { pdf_base64: pdf.toString("base64") };
    } catch (err) {
      return sendError(reply, err);
    }
  });

  fastify.post<{ Body: { html: string; printer?: string; service_id?: string } }>("/v1/print", async (req, reply) => {
    if (!htmlToPdf) return reply.status(503).send({ error: "PDF rendering requires JobiDocs (Electron)" });
    const { html, printer: explicitPrinter, service_id } = req.body || {};
    if (!html || typeof html !== "string") return reply.status(400).send({ error: "html required" });
    try {
      const pdf = await withTimeout(htmlToPdf(html), PDF_TIMEOUT_MS, "PDF render timeout");
      const { printer, jobId } = await printBuffer(service_id ?? "", pdf, explicitPrinter);
      pushActivity("print", "ok", [printer, jobId ? `(${jobId})` : ""].filter(Boolean).join(" "));
      return { ok: true, status: "queued", job_id: jobId || undefined };
    } catch (err) {
      pushActivity("print", "error", err instanceof Error ? err.message : String(err));
      return sendError(reply, err);
    }
  });

  fastify.post<{ Body: { html: string; target_path: string; letterhead_pdf_url?: string } }>("/v1/export", async (req, reply) => {
    if (!htmlToPdf) return reply.status(503).send({ error: "PDF rendering requires JobiDocs (Electron)" });
    const { html, target_path, letterhead_pdf_url } = req.body || {};
    if (!html || typeof html !== "string") return reply.status(400).send({ error: "html required" });
    if (!target_path || typeof target_path !== "string") return reply.status(400).send({ error: "target_path required" });
    try {
      let pdf = await withTimeout(htmlToPdf(html), PDF_TIMEOUT_MS, "PDF render timeout");
      pdf = await mergeLetterhead(pdf, letterhead_pdf_url);
      await fs.writeFile(target_path, pdf);
      pushActivity("export", "ok", target_path);
      return { ok: true, path: target_path };
    } catch (err) {
      pushActivity("export", "error", err instanceof Error ? err.message : String(err));
      return sendError(reply, err);
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
