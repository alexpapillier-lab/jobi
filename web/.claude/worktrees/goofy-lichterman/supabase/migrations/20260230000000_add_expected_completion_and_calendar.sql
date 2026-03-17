-- Předpokládané dokončení a datum dokončení pro kalendář (Gantt)
-- tickets: expected_completion_at (volitelné), completed_at (nastaví se při přepnutí do finálního stavu)
-- warranty_claims: stejně

ALTER TABLE public.tickets
  ADD COLUMN IF NOT EXISTS expected_completion_at timestamptz,
  ADD COLUMN IF NOT EXISTS completed_at timestamptz;

ALTER TABLE public.warranty_claims
  ADD COLUMN IF NOT EXISTS expected_completion_at timestamptz,
  ADD COLUMN IF NOT EXISTS completed_at timestamptz;

CREATE INDEX IF NOT EXISTS idx_tickets_expected_completion_at ON public.tickets(expected_completion_at)
  WHERE expected_completion_at IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_tickets_completed_at ON public.tickets(completed_at)
  WHERE completed_at IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_warranty_claims_expected_completion_at ON public.warranty_claims(expected_completion_at)
  WHERE expected_completion_at IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_warranty_claims_completed_at ON public.warranty_claims(completed_at)
  WHERE completed_at IS NOT NULL;

COMMENT ON COLUMN public.tickets.expected_completion_at IS 'Předpokládané datum/čas dokončení (pro kalendář)';
COMMENT ON COLUMN public.tickets.completed_at IS 'Datum/čas přepnutí do finálního stavu (pro Gantt)';
COMMENT ON COLUMN public.warranty_claims.expected_completion_at IS 'Předpokládané datum/čas dokončení (pro kalendář)';
COMMENT ON COLUMN public.warranty_claims.completed_at IS 'Datum/čas přepnutí do finálního stavu (pro Gantt)';
