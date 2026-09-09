import { useEffect, useState } from "react";
import { loadServiceConfig, subscribeServiceConfig } from "../lib/serviceSettingsSync";

/**
 * Je pro servis zapnutý chat týmu? (`service_settings.config.chat`, výchozí
 * zapnuto – chat je zdarma, vypíná se jen tam, kde si lidé nepíšou.)
 *
 * Vlastní hook místo stavu ze Zakázek: chat visí nad celou aplikací (App),
 * ne nad jednou stránkou, a musí reagovat i na přepnutí v Nastavení bez
 * obnovení stránky – proto realtime odběr configu.
 */
export function useChatZapnuty(serviceId: string | null): boolean {
  const [zapnuto, setZapnuto] = useState(true);
  useEffect(() => {
    if (!serviceId) { setZapnuto(true); return; }
    let zruseno = false;
    void loadServiceConfig(serviceId).then((config) => {
      if (!zruseno) setZapnuto((config as { chat?: unknown } | null)?.chat !== false);
    });
    const odhlasit = subscribeServiceConfig(serviceId, (config) => {
      setZapnuto((config as { chat?: unknown } | null)?.chat !== false);
    }, "chat");
    return () => { zruseno = true; odhlasit(); };
  }, [serviceId]);
  return zapnuto;
}
