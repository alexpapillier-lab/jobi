-- Migration: Fix tickets.created_at column
-- This migration ensures created_at is NOT NULL with DEFAULT now()

-- 1. Update any NULL values to current timestamp (or a reasonable default)
UPDATE public.tickets
SET created_at = COALESCE(created_at, now())
WHERE created_at IS NULL;

-- 2. Set DEFAULT now() if not already set
ALTER TABLE public.tickets
  ALTER COLUMN created_at SET DEFAULT now();

-- 3. Add NOT NULL constraint
ALTER TABLE public.tickets
  ALTER COLUMN created_at SET NOT NULL;

-- Add comment for documentation
COMMENT ON COLUMN public.tickets.created_at IS 
  'Timestamp when the ticket was created. Always set to now() by default. Cannot be NULL.';


