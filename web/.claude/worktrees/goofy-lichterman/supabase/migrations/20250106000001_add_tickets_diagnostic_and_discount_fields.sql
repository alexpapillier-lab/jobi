-- Migration: Add diagnostic and discount fields to tickets table
-- This migration adds fields for diagnostic information and discount calculation.

-- 1. Add diagnostic_text column (TEXT for diagnostic notes)
ALTER TABLE public.tickets
  ADD COLUMN IF NOT EXISTS diagnostic_text TEXT;

-- 2. Add diagnostic_photos column (JSONB array of photo URLs)
ALTER TABLE public.tickets
  ADD COLUMN IF NOT EXISTS diagnostic_photos JSONB DEFAULT '[]'::jsonb;

-- 3. Add discount_type column (VARCHAR for discount type: 'percentage' or 'amount')
ALTER TABLE public.tickets
  ADD COLUMN IF NOT EXISTS discount_type VARCHAR(20);

-- 4. Add discount_value column (NUMERIC for discount amount or percentage)
ALTER TABLE public.tickets
  ADD COLUMN IF NOT EXISTS discount_value NUMERIC(10,2);

-- 5. Add comments explaining the new columns
COMMENT ON COLUMN public.tickets.diagnostic_text IS 
  'Text notes from diagnostic process. Can contain detailed findings and recommendations.';

COMMENT ON COLUMN public.tickets.diagnostic_photos IS 
  'JSONB array of diagnostic photo URLs. Format: ["url1", "url2", ...]. Default: empty array.';

COMMENT ON COLUMN public.tickets.discount_type IS 
  'Type of discount applied: "percentage" for percentage discount, "amount" for fixed amount discount, NULL for no discount.';

COMMENT ON COLUMN public.tickets.discount_value IS 
  'Discount value: percentage (0-100) if discount_type is "percentage", or amount in currency if discount_type is "amount". NULL if no discount.';


