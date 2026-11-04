-- Pokladna
-- ============================================================================
--
-- Volitelný modul (service_settings.config.pokladna = true, zapíná správce
-- v Nastavení → Firma → Pokladna). Servis může mít víc pokladen, i víc na
-- jedné pobočce. Každý pohyb peněz je řádek v pokladna_pohyby:
--
--   • platba za zakázku / fakturu (hotově, kartou, převodem), záloha,
--   • ruční příjem a výdaj s volnou kategorií, vklad, výběr, odvod do banky,
--   • převod mezi pokladnami (dva řádky se společným prevod_id),
--   • rozdíl z uzávěrky (napočítáno ≠ očekáváno).
--
-- Pohyby se NEMAŽOU ani neupravují. Chyba se opraví stornem: nový řádek
-- s opačným směrem a storno_id → původní. Historie tak sedí i zpětně.
-- Stav hotovosti = počáteční stav + hotovostní příjmy − hotovostní výdaje.
-- Platba kartou a převodem se eviduje (tržba, zaplacená zakázka), ale stav
-- šuplíku nemění.
--
-- Zápis jde jen přes funkce níž (security definer), tabulky samy mají jen
-- čtení. Funkce hlídají členství, právo can_use_pokladna, pobočku a to, že
-- servis smí pracovat.
--
-- Právo can_use_pokladna: chybějící klíč = POVOLENO (stejně jako
-- can_view_statistics). Majitel ho členovi odebere v Nastavení → Tým.

-- ── 1) Seznam práv členů ────────────────────────────────────────────────────
-- Musí se shodovat s TeamSettings.tsx a team-set-capabilities (hlídá test
-- src/lib/opravneniSeznam.test.ts).
create or replace function public.povolene_capability()
returns text[]
language sql
immutable
set search_path = public
as $$
  select array[
    'can_manage_tickets_basic',
    'can_change_ticket_status',
    'can_delete_tickets',
    'can_manage_ticket_archive',
    'can_manage_customers',
    'can_manage_statuses',
    'can_manage_documents',
    'can_print_export',
    'can_edit_devices',
    'can_edit_inventory',
    'can_adjust_inventory_quantity',
    'can_edit_service_settings',
    'can_view_statistics',
    'can_use_pokladna',
    'branch_only'
  ]::text[];
$$;

revoke all on function public.povolene_capability() from public, anon;
grant execute on function public.povolene_capability() to authenticated, service_role;

-- ── 2) Tabulky ──────────────────────────────────────────────────────────────
create table if not exists public.pokladny (
  id uuid primary key default gen_random_uuid(),
  service_id uuid not null references public.services(id) on delete cascade,
  branch_id uuid references public.branches(id) on delete set null,
  nazev text not null check (char_length(btrim(nazev)) between 1 and 60),
  pocatecni_stav numeric(12, 2) not null default 0,
  poradi integer not null default 0,
  archivovana_at timestamptz,
  created_at timestamptz not null default now(),
  created_by uuid references auth.users(id) on delete set null
);
create index if not exists pokladny_service_idx on public.pokladny (service_id);

create table if not exists public.pokladna_uzaverky (
  id uuid primary key default gen_random_uuid(),
  service_id uuid not null references public.services(id) on delete cascade,
  pokladna_id uuid not null references public.pokladny(id) on delete cascade,
  ocekavano numeric(12, 2) not null,
  napocitano numeric(12, 2) not null,
  rozdil numeric(12, 2) generated always as (napocitano - ocekavano) stored,
  -- Napočítané bankovky a mince: {"5000": 2, "100": 7, …}
  platidla jsonb,
  poznamka text,
  created_at timestamptz not null default now(),
  created_by uuid references auth.users(id) on delete set null
);
create index if not exists pokladna_uzaverky_pokladna_idx on public.pokladna_uzaverky (pokladna_id, created_at desc);

create table if not exists public.pokladna_pohyby (
  id uuid primary key default gen_random_uuid(),
  service_id uuid not null references public.services(id) on delete cascade,
  pokladna_id uuid not null references public.pokladny(id) on delete cascade,
  smer text not null check (smer in ('prijem', 'vydej')),
  castka numeric(12, 2) not null check (castka > 0 and castka < 10000000),
  zpusob text not null default 'cash' check (zpusob in ('cash', 'card', 'transfer')),
  druh text not null check (druh in ('zakazka', 'zaloha', 'faktura', 'prijem', 'vydej', 'vklad', 'vyber', 'odvod', 'prevod', 'rozdil', 'storno')),
  kategorie text check (kategorie is null or char_length(kategorie) <= 60),
  popis text check (popis is null or char_length(popis) <= 500),
  ticket_id uuid references public.tickets(id) on delete set null,
  invoice_id uuid references public.invoices(id) on delete set null,
  -- Hotovost se platí na celé koruny; rozdíl proti ceně zakázky (+ / −).
  zaokrouhleni numeric(12, 2) not null default 0,
  prevod_id uuid,
  storno_id uuid unique references public.pokladna_pohyby(id) on delete set null,
  uzaverka_id uuid references public.pokladna_uzaverky(id) on delete set null,
  created_at timestamptz not null default now(),
  created_by uuid references auth.users(id) on delete set null
);
create index if not exists pokladna_pohyby_pokladna_idx on public.pokladna_pohyby (pokladna_id, created_at desc);
create index if not exists pokladna_pohyby_service_idx on public.pokladna_pohyby (service_id, created_at desc);
create index if not exists pokladna_pohyby_ticket_idx on public.pokladna_pohyby (ticket_id) where ticket_id is not null;
create index if not exists pokladna_pohyby_invoice_idx on public.pokladna_pohyby (invoice_id) where invoice_id is not null;

comment on table public.pokladny is 'Pokladny servisu (modul Pokladna). Zápis jen přes pokladna_uloz.';
comment on table public.pokladna_pohyby is 'Pohyby peněz v pokladně. Nemažou se, chyba se opraví stornem (storno_id). Zápis jen přes funkce pokladna_*.';
comment on table public.pokladna_uzaverky is 'Uzávěrky pokladny: očekávaný a napočítaný stav hotovosti.';

-- ── 3) Kdo smí ──────────────────────────────────────────────────────────────
create or replace function public.pokladna_smi(p_service_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
set row_security = off
as $$
  select auth.uid() is not null and exists (
    select 1 from public.service_memberships m
     where m.service_id = p_service_id
       and m.user_id = auth.uid()
       and (m.role in ('owner', 'admin') or coalesce(m.capabilities ->> 'can_use_pokladna', 'true') <> 'false')
  );
$$;
revoke all on function public.pokladna_smi(uuid) from public, anon;
grant execute on function public.pokladna_smi(uuid) to authenticated, service_role;

create or replace function public.pokladna_spravce(p_service_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
set row_security = off
as $$
  select auth.uid() is not null and exists (
    select 1 from public.service_memberships m
     where m.service_id = p_service_id and m.user_id = auth.uid() and m.role in ('owner', 'admin')
  );
$$;
revoke all on function public.pokladna_spravce(uuid) from public, anon;
grant execute on function public.pokladna_spravce(uuid) to authenticated, service_role;

alter table public.pokladny enable row level security;
alter table public.pokladna_pohyby enable row level security;
alter table public.pokladna_uzaverky enable row level security;

revoke all on public.pokladny, public.pokladna_pohyby, public.pokladna_uzaverky from anon;
revoke insert, update, delete on public.pokladny, public.pokladna_pohyby, public.pokladna_uzaverky from authenticated;
grant select on public.pokladny, public.pokladna_pohyby, public.pokladna_uzaverky to authenticated;

drop policy if exists pokladny_cte on public.pokladny;
create policy pokladny_cte on public.pokladny for select to authenticated
  using (public.pokladna_smi(service_id) and public.pobocka_povolena(service_id, branch_id));

drop policy if exists pokladna_pohyby_cte on public.pokladna_pohyby;
create policy pokladna_pohyby_cte on public.pokladna_pohyby for select to authenticated
  using (exists (select 1 from public.pokladny p where p.id = pokladna_pohyby.pokladna_id));

drop policy if exists pokladna_uzaverky_cte on public.pokladna_uzaverky;
create policy pokladna_uzaverky_cte on public.pokladna_uzaverky for select to authenticated
  using (exists (select 1 from public.pokladny p where p.id = pokladna_uzaverky.pokladna_id));

-- Hradba (vzor 20260912130000 / 20260927100000): vypnutý servis nic nevidí.
do $$
declare
  t text;
begin
  foreach t in array array['pokladny', 'pokladna_pohyby', 'pokladna_uzaverky'] loop
    execute format('drop policy if exists %I on public.%I', t || '_jen_zapnuty_servis', t);
    execute format(
      'create policy %I on public.%I as restrictive for select to authenticated using (not (service_id = any (public.vypnute_servisy())))',
      t || '_jen_zapnuty_servis', t
    );
  end loop;
end
$$;

-- ── 4) Pomocné funkce zápisu ────────────────────────────────────────────────
-- Pokladna, do které volající smí zapisovat; jinak výjimka.
create or replace function public.pokladna_pro_zapis(p_pokladna_id uuid)
returns public.pokladny
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  p public.pokladny;
begin
  select * into p from public.pokladny where id = p_pokladna_id;
  if p.id is null then
    raise exception 'Pokladna nenalezena.' using errcode = 'P0002';
  end if;
  if not public.pokladna_smi(p.service_id) then
    raise exception 'Nemáte přístup k pokladně.' using errcode = '42501';
  end if;
  if not public.servis_smi_pracovat(p.service_id) then
    raise exception 'Servis je vypnutý nebo mu skončil přístup.' using errcode = '42501';
  end if;
  if not public.pobocka_povolena(p.service_id, p.branch_id) then
    raise exception 'Pokladna patří jiné pobočce.' using errcode = '42501';
  end if;
  if p.archivovana_at is not null then
    raise exception 'Pokladna je archivovaná.' using errcode = '22023';
  end if;
  return p;
end;
$$;
revoke all on function public.pokladna_pro_zapis(uuid) from public, anon, authenticated;

-- Stav hotovosti (bez karet a převodů).
create or replace function public.pokladna_stav_hotovosti(p_pokladna_id uuid)
returns numeric
language sql
stable
security definer
set search_path = public
set row_security = off
as $$
  select p.pocatecni_stav + coalesce((
    select sum(case when h.smer = 'prijem' then h.castka else -h.castka end)
      from public.pokladna_pohyby h
     where h.pokladna_id = p.id and h.zpusob = 'cash'
  ), 0)
  from public.pokladny p where p.id = p_pokladna_id;
$$;
revoke all on function public.pokladna_stav_hotovosti(uuid) from public, anon, authenticated;

-- ── 5) Správa pokladen (majitel a správce) ──────────────────────────────────
create or replace function public.pokladna_uloz(
  p_id uuid,
  p_service_id uuid,
  p_nazev text,
  p_branch_id uuid,
  p_pocatecni_stav numeric,
  p_poradi integer default null,
  p_archivovat boolean default false
)
returns public.pokladny
language plpgsql
security definer
set search_path = public
as $$
declare
  p public.pokladny;
begin
  if not public.pokladna_spravce(p_service_id) then
    raise exception 'Pokladny spravuje majitel nebo správce servisu.' using errcode = '42501';
  end if;
  if not public.servis_smi_pracovat(p_service_id) then
    raise exception 'Servis je vypnutý nebo mu skončil přístup.' using errcode = '42501';
  end if;
  if p_branch_id is not null and not exists (select 1 from public.branches b where b.id = p_branch_id and b.service_id = p_service_id) then
    raise exception 'Pobočka nepatří servisu.' using errcode = '42501';
  end if;
  if coalesce(p_pocatecni_stav, 0) < 0 or coalesce(p_pocatecni_stav, 0) >= 10000000 then
    raise exception 'Neplatný počáteční stav.' using errcode = '22023';
  end if;

  if p_id is null then
    insert into public.pokladny (service_id, branch_id, nazev, pocatecni_stav, poradi, created_by)
    values (p_service_id, p_branch_id, btrim(p_nazev), coalesce(p_pocatecni_stav, 0),
            coalesce(p_poradi, (select coalesce(max(poradi), 0) + 1 from public.pokladny where service_id = p_service_id)),
            auth.uid())
    returning * into p;
    return p;
  end if;

  select * into p from public.pokladny where id = p_id and service_id = p_service_id for update;
  if p.id is null then
    raise exception 'Pokladna nenalezena.' using errcode = 'P0002';
  end if;
  -- Počáteční stav po prvním pohybu změnit nejde – přepsal by celou historii.
  if coalesce(p_pocatecni_stav, 0) <> p.pocatecni_stav
     and exists (select 1 from public.pokladna_pohyby h where h.pokladna_id = p.id) then
    raise exception 'Počáteční stav nejde změnit, pokladna už má pohyby. Použijte vklad nebo výběr.' using errcode = '22023';
  end if;
  update public.pokladny
     set nazev = btrim(p_nazev),
         branch_id = p_branch_id,
         pocatecni_stav = coalesce(p_pocatecni_stav, 0),
         poradi = coalesce(p_poradi, poradi),
         archivovana_at = case when p_archivovat then coalesce(archivovana_at, now()) else null end
   where id = p.id
  returning * into p;
  return p;
end;
$$;
revoke all on function public.pokladna_uloz(uuid, uuid, text, uuid, numeric, integer, boolean) from public, anon;
grant execute on function public.pokladna_uloz(uuid, uuid, text, uuid, numeric, integer, boolean) to authenticated;

-- ── 6) Ruční pohyb: příjem, výdaj, vklad, výběr, odvod do banky ─────────────
create or replace function public.pokladna_zapis(
  p_pokladna_id uuid,
  p_druh text,
  p_castka numeric,
  p_zpusob text default 'cash',
  p_kategorie text default null,
  p_popis text default null
)
returns public.pokladna_pohyby
language plpgsql
security definer
set search_path = public
as $$
declare
  p public.pokladny;
  h public.pokladna_pohyby;
  v_smer text;
begin
  p := public.pokladna_pro_zapis(p_pokladna_id);
  v_smer := case p_druh
    when 'prijem' then 'prijem'
    when 'vklad' then 'prijem'
    when 'vydej' then 'vydej'
    when 'vyber' then 'vydej'
    when 'odvod' then 'vydej'
  end;
  if v_smer is null then
    raise exception 'Neznámý druh pohybu.' using errcode = '22023';
  end if;
  if p_druh in ('vklad', 'vyber', 'odvod') and coalesce(p_zpusob, 'cash') <> 'cash' then
    raise exception 'Vklad, výběr a odvod jsou jen v hotovosti.' using errcode = '22023';
  end if;
  insert into public.pokladna_pohyby (service_id, pokladna_id, smer, castka, zpusob, druh, kategorie, popis, created_by)
  values (p.service_id, p.id, v_smer, round(p_castka, 2), coalesce(p_zpusob, 'cash'), p_druh,
          nullif(btrim(coalesce(p_kategorie, '')), ''), nullif(btrim(coalesce(p_popis, '')), ''), auth.uid())
  returning * into h;
  return h;
end;
$$;
revoke all on function public.pokladna_zapis(uuid, text, numeric, text, text, text) from public, anon;
grant execute on function public.pokladna_zapis(uuid, text, numeric, text, text, text) to authenticated;

-- ── 7) Platba za zakázku nebo fakturu, záloha ───────────────────────────────
-- Faktura zaplacená celou částkou (druh zakazka/faktura) se označí jako
-- zaplacená s daným způsobem platby a zapíše se do její historie. Stav
-- zakázky (Vydáno) mění aplikace přes change_ticket_status, ať proběhne
-- všechno, co k vydání patří (sklad, tisk, automatizace).
create or replace function public.pokladna_zaplatit(
  p_pokladna_id uuid,
  p_druh text,
  p_castka numeric,
  p_zpusob text,
  p_ticket_id uuid default null,
  p_invoice_id uuid default null,
  p_zaokrouhleni numeric default 0,
  p_popis text default null
)
returns public.pokladna_pohyby
language plpgsql
security definer
set search_path = public
as $$
declare
  p public.pokladny;
  h public.pokladna_pohyby;
  v_ticket_service uuid;
  inv record;
begin
  p := public.pokladna_pro_zapis(p_pokladna_id);
  if p_druh not in ('zakazka', 'zaloha', 'faktura') then
    raise exception 'Neznámý druh platby.' using errcode = '22023';
  end if;
  if p_ticket_id is null and p_invoice_id is null then
    raise exception 'Chybí zakázka nebo faktura.' using errcode = '22023';
  end if;
  if p_druh = 'zaloha' and p_ticket_id is null then
    raise exception 'Záloha patří k zakázce.' using errcode = '22023';
  end if;
  if abs(coalesce(p_zaokrouhleni, 0)) >= 1 then
    raise exception 'Zaokrouhlení může být nejvýš ±0,99 Kč.' using errcode = '22023';
  end if;

  if p_ticket_id is not null then
    select service_id into v_ticket_service from public.tickets where id = p_ticket_id and deleted_at is null;
    if v_ticket_service is null or v_ticket_service <> p.service_id then
      raise exception 'Zakázka nenalezena.' using errcode = 'P0002';
    end if;
    perform public.kontrola_pobocky_zakazky(p_ticket_id);
  end if;

  if p_invoice_id is not null then
    select id, service_id, status, ticket_id, deleted_at into inv from public.invoices where id = p_invoice_id;
    if inv.id is null or inv.service_id <> p.service_id or inv.deleted_at is not null then
      raise exception 'Faktura nenalezena.' using errcode = 'P0002';
    end if;
    -- Vazby faktura ↔ zakázka (i souhrnná faktura) jsou v invoice_tickets.
    if p_ticket_id is not null and inv.ticket_id is distinct from p_ticket_id
       and not exists (select 1 from public.invoice_tickets it where it.invoice_id = inv.id and it.ticket_id = p_ticket_id) then
      raise exception 'Faktura nepatří k zakázce.' using errcode = '22023';
    end if;
    if inv.status = 'paid' and p_druh <> 'zaloha' then
      raise exception 'Faktura už je zaplacená.' using errcode = '22023';
    end if;
  end if;

  insert into public.pokladna_pohyby (service_id, pokladna_id, smer, castka, zpusob, druh, popis, ticket_id, invoice_id, zaokrouhleni, created_by)
  values (p.service_id, p.id, 'prijem', round(p_castka, 2), coalesce(p_zpusob, 'cash'), p_druh,
          nullif(btrim(coalesce(p_popis, '')), ''), p_ticket_id, p_invoice_id, round(coalesce(p_zaokrouhleni, 0), 2), auth.uid())
  returning * into h;

  if p_invoice_id is not null and p_druh <> 'zaloha' then
    update public.invoices
       set status = 'paid', paid_at = now(), payment_method = coalesce(p_zpusob, 'cash')
     where id = p_invoice_id;
    insert into public.invoice_events (invoice_id, type, payload, created_by)
    values (p_invoice_id, 'status_changed', jsonb_build_object('from', inv.status, 'to', 'paid', 'pokladna', p.nazev), auth.uid());
  end if;
  return h;
end;
$$;
revoke all on function public.pokladna_zaplatit(uuid, text, numeric, text, uuid, uuid, numeric, text) from public, anon;
grant execute on function public.pokladna_zaplatit(uuid, text, numeric, text, uuid, uuid, numeric, text) to authenticated;

-- ── 8) Převod mezi pokladnami ───────────────────────────────────────────────
create or replace function public.pokladna_prevod(p_z uuid, p_do uuid, p_castka numeric, p_popis text default null)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  z public.pokladny;
  d public.pokladny;
  v_prevod uuid := gen_random_uuid();
begin
  z := public.pokladna_pro_zapis(p_z);
  select * into d from public.pokladny where id = p_do;
  if d.id is null or d.service_id <> z.service_id or d.archivovana_at is not null then
    raise exception 'Cílová pokladna nenalezena.' using errcode = 'P0002';
  end if;
  if d.id = z.id then
    raise exception 'Převod do stejné pokladny nedává smysl.' using errcode = '22023';
  end if;
  insert into public.pokladna_pohyby (service_id, pokladna_id, smer, castka, zpusob, druh, popis, prevod_id, created_by)
  values (z.service_id, z.id, 'vydej', round(p_castka, 2), 'cash', 'prevod', nullif(btrim(coalesce(p_popis, '')), ''), v_prevod, auth.uid()),
         (z.service_id, d.id, 'prijem', round(p_castka, 2), 'cash', 'prevod', nullif(btrim(coalesce(p_popis, '')), ''), v_prevod, auth.uid());
  return v_prevod;
end;
$$;
revoke all on function public.pokladna_prevod(uuid, uuid, numeric, text) from public, anon;
grant execute on function public.pokladna_prevod(uuid, uuid, numeric, text) to authenticated;

-- ── 9) Storno ───────────────────────────────────────────────────────────────
-- Protizápis s opačným směrem. Převod se stornuje celý (obě nohy). Storno
-- platby faktury vrátí fakturu mezi nezaplacené.
create or replace function public.pokladna_storno(p_pohyb_id uuid, p_duvod text default null)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  h public.pokladna_pohyby;
  r public.pokladna_pohyby;
  v_pocet integer := 0;
begin
  select * into h from public.pokladna_pohyby where id = p_pohyb_id for update;
  if h.id is null then
    raise exception 'Pohyb nenalezen.' using errcode = 'P0002';
  end if;
  perform public.pokladna_pro_zapis(h.pokladna_id);
  if h.druh = 'storno' then
    raise exception 'Storno se nestornuje.' using errcode = '22023';
  end if;
  if h.druh = 'rozdil' then
    raise exception 'Rozdíl z uzávěrky nejde stornovat. Opravte ho vkladem nebo výběrem.' using errcode = '22023';
  end if;

  for r in
    select * from public.pokladna_pohyby
     where (id = h.id or (h.prevod_id is not null and prevod_id = h.prevod_id))
       and not exists (select 1 from public.pokladna_pohyby s where s.storno_id = pokladna_pohyby.id)
     for update
  loop
    insert into public.pokladna_pohyby (service_id, pokladna_id, smer, castka, zpusob, druh, kategorie, popis, ticket_id, invoice_id, zaokrouhleni, prevod_id, storno_id, created_by)
    values (r.service_id, r.pokladna_id, case when r.smer = 'prijem' then 'vydej' else 'prijem' end, r.castka, r.zpusob, 'storno',
            r.kategorie, nullif(btrim(coalesce(p_duvod, '')), ''), r.ticket_id, r.invoice_id, -r.zaokrouhleni, r.prevod_id, r.id, auth.uid());
    v_pocet := v_pocet + 1;

    if r.invoice_id is not null and r.druh in ('zakazka', 'faktura') then
      update public.invoices
         set status = 'issued', paid_at = null, payment_method = null
       where id = r.invoice_id and status = 'paid';
      if found then
        insert into public.invoice_events (invoice_id, type, payload, created_by)
        values (r.invoice_id, 'status_changed', jsonb_build_object('from', 'paid', 'to', 'issued', 'pokladna', 'storno platby'), auth.uid());
      end if;
    end if;
  end loop;

  if v_pocet = 0 then
    raise exception 'Pohyb už je stornovaný.' using errcode = '22023';
  end if;
  return v_pocet;
end;
$$;
revoke all on function public.pokladna_storno(uuid, text) from public, anon;
grant execute on function public.pokladna_storno(uuid, text) to authenticated;

-- ── 10) Uzávěrka ────────────────────────────────────────────────────────────
-- Očekávaný stav spočítá server. Rozdíl se zapíše jako pohyb, takže stav
-- pokladny potom odpovídá napočítané hotovosti.
create or replace function public.pokladna_uzavrit(p_pokladna_id uuid, p_napocitano numeric, p_platidla jsonb default null, p_poznamka text default null)
returns public.pokladna_uzaverky
language plpgsql
security definer
set search_path = public
as $$
declare
  p public.pokladny;
  u public.pokladna_uzaverky;
  v_ocekavano numeric;
begin
  p := public.pokladna_pro_zapis(p_pokladna_id);
  if p_napocitano is null or p_napocitano < 0 or p_napocitano >= 10000000 then
    raise exception 'Neplatná napočítaná částka.' using errcode = '22023';
  end if;
  perform 1 from public.pokladny where id = p.id for update;
  v_ocekavano := public.pokladna_stav_hotovosti(p.id);

  insert into public.pokladna_uzaverky (service_id, pokladna_id, ocekavano, napocitano, platidla, poznamka, created_by)
  values (p.service_id, p.id, v_ocekavano, round(p_napocitano, 2), p_platidla, nullif(btrim(coalesce(p_poznamka, '')), ''), auth.uid())
  returning * into u;

  if u.rozdil <> 0 then
    insert into public.pokladna_pohyby (service_id, pokladna_id, smer, castka, zpusob, druh, popis, uzaverka_id, created_by)
    values (p.service_id, p.id, case when u.rozdil > 0 then 'prijem' else 'vydej' end, abs(u.rozdil), 'cash', 'rozdil',
            case when u.rozdil > 0 then 'Přebytek při uzávěrce' else 'Manko při uzávěrce' end, u.id, auth.uid());
  end if;
  return u;
end;
$$;
revoke all on function public.pokladna_uzavrit(uuid, numeric, jsonb, text) from public, anon;
grant execute on function public.pokladna_uzavrit(uuid, numeric, jsonb, text) to authenticated;

-- ── 11) Přehled pokladen pro stránku ────────────────────────────────────────
-- Stav hotovosti a poslední uzávěrka každé pokladny, kterou volající vidí.
-- Bez security definer: viditelnost řeší RLS tabulek.
create or replace function public.pokladna_stavy(p_service_id uuid)
returns table (pokladna_id uuid, stav numeric, posledni_uzaverka_at timestamptz, hotovostni_od_uzaverky integer)
language sql
stable
set search_path = public
as $$
  select p.id,
         p.pocatecni_stav + coalesce(sum(case when h.zpusob = 'cash' then (case when h.smer = 'prijem' then h.castka else -h.castka end) end), 0),
         u.posledni,
         count(h.id) filter (where h.zpusob = 'cash' and h.druh <> 'rozdil' and (u.posledni is null or h.created_at > u.posledni))::integer
    from public.pokladny p
    left join public.pokladna_pohyby h on h.pokladna_id = p.id
    left join lateral (select max(created_at) as posledni from public.pokladna_uzaverky x where x.pokladna_id = p.id) u on true
   where p.service_id = p_service_id
   group by p.id, p.pocatecni_stav, u.posledni;
$$;
revoke all on function public.pokladna_stavy(uuid) from public, anon;
grant execute on function public.pokladna_stavy(uuid) to authenticated;

-- ── 12) Realtime ────────────────────────────────────────────────────────────
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    begin
      alter publication supabase_realtime add table public.pokladna_pohyby;
    exception when duplicate_object then null;
    end;
    begin
      alter publication supabase_realtime add table public.pokladny;
    exception when duplicate_object then null;
    end;
  end if;
end $$;
