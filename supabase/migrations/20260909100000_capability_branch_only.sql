-- Majitel servisu nemohl uložit práva členů.
--
-- Když přibyla pobočková práva, dostal seznam v rozhraní (a v edge funkci
-- team-set-capabilities) klíč `branch_only`, ale bílá listina uvnitř
-- set_member_capabilities se nerozšířila. Funkce proto při každém uložení
-- skončila výjimkou „Invalid capability key: branch_only" – a protože
-- rozhraní posílá vždy všechny klíče najednou, nešlo uložit vůbec nic.
-- Root owner to nepocítil, ten jde přes edge funkci; každý zákaznický
-- majitel a admin ano.
--
-- Aby se to nestalo znovu, je seznam nově jen na jednom místě: funkce
-- povolene_capability(). Kdo přidá klíč, přidá ho tam a hotovo.

create or replace function public.povolene_capability()
returns text[]
language sql
immutable
set search_path = public
as $$
  select array[
    'can_manage_tickets_basic',
    'can_change_ticket_status',
    'can_delete_tickets',
    'can_manage_ticket_archive',
    'can_manage_customers',
    'can_manage_statuses',
    'can_manage_documents',
    'can_print_export',
    'can_edit_devices',
    'can_edit_inventory',
    'can_adjust_inventory_quantity',
    'can_edit_service_settings',
    'branch_only'
  ]::text[];
$$;

revoke all on function public.povolene_capability() from public, anon;
grant execute on function public.povolene_capability() to authenticated, service_role;

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
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  SELECT role INTO v_caller_role
  FROM public.service_memberships
  WHERE service_id = p_service_id
    AND user_id = auth.uid();

  IF v_caller_role IS NULL THEN
    RAISE EXCEPTION 'Not authorized: User is not a member of this service';
  END IF;

  IF v_caller_role NOT IN ('owner', 'admin') THEN
    RAISE EXCEPTION 'Not authorized: Only owner or admin can change member capabilities';
  END IF;

  SELECT role INTO v_target_role
  FROM public.service_memberships
  WHERE service_id = p_service_id
    AND user_id = p_user_id;

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

  UPDATE public.service_memberships
  SET capabilities = COALESCE(
    (
      SELECT jsonb_object_agg(key, COALESCE((value::text)::boolean, false))
      FROM jsonb_each(p_capabilities)
      WHERE key = ANY(v_allowed_keys)
    ),
    '{}'::jsonb
  )
  WHERE service_id = p_service_id
    AND user_id = p_user_id;
END;
$function$;

revoke all on function public.set_member_capabilities(uuid, uuid, jsonb) from public, anon;
grant execute on function public.set_member_capabilities(uuid, uuid, jsonb) to authenticated, service_role;
