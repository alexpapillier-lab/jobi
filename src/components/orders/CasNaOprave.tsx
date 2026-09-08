import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "../ui";
import { showToast } from "../../components/Toast";
import { delkaSekund, formatDelka, nactiPrezdivky, nactiUseky, sledujUseky, smazUsek, spustPraci, zastavPraci, type UsekPrace } from "../../lib/casNaOprave";
import { MAX_OTEVRENY_USEK_HODIN, castkaZaCas, hodinyKUctovani, jeZapomenuty, nejvytizenejsi, sekundyCelkem } from "../../lib/usekyPrace";
import { formatCurrency } from "../../lib/invoiceMath";

/**
 * Karta „Čas na opravě“ v detailu zakázky (jen když to servis zapnul).
 *
 * Technik spustí a zastaví práci; vidí se, kdo právě pracuje a kolik času
 * zakázka celkem stála. Úseky jsou po lidech, každý mění jen své.
 *
 * Když má servis hodinovou sazbu, ukáže se vedle času i odhad ceny a
 * tlačítko, které naměřený čas přidá do provedených oprav jako hodinovou
 * práci – dřív technik hodiny opisoval ručně. Částku vidí každý, kdo vidí
 * kartu (rozhodnutí majitele 8. 9. 2026).
 */
export function CasNaOprave({
  serviceId,
  ticketId,
  userId,
  jmena,
  sazba,
  uzPridano = false,
  onPridatHodinovouPraci,
}: {
  serviceId: string;
  ticketId: string;
  userId: string | null;
  /** user_id → přezdívka; kdo chybí, ukáže se jako „Kolega“. */
  jmena: Record<string, string>;
  /** Hodinová sazba servisu (Kč/h). Bez ní se částka ani tlačítko neukážou. */
  sazba?: number | null;
  /** Hodinová práce z měření už v zakázce je – tlačítko se jen ukáže jako hotové. */
  uzPridano?: boolean;
  /** Přidá naměřený čas do provedených oprav jako položku „Hodinová práce“. */
  onPridatHodinovouPraci?: (prace: { hodiny: number; sazba: number; technik?: string; technikUserId?: string }) => void;
}) {
  const [useky, setUseky] = useState<UsekPrace[]>([]);
  const [prezdivky, setPrezdivky] = useState<Record<string, string>>({});
  const [ted, setTed] = useState(() => Date.now());
  const [ceka, setCeka] = useState(false);
  // Odpověď pro předchozí zakázku nesmí přepsat úseky té současné.
  const aktualniTicket = useRef(ticketId);
  aktualniTicket.current = ticketId;

  const nacti = useCallback(async () => {
    const pro = ticketId;
    try {
      const radky = await nactiUseky(pro);
      if (aktualniTicket.current !== pro) return;
      setUseky(radky);
      const ids = [...new Set(radky.map((u) => u.user_id))];
      const chybi = ids.filter((id) => !(id in prezdivkyRef.current));
      if (chybi.length > 0) {
        const nove = await nactiPrezdivky(chybi);
        if (aktualniTicket.current !== pro) return;
        setPrezdivky((prev) => ({ ...prev, ...nove }));
      }
    } catch (e) {
      console.warn("[cas] načtení selhalo", e);
    }
  }, [ticketId]);
  const prezdivkyRef = useRef(prezdivky);
  prezdivkyRef.current = prezdivky;

  useEffect(() => {
    setUseky([]);
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
  // Součet za zakázku počítá zapomenuté stopky nejvýš jednu směnu – stejně
  // jako KPI techniků ve Statistikách. Bez toho tu po víkendu svítí „61 h“
  // za práci, která trvala hodinu. Odpočet u tlačítka Zastavit tiká dál.
  const celkem = sekundyCelkem(useky, null, null, ted);
  const zapomenute = useky.filter((u) => jeZapomenuty(u, ted));
  const jmeno = (id: string) => jmena[id] ?? prezdivky[id] ?? (id === userId ? "Já" : "Kolega");
  const maSazbu = typeof sazba === "number" && sazba > 0;
  const castka = maSazbu && celkem > 0 ? castkaZaCas(celkem, sazba) : null;
  const hodiny = hodinyKUctovani(celkem);

  const pridatHodinovouPraci = () => {
    if (!onPridatHodinovouPraci || !maSazbu || hodiny <= 0) return;
    const technikUserId = nejvytizenejsi(useky, ted) ?? undefined;
    const technik = technikUserId ? jmeno(technikUserId) : undefined;
    onPridatHodinovouPraci({ hodiny, sazba, technik, technikUserId });
    showToast(`Přidána hodinová práce ${hodiny.toLocaleString("cs-CZ")} h × ${formatCurrency(sazba)}.`, "success");
  };

  const start = async () => {
    if (!userId) return;
    setCeka(true);
    try {
      await spustPraci(serviceId, ticketId);
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
      await zastavPraci();
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
          {castka !== null && (
            <span title={`Odhad podle sazby servisu ${formatCurrency(sazba as number)}/h. Účtuje se po započatých čtvrthodinách.`}>
              {" "}· ≈ <b style={{ color: "var(--text)" }}>{formatCurrency(castka)}</b>
            </span>
          )}
          {bezi && <span> · právě běží</span>}
          {zapomenute.length > 0 && (
            <span title={`Úsek, který běží déle než ${MAX_OTEVRENY_USEK_HODIN} h, se do součtu započítá jen ${MAX_OTEVRENY_USEK_HODIN} h.`}>
              {" "}· {zapomenute.length === 1 ? "jeden úsek se zapomněl zastavit" : `${zapomenute.length} úseky se zapomněly zastavit`}
            </span>
          )}
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
      {maSazbu && celkem > 0 && onPridatHodinovouPraci && (
        <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
          <Button
            variant="soft"
            size="sm"
            onClick={pridatHodinovouPraci}
            disabled={uzPridano || bezi}
            title={uzPridano ? "Hodinová práce z měření už v provedených opravách je." : bezi ? "Nejdřív zastavte běžící práci, ať se započítá celý čas." : undefined}
          >
            {uzPridano ? "Hodinová práce už je v opravách" : `Přidat jako hodinovou práci · ${hodiny.toLocaleString("cs-CZ")} h × ${formatCurrency(sazba as number)}`}
          </Button>
        </div>
      )}
    </div>
  );
}
