import { useEffect, useState } from "react";
import { loadServiceConfig, subscribeServiceConfig } from "../lib/serviceSettingsSync";

/**
 * Modul „Přesuny mezi pobočkami“ (service_settings.config.zasilky).
 *
 * Výchozí vypnuto – zapíná ho správce v Nastavení → Zakázky → Přesuny mezi
 * pobočkami a dává smysl jen servisu s víc pobočkami. Zapnutý modul přidá
 * stránku Zásilky, kartu „Kde je zakázka“ v detailu a štítek místa v seznamu.
 */
export function useZasilkyZapnuty(serviceId: string | null): boolean {
  const [zapnuto, setZapnuto] = useState(false);
  useEffect(() => {
    if (!serviceId) { setZapnuto(false); return; }
    let zruseno = false;
    void loadServiceConfig(serviceId).then((config) => {
      if (!zruseno) setZapnuto((config as { zasilky?: unknown } | null)?.zasilky === true);
    });
    const odhlasit = subscribeServiceConfig(serviceId, (config) => {
      setZapnuto((config as { zasilky?: unknown } | null)?.zasilky === true);
    }, "zasilky");
    return () => { zruseno = true; odhlasit(); };
  }, [serviceId]);
  return zapnuto;
}
