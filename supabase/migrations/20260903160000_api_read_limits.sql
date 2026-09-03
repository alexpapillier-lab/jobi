-- Limity čtení a přehled využití veřejného API.
--
-- Počítá se jen to, co se ke funkci opravdu dostane. Odpovědi mají
-- Cache-Control: max-age=300 a ETag, takže opakované dotazy z jedné
-- stránky sem nedojdou – čísla ukazují skutečná volání, ne návštěvnost.
--
-- Limity podle docs/ZADANI_API.md:
--   čtení na IP     60/min
--   čtení na servis 600/min
CREATE TABLE IF NOT EXISTS public.api_read_hits (
  service_id uuid NOT NULL REFERENCES public.services(id) ON DELETE CASCADE,
  -- prázdný řetězec = souhrn za servis, jinak otisk IP
  klic text NOT NULL,
  minuta timestamptz NOT NULL,
  endpoint text NOT NULL,
  pocet integer NOT NULL DEFAULT 0,
  PRIMARY KEY (service_id, klic, minuta, endpoint)
);

COMMENT ON TABLE public.api_read_hits IS
  'Počet čtení veřejného API po minutách. Slouží k limitům i k přehledu využití. IP se ukládá jen jako otisk.';

CREATE INDEX IF NOT EXISTS idx_api_read_hits_minuta ON public.api_read_hits (minuta);
CREATE INDEX IF NOT EXISTS idx_api_read_hits_servis ON public.api_read_hits (service_id, minuta);

ALTER TABLE public.api_read_hits ENABLE ROW LEVEL SECURITY;

-- Přehled vidí členové servisu. Jsou to jejich vlastní čísla.
DROP POLICY IF EXISTS "api_read_hits_select_members" ON public.api_read_hits;
CREATE POLICY "api_read_hits_select_members"
  ON public.api_read_hits FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.service_memberships m
      WHERE m.service_id = api_read_hits.service_id AND m.user_id = auth.uid()
    )
  );

-- Jedno volání započítá dotaz na servis i na IP a rovnou vrátí obě čísla.
-- Dva samostatné dotazy by šly obejít souběhem.
CREATE OR REPLACE FUNCTION public.api_zapocitej_cteni(
  p_service_id uuid,
  p_klic text,
  p_endpoint text
)
RETURNS TABLE (za_servis integer, za_klic integer)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_minuta timestamptz := date_trunc('minute', now());
  v_servis integer;
  v_klic integer;
BEGIN
  INSERT INTO public.api_read_hits (service_id, klic, minuta, endpoint, pocet)
  VALUES (p_service_id, '', v_minuta, p_endpoint, 1)
  ON CONFLICT (service_id, klic, minuta, endpoint)
  DO UPDATE SET pocet = public.api_read_hits.pocet + 1
  RETURNING pocet INTO v_servis;

  INSERT INTO public.api_read_hits (service_id, klic, minuta, endpoint, pocet)
  VALUES (p_service_id, p_klic, v_minuta, p_endpoint, 1)
  ON CONFLICT (service_id, klic, minuta, endpoint)
  DO UPDATE SET pocet = public.api_read_hits.pocet + 1
  RETURNING pocet INTO v_klic;

  RETURN QUERY SELECT v_servis, v_klic;
END;
$$;

REVOKE ALL ON FUNCTION public.api_zapocitej_cteni(uuid, text, text) FROM public, anon, authenticated;

-- Úklid. Bez něj tabulka roste donekonečna; na limity stačí pár minut,
-- na přehled 30 dní.
CREATE OR REPLACE FUNCTION public.api_uklid_starych_zaznamu()
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  DELETE FROM public.api_read_hits WHERE minuta < now() - interval '30 days';
  DELETE FROM public.api_write_hits WHERE minuta < now() - interval '2 days';
  DELETE FROM public.api_idempotency WHERE created_at < now() - interval '24 hours';
$$;

REVOKE ALL ON FUNCTION public.api_uklid_starych_zaznamu() FROM public, anon, authenticated;
