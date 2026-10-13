-- ============================================================================
-- Veřejné API „Objednávky“: příjem objednávek oprav z cizích formulářů
-- a e-shopů + webhooky zpět
-- ============================================================================
--
-- PROČ: Servisy mají vlastní weby s formulářem „Zaslat zařízení“ (první je
-- servis.iswap.cz: objednávky SRV-RRRR-NNNN, doprava DPD tam a Zásilkovna
-- zpět). Objednávka je budoucí zakázka – zařízení teprve jede. Web ji pošle
-- do Jobi přes API s tokenem (scope `orders`), servis ji uvidí v Zakázkách
-- (Příchozí objednávky) a na stránce Dnes, po doručení z ní jedním kliknutím
-- založí zakázku a web se o tom dozví webhookem – stejně jako o každé další
-- změně stavu zakázky.
--
-- Co migrace zakládá:
--   * web_objednavky – objednávky z webu. Zapisuje JEN server (edge funkce
--     api-orders a public-order-form pod service_role). Členové čtou (podle
--     pobočky jako zakázky), převod na zakázku a změnu stavu dělají funkcí
--     web_objednavka_prevest / web_objednavka_nastav_stav (právo
--     „Úpravy zakázek“). `externi_cislo` je unikátní v servisu = idempotence
--     opakovaného odeslání.
--   * api_webhooky – adresa webhooku servisu (jedna na servis), odebírané
--     události a tajemství pro podpis HMAC. Tajemství nemá grant pro
--     authenticated: ukáže se jen jednou, při založení nebo výměně (RPC).
--   * api_webhook_doruceni – fronta a zároveň log doručení. Trigger na
--     tickets (změna stavu zakázky navázané na objednávku) a převod/zrušení
--     objednávky do ní zapíší událost jen při aktivním webhooku, který ji
--     odebírá. Odesílá edge funkce api-webhooks: volá ji pg_cron každou
--     minutu (jen když ve frontě něco čeká) se sdíleným tajemstvím z Vaultu,
--     vzor platby_tick. Neúspěch se opakuje 3× s rostoucí pauzou (plán
--     počítá edge funkce, viz _shared/objednavky.ts).
--
-- Moduly: objednávky patří k veřejnému API – brána je nárok `api_catalog`
-- (stejně jako ceník ve formuláři rezervací). RPC i edge funkce ho ověřují.
--
-- §5 MIGRATIONS_SAFETY: obě tabulky s ticket_id mají restriktivní politiku
-- „jen k viditelným zakázkám“, všechny tři jsou v hradbě (vypnutý servis,
-- propadlý přístup) a nemají granty pro anon. Funkce s ticket_id volají
-- pobocka_povolena. Sondy řady 1700 ve scripts/rls-probe.sql.
--
-- Idempotentní (if not exists, create or replace, drop policy if exists).
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1) Tabulky
-- ---------------------------------------------------------------------------
create table if not exists public.web_objednavky (
  id uuid primary key default gen_random_uuid(),
  service_id uuid not null references public.services(id) on delete cascade,
  -- Pobočka, kam zařízení jede (null = rozhodne servis při převodu).
  branch_id uuid references public.branches(id) on delete set null,
  -- Číslo objednávky v systému odesílatele (SRV-2026-0123). Idempotence.
  externi_cislo text not null check (length(btrim(externi_cislo)) between 1 and 100),
  -- Odkud objednávka přišla: „api“, název tokenu, „formulář Jobi“…
  zdroj text not null default 'api' check (length(zdroj) <= 80),
  stav text not null default 'nova' check (stav in ('nova', 'na_ceste', 'dorazilo', 'prevedeno', 'zrusena')),

  zakaznik_jmeno text check (length(zakaznik_jmeno) <= 200),
  zakaznik_telefon text check (length(zakaznik_telefon) <= 40),
  zakaznik_email text check (length(zakaznik_email) <= 200),
  zakaznik_firma text check (length(zakaznik_firma) <= 200),
  zakaznik_ico text check (length(zakaznik_ico) <= 20),
  zakaznik_dic text check (length(zakaznik_dic) <= 20),
  zakaznik_ulice text check (length(zakaznik_ulice) <= 200),
  zakaznik_mesto text check (length(zakaznik_mesto) <= 120),
  zakaznik_psc text check (length(zakaznik_psc) <= 20),

  zarizeni text check (length(zarizeni) <= 200),
  model_id uuid references public.device_models(id) on delete set null,
  sn_imei text check (length(sn_imei) <= 100),
  heslo_zarizeni text check (length(heslo_zarizeni) <= 100),
  prislusenstvi text check (length(prislusenstvi) <= 500),
  popis_zavady text check (length(popis_zavady) <= 4000),
  pozadovana_oprava text check (length(pozadovana_oprava) <= 1000),
  repair_id uuid references public.repairs(id) on delete set null,

  doprava_tam text check (length(doprava_tam) <= 100),
  doprava_zpet text check (length(doprava_zpet) <= 100),
  vydejni_misto text check (length(vydejni_misto) <= 500),
  adresa_zpet text check (length(adresa_zpet) <= 500),
  -- [{ "dopravce": "dpd", "cislo": "…", "smer": "tam"|"zpet", "url": "…" }]
  sledovaci_cisla jsonb not null default '[]'::jsonb
    check (jsonb_typeof(sledovaci_cisla) = 'array' and octet_length(sledovaci_cisla::text) <= 8000),

  poznamka text check (length(poznamka) <= 4000),
  -- Cokoli dalšího od odesílatele (cena dopravy, číslo platby…), max ~20 kB.
  data jsonb not null default '{}'::jsonb
    check (jsonb_typeof(data) = 'object' and octet_length(data::text) <= 20480),

  ticket_id uuid references public.tickets(id) on delete set null,
  -- Token, kterým objednávka přišla (null = formulář Jobi).
  token_id uuid references public.api_tokens(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  dorazilo_at timestamptz,
  prevedeno_at timestamptz,
  unique (service_id, externi_cislo)
);

create index if not exists web_objednavky_service_stav_idx on public.web_objednavky (service_id, stav, created_at desc);
create index if not exists web_objednavky_ticket_idx on public.web_objednavky (ticket_id) where ticket_id is not null;

comment on table public.web_objednavky is
  'Objednávky oprav z webu servisu (API s tokenem scope orders, nebo vložitelný formulář Jobi). Zapisuje server; převod na zakázku funkcí web_objednavka_prevest.';

create table if not exists public.api_webhooky (
  id uuid primary key default gen_random_uuid(),
  service_id uuid not null unique references public.services(id) on delete cascade,
  url text not null check (url ~* '^https://' and length(url) <= 500),
  -- Klíč pro HMAC podpis. Jen service_role; klient ho dostane jednou z RPC.
  tajemstvi text not null,
  udalosti text[] not null default array['order.converted', 'ticket.status_changed', 'ticket.completed', 'order.cancelled']
    check (udalosti <@ array['order.converted', 'ticket.status_changed', 'ticket.completed', 'order.cancelled']),
  aktivni boolean not null default true,
  posledni_uspech_at timestamptz,
  posledni_chyba text,
  posledni_chyba_at timestamptz,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.api_webhooky is
  'Webhook servisu pro objednávky (order.converted, ticket.status_changed, ticket.completed, order.cancelled). Tajemství čte jen service_role.';

create table if not exists public.api_webhook_doruceni (
  id uuid primary key default gen_random_uuid(),
  service_id uuid not null references public.services(id) on delete cascade,
  udalost text not null check (udalost in ('order.converted', 'ticket.status_changed', 'ticket.completed', 'order.cancelled', 'ping')),
  payload jsonb not null,
  ticket_id uuid references public.tickets(id) on delete set null,
  objednavka_id uuid references public.web_objednavky(id) on delete set null,
  -- ceka → odesila → odeslano | ceka (další pokus) | chyba (vzdáno) | zahozeno
  stav text not null default 'ceka' check (stav in ('ceka', 'odesila', 'odeslano', 'chyba', 'zahozeno')),
  pokusy integer not null default 0,
  dalsi_pokus_at timestamptz not null default now(),
  zamceno_at timestamptz,
  http_status integer,
  chyba text check (length(chyba) <= 500),
  created_at timestamptz not null default now(),
  odeslano_at timestamptz
);

create index if not exists api_webhook_doruceni_fronta_idx on public.api_webhook_doruceni (dalsi_pokus_at) where stav in ('ceka', 'odesila');
create index if not exists api_webhook_doruceni_service_idx on public.api_webhook_doruceni (service_id, created_at desc);
create index if not exists api_webhook_doruceni_ticket_idx on public.api_webhook_doruceni (ticket_id) where ticket_id is not null;

comment on table public.api_webhook_doruceni is
  'Fronta a log doručení webhooků objednávek. Plní trigger a RPC, odesílá edge funkce api-webhooks (pg_cron). Uklízí se po 30 dnech.';

-- ---------------------------------------------------------------------------
-- 2) Práva a RLS
-- ---------------------------------------------------------------------------
alter table public.web_objednavky enable row level security;
alter table public.api_webhooky enable row level security;
alter table public.api_webhook_doruceni enable row level security;

revoke all on table public.web_objednavky, public.api_webhooky, public.api_webhook_doruceni from anon, authenticated;
grant all on table public.web_objednavky, public.api_webhooky, public.api_webhook_doruceni to service_role;

-- Objednávky čtou členové; zápis jen server a RPC.
grant select on table public.web_objednavky to authenticated;
-- Webhook i log jen čtení, a u webhooku bez tajemství (RLS neumí sloupce).
grant select (id, service_id, url, udalosti, aktivni, posledni_uspech_at, posledni_chyba, posledni_chyba_at, created_at, updated_at)
  on table public.api_webhooky to authenticated;
grant select on table public.api_webhook_doruceni to authenticated;

drop policy if exists web_objednavky_select_clenove on public.web_objednavky;
create policy web_objednavky_select_clenove on public.web_objednavky
  for select to authenticated
  using (
    exists (select 1 from public.service_memberships m where m.service_id = web_objednavky.service_id and m.user_id = auth.uid())
    and public.pobocka_povolena(service_id, branch_id)
  );

-- §5: převedená objednávka se řídí viditelností své zakázky.
drop policy if exists web_objednavky_jen_viditelne_zakazky on public.web_objednavky;
create policy web_objednavky_jen_viditelne_zakazky on public.web_objednavky
  as restrictive for select to authenticated
  using (ticket_id is null or exists (select 1 from public.tickets t where t.id = web_objednavky.ticket_id));

drop policy if exists api_webhooky_select_spravci on public.api_webhooky;
create policy api_webhooky_select_spravci on public.api_webhooky
  for select to authenticated
  using (exists (
    select 1 from public.service_memberships m
     where m.service_id = api_webhooky.service_id and m.user_id = auth.uid() and m.role in ('owner', 'admin')
  ));

drop policy if exists api_webhook_doruceni_select_spravci on public.api_webhook_doruceni;
create policy api_webhook_doruceni_select_spravci on public.api_webhook_doruceni
  for select to authenticated
  using (exists (
    select 1 from public.service_memberships m
     where m.service_id = api_webhook_doruceni.service_id and m.user_id = auth.uid() and m.role in ('owner', 'admin')
  ));

drop policy if exists api_webhook_doruceni_jen_viditelne_zakazky on public.api_webhook_doruceni;
create policy api_webhook_doruceni_jen_viditelne_zakazky on public.api_webhook_doruceni
  as restrictive for select to authenticated
  using (ticket_id is null or exists (select 1 from public.tickets t where t.id = api_webhook_doruceni.ticket_id));

-- Hradba (vzor 20260912130000): vypnutý servis nečte, propadlý přístup nezapisuje.
-- Zápisové politiky jsou pojistka – authenticated dnes zápisový grant nemá.
do $$
declare
  t text;
begin
  foreach t in array array['web_objednavky', 'api_webhooky', 'api_webhook_doruceni'] loop
    execute format('drop policy if exists %I on public.%I', t || '_jen_zapnuty_servis', t);
    execute format(
      'create policy %I on public.%I as restrictive for select to authenticated using (not (service_id = any (public.vypnute_servisy())))',
      t || '_jen_zapnuty_servis', t);
    execute format('drop policy if exists %I on public.%I', t || '_jen_s_pristupem_vlozeni', t);
    execute format(
      'create policy %I on public.%I as restrictive for insert to authenticated with check (service_id = any (public.servisy_kde_smim_pracovat()))',
      t || '_jen_s_pristupem_vlozeni', t);
    execute format('drop policy if exists %I on public.%I', t || '_jen_s_pristupem_zmena', t);
    execute format(
      'create policy %I on public.%I as restrictive for update to authenticated using (service_id = any (public.servisy_kde_smim_pracovat())) with check (service_id = any (public.servisy_kde_smim_pracovat()))',
      t || '_jen_s_pristupem_zmena', t);
    execute format('drop policy if exists %I on public.%I', t || '_jen_s_pristupem_mazani', t);
    execute format(
      'create policy %I on public.%I as restrictive for delete to authenticated using (service_id = any (public.servisy_kde_smim_pracovat()))',
      t || '_jen_s_pristupem_mazani', t);
  end loop;
end
$$;

-- updated_at
create or replace function public.web_objednavky_touch()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;
drop trigger if exists web_objednavky_touch on public.web_objednavky;
create trigger web_objednavky_touch before update on public.web_objednavky
  for each row execute function public.web_objednavky_touch();
drop trigger if exists api_webhooky_touch on public.api_webhooky;
create trigger api_webhooky_touch before update on public.api_webhooky
  for each row execute function public.web_objednavky_touch();

-- Realtime: nová objednávka se v Zakázkách a na Dnes ukáže hned.
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'web_objednavky') then
    alter publication supabase_realtime add table public.web_objednavky;
  end if;
end
$$;

-- ---------------------------------------------------------------------------
-- 3) Pomocné funkce: stav pro API a obsah webhooku
-- ---------------------------------------------------------------------------
-- Stav objednávky směrem ven (API mluví anglicky). Zrcadlo STAV_API
-- v supabase/functions/_shared/objednavky.ts.
create or replace function public.web_objednavka_stav_api(p_stav text)
returns text
language sql
immutable
set search_path = public
as $$
  select case p_stav
    when 'nova' then 'new'
    when 'na_ceste' then 'in_transit'
    when 'dorazilo' then 'arrived'
    when 'prevedeno' then 'converted'
    when 'zrusena' then 'cancelled'
    else p_stav
  end;
$$;

-- Zakázka v podobě pro API a webhook: číslo, stav (klíč, název, koncový?),
-- celková cena (součet provedených oprav po slevě – stejný vzorec jako
-- provize a src/lib/slevaZakazky.ts) a čas poslední změny. Smazaná = null.
create or replace function public.web_objednavka_zakazka_json(p_ticket_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'code', t.code,
    'status', jsonb_build_object('key', t.status, 'label', coalesce(s.label, t.status), 'is_final', coalesce(s.is_final, false)),
    'total', public.provize_cena(t.performed_repairs, t.discount_type, t.discount_value),
    'updated_at', t.updated_at
  )
  from public.tickets t
  left join public.service_statuses s on s.service_id = t.service_id and s.key = t.status
  where t.id = p_ticket_id and t.deleted_at is null;
$$;
revoke all on function public.web_objednavka_zakazka_json(uuid) from public, anon, authenticated;
grant execute on function public.web_objednavka_zakazka_json(uuid) to service_role;

-- Tělo webhooku: { event, external_id, source, order_status, ticket_code,
-- status: {key,label,is_final}, total, updated_at }.
create or replace function public.web_objednavka_payload(p_objednavka_id uuid, p_udalost text)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'event', p_udalost,
    'external_id', o.externi_cislo,
    'source', o.zdroj,
    'order_status', public.web_objednavka_stav_api(o.stav),
    'ticket_code', z ->> 'code',
    'status', z -> 'status',
    'total', z -> 'total',
    'updated_at', to_jsonb(greatest(o.updated_at, coalesce((z ->> 'updated_at')::timestamptz, o.updated_at)))
  )
  from public.web_objednavky o
  left join lateral (select public.web_objednavka_zakazka_json(o.ticket_id) as z) j on true
  where o.id = p_objednavka_id;
$$;
revoke all on function public.web_objednavka_payload(uuid, text) from public, anon, authenticated;
grant execute on function public.web_objednavka_payload(uuid, text) to service_role;

-- Zařadí událost do fronty – jen když má servis aktivní webhook, který ji
-- odebírá. Volá se z triggeru a z RPC (definer), ne z klienta.
create or replace function public.api_webhook_zarad(p_objednavka_id uuid, p_udalost text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_o public.web_objednavky;
begin
  select * into v_o from public.web_objednavky where id = p_objednavka_id;
  if not found then
    return;
  end if;
  if not exists (
    select 1 from public.api_webhooky w
     where w.service_id = v_o.service_id and w.aktivni and p_udalost = any (w.udalosti)
  ) then
    return;
  end if;
  insert into public.api_webhook_doruceni (service_id, udalost, payload, ticket_id, objednavka_id)
  values (v_o.service_id, p_udalost, public.web_objednavka_payload(v_o.id, p_udalost), v_o.ticket_id, v_o.id);
end;
$$;
revoke all on function public.api_webhook_zarad(uuid, text) from public, anon, authenticated;
grant execute on function public.api_webhook_zarad(uuid, text) to service_role;

-- ---------------------------------------------------------------------------
-- 4) Trigger: změna stavu zakázky navázané na objednávku → webhook
-- ---------------------------------------------------------------------------
-- ticket.status_changed vždy, ticket.completed navíc při přechodu do
-- koncového stavu (service_statuses.is_final). Zrcadlo udalostiZmenyStavu
-- v _shared/objednavky.ts.
create or replace function public.tickets_webhook_objednavky()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
  v_novy_koncovy boolean;
  v_stary_koncovy boolean;
begin
  if new.status is not distinct from old.status or new.deleted_at is not null then
    return new;
  end if;
  -- Levná cesta pro drtivou většinu zakázek, které z objednávky nejsou.
  if not exists (select 1 from public.web_objednavky o where o.ticket_id = new.id) then
    return new;
  end if;
  select coalesce(bool_or(s.is_final), false) into v_novy_koncovy
    from public.service_statuses s where s.service_id = new.service_id and s.key = new.status;
  select coalesce(bool_or(s.is_final), false) into v_stary_koncovy
    from public.service_statuses s where s.service_id = new.service_id and s.key = old.status;
  for v_id in select o.id from public.web_objednavky o where o.ticket_id = new.id loop
    perform public.api_webhook_zarad(v_id, 'ticket.status_changed');
    if v_novy_koncovy and not v_stary_koncovy then
      perform public.api_webhook_zarad(v_id, 'ticket.completed');
    end if;
  end loop;
  return new;
end;
$$;
revoke all on function public.tickets_webhook_objednavky() from public, anon, authenticated;

drop trigger if exists tickets_webhook_objednavky on public.tickets;
create trigger tickets_webhook_objednavky
  after update of status on public.tickets
  for each row execute function public.tickets_webhook_objednavky();

-- ---------------------------------------------------------------------------
-- 5) RPC pro aplikaci: převod na zakázku a změna stavu
-- ---------------------------------------------------------------------------
-- Po založení zakázky z objednávky: objednávka → prevedeno + ticket_id
-- a webhook order.converted. Vrací false, když objednávku mezitím vyřídil
-- někdo jiný (zakázka zůstává). Zakázka musí být ze stejného servisu
-- a volající ji musí vidět (pobočka).
create or replace function public.web_objednavka_prevest(p_id uuid, p_ticket_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_o public.web_objednavky;
  v_t record;
begin
  if v_uid is null then
    raise exception 'Nepřihlášený' using errcode = '42501';
  end if;
  select * into v_o from public.web_objednavky where id = p_id for update;
  if not found then
    raise exception 'Objednávka neexistuje' using errcode = 'P0002';
  end if;
  if not public.has_capability(v_o.service_id, v_uid, 'can_manage_tickets_basic')
     or not (v_o.service_id = any (public.servisy_kde_smim_pracovat()))
     or not public.pobocka_povolena(v_o.service_id, v_o.branch_id) then
    raise exception 'Na převod objednávky nemáte oprávnění' using errcode = '42501';
  end if;
  select id, service_id, branch_id, deleted_at into v_t from public.tickets where id = p_ticket_id;
  if not found or v_t.service_id <> v_o.service_id or v_t.deleted_at is not null then
    raise exception 'Zakázka k objednávce nepatří' using errcode = '42501';
  end if;
  if not public.pobocka_povolena(v_t.service_id, v_t.branch_id) then
    raise exception 'Zakázka je na pobočce, kterou nevidíte' using errcode = '42501';
  end if;
  if v_o.stav not in ('nova', 'na_ceste', 'dorazilo') then
    return false;
  end if;
  update public.web_objednavky
     set stav = 'prevedeno', ticket_id = p_ticket_id, prevedeno_at = now(),
         dorazilo_at = coalesce(dorazilo_at, now())
   where id = p_id;
  perform public.api_webhook_zarad(p_id, 'order.converted');
  return true;
end;
$$;
revoke all on function public.web_objednavka_prevest(uuid, uuid) from public, anon;
grant execute on function public.web_objednavka_prevest(uuid, uuid) to authenticated, service_role;

-- Ruční změna stavu v aplikaci: Na cestě / Dorazilo / Zrušit (a zpět Nová).
-- Jen u nevyřízené objednávky; zrušení pošle webhook order.cancelled.
create or replace function public.web_objednavka_nastav_stav(p_id uuid, p_stav text)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_o public.web_objednavky;
begin
  if v_uid is null then
    raise exception 'Nepřihlášený' using errcode = '42501';
  end if;
  if p_stav not in ('nova', 'na_ceste', 'dorazilo', 'zrusena') then
    raise exception 'Neznámý stav %', p_stav using errcode = '22023';
  end if;
  select * into v_o from public.web_objednavky where id = p_id for update;
  if not found then
    raise exception 'Objednávka neexistuje' using errcode = 'P0002';
  end if;
  if not public.has_capability(v_o.service_id, v_uid, 'can_manage_tickets_basic')
     or not (v_o.service_id = any (public.servisy_kde_smim_pracovat()))
     or not public.pobocka_povolena(v_o.service_id, v_o.branch_id) then
    raise exception 'Na změnu objednávky nemáte oprávnění' using errcode = '42501';
  end if;
  if v_o.stav not in ('nova', 'na_ceste', 'dorazilo') then
    return false;
  end if;
  if v_o.stav = p_stav then
    return true;
  end if;
  update public.web_objednavky
     set stav = p_stav,
         dorazilo_at = case when p_stav = 'dorazilo' then coalesce(dorazilo_at, now()) else dorazilo_at end
   where id = p_id;
  if p_stav = 'zrusena' then
    perform public.api_webhook_zarad(p_id, 'order.cancelled');
  end if;
  return true;
end;
$$;
revoke all on function public.web_objednavka_nastav_stav(uuid, text) from public, anon;
grant execute on function public.web_objednavka_nastav_stav(uuid, text) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 6) RPC pro Nastavení → API: webhook servisu
-- ---------------------------------------------------------------------------
create or replace function public.api_webhook_nove_tajemstvi_text()
returns text
language sql
volatile
set search_path = public
as $$
  select 'whsec_' || replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '');
$$;
revoke all on function public.api_webhook_nove_tajemstvi_text() from public, anon, authenticated;

-- Jen majitel/správce servisu s modulem veřejného API a s přístupem.
create or replace function public.api_webhook_over_spravce(p_service_id uuid)
returns void
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if auth.uid() is null or not exists (
    select 1 from public.service_memberships m
     where m.service_id = p_service_id and m.user_id = auth.uid() and m.role in ('owner', 'admin')
  ) then
    raise exception 'Webhook smí nastavit jen majitel nebo správce servisu' using errcode = '42501';
  end if;
  if not (p_service_id = any (public.servisy_kde_smim_pracovat())) then
    raise exception 'Servis nemá platný přístup' using errcode = '42501';
  end if;
  if not public.has_entitlement(p_service_id, 'api_catalog') then
    raise exception 'Veřejné API není pro tento servis aktivní' using errcode = '42501';
  end if;
end;
$$;
revoke all on function public.api_webhook_over_spravce(uuid) from public, anon, authenticated;

-- Uloží adresu, události a zapnutí. Při prvním uložení vznikne tajemství
-- a vrátí se – jediný okamžik, kdy ho klient uvidí. Vrací { id, tajemstvi? }.
create or replace function public.api_webhook_ulozit(p_service_id uuid, p_url text, p_udalosti text[], p_aktivni boolean)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_url text := btrim(coalesce(p_url, ''));
  v_udalosti text[];
  v_id uuid;
  v_tajemstvi text;
begin
  perform public.api_webhook_over_spravce(p_service_id);
  if v_url !~* '^https://[^/?#\s]+' or length(v_url) > 500 then
    raise exception 'Adresa musí začínat https://' using errcode = '22023';
  end if;
  select coalesce(array_agg(distinct u order by u), '{}') into v_udalosti
    from unnest(coalesce(p_udalosti, '{}')) u
   where u in ('order.converted', 'ticket.status_changed', 'ticket.completed', 'order.cancelled');
  if cardinality(v_udalosti) = 0 then
    raise exception 'Vyberte aspoň jednu událost' using errcode = '22023';
  end if;

  update public.api_webhooky
     set url = v_url, udalosti = v_udalosti, aktivni = coalesce(p_aktivni, true),
         posledni_chyba = null, posledni_chyba_at = null
   where service_id = p_service_id
  returning id into v_id;
  if v_id is not null then
    return jsonb_build_object('id', v_id);
  end if;

  v_tajemstvi := public.api_webhook_nove_tajemstvi_text();
  insert into public.api_webhooky (service_id, url, tajemstvi, udalosti, aktivni, created_by)
  values (p_service_id, v_url, v_tajemstvi, v_udalosti, coalesce(p_aktivni, true), auth.uid())
  returning id into v_id;
  return jsonb_build_object('id', v_id, 'tajemstvi', v_tajemstvi);
end;
$$;
revoke all on function public.api_webhook_ulozit(uuid, text, text[], boolean) from public, anon;
grant execute on function public.api_webhook_ulozit(uuid, text, text[], boolean) to authenticated;

-- Nové tajemství (únik, výměna). Staré přestane platit hned.
create or replace function public.api_webhook_nove_tajemstvi(p_service_id uuid)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_tajemstvi text := public.api_webhook_nove_tajemstvi_text();
begin
  perform public.api_webhook_over_spravce(p_service_id);
  update public.api_webhooky set tajemstvi = v_tajemstvi where service_id = p_service_id;
  if not found then
    raise exception 'Webhook ještě není nastavený' using errcode = 'P0002';
  end if;
  return v_tajemstvi;
end;
$$;
revoke all on function public.api_webhook_nove_tajemstvi(uuid) from public, anon;
grant execute on function public.api_webhook_nove_tajemstvi(uuid) to authenticated;

-- Smazání webhooku. Nedoručené události ve frontě se zahodí.
create or replace function public.api_webhook_smazat(p_service_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  -- Smazat jde i po vypršení modulu – vypnout odesílání musí jít vždycky.
  if auth.uid() is null or not exists (
    select 1 from public.service_memberships m
     where m.service_id = p_service_id and m.user_id = auth.uid() and m.role in ('owner', 'admin')
  ) then
    raise exception 'Webhook smí smazat jen majitel nebo správce servisu' using errcode = '42501';
  end if;
  delete from public.api_webhooky where service_id = p_service_id;
  update public.api_webhook_doruceni set stav = 'zahozeno', chyba = 'Webhook smazán'
   where service_id = p_service_id and stav in ('ceka', 'odesila');
end;
$$;
revoke all on function public.api_webhook_smazat(uuid) from public, anon;
grant execute on function public.api_webhook_smazat(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 7) Fronta pro edge funkci api-webhooks (jen service_role)
-- ---------------------------------------------------------------------------
-- Vezme k odeslání až p_limit událostí (volitelně jen jednoho servisu)
-- a zamkne je. Souběžné volání (cron + „pošli hned“ z aplikace) si je
-- nerozebere dvakrát díky skip locked; zaseknuté odesílání (spadlá funkce)
-- se po 5 minutách vezme znovu.
create or replace function public.api_webhooky_k_odeslani(p_limit integer default 50, p_service_id uuid default null)
returns table (
  id uuid, service_id uuid, udalost text, payload jsonb, pokusy integer,
  url text, tajemstvi text, udalosti text[], aktivni boolean
)
language plpgsql
security definer
set search_path = public
as $$
begin
  return query
  with k as (
    select d.id
      from public.api_webhook_doruceni d
     where ((d.stav = 'ceka' and d.dalsi_pokus_at <= now())
            or (d.stav = 'odesila' and d.zamceno_at < now() - interval '5 minutes'))
       and (p_service_id is null or d.service_id = p_service_id)
     order by d.dalsi_pokus_at
     limit greatest(1, least(coalesce(p_limit, 50), 200))
     for update skip locked
  ), z as (
    update public.api_webhook_doruceni d
       set stav = 'odesila', zamceno_at = now(), pokusy = d.pokusy + 1
      from k
     where d.id = k.id
    returning d.id, d.service_id, d.udalost, d.payload, d.pokusy
  )
  select z.id, z.service_id, z.udalost, z.payload, z.pokusy, w.url, w.tajemstvi, w.udalosti, w.aktivni
    from z left join public.api_webhooky w on w.service_id = z.service_id;
end;
$$;
revoke all on function public.api_webhooky_k_odeslani(integer, uuid) from public, anon, authenticated;
grant execute on function public.api_webhooky_k_odeslani(integer, uuid) to service_role;

-- Výsledek pokusu. p_dalsi_pokus_at = kdy znovu (null = už ne); plán
-- opakování počítá edge funkce (naplanujOpakovani v _shared/objednavky.ts).
-- p_zahodit = neposílá se vůbec (webhook smazaný/vypnutý, událost neodebíraná).
create or replace function public.api_webhook_vysledek(
  p_id uuid, p_ok boolean, p_http_status integer, p_chyba text,
  p_dalsi_pokus_at timestamptz default null, p_zahodit boolean default false
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_service uuid;
begin
  update public.api_webhook_doruceni d
     set stav = case
                  when p_zahodit then 'zahozeno'
                  when p_ok then 'odeslano'
                  when p_dalsi_pokus_at is not null then 'ceka'
                  else 'chyba'
                end,
         http_status = p_http_status,
         chyba = case when p_ok then null else left(p_chyba, 500) end,
         odeslano_at = case when p_ok then now() else d.odeslano_at end,
         dalsi_pokus_at = coalesce(p_dalsi_pokus_at, d.dalsi_pokus_at),
         zamceno_at = null
   where d.id = p_id
  returning d.service_id into v_service;
  if v_service is null or p_zahodit then
    return;
  end if;
  if p_ok then
    update public.api_webhooky set posledni_uspech_at = now() where service_id = v_service;
  else
    update public.api_webhooky set posledni_chyba = left(p_chyba, 500), posledni_chyba_at = now() where service_id = v_service;
  end if;
end;
$$;
revoke all on function public.api_webhook_vysledek(uuid, boolean, integer, text, timestamptz, boolean) from public, anon, authenticated;
grant execute on function public.api_webhook_vysledek(uuid, boolean, integer, text, timestamptz, boolean) to service_role;

-- Úklid logu: hotové záznamy starší 30 dní.
create or replace function public.api_webhooky_uklid()
returns void
language sql
security definer
set search_path = public
as $$
  delete from public.api_webhook_doruceni
   where stav in ('odeslano', 'chyba', 'zahozeno') and created_at < now() - interval '30 days';
$$;
revoke all on function public.api_webhooky_uklid() from public, anon, authenticated;
grant execute on function public.api_webhooky_uklid() to service_role;

-- ---------------------------------------------------------------------------
-- 8) Cron: tajemství ve Vaultu a tik každou minutu (vzor platby_tick)
-- ---------------------------------------------------------------------------
do $$
begin
  if not exists (select 1 from pg_namespace where nspname = 'vault') then
    raise notice 'Vault není k dispozici – tajemství api_webhooky_cron_secret se nezaložilo.';
    return;
  end if;
  if not exists (select 1 from vault.secrets where name = 'api_webhooky_cron_secret') then
    perform vault.create_secret(
      replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', ''),
      'api_webhooky_cron_secret',
      'Sdílené tajemství pro plánované volání edge funkce api-webhooks (pg_cron → pg_net).'
    );
  end if;
exception
  when insufficient_privilege or undefined_table or undefined_function or undefined_object then
    raise notice 'Vault se nepodařilo použít (%). Tajemství api_webhooky_cron_secret založ ručně.', sqlerrm;
end $$;

create or replace function public.api_webhooky_cron_secret()
returns text
language plpgsql
security definer
stable
set search_path = public, vault, extensions
as $$
declare
  v_secret text;
begin
  if not exists (select 1 from pg_namespace where nspname = 'vault') then
    return null;
  end if;
  execute $q$select decrypted_secret from vault.decrypted_secrets where name = 'api_webhooky_cron_secret' order by created_at desc limit 1$q$
    into v_secret;
  return v_secret;
end;
$$;
revoke all on function public.api_webhooky_cron_secret() from public, anon, authenticated;
grant execute on function public.api_webhooky_cron_secret() to service_role;

-- Tik: edge funkci zavolá jen tehdy, když ve frontě něco čeká – jinak by
-- každou minutu běžela naprázdno.
create or replace function public.api_webhooky_tick()
returns void
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_secret text;
begin
  if not exists (
    select 1 from public.api_webhook_doruceni d
     where (d.stav = 'ceka' and d.dalsi_pokus_at <= now())
        or (d.stav = 'odesila' and d.zamceno_at < now() - interval '5 minutes')
  ) then
    return;
  end if;
  if not exists (select 1 from pg_extension where extname = 'pg_net') then
    raise notice 'pg_net není zapnutý – api_webhooky_tick nemá jak zavolat edge funkci.';
    return;
  end if;
  v_secret := public.api_webhooky_cron_secret();
  if v_secret is null or v_secret = '' then
    raise notice 'Chybí tajemství api_webhooky_cron_secret ve Vaultu – tik se přeskočil.';
    return;
  end if;
  execute $q$select net.http_post(
    url := 'https://ijtvcgolsdsrquqbvjrz.supabase.co/functions/v1/api-webhooks',
    body := jsonb_build_object('secret', $1),
    headers := '{"Content-Type": "application/json"}'::jsonb,
    timeout_milliseconds := 60000
  )$q$ using v_secret;
end;
$$;
revoke all on function public.api_webhooky_tick() from public, anon, authenticated;
grant execute on function public.api_webhooky_tick() to service_role;

do $$
begin
  if not exists (select 1 from pg_available_extensions where name = 'pg_cron') then
    raise notice 'pg_cron není k dispozici – odesílání webhooků objednávek se nenaplánovalo.';
    return;
  end if;
  create extension if not exists pg_cron;
  perform cron.unschedule('jobi-webhooky-objednavek') where exists (select 1 from cron.job where jobname = 'jobi-webhooky-objednavek');
  perform cron.schedule('jobi-webhooky-objednavek', '* * * * *', 'SELECT public.api_webhooky_tick()');
  perform cron.unschedule('jobi-webhooky-uklid') where exists (select 1 from cron.job where jobname = 'jobi-webhooky-uklid');
  perform cron.schedule('jobi-webhooky-uklid', '35 3 * * *', 'SELECT public.api_webhooky_uklid()');
exception
  when insufficient_privilege or undefined_table or undefined_function or undefined_object then
    raise notice 'pg_cron se nepodařilo nastavit (%). Tik api_webhooky_tick() naplánuj ručně.', sqlerrm;
end $$;
