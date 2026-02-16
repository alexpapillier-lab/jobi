-- New capability keys: can_delete_tickets, can_adjust_inventory_quantity, can_print_export
-- Extend set_member_capabilities whitelist and soft_delete_ticket logic

-- 1) set_member_capabilities: add new keys to whitelist
CREATE OR REPLACE FUNCTION public.set_member_capabilities(p_service_id uuid, p_user_id uuid, p_capabilities jsonb)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_caller_role TEXT;
  v_target_role TEXT;
  v_allowed_keys TEXT[] := ARRAY[
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
    'can_edit_service_settings'
  ];
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
      RAISE EXCEPTION 'Invalid capability key: %. Allowed keys: %', v_key, array_to_string(v_allowed_keys, ', ');
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

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Failed to update member capabilities';
  END IF;
END;
$function$;

-- 2) soft_delete_ticket: member needs can_delete_tickets OR can_manage_ticket_archive
CREATE OR REPLACE FUNCTION public.soft_delete_ticket(p_ticket_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_service_id UUID;
  v_user_id UUID;
  v_user_role TEXT;
BEGIN
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  SELECT service_id INTO v_service_id
  FROM public.tickets
  WHERE id = p_ticket_id;

  IF v_service_id IS NULL THEN
    RAISE EXCEPTION 'Ticket not found';
  END IF;

  SELECT role INTO v_user_role
  FROM public.service_memberships
  WHERE service_id = v_service_id
    AND user_id = v_user_id;

  IF v_user_role IS NULL THEN
    RAISE EXCEPTION 'Not authorized: user is not a member of this service';
  END IF;

  IF v_user_role IN ('owner', 'admin') THEN
    NULL;
  ELSIF v_user_role = 'member' THEN
    IF NOT (public.has_capability(v_service_id, v_user_id, 'can_delete_tickets')
             OR public.has_capability(v_service_id, v_user_id, 'can_manage_ticket_archive')) THEN
      RAISE EXCEPTION 'Not authorized: member needs can_delete_tickets or can_manage_ticket_archive to delete tickets';
    END IF;
  ELSE
    RAISE EXCEPTION 'Not authorized: invalid role';
  END IF;

  UPDATE public.tickets
  SET deleted_at = now()
  WHERE id = p_ticket_id
    AND service_id = v_service_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Ticket not found or update failed';
  END IF;
END;
$function$;
