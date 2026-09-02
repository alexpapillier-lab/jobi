import { useCallback, useEffect, useState } from "react";
import { supabase } from "../lib/supabaseClient";

/**
 * Nároky servisu na placené moduly.
 *
 * Čte se z tabulky service_entitlements, kterou smí měnit jen majitel
 * aplikace přes Edge Function entitlements-manage. Členové servisu mají
 * podle RLS jen čtení.
 *
 * DŮLEŽITÉ: tenhle hook slouží k tomu, aby UI neukazovalo, co si servis
 * nezaplatil. NENÍ to bezpečnostní prvek – kdo si otevře vývojářské
 * nástroje, zavolá edge funkci přímo. Skutečná kontrola je na serveru,
 * viz has_entitlement() v sms-send, sms-provision a invoice-send-email.
 */

export type ModuleName = "sms" | "invoices" | "api_catalog" | "api_inventory";

type State = {
  /** Které moduly má servis aktivní. */
  modules: Set<ModuleName>;
  loading: boolean;
};

export function useEntitlements(activeServiceId: string | null): State & {
  has: (m: ModuleName) => boolean;
  refresh: () => void;
} {
  const [modules, setModules] = useState<Set<ModuleName>>(new Set());
  const [loading, setLoading] = useState(true);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    if (!activeServiceId || !supabase) {
      // Nový Set je pokaždé jiná reference – viz useActiveRole.
      setModules((prev) => (prev.size === 0 ? prev : new Set()));
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    (async () => {
      const nowIso = new Date().toISOString();
      // Vygenerované typy Supabase tuhle tabulku zatím neznají
      // (types/supabase.ts se generuje ze schématu). Stejná obezlička
      // jako jinde v kódu; až se typy přegenerují, dá se odstranit.
      type EntitlementRow = { module: string; active: boolean; valid_until: string | null };
      const { data, error } = (await (supabase.from("service_entitlements") as never as {
        select: (c: string) => {
          eq: (a: string, b: unknown) => {
            eq: (a: string, b: unknown) => Promise<{ data: EntitlementRow[] | null; error: unknown }>;
          };
        };
      })
        .select("module, active, valid_until")
        .eq("service_id", activeServiceId)
        .eq("active", true));

      if (cancelled) return;
      if (error || !data) {
        // Při chybě raději nic nezpřístupnit – server by to stejně odmítl.
        setModules(new Set());
      } else {
        const live = data.filter((r) => !r.valid_until || r.valid_until > nowIso);
        setModules(new Set(live.map((r) => r.module as ModuleName)));
      }
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [activeServiceId, tick]);

  const has = useCallback((m: ModuleName) => modules.has(m), [modules]);
  const refresh = useCallback(() => setTick((t) => t + 1), []);

  return { modules, loading, has, refresh };
}
