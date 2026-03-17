-- Add country_code to know where the Twilio number is (CZ vs US fallback)
ALTER TABLE public.service_phone_numbers
  ADD COLUMN IF NOT EXISTS country_code text NOT NULL DEFAULT 'CZ';

COMMENT ON COLUMN public.service_phone_numbers.country_code IS 'ISO 3166-1 alpha-2, e.g. CZ or US. US used when CZ numbers unavailable.';
