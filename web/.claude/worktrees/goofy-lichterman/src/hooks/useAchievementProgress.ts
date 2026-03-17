/**
 * Načte aktuální progress pro achievementy (počet zakázek, zákazníků atd.).
 * Používá se pro zobrazení "Zbývá X/Y" na stránce Achievementy.
 */

import { useState, useEffect } from "react";
import { supabase } from "../lib/supabaseClient";
import { ACHIEVEMENT_DEFS } from "../lib/achievements";

export type AchievementProgress = Record<string, { current: number; target: number }>;

export function useAchievementProgress(
  userId: string | null,
  activeServiceId: string | null,
  servicesCount?: number
): AchievementProgress {
  const [progress, setProgress] = useState<AchievementProgress>({});

  useEffect(() => {
    if (!userId || !activeServiceId || !supabase) {
      setProgress({});
      return;
    }

    let cancelled = false;

    const load = async () => {
      const client = supabase;
      if (!client) {
        if (!cancelled) setProgress({});
        return;
      }
      try {
        const { count: ticketCount } = await (client.from("tickets") as any)
          .select("*", { count: "exact", head: true })
          .eq("service_id", activeServiceId)
          .is("deleted_at", null);

        const { count: customerCount } = await (client.from("customers") as any)
          .select("*", { count: "exact", head: true })
          .eq("service_id", activeServiceId);

        if (cancelled) return;

        const t = typeof ticketCount === "number" ? ticketCount : 0;
        const c = typeof customerCount === "number" ? customerCount : 0;

        const map: AchievementProgress = {};
        for (const def of ACHIEVEMENT_DEFS) {
          if (!def.progressTarget) continue;
          let current = 0;
          switch (def.id) {
            case "first_ticket":
            case "tickets_10":
            case "tickets_50":
            case "tickets_100":
            case "tickets_500":
            case "tickets_1000":
              current = t;
              break;
            case "service_tickets_10":
            case "service_tickets_100":
            case "service_tickets_500":
              current = t;
              break;
            case "first_customer":
            case "customers_10":
              current = c;
              break;
            case "multiservice":
              current = servicesCount ?? 0;
              break;
            default:
              continue;
          }
          map[def.id] = { current: Math.min(current, def.progressTarget), target: def.progressTarget };
        }
        setProgress(map);
      } catch {
        if (!cancelled) setProgress({});
      }
    };

    load();
    return () => {
      cancelled = true;
    };
  }, [userId, activeServiceId, servicesCount]);

  return progress;
}
