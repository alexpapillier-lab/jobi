-- Rezervace dílů ze zakázky (detail zakázky → Provedené opravy).
--
-- Oprava z ceníku má navázané produkty (repairs.product_ids). Když se oprava
-- přidá k zakázce, každý díl se zarezervuje (inventory_reservations, status
-- 'reserved'). Když zakázka přejde do koncového stavu, rezervace se odečtou
-- ze skladu (inventory_stock, status 'consumed'). Odebrání opravy nebo
-- smazání zakázky rezervaci uvolní ('released').
--
-- Sloupec repair_entry_id = `id` položky v tickets.performed_repairs, aby šlo
-- uvolnit rezervaci přesně té opravy, kterou uživatel odebral.
--
-- Součet inventory_products.stock dopočítává trigger trg_inventory_stock_dopocet
-- (viz 20260903200000_inventory_warehouses.sql); tady se zapisuje jen do
-- inventory_stock. Vše idempotentní, RPC jen pro členy servisu zakázky.

-- ========== 1) sloupec + index ==========

ALTER TABLE public.inventory_reservations
  ADD COLUMN IF NOT EXISTS repair_entry_id text;

COMMENT ON COLUMN public.inventory_reservations.repair_entry_id IS
  'Id položky v tickets.performed_repairs, ke které rezervace patří.';

CREATE INDEX IF NOT EXISTS idx_inventory_reservations_ticket_entry
  ON public.inventory_reservations(ticket_id, repair_entry_id);

-- ========== 2) RPC: rezervovat díly opravy ==========
-- Vloží jednu rezervaci na produkt. Produkty cizího servisu přeskočí, stejně
-- jako díl, který už je pro tuto opravu na zakázce rezervován (opakované
-- volání nic nezdvojí). Vrátí, co chybí: stock − součet rezervací < 0.

CREATE OR REPLACE FUNCTION public.inventory_reserve_for_repair(
  p_ticket_id uuid,
  p_repair_entry_id text,
  p_product_ids uuid[],
  p_qty integer DEFAULT 1
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_service_id uuid;
  v_qty integer := greatest(coalesce(p_qty, 1), 1);
  v_pid uuid;
  v_reserved integer := 0;
  v_shortages jsonb := '[]'::jsonb;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '42501';
  END IF;

  SELECT t.service_id INTO v_service_id
  FROM public.tickets t
  WHERE t.id = p_ticket_id AND t.deleted_at IS NULL;

  IF v_service_id IS NULL THEN
    RAISE EXCEPTION 'Zakázka nenalezena' USING ERRCODE = 'P0002';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.service_memberships m
    WHERE m.service_id = v_service_id AND m.user_id = v_uid
  ) THEN
    RAISE EXCEPTION 'Nemáte oprávnění k této zakázce' USING ERRCODE = '42501';
  END IF;

  IF p_product_ids IS NULL OR coalesce(array_length(p_product_ids, 1), 0) = 0 THEN
    RETURN jsonb_build_object('reserved', 0, 'shortages', v_shortages);
  END IF;

  FOR v_pid IN SELECT DISTINCT u FROM unnest(p_product_ids) AS u WHERE u IS NOT NULL LOOP
    -- Produkt musí patřit servisu zakázky.
    IF NOT EXISTS (
      SELECT 1 FROM public.inventory_products p
      WHERE p.id = v_pid AND p.service_id = v_service_id
    ) THEN
      CONTINUE;
    END IF;

    -- Stejná rezervace už existuje (opakované kliknutí, dva klienti).
    IF EXISTS (
      SELECT 1 FROM public.inventory_reservations r
      WHERE r.ticket_id = p_ticket_id
        AND r.product_id = v_pid
        AND r.status = 'reserved'
        AND r.repair_entry_id IS NOT DISTINCT FROM p_repair_entry_id
    ) THEN
      CONTINUE;
    END IF;

    INSERT INTO public.inventory_reservations (service_id, product_id, ticket_id, repair_entry_id, qty, status)
    VALUES (v_service_id, v_pid, p_ticket_id, p_repair_entry_id, v_qty, 'reserved');

    v_reserved := v_reserved + 1;
  END LOOP;

  -- Co není skladem: stav produktu minus všechny živé rezervace (všech zakázek).
  SELECT coalesce(jsonb_agg(jsonb_build_object(
           'product_id', p.id,
           'name', p.name,
           'stock', p.stock,
           'reserved_total', r.total
         ) ORDER BY p.name), '[]'::jsonb)
    INTO v_shortages
  FROM public.inventory_products p
  JOIN (
    SELECT res.product_id, sum(res.qty)::integer AS total
    FROM public.inventory_reservations res
    WHERE res.status = 'reserved'
      AND res.product_id = ANY (p_product_ids)
    GROUP BY res.product_id
  ) r ON r.product_id = p.id
  WHERE p.service_id = v_service_id
    AND p.stock - r.total < 0;

  RETURN jsonb_build_object('reserved', v_reserved, 'shortages', v_shortages);
END;
$$;

REVOKE ALL ON FUNCTION public.inventory_reserve_for_repair(uuid, text, uuid[], integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.inventory_reserve_for_repair(uuid, text, uuid[], integer) FROM anon;
GRANT EXECUTE ON FUNCTION public.inventory_reserve_for_repair(uuid, text, uuid[], integer) TO authenticated;

COMMENT ON FUNCTION public.inventory_reserve_for_repair(uuid, text, uuid[], integer) IS
  'Zarezervuje díly opravy pro zakázku (1 řádek na produkt). Vrací {reserved, shortages[]}. Jen členové servisu zakázky.';

-- ========== 3) RPC: uvolnit rezervace ==========
-- Odebrání opravy ze zakázky (s p_repair_entry_id) nebo smazání zakázky (bez).
-- Smazaná zakázka má deleted_at, proto se tu na něj nefiltruje.

CREATE OR REPLACE FUNCTION public.inventory_release_reservations(
  p_ticket_id uuid,
  p_repair_entry_id text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_service_id uuid;
  v_released integer := 0;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '42501';
  END IF;

  SELECT t.service_id INTO v_service_id
  FROM public.tickets t
  WHERE t.id = p_ticket_id;

  IF v_service_id IS NULL THEN
    RAISE EXCEPTION 'Zakázka nenalezena' USING ERRCODE = 'P0002';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.service_memberships m
    WHERE m.service_id = v_service_id AND m.user_id = v_uid
  ) THEN
    RAISE EXCEPTION 'Nemáte oprávnění k této zakázce' USING ERRCODE = '42501';
  END IF;

  UPDATE public.inventory_reservations r
     SET status = 'released'
   WHERE r.ticket_id = p_ticket_id
     AND r.status = 'reserved'
     AND (p_repair_entry_id IS NULL OR r.repair_entry_id = p_repair_entry_id);

  GET DIAGNOSTICS v_released = ROW_COUNT;

  RETURN jsonb_build_object('released', v_released);
END;
$$;

REVOKE ALL ON FUNCTION public.inventory_release_reservations(uuid, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.inventory_release_reservations(uuid, text) FROM anon;
GRANT EXECUTE ON FUNCTION public.inventory_release_reservations(uuid, text) TO authenticated;

COMMENT ON FUNCTION public.inventory_release_reservations(uuid, text) IS
  'Uvolní rezervace zakázky (volitelně jen jedné opravy). Vrací {released}. Jen členové servisu zakázky.';

-- ========== 4) RPC: odečíst rezervace zakázky ze skladu ==========
-- Volá se při přechodu zakázky do koncového stavu. Pro každou živou rezervaci
-- odečte kusy z inventory_stock – ve zvoleném skladu (musí patřit servisu),
-- jinak ve skladu s největší zásobou toho produktu, jinak v prvním skladu
-- servisu. Pod nulu nikdy nejde: odečte min(qty, k dispozici) a chybějící
-- kusy vrátí v shortages. Rezervace přejdou na 'consumed'. Jedna transakce.

CREATE OR REPLACE FUNCTION public.inventory_consume_ticket(
  p_ticket_id uuid,
  p_warehouse_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_service_id uuid;
  v_fixed_wh uuid := NULL;
  v_wh uuid;
  v_avail integer;
  v_take integer;
  v_consumed integer := 0;
  v_shortages jsonb := '[]'::jsonb;
  r record;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '42501';
  END IF;

  SELECT t.service_id INTO v_service_id
  FROM public.tickets t
  WHERE t.id = p_ticket_id;

  IF v_service_id IS NULL THEN
    RAISE EXCEPTION 'Zakázka nenalezena' USING ERRCODE = 'P0002';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.service_memberships m
    WHERE m.service_id = v_service_id AND m.user_id = v_uid
  ) THEN
    RAISE EXCEPTION 'Nemáte oprávnění k této zakázce' USING ERRCODE = '42501';
  END IF;

  IF p_warehouse_id IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.inventory_warehouses w
    WHERE w.id = p_warehouse_id AND w.service_id = v_service_id
  ) THEN
    v_fixed_wh := p_warehouse_id;
  END IF;

  FOR r IN
    SELECT res.id, res.product_id, res.qty, p.name
    FROM public.inventory_reservations res
    JOIN public.inventory_products p ON p.id = res.product_id
    WHERE res.ticket_id = p_ticket_id
      AND res.status = 'reserved'
    ORDER BY res.created_at, res.id
    FOR UPDATE OF res
  LOOP
    v_wh := v_fixed_wh;

    -- Sklad s největší zásobou tohoto produktu.
    IF v_wh IS NULL THEN
      SELECT s.warehouse_id INTO v_wh
      FROM public.inventory_stock s
      JOIN public.inventory_warehouses w ON w.id = s.warehouse_id
      WHERE s.product_id = r.product_id
        AND w.service_id = v_service_id
      ORDER BY s.quantity DESC, w.is_default DESC, w.order_index, w.created_at
      LIMIT 1;
    END IF;

    -- Produkt nemá záznam v žádném skladu → první sklad servisu.
    IF v_wh IS NULL THEN
      SELECT w.id INTO v_wh
      FROM public.inventory_warehouses w
      WHERE w.service_id = v_service_id
      ORDER BY w.is_default DESC, w.order_index, w.created_at
      LIMIT 1;
    END IF;

    v_avail := 0;
    IF v_wh IS NOT NULL THEN
      SELECT s.quantity INTO v_avail
      FROM public.inventory_stock s
      WHERE s.product_id = r.product_id AND s.warehouse_id = v_wh
      FOR UPDATE;
      v_avail := coalesce(v_avail, 0);
    END IF;

    v_take := least(r.qty, greatest(v_avail, 0));

    IF v_take > 0 THEN
      UPDATE public.inventory_stock s
         SET quantity = s.quantity - v_take,
             updated_at = now()
       WHERE s.product_id = r.product_id AND s.warehouse_id = v_wh;
    END IF;

    IF v_take < r.qty THEN
      v_shortages := v_shortages || jsonb_build_object(
        'product_id', r.product_id,
        'name', r.name,
        'requested', r.qty,
        'consumed', v_take,
        'missing', r.qty - v_take
      );
    END IF;

    UPDATE public.inventory_reservations
       SET status = 'consumed'
     WHERE id = r.id;

    v_consumed := v_consumed + 1;
  END LOOP;

  RETURN jsonb_build_object('consumed', v_consumed, 'shortages', v_shortages);
END;
$$;

REVOKE ALL ON FUNCTION public.inventory_consume_ticket(uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.inventory_consume_ticket(uuid, uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.inventory_consume_ticket(uuid, uuid) TO authenticated;

COMMENT ON FUNCTION public.inventory_consume_ticket(uuid, uuid) IS
  'Odečte živé rezervace zakázky ze skladu (nikdy pod nulu) a označí je consumed. Vrací {consumed, shortages[]}. Jen členové servisu zakázky.';

-- PostgREST si nové funkce načte do cache schématu.
NOTIFY pgrst, 'reload schema';
