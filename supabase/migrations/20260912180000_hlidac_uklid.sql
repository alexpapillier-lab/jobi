-- Úklid po syntetickém hlídači.
--
-- Hlídač (scripts/hlidac/, workflow „Hlídač provozu") každých 15 minut založí
-- v E2E testovacím servisu zakázku a hned ji zase smaže – jinak by se nedalo
-- ověřit, že příjem u pultu funguje. „Smazat" ale v Jobi znamená přesunout do
-- koše: DELETE politika na `tickets` je restriktivní a povolující žádná není,
-- takže `authenticated` řádek natvrdo odstranit nemůže (a nemá – zakázku
-- v koši musí jít vrátit).
--
-- Bez tohohle úklidu by v koši testovacího servisu přibývalo 96 zakázek denně,
-- tedy asi 35 000 za rok. Maže se stejným způsobem jako `rate_hits_uklid`,
-- `alerts_uklid` a `purge_old_error_logs`: denní úloha pg_cron.
--
-- Dvě pojistky, aby se to nikdy nedotklo zákaznických dat:
--   1) jen servis 882beee7-… (E2E testovací),
--   2) jen zakázky s číslem začínajícím na „HLIDAC-" a už v koši.
-- Obě musí platit zároveň.

create or replace function public.hlidac_uklid()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_smazano integer;
begin
  delete from public.tickets
   where service_id = '882beee7-4564-4d10-8ac6-16dc19240b57'
     and code like 'HLIDAC-%'
     and deleted_at is not null
     -- Dva dny odkladu: kdyby hlídač hlásil něco divného, má být na co se
     -- podívat. Vejde se do toho i víkend bez nasazení.
     and deleted_at < now() - interval '2 days';
  get diagnostics v_smazano = row_count;
  return v_smazano;
end;
$$;

revoke all on function public.hlidac_uklid() from public, anon, authenticated;
grant execute on function public.hlidac_uklid() to service_role;

comment on function public.hlidac_uklid() is
  'Maže staré zakázky syntetického hlídače z koše E2E testovacího servisu. Jinam nesahá.';

do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.unschedule('jobi-uklid-hlidace') where exists (select 1 from cron.job where jobname = 'jobi-uklid-hlidace');
    -- 03:40 UTC – mimo zálohu databáze (02:30) i mimo pracovní dobu servisů.
    perform cron.schedule('jobi-uklid-hlidace', '40 3 * * *', 'SELECT public.hlidac_uklid()');
  else
    raise notice 'pg_cron není zapnutý – naplánuj jobi-uklid-hlidace ručně.';
  end if;
end $$;
