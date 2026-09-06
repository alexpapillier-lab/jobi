/**
 * Desktopové obaly nad JobiDocs API (localhost:3847) a nad `invoke`.
 *
 * Tahle cesta existuje jen v Tauri – ve webové verzi se místo ní tiskne
 * prohlížečem, takže ji Playwright na webu nikdy neprojde. Testuje se proto
 * s namockovaným `@tauri-apps/*`, a hlavně chybové stavy: JobiDocs neběží,
 * odpoví chybou, spojení spadne. V žádném z nich nesmí volající dostat
 * „ok“ ani tichý příslib, že se něco vytisklo.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { DocumentData } from "./documentData";

const stav = vi.hoisted(() => ({
  fetchVolani: [] as Array<{ url: string; init: Record<string, unknown> }>,
  fetchOdpoved: null as null | (() => Promise<Response> | Response),
  invokeVolani: [] as Array<{ cmd: string; args: unknown }>,
  invokeVysledek: undefined as unknown,
  invokeChyba: null as Error | null,
  openUrlVolani: [] as string[],
  openUrlChyba: null as Error | null,
}));

vi.mock("@tauri-apps/plugin-http", () => ({
  fetch: async (url: string, init: Record<string, unknown>) => {
    stav.fetchVolani.push({ url: String(url), init: init ?? {} });
    if (!stav.fetchOdpoved) throw new Error("test neurčil odpověď");
    return stav.fetchOdpoved();
  },
}));

vi.mock("@tauri-apps/api/core", () => ({
  invoke: async (cmd: string, args: unknown) => {
    stav.invokeVolani.push({ cmd, args });
    if (stav.invokeChyba) throw stav.invokeChyba;
    return stav.invokeVysledek;
  },
}));

vi.mock("@tauri-apps/plugin-opener", () => ({
  openUrl: async (url: string) => {
    if (stav.openUrlChyba) throw stav.openUrlChyba;
    stav.openUrlVolani.push(url);
  },
}));

const DATA = { ticket: { code: "Z-1" } } as unknown as DocumentData;
const SERVIS = "882beee7-4564-4d10-8ac6-16dc19240b57";

/** Předstírá běh uvnitř Tauri – bez toho se moduly chovají jako web. */
function jsmeVDesktopu(ano: boolean) {
  (globalThis as { window?: unknown }).window = ano ? { __TAURI_INTERNALS__: {} } : {};
}

function odpoved(telo: unknown, init?: ResponseInit) {
  stav.fetchOdpoved = () => new Response(typeof telo === "string" ? telo : JSON.stringify(telo), init);
}

function spojeniSpadne(hlaska = "error sending request") {
  stav.fetchOdpoved = () => {
    throw new Error(hlaska);
  };
}

/** Modul si fetch pamatuje v proměnné, takže se musí načíst znovu. */
async function nactiJobidocs() {
  vi.resetModules();
  return import("./jobidocs");
}

beforeEach(() => {
  stav.fetchVolani = [];
  stav.fetchOdpoved = null;
  stav.invokeVolani = [];
  stav.invokeVysledek = undefined;
  stav.invokeChyba = null;
  stav.openUrlVolani = [];
  stav.openUrlChyba = null;
  jsmeVDesktopu(true);
});

afterEach(() => {
  delete (globalThis as { window?: unknown }).window;
});

describe("zjištění, jestli JobiDocs běží", () => {
  it("ve webové verzi se na localhost vůbec neptá", async () => {
    jsmeVDesktopu(false);
    const { isJobiDocsRunning, jobiDocsApiVersion } = await nactiJobidocs();
    expect(await isJobiDocsRunning()).toBe(false);
    expect(await jobiDocsApiVersion()).toBeNull();
    // Jinak by každý dotaz čekal na timeout a UI by se sekalo.
    expect(stav.fetchVolani).toEqual([]);
  });

  it("odpověď 200 znamená, že JobiDocs běží", async () => {
    odpoved({});
    const { isJobiDocsRunning } = await nactiJobidocs();
    expect(await isJobiDocsRunning()).toBe(true);
    expect(stav.fetchVolani[0].url).toBe("http://127.0.0.1:3847/v1/context");
  });

  it("nespuštěný JobiDocs (spojení odmítnuto) vrací false, ne výjimku", async () => {
    spojeniSpadne("Connection refused");
    const { isJobiDocsRunning } = await nactiJobidocs();
    await expect(isJobiDocsRunning()).resolves.toBe(false);
  });

  it("dotaz má timeout – bez něj by mrtvý JobiDocs zasekl tlačítko Tisk", async () => {
    odpoved({});
    const { isJobiDocsRunning } = await nactiJobidocs();
    await isJobiDocsRunning();
    expect(stav.fetchVolani[0].init.connectTimeout).toBe(2000);
  });

  it("verze API se čte z /v1/health, chybějící číslo znamená starou verzi 1", async () => {
    odpoved({ api: 2 });
    const m = await nactiJobidocs();
    expect(await m.jobiDocsApiVersion()).toBe(2);
    expect(stav.fetchVolani[0].url).toBe("http://127.0.0.1:3847/v1/health");

    odpoved({});
    expect(await m.jobiDocsApiVersion()).toBe(1);

    odpoved({}, { status: 500 });
    expect(await m.jobiDocsApiVersion()).toBeNull();
  });
});

describe("tisk dokumentu", () => {
  it("pošle typovaná data na /v2/print", async () => {
    odpoved({});
    const { printDocument } = await nactiJobidocs();
    const res = await printDocument("zakazkovy_list", SERVIS, DATA);
    expect(res).toEqual({ ok: true });
    const volani = stav.fetchVolani[0];
    expect(volani.url).toBe("http://127.0.0.1:3847/v2/print");
    expect(volani.init.method).toBe("POST");
    expect(JSON.parse(String(volani.init.body))).toEqual({ doc_type: "zakazkovy_list", service_id: SERVIS, data: DATA });
  });

  it("chybu z JobiDocs předá dál, nezamlčí ji", async () => {
    odpoved({ error: "No printer found" }, { status: 500 });
    const { printDocument } = await nactiJobidocs();
    expect(await printDocument("zakazkovy_list", SERVIS, DATA)).toEqual({ ok: false, error: "No printer found" });
  });

  it("odpověď bez těla neskončí jako úspěch", async () => {
    stav.fetchOdpoved = () => new Response("<html>proxy</html>", { status: 502, statusText: "Bad Gateway" });
    const { printDocument } = await nactiJobidocs();
    const res = await printDocument("zakazkovy_list", SERVIS, DATA);
    expect(res.ok).toBe(false);
    expect(res.error).toBeTruthy();
  });

  it("spadlé spojení je chyba s hláškou, ne tichý úspěch", async () => {
    spojeniSpadne();
    const { printDocument } = await nactiJobidocs();
    expect(await printDocument("zakazkovy_list", SERVIS, DATA)).toEqual({ ok: false, error: "error sending request" });
  });
});

describe("export a náhled", () => {
  it("export posílá cílovou cestu, kterou vybral uživatel", async () => {
    odpoved({});
    const { exportDocument } = await nactiJobidocs();
    await exportDocument("faktura", SERVIS, DATA, "/Users/test/Desktop/f.pdf");
    expect(JSON.parse(String(stav.fetchVolani[0].init.body)).target_path).toBe("/Users/test/Desktop/f.pdf");
  });

  it("neúspěšný export nevrátí ok", async () => {
    odpoved({ error: "EACCES" }, { status: 500 });
    const { exportDocument } = await nactiJobidocs();
    expect(await exportDocument("faktura", SERVIS, DATA, "/x.pdf")).toEqual({ ok: false, error: "EACCES" });
  });

  it("PDF pro náhled se vrací jako data", async () => {
    stav.fetchOdpoved = () => new Response(new Uint8Array([0x25, 0x50, 0x44, 0x46]), { status: 200 });
    const { renderPdf } = await nactiJobidocs();
    const res = await renderPdf("faktura", SERVIS, DATA);
    expect(res.ok).toBe(true);
    expect(new Uint8Array(res.data!)).toEqual(new Uint8Array([0x25, 0x50, 0x44, 0x46]));
  });

  it("selhaný náhled nevrátí prázdné PDF", async () => {
    odpoved({ error: "Template not found" }, { status: 404 });
    const { renderPdf } = await nactiJobidocs();
    const res = await renderPdf("faktura", SERVIS, DATA);
    expect(res.ok).toBe(false);
    expect(res.data).toBeUndefined();
    expect(res.error).toBe("Template not found");
  });

  it("HTML náhled se vrací jako text", async () => {
    stav.fetchOdpoved = () => new Response("<html>doklad</html>", { status: 200 });
    const { renderHtml } = await nactiJobidocs();
    expect(await renderHtml("faktura", SERVIS, DATA)).toEqual({ ok: true, html: "<html>doklad</html>" });
  });
});

describe("předání kontextu JobiDocs", () => {
  it("uloží kontext do Rustu i pošle HTTP – Rust posílá dál i s uspaným oknem", async () => {
    odpoved({});
    const { pushContextToJobiDocs } = await nactiJobidocs();
    await pushContextToJobiDocs([{ service_id: SERVIS, service_name: "E2E", role: "owner" }], SERVIS);

    expect(stav.invokeVolani[0].cmd).toBe("set_jobidocs_context");
    const payload = JSON.parse(String((stav.invokeVolani[0].args as { payload: string }).payload));
    expect(payload.activeServiceId).toBe(SERVIS);
    expect(stav.fetchVolani[0].url).toBe("http://127.0.0.1:3847/v1/context");
    expect(stav.fetchVolani[0].init.method).toBe("PUT");
  });

  it("starší Jobi bez rustového příkazu pošle kontext aspoň po HTTP", async () => {
    stav.invokeChyba = new Error("Command set_jobidocs_context not found");
    odpoved({});
    const { pushContextToJobiDocs } = await nactiJobidocs();
    await pushContextToJobiDocs([], null);
    expect(stav.fetchVolani).toHaveLength(1);
  });

  it("nespuštěný JobiDocs kontext neshodí aplikaci", async () => {
    spojeniSpadne("Connection refused");
    const { pushContextToJobiDocs } = await nactiJobidocs();
    await expect(pushContextToJobiDocs([], null)).resolves.toBeUndefined();
  });

  it("ve webu se kontext neposílá nikam", async () => {
    jsmeVDesktopu(false);
    const { pushContextToJobiDocs } = await nactiJobidocs();
    await pushContextToJobiDocs([], null);
    expect(stav.fetchVolani).toEqual([]);
    expect(stav.invokeVolani).toEqual([]);
  });

  it("přístupový token se přidá jen když ho volající dodá", async () => {
    odpoved({});
    const m = await nactiJobidocs();
    await m.pushContextToJobiDocs([], SERVIS);
    expect(JSON.parse(String(stav.fetchVolani[0].init.body)).supabaseAccessToken).toBeUndefined();

    stav.fetchVolani = [];
    await m.pushContextToJobiDocs([], SERVIS, {
      supabaseAuth: { supabaseUrl: "https://x.supabase.co", supabaseAnonKey: "anon", supabaseAccessToken: null },
    });
    const telo = JSON.parse(String(stav.fetchVolani[0].init.body));
    expect(telo.supabaseUrl).toBe("https://x.supabase.co");
    expect(telo.supabaseAccessToken).toBeNull();
  });
});

describe("spuštění a stažení JobiDocs", () => {
  it("úspěšné spuštění vrací true", async () => {
    stav.invokeVysledek = true;
    const { launchJobiDocsApp } = await nactiJobidocs();
    expect(await launchJobiDocsApp()).toBe(true);
    expect(stav.invokeVolani[0].cmd).toBe("launch_jobidocs");
  });

  it("nenainstalovaný JobiDocs vrací false, ne výjimku", async () => {
    stav.invokeVysledek = false;
    const m = await nactiJobidocs();
    expect(await m.launchJobiDocsApp()).toBe(false);

    stav.invokeChyba = new Error("Command not allowed by capability");
    expect(await m.launchJobiDocsApp()).toBe(false);
  });

  it("odkaz na stažení otevře systémový prohlížeč", async () => {
    const { openJobiDocsDownload, JOBIDOCS_DOWNLOAD_URL } = await nactiJobidocs();
    await openJobiDocsDownload();
    expect(stav.openUrlVolani).toEqual([JOBIDOCS_DOWNLOAD_URL]);
  });

  it("když systémový prohlížeč selže, zkusí se okno webview", async () => {
    stav.openUrlChyba = new Error("opener.open_url not allowed");
    const otevrena: string[] = [];
    (globalThis as { window?: unknown }).window = {
      __TAURI_INTERNALS__: {},
      open: (url: string) => otevrena.push(url),
    };
    const { openJobiDocsDownload, JOBIDOCS_DOWNLOAD_URL } = await nactiJobidocs();
    await openJobiDocsDownload();
    expect(otevrena).toEqual([JOBIDOCS_DOWNLOAD_URL]);
  });
});
