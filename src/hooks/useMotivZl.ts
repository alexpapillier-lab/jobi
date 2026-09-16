import { useEffect, useState } from "react";
import { loadServiceConfig, subscribeServiceConfig } from "../lib/serviceSettingsSync";

/**
 * Modul „Motiv ZL“ (service_settings.config.motiv_zl).
 *
 * Výchozí vypnuto. Zapnutý modul přidá do Nastavení → Vzhled → Předvolby
 * motiv ZL – bílé panely, modrý akcent a tmavá boční lišta, tedy vzhled
 * Zakázkového listu. Je to volba servisu, ne osobní: servis, který ze
 * Zakázkového listu přešel, ho nabídne celému týmu; kdo ho nechce, prostě
 * si motiv nevybere.
 */
export function useMotivZl(serviceId: string | null): boolean {
  const [zapnuto, setZapnuto] = useState(false);
  useEffect(() => {
    if (!serviceId) { setZapnuto(false); return; }
    let zruseno = false;
    void loadServiceConfig(serviceId).then((config) => {
      if (!zruseno) setZapnuto((config as { motiv_zl?: unknown } | null)?.motiv_zl === true);
    });
    const odhlasit = subscribeServiceConfig(serviceId, (config) => {
      setZapnuto((config as { motiv_zl?: unknown }).motiv_zl === true);
    }, "motiv-zl");
    return () => { zruseno = true; odhlasit(); };
  }, [serviceId]);
  return zapnuto;
}
