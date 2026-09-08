import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "../lib/supabaseClient";

/**
 * Členové servisu pro výběr technika a překlad id → jméno.
 *
 * Člen smí podle RLS číst jen své vlastní členství, proto jde seznam přes
 * funkci `clenove_servisu` (jména a fotky, ne e-maily). Načítá se jen když
 * má servis přidělování zapnuté – jinak by se to ptalo zbytečně.
 */
export type ClenServisu = { userId: string; jmeno: string; avatarUrl: string | null; role: string };

export function useClenoveServisu(serviceId: string | null, zapnuto: boolean) {
  const [clenove, setClenove] = useState<ClenServisu[]>([]);

  useEffect(() => {
    if (!serviceId || !zapnuto || !supabase) { setClenove([]); return; }
    let zruseno = false;
    void (supabase as any).rpc("clenove_servisu", { p_service_id: serviceId }).then(({ data, error }: { data: any[] | null; error: unknown }) => {
      if (zruseno || error || !Array.isArray(data)) return;
      setClenove(
        data.map((r) => ({
          userId: String(r.user_id),
          jmeno: (typeof r.nickname === "string" && r.nickname.trim()) || "Kolega",
          avatarUrl: typeof r.avatar_url === "string" ? r.avatar_url : null,
          role: String(r.role ?? ""),
        }))
      );
    });
    return () => { zruseno = true; };
  }, [serviceId, zapnuto]);

  const podleId = useMemo(() => new Map(clenove.map((c) => [c.userId, c])), [clenove]);
  const jmeno = useCallback((userId: string | null | undefined): string | null => (userId ? podleId.get(userId)?.jmeno ?? null : null), [podleId]);

  return useMemo(() => ({ clenove, jmeno }), [clenove, jmeno]);
}
