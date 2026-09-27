-- Inventura skladu: fyzické přepočítání, zápis rozdílů a protokol.
--
-- Servis jednou za čas přepočítá, co opravdu leží na regálu, a potřebuje
-- (a) srovnat evidovaný stav se skutečností a (b) mít o tom doklad – kdo,
-- kdy, kolik chybělo a kolik to stálo.
--
-- ── Model ──────────────────────────────────────────────────────────────────
--   inventory_stocktakes       – jedna inventura JEDNOHO skladu (zásoba se
--                                v Jobi vede produkt × sklad, viz
--                                20260903200000). Pobočka se bere ze skladu,
--                                takže „inventura pobočky“ = inventura jejího
--                                skladu. Na sklad běží nejvýš jedna otevřená.
--   inventory_stocktake_items  – řádek na produkt: `ocekavano` (evidovaný stav
--                                skladu při zahájení, zmrazený), `rezervovano`
--                                (živé rezervace zakázek, jen pro informaci –
--                                rezervovaný díl pořád leží na regálu),
--                                `napocitano` (NULL = nespočítáno).
--
-- ── Jak se zapisuje rozdíl ──────────────────────────────────────────────────
-- Pohybovou tabulku sklad nemá: zásobu mění přímo `inventory_stock.quantity`
-- (příjem objednávky, odpis zakázky, ruční úprava) a součet na produktu
-- dopočítá trigger trg_inventory_stock_dopocet. Inventura se drží stejné
-- cesty – píše jen do `inventory_stock`, takže sedí součty, rezervace
-- (počítají se proti `inventory_products.stock`) i statistiky.
--
-- Inventura může běžet víc dní a sklad se mezitím hýbe (zakázky odepisují,
-- objednávky se přijímají). Kdyby se při uzavření stav prostě přepsal na
-- napočítané číslo, zmizel by každý pohyb mezi spočítáním a uzavřením.
-- Proto si řádek při zápisu napočítaného čísla zapamatuje, jaký byl evidovaný
-- stav právě v tu chvíli (`stav_pri_pocitani`), a uzavření přičte jen rozdíl:
--     nový stav = současný stav + (napočítáno − stav při počítání)
-- Bez pohybu mezitím vyjde přesně napočítané číslo. Pod nulu nikdy (stejně
-- jako odpis zakázky); co se opravdu zapsalo, drží `zapsany_rozdil`.
--
-- ── Práva ──────────────────────────────────────────────────────────────────
--   čtení           – člen servisu, jehož pobočka smí vidět (pobocka_povolena)
--   počítání        – can_edit_inventory NEBO can_adjust_inventory_quantity
--   zahájit/zrušit  – can_edit_inventory
--   uzavřít         – can_edit_inventory A can_adjust_inventory_quantity
--                     (druhé právo by stejně vynutil trigger
--                     enforce_inventory_capabilities při přepočtu součtu;
--                     tady se kontroluje dřív a se srozumitelnou hláškou)
-- Hlavičku inventury ani řádky nejde přes REST vložit ani smazat – jen přes
-- RPC níž. Řádek jde přes REST jen „napočítat“ (sloupec `napocitano`), vše
-- ostatní drží trigger.
--
-- Vše idempotentní (IF NOT EXISTS, DROP … IF EXISTS, CREATE OR REPLACE).

-- ========== 1) tabulky ==========

create table if not exists public.inventory_stocktakes (
  id uuid primary key default gen_random_uuid(),
  service_id uuid not null references public.services(id) on delete cascade,
  -- Smazaný sklad inventuru (doklad) nesmaže; uzavřít ji pak už nejde.
  warehouse_id uuid references public.inventory_warehouses(id) on delete set null,
  branch_id uuid references public.branches(id) on delete set null,
  -- INV-2026-001, přiděluje inventura_zahajit.
  cislo text not null,
  sklad_nazev text not null default '',
  status text not null default 'open'
    check (status in ('open', 'closed', 'cancelled')),
  poznamka text,
  zahajil uuid references auth.users(id) on delete set null,
  zahajeno_at timestamptz not null default now(),
  uzavrel uuid references auth.users(id) on delete set null,
  uzavreno_at timestamptz,
  -- Uzavřeno s výslovným „nespočítané položky nechat beze změny“.
  nespocitane_beze_zmeny boolean not null default false,
  -- Souhrn protokolu z uzavření (počty, manko/přebytek v ks a Kč).
  souhrn jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_inventory_stocktakes_service
  on public.inventory_stocktakes(service_id, zahajeno_at desc);
create unique index if not exists uq_inventory_stocktakes_cislo
  on public.inventory_stocktakes(service_id, cislo);
-- Na jeden sklad nejvýš jedna rozdělaná inventura.
create unique index if not exists uq_inventory_stocktakes_open_warehouse
  on public.inventory_stocktakes(warehouse_id) where status = 'open';

comment on table public.inventory_stocktakes is
  'Inventura jednoho skladu. Zakládá, ruší a uzavírá se jen přes RPC inventura_*.';
comment on column public.inventory_stocktakes.status is 'open | closed | cancelled';
comment on column public.inventory_stocktakes.souhrn is
  'Protokol z uzavření: polozek, spocitano, nespocitano, s_rozdilem, manko_ks, prebytek_ks, manko_kc, prebytek_kc, bez_ceny.';

create table if not exists public.inventory_stocktake_items (
  id uuid primary key default gen_random_uuid(),
  stocktake_id uuid not null references public.inventory_stocktakes(id) on delete cascade,
  service_id uuid not null references public.services(id) on delete cascade,
  -- Smazaný produkt z protokolu nezmizí (název zůstává v `nazev`).
  product_id uuid references public.inventory_products(id) on delete set null,
  nazev text not null default '',
  sku text,
  -- Nákupní cena pro ocenění rozdílu. Při zahájení i při uzavření se
  -- přepíše aktuální cenou produktu; NULL = produkt cenu nemá.
  nakupni_cena numeric(12,2),
  ocekavano integer not null default 0,
  rezervovano integer not null default 0,
  napocitano integer check (napocitano is null or napocitano >= 0),
  -- Evidovaný stav skladu ve chvíli, kdy někdo zapsal `napocitano`.
  stav_pri_pocitani integer,
  napocital uuid references auth.users(id) on delete set null,
  napocitano_at timestamptz,
  -- Vyplní uzavření: stav skladu těsně před zápisem a co se opravdu zapsalo.
  stav_pred_uzavrenim integer,
  zapsany_rozdil integer,
  -- Přidáno až během inventury (našel se díl, který evidence neměla).
  pridano_rucne boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_inventory_stocktake_items_stocktake
  on public.inventory_stocktake_items(stocktake_id);
create index if not exists idx_inventory_stocktake_items_service
  on public.inventory_stocktake_items(service_id);
create unique index if not exists uq_inventory_stocktake_items_product
  on public.inventory_stocktake_items(stocktake_id, product_id);

comment on table public.inventory_stocktake_items is
  'Řádek inventury: zmrazený evidovaný stav, napočítané kusy, kdo a kdy. Přes REST jde měnit jen napocitano.';

-- ========== 2) updated_at ==========

drop trigger if exists trg_inventory_stocktakes_set_updated_at on public.inventory_stocktakes;
create trigger trg_inventory_stocktakes_set_updated_at
  before update on public.inventory_stocktakes
  for each row execute function public.set_updated_at();

drop trigger if exists trg_inventory_stocktake_items_set_updated_at on public.inventory_stocktake_items;
create trigger trg_inventory_stocktake_items_set_updated_at
  before update on public.inventory_stocktake_items
  for each row execute function public.set_updated_at();

-- ========== 3) hlídač řádku: jen napočítat, jen v otevřené inventuře ==========
-- Uzavírající RPC si nastaví `jobi.inventura_uzaviram` = id inventury a smí
-- vyplnit i sloupce protokolu. Kdokoli jiný (REST) mění jen `napocitano`;
-- kdo a kdy a stav při počítání doplní trigger sám, ať se nedají podvrhnout.

create or replace function public.inventura_polozka_hlidac()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_status text;
  v_wh uuid;
  v_qty integer;
begin
  if coalesce(current_setting('jobi.inventura_uzaviram', true), '') = old.stocktake_id::text then
    return new;
  end if;

  select s.status, s.warehouse_id into v_status, v_wh
    from public.inventory_stocktakes s
   where s.id = old.stocktake_id;

  -- 42501 schválně: fronta neuložených změn takovou chybu neopakuje donekonečna,
  -- ale ukáže ji jako zaseknutou – číslo z regálu se tak neztratí potichu.
  if v_status is distinct from 'open' then
    raise exception 'Inventura už je uzavřená – napočítaný stav se nezapsal.' using errcode = '42501';
  end if;

  new.stocktake_id := old.stocktake_id;
  new.service_id := old.service_id;
  new.product_id := old.product_id;
  new.nazev := old.nazev;
  new.sku := old.sku;
  new.nakupni_cena := old.nakupni_cena;
  new.ocekavano := old.ocekavano;
  new.rezervovano := old.rezervovano;
  new.stav_pred_uzavrenim := old.stav_pred_uzavrenim;
  new.zapsany_rozdil := old.zapsany_rozdil;
  new.pridano_rucne := old.pridano_rucne;
  new.created_at := old.created_at;

  if new.napocitano is distinct from old.napocitano then
    if new.napocitano is null then
      new.napocital := null;
      new.napocitano_at := null;
      new.stav_pri_pocitani := null;
    else
      select st.quantity into v_qty
        from public.inventory_stock st
       where st.product_id = old.product_id and st.warehouse_id = v_wh;
      new.napocital := auth.uid();
      new.napocitano_at := now();
      new.stav_pri_pocitani := coalesce(v_qty, 0);
    end if;
  else
    new.napocital := old.napocital;
    new.napocitano_at := old.napocitano_at;
    new.stav_pri_pocitani := old.stav_pri_pocitani;
  end if;

  return new;
end;
$$;

drop trigger if exists trg_inventory_stocktake_items_hlidac on public.inventory_stocktake_items;
create trigger trg_inventory_stocktake_items_hlidac
  before update on public.inventory_stocktake_items
  for each row execute function public.inventura_polozka_hlidac();

-- ========== 4) RLS ==========

alter table public.inventory_stocktakes enable row level security;
alter table public.inventory_stocktake_items enable row level security;

drop policy if exists "inventory_stocktakes_select_members" on public.inventory_stocktakes;
create policy "inventory_stocktakes_select_members"
  on public.inventory_stocktakes for select to authenticated
  using (
    exists (
      select 1 from public.service_memberships m
       where m.service_id = inventory_stocktakes.service_id and m.user_id = auth.uid()
    )
    and public.pobocka_povolena(inventory_stocktakes.service_id, inventory_stocktakes.branch_id)
  );
-- Zápis do hlavičky jen přes RPC: žádná insert/update/delete politika.

drop policy if exists "inventory_stocktake_items_select_members" on public.inventory_stocktake_items;
create policy "inventory_stocktake_items_select_members"
  on public.inventory_stocktake_items for select to authenticated
  using (
    exists (
      select 1 from public.inventory_stocktakes s
       where s.id = inventory_stocktake_items.stocktake_id
    )
  );

drop policy if exists "inventory_stocktake_items_update_counters" on public.inventory_stocktake_items;
create policy "inventory_stocktake_items_update_counters"
  on public.inventory_stocktake_items for update to authenticated
  using (
    (public.has_capability(inventory_stocktake_items.service_id, auth.uid(), 'can_edit_inventory')
      or public.has_capability(inventory_stocktake_items.service_id, auth.uid(), 'can_adjust_inventory_quantity'))
    and exists (
      select 1 from public.inventory_stocktakes s
       where s.id = inventory_stocktake_items.stocktake_id
         and public.pobocka_povolena_zapis(s.service_id, s.branch_id)
    )
  )
  with check (
    (public.has_capability(inventory_stocktake_items.service_id, auth.uid(), 'can_edit_inventory')
      or public.has_capability(inventory_stocktake_items.service_id, auth.uid(), 'can_adjust_inventory_quantity'))
    and exists (
      select 1 from public.inventory_stocktakes s
       where s.id = inventory_stocktake_items.stocktake_id
         and public.pobocka_povolena_zapis(s.service_id, s.branch_id)
    )
  );
-- Vkládat a mazat řádky jde jen přes RPC.

-- Hradba přístupu (20260912130000): vypnutý servis nečte, bez nároku „access“ nezapisuje.
do $$
declare
  t text;
begin
  foreach t in array array['inventory_stocktakes', 'inventory_stocktake_items'] loop
    execute format('drop policy if exists %I on public.%I', t || '_jen_zapnuty_servis', t);
    execute format(
      'create policy %I on public.%I as restrictive for select to authenticated using (not (service_id = any (public.vypnute_servisy())))',
      t || '_jen_zapnuty_servis', t
    );
    execute format('drop policy if exists %I on public.%I', t || '_jen_s_pristupem_vlozeni', t);
    execute format(
      'create policy %I on public.%I as restrictive for insert to authenticated with check (service_id = any (public.servisy_kde_smim_pracovat()))',
      t || '_jen_s_pristupem_vlozeni', t
    );
    execute format('drop policy if exists %I on public.%I', t || '_jen_s_pristupem_zmena', t);
    execute format(
      'create policy %I on public.%I as restrictive for update to authenticated using (service_id = any (public.servisy_kde_smim_pracovat())) with check (service_id = any (public.servisy_kde_smim_pracovat()))',
      t || '_jen_s_pristupem_zmena', t
    );
    execute format('drop policy if exists %I on public.%I', t || '_jen_s_pristupem_mazani', t);
    execute format(
      'create policy %I on public.%I as restrictive for delete to authenticated using (service_id = any (public.servisy_kde_smim_pracovat()))',
      t || '_jen_s_pristupem_mazani', t
    );
  end loop;
end
$$;

-- ========== 5) Realtime ==========
-- Víc lidí počítá naráz: každý zápis řádku se ostatním ukáže hned.

do $$
begin
  alter publication supabase_realtime add table public.inventory_stocktakes;
exception when others then
  if sqlerrm not like '%already member%' then raise; end if;
end $$;

do $$
begin
  alter publication supabase_realtime add table public.inventory_stocktake_items;
exception when others then
  if sqlerrm not like '%already member%' then raise; end if;
end $$;

-- ========== 6) společná kontrola ==========
-- Vrátí servis inventury/skladu po ověření členství, pobočky a práva.

create or replace function public.inventura_kontrola(
  p_service_id uuid,
  p_branch_id uuid,
  p_uroven text
)
returns void
language plpgsql
security definer
stable
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    raise exception 'Not authenticated' using errcode = '42501';
  end if;
  if not exists (
    select 1 from public.service_memberships m
     where m.service_id = p_service_id and m.user_id = v_uid
  ) then
    raise exception 'Nemáte přístup k tomuto servisu' using errcode = '42501';
  end if;
  if not public.pobocka_povolena_zapis(p_service_id, p_branch_id) then
    raise exception 'Sklad patří jiné pobočce.' using errcode = '42501';
  end if;
  if p_uroven = 'pocitat' then
    if not (public.has_capability(p_service_id, v_uid, 'can_edit_inventory')
            or public.has_capability(p_service_id, v_uid, 'can_adjust_inventory_quantity')) then
      raise exception 'Nemáte oprávnění k inventuře skladu' using errcode = '42501';
    end if;
  elsif p_uroven = 'spravovat' then
    if not public.has_capability(p_service_id, v_uid, 'can_edit_inventory') then
      raise exception 'Nemáte oprávnění upravovat sklad' using errcode = '42501';
    end if;
  elsif p_uroven = 'uzavrit' then
    if not public.has_capability(p_service_id, v_uid, 'can_edit_inventory') then
      raise exception 'Nemáte oprávnění upravovat sklad' using errcode = '42501';
    end if;
    if not public.has_capability(p_service_id, v_uid, 'can_adjust_inventory_quantity') then
      raise exception 'Nemáte oprávnění měnit množství na skladě' using errcode = '42501';
    end if;
  else
    raise exception 'Neznámá úroveň oprávnění %', p_uroven;
  end if;
end;
$$;

revoke all on function public.inventura_kontrola(uuid, uuid, text) from public, anon, authenticated;

-- ========== 7) RPC: zahájit inventuru ==========
-- Zmrazí seznam produktů s evidovaným stavem ve skladu (a volitelně i ty
-- s nulou). Když na skladu už inventura běží, vrátí ji – dva lidé, kteří
-- klepnou na „Zahájit“ naráz, skončí ve stejné inventuře.

create or replace function public.inventura_zahajit(
  p_warehouse_id uuid,
  p_poznamka text default null,
  p_vcetne_nulovych boolean default false
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_service_id uuid;
  v_branch_id uuid;
  v_nazev text;
  v_id uuid;
  v_poradi bigint;
begin
  if v_uid is null then
    raise exception 'Not authenticated' using errcode = '42501';
  end if;

  select w.service_id, w.branch_id, w.name into v_service_id, v_branch_id, v_nazev
    from public.inventory_warehouses w
   where w.id = p_warehouse_id;
  if v_service_id is null then
    raise exception 'Sklad nenalezen' using errcode = 'P0002';
  end if;

  perform public.inventura_kontrola(v_service_id, v_branch_id, 'spravovat');

  -- Souběh: číslo inventury i „jedna otevřená na sklad“ se rozhodují pod zámkem servisu.
  perform pg_advisory_xact_lock(hashtext('inventura:' || v_service_id::text));

  select s.id into v_id
    from public.inventory_stocktakes s
   where s.warehouse_id = p_warehouse_id and s.status = 'open'
   limit 1;
  if v_id is not null then
    return v_id;
  end if;

  select count(*) into v_poradi
    from public.inventory_stocktakes s
   where s.service_id = v_service_id
     and s.cislo like 'INV-' || to_char(now(), 'YYYY') || '-%';

  insert into public.inventory_stocktakes (service_id, warehouse_id, branch_id, cislo, sklad_nazev, poznamka, zahajil)
  values (
    v_service_id, p_warehouse_id, v_branch_id,
    'INV-' || to_char(now(), 'YYYY') || '-' || lpad((v_poradi + 1)::text, 3, '0'),
    coalesce(v_nazev, ''), nullif(btrim(coalesce(p_poznamka, '')), ''), v_uid
  )
  returning id into v_id;

  insert into public.inventory_stocktake_items
    (stocktake_id, service_id, product_id, nazev, sku, nakupni_cena, ocekavano, rezervovano)
  select v_id, v_service_id, p.id, p.name, nullif(p.sku, ''), p.purchase_price,
         coalesce(st.quantity, 0), coalesce(r.celkem, 0)
    from public.inventory_products p
    left join public.inventory_stock st
      on st.product_id = p.id and st.warehouse_id = p_warehouse_id
    left join (
      select res.product_id, sum(res.qty)::integer as celkem
        from public.inventory_reservations res
       where res.service_id = v_service_id and res.status = 'reserved'
       group by res.product_id
    ) r on r.product_id = p.id
   where p.service_id = v_service_id
     and (coalesce(p_vcetne_nulovych, false) or coalesce(st.quantity, 0) > 0);

  return v_id;
end;
$$;

revoke all on function public.inventura_zahajit(uuid, text, boolean) from public, anon;
grant execute on function public.inventura_zahajit(uuid, text, boolean) to authenticated;

comment on function public.inventura_zahajit(uuid, text, boolean) is
  'Zahájí inventuru skladu (nebo vrátí už běžící). Zmrazí evidovaný stav a rezervace. Právo can_edit_inventory.';

-- ========== 8) RPC: přidat produkt do rozdělané inventury ==========
-- Na regálu se najde díl, který evidence ve skladu neměla (nulový stav).
-- Evidovaný stav se zmrazí na serveru, klient ho neposílá.

create or replace function public.inventura_pridat_produkt(p_id uuid, p_product_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_service_id uuid;
  v_branch_id uuid;
  v_wh uuid;
  v_status text;
  v_item uuid;
begin
  select s.service_id, s.branch_id, s.warehouse_id, s.status
    into v_service_id, v_branch_id, v_wh, v_status
    from public.inventory_stocktakes s
   where s.id = p_id;
  if v_service_id is null then
    raise exception 'Inventura nenalezena' using errcode = 'P0002';
  end if;

  perform public.inventura_kontrola(v_service_id, v_branch_id, 'pocitat');

  if v_status <> 'open' then
    raise exception 'Inventura už je uzavřená' using errcode = 'P0001';
  end if;

  if not exists (select 1 from public.inventory_products p where p.id = p_product_id and p.service_id = v_service_id) then
    raise exception 'Produkt nepatří tomuto servisu' using errcode = 'P0001';
  end if;

  select i.id into v_item
    from public.inventory_stocktake_items i
   where i.stocktake_id = p_id and i.product_id = p_product_id;
  if v_item is not null then
    return v_item;
  end if;

  insert into public.inventory_stocktake_items
    (stocktake_id, service_id, product_id, nazev, sku, nakupni_cena, ocekavano, rezervovano, pridano_rucne)
  select p_id, v_service_id, p.id, p.name, nullif(p.sku, ''), p.purchase_price,
         coalesce((select st.quantity from public.inventory_stock st where st.product_id = p.id and st.warehouse_id = v_wh), 0),
         coalesce((select sum(res.qty)::integer from public.inventory_reservations res
                    where res.product_id = p.id and res.status = 'reserved'), 0),
         true
    from public.inventory_products p
   where p.id = p_product_id
  on conflict (stocktake_id, product_id) do nothing
  returning id into v_item;

  if v_item is null then
    select i.id into v_item
      from public.inventory_stocktake_items i
     where i.stocktake_id = p_id and i.product_id = p_product_id;
  end if;

  return v_item;
end;
$$;

revoke all on function public.inventura_pridat_produkt(uuid, uuid) from public, anon;
grant execute on function public.inventura_pridat_produkt(uuid, uuid) to authenticated;

comment on function public.inventura_pridat_produkt(uuid, uuid) is
  'Přidá produkt do otevřené inventury (se zmrazeným stavem skladu). Vrací id řádku; opakované volání nic nezdvojí.';

-- ========== 9) RPC: zrušit rozdělanou inventuru ==========
-- Sklad se nemění. Řádky zůstávají (je vidět, co se napočítalo), inventura
-- se jen zamkne jako zrušená.

create or replace function public.inventura_zrusit(p_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_service_id uuid;
  v_branch_id uuid;
  v_status text;
begin
  select s.service_id, s.branch_id, s.status into v_service_id, v_branch_id, v_status
    from public.inventory_stocktakes s
   where s.id = p_id
   for update;
  if v_service_id is null then
    raise exception 'Inventura nenalezena' using errcode = 'P0002';
  end if;

  perform public.inventura_kontrola(v_service_id, v_branch_id, 'spravovat');

  if v_status = 'cancelled' then
    return;
  end if;
  if v_status = 'closed' then
    raise exception 'Uzavřenou inventuru nejde zrušit – stav skladu už je zapsaný.' using errcode = 'P0001';
  end if;

  update public.inventory_stocktakes
     set status = 'cancelled', uzavrel = auth.uid(), uzavreno_at = now()
   where id = p_id;
end;
$$;

revoke all on function public.inventura_zrusit(uuid) from public, anon;
grant execute on function public.inventura_zrusit(uuid) to authenticated;

-- ========== 10) RPC: uzavřít inventuru ==========
-- Jedna transakce: spočítá rozdíly, zapíše je do inventory_stock (součty
-- dopočítá trigger), vyplní protokol a inventuru zamkne. Opakované volání
-- na uzavřenou inventuru nic nezapíše a vrátí stejný souhrn.

create or replace function public.inventura_uzavrit(
  p_id uuid,
  p_nespocitane_beze_zmeny boolean default false,
  p_poznamka text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_st record;
  v_nespocitano integer;
  r record;
  v_cur integer;
  v_zaklad integer;
  v_novy integer;
  v_souhrn jsonb;
begin
  if v_uid is null then
    raise exception 'Not authenticated' using errcode = '42501';
  end if;

  select * into v_st
    from public.inventory_stocktakes s
   where s.id = p_id
   for update;
  if not found then
    raise exception 'Inventura nenalezena' using errcode = 'P0002';
  end if;

  perform public.inventura_kontrola(v_st.service_id, v_st.branch_id, 'uzavrit');

  if v_st.status = 'closed' then
    return coalesce(v_st.souhrn, '{}'::jsonb);
  end if;
  if v_st.status = 'cancelled' then
    raise exception 'Zrušenou inventuru nejde uzavřít' using errcode = 'P0001';
  end if;
  if v_st.warehouse_id is null
     or not exists (select 1 from public.inventory_warehouses w
                     where w.id = v_st.warehouse_id and w.service_id = v_st.service_id) then
    raise exception 'Sklad inventury už neexistuje – inventuru jde jen zrušit.' using errcode = 'P0001';
  end if;

  select count(*) into v_nespocitano
    from public.inventory_stocktake_items i
   where i.stocktake_id = p_id and i.product_id is not null and i.napocitano is null;
  if v_nespocitano > 0 and not coalesce(p_nespocitane_beze_zmeny, false) then
    raise exception 'Nespočítané položky: %. Spočítejte je, nebo potvrďte, že zůstanou beze změny.', v_nespocitano
      using errcode = 'P0001';
  end if;

  perform set_config('jobi.inventura_uzaviram', p_id::text, true);

  for r in
    select i.id, i.product_id, i.napocitano, i.stav_pri_pocitani, i.ocekavano, p.purchase_price
      from public.inventory_stocktake_items i
      join public.inventory_products p on p.id = i.product_id and p.service_id = v_st.service_id
     where i.stocktake_id = p_id
     order by i.product_id
     for update of i
  loop
    v_cur := null;
    select st.quantity into v_cur
      from public.inventory_stock st
     where st.product_id = r.product_id and st.warehouse_id = v_st.warehouse_id
     for update;
    v_cur := coalesce(v_cur, 0);

    if r.napocitano is null then
      update public.inventory_stocktake_items
         set stav_pred_uzavrenim = v_cur, zapsany_rozdil = 0, nakupni_cena = r.purchase_price
       where id = r.id;
      continue;
    end if;

    v_zaklad := coalesce(r.stav_pri_pocitani, r.ocekavano);
    v_novy := greatest(0, v_cur + (r.napocitano - v_zaklad));

    if v_novy <> v_cur then
      insert into public.inventory_stock as s (product_id, warehouse_id, service_id, quantity)
      values (r.product_id, v_st.warehouse_id, v_st.service_id, v_novy)
      on conflict (product_id, warehouse_id)
      do update set quantity = excluded.quantity, updated_at = now();
    end if;

    update public.inventory_stocktake_items
       set stav_pred_uzavrenim = v_cur, zapsany_rozdil = v_novy - v_cur, nakupni_cena = r.purchase_price
     where id = r.id;
  end loop;

  -- Souhrn protokolu. Rozdíl = napočítáno − stav při počítání (to je, o kolik
  -- se evidence mýlila); ocenění nákupní cenou, produkty bez ceny zvlášť.
  select jsonb_build_object(
           'polozek', count(*),
           'spocitano', count(*) filter (where x.napocitano is not null),
           'nespocitano', count(*) filter (where x.napocitano is null),
           's_rozdilem', count(*) filter (where x.rozdil <> 0),
           'manko_ks', coalesce(sum(-x.rozdil) filter (where x.rozdil < 0), 0),
           'prebytek_ks', coalesce(sum(x.rozdil) filter (where x.rozdil > 0), 0),
           'manko_kc', coalesce(sum(-x.rozdil * x.nakupni_cena) filter (where x.rozdil < 0 and x.nakupni_cena is not null), 0),
           'prebytek_kc', coalesce(sum(x.rozdil * x.nakupni_cena) filter (where x.rozdil > 0 and x.nakupni_cena is not null), 0),
           'bez_ceny', count(*) filter (where x.rozdil <> 0 and x.nakupni_cena is null),
           'zapsano_ks', coalesce(sum(x.zapsany_rozdil), 0)
         )
    into v_souhrn
    from (
      select i.napocitano, i.nakupni_cena, coalesce(i.zapsany_rozdil, 0) as zapsany_rozdil,
             case when i.napocitano is null then 0
                  else i.napocitano - coalesce(i.stav_pri_pocitani, i.ocekavano) end as rozdil
        from public.inventory_stocktake_items i
       where i.stocktake_id = p_id and i.product_id is not null
    ) x;

  update public.inventory_stocktakes
     set status = 'closed',
         uzavrel = v_uid,
         uzavreno_at = now(),
         nespocitane_beze_zmeny = coalesce(p_nespocitane_beze_zmeny, false),
         poznamka = coalesce(nullif(btrim(coalesce(p_poznamka, '')), ''), poznamka),
         souhrn = v_souhrn
   where id = p_id;

  perform set_config('jobi.inventura_uzaviram', '', true);

  return v_souhrn;
end;
$$;

revoke all on function public.inventura_uzavrit(uuid, boolean, text) from public, anon;
grant execute on function public.inventura_uzavrit(uuid, boolean, text) to authenticated;

comment on function public.inventura_uzavrit(uuid, boolean, text) is
  'Uzavře inventuru: zapíše rozdíly do inventory_stock (nový = současný + napočítáno − stav při počítání, nikdy pod nulu), vyplní protokol a zamkne. Práva can_edit_inventory + can_adjust_inventory_quantity.';

notify pgrst, 'reload schema';
