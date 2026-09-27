/**
 * Modál „Historie zakázky“ – záznamy z ticket_history s rozbalitelným
 * rozdílem změn. Vyneseno z Orders.tsx beze změny obsahu.
 */
import type React from "react";
import { createPortal } from "react-dom";
import { Button } from "../../components/ui";
import { formatCZ } from "../../components/tickets";
import { formatCurrency } from "../../lib/invoiceMath";
import { getCachedBranch } from "../../lib/branches";
import type { StatusMeta } from "../../state/StatusesStore";

/** Jeden řádek historie (zakázky i reklamace) s doplněnou přezdívkou autora. */
export type ZaznamHistorie = { id: string; action: string; changed_by: string | null; created_at: string; details: Record<string, unknown>; nickname: string | null };

type Props = {
  entries: ZaznamHistorie[];
  loading: boolean;
  error: string | null;
  expandedId: string | null;
  setExpandedId: React.Dispatch<React.SetStateAction<string | null>>;
  onClose: () => void;
  getByKey: (key: string) => StatusMeta | undefined;
  activeServiceId: string | null;
  /** Jméno člena servisu podle id (useClenoveServisu().jmeno). */
  jmenoClena: (userId: string | null | undefined) => string | null;
};

export function HistorieZakazkyModal({ entries, loading, error, expandedId, setExpandedId, onClose, getByKey, activeServiceId, jmenoClena }: Props) {
  return createPortal(
    <div
      role="dialog"
      aria-label="Historie zakázky"
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 10000,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: "rgba(0,0,0,0.4)",
        padding: 24,
      }}
      onClick={onClose}
    >
      <div
        style={{
          background: "var(--panel)",
          border: "1px solid var(--border)",
          borderRadius: "var(--radius-lg)",
          boxShadow: "var(--shadow-soft)",
          maxWidth: 480,
          width: "100%",
          maxHeight: "80vh",
          overflow: "hidden",
          display: "flex",
          flexDirection: "column",
          color: "var(--text)",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div style={{ padding: "16px 20px", borderBottom: "1px solid var(--border)", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div style={{ fontWeight: 950, fontSize: 16 }}>Historie zakázky</div>
          <Button variant="soft" size="sm" onClick={onClose}>Zavřít</Button>
        </div>
        <div style={{ padding: 16, overflowY: "auto", flex: 1 }}>
          {loading && <div style={{ color: "var(--muted)", padding: 12 }}>Načítám…</div>}
          {error && <div style={{ color: "rgba(239,68,68,0.9)", padding: 12 }}>{error}</div>}
          {!loading && !error && entries.length === 0 && (
            <div style={{ color: "var(--muted)", padding: 12 }}>Žádné záznamy v historii. Historie se vytváří po uložení zakázky na server.</div>
          )}
          {!loading && !error && entries.length > 0 && (() => {
            const FIELD_LABELS: Record<string, string> = {
              title: "Zakázka / zařízení",
              status: "Stav",
              notes: "Popis",
              estimated_price: "Odhadovaná cena",
              performed_repairs: "Provedené opravy",
              diagnostic_text: "Diagnostika",
              customer_name: "Zákazník",
              customer_phone: "Telefon",
              customer_email: "E-mail",
              device_label: "Zařízení",
              discount: "Sleva",
              device_condition: "Stav zařízení",
              device_note: "Poznámka k zařízení",
              device_accessories: "Příslušenství",
              device_brand: "Značka",
              device_model: "Model",
              device_serial: "Sériové číslo",
              device_imei: "IMEI",
              device_passcode: "Kód zařízení",
              customer_company: "Firma",
              customer_ico: "IČO",
              customer_info: "Poznámka k zákazníkovi",
              customer_address_street: "Ulice",
              customer_address_city: "Město",
              customer_address_zip: "PSČ",
              customer_address_country: "Země",
              customer_id: "Zákazník v adresáři",
              external_id: "Externí číslo",
              handoff_method: "Převzetí",
              handback_method: "Předání",
              diagnostic_photos: "Fotky diagnostiky",
              expected_completion_at: "Předpokládané dokončení",
              completed_at: "Dokončeno",
              branch_id: "Pobočka",
              assigned_to: "Technik",
              test_checklist: "Kontrola po opravě",
              loaner: "Náhradní zařízení",
              quote_items: "Cenová nabídka",
              quote_status: "Stav nabídky",
              quote_amount: "Částka nabídky",
              quote_sent_at: "Nabídka odeslána",
              quote_decided_at: "Nabídka rozhodnuta",
              quote_decision_meta: "Rozhodnutí o nabídce",
              intake_signed_at: "Podpis převzetí",
              intake_signature_url: "Podpis převzetí (obrázek)",
            };
            const formatHistoryVal = (key: string, val: unknown): string => {
              if (val === null || val === undefined) return "—";
              // V databázi je stav anglický klíč ("received"). Zbytek aplikace
              // ho překládá přes getByKey; historie ho vypisovala surový, takže
              // uživatel četl "received → ready" místo "Přijato → Připraveno".
              if (key === "status") return getByKey(String(val))?.label ?? String(val);
              if (key === "estimated_price" && typeof val === "number") return `${val} Kč`;
              if (key === "performed_repairs" && Array.isArray(val)) {
                return val.map((r: { name?: string; price?: number }) => `${r?.name ?? "—"}${typeof r?.price === "number" ? ` (${formatCurrency(r.price)})` : ""}`).join(", ") || "—";
              }
              if (key === "discount" && val && typeof val === "object" && !Array.isArray(val)) {
                const o = val as { type?: string; value?: number };
                return [o.type, typeof o.value === "number" ? `${o.value} Kč` : ""].filter(Boolean).join(" · ") || "—";
              }
              // Strukturované sloupce: krátké shrnutí místo JSON.
              if (key === "test_checklist" && val && typeof val === "object") {
                const k = val as { sablonaNazev?: string; polozky?: Array<{ stav?: string | null }> };
                const p = k.polozky ?? [];
                return `${k.sablonaNazev ?? "kontrola"}: ověřeno ${p.filter((x) => x.stav).length} z ${p.length}${p.some((x) => x.stav === "chyba") ? " (s chybou)" : ""}`;
              }
              if (key === "loaner" && val && typeof val === "object") {
                const z = val as { nazev?: string; vraceno?: string | null };
                return `${z.nazev ?? "—"}${z.vraceno ? " (vráceno)" : " (u zákazníka)"}`;
              }
              if (key === "quote_items" && Array.isArray(val)) return `${val.length} položek`;
              if (key === "quote_status") return ({ none: "bez nabídky", draft: "koncept", sent: "odeslána", approved: "schválena", rejected: "zamítnuta" } as Record<string, string>)[String(val)] ?? String(val);
              if (key === "quote_amount" && typeof val === "number") return formatCurrency(val);
              if (key === "branch_id") return getCachedBranch(activeServiceId ?? undefined, String(val))?.name ?? "jiná pobočka";
              if (key === "assigned_to") return val ? jmenoClena(String(val)) ?? "kolega" : "nikdo";
              if (key === "intake_signature_url") return "podepsáno";
              if ((key === "expected_completion_at" || key === "completed_at" || key === "quote_sent_at" || key === "quote_decided_at" || key === "intake_signed_at") && typeof val === "string") return formatCZ(val);
              if (Array.isArray(val)) return `${val.length} položek`;
              if (typeof val === "object") return JSON.stringify(val).slice(0, 80);
              return String(val);
            };
            const getHistoryChanges = (details: Record<string, unknown>): Array<{ label: string; oldVal: string; newVal: string }> => {
              const out: Array<{ label: string; oldVal: string; newVal: string }> = [];
              const changes = details?.changes as Record<string, { old?: unknown; new?: unknown }> | undefined;
              if (changes && typeof changes === "object") {
                for (const [field, v] of Object.entries(changes)) {
                  if (!v || typeof v !== "object") continue;
                  const label = FIELD_LABELS[field] ?? field;
                  if (field === "discount") {
                    const oldD = v.old as { type?: string; value?: number } | undefined;
                    const newD = v.new as { type?: string; value?: number } | undefined;
                    out.push({
                      label,
                      oldVal: oldD ? formatHistoryVal("discount", oldD) : "—",
                      newVal: newD ? formatHistoryVal("discount", newD) : "—",
                    });
                  } else {
                    out.push({
                      label,
                      oldVal: formatHistoryVal(field, v.old),
                      newVal: formatHistoryVal(field, v.new),
                    });
                  }
                }
              } else if (details?.status_old !== undefined || details?.title_old !== undefined) {
                if (details.status_old !== undefined && details.status_new !== undefined) {
                  out.push({
                    label: "Stav",
                    oldVal: formatHistoryVal("status", details.status_old),
                    newVal: formatHistoryVal("status", details.status_new),
                  });
                }
                if (details.title_old !== undefined && details.title_new !== undefined) {
                  out.push({ label: "Zakázka / zařízení", oldVal: String(details.title_old), newVal: String(details.title_new) });
                }
              }
              return out;
            };
            return (
              <ul style={{ listStyle: "none", margin: 0, padding: 0 }}>
                {entries.map((e) => {
                  const actionLabel = e.action === "created" ? "Vytvořena" : e.action === "updated" ? "Upravena" : e.action === "deleted" ? "Smazána" : e.action === "restored" ? "Obnovena" : e.action === "cancel_reason" ? "Důvod storna" : e.action;
                  const who = e.nickname || (e.changed_by ? "Kolega bez přezdívky" : "Systém");
                  const changes = e.action === "updated" && e.details ? getHistoryChanges(e.details) : [];
                  const statusChange = changes.find((c) => c.label === "Stav");
                  const isExpanded = expandedId === e.id;
                  return (
                    <li key={e.id} style={{ padding: "10px 0", borderBottom: "1px solid var(--border)", fontSize: 13 }}>
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 8 }}>
                        <div>
                          <div style={{ fontWeight: 700 }}>
                            {actionLabel}
                            {statusChange && (
                              <span style={{ fontWeight: 600, color: "var(--muted)", marginLeft: 6 }}>
                                · Stav: {statusChange.oldVal} → {statusChange.newVal}
                              </span>
                            )}
                          </div>
                          <div style={{ color: "var(--muted)", marginTop: 2 }}>{formatCZ(e.created_at)} · {who}</div>
                          {e.action === "cancel_reason" && (
                            <div style={{ marginTop: 4 }}>
                              {String((e.details as Record<string, unknown>)?.duvod ?? "")}
                              {(e.details as Record<string, unknown>)?.poznamka ? ` – ${String((e.details as Record<string, unknown>).poznamka)}` : ""}
                            </div>
                          )}
                          {e.action === "updated" && changes.length === 0 && (
                            // Starší záznamy vznikly před migrací s plným diffem, takže
                            // co se změnilo, se nikam neuložilo. Bez téhle věty vidí
                            // uživatel jen „Upravena" a nemá jak zjistit proč.
                            <div style={{ color: "var(--muted)", marginTop: 2, fontSize: 12, fontStyle: "italic" }}>
                              Podrobnosti u tohoto záznamu nejsou – zaznamenávají se až u novějších změn.
                            </div>
                          )}
                        </div>
                        {changes.length > 0 && (
                          <button
                            type="button"
                            onClick={() => setExpandedId(isExpanded ? null : e.id)}
                            style={{
                              padding: "4px 8px",
                              border: "1px solid var(--border)",
                              borderRadius: 6,
                              background: "var(--bg)",
                              color: "var(--accent)",
                              fontSize: 11,
                              fontWeight: 600,
                              cursor: "pointer",
                              whiteSpace: "nowrap",
                            }}
                          >
                            {isExpanded ? "Skrýt detail" : "Detail změn"}
                          </button>
                        )}
                      </div>
                      {isExpanded && changes.length > 0 && (
                        <div style={{ marginTop: 10, padding: "10px 12px", background: "var(--bg)", borderRadius: 8, border: "1px solid var(--border)" }}>
                          {changes.map((c, i) => (
                            <div key={i} style={{ marginBottom: i < changes.length - 1 ? 8 : 0, fontSize: 12 }}>
                              <div style={{ fontWeight: 600, color: "var(--text)", marginBottom: 2 }}>{c.label}</div>
                              <div style={{ color: "var(--muted)", display: "flex", flexWrap: "wrap", gap: "4px 8px" }}>
                                <span>{c.oldVal}</span>
                                <span style={{ color: "var(--text)" }}>→</span>
                                <span>{c.newVal}</span>
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                    </li>
                  );
                })}
              </ul>
            );
          })()}
        </div>
      </div>
    </div>,
    document.body
  );
}
