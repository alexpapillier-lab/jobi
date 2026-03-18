-- SMS shared numbers: allow multiple services to share one Twilio number.
--
-- Previously service_phone_numbers had:
--   service_id UNIQUE  →  one row per service (keep)
--   twilio_number UNIQUE  →  one service per number (REMOVE – shared pool)
--
-- New column is_pool_primary: when an inbound SMS arrives on a shared number
-- from an unknown customer (no prior conversation), route to the primary service.
-- Exactly one service per shared number should have is_pool_primary = true.
-- For dedicated (non-shared) numbers this column is irrelevant but defaults true.

-- 1. Drop the unique constraint on twilio_number
ALTER TABLE public.service_phone_numbers
  DROP CONSTRAINT IF EXISTS service_phone_numbers_twilio_number_key;

-- 2. Add is_pool_primary flag
ALTER TABLE public.service_phone_numbers
  ADD COLUMN IF NOT EXISTS is_pool_primary boolean NOT NULL DEFAULT true;

-- 3. country_code column (may not exist on older installs)
ALTER TABLE public.service_phone_numbers
  ADD COLUMN IF NOT EXISTS country_code text NOT NULL DEFAULT 'CZ';

-- 4. Replace single-column index with a composite for the shared routing query
DROP INDEX IF EXISTS idx_service_phone_numbers_twilio_number;
CREATE INDEX IF NOT EXISTS idx_service_phone_numbers_twilio_active
  ON public.service_phone_numbers(twilio_number, active);
