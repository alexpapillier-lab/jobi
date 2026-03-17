-- Backend: can_manage_documents pro údaje firmy a dokumenty
-- 1) update_service_settings: member při ukládání „kontaktních“ polí potřebuje can_manage_documents
-- 2) service_document_settings: INSERT/UPDATE povolit i memberům s can_manage_documents

-- 1) Upravit update_service_settings – pokud config obsahuje kontaktní pole, member potřebuje can_manage_documents
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
  v_config jsonb;
  v_has_edit boolean;
  v_has_docs boolean;
  v_contact_keys text[] := ARRAY['phone', 'email', 'website', 'addressStreet', 'addressCity', 'addressZip'];
  v_key text;
BEGIN
  v_caller_id := auth.uid();
  IF v_caller_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  SELECT role INTO v_caller_role
  FROM public.service_memberships
  WHERE service_id = p_service_id AND user_id = v_caller_id;

  IF v_caller_role IS NULL THEN
    RAISE EXCEPTION 'Not a member of this service';
  END IF;

  IF v_caller_role IN ('owner', 'admin') THEN
    -- Upsert
    v_config := COALESCE(p_patch->'config', '{}'::jsonb);
    INSERT INTO public.service_settings (service_id, config)
    VALUES (p_service_id, v_config)
    ON CONFLICT (service_id)
    DO UPDATE SET config = COALESCE(public.service_settings.config, '{}'::jsonb) || v_config;
    RETURN;
  END IF;

  IF v_caller_role <> 'member' THEN
    RAISE EXCEPTION 'Not authorized: invalid role';
  END IF;

  v_config := COALESCE(p_patch->'config', '{}'::jsonb);
  SELECT public.has_capability(p_service_id, v_caller_id, 'can_edit_service_settings') INTO v_has_edit;
  SELECT public.has_capability(p_service_id, v_caller_id, 'can_manage_documents') INTO v_has_docs;

  -- Kontaktní pole v config vyžadují can_manage_documents
  FOREACH v_key IN ARRAY v_contact_keys
  LOOP
    IF v_config ? v_key AND NOT v_has_docs THEN
      RAISE EXCEPTION 'Not authorized: can_manage_documents required to update contact data';
    END IF;
  END LOOP;

  IF NOT v_has_edit AND NOT v_has_docs THEN
    RAISE EXCEPTION 'Not authorized: need can_edit_service_settings or can_manage_documents';
  END IF;

  INSERT INTO public.service_settings (service_id, config)
  VALUES (p_service_id, v_config)
  ON CONFLICT (service_id)
  DO UPDATE SET config = COALESCE(public.service_settings.config, '{}'::jsonb) || v_config;
END;
$$;

-- 2) service_document_settings: povolit INSERT/UPDATE memberům s can_manage_documents
DROP POLICY IF EXISTS "Only owner/admin can insert document settings" ON public.service_document_settings;
DROP POLICY IF EXISTS "Only owner/admin can update document settings" ON public.service_document_settings;

CREATE POLICY "Owner admin or can_manage_documents can insert document settings"
  ON public.service_document_settings
  FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.service_memberships sm
      WHERE sm.service_id = service_document_settings.service_id
        AND sm.user_id = auth.uid()
        AND (
          sm.role IN ('owner', 'admin')
          OR (sm.role = 'member' AND public.has_capability(service_document_settings.service_id, auth.uid(), 'can_manage_documents'))
        )
    )
  );

CREATE POLICY "Owner admin or can_manage_documents can update document settings"
  ON public.service_document_settings
  FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.service_memberships sm
      WHERE sm.service_id = service_document_settings.service_id
        AND sm.user_id = auth.uid()
        AND (
          sm.role IN ('owner', 'admin')
          OR (sm.role = 'member' AND public.has_capability(service_document_settings.service_id, auth.uid(), 'can_manage_documents'))
        )
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.service_memberships sm
      WHERE sm.service_id = service_document_settings.service_id
        AND sm.user_id = auth.uid()
        AND (
          sm.role IN ('owner', 'admin')
          OR (sm.role = 'member' AND public.has_capability(service_document_settings.service_id, auth.uid(), 'can_manage_documents'))
        )
    )
  );
