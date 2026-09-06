import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { Button } from "../../components/ui";
import { supabase } from "../../lib/supabaseClient";
import { normalizePhone } from "../../lib/phone";
import { POPIS_POLE, odhadniMapovani, parseCsv, type CsvTabulka, type PoleZakaznika } from "../../lib/csv";

/**
 * Import zákazníků z CSV – přechod z jiného systému (MyRepair, Zakázkový
 * list, tabulka v Excelu). Sloupce se přiřadí podle názvů v hlavičce a jdou
 * ručně opravit; zákazník, jehož telefon už v servisu je, se přeskočí,
 * aby import nevytvořil duplicity. Řádky bez jména i telefonu se vynechají.
 */
type Vysledek = { novych: number; preskoceno: number; bezTelefonu: number; chyb: number };

const POLE: PoleZakaznika[] = ["name", "phone", "email", "company", "ico", "dic", "address_street", "address_city", "address_zip", "note"];

export function ImportZakazniku({
  open,
  onClose,
  activeServiceId,
  existujiciTelefony,
  onHotovo,
}: {
  open: boolean;
  onClose: () => void;
  activeServiceId: string | null;
  /** Normalizované telefony zákazníků, které servis už má. */
  existujiciTelefony: Set<string>;
  onHotovo: (vysledek: Vysledek) => void;
}) {
  const [tabulka, setTabulka] = useState<CsvTabulka | null>(null);
  const [nazevSouboru, setNazevSouboru] = useState("");
  const [mapovani, setMapovani] = useState<Array<PoleZakaznika | null>>([]);
  const [bezi, setBezi] = useState(false);
  const [postup, setPostup] = useState(0);
  const [vysledek, setVysledek] = useState<Vysledek | null>(null);
  const [chyba, setChyba] = useState<string | null>(null);

  useEffect(() => {
    if (!open) {
      setTabulka(null);
      setNazevSouboru("");
      setMapovani([]);
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
    setMapovani(odhadniMapovani(t.hlavicka));
  };

  /** Řádky přeložené na zákazníky, s rozhodnutím, co se s nimi stane. */
  const priprava = useMemo(() => {
    if (!tabulka) return null;
    const idx = (pole: PoleZakaznika) => mapovani.indexOf(pole);
    const videneTelefony = new Set<string>();
    const zaznamy: Array<{ data: Record<string, string | null>; stav: "novy" | "existuje" | "bezTelefonu" | "prazdny" }> = [];
    for (const r of tabulka.radky) {
      const hodnota = (pole: PoleZakaznika) => {
        const i = idx(pole);
        return i >= 0 ? (r[i] ?? "").trim() : "";
      };
      const name = hodnota("name") || hodnota("company");
      const phone = hodnota("phone");
      if (!name && !phone) {
        zaznamy.push({ data: {}, stav: "prazdny" });
        continue;
      }
      const phoneNorm = normalizePhone(phone);
      const data: Record<string, string | null> = {
        name: name || phone,
        phone: phone || null,
        phone_norm: phoneNorm,
        email: hodnota("email") || null,
        company: hodnota("company") || null,
        ico: hodnota("ico") || null,
        dic: hodnota("dic") || null,
        address_street: hodnota("address_street") || null,
        address_city: hodnota("address_city") || null,
        address_zip: hodnota("address_zip") || null,
        note: hodnota("note") || null,
      };
      if (!phoneNorm) {
        zaznamy.push({ data, stav: "bezTelefonu" });
      } else if (existujiciTelefony.has(phoneNorm) || videneTelefony.has(phoneNorm)) {
        zaznamy.push({ data, stav: "existuje" });
      } else {
        videneTelefony.add(phoneNorm);
        zaznamy.push({ data, stav: "novy" });
      }
    }
    return {
      zaznamy,
      novych: zaznamy.filter((z) => z.stav === "novy").length,
      existuje: zaznamy.filter((z) => z.stav === "existuje").length,
      bezTelefonu: zaznamy.filter((z) => z.stav === "bezTelefonu").length,
      prazdnych: zaznamy.filter((z) => z.stav === "prazdny").length,
    };
  }, [tabulka, mapovani, existujiciTelefony]);

  const maJmeno = mapovani.includes("name") || mapovani.includes("company");

  const importovat = async () => {
    if (!priprava || !activeServiceId || !supabase) return;
    setBezi(true);
    setChyba(null);
    const kImportu = priprava.zaznamy.filter((z) => z.stav === "novy" || z.stav === "bezTelefonu").map((z) => ({ ...z.data, service_id: activeServiceId }));
    let novych = 0;
    let chyb = 0;
    let preskoceno = priprava.existuje;
    const DAVKA = 100;
    for (let i = 0; i < kImportu.length; i += DAVKA) {
      const davka = kImportu.slice(i, i + DAVKA);
      const { error } = await (supabase.from("customers") as any).insert(davka);
      if (!error) {
        novych += davka.length;
      } else {
        // Dávka spadla (nejspíš telefon, který mezitím někdo založil) – po jednom, ať projde zbytek.
        for (const radek of davka) {
          const { error: e1 } = await (supabase.from("customers") as any).insert(radek);
          if (!e1) novych += 1;
          else if ((e1 as { code?: string }).code === "23505") preskoceno += 1;
          else chyb += 1;
        }
      }
      setPostup(Math.min(100, Math.round(((i + davka.length) / Math.max(1, kImportu.length)) * 100)));
    }
    const v: Vysledek = { novych, preskoceno, bezTelefonu: priprava.bezTelefonu, chyb };
    setVysledek(v);
    setBezi(false);
    onHotovo(v);
  };

  if (!open) return null;

  const input: React.CSSProperties = { padding: "6px 8px", borderRadius: 8, border: "1px solid var(--border)", background: "var(--panel)", color: "var(--text)", fontSize: 12, fontFamily: "inherit", width: "100%", boxSizing: "border-box" };

  return createPortal(
    <div role="dialog" aria-modal="true" aria-labelledby="import-zakazniku-nadpis" data-escape-vlastni onMouseDown={(e) => e.stopPropagation()} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 10_000, padding: 16 }}>
      <div style={{ background: "var(--panel)", color: "var(--text)", borderRadius: 14, border: "1px solid var(--border)", padding: 20, width: "min(100%, 860px)", maxHeight: "90vh", overflow: "auto", display: "grid", gap: 14, boxShadow: "0 20px 60px rgba(0,0,0,0.35)" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12 }}>
          <div>
            <h2 id="import-zakazniku-nadpis" style={{ margin: 0, fontSize: 17, fontWeight: 800 }}>Import zákazníků z CSV</h2>
            <div style={{ color: "var(--muted)", fontSize: 13, marginTop: 4 }}>
              Export z jiného systému nebo tabulka z Excelu uložená jako CSV. První řádek jsou názvy sloupců. Zákazník, jehož telefon už máte, se přeskočí.
            </div>
          </div>
          <Button size="sm" variant="ghost" onClick={onClose} disabled={bezi}>Zavřít</Button>
        </div>

        {!vysledek && (
          <label style={{ display: "grid", gap: 6, fontSize: 13 }}>
            <span style={{ color: "var(--muted)" }}>Soubor (CSV nebo TXT)</span>
            <input type="file" accept=".csv,.txt,text/csv,text/plain" aria-label="Soubor CSV" disabled={bezi} onChange={(e) => { const f = e.target.files?.[0]; if (f) void nactiSoubor(f); }} style={{ ...input, padding: "8px 10px", cursor: "pointer" }} />
          </label>
        )}
        {chyba && <div role="alert" style={{ color: "#dc2626", fontSize: 13 }}>{chyba}</div>}

        {tabulka && priprava && !vysledek && (
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
                        <select aria-label={`Význam sloupce ${h || i + 1}`} value={mapovani[i] ?? ""} onChange={(e) => setMapovani((prev) => prev.map((m, j) => (j === i ? ((e.target.value || null) as PoleZakaznika | null) : m)))} style={input}>
                          <option value="">– nepoužít –</option>
                          {POLE.map((p) => <option key={p} value={p}>{POPIS_POLE[p]}</option>)}
                        </select>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {tabulka.radky.slice(0, 5).map((r, ri) => (
                    <tr key={ri}>
                      {tabulka.hlavicka.map((_, ci) => (
                        <td key={ci} style={{ padding: "4px 6px", borderBottom: "1px solid var(--border)", color: "var(--muted)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", maxWidth: 200 }}>{r[ci] ?? ""}</td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {!maJmeno && <div role="alert" style={{ color: "#dc2626", fontSize: 13 }}>Určete, který sloupec je jméno (nebo firma).</div>}
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
              <div style={{ fontSize: 13 }}>
                <b>{priprava.novych}</b> nových
                {priprava.existuje > 0 ? <> · <b>{priprava.existuje}</b> už máte (přeskočí se)</> : null}
                {priprava.bezTelefonu > 0 ? <> · <b>{priprava.bezTelefonu}</b> bez telefonu (založí se, duplicity se u nich nepoznají)</> : null}
                {priprava.prazdnych > 0 ? <> · {priprava.prazdnych} prázdných řádků</> : null}
              </div>
              <Button variant="primary" onClick={() => void importovat()} disabled={bezi || !maJmeno || priprava.novych + priprava.bezTelefonu === 0}>
                {bezi ? `Importuji… ${postup} %` : `Importovat ${priprava.novych + priprava.bezTelefonu} zákazníků`}
              </Button>
            </div>
          </>
        )}

        {vysledek && (
          <div style={{ display: "grid", gap: 8, fontSize: 14 }}>
            <div style={{ fontWeight: 800 }}>Hotovo</div>
            <div>Založeno <b>{vysledek.novych}</b> zákazníků{vysledek.preskoceno > 0 ? `, ${vysledek.preskoceno} přeskočeno (telefon už v servisu byl)` : ""}{vysledek.bezTelefonu > 0 ? `, z toho ${vysledek.bezTelefonu} bez telefonu` : ""}{vysledek.chyb > 0 ? `, ${vysledek.chyb} se nepodařilo uložit` : ""}.</div>
            <div><Button variant="primary" onClick={onClose}>Zavřít</Button></div>
          </div>
        )}
      </div>
    </div>,
    document.body,
  );
}
