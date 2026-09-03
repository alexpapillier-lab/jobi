/**
 * Sdílení osobních voleb napříč zařízeními.
 *
 * Testuje se jen čistá část (čtení/zápis sledovaných klíčů) – supabase
 * klient se v testech nemockuje, tenhle modul ho volá jen v `pull`/`push`
 * funkcích, které tu nejsou pod testem.
 *
 * Prostředí testů je "node" (viz vite.config.ts), ne jsdom, takže
 * localStorage/window tu nejsou samy o sobě – nahrazují se drobnou
 * atrapou přesně na míru tomu, co modul používá.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";

function vytvorAtrapuLocalStorage() {
  const data = new Map<string, string>();
  return {
    getItem: (k: string) => (data.has(k) ? data.get(k)! : null),
    setItem: (k: string, v: string) => { data.set(k, v); },
    removeItem: (k: string) => { data.delete(k); },
    clear: () => { data.clear(); },
  };
}

beforeEach(() => {
  vi.resetModules();
  (globalThis as any).localStorage = vytvorAtrapuLocalStorage();
  (globalThis as any).window = {
    dispatchEvent: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  };
  (globalThis as any).CustomEvent = class {
    type: string;
    constructor(type: string) { this.type = type; }
  };
});

// vi.resetModules() v beforeEach zaručí čerstvý modul (a tedy čerstvé
// module-scope proměnné jako `odlozeno`) pro každý test.
const nacti = () => import("./personalPreferencesSync");

describe("readSyncedKeys / writeSyncedKeys", () => {
  it("přečte jen sledované klíče, ne cokoli jiného v localStorage", async () => {
    const { readSyncedKeys } = await nacti();
    localStorage.setItem("jobsheet_ui_settings_v1", JSON.stringify({ orders: { pageSize: 50 } }));
    localStorage.setItem("jobsheet_logo_preset_v1", "blue");
    localStorage.setItem("neco_jineho_uplne", "citlive udaje");
    const out = readSyncedKeys();
    expect(out).toEqual({
      jobsheet_ui_settings_v1: { orders: { pageSize: 50 } },
      jobsheet_logo_preset_v1: "blue",
    });
    expect(out).not.toHaveProperty("neco_jineho_uplne");
  });

  it("chybějící klíč v readSyncedKeys prostě vynechá", async () => {
    const { readSyncedKeys } = await nacti();
    localStorage.setItem("jobsheet_logo_preset_v1", "green");
    expect(readSyncedKeys()).toEqual({ jobsheet_logo_preset_v1: "green" });
  });

  it("writeSyncedKeys zapíše JSON objekt jako JSON, holý řetězec jako řetězec", async () => {
    const { writeSyncedKeys } = await nacti();
    writeSyncedKeys({
      jobsheet_ui_settings_v1: { orders: { pageSize: 100 } },
      jobsheet_logo_preset_v1: "dark",
    });
    expect(localStorage.getItem("jobsheet_ui_settings_v1")).toBe(JSON.stringify({ orders: { pageSize: 100 } }));
    expect(localStorage.getItem("jobsheet_logo_preset_v1")).toBe("dark");
  });

  it("po zápisu pošle refresh událost pro každý změněný klíč", async () => {
    const { writeSyncedKeys } = await nacti();
    writeSyncedKeys({ jobsheet_ui_settings_v1: { a: 1 }, jobsheet_logo_preset_v1: "blue" });
    const typy = (window.dispatchEvent as any).mock.calls.map((c: any[]) => c[0].type);
    expect(typy).toContain("jobsheet:ui-updated");
    expect(typy).toContain("jobsheet:logo-preset-changed");
  });

  // Tohle je to hlavní, kvůli čemu sync vůbec existuje: bez téhle pojistky
  // by pull po každém přihlášení překreslil UI, i když se na serveru nic
  // nezměnilo od posledního pullu na stejném zařízení.
  it("beze změny hodnoty se neposílá žádná událost", async () => {
    const { writeSyncedKeys } = await nacti();
    localStorage.setItem("jobsheet_logo_preset_v1", "blue");
    writeSyncedKeys({ jobsheet_logo_preset_v1: "blue" });
    expect(window.dispatchEvent).not.toHaveBeenCalled();
  });

  it("ignoruje klíče mimo seznam sledovaných, i kdyby je někdo poslal", async () => {
    const { writeSyncedKeys } = await nacti();
    writeSyncedKeys({ jobsheet_devices_v1: "citliva obchodni data" } as any);
    expect(localStorage.getItem("jobsheet_devices_v1")).toBeNull();
  });
});
