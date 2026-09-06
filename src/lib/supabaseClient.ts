import { createClient } from "@supabase/supabase-js";
import { devLog, devWarn } from "./devLog";
import { authStorage } from "./authStorage";

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

function isTauri(): boolean {
  return typeof window !== "undefined" && !!(window as unknown as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__;
}

let cachedTauriFetch: typeof fetch | null = null;
let tauriFetchLoadFailed = false;

/**
 * Nativní fetch webview místo HTTP pluginu Tauri, když ho webview pustí.
 *
 * Plugin (tauri-plugin-http 2.5.7) zakládá pro každý požadavek nový
 * reqwest klient s vlastním poolem spojení; při desítkách požadavků za
 * minutu (realtime, obnovování panelů) se po čase vyčerpají sokety a všechno
 * padá na „error sending request“, dokud se aplikace nerestartuje. Nativní
 * fetch webview drží jeden pool jako prohlížeč. Jestli ho webview pustí
 * (CORS z tauri://localhost), se zjistí jedním pokusem při startu; když ne,
 * zůstane plugin. Při selhání pluginu se navíc zkusí nativní cesta.
 */
type NativniStav = "nezjisteno" | "ano" | "ne";
let nativniFetchStav: NativniStav = "nezjisteno";
let nativniOvereni: Promise<NativniStav> | null = null;

function overNativniFetch(): Promise<NativniStav> {
  if (nativniFetchStav !== "nezjisteno") return Promise.resolve(nativniFetchStav);
  if (nativniOvereni) return nativniOvereni;
  nativniOvereni = (async () => {
    try {
      if (!supabaseUrl || typeof window === "undefined" || typeof window.fetch !== "function") return (nativniFetchStav = "ne");
      // /auth/v1/health odpovídá bez tokenu; jde jen o to, jestli webview požadavek pustí ven.
      const r = await window.fetch(`${supabaseUrl}/auth/v1/health`, { headers: supabaseAnonKey ? { apikey: supabaseAnonKey } : undefined });
      nativniFetchStav = r.status > 0 ? "ano" : "ne";
    } catch (e) {
      devWarn(`${LOG} nativní fetch ve webview neprošel, zůstává HTTP plugin:`, e instanceof Error ? e.message : String(e));
      nativniFetchStav = "ne";
    }
    devLog(`${LOG} nativní fetch: ${nativniFetchStav}`);
    return nativniFetchStav;
  })();
  return nativniOvereni;
}

const LOG = "[supabaseFetch]";

/**
 * Kdy naposled Supabase odpověděl (jakýkoli HTTP stav = server je na příjmu).
 *
 * Slouží OnlineGate: dokud běžné dotazy aplikace procházejí, nemá smysl
 * hlásit „Cloud není dostupný“ kvůli jednomu kontrolnímu pingu, který se
 * v Tauri umí zaseknout. Tím zmizí falešné poplachy, kvůli kterým lidé
 * restartovali aplikaci.
 */
let lastResponseAt = 0;

/** Volá se po každé odpovědi Supabase. */
export function markSupabaseReachable(): void {
  lastResponseAt = Date.now();
}

/** Milisekundy od poslední odpovědi Supabase; Infinity, když ještě žádná nebyla. */
export function msSinceSupabaseResponse(): number {
  return lastResponseAt === 0 ? Number.POSITIVE_INFINITY : Date.now() - lastResponseAt;
}
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
      if ((await overNativniFetch()) === "ano") {
        const res = await window.fetch(input, initClean ?? init);
        markSupabaseReachable();
        return res;
      }
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
        markSupabaseReachable();
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
        // Plugin selhal (typicky vyčerpaná spojení) – nativní fetch může projít; když ano, jede se dál nativně.
        try {
          const res = await window.fetch(input, initClean ?? init);
          markSupabaseReachable();
          nativniFetchStav = "ano";
          devWarn(`${LOG} HTTP plugin selhal, nativní fetch prošel – přepínám na nativní.`);
          return res;
        } catch {
          return Promise.reject(e);
        }
      }
    }

    const res = await fetch(input, initClean ?? init);
    markSupabaseReachable();
    return res;
  })();
}

/**
 * Zámek relace pro supabase-js – vlastní, protože ten vestavěný hlásí ve
 * Firefoxu chybu do konzole.
 *
 * Supabase si obnovu tokenu jistí zámkem přes Web Locks, aby dvě otevřené
 * karty nesáhly na jeden refresh token naráz. Když zámek zrovna volný není
 * (typicky hned po startu, kdy ho drží vlastní inicializace), vyhodí uvnitř
 * callbacku výjimku. Chrome i Safari ji berou jako obslouženou – vnější
 * `catch` ji chytí a obnova se jen o kolečko odloží. **Firefox ji navíc
 * nahlásí jako neodchycenou chybu stránky**, i když ji nahoře někdo chytí;
 * v konzoli tak při každém načtení svítí červená hláška, která nic neznamená.
 * (Ověřeno testem: throw uvnitř `navigator.locks.request` je ve Firefoxu
 * hlášen jako `pageerror`, v Chromiu ani WebKitu ne.)
 *
 * Tahle verze dělá totéž, jen z callbacku nikdy nevyhodí – výsledek i případnou
 * chybu si odloží stranou a vyhodí je až venku. `isAcquireTimeout` je značka,
 * podle které supabase-js pozná, že má obnovu jen přeskočit.
 */
async function zamekRelace<R>(nazev: string, cekatMs: number, fn: () => Promise<R>): Promise<R> {
  const locks = typeof navigator !== "undefined" ? (navigator as Navigator & { locks?: LockManager }).locks : undefined;
  // Bez Web Locks (starší Safari, nezabezpečený kontext) se jede bez zámku –
  // stejně jako to dělá supabase-js sám.
  if (!locks) return fn();

  let ziskano = false;
  let hotovo = false;
  let vysledek: R | undefined;
  let chyba: unknown;

  const spust = async (lock: Lock | null) => {
    if (!lock) return;
    ziskano = true;
    try {
      vysledek = await fn();
      hotovo = true;
    } catch (e) {
      chyba = e;
    }
  };

  if (cekatMs === 0) {
    await locks.request(nazev, { mode: "exclusive", ifAvailable: true }, spust);
  } else if (cekatMs > 0) {
    const rizeni = new AbortController();
    const casovac = setTimeout(() => rizeni.abort(), cekatMs);
    try {
      await locks.request(nazev, { mode: "exclusive", signal: rizeni.signal }, spust);
    } finally {
      clearTimeout(casovac);
    }
  } else {
    await locks.request(nazev, { mode: "exclusive" }, spust);
  }

  if (chyba) throw chyba;
  if (!ziskano || !hotovo) {
    const e = new Error(`Zámek relace „${nazev}“ nebyl hned volný.`) as Error & { isAcquireTimeout: boolean };
    e.isAcquireTimeout = true;
    throw e;
  }
  return vysledek as R;
}

let supabase: ReturnType<typeof createClient> | null = null;

if (supabaseUrl && supabaseAnonKey) {
  supabase = createClient(supabaseUrl, supabaseAnonKey, {
    global: { fetch: supabaseFetch },
    auth: {
      // Explicitně: přihlášení se drží mezi spuštěními a token se sám obnovuje.
      // `storage` rozhoduje podle volby „Zapamatovat přihlášení“ (viz authStorage).
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true,
      storage: authStorage,
      lock: zamekRelace,
    },
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
