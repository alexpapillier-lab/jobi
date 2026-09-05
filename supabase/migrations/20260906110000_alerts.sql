-- Hlídač provozu: co už bylo odesláno a hodinový tik.
--
-- Chyby z aplikace padají do error_logs, ale nikdo se tam sám od sebe nedívá.
-- Edge funkce alerts-check jednou za hodinu zkontroluje poslední okno a při
-- něčem nezdravém pošle e-mail. Tahle tabulka drží, co už odešlo, aby při
-- delším výpadku nechodil stejný e-mail každou hodinu.
create table if not exists public.alert_events (
  id uuid primary key default gen_random_uuid(),
  kind text not null,
  detail jsonb not null default '{}'::jsonb,
  sent_at timestamptz not null default now()
);

create index if not exists alert_events_kind_sent_idx on public.alert_events (kind, sent_at desc);

alter table public.alert_events enable row level security;
-- Žádná politika = přístup má jen service_role. Provozní upozornění nejsou
-- data servisu a v aplikaci se nezobrazují.
revoke all on table public.alert_events from anon, authenticated;

comment on table public.alert_events is
  'Odeslaná provozní upozornění (hlídač alerts-check). Slouží k tlumení opakovaných e-mailů.';

-- Tajemství pro cron, stejný postup jako u automatizací.
create or replace function public.alerts_cron_secret()
returns text
language plpgsql
security definer
set search_path = public, vault
as $$
declare
  v_secret text;
begin
  select decrypted_secret into v_secret
  from vault.decrypted_secrets
  where name = 'alerts_cron_secret'
  order by created_at desc
  limit 1;
  return v_secret;
end;
$$;

revoke all on function public.alerts_cron_secret() from public, anon, authenticated;
grant execute on function public.alerts_cron_secret() to service_role;

create or replace function public.alerts_tick()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_secret text;
  v_request_id bigint;
begin
  if not exists (select 1 from pg_extension where extname = 'pg_net') then
    raise notice 'pg_net není zapnutý – alerts_tick nemá jak zavolat edge funkci.';
    return;
  end if;

  v_secret := public.alerts_cron_secret();
  if v_secret is null or v_secret = '' then
    raise notice 'Chybí tajemství alerts_cron_secret ve Vaultu – tik se přeskočil.';
    return;
  end if;

  select net.http_post(
    url := 'https://ijtvcgolsdsrquqbvjrz.supabase.co/functions/v1/alerts-check',
    body := jsonb_build_object('secret', v_secret, 'windowMinutes', 60),
    headers := '{"Content-Type": "application/json"}'::jsonb,
    timeout_milliseconds := 60000
  ) into v_request_id;
end;
$$;

revoke all on function public.alerts_tick() from public, anon, authenticated;

-- Úklid: upozornění starší než rok nikoho nezajímají.
create or replace function public.alerts_uklid()
returns void
language sql
security definer
set search_path = public
as $$
  delete from public.alert_events where sent_at < now() - interval '1 year';
$$;

do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.unschedule('jobi-alerts') where exists (select 1 from cron.job where jobname = 'jobi-alerts');
    perform cron.schedule('jobi-alerts', '5 * * * *', 'SELECT public.alerts_tick()');
  else
    raise notice 'pg_cron není zapnutý – naplánuj jobi-alerts ručně.';
  end if;
end $$;
