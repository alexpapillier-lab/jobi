/**
 * OTA update check for Jobi (Tauri). Runs at startup and when the window gains focus.
 * Only active inside Tauri; no-op in browser.
 */
import { useEffect, useRef } from "react";

const FOCUS_CHECK_COOLDOWN_MS = 5 * 60 * 1000; // 5 min between checks on focus

async function runUpdateCheck(): Promise<boolean> {
  const { check } = await import("@tauri-apps/plugin-updater");
  const { relaunch } = await import("@tauri-apps/plugin-process");
  const { ask } = await import("@tauri-apps/plugin-dialog");

  const update = await check();
  if (!update) return false;

  const message = `Je k dispozici nová verze ${update.version}.\n\n${update.body || ""}\n\nChcete ji nainstalovat? Aplikace se po instalaci restartuje.`;
  const yes = await ask(message, {
    title: "Aktualizace Jobi",
    kind: "info",
    okLabel: "Ano, nainstalovat",
    cancelLabel: "Později",
  });
  if (!yes) return false;

  await update.downloadAndInstall((event) => {
    if (event.event === "Finished") {
      console.log("[Updater] Download finished, installing…");
    }
  });
  await relaunch();
  return true;
}

export function useCheckForAppUpdate() {
  const didInitialCheckRef = useRef(false);
  const isCheckingRef = useRef(false);
  const lastFocusCheckRef = useRef(0);

  useEffect(() => {
    const isTauri = typeof window !== "undefined" && !!(window as any).__TAURI_INTERNALS__;
    if (!isTauri) return;

    const doCheck = async () => {
      if (isCheckingRef.current) return;
      isCheckingRef.current = true;
      try {
        await runUpdateCheck();
      } catch (err) {
        console.warn("[Updater] Check or install failed:", err);
      } finally {
        isCheckingRef.current = false;
      }
    };

    // První kontrola hned po startu
    if (!didInitialCheckRef.current) {
      didInitialCheckRef.current = true;
      doCheck();
    }

    // Kontrola při návratu do okna (window focus / visibility)
    const onVisible = () => {
      if (document.visibilityState !== "visible") return;
      const now = Date.now();
      if (now - lastFocusCheckRef.current < FOCUS_CHECK_COOLDOWN_MS) return;
      lastFocusCheckRef.current = now;
      doCheck();
    };

    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, []);
}
