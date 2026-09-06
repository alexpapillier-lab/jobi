-- Ukládání práv členů: sloučení místo náhrady a odolnost proti JSON null.
--
-- Dvě věci, které vyplynuly z revize předchozí migrace:
--
--   1) Zápis nahrazoval celý objekt `capabilities`. Opíralo se to o to, že
--      rozhraní posílá vždy všechny klíče. Jenže Jobi je desktopová aplikace,
--      kterou si zákazník aktualizuje sám – starší klient, který nový klíč
--      nezná, ho při prvním uložení práv tiše smazal. Nově se klíče slučují,
--      takže starý klient přepíše jen to, o čem ví. Odebrání práva funguje
--      dál: rozhraní posílá `false`, ne vynechaný klíč.
--
--   2) `(value::text)::boolean` na JSON hodnotě `null` nebo na řetězci
--      vyhodí výjimku (`'null'::boolean`), takže jediná taková hodnota
--      položila celé uložení práv. Nově se čte přes `#>> '{}'` a cokoli
--      jiného než `true` znamená `false`.
--
-- Prázdný objekt práv nově znamená „nic neměň“, ne „všechno seber“ – kdo
-- chce práva odebrat, pošle je s hodnotou `false`.

create or replace function public.set_member_capabilities(p_service_id uuid, p_user_id uuid, p_capabilities jsonb)
returns void
language plpgsql
security definer
set search_path = public
as $function$
DECLARE
  v_caller_role TEXT;
  v_target_role TEXT;
  v_allowed_keys TEXT[] := public.povolene_capability();
  v_key TEXT;
  v_nove jsonb;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  SELECT role INTO v_caller_role
  FROM public.service_memberships
  WHERE service_id = p_service_id AND user_id = auth.uid();

  IF v_caller_role IS NULL THEN
    RAISE EXCEPTION 'Not authorized: User is not a member of this service';
  END IF;

  IF v_caller_role NOT IN ('owner', 'admin') THEN
    RAISE EXCEPTION 'Not authorized: Only owner or admin can change member capabilities';
  END IF;

  SELECT role INTO v_target_role
  FROM public.service_memberships
  WHERE service_id = p_service_id AND user_id = p_user_id;

  IF v_target_role IS NULL THEN
    RAISE EXCEPTION 'Target user is not a member of this service';
  END IF;

  IF v_target_role = 'owner' THEN
    RAISE EXCEPTION 'Cannot change capabilities of owner';
  END IF;

  IF v_caller_role = 'admin' AND v_target_role != 'member' THEN
    RAISE EXCEPTION 'Not authorized: Admin can only change capabilities for members';
  END IF;

  FOR v_key IN SELECT jsonb_object_keys(p_capabilities)
  LOOP
    IF NOT (v_key = ANY(v_allowed_keys)) THEN
      RAISE EXCEPTION 'Neznámé oprávnění: %. Povolená: %', v_key, array_to_string(v_allowed_keys, ', ');
    END IF;
  END LOOP;

  SELECT COALESCE(jsonb_object_agg(key, (value #>> '{}') = 'true'), '{}'::jsonb)
    INTO v_nove
    FROM jsonb_each(p_capabilities)
   WHERE key = ANY(v_allowed_keys);

  UPDATE public.service_memberships
     SET capabilities = COALESCE(capabilities, '{}'::jsonb) || v_nove
   WHERE service_id = p_service_id
     AND user_id = p_user_id;
END;
$function$;

revoke all on function public.set_member_capabilities(uuid, uuid, jsonb) from public, anon;
grant execute on function public.set_member_capabilities(uuid, uuid, jsonb) to authenticated, service_role;
