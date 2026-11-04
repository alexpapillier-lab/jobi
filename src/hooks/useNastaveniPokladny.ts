import { useEffect, useState } from "react";
import { loadServiceConfig, subscribeServiceConfig } from "../lib/serviceSettingsSync";
import { normalizujNastaveniPokladny, type NastaveniPokladny } from "../lib/pokladna";

/**
 * Modul Pokladna (service_settings.config.pokladna) a jeho volby.
 *
 * Výchozí vypnuto – zapíná správce v Nastavení → Firma → Pokladna. Zapnutý
 * modul přidá stránku Pokladna; na Dnes pak hlásí nezaplacené vydané
 * zakázky a chybějící uzávěrku.
 */
export function useNastaveniPokladny(serviceId: string | null): NastaveniPokladny {
  // Hook používá víc míst naráz (navigace, stránka, Dnes) – každé svůj kanál.
  const [kanal] = useState(() => `pokladna-${Math.random().toString(36).slice(2, 8)}`);
  const [nastaveni, setNastaveni] = useState<NastaveniPokladny>(() => normalizujNastaveniPokladny(undefined));
  useEffect(() => {
    setNastaveni(normalizujNastaveniPokladny(undefined));
    if (!serviceId) return;
    let zruseno = false;
    void loadServiceConfig(serviceId).then((config) => {
      if (!zruseno) setNastaveni(normalizujNastaveniPokladny(config as Record<string, unknown> | null));
    });
    const odhlasit = subscribeServiceConfig(serviceId, (config) => {
      setNastaveni(normalizujNastaveniPokladny(config as Record<string, unknown>));
    }, kanal);
    return () => { zruseno = true; odhlasit(); };
  }, [serviceId, kanal]);
  return nastaveni;
}
