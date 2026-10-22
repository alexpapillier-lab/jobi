import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "../lib/supabaseClient";
import { useAuth } from "../auth/AuthProvider";
import { JMENO_SYSTEM, bezRootOwnera, skrytyRootOwner } from "../lib/rootOwner";

/**
 * Členové servisu pro výběr technika a překlad id → jméno.
 *
 * Člen smí podle RLS číst jen své vlastní členství, proto jde seznam přes
 * funkci `clenove_servisu` (jména a fotky, ne e-maily). Načítá se jen když
 * má servis přidělování zapnuté – jinak by se to ptalo zbytečně.
 *
 * Majitele aplikace funkce ostatním nevrací (migrace 20261009160000); když
 * se jeho id objeví v datech (přidělená zakázka, autor změny), `jmeno` vrátí
 * „Systém“. Filtr níž je jen pojistka pro databázi bez té migrace.
 */
export type ClenServisu = { userId: string; jmeno: string; avatarUrl: string | null; role: string };

export function useClenoveServisu(serviceId: string | null, zapnuto: boolean) {
  const [clenove, setClenove] = useState<ClenServisu[]>([]);
  const { session } = useAuth();
  const mojeId = session?.user?.id ?? null;

  useEffect(() => {
    if (!serviceId || !zapnuto || !supabase) { setClenove([]); return; }
    let zruseno = false;
    void (supabase as any).rpc("clenove_servisu", { p_service_id: serviceId }).then(({ data, error }: { data: any[] | null; error: unknown }) => {
      if (zruseno || error || !Array.isArray(data)) return;
      setClenove(
        bezRootOwnera(data, (r) => String(r.user_id), mojeId).map((r) => ({
          userId: String(r.user_id),
          jmeno: (typeof r.nickname === "string" && r.nickname.trim()) || "Kolega",
          avatarUrl: typeof r.avatar_url === "string" ? r.avatar_url : null,
          role: String(r.role ?? ""),
        }))
      );
    });
    return () => { zruseno = true; };
  }, [serviceId, zapnuto, mojeId]);

  const podleId = useMemo(() => new Map(clenove.map((c) => [c.userId, c])), [clenove]);
  const jmeno = useCallback(
    (userId: string | null | undefined): string | null => {
      if (!userId) return null;
      if (skrytyRootOwner(userId, mojeId)) return JMENO_SYSTEM;
      return podleId.get(userId)?.jmeno ?? null;
    },
    [podleId, mojeId]
  );

  return useMemo(() => ({ clenove, jmeno }), [clenove, jmeno]);
}
