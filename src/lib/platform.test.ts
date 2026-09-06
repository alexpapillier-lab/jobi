/**
 * Rozlišení desktopu a webu.
 *
 * Na téhle jediné funkci visí, jestli se tiskne přes JobiDocs nebo přes
 * prohlížeč, jestli se ptáme na localhost a jestli se kontrolují aktualizace.
 * Když se splete, aplikace nespadne – jen tiše dělá něco jiného, než má.
 */
import { describe, it, expect, afterEach } from "vitest";
import { isDesktop, isWeb, platformName } from "./platform";

function prostredi(window: unknown, userAgent?: string) {
  (globalThis as Record<string, unknown>).window = window;
  if (userAgent !== undefined) (globalThis as Record<string, unknown>).navigator = { userAgent };
}

afterEach(() => {
  delete (globalThis as Record<string, unknown>).window;
  delete (globalThis as Record<string, unknown>).navigator;
});

describe("desktop vs. web", () => {
  it("Tauri se pozná podle __TAURI_INTERNALS__", () => {
    prostredi({ __TAURI_INTERNALS__: {} });
    expect(isDesktop()).toBe(true);
    expect(isWeb()).toBe(false);
  });

  it("prohlížeč bez Tauri je web", () => {
    prostredi({});
    expect(isDesktop()).toBe(false);
    expect(isWeb()).toBe(true);
  });

  it("bez window (server, test) se nehádá desktop", () => {
    expect(isDesktop()).toBe(false);
    expect(platformName()).toBe("unknown");
  });
});

describe("název platformy pro logy", () => {
  it("macOS a Windows se poznají z user agenta webview", () => {
    prostredi({ __TAURI_INTERNALS__: {} }, "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)");
    expect(platformName()).toBe("macos");

    prostredi({ __TAURI_INTERNALS__: {} }, "Mozilla/5.0 (Windows NT 10.0; Win64; x64)");
    expect(platformName()).toBe("windows");
  });

  it("neznámý systém se nehádá", () => {
    prostredi({ __TAURI_INTERNALS__: {} }, "Mozilla/5.0 (X11; Linux x86_64)");
    expect(platformName()).toBe("unknown");
  });

  it("v prohlížeči je platforma web bez ohledu na systém", () => {
    prostredi({}, "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)");
    expect(platformName()).toBe("web");
  });
});
