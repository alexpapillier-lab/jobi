/**
 * Rozlišení desktopové (Tauri) a webové varianty.
 *
 * Kód dosud kontroloval `window.__TAURI_INTERNALS__` na pěti různých místech.
 * Tenhle modul to sjednocuje, aby se webová verze dala poznat jedním způsobem
 * a UI mohlo skrýt to, co v prohlížeči nedává smysl.
 *
 * Detekce je záměrně runtime, ne build-time: stejný `src/` se používá pro
 * desktop i pro web, liší se jen vite config (viz vite.config.web.ts).
 */

/** Běžíme uvnitř Tauri (desktopová aplikace)? */
export function isDesktop(): boolean {
  return typeof window !== "undefined" && !!(window as unknown as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__;
}

/** Běžíme v běžném prohlížeči (webová verze)? */
export function isWeb(): boolean {
  return !isDesktop();
}

/**
 * Platforma pro telemetrii a chybové logy: "macos" | "windows" | "web".
 * Na desktopu se rozlišuje podle user agenta, protože Tauri webview ho dědí
 * od systému.
 */
export function platformName(): "macos" | "windows" | "web" {
  if (!isDesktop()) return "web";
  const ua = typeof navigator !== "undefined" ? navigator.userAgent : "";
  return /Windows/i.test(ua) ? "windows" : "macos";
}
