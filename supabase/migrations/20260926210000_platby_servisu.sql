-- ============================================================================
-- Platby servisů: kolik který servis platí měsíčně, kdy, a připomínka majiteli
-- ============================================================================
--
-- PROČ: Majitel aplikace vybírá od servisů měsíční platbu ručně (mimo
-- Stripe, který je připravený, ale nezapnutý). Potřebuje u servisu vidět
-- částku a den platby, jedním klikem si zapsat „zaplaceno za září“ a mít
-- připomínku, když někdo v den platby nezaplatil – v aplikaci (Owner
-- a upozornění po přihlášení) i e-mailem (denní tik → edge funkce
-- platby-pripominka).
--
-- Všechno jen pro majitele aplikace (je_root_owner) a servisní roli.
-- ============================================================================

-- 1) Nastavení platby u servisu ------------------------------------------------
create table if not exists public.platby_nastaveni (
  service_id uuid primary key references public.services(id) on delete cascade,
  cena_mesicne numeric not null default 0 check (cena_mesicne >= 0),
  -- Den v měsíci, kdy má platba přijít (1–28, ať existuje v každém měsíci).
  den_platby integer not null default 1 check (den_platby between 1 and 28),
  aktivni boolean not null default true,
  poznamka text,
  updated_at timestamptz not null default now()
);
alter table public.platby_nastaveni enable row level security;
drop policy if exists platby_nastaveni_root on public.platby_nastaveni;
create policy platby_nastaveni_root on public.platby_nastaveni
  for all to authenticated using (public.je_root_owner()) with check (public.je_root_owner());
revoke all on table public.platby_nastaveni from anon;
grant select, insert, update, delete on table public.platby_nastaveni to authenticated;
comment on table public.platby_nastaveni is
  'Měsíční platba servisu majiteli aplikace: částka, den platby, aktivní. Jen root owner.';

-- 2) Zapsané platby: servis × měsíc ------------------------------------------------
create table if not exists public.platby (
  id uuid primary key default gen_random_uuid(),
  service_id uuid not null references public.services(id) on delete cascade,
  -- „2026-09“
  obdobi text not null check (obdobi ~ '^[0-9]{4}-[0-9]{2}$'),
  castka numeric not null default 0,
  zaplaceno_at timestamptz not null default now(),
  poznamka text,
  created_by uuid references auth.users(id) on delete set null,
  unique (service_id, obdobi)
);
alter table public.platby enable row level security;
drop policy if exists platby_root on public.platby;
create policy platby_root on public.platby
  for all to authenticated using (public.je_root_owner()) with check (public.je_root_owner());
revoke all on table public.platby from anon;
grant select, insert, update, delete on table public.platby to authenticated;
comment on table public.platby is 'Zaplacené měsíce servisů (jen root owner).';

-- 3) Přehled pro aplikaci i e-mail --------------------------------------------------
-- Vrací každý servis s nastavením, platbou za daný měsíc a poslední platbou.
-- Stav (čeká / splatné / po splatnosti) si dopočítá klient nebo edge funkce
-- ze dne platby a data – jedno pravidlo v src/lib/platbyServisu.ts.
create or replace function public.platby_prehled(p_obdobi text default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_obdobi text := coalesce(p_obdobi, to_char(now() at time zone 'Europe/Prague', 'YYYY-MM'));
begin
  if auth.role() is distinct from 'service_role' and not public.je_root_owner() then
    raise exception 'Jen majitel aplikace.' using errcode = '42501';
  end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'serviceId', s.id,
      'nazev', s.name,
      'aktivniServis', coalesce(s.active, true),
      'cenaMesicne', coalesce(n.cena_mesicne, 0),
      'denPlatby', coalesce(n.den_platby, 1),
      'aktivni', coalesce(n.aktivni, false),
      'poznamka', n.poznamka,
      'maNastaveni', n.service_id is not null,
      'obdobi', v_obdobi,
      'zaplacenoAt', p.zaplaceno_at,
      'zaplacenoCastka', p.castka,
      'posledniObdobi', (select max(x.obdobi) from public.platby x where x.service_id = s.id)
    ) order by coalesce(n.aktivni, false) desc, s.name)
    from public.services s
    left join public.platby_nastaveni n on n.service_id = s.id
    left join public.platby p on p.service_id = s.id and p.obdobi = v_obdobi
  ), '[]'::jsonb);
end;
$$;
revoke all on function public.platby_prehled(text) from public, anon;
grant execute on function public.platby_prehled(text) to authenticated, service_role;
comment on function public.platby_prehled(text) is
  'Platby servisů za měsíc (výchozí aktuální): nastavení, zaplaceno, poslední platba. Jen root owner / service_role.';

-- 4) Tajemství a denní tik pro e-mailovou připomínku ------------------------------
do $$
begin
  if not exists (select 1 from pg_namespace where nspname = 'vault') then
    raise notice 'Vault není k dispozici – tajemství platby_cron_secret se nezaložilo.';
    return;
  end if;
  if not exists (select 1 from vault.secrets where name = 'platby_cron_secret') then
    perform vault.create_secret(
      replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', ''),
      'platby_cron_secret',
      'Sdílené tajemství pro plánované volání edge funkce platby-pripominka (pg_cron → pg_net).'
    );
  end if;
exception
  when insufficient_privilege or undefined_table or undefined_function or undefined_object then
    raise notice 'Vault se nepodařilo použít (%). Tajemství platby_cron_secret založ ručně.', sqlerrm;
end $$;

create or replace function public.platby_cron_secret()
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
  where name = 'platby_cron_secret'
  order by created_at desc
  limit 1;
  return v_secret;
end;
$$;
revoke all on function public.platby_cron_secret() from public, anon, authenticated;
grant execute on function public.platby_cron_secret() to service_role;

create or replace function public.platby_tick()
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
    raise notice 'pg_net není zapnutý – platby_tick nemá jak zavolat edge funkci.';
    return;
  end if;
  v_secret := public.platby_cron_secret();
  if v_secret is null or v_secret = '' then
    raise notice 'Chybí tajemství platby_cron_secret ve Vaultu – tik se přeskočil.';
    return;
  end if;
  select net.http_post(
    url := 'https://ijtvcgolsdsrquqbvjrz.supabase.co/functions/v1/platby-pripominka',
    body := jsonb_build_object('secret', v_secret),
    headers := '{"Content-Type": "application/json"}'::jsonb,
    timeout_milliseconds := 30000
  ) into v_request_id;
end;
$$;
revoke all on function public.platby_tick() from public, anon, authenticated;
grant execute on function public.platby_tick() to service_role;

do $$
begin
  if not exists (select 1 from pg_available_extensions where name = 'pg_cron') then
    raise notice 'pg_cron není k dispozici – připomínka plateb se nenaplánovala.';
    return;
  end if;
  create extension if not exists pg_cron;
  perform cron.unschedule('jobi-platby-pripominka')
  where exists (select 1 from cron.job where jobname = 'jobi-platby-pripominka');
  -- 6:10 UTC = 8:10 letního / 7:10 zimního času v Praze; jednou denně.
  perform cron.schedule('jobi-platby-pripominka', '10 6 * * *', 'SELECT public.platby_tick()');
exception
  when insufficient_privilege or undefined_table or undefined_function or undefined_object then
    raise notice 'pg_cron se nepodařilo nastavit (%). Tik platby_tick() naplánuj ručně.', sqlerrm;
end $$;
