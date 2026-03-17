-- Draft capture: token bez zakázky (pro "Udělat přijímací fotky" před vytvořením zakázky)
-- ticket_id může být NULL; upload jde do draft_capture_photos, po vytvoření zakázky se claimne

ALTER TABLE public.capture_tokens
  ALTER COLUMN ticket_id DROP NOT NULL;

COMMENT ON COLUMN public.capture_tokens.ticket_id IS 'NULL = draft token (fotky se uloží do draft_capture_photos a po vytvoření zakázky se claimnou)';

CREATE TABLE IF NOT EXISTS public.draft_capture_photos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  capture_token_id uuid NOT NULL REFERENCES public.capture_tokens(id) ON DELETE CASCADE,
  photo_url text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_draft_capture_photos_token ON public.draft_capture_photos(capture_token_id);

COMMENT ON TABLE public.draft_capture_photos IS 'Fotky nahráné přes draft capture token; po vytvoření zakázky se přesunou do ticket.diagnostic_photos_before';
