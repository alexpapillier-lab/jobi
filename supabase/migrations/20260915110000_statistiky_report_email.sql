-- Report statistik e-mailem.
--
-- Majitel servisu si v Nastavení → Komunikace → Report statistik zapne,
-- že mu (a komu chce) má jednou za měsíc nebo týden přijít PDF se
-- statistikami: obrat, zisk, marže, počty zakázek, nejčastější opravy a
-- zařízení, hodnotní a pravidelní zákazníci, technici, pobočky.
--
-- Nastavení žije v service_settings.config.statistiky_report (žádná nová
-- tabulka pro nastavení – stejně jako rezervace nebo chat). Tady je jen:
--   1) záznam o odeslání – tlumí duplicity (klíč období) a ukazuje se
--      v Nastavení jako „naposledy odesláno“,
--   2) tajemství pro cron a hodinový tik, který volá edge funkci
--      statistics-report-send. Stejný vzor jako alerts-check.
--
-- Tik je hodinový schválně: servis si volí hodinu odeslání a report se
-- odešle v první hodině daného dne (1. v měsíci / pondělí), která je
-- rovna nebo pozdější. Když odeslání selže, další hodina to zkusí znovu;
-- co odešlo, se podle klíče období už neopakuje.

-- 1) Záznamy o odeslání --------------------------------------------------------
create table if not exists public.statistiky_report_odeslani (
  id uuid primary key default gen_random_uuid(),
  service_id uuid not null references public.services(id) on delete cascade,
  -- „2026-08“, „2026-W36“; ruční odeslání má vlastní klíče s příponou.
  klic text not null,
  frekvence text not null check (frekvence in ('mesicne', 'tydne')),
  nazev_obdobi text not null default '',
  prijemci text[] not null default '{}'::text[],
  -- true = plánované z cronu, false = ručně z Nastavení (Poslat teď / zkušební).
  planovane boolean not null default true,
  ok boolean not null default true,
  chyba text,
  sent_at timestamptz not null default now()
);

create index if not exists statistiky_report_odeslani_service_idx
  on public.statistiky_report_odeslani (service_id, sent_at desc);

-- Plánované odeslání za jedno období jen jednou (neúspěšné pokusy se smí opakovat).
create unique index if not exists statistiky_report_odeslani_klic_uidx
  on public.statistiky_report_odeslani (service_id, klic)
  where planovane and ok;

alter table public.statistiky_report_odeslani enable row level security;

-- Členové servisu vidí, kdy a komu report odešel; zapisuje jen edge funkce
-- pod service_role (žádná politika pro insert/update/delete).
drop policy if exists "statistiky_report_odeslani_cteni" on public.statistiky_report_odeslani;
create policy "statistiky_report_odeslani_cteni"
  on public.statistiky_report_odeslani
  for select
  to authenticated
  using (
    exists (
      select 1 from public.service_memberships m
      where m.service_id = statistiky_report_odeslani.service_id
        and m.user_id = auth.uid()
    )
  );

revoke all on table public.statistiky_report_odeslani from anon;
grant select on table public.statistiky_report_odeslani to authenticated;

comment on table public.statistiky_report_odeslani is
  'Odeslané e-mailové reporty statistik (statistics-report-send). Tlumení duplicit podle klíče období a přehled v Nastavení.';

-- 2) Tajemství pro cron (Vault) ----------------------------------------------
do $$
begin
  if not exists (select 1 from pg_namespace where nspname = 'vault') then
    raise notice 'Vault není k dispozici – tajemství statistiky_report_cron_secret se nezaložilo. Zapni supabase_vault a spusť migraci znovu.';
    return;
  end if;
  if not exists (select 1 from vault.secrets where name = 'statistiky_report_cron_secret') then
    perform vault.create_secret(
      replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', ''),
      'statistiky_report_cron_secret',
      'Sdílené tajemství pro plánované volání edge funkce statistics-report-send (pg_cron → pg_net).'
    );
    raise notice 'Založeno tajemství statistiky_report_cron_secret.';
  end if;
exception
  when insufficient_privilege or undefined_table or undefined_function or undefined_object then
    raise notice 'Vault se nepodařilo použít (%). Tajemství statistiky_report_cron_secret založ ručně.', sqlerrm;
end $$;

create or replace function public.statistiky_report_cron_secret()
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
  where name = 'statistiky_report_cron_secret'
  order by created_at desc
  limit 1;
  return v_secret;
end;
$$;

revoke all on function public.statistiky_report_cron_secret() from public, anon, authenticated;
grant execute on function public.statistiky_report_cron_secret() to service_role;

comment on function public.statistiky_report_cron_secret() is
  'Vrátí tajemství statistiky_report_cron_secret z Vaultu. Jen service_role – edge funkce jím ověří plánované volání.';

-- 3) Hodinový tik ----------------------------------------------------------------
create or replace function public.statistiky_report_tick()
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
    raise notice 'pg_net není zapnutý – statistiky_report_tick nemá jak zavolat edge funkci.';
    return;
  end if;

  v_secret := public.statistiky_report_cron_secret();
  if v_secret is null or v_secret = '' then
    raise notice 'Chybí tajemství statistiky_report_cron_secret ve Vaultu – tik se přeskočil.';
    return;
  end if;

  select net.http_post(
    url := 'https://ijtvcgolsdsrquqbvjrz.supabase.co/functions/v1/statistics-report-send',
    body := jsonb_build_object('secret', v_secret, 'mode', 'scheduled'),
    headers := '{"Content-Type": "application/json"}'::jsonb,
    -- Víc servisů × PDF × e-mail – nechat rezervu.
    timeout_milliseconds := 120000
  ) into v_request_id;
end;
$$;

revoke all on function public.statistiky_report_tick() from public, anon, authenticated;
grant execute on function public.statistiky_report_tick() to service_role;

comment on function public.statistiky_report_tick() is
  'Plánovaný tik: přes pg_net zavolá edge funkci statistics-report-send v režimu scheduled. Spouští pg_cron (jobi-statistiky-report).';

do $$
begin
  if not exists (select 1 from pg_available_extensions where name = 'pg_cron') then
    raise notice 'pg_cron není k dispozici – report statistik se nenaplánoval. Zapni ho v Supabase → Database → Extensions a spusť migraci znovu.';
    return;
  end if;
  create extension if not exists pg_cron;
  perform cron.unschedule('jobi-statistiky-report')
  where exists (select 1 from cron.job where jobname = 'jobi-statistiky-report');
  -- Minuta 20, ať se nepotká s hlídačem (:05) a automatizacemi (:00, :15, :30, :45).
  perform cron.schedule('jobi-statistiky-report', '20 * * * *', 'SELECT public.statistiky_report_tick()');
  raise notice 'Report statistik naplánován každou hodinu (jobi-statistiky-report).';
exception
  when insufficient_privilege or undefined_table or undefined_function or undefined_object then
    raise notice 'pg_cron se nepodařilo nastavit (%). Tik statistiky_report_tick() je potřeba naplánovat ručně.', sqlerrm;
end $$;
