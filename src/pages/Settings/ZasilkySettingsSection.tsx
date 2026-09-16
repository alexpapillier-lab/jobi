import { useCallback, useEffect, useState, type ReactNode } from "react";
import { Card, SettingRow, SettingRows, useSavedHint } from "../../components/ui";
import { nactiServiceConfig, mergeServiceConfig, subscribeServiceConfig } from "../../lib/serviceSettingsSync";
import { useConfigNacteno } from "./useConfigNacteno";
import { useBranches } from "../../context/BranchContext";
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
 * Nastavení → Zakázky → Přesuny mezi pobočkami: zapínací modul zásilek.
 *
 * Zapnutý modul (service_settings.config.zasilky) přidá stránku Zásilky,
 * kartu „Kde je zakázka“ v detailu a štítek místa v seznamu. Dává smysl jen
 * servisu s víc pobočkami – s jednou není kam posílat.
 */
export function ZasilkySettingsSection({ activeServiceId }: { activeServiceId: string | null }) {
  const [zapnuto, setZapnuto] = useState(false);
  const { nacteno, oznacNacteno } = useConfigNacteno(activeServiceId);
  const { branches, isMulti } = useBranches();
  const hint = useSavedHint();

  useEffect(() => {
    if (!activeServiceId) return;
    let zruseno = false;
    nactiServiceConfig(activeServiceId).then((r) => {
      if (zruseno || r.stav === "chyba") return;
      setZapnuto(r.stav === "ok" && r.config.zasilky === true);
      oznacNacteno();
    });
    const unsubscribe = subscribeServiceConfig(activeServiceId, (config) => setZapnuto(config.zasilky === true), "zasilky-nastaveni");
    return () => { zruseno = true; unsubscribe(); };
  }, [activeServiceId, oznacNacteno]);

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
      </SettingRows>
    </Card>
  );
}
