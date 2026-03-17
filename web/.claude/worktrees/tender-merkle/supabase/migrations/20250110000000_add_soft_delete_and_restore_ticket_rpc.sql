-- Migration: Add RPC functions for soft delete and restore tickets
-- These functions enforce owner/admin permissions for destructive operations

-- 1. RPC function: Soft delete ticket
-- Sets deleted_at = now() for a ticket
-- Only owner/admin can soft delete tickets
CREATE OR REPLACE FUNCTION public.soft_delete_ticket(
  p_ticket_id UUID
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_ticket_service_id UUID;
  v_user_role TEXT;
  v_user_id UUID;
BEGIN
  -- Get current user ID
  v_user_id := auth.uid();
  
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;
  
  -- Get ticket information
  SELECT service_id
  INTO v_ticket_service_id
  FROM public.tickets
  WHERE id = p_ticket_id;
  
  IF v_ticket_service_id IS NULL THEN
    RAISE EXCEPTION 'Ticket not found';
  END IF;
  
  -- Verify user is a member of the service
  SELECT role INTO v_user_role
  FROM public.service_memberships
  WHERE service_id = v_ticket_service_id
    AND user_id = v_user_id;
  
  IF v_user_role IS NULL THEN
    RAISE EXCEPTION 'Not authorized: User is not a member of this service';
  END IF;
  
  -- Only owner and admin can soft delete tickets
  IF v_user_role NOT IN ('owner', 'admin') THEN
    RAISE EXCEPTION 'Not authorized: Only owner or admin can delete tickets';
  END IF;
  
  -- Perform soft delete (set deleted_at = now())
  UPDATE public.tickets
  SET deleted_at = now()
  WHERE id = p_ticket_id
    AND service_id = v_ticket_service_id;
  
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Ticket not found or update failed';
  END IF;
END;
$$;

-- 2. RPC function: Restore ticket
-- Sets deleted_at = NULL for a soft-deleted ticket
-- Only owner/admin can restore tickets
CREATE OR REPLACE FUNCTION public.restore_ticket(
  p_ticket_id UUID
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_ticket_service_id UUID;
  v_user_role TEXT;
  v_user_id UUID;
BEGIN
  -- Get current user ID
  v_user_id := auth.uid();
  
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;
  
  -- Get ticket information
  SELECT service_id
  INTO v_ticket_service_id
  FROM public.tickets
  WHERE id = p_ticket_id;
  
  IF v_ticket_service_id IS NULL THEN
    RAISE EXCEPTION 'Ticket not found';
  END IF;
  
  -- Verify user is a member of the service
  SELECT role INTO v_user_role
  FROM public.service_memberships
  WHERE service_id = v_ticket_service_id
    AND user_id = v_user_id;
  
  IF v_user_role IS NULL THEN
    RAISE EXCEPTION 'Not authorized: User is not a member of this service';
  END IF;
  
  -- Only owner and admin can restore tickets
  IF v_user_role NOT IN ('owner', 'admin') THEN
    RAISE EXCEPTION 'Not authorized: Only owner or admin can restore tickets';
  END IF;
  
  -- Perform restore (set deleted_at = NULL)
  UPDATE public.tickets
  SET deleted_at = NULL
  WHERE id = p_ticket_id
    AND service_id = v_ticket_service_id;
  
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Ticket not found or update failed';
  END IF;
END;
$$;

-- Revoke all permissions from public
REVOKE ALL ON FUNCTION public.soft_delete_ticket(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.restore_ticket(UUID) FROM PUBLIC;

-- Grant execute permission to authenticated users
GRANT EXECUTE ON FUNCTION public.soft_delete_ticket(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.restore_ticket(UUID) TO authenticated;

-- Add comments for documentation
COMMENT ON FUNCTION public.soft_delete_ticket(UUID) IS 
  'Soft deletes a ticket by setting deleted_at = now(). Only owner or admin can perform this operation.';
COMMENT ON FUNCTION public.restore_ticket(UUID) IS 
  'Restores a soft-deleted ticket by setting deleted_at = NULL. Only owner or admin can perform this operation.';


