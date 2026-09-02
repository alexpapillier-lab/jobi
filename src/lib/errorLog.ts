/**
 * Sběr chyb do centrální tabulky `error_logs`.
 *
 * Účel: majitel aplikace vidí napříč všemi servisy, komu co nefunguje,
 * aniž by musel obvolávat zákazníky.
 *
 * ZÁSADNÍ PRAVIDLO – OSOBNÍ ÚDAJE:
 * Chybové hlášky běžně obsahují jména zákazníků, telefony, IMEI nebo texty
 * diagnostiky. Servisy jsou správci těch dat, my bychom se jejich centrálním
 * sbíráním stali zpracovatelem. Proto se každá hláška před odesláním čistí
 * (scrubPII) a do `context` patří jen technické identifikátory – nikdy
 * celé objekty zakázek nebo zákazníků.
 */

import { getSupabaseClient } from "./supabaseClient";

/**
 * ID běhu aplikace. Vzniká jednou při načtení a drží se do zavření okna.
 *
 * K čemu: uživatel napíše „kolem druhé mi nešlo uložit zakázku". Bez
 * společného ID se v logu hledá podle času a odhadu. S ním stačí najít
 * jeden záznam a všechny chyby z téhož běhu jsou pohromadě – včetně těch,
 * které se staly předtím a mohly být příčinou.
 *
 * Není to identifikátor uživatele; při každém spuštění je jiné.
 */
const SESSION_ID = (() => {
  try {
    const buf = new Uint8Array(8);
    crypto.getRandomValues(buf);
    return Array.from(buf, (b) => b.toString(16).padStart(2, "0")).join("");
  } catch {
    return Math.random().toString(16).slice(2, 18);
  }
})();

/** Pro zobrazení uživateli, ať ho může nadiktovat do hlášení. */
export function getSessionId(): string {
  return SESSION_ID;
}

/** Maximální délka hlášky a stacku, aby tabulka nebobtnala. */
const MAX_MESSAGE = 500;
const MAX_STACK = 2000;

/** Kolik chyb nejvýš odešleme za minutu (ochrana před smyčkou). */
const RATE_LIMIT_PER_MIN = 10;
let sentTimestamps: number[] = [];

/** Stejná chyba se neposílá znovu dřív než za 5 minut. */
const DEDUPE_MS = 5 * 60 * 1000;
const lastSentByKey = new Map<string, number>();

export type ErrorLogContext = Record<string, string | number | boolean | null>;

/**
 * Odstraní z textu osobní údaje.
 *
 * Záměrně konzervativní: radši zamaskovat víc než pustit ven telefon
 * zákazníka. Hláška zůstane čitelná – nahrazuje se typem údaje.
 */
export function scrubPII(input: string): string {
  if (!input) return "";
  return (
    input
      // e-maily
      .replace(/[\w.+-]+@[\w-]+\.[\w.-]+/g, "[email]")
      // IMEI a dlouhá sériová čísla (12+ číslic v řadě) – dřív než telefony,
      // aby se patnáctimístné IMEI neoznačilo jako telefon
      .replace(/\b\d{12,}\b/g, "[imei]")
      // Telefonní čísla: běh číslic a mezer, který má aspoň 9 číslic.
      // Počítá se až v callbacku, protože regulárním výrazem se to přes
      // volitelnou předvolbu spolehlivě zachytit nedá.
      .replace(/\+?\d[\d ]{7,}\d/g, (m) =>
        m.replace(/\D/g, "").length >= 9 ? "[telefon]" : m
      )
      // UUID zůstávají: jsou to technické identifikátory, ne osobní údaj
      .slice(0, MAX_MESSAGE)
  );
}

/** Na jaké platformě aplikace běží. */
function detectPlatform(): string {
  if (typeof window === "undefined") return "unknown";
  const isTauri = !!(window as unknown as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__;
  if (!isTauri) return "web";
  const ua = navigator.userAgent || "";
  if (/Windows|Win64|Win32/i.test(ua)) return "windows";
  if (/Mac OS X|Macintosh/i.test(ua)) return "macos";
  return "unknown";
}

function allowedByRateLimit(): boolean {
  const now = Date.now();
  sentTimestamps = sentTimestamps.filter((t) => now - t < 60_000);
  if (sentTimestamps.length >= RATE_LIMIT_PER_MIN) return false;
  sentTimestamps.push(now);
  return true;
}

export type LogErrorInput = {
  /** Strojový kód pro seskupování, např. "orders.create_failed". */
  code: string;
  error: unknown;
  /** Kde v aplikaci, např. "Orders.createTicket". */
  source?: string;
  serviceId?: string | null;
  /** Jen technické údaje – ticket_id, http status. Žádná osobní data. */
  context?: ErrorLogContext;
};

/**
 * Zaloguje chybu. Nikdy nevyhazuje výjimku a nic neblokuje – logování
 * se nesmí stát příčinou další chyby.
 */
export async function logError({ code, error, source, serviceId, context }: LogErrorInput): Promise<void> {
  try {
    if (!allowedByRateLimit()) return;

    const rawMessage = error instanceof Error ? error.message : String(error ?? "");
    const message = scrubPII(rawMessage) || "(bez hlášky)";

    const dedupeKey = `${code}|${message}`;
    const last = lastSentByKey.get(dedupeKey);
    if (last && Date.now() - last < DEDUPE_MS) return;

    const client = getSupabaseClient();
    if (!client) return;

    const { data: userRes } = await client.auth.getUser();
    const userId = userRes?.user?.id;
    // Bez přihlášení RLS zápis stejně nepustí.
    if (!userId) return;

    const stack = error instanceof Error && error.stack ? scrubPII(error.stack).slice(0, MAX_STACK) : null;

    lastSentByKey.set(dedupeKey, Date.now());

    await (client.from("error_logs") as unknown as {
      insert: (v: Record<string, unknown>) => Promise<unknown>;
    }).insert({
      service_id: serviceId ?? null,
      user_id: userId,
      code,
      message,
      stack,
      source: source ?? null,
      context: { ...(context ?? {}), session_id: SESSION_ID },
      app_version: import.meta.env.VITE_APP_VERSION ?? null,
      platform: detectPlatform(),
    });
  } catch {
    // Logování chyb nesmí samo shodit aplikaci.
  }
}
