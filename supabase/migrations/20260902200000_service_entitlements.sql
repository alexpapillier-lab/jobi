-- Nároky servisů na placené moduly.
--
-- Dosud se moduly zapínaly nesourodě: SMS podle toho, jestli servis má
-- aktivní telefonní číslo, Faktury přepínačem v localStorage. To druhé
-- není nárok, ale předvolba na zařízení – uživatel si modul zapnul sám
-- a na jiném počítači ho měl jinak. Prodávat se takhle nedá.
--
-- Tahle tabulka je jediné místo pravdy o tom, co má který servis
-- zaplacené. Zapisovat do ní smí jen majitel aplikace přes Edge Function
-- entitlements-manage; servis si svoje nároky může jen přečíst.
--
-- POZOR: schovat modul v UI nestačí. Kdo umí otevřít vývojářské nástroje,
-- zavolá edge funkci přímo. Proto se has_entitlement() kontroluje i na
-- serveru – viz sms-send a spol.

CREATE TABLE IF NOT EXISTS public.service_entitlements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  service_id uuid NOT NULL REFERENCES public.services(id) ON DELETE CASCADE,
  -- Strojový název modulu: 'sms', 'invoices', …
  module text NOT NULL,
  active boolean NOT NULL DEFAULT true,
  -- NULL = bez omezení. Jinak nárok po tomhle datu zaniká.
  valid_until timestamptz,
  -- Volitelná poznámka pro majitele (číslo objednávky, domluva…).
  note text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (service_id, module)
);

CREATE INDEX IF NOT EXISTS idx_service_entitlements_service
  ON public.service_entitlements (service_id);
CREATE INDEX IF NOT EXISTS idx_service_entitlements_module
  ON public.service_entitlements (module);

ALTER TABLE public.service_entitlements ENABLE ROW LEVEL SECURITY;

-- Členové servisu si svoje nároky mohou přečíst (UI podle toho skrývá moduly).
CREATE POLICY "service_entitlements_select_members"
  ON public.service_entitlements
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.service_memberships m
      WHERE m.service_id = service_entitlements.service_id
        AND m.user_id = auth.uid()
    )
  );

-- Zapisovat nesmí přes RLS nikdo. Uděluje jen majitel aplikace přes
-- Edge Function se service_role – stejný vzor jako u services-list.
CREATE POLICY "service_entitlements_no_write"
  ON public.service_entitlements
  FOR ALL
  TO authenticated
  USING (false)
  WITH CHECK (false);

COMMENT ON TABLE public.service_entitlements IS
  'Co má který servis zaplacené. Zapisuje jen Edge Function entitlements-manage (root owner).';

-- Jediné místo, kde se vyhodnocuje, jestli nárok platí.
-- SECURITY DEFINER, aby to šlo volat i z RLS politik jiných tabulek.
CREATE OR REPLACE FUNCTION public.has_entitlement(p_service_id uuid, p_module text)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.service_entitlements e
    WHERE e.service_id = p_service_id
      AND e.module = p_module
      AND e.active
      AND (e.valid_until IS NULL OR e.valid_until > now())
  );
$$;

COMMENT ON FUNCTION public.has_entitlement(uuid, text) IS
  'Má servis platný nárok na modul? Zohledňuje active i valid_until.';

-- ---------------------------------------------------------------------
-- Doplnění nároků existujícím servisům.
--
-- Bez tohohle by zavedení kontrol vyplo moduly všem, kdo je dnes používají.
-- Vychází se ze současného stavu:
--   sms      – servisy, které mají aktivní telefonní číslo
--   invoices – všechny, protože modul byl dosud zapnutý ve výchozím stavu
-- ---------------------------------------------------------------------

INSERT INTO public.service_entitlements (service_id, module, note)
SELECT DISTINCT p.service_id, 'sms', 'Doplněno při zavedení nároků – servis měl aktivní číslo'
FROM public.service_phone_numbers p
WHERE p.active
ON CONFLICT (service_id, module) DO NOTHING;

INSERT INTO public.service_entitlements (service_id, module, note)
SELECT s.id, 'invoices', 'Doplněno při zavedení nároků – modul byl zapnutý ve výchozím stavu'
FROM public.services s
ON CONFLICT (service_id, module) DO NOTHING;
