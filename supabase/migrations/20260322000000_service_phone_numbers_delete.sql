-- Allow owner/admin to remove this service's SMS binding (re-provision with correct number).
DROP POLICY IF EXISTS service_phone_numbers_delete ON public.service_phone_numbers;
CREATE POLICY service_phone_numbers_delete ON public.service_phone_numbers
  FOR DELETE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.service_memberships m
      WHERE m.service_id = service_phone_numbers.service_id
        AND m.user_id = auth.uid()
        AND m.role IN ('owner', 'admin')
    )
  );
