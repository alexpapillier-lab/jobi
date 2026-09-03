-- Realtime pro service_settings.
--
-- Údaje firmy (IČO, DIČ, adresa, bankovní účet – použité při generování
-- faktur) a nabídky stavů zařízení/způsobů předání byly do teď jen
-- v localStorage, tedy zvlášť pro každé zařízení. Se dvěma lidmi na dvou
-- počítačích šlo mít na fakturách různé fakturační údaje podle toho,
-- kdo je vygeneroval. RPC update_service_settings a tabulka i RLS na
-- to už existují (viz 20250108000000_create_service_settings.sql
-- a 20260216110000_enforce_can_manage_documents.sql) – chybělo jen
-- zapnout realtime, ať se změna propíše kolegům bez obnovení stránky.
DO $$
BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.service_settings;
EXCEPTION WHEN OTHERS THEN
  IF SQLERRM NOT LIKE '%already member%' THEN RAISE; END IF;
END $$;
