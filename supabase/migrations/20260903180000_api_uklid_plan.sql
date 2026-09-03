-- Naplánování úklidu záznamů o využití API.
--
-- api_read_hits jinak roste donekonečna: jeden řádek na servis, minutu
-- a endpoint, plus jeden na každou volající adresu. Funkce
-- api_uklid_starych_zaznamu() existuje od migrace 20260903160000,
-- ale nikdo ji nevolal.
--
-- Celé je to podmíněné. Když projekt pg_cron nemá, migrace se jen
-- přeskočí a napíše upozornění – nasazení kvůli tomu padnout nesmí.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_available_extensions WHERE name = 'pg_cron') THEN
    RAISE NOTICE 'pg_cron není k dispozici – úklid API se nenaplánoval. Zapni ho v Supabase → Database → Extensions a spusť migraci znovu.';
    RETURN;
  END IF;

  CREATE EXTENSION IF NOT EXISTS pg_cron;

  -- Stejný název přepíše dřívější plán, takže opakované spuštění migrace
  -- nenadělá deset úloh.
  PERFORM cron.unschedule('jobi-uklid-api')
  WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'jobi-uklid-api');

  -- Každý den ve 3:20 ráno. Přesná hodina nehraje roli, jde o to, aby to
  -- nebylo ve špičce.
  PERFORM cron.schedule(
    'jobi-uklid-api',
    '20 3 * * *',
    'SELECT public.api_uklid_starych_zaznamu()'
  );

  RAISE NOTICE 'Úklid API naplánován na 3:20 denně.';
EXCEPTION
  WHEN insufficient_privilege OR undefined_table OR undefined_function OR undefined_object THEN
    RAISE NOTICE 'pg_cron se nepodařilo nastavit (%). Úklid je potřeba naplánovat ručně.', SQLERRM;
END $$;
