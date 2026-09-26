import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { Button } from "./ui";
import { supabase } from "../lib/supabaseClient";
import { parseCsv, type CsvTabulka } from "../lib/csv";
import { loadDevicesFromDb, type DevicesData } from "../lib/devicesDb";
import { POLE_CENIKU, POPIS_POLE_CENIKU, VYCHOZI_KATEGORIE, odhadniMapovaniCeniku, pripravCenik, zapisCenik, type PoleCeniku, type VysledekCeniku } from "../lib/importCeniku";

/**
 * Import ceníku oprav z CSV do katalogu servisu (značky → kategorie →
 * modely → opravy). Stejný postup jako import zákazníků: soubor → odhad
 * sloupců (jde přemapovat) → náhled a shrnutí → zápis. Co v katalogu podle
 * názvu už je, se znovu nezakládá. Stránka Zařízení si změny stáhne sama
 * přes realtime, není potřeba ji obnovovat.
 */
export function ImportCeniku({
  open,
  onClose,
  activeServiceId,
  onHotovo,
}: {
  open: boolean;
  onClose: () => void;
  activeServiceId: string | null;
  onHotovo: (vysledek: VysledekCeniku) => void;
}) {
  const [tabulka, setTabulka] = useState<CsvTabulka | null>(null);
  const [nazevSouboru, setNazevSouboru] = useState("");
  const [mapovani, setMapovani] = useState<Array<PoleCeniku | null>>([]);
  const [katalog, setKatalog] = useState<DevicesData | null>(null);
  const [bezi, setBezi] = useState(false);
  const [postup, setPostup] = useState(0);
  const [vysledek, setVysledek] = useState<VysledekCeniku | null>(null);
  const [chyba, setChyba] = useState<string | null>(null);

  useEffect(() => {
    if (!open) {
      setTabulka(null);
      setNazevSouboru("");
      setMapovani([]);
      setKatalog(null);
      setBezi(false);
      setPostup(0);
      setVysledek(null);
      setChyba(null);
    }
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !bezi) {
        e.preventDefault();
        e.stopPropagation();
        onClose();
      }
    };
    document.addEventListener("keydown", onKey, true);
    return () => document.removeEventListener("keydown", onKey, true);
  }, [open, bezi, onClose]);

  // Stávající katalog – podle něj se pozná, co už servis má a nemá se zakládat znovu.
  useEffect(() => {
    if (!open || !activeServiceId) return;
    let zruseno = false;
    void loadDevicesFromDb(activeServiceId).then((r) => {
      if (zruseno) return;
      if (r.error) {
        setChyba("Nepodařilo se načíst stávající katalog – zkuste to znovu.");
        return;
      }
      setKatalog(r.data);
    });
    return () => { zruseno = true; };
  }, [open, activeServiceId]);

  const nactiSoubor = async (soubor: File) => {
    setChyba(null);
    setVysledek(null);
    const text = await soubor.text();
    const t = parseCsv(text);
    if (t.hlavicka.length === 0 || t.radky.length === 0) {
      setChyba("Soubor je prázdný nebo v něm chybí hlavička se sloupci.");
      setTabulka(null);
      return;
    }
    setNazevSouboru(soubor.name);
    setTabulka(t);
    setMapovani(odhadniMapovaniCeniku(t.hlavicka));
  };

  const zmenMapovani = (i: number, pole: PoleCeniku | null) => {
    // Jedno pole smí mít jen jeden sloupec – jinak by se hodnoty tiše přebíjely.
    setMapovani((prev) => prev.map((x, j) => (j === i ? pole : x === pole ? null : x)));
  };

  const plan = useMemo(() => {
    if (!tabulka || !katalog) return null;
    return pripravCenik(tabulka, mapovani, katalog);
  }, [tabulka, mapovani, katalog]);

  const maZnackuAModel = mapovani.includes("brand") && mapovani.includes("model");
  const pocetZmen = plan ? plan.brands.length + plan.categories.length + plan.models.length + plan.repairs.length + plan.rozsireni.length : 0;

  const importovat = async () => {
    if (!plan || !activeServiceId || !supabase) return;
    setBezi(true);
    setChyba(null);
    const klient = { from: (tabulka: string) => supabase!.from(tabulka) as any };
    const v = await zapisCenik(klient, activeServiceId, plan, setPostup);
    setVysledek(v);
    setBezi(false);
    onHotovo(v);
  };

  if (!open) return null;

  const input: React.CSSProperties = { padding: "6px 8px", borderRadius: 8, border: "1px solid var(--border)", background: "var(--panel)", color: "var(--text)", fontSize: 12, fontFamily: "inherit", width: "100%", boxSizing: "border-box" };
  const bunka: React.CSSProperties = { padding: "4px 6px", borderBottom: "1px solid var(--border)", color: "var(--muted)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", maxWidth: 200 };

  return createPortal(
    <div role="dialog" aria-modal="true" aria-labelledby="import-ceniku-nadpis" data-escape-vlastni onMouseDown={(e) => e.stopPropagation()} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 10_000, padding: 16 }}>
      <div style={{ background: "var(--panel)", color: "var(--text)", borderRadius: 14, border: "1px solid var(--border)", padding: 20, width: "min(100%, 860px)", maxHeight: "90vh", overflow: "auto", display: "grid", gap: 14, boxShadow: "0 20px 60px rgba(0,0,0,0.35)" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12 }}>
          <div>
            <h2 id="import-ceniku-nadpis" style={{ margin: 0, fontSize: 17, fontWeight: 800 }}>Import ceníku z CSV</h2>
            <div style={{ color: "var(--muted)", fontSize: 13, marginTop: 4 }}>
              Jeden řádek = jedna oprava u jednoho modelu (značka, kategorie, model, oprava, cena, náklady, čas). Bez kategorie se model zařadí do „{VYCHOZI_KATEGORIE}“. Co v katalogu podle názvu už je, se nezakládá znovu.
            </div>
          </div>
          <Button size="sm" variant="ghost" onClick={onClose} disabled={bezi}>Zavřít</Button>
        </div>

        {!vysledek && (
          <label style={{ display: "grid", gap: 6, fontSize: 13 }}>
            <span style={{ color: "var(--muted)" }}>Soubor (CSV nebo TXT)</span>
            <input type="file" accept=".csv,.txt,text/csv,text/plain" aria-label="Soubor CSV s ceníkem" disabled={bezi} onChange={(e) => { const f = e.target.files?.[0]; if (f) void nactiSoubor(f); }} style={{ ...input, padding: "8px 10px", cursor: "pointer" }} />
          </label>
        )}
        {chyba && <div role="alert" style={{ color: "#dc2626", fontSize: 13 }}>{chyba}</div>}

        {tabulka && !vysledek && (
          <>
            <div style={{ fontSize: 13, color: "var(--muted)" }}>
              {nazevSouboru} · {tabulka.radky.length} řádků · oddělovač „{tabulka.oddelovac === "\t" ? "tabulátor" : tabulka.oddelovac}“
            </div>
            <div style={{ overflowX: "auto" }}>
              <table style={{ borderCollapse: "collapse", fontSize: 12, minWidth: "100%" }}>
                <thead>
                  <tr>
                    {tabulka.hlavicka.map((h, i) => (
                      <th key={i} style={{ textAlign: "left", padding: "6px 6px", borderBottom: "1px solid var(--border)", verticalAlign: "top", minWidth: 140 }}>
                        <div style={{ fontWeight: 700, marginBottom: 4, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", maxWidth: 200 }}>{h || `Sloupec ${i + 1}`}</div>
                        <select aria-label={`Význam sloupce ${h || i + 1}`} value={mapovani[i] ?? ""} onChange={(e) => zmenMapovani(i, (e.target.value || null) as PoleCeniku | null)} disabled={bezi} style={input}>
                          <option value="">– nepoužít –</option>
                          {POLE_CENIKU.map((p) => <option key={p} value={p}>{POPIS_POLE_CENIKU[p]}</option>)}
                        </select>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {tabulka.radky.slice(0, 5).map((r, ri) => (
                    <tr key={ri}>
                      {tabulka.hlavicka.map((_, ci) => <td key={ci} style={bunka}>{r[ci] ?? ""}</td>)}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {!maZnackuAModel && <div role="alert" style={{ color: "#dc2626", fontSize: 13 }}>Určete, který sloupec je značka a který model.</div>}

            {plan && plan.chyby.length > 0 && (
              <div role="alert" style={{ fontSize: 12, color: "#dc2626", display: "grid", gap: 2 }}>
                <div style={{ fontWeight: 700 }}>Řádky s chybou se neimportují ({plan.chyby.length}):</div>
                {plan.chyby.slice(0, 10).map((c) => <div key={c.radek}>řádek {c.radek}: {c.zprava}</div>)}
                {plan.chyby.length > 10 && <div>… a dalších {plan.chyby.length - 10}</div>}
              </div>
            )}

            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
              <div style={{ fontSize: 13 }}>
                {!plan ? "Načítám stávající katalog…" : (
                  <>
                    Nově: <b>{plan.brands.length}</b> značek · <b>{plan.categories.length}</b> kategorií · <b>{plan.models.length}</b> modelů · <b>{plan.repairs.length}</b> oprav
                    {plan.rozsireni.length > 0 ? <> · <b>{plan.rozsireni.length}</b> oprav dostane další modely</> : null}
                    {plan.preskoceno > 0 ? <> · {plan.preskoceno} oprav už máte (přeskočí se)</> : null}
                  </>
                )}
              </div>
              <Button variant="primary" onClick={() => void importovat()} disabled={bezi || !maZnackuAModel || !plan || pocetZmen === 0}>
                {bezi ? `Importuji… ${postup} %` : `Importovat ${pocetZmen} položek`}
              </Button>
            </div>
          </>
        )}

        {vysledek && (
          <div style={{ display: "grid", gap: 8, fontSize: 14 }}>
            <div style={{ fontWeight: 800 }}>Hotovo</div>
            <div>
              Založeno <b>{vysledek.znacek}</b> značek, <b>{vysledek.kategorii}</b> kategorií, <b>{vysledek.modelu}</b> modelů a <b>{vysledek.oprav}</b> oprav
              {vysledek.rozsireno > 0 ? `, ${vysledek.rozsireno} oprav rozšířeno o další modely` : ""}.
            </div>
            {vysledek.chyby.length > 0 && (
              <div role="alert" style={{ fontSize: 12, color: "#dc2626", display: "grid", gap: 2 }}>
                {vysledek.chyby.map((c, i) => <div key={i}>{c}</div>)}
              </div>
            )}
            <div><Button variant="primary" onClick={onClose}>Zavřít</Button></div>
          </div>
        )}
      </div>
    </div>,
    document.body,
  );
}
