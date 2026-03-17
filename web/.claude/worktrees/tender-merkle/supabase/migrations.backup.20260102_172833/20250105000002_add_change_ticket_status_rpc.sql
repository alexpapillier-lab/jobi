-- Migration: Add RPC function for changing ticket status with capability check
-- This migration adds change_ticket_status RPC function and updates RLS policy for status changes.

-- RPC function: Change ticket status with capability check
-- Only owner/admin or members with can_change_ticket_status capability can change status
CREATE OR REPLACE FUNCTION public.change_ticket_status(
  p_ticket_id UUID,
  p_next TEXT
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_ticket_service_id UUID;
  v_ticket_status TEXT;
  v_ticket_deleted_at TIMESTAMPTZ;
  v_user_role TEXT;
  v_user_id UUID;
BEGIN
  -- Get current user ID
  v_user_id := auth.uid();
  
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;
  
  -- Get ticket information
  SELECT service_id, status, deleted_at
  INTO v_ticket_service_id, v_ticket_status, v_ticket_deleted_at
  FROM public.tickets
  WHERE id = p_ticket_id;
  
  IF v_ticket_service_id IS NULL THEN
    RAISE EXCEPTION 'Ticket not found';
  END IF;
  
  -- Check if ticket is soft-deleted
  IF v_ticket_deleted_at IS NOT NULL THEN
    RAISE EXCEPTION 'Cannot change status of deleted ticket';
  END IF;
  
  -- Verify user is a member of the service
  SELECT role INTO v_user_role
  FROM public.service_memberships
  WHERE service_id = v_ticket_service_id
    AND user_id = v_user_id;
  
  IF v_user_role IS NULL THEN
    RAISE EXCEPTION 'Not authorized: User is not a member of this service';
  END IF;
  
  -- Owner and admin can always change status
  IF v_user_role IN ('owner', 'admin') THEN
    -- Proceed with update
  ELSIF v_user_role = 'member' THEN
    -- Member needs can_change_ticket_status capability
    IF NOT public.has_capability(v_ticket_service_id, v_user_id, 'can_change_ticket_status') THEN
      RAISE EXCEPTION 'Not authorized: Member does not have can_change_ticket_status capability';
    END IF;
  ELSE
    RAISE EXCEPTION 'Not authorized: Invalid role';
  END IF;
  
  -- Perform status update
  UPDATE public.tickets
  SET status = p_next
  WHERE id = p_ticket_id
    AND service_id = v_ticket_service_id;
  
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Ticket not found or update failed';
  END IF;
END;
$$;

-- Revoke all permissions from public
REVOKE ALL ON FUNCTION public.change_ticket_status(UUID, TEXT) FROM PUBLIC;

-- Grant execute permission to authenticated users
GRANT EXECUTE ON FUNCTION public.change_ticket_status(UUID, TEXT) TO authenticated;

-- Update RLS policy for tickets UPDATE
-- Restore simple membership-only UPDATE policy
-- Status changes will be enforced by trigger (see below)
DROP POLICY IF EXISTS "Service members can update tickets" ON public.tickets;
DROP POLICY IF EXISTS "Members can update tickets" ON public.tickets;
DROP POLICY IF EXISTS "tickets_update_policy" ON public.tickets;
DROP POLICY IF EXISTS "Service members can update tickets with status capability check" ON public.tickets;

CREATE POLICY "Service members can update tickets"
  ON public.tickets
  FOR UPDATE
  USING (
    EXISTS (
      SELECT 1
      FROM public.service_memberships sm
      WHERE sm.service_id = tickets.service_id
        AND sm.user_id = auth.uid()
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM public.service_memberships sm
      WHERE sm.service_id = tickets.service_id
        AND sm.user_id = auth.uid()
    )
  );

-- Create trigger function to enforce status change permissions
CREATE OR REPLACE FUNCTION public.enforce_ticket_status_change_permissions()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_role text;
BEGIN
  -- Only enforce when status is changing
  IF NEW.status IS DISTINCT FROM OLD.status THEN
    SELECT sm.role INTO v_role
    FROM public.service_memberships sm
    WHERE sm.service_id = NEW.service_id
      AND sm.user_id = auth.uid()
    LIMIT 1;

    IF v_role IS NULL THEN
      RAISE EXCEPTION 'Not authorized: not a service member';
    END IF;

    IF v_role IN ('owner', 'admin')
       OR public.has_capability(NEW.service_id, auth.uid(), 'can_change_ticket_status')
    THEN
      RETURN NEW;
    END IF;

    RAISE EXCEPTION 'Not authorized: missing can_change_ticket_status';
  END IF;

  RETURN NEW;
END;
$$;

-- Create trigger for status change enforcement
DROP TRIGGER IF EXISTS trg_enforce_ticket_status_change_permissions ON public.tickets;

CREATE TRIGGER trg_enforce_ticket_status_change_permissions
BEFORE UPDATE OF status ON public.tickets
FOR EACH ROW
EXECUTE FUNCTION public.enforce_ticket_status_change_permissions();

