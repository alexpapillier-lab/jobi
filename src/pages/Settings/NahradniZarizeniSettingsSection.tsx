import { useCallback, useEffect, useState } from "react";
import { Card, Button } from "../../components/ui";
import { loadServiceConfig, mergeServiceConfig, subscribeServiceConfig } from "../../lib/serviceSettingsSync";
import { normalizujNahradni, type NahradniZarizeni } from "../../lib/zapujcka";
import { showToast } from "../../components/Toast";

/**
 * Nastavení → Zakázky → Náhradní zařízení: stálý seznam toho, co servis
 * půjčuje. V zakázce se pak zařízení jen vybere a vidí se, které je právě
 * u zákazníka. Ukládá se do service_settings.config.nahradniZarizeni.
 */
export function NahradniZarizeniSettingsSection({ activeServiceId }: { activeServiceId: string | null }) {
  const [seznam, setSeznam] = useState<NahradniZarizeni[]>([]);
  const [novy, setNovy] = useState<NahradniZarizeni>({ id: "", nazev: "" });

  useEffect(() => {
    if (!activeServiceId) return;
    let zruseno = false;
    loadServiceConfig(activeServiceId).then((config) => {
      if (!zruseno) setSeznam(normalizujNahradni(config?.nahradniZarizeni));
    });
    const unsubscribe = subscribeServiceConfig(activeServiceId, (config) => setSeznam(normalizujNahradni(config.nahradniZarizeni)));
    return () => { zruseno = true; unsubscribe(); };
  }, [activeServiceId]);

  const ulozit = useCallback(async (next: NahradniZarizeni[]) => {
    setSeznam(next);
    if (!activeServiceId) return;
    try {
      await mergeServiceConfig(activeServiceId, { nahradniZarizeni: next });
    } catch (e) {
      console.error("[NahradniZarizeni] uložení selhalo", e);
      showToast("Seznam se nepodařilo uložit", "error");
    }
  }, [activeServiceId]);

  const pridat = () => {
    if (!novy.nazev.trim()) return;
    void ulozit([...seznam, { ...novy, id: `n_${Date.now().toString(36)}`, nazev: novy.nazev.trim(), seriove: novy.seriove?.trim() || undefined, prislusenstvi: novy.prislusenstvi?.trim() || undefined, kauce: novy.kauce && novy.kauce > 0 ? novy.kauce : undefined }]);
    setNovy({ id: "", nazev: "" });
  };

  const input: React.CSSProperties = { padding: "8px 10px", borderRadius: 8, border: "1px solid var(--border)", background: "var(--panel)", color: "var(--text)", fontSize: 13, fontFamily: "inherit", width: "100%", boxSizing: "border-box" };
  const mrizka: React.CSSProperties = { display: "grid", gridTemplateColumns: "2fr 1.4fr 1.4fr 0.8fr auto", gap: 8, alignItems: "center" };

  return (
    <Card>
      <div style={{ marginBottom: 12 }}>
        <div style={{ fontWeight: 800, fontSize: 15 }}>Náhradní zařízení</div>
        <div style={{ color: "var(--muted)", fontSize: 13, marginTop: 4 }}>
          Co půjčujete zákazníkům na dobu opravy. V zakázce se zařízení vybere ze seznamu, formulář se vyplní a u půjčeného je vidět, ve které zakázce právě je.
        </div>
      </div>
      <div style={{ display: "grid", gap: 8 }}>
        {seznam.length > 0 && (
          <div style={{ ...mrizka, fontSize: 12, color: "var(--muted)", padding: "0 4px" }}>
            <span>Zařízení</span><span>Sériové číslo / IMEI</span><span>Příslušenství</span><span>Kauce Kč</span><span />
          </div>
        )}
        {seznam.map((z) => (
          <div key={z.id} style={mrizka}>
            <input type="text" defaultValue={z.nazev} aria-label="Zařízení" onBlur={(e) => { const v = e.target.value.trim(); if (v && v !== z.nazev) void ulozit(seznam.map((x) => (x.id === z.id ? { ...x, nazev: v } : x))); }} style={input} />
            <input type="text" defaultValue={z.seriove ?? ""} aria-label="Sériové číslo" onBlur={(e) => void ulozit(seznam.map((x) => (x.id === z.id ? { ...x, seriove: e.target.value.trim() || undefined } : x)))} style={input} />
            <input type="text" defaultValue={z.prislusenstvi ?? ""} aria-label="Příslušenství" onBlur={(e) => void ulozit(seznam.map((x) => (x.id === z.id ? { ...x, prislusenstvi: e.target.value.trim() || undefined } : x)))} style={input} />
            <input type="number" min={0} step={100} defaultValue={z.kauce ?? ""} aria-label="Kauce" onBlur={(e) => { const n = Number(e.target.value); void ulozit(seznam.map((x) => (x.id === z.id ? { ...x, kauce: n > 0 ? n : undefined } : x))); }} style={input} />
            <Button size="sm" variant="ghost" onClick={() => void ulozit(seznam.filter((x) => x.id !== z.id))}>Smazat</Button>
          </div>
        ))}
        <div style={{ ...mrizka, paddingTop: 8, borderTop: seznam.length > 0 ? "1px solid var(--border)" : "none" }}>
          <input type="text" value={novy.nazev} onChange={(e) => setNovy({ ...novy, nazev: e.target.value })} placeholder="např. iPhone SE 2020, černý" aria-label="Nové zařízení" style={input} onKeyDown={(e) => { if (e.key === "Enter") pridat(); }} />
          <input type="text" value={novy.seriove ?? ""} onChange={(e) => setNovy({ ...novy, seriove: e.target.value })} placeholder="SN / IMEI" aria-label="Nové sériové číslo" style={input} />
          <input type="text" value={novy.prislusenstvi ?? ""} onChange={(e) => setNovy({ ...novy, prislusenstvi: e.target.value })} placeholder="nabíječka, kryt" aria-label="Nové příslušenství" style={input} />
          <input type="number" min={0} step={100} value={novy.kauce ?? ""} onChange={(e) => setNovy({ ...novy, kauce: e.target.value === "" ? undefined : Number(e.target.value) })} placeholder="kauce" aria-label="Nová kauce" style={input} />
          <Button size="sm" variant="soft" onClick={pridat} disabled={!novy.nazev.trim()}>Přidat</Button>
        </div>
      </div>
    </Card>
  );
}
