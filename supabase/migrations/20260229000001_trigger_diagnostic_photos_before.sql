-- Add diagnostic_photos_before to trigger so capability check applies when users update it
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

  IF auth.uid() IS NULL THEN
    RETURN NEW;
  END IF;

  IF OLD.status IS DISTINCT FROM NEW.status THEN
    RETURN NEW;
  END IF;

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
     OR (OLD.diagnostic_photos_before IS DISTINCT FROM NEW.diagnostic_photos_before)
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
