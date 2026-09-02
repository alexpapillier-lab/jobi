-- Nastavení DPH si spravuje sám servis, ne root owner.
--
-- Na services dosud nebyla žádná UPDATE politika – měnit je šlo jen přes
-- edge funkci service-manage, která je určená ownerovi (přejmenování,
-- deaktivace). To je pro DPH špatně: jestli je servis plátce, ví jen on.
--
-- RLS neumí omezit sloupce, proto se povolení skládá ze dvou částí:
-- politika řekne KTERÉ ŘÁDKY, sloupcový GRANT řekne KTERÉ SLOUPCE.
-- Bez toho grantu by členové mohli přepsat i název nebo příznak active.

DROP POLICY IF EXISTS "services_update_vat_members" ON public.services;
CREATE POLICY "services_update_vat_members"
  ON public.services FOR UPDATE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.service_memberships m
      WHERE m.service_id = services.id AND m.user_id = auth.uid()
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.service_memberships m
      WHERE m.service_id = services.id AND m.user_id = auth.uid()
    )
  );

REVOKE UPDATE ON public.services FROM authenticated;
GRANT UPDATE (vat_payer, default_vat_rate, prices_include_vat)
  ON public.services TO authenticated;

COMMENT ON POLICY "services_update_vat_members" ON public.services IS
  'Členové mění jen nastavení DPH – rozsah sloupců hlídá GRANT, ne tahle politika.';
