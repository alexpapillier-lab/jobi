/**
 * Realtime odběr tabulky tickets: vložení, změna, obnovení a smazání zakázky
 * se promítnou do seznamu. Řádek z databáze se slučuje s pamětí podle
 * evidence zápisů (src/lib/slouceniZakazky.ts) – běžící, odložený nebo
 * neúspěšný okamžitý zápis oprav nesmí realtime přepsat.
 * Vyneseno z Orders.tsx beze změny obsahu (včetně závislostí efektu).
 */
import { useEffect, type Dispatch, type SetStateAction } from "react";
import { supabase } from "../../../lib/supabaseClient";
import { devLog } from "../../../lib/devLog";
import { showToast } from "../../../components/Toast";
import { sloucZakazkuZDb, type EvidenceZapisu } from "../../../lib/slouceniZakazky";
import { mapSupabaseTicketToTicketEx } from "../mapovani";
import type { TicketEx } from "../typy";

type Vstup = {
  activeServiceId: string | null;
  /** Otevřený detail v režimu úprav – kvůli hlášce „Zakázka se změnila na pozadí“. */
  isEditing: boolean;
  detailId: string | null;
  setCloudTickets: Dispatch<SetStateAction<TicketEx[]>>;
  evidenceZapisu: () => EvidenceZapisu;
};

export function useRealtimeZakazek({ activeServiceId, isEditing, detailId, setCloudTickets, evidenceZapisu }: Vstup) {
  // Realtime subscription for tickets
  useEffect(() => {
    if (!activeServiceId || !supabase) return;

    const topic = `tickets:${activeServiceId}`;
    devLog("[RT] subscribe", topic, new Date().toISOString());

    const channel = supabase
      .channel(topic)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "tickets",
          filter: `service_id=eq.${activeServiceId}`,
        },
        async (payload) => {
          devLog("[Orders] tickets changed", payload);
          
          if (payload.eventType === "INSERT" || payload.eventType === "UPDATE") {
            devLog("[RT tickets] event", payload.eventType, {
              id: (payload.new as any)?.id,
              service_id: (payload.new as any)?.service_id,
              status: (payload.new as any)?.status,
              updated_at: (payload.new as any)?.updated_at,
            });

            const newTicket = mapSupabaseTicketToTicketEx(payload.new as any);
            const wasDeleted = (payload.old as any)?.deleted_at != null;
            const isDeleted = (payload.new as any)?.deleted_at != null;
            
            // Handle restore: deleted_at changed from not null to null
            if (wasDeleted && !isDeleted) {
              // Ticket was restored - add it back
            setCloudTickets((prev) => {
                const existing = prev.find((t) => t.id === newTicket.id);
                devLog("[RT tickets] setCloudTickets (restore)", {
                  id: newTicket.id,
                  hadExisting: !!existing,
                  prevLen: prev.length,
                  newStatus: newTicket.status,
                });
                if (existing) {
                  // Update existing – stejné sloučení jako u běžné změny níže.
                  const sloucena = sloucZakazkuZDb(existing, newTicket, evidenceZapisu(), newTicket.id);
                  return prev.map((t) => (t.id === newTicket.id ? sloucena : t));
                } else {
                  // Add new - insert in correct position based on created_at
                  const sorted = [...prev, newTicket].sort((a, b) => {
                    const aTime = a.createdAt ? new Date(a.createdAt).getTime() : 0;
                    const bTime = b.createdAt ? new Date(b.createdAt).getTime() : 0;
                    return bTime - aTime; // Descending order (newest first)
                  });
                  return sorted;
                }
              });
            } else if (!isDeleted) {
              // Ticket is not deleted - upsert
              setCloudTickets((prev) => {
                const existing = prev.find((t) => t.id === newTicket.id);
                devLog("[RT tickets] setCloudTickets (upsert)", {
                  id: newTicket.id,
                  hadExisting: !!existing,
                  prevLen: prev.length,
                  newStatus: newTicket.status,
                  oldStatus: existing?.status,
                });
                
                // Check if this is the currently edited ticket and if version conflict occurred
                if (existing && isEditing && detailId === newTicket.id) {
                  const existingVersion = existing.version ?? 0;
                  const newVersion = newTicket.version ?? 0;
                  if (newVersion > existingVersion) {
                    // Remote update detected during editing - show banner/toast
                    devLog("[RT tickets] Remote update detected for edited ticket", {
                      ticketId: newTicket.id,
                      existingVersion,
                      newVersion,
                    });
                    showToast("Zakázka se změnila na pozadí", "info");
                  }
                }
                
                if (existing) {
                  // Provedené opravy se ukládají hned; dokud zápis běží, čeká na
                  // odklad, nebo selhal a čeká na zavření detailu, drží se místní
                  // verze. Jinak by změna stavu od kolegy vrátila opravy z databáze,
                  // které jsou o krok pozadu, a ve skladu by zůstala rezervace na
                  // opravu, kterou nikdo nevidí. Stejně se hned ukládá kontrola po
                  // opravě a náhradní zařízení – ozvěna staršího zápisu by přepsala
                  // kliknutí, které přišlo mezitím. Pravidlo: src/lib/slouceniZakazky.ts.
                  const sloucena = sloucZakazkuZDb(existing, newTicket, evidenceZapisu(), newTicket.id);
                  return prev.map((t) => (t.id === newTicket.id ? sloucena : t));
                } else {
                  // Add new - insert in correct position based on created_at
                  const sorted = [...prev, newTicket].sort((a, b) => {
                    const aTime = a.createdAt ? new Date(a.createdAt).getTime() : 0;
                    const bTime = b.createdAt ? new Date(b.createdAt).getTime() : 0;
                    return bTime - aTime; // Descending order (newest first)
                  });
                  return sorted;
                }
              });
            } else {
              // Ticket was soft-deleted (deleted_at changed from null to not null)
              setCloudTickets((prev) => prev.filter((t) => t.id !== newTicket.id));
            }
          } else if (payload.eventType === "DELETE") {
            // Hard delete - remove from list
            const deletedId = (payload.old as any)?.id || (payload.new as any)?.id;
            if (deletedId) {
            setCloudTickets((prev) => prev.filter((t) => t.id !== deletedId));
            }
          }
        }
      )
      .subscribe();

    return () => {
      devLog("[RT] unsubscribe", topic, new Date().toISOString());
      if (supabase) {
        supabase.removeChannel(channel);
      }
    };
  }, [activeServiceId, isEditing, detailId]);
}
