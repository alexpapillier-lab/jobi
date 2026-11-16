/**
 * Historie zakázky (ticket_history) – načte se při otevření modálu Historie.
 * Vyneseno z Orders.tsx beze změny obsahu; názvy stavů zůstávají.
 */
import { useEffect, useState } from "react";
import { supabase } from "../../../lib/supabaseClient";
import { useAuth } from "../../../auth/AuthProvider";
import { autorProOstatni } from "../../../lib/rootOwner";
import type { ZaznamHistorie } from "../HistorieZakazkyModal";
import { historiePrepravy, nactiZasilkyZakazky } from "../../../lib/zasilky";
import { nactiObjednavkyDpdZasilek } from "../../../lib/prepravaDpd";
import { getCachedBranch } from "../../../lib/branches";

/**
 * Přeprava zakázky (zásilky mezi pobočkami, DPD) jako řádky historie.
 * Je to doplněk – když se nenačte (servis bez zásilek, výpadek), historie
 * zakázky se ukáže i bez něj.
 */
async function nactiPrepravu(ticketId: string, serviceId: string): Promise<ZaznamHistorie[]> {
  try {
    const zasilky = await nactiZasilkyZakazky(ticketId);
    if (zasilky.length === 0) return [];
    const dpd = await nactiObjednavkyDpdZasilek(zasilky.map((z) => z.id)).catch(() => []);
    const nazev = (id: string) => getCachedBranch(serviceId, id)?.name ?? "jiná pobočka";
    return historiePrepravy(ticketId, zasilky, dpd, nazev).map((u) => ({
      id: u.id,
      action: "preprava",
      changed_by: u.kdo,
      created_at: u.kdy,
      details: { titulek: u.titulek, popis: u.popis },
      nickname: null,
    }));
  } catch (e) {
    console.warn("[Orders] přeprava do historie se nenačetla", e);
    return [];
  }
}

export function useHistorieZakazky(ticketHistoryModalOpen: boolean, detailId: string | null, activeServiceId: string | null) {
  const { session } = useAuth();
  const mojeId = session?.user?.id ?? null;
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
        const preprava = await nactiPrepravu(ticketId, activeServiceId);
        type Radek = { id: string; action: string; changed_by: string | null; created_at: string; details: Record<string, unknown> };
        // „Upravena · Kde zakázka je, Zásilka“ je jen technická stopa odeslání
        // a převzetí – řádky přepravy totéž říkají srozumitelně, tak se skryje.
        const jenStopaPrepravy = (r: Radek) => {
          const zmeny = r.details?.changes;
          if (r.action !== "updated" || !zmeny || typeof zmeny !== "object") return false;
          const klice = Object.keys(zmeny as Record<string, unknown>);
          return klice.length > 0 && klice.every((k) => k === "transit_shipment_id" || k === "location_branch_id");
        };
        const historie = ((rows || []) as Radek[]).filter((r) => preprava.length === 0 || !jenStopaPrepravy(r));
        // Změna od majitele aplikace se ostatním ukáže jako „Systém“ (bez autora).
        const entries = [...historie, ...preprava]
          .map((e) => ({ ...e, changed_by: autorProOstatni(e.changed_by, mojeId) }))
          .sort((a, b) => b.created_at.localeCompare(a.created_at));
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
  }, [ticketHistoryModalOpen, detailId, activeServiceId, supabase, mojeId]);

  return { ticketHistoryEntries, ticketHistoryLoading, ticketHistoryError, ticketHistoryExpandedId, setTicketHistoryExpandedId };
}
