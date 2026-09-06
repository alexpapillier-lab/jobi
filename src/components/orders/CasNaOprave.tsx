import { useCallback, useEffect, useState } from "react";
import { Button } from "../ui";
import { showToast } from "../../components/Toast";
import { delkaSekund, formatDelka, nactiUseky, sledujUseky, smazUsek, spustPraci, zastavPraci, type UsekPrace } from "../../lib/casNaOprave";

/**
 * Karta „Čas na opravě“ v detailu zakázky (jen když to servis zapnul).
 *
 * Technik spustí a zastaví práci; vidí se, kdo právě pracuje a kolik času
 * zakázka celkem stála. Úseky jsou po lidech, každý mění jen své.
 */
export function CasNaOprave({
  serviceId,
  ticketId,
  userId,
  jmena,
}: {
  serviceId: string;
  ticketId: string;
  userId: string | null;
  /** user_id → přezdívka; kdo chybí, ukáže se jako „Kolega“. */
  jmena: Record<string, string>;
}) {
  const [useky, setUseky] = useState<UsekPrace[]>([]);
  const [ted, setTed] = useState(() => Date.now());
  const [ceka, setCeka] = useState(false);

  const nacti = useCallback(async () => {
    try {
      setUseky(await nactiUseky(ticketId));
    } catch (e) {
      console.warn("[cas] načtení selhalo", e);
    }
  }, [ticketId]);

  useEffect(() => {
    void nacti();
    const odhlasit = sledujUseky(ticketId, () => void nacti());
    return odhlasit;
  }, [ticketId, nacti]);

  const bezi = useky.some((u) => !u.ended_at);
  useEffect(() => {
    if (!bezi) return;
    const id = window.setInterval(() => setTed(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [bezi]);

  const mujBezici = userId ? useky.find((u) => !u.ended_at && u.user_id === userId) ?? null : null;
  const celkem = useky.reduce((a, u) => a + delkaSekund(u, ted), 0);
  const jmeno = (id: string) => jmena[id] ?? (id === userId ? "Já" : "Kolega");

  const start = async () => {
    if (!userId) return;
    setCeka(true);
    try {
      await spustPraci(serviceId, ticketId, userId);
      await nacti();
    } catch (e) {
      showToast("Práci se nepodařilo spustit: " + (e instanceof Error ? e.message : String(e)), "error");
    } finally {
      setCeka(false);
    }
  };
  const stop = async () => {
    if (!mujBezici) return;
    setCeka(true);
    try {
      await zastavPraci(mujBezici.id);
      await nacti();
    } catch {
      showToast("Práci se nepodařilo zastavit", "error");
    } finally {
      setCeka(false);
    }
  };

  return (
    <div style={{ display: "grid", gap: 10 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
        <div style={{ fontSize: 13, color: "var(--muted)" }}>
          Celkem na zakázce <b style={{ color: "var(--text)" }}>{formatDelka(celkem)}</b>
          {bezi && <span> · právě běží</span>}
        </div>
        {mujBezici ? (
          <Button variant="danger" size="sm" onClick={() => void stop()} disabled={ceka}>
            Zastavit · {formatDelka(delkaSekund(mujBezici, ted))}
          </Button>
        ) : (
          <Button variant="primary" size="sm" onClick={() => void start()} disabled={ceka || !userId}>
            Spustit práci
          </Button>
        )}
      </div>
      {useky.length > 0 && (
        <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "grid", gap: 4 }}>
          {useky.slice(0, 8).map((u) => (
            <li key={u.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, fontSize: 12, padding: "6px 8px", borderRadius: 8, background: u.ended_at ? "var(--panel-2)" : "var(--accent-soft)" }}>
              <span>
                <b>{jmeno(u.user_id)}</b> · {new Date(u.started_at).toLocaleString("cs-CZ", { day: "numeric", month: "numeric", hour: "2-digit", minute: "2-digit" })}
                {u.ended_at ? ` – ${new Date(u.ended_at).toLocaleTimeString("cs-CZ", { hour: "2-digit", minute: "2-digit" })}` : " – běží"}
              </span>
              <span style={{ display: "flex", gap: 8, alignItems: "center" }}>
                <b>{formatDelka(delkaSekund(u, ted))}</b>
                {u.user_id === userId && u.ended_at && (
                  <button type="button" onClick={() => void smazUsek(u.id).then(nacti).catch(() => showToast("Úsek se nepodařilo smazat", "error"))} aria-label="Smazat úsek" title="Smazat úsek" style={{ background: "transparent", border: "none", color: "var(--muted)", cursor: "pointer", fontSize: 14 }}>×</button>
                )}
              </span>
            </li>
          ))}
          {useky.length > 8 && <li style={{ fontSize: 12, color: "var(--muted)" }}>… a dalších {useky.length - 8}</li>}
        </ul>
      )}
    </div>
  );
}
