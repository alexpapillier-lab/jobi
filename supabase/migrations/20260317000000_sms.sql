-- SMS feature: service phone numbers, conversations, messages

-- 1. service_phone_numbers: one Twilio number per service
CREATE TABLE IF NOT EXISTS public.service_phone_numbers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  service_id uuid NOT NULL UNIQUE REFERENCES public.services(id) ON DELETE CASCADE,
  twilio_number text NOT NULL UNIQUE,
  forwarding_number text,
  active boolean NOT NULL DEFAULT true,
  provisioned_at timestamptz NOT NULL DEFAULT now(),
  twilio_sid text
);

CREATE INDEX IF NOT EXISTS idx_service_phone_numbers_service_id ON public.service_phone_numbers(service_id);
CREATE INDEX IF NOT EXISTS idx_service_phone_numbers_twilio_number ON public.service_phone_numbers(twilio_number);


-- 2. sms_conversations: one per (service, customer_phone)
CREATE TABLE IF NOT EXISTS public.sms_conversations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  service_id uuid NOT NULL REFERENCES public.services(id) ON DELETE CASCADE,
  ticket_id uuid REFERENCES public.tickets(id) ON DELETE SET NULL,
  customer_phone text NOT NULL,
  customer_name text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT sms_conversations_service_customer_uq UNIQUE (service_id, customer_phone)
);

CREATE INDEX IF NOT EXISTS idx_sms_conversations_service_id ON public.sms_conversations(service_id);
CREATE INDEX IF NOT EXISTS idx_sms_conversations_ticket_id ON public.sms_conversations(ticket_id);
CREATE INDEX IF NOT EXISTS idx_sms_conversations_service_customer ON public.sms_conversations(service_id, customer_phone);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_sms_conversations_set_updated_at') THEN
    CREATE TRIGGER trg_sms_conversations_set_updated_at
      BEFORE UPDATE ON public.sms_conversations
      FOR EACH ROW
      EXECUTE FUNCTION public.set_updated_at();
  END IF;
END $$;


-- 3. sms_messages
CREATE TABLE IF NOT EXISTS public.sms_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id uuid NOT NULL REFERENCES public.sms_conversations(id) ON DELETE CASCADE,
  direction text NOT NULL CHECK (direction IN ('outbound', 'inbound')),
  body text NOT NULL,
  sent_at timestamptz NOT NULL DEFAULT now(),
  twilio_sid text UNIQUE,
  status text,
  read_at timestamptz
);

CREATE INDEX IF NOT EXISTS idx_sms_messages_conversation_sent ON public.sms_messages(conversation_id, sent_at DESC);
CREATE INDEX IF NOT EXISTS idx_sms_messages_twilio_sid ON public.sms_messages(twilio_sid) WHERE twilio_sid IS NOT NULL;


-- 4. Trigger: update sms_conversations.updated_at on INSERT into sms_messages
CREATE OR REPLACE FUNCTION public.sms_conversation_updated_at_on_message()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.sms_conversations
  SET updated_at = now()
  WHERE id = NEW.conversation_id;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_sms_messages_conversation_updated_at ON public.sms_messages;
CREATE TRIGGER trg_sms_messages_conversation_updated_at
  AFTER INSERT ON public.sms_messages
  FOR EACH ROW
  EXECUTE FUNCTION public.sms_conversation_updated_at_on_message();


-- 5. RLS

ALTER TABLE public.service_phone_numbers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sms_conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sms_messages ENABLE ROW LEVEL SECURITY;

-- service_phone_numbers: authenticated users see only their service's row
CREATE POLICY service_phone_numbers_select ON public.service_phone_numbers
  FOR SELECT USING (
    EXISTS (SELECT 1 FROM public.service_memberships m WHERE m.service_id = service_phone_numbers.service_id AND m.user_id = auth.uid())
  );
CREATE POLICY service_phone_numbers_insert ON public.service_phone_numbers
  FOR INSERT WITH CHECK (
    EXISTS (SELECT 1 FROM public.service_memberships m WHERE m.service_id = service_phone_numbers.service_id AND m.user_id = auth.uid())
  );
CREATE POLICY service_phone_numbers_update ON public.service_phone_numbers
  FOR UPDATE USING (
    EXISTS (SELECT 1 FROM public.service_memberships m WHERE m.service_id = service_phone_numbers.service_id AND m.user_id = auth.uid())
  );

-- sms_conversations: membership-based
CREATE POLICY sms_conversations_select ON public.sms_conversations
  FOR SELECT USING (
    EXISTS (SELECT 1 FROM public.service_memberships m WHERE m.service_id = sms_conversations.service_id AND m.user_id = auth.uid())
  );
CREATE POLICY sms_conversations_insert ON public.sms_conversations
  FOR INSERT WITH CHECK (
    EXISTS (SELECT 1 FROM public.service_memberships m WHERE m.service_id = sms_conversations.service_id AND m.user_id = auth.uid())
  );
CREATE POLICY sms_conversations_update ON public.sms_conversations
  FOR UPDATE USING (
    EXISTS (SELECT 1 FROM public.service_memberships m WHERE m.service_id = sms_conversations.service_id AND m.user_id = auth.uid())
  );
CREATE POLICY sms_conversations_delete ON public.sms_conversations
  FOR DELETE USING (
    EXISTS (SELECT 1 FROM public.service_memberships m WHERE m.service_id = sms_conversations.service_id AND m.user_id = auth.uid())
  );

-- sms_messages: access via parent conversation's service
CREATE POLICY sms_messages_select ON public.sms_messages
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM public.sms_conversations c
      JOIN public.service_memberships m ON m.service_id = c.service_id AND m.user_id = auth.uid()
      WHERE c.id = sms_messages.conversation_id
    )
  );
CREATE POLICY sms_messages_insert ON public.sms_messages
  FOR INSERT WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.sms_conversations c
      JOIN public.service_memberships m ON m.service_id = c.service_id AND m.user_id = auth.uid()
      WHERE c.id = sms_messages.conversation_id
    )
  );
CREATE POLICY sms_messages_update ON public.sms_messages
  FOR UPDATE USING (
    EXISTS (
      SELECT 1 FROM public.sms_conversations c
      JOIN public.service_memberships m ON m.service_id = c.service_id AND m.user_id = auth.uid()
      WHERE c.id = sms_messages.conversation_id
    )
  );
