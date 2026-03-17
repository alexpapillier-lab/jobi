-- Add capabilities column to service_memberships
-- Capabilities are stored as JSONB object with boolean values per capability key
-- Only members can have capabilities; owner/admin have all capabilities implicitly

-- Add capabilities column
ALTER TABLE public.service_memberships
  ADD COLUMN IF NOT EXISTS capabilities JSONB NOT NULL DEFAULT '{}'::jsonb;

-- Create GIN index on capabilities for efficient queries
CREATE INDEX IF NOT EXISTS idx_service_memberships_capabilities 
  ON public.service_memberships USING GIN (capabilities);

-- Helper function to check if user has a specific capability
-- Returns true for owner/admin, or checks capabilities JSONB for members
CREATE OR REPLACE FUNCTION public.has_capability(
  p_service_id uuid,
  p_user_id uuid,
  p_capability text
) RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
DECLARE
  v_role text;
  v_capabilities jsonb;
BEGIN
  -- Get role and capabilities for the user in the service
  SELECT role, capabilities
  INTO v_role, v_capabilities
  FROM public.service_memberships
  WHERE service_id = p_service_id
    AND user_id = p_user_id;

  -- If no membership found, return false
  IF v_role IS NULL THEN
    RETURN false;
  END IF;

  -- Owner and admin have all capabilities
  IF v_role IN ('owner', 'admin') THEN
    RETURN true;
  END IF;

  -- For members, check the capability in JSONB
  -- If capability is not present or false, return false
  RETURN COALESCE((v_capabilities->>p_capability)::boolean, false);
END;
$$;

-- Helper function to check if user has any of the specified capabilities
-- Returns true for owner/admin, or checks if any capability in array is true for members
CREATE OR REPLACE FUNCTION public.has_any_capability(
  p_service_id uuid,
  p_user_id uuid,
  p_capabilities text[]
) RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
DECLARE
  v_role text;
  v_member_capabilities jsonb;
  v_cap text;
BEGIN
  -- Get role and capabilities for the user in the service
  SELECT role, capabilities
  INTO v_role, v_member_capabilities
  FROM public.service_memberships
  WHERE service_id = p_service_id
    AND user_id = p_user_id;

  -- If no membership found, return false
  IF v_role IS NULL THEN
    RETURN false;
  END IF;

  -- Owner and admin have all capabilities
  IF v_role IN ('owner', 'admin') THEN
    RETURN true;
  END IF;

  -- For members, check if any capability in array is true
  FOREACH v_cap IN ARRAY p_capabilities
  LOOP
    IF COALESCE((v_member_capabilities->>v_cap)::boolean, false) THEN
      RETURN true;
    END IF;
  END LOOP;

  RETURN false;
END;
$$;

-- Revoke execute from public and anon
REVOKE EXECUTE ON FUNCTION public.has_capability(uuid, uuid, text) FROM public, anon;
REVOKE EXECUTE ON FUNCTION public.has_any_capability(uuid, uuid, text[]) FROM public, anon;

-- Grant execute to authenticated users
GRANT EXECUTE ON FUNCTION public.has_capability(uuid, uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.has_any_capability(uuid, uuid, text[]) TO authenticated;

-- Document v1 capability keys (informational comment, not enforcement)
COMMENT ON COLUMN public.service_memberships.capabilities IS 
'JSONB object storing capabilities for members. Keys (v1): can_manage_tickets_basic, can_change_ticket_status, can_manage_ticket_archive, can_manage_customers, can_manage_statuses, can_manage_documents, can_edit_devices, can_edit_inventory, can_edit_service_settings. Owner/admin have all capabilities implicitly.';



