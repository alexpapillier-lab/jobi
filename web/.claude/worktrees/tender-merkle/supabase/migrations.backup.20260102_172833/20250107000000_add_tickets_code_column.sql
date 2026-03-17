-- Migration: Add code column to tickets table
-- This migration adds a code column to the tickets table for storing generated ticket codes
-- Format: PREFIXYY###### (e.g., SRV25000001, ABC25000002)

-- Add code column to tickets table
ALTER TABLE public.tickets
  ADD COLUMN IF NOT EXISTS code TEXT;

-- Create index on code for faster lookups (optional, but recommended for performance)
CREATE INDEX IF NOT EXISTS idx_tickets_code 
  ON public.tickets(code) 
  WHERE code IS NOT NULL;

-- Add comment explaining the code column
COMMENT ON COLUMN public.tickets.code IS 
  'Generated ticket code in format PREFIXYY###### (e.g., SRV25000001). Format: service abbreviation + 2-digit year + 6-digit sequence number. Used for human-readable ticket identification.';


