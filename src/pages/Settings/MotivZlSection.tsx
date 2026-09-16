import { useCallback, useEffect, useState, type ReactNode } from "react";
import { Card, SettingRow, SettingRows, useSavedHint } from "../../components/ui";
import { nactiServiceConfig, mergeServiceConfig, subscribeServiceConfig } from "../../lib/serviceSettingsSync";
import { useConfigNacteno } from "./useConfigNacteno";
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
 * Nastavení → Vzhled → Moduly: motiv ZL.
 *
 * Zapnutý modul (service_settings.config.motiv_zl) přidá do Předvoleb
 * motiv ZL. Zapíná ho správce pro celý servis; motiv si pak každý vybere
 * sám, nikomu se nevnucuje.
 */
export function MotivZlSection({ activeServiceId }: { activeServiceId: string | null }) {
  const [zapnuto, setZapnuto] = useState(false);
  const { nacteno, oznacNacteno } = useConfigNacteno(activeServiceId);
  const hint = useSavedHint();

  useEffect(() => {
    if (!activeServiceId) return;
    let zruseno = false;
    nactiServiceConfig(activeServiceId).then((r) => {
      if (zruseno || r.stav === "chyba") return;
      setZapnuto(r.stav === "ok" && r.config.motiv_zl === true);
      oznacNacteno();
    });
    const unsubscribe = subscribeServiceConfig(activeServiceId, (config) => setZapnuto(config.motiv_zl === true), "motiv-zl-nastaveni");
    return () => { zruseno = true; unsubscribe(); };
  }, [activeServiceId, oznacNacteno]);

  const ulozit = useCallback(async (hodnota: boolean) => {
    if (!nacteno || !activeServiceId) return;
    setZapnuto(hodnota);
    try {
      const r = await mergeServiceConfig(activeServiceId, { motiv_zl: hodnota });
      if (r.error) throw new Error(r.error);
      window.dispatchEvent(new CustomEvent("jobsheet:ui-updated"));
      hint.show();
    } catch (e) {
      console.error("[MotivZL] uložení selhalo", e);
      showToast("Nastavení se nepodařilo uložit", "error");
    }
  }, [activeServiceId, nacteno, hint]);

  return (
    <Card data-config-nacteno={nacteno ? "1" : "0"}>
      <CardHeader
        title="Motiv ZL"
        description="Vzhled jako v Zakázkovém listu: bílé panely na šedém podkladu, modrý akcent, tmavá boční lišta, hranatější tvary a žádné rozostření. Hodí se servisu, který ze Zakázkového listu přešel a chce známé prostředí."
        right={hint.node}
      />
      <SettingRows>
        <SettingRow
          clickable
          label="Nabízet motiv ZL"
          description="Přidá ho mezi předvolby v Nastavení → Vzhled. Motiv si pak každý zapne sám, nikomu se nemění."
          control={
            <input
              type="checkbox"
              checked={zapnuto}
              disabled={!nacteno}
              aria-label="Nabízet motiv ZL"
              onChange={(e) => void ulozit(e.target.checked)}
            />
          }
        />
      </SettingRows>
    </Card>
  );
}
