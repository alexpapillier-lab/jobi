/** Stub @tauri-apps/plugin-http pro web – použije se běžný fetch prohlížeče. */
import type * as Skutecny from "@tauri-apps/plugin-http";

// connectTimeout a další ClientOptions prohlížečový fetch ignoruje; to je v pořádku,
// v prohlížeči žádné CORS obcházení přes Rust neděláme.
export const fetch: typeof Skutecny.fetch = globalThis.fetch.bind(globalThis);
