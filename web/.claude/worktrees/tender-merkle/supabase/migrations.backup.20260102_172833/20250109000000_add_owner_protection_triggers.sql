-- Migration: Add triggers to prevent root owner change and last owner removal
-- These triggers enforce business rules at the database level, not just in RPC functions

-- 1. Trigger function: Prevent changing owner role
-- This blocks UPDATE that would change a user's role FROM 'owner' to something else
CREATE OR REPLACE FUNCTION public.prevent_root_owner_change()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- If old role was 'owner' and new role is not 'owner', block it
  IF OLD.role = 'owner' AND NEW.role != 'owner' THEN
    RAISE EXCEPTION 'Cannot change role of owner.';
  END IF;
  
  RETURN NEW;
END;
$$;

-- 2. Trigger function: Prevent removing the last owner
-- This blocks DELETE or UPDATE that would leave a service without any owner
CREATE OR REPLACE FUNCTION public.prevent_last_owner_removal()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_owner_count INTEGER;
  v_service_id UUID;
BEGIN
  -- Determine service_id from the row being deleted/updated
  IF TG_OP = 'DELETE' THEN
    v_service_id := OLD.service_id;
  ELSE
    v_service_id := NEW.service_id;
  END IF;
  
  -- If this is a DELETE and the row being deleted is an owner
  IF TG_OP = 'DELETE' AND OLD.role = 'owner' THEN
    -- Count owners for this service (including the one being deleted, since this is BEFORE DELETE)
    SELECT COUNT(*) INTO v_owner_count
    FROM public.service_memberships
    WHERE service_id = v_service_id
      AND role = 'owner';
    
    -- If this is the only owner, block the deletion
    IF v_owner_count <= 1 THEN
      RAISE EXCEPTION 'Cannot remove the last owner. Service must have at least one owner.';
    END IF;
  END IF;
  
  -- If this is an UPDATE and the role is being changed from 'owner' to something else
  IF TG_OP = 'UPDATE' AND OLD.role = 'owner' AND NEW.role != 'owner' THEN
    -- Count owners for this service (including the one being changed, since this is BEFORE UPDATE)
    SELECT COUNT(*) INTO v_owner_count
    FROM public.service_memberships
    WHERE service_id = v_service_id
      AND role = 'owner';
    
    -- If this is the only owner, block the change
    IF v_owner_count <= 1 THEN
      RAISE EXCEPTION 'Cannot remove the last owner. Service must have at least one owner.';
    END IF;
  END IF;
  
  RETURN COALESCE(NEW, OLD);
END;
$$;

-- 3. Create trigger to prevent root owner change (BEFORE UPDATE)
DROP TRIGGER IF EXISTS trg_prevent_root_owner_change ON public.service_memberships;
CREATE TRIGGER trg_prevent_root_owner_change
  BEFORE UPDATE ON public.service_memberships
  FOR EACH ROW
  EXECUTE FUNCTION public.prevent_root_owner_change();

-- 4. Create trigger to prevent last owner removal (BEFORE DELETE and BEFORE UPDATE)
DROP TRIGGER IF EXISTS trg_prevent_last_owner_removal ON public.service_memberships;
CREATE TRIGGER trg_prevent_last_owner_removal
  BEFORE DELETE OR UPDATE ON public.service_memberships
  FOR EACH ROW
  EXECUTE FUNCTION public.prevent_last_owner_removal();

-- Add comments for documentation
COMMENT ON FUNCTION public.prevent_root_owner_change() IS 
  'Trigger function that prevents changing the role of an owner. Owners cannot have their role changed.';
COMMENT ON FUNCTION public.prevent_last_owner_removal() IS 
  'Trigger function that prevents removing the last owner from a service. Services must always have at least one owner.';

