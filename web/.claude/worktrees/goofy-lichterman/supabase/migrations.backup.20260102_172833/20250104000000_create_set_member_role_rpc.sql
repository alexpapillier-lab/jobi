-- RPC function to set member role
-- Only owner (or admin if desired) can change roles
-- Prevents changing owner role

CREATE OR REPLACE FUNCTION public.set_member_role(
  p_service_id UUID,
  p_user_id UUID,
  p_role TEXT
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_caller_role TEXT;
  v_target_role TEXT;
  v_owner_count INTEGER;
BEGIN
  -- Validate role
  IF p_role NOT IN ('owner', 'admin', 'member') THEN
    RAISE EXCEPTION 'Invalid role. Must be owner, admin, or member.';
  END IF;

  -- Get caller's role
  SELECT role INTO v_caller_role
  FROM public.service_memberships
  WHERE service_id = p_service_id
    AND user_id = auth.uid();

  IF v_caller_role IS NULL THEN
    RAISE EXCEPTION 'Not authorized: User is not a member of this service.';
  END IF;

  -- Only owner can change roles (or admin if desired - currently only owner)
  IF v_caller_role != 'owner' THEN
    RAISE EXCEPTION 'Not authorized: Only owner can change member roles.';
  END IF;

  -- Get target user's current role
  SELECT role INTO v_target_role
  FROM public.service_memberships
  WHERE service_id = p_service_id
    AND user_id = p_user_id;

  IF v_target_role IS NULL THEN
    RAISE EXCEPTION 'Target user is not a member of this service.';
  END IF;

  -- Prevent changing owner role
  IF v_target_role = 'owner' THEN
    RAISE EXCEPTION 'Cannot change role of owner.';
  END IF;

  -- Prevent downgrading last owner (if trying to change someone to non-owner and they're the only owner)
  IF v_target_role = 'owner' AND p_role != 'owner' THEN
    SELECT COUNT(*) INTO v_owner_count
    FROM public.service_memberships
    WHERE service_id = p_service_id
      AND role = 'owner';

    IF v_owner_count <= 1 THEN
      RAISE EXCEPTION 'Cannot remove the last owner.';
    END IF;
  END IF;

  -- Update the role
  UPDATE public.service_memberships
  SET role = p_role
  WHERE service_id = p_service_id
    AND user_id = p_user_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Failed to update member role.';
  END IF;
END;
$$;

-- Revoke execute permission from public and anon (security)
REVOKE EXECUTE ON FUNCTION public.set_member_role(UUID, UUID, TEXT) FROM public, anon;

-- Grant execute permission to authenticated users only
GRANT EXECUTE ON FUNCTION public.set_member_role(UUID, UUID, TEXT) TO authenticated;

