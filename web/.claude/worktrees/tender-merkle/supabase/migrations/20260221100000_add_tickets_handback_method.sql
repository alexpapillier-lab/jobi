-- Způsob předání (odevzdání zákazníkovi) – odděleně od způsobu převzetí
ALTER TABLE public.tickets
  ADD COLUMN IF NOT EXISTS handback_method text;

COMMENT ON COLUMN public.tickets.handback_method IS 'Způsob předání zařízení zákazníkovi (např. na pobočce, poštou). Převzetí je v handoff_method.';
