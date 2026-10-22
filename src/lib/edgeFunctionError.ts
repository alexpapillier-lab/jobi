/**
 * Text chyby z volání edge funkce, který je k něčemu.
 *
 * Při odpovědi mimo 2xx vrátí supabase-js obecnou větu „Edge Function returned
 * a non-2xx status code“ a skutečný důvod, který funkce poslala v těle
 * (`{"error":"Pozvánka nenalezena"}`), schová do `error.context` – což je
 * neotevřená `Response`. Kdo jen přepošle `error.message`, ukáže uživateli
 * větu, ze které se nedá poznat, co je špatně.
 */
export async function textChybyFunkce(err: unknown, vychozi: string): Promise<string> {
  const ctx = (err as { context?: unknown } | null)?.context;
  if (ctx && typeof (ctx as Response).clone === "function") {
    try {
      const telo = await (ctx as Response).clone().json();
      if (telo && typeof telo.error === "string" && telo.error.trim()) return telo.error.trim();
    } catch {
      // tělo není JSON – spadneme na zprávu chyby níž
    }
  }
  if (err instanceof Error && err.message && !/non-2xx/i.test(err.message)) return err.message;
  return vychozi;
}
