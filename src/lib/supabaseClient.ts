import { createClient } from "@supabase/supabase-js";
import { devLog, devWarn } from "./devLog";

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

function isTauri(): boolean {
  return typeof window !== "undefined" && !!(window as unknown as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__;
}

let cachedTauriFetch: typeof fetch | null = null;
let tauriFetchLoadFailed = false;

const LOG = "[supabaseFetch]";
const VERBOSE = import.meta.env.VITE_SUPABASE_FETCH_VERBOSE === "1";

/** Resetuje stav při selhání síťového modulu. Volá se při visibility change nebo při explicitním „Zkusit znovu“. */
export function resetTauriFetchState(): void {
  if (tauriFetchLoadFailed || cachedTauriFetch) {
    tauriFetchLoadFailed = false;
    cachedTauriFetch = null;
    if (VERBOSE) devLog(`${LOG} reset tauriFetch state`);
  }
}

if (typeof document !== "undefined") {
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") resetTauriFetchState();
  });
}

/** V Tauri webviewu výchozí fetch blokuje cross-origin (Supabase). Používáme Tauri HTTP plugin. */
export function supabaseFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  return (async () => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : (input as Request).url;
    const inTauri = isTauri();
    // Odstranit AbortSignal – plugin-http s ním může padat
    const initClean = init ? { ...init } : undefined;
    if (initClean && "signal" in initClean) {
      delete (initClean as Record<string, unknown>).signal;
    }

    if (VERBOSE) devLog(`${LOG} request url=${url}`);

    if (inTauri) {
      if (tauriFetchLoadFailed) {
        devWarn(`${LOG} skipping – previous load failed. Zkuste „Zkusit znovu“ nebo přepnout záložku a vrátit se.`);
        return Promise.reject(
          new Error("Nelze načíst síťový modul. Restartujte aplikaci (Úpravy → ukončit a znovu spustit Jobi), nebo zkuste „Zkusit znovu“ na obrazovce chyby.")
        );
      }
      // 1) Načíst plugin – selhání je trvalé (tauriFetchLoadFailed), vyžaduje restart
      try {
        if (!cachedTauriFetch) {
          const mod = await import("@tauri-apps/plugin-http");
          cachedTauriFetch = mod.fetch;
        }
      } catch (loadErr) {
        tauriFetchLoadFailed = true;
        const err = loadErr instanceof Error ? loadErr : new Error(String(loadErr));
        console.error(`${LOG} Tauri plugin-http LOAD failed:`, { message: err.message, cause: err.cause });
        return Promise.reject(err);
      }
      // 2) Fetch – prodloužený connectTimeout (60s) kvůli Supabase cold start a pomalým sítím
      const initWithTimeout = {
        ...initClean,
        connectTimeout: 60_000,
      };
      try {
        const response = await cachedTauriFetch!(input, initWithTimeout);
        return response;
      } catch (e) {
        const err = e instanceof Error ? e : new Error(String(e));
        const cause = err.cause instanceof Error ? { message: err.cause.message, name: err.cause.name } : err.cause;
        const msg = (err.message + " " + (cause && typeof cause === "object" && "message" in cause ? String(cause.message) : "")).toLowerCase();
        const isAuthLike = /401|jwt|invalid.*token|unauthorized|token.*expired|session.*expired|auth/i.test(msg);
        if (isAuthLike) {
          console.error(`${LOG} Auth/JWT related error:`, { message: err.message, cause });
          return Promise.reject(
            new Error("Přihlášení vypršelo. Odhlaste se a přihlaste znovu.")
          );
        }
        console.warn(`${LOG} Fetch failed (ne-blokuje další requesty):`, { message: err.message, cause });
        return Promise.reject(e);
      }
    }

    return fetch(input, initClean ?? init);
  })();
}

let supabase: ReturnType<typeof createClient> | null = null;

if (supabaseUrl && supabaseAnonKey) {
  supabase = createClient(supabaseUrl, supabaseAnonKey, {
    global: { fetch: supabaseFetch },
  });
} else {
  console.error(
    "[supabaseClient] Missing environment variables: VITE_SUPABASE_URL or VITE_SUPABASE_ANON_KEY"
  );
}

export { supabase, supabaseUrl, supabaseAnonKey };
export function getSupabaseClient() {
  return supabase;
}
