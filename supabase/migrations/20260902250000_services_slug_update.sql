-- Adresu ve veřejném API si nastavuje sám servis, stejně jako DPH.
-- Rozšiřuje se jen sloupcový GRANT; politika services_update_vat_members
-- z migrace 20260902240000 už řádky omezuje.
GRANT UPDATE (public_slug, inventory_availability_mode)
  ON public.services TO authenticated;
