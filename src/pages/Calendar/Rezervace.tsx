import { useCallback, useEffect, useState } from "react";
import { Button } from "../../components/ui";
import { showToast } from "../../components/Toast";
import { type Rezervace, nactiRezervace, nastavStavRezervace, popisTerminu, sledujRezervace } from "../../lib/rezervace";

/**
 * Rezervace z webu v Kalendáři: nové a potvrzené nahoře, ať je servis vidí
 * hned po otevření. „Založit zakázku“ předvyplní příjem údaji z rezervace;
 * rezervace se označí jako převedená, až zakázka vznikne (Orders).
 */
export function RezervacePanel({
  activeServiceId,
  onZalozitZakazku,
  onOpenTicket,
}: {
  activeServiceId: string | null;
  onZalozitZakazku: (rezervace: Rezervace) => void;
  onOpenTicket: (ticketId: string) => void;
}) {
  const [rezervace, setRezervace] = useState<Rezervace[]>([]);
  const [zobrazitUzavrene, setZobrazitUzavrene] = useState(false);

  const nacti = useCallback(async () => {
    if (!activeServiceId) {
      setRezervace([]);
      return;
    }
    try {
      setRezervace(await nactiRezervace(activeServiceId));
    } catch (e) {
      // Tabulka nemusí ještě existovat (stará databáze) – panel se jen neukáže.
      console.warn("[rezervace] načtení selhalo", e);
      setRezervace([]);
    }
  }, [activeServiceId]);

  useEffect(() => {
    void nacti();
    if (!activeServiceId) return;
    const odhlasit = sledujRezervace(activeServiceId, (typ) => {
      if (typ === "INSERT") showToast("Nová rezervace z webu", "info");
      void nacti();
    });
    // Kalendář zůstává připojený i skrytý; po založení zakázky z rezervace
    // (Orders) a při návratu do okna se seznam načte znovu, kdyby realtime
    // zprávu neprošla. Minutový interval je pojistka.
    const onZmena = () => void nacti();
    const onViditelnost = () => { if (document.visibilityState === "visible") void nacti(); };
    window.addEventListener("jobsheet:rezervace-zmena", onZmena);
    document.addEventListener("visibilitychange", onViditelnost);
    const interval = window.setInterval(() => void nacti(), 60_000);
    return () => {
      odhlasit();
      window.removeEventListener("jobsheet:rezervace-zmena", onZmena);
      document.removeEventListener("visibilitychange", onViditelnost);
      window.clearInterval(interval);
    };
  }, [activeServiceId, nacti]);

  const otevrene = rezervace.filter((r) => r.status === "new" || r.status === "confirmed");
  const uzavrene = rezervace.filter((r) => r.status === "converted" || r.status === "cancelled").slice(0, 10);
  if (rezervace.length === 0) return null;

  const zmenStav = async (r: Rezervace, status: Rezervace["status"]) => {
    try {
      await nastavStavRezervace(r.id, status);
      setRezervace((prev) => prev.map((x) => (x.id === r.id ? { ...x, status } : x)));
    } catch {
      showToast("Změnu rezervace se nepodařilo uložit", "error");
    }
  };

  const stitek = (status: Rezervace["status"]) => {
    const map: Record<Rezervace["status"], { text: string; bg: string; fg: string }> = {
      new: { text: "Nová", bg: "var(--accent-soft)", fg: "var(--accent)" },
      confirmed: { text: "Potvrzená", bg: "rgba(22,163,74,0.12)", fg: "var(--success-text, #16a34a)" },
      converted: { text: "Zakázka založena", bg: "var(--panel-2)", fg: "var(--muted)" },
      cancelled: { text: "Zrušená", bg: "var(--panel-2)", fg: "var(--muted)" },
    };
    const m = map[status];
    return <span style={{ display: "inline-block", padding: "2px 8px", borderRadius: 999, fontSize: 11, fontWeight: 700, background: m.bg, color: m.fg }}>{m.text}</span>;
  };

  const radek = (r: Rezervace) => (
    <li key={r.id} data-rezervace={r.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, flexWrap: "wrap", padding: "10px 12px", borderRadius: 10, border: "1px solid var(--border)", background: "var(--panel)" }}>
      <div style={{ display: "grid", gap: 2, minWidth: 0, fontSize: 13 }}>
        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          <span style={{ fontWeight: 800 }}>{r.customer_name}</span>
          <span style={{ color: "var(--muted)" }}>{r.customer_phone}{r.customer_email ? ` · ${r.customer_email}` : ""}</span>
          {stitek(r.status)}
        </div>
        <div>
          {r.device_label}{r.model_name && r.model_name !== r.device_label ? ` (${r.model_name})` : ""}
          {r.repair_name ? ` · ${r.repair_name}` : ""}
          {r.price_estimate ? ` · cca ${r.price_estimate.toLocaleString("cs-CZ")} Kč` : ""}
          <span style={{ color: "var(--muted)" }}> · termín {popisTerminu(r)}</span>
        </div>
        {r.note && <div style={{ color: "var(--muted)" }}>{r.note}</div>}
      </div>
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
        {(r.status === "new" || r.status === "confirmed") && (
          <>
            <Button size="sm" variant="primary" onClick={() => onZalozitZakazku(r)}>Založit zakázku</Button>
            {r.status === "new" && <Button size="sm" variant="soft" onClick={() => void zmenStav(r, "confirmed")}>Potvrdit</Button>}
            <Button size="sm" variant="ghost" onClick={() => void zmenStav(r, "cancelled")}>Zrušit</Button>
          </>
        )}
        {r.status === "converted" && r.ticket_id && (
          <Button size="sm" variant="soft" onClick={() => onOpenTicket(r.ticket_id!)}>Otevřít zakázku</Button>
        )}
      </div>
    </li>
  );

  return (
    <section aria-label="Rezervace z webu" style={{ padding: "12px 20px", borderBottom: "1px solid var(--border)", background: "var(--panel-2)" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, marginBottom: 8 }}>
        <div style={{ fontWeight: 900, fontSize: 14 }}>
          Rezervace z webu{otevrene.length > 0 ? ` · ${otevrene.length} k vyřízení` : ""}
        </div>
        {uzavrene.length > 0 && (
          <Button size="sm" variant="ghost" onClick={() => setZobrazitUzavrene((v) => !v)}>
            {zobrazitUzavrene ? "Skrýt vyřízené" : `Vyřízené (${uzavrene.length})`}
          </Button>
        )}
      </div>
      {otevrene.length === 0 && !zobrazitUzavrene && <div style={{ fontSize: 13, color: "var(--muted)" }}>Žádná nevyřízená rezervace.</div>}
      <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "grid", gap: 6 }}>
        {otevrene.map(radek)}
        {zobrazitUzavrene && uzavrene.map(radek)}
      </ul>
    </section>
  );
}
