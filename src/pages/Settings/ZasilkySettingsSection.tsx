import { useCallback, useEffect, useState, type ReactNode } from "react";
import { Card, SettingRow, SettingRows, useSavedHint } from "../../components/ui";
import { nactiServiceConfig, mergeServiceConfig, subscribeServiceConfig } from "../../lib/serviceSettingsSync";
import { useConfigNacteno } from "./useConfigNacteno";
import { useBranches } from "../../context/BranchContext";
import { showToast } from "../../components/Toast";
import { normalizujNastaveniZasilek, type NastaveniZasilek } from "../../lib/zasilky";

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
 * Nastavení → Zakázky → Přesuny mezi pobočkami: zapínací modul zásilek.
 *
 * Zapnutý modul (service_settings.config.zasilky) přidá stránku Zásilky,
 * kartu „Kde je zakázka“ v detailu a štítek místa v seznamu. Dává smysl jen
 * servisu s víc pobočkami – s jednou není kam posílat.
 */
export function ZasilkySettingsSection({ activeServiceId }: { activeServiceId: string | null }) {
  const [zapnuto, setZapnuto] = useState(false);
  const [volby, setVolby] = useState<NastaveniZasilek>(() => normalizujNastaveniZasilek(undefined));
  const { nacteno, oznacNacteno } = useConfigNacteno(activeServiceId);
  const { branches, isMulti } = useBranches();
  const hint = useSavedHint();

  useEffect(() => {
    if (!activeServiceId) return;
    let zruseno = false;
    nactiServiceConfig(activeServiceId).then((r) => {
      if (zruseno || r.stav === "chyba") return;
      setZapnuto(r.stav === "ok" && r.config.zasilky === true);
      setVolby(normalizujNastaveniZasilek(r.stav === "ok" ? r.config : undefined));
      oznacNacteno();
    });
    const unsubscribe = subscribeServiceConfig(activeServiceId, (config) => {
      setZapnuto(config.zasilky === true);
      setVolby(normalizujNastaveniZasilek(config));
    }, "zasilky-nastaveni");
    return () => { zruseno = true; unsubscribe(); };
  }, [activeServiceId, oznacNacteno]);

  const ulozPatch = useCallback(async (patch: Record<string, unknown>) => {
    if (!nacteno || !activeServiceId) return;
    try {
      const r = await mergeServiceConfig(activeServiceId, patch);
      if (r.error) throw new Error(r.error);
      window.dispatchEvent(new CustomEvent("jobsheet:ui-updated"));
      hint.show();
    } catch (e) {
      console.error("[Zasilky] uložení selhalo", e);
      showToast("Nastavení se nepodařilo uložit", "error");
    }
  }, [activeServiceId, nacteno, hint]);

  const ulozit = useCallback(async (hodnota: boolean) => {
    if (!nacteno || !activeServiceId) return;
    setZapnuto(hodnota);
    try {
      const r = await mergeServiceConfig(activeServiceId, { zasilky: hodnota });
      if (r.error) throw new Error(r.error);
      window.dispatchEvent(new CustomEvent("jobsheet:ui-updated"));
      hint.show();
    } catch (e) {
      console.error("[Zasilky] uložení selhalo", e);
      showToast("Nastavení se nepodařilo uložit", "error");
    }
  }, [activeServiceId, nacteno, hint]);

  return (
    <Card data-config-nacteno={nacteno ? "1" : "0"}>
      <CardHeader
        title="Přesuny mezi pobočkami"
        description="Zakázka se přijme na jedné pobočce, opraví na druhé a vydá zase na první. Místo stavů typu „Posláno do Prahy“ vede aplikace zvlášť, kde zařízení fyzicky je: zásilky (koncept → odesláno → převzato) s dopravcem a sledovacím číslem, karta „Kde je zakázka“ v detailu a štítek místa v seznamu. Člen omezený na pobočku vidí i zakázky, které k němu přijely."
        right={hint.node}
      />
      <SettingRows>
        <SettingRow
          clickable
          label="Zásilky mezi pobočkami"
          description={isMulti
            ? `Přidá stránku Zásilky do navigace. Pobočky: ${branches.map((b) => b.name).join(", ")}.`
            : "Servis má jednu pobočku – zásilky nemají kam jet. Pobočky přidáte v Nastavení → Firma → Pobočky."}
          control={
            <input
              type="checkbox"
              checked={zapnuto}
              disabled={!nacteno || (!isMulti && !zapnuto)}
              aria-label="Zapnout zásilky mezi pobočkami"
              onChange={(e) => void ulozit(e.target.checked)}
            />
          }
        />
        {zapnuto && (
          <>
            <SettingRow
              clickable
              label="Kroky přesunu v Postupu zakázky"
              description="V detailu se do postupu přidá „Odesláno do Prahy → Převzato v Praze → Zpět v Brně“, aby recepce viděla, kde zakázka vázne. Jen u zakázek, které někam jely."
              control={<input type="checkbox" checked={volby.postup} disabled={!nacteno} aria-label="Kroky přesunu v postupu zakázky" onChange={(e) => { setVolby({ ...volby, postup: e.target.checked }); void ulozPatch({ zasilky_postup: e.target.checked }); }} />}
            />
            <SettingRow
              clickable
              label="Rychlý filtr „Přesuny“ v seznamu zakázek"
              description="Vedle Aktivní / Vše přibude záložka se zakázkami, které jsou na cestě nebo leží na jiné pobočce."
              control={<input type="checkbox" checked={volby.filtr} disabled={!nacteno} aria-label="Rychlý filtr Přesuny" onChange={(e) => { setVolby({ ...volby, filtr: e.target.checked }); void ulozPatch({ zasilky_filtr: e.target.checked }); }} />}
            />
            <SettingRow
              label="Upozornit, když zakázka leží jinde bez změny"
              description="Zakázka mimo svou pobočku, která se tolik dní neuložila (žádná změna stavu ani oprav), dostane v seznamu červený štítek a v detailu upozornění. 0 = vypnuto."
              control={
                <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                  <input
                    type="number"
                    className="ui-input"
                    min={0}
                    max={365}
                    step={1}
                    defaultValue={volby.upozorneniDni}
                    disabled={!nacteno}
                    aria-label="Počet dní bez změny"
                    style={{ width: 80 }}
                    onBlur={(e) => {
                      const n = Math.max(0, Math.min(365, Math.floor(Number(e.target.value) || 0)));
                      e.target.value = String(n);
                      if (n !== volby.upozorneniDni) { setVolby({ ...volby, upozorneniDni: n }); void ulozPatch({ zasilky_upozorneni_dni: n }); }
                    }}
                  />
                  <span style={{ color: "var(--muted)", fontSize: 13 }}>dní</span>
                </span>
              }
            />
            <SettingRow
              clickable
              label="Zákaznický portál: „Zařízení je v opravně“"
              description="Když je zakázka mimo svou pobočku nebo na cestě, portál zákazníkovi řekne jen to, že zařízení je v opravně – bez názvu pobočky. Vyžaduje nasazenou edge funkci portal-ticket."
              control={<input type="checkbox" checked={volby.portal} disabled={!nacteno} aria-label="Zákaznický portál: zařízení je v opravně" onChange={(e) => { setVolby({ ...volby, portal: e.target.checked }); void ulozPatch({ zasilky_portal: e.target.checked }); }} />}
            />
          </>
        )}
      </SettingRows>
    </Card>
  );
}
