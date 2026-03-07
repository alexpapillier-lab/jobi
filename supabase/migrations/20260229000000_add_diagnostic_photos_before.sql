-- Fotky při příjmu (před vytvořením zakázky / při zakládání)
ALTER TABLE public.tickets
  ADD COLUMN IF NOT EXISTS diagnostic_photos_before JSONB DEFAULT '[]'::jsonb;

COMMENT ON COLUMN public.tickets.diagnostic_photos_before IS
  'JSONB array of diagnostic photo URLs taken at intake/creation. Format: ["url1", "url2", ...].';
