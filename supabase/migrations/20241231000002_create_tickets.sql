-- Base table required by later migrations (soft delete, RPC, created_at fixes, etc.)

CREATE TABLE IF NOT EXISTS public.tickets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  service_id uuid NOT NULL,
  title text NOT NULL DEFAULT ''::text,
  status text NOT NULL DEFAULT 'received'::text,
  notes text NOT NULL DEFAULT ''::text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz DEFAULT now(),

  customer_name text,
  customer_phone text,
  customer_email text,
  customer_address_street text,
  customer_address_city text,
  customer_address_zip text,
  customer_address_country text,
  customer_company text,
  customer_ico text,
  customer_info text,

  device_condition text,
  device_note text,
  device_label text,
  device_brand text,
  device_model text,
  device_serial text,
  device_imei text,
  device_passcode text,

  estimated_price numeric(10,2),
  external_id text,
  handoff_method text,

  performed_repairs jsonb NOT NULL DEFAULT '[]'::jsonb,
  diagnostic_text text,
  diagnostic_photos jsonb NOT NULL DEFAULT '[]'::jsonb,
  discount_type text,
  discount_value numeric,

  customer_id uuid,
  code text,
  deleted_at timestamptz
);

-- FK to services (services must exist)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'tickets_service_id_fkey'
  ) THEN
    ALTER TABLE public.tickets
      ADD CONSTRAINT tickets_service_id_fkey
      FOREIGN KEY (service_id) REFERENCES public.services(id)
      ON DELETE CASCADE;
  END IF;
END $$;

-- Common indexes
CREATE INDEX IF NOT EXISTS idx_tickets_service_id ON public.tickets(service_id);
CREATE INDEX IF NOT EXISTS idx_tickets_created_at ON public.tickets(created_at);
CREATE INDEX IF NOT EXISTS idx_tickets_updated_at ON public.tickets(updated_at);

-- Soft delete index (matches later usage)
CREATE INDEX IF NOT EXISTS idx_tickets_deleted_at
  ON public.tickets(deleted_at)
  WHERE deleted_at IS NULL;

-- updated_at helper (optional but practical)
CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger WHERE tgname = 'trg_tickets_set_updated_at'
  ) THEN
    CREATE TRIGGER trg_tickets_set_updated_at
    BEFORE UPDATE ON public.tickets
    FOR EACH ROW
    EXECUTE FUNCTION public.set_updated_at();
  END IF;
END $$;
