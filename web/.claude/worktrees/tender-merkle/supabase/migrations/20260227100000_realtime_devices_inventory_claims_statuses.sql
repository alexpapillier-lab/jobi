-- Povolit Realtime (postgres_changes) pro zařízení, sklad, reklamace a statusy.
-- Pokud tabulka už v supabase_realtime je, příkaz selže – v tom případě ji přeskočíme.

DO $$
BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.device_brands;
EXCEPTION WHEN OTHERS THEN
  IF SQLERRM NOT LIKE '%already member%' THEN RAISE; END IF;
END $$;

DO $$
BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.device_categories;
EXCEPTION WHEN OTHERS THEN
  IF SQLERRM NOT LIKE '%already member%' THEN RAISE; END IF;
END $$;

DO $$
BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.device_models;
EXCEPTION WHEN OTHERS THEN
  IF SQLERRM NOT LIKE '%already member%' THEN RAISE; END IF;
END $$;

DO $$
BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.repairs;
EXCEPTION WHEN OTHERS THEN
  IF SQLERRM NOT LIKE '%already member%' THEN RAISE; END IF;
END $$;

DO $$
BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.inventory_product_categories;
EXCEPTION WHEN OTHERS THEN
  IF SQLERRM NOT LIKE '%already member%' THEN RAISE; END IF;
END $$;

DO $$
BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.inventory_products;
EXCEPTION WHEN OTHERS THEN
  IF SQLERRM NOT LIKE '%already member%' THEN RAISE; END IF;
END $$;

DO $$
BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.warranty_claims;
EXCEPTION WHEN OTHERS THEN
  IF SQLERRM NOT LIKE '%already member%' THEN RAISE; END IF;
END $$;

DO $$
BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.service_statuses;
EXCEPTION WHEN OTHERS THEN
  IF SQLERRM NOT LIKE '%already member%' THEN RAISE; END IF;
END $$;
