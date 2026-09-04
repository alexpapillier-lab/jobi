/**
 * Stav aktualizace aplikace (Tauri). Kontrola běží na pozadí, nová verze se
 * rovnou stáhne a připraví; uživatel jen jednou klikne „Restartovat“.
 *
 * Dřív: toast „Je k dispozici aktualizace“ → Nastavení → Nainstalovat →
 * čekání na stažení → Restartovat. Čtyři kroky pro něco, co má být jeden.
 * Teď se stahuje samo (jde to vypnout) a ozveme se až s hotovou verzí.
 *
 * Fáze: idle → checking → available → downloading → ready | error.
 * Původní pole (update, downloading, downloaded, …) zůstávají pro
 * stávající odběratele.
 */
import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";

export type UpdatePhase = "idle" | "checking" | "available" | "downloading" | "ready" | "error";

export type AppUpdateState = {
  phase: UpdatePhase;
  /** Dostupná verze (i když už je stažená) – null, když není nebo ještě neproběhla kontrola. */
  update: { version: string; body?: string; date?: string } | null;
  /** 0–100 při stahování */
  downloadProgress: number;
  /** Stažená a nainstalovaná; stačí restart. */
  downloaded: boolean;
  checking: boolean;
  downloading: boolean;
  /** Poslední chyba (kontrola i stažení) */
  error: string | null;
  /** Kdy naposledy proběhla kontrola (ms) */
  lastCheckedAt: number | null;
  /** Verze, která právě běží */
  currentVersion: string | null;
  /** Stahovat novou verzi hned po nalezení */
  autoDownload: boolean;
};

type AppUpdateContextValue = AppUpdateState & {
  checkForUpdate: () => Promise<void>;
  downloadAndInstall: () => Promise<void>;
  relaunch: () => Promise<void>;
  setAutoDownload: (on: boolean) => void;
};

const AUTO_DOWNLOAD_KEY = "jobsheet_update_auto_download";

function readAutoDownload(): boolean {
  try {
    const v = localStorage.getItem(AUTO_DOWNLOAD_KEY);
    return v === null ? true : v === "1";
  } catch {
    return true;
  }
}

const initialState: AppUpdateState = {
  phase: "idle",
  update: null,
  downloadProgress: 0,
  downloaded: false,
  checking: false,
  downloading: false,
  error: null,
  lastCheckedAt: null,
  currentVersion: null,
  autoDownload: true,
};

const AppUpdateContext = createContext<AppUpdateContextValue | null>(null);

function isTauriRuntime(): boolean {
  return typeof window !== "undefined" && !!(window as any).__TAURI_INTERNALS__;
}

/** Chybové hlášky z updateru jsou technické; tohle je to, co má smysl číst. */
function humanizeUpdateError(err: unknown): string {
  const msg = err instanceof Error ? err.message : String(err);
  const low = msg.toLowerCase();
  if (low.includes("network") || low.includes("fetch") || low.includes("timed out") || low.includes("dns") || low.includes("connect")) {
    return "Nepodařilo se spojit se serverem aktualizací. Zkontrolujte připojení a zkuste to znovu.";
  }
  if (low.includes("signature") || low.includes("pubkey") || low.includes("verify")) {
    return "Stažená verze neprošla ověřením podpisu. Aktualizace se nenainstalovala.";
  }
  if (low.includes("permission") || low.includes("denied")) {
    return "Aplikace nemá oprávnění se přepsat. Zkuste ji spustit z složky Aplikace.";
  }
  return msg;
}

export function AppUpdateProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<AppUpdateState>(() => ({ ...initialState, autoDownload: readAutoDownload() }));
  /** Objekt Update z pluginu – aby se při instalaci nemuselo znovu kontrolovat. */
  const pendingUpdateRef = useRef<any>(null);
  /** Verze, kterou už stahujeme/stáhli – ať se auto-stahování nespustí dvakrát. */
  const handledVersionRef = useRef<string | null>(null);
  const downloadingRef = useRef(false);

  useEffect(() => {
    if (!isTauriRuntime()) return;
    import("@tauri-apps/api/app")
      .then(({ getVersion }) => getVersion())
      .then((v) => setState((s) => ({ ...s, currentVersion: v })))
      .catch(() => {});
  }, []);

  const downloadAndInstall = useCallback(async () => {
    if (!isTauriRuntime()) return;
    if (downloadingRef.current) return;
    let update = pendingUpdateRef.current;
    if (!update) {
      const { check } = await import("@tauri-apps/plugin-updater");
      update = await check();
      if (!update) {
        setState((s) => ({ ...s, phase: "idle", update: null }));
        return;
      }
      pendingUpdateRef.current = update;
    }

    downloadingRef.current = true;
    setState((s) => ({ ...s, phase: "downloading", downloading: true, downloadProgress: 0, error: null }));
    try {
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
          setState((s) => ({ ...s, downloadProgress: 100 }));
        }
      });
      setState((s) => ({ ...s, phase: "ready", downloading: false, downloadProgress: 100, downloaded: true }));
    } catch (err) {
      setState((s) => ({ ...s, phase: "error", downloading: false, error: humanizeUpdateError(err) }));
    } finally {
      downloadingRef.current = false;
    }
  }, []);

  const checkForUpdate = useCallback(async () => {
    if (!isTauriRuntime()) return;
    // Hotovou verzi nepřepisujeme další kontrolou – stačí restart.
    if (downloadingRef.current) return;

    setState((s) => (s.phase === "ready" ? s : { ...s, phase: "checking", checking: true, error: null }));
    try {
      const { check } = await import("@tauri-apps/plugin-updater");
      const update = await check();
      const now = Date.now();
      if (!update) {
        pendingUpdateRef.current = null;
        setState((s) =>
          s.phase === "ready"
            ? { ...s, lastCheckedAt: now, checking: false }
            : { ...s, phase: "idle", checking: false, update: null, downloaded: false, downloadProgress: 0, lastCheckedAt: now }
        );
        return;
      }
      pendingUpdateRef.current = update;
      const info = { version: update.version, body: update.body ?? undefined, date: update.date ?? undefined };
      setState((s) =>
        s.phase === "ready" && s.update?.version === update.version
          ? { ...s, lastCheckedAt: now, checking: false }
          : { ...s, phase: "available", checking: false, update: info, downloaded: false, downloadProgress: 0, lastCheckedAt: now }
      );
      if (readAutoDownload() && handledVersionRef.current !== update.version) {
        handledVersionRef.current = update.version;
        void downloadAndInstall();
      }
    } catch (err) {
      setState((s) => ({ ...s, phase: s.phase === "ready" ? "ready" : "error", checking: false, error: humanizeUpdateError(err), lastCheckedAt: Date.now() }));
    }
  }, [downloadAndInstall]);

  const relaunch = useCallback(async () => {
    if (!isTauriRuntime()) return;
    const { relaunch } = await import("@tauri-apps/plugin-process");
    await relaunch();
  }, []);

  const setAutoDownload = useCallback((on: boolean) => {
    try {
      localStorage.setItem(AUTO_DOWNLOAD_KEY, on ? "1" : "0");
    } catch {
      // ignore
    }
    setState((s) => ({ ...s, autoDownload: on }));
    if (on && pendingUpdateRef.current && !downloadingRef.current) {
      handledVersionRef.current = pendingUpdateRef.current.version ?? null;
      void downloadAndInstall();
    }
  }, [downloadAndInstall]);

  const value = useMemo<AppUpdateContextValue>(
    () => ({ ...state, checkForUpdate, downloadAndInstall, relaunch, setAutoDownload }),
    [state, checkForUpdate, downloadAndInstall, relaunch, setAutoDownload]
  );

  return <AppUpdateContext.Provider value={value}>{children}</AppUpdateContext.Provider>;
}

export function useAppUpdate() {
  const ctx = useContext(AppUpdateContext);
  return ctx;
}
