-- Povolit Realtime (postgres_changes) pro ticket_comments, ať se nové/připnuté
-- komentáře objeví u všech kolegů na všech zařízeních v reálném čase.
DO $$
BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.ticket_comments;
EXCEPTION WHEN OTHERS THEN
  IF SQLERRM NOT LIKE '%already member%' THEN RAISE; END IF;
END $$;
