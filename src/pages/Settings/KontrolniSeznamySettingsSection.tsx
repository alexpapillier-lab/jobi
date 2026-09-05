import { useCallback, useEffect, useState } from "react";
import { Card, Button } from "../../components/ui";
import { loadServiceConfig, mergeServiceConfig, subscribeServiceConfig } from "../../lib/serviceSettingsSync";
import { VYCHOZI_SABLONY, normalizujSablony, type SablonaKontroly } from "../../lib/kontrolniSeznamy";
import { showToast } from "../../components/Toast";

/**
 * Nastavení → Zakázky → Kontrola po opravě: šablony kontrolních seznamů.
 *
 * Každá šablona má název, klíčová slova (podle nich se vybere ke zařízení)
 * a položky po řádcích. Ukládá se do service_settings.config.kontrolniSeznamy
 * – sdílené pro celý servis, v reálném čase.
 */
export function KontrolniSeznamySettingsSection({ activeServiceId }: { activeServiceId: string | null }) {
  const [sablony, setSablony] = useState<SablonaKontroly[]>(VYCHOZI_SABLONY);
  const [rozbalena, setRozbalena] = useState<string | null>(null);

  useEffect(() => {
    if (!activeServiceId) return;
    let zruseno = false;
    loadServiceConfig(activeServiceId).then((config) => {
      if (!zruseno) setSablony(normalizujSablony(config?.kontrolniSeznamy));
    });
    const unsubscribe = subscribeServiceConfig(activeServiceId, (config) => {
      setSablony(normalizujSablony(config.kontrolniSeznamy));
    });
    return () => { zruseno = true; unsubscribe(); };
  }, [activeServiceId]);

  const ulozit = useCallback(async (next: SablonaKontroly[]) => {
    setSablony(next);
    if (!activeServiceId) return;
    try {
      await mergeServiceConfig(activeServiceId, { kontrolniSeznamy: next });
    } catch (err) {
      console.error("[KontrolniSeznamy] uložení selhalo", err);
      showToast("Šablony se nepodařilo uložit", "error");
    }
  }, [activeServiceId]);

  const uprav = (id: string, zmena: Partial<SablonaKontroly>) => {
    void ulozit(sablony.map((s) => (s.id === id ? { ...s, ...zmena } : s)));
  };

  const pridat = () => {
    const id = `s_${Date.now().toString(36)}`;
    void ulozit([...sablony, { id, nazev: "Nová šablona", klicovaSlova: [], polozky: ["Základní funkce zařízení"] }]);
    setRozbalena(id);
  };

  const input: React.CSSProperties = { padding: "8px 10px", borderRadius: 8, border: "1px solid var(--border)", background: "var(--panel)", color: "var(--text)", fontSize: 13, fontFamily: "inherit", width: "100%", boxSizing: "border-box" };

  return (
    <Card>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12, marginBottom: 12 }}>
        <div>
          <div style={{ fontWeight: 800, fontSize: 15 }}>Kontrola po opravě</div>
          <div style={{ color: "var(--muted)", fontSize: 13, marginTop: 4 }}>
            Co technik ověří před předáním. Šablona se v zakázce vybere podle názvu zařízení (klíčová slova); šablona bez klíčových slov je obecná záloha. Výsledek jde do protokolu.
          </div>
        </div>
        <Button size="sm" variant="soft" onClick={pridat}>+ Šablona</Button>
      </div>
      <div style={{ display: "grid", gap: 10 }}>
        {sablony.map((s) => {
          const otevrena = rozbalena === s.id;
          return (
            <div key={s.id} style={{ border: "1px solid var(--border)", borderRadius: 12, padding: 12, display: "grid", gap: 8 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                <button
                  type="button"
                  onClick={() => setRozbalena(otevrena ? null : s.id)}
                  aria-expanded={otevrena}
                  style={{ background: "transparent", border: "none", color: "var(--text)", fontWeight: 700, fontSize: 14, cursor: "pointer", padding: 0, textAlign: "left" }}
                >
                  {otevrena ? "▾" : "▸"} {s.nazev} <span style={{ color: "var(--muted)", fontWeight: 500 }}>· {s.polozky.length} položek{s.klicovaSlova.length === 0 ? " · obecná" : ""}</span>
                </button>
                <Button size="sm" variant="ghost" onClick={() => void ulozit(sablony.filter((x) => x.id !== s.id))} disabled={sablony.length <= 1}>
                  Smazat
                </Button>
              </div>
              {otevrena && (
                <div style={{ display: "grid", gap: 8 }}>
                  <label style={{ display: "grid", gap: 4, fontSize: 12, color: "var(--muted)" }}>
                    Název
                    <input type="text" value={s.nazev} onChange={(e) => uprav(s.id, { nazev: e.target.value })} style={input} />
                  </label>
                  <label style={{ display: "grid", gap: 4, fontSize: 12, color: "var(--muted)" }}>
                    Klíčová slova v názvu zařízení (oddělená čárkou)
                    <input
                      type="text"
                      defaultValue={s.klicovaSlova.join(", ")}
                      onBlur={(e) => uprav(s.id, { klicovaSlova: e.target.value.split(",").map((k) => k.trim().toLowerCase()).filter(Boolean) })}
                      placeholder="např. iphone, samsung, telefon"
                      style={input}
                    />
                  </label>
                  <label style={{ display: "grid", gap: 4, fontSize: 12, color: "var(--muted)" }}>
                    Položky (každá na vlastní řádek)
                    <textarea
                      defaultValue={s.polozky.join("\n")}
                      onBlur={(e) => {
                        const polozky = e.target.value.split("\n").map((p) => p.trim()).filter(Boolean);
                        if (polozky.length > 0) uprav(s.id, { polozky });
                      }}
                      rows={Math.min(12, Math.max(4, s.polozky.length + 1))}
                      style={{ ...input, resize: "vertical" }}
                    />
                  </label>
                </div>
              )}
            </div>
          );
        })}
        <div>
          <Button size="sm" variant="ghost" onClick={() => void ulozit(VYCHOZI_SABLONY)}>Obnovit výchozí šablony</Button>
        </div>
      </div>
    </Card>
  );
}
