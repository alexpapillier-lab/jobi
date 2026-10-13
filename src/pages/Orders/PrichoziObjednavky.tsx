import { useCallback, useEffect, useMemo, useState } from "react";
import { Button, Input, Segmented, type SegmentedOption } from "../../components/ui";
import { showToast } from "../../components/Toast";
import { useBranches } from "../../context/BranchContext";
import { otevriVProhlizeci } from "../../lib/platform";
import {
  POPIS_STAVU,
  jeOtevrena,
  nactiObjednavky,
  objednavkaZakazky,
  nastavStavObjednavky,
  odpovidaHledani,
  sledovaciOdkazy,
  sledujObjednavky,
  type StavObjednavky,
  type WebObjednavka,
} from "../../lib/objednavky";
import { detailSouhlasu, nactiPodpisPrevzeti, textSouhlasu, type PodpisPrevzeti, type SouhlasZakazky } from "../../lib/souhlasPrevzeti";

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

/**
 * Detail zakázky: „Z objednávky SRV-2026-0123 (servis.iswap.cz)“ a pod tím
 * „Elektronicky odsouhlaseno … (ID …)“ s rozbalitelným detailem (čas,
 * metoda, IP, prohlížeč, verze podmínek). Nic z toho = nic se neukáže.
 */
export function ZObjednavky({ ticketId }: { ticketId: string }) {
  const [o, setO] = useState<{ externi_cislo: string; zdroj: string } | null>(null);
  const [souhlas, setSouhlas] = useState<SouhlasZakazky | null>(null);
  const [otevreno, setOtevreno] = useState(false);
  useEffect(() => {
    let zruseno = false;
    void Promise.all([objednavkaZakazky(ticketId), nactiPodpisPrevzeti(ticketId).catch(() => ({}) as PodpisPrevzeti)]).then(([x, p]) => {
      if (zruseno) return;
      setO(x);
      setSouhlas(p.intakeConsent ?? null);
      setOtevreno(false);
    });
    return () => { zruseno = true; };
  }, [ticketId]);
  if (!o && !souhlas) return null;
  return (
    <div data-tour="detail-z-objednavky" style={{ display: "grid", gap: 4, fontSize: 12, color: "var(--muted)", flexBasis: "100%" }}>
      {o && (
        <div>
          Z objednávky <strong style={{ color: "var(--text)" }}>{o.externi_cislo}</strong>{o.zdroj ? ` (${o.zdroj})` : ""}
        </div>
      )}
      {souhlas && (
        <div>
          <button
            type="button"
            onClick={() => setOtevreno((v) => !v)}
            aria-expanded={otevreno}
            title="Zobrazit detail elektronického odsouhlasení"
            style={{ border: "none", background: "none", padding: 0, color: "var(--accent)", fontWeight: 700, cursor: "pointer", fontFamily: "inherit", fontSize: "inherit", textAlign: "left" }}
          >
            {otevreno ? "▾" : "▸"} {textSouhlasu(souhlas)}
            {souhlas.signature_url ? " · s podpisem" : ""}
          </button>
          {otevreno && (
            <dl style={{ display: "grid", gridTemplateColumns: "auto 1fr", gap: "2px 10px", margin: "6px 0 0", padding: 8, borderRadius: 8, background: "var(--panel-2)" }}>
              {detailSouhlasu(souhlas).map(([k, v]) => (
                <div key={k} style={{ display: "contents" }}>
                  <dt style={{ color: "var(--muted)" }}>{k}</dt>
                  <dd style={{ margin: 0, color: "var(--text)", overflowWrap: "anywhere" }}>{v}</dd>
                </div>
              ))}
            </dl>
          )}
        </div>
      )}
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
  const { activeBranchId, branches } = useBranches();
  // Objednávka bez pobočky (smazaná pobočka) patří do výchozí, ne do všech.
  const vychoziPobocka = branches.find((b) => b.isDefault)?.id ?? null;
  const [filtr, setFiltr] = useState<FiltrObjednavek>("vse");
  const [vse, setVse] = useState(false);
  const [hledat, setHledat] = useState("");
  const [sbaleno, setSbalenoStav] = useState(nactiSbaleno);
  const setSbaleno = (v: boolean) => {
    setSbalenoStav(v);
    try { localStorage.setItem(KLIC_SBALENO, v ? "1" : "0"); } catch { /* jen pohodlí */ }
  };

  const viditelne = useMemo(
    () => objednavky.filter((o) => !activeBranchId || (o.branch_id ?? vychoziPobocka ?? activeBranchId) === activeBranchId),
    [objednavky, activeBranchId, vychoziPobocka],
  );
  const otevrene = useMemo(
    () => viditelne.filter((o) => jeOtevrena(o.stav)).sort((a, b) => (PORADI[a.stav] ?? 9) - (PORADI[b.stav] ?? 9) || b.created_at.localeCompare(a.created_at)),
    [viditelne],
  );
  const vyrizene = useMemo(
    () => viditelne.filter((o) => !jeOtevrena(o.stav)).sort((a, b) => b.updated_at.localeCompare(a.updated_at)).slice(0, 20),
    [viditelne],
  );
  if (viditelne.length === 0) return null;

  const pocty = { dorazilo: 0, nova: 0, na_ceste: 0 } as Record<StavObjednavky, number>;
  for (const o of otevrene) pocty[o.stav] = (pocty[o.stav] ?? 0) + 1;
  const zdroje = new Set(viditelne.map((o) => o.zdroj).filter(Boolean));
  const jedenZdroj = zdroje.size === 1 ? [...zdroje][0] : null;

  // Hledání jde přes všechny objednávky (i vyřízené), filtr stavu se při něm neuplatní.
  const hleda = hledat.trim().length > 0;
  const seznam = hleda
    ? [...otevrene, ...vyrizene].filter((o) => odpovidaHledani(o, hledat))
    : filtr === "vyrizene" ? vyrizene : filtr === "vse" ? otevrene : otevrene.filter((o) => o.stav === filtr);
  const ukazane = vse ? seznam : seznam.slice(0, LIMIT);

  const volby: SegmentedOption<FiltrObjednavek>[] = [
    { value: "vse", label: `Vše ${otevrene.length}` },
    ...(["dorazilo", "nova", "na_ceste"] as const)
      .filter((st) => pocty[st] > 0)
      .map((st) => ({ value: st as FiltrObjednavek, label: `${POPIS_STAVU[st]} ${pocty[st]}` })),
    ...(vyrizene.length > 0 ? [{ value: "vyrizene" as FiltrObjednavek, label: "Vyřízené" }] : []),
  ];

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

  const radek = (o: WebObjednavka) => {
    const zavada = o.pozadovana_oprava || o.popis_zavady || "";
    const otevrena = jeOtevrena(o.stav);
    return (
      <li key={o.id} data-objednavka={o.id} className="po-radek">
        <div className="po-cislo">
          <span className="po-mono">{o.externi_cislo}</span>
          <StitekObjednavky stav={o.stav} />
        </div>
        <div className="po-zakaznik">
          <span className="po-silne po-jeden">{o.zakaznik_jmeno || "Zákazník"}</span>
          {o.zakaznik_telefon && <span className="po-tlumene po-jeden">{o.zakaznik_telefon}</span>}
        </div>
        <div className="po-zarizeni">
          <span className="po-jeden">
            <span className="po-silne">{o.zarizeni || "Zařízení neuvedeno"}</span>
            {o.sn_imei ? <span className="po-tlumene"> · {o.sn_imei}</span> : null}
          </span>
          {zavada && <span className="po-tlumene po-dva" title={zavada}>{zavada}</span>}
        </div>
        <div className="po-doprava po-tlumene">
          {o.doprava_tam && <span className="po-jeden" title={o.doprava_tam}>{o.doprava_tam}</span>}
          <SledovaciCisla objednavka={o} />
          <span className="po-jeden" title={casFmt(o.created_at)}>
            {datumFmt(o.created_at)}{!jedenZdroj && o.zdroj ? ` · ${o.zdroj}` : ""}
          </span>
        </div>
        <div className="po-akce">
          {otevrena && (
            <>
              <Button size="sm" variant="primary" onClick={() => zalozitZakazkuZObjednavky(o)}>Založit zakázku</Button>
              {o.stav !== "dorazilo" && <Button size="sm" variant="soft" onClick={() => void zmenStav(o, "dorazilo")}>Dorazilo</Button>}
              <Button size="sm" variant="ghost" onClick={() => void zmenStav(o, "zrusena")} title="Zrušit objednávku">Zrušit</Button>
            </>
          )}
          {o.stav === "prevedeno" && o.ticket_id && (
            <Button size="sm" variant="soft" onClick={() => onOpenTicket(o.ticket_id!)}>Otevřít zakázku</Button>
          )}
        </div>
      </li>
    );
  };

  return (
    <section data-tour="orders-objednavky" aria-label="Příchozí objednávky z webu" className="po-panel">
      <style>{STYL}</style>
      <div className="po-hlavicka">
        <button type="button" className="po-titulek" onClick={() => setSbaleno(!sbaleno)} aria-expanded={!sbaleno}>
          <span aria-hidden="true" className="po-sipka" style={{ transform: sbaleno ? "rotate(-90deg)" : undefined }}>▾</span>
          <span>Příchozí objednávky</span>
          {otevrene.length > 0 && <span className="po-pocet">{otevrene.length}</span>}
          {jedenZdroj && <span className="po-tlumene po-zdroj">z {jedenZdroj}</span>}
        </button>
        {sbaleno ? (
          <span className="po-tlumene po-souhrn">
            {(["dorazilo", "nova", "na_ceste"] as const).filter((st) => pocty[st] > 0).map((st) => `${POPIS_STAVU[st]} ${pocty[st]}`).join(" · ")}
          </span>
        ) : (
          <div className="po-ovladani">
            <Input
              type="search"
              className="po-hledat"
              value={hledat}
              onChange={(e) => { setHledat(e.target.value); setVse(false); }}
              onKeyDown={(e) => { if (e.key === "Escape") setHledat(""); }}
              placeholder="Hledat číslo, jméno, telefon, zařízení…"
              aria-label="Hledat v příchozích objednávkách"
            />
            {!hleda && volby.length > 2 && (
              <Segmented
                size="sm"
                ariaLabel="Filtr objednávek"
                value={filtr}
                options={volby}
                onChange={(v) => { setFiltr(v); setVse(false); }}
              />
            )}
          </div>
        )}
      </div>
      {!sbaleno && (
        <>
          {seznam.length === 0 ? (
            <div className="po-tlumene" style={{ fontSize: 13, padding: "6px 2px" }}>
              {hleda ? `Nic neodpovídá „${hledat.trim()}“.` : filtr === "vyrizene" ? "Žádná vyřízená objednávka." : "Žádná nevyřízená objednávka."}
            </div>
          ) : (
            <ul className="po-seznam">{ukazane.map(radek)}</ul>
          )}
          {seznam.length > LIMIT && (
            <button type="button" className="po-vice" onClick={() => setVse(!vse)}>
              {vse ? "Zobrazit méně" : `Zobrazit všech ${seznam.length}`}
            </button>
          )}
        </>
      )}
    </section>
  );
}

type FiltrObjednavek = "vse" | "vyrizene" | StavObjednavky;

/** Nahoře to, co čeká na akci: dorazilo → založit zakázku, nová → čeká na odeslání. */
const PORADI: Partial<Record<StavObjednavky, number>> = { dorazilo: 0, nova: 1, na_ceste: 2 };
const LIMIT = 5;
const KLIC_SBALENO = "jobi_objednavky_sbaleno_v1";

function nactiSbaleno(): boolean {
  try { return localStorage.getItem(KLIC_SBALENO) === "1"; } catch { return false; }
}

const datumFmt = (iso: string) => {
  const d = new Date(iso);
  const dnes = new Date();
  const vcera = new Date(dnes.getFullYear(), dnes.getMonth(), dnes.getDate() - 1);
  const cas = d.toLocaleTimeString("cs-CZ", { hour: "2-digit", minute: "2-digit" });
  if (d.toDateString() === dnes.toDateString()) return `dnes ${cas}`;
  if (d.toDateString() === vcera.toDateString()) return `včera ${cas}`;
  return d.toLocaleDateString("cs-CZ", { day: "numeric", month: "numeric" });
};

/** Řádek je mřížka, aby tlačítka seděla vpravo vždy na stejném místě. */
const STYL = `
.po-panel{padding:12px 14px;border-radius:12px;border:1px solid var(--border);background:var(--panel-2)}
.po-hlavicka{display:flex;align-items:center;justify-content:space-between;gap:10px;flex-wrap:wrap}
.po-titulek{display:inline-flex;align-items:center;gap:8px;border:none;background:none;padding:0;font:inherit;font-weight:900;font-size:14px;color:var(--text);cursor:pointer}
.po-sipka{display:inline-block;font-size:12px;color:var(--muted);transition:transform .15s}
.po-pocet{min-width:20px;padding:1px 7px;border-radius:999px;background:var(--accent);color:var(--accent-contrast,#fff);font-size:11px;font-weight:800;text-align:center}
.po-zdroj{font-weight:500;font-size:12px}
.po-souhrn{font-size:12px}
.po-ovladani{display:flex;align-items:center;gap:8px;flex-wrap:wrap}
.po-hledat{width:260px;max-width:100%;height:30px;font-size:13px}
.po-tlumene{color:var(--muted)}
.po-silne{font-weight:700;color:var(--text)}
.po-mono{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-weight:800;font-size:12px}
.po-jeden{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;min-width:0}
.po-dva{display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;overflow-wrap:anywhere}
.po-seznam{list-style:none;margin:10px 0 0;padding:0;border:1px solid var(--border);border-radius:10px;background:var(--panel);overflow:hidden}
.po-radek{display:grid;grid-template-columns:118px minmax(130px,1fr) minmax(180px,2.2fr) minmax(130px,1fr) auto;gap:14px;align-items:center;padding:10px 12px;font-size:13px}
.po-radek+.po-radek{border-top:1px solid var(--border)}
.po-radek:hover{background:var(--panel-2)}
.po-cislo,.po-zakaznik,.po-zarizeni,.po-doprava{display:grid;gap:3px;min-width:0}
.po-cislo,.po-doprava{justify-items:start}
.po-doprava{font-size:12px}
.po-akce{display:flex;gap:6px;justify-content:flex-end;flex-wrap:nowrap}
.po-vice{margin-top:8px;border:none;background:none;padding:2px;font:inherit;font-size:12px;font-weight:700;color:var(--accent);cursor:pointer}
@media (max-width:1100px){
  .po-radek{grid-template-columns:118px minmax(0,1fr) minmax(0,1.6fr) auto;}
  .po-doprava{display:none}
}
@media (max-width:760px){
  .po-ovladani,.po-hledat{width:100%}
  .po-radek{grid-template-columns:minmax(0,1fr) auto;grid-template-areas:"cislo cislo" "zak zak" "zar zar" "akce akce";gap:6px}
  .po-cislo{grid-area:cislo;display:flex;gap:8px;align-items:center}
  .po-zakaznik{grid-area:zak;display:flex;flex-wrap:wrap;gap:0 8px}
  .po-zarizeni{grid-area:zar}
  .po-akce{grid-area:akce;justify-content:flex-start;flex-wrap:wrap}
}
`;
