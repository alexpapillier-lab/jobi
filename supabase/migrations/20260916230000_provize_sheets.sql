-- Provize do Google Sheets: náhrada bota zakazkovylist-bot.
--
-- Bot dosud přes Playwright projížděl seznam zakázek v Zakázkovém listu a
-- zakázky ve stavu „Připraveno k převzetí“ / „Vydáno“ posílal do Apps
-- Scriptu nad tabulkou provizí. Zakázky teď žijí v Jobi, takže totéž dělá
-- edge funkce provize-sheets nad tabulkou tickets – stejný endpoint, stejný
-- tvar řádků, tabulka ani Apps Script se nemění.
--
-- Zapnutí per servis v service_settings.config.provize_sheets:
--   { "zapnuto": true, "endpoint": "https://script.google.com/…/exec",
--     "statusy": ["Připraveno k převzetí", "Vydáno"], "od": "2026-09-16" }
-- „statusy“ jsou názvy statusů v Jobi (první = připraveno, druhý = vydáno).
-- „od“ je volitelné datum: zakázky, které v tabulce ještě nejsou, se přidají
-- jen když se do sledovaného stavu dostaly v Jobi od tohoto data (podle
-- ticket_history) nebo byly od té doby založené – importovaná historie ze ZL
-- se tak sama nezačne účtovat. Co v tabulce už je, se uzavírá a doplácí vždy.

-- 1) Záznam běhů (co se poslalo) ---------------------------------------------
create table if not exists public.provize_sheets_behy (
  id bigint generated always as identity primary key,
  service_id uuid not null references public.services(id) on delete cascade,
  started_at timestamptz not null default now(),
  ok boolean not null,
  rezim text not null default 'scheduled',
  poslano integer not null default 0,
  doplatky integer not null default 0,
  opraveno integer not null default 0,
  chyba text,
  detail jsonb not null default '[]'::jsonb
);

create index if not exists provize_sheets_behy_service_idx
  on public.provize_sheets_behy (service_id, started_at desc);

alter table public.provize_sheets_behy enable row level security;

-- Čtou vlastníci a správci servisu (přehled v Nastavení); zápis jen service_role.
drop policy if exists provize_sheets_behy_select on public.provize_sheets_behy;
create policy provize_sheets_behy_select on public.provize_sheets_behy
  for select to authenticated
  using (
    exists (
      select 1 from public.service_memberships m
      where m.service_id = provize_sheets_behy.service_id
        and m.user_id = auth.uid()
        and m.role in ('owner', 'admin')
    )
  );

revoke all on table public.provize_sheets_behy from anon;
grant select on table public.provize_sheets_behy to authenticated;

comment on table public.provize_sheets_behy is
  'Běhy odesílání provizí do Google Sheets (provize-sheets). Detail = odeslané řádky.';

-- 2) Tajemství pro cron (Vault) ----------------------------------------------
do $$
begin
  if not exists (select 1 from pg_namespace where nspname = 'vault') then
    raise notice 'Vault není k dispozici – tajemství provize_sheets_cron_secret se nezaložilo.';
    return;
  end if;
  if not exists (select 1 from vault.secrets where name = 'provize_sheets_cron_secret') then
    perform vault.create_secret(
      replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', ''),
      'provize_sheets_cron_secret',
      'Sdílené tajemství pro plánované volání edge funkce provize-sheets (pg_cron → pg_net).'
    );
    raise notice 'Založeno tajemství provize_sheets_cron_secret.';
  end if;
exception
  when insufficient_privilege or undefined_table or undefined_function or undefined_object then
    raise notice 'Vault se nepodařilo použít (%). Tajemství provize_sheets_cron_secret založ ručně.', sqlerrm;
end $$;

create or replace function public.provize_sheets_cron_secret()
returns text
language plpgsql
security definer
stable
set search_path = public, vault, extensions
as $$
declare
  v_secret text;
begin
  select decrypted_secret into v_secret
  from vault.decrypted_secrets
  where name = 'provize_sheets_cron_secret'
  order by created_at desc
  limit 1;
  return v_secret;
end;
$$;

revoke all on function public.provize_sheets_cron_secret() from public, anon, authenticated;
grant execute on function public.provize_sheets_cron_secret() to service_role;

-- 3) Tik ------------------------------------------------------------------------
create or replace function public.provize_sheets_tick()
returns void
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_secret text;
  v_request_id bigint;
begin
  if not exists (select 1 from pg_extension where extname = 'pg_net') then
    raise notice 'pg_net není zapnutý – provize_sheets_tick nemá jak zavolat edge funkci.';
    return;
  end if;

  v_secret := public.provize_sheets_cron_secret();
  if v_secret is null or v_secret = '' then
    raise notice 'Chybí tajemství provize_sheets_cron_secret ve Vaultu – tik se přeskočil.';
    return;
  end if;

  select net.http_post(
    url := 'https://ijtvcgolsdsrquqbvjrz.supabase.co/functions/v1/provize-sheets',
    body := jsonb_build_object('secret', v_secret, 'mode', 'scheduled'),
    headers := '{"Content-Type": "application/json"}'::jsonb,
    -- Apps Script umí odpovídat pomalu (studený start) a řádků může být víc dávek.
    timeout_milliseconds := 120000
  ) into v_request_id;
end;
$$;

revoke all on function public.provize_sheets_tick() from public, anon, authenticated;
grant execute on function public.provize_sheets_tick() to service_role;

comment on function public.provize_sheets_tick() is
  'Plánovaný tik: přes pg_net zavolá edge funkci provize-sheets. Spouští pg_cron (jobi-provize-sheets).';

do $$
begin
  if not exists (select 1 from pg_available_extensions where name = 'pg_cron') then
    raise notice 'pg_cron není k dispozici – provize do Sheets se nenaplánovaly.';
    return;
  end if;
  create extension if not exists pg_cron;
  perform cron.unschedule('jobi-provize-sheets')
  where exists (select 1 from cron.job where jobname = 'jobi-provize-sheets');
  -- Bot běžel každé 2 hodiny; minuta 40, ať se nepotká s automatizacemi
  -- (:00/:15/:30/:45), hlídačem (:05) a reportem statistik (:20).
  perform cron.schedule('jobi-provize-sheets', '40 */2 * * *', 'SELECT public.provize_sheets_tick()');
  raise notice 'Provize do Sheets naplánovány každé 2 hodiny (jobi-provize-sheets).';
exception
  when insufficient_privilege or undefined_table or undefined_function or undefined_object then
    raise notice 'pg_cron se nepodařilo nastavit (%). Tik provize_sheets_tick() je potřeba naplánovat ručně.', sqlerrm;
end $$;
