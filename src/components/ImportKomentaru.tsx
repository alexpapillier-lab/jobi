import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { Button } from "./ui";
import { supabase } from "../lib/supabaseClient";
import { fetchAllPages } from "../lib/fetchAllPages";
import { parseCsv, type CsvTabulka } from "../lib/csv";
import { POLE_KOMENTARE, POPIS_POLE_KOMENTARE, klicKomentare, odhadniMapovaniKomentaru, pripravKomentare, zapisKomentare, type CileKomentaru, type PoleKomentare, type VysledekKomentaru } from "../lib/importKomentaru";

/**
 * Import komentářů z CSV (komentare.csv z nástroje migrace ze Zakázkového
 * listu) do interních komentářů zakázek. Stejný postup jako import ceníku:
 * soubor → odhad sloupců (jde přemapovat) → náhled a shrnutí → zápis.
 * Komentáře reklamací jdou na zakázku, ze které reklamace vznikla. Co už
 * v zakázce je (stejné datum a text), se přeskočí.
 */
export function ImportKomentaru({
  open,
  onClose,
  activeServiceId,
  onHotovo,
}: {
  open: boolean;
  onClose: () => void;
  activeServiceId: string | null;
  onHotovo: (vysledek: VysledekKomentaru) => void;
}) {
  const [tabulka, setTabulka] = useState<CsvTabulka | null>(null);
  const [nazevSouboru, setNazevSouboru] = useState("");
  const [mapovani, setMapovani] = useState<Array<PoleKomentare | null>>([]);
  const [cile, setCile] = useState<CileKomentaru | null>(null);
  const [bezi, setBezi] = useState(false);
  const [postup, setPostup] = useState(0);
  const [vysledek, setVysledek] = useState<VysledekKomentaru | null>(null);
  const [chyba, setChyba] = useState<string | null>(null);

  useEffect(() => {
    if (!open) {
      setTabulka(null);
      setNazevSouboru("");
      setMapovani([]);
      setCile(null);
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

  // Zakázky a reklamace servisu podle kódu + stávající komentáře kvůli duplicitám.
  useEffect(() => {
    if (!open || !activeServiceId || !supabase) return;
    let zruseno = false;
    const sid = activeServiceId;
    void (async () => {
      const [zakazky, reklamace, komentare] = await Promise.all([
        fetchAllPages<{ id: string; code: string | null }>((from, to) => (supabase!.from("tickets") as any).select("id, code").eq("service_id", sid).range(from, to)),
        fetchAllPages<{ id: string; code: string; source_ticket_id: string | null }>((from, to) => (supabase!.from("warranty_claims") as any).select("id, code, source_ticket_id").eq("service_id", sid).range(from, to)),
        fetchAllPages<{ ticket_id: string; content: string; created_at: string }>((from, to) => (supabase!.from("ticket_comments") as any).select("ticket_id, content, created_at").eq("service_id", sid).range(from, to)),
      ]);
      if (zruseno) return;
      if (zakazky.error || reklamace.error || komentare.error) {
        setChyba("Nepodařilo se načíst zakázky a reklamace servisu – zkuste to znovu.");
        return;
      }
      const c: CileKomentaru = { zakazky: new Map(), reklamace: new Map(), existujici: new Set() };
      for (const t of zakazky.data) if (t.code) c.zakazky.set(t.code, t.id);
      for (const r of reklamace.data) c.reklamace.set(r.code, { id: r.id, sourceTicketId: r.source_ticket_id });
      for (const k of komentare.data) c.existujici.add(klicKomentare(k.ticket_id, k.created_at, k.content));
      setCile(c);
    })();
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
    setMapovani(odhadniMapovaniKomentaru(t.hlavicka));
  };

  const zmenMapovani = (i: number, pole: PoleKomentare | null) => {
    // Jedno pole smí mít jen jeden sloupec – jinak by se hodnoty tiše přebíjely.
    setMapovani((prev) => prev.map((x, j) => (j === i ? pole : x === pole ? null : x)));
  };

  const plan = useMemo(() => {
    if (!tabulka || !cile) return null;
    return pripravKomentare(tabulka, mapovani, cile);
  }, [tabulka, mapovani, cile]);

  const maPovinne = mapovani.includes("code") && mapovani.includes("text") && mapovani.includes("date");

  const importovat = async () => {
    if (!plan || !activeServiceId || !supabase) return;
    setBezi(true);
    setChyba(null);
    const klient = { from: (tabulka: string) => supabase!.from(tabulka) as any };
    const v = await zapisKomentare(klient, activeServiceId, plan.radky, setPostup);
    setVysledek(v);
    setBezi(false);
    onHotovo(v);
  };

  if (!open) return null;

  const input: React.CSSProperties = { padding: "6px 8px", borderRadius: 8, border: "1px solid var(--border)", background: "var(--panel)", color: "var(--text)", fontSize: 12, fontFamily: "inherit", width: "100%", boxSizing: "border-box" };
  const bunka: React.CSSProperties = { padding: "4px 6px", borderBottom: "1px solid var(--border)", color: "var(--muted)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", maxWidth: 260 };

  return createPortal(
    <div role="dialog" aria-modal="true" aria-labelledby="import-komentaru-nadpis" data-escape-vlastni onMouseDown={(e) => e.stopPropagation()} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 10_000, padding: 16 }}>
      <div style={{ background: "var(--panel)", color: "var(--text)", borderRadius: 14, border: "1px solid var(--border)", padding: 20, width: "min(100%, 860px)", maxHeight: "90vh", overflow: "auto", display: "grid", gap: 14, boxShadow: "0 20px 60px rgba(0,0,0,0.35)" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12 }}>
          <div>
            <h2 id="import-komentaru-nadpis" style={{ margin: 0, fontSize: 17, fontWeight: 800 }}>Import komentářů z CSV</h2>
            <div style={{ color: "var(--muted)", fontSize: 13, marginTop: 4 }}>
              Jeden řádek = jeden komentář (číslo zakázky nebo reklamace, druh, autor, datum, text). Komentář k reklamaci se připojí k zakázce, ze které reklamace vznikla, s předponou „[Reklamace …]“. Komentář, který zakázka už má (stejné datum a text), se přeskočí. Autor zůstane jen jako jméno – lidé z původního systému nejsou uživatelé Jobi.
            </div>
          </div>
          <Button size="sm" variant="ghost" onClick={onClose} disabled={bezi}>Zavřít</Button>
        </div>

        {!vysledek && (
          <label style={{ display: "grid", gap: 6, fontSize: 13 }}>
            <span style={{ color: "var(--muted)" }}>Soubor (CSV nebo TXT)</span>
            <input type="file" accept=".csv,.txt,text/csv,text/plain" aria-label="Soubor CSV s komentáři" disabled={bezi} onChange={(e) => { const f = e.target.files?.[0]; if (f) void nactiSoubor(f); }} style={{ ...input, padding: "8px 10px", cursor: "pointer" }} />
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
                        <select aria-label={`Význam sloupce ${h || i + 1}`} value={mapovani[i] ?? ""} onChange={(e) => zmenMapovani(i, (e.target.value || null) as PoleKomentare | null)} disabled={bezi} style={input}>
                          <option value="">– nepoužít –</option>
                          {POLE_KOMENTARE.map((p) => <option key={p} value={p}>{POPIS_POLE_KOMENTARE[p]}</option>)}
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
            {!maPovinne && <div role="alert" style={{ color: "#dc2626", fontSize: 13 }}>Určete, který sloupec je číslo zakázky / reklamace, datum a text komentáře.</div>}

            {plan && plan.chyby.length > 0 && (
              <div role="alert" style={{ fontSize: 12, color: "#dc2626", display: "grid", gap: 2 }}>
                <div style={{ fontWeight: 700 }}>Řádky s chybou se neimportují ({plan.chyby.length}):</div>
                {plan.chyby.slice(0, 10).map((c) => <div key={c.radek}>řádek {c.radek}: {c.zprava}</div>)}
                {plan.chyby.length > 10 && <div>… a dalších {plan.chyby.length - 10}</div>}
              </div>
            )}

            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
              <div style={{ fontSize: 13 }}>
                {!plan ? "Načítám zakázky a reklamace servisu…" : (
                  <>
                    Nově: <b>{plan.radky.length}</b> komentářů · {plan.zakazek} k zakázkám · {plan.reklamaci} k reklamacím
                    {plan.preskoceno > 0 ? <> · {plan.preskoceno} už v zakázkách je (přeskočí se)</> : null}
                  </>
                )}
              </div>
              <Button variant="primary" onClick={() => void importovat()} disabled={bezi || !maPovinne || !plan || plan.radky.length === 0}>
                {bezi ? `Importuji… ${postup} %` : `Importovat ${plan?.radky.length ?? 0} komentářů`}
              </Button>
            </div>
          </>
        )}

        {vysledek && (
          <div style={{ display: "grid", gap: 8, fontSize: 14 }}>
            <div style={{ fontWeight: 800 }}>Hotovo</div>
            <div>
              Zapsáno <b>{vysledek.zapsano}</b> komentářů{vysledek.chyb > 0 ? <>, <b>{vysledek.chyb}</b> se nepodařilo uložit</> : null}.
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
