-- Úklid po odesílání provizí do Google Sheets
--
-- Provize jsou od 18. 9. 2026 přímo v Jobi (provize_*, jen majitel aplikace),
-- historie z tabulky je naimportovaná a ověřená (1060 řádků). Edge funkce
-- provize-sheets, její plánovač a pomocné objekty už nejsou potřeba – a
-- config.provize_sheets nemá co dělat v nastavení, které čtou členové servisu.

do $$
begin
  perform cron.unschedule('jobi-provize-sheets')
  where exists (select 1 from cron.job where jobname = 'jobi-provize-sheets');
exception
  when undefined_table or undefined_function or invalid_schema_name or insufficient_privilege then
    raise notice 'pg_cron: úlohu jobi-provize-sheets se nepodařilo zrušit (%).', sqlerrm;
end $$;

drop function if exists public.provize_sheets_tick();
drop function if exists public.provize_sheets_cron_secret();

do $$
begin
  delete from vault.secrets where name = 'provize_sheets_cron_secret';
exception
  when undefined_table or invalid_schema_name or insufficient_privilege then
    raise notice 'Vault: tajemství provize_sheets_cron_secret se nepodařilo smazat (%).', sqlerrm;
end $$;

drop table if exists public.provize_sheets_behy;

update public.service_settings
set config = config - 'provize_sheets'
where config ? 'provize_sheets';
