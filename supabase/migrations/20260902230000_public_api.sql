-- Veřejné API: viditelnost položek, adresa servisu, režim skladu, tokeny.
-- Zadání: docs/ZADANI_API.md

-- 1) Adresa servisu ve veřejném API a režim dostupnosti skladu.
--    Slug místo service_id, ať neleze ven interní identifikátor.
ALTER TABLE public.services
  ADD COLUMN IF NOT EXISTS public_slug text,
  ADD COLUMN IF NOT EXISTS inventory_availability_mode text NOT NULL DEFAULT 'boolean';

CREATE UNIQUE INDEX IF NOT EXISTS idx_services_public_slug
  ON public.services (public_slug) WHERE public_slug IS NOT NULL;

ALTER TABLE public.services
  DROP CONSTRAINT IF EXISTS services_inventory_availability_mode_check;
ALTER TABLE public.services
  ADD CONSTRAINT services_inventory_availability_mode_check
  CHECK (inventory_availability_mode IN ('hidden', 'boolean', 'exact'));

-- Slug jde do URL: malá písmena, číslice, pomlčky.
ALTER TABLE public.services
  DROP CONSTRAINT IF EXISTS services_public_slug_format;
ALTER TABLE public.services
  ADD CONSTRAINT services_public_slug_format
  CHECK (public_slug IS NULL OR public_slug ~ '^[a-z0-9]([a-z0-9-]{1,48}[a-z0-9])?$');

COMMENT ON COLUMN public.services.public_slug IS
  'Adresa servisu ve veřejném API (/v1/catalog?service=<slug>). NULL = API se nedá adresovat.';
COMMENT ON COLUMN public.services.inventory_availability_mode IS
  'Jak se ve veřejném API ukazuje sklad: hidden (vůbec), boolean (skladem/není), exact (přesné číslo).';

-- 2) Viditelnost po položkách.
--
--    Výchozí TRUE, ne FALSE: zapnutí modulu je vědomý krok a nutit
--    uživatele ručně odklikat stovku oprav by znamenalo, že to nikdo
--    nepoužije. Skrytí je výjimka.
ALTER TABLE public.device_categories        ADD COLUMN IF NOT EXISTS public_visible boolean NOT NULL DEFAULT true;
ALTER TABLE public.device_models            ADD COLUMN IF NOT EXISTS public_visible boolean NOT NULL DEFAULT true;
ALTER TABLE public.repairs                  ADD COLUMN IF NOT EXISTS public_visible boolean NOT NULL DEFAULT true;
ALTER TABLE public.device_brands            ADD COLUMN IF NOT EXISTS public_visible boolean NOT NULL DEFAULT true;
ALTER TABLE public.inventory_product_categories ADD COLUMN IF NOT EXISTS public_visible boolean NOT NULL DEFAULT true;
ALTER TABLE public.inventory_products       ADD COLUMN IF NOT EXISTS public_visible boolean NOT NULL DEFAULT true;

COMMENT ON COLUMN public.repairs.public_visible IS
  'Posílat tuhle opravu do veřejného API? Skrytá značka/kategorie skrývá i vše pod sebou.';

-- 3) Tokeny pro zápis.
--
--    Ukládá se jen hash. Samotný token se ukáže jednou při vytvoření
--    a už nikdy – jinak by jeho únik z databáze znamenal přístup k zápisu.
CREATE TABLE IF NOT EXISTS public.api_tokens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  service_id uuid NOT NULL REFERENCES public.services(id) ON DELETE CASCADE,
  name text NOT NULL,
  token_hash text NOT NULL UNIQUE,
  -- catalog:read, catalog:write, inventory:read, inventory:write
  scopes text[] NOT NULL DEFAULT '{}',
  last_used_at timestamptz,
  revoked_at timestamptz,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_api_tokens_service ON public.api_tokens (service_id);
CREATE INDEX IF NOT EXISTS idx_api_tokens_hash ON public.api_tokens (token_hash) WHERE revoked_at IS NULL;

COMMENT ON TABLE public.api_tokens IS
  'Tokeny pro zápis přes veřejné API. Odvolané se nemažou, ať je dohledatelné, co se kdy dělo.';

-- RLS: tokeny vidí a spravuje jen člen servisu. Anon nic.
ALTER TABLE public.api_tokens ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "api_tokens_select_members" ON public.api_tokens;
CREATE POLICY "api_tokens_select_members"
  ON public.api_tokens FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.service_memberships m
      WHERE m.service_id = api_tokens.service_id AND m.user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "api_tokens_write_members" ON public.api_tokens;
CREATE POLICY "api_tokens_write_members"
  ON public.api_tokens FOR ALL TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.service_memberships m
      WHERE m.service_id = api_tokens.service_id AND m.user_id = auth.uid()
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.service_memberships m
      WHERE m.service_id = api_tokens.service_id AND m.user_id = auth.uid()
    )
  );
