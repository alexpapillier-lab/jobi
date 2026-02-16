/**
 * OTA update check for Jobi (Tauri). Runs once after mount when app is ready.
 * Only active inside Tauri; no-op in browser.
 */
import { useEffect, useRef } from "react";

export function useCheckForAppUpdate() {
  const didCheckRef = useRef(false);

  useEffect(() => {
    if (didCheckRef.current) return;
    const isTauri = typeof window !== "undefined" && !! (window as any).__TAURI_INTERNALS__;
    if (!isTauri) return;

    didCheckRef.current = true;
    (async () => {
      try {
        const { check } = await import("@tauri-apps/plugin-updater");
        const { relaunch } = await import("@tauri-apps/plugin-process");
        const { ask } = await import("@tauri-apps/plugin-dialog");

        const update = await check();
        if (!update) return;

        const message = `Je k dispozici nová verze ${update.version}.\n\n${update.body || ""}\n\nChcete ji nainstalovat? Aplikace se po instalaci restartuje.`;
        const yes = await ask(message, {
          title: "Aktualizace Jobi",
          kind: "info",
          okLabel: "Ano, nainstalovat",
          cancelLabel: "Později",
        });
        if (!yes) return;

        await update.downloadAndInstall((event) => {
          if (event.event === "Finished") {
            console.log("[Updater] Download finished, installing…");
          }
        });
        await relaunch();
      } catch (err) {
        console.warn("[Updater] Check or install failed:", err);
      }
    })();
  }, []);
}
