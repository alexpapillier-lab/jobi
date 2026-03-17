-- Migration: Add phone_norm to customers and customer_id FK to tickets
-- This migration adds phone normalization support and customer foreign key relationship.

-- 1. Add phone_norm column to customers table
ALTER TABLE public.customers
  ADD COLUMN IF NOT EXISTS phone_norm TEXT;

-- 2. Create index on phone_norm for faster lookups
CREATE INDEX IF NOT EXISTS idx_customers_phone_norm 
  ON public.customers(phone_norm) 
  WHERE phone_norm IS NOT NULL;

-- 3. Create UNIQUE constraint on (service_id, phone_norm) for customer deduplication
-- Note: This allows NULL phone_norm values (multiple customers without phone per service)
-- But prevents duplicate phone_norm values within the same service
CREATE UNIQUE INDEX IF NOT EXISTS idx_customers_service_phone_norm_unique
  ON public.customers(service_id, phone_norm)
  WHERE phone_norm IS NOT NULL;

-- 4. Add customer_id foreign key to tickets table
ALTER TABLE public.tickets
  ADD COLUMN IF NOT EXISTS customer_id UUID REFERENCES public.customers(id) ON DELETE SET NULL;

-- 5. Create index on customer_id for faster lookups
CREATE INDEX IF NOT EXISTS idx_tickets_customer_id 
  ON public.tickets(customer_id) 
  WHERE customer_id IS NOT NULL;

-- 6. Add comment explaining the phone_norm normalization
COMMENT ON COLUMN public.customers.phone_norm IS 
  'Normalized phone number for deduplication. Format: +420XXXXXXXXX (international format). NULL for customers without phone.';

-- 7. Add comment explaining the customer_id relationship
COMMENT ON COLUMN public.tickets.customer_id IS 
  'Foreign key to customers table. NULL if customer is anonymous or not yet linked.';


