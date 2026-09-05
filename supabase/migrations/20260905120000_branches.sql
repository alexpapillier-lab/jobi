-- Pobočky.
--
-- Pobočka není nový servis: servis zůstává jedna firma (ceník, tým,
-- fakturační údaje, předplatné), pobočka je místo uvnitř servisu – vlastní
-- adresa a telefon na dokumentech a v portálu, vlastní zkratka v čísle
-- zakázky, vlastní sklady, filtr v Zakázkách / Kalendáři / Skladu /
-- Statistikách. Každý servis dostane automaticky jednu výchozí pobočku,
-- takže servis s jedním místem nic nepozná.

-- ========== 1) tabulka ==========

create table if not exists public.branches (
  id uuid primary key default gen_random_uuid(),
  service_id uuid not null references public.services(id) on delete cascade,
  name text not null,
  -- Zkratka do čísla zakázky (za zkratku servisu, před rok). Jen velká
  -- písmena bez diakritiky, max 3 – číslice by se pletly s rokem
  -- a pořadovým číslem (viz makeCode v useOrderActions).
  code text not null default '' check (code ~ '^[A-Z]{0,3}$'),
  address_street text,
  address_city text,
  address_zip text,
  phone text,
  email text,
  opening_hours text,
  -- Kam míří příjem dílů a odpis u zakázek téhle pobočky, když se neřekne jinak.
  default_warehouse_id uuid,
  is_default boolean not null default false,
  order_index integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_branches_service_id on public.branches(service_id);
create unique index if not exists uq_branches_default on public.branches(service_id) where is_default;
create unique index if not exists uq_branches_code on public.branches(service_id, code) where code <> '';

comment on table public.branches is 'Pobočky servisu. Každý servis má aspoň jednu (výchozí).';
comment on column public.branches.code is 'Zkratka pobočky v čísle zakázky: ZKRATKASERVISU + code + RR + pořadí. Prázdná = bez zkratky.';

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'uq_branches_id_service') then
    alter table public.branches add constraint uq_branches_id_service unique (id, service_id);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'branches_default_warehouse_fkey') then
    alter table public.branches
      add constraint branches_default_warehouse_fkey
      foreign key (default_warehouse_id, service_id)
      references public.inventory_warehouses(id, service_id) on delete set null;
  end if;
end $$;

drop trigger if exists trg_branches_updated_at on public.branches;
create trigger trg_branches_updated_at
  before update on public.branches
  for each row execute function public.set_updated_at();

-- ========== 2) sloupce na navázaných tabulkách ==========

alter table public.tickets add column if not exists branch_id uuid references public.branches(id) on delete set null;
alter table public.warranty_claims add column if not exists branch_id uuid references public.branches(id) on delete set null;
alter table public.invoices add column if not exists branch_id uuid references public.branches(id) on delete set null;
alter table public.inventory_warehouses add column if not exists branch_id uuid references public.branches(id) on delete set null;
-- Domovská pobočka člena: výchozí filtr a výchozí pobočka nové zakázky.
alter table public.service_memberships add column if not exists home_branch_id uuid references public.branches(id) on delete set null;

create index if not exists idx_tickets_branch on public.tickets(service_id, branch_id);
create index if not exists idx_warranty_claims_branch on public.warranty_claims(service_id, branch_id);
create index if not exists idx_invoices_branch on public.invoices(service_id, branch_id);
create index if not exists idx_inventory_warehouses_branch on public.inventory_warehouses(service_id, branch_id);

-- ========== 3) výchozí pobočka pro každý servis + přenos dat ==========

insert into public.branches (service_id, name, code, is_default, order_index)
select s.id, 'Hlavní pobočka', '', true, 0
  from public.services s
 where not exists (select 1 from public.branches b where b.service_id = s.id);

update public.tickets t set branch_id = b.id
  from public.branches b
 where b.service_id = t.service_id and b.is_default and t.branch_id is null;

update public.warranty_claims c set branch_id = b.id
  from public.branches b
 where b.service_id = c.service_id and b.is_default and c.branch_id is null;

update public.invoices i set branch_id = b.id
  from public.branches b
 where b.service_id = i.service_id and b.is_default and i.branch_id is null;

update public.inventory_warehouses w set branch_id = b.id
  from public.branches b
 where b.service_id = w.service_id and b.is_default and w.branch_id is null;

-- Výchozí sklad pobočky = výchozí sklad servisu.
update public.branches b set default_warehouse_id = w.id
  from public.inventory_warehouses w
 where w.service_id = b.service_id and w.is_default and b.is_default and b.default_warehouse_id is null;

-- ========== 4) pomocné funkce a triggery ==========

create or replace function public.default_branch_id(p_service uuid)
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select id from public.branches where service_id = p_service and is_default limit 1;
$$;

-- Nový servis dostane výchozí pobočku sám.
create or replace function public.branches_create_default_for_service()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.branches (service_id, name, code, is_default, order_index)
  values (new.id, 'Hlavní pobočka', '', true, 0);
  return new;
end;
$$;

drop trigger if exists trg_services_default_branch on public.services;
create trigger trg_services_default_branch
  after insert on public.services
  for each row execute function public.branches_create_default_for_service();

-- Řádek bez pobočky (starší klient, API, import) padá do výchozí pobočky.
create or replace function public.branches_fill_default()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.branch_id is null then
    new.branch_id := public.default_branch_id(new.service_id);
  end if;
  return new;
end;
$$;

drop trigger if exists trg_tickets_fill_branch on public.tickets;
create trigger trg_tickets_fill_branch
  before insert on public.tickets
  for each row execute function public.branches_fill_default();

drop trigger if exists trg_warranty_claims_fill_branch on public.warranty_claims;
create trigger trg_warranty_claims_fill_branch
  before insert on public.warranty_claims
  for each row execute function public.branches_fill_default();

drop trigger if exists trg_invoices_fill_branch on public.invoices;
create trigger trg_invoices_fill_branch
  before insert on public.invoices
  for each row execute function public.branches_fill_default();

drop trigger if exists trg_inventory_warehouses_fill_branch on public.inventory_warehouses;
create trigger trg_inventory_warehouses_fill_branch
  before insert on public.inventory_warehouses
  for each row execute function public.branches_fill_default();

-- Jediná výchozí pobočka na servis: nastavení nové výchozí odebere příznak ostatním.
create or replace function public.branches_single_default()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.is_default then
    update public.branches set is_default = false
     where service_id = new.service_id and id <> new.id and is_default;
  elsif tg_op = 'UPDATE' and old.is_default and not exists (
    select 1 from public.branches where service_id = new.service_id and id <> new.id and is_default
  ) then
    -- Odebrat výchozí bez náhrady nejde – servis by neměl kam sázet nové zakázky.
    new.is_default := true;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_branches_single_default on public.branches;
create trigger trg_branches_single_default
  before insert or update of is_default on public.branches
  for each row execute function public.branches_single_default();

-- Mazání: výchozí pobočka nejde smazat; zakázky, sklady a faktury smazané
-- pobočky přejdou pod výchozí, aby nikde nezůstaly bez místa.
create or replace function public.branches_before_delete()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if old.is_default then
    raise exception 'Výchozí pobočku nelze smazat. Nejdřív nastavte jako výchozí jinou pobočku.'
      using errcode = 'check_violation';
  end if;
  return old;
end;
$$;

drop trigger if exists trg_branches_before_delete on public.branches;
create trigger trg_branches_before_delete
  before delete on public.branches
  for each row execute function public.branches_before_delete();

create or replace function public.branches_after_delete()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_default uuid;
begin
  v_default := public.default_branch_id(old.service_id);
  if v_default is null then return old; end if;
  update public.tickets set branch_id = v_default where service_id = old.service_id and branch_id is null;
  update public.warranty_claims set branch_id = v_default where service_id = old.service_id and branch_id is null;
  update public.invoices set branch_id = v_default where service_id = old.service_id and branch_id is null;
  update public.inventory_warehouses set branch_id = v_default where service_id = old.service_id and branch_id is null;
  return old;
end;
$$;

drop trigger if exists trg_branches_after_delete on public.branches;
create trigger trg_branches_after_delete
  after delete on public.branches
  for each row execute function public.branches_after_delete();

-- Domovská pobočka člena: sám sobě, nebo owner/admin komukoli.
create or replace function public.set_member_home_branch(p_service_id uuid, p_user_id uuid, p_branch_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'Nepřihlášeno' using errcode = '28000';
  end if;
  if auth.uid() <> p_user_id and not public.is_owner_or_admin(p_service_id) then
    raise exception 'Domovskou pobočku může měnit jen majitel nebo správce.' using errcode = '42501';
  end if;
  if p_branch_id is not null and not exists (
    select 1 from public.branches where id = p_branch_id and service_id = p_service_id
  ) then
    raise exception 'Pobočka nepatří k tomuto servisu.' using errcode = 'foreign_key_violation';
  end if;
  update public.service_memberships
     set home_branch_id = p_branch_id
   where service_id = p_service_id and user_id = p_user_id;
end;
$$;

grant execute on function public.set_member_home_branch(uuid, uuid, uuid) to authenticated;
grant execute on function public.default_branch_id(uuid) to authenticated;

-- ========== 5) RLS ==========

alter table public.branches enable row level security;

drop policy if exists branches_select_by_membership on public.branches;
create policy branches_select_by_membership
  on public.branches for select to authenticated
  using (exists (
    select 1 from public.service_memberships m
     where m.service_id = branches.service_id and m.user_id = auth.uid()
  ));

drop policy if exists branches_insert_by_admin on public.branches;
create policy branches_insert_by_admin
  on public.branches for insert to authenticated
  with check (public.is_owner_or_admin(service_id));

drop policy if exists branches_update_by_admin on public.branches;
create policy branches_update_by_admin
  on public.branches for update to authenticated
  using (public.is_owner_or_admin(service_id))
  with check (public.is_owner_or_admin(service_id));

drop policy if exists branches_delete_by_admin on public.branches;
create policy branches_delete_by_admin
  on public.branches for delete to authenticated
  using (public.is_owner_or_admin(service_id));

grant select, insert, update, delete on public.branches to authenticated;

-- ========== 6) realtime ==========

do $$
begin
  alter publication supabase_realtime add table public.branches;
exception when others then
  if sqlerrm not like '%already member%' then raise; end if;
end $$;
