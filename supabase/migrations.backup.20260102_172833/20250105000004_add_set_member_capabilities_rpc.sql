-- RPC function to set member capabilities
-- Owner can always set capabilities
-- Admin can set capabilities for members only
-- Cannot change capabilities for admins/owners
-- Whitelists capability keys
-- Replaces capabilities (does not merge)

CREATE OR REPLACE FUNCTION public.set_member_capabilities(
  p_service_id uuid,
  p_user_id uuid,
  p_capabilities jsonb
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caller_id uuid;
  v_caller_role text;
  v_target_role text;
  v_allowed_keys jsonb;
  v_filtered_capabilities jsonb;
  v_key text;
BEGIN
  -- Get current user ID
  v_caller_id := auth.uid();
  
  IF v_caller_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  -- Get caller's role
  SELECT role INTO v_caller_role
  FROM public.service_memberships
  WHERE service_id = p_service_id
    AND user_id = v_caller_id;

  IF v_caller_role IS NULL THEN
    RAISE EXCEPTION 'Not a member of this service';
  END IF;

  -- Only owner can set capabilities
  IF v_caller_role != 'owner' THEN
    RAISE EXCEPTION 'Only owner can set member capabilities';
  END IF;

  -- Get target user's role
  SELECT role INTO v_target_role
  FROM public.service_memberships
  WHERE service_id = p_service_id
    AND user_id = p_user_id;

  IF v_target_role IS NULL THEN
    RAISE EXCEPTION 'Target user is not a member of this service';
  END IF;

  -- Cannot change capabilities for admins/owners
  IF v_target_role IN ('owner', 'admin') THEN
    RAISE EXCEPTION 'Cannot change capabilities for owners or admins';
  END IF;

  -- Whitelist allowed capability keys (v1 keys)
  v_allowed_keys := '[
    "can_manage_tickets_basic",
    "can_change_ticket_status",
    "can_manage_ticket_archive",
    "can_manage_customers",
    "can_manage_statuses",
    "can_manage_documents",
    "can_edit_devices",
    "can_edit_inventory",
    "can_edit_service_settings"
  ]'::jsonb;

  -- Filter and validate capabilities
  v_filtered_capabilities := '{}'::jsonb;
  
  FOR v_key IN SELECT jsonb_array_elements_text(v_allowed_keys)
  LOOP
    IF p_capabilities ? v_key THEN
      -- Only allow boolean values
      IF jsonb_typeof(p_capabilities->v_key) = 'boolean' THEN
        v_filtered_capabilities := v_filtered_capabilities || jsonb_build_object(v_key, (p_capabilities->>v_key)::boolean);
      END IF;
    END IF;
  END LOOP;

  -- Replace capabilities (not merge)
  UPDATE public.service_memberships
  SET capabilities = v_filtered_capabilities
  WHERE service_id = p_service_id
    AND user_id = p_user_id;
END;
$$;

-- Revoke execute from public and anon
REVOKE EXECUTE ON FUNCTION public.set_member_capabilities(uuid, uuid, jsonb) FROM public, anon;

-- Grant execute to authenticated users
GRANT EXECUTE ON FUNCTION public.set_member_capabilities(uuid, uuid, jsonb) TO authenticated;



