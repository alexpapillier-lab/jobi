/**
 * Historie zakázky (ticket_history) – načte se při otevření modálu Historie.
 * Vyneseno z Orders.tsx beze změny obsahu; názvy stavů zůstávají.
 */
import { useEffect, useState } from "react";
import { supabase } from "../../../lib/supabaseClient";
import type { ZaznamHistorie } from "../HistorieZakazkyModal";

export function useHistorieZakazky(ticketHistoryModalOpen: boolean, detailId: string | null, activeServiceId: string | null) {
  const [ticketHistoryEntries, setTicketHistoryEntries] = useState<ZaznamHistorie[]>([]);
  const [ticketHistoryLoading, setTicketHistoryLoading] = useState(false);
  const [ticketHistoryError, setTicketHistoryError] = useState<string | null>(null);
  const [ticketHistoryExpandedId, setTicketHistoryExpandedId] = useState<string | null>(null);
  // Load ticket history when history modal opens
  useEffect(() => {
    if (!ticketHistoryModalOpen || !detailId || !supabase || !activeServiceId) {
      if (!ticketHistoryModalOpen) {
        setTicketHistoryEntries([]);
        setTicketHistoryError(null);
        setTicketHistoryExpandedId(null);
      }
      return;
    }
    const ticketId = detailId;
    setTicketHistoryLoading(true);
    setTicketHistoryError(null);
    (async () => {
      try {
        const { data: rows, error } = await (supabase as any)
          .from("ticket_history")
          .select("id, action, changed_by, created_at, details")
          .eq("ticket_id", ticketId)
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
        setTicketHistoryEntries(
          entries.map((e) => ({ ...e, nickname: (e.changed_by && nicknames[e.changed_by]) || null }))
        );
      } catch (err) {
        console.error("[Orders] ticket history load error", err);
        const code = (err as { code?: string })?.code;
        const msg = code === "PGRST205"
          ? "Historie zatím není k dispozici. V databázi chybí tabulka – spusť migraci (např. supabase db push)."
          : (err instanceof Error ? err.message : "Nelze načíst historii");
        setTicketHistoryError(msg);
        setTicketHistoryEntries([]);
      } finally {
        setTicketHistoryLoading(false);
      }
    })();
  }, [ticketHistoryModalOpen, detailId, activeServiceId, supabase]);

  return { ticketHistoryEntries, ticketHistoryLoading, ticketHistoryError, ticketHistoryExpandedId, setTicketHistoryExpandedId };
}
