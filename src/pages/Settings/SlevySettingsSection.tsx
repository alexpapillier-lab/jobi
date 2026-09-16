import { useCallback, useEffect, useState, type ReactNode } from "react";
import { Card, Button, useSavedHint } from "../../components/ui";
import { nactiServiceConfig, mergeServiceConfig, subscribeServiceConfig } from "../../lib/serviceSettingsSync";
import { useConfigNacteno } from "./useConfigNacteno";
import { MAX_PREDNASTAVENYCH_SLEV, hodnotaSlevy, normalizujSlevy, type PrednastavenaSleva } from "../../lib/prednastaveneSlevy";
import { showToast } from "../../components/Toast";

/** Stejná hlavička karty jako v Settings.tsx (tam je jen lokální). */
function CardHeader({ title, description, right }: { title: ReactNode; description?: ReactNode; right?: ReactNode }) {
  return (
    <div style={{ marginBottom: "var(--space-3)" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "var(--space-2)" }}>
        <div style={{ fontWeight: 900, fontSize: "var(--text-base)", color: "var(--text)" }}>{title}</div>
        {right}
      </div>
      {description ? <div style={{ fontSize: "var(--text-sm)", color: "var(--muted)", marginTop: 2, lineHeight: 1.5 }}>{description}</div> : null}
    </div>
  );
}

/**
 * Nastavení → Zakázky → Slevy: přednastavené slevy.
 *
 * V detailu zakázky se pak sleva nezadává ručně, ale klepne se na tlačítko
 * „10 %“ nebo „200 Kč“ u ceny oprav. Ukládá se do
 * service_settings.config.prednastavene_slevy – sdílené pro celý servis.
 */
export function SlevySettingsSection({ activeServiceId }: { activeServiceId: string | null }) {
  const [slevy, setSlevy] = useState<PrednastavenaSleva[]>([]);
  const [novaTyp, setNovaTyp] = useState<"percentage" | "amount">("percentage");
  const [novaHodnota, setNovaHodnota] = useState("");
  const [novaNazev, setNovaNazev] = useState("");
  const { nacteno, oznacNacteno } = useConfigNacteno(activeServiceId);
  const [chybaNacteni, setChybaNacteni] = useState(false);
  const hint = useSavedHint();

  useEffect(() => {
    if (!activeServiceId) return;
    let zruseno = false;
    nactiServiceConfig(activeServiceId).then((r) => {
      if (zruseno) return;
      if (r.stav === "chyba") {
        // Bez jistoty, co je v databázi, se nesmí ukládat – uložil by se
        // prázdný seznam přes ten skutečný.
        setChybaNacteni(true);
        return;
      }
      setChybaNacteni(false);
      setSlevy(normalizujSlevy(r.stav === "ok" ? r.config.prednastavene_slevy : undefined));
      oznacNacteno();
    });
    const unsubscribe = subscribeServiceConfig(activeServiceId, (config) => setSlevy(normalizujSlevy(config.prednastavene_slevy)));
    return () => { zruseno = true; unsubscribe(); };
  }, [activeServiceId, oznacNacteno]);

  const ulozit = useCallback(async (next: PrednastavenaSleva[]) => {
    if (!nacteno) return;
    setSlevy(next);
    if (!activeServiceId) return;
    try {
      const r = await mergeServiceConfig(activeServiceId, { prednastavene_slevy: next });
      if (r.error) throw new Error(r.error);
      hint.show();
    } catch (e) {
      console.error("[Slevy] uložení selhalo", e);
      showToast("Slevy se nepodařilo uložit", "error");
    }
  }, [activeServiceId, nacteno, hint]);

  const cisloNove = parseFloat(novaHodnota.replace(",", "."));
  const novaPlatna = Number.isFinite(cisloNove) && cisloNove > 0 && (novaTyp === "amount" || cisloNove <= 100);
  const plno = slevy.length >= MAX_PREDNASTAVENYCH_SLEV;

  const pridat = () => {
    if (!novaPlatna || plno) return;
    const nova: PrednastavenaSleva = {
      id: `s_${Date.now().toString(36)}`,
      typ: novaTyp,
      hodnota: Math.round(cisloNove * 100) / 100,
      nazev: novaNazev.trim() || undefined,
    };
    void ulozit([...slevy, nova]);
    setNovaHodnota("");
    setNovaNazev("");
  };

  const input: React.CSSProperties = { padding: "8px 10px", borderRadius: 8, border: "1px solid var(--border)", background: "var(--panel)", color: "var(--text)", fontSize: 13, fontFamily: "inherit", width: "100%", boxSizing: "border-box" };
  const mrizka: React.CSSProperties = { display: "grid", gridTemplateColumns: "minmax(90px, 0.7fr) minmax(90px, 0.8fr) 2fr auto", gap: 8, alignItems: "center" };

  return (
    <Card data-config-nacteno={nacteno ? "1" : "0"}>
      <CardHeader
        title="Přednastavené slevy"
        description="V detailu zakázky se u ceny oprav ukážou jako tlačítka – sleva se pak dá jedním klepnutím, bez vypisování. Ruční zadání zůstává."
        right={hint.node}
      />
      {chybaNacteni && (
        <div style={{ marginBottom: 12, padding: 10, borderRadius: 8, border: "1px solid var(--danger, #dc2626)", color: "var(--danger, #dc2626)", fontSize: 13 }}>
          Slevy se nepodařilo načíst. Dokud se nenačtou, nejde je měnit – jinak by se uložil prázdný seznam.
        </div>
      )}
      <div style={{ display: "grid", gap: 8 }}>
        {slevy.length > 0 && (
          <div style={{ ...mrizka, fontSize: 12, color: "var(--muted)", padding: "0 4px" }}>
            <span>Typ</span><span>Hodnota</span><span>Popisek (nepovinný)</span><span />
          </div>
        )}
        {slevy.map((s) => (
          <div key={s.id} style={mrizka} data-testid="prednastavena-sleva">
            <select
              value={s.typ}
              aria-label={`Typ slevy ${hodnotaSlevy(s)}`}
              onChange={(e) => {
                const typ = e.target.value as "percentage" | "amount";
                const hodnota = typ === "percentage" ? Math.min(100, s.hodnota) : s.hodnota;
                void ulozit(slevy.map((x) => (x.id === s.id ? { ...x, typ, hodnota } : x)));
              }}
              style={input}
            >
              <option value="percentage">Procenta</option>
              <option value="amount">Kč</option>
            </select>
            <input
              type="number"
              min={0}
              step={s.typ === "percentage" ? 1 : 10}
              defaultValue={s.hodnota}
              aria-label={`Hodnota slevy ${hodnotaSlevy(s)}`}
              onBlur={(e) => {
                const n = parseFloat(e.target.value.replace(",", "."));
                if (!Number.isFinite(n) || n <= 0 || (s.typ === "percentage" && n > 100)) { e.target.value = String(s.hodnota); return; }
                if (n !== s.hodnota) void ulozit(slevy.map((x) => (x.id === s.id ? { ...x, hodnota: Math.round(n * 100) / 100 } : x)));
              }}
              style={input}
            />
            <input
              type="text"
              defaultValue={s.nazev ?? ""}
              placeholder="např. Stálý zákazník"
              aria-label={`Popisek slevy ${hodnotaSlevy(s)}`}
              onBlur={(e) => {
                const v = e.target.value.trim() || undefined;
                if (v !== s.nazev) void ulozit(slevy.map((x) => (x.id === s.id ? { ...x, nazev: v } : x)));
              }}
              style={input}
            />
            <Button size="sm" variant="ghost" onClick={() => void ulozit(slevy.filter((x) => x.id !== s.id))}>Smazat</Button>
          </div>
        ))}
        {slevy.length === 0 && !chybaNacteni && (
          <div style={{ color: "var(--muted)", fontSize: 13 }}>Zatím žádná. Přidejte třeba 10 % pro stálé zákazníky nebo 200 Kč za dlouhé čekání.</div>
        )}
        <div style={{ ...mrizka, paddingTop: 8, borderTop: slevy.length > 0 ? "1px solid var(--border)" : "none" }}>
          <select value={novaTyp} onChange={(e) => setNovaTyp(e.target.value as "percentage" | "amount")} aria-label="Typ nové slevy" style={input}>
            <option value="percentage">Procenta</option>
            <option value="amount">Kč</option>
          </select>
          <input
            type="number"
            min={0}
            step={novaTyp === "percentage" ? 1 : 10}
            value={novaHodnota}
            onChange={(e) => setNovaHodnota(e.target.value)}
            placeholder={novaTyp === "percentage" ? "např. 10" : "např. 200"}
            aria-label="Hodnota nové slevy"
            style={input}
            onKeyDown={(e) => { if (e.key === "Enter") pridat(); }}
          />
          <input
            type="text"
            value={novaNazev}
            onChange={(e) => setNovaNazev(e.target.value)}
            placeholder="popisek, např. Stálý zákazník"
            aria-label="Popisek nové slevy"
            style={input}
            onKeyDown={(e) => { if (e.key === "Enter") pridat(); }}
          />
          <Button size="sm" variant="soft" onClick={pridat} disabled={!novaPlatna || !nacteno || plno} title={plno ? `Nejvýš ${MAX_PREDNASTAVENYCH_SLEV} slev` : undefined}>Přidat</Button>
        </div>
      </div>
    </Card>
  );
}
