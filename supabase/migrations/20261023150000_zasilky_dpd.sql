-- Přeprava DPD přímo ze Zásilek (přesuny mezi pobočkami).
--
-- U zásilky jde objednat DPD: štítek (podání na výdejním místě) nebo kurýra
-- (svoz na den). Volání DPD dělá edge funkce zasilka-dpd s klíčem servisu
-- z Vaultu; klient sem nikdy nezapisuje a klíč nevidí.
--
-- Funkce je zatím jen pro servisy, kterým ji zapne majitel aplikace
-- (Owner → Přeprava DPD) a zadá jim účet DPD. Bez nastavení se v Zásilkách
-- nic neukáže.
--
--   preprava_dpd                – nastavení servisu (zapnuto, DSW, test/ostré)
--   preprava_dpd_nastav()       – zápis nastavení a klíče (jen root owner)
--   preprava_dpd_klic()         – klíč z Vaultu (jen service_role)
--   ticket_shipment_dpd         – objednávky DPD k zásilkám (zapisuje jen funkce)
--   zasilka_dpd_smi()           – smí přihlášený objednat DPD k zásilce?
--   preprava_dpd_tick()         – hodinový tik: sledování odeslaných balíků

-- ── 1. Nastavení servisu ────────────────────────────────────────────────────
create table if not exists public.preprava_dpd (
  service_id uuid primary key references public.services(id) on delete cascade,
  zapnuto boolean not null default false,
  dsw text,
  testovaci boolean not null default false,
  ma_klic boolean not null default false,
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id) on delete set null
);
comment on table public.preprava_dpd is
  'Přeprava DPD ze Zásilek: zapnutí a účet DPD servisu. Klíč API je ve Vaultu (dpd_api_key:<service_id>), tady jen příznak ma_klic. Zapisuje jen preprava_dpd_nastav (root owner).';

alter table public.preprava_dpd enable row level security;
-- Zapisuje jen preprava_dpd_nastav (security definer); klient nic.
revoke all on public.preprava_dpd from anon;
revoke insert, update, delete on public.preprava_dpd from authenticated;

-- Členové servisu vidí, jestli je přeprava zapnutá (tlačítko v Zásilkách);
-- root owner vidí všechny servisy (Owner).
drop policy if exists "preprava_dpd_cte" on public.preprava_dpd;
create policy "preprava_dpd_cte" on public.preprava_dpd
  for select to authenticated
  using (public.zasilka_clen(service_id) or public.je_root_owner());

create or replace function public.preprava_dpd_nastav(
  p_service_id uuid,
  p_zapnuto boolean,
  p_dsw text,
  p_testovaci boolean,
  p_klic text default null
)
returns void
language plpgsql
security definer
set search_path = public, vault, extensions
as $$
declare
  v_nazev text := 'dpd_api_key:' || p_service_id::text;
  v_id uuid;
  v_klic text := nullif(btrim(coalesce(p_klic, '')), '');
begin
  if not public.je_root_owner() then
    raise exception 'Přepravu DPD nastavuje jen majitel aplikace.' using errcode = '42501';
  end if;
  if not exists (select 1 from public.services where id = p_service_id) then
    raise exception 'Servis neexistuje.' using errcode = 'P0002';
  end if;
  if v_klic is not null then
    select id into v_id from vault.secrets where name = v_nazev;
    if v_id is null then
      perform vault.create_secret(v_klic, v_nazev, 'Klíč DPD GeoAPI servisu (Zásilky → Objednat DPD).');
    else
      perform vault.update_secret(v_id, v_klic);
    end if;
  end if;
  insert into public.preprava_dpd as p (service_id, zapnuto, dsw, testovaci, ma_klic, updated_at, updated_by)
  values (p_service_id, coalesce(p_zapnuto, false), nullif(btrim(coalesce(p_dsw, '')), ''), coalesce(p_testovaci, false),
          v_klic is not null or exists (select 1 from vault.secrets where name = v_nazev), now(), auth.uid())
  on conflict (service_id) do update
     set zapnuto = excluded.zapnuto, dsw = excluded.dsw, testovaci = excluded.testovaci,
         ma_klic = excluded.ma_klic, updated_at = now(), updated_by = auth.uid();
end;
$$;
revoke all on function public.preprava_dpd_nastav(uuid, boolean, text, boolean, text) from public, anon;
grant execute on function public.preprava_dpd_nastav(uuid, boolean, text, boolean, text) to authenticated;

create or replace function public.preprava_dpd_klic(p_service_id uuid)
returns text
language plpgsql
security definer
stable
set search_path = public, vault, extensions
as $$
declare
  v text;
begin
  select decrypted_secret into v from vault.decrypted_secrets
   where name = 'dpd_api_key:' || p_service_id::text
   order by created_at desc limit 1;
  return v;
end;
$$;
revoke all on function public.preprava_dpd_klic(uuid) from public, anon, authenticated;
grant execute on function public.preprava_dpd_klic(uuid) to service_role;

-- ── 2. Objednávky DPD k zásilkám ────────────────────────────────────────────
create table if not exists public.ticket_shipment_dpd (
  id uuid primary key default gen_random_uuid(),
  service_id uuid not null references public.services(id) on delete cascade,
  shipment_id uuid not null references public.ticket_shipments(id) on delete restrict,
  mode text not null check (mode in ('label', 'courier')),
  parcels integer not null check (parcels between 1 and 10),
  testovaci boolean not null default false,
  dpd_shipment_id text,
  parcel_numbers text[] not null default '{}',
  pickup_order_id text,
  pickup_date date,
  status text not null check (status in ('created', 'pickup_ordered', 'in_transit', 'delivered', 'cancelled')),
  status_text text,
  delivered_at timestamptz,
  tracking_at timestamptz,
  label_pdf text,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  cancelled_by uuid references auth.users(id) on delete set null,
  cancelled_at timestamptz
);
comment on table public.ticket_shipment_dpd is
  'Objednávky DPD k zásilkám mezi pobočkami. Zapisuje jen edge funkce zasilka-dpd (service_role). label_pdf = štítek PDF v base64.';

-- Jedna živá objednávka na zásilku; po zrušení jde objednat znovu.
create unique index if not exists ticket_shipment_dpd_jedna_ziva
  on public.ticket_shipment_dpd (shipment_id) where status <> 'cancelled';
create index if not exists ticket_shipment_dpd_sledovat
  on public.ticket_shipment_dpd (status) where status in ('created', 'pickup_ordered', 'in_transit');

alter table public.ticket_shipment_dpd enable row level security;
revoke all on public.ticket_shipment_dpd from anon;
revoke insert, update, delete on public.ticket_shipment_dpd from authenticated;

drop policy if exists "ticket_shipment_dpd_cte" on public.ticket_shipment_dpd;
create policy "ticket_shipment_dpd_cte" on public.ticket_shipment_dpd
  for select to authenticated
  using (public.zasilka_clen(service_id));
-- Žádné insert/update/delete politiky: zapisuje jen service_role.

-- Koncept s objednaným DPD nejde smazat (zásilka by u DPD visela bez vazby).
create or replace function public.ticket_shipments_dpd_nesmazat()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if exists (select 1 from public.ticket_shipment_dpd d where d.shipment_id = old.id and d.status <> 'cancelled') then
    raise exception 'Zásilka má objednanou přepravu DPD – nejdřív ji zrušte.' using errcode = '42501';
  end if;
  -- Zrušené objednávky jdou se zásilkou pryč.
  delete from public.ticket_shipment_dpd d where d.shipment_id = old.id;
  return old;
end;
$$;
revoke all on function public.ticket_shipments_dpd_nesmazat() from public, anon, authenticated;

drop trigger if exists trg_ticket_shipments_dpd_nesmazat on public.ticket_shipments;
create trigger trg_ticket_shipments_dpd_nesmazat
  before delete on public.ticket_shipments
  for each row execute function public.ticket_shipments_dpd_nesmazat();

-- ── 3. Kdo smí objednat / zrušit ────────────────────────────────────────────
-- Volá edge funkce pod tokenem přihlášeného. Stejná pravidla jako storno
-- zásilky: člen servisu, servis smí pracovat, pobočka odeslání nebo cíle.
create or replace function public.zasilka_dpd_smi(p_shipment_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  s public.ticket_shipments%rowtype;
begin
  select * into s from public.ticket_shipments where id = p_shipment_id;
  if s.id is null or not public.zasilka_clen(s.service_id) then
    raise exception 'Zásilka nenalezena.' using errcode = 'P0002';
  end if;
  if not public.servis_smi_pracovat(s.service_id) then
    raise exception 'Servis je vypnutý nebo mu skončil přístup.' using errcode = '42501';
  end if;
  if not public.pobocka_povolena(s.service_id, s.from_branch_id)
     and not public.pobocka_povolena(s.service_id, s.to_branch_id) then
    raise exception 'Přepravu objednává pobočka odeslání nebo cíle.' using errcode = '42501';
  end if;
  return jsonb_build_object('service_id', s.service_id, 'status', s.status, 'user_id', auth.uid());
end;
$$;
revoke all on function public.zasilka_dpd_smi(uuid) from public, anon;
grant execute on function public.zasilka_dpd_smi(uuid) to authenticated;

-- ── 4. Hodinový tik: sledování balíků ───────────────────────────────────────
do $$
begin
  if not exists (select 1 from pg_namespace where nspname = 'vault') then
    raise notice 'Vault není k dispozici – tajemství preprava_dpd_cron_secret se nezaložilo.';
    return;
  end if;
  if not exists (select 1 from vault.secrets where name = 'preprava_dpd_cron_secret') then
    perform vault.create_secret(
      replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', ''),
      'preprava_dpd_cron_secret',
      'Sdílené tajemství pro plánované volání edge funkce zasilka-dpd (sledování balíků).'
    );
  end if;
exception
  when insufficient_privilege or undefined_table or undefined_function or undefined_object then
    raise notice 'Vault se nepodařilo použít (%). Tajemství preprava_dpd_cron_secret založ ručně.', sqlerrm;
end $$;

create or replace function public.preprava_dpd_cron_secret()
returns text
language plpgsql
security definer
stable
set search_path = public, vault, extensions
as $$
declare
  v text;
begin
  select decrypted_secret into v from vault.decrypted_secrets
   where name = 'preprava_dpd_cron_secret' order by created_at desc limit 1;
  return v;
end;
$$;
revoke all on function public.preprava_dpd_cron_secret() from public, anon, authenticated;
grant execute on function public.preprava_dpd_cron_secret() to service_role;

create or replace function public.preprava_dpd_tick()
returns void
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_secret text;
  v_request_id bigint;
begin
  -- Bez rozjetých balíků se edge funkce vůbec nevolá.
  if not exists (select 1 from public.ticket_shipment_dpd where status in ('created', 'pickup_ordered', 'in_transit')) then
    return;
  end if;
  if not exists (select 1 from pg_extension where extname = 'pg_net') then
    raise notice 'pg_net není zapnutý – preprava_dpd_tick nemá jak zavolat edge funkci.';
    return;
  end if;
  v_secret := public.preprava_dpd_cron_secret();
  if v_secret is null or v_secret = '' then
    raise notice 'Chybí tajemství preprava_dpd_cron_secret ve Vaultu – tik se přeskočil.';
    return;
  end if;
  select net.http_post(
    url := 'https://ijtvcgolsdsrquqbvjrz.supabase.co/functions/v1/zasilka-dpd',
    body := jsonb_build_object('secret', v_secret, 'action', 'track_all'),
    headers := '{"Content-Type": "application/json"}'::jsonb,
    timeout_milliseconds := 60000
  ) into v_request_id;
end;
$$;
revoke all on function public.preprava_dpd_tick() from public, anon, authenticated;
grant execute on function public.preprava_dpd_tick() to service_role;

do $$
begin
  if not exists (select 1 from pg_available_extensions where name = 'pg_cron') then
    raise notice 'pg_cron není k dispozici – sledování DPD se nenaplánovalo.';
    return;
  end if;
  create extension if not exists pg_cron;
  perform cron.unschedule('jobi-preprava-dpd')
  where exists (select 1 from cron.job where jobname = 'jobi-preprava-dpd');
  -- V 25. minutě každou hodinu 5–18 UTC (7–20 h letního času), po–so.
  perform cron.schedule('jobi-preprava-dpd', '25 5-18 * * 1-6', 'SELECT public.preprava_dpd_tick()');
exception
  when insufficient_privilege or undefined_table or undefined_function or undefined_object then
    raise notice 'pg_cron se nepodařilo nastavit (%). Tik preprava_dpd_tick() naplánuj ručně.', sqlerrm;
end $$;
