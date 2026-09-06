-- Skladové RPC funkce respektují pobočku.
--
-- `inventory_reserve_for_repair`, `inventory_release_reservations`
-- a `inventory_consume_ticket` běží jako `security definer`, takže obcházejí
-- RLS, a kontrolovaly jen členství v servisu. Člen omezený na jednu pobočku
-- si tak mohl na cizí pobočkové zakázce rezervovat díly, cizí rezervace
-- zrušit (sabotáž) nebo na ni odepsat sklad – přestože tu zakázku vůbec
-- nevidí. `ensure_portal_token` tuhle kontrolu má a je pokrytá sondou 311.
--
-- Přidává se i kontrola práva na sklad. Dosud ji držel jen vedlejší efekt:
-- přepočet souhrnu produktu spustí trigger, který právo vyžaduje. Ochrana
-- postavená na vedlejším efektu vydrží jen do první změny přepočtu.
--
-- Funkce se tu nepřepisují celé; jen se do nich vloží kontrola hned za
-- ověření členství, aby zůstalo všechno ostatní beze změny.

create or replace function public.kontrola_pobocky_zakazky(p_ticket_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_service_id uuid;
  v_branch_id uuid;
begin
  select t.service_id, t.branch_id into v_service_id, v_branch_id
  from public.tickets t where t.id = p_ticket_id;
  if v_service_id is null then
    raise exception 'Zakázka nenalezena' using errcode = 'P0002';
  end if;
  if not public.pobocka_povolena(v_service_id, v_branch_id) then
    raise exception 'Zakázka patří jiné pobočce.' using errcode = '42501';
  end if;
end;
$$;

revoke all on function public.kontrola_pobocky_zakazky(uuid) from public, anon;
grant execute on function public.kontrola_pobocky_zakazky(uuid) to authenticated, service_role;

create or replace function public.inventory_release_reservations(p_ticket_id uuid, p_repair_entry_id text default null::text)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
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

  PERFORM public.kontrola_pobocky_zakazky(p_ticket_id);

  UPDATE public.inventory_reservations r
     SET status = 'released'
   WHERE r.ticket_id = p_ticket_id
     AND r.status = 'reserved'
     AND (p_repair_entry_id IS NULL OR r.repair_entry_id = p_repair_entry_id);

  GET DIAGNOSTICS v_released = ROW_COUNT;

  RETURN jsonb_build_object('released', v_released);
END;
$function$;

CREATE OR REPLACE FUNCTION public.inventory_reserve_for_repair(p_ticket_id uuid, p_repair_entry_id text, p_product_ids uuid[], p_qty integer DEFAULT 1)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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

  -- Pobočka: zakázka z cizí pobočky se nesmí obsloužit ani přes RPC.
  PERFORM public.kontrola_pobocky_zakazky(p_ticket_id);

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
$function$;

CREATE OR REPLACE FUNCTION public.inventory_consume_ticket(p_ticket_id uuid, p_warehouse_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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

  -- Pobočka: zakázka z cizí pobočky se nesmí obsloužit ani přes RPC.
  PERFORM public.kontrola_pobocky_zakazky(p_ticket_id);

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
$function$;
