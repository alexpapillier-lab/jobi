/**
 * OTA update check for Jobi (Tauri). Runs at startup and frequently on interval.
 * No dialog – update UI is in Settings → O aplikaci → Aktualizace.
 */
import { useEffect, useRef } from "react";
import { useAppUpdate } from "../context/AppUpdateContext";

const CHECK_INTERVAL_MS = 10 * 60 * 1000; // 10 min

export function useCheckForAppUpdate() {
  const { checkForUpdate } = useAppUpdate() ?? {};
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    const isTauri = typeof window !== "undefined" && !!(window as any).__TAURI_INTERNALS__;
    if (!isTauri || !checkForUpdate) return;

    checkForUpdate();

    intervalRef.current = setInterval(checkForUpdate, CHECK_INTERVAL_MS);
    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    };
  }, [checkForUpdate]);
}
