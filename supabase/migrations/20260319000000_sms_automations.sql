-- SMS automations: send template message when ticket status changes to a given status
CREATE TABLE IF NOT EXISTS public.sms_automations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  service_id uuid NOT NULL REFERENCES public.services(id) ON DELETE CASCADE,
  trigger_status_key text NOT NULL,
  message_template text NOT NULL DEFAULT '',
  active boolean NOT NULL DEFAULT true,
  sort_order int NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_sms_automations_service_status ON public.sms_automations(service_id, trigger_status_key);
COMMENT ON TABLE public.sms_automations IS 'When ticket status changes to trigger_status_key, send message_template (with variables) via SMS to customer. Variables: {{code}}, {{customer_name}}, {{device_label}}, {{total_price}}, {{status}}, {{notes}}';

ALTER TABLE public.sms_automations ENABLE ROW LEVEL SECURITY;

CREATE POLICY sms_automations_select ON public.sms_automations
  FOR SELECT USING (
    EXISTS (SELECT 1 FROM public.service_memberships m WHERE m.service_id = sms_automations.service_id AND m.user_id = auth.uid())
  );
CREATE POLICY sms_automations_insert ON public.sms_automations
  FOR INSERT WITH CHECK (
    EXISTS (SELECT 1 FROM public.service_memberships m WHERE m.service_id = sms_automations.service_id AND m.user_id = auth.uid())
  );
CREATE POLICY sms_automations_update ON public.sms_automations
  FOR UPDATE USING (
    EXISTS (SELECT 1 FROM public.service_memberships m WHERE m.service_id = sms_automations.service_id AND m.user_id = auth.uid())
  );
CREATE POLICY sms_automations_delete ON public.sms_automations
  FOR DELETE USING (
    EXISTS (SELECT 1 FROM public.service_memberships m WHERE m.service_id = sms_automations.service_id AND m.user_id = auth.uid())
  );
