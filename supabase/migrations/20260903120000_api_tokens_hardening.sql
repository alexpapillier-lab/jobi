-- Tokeny pro zápis: utažení práv + zázemí pro idempotenci a limity.
--
-- Původní RLS z migrace 20260902230000 pouštěla k tokenům KAŽDÉHO člena
-- servisu, včetně řadového – ten si mohl sám vyrobit token na zápis do
-- ceníku. Vydávání tokenů patří majiteli a adminovi, stejně jako pozvánky.

-- 1) Čtení jen pro owner/admin. Řadový člen o tokenech nemusí vědět.
DROP POLICY IF EXISTS "api_tokens_select_members" ON public.api_tokens;
CREATE POLICY "api_tokens_select_admins"
  ON public.api_tokens FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.service_memberships m
      WHERE m.service_id = api_tokens.service_id
        AND m.user_id = auth.uid()
        AND m.role IN ('owner', 'admin')
    )
  );

-- 2) Zápis do tabulky jen přes edge funkci (service_role). Přes klienta
--    nejde token vyrobit ani upravit – jinak by šlo obejít generování
--    a uložit si vlastní známý hash.
DROP POLICY IF EXISTS "api_tokens_write_members" ON public.api_tokens;

-- 3) Hash ven nepatří ani adminovi. RLS neumí omezovat sloupce, na to je
--    jedině GRANT. (Stejná úvaha jako u repairs.costs ve veřejném API.)
REVOKE ALL ON public.api_tokens FROM authenticated;
GRANT SELECT (id, service_id, name, scopes, last_used_at, revoked_at, created_by, created_at)
  ON public.api_tokens TO authenticated;

-- 4) Idempotence zápisu.
--
--    Když se při výpadku sítě odešle stejný požadavek dvakrát, nesmí se
--    projevit dvakrát. Klient pošle hlavičku Idempotency-Key, my si klíč
--    zapamatujeme i s odpovědí a podruhé vrátíme tu uloženou.
CREATE TABLE IF NOT EXISTS public.api_idempotency (
  service_id uuid NOT NULL REFERENCES public.services(id) ON DELETE CASCADE,
  token_id uuid NOT NULL REFERENCES public.api_tokens(id) ON DELETE CASCADE,
  klic text NOT NULL,
  -- otisk těla: stejný klíč s jiným tělem je chyba klienta, ne opakování
  otisk_tela text NOT NULL,
  odpoved jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (token_id, klic)
);

COMMENT ON TABLE public.api_idempotency IS
  'Zapamatované odpovědi na zápis podle hlavičky Idempotency-Key. Uklízí se po 24 hodinách.';

ALTER TABLE public.api_idempotency ENABLE ROW LEVEL SECURITY;
-- Žádná politika = přes klienta nedostupné. Sahá tam jen service_role.

-- 5) Počítadlo pro limit zápisů.
--
--    Čtení se limituje na CDN (viz docs/ZADANI_API.md); u zápisu to jde
--    udělat v databázi, protože zápisů je řádově míň a jeden řádek navíc
--    nic nestojí.
CREATE TABLE IF NOT EXISTS public.api_write_hits (
  token_id uuid NOT NULL REFERENCES public.api_tokens(id) ON DELETE CASCADE,
  minuta timestamptz NOT NULL,
  pocet integer NOT NULL DEFAULT 0,
  PRIMARY KEY (token_id, minuta)
);

COMMENT ON TABLE public.api_write_hits IS
  'Počet zápisů na token a minutu. Limit hlídá edge funkce api-write.';

ALTER TABLE public.api_write_hits ENABLE ROW LEVEL SECURITY;

-- Atomické zvýšení počítadla. Bez toho by dva souběžné zápisy přečetly
-- stejnou hodnotu a limit by se dal obejít.
CREATE OR REPLACE FUNCTION public.api_zapocitej_zapis(p_token_id uuid)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_minuta timestamptz := date_trunc('minute', now());
  v_pocet integer;
BEGIN
  INSERT INTO public.api_write_hits (token_id, minuta, pocet)
  VALUES (p_token_id, v_minuta, 1)
  ON CONFLICT (token_id, minuta)
  DO UPDATE SET pocet = public.api_write_hits.pocet + 1
  RETURNING pocet INTO v_pocet;

  RETURN v_pocet;
END;
$$;

REVOKE ALL ON FUNCTION public.api_zapocitej_zapis(uuid) FROM public, anon, authenticated;

CREATE INDEX IF NOT EXISTS idx_api_write_hits_minuta ON public.api_write_hits (minuta);
CREATE INDEX IF NOT EXISTS idx_api_idempotency_created ON public.api_idempotency (created_at);
