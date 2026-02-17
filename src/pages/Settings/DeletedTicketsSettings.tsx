import { useState, useEffect } from "react";
import { useAuth } from "../../auth/AuthProvider";
import { showToast } from "../../components/Toast";
import { supabase } from "../../lib/supabaseClient";
import { ConfirmDialog } from "../../components/ConfirmDialog";
import { Card } from "../../lib/settingsUi";

type DeletedTicketsSettingsProps = {
  activeServiceId: string | null;
};

export function DeletedTicketsSettings({ activeServiceId }: DeletedTicketsSettingsProps) {
  const { session } = useAuth();
  const [deletedTickets, setDeletedTickets] = useState<any[]>([]);
  const [deletedByMap, setDeletedByMap] = useState<Record<string, string | null>>({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Restore dialog states
  const [restoreDialogOpen, setRestoreDialogOpen] = useState(false);
  const [restoreTicketId, setRestoreTicketId] = useState<string | null>(null);

  // Load deleted tickets and who deleted them (from ticket_history)
  useEffect(() => {
    if (!activeServiceId || !session || !supabase) {
      setDeletedTickets([]);
      setDeletedByMap({});
      setError(null);
      return;
    }

    const loadDeletedTickets = async () => {
      if (!supabase) return;
      setLoading(true);
      setError(null);

      try {
        const { data, error: fetchError } = await supabase
          .from("tickets")
          .select("id, title, status, customer_name, customer_phone, created_at, deleted_at")
          .eq("service_id", activeServiceId)
          .not("deleted_at", "is", null)
          .order("deleted_at", { ascending: false });

        if (fetchError) {
          setError(`Chyba při načítání smazaných zakázek: ${fetchError.message}`);
          setDeletedTickets([]);
          setDeletedByMap({});
          setLoading(false);
          return;
        }

        const tickets = data || [];
        setDeletedTickets(tickets);

        if (tickets.length === 0) {
          setDeletedByMap({});
          setLoading(false);
          return;
        }

        const ticketIds = tickets.map((t: any) => t.id);
        const { data: historyRows } = await (supabase as any)
          .from("ticket_history")
          .select("ticket_id, changed_by")
          .in("ticket_id", ticketIds)
          .eq("action", "deleted");

        const userIds = [...new Set((historyRows || []).map((r: any) => r.changed_by).filter(Boolean))];
        let nicknames: Record<string, string> = {};
        if (userIds.length > 0) {
          const { data: profiles } = await (supabase as any).from("profiles").select("id, nickname").in("id", userIds);
          if (profiles) {
            for (const p of profiles) {
              if (p.nickname) nicknames[p.id] = p.nickname;
            }
          }
        }

        const map: Record<string, string | null> = {};
        for (const r of historyRows || []) {
          map[r.ticket_id] = (r.changed_by && nicknames[r.changed_by]) || r.changed_by ? `${String(r.changed_by).slice(0, 8)}…` : null;
        }
        setDeletedByMap(map);
      } catch (err) {
        const errorMessage = err instanceof Error ? err.message : "Neznámá chyba";
        setError(`Chyba při načítání smazaných zakázek: ${errorMessage}`);
        setDeletedTickets([]);
        setDeletedByMap({});
      } finally {
        setLoading(false);
      }
    };

    loadDeletedTickets();
  }, [activeServiceId, session, supabase]);

  const handleRestoreTicket = async () => {
    if (!restoreTicketId || !supabase) return;

    try {
      const { error } = await (supabase.rpc as any)("restore_ticket", {
        p_ticket_id: restoreTicketId,
      });

      if (error) {
        throw error;
      }

      // Remove ticket from local list
      setDeletedTickets((prev) => prev.filter((t) => t.id !== restoreTicketId));

      showToast("Zakázka byla obnovena", "success");
      setRestoreDialogOpen(false);
      setRestoreTicketId(null);
    } catch (err: any) {
      const errorMessage = err?.message || "Neznámá chyba";
      if (errorMessage.includes("Not authorized") || errorMessage.includes("permission")) {
        showToast("Nemáš oprávnění obnovit zakázku", "error");
      } else {
        showToast(`Chyba při obnovování zakázky: ${errorMessage}`, "error");
      }
    }
  };

  const border = "1px solid var(--border)";

  return (
    <>
      <Card>
        <div style={{ fontWeight: 950, fontSize: 14, marginBottom: 12, color: "var(--text)" }}>Smazané zakázky</div>
        <div style={{ fontSize: 13, color: "var(--muted)", marginBottom: 16 }}>
          Zobrazují se zakázky, které byly přesunuty do smazaných
        </div>

        {loading ? (
          <div style={{ color: "var(--muted)", fontSize: 13 }}>Načítání...</div>
        ) : error ? (
          <div style={{ color: "rgba(239,68,68,0.9)", fontSize: 13 }}>{error}</div>
        ) : deletedTickets.length === 0 ? (
          <div style={{ color: "var(--muted)", fontSize: 13 }}>Žádné smazané zakázky</div>
        ) : (
          <div style={{ display: "grid", gap: 12 }}>
            {deletedTickets.map((ticket) => (
              <div
                key={ticket.id}
                style={{
                  padding: 16,
                  borderRadius: 12,
                  border,
                  background: "var(--panel)",
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                }}
              >
                <div>
                  <div style={{ fontWeight: 800, fontSize: 14, color: "var(--text)" }}>
                    {ticket.title || "Neznámá zakázka"}
                  </div>
                  {ticket.customer_name && (
                    <div style={{ fontSize: 13, color: "var(--muted)", marginTop: 4 }}>
                      {ticket.customer_name}
                      {ticket.customer_phone && ` · ${ticket.customer_phone}`}
                    </div>
                  )}
                  {ticket.deleted_at && (
                    <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 4 }}>
                      Smazáno: {new Date(ticket.deleted_at).toLocaleString("cs-CZ")}
                      {deletedByMap[ticket.id] && ` · ${deletedByMap[ticket.id]}`}
                    </div>
                  )}
                </div>
                <button
                  onClick={() => {
                    setRestoreTicketId(ticket.id);
                    setRestoreDialogOpen(true);
                          }}
                          style={{
                    padding: "8px 16px",
                    borderRadius: 10,
                    border,
                    background: "var(--accent)",
                    color: "white",
                    fontSize: 13,
                    fontWeight: 700,
                            cursor: "pointer",
                          }}
                        >
                  Obnovit
                        </button>
                      </div>
            ))}
                    </div>
        )}
      </Card>

      {/* Restore ticket confirmation dialog */}
      <ConfirmDialog
        open={restoreDialogOpen}
        title="Obnovit zakázku"
        message="Opravdu chceš tuto zakázku obnovit?"
        confirmLabel="Obnovit"
        cancelLabel="Zrušit"
        variant="default"
        onConfirm={handleRestoreTicket}
        onCancel={() => {
          setRestoreDialogOpen(false);
          setRestoreTicketId(null);
        }}
      />
    </>
  );
}
