-- Allow hard delete of service (root owner): when the whole service is deleted,
-- the trigger "prevent last owner removal" must not block CASCADE delete of memberships.
-- We use a transaction-local config so the trigger can skip the check when the service
-- is being deleted via the dedicated RPC.

-- 1. Update trigger function: if app.deleting_service_id is set and matches this service, allow DELETE
CREATE OR REPLACE FUNCTION public.prevent_last_owner_removal()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $function$
DECLARE
  owners_count INT;
  deleting_id TEXT;
BEGIN
  -- When the entire service is being deleted (via delete_service_for_root), allow CASCADE to remove memberships
  IF TG_OP = 'DELETE' THEN
    deleting_id := current_setting('app.deleting_service_id', true);
    IF deleting_id IS NOT NULL AND deleting_id = OLD.service_id::text THEN
      RETURN OLD;
    END IF;
  END IF;

  -- Count other owners in this service (excluding the current row)
  SELECT COUNT(*) INTO owners_count
  FROM public.service_memberships
  WHERE service_id = OLD.service_id
    AND role = 'owner'
    AND user_id <> OLD.user_id;

  IF TG_OP = 'UPDATE' THEN
    IF OLD.role = 'owner' AND NEW.role <> 'owner' AND owners_count = 0 THEN
      RAISE EXCEPTION 'Cannot downgrade the last owner of a service';
    END IF;
    RETURN NEW;
  END IF;

  -- DELETE: if this is the last owner, block (unless we already returned above via deleting_service_id)
  IF OLD.role = 'owner' AND owners_count = 0 THEN
    RAISE EXCEPTION 'Cannot remove the last owner of a service';
  END IF;

  RETURN OLD;
END;
$function$;

-- 2. RPC for root owner to delete a service (sets session variable so trigger allows CASCADE)
CREATE OR REPLACE FUNCTION public.delete_service_for_root(p_service_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Mark that we're deleting this service so prevent_last_owner_removal allows CASCADE
  PERFORM set_config('app.deleting_service_id', p_service_id::text, true);
  DELETE FROM public.services WHERE id = p_service_id;
END;
$$;

COMMENT ON FUNCTION public.delete_service_for_root(uuid) IS
  'Deletes a service and all related rows (CASCADE). For use by root owner only. Call from Edge Function service-manage after auth check.';
