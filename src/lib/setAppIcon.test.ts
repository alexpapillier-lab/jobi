/**
 * Ikona v Docku (macOS) – jediná cesta, kudy Jobi volá `invoke` mimo JobiDocs.
 *
 * Zajímá nás, že se v prohlížeči nic nestane (příkaz tam neexistuje) a že
 * selhání – chybějící soubor loga, zamítnutý příkaz – aplikaci neshodí.
 * Ikona v Docku není nic, kvůli čemu má spadnout celé Nastavení.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { LogoPresetId } from "./logoPresets";

const stav = vi.hoisted(() => ({
  invokeVolani: [] as Array<{ cmd: string; args: unknown }>,
  invokeChyba: null as Error | null,
}));

vi.mock("@tauri-apps/api/core", () => ({
  invoke: async (cmd: string, args: unknown) => {
    stav.invokeVolani.push({ cmd, args });
    if (stav.invokeChyba) throw stav.invokeChyba;
  },
}));

/** Node nemá FileReader; setAppIcon přes něj dělá base64 z blobu. */
class FakeFileReader {
  result: string | null = null;
  onloadend: (() => void) | null = null;
  onerror: ((e: unknown) => void) | null = null;
  readAsDataURL(_blob: Blob) {
    this.result = "data:image/png;base64,QUJD";
    queueMicrotask(() => this.onloadend?.());
  }
}

let odpovedNaLogo: () => Response | Promise<Response>;

beforeEach(() => {
  stav.invokeVolani = [];
  stav.invokeChyba = null;
  odpovedNaLogo = () => new Response(new Uint8Array([1, 2, 3]), { status: 200 });
  (globalThis as Record<string, unknown>).window = { __TAURI_INTERNALS__: {} };
  (globalThis as Record<string, unknown>).FileReader = FakeFileReader;
  vi.stubGlobal("fetch", async () => odpovedNaLogo());
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => {
  delete (globalThis as Record<string, unknown>).window;
  delete (globalThis as Record<string, unknown>).FileReader;
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

async function nacti() {
  vi.resetModules();
  return import("./setAppIcon");
}

describe("nastavení ikony aplikace", () => {
  it("mimo Tauri se o ikonu vůbec nepokouší", async () => {
    (globalThis as Record<string, unknown>).window = {};
    const { setAppIconFromPreset } = await nacti();
    await setAppIconFromPreset("light" as LogoPresetId, "light");
    expect(stav.invokeVolani).toEqual([]);
  });

  it("předá Rustu čisté base64 bez prefixu data URL", async () => {
    const { setAppIconFromPreset } = await nacti();
    await setAppIconFromPreset("dark" as LogoPresetId, "light");
    expect(stav.invokeVolani).toEqual([{ cmd: "set_app_icon", args: { data: "QUJD" } }]);
  });

  it("„auto“ použije barvu podle motivu, ne soubor auto.png", async () => {
    const stazene: string[] = [];
    vi.stubGlobal("fetch", async (url: string) => {
      stazene.push(String(url));
      return odpovedNaLogo();
    });
    const { setAppIconFromPreset } = await nacti();
    await setAppIconFromPreset("auto" as LogoPresetId, "dark");
    expect(stazene).toEqual(["/logos/dark.png"]);
  });

  it("chybějící soubor loga aplikaci neshodí a nic neposílá", async () => {
    odpovedNaLogo = () => new Response("not found", { status: 404 });
    const { setAppIconFromPreset } = await nacti();
    await expect(setAppIconFromPreset("light" as LogoPresetId, "light")).resolves.toBeUndefined();
    expect(stav.invokeVolani).toEqual([]);
  });

  it("zamítnutý příkaz skončí varováním, ne výjimkou přes celou aplikaci", async () => {
    stav.invokeChyba = new Error("Ikona není PNG.");
    const { setAppIconFromPreset } = await nacti();
    await expect(setAppIconFromPreset("light" as LogoPresetId, "light")).resolves.toBeUndefined();
    expect(console.warn).toHaveBeenCalled();
  });
});
