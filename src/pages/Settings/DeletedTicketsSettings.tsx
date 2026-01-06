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
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  
  // Restore dialog states
  const [restoreDialogOpen, setRestoreDialogOpen] = useState(false);
  const [restoreTicketId, setRestoreTicketId] = useState<string | null>(null);

  // Load deleted tickets when activeServiceId changes
  useEffect(() => {
    if (!activeServiceId || !session || !supabase) {
      setDeletedTickets([]);
      setError(null);
      return;
    }

    const loadDeletedTickets = async () => {
      setLoading(true);
      setError(null);

      try {
        if (!supabase) {
          setError("Chyba konfigurace: Supabase client není dostupný");
          setDeletedTickets([]);
          setLoading(false);
                                return;
                              }

        const { data, error: fetchError } = await supabase
          .from("tickets")
          .select("id, title, status, customer_name, customer_phone, created_at, deleted_at")
          .eq("service_id", activeServiceId)
          .not("deleted_at", "is", null)
          .order("deleted_at", { ascending: false });

        if (fetchError) {
          setError(`Chyba při načítání smazaných zakázek: ${fetchError.message}`);
          setDeletedTickets([]);
          setLoading(false);
                                return;
                              }

        if (data) {
          setDeletedTickets(data || []);
          setError(null);
        } else {
          setDeletedTickets([]);
        }
        setLoading(false);
                            } catch (err) {
        const errorMessage = err instanceof Error ? err.message : "Neznámá chyba";
        setError(`Chyba při načítání smazaných zakázek: ${errorMessage}`);
        setDeletedTickets([]);
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
