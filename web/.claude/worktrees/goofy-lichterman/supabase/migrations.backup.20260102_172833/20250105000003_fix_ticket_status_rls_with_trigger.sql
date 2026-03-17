-- Trigger to enforce ticket status change permissions
-- This trigger runs BEFORE UPDATE OF status on tickets
-- It checks capabilities for status changes, allowing regular updates for members

-- Create trigger function
CREATE OR REPLACE FUNCTION public.enforce_ticket_status_change_permissions()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caller_id uuid;
  v_caller_role text;
  v_has_capability boolean;
BEGIN
  -- Get current user ID
  v_caller_id := auth.uid();
  
  IF v_caller_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  -- If status is not changing, allow the update (members can update other fields)
  IF NEW.status IS NOT DISTINCT FROM OLD.status THEN
    RETURN NEW;
  END IF;

  -- Status is changing - check permissions
  -- Get caller's role
  SELECT role INTO v_caller_role
  FROM public.service_memberships
  WHERE service_id = NEW.service_id
    AND user_id = v_caller_id;

  IF v_caller_role IS NULL THEN
    RAISE EXCEPTION 'Not a member of this service';
  END IF;

  -- Owner and admin can always change status
  IF v_caller_role IN ('owner', 'admin') THEN
    RETURN NEW;
  END IF;

  -- For members, check capability
  SELECT public.has_capability(NEW.service_id, v_caller_id, 'can_change_ticket_status')
  INTO v_has_capability;

  IF NOT v_has_capability THEN
    RAISE EXCEPTION 'Not authorized: missing can_change_ticket_status capability';
  END IF;

  RETURN NEW;
END;
$$;

-- Drop trigger if it exists
DROP TRIGGER IF EXISTS trg_enforce_ticket_status_change_permissions ON public.tickets;

-- Create trigger
CREATE TRIGGER trg_enforce_ticket_status_change_permissions
  BEFORE UPDATE OF status ON public.tickets
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_ticket_status_change_permissions();

-- Note: RLS UPDATE policy on tickets should allow regular membership-based updates
-- This trigger only enforces capability check when status is changing



