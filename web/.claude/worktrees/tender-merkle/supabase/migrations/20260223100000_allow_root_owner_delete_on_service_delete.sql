-- Při mazání celého servisu (RPC delete_service_for_root) smí CASCADE smazat i řádek
-- root ownera v service_memberships. Trigger prevent_root_owner_change to musí povolit.

CREATE OR REPLACE FUNCTION public.prevent_root_owner_change()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $function$
DECLARE
  deleting_id TEXT;
BEGIN
  -- Když mazání celého servisu (delete_service_for_root), povolit DELETE libovolného řádku včetně root ownera
  IF TG_OP = 'DELETE' THEN
    deleting_id := current_setting('app.deleting_service_id', true);
    IF deleting_id IS NOT NULL AND deleting_id = OLD.service_id::text THEN
      RETURN OLD;
    END IF;
  END IF;

  -- Root owner (nezměnitelný) – nelze odebrat z týmu ani změnit roli
  IF OLD.user_id = 'f3b27eb3-7059-48e0-839f-de1eb988fe70' THEN
    IF TG_OP = 'DELETE' THEN
      RAISE EXCEPTION 'Root owner cannot be removed';
    END IF;
    IF TG_OP = 'UPDATE' AND NEW.role <> 'owner' THEN
      RAISE EXCEPTION 'Root owner role cannot be changed';
    END IF;
  END IF;

  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  ELSE
    RETURN NEW;
  END IF;
END;
$function$;
