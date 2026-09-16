import { useCallback, useEffect, useState } from "react";
import { Button } from "../ui";
import { showToast } from "../Toast";
import { reportError } from "../../lib/reportError";
import {
  cisloZasilky,
  druhaPobocka,
  nactiZasilky,
  otevrenyKoncept,
  popisUmisteni,
  pridejDoZasilky,
  subscribeZasilky,
  umisteniZakazky,
  vytvorZasilku,
  type Zasilka,
} from "../../lib/zasilky";

/**
 * Karta „Kde je zakázka“ v detailu (modul Přesuny mezi pobočkami).
 *
 * Ukáže, kde zařízení fyzicky je, historii zásilek, ve kterých cestovalo,
 * a jedno tlačítko: přidat do otevřeného konceptu zásilky z tohoto místa
 * na druhou pobočku (koncept se založí, když žádný není). Odeslání
 * a převzetí se dělá na stránce Zásilky, kde je celá krabice pohromadě.
 */
export function KdeJeZakazka({
  ticket,
  serviceId,
  branches,
  nazevPobocky,
  onOtevritZasilky,
  onHistorie,
  dniBezZmeny,
}: {
  ticket: { id: string; code?: string | null; branchId?: string | null; locationBranchId?: string | null; transitShipmentId?: string | null };
  serviceId: string;
  branches: Array<{ id: string; name: string }>;
  nazevPobocky: (id: string) => string;
  onOtevritZasilky: () => void;
  /** Načtená historie zásilek zakázky – rodič z ní skládá kroky v Postupu zakázky. */
  onHistorie?: (historie: Zasilka[]) => void;
  /** Leží mimo pobočku tolik dní bez změny (Nastavení → Přesuny mezi pobočkami); null = v pořádku. */
  dniBezZmeny?: number | null;
}) {
  const [historie, setHistorie] = useState<Zasilka[]>([]);
  const [koncepty, setKoncepty] = useState<Zasilka[]>([]);
  const [cil, setCil] = useState<string>("");
  const [zauzlovano, setZauzlovano] = useState(false);

  const u = umisteniZakazky(ticket);
  const domaci = ticket.branchId ? nazevPobocky(ticket.branchId) : "—";
  /** Odkud by zakázka teď odjížděla: kde fyzicky je. */
  const odkud = u.druh === "jinde" ? u.branchId : (ticket.branchId ?? null);

  const nacti = useCallback(async () => {
    try {
      // Jeden dotaz: zásilky servisu i s položkami. Historie zakázky jsou ty,
      // ve kterých je mezi položkami; koncepty pro „přidat do zásilky“ taky.
      const vsechny = await nactiZasilky(serviceId);
      const rows = vsechny
        .filter((z) => z.polozky.some((p) => p.ticketId === ticket.id))
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
      setHistorie(rows);
      onHistorie?.(rows);
      setKoncepty(vsechny.filter((z) => z.status === "draft"));
    } catch (error) {
      reportError({ code: "zasilky.ticket_history_failed", error, source: "KdeJeZakazka", serviceId, context: { ticketId: ticket.id } });
    }
    // onHistorie se nemění záměrně – rodič ji předává jako inline funkci.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [serviceId, ticket.id]);

  useEffect(() => {
    void nacti();
    return subscribeZasilky(serviceId, () => void nacti());
  }, [nacti, serviceId]);

  useEffect(() => {
    if (!odkud) return;
    setCil(druhaPobocka(branches, odkud) ?? branches.find((b) => b.id !== odkud)?.id ?? "");
  }, [branches, odkud]);

  const koncept = odkud && cil ? otevrenyKoncept(koncepty, odkud, cil) : null;

  const pridat = async () => {
    if (!odkud || !cil || zauzlovano) return;
    setZauzlovano(true);
    try {
      const z = koncept ?? (await vytvorZasilku({ serviceId, fromBranchId: odkud, toBranchId: cil }));
      await pridejDoZasilky(z.id, ticket.id);
      showToast(`Přidáno do zásilky ${cisloZasilky(z)} (${nazevPobocky(odkud)} → ${nazevPobocky(cil)}). Odešlete ji na stránce Zásilky.`, "success");
      await nacti();
    } catch (error) {
      reportError({ code: "zasilky.add_failed", error, userMessage: error instanceof Error ? error.message : "Nepodařilo se přidat do zásilky.", source: "KdeJeZakazka", serviceId, context: { ticketId: ticket.id } });
    } finally {
      setZauzlovano(false);
    }
  };

  const vKonceptu = historie.find((z) => z.status === "draft");
  const datum = (iso: string | null) => (iso ? new Date(iso).toLocaleString("cs-CZ", { day: "numeric", month: "numeric", hour: "2-digit", minute: "2-digit" }) : "");
  const muted: React.CSSProperties = { fontSize: 12, color: "var(--muted)" };

  return (
    <div style={{ display: "grid", gap: 10 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
        <span
          style={{
            display: "inline-block", padding: "3px 10px", borderRadius: 999, fontSize: 12, fontWeight: 800,
            background: u.druh === "doma" ? "var(--success-soft)" : "var(--warning-soft)",
            color: u.druh === "doma" ? "var(--success-text)" : "var(--warning-text)",
          }}
        >
          {popisUmisteni(u, nazevPobocky, domaci)}
        </span>
        {u.druh === "na_ceste" && (
          <span style={muted}>
            zásilka {historie.find((z) => z.id === u.shipmentId) ? cisloZasilky(historie.find((z) => z.id === u.shipmentId)!) : ""} · převezme se na stránce Zásilky
          </span>
        )}
        {u.druh !== "doma" && ticket.branchId && <span style={muted}>Přijato a vydá se: {domaci}</span>}
      </div>
      {dniBezZmeny ? (
        <div style={{ fontSize: 13, fontWeight: 700, color: "var(--danger-text)", background: "var(--danger-soft)", borderRadius: 8, padding: "6px 10px" }}>
          Zakázka je mimo svou pobočku už {dniBezZmeny} {dniBezZmeny === 1 ? "den" : dniBezZmeny < 5 ? "dny" : "dní"} bez změny. Zkontrolujte, jestli se na ní pracuje, nebo ji pošlete zpět.
        </div>
      ) : null}

      {u.druh !== "na_ceste" && odkud && (
        <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
          {vKonceptu ? (
            <span style={muted}>V konceptu zásilky {cisloZasilky(vKonceptu)} ({nazevPobocky(vKonceptu.fromBranchId)} → {nazevPobocky(vKonceptu.toBranchId)}), čeká na odeslání.</span>
          ) : (
            <>
              {branches.length > 2 && (
                <select className="ui-input" aria-label="Cílová pobočka" value={cil} onChange={(e) => setCil(e.target.value)} style={{ width: "auto" }}>
                  {branches.filter((b) => b.id !== odkud).map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
                </select>
              )}
              <Button size="sm" variant="soft" onClick={() => void pridat()} disabled={zauzlovano || !cil}>
                {cil ? `Přidat do zásilky do pobočky ${nazevPobocky(cil)}` : "Přidat do zásilky"}
              </Button>
              {koncept && <span style={muted}>přidá se do otevřeného konceptu {cisloZasilky(koncept)}</span>}
            </>
          )}
          <Button size="sm" variant="ghost" onClick={onOtevritZasilky}>Otevřít Zásilky</Button>
        </div>
      )}

      {historie.length > 0 && (
        <div style={{ display: "grid", gap: 4, paddingTop: 8, borderTop: "1px solid var(--border)" }}>
          <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: "0.04em", textTransform: "uppercase", color: "var(--muted)" }}>Zásilky</div>
          {historie.map((z) => (
            <div key={z.id} style={{ display: "flex", gap: 8, alignItems: "baseline", fontSize: 13, flexWrap: "wrap" }}>
              <span style={{ fontWeight: 700 }}>{cisloZasilky(z)}</span>
              <span>{nazevPobocky(z.fromBranchId)} → {nazevPobocky(z.toBranchId)}</span>
              <span style={muted}>
                {z.status === "draft" ? "koncept" : z.status === "sent" ? `odesláno ${datum(z.sentAt)}` : `převzato ${datum(z.receivedAt)}`}
                {z.trackingNumber ? ` · ${z.trackingNumber}` : ""}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
