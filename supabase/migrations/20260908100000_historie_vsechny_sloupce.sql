-- Historie zakázky sleduje všechny sloupce, ne pevný seznam.
--
-- Trigger ticket_history_log porovnával jen vyjmenované sloupce (title,
-- status, notes, …). Každý nový sloupec (kontrola po opravě, náhradní
-- zařízení, cenová nabídka, pobočka, termín) tak v historii skončil jako
-- „Upravena“ bez podrobností. Teď se porovná celý řádek a vynechá se jen
-- to, co člověk nemění (updated_at, version, portálové značky). Sleva
-- zůstává jako jedna dvojice 'discount' {type, value}, jak ji čte aplikace.
-- Změna, která se dotkla jen vynechaných sloupců, se nezapisuje.
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
  v_old jsonb;
  v_new jsonb;
  v_key text;
  c_skip constant text[] := array[
    'id', 'service_id', 'code', 'created_at', 'updated_at', 'version', 'deleted_at',
    'portal_token', 'portal_last_opened_at', 'discount_type', 'discount_value'
  ];
BEGIN
  IF TG_OP = 'INSERT' THEN
    v_action := 'created';
    v_details := jsonb_build_object('title', COALESCE(NEW.title, ''), 'changes', '{}'::jsonb);
  ELSIF TG_OP = 'UPDATE' THEN
    IF OLD.deleted_at IS NULL AND NEW.deleted_at IS NOT NULL THEN
      v_action := 'deleted';
    ELSIF OLD.deleted_at IS NOT NULL AND NEW.deleted_at IS NULL THEN
      v_action := 'restored';
    ELSE
      v_action := 'updated';
      v_old := to_jsonb(OLD);
      v_new := to_jsonb(NEW);
      FOR v_key IN SELECT jsonb_object_keys(v_new) LOOP
        IF v_key = ANY (c_skip) THEN
          CONTINUE;
        END IF;
        IF v_old -> v_key IS DISTINCT FROM v_new -> v_key THEN
          IF v_key = 'performed_repairs' THEN
            v_changes := v_changes || jsonb_build_object(v_key, jsonb_build_object(
              'old', COALESCE(v_old -> v_key, '[]'::jsonb), 'new', COALESCE(v_new -> v_key, '[]'::jsonb)));
          ELSE
            v_changes := v_changes || jsonb_build_object(v_key, jsonb_build_object('old', v_old -> v_key, 'new', v_new -> v_key));
          END IF;
        END IF;
      END LOOP;
      IF OLD.discount_type IS DISTINCT FROM NEW.discount_type OR OLD.discount_value IS DISTINCT FROM NEW.discount_value THEN
        v_changes := v_changes || jsonb_build_object('discount', jsonb_build_object(
          'old', jsonb_build_object('type', to_jsonb(OLD.discount_type), 'value', to_jsonb(OLD.discount_value)),
          'new', jsonb_build_object('type', to_jsonb(NEW.discount_type), 'value', to_jsonb(NEW.discount_value))));
      END IF;
      -- Nic, co by člověka zajímalo (jen updated_at, version, portál) – bez záznamu.
      IF v_changes = '{}'::jsonb THEN
        RETURN NEW;
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
