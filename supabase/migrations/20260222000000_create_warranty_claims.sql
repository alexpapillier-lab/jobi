-- Reklamace: tabulka warranty_claims a historie warranty_claim_history.
-- Statusy sdílené s zakázkami (service_statuses). Při založení reklamace k zakázce
-- se zapíše do ticket_history action 'warranty_claim_created'.

-- 1) warranty_claims
CREATE TABLE IF NOT EXISTS public.warranty_claims (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  service_id uuid NOT NULL REFERENCES public.services(id) ON DELETE CASCADE,
  source_ticket_id uuid REFERENCES public.tickets(id) ON DELETE SET NULL,
  code text NOT NULL,
  status text NOT NULL DEFAULT 'received',
  notes text NOT NULL DEFAULT '',
  resolution_summary text,
  received_at timestamptz,
  released_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz DEFAULT now(),

  customer_id uuid REFERENCES public.customers(id) ON DELETE SET NULL,
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
  device_accessories text,
  device_note text,
  device_label text,
  device_brand text,
  device_model text,
  device_serial text,
  device_imei text,
  device_passcode text
);

CREATE INDEX IF NOT EXISTS idx_warranty_claims_service_id ON public.warranty_claims(service_id);
CREATE INDEX IF NOT EXISTS idx_warranty_claims_source_ticket_id ON public.warranty_claims(source_ticket_id) WHERE source_ticket_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_warranty_claims_status ON public.warranty_claims(service_id, status);
CREATE INDEX IF NOT EXISTS idx_warranty_claims_code ON public.warranty_claims(service_id, code);
CREATE INDEX IF NOT EXISTS idx_warranty_claims_created_at ON public.warranty_claims(created_at DESC);

COMMENT ON TABLE public.warranty_claims IS 'Reklamace – vytvořené z dokončených zakázek nebo ručně. Statusy z service_statuses.';

-- updated_at trigger
DROP TRIGGER IF EXISTS trg_warranty_claims_set_updated_at ON public.warranty_claims;
CREATE TRIGGER trg_warranty_claims_set_updated_at
  BEFORE UPDATE ON public.warranty_claims
  FOR EACH ROW
  EXECUTE FUNCTION public.set_updated_at();

-- 2) warranty_claim_history
CREATE TABLE IF NOT EXISTS public.warranty_claim_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  warranty_claim_id uuid NOT NULL REFERENCES public.warranty_claims(id) ON DELETE CASCADE,
  service_id uuid NOT NULL REFERENCES public.services(id) ON DELETE CASCADE,
  action text NOT NULL CHECK (action IN ('created', 'status_changed', 'updated')),
  changed_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  details jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_warranty_claim_history_claim_id ON public.warranty_claim_history(warranty_claim_id);
CREATE INDEX IF NOT EXISTS idx_warranty_claim_history_service_id ON public.warranty_claim_history(service_id);
CREATE INDEX IF NOT EXISTS idx_warranty_claim_history_created_at ON public.warranty_claim_history(created_at DESC);

COMMENT ON TABLE public.warranty_claim_history IS 'Historie změn reklamace: vytvoření, změna statusu, úprava.';

-- 3) Rozšíření ticket_history o action warranty_claim_created
DO $$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT c.conname
    FROM pg_constraint c
    JOIN pg_attribute a ON a.attnum = ANY(c.conkey) AND a.attrelid = c.conrelid
    WHERE c.conrelid = 'public.ticket_history'::regclass
      AND c.contype = 'c'
      AND a.attname = 'action'
  LOOP
    EXECUTE format('ALTER TABLE public.ticket_history DROP CONSTRAINT %I', r.conname);
    EXIT;
  END LOOP;
END $$;

ALTER TABLE public.ticket_history
  ADD CONSTRAINT ticket_history_action_check
  CHECK (action IN ('created', 'updated', 'deleted', 'restored', 'warranty_claim_created'));

COMMENT ON COLUMN public.ticket_history.action IS 'created, updated, deleted, restored, warranty_claim_created (when a warranty claim is linked to this ticket)';

-- 4) RLS warranty_claims
ALTER TABLE public.warranty_claims ENABLE ROW LEVEL SECURITY;

CREATE POLICY "warranty_claims_select_members"
  ON public.warranty_claims FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.service_memberships m
      WHERE m.service_id = warranty_claims.service_id AND m.user_id = auth.uid()
    )
  );

CREATE POLICY "warranty_claims_insert_members"
  ON public.warranty_claims FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.service_memberships m
      WHERE m.service_id = warranty_claims.service_id AND m.user_id = auth.uid()
    )
  );

CREATE POLICY "warranty_claims_update_members"
  ON public.warranty_claims FOR UPDATE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.service_memberships m
      WHERE m.service_id = warranty_claims.service_id AND m.user_id = auth.uid()
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.service_memberships m
      WHERE m.service_id = warranty_claims.service_id AND m.user_id = auth.uid()
    )
  );

CREATE POLICY "warranty_claims_delete_members"
  ON public.warranty_claims FOR DELETE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.service_memberships m
      WHERE m.service_id = warranty_claims.service_id AND m.user_id = auth.uid()
    )
  );

-- 5) RLS warranty_claim_history
ALTER TABLE public.warranty_claim_history ENABLE ROW LEVEL SECURITY;

CREATE POLICY "warranty_claim_history_select_members"
  ON public.warranty_claim_history FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.service_memberships m
      WHERE m.service_id = warranty_claim_history.service_id AND m.user_id = auth.uid()
    )
  );

CREATE POLICY "warranty_claim_history_insert_members"
  ON public.warranty_claim_history FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.service_memberships m
      WHERE m.service_id = warranty_claim_history.service_id AND m.user_id = auth.uid()
    )
  );

-- 6) Trigger: log warranty_claim_history on insert/update
CREATE OR REPLACE FUNCTION public.warranty_claim_history_log()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_action text;
  v_details jsonb := '{}'::jsonb;
BEGIN
  IF TG_OP = 'INSERT' THEN
    v_action := 'created';
    v_details := jsonb_build_object('status', NEW.status, 'code', NEW.code);
    INSERT INTO public.warranty_claim_history (warranty_claim_id, service_id, action, changed_by, details)
    VALUES (NEW.id, NEW.service_id, v_action, auth.uid(), v_details);
    RETURN NEW;
  ELSIF TG_OP = 'UPDATE' THEN
    IF OLD.status IS DISTINCT FROM NEW.status THEN
      v_action := 'status_changed';
      v_details := jsonb_build_object('status_old', OLD.status, 'status_new', NEW.status);
    ELSE
      v_action := 'updated';
      v_details := '{}'::jsonb;
    END IF;
    INSERT INTO public.warranty_claim_history (warranty_claim_id, service_id, action, changed_by, details)
    VALUES (NEW.id, NEW.service_id, v_action, auth.uid(), v_details);
    RETURN NEW;
  END IF;
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_warranty_claim_history_log ON public.warranty_claims;
CREATE TRIGGER trg_warranty_claim_history_log
  AFTER INSERT OR UPDATE ON public.warranty_claims
  FOR EACH ROW
  EXECUTE FUNCTION public.warranty_claim_history_log();
