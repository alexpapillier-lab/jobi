import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { Button, Segmented } from "./ui";
import { supabase } from "../lib/supabaseClient";
import { fetchAllPages } from "../lib/fetchAllPages";
import { useStatuses } from "../state/StatusesStore";
import {
  POLE_ZAKAZKY,
  POPIS_POLE_ZAKAZKY,
  PREDVOLBY,
  navrhniMapovaniStavu,
  odhadniMapovaniZakazek,
  parseCsv,
  pripravZakazky,
  stavyZeSouboru,
  zapisZakazky,
  type PoleZakazky,
  type Predvolba,
  type VysledekZapisu,
} from "../lib/importZakazek";
import type { CsvTabulka } from "../lib/csv";

/**
 * Import zakázek z CSV – přechod ze Zakázkového listu, MyRepair nebo jiné
 * tabulky. Stejný postup jako import zákazníků: soubor → odhad sloupců
 * podle předvolby (jde přemapovat) → mapování cizích stavů na stavy servisu
 * → náhled a shrnutí → zápis po dávkách. Zakázka s číslem, které servis
 * už má, se přeskočí; řádky s chybou (datum, částka) se nahlásí s číslem
 * řádku a neimportují.
 */
export type VysledekImportuZakazek = VysledekZapisu & { chybnychRadku: number };

export function ImportZakazek({
  open,
  onClose,
  activeServiceId,
  onHotovo,
}: {
  open: boolean;
  onClose: () => void;
  activeServiceId: string | null;
  onHotovo: (vysledek: VysledekImportuZakazek) => void;
}) {
  const { statuses, fallbackKey } = useStatuses();
  const [predvolba, setPredvolba] = useState<Predvolba>("zl");
  const [tabulka, setTabulka] = useState<CsvTabulka | null>(null);
  const [nazevSouboru, setNazevSouboru] = useState("");
  const [mapovani, setMapovani] = useState<Array<PoleZakazky | null>>([]);
  const [mapovaniStavu, setMapovaniStavu] = useState<Record<string, string>>({});
  const [existujiciKody, setExistujiciKody] = useState<Set<string> | null>(null);
  const [bezi, setBezi] = useState(false);
  const [postup, setPostup] = useState(0);
  const [vysledek, setVysledek] = useState<VysledekImportuZakazek | null>(null);
  const [chyba, setChyba] = useState<string | null>(null);

  useEffect(() => {
    if (!open) {
      setTabulka(null);
      setNazevSouboru("");
      setMapovani([]);
      setMapovaniStavu({});
      setExistujiciKody(null);
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

  // Čísla zakázek, která servis už má – kvůli duplicitám. Načítá se až
  // s otevřením, ať se velký seznam netahá při každém renderu Nastavení.
  useEffect(() => {
    if (!open || !activeServiceId || !supabase) return;
    let zruseno = false;
    void fetchAllPages<{ code: string | null }>((from, to) =>
      (supabase!.from("tickets") as any).select("code").eq("service_id", activeServiceId).is("deleted_at", null).range(from, to),
    ).then((r) => {
      if (zruseno) return;
      if (r.error) {
        setChyba("Nepodařilo se načíst stávající zakázky, duplicity se nepoznají předem (při zápisu se přesto přeskočí).");
        setExistujiciKody(new Set());
        return;
      }
      setExistujiciKody(new Set(r.data.map((t) => (t.code ?? "").trim()).filter(Boolean)));
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
    const m = odhadniMapovaniZakazek(t.hlavicka, predvolba);
    setMapovani(m);
    setMapovaniStavu(navrhniMapovaniStavu(stavyZeSouboru(t, m), statuses, fallbackKey));
  };

  const zmenPredvolbu = (p: Predvolba) => {
    setPredvolba(p);
    if (!tabulka) return;
    const m = odhadniMapovaniZakazek(tabulka.hlavicka, p);
    setMapovani(m);
    setMapovaniStavu(navrhniMapovaniStavu(stavyZeSouboru(tabulka, m), statuses, fallbackKey));
  };

  const zmenMapovani = (i: number, pole: PoleZakazky | null) => {
    if (!tabulka) return;
    // Jedno pole smí mít jen jeden sloupec – jinak by se hodnoty tiše přebíjely.
    const m = mapovani.map((x, j) => (j === i ? pole : x === pole ? null : x));
    setMapovani(m);
    if (pole === "status" || mapovani[i] === "status") {
      setMapovaniStavu(navrhniMapovaniStavu(stavyZeSouboru(tabulka, m), statuses, fallbackKey));
    }
  };

  const priprava = useMemo(() => {
    if (!tabulka || !existujiciKody) return null;
    return pripravZakazky(tabulka, mapovani, { existujiciKody, stavy: statuses, fallbackKey, mapovaniStavu });
  }, [tabulka, mapovani, existujiciKody, statuses, fallbackKey, mapovaniStavu]);

  const maKod = mapovani.includes("code");

  const importovat = async () => {
    if (!priprava || !activeServiceId || !supabase) return;
    setBezi(true);
    setChyba(null);
    const radky = priprava.zaznamy.flatMap((z) => (z.stav === "novy" ? [z.data] : []));
    const klient = { from: (tabulka: string) => supabase!.from(tabulka) as any };
    const v = await zapisZakazky(klient, activeServiceId, radky, setPostup);
    const cely: VysledekImportuZakazek = { ...v, preskoceno: v.preskoceno + priprava.duplicit, chybnychRadku: priprava.chyb };
    setVysledek(cely);
    setBezi(false);
    onHotovo(cely);
  };

  if (!open) return null;

  const input: React.CSSProperties = { padding: "6px 8px", borderRadius: 8, border: "1px solid var(--border)", background: "var(--panel)", color: "var(--text)", fontSize: 12, fontFamily: "inherit", width: "100%", boxSizing: "border-box" };
  const bunka: React.CSSProperties = { padding: "4px 6px", borderBottom: "1px solid var(--border)", color: "var(--muted)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", maxWidth: 200 };

  return createPortal(
    <div role="dialog" aria-modal="true" aria-labelledby="import-zakazek-nadpis" data-escape-vlastni onMouseDown={(e) => e.stopPropagation()} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 10_000, padding: 16 }}>
      <div style={{ background: "var(--panel)", color: "var(--text)", borderRadius: 14, border: "1px solid var(--border)", padding: 20, width: "min(100%, 960px)", maxHeight: "90vh", overflow: "auto", display: "grid", gap: 14, boxShadow: "0 20px 60px rgba(0,0,0,0.35)" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12 }}>
          <div>
            <h2 id="import-zakazek-nadpis" style={{ margin: 0, fontSize: 17, fontWeight: 800 }}>Import zakázek z CSV</h2>
            <div style={{ color: "var(--muted)", fontSize: 13, marginTop: 4 }}>
              Export zakázek z jiného systému. První řádek jsou názvy sloupců. Zakázka s číslem, které už máte, se přeskočí; datum vydání se zapíše jako datum dokončení.
            </div>
          </div>
          <Button size="sm" variant="ghost" onClick={onClose} disabled={bezi}>Zavřít</Button>
        </div>

        {!vysledek && (
          <div style={{ display: "grid", gap: 10 }}>
            <div style={{ display: "grid", gap: 6, fontSize: 13 }}>
              <span style={{ color: "var(--muted)" }}>Odkud data jsou (předvolba názvů sloupců)</span>
              <Segmented
                ariaLabel="Předvolba sloupců"
                size="sm"
                value={predvolba}
                onChange={zmenPredvolbu}
                options={(Object.keys(PREDVOLBY) as Predvolba[]).map((p) => ({ value: p, label: PREDVOLBY[p].label, title: PREDVOLBY[p].popis, disabled: bezi }))}
              />
              <span style={{ color: "var(--muted)", fontSize: 12 }}>{PREDVOLBY[predvolba].popis}</span>
            </div>
            <label style={{ display: "grid", gap: 6, fontSize: 13 }}>
              <span style={{ color: "var(--muted)" }}>Soubor (CSV nebo TXT)</span>
              <input type="file" accept=".csv,.txt,text/csv,text/plain" aria-label="Soubor CSV se zakázkami" disabled={bezi} onChange={(e) => { const f = e.target.files?.[0]; if (f) void nactiSoubor(f); }} style={{ ...input, padding: "8px 10px", cursor: "pointer" }} />
            </label>
          </div>
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
                      <th key={i} style={{ textAlign: "left", padding: "6px 6px", borderBottom: "1px solid var(--border)", verticalAlign: "top", minWidth: 150 }}>
                        <div style={{ fontWeight: 700, marginBottom: 4, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", maxWidth: 200 }}>{h || `Sloupec ${i + 1}`}</div>
                        <select aria-label={`Význam sloupce ${h || i + 1}`} value={mapovani[i] ?? ""} onChange={(e) => zmenMapovani(i, (e.target.value || null) as PoleZakazky | null)} disabled={bezi} style={input}>
                          <option value="">– nepoužít –</option>
                          {POLE_ZAKAZKY.map((p) => <option key={p} value={p}>{POPIS_POLE_ZAKAZKY[p]}</option>)}
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
            {!maKod && <div role="alert" style={{ color: "#dc2626", fontSize: 13 }}>Určete, který sloupec je číslo zakázky – podle něj se poznají duplicity.</div>}

            {priprava && priprava.stavyVeVstupu.length > 0 && (
              <div style={{ display: "grid", gap: 6 }}>
                <div style={{ fontSize: 13, fontWeight: 700 }}>Stavy ze souboru → stavy servisu</div>
                <div style={{ fontSize: 12, color: "var(--muted)" }}>Přiřazeno podle názvu; nepoznané stavy jdou do výchozího „{statuses.find((s) => s.key === fallbackKey)?.label ?? fallbackKey}“, vydané zakázky do koncového stavu.</div>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))", gap: 6 }}>
                  {priprava.stavyVeVstupu.map((s) => (
                    <label key={s} style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6, alignItems: "center", fontSize: 12 }}>
                      <span style={{ whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }} title={s}>{s}</span>
                      <select aria-label={`Stav ${s}`} value={mapovaniStavu[s] ?? ""} onChange={(e) => setMapovaniStavu((prev) => ({ ...prev, [s]: e.target.value }))} disabled={bezi} style={input}>
                        <option value="">– podle data vydání –</option>
                        {statuses.map((st) => <option key={st.key} value={st.key}>{st.label}{st.isFinal ? " (koncový)" : ""}</option>)}
                      </select>
                    </label>
                  ))}
                </div>
              </div>
            )}

            {priprava && priprava.chyby.length > 0 && (
              <div role="alert" style={{ fontSize: 12, color: "#dc2626", display: "grid", gap: 2 }}>
                <div style={{ fontWeight: 700 }}>Řádky s chybou se neimportují ({priprava.chyby.length}):</div>
                {priprava.chyby.slice(0, 10).map((c) => <div key={c.radek}>řádek {c.radek}: {c.zprava}</div>)}
                {priprava.chyby.length > 10 && <div>… a dalších {priprava.chyby.length - 10}</div>}
              </div>
            )}

            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
              <div style={{ fontSize: 13 }}>
                {!priprava ? "Načítám stávající zakázky…" : (
                  <>
                    <b>{priprava.novych}</b> nových
                    {priprava.duplicit > 0 ? <> · <b>{priprava.duplicit}</b> už máte (přeskočí se)</> : null}
                    {priprava.chyb > 0 ? <> · <b>{priprava.chyb}</b> s chybou</> : null}
                    {priprava.prazdnych > 0 ? <> · {priprava.prazdnych} prázdných řádků</> : null}
                  </>
                )}
              </div>
              <Button variant="primary" onClick={() => void importovat()} disabled={bezi || !maKod || !priprava || priprava.novych === 0}>
                {bezi ? `Importuji… ${postup} %` : `Importovat ${priprava?.novych ?? 0} zakázek`}
              </Button>
            </div>
          </>
        )}

        {vysledek && (
          <div style={{ display: "grid", gap: 8, fontSize: 14 }}>
            <div style={{ fontWeight: 800 }}>Hotovo</div>
            <div>
              Založeno <b>{vysledek.novych}</b> zakázek
              {vysledek.preskoceno > 0 ? `, ${vysledek.preskoceno} přeskočeno (číslo zakázky už v servisu bylo)` : ""}
              {vysledek.chybnychRadku > 0 ? `, ${vysledek.chybnychRadku} řádků s chybou vynecháno` : ""}
              {vysledek.chyb > 0 ? `, ${vysledek.chyb} se nepodařilo uložit` : ""}.
            </div>
            {vysledek.chyby.length > 0 && (
              <div style={{ fontSize: 12, color: "#dc2626", display: "grid", gap: 2 }}>
                {vysledek.chyby.slice(0, 10).map((c) => <div key={c.kod}>{c.kod}: {c.zprava}</div>)}
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
