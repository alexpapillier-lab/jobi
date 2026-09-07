/**
 * Lokální API, kterým si Jobi říká o tisk.
 *
 * Testuje se bez Electronu – server se spustí přímo v procesu testu, takže
 * jde podstrčit vlastní „tiskárnu“ i vlastní převod HTML na PDF a sledovat,
 * co se stane při špatném vstupu. Právě tam se dřív chybovalo mlčky:
 * dokument se nevytiskl a Jobi se to nedozvěděla.
 *
 * Cesty, kde je potřeba skutečné Chromium (opravdové PDF), pokrývá
 * `aplikace.spec.ts` nad spuštěnou aplikací.
 */
import { test, expect } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { startApiServer } from "../api/server";
import { DOC_TYPES, documentsFromConfig, normalizeDocuments, renderDocument, sampleData, templateFor } from "../core/index.js";
import { docasnyAdresar, E2E_SERVICE_ID, volnyPort } from "./pomocnici";

type Server = Awaited<ReturnType<typeof startApiServer>>;

/** Dvoustránkové PDF – zástupce za Chromium. */
async function falesnePdf(): Promise<Buffer> {
  const { PDFDocument } = await import("pdf-lib");
  const doc = await PDFDocument.create();
  doc.addPage();
  doc.addPage();
  return Buffer.from(await doc.save());
}

type Prostredi = {
  server: Server;
  api: string;
  dataDir: string;
  /** Co se poslalo na „tiskárnu“. */
  tisky: Array<{ velikost: number; tiskarna?: string }>;
  /** Kolikrát se volal převod HTML → PDF a s jakým HTML. */
  rendery: string[];
};

async function spustApi(options?: { sPdf?: boolean; selhaniTisku?: string; klicOkna?: string }): Promise<Prostredi> {
  const port = await volnyPort();
  const dataDir = docasnyAdresar("api");
  const tisky: Prostredi["tisky"] = [];
  const rendery: string[] = [];
  const server = await startApiServer(port, dataDir, {
    appVersion: "test",
    klicOkna: options?.klicOkna,
    htmlToPdf: options?.sPdf
      ? async (html: string) => {
          rendery.push(html);
          return falesnePdf();
        }
      : undefined,
    printPdfNative: async (pdf: Buffer, tiskarna?: string) => {
      if (options?.selhaniTisku) throw new Error(options.selhaniTisku);
      tisky.push({ velikost: pdf.length, tiskarna });
      return "test-job-1";
    },
    listPrintersNative: async () => [{ name: "Testovací tiskárna", status: "idle", available: true }],
  });
  return { server, api: `http://127.0.0.1:${port}`, dataDir, tisky, rendery };
}

async function zastav(p: Prostredi) {
  await p.server.fastify.close();
  fs.rmSync(p.dataDir, { recursive: true, force: true });
}

function post(api: string, cesta: string, telo: unknown) {
  return fetch(`${api}${cesta}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(telo) });
}

/** Kontext, který jinak posílá Jobi (bez Supabase – šablony zůstanou lokální). */
function poslikontext(api: string, extra: Record<string, unknown> = {}) {
  return fetch(`${api}/v1/context`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      services: [{ service_id: E2E_SERVICE_ID, service_name: "E2E testovací servis", role: "owner" }],
      activeServiceId: E2E_SERVICE_ID,
      companyData: { name: "E2E testovací servis", ico: "12345678" },
      canManageDocuments: true,
      ...extra,
    }),
  });
}

// ---------------------------------------------------------------------------

test.describe("API bez Electronu (PDF není k dispozici)", () => {
  let p: Prostredi;
  test.beforeEach(async () => {
    p = await spustApi();
    await poslikontext(p.api);
  });
  test.afterEach(async () => zastav(p));

  test("health hlásí verzi a číslo rozhraní", async () => {
    const d = (await (await fetch(`${p.api}/v1/health`)).json()) as { ok: boolean; app: string; version: string; api: number };
    expect(d).toMatchObject({ ok: true, app: "jobidocs", version: "test" });
    // Jobi se podle tohohle čísla rozhoduje, jestli smí použít /v2.
    expect(d.api).toBe(2);
  });

  test("chybějící service_id vrátí 400 a řekne, co chybí", async () => {
    for (const cesta of ["/v1/settings", "/v2/documents"]) {
      const r = await fetch(`${p.api}${cesta}`);
      expect(r.status, cesta).toBe(400);
      expect((await r.json()) as { error: string }).toMatchObject({ error: "service_id required" });
    }
    const r = await fetch(`${p.api}/v1/settings`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: "{}" });
    expect(r.status).toBe(400);
  });

  test("neznámý typ dokumentu vrátí 400 se seznamem povolených typů", async () => {
    for (const cesta of ["/v2/html", "/v2/pdf", "/v2/print", "/v2/export"]) {
      const r = await post(p.api, cesta, { service_id: E2E_SERVICE_ID, doc_type: "faktura_z_budoucnosti" });
      expect(r.status, cesta).toBe(400);
      const telo = (await r.json()) as { error: string };
      expect(telo.error, cesta).toContain("doc_type must be one of");
      // V hlášce musí být, co se tedy povoluje – jinak je k ničemu.
      expect(telo.error, cesta).toContain("zakazkovy_list");
    }
  });

  test("chybějící doc_type se nedá obejít prázdnou hodnotou", async () => {
    for (const doc_type of [undefined, null, "", 42, {}]) {
      const r = await post(p.api, "/v2/pdf", { service_id: E2E_SERVICE_ID, doc_type });
      expect(r.status, String(doc_type)).toBe(400);
    }
  });

  test("starší rozhraní v1 hlídá vstup stejně", async () => {
    const bezVseho = await post(p.api, "/v1/print-document", {});
    expect(bezVseho.status).toBe(400);
    expect((await bezVseho.json()) as { error: string }).toMatchObject({ error: "doc_type and service_id required" });

    const spatnyTyp = await post(p.api, "/v1/render-pdf", { doc_type: "nesmysl", service_id: E2E_SERVICE_ID, company_data: {} });
    expect(spatnyTyp.status).toBe(400);

    const bezHtml = await post(p.api, "/v1/render", {});
    expect(bezHtml.status).toBe(503); // bez Electronu se nedostane ani k validaci HTML
  });

  test("export bez cílové cesty neskončí tichým úspěchem", async () => {
    const r = await post(p.api, "/v2/export", { service_id: E2E_SERVICE_ID, doc_type: "zakazkovy_list", sample: "short" });
    expect(r.status).toBe(400);
    expect((await r.json()) as { error: string }).toMatchObject({ error: "target_path required" });
  });

  test("bez Electronu vrátí PDF cesty 503 s návodem, ne prázdnou odpověď", async () => {
    const volani: Array<[string, unknown]> = [
      ["/v2/pdf", { service_id: E2E_SERVICE_ID, doc_type: "zakazkovy_list", sample: "short" }],
      ["/v2/print", { service_id: E2E_SERVICE_ID, doc_type: "zakazkovy_list", sample: "short" }],
      ["/v2/export", { service_id: E2E_SERVICE_ID, doc_type: "zakazkovy_list", sample: "short", target_path: path.join(p.dataDir, "x.pdf") }],
      ["/v1/render", { html: "<p>ahoj</p>" }],
      ["/v1/print", { html: "<p>ahoj</p>" }],
      ["/v1/export", { html: "<p>ahoj</p>", target_path: path.join(p.dataDir, "y.pdf") }],
    ];
    for (const [cesta, telo] of volani) {
      const r = await post(p.api, cesta, telo);
      expect(r.status, cesta).toBe(503);
      const d = (await r.json()) as { error: string };
      // Jobi z téhle hlášky skládá radu „spusťte JobiDocs“.
      expect(d.error, cesta).toContain("JobiDocs");
    }
    // Soubor nesmí vzniknout ani prázdný.
    expect(fs.existsSync(path.join(p.dataDir, "x.pdf"))).toBe(false);
    expect(fs.existsSync(path.join(p.dataDir, "y.pdf"))).toBe(false);
  });

  test("HTML dokumentu se sestaví i bez Electronu (náhled v Jobi)", async () => {
    const r = await post(p.api, "/v2/html", { service_id: E2E_SERVICE_ID, doc_type: "zakazkovy_list", sample: "short" });
    expect(r.status).toBe(200);
    expect(r.headers.get("content-type")).toContain("text/html");
    const html = await r.text();
    expect(html).toContain('<section class="page" data-main');
    // Údaje servisu z kontextu se doplní do dokumentu.
    expect(html).toContain("E2E testovací servis");
    // Do tisku se nesmí dostat nenahrazená proměnná.
    expect(html).not.toContain("{{");
  });

  test("neznámá cesta a rozbitý JSON skončí chybou, ne 200", async () => {
    const neznama = await fetch(`${p.api}/v3/neco`);
    expect(neznama.status).toBe(404);

    const rozbity = await fetch(`${p.api}/v2/pdf`, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{tohle není json" });
    expect(rozbity.status).toBe(400);
  });

  test("recent bez přihlášení řekne, že je offline (a nepředstírá prázdno)", async () => {
    const r = await fetch(`${p.api}/v2/recent?service_id=${E2E_SERVICE_ID}&doc_type=zakazkovy_list`);
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ items: [], online: false });

    const spatny = await fetch(`${p.api}/v2/recent?service_id=${E2E_SERVICE_ID}&doc_type=neco`);
    expect(spatny.status).toBe(400);
  });

  test("šablony: uložení, načtení, kontrola vstupu i oprávnění", async () => {
    const vychozi = (await (await fetch(`${p.api}/v2/documents?service_id=${E2E_SERVICE_ID}`)).json()) as {
      documents: { theme: { accent: string }; templates: Record<string, unknown> };
      source: string;
      canManage: boolean;
      online: boolean;
    };
    expect(vychozi.source).toBe("default");
    expect(vychozi.canManage).toBe(true);
    expect(vychozi.online).toBe(false);

    const upravene = { ...vychozi.documents, theme: { ...vychozi.documents.theme, accent: "#123456" } };
    const ulozeni = await fetch(`${p.api}/v2/documents?service_id=${E2E_SERVICE_ID}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ documents: upravene }),
    });
    expect(ulozeni.status).toBe(200);
    expect((await ulozeni.json()) as { savedTo: string }).toMatchObject({ ok: true, savedTo: "local" });

    const nactene = (await (await fetch(`${p.api}/v2/documents?service_id=${E2E_SERVICE_ID}`)).json()) as { documents: { theme: { accent: string } }; source: string };
    expect(nactene.documents.theme.accent).toBe("#123456");
    expect(nactene.source).toBe("local");

    const bezTela = await fetch(`${p.api}/v2/documents?service_id=${E2E_SERVICE_ID}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    expect(bezTela.status).toBe(400);

    // Technik bez oprávnění šablonu nezmění – a dozví se proč.
    await poslikontext(p.api, { canManageDocuments: false });
    const zakazano = await fetch(`${p.api}/v2/documents?service_id=${E2E_SERVICE_ID}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ documents: upravene }),
    });
    expect(zakazano.status).toBe(403);
    expect(((await zakazano.json()) as { error: string }).error).toContain("oprávnění");
    await poslikontext(p.api);
  });

  test("kontext se vrací bez přihlašovacích údajů", async () => {
    await poslikontext(p.api, { supabaseUrl: "https://priklad.supabase.co", supabaseAnonKey: "anon-klic", supabaseAccessToken: "tajny-token" });
    const c = (await (await fetch(`${p.api}/v1/context`)).json()) as Record<string, unknown>;
    const text = JSON.stringify(c);
    expect(text).not.toContain("tajny-token");
    expect(text).not.toContain("anon-klic");
    expect(c.activeServiceId).toBe(E2E_SERVICE_ID);
  });

  test("nastavení tiskárny se uloží pro daný servis", async () => {
    const tiskarny = (await (await fetch(`${p.api}/v1/printers`)).json()) as { printers: Array<{ name: string }> };
    expect(tiskarny.printers.map((t) => t.name)).toContain("Testovací tiskárna");

    await fetch(`${p.api}/v1/settings?service_id=${E2E_SERVICE_ID}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ preferred_printer_name: "Testovací tiskárna" }),
    });
    const s = (await (await fetch(`${p.api}/v1/settings?service_id=${E2E_SERVICE_ID}`)).json()) as { preferred_printer_name?: string };
    expect(s.preferred_printer_name).toBe("Testovací tiskárna");

    // Jiný servis nesmí nastavení zdědit.
    const jiny = (await (await fetch(`${p.api}/v1/settings?service_id=72de5c11-6c2d-486a-9a44-dd0a9060cf97`)).json()) as { preferred_printer_name?: string };
    expect(jiny.preferred_printer_name).toBeUndefined();
  });

  test("nedostupný server: volání selže, nevrátí prázdný úspěch", async () => {
    const api = p.api;
    await p.server.fastify.close();
    await expect(fetch(`${api}/v1/health`)).rejects.toThrow();
    await expect(post(api, "/v2/print", { service_id: E2E_SERVICE_ID, doc_type: "zakazkovy_list" })).rejects.toThrow();
    // Aby afterEach neselhal na druhém zavření.
    p.server = { ...p.server, fastify: { close: async () => {} } } as unknown as Server;
  });
});

test.describe("API s převodem na PDF", () => {
  let p: Prostredi;
  test.beforeEach(async () => {
    p = await spustApi({ sPdf: true });
    await poslikontext(p.api);
  });
  test.afterEach(async () => zastav(p));

  test("tisk projde na vybranou tiskárnu a zapíše se do Aktivit", async () => {
    const r = await post(p.api, "/v2/print", { service_id: E2E_SERVICE_ID, doc_type: "zakazkovy_list", sample: "short", printer: "Testovací tiskárna" });
    expect(r.status).toBe(200);
    expect(await r.json()).toMatchObject({ ok: true, status: "queued", printer: "Testovací tiskárna", job_id: "test-job-1" });
    expect(p.tisky).toHaveLength(1);
    expect(p.tisky[0]?.velikost).toBeGreaterThan(0);

    // Šablona se pro jeden tisk načte právě jednou.
    expect(p.rendery).toHaveLength(1);
    expect(p.rendery[0]).toContain('<section class="page" data-main');

    const aktivity = (await (await fetch(`${p.api}/v1/activity`)).json()) as { entries: Array<{ action: string; status: string }> };
    expect(aktivity.entries.some((e) => e.action === "print" && e.status === "ok")).toBe(true);
  });

  test("export zapíše PDF; nezapisovatelná cesta vrátí chybu", async () => {
    const cil = path.join(p.dataDir, "doklad.pdf");
    const r = await post(p.api, "/v2/export", { service_id: E2E_SERVICE_ID, doc_type: "faktura", sample: "short", target_path: cil });
    expect(r.status).toBe(200);
    expect(fs.readFileSync(cil).subarray(0, 5).toString("latin1")).toBe("%PDF-");

    const spatnaCesta = await post(p.api, "/v2/export", {
      service_id: E2E_SERVICE_ID,
      doc_type: "faktura",
      sample: "short",
      target_path: path.join(p.dataDir, "neexistujici-slozka", "doklad.pdf"),
    });
    expect(spatnaCesta.status).toBe(500);
    expect(((await spatnaCesta.json()) as { error: string }).error).toBeTruthy();

    const aktivity = (await (await fetch(`${p.api}/v1/activity`)).json()) as { entries: Array<{ action: string; status: string }> };
    expect(aktivity.entries.some((e) => e.action === "export" && e.status === "error")).toBe(true);
  });

  test("service_id se dá vzít z aktivního servisu v kontextu", async () => {
    const r = await post(p.api, "/v2/pdf", { doc_type: "zakazkovy_list", sample: "short" });
    expect(r.status).toBe(200);
    expect(r.headers.get("content-type")).toContain("application/pdf");
    expect((await r.arrayBuffer()).byteLength).toBeGreaterThan(0);
  });

  test("nepoužitelný hlavičkový papír tisk nezastaví, ale nezůstane potichu", async () => {
    // Odkaz, který nejde stáhnout. Dokument musí vzniknout (servis musí
    // vydat doklad), ale důvod se musí objevit v Aktivitách – jinak si
    // nikdo nevšimne, že se tiskne na prázdný papír.
    const dokumenty = (await (await fetch(`${p.api}/v2/documents?service_id=${E2E_SERVICE_ID}`)).json()) as { documents: { brand: Record<string, unknown> } };
    const sPapirem = { ...dokumenty.documents, brand: { ...dokumenty.documents.brand, letterheadPdfUrl: "https://127.0.0.1:1/hlavicka.pdf" } };

    const cil = path.join(p.dataDir, "s-hlavickou.pdf");
    const r = await post(p.api, "/v2/export", { service_id: E2E_SERVICE_ID, doc_type: "zakazkovy_list", sample: "short", documents: sPapirem, target_path: cil });
    expect(r.status).toBe(200);
    expect(fs.existsSync(cil)).toBe(true);

    const aktivity = (await (await fetch(`${p.api}/v1/activity`)).json()) as { entries: Array<{ status: string; detail?: string }> };
    expect(aktivity.entries.some((e) => e.status === "error" && (e.detail ?? "").includes("Hlavičkový papír"))).toBe(true);
  });

  test("neplatný hlavičkový papír v base64 dokument neshodí", async () => {
    const dokumenty = (await (await fetch(`${p.api}/v2/documents?service_id=${E2E_SERVICE_ID}`)).json()) as { documents: { brand: Record<string, unknown> } };
    const rozbity = {
      ...dokumenty.documents,
      brand: { ...dokumenty.documents.brand, letterheadPdfUrl: `data:application/pdf;base64,${Buffer.from("tohle není PDF").toString("base64")}` },
    };
    const cil = path.join(p.dataDir, "rozbita-hlavicka.pdf");
    const r = await post(p.api, "/v2/export", { service_id: E2E_SERVICE_ID, doc_type: "zakazkovy_list", sample: "short", documents: rozbity, target_path: cil });
    expect(r.status).toBe(200);
    expect(fs.statSync(cil).size).toBeGreaterThan(0);

    const aktivity = (await (await fetch(`${p.api}/v1/activity`)).json()) as { entries: Array<{ status: string; detail?: string }> };
    expect(aktivity.entries.some((e) => e.status === "error" && (e.detail ?? "").includes("Hlavičkový papír"))).toBe(true);
  });

  test("selhání tiskárny se vrátí jako chyba, ne jako zařazeno do fronty", async () => {
    const q = await spustApi({ sPdf: true, selhaniTisku: "Tiskárna neodpovídá" });
    try {
      await poslikontext(q.api);
      const r = await post(q.api, "/v2/print", { service_id: E2E_SERVICE_ID, doc_type: "zakazkovy_list", sample: "short" });
      expect(r.status).toBe(500);
      expect(((await r.json()) as { error: string }).error).toContain("Tiskárna neodpovídá");
      const aktivity = (await (await fetch(`${q.api}/v1/activity`)).json()) as { entries: Array<{ action: string; status: string; detail?: string }> };
      expect(aktivity.entries.some((e) => e.action === "print" && e.status === "error" && (e.detail ?? "").includes("Tiskárna neodpovídá"))).toBe(true);
    } finally {
      await zastav(q);
    }
  });
});

// ---------------------------------------------------------------------------

/**
 * Tatáž šablona v JobiDocs i v prohlížeči.
 *
 * Webová verze Jobi (`src/lib/webPrint.ts`) si HTML skládá sama – z téhož
 * jádra, ale bez JobiDocs. Vizuální předlohy v kořenovém
 * `e2e/dokumenty-vzhled.spec.ts` se pořizují právě z téhle cesty
 * (`e2e/dokumenty/nahled.ts`). Kdyby si JobiDocs cokoli přidával nebo ubíral,
 * vypadal by doklad z desktopu jinak než z prohlížeče a předlohy by hlídaly
 * jen jednu z těch dvou podob. Proto se tady porovnává znak po znaku.
 */
test.describe("Jádro kreslí v JobiDocs totéž co ve webové verzi", () => {
  let p: Prostredi;
  test.beforeEach(async () => {
    p = await spustApi();
    // Schválně bez `companyData`: webová předloha kreslí s ukázkovým
    // servisem z jádra, takže musí do porovnání jít stejný vstup.
    await fetch(`${p.api}/v1/context`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ services: [], activeServiceId: E2E_SERVICE_ID, companyData: null, canManageDocuments: true }),
    });
  });
  test.afterEach(async () => zastav(p));

  test("HTML z /v2/html je znak po znaku shodné s webovou větví", async () => {
    const dokumenty = normalizeDocuments(documentsFromConfig(null));

    for (const typ of DOC_TYPES) {
      for (const varianta of ["short", "long"] as const) {
        // Přesně to, co dělá e2e/dokumenty/nahled.ts a buildDocumentHtmlForWeb.
        const web = renderDocument({
          template: templateFor(dokumenty, typ),
          data: sampleData(typ, varianta),
          brand: dokumenty.brand,
          theme: dokumenty.theme,
          options: { mode: "print" },
        });

        const r = await post(p.api, "/v2/html", { service_id: E2E_SERVICE_ID, doc_type: typ, sample: varianta });
        expect(r.status, `${typ}/${varianta}`).toBe(200);
        expect(await r.text(), `${typ}/${varianta}: JobiDocs kreslí jinak než web`).toBe(web);
      }
    }
  });

  test("výchozí šablona pokrývá všechny typy dokumentů, které Jobi umí poslat", async () => {
    // Jobi nabízí tisk sedmi typů (DocTypeForPrint v src/lib/jobidocs.ts).
    // Kdyby jádro některý neznalo, vrátilo by 400 až ve chvíli, kdy technik
    // mačká Tisk – proto se seznam kontroluje celý najednou.
    expect([...DOC_TYPES].sort()).toEqual(
      ["diagnosticky_protokol", "faktura", "prijemka_reklamace", "smlouva_zapujcka", "vydejka_reklamace", "zakazkovy_list", "zarucni_list"].sort(),
    );
  });
});

/**
 * Tvar volání, kterým s JobiDocs mluví hlavní aplikace.
 *
 * `src/lib/jobidocs.ts` nikdy neposílá `sample` – posílá `data`
 * (DocumentData ze zakázky). Testy nad `sample` tuhle cestu minou, přitom
 * právě tady se rozhoduje, co bude na papíře u zákazníka.
 */
test.describe("Data ze zakázky (tak, jak je posílá Jobi)", () => {
  let p: Prostredi;
  test.beforeEach(async () => {
    p = await spustApi({ sPdf: true });
    await poslikontext(p.api);
  });
  test.afterEach(async () => zastav(p));

  test("hodnoty ze zakázky se dostanou do dokumentu", async () => {
    const data = {
      number: "IRPAZ2600001",
      customer: { name: "Testovací Zákazník", phone: "+420 700 000 001" },
      device: { name: "Acer Aspire 5", serial: "SN-E2E-1", issue: "Nenabíjí baterii" },
      service: {},
    };
    const html = await (await post(p.api, "/v2/html", { service_id: E2E_SERVICE_ID, doc_type: "zakazkovy_list", data })).text();
    expect(html).toContain("Testovací Zákazník");
    expect(html).toContain("SN-E2E-1");
    expect(html).toContain("Nenabíjí baterii");
    // Údaje servisu se doplní z kontextu, i když je Jobi v datech neposlala.
    expect(html).toContain("E2E testovací servis");
    expect(html).not.toContain("{{");
  });

  test("prázdná data dokument nezruší, jen v něm nic nedopíšou", async () => {
    // Zakázka bez vyplněných polí se pořád musí dát vytisknout – papír
    // s prázdnými řádky je použitelný, chybová hláška při příjmu ne.
    for (const data of [{}, { service: null }, { customer: null, device: null }]) {
      const r = await post(p.api, "/v2/html", { service_id: E2E_SERVICE_ID, doc_type: "zakazkovy_list", data });
      expect(r.status, JSON.stringify(data)).toBe(200);
      const html = await r.text();
      expect(html, JSON.stringify(data)).toContain('<section class="page" data-main');
      expect(html, JSON.stringify(data)).not.toContain("{{");
    }
  });

  test("data jiného typu než objekt se neprotlačí do šablony", async () => {
    for (const data of ["<script>x</script>", 42, ["a"], true]) {
      const r = await post(p.api, "/v2/html", { service_id: E2E_SERVICE_ID, doc_type: "zakazkovy_list", data });
      expect(r.status, String(data)).toBe(200);
      const html = await r.text();
      expect(html, String(data)).toContain('<section class="page" data-main');
      expect(html, String(data)).not.toContain("<script>x</script>");
    }
  });

  test("tisk i export se stejnými daty projdou celou cestou do PDF", async () => {
    const data = { number: "IRPAZ2600002", customer: { name: "Druhý Zákazník" }, service: {} };
    const tisk = await post(p.api, "/v2/print", { service_id: E2E_SERVICE_ID, doc_type: "zarucni_list", data, printer: "Testovací tiskárna" });
    expect(tisk.status).toBe(200);

    const cil = path.join(p.dataDir, "ze-zakazky.pdf");
    const exp = await post(p.api, "/v2/export", { service_id: E2E_SERVICE_ID, doc_type: "zarucni_list", data, target_path: cil });
    expect(exp.status).toBe(200);
    expect(fs.existsSync(cil)).toBe(true);

    // Tisk i export musí projít týmž HTML – jinak by uložené PDF ukazovalo
    // něco jiného, než co vyjelo z tiskárny.
    expect(p.rendery).toHaveLength(2);
    expect(p.rendery[0]).toBe(p.rendery[1]);
    expect(p.rendery[0]).toContain("Druhý Zákazník");
  });
});

/**
 * Místní API poslouchá na 127.0.0.1, jenže to před prohlížečem nechrání:
 * každá otevřená stránka umí poslat POST na localhost. Tyhle testy hlídají obě
 * pojistky – odmítnutí cizího původu a omezení cesty pro export.
 */
test.describe("hranice místního API", () => {
  let p: Prostredi;
  test.beforeAll(async () => { p = await spustApi({ sPdf: true }); });
  test.afterAll(async () => { await zastav(p); });

  test("požadavek z cizí stránky se odmítne, z Jobi projde", async () => {
    const cizi = await fetch(`${p.api}/v1/health`, { headers: { Origin: "https://utocnik.example" } });
    expect(cizi.status, "cizí web se dostal na API JobiDocs").toBe(403);

    // macOS Tauri hlásí `tauri://localhost`, Windows `http://tauri.localhost`,
    // vývojový server `http://localhost:1430`. Všechny tři musí projít, jinak
    // by přestal fungovat tisk z aplikace.
    for (const puvod of ["tauri://localhost", "http://tauri.localhost", "http://localhost:1430"]) {
      const nase = await fetch(`${p.api}/v1/health`, { headers: { Origin: puvod } });
      expect(nase.status, `Jobi z původu ${puvod} se na API nedostala`).toBe(200);
    }
  });

  test("export mimo domovskou a dočasnou složku se odmítne", async () => {
    // Bez téhle kontroly by cizí stránka nechala JobiDocs zapsat soubor
    // kamkoli, kam má uživatel právo.
    const res = await post(p.api, "/v1/export", { html: "<p>test</p>", target_path: "/Library/LaunchAgents/jobi.pdf" });
    expect(res.status).toBe(400);
    expect(await res.text()).toContain("target_path");
  });

  test("export bez přípony .pdf se odmítne", async () => {
    const res = await post(p.api, "/v1/export", { html: "<p>test</p>", target_path: `${os.homedir()}/jobi-test.sh` });
    expect(res.status).toBe(400);
  });

  test("export do domovské složky projde", async () => {
    const cil = path.join(os.tmpdir(), `jobi-export-${Date.now()}.pdf`);
    const res = await post(p.api, "/v1/export", { html: "<p>test</p>", target_path: cil });
    expect(res.status, await res.text()).toBe(200);
    expect(fs.existsSync(cil)).toBe(true);
    fs.rmSync(cil, { force: true });
  });
});

/**
 * Kontrola původu sama nestačí: `Origin: null` posílá jak naše okno
 * z `file://`, tak libovolná stránka ze sandboxovaného iframu. Pro takový
 * požadavek proto server vyžaduje klíč, který hlavní proces předá jen oknu.
 */
test.describe("klíč okna", () => {
  let p: Prostredi;
  const KLIC = "klic-pro-test-12345";
  test.beforeAll(async () => { p = await spustApi({ sPdf: true, klicOkna: KLIC }); });
  test.afterAll(async () => { await zastav(p); });

  test("cizí stránka ze sandboxu (Origin: null) se bez klíče nedostane na kontext", async () => {
    const bez = await fetch(`${p.api}/v1/context`, { headers: { Origin: "null" } });
    expect(bez.status, "sandboxovaný iframe se dostal ke kontextu JobiDocs").toBe(403);

    const sKlicem = await fetch(`${p.api}/v1/context`, { headers: { Origin: "null", "x-jobi-klic": KLIC } });
    expect(sKlicem.status, "okno JobiDocs se ke svému API nedostalo").toBe(200);
  });

  test("špatný klíč neprojde", async () => {
    const res = await fetch(`${p.api}/v1/context`, { headers: { Origin: "null", "x-jobi-klic": "neco-jineho" } });
    expect(res.status).toBe(403);
  });

  test("Jobi z tauri původu projde i bez klíče", async () => {
    const res = await fetch(`${p.api}/v1/health`, { headers: { Origin: "tauri://localhost" } });
    expect(res.status).toBe(200);
  });
});
