-- RPC functions for soft delete and restore tickets
-- These functions enforce role-based authorization (owner/admin only)

-- Function: soft_delete_ticket
-- Sets deleted_at = now() for a ticket
-- Only owner/admin can call this
CREATE OR REPLACE FUNCTION public.soft_delete_ticket(p_ticket_id UUID)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_service_id UUID;
  v_user_role TEXT;
BEGIN
  -- Get ticket's service_id
  SELECT service_id INTO v_service_id
  FROM public.tickets
  WHERE id = p_ticket_id;
  
  IF v_service_id IS NULL THEN
    RAISE EXCEPTION 'Ticket not found';
  END IF;
  
  -- Check user is a member of the service
  SELECT role INTO v_user_role
  FROM public.service_memberships
  WHERE service_id = v_service_id
    AND user_id = auth.uid();
  
  IF v_user_role IS NULL THEN
    RAISE EXCEPTION 'Not authorized: user is not a member of this service';
  END IF;
  
  -- Check user is owner or admin
  IF v_user_role NOT IN ('owner', 'admin') THEN
    RAISE EXCEPTION 'Not authorized: only owner or admin can delete tickets';
  END IF;
  
  -- Perform soft delete
  UPDATE public.tickets
  SET deleted_at = now()
  WHERE id = p_ticket_id
    AND service_id = v_service_id;
  
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Ticket not found or update failed';
  END IF;
END;
$$;

-- Function: restore_ticket
-- Sets deleted_at = NULL for a ticket
-- Only owner/admin can call this
CREATE OR REPLACE FUNCTION public.restore_ticket(p_ticket_id UUID)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_service_id UUID;
  v_user_role TEXT;
BEGIN
  -- Get ticket's service_id
  SELECT service_id INTO v_service_id
  FROM public.tickets
  WHERE id = p_ticket_id;
  
  IF v_service_id IS NULL THEN
    RAISE EXCEPTION 'Ticket not found';
  END IF;
  
  -- Check user is a member of the service
  SELECT role INTO v_user_role
  FROM public.service_memberships
  WHERE service_id = v_service_id
    AND user_id = auth.uid();
  
  IF v_user_role IS NULL THEN
    RAISE EXCEPTION 'Not authorized: user is not a member of this service';
  END IF;
  
  -- Check user is owner or admin
  IF v_user_role NOT IN ('owner', 'admin') THEN
    RAISE EXCEPTION 'Not authorized: only owner or admin can restore tickets';
  END IF;
  
  -- Perform restore
  UPDATE public.tickets
  SET deleted_at = NULL
  WHERE id = p_ticket_id
    AND service_id = v_service_id;
  
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Ticket not found or update failed';
  END IF;
END;
$$;

-- Grant execute permissions to authenticated users
-- (RLS will still enforce service membership)
GRANT EXECUTE ON FUNCTION public.soft_delete_ticket(UUID) TO authenticated;

GRANT EXECUTE ON FUNCTION public.restore_ticket(UUID) TO authenticated;

