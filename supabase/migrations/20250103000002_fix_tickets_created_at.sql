-- Fix created_at column in tickets table
-- 1. Fill NULL created_at values with updated_at (if available) or now()
-- 2. Set default to now()
-- 3. Add NOT NULL constraint

-- Step 1: Fill NULL created_at values
-- Use updated_at if available and not null, otherwise use now()
UPDATE public.tickets
SET created_at = COALESCE(updated_at, now())
WHERE created_at IS NULL;

-- Step 2: Set default value
ALTER TABLE public.tickets
ALTER COLUMN created_at SET DEFAULT now();

-- Step 3: Add NOT NULL constraint
ALTER TABLE public.tickets
ALTER COLUMN created_at SET NOT NULL;

-- Optional: Add comment for documentation
COMMENT ON COLUMN public.tickets.created_at IS 'Timestamp when the ticket was created. Always set by database default.';

