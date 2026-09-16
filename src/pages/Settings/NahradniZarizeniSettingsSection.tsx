import { useCallback, useEffect, useState } from "react";
import { Card, Button } from "../../components/ui";
import { nactiServiceConfig, mergeServiceConfig, subscribeServiceConfig } from "../../lib/serviceSettingsSync";
import { useConfigNacteno } from "./useConfigNacteno";
import { normalizujNahradni, type NahradniZarizeni } from "../../lib/zapujcka";
import { showToast } from "../../components/Toast";
import { useBranches } from "../../context/BranchContext";

/**
 * Nastavení → Zakázky → Náhradní zařízení: stálý seznam toho, co servis
 * půjčuje. V zakázce se pak zařízení jen vybere a vidí se, které je právě
 * u zákazníka. Ukládá se do service_settings.config.nahradniZarizeni.
 *
 * Servis s více pobočkami má u každého zařízení pobočku, kde fyzicky je:
 * v zakázce se pak napřed nabídnou zařízení z její pobočky. Bez pobočky
 * je zařízení společné.
 */
export function NahradniZarizeniSettingsSection({ activeServiceId }: { activeServiceId: string | null }) {
  const [seznam, setSeznam] = useState<NahradniZarizeni[]>([]);
  const [novy, setNovy] = useState<NahradniZarizeni>({ id: "", nazev: "" });
  const { isMulti: pobocky, branches } = useBranches();
  const { nacteno, oznacNacteno } = useConfigNacteno(activeServiceId);
  const [chybaNacteni, setChybaNacteni] = useState(false);

  useEffect(() => {
    if (!activeServiceId) return;
    let zruseno = false;
    nactiServiceConfig(activeServiceId).then((r) => {
      if (zruseno) return;
      if (r.stav === "chyba") {
        // Bez jistoty, co je v databázi, se nesmí ukládat – uložil by se
        // prázdný výchozí seznam přes ten skutečný.
        setChybaNacteni(true);
        return;
      }
      setChybaNacteni(false);
      setSeznam(normalizujNahradni(r.stav === "ok" ? (r.config as any)?.nahradniZarizeni : undefined));
      oznacNacteno();
    });
    const unsubscribe = subscribeServiceConfig(activeServiceId, (config) => setSeznam(normalizujNahradni(config.nahradniZarizeni)));
    return () => { zruseno = true; unsubscribe(); };
  }, [activeServiceId, oznacNacteno]);

  const ulozit = useCallback(async (next: NahradniZarizeni[]) => {
    // Dokud nevíme, co je na serveru, nesmí se ukládat – přepsalo by to seznam.
    if (!nacteno) return;
    setSeznam(next);
    if (!activeServiceId) return;
    try {
      // mergeServiceConfig chybu nevyhazuje, vrací ji – `catch` sám by ji minul.
      const r = await mergeServiceConfig(activeServiceId, { nahradniZarizeni: next });
      if (r.error) throw new Error(r.error);
    } catch (e) {
      console.error("[NahradniZarizeni] uložení selhalo", e);
      showToast("Seznam se nepodařilo uložit", "error");
    }
  }, [activeServiceId, nacteno]);

  const pridat = () => {
    if (!novy.nazev.trim()) return;
    void ulozit([...seznam, { ...novy, id: `n_${Date.now().toString(36)}`, nazev: novy.nazev.trim(), seriove: novy.seriove?.trim() || undefined, prislusenstvi: novy.prislusenstvi?.trim() || undefined, kauce: novy.kauce && novy.kauce > 0 ? novy.kauce : undefined, branchId: novy.branchId || undefined }]);
    setNovy({ id: "", nazev: "", branchId: novy.branchId });
  };

  const input: React.CSSProperties = { padding: "8px 10px", borderRadius: 8, border: "1px solid var(--border)", background: "var(--panel)", color: "var(--text)", fontSize: 13, fontFamily: "inherit", width: "100%", boxSizing: "border-box" };
  const mrizka: React.CSSProperties = { display: "grid", gridTemplateColumns: pobocky ? "2fr 1.4fr 1.4fr 0.8fr 1.2fr auto" : "2fr 1.4fr 1.4fr 0.8fr auto", gap: 8, alignItems: "center" };
  const vyberPobocky = (hodnota: string | undefined, ariaLabel: string, onChange: (id: string | undefined) => void) => (
    <select value={hodnota ?? ""} aria-label={ariaLabel} onChange={(e) => onChange(e.target.value || undefined)} style={input}>
      <option value="">Společné</option>
      {branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
    </select>
  );

  return (
    /* data-config-nacteno: než je seznam ze serveru, nesmí se ukládat.
       Testy podle toho poznají, že sekce má skutečná data, ne výchozí prázdno. */
    <Card data-config-nacteno={nacteno ? "1" : "0"}>
      <div style={{ marginBottom: 12 }}>
        <div style={{ fontWeight: 800, fontSize: 15 }}>Náhradní zařízení</div>
        <div style={{ color: "var(--muted)", fontSize: 13, marginTop: 4 }}>
          Co půjčujete zákazníkům na dobu opravy. V zakázce se zařízení vybere ze seznamu, formulář se vyplní a u půjčeného je vidět, ve které zakázce právě je.
          {pobocky ? " U zařízení vyberte pobočku, kde fyzicky je – v zakázce se napřed nabídnou zařízení z její pobočky. „Společné“ se nabízí všude." : ""}
        </div>
      </div>
      {chybaNacteni && (
        <div style={{ marginBottom: 12, padding: 10, borderRadius: 8, border: "1px solid var(--danger, #dc2626)", color: "var(--danger, #dc2626)", fontSize: 13 }}>
          Seznam se nepodařilo načíst. Dokud se nenačte, nejde ho měnit – jinak by se uložil prázdný.
        </div>
      )}
      <div style={{ display: "grid", gap: 8 }}>
        {seznam.length > 0 && (
          <div style={{ ...mrizka, fontSize: 12, color: "var(--muted)", padding: "0 4px" }}>
            <span>Zařízení</span><span>Sériové číslo / IMEI</span><span>Příslušenství</span><span>Kauce Kč</span>{pobocky && <span>Pobočka</span>}<span />
          </div>
        )}
        {seznam.map((z) => (
          <div key={z.id} style={mrizka}>
            <input type="text" defaultValue={z.nazev} aria-label="Zařízení" onBlur={(e) => { const v = e.target.value.trim(); if (v && v !== z.nazev) void ulozit(seznam.map((x) => (x.id === z.id ? { ...x, nazev: v } : x))); }} style={input} />
            <input type="text" defaultValue={z.seriove ?? ""} aria-label="Sériové číslo" onBlur={(e) => void ulozit(seznam.map((x) => (x.id === z.id ? { ...x, seriove: e.target.value.trim() || undefined } : x)))} style={input} />
            <input type="text" defaultValue={z.prislusenstvi ?? ""} aria-label="Příslušenství" onBlur={(e) => void ulozit(seznam.map((x) => (x.id === z.id ? { ...x, prislusenstvi: e.target.value.trim() || undefined } : x)))} style={input} />
            <input type="number" min={0} step={100} defaultValue={z.kauce ?? ""} aria-label="Kauce" onBlur={(e) => { const n = Number(e.target.value); void ulozit(seznam.map((x) => (x.id === z.id ? { ...x, kauce: n > 0 ? n : undefined } : x))); }} style={input} />
            {pobocky && vyberPobocky(z.branchId, `Pobočka – ${z.nazev}`, (id) => void ulozit(seznam.map((x) => (x.id === z.id ? { ...x, branchId: id } : x))))}
            <Button size="sm" variant="ghost" onClick={() => void ulozit(seznam.filter((x) => x.id !== z.id))}>Smazat</Button>
          </div>
        ))}
        <div style={{ ...mrizka, paddingTop: 8, borderTop: seznam.length > 0 ? "1px solid var(--border)" : "none" }}>
          <input type="text" value={novy.nazev} onChange={(e) => setNovy({ ...novy, nazev: e.target.value })} placeholder="např. iPhone SE 2020, černý" aria-label="Nové zařízení" style={input} onKeyDown={(e) => { if (e.key === "Enter") pridat(); }} />
          <input type="text" value={novy.seriove ?? ""} onChange={(e) => setNovy({ ...novy, seriove: e.target.value })} placeholder="SN / IMEI" aria-label="Nové sériové číslo" style={input} />
          <input type="text" value={novy.prislusenstvi ?? ""} onChange={(e) => setNovy({ ...novy, prislusenstvi: e.target.value })} placeholder="nabíječka, kryt" aria-label="Nové příslušenství" style={input} />
          <input type="number" min={0} step={100} value={novy.kauce ?? ""} onChange={(e) => setNovy({ ...novy, kauce: e.target.value === "" ? undefined : Number(e.target.value) })} placeholder="kauce" aria-label="Nová kauce" style={input} />
          {pobocky && vyberPobocky(novy.branchId, "Pobočka nového zařízení", (id) => setNovy({ ...novy, branchId: id }))}
          <Button size="sm" variant="soft" onClick={pridat} disabled={!novy.nazev.trim() || !nacteno}>Přidat</Button>
        </div>
      </div>
    </Card>
  );
}
