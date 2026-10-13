import { useCallback, useEffect, useMemo, useState } from "react";
import { Button } from "../../components/ui";
import { showToast } from "../../components/Toast";
import { useBranches } from "../../context/BranchContext";
import { otevriVProhlizeci } from "../../lib/platform";
import {
  POPIS_STAVU,
  jeOtevrena,
  nactiObjednavky,
  objednavkaZakazky,
  nastavStavObjednavky,
  popisDopravy,
  sledovaciOdkazy,
  sledujObjednavky,
  type StavObjednavky,
  type WebObjednavka,
} from "../../lib/objednavky";

/** Příjem předvyplněný z objednávky – App poslouchá a otevře Novou zakázku. */
export function zalozitZakazkuZObjednavky(objednavka: WebObjednavka) {
  window.dispatchEvent(new CustomEvent("jobsheet:zalozit-z-objednavky", { detail: { objednavka } }));
}

/** Načtení + realtime + pojistky (návrat do okna, minutový interval) – sdílí Zakázky i Dnes. */
export function useObjednavky(activeServiceId: string | null, upozornitNaNove = false) {
  const [objednavky, setObjednavky] = useState<WebObjednavka[]>([]);
  const [nacteno, setNacteno] = useState(false);

  const nacti = useCallback(async () => {
    if (!activeServiceId) {
      setObjednavky([]);
      return;
    }
    try {
      setObjednavky(await nactiObjednavky(activeServiceId));
    } catch (e) {
      // Tabulka nemusí ještě existovat (starší databáze) – panel se jen neukáže.
      console.warn("[objednavky] načtení selhalo", e);
      setObjednavky([]);
    } finally {
      setNacteno(true);
    }
  }, [activeServiceId]);

  useEffect(() => {
    void nacti();
    if (!activeServiceId) return;
    const odhlasit = sledujObjednavky(activeServiceId, (typ) => {
      if (typ === "INSERT" && upozornitNaNove) showToast("Nová objednávka z webu", "info");
      void nacti();
    });
    const onZmena = () => void nacti();
    const onViditelnost = () => { if (document.visibilityState === "visible") void nacti(); };
    window.addEventListener("jobsheet:objednavky-zmena", onZmena);
    document.addEventListener("visibilitychange", onViditelnost);
    const interval = window.setInterval(() => void nacti(), 60_000);
    return () => {
      odhlasit();
      window.removeEventListener("jobsheet:objednavky-zmena", onZmena);
      document.removeEventListener("visibilitychange", onViditelnost);
      window.clearInterval(interval);
    };
  }, [activeServiceId, nacti, upozornitNaNove]);

  return { objednavky, setObjednavky, nacteno, nacti };
}

/** Detail zakázky: „Z objednávky SRV-2026-0123 (servis.iswap.cz)“. */
export function ZObjednavky({ ticketId }: { ticketId: string }) {
  const [o, setO] = useState<{ externi_cislo: string; zdroj: string } | null>(null);
  useEffect(() => {
    let zruseno = false;
    setO(null);
    void objednavkaZakazky(ticketId).then((x) => { if (!zruseno) setO(x); });
    return () => { zruseno = true; };
  }, [ticketId]);
  if (!o) return null;
  return (
    <div data-tour="detail-z-objednavky" style={{ fontSize: 12, color: "var(--muted)" }}>
      Z objednávky <strong style={{ color: "var(--text)" }}>{o.externi_cislo}</strong>{o.zdroj ? ` (${o.zdroj})` : ""}
    </div>
  );
}

const casFmt = (iso: string) => new Date(iso).toLocaleString("cs-CZ", { day: "numeric", month: "numeric", hour: "2-digit", minute: "2-digit" });

/** Štítek stavu objednávky. */
export function StitekObjednavky({ stav }: { stav: StavObjednavky }) {
  const barvy: Record<StavObjednavky, { bg: string; fg: string }> = {
    nova: { bg: "var(--accent-soft)", fg: "var(--accent)" },
    na_ceste: { bg: "rgba(234,179,8,0.14)", fg: "var(--warning-text, #a16207)" },
    dorazilo: { bg: "rgba(22,163,74,0.12)", fg: "var(--success-text, #16a34a)" },
    prevedeno: { bg: "var(--panel-2)", fg: "var(--muted)" },
    zrusena: { bg: "var(--panel-2)", fg: "var(--muted)" },
  };
  const b = barvy[stav] ?? barvy.nova;
  return <span style={{ display: "inline-block", padding: "2px 8px", borderRadius: 999, fontSize: 11, fontWeight: 700, background: b.bg, color: b.fg, whiteSpace: "nowrap" }}>{POPIS_STAVU[stav] ?? stav}</span>;
}

/** Sledovací čísla jako odkazy na sledování zásilky (DPD, Zásilkovna…). */
export function SledovaciCisla({ objednavka }: { objednavka: Pick<WebObjednavka, "sledovaci_cisla"> }) {
  const odkazy = sledovaciOdkazy(objednavka);
  if (odkazy.length === 0) return null;
  return (
    <span style={{ display: "inline-flex", gap: 8, flexWrap: "wrap" }}>
      {odkazy.map((o, i) =>
        o.url ? (
          <button
            key={i}
            type="button"
            onClick={(e) => { e.stopPropagation(); void otevriVProhlizeci(o.url!); }}
            title={`Sledovat zásilku${o.smer === "zpet" ? " zpět k zákazníkovi" : o.smer === "tam" ? " do servisu" : ""}`}
            style={{ border: "none", background: "none", padding: 0, color: "var(--accent)", fontWeight: 700, cursor: "pointer", fontFamily: "inherit", fontSize: "inherit", textDecoration: "underline" }}
          >
            {o.smer === "zpet" ? "↩ " : ""}{o.text}
          </button>
        ) : (
          <span key={i}>{o.smer === "zpet" ? "↩ " : ""}{o.text}</span>
        ),
      )}
    </span>
  );
}

/**
 * Zakázky → Příchozí objednávky: objednávky z webu servisu (API, formulář).
 *
 * Zařízení teprve jede, takže objednávka není zakázka – je to budoucí příjem.
 * Panel proto sedí nad seznamem zakázek (ne v Kalendáři jako rezervace,
 * které jsou o termínu): když zásilka dorazí, „Založit zakázku“ otevře příjem
 * předvyplněný z objednávky na stejné stránce. Bez objednávek se neukazuje.
 */
export function PrichoziObjednavky({
  activeServiceId,
  onOpenTicket,
}: {
  activeServiceId: string | null;
  onOpenTicket: (ticketId: string) => void;
}) {
  const { objednavky, setObjednavky, nacti } = useObjednavky(activeServiceId, true);
  const { activeBranchId } = useBranches();
  const [zobrazitVyrizene, setZobrazitVyrizene] = useState(false);
  const [sbaleno, setSbaleno] = useState(false);

  const viditelne = useMemo(
    () => objednavky.filter((o) => !activeBranchId || !o.branch_id || o.branch_id === activeBranchId),
    [objednavky, activeBranchId],
  );
  const otevrene = viditelne.filter((o) => jeOtevrena(o.stav));
  const vyrizene = viditelne.filter((o) => !jeOtevrena(o.stav)).slice(0, 10);
  if (viditelne.length === 0) return null;

  const zmenStav = async (o: WebObjednavka, stav: "na_ceste" | "dorazilo" | "zrusena") => {
    if (stav === "zrusena" && !window.confirm(`Zrušit objednávku ${o.externi_cislo}? Web dostane oznámení (webhook), pokud ho máte nastavený.`)) return;
    try {
      const ok = await nastavStavObjednavky(o.id, stav);
      if (!ok) {
        showToast("Objednávku mezitím vyřídil někdo jiný", "info");
        await nacti();
        return;
      }
      setObjednavky((prev) => prev.map((x) => (x.id === o.id ? { ...x, stav } : x)));
    } catch (e) {
      const zprava = e && typeof e === "object" && "message" in e ? String((e as { message: unknown }).message) : "";
      showToast(zprava.includes("oprávnění") ? zprava : "Změnu objednávky se nepodařilo uložit", "error");
    }
  };

  const radek = (o: WebObjednavka) => (
    <li
      key={o.id}
      data-objednavka={o.id}
      style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, flexWrap: "wrap", padding: "10px 12px", borderRadius: 10, border: "1px solid var(--border)", background: "var(--panel)" }}
    >
      <div style={{ display: "grid", gap: 2, minWidth: 0, fontSize: 13 }}>
        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          <span style={{ fontWeight: 800, fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace" }}>{o.externi_cislo}</span>
          <span style={{ fontWeight: 700 }}>{o.zakaznik_jmeno || "Zákazník"}</span>
          {o.zakaznik_telefon && <span style={{ color: "var(--muted)" }}>{o.zakaznik_telefon}</span>}
          <StitekObjednavky stav={o.stav} />
        </div>
        <div>
          {o.zarizeni || "Zařízení neuvedeno"}
          {o.sn_imei ? <span style={{ color: "var(--muted)" }}> · {o.sn_imei}</span> : null}
          {o.popis_zavady || o.pozadovana_oprava ? <span> · {o.pozadovana_oprava || o.popis_zavady}</span> : null}
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", color: "var(--muted)" }}>
          <span>{popisDopravy(o)}</span>
          <SledovaciCisla objednavka={o} />
          <span>· {o.zdroj} · {casFmt(o.created_at)}</span>
        </div>
      </div>
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
        {jeOtevrena(o.stav) && (
          <>
            <Button size="sm" variant="primary" onClick={() => zalozitZakazkuZObjednavky(o)}>Založit zakázku</Button>
            {o.stav !== "dorazilo" && <Button size="sm" variant="soft" onClick={() => void zmenStav(o, "dorazilo")}>Dorazilo</Button>}
            <Button size="sm" variant="ghost" onClick={() => void zmenStav(o, "zrusena")}>Zrušit</Button>
          </>
        )}
        {o.stav === "prevedeno" && o.ticket_id && (
          <Button size="sm" variant="soft" onClick={() => onOpenTicket(o.ticket_id!)}>Otevřít zakázku</Button>
        )}
      </div>
    </li>
  );

  return (
    <section
      data-tour="orders-objednavky"
      aria-label="Příchozí objednávky z webu"
      style={{ padding: "12px 14px", borderRadius: 12, border: "1px solid var(--border)", background: "var(--panel-2)" }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, marginBottom: sbaleno ? 0 : 8, flexWrap: "wrap" }}>
        <button
          type="button"
          onClick={() => setSbaleno((v) => !v)}
          aria-expanded={!sbaleno}
          style={{ border: "none", background: "none", padding: 0, fontWeight: 900, fontSize: 14, color: "var(--text)", cursor: "pointer", fontFamily: "inherit" }}
        >
          {sbaleno ? "▸" : "▾"} Příchozí objednávky{otevrene.length > 0 ? ` · ${otevrene.length} k vyřízení` : ""}
        </button>
        {!sbaleno && vyrizene.length > 0 && (
          <Button size="sm" variant="ghost" onClick={() => setZobrazitVyrizene((v) => !v)}>
            {zobrazitVyrizene ? "Skrýt vyřízené" : `Vyřízené (${vyrizene.length})`}
          </Button>
        )}
      </div>
      {!sbaleno && (
        <>
          {otevrene.length === 0 && !zobrazitVyrizene && <div style={{ fontSize: 13, color: "var(--muted)" }}>Žádná nevyřízená objednávka.</div>}
          <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "grid", gap: 6 }}>
            {otevrene.map(radek)}
            {zobrazitVyrizene && vyrizene.map(radek)}
          </ul>
        </>
      )}
    </section>
  );
}
