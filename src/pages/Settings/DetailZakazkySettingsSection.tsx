import { useCallback, useEffect, useState, type ReactNode } from "react";
import { Card, SettingRow, SettingRows, useSavedHint } from "../../components/ui";
import { nactiServiceConfig, mergeServiceConfig, subscribeServiceConfig } from "../../lib/serviceSettingsSync";
import { useConfigNacteno } from "./useConfigNacteno";
import { SKRYTELNE_SEKCE, normalizujSkryteSekce, type SkrytelnaSekce } from "../../lib/sekceDetailu";
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
 * Nastavení → Zakázky → Detail zakázky: které sekce se v detailu ukazují.
 *
 * Servis, který nepoužívá zákaznický portál, zápůjčky nebo kontrolu po
 * opravě, měl v každé zakázce tři karty navíc a k opravám scrolloval kolem
 * nich. Tady si je vypne pro celý servis
 * (service_settings.config.skryte_sekce_detailu). Karta Technik se řídí
 * přidělováním technika (config.pridelovani_technika) – stejný přepínač je
 * i v Nastavení → Tým.
 */
export function DetailZakazkySettingsSection({ activeServiceId }: { activeServiceId: string | null }) {
  const [skryte, setSkryte] = useState<Set<SkrytelnaSekce>>(new Set());
  const [pridelovaniTechnika, setPridelovaniTechnika] = useState(true);
  const { nacteno, oznacNacteno } = useConfigNacteno(activeServiceId);
  const [chybaNacteni, setChybaNacteni] = useState(false);
  const hint = useSavedHint();

  useEffect(() => {
    if (!activeServiceId) return;
    let zruseno = false;
    nactiServiceConfig(activeServiceId).then((r) => {
      if (zruseno) return;
      if (r.stav === "chyba") {
        setChybaNacteni(true);
        return;
      }
      setChybaNacteni(false);
      const config = r.stav === "ok" ? r.config : {};
      setSkryte(normalizujSkryteSekce(config.skryte_sekce_detailu));
      setPridelovaniTechnika(config.pridelovani_technika !== false);
      oznacNacteno();
    });
    const unsubscribe = subscribeServiceConfig(activeServiceId, (config) => {
      setSkryte(normalizujSkryteSekce(config.skryte_sekce_detailu));
      setPridelovaniTechnika(config.pridelovani_technika !== false);
    });
    return () => { zruseno = true; unsubscribe(); };
  }, [activeServiceId, oznacNacteno]);

  const ulozit = useCallback(async (patch: { skryte_sekce_detailu?: SkrytelnaSekce[]; pridelovani_technika?: boolean }) => {
    if (!nacteno || !activeServiceId) return;
    try {
      const r = await mergeServiceConfig(activeServiceId, patch);
      if (r.error) throw new Error(r.error);
      // Stránka Zakázky si config načte znovu (stejně jako po přepnutí v Týmu).
      window.dispatchEvent(new CustomEvent("jobsheet:ui-updated"));
      hint.show();
    } catch (e) {
      console.error("[DetailZakazky] uložení selhalo", e);
      showToast("Nastavení se nepodařilo uložit", "error");
    }
  }, [activeServiceId, nacteno, hint]);

  const prepnout = (klic: SkrytelnaSekce, zobrazit: boolean) => {
    const next = new Set(skryte);
    if (zobrazit) next.delete(klic);
    else next.add(klic);
    setSkryte(next);
    void ulozit({ skryte_sekce_detailu: [...next] });
  };

  return (
    <Card data-config-nacteno={nacteno ? "1" : "0"}>
      <CardHeader
        title="Sekce v detailu zakázky"
        description="Co nepoužíváte, vypněte – detail zakázky bude kratší. Platí pro všechny v servisu."
        right={hint.node}
      />
      {chybaNacteni && (
        <div style={{ marginBottom: 12, padding: 10, borderRadius: 8, border: "1px solid var(--danger, #dc2626)", color: "var(--danger, #dc2626)", fontSize: 13 }}>
          Nastavení se nepodařilo načíst. Dokud se nenačte, nejde ho měnit.
        </div>
      )}
      <SettingRows>
        {SKRYTELNE_SEKCE.map((s) => (
          <SettingRow
            key={s.klic}
            clickable
            label={s.nazev}
            description={s.popis}
            control={
              <input
                type="checkbox"
                checked={!skryte.has(s.klic)}
                disabled={!nacteno}
                aria-label={`Zobrazit sekci ${s.nazev}`}
                onChange={(e) => prepnout(s.klic, e.target.checked)}
              />
            }
          />
        ))}
        <SettingRow
          clickable
          label="Technik"
          description="Přidělení zakázky technikovi („Přidělit mně“), v seznamu skupina Moje a jméno technika na kartě. Stejný přepínač je v Nastavení → Tým."
          control={
            <input
              type="checkbox"
              checked={pridelovaniTechnika}
              disabled={!nacteno}
              aria-label="Zobrazit sekci Technik"
              onChange={(e) => { setPridelovaniTechnika(e.target.checked); void ulozit({ pridelovani_technika: e.target.checked }); }}
            />
          }
        />
      </SettingRows>
    </Card>
  );
}
