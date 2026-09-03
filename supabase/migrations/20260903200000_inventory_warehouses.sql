-- Víc skladů na jeden servis.
--
-- Dosud měl produkt jedno číslo `stock`. Servisy, které berou díly z víc míst
-- (vlastní sklad, pobočka, dodavatel), potřebují stejné SKU vést v každém z nich
-- zvlášť. Množství se proto stěhuje do `inventory_stock` (produkt × sklad → ks).
--
-- `inventory_products.stock` ZŮSTÁVÁ – jako součet přes všechny sklady, který
-- dopočítává trigger. Díky tomu nepřestane fungovat nic, co dnes čte jedno číslo.
-- Přibývá `public_stock` = součet jen přes sklady označené do veřejné dostupnosti.
--
-- Obě čísla jsou odvozená a triggery je při každém zápisu přepíší. Přímý zápis do
-- `stock` se tedy tiše zahodí – kdo mění zásobu, musí psát do `inventory_stock`.
-- Je to schválně: rozejít se součtu s realitou by byla přesně ta tichá chyba,
-- které se u skladu chceme vyhnout.

-- ========== 1) tabulky ==========

create table if not exists public.inventory_warehouses (
  id uuid primary key default gen_random_uuid(),
  service_id uuid not null references public.services(id) on delete cascade,
  name text not null,
  -- Kam míří automatický odpis a zápis přes API, když se neřekne jinak.
  is_default boolean not null default false,
  -- Počítat do dostupnosti ve veřejném ceníku a API?
  public_visible boolean not null default true,
  order_index integer not null default 0,
  created_at timestamptz not null default now()
);

create index if not exists idx_inventory_warehouses_service_id
  on public.inventory_warehouses(service_id);

-- Nejvýš jeden výchozí sklad na servis.
create unique index if not exists uq_inventory_warehouses_default
  on public.inventory_warehouses(service_id) where is_default;

comment on table public.inventory_warehouses is 'Sklady servisu. Každý servis má aspoň jeden.';

-- Aby šlo složeným cizím klíčem vynutit, že produkt i sklad patří témuž servisu.
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'uq_inventory_products_id_service') then
    alter table public.inventory_products add constraint uq_inventory_products_id_service unique (id, service_id);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'uq_inventory_warehouses_id_service') then
    alter table public.inventory_warehouses add constraint uq_inventory_warehouses_id_service unique (id, service_id);
  end if;
end $$;

create table if not exists public.inventory_stock (
  product_id uuid not null,
  warehouse_id uuid not null,
  service_id uuid not null references public.services(id) on delete cascade,
  quantity integer not null default 0 check (quantity >= 0),
  updated_at timestamptz not null default now(),
  primary key (product_id, warehouse_id),
  -- Složené klíče: produkt ze servisu A nejde uložit do skladu servisu B.
  foreign key (product_id, service_id)
    references public.inventory_products(id, service_id) on delete cascade,
  foreign key (warehouse_id, service_id)
    references public.inventory_warehouses(id, service_id) on delete cascade
);

create index if not exists idx_inventory_stock_warehouse on public.inventory_stock(warehouse_id);
create index if not exists idx_inventory_stock_service on public.inventory_stock(service_id);

comment on table public.inventory_stock is 'Kolik kusů produktu leží ve kterém skladu.';

alter table public.inventory_products
  add column if not exists public_stock integer not null default 0;

comment on column public.inventory_products.stock is
  'Součet přes všechny sklady. Odvozené – dopočítává trigger z inventory_stock.';
comment on column public.inventory_products.public_stock is
  'Součet přes sklady s public_visible. Odvozené – dopočítává trigger.';

-- ========== 2) přenos dosavadních dat ==========

-- Každý servis dostane výchozí sklad. Do něj se přesune dosavadní zásoba.
insert into public.inventory_warehouses (service_id, name, is_default, public_visible, order_index)
select s.id, 'Hlavní sklad', true, true, 0
  from public.services s
 where not exists (select 1 from public.inventory_warehouses w where w.service_id = s.id);

insert into public.inventory_stock (product_id, warehouse_id, service_id, quantity)
select p.id, w.id, p.service_id, p.stock
  from public.inventory_products p
  join public.inventory_warehouses w on w.service_id = p.service_id and w.is_default
 where p.stock > 0
on conflict (product_id, warehouse_id) do nothing;

-- ========== 3) dopočet ==========

create or replace function public.prepocitat_sklad_produktu(p_product uuid)
returns void
language sql
security definer
set search_path = public
as $$
  update public.inventory_products p
     set stock = coalesce((
           select sum(s.quantity) from public.inventory_stock s where s.product_id = p.id
         ), 0),
         public_stock = coalesce((
           select sum(s.quantity)
             from public.inventory_stock s
             join public.inventory_warehouses w on w.id = s.warehouse_id
            where s.product_id = p.id and w.public_visible
         ), 0)
   where p.id = p_product;
$$;

create or replace function public.prepocitat_sklad_servisu(p_service uuid)
returns void
language sql
security definer
set search_path = public
as $$
  update public.inventory_products p
     set stock = coalesce((
           select sum(s.quantity) from public.inventory_stock s where s.product_id = p.id
         ), 0),
         public_stock = coalesce((
           select sum(s.quantity)
             from public.inventory_stock s
             join public.inventory_warehouses w on w.id = s.warehouse_id
            where s.product_id = p.id and w.public_visible
         ), 0)
   where p.service_id = p_service;
$$;

-- Přepíše stock/public_stock při každém zápisu do produktu. Tím se nemůže stát,
-- že by starý klient nebo integrace přepsaly součet vedle skutečných stavů.
create or replace function public.sklad_dopocet_produktu()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  new.stock := coalesce((
    select sum(s.quantity) from public.inventory_stock s where s.product_id = new.id
  ), 0);
  new.public_stock := coalesce((
    select sum(s.quantity)
      from public.inventory_stock s
      join public.inventory_warehouses w on w.id = s.warehouse_id
     where s.product_id = new.id and w.public_visible
  ), 0);
  return new;
end;
$$;

-- Nový produkt smí přijít s počátečním množstvím – uloží se do výchozího skladu.
-- Bez toho by „přidat produkt se 3 ks“ znamenalo dva kroky v každém klientovi.
create or replace function public.sklad_novy_produkt()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_wh uuid;
begin
  if coalesce(new.stock, 0) <> 0 then
    select id into v_wh
      from public.inventory_warehouses
     where service_id = new.service_id and is_default
     limit 1;
    if v_wh is null then
      select id into v_wh
        from public.inventory_warehouses
       where service_id = new.service_id
       order by order_index, created_at
       limit 1;
    end if;
    if v_wh is not null then
      insert into public.inventory_stock (product_id, warehouse_id, service_id, quantity)
      values (new.id, v_wh, new.service_id, greatest(new.stock, 0))
      on conflict (product_id, warehouse_id) do update set quantity = excluded.quantity;
    end if;
  end if;
  perform public.prepocitat_sklad_produktu(new.id);
  return null;
end;
$$;

create or replace function public.sklad_zmena_stavu()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'DELETE' then
    perform public.prepocitat_sklad_produktu(old.product_id);
    return old;
  end if;
  perform public.prepocitat_sklad_produktu(new.product_id);
  if tg_op = 'UPDATE' and old.product_id is distinct from new.product_id then
    perform public.prepocitat_sklad_produktu(old.product_id);
  end if;
  return new;
end;
$$;

-- Přepnutí „počítat do veřejné dostupnosti“ mění public_stock všech produktů servisu.
create or replace function public.sklad_zmena_viditelnosti()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if old.public_visible is distinct from new.public_visible then
    perform public.prepocitat_sklad_servisu(new.service_id);
  end if;
  return new;
end;
$$;

-- Servis bez skladu by neuměl přijmout produkt – proto ho dostane hned při vzniku.
create or replace function public.sklad_novy_servis()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.inventory_warehouses (service_id, name, is_default, public_visible, order_index)
  values (new.id, 'Hlavní sklad', true, true, 0);
  return null;
end;
$$;

-- Poslední sklad nejde smazat. Při mazání celého servisu ale ano – tam už
-- řádek services neexistuje, protože se maže první.
create or replace function public.sklad_chranit_posledni()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if exists (select 1 from public.services s where s.id = old.service_id)
     and (select count(*) from public.inventory_warehouses w where w.service_id = old.service_id) <= 1 then
    raise exception 'Poslední sklad servisu nejde smazat';
  end if;
  return old;
end;
$$;

-- ========== 4) triggery ==========

drop trigger if exists trg_inventory_products_dopocet on public.inventory_products;
create trigger trg_inventory_products_dopocet
  before update on public.inventory_products
  for each row execute function public.sklad_dopocet_produktu();

drop trigger if exists trg_inventory_products_novy on public.inventory_products;
create trigger trg_inventory_products_novy
  after insert on public.inventory_products
  for each row execute function public.sklad_novy_produkt();

drop trigger if exists trg_inventory_stock_dopocet on public.inventory_stock;
create trigger trg_inventory_stock_dopocet
  after insert or update or delete on public.inventory_stock
  for each row execute function public.sklad_zmena_stavu();

drop trigger if exists trg_inventory_warehouses_viditelnost on public.inventory_warehouses;
create trigger trg_inventory_warehouses_viditelnost
  after update on public.inventory_warehouses
  for each row execute function public.sklad_zmena_viditelnosti();

drop trigger if exists trg_services_vychozi_sklad on public.services;
create trigger trg_services_vychozi_sklad
  after insert on public.services
  for each row execute function public.sklad_novy_servis();

drop trigger if exists trg_inventory_warehouses_posledni on public.inventory_warehouses;
create trigger trg_inventory_warehouses_posledni
  before delete on public.inventory_warehouses
  for each row execute function public.sklad_chranit_posledni();

-- Srovnat součty po přenosu dat.
update public.inventory_products p
   set stock = coalesce((
         select sum(s.quantity) from public.inventory_stock s where s.product_id = p.id
       ), 0),
       public_stock = coalesce((
         select sum(s.quantity)
           from public.inventory_stock s
           join public.inventory_warehouses w on w.id = s.warehouse_id
          where s.product_id = p.id and w.public_visible
       ), 0);

-- ========== 5) RLS ==========

alter table public.inventory_warehouses enable row level security;

drop policy if exists "inventory_warehouses_select_members" on public.inventory_warehouses;
create policy "inventory_warehouses_select_members"
  on public.inventory_warehouses for select to authenticated
  using (exists (
    select 1 from public.service_memberships m
     where m.service_id = inventory_warehouses.service_id and m.user_id = auth.uid()
  ));

drop policy if exists "inventory_warehouses_insert_members" on public.inventory_warehouses;
create policy "inventory_warehouses_insert_members"
  on public.inventory_warehouses for insert to authenticated
  with check (exists (
    select 1 from public.service_memberships m
     where m.service_id = inventory_warehouses.service_id and m.user_id = auth.uid()
  ));

drop policy if exists "inventory_warehouses_update_members" on public.inventory_warehouses;
create policy "inventory_warehouses_update_members"
  on public.inventory_warehouses for update to authenticated
  using (exists (
    select 1 from public.service_memberships m
     where m.service_id = inventory_warehouses.service_id and m.user_id = auth.uid()
  ))
  with check (exists (
    select 1 from public.service_memberships m
     where m.service_id = inventory_warehouses.service_id and m.user_id = auth.uid()
  ));

drop policy if exists "inventory_warehouses_delete_members" on public.inventory_warehouses;
create policy "inventory_warehouses_delete_members"
  on public.inventory_warehouses for delete to authenticated
  using (exists (
    select 1 from public.service_memberships m
     where m.service_id = inventory_warehouses.service_id and m.user_id = auth.uid()
  ));

alter table public.inventory_stock enable row level security;

drop policy if exists "inventory_stock_select_members" on public.inventory_stock;
create policy "inventory_stock_select_members"
  on public.inventory_stock for select to authenticated
  using (exists (
    select 1 from public.service_memberships m
     where m.service_id = inventory_stock.service_id and m.user_id = auth.uid()
  ));

drop policy if exists "inventory_stock_insert_members" on public.inventory_stock;
create policy "inventory_stock_insert_members"
  on public.inventory_stock for insert to authenticated
  with check (exists (
    select 1 from public.service_memberships m
     where m.service_id = inventory_stock.service_id and m.user_id = auth.uid()
  ));

drop policy if exists "inventory_stock_update_members" on public.inventory_stock;
create policy "inventory_stock_update_members"
  on public.inventory_stock for update to authenticated
  using (exists (
    select 1 from public.service_memberships m
     where m.service_id = inventory_stock.service_id and m.user_id = auth.uid()
  ))
  with check (exists (
    select 1 from public.service_memberships m
     where m.service_id = inventory_stock.service_id and m.user_id = auth.uid()
  ));

drop policy if exists "inventory_stock_delete_members" on public.inventory_stock;
create policy "inventory_stock_delete_members"
  on public.inventory_stock for delete to authenticated
  using (exists (
    select 1 from public.service_memberships m
     where m.service_id = inventory_stock.service_id and m.user_id = auth.uid()
  ));

-- Dopočtové funkce jsou security definer – ať je nejde volat zvenčí přímo.
revoke all on function public.prepocitat_sklad_produktu(uuid) from public, anon, authenticated;
revoke all on function public.prepocitat_sklad_servisu(uuid) from public, anon, authenticated;
