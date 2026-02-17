import { createClient } from "@supabase/supabase-js";

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

function isTauri(): boolean {
  return typeof window !== "undefined" && !!(window as unknown as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__;
}

let cachedTauriFetch: typeof fetch | null = null;
let tauriFetchLoadFailed = false;

const LOG = "[supabaseFetch]";

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

    console.log(`${LOG} request url=${url} inTauri=${inTauri} cachedTauriFetch=${!!cachedTauriFetch} tauriFetchLoadFailed=${tauriFetchLoadFailed}`);

    if (inTauri) {
      if (tauriFetchLoadFailed) {
        console.warn(`${LOG} skipping fetch – previous load failed`);
        return Promise.reject(
          new Error(
            "Nelze načíst síťový modul. Restartujte aplikaci (Úpravy → ukončit a znovu spustit Jobi)."
          )
        );
      }
      try {
        if (!cachedTauriFetch) {
          console.log(`${LOG} loading @tauri-apps/plugin-http...`);
          const mod = await import("@tauri-apps/plugin-http");
          cachedTauriFetch = mod.fetch;
          console.log(`${LOG} plugin-http loaded ok`);
        }
        console.log(`${LOG} calling tauriFetch(${url})`);
        const response = await cachedTauriFetch(input, initClean);
        console.log(`${LOG} tauriFetch response status=${response?.status} ok=${response?.ok} url=${response?.url}`);
        return response;
      } catch (e) {
        tauriFetchLoadFailed = true;
        const err = e instanceof Error ? e : new Error(String(e));
        const cause = err.cause instanceof Error ? { message: err.cause.message, name: err.cause.name } : err.cause;
        console.error(`${LOG} Tauri plugin-http load or fetch FAILED:`, {
          message: err.message,
          name: err.name,
          cause,
          stack: err.stack,
          // Supabase FunctionsFetchError má .context (Response)
          context: (e as { context?: unknown }).context,
        });
        return Promise.reject(e);
      }
    }

    console.log(`${LOG} using global fetch (browser)`);
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
