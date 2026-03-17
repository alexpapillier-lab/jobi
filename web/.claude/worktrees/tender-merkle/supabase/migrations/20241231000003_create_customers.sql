-- Base table: customers

CREATE TABLE IF NOT EXISTS public.customers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  service_id uuid NOT NULL,
  name text,
  phone text,
  email text,

  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- FK to services
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'customers_service_id_fkey'
  ) THEN
    ALTER TABLE public.customers
      ADD CONSTRAINT customers_service_id_fkey
      FOREIGN KEY (service_id)
      REFERENCES public.services(id)
      ON DELETE CASCADE;
  END IF;
END $$;

-- Indexes
CREATE INDEX IF NOT EXISTS idx_customers_service_id
  ON public.customers(service_id);

CREATE INDEX IF NOT EXISTS idx_customers_phone
  ON public.customers(phone);

-- updated_at trigger (reuse existing function if present)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger WHERE tgname = 'trg_customers_set_updated_at'
  ) THEN
    CREATE TRIGGER trg_customers_set_updated_at
    BEFORE UPDATE ON public.customers
    FOR EACH ROW
    EXECUTE FUNCTION public.set_updated_at();
  END IF;
END $$;
