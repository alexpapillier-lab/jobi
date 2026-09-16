-- Zásilky mezi pobočkami (modul „Přesuny mezi pobočkami“).
--
-- Servis přijímá zakázky na jedné pobočce, opravuje na druhé a vydává zase
-- na první. Dřív se to řešilo stavy typu „Posláno do Prahy“, které míchaly
-- stav opravy s místem, kde telefon fyzicky je. Tady je místo druhá,
-- nezávislá osa:
--
--   tickets.branch_id             – pobočka, kde byla zakázka přijata a kde
--                                   se vydá (nemění se; zákazník, faktura,
--                                   statistiky tržeb)
--   tickets.location_branch_id    – kde zařízení fyzicky je; NULL = na své
--                                   pobočce (branch_id)
--   tickets.transit_shipment_id   – zásilka, ve které právě cestuje; NULL =
--                                   necestuje
--
-- Zásilka (ticket_shipments) je krabice s několika zakázkami, která jede
-- z pobočky na pobočku: koncept → odesláno → převzato. Položky se převezmou
-- po jedné (co v krabici chybí, zůstane nepřevzaté a zásilka „sent“).
--
-- Přístup: člen omezený na pobočku vidí zakázku i tehdy, když na jeho
-- pobočce fyzicky leží nebo do ní právě cestuje (jinak by ji technik v Praze
-- nemohl opravovat). Stavové přechody jdou přes RPC (security definer), ať
-- se zakázky z druhé pobočky dají přehodit i bez práva na ně zapisovat.

-- ========== 1) sloupce u zakázky ==========

alter table public.tickets
  add column if not exists location_branch_id uuid references public.branches(id) on delete set null,
  add column if not exists transit_shipment_id uuid;

comment on column public.tickets.location_branch_id is 'Kde zařízení fyzicky je; NULL = na své pobočce (branch_id).';
comment on column public.tickets.transit_shipment_id is 'Zásilka, ve které zakázka právě cestuje; NULL = necestuje.';

create index if not exists tickets_location_branch_idx on public.tickets (service_id, location_branch_id) where location_branch_id is not null;
create index if not exists tickets_transit_shipment_idx on public.tickets (transit_shipment_id) where transit_shipment_id is not null;

-- ========== 2) tabulky ==========

create table if not exists public.ticket_shipments (
  id uuid primary key default gen_random_uuid(),
  service_id uuid not null references public.services(id) on delete cascade,
  cislo integer not null,
  from_branch_id uuid not null references public.branches(id) on delete restrict,
  to_branch_id uuid not null references public.branches(id) on delete restrict,
  status text not null default 'draft' check (status in ('draft', 'sent', 'received')),
  carrier text,
  tracking_number text,
  note text,
  created_by uuid,
  created_at timestamptz not null default now(),
  sent_by uuid,
  sent_at timestamptz,
  received_by uuid,
  received_at timestamptz,
  constraint ticket_shipments_ruzne_pobocky check (from_branch_id <> to_branch_id),
  constraint ticket_shipments_cislo_unique unique (service_id, cislo)
);

comment on table public.ticket_shipments is 'Zásilka zakázek mezi pobočkami: koncept → odesláno → převzato.';

create table if not exists public.ticket_shipment_items (
  id uuid primary key default gen_random_uuid(),
  shipment_id uuid not null references public.ticket_shipments(id) on delete cascade,
  ticket_id uuid not null references public.tickets(id) on delete cascade,
  added_at timestamptz not null default now(),
  received_at timestamptz,
  note text,
  constraint ticket_shipment_items_unique unique (shipment_id, ticket_id)
);

create index if not exists ticket_shipments_service_idx on public.ticket_shipments (service_id, status, created_at desc);
create index if not exists ticket_shipment_items_ticket_idx on public.ticket_shipment_items (ticket_id);

alter table public.tickets
  drop constraint if exists tickets_transit_shipment_fkey,
  add constraint tickets_transit_shipment_fkey foreign key (transit_shipment_id) references public.ticket_shipments(id) on delete set null;

-- Číslo zásilky: pořadové v rámci servisu, dává ho databáze.
create or replace function public.ticket_shipments_cislo()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.cislo is null or new.cislo <= 0 then
    select coalesce(max(cislo), 0) + 1 into new.cislo
      from public.ticket_shipments where service_id = new.service_id;
  end if;
  if new.created_by is null then
    new.created_by := auth.uid();
  end if;
  return new;
end;
$$;

drop trigger if exists trg_ticket_shipments_cislo on public.ticket_shipments;
create trigger trg_ticket_shipments_cislo
  before insert on public.ticket_shipments
  for each row execute function public.ticket_shipments_cislo();

alter table public.ticket_shipments alter column cislo set default 0;

-- ========== 3) RLS ==========

alter table public.ticket_shipments enable row level security;
alter table public.ticket_shipment_items enable row level security;

-- Člen servisu (bez ohledu na pobočku – zásilka jde vždycky mezi dvěma).
create or replace function public.zasilka_clen(p_service_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
set row_security = off
as $$
  select auth.uid() is not null and exists (
    select 1 from public.service_memberships m
     where m.service_id = p_service_id and m.user_id = auth.uid()
  );
$$;
revoke all on function public.zasilka_clen(uuid) from public, anon;
grant execute on function public.zasilka_clen(uuid) to authenticated, service_role;

drop policy if exists "ticket_shipments_clen_cte" on public.ticket_shipments;
create policy "ticket_shipments_clen_cte" on public.ticket_shipments
  for select to authenticated
  using (public.zasilka_clen(service_id));

drop policy if exists "ticket_shipments_clen_vlozi" on public.ticket_shipments;
create policy "ticket_shipments_clen_vlozi" on public.ticket_shipments
  for insert to authenticated
  with check (public.zasilka_clen(service_id) and status = 'draft');

-- Přímo se mění jen dopravce, sledovací číslo a poznámka; stav řeší RPC.
drop policy if exists "ticket_shipments_clen_meni" on public.ticket_shipments;
create policy "ticket_shipments_clen_meni" on public.ticket_shipments
  for update to authenticated
  using (public.zasilka_clen(service_id))
  with check (public.zasilka_clen(service_id));

drop policy if exists "ticket_shipments_clen_maze_koncept" on public.ticket_shipments;
create policy "ticket_shipments_clen_maze_koncept" on public.ticket_shipments
  for delete to authenticated
  using (public.zasilka_clen(service_id) and status = 'draft');

-- Stav a časy odeslání/převzetí se přímým update měnit nesmí – jen přes RPC.
create or replace function public.ticket_shipments_jen_hlavicka()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    return new; -- service_role, RPC (ty běží jako definer, ale auth.uid() mají – viz níž)
  end if;
  if current_setting('jobi.zasilka_rpc', true) = '1' then
    return new;
  end if;
  if new.status is distinct from old.status
     or new.sent_at is distinct from old.sent_at or new.sent_by is distinct from old.sent_by
     or new.received_at is distinct from old.received_at or new.received_by is distinct from old.received_by
     or new.service_id is distinct from old.service_id or new.cislo is distinct from old.cislo then
    raise exception 'Stav zásilky se mění jen přes odeslání a převzetí.' using errcode = '42501';
  end if;
  if old.status <> 'draft' and (new.from_branch_id is distinct from old.from_branch_id or new.to_branch_id is distinct from old.to_branch_id) then
    raise exception 'Odeslané zásilce už nejde měnit pobočky.' using errcode = '42501';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_ticket_shipments_jen_hlavicka on public.ticket_shipments;
create trigger trg_ticket_shipments_jen_hlavicka
  before update on public.ticket_shipments
  for each row execute function public.ticket_shipments_jen_hlavicka();

-- Položky: vidí člen servisu, přidává/maže jen u konceptu.
create or replace function public.zasilka_polozka_povolena(p_shipment_id uuid, p_jen_koncept boolean)
returns boolean
language sql
stable
security definer
set search_path = public
set row_security = off
as $$
  select exists (
    select 1 from public.ticket_shipments s
     where s.id = p_shipment_id
       and public.zasilka_clen(s.service_id)
       and (not p_jen_koncept or s.status = 'draft')
  );
$$;
revoke all on function public.zasilka_polozka_povolena(uuid, boolean) from public, anon;
grant execute on function public.zasilka_polozka_povolena(uuid, boolean) to authenticated, service_role;

drop policy if exists "ticket_shipment_items_cte" on public.ticket_shipment_items;
create policy "ticket_shipment_items_cte" on public.ticket_shipment_items
  for select to authenticated
  using (public.zasilka_polozka_povolena(shipment_id, false));

drop policy if exists "ticket_shipment_items_vlozi" on public.ticket_shipment_items;
create policy "ticket_shipment_items_vlozi" on public.ticket_shipment_items
  for insert to authenticated
  with check (public.zasilka_polozka_povolena(shipment_id, true) and received_at is null);

drop policy if exists "ticket_shipment_items_maze" on public.ticket_shipment_items;
create policy "ticket_shipment_items_maze" on public.ticket_shipment_items
  for delete to authenticated
  using (public.zasilka_polozka_povolena(shipment_id, true));

-- Do konceptu jde jen zakázka téhož servisu, která zrovna necestuje.
create or replace function public.ticket_shipment_items_kontrola()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_service uuid;
  v_transit uuid;
  v_ticket_service uuid;
begin
  select service_id into v_service from public.ticket_shipments where id = new.shipment_id;
  select service_id, transit_shipment_id into v_ticket_service, v_transit from public.tickets where id = new.ticket_id;
  if v_ticket_service is null or v_ticket_service <> v_service then
    raise exception 'Zakázka patří jinému servisu.' using errcode = '42501';
  end if;
  if v_transit is not null then
    raise exception 'Zakázka právě cestuje v jiné zásilce.' using errcode = '23505';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_ticket_shipment_items_kontrola on public.ticket_shipment_items;
create trigger trg_ticket_shipment_items_kontrola
  before insert on public.ticket_shipment_items
  for each row execute function public.ticket_shipment_items_kontrola();

-- ========== 4) přístup k zakázce podle místa ==========
-- Omezený člen vidí i zakázky, které na jeho pobočce fyzicky leží nebo
-- do ní cestují. Zápis (změna stavu, opravy) taky – bez toho by pražský
-- technik nemohl na brněnské zakázce pracovat.

create or replace function public.zakazka_viditelna_podle_mista(p_service_id uuid, p_branch_id uuid, p_location_branch_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.pobocka_povolena(p_service_id, p_branch_id)
      or (p_location_branch_id is not null and public.pobocka_povolena(p_service_id, p_location_branch_id));
$$;
revoke all on function public.zakazka_viditelna_podle_mista(uuid, uuid, uuid) from public, anon;
grant execute on function public.zakazka_viditelna_podle_mista(uuid, uuid, uuid) to authenticated, service_role;

drop policy if exists "tickets_jen_vlastni_pobocka" on public.tickets;
create policy "tickets_jen_vlastni_pobocka" on public.tickets
  as restrictive for select to authenticated
  using (public.zakazka_viditelna_podle_mista(service_id, branch_id, location_branch_id));

drop policy if exists "tickets_jen_vlastni_pobocka_zapis" on public.tickets;
create policy "tickets_jen_vlastni_pobocka_zapis" on public.tickets
  as restrictive for update to authenticated
  using (public.zakazka_viditelna_podle_mista(service_id, branch_id, location_branch_id))
  with check (
    public.pobocka_povolena_zapis(service_id, branch_id)
    or (location_branch_id is not null and public.pobocka_povolena_zapis(service_id, location_branch_id))
  );

-- ========== 5) odeslání a převzetí ==========

create or replace function public.zasilka_odeslat(p_shipment_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  s public.ticket_shipments%rowtype;
  v_pocet integer;
begin
  select * into s from public.ticket_shipments where id = p_shipment_id for update;
  if s.id is null then
    raise exception 'Zásilka nenalezena.' using errcode = 'P0002';
  end if;
  if not public.zasilka_clen(s.service_id) then
    raise exception 'Nejste členem servisu.' using errcode = '42501';
  end if;
  if s.status <> 'draft' then
    raise exception 'Zásilka už byla odeslána.' using errcode = '22023';
  end if;
  select count(*) into v_pocet from public.ticket_shipment_items where shipment_id = s.id;
  if v_pocet = 0 then
    raise exception 'Do zásilky nejdřív přidejte zakázky.' using errcode = '22023';
  end if;
  -- Zakázka, která mezitím odjela jinou zásilkou, se v téhle nesmí tvářit, že jede.
  if exists (
    select 1 from public.ticket_shipment_items i join public.tickets t on t.id = i.ticket_id
     where i.shipment_id = s.id and t.transit_shipment_id is not null
  ) then
    raise exception 'Některá zakázka právě cestuje v jiné zásilce.' using errcode = '23505';
  end if;

  perform set_config('jobi.zasilka_rpc', '1', true);
  update public.ticket_shipments
     set status = 'sent', sent_at = now(), sent_by = auth.uid()
   where id = s.id;
  update public.tickets t
     set transit_shipment_id = s.id,
         location_branch_id = case when s.to_branch_id = t.branch_id then null else s.to_branch_id end
    from public.ticket_shipment_items i
   where i.shipment_id = s.id and t.id = i.ticket_id;
end;
$$;
revoke all on function public.zasilka_odeslat(uuid) from public, anon;
grant execute on function public.zasilka_odeslat(uuid) to authenticated, service_role;

-- Převezme vyjmenované položky. Když jsou převzaté všechny, zásilka je „received“.
-- Nepřevzaté zakázky dál cestují (transit zůstává) – v seznamu svítí, že chybí.
create or replace function public.zasilka_prevzit(p_shipment_id uuid, p_ticket_ids uuid[])
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  s public.ticket_shipments%rowtype;
  v_zbyva integer;
begin
  select * into s from public.ticket_shipments where id = p_shipment_id for update;
  if s.id is null then
    raise exception 'Zásilka nenalezena.' using errcode = 'P0002';
  end if;
  if not public.zasilka_clen(s.service_id) then
    raise exception 'Nejste členem servisu.' using errcode = '42501';
  end if;
  if s.status = 'draft' then
    raise exception 'Zásilka ještě nebyla odeslána.' using errcode = '22023';
  end if;

  perform set_config('jobi.zasilka_rpc', '1', true);
  update public.ticket_shipment_items
     set received_at = now()
   where shipment_id = s.id and received_at is null and ticket_id = any(p_ticket_ids);
  update public.tickets t
     set transit_shipment_id = null,
         location_branch_id = case when s.to_branch_id = t.branch_id then null else s.to_branch_id end
   where t.id = any(p_ticket_ids) and t.transit_shipment_id = s.id;

  select count(*) into v_zbyva from public.ticket_shipment_items where shipment_id = s.id and received_at is null;
  if v_zbyva = 0 then
    update public.ticket_shipments
       set status = 'received', received_at = now(), received_by = auth.uid()
     where id = s.id;
  end if;
end;
$$;
revoke all on function public.zasilka_prevzit(uuid, uuid[]) from public, anon;
grant execute on function public.zasilka_prevzit(uuid, uuid[]) to authenticated, service_role;

-- Zakázka vyndaná z krabice ještě před odesláním (nebo zásilka smazaná
-- jako koncept) nic na zakázce nemění – koncept se zakázky nedotýká.

-- ========== 6) realtime ==========
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    begin
      alter publication supabase_realtime add table public.ticket_shipments;
    exception when duplicate_object then null;
    end;
    begin
      alter publication supabase_realtime add table public.ticket_shipment_items;
    exception when duplicate_object then null;
    end;
  end if;
end $$;
