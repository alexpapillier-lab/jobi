-- Archive SMS conversations from sidebar list; chat stays available on the ticket
ALTER TABLE public.sms_conversations
  ADD COLUMN IF NOT EXISTS archived boolean NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS idx_sms_conversations_service_archived ON public.sms_conversations(service_id, archived);
COMMENT ON COLUMN public.sms_conversations.archived IS 'When true, conversation is hidden from sidebar SMS list but still visible when opening the ticket.';
