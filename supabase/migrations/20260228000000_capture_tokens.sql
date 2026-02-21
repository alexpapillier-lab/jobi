-- Tabulka pro jednorázové tokeny pro upload diagnostických fotek z mobilu (QR capture)
-- Token vytvoří Jobi (Edge Function capture-create-token), capture stránka ho použije v URL

CREATE TABLE IF NOT EXISTS public.capture_tokens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  token text NOT NULL UNIQUE,
  ticket_id uuid NOT NULL REFERENCES public.tickets(id) ON DELETE CASCADE,
  service_id uuid NOT NULL,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_capture_tokens_token ON public.capture_tokens(token);
CREATE INDEX IF NOT EXISTS idx_capture_tokens_expires_at ON public.capture_tokens(expires_at);

COMMENT ON TABLE public.capture_tokens IS 'Jednorázové tokeny pro upload diagnostické fotky z mobilu (QR kód)';
