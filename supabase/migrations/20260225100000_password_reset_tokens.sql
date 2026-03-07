-- Tokeny pro obnovu hesla (kód v e-mailu, uživatel ho zadá v aplikaci).
CREATE TABLE IF NOT EXISTS public.password_reset_tokens (
  email text NOT NULL,
  token text NOT NULL,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (email, token)
);

CREATE INDEX IF NOT EXISTS idx_password_reset_tokens_expires_at
  ON public.password_reset_tokens (expires_at);

ALTER TABLE public.password_reset_tokens ENABLE ROW LEVEL SECURITY;

-- Žádný přístup pro anon/authenticated; pouze service role (Edge Functions) může číst/psát.
CREATE POLICY "password_reset_tokens_service_only"
  ON public.password_reset_tokens
  FOR ALL
  USING (false)
  WITH CHECK (false);

-- Vrátí auth.users.id pro daný e-mail (pro Edge Function při potvrzení resetu).
CREATE OR REPLACE FUNCTION public.get_auth_user_id_by_email(p_email text)
RETURNS uuid
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = auth, public
AS $$
  SELECT id FROM auth.users WHERE email = lower(trim(p_email)) LIMIT 1;
$$;

COMMENT ON TABLE public.password_reset_tokens IS 'Jednorázové tokeny pro obnovu hesla; platnost typicky 1 hodina.';
COMMENT ON FUNCTION public.get_auth_user_id_by_email(text) IS 'Pro password-reset-confirm: vrátí user id z auth.users podle e-mailu.';
