import { useEffect, useState } from "react";
import { nactiZasilky, subscribeZasilky } from "../lib/zasilky";

/**
 * Kolik zásilek je právě na cestě k dané pobočce (odznak u položky Zásilky
 * v navigaci). Bez vybrané pobočky („Všechny pobočky“) počítá všechny
 * zásilky na cestě. Vypnutý modul = 0 a nic se nenačítá.
 */
export function usePrichoziZasilky(serviceId: string | null, branchId: string | null, zapnuto: boolean): number {
  const [pocet, setPocet] = useState(0);
  useEffect(() => {
    if (!serviceId || !zapnuto) { setPocet(0); return; }
    let zruseno = false;
    const nacti = () => {
      nactiZasilky(serviceId)
        .then((z) => {
          if (zruseno) return;
          setPocet(z.filter((s) => s.status === "sent" && (!branchId || s.toBranchId === branchId)).length);
        })
        .catch(() => { /* odznak není důvod k chybové hlášce; stránka Zásilky ji ukáže sama */ });
    };
    nacti();
    const odhlasit = subscribeZasilky(serviceId, nacti);
    return () => { zruseno = true; odhlasit(); };
  }, [serviceId, branchId, zapnuto]);
  return pocet;
}
