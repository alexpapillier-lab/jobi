-- Realtime pro příchozí SMS → živý badge u zakázky v přehledu (Orders).
DO $$
BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.sms_messages;
EXCEPTION WHEN OTHERS THEN
  IF SQLERRM NOT LIKE '%already member%' THEN RAISE; END IF;
END $$;
