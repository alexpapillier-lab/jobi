-- Migration: Create customer_history table
-- This table stores audit history of customer data changes (append-only)

-- Create customer_history table
CREATE TABLE IF NOT EXISTS public.customer_history (
  id UUID NOT NULL PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id UUID NOT NULL,
  service_id UUID NOT NULL,
  changed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  changed_by UUID,
  change_type TEXT NOT NULL DEFAULT 'update',
  diff JSONB NOT NULL DEFAULT '{}'::jsonb,
  CONSTRAINT customer_history_customer_id_fkey 
    FOREIGN KEY (customer_id) REFERENCES public.customers(id) ON DELETE CASCADE,
  CONSTRAINT customer_history_service_id_fkey 
    FOREIGN KEY (service_id) REFERENCES public.services(id) ON DELETE CASCADE
);

-- Create indexes for performance
CREATE INDEX IF NOT EXISTS idx_customer_history_customer_id 
  ON public.customer_history(customer_id);

CREATE INDEX IF NOT EXISTS idx_customer_history_service_id 
  ON public.customer_history(service_id);

CREATE INDEX IF NOT EXISTS idx_customer_history_changed_at 
  ON public.customer_history(changed_at DESC);

-- Enable RLS
ALTER TABLE public.customer_history ENABLE ROW LEVEL SECURITY;

-- RLS Policies

-- Policy: Users can SELECT customer_history for customers in services they are members of
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
-- (Only members can create history entries, typically done by application logic)
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

-- Add comments for documentation
COMMENT ON TABLE public.customer_history IS 
  'Append-only audit log of customer data changes. Stores diffs of what changed, when, and by whom.';

COMMENT ON COLUMN public.customer_history.id IS 
  'Primary key, UUID generated automatically.';

COMMENT ON COLUMN public.customer_history.customer_id IS 
  'Foreign key to customers table. Cascade delete when customer is deleted.';

COMMENT ON COLUMN public.customer_history.service_id IS 
  'Foreign key to services table. Used for RLS and filtering.';

COMMENT ON COLUMN public.customer_history.changed_at IS 
  'Timestamp when the change occurred. Defaults to now().';

COMMENT ON COLUMN public.customer_history.changed_by IS 
  'UUID of the user who made the change (auth.uid()). NULL if not available.';

COMMENT ON COLUMN public.customer_history.change_type IS 
  'Type of change, e.g. "update", "create", "merge". Defaults to "update".';

COMMENT ON COLUMN public.customer_history.diff IS 
  'JSONB object containing only changed fields in format: {"field_name": {"old": "old_value", "new": "new_value"}}.';

