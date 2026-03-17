-- Restore SELECT on service_settings for members (remote_schema dropped it; app uses .from('service_settings').select())
-- UPDATE stays restricted to RPC only via existing policy.

DROP POLICY IF EXISTS "Service members can read service_settings" ON public.service_settings;
CREATE POLICY "Service members can read service_settings"
  ON public.service_settings
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.service_memberships
      WHERE service_memberships.service_id = service_settings.service_id
        AND service_memberships.user_id = auth.uid()
    )
  );
