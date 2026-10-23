import { useMemo, useState } from "react";
import { Button, Input, Pill, Segmented } from "./ui";
import { showToast } from "./Toast";
import { reportError } from "../lib/reportError";
import { jdeZrusit, objednatDpd, otevritStitek, sledovatDpd, stavDpdText, stitekDpd, zrusitDpd, type ObjednavkaDpd, type RezimDpd } from "../lib/prepravaDpd";

/**
 * Přeprava DPD v detailu zásilky (Zásilky). Bez objednávky formulář
 * (štítek / kurýr, počet balíků, den svozu), s objednávkou stav, čísla
 * balíků, štítek a zrušení. Volá edge funkci zasilka-dpd.
 */

/** Pracovní dny pro výběr svozu (dnešek + 5), v pražském čase jako na serveru. */
function nabidkaDnu(): Array<{ value: string; label: string }> {
  const fmt = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Prague", year: "numeric", month: "2-digit", day: "2-digit" });
  const d = new Date(`${fmt.format(new Date())}T12:00:00Z`);
  const out: Array<{ value: string; label: string }> = [];
  while (out.length < 6) {
    if (d.getUTCDay() !== 0 && d.getUTCDay() !== 6) {
      const iso = d.toISOString().slice(0, 10);
      out.push({ value: iso, label: d.toLocaleDateString("cs-CZ", { weekday: "short", day: "numeric", month: "numeric", timeZone: "UTC" }) });
    }
    d.setUTCDate(d.getUTCDate() + 1);
  }
  return out;
}

export function PrepravaDpd({
  shipmentId,
  cislo,
  objednavka,
  muzeObjednat,
  testovaci,
  serviceId,
  onZmena,
}: {
  shipmentId: string;
  cislo: string;
  objednavka: ObjednavkaDpd | null;
  /** Zásilka je koncept nebo odeslaná (převzatou ani stornovanou už nikam neposíláme). */
  muzeObjednat: boolean;
  testovaci: boolean;
  serviceId: string | null;
  onZmena: () => void;
}) {
  const [rezim, setRezim] = useState<RezimDpd>("label");
  const [baliku, setBaliku] = useState("1");
  const [den, setDen] = useState("asap");
  const [pracuje, setPracuje] = useState<null | "create" | "label" | "track" | "cancel">(null);
  const dny = useMemo(nabidkaDnu, []);
  const ziva = objednavka && objednavka.status !== "cancelled" ? objednavka : null;

  const akce = async (co: "create" | "label" | "track" | "cancel", fn: () => Promise<void>) => {
    if (pracuje) return;
    setPracuje(co);
    try {
      await fn();
    } catch (error) {
      reportError({ code: `zasilky.dpd_${co}_failed`, error, userMessage: error instanceof Error ? error.message : "Přeprava DPD selhala.", source: "PrepravaDpd", serviceId });
    } finally {
      setPracuje(null);
      onZmena();
    }
  };

  const objednat = () => akce("create", async () => {
    const r = await objednatDpd({ shipmentId, mode: rezim, parcels: Number(baliku) || 1, pickupDate: rezim === "courier" ? den : undefined });
    if (r.labelBase64) otevritStitek(r.labelBase64, `DPD-${cislo}.pdf`);
    if (r.varovani) showToast(r.varovani, "error");
    else showToast(rezim === "courier" ? "Přeprava objednána, kurýr přijede pro balík." : "Štítek je připravený – nalepte ho a podejte na výdejním místě DPD.", "success");
  });

  const titulek = (
    <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
      <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: "0.04em", textTransform: "uppercase", color: "var(--muted)" }}>Přeprava DPD</span>
      {testovaci && <Pill>testovací prostředí</Pill>}
    </div>
  );

  if (ziva) {
    return (
      <div data-tour="zasilky-dpd" style={{ display: "grid", gap: 8, padding: 10, borderRadius: 10, border: "1px solid var(--border)", background: "var(--panel-2)" }}>
        {titulek}
        <div style={{ display: "flex", gap: 8, alignItems: "baseline", flexWrap: "wrap", fontSize: 13 }}>
          <strong>{ziva.mode === "courier" ? "Kurýr" : "Štítek"}</strong>
          <span>· {stavDpdText(ziva)}</span>
          <span style={{ color: "var(--muted)" }}>· {ziva.parcels} {ziva.parcels === 1 ? "balík" : ziva.parcels < 5 ? "balíky" : "balíků"}</span>
        </div>
        {ziva.statusText && ziva.status !== "delivered" && (
          <div style={{ fontSize: 12, color: ziva.status === "created" || ziva.status === "pickup_ordered" ? "var(--muted)" : "var(--text)" }}>DPD: {ziva.statusText}</div>
        )}
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap", fontSize: 12 }}>
          {ziva.parcelNumbers.map((n) => (
            <a key={n} href={`https://tracking.dpd.de/status/cs_CZ/parcel/${encodeURIComponent(n)}`} target="_blank" rel="noreferrer" style={{ color: "var(--accent)", fontWeight: 700 }}>{n}</a>
          ))}
        </div>
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          <Button size="sm" variant="soft" disabled={!!pracuje} onClick={() => void akce("label", async () => otevritStitek(await stitekDpd(shipmentId), `DPD-${cislo}.pdf`))}>
            {pracuje === "label" ? "Stahuji…" : "Tisk štítku"}
          </Button>
          {ziva.status !== "delivered" && (
            <Button size="sm" variant="ghost" disabled={!!pracuje} onClick={() => void akce("track", async () => { await sledovatDpd(shipmentId); })} title="Stav se jinak aktualizuje sám každou hodinu">
              {pracuje === "track" ? "Zjišťuji…" : "Aktualizovat stav"}
            </Button>
          )}
          {jdeZrusit(ziva) && (
            <Button size="sm" variant="ghost" disabled={!!pracuje} onClick={() => void akce("cancel", async () => { await zrusitDpd(shipmentId); showToast(ziva.pickupOrderId ? "Svoz u DPD zrušen." : "Objednávka zrušena. Štítek už nepoužívejte.", "success"); })}>
              {pracuje === "cancel" ? "Ruším…" : ziva.mode === "courier" ? "Zrušit svoz" : "Zrušit štítek"}
            </Button>
          )}
        </div>
      </div>
    );
  }

  if (!muzeObjednat) return null;

  return (
    <div data-tour="zasilky-dpd" style={{ display: "grid", gap: 8, padding: 10, borderRadius: 10, border: "1px solid var(--border)", background: "var(--panel-2)" }}>
      {titulek}
      <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
        <Segmented<RezimDpd>
          size="sm"
          ariaLabel="Způsob přepravy"
          value={rezim}
          onChange={setRezim}
          options={[
            { value: "label", label: "Štítek (podám sám)" },
            { value: "courier", label: "Kurýr (svoz)" },
          ]}
        />
        <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, color: "var(--muted)" }}>
          balíků
          <Input type="number" min={1} max={10} value={baliku} onChange={(e) => setBaliku(e.target.value.replace(/\D/g, "").slice(0, 2))} style={{ width: 64 }} aria-label="Počet balíků" />
        </label>
        {rezim === "courier" && (
          <select className="ui-input" aria-label="Den svozu" value={den} onChange={(e) => setDen(e.target.value)} style={{ width: "auto" }}>
            <option value="asap">co nejdřív</option>
            {dny.map((d) => <option key={d.value} value={d.value}>{d.label}</option>)}
          </select>
        )}
        <Button size="sm" variant="primary" disabled={!!pracuje || !(Number(baliku) >= 1 && Number(baliku) <= 10)} onClick={() => void objednat()}>
          {pracuje === "create" ? "Objednávám…" : "Objednat DPD"}
        </Button>
      </div>
      <div style={{ fontSize: 12, color: "var(--muted)" }}>
        {rezim === "label"
          ? "Vytiskne se štítek, krabici podáte na kterémkoli výdejním místě DPD."
          : "DPD pošle kurýra na adresu pobočky odeslání. „Co nejdřív“ zkusí dnešek a další pracovní dny."}
        {" "}Číslo balíku se zapíše do zásilky, stav se pak aktualizuje sám.
      </div>
    </div>
  );
}
