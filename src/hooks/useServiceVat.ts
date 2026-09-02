import { useEffect, useState } from "react";
import { supabase } from "../lib/supabaseClient";

/**
 * Nastavení DPH pro servis.
 *
 * Do zavedení těchhle sloupců měla každá nová položka faktury napevno 21 %
 * a nešlo říct „nejsem plátce“ – neplátce musel sazbu přepisovat u každého
 * řádku a na dokumentu mu stejně vyjela rekapitulace DPH.
 */
export type ServiceVat = {
  /** Když false, nové položky mají sazbu 0 a rekapitulace DPH se netiskne. */
  vatPayer: boolean;
  /** Výchozí sazba pro nové položky faktur (v procentech). */
  defaultVatRate: number;
  /** Jsou ceny v ceníku a skladu zadané včetně DPH? */
  pricesIncludeVat: boolean;
  loading: boolean;
};

/** Chování před migrací a při chybě: jako dosud, ať se nic nerozbije. */
export const VYCHOZI_DPH: Omit<ServiceVat, "loading"> = {
  vatPayer: true,
  defaultVatRate: 21,
  pricesIncludeVat: true,
};

export function useServiceVat(activeServiceId: string | null): ServiceVat {
  const [stav, setStav] = useState<Omit<ServiceVat, "loading">>(VYCHOZI_DPH);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!activeServiceId || !supabase) {
      setStav(VYCHOZI_DPH);
      setLoading(false);
      return;
    }
    let zruseno = false;
    setLoading(true);
    (async () => {
      const { data, error } = await supabase
        .from("services")
        .select("vat_payer, default_vat_rate, prices_include_vat")
        .eq("id", activeServiceId)
        .maybeSingle();
      if (zruseno) return;
      // Dokud migrace neproběhla, sloupce neexistují – držíme se výchozích
      // hodnot místo toho, abychom aplikaci shodili.
      if (error || !data) {
        setStav(VYCHOZI_DPH);
      } else {
        const d = data as { vat_payer?: boolean; default_vat_rate?: number | string; prices_include_vat?: boolean };
        const sazba = Number(d.default_vat_rate);
        setStav({
          vatPayer: d.vat_payer ?? VYCHOZI_DPH.vatPayer,
          defaultVatRate: Number.isFinite(sazba) ? sazba : VYCHOZI_DPH.defaultVatRate,
          pricesIncludeVat: d.prices_include_vat ?? VYCHOZI_DPH.pricesIncludeVat,
        });
      }
      setLoading(false);
    })();
    return () => {
      zruseno = true;
    };
  }, [activeServiceId]);

  return { ...stav, loading };
}

/** Sazba pro NOVOU položku faktury. Neplátce má vždy 0. */
export function sazbaProNovouPolozku(v: Pick<ServiceVat, "vatPayer" | "defaultVatRate">): number {
  return v.vatPayer ? v.defaultVatRate : 0;
}
