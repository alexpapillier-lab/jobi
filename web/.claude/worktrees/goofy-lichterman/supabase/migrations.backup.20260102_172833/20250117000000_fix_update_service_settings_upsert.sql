-- Fix update_service_settings to support INSERT if record doesn't exist (upsert)
-- This fixes the issue where saving service settings fails if the record doesn't exist yet

CREATE OR REPLACE FUNCTION public.update_service_settings(
  p_service_id uuid,
  p_patch jsonb
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caller_id uuid;
  v_caller_role text;
  v_has_capability boolean;
  v_allowed_fields jsonb;
  v_filtered_patch jsonb;
  v_config jsonb;
BEGIN
  -- Get current user ID
  v_caller_id := auth.uid();
  
  IF v_caller_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  -- Verify membership
  SELECT role INTO v_caller_role
  FROM public.service_memberships
  WHERE service_id = p_service_id
    AND user_id = v_caller_id;

  IF v_caller_role IS NULL THEN
    RAISE EXCEPTION 'Not a member of this service';
  END IF;

  -- Whitelist allowed fields (config is the main field users can update)
  v_allowed_fields := '{"config"}'::jsonb;
  v_filtered_patch := p_patch ? v_allowed_fields;
  
  -- Extract config from patch
  v_config := (v_filtered_patch->>'config')::jsonb;

  -- Owner and admin can always update
  IF v_caller_role IN ('owner', 'admin') THEN
    -- Upsert: INSERT if not exists, UPDATE if exists
    -- Merge config: new values override existing ones, but keep existing keys not in patch
    INSERT INTO public.service_settings (service_id, config)
    VALUES (p_service_id, COALESCE(v_config, '{}'::jsonb))
    ON CONFLICT (service_id) 
    DO UPDATE SET 
      config = COALESCE(service_settings.config, '{}'::jsonb) || COALESCE(v_config, '{}'::jsonb);
    
    RETURN;
  END IF;

  -- For members, check capability
  SELECT public.has_capability(p_service_id, v_caller_id, 'can_edit_service_settings')
  INTO v_has_capability;

  IF NOT v_has_capability THEN
    RAISE EXCEPTION 'Not authorized: missing can_edit_service_settings capability';
  END IF;

  -- Upsert: INSERT if not exists, UPDATE if exists
  -- Merge config: new values override existing ones, but keep existing keys not in patch
  INSERT INTO public.service_settings (service_id, config)
  VALUES (p_service_id, COALESCE(v_config, '{}'::jsonb))
  ON CONFLICT (service_id) 
  DO UPDATE SET 
    config = COALESCE(service_settings.config, '{}'::jsonb) || COALESCE(v_config, '{}'::jsonb);
END;
$$;

