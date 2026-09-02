-- Výjimky ve veřejném ceníku pro jednotlivé modely.
--
-- Do teď byla viditelnost jen jeden vypínač na řádek, takže „Reinstalace iOS“
-- navěšená na 37 modelů se dala schovat jen celá. Skrýt místo toho model
-- schová všechny opravy na něm a vyndat model z model_ids by ho odebral
-- i uvnitř aplikace, kde se vybírá na zakázce.
--
-- Tohle je čistě věc API: model_ids zůstávají netknuté, jen se z výstupu
-- vypustí dvojice oprava–model, které tu jsou vyjmenované.
ALTER TABLE public.repairs
  ADD COLUMN IF NOT EXISTS public_hidden_model_ids jsonb NOT NULL DEFAULT '[]'::jsonb;

COMMENT ON COLUMN public.repairs.public_hidden_model_ids IS
  'Modely, u kterých se tahle oprava do veřejného ceníku neposílá. Uvnitř aplikace se nabízí dál. Nadřazené jsou public_visible na opravě i na modelu.';

-- Stejný gin index jako na model_ids – filtruje se přes ně stejně.
CREATE INDEX IF NOT EXISTS idx_repairs_public_hidden_model_ids
  ON public.repairs USING gin(public_hidden_model_ids);
