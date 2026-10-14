import { useEffect, useState } from "react";
import { nactiOdkudCestuji, subscribeZasilky } from "../../../lib/zasilky";

/**
 * Zásilky mezi pobočkami, které jsou právě na cestě: id zásilky → pobočka,
 * odkud vyjela. Seznam zakázek z toho skládá štítek „Brno → Hlavní pobočka“;
 * zakázka sama zná jen cíl (location_branch_id) a id zásilky.
 */
export function useOdkudCestuji(activeServiceId: string | null, zapnuto: boolean): Map<string, string> {
  const [odkud, setOdkud] = useState<Map<string, string>>(() => new Map());

  useEffect(() => {
    if (!activeServiceId || !zapnuto) {
      setOdkud(new Map());
      return;
    }
    let zruseno = false;
    const nacti = () => {
      nactiOdkudCestuji(activeServiceId)
        .then((m) => { if (!zruseno) setOdkud(m); })
        // Bez odkud štítek ukáže aspoň cíl („→ Praha“) – nic se nerozbije.
        .catch((e) => console.warn("[zasilky] načtení zásilek na cestě selhalo", e));
    };
    nacti();
    const odhlasit = subscribeZasilky(activeServiceId, nacti);
    return () => { zruseno = true; odhlasit(); };
  }, [activeServiceId, zapnuto]);

  return odkud;
}
