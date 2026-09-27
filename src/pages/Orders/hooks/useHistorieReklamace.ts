/**
 * Historie reklamace (warranty_claim_history) – načte se při otevření modálu.
 * Vyneseno z Orders.tsx beze změny obsahu; názvy stavů zůstávají.
 */
import { useEffect, useState } from "react";
import { supabase } from "../../../lib/supabaseClient";
import type { ZaznamHistorie } from "../HistorieZakazkyModal";

export function useHistorieReklamace(claimHistoryModalOpen: boolean, detailClaimId: string | null, activeServiceId: string | null) {
  const [claimHistoryEntries, setClaimHistoryEntries] = useState<ZaznamHistorie[]>([]);
  const [claimHistoryLoading, setClaimHistoryLoading] = useState(false);
  const [claimHistoryError, setClaimHistoryError] = useState<string | null>(null);
  // Load claim history when claim history modal opens
  useEffect(() => {
    if (!claimHistoryModalOpen || !detailClaimId || !supabase || !activeServiceId) {
      if (!claimHistoryModalOpen) {
        setClaimHistoryEntries([]);
        setClaimHistoryError(null);
      }
      return;
    }
    const claimId = detailClaimId;
    setClaimHistoryLoading(true);
    setClaimHistoryError(null);
    (async () => {
      try {
        const { data: rows, error } = await (supabase as any)
          .from("warranty_claim_history")
          .select("id, action, changed_by, created_at, details")
          .eq("warranty_claim_id", claimId)
          .order("created_at", { ascending: false });
        if (error) throw error;
        const entries = (rows || []) as Array<{ id: string; action: string; changed_by: string | null; created_at: string; details: Record<string, unknown> }>;
        const userIds = [...new Set(entries.map((e) => e.changed_by).filter(Boolean))] as string[];
        const nicknames: Record<string, string> = {};
        if (userIds.length > 0) {
          const { data: profiles } = await (supabase as any).from("profiles").select("id, nickname").in("id", userIds);
          if (profiles) {
            for (const p of profiles) {
              if (p.nickname) nicknames[p.id] = p.nickname;
            }
          }
        }
        setClaimHistoryEntries(
          entries.map((e) => ({ ...e, nickname: (e.changed_by && nicknames[e.changed_by]) || null }))
        );
      } catch (err) {
        console.error("[Orders] claim history load error", err);
        setClaimHistoryError(err instanceof Error ? err.message : "Nelze načíst historii");
        setClaimHistoryEntries([]);
      } finally {
        setClaimHistoryLoading(false);
      }
    })();
  }, [claimHistoryModalOpen, detailClaimId, activeServiceId, supabase]);

  return { claimHistoryEntries, claimHistoryLoading, claimHistoryError };
}
