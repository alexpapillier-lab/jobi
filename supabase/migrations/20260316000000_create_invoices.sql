-- Invoicing tables: invoices, invoice_items, invoice_events, invoice_series

-- Series for atomic invoice numbering per service+year
CREATE TABLE IF NOT EXISTS public.invoice_series (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  service_id uuid NOT NULL,
  prefix text NOT NULL DEFAULT 'FV',
  year int NOT NULL DEFAULT EXTRACT(YEAR FROM now())::int,
  next_value int NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT invoice_series_service_year_uq UNIQUE (service_id, prefix, year)
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'invoice_series_service_id_fkey'
  ) THEN
    ALTER TABLE public.invoice_series
      ADD CONSTRAINT invoice_series_service_id_fkey
      FOREIGN KEY (service_id) REFERENCES public.services(id)
      ON DELETE CASCADE;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_invoice_series_service_id ON public.invoice_series(service_id);


-- Main invoices table
CREATE TABLE IF NOT EXISTS public.invoices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  service_id uuid NOT NULL,
  customer_id uuid,
  ticket_id uuid,

  number text NOT NULL,
  variable_symbol text,

  status text NOT NULL DEFAULT 'draft',

  issue_date date NOT NULL DEFAULT CURRENT_DATE,
  due_date date NOT NULL DEFAULT (CURRENT_DATE + interval '14 days')::date,
  taxable_date date,
  paid_at timestamptz,
  sent_at timestamptz,

  currency text NOT NULL DEFAULT 'CZK',
  subtotal numeric(12,2) NOT NULL DEFAULT 0,
  vat_amount numeric(12,2) NOT NULL DEFAULT 0,
  total numeric(12,2) NOT NULL DEFAULT 0,
  rounding numeric(12,2) NOT NULL DEFAULT 0,

  supplier_name text,
  supplier_ico text,
  supplier_dic text,
  supplier_address text,
  supplier_email text,
  supplier_phone text,
  supplier_bank_account text,
  supplier_iban text,
  supplier_swift text,

  customer_name text,
  customer_ico text,
  customer_dic text,
  customer_address text,
  customer_email text,
  customer_phone text,

  notes text,
  internal_note text,

  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  deleted_at timestamptz
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'invoices_service_id_fkey'
  ) THEN
    ALTER TABLE public.invoices
      ADD CONSTRAINT invoices_service_id_fkey
      FOREIGN KEY (service_id) REFERENCES public.services(id)
      ON DELETE CASCADE;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'invoices_customer_id_fkey'
  ) THEN
    ALTER TABLE public.invoices
      ADD CONSTRAINT invoices_customer_id_fkey
      FOREIGN KEY (customer_id) REFERENCES public.customers(id)
      ON DELETE SET NULL;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'invoices_ticket_id_fkey'
  ) THEN
    ALTER TABLE public.invoices
      ADD CONSTRAINT invoices_ticket_id_fkey
      FOREIGN KEY (ticket_id) REFERENCES public.tickets(id)
      ON DELETE SET NULL;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_invoices_service_id ON public.invoices(service_id);
CREATE INDEX IF NOT EXISTS idx_invoices_customer_id ON public.invoices(customer_id);
CREATE INDEX IF NOT EXISTS idx_invoices_ticket_id ON public.invoices(ticket_id);
CREATE INDEX IF NOT EXISTS idx_invoices_status ON public.invoices(status);
CREATE INDEX IF NOT EXISTS idx_invoices_number ON public.invoices(number);
CREATE INDEX IF NOT EXISTS idx_invoices_issue_date ON public.invoices(issue_date);
CREATE INDEX IF NOT EXISTS idx_invoices_deleted_at ON public.invoices(deleted_at) WHERE deleted_at IS NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger WHERE tgname = 'trg_invoices_set_updated_at'
  ) THEN
    CREATE TRIGGER trg_invoices_set_updated_at
    BEFORE UPDATE ON public.invoices
    FOR EACH ROW
    EXECUTE FUNCTION public.set_updated_at();
  END IF;
END $$;


-- Invoice line items
CREATE TABLE IF NOT EXISTS public.invoice_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_id uuid NOT NULL,
  sort_order int NOT NULL DEFAULT 0,

  name text NOT NULL DEFAULT '',
  qty numeric(10,3) NOT NULL DEFAULT 1,
  unit text NOT NULL DEFAULT 'ks',
  unit_price numeric(12,2) NOT NULL DEFAULT 0,
  vat_rate numeric(5,2) NOT NULL DEFAULT 21,
  line_total numeric(12,2) NOT NULL DEFAULT 0,

  created_at timestamptz NOT NULL DEFAULT now()
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'invoice_items_invoice_id_fkey'
  ) THEN
    ALTER TABLE public.invoice_items
      ADD CONSTRAINT invoice_items_invoice_id_fkey
      FOREIGN KEY (invoice_id) REFERENCES public.invoices(id)
      ON DELETE CASCADE;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_invoice_items_invoice_id ON public.invoice_items(invoice_id);


-- Invoice event log (audit trail)
CREATE TABLE IF NOT EXISTS public.invoice_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_id uuid NOT NULL,
  type text NOT NULL,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'invoice_events_invoice_id_fkey'
  ) THEN
    ALTER TABLE public.invoice_events
      ADD CONSTRAINT invoice_events_invoice_id_fkey
      FOREIGN KEY (invoice_id) REFERENCES public.invoices(id)
      ON DELETE CASCADE;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_invoice_events_invoice_id ON public.invoice_events(invoice_id);
CREATE INDEX IF NOT EXISTS idx_invoice_events_type ON public.invoice_events(type);


-- RLS
ALTER TABLE public.invoices ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.invoice_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.invoice_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.invoice_series ENABLE ROW LEVEL SECURITY;

-- invoices: membership-based access
CREATE POLICY invoices_select ON public.invoices FOR SELECT USING (
  EXISTS (SELECT 1 FROM public.service_memberships m WHERE m.service_id = invoices.service_id AND m.user_id = auth.uid())
);
CREATE POLICY invoices_insert ON public.invoices FOR INSERT WITH CHECK (
  EXISTS (SELECT 1 FROM public.service_memberships m WHERE m.service_id = invoices.service_id AND m.user_id = auth.uid())
);
CREATE POLICY invoices_update ON public.invoices FOR UPDATE USING (
  EXISTS (SELECT 1 FROM public.service_memberships m WHERE m.service_id = invoices.service_id AND m.user_id = auth.uid())
);
CREATE POLICY invoices_delete ON public.invoices FOR DELETE USING (
  EXISTS (SELECT 1 FROM public.service_memberships m WHERE m.service_id = invoices.service_id AND m.user_id = auth.uid())
);

-- invoice_items: access via parent invoice
CREATE POLICY invoice_items_select ON public.invoice_items FOR SELECT USING (
  EXISTS (SELECT 1 FROM public.invoices i JOIN public.service_memberships m ON m.service_id = i.service_id AND m.user_id = auth.uid() WHERE i.id = invoice_items.invoice_id)
);
CREATE POLICY invoice_items_insert ON public.invoice_items FOR INSERT WITH CHECK (
  EXISTS (SELECT 1 FROM public.invoices i JOIN public.service_memberships m ON m.service_id = i.service_id AND m.user_id = auth.uid() WHERE i.id = invoice_items.invoice_id)
);
CREATE POLICY invoice_items_update ON public.invoice_items FOR UPDATE USING (
  EXISTS (SELECT 1 FROM public.invoices i JOIN public.service_memberships m ON m.service_id = i.service_id AND m.user_id = auth.uid() WHERE i.id = invoice_items.invoice_id)
);
CREATE POLICY invoice_items_delete ON public.invoice_items FOR DELETE USING (
  EXISTS (SELECT 1 FROM public.invoices i JOIN public.service_memberships m ON m.service_id = i.service_id AND m.user_id = auth.uid() WHERE i.id = invoice_items.invoice_id)
);

-- invoice_events: access via parent invoice
CREATE POLICY invoice_events_select ON public.invoice_events FOR SELECT USING (
  EXISTS (SELECT 1 FROM public.invoices i JOIN public.service_memberships m ON m.service_id = i.service_id AND m.user_id = auth.uid() WHERE i.id = invoice_events.invoice_id)
);
CREATE POLICY invoice_events_insert ON public.invoice_events FOR INSERT WITH CHECK (
  EXISTS (SELECT 1 FROM public.invoices i JOIN public.service_memberships m ON m.service_id = i.service_id AND m.user_id = auth.uid() WHERE i.id = invoice_events.invoice_id)
);

-- invoice_series: membership-based
CREATE POLICY invoice_series_select ON public.invoice_series FOR SELECT USING (
  EXISTS (SELECT 1 FROM public.service_memberships m WHERE m.service_id = invoice_series.service_id AND m.user_id = auth.uid())
);
CREATE POLICY invoice_series_insert ON public.invoice_series FOR INSERT WITH CHECK (
  EXISTS (SELECT 1 FROM public.service_memberships m WHERE m.service_id = invoice_series.service_id AND m.user_id = auth.uid())
);
CREATE POLICY invoice_series_update ON public.invoice_series FOR UPDATE USING (
  EXISTS (SELECT 1 FROM public.service_memberships m WHERE m.service_id = invoice_series.service_id AND m.user_id = auth.uid())
);


-- Atomic number generation function
CREATE OR REPLACE FUNCTION public.next_invoice_number(
  p_service_id uuid,
  p_prefix text DEFAULT 'FV',
  p_year int DEFAULT EXTRACT(YEAR FROM now())::int
)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_next int;
BEGIN
  INSERT INTO public.invoice_series (service_id, prefix, year, next_value)
  VALUES (p_service_id, p_prefix, p_year, 2)
  ON CONFLICT (service_id, prefix, year)
  DO UPDATE SET next_value = invoice_series.next_value + 1
  RETURNING next_value - 1 INTO v_next;

  RETURN p_prefix || p_year::text || '-' || LPAD(v_next::text, 4, '0');
END;
$$;
