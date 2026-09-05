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

export type ModuleName = "sms" | "invoices" | "api_catalog" | "api_inventory" | "branches" | "accounting";

type State = {
  /** Které moduly má servis aktivní. */
  modules: Set<ModuleName>;
  loading: boolean;
};

/** Kolik kusů modulu má servis zaplaceno (dnes počet poboček). */
type Quotas = Partial<Record<ModuleName, number>>;

export function useEntitlements(activeServiceId: string | null): State & {
  has: (m: ModuleName) => boolean;
  /** Konec zkušebního období (ISO), nebo null u servisu bez časového omezení. */
  trialEndsAt: string | null;
  /** Zbývající dny; záporné číslo = už skončilo. */
  trialDaysLeft: number | null;
  /** Limit počtu kusů modulu; null = bez omezení nebo modul není aktivní. */
  quota: (m: ModuleName) => number | null;
  refresh: () => void;
} {
  const [modules, setModules] = useState<Set<ModuleName>>(new Set());
  const [quotas, setQuotas] = useState<Quotas>({});
  /** Konec zkušebního období = nejzazší platnost mezi časově omezenými nároky. */
  const [trialEndsAt, setTrialEndsAt] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    if (!activeServiceId || !supabase) {
      // Nový Set je pokaždé jiná reference – viz useActiveRole.
      setModules((prev) => (prev.size === 0 ? prev : new Set()));
      setQuotas({});
      setTrialEndsAt(null);
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
      type EntitlementRow = { module: string; active: boolean; valid_until: string | null; quota: number | null };
      const { data, error } = (await (supabase.from("service_entitlements") as never as {
        select: (c: string) => {
          eq: (a: string, b: unknown) => {
            eq: (a: string, b: unknown) => Promise<{ data: EntitlementRow[] | null; error: unknown }>;
          };
        };
      })
        .select("module, active, valid_until, quota")
        .eq("service_id", activeServiceId)
        .eq("active", true));

      if (cancelled) return;
      if (error || !data) {
        // Při chybě raději nic nezpřístupnit – server by to stejně odmítl.
        setModules(new Set());
        setQuotas({});
        setTrialEndsAt(null);
      } else {
        const live = data.filter((r) => !r.valid_until || r.valid_until > nowIso);
        setModules(new Set(live.map((r) => r.module as ModuleName)));
        const q: Quotas = {};
        for (const r of live) {
          if (typeof r.quota === "number") q[r.module as ModuleName] = r.quota;
        }
        setQuotas(q);
        // Časově omezené nároky drží i po vypršení (aplikace pak umí říct,
        // že zkušební období skončilo, místo aby moduly beze slova zmizely).
        const konce = data.map((r) => r.valid_until).filter((v): v is string => typeof v === "string");
        setTrialEndsAt(konce.length > 0 ? konce.sort().slice(-1)[0] : null);
      }
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [activeServiceId, tick]);

  const has = useCallback((m: ModuleName) => modules.has(m), [modules]);
  const quota = useCallback((m: ModuleName) => quotas[m] ?? null, [quotas]);
  const refresh = useCallback(() => setTick((t) => t + 1), []);

  // Dny se počítají při načtení nároků, ne při každém vykreslení – Date.now()
  // v renderu je nestabilní vstup a aplikace by se překreslovala na půlnoci.
  const [ted, setTed] = useState(() => Date.now());
  useEffect(() => {
    setTed(Date.now());
    // Jednou za hodinu stačí; zbývající dny se rychleji nemění.
    const id = setInterval(() => setTed(Date.now()), 3_600_000);
    return () => clearInterval(id);
  }, [trialEndsAt]);

  const trialDaysLeft = trialEndsAt
    ? Math.ceil((new Date(trialEndsAt).getTime() - ted) / 86_400_000)
    : null;

  return { modules, loading, has, quota, trialEndsAt, trialDaysLeft, refresh };
}
