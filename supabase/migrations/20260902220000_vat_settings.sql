-- DPH na úrovni servisu.
--
-- Do teď aplikace o DPH nevěděla nic: každá nová položka faktury dostala
-- napevno 21 % a nikde nešlo říct "nejsem plátce". Neplátce tak musel
-- sazbu přepisovat u každého řádku a na dokumentu mu stejně vyjela
-- rekapitulace DPH. U servisu pod obratovým limitem je to špatně.
--
-- Zároveň mělo repairs.price a inventory_products.price nedefinovaný
-- význam – nikdo nevěděl, jestli je to částka s daní nebo bez. To vadí
-- hlavně veřejnému API, které má posílat obě varianty.

ALTER TABLE public.services
  ADD COLUMN IF NOT EXISTS vat_payer boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS default_vat_rate numeric(5,2) NOT NULL DEFAULT 21,
  ADD COLUMN IF NOT EXISTS prices_include_vat boolean NOT NULL DEFAULT true;

COMMENT ON COLUMN public.services.vat_payer IS
  'Je servis plátce DPH? Když ne, nové položky faktur mají sazbu 0 a na dokumentech se neukazuje rekapitulace DPH.';
COMMENT ON COLUMN public.services.default_vat_rate IS
  'Výchozí sazba DPH pro nové položky faktur (v procentech). U neplátce se ignoruje.';
COMMENT ON COLUMN public.services.prices_include_vat IS
  'Jsou ceny v ceníku a skladu zadané VČETNĚ DPH? Určuje, jak se dopočítá druhá varianta ve veřejném API.';

-- Sazba musí dávat smysl. 0 je platná (osvobozeno), záporná ani přes 100 ne.
ALTER TABLE public.services
  DROP CONSTRAINT IF EXISTS services_default_vat_rate_range;
ALTER TABLE public.services
  ADD CONSTRAINT services_default_vat_rate_range
  CHECK (default_vat_rate >= 0 AND default_vat_rate <= 100);
