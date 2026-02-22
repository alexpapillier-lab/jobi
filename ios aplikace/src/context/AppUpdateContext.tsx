/**
 * App update state for Jobi (Tauri). Check runs in background, no auto-dialog.
 * UI shows in Settings → O aplikaci → Aktualizace.
 */
import React, { createContext, useCallback, useContext, useState } from "react";

export type AppUpdateState = {
  /** Update available (version, body) – null when no update or not checked yet */
  update: { version: string; body?: string } | null;
  /** 0–100 during download */
  downloadProgress: number;
  /** Download finished, ready to restart */
  downloaded: boolean;
  /** Currently checking for update */
  checking: boolean;
  /** Currently downloading */
  downloading: boolean;
  /** Last check error */
  error: string | null;
};

type AppUpdateContextValue = AppUpdateState & {
  checkForUpdate: () => Promise<void>;
  downloadAndInstall: () => Promise<void>;
  relaunch: () => Promise<void>;
};

const initialState: AppUpdateState = {
  update: null,
  downloadProgress: 0,
  downloaded: false,
  checking: false,
  downloading: false,
  error: null,
};

const AppUpdateContext = createContext<AppUpdateContextValue | null>(null);

export function AppUpdateProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<AppUpdateState>(initialState);

  const checkForUpdate = useCallback(async () => {
    const isTauri = typeof window !== "undefined" && !!(window as any).__TAURI_INTERNALS__;
    if (!isTauri) return;

    setState((s) => ({ ...s, checking: true, error: null }));
    try {
      const { check } = await import("@tauri-apps/plugin-updater");
      const update = await check();
      setState((s) => ({
        ...s,
        checking: false,
        update: update ? { version: update.version, body: update.body ?? undefined } : null,
        downloaded: false,
        downloadProgress: 0,
      }));
    } catch (err) {
      setState((s) => ({
        ...s,
        checking: false,
        error: err instanceof Error ? err.message : String(err),
      }));
    }
  }, []);

  const downloadAndInstall = useCallback(async () => {
    const isTauri = typeof window !== "undefined" && !!(window as any).__TAURI_INTERNALS__;
    if (!isTauri || !state.update) return;

    setState((s) => ({ ...s, downloading: true, downloadProgress: 0, error: null }));
    try {
      const { check } = await import("@tauri-apps/plugin-updater");
      const update = await check();
      if (!update) {
        setState((s) => ({ ...s, downloading: false, update: null }));
        return;
      }

      let totalBytes = 0;
      let downloadedBytes = 0;

      await update.downloadAndInstall((event: { event: string; data?: { contentLength?: number; chunkLength?: number } }) => {
        if (event.event === "Started" && event.data?.contentLength) {
          totalBytes = event.data.contentLength;
        } else if (event.event === "Progress" && event.data?.chunkLength) {
          downloadedBytes += event.data.chunkLength;
          const pct = totalBytes > 0 ? Math.min(100, Math.round((downloadedBytes / totalBytes) * 100)) : 0;
          setState((s) => ({ ...s, downloadProgress: pct }));
        } else if (event.event === "Finished") {
          setState((s) => ({
            ...s,
            downloading: false,
            downloadProgress: 100,
            downloaded: true,
          }));
        }
      });
    } catch (err) {
      setState((s) => ({
        ...s,
        downloading: false,
        error: err instanceof Error ? err.message : String(err),
      }));
    }
  }, [state.update]);

  const relaunch = useCallback(async () => {
    const isTauri = typeof window !== "undefined" && !!(window as any).__TAURI_INTERNALS__;
    if (!isTauri) return;
    const { relaunch } = await import("@tauri-apps/plugin-process");
    await relaunch();
  }, []);

  const value: AppUpdateContextValue = {
    ...state,
    checkForUpdate,
    downloadAndInstall,
    relaunch,
  };

  return (
    <AppUpdateContext.Provider value={value}>
      {children}
    </AppUpdateContext.Provider>
  );
}

export function useAppUpdate() {
  const ctx = useContext(AppUpdateContext);
  return ctx;
}
