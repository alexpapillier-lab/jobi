-- Enforce capabilities for members in RPC and RLS
-- soft_delete_ticket / restore_ticket: member needs can_manage_ticket_archive
-- Ticket UPDATE (non-status): member needs can_manage_tickets_basic (trigger)
-- customers UPDATE: member needs can_manage_customers (RLS)

-- 1) soft_delete_ticket: allow member with can_manage_ticket_archive
CREATE OR REPLACE FUNCTION public.soft_delete_ticket(p_ticket_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_service_id UUID;
  v_user_id UUID;
  v_user_role TEXT;
BEGIN
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  SELECT service_id INTO v_service_id
  FROM public.tickets
  WHERE id = p_ticket_id;

  IF v_service_id IS NULL THEN
    RAISE EXCEPTION 'Ticket not found';
  END IF;

  SELECT role INTO v_user_role
  FROM public.service_memberships
  WHERE service_id = v_service_id
    AND user_id = v_user_id;

  IF v_user_role IS NULL THEN
    RAISE EXCEPTION 'Not authorized: user is not a member of this service';
  END IF;

  IF v_user_role IN ('owner', 'admin') THEN
    NULL;
  ELSIF v_user_role = 'member' THEN
    IF NOT public.has_capability(v_service_id, v_user_id, 'can_manage_ticket_archive') THEN
      RAISE EXCEPTION 'Not authorized: member needs can_manage_ticket_archive to delete tickets';
    END IF;
  ELSE
    RAISE EXCEPTION 'Not authorized: invalid role';
  END IF;

  UPDATE public.tickets
  SET deleted_at = now()
  WHERE id = p_ticket_id
    AND service_id = v_service_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Ticket not found or update failed';
  END IF;
END;
$function$;

-- 2) restore_ticket: allow member with can_manage_ticket_archive
CREATE OR REPLACE FUNCTION public.restore_ticket(p_ticket_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_service_id UUID;
  v_user_id UUID;
  v_user_role TEXT;
BEGIN
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  SELECT service_id INTO v_service_id
  FROM public.tickets
  WHERE id = p_ticket_id;

  IF v_service_id IS NULL THEN
    RAISE EXCEPTION 'Ticket not found';
  END IF;

  SELECT role INTO v_user_role
  FROM public.service_memberships
  WHERE service_id = v_service_id
    AND user_id = v_user_id;

  IF v_user_role IS NULL THEN
    RAISE EXCEPTION 'Not authorized: user is not a member of this service';
  END IF;

  IF v_user_role IN ('owner', 'admin') THEN
    NULL;
  ELSIF v_user_role = 'member' THEN
    IF NOT public.has_capability(v_service_id, v_user_id, 'can_manage_ticket_archive') THEN
      RAISE EXCEPTION 'Not authorized: member needs can_manage_ticket_archive to restore tickets';
    END IF;
  ELSE
    RAISE EXCEPTION 'Not authorized: invalid role';
  END IF;

  UPDATE public.tickets
  SET deleted_at = NULL
  WHERE id = p_ticket_id
    AND service_id = v_service_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Ticket not found or update failed';
  END IF;
END;
$function$;

-- 3) Trigger: require can_manage_tickets_basic when updating ticket fields other than status
CREATE OR REPLACE FUNCTION public.enforce_ticket_basic_update_permissions()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_basic_changed boolean := FALSE;
BEGIN
  IF TG_OP <> 'UPDATE' THEN
    RETURN NEW;
  END IF;

  -- Status change is handled by enforce_ticket_status_change_permissions
  IF OLD.status IS DISTINCT FROM NEW.status THEN
    RETURN NEW;
  END IF;

  -- Check if any "basic" (non-status) content field changed
  IF (OLD.title IS DISTINCT FROM NEW.title)
     OR (OLD.notes IS DISTINCT FROM NEW.notes)
     OR (OLD.customer_name IS DISTINCT FROM NEW.customer_name)
     OR (OLD.customer_phone IS DISTINCT FROM NEW.customer_phone)
     OR (OLD.customer_email IS DISTINCT FROM NEW.customer_email)
     OR (OLD.customer_address_street IS DISTINCT FROM NEW.customer_address_street)
     OR (OLD.customer_address_city IS DISTINCT FROM NEW.customer_address_city)
     OR (OLD.customer_address_zip IS DISTINCT FROM NEW.customer_address_zip)
     OR (OLD.customer_address_country IS DISTINCT FROM NEW.customer_address_country)
     OR (OLD.customer_company IS DISTINCT FROM NEW.customer_company)
     OR (OLD.customer_ico IS DISTINCT FROM NEW.customer_ico)
     OR (OLD.customer_info IS DISTINCT FROM NEW.customer_info)
     OR (OLD.customer_id IS DISTINCT FROM NEW.customer_id)
     OR (OLD.device_condition IS DISTINCT FROM NEW.device_condition)
     OR (OLD.device_note IS DISTINCT FROM NEW.device_note)
     OR (OLD.device_label IS DISTINCT FROM NEW.device_label)
     OR (OLD.device_brand IS DISTINCT FROM NEW.device_brand)
     OR (OLD.device_model IS DISTINCT FROM NEW.device_model)
     OR (OLD.device_serial IS DISTINCT FROM NEW.device_serial)
     OR (OLD.device_imei IS DISTINCT FROM NEW.device_imei)
     OR (OLD.device_passcode IS DISTINCT FROM NEW.device_passcode)
     OR (OLD.estimated_price IS DISTINCT FROM NEW.estimated_price)
     OR (OLD.external_id IS DISTINCT FROM NEW.external_id)
     OR (OLD.handoff_method IS DISTINCT FROM NEW.handoff_method)
     OR (OLD.performed_repairs IS DISTINCT FROM NEW.performed_repairs)
     OR (OLD.diagnostic_text IS DISTINCT FROM NEW.diagnostic_text)
     OR (OLD.diagnostic_photos IS DISTINCT FROM NEW.diagnostic_photos)
     OR (OLD.discount_type IS DISTINCT FROM NEW.discount_type)
     OR (OLD.discount_value IS DISTINCT FROM NEW.discount_value)
     OR (OLD.code IS DISTINCT FROM NEW.code)
  THEN
    v_basic_changed := TRUE;
  END IF;

  IF NOT v_basic_changed THEN
    RETURN NEW;
  END IF;

  IF NOT public.has_capability(NEW.service_id, auth.uid(), 'can_manage_tickets_basic') THEN
    RAISE EXCEPTION 'Not authorized: missing can_manage_tickets_basic for ticket updates';
  END IF;

  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_enforce_ticket_basic_update_permissions ON public.tickets;
CREATE TRIGGER trg_enforce_ticket_basic_update_permissions
  BEFORE UPDATE ON public.tickets
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_ticket_basic_update_permissions();

-- 4) customers UPDATE: only if has can_manage_customers (owner/admin implicit)
DROP POLICY IF EXISTS "customers_update" ON public.customers;
CREATE POLICY "customers_update"
  ON public.customers
  AS PERMISSIVE
  FOR UPDATE
  TO authenticated
  USING (public.has_capability(service_id, auth.uid(), 'can_manage_customers'))
  WITH CHECK (public.has_capability(service_id, auth.uid(), 'can_manage_customers'));
