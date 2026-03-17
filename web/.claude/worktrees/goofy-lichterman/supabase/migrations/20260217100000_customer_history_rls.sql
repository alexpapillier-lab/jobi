-- Fix Supabase linter: rls_disabled_in_public (ERROR)
-- Re-enable RLS on customer_history and restore policies (were disabled in remote_schema).

ALTER TABLE public.customer_history ENABLE ROW LEVEL SECURITY;

-- Policy: Users can SELECT customer_history for customers in services they are members of
DROP POLICY IF EXISTS "Users can view customer_history for their services" ON public.customer_history;
CREATE POLICY "Users can view customer_history for their services"
  ON public.customer_history
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.service_memberships
      WHERE service_memberships.service_id = customer_history.service_id
        AND service_memberships.user_id = auth.uid()
    )
  );

-- Policy: Users can INSERT customer_history for customers in services they are members of
DROP POLICY IF EXISTS "Users can insert customer_history for their services" ON public.customer_history;
CREATE POLICY "Users can insert customer_history for their services"
  ON public.customer_history
  FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM public.service_memberships
      WHERE service_memberships.service_id = customer_history.service_id
        AND service_memberships.user_id = auth.uid()
    )
  );
