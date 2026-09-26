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
 * Otevře URL v systémovém prohlížeči.
 *
 * V Tauri webview by `window.open` otevřel jen další webview bez adresního
 * řádku, proto jde odkaz přes plugin-opener; když plugin není (web, testy),
 * stačí nové okno prohlížeče.
 */
export async function otevriVProhlizeci(url: string): Promise<void> {
  try {
    const { openUrl } = await import("@tauri-apps/plugin-opener");
    await openUrl(url);
  } catch {
    window.open(url, "_blank", "noopener,noreferrer");
  }
}

/**
 * Platforma pro telemetrii a chybové logy.
 * Na desktopu se rozlišuje podle user agenta, protože Tauri webview ho dědí
 * od systému. Neznámý systém se nehádá – vrací se "unknown".
 *
 * Pozn.: stejnou logiku má zatím i detectPlatform() v src/lib/errorLog.ts,
 * který vznikl souběžně. Až se ustálí, patří sjednotit sem.
 */
export function platformName(): "macos" | "windows" | "web" | "unknown" {
  if (typeof window === "undefined") return "unknown";
  if (!isDesktop()) return "web";
  const ua = typeof navigator !== "undefined" ? navigator.userAgent : "";
  if (/Windows|Win64|Win32/i.test(ua)) return "windows";
  if (/Mac OS X|Macintosh/i.test(ua)) return "macos";
  return "unknown";
}
