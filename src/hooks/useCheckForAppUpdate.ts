/**
 * Kontrola aktualizací (Tauri): při startu, každých 10 minut a při návratu
 * do okna (aplikace často běží dny v pozadí; interval v uspaném okně
 * nemusí tikat, návrat do okna je proto spolehlivější spouštěč).
 * Žádný dialog – stav je v Nastavení → Aplikace → Aktualizace a v toastu,
 * až je verze připravená.
 */
import { useEffect, useRef } from "react";
import { useAppUpdate } from "../context/AppUpdateContext";

const CHECK_INTERVAL_MS = 10 * 60 * 1000;
/** Při návratu do okna nekontrolovat častěji než jednou za 5 minut. */
const FOCUS_THROTTLE_MS = 5 * 60 * 1000;

export function useCheckForAppUpdate() {
  const { checkForUpdate } = useAppUpdate() ?? {};
  const lastRunRef = useRef(0);

  useEffect(() => {
    const isTauri = typeof window !== "undefined" && !!(window as any).__TAURI_INTERNALS__;
    if (!isTauri || !checkForUpdate) return;

    const run = () => {
      lastRunRef.current = Date.now();
      void checkForUpdate();
    };
    run();

    const interval = setInterval(run, CHECK_INTERVAL_MS);
    const onFocus = () => {
      if (document.visibilityState === "hidden") return;
      if (Date.now() - lastRunRef.current < FOCUS_THROTTLE_MS) return;
      run();
    };
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onFocus);
    return () => {
      clearInterval(interval);
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onFocus);
    };
  }, [checkForUpdate]);
}
