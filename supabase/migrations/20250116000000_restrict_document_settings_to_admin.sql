-- Restrict document settings editing to owner/admin only
-- Members can only read, not insert/update/delete

-- Drop existing INSERT/UPDATE policies
DROP POLICY IF EXISTS "Service members can insert document settings" ON public.service_document_settings;
DROP POLICY IF EXISTS "Service members can update document settings" ON public.service_document_settings;

-- Keep SELECT policy (all members can read)
-- SELECT policy already exists: "Service members can read document settings"

-- New INSERT policy: only owner/admin can insert
CREATE POLICY "Only owner/admin can insert document settings"
  ON public.service_document_settings
  FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.service_memberships
      WHERE service_memberships.service_id = service_document_settings.service_id
        AND service_memberships.user_id = auth.uid()
        AND service_memberships.role IN ('owner', 'admin')
    )
  );

-- New UPDATE policy: only owner/admin can update
CREATE POLICY "Only owner/admin can update document settings"
  ON public.service_document_settings
  FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM public.service_memberships
      WHERE service_memberships.service_id = service_document_settings.service_id
        AND service_memberships.user_id = auth.uid()
        AND service_memberships.role IN ('owner', 'admin')
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.service_memberships
      WHERE service_memberships.service_id = service_document_settings.service_id
        AND service_memberships.user_id = auth.uid()
        AND service_memberships.role IN ('owner', 'admin')
    )
  );

-- DELETE policy: only owner/admin can delete (if needed in future)
CREATE POLICY "Only owner/admin can delete document settings"
  ON public.service_document_settings
  FOR DELETE
  USING (
    EXISTS (
      SELECT 1 FROM public.service_memberships
      WHERE service_memberships.service_id = service_document_settings.service_id
        AND service_memberships.user_id = auth.uid()
        AND service_memberships.role IN ('owner', 'admin')
    )
  );

