-- Ticket history: trigger records full diff of changed fields (not just status/title)
CREATE OR REPLACE FUNCTION public.ticket_history_log()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_action text;
  v_details jsonb := '{}'::jsonb;
  v_changes jsonb := '{}'::jsonb;
BEGIN
  IF TG_OP = 'INSERT' THEN
    v_action := 'created';
    v_details := jsonb_build_object(
      'title', COALESCE(NEW.title, ''),
      'changes', '{}'::jsonb
    );
  ELSIF TG_OP = 'UPDATE' THEN
    IF OLD.deleted_at IS NULL AND NEW.deleted_at IS NOT NULL THEN
      v_action := 'deleted';
      v_details := '{}'::jsonb;
    ELSIF OLD.deleted_at IS NOT NULL AND NEW.deleted_at IS NULL THEN
      v_action := 'restored';
      v_details := '{}'::jsonb;
    ELSE
      v_action := 'updated';
      -- Build diff: only include columns that actually changed
      IF OLD.title IS DISTINCT FROM NEW.title THEN
        v_changes := v_changes || jsonb_build_object('title', jsonb_build_object('old', to_jsonb(OLD.title), 'new', to_jsonb(NEW.title)));
      END IF;
      IF OLD.status IS DISTINCT FROM NEW.status THEN
        v_changes := v_changes || jsonb_build_object('status', jsonb_build_object('old', to_jsonb(OLD.status), 'new', to_jsonb(NEW.status)));
      END IF;
      IF OLD.notes IS DISTINCT FROM NEW.notes THEN
        v_changes := v_changes || jsonb_build_object('notes', jsonb_build_object('old', to_jsonb(OLD.notes), 'new', to_jsonb(NEW.notes)));
      END IF;
      IF OLD.estimated_price IS DISTINCT FROM NEW.estimated_price THEN
        v_changes := v_changes || jsonb_build_object('estimated_price', jsonb_build_object('old', to_jsonb(OLD.estimated_price), 'new', to_jsonb(NEW.estimated_price)));
      END IF;
      IF OLD.performed_repairs IS DISTINCT FROM NEW.performed_repairs THEN
        v_changes := v_changes || jsonb_build_object('performed_repairs', jsonb_build_object('old', COALESCE(OLD.performed_repairs, '[]'::jsonb), 'new', COALESCE(NEW.performed_repairs, '[]'::jsonb)));
      END IF;
      IF OLD.diagnostic_text IS DISTINCT FROM NEW.diagnostic_text THEN
        v_changes := v_changes || jsonb_build_object('diagnostic_text', jsonb_build_object('old', to_jsonb(OLD.diagnostic_text), 'new', to_jsonb(NEW.diagnostic_text)));
      END IF;
      IF OLD.customer_name IS DISTINCT FROM NEW.customer_name THEN
        v_changes := v_changes || jsonb_build_object('customer_name', jsonb_build_object('old', to_jsonb(OLD.customer_name), 'new', to_jsonb(NEW.customer_name)));
      END IF;
      IF OLD.customer_phone IS DISTINCT FROM NEW.customer_phone THEN
        v_changes := v_changes || jsonb_build_object('customer_phone', jsonb_build_object('old', to_jsonb(OLD.customer_phone), 'new', to_jsonb(NEW.customer_phone)));
      END IF;
      IF OLD.customer_email IS DISTINCT FROM NEW.customer_email THEN
        v_changes := v_changes || jsonb_build_object('customer_email', jsonb_build_object('old', to_jsonb(OLD.customer_email), 'new', to_jsonb(NEW.customer_email)));
      END IF;
      IF OLD.device_label IS DISTINCT FROM NEW.device_label THEN
        v_changes := v_changes || jsonb_build_object('device_label', jsonb_build_object('old', to_jsonb(OLD.device_label), 'new', to_jsonb(NEW.device_label)));
      END IF;
      IF OLD.discount_type IS DISTINCT FROM NEW.discount_type OR OLD.discount_value IS DISTINCT FROM NEW.discount_value THEN
        v_changes := v_changes || jsonb_build_object(
          'discount',
          jsonb_build_object(
            'old', jsonb_build_object('type', to_jsonb(OLD.discount_type), 'value', to_jsonb(OLD.discount_value)),
            'new', jsonb_build_object('type', to_jsonb(NEW.discount_type), 'value', to_jsonb(NEW.discount_value))
          )
        );
      END IF;
      IF OLD.device_condition IS DISTINCT FROM NEW.device_condition THEN
        v_changes := v_changes || jsonb_build_object('device_condition', jsonb_build_object('old', to_jsonb(OLD.device_condition), 'new', to_jsonb(NEW.device_condition)));
      END IF;
      IF OLD.device_note IS DISTINCT FROM NEW.device_note THEN
        v_changes := v_changes || jsonb_build_object('device_note', jsonb_build_object('old', to_jsonb(OLD.device_note), 'new', to_jsonb(NEW.device_note)));
      END IF;
      v_details := jsonb_build_object('changes', v_changes);
    END IF;
  ELSE
    RETURN NULL;
  END IF;

  INSERT INTO public.ticket_history (ticket_id, service_id, action, changed_by, details)
  VALUES (NEW.id, NEW.service_id, v_action, auth.uid(), v_details);
  RETURN COALESCE(NEW, OLD);
END;
$$;
