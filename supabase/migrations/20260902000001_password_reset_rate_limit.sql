-- Rate limiting pro obnovu hesla.
--
-- password_reset_tokens se při každém požadavku maže a znovu vkládá, takže z něj
-- nejde zjistit historii pokusů. Tahle tabulka drží klouzavé okno na e-mail:
-- kolik žádostí přišlo a kdy okno začalo.
--
-- Bez toho šlo endpointem password-reset-request neomezeně bombardovat schránku
-- uživatele a sbírat vzorky tokenů.

CREATE TABLE IF NOT EXISTS public.password_reset_rate_limit (
  email text PRIMARY KEY,
  window_started_at timestamptz NOT NULL DEFAULT now(),
  request_count integer NOT NULL DEFAULT 0,
  last_request_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_password_reset_rate_limit_window
  ON public.password_reset_rate_limit (window_started_at);

ALTER TABLE public.password_reset_rate_limit ENABLE ROW LEVEL SECURITY;

-- Přístup má jen service_role (edge funkce); anon/authenticated nic.
CREATE POLICY "password_reset_rate_limit_service_only"
  ON public.password_reset_rate_limit
  FOR ALL
  USING (false)
  WITH CHECK (false);

COMMENT ON TABLE public.password_reset_rate_limit IS
  'Klouzavé okno pro omezení žádostí o obnovu hesla (1/min, 5/hod na e-mail).';
