import { createClient } from "@supabase/supabase-js";

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

/** V Tauri webviewu může výchozí fetch blokovat požadavky na Supabase. Tento wrapper používá Tauri HTTP plugin, který respektuje capabilities (včetně *.supabase.co). */
function supabaseFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  return (async () => {
    try {
      const { fetch: tauriFetch } = await import("@tauri-apps/plugin-http");
      return tauriFetch(input, init);
    } catch {
      return fetch(input, init);
    }
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

export { supabase };
export function getSupabaseClient() {
  return supabase;
}
