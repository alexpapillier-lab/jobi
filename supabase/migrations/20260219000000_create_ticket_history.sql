-- Ticket history: audit log for ticket create/update/delete/restore
CREATE TABLE IF NOT EXISTS public.ticket_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_id uuid NOT NULL REFERENCES public.tickets(id) ON DELETE CASCADE,
  service_id uuid NOT NULL REFERENCES public.services(id) ON DELETE CASCADE,
  action text NOT NULL CHECK (action IN ('created', 'updated', 'deleted', 'restored')),
  changed_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  details jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ticket_history_ticket_id ON public.ticket_history(ticket_id);
CREATE INDEX IF NOT EXISTS idx_ticket_history_service_id ON public.ticket_history(service_id);
CREATE INDEX IF NOT EXISTS idx_ticket_history_created_at ON public.ticket_history(created_at DESC);

ALTER TABLE public.ticket_history ENABLE ROW LEVEL SECURITY;

-- Members of the ticket's service can read history
CREATE POLICY "ticket_history_select_service_members"
  ON public.ticket_history
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.service_memberships m
      WHERE m.service_id = ticket_history.service_id AND m.user_id = auth.uid()
    )
  );

-- Only the trigger (and service members via app) insert; use WITH CHECK same as select for consistency
CREATE POLICY "ticket_history_insert_service_members"
  ON public.ticket_history
  FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.service_memberships m
      WHERE m.service_id = ticket_history.service_id AND m.user_id = auth.uid()
    )
  );

COMMENT ON TABLE public.ticket_history IS 'Audit log of ticket lifecycle: created, updated, soft-deleted, restored.';

-- Trigger function: log ticket changes (runs as invoking user so RLS and auth.uid() apply)
CREATE OR REPLACE FUNCTION public.ticket_history_log()
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
    v_details := jsonb_build_object('title', COALESCE(NEW.title, ''));
  ELSIF TG_OP = 'UPDATE' THEN
    IF OLD.deleted_at IS NULL AND NEW.deleted_at IS NOT NULL THEN
      v_action := 'deleted';
    ELSIF OLD.deleted_at IS NOT NULL AND NEW.deleted_at IS NULL THEN
      v_action := 'restored';
    ELSE
      v_action := 'updated';
      v_details := jsonb_build_object(
        'status_old', OLD.status,
        'status_new', NEW.status,
        'title_old', OLD.title,
        'title_new', NEW.title
      );
    END IF;
  ELSE
    RETURN NULL;
  END IF;

  INSERT INTO public.ticket_history (ticket_id, service_id, action, changed_by, details)
  VALUES (NEW.id, NEW.service_id, v_action, auth.uid(), v_details);
  RETURN COALESCE(NEW, OLD);
END;
$$;

DROP TRIGGER IF EXISTS trg_ticket_history_log ON public.tickets;
CREATE TRIGGER trg_ticket_history_log
  AFTER INSERT OR UPDATE ON public.tickets
  FOR EACH ROW
  EXECUTE FUNCTION public.ticket_history_log();
