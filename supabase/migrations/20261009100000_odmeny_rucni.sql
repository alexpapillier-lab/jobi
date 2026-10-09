-- ============================================================================
-- Odměny týmu: ruční odměny podle pravidel ze Nastavení
-- ============================================================================
--
-- PROČ: Odměny dosud vznikaly jen z provedených oprav s příznakem „Nabídnuto
-- navíc“. Majitel chce, aby si zaměstnanec mohl na stránce Odměny přidat
-- i odměnu, která na zakázce nevznikla (prodal sklo kamarádovi u pultu,
-- čištění bez zakázky…) – vždy podle pravidla z Nastavení a s poznámkou.
--
-- Jak to funguje:
--   * odmeny_rucni – jeden řádek = jedna ruční odměna. Pravidlo a částka
--     jsou SNÍMEK v okamžiku přidání (pozdější změna pravidla odměnu
--     nepřepočítá). Částku počítá vždy server z pravidla v configu
--     (service_settings.config.odmeny.pravidla) – klient ji neposílá.
--   * Přidává se jen funkcí odmeny_rucni_pridat (REST insert není povolený).
--     Zaměstnanec jen sám sobě; jeho odměna čeká na schválení (stav 'ceka')
--     a do součtů se nepočítá. Správce (owner/admin) přidává komukoli a jeho
--     odměna je rovnou schválená.
--   * odmeny_auto_schvaleni – správce může u člověka zapnout „schvalovat
--     automaticky“: jeho ruční odměny se uloží rovnou jako schválené
--     (schvalil = null, automaticky = true). Samostatná tabulka, ne klíč
--     v configu: config smí ukládat i člen s právem nastavení, tohle jen
--     správce.
--   * Schválení / zamítnutí = update stavu (jen správce, RLS). Trigger
--     doplní, kdo a kdy rozhodl, a nepustí ne‑správce ke stavu ani částce.
--   * Autor smí smazat svůj čekající záznam; schválený mění a maže jen
--     správce.
--   * odmeny_prehled přičte SCHVÁLENÉ ruční odměny příjemci do součtu,
--     počtu, žebříčku, měsíční řady (podle obdobi 'RRRR-MM') a tím i do
--     zaměstnance měsíce a vyplácení. Vrací je i zvlášť v poli `rucni`
--     (období) a `cekajici` (vše čekající: správci celý servis, ostatním
--     jen jejich vlastní).
--
-- Viditelnost: správce vše; člen svoje (příjemce nebo autor) a při veřejném
-- žebříčku schválené ostatních – bez zákazníka a zařízení. Číslo zakázky
-- jen u zakázek, které volající vidí (člen omezený na pobočku, audit 4).
--
-- Hradba (vypnutý servis / propadlý přístup) jako u ostatních odměnových
-- tabulek (20260927100000). Idempotentní, mění jen vlastní objekty.
-- Sondy řady 1500 ve scripts/rls-probe.sql.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1) Tabulky
-- ---------------------------------------------------------------------------
create table if not exists public.odmeny_rucni (
  id uuid primary key default gen_random_uuid(),
  service_id uuid not null references public.services(id) on delete cascade,
  -- příjemce odměny
  user_id uuid not null references auth.users(id) on delete cascade,
  pravidlo_id text not null,
  -- snímek názvu pravidla v okamžiku přidání
  pravidlo_nazev text not null default '',
  -- snímek spočtené odměny (Kč) – počítá server
  castka numeric(12,2) not null default 0,
  -- u procentního pravidla cena, ze které se počítá
  zaklad numeric(12,2),
  poznamka text not null check (length(btrim(poznamka)) between 1 and 1000),
  ticket_id uuid references public.tickets(id) on delete set null,
  -- „2026-10“
  obdobi text not null check (obdobi ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),
  stav text not null default 'ceka' check (stav in ('ceka', 'schvaleno', 'zamitnuto')),
  duvod_zamitnuti text check (duvod_zamitnuti is null or length(duvod_zamitnuti) <= 1000),
  -- schváleno automaticky (odmeny_auto_schvaleni), ne správcem
  automaticky boolean not null default false,
  vytvoril uuid references auth.users(id) on delete set null,
  -- kdo schválil nebo zamítl (u automatického schválení null)
  schvalil uuid references auth.users(id) on delete set null,
  -- kdy se rozhodlo (schválení i zamítnutí)
  schvaleno_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists odmeny_rucni_service_obdobi_idx on public.odmeny_rucni (service_id, obdobi);
create index if not exists odmeny_rucni_service_stav_idx on public.odmeny_rucni (service_id, stav);
create index if not exists odmeny_rucni_ticket_idx on public.odmeny_rucni (ticket_id) where ticket_id is not null;
comment on table public.odmeny_rucni is
  'Odměny týmu: ruční odměny podle pravidla z config.odmeny (snímek pravidla a částky). Přidává se funkcí odmeny_rucni_pridat; zaměstnancova čeká na schválení správcem.';

create table if not exists public.odmeny_auto_schvaleni (
  service_id uuid not null references public.services(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  nastavil uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  primary key (service_id, user_id)
);
comment on table public.odmeny_auto_schvaleni is
  'Odměny týmu: členové, jejichž ruční odměny se schvalují automaticky. Zapisuje jen majitel/správce.';

-- ---------------------------------------------------------------------------
-- 2) Pomocné funkce
-- ---------------------------------------------------------------------------

-- Veřejný žebříček servisu (config.odmeny.verejny_zebricek, výchozí ano).
-- Definer: politika ji volá a nemá spoléhat na RLS service_settings.
create or replace function public.odmeny_verejny_zebricek(p_service_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((
    select case when jsonb_typeof(s.config #> '{odmeny,verejny_zebricek}') = 'boolean'
                then (s.config #>> '{odmeny,verejny_zebricek}')::boolean end
      from public.service_settings s where s.service_id = p_service_id
  ), true);
$$;
revoke all on function public.odmeny_verejny_zebricek(uuid) from public, anon;
grant execute on function public.odmeny_verejny_zebricek(uuid) to authenticated, service_role;

-- Pravidlo podle id a spočtená odměna. Stejný výběr pravidel i vzorec jako
-- odmeny_prehled (aktivní, s hledaným textem a číselnou hodnotou; id chybí
-- = pořadí) a jako castkaOdmeny v src/lib/odmeny.ts.
-- Vrací nazev, typ, castka; pravidlo nenalezeno = žádný řádek.
create or replace function public.odmeny_rucni_vypocet(p_service_id uuid, p_pravidlo_id text, p_zaklad numeric)
returns table (nazev text, typ text, castka numeric)
language sql
stable
security definer
set search_path = public
as $$
  with cfg as (
    select case when jsonb_typeof(s.config #> '{odmeny,pravidla}') = 'array' then s.config #> '{odmeny,pravidla}' else '[]'::jsonb end as pravidla
      from public.service_settings s where s.service_id = p_service_id
  ),
  pravidla as (
    select
      coalesce(nullif(r ->> 'id', ''), ord::text) as id,
      coalesce(nullif(btrim(r ->> 'nazev'), ''), btrim(r ->> 'hledat')) as nazev,
      case when r ->> 'typ' = 'procento' then 'procento' else 'castka' end as typ,
      replace(r ->> 'hodnota', ',', '.')::numeric as hodnota,
      ord
    from cfg cross join lateral jsonb_array_elements(cfg.pravidla) with ordinality x(r, ord)
    where jsonb_typeof(r) = 'object'
      and coalesce((r ->> 'aktivni')::boolean, true)
      and nullif(btrim(r ->> 'hledat'), '') is not null
      and (r ->> 'hodnota') ~ '^-?[0-9]+([.,][0-9]+)?$'
  )
  select p.nazev, p.typ,
         case when p.typ = 'procento' then round(coalesce(p_zaklad, 0) * p.hodnota / 100, 2) else round(p.hodnota, 2) end
    from pravidla p
   where p.id = p_pravidlo_id
   order by p.ord
   limit 1;
$$;
revoke all on function public.odmeny_rucni_vypocet(uuid, text, numeric) from public, anon, authenticated;
grant execute on function public.odmeny_rucni_vypocet(uuid, text, numeric) to service_role;

-- ---------------------------------------------------------------------------
-- 3) Trigger: částka ze serveru, stav a schválení jen správce
-- ---------------------------------------------------------------------------
create or replace function public.odmeny_rucni_kontrola()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  -- Bez přihlášeného uživatele (service_role, migrace, cron) se oprávnění
  -- nehlídá – RLS ani granty tam nedosáhnou a anon tabulku vůbec nemá.
  v_admin boolean := v_uid is null or public.odmeny_je_spravce(new.service_id);
  v_nazev text;
  v_typ text;
  v_castka numeric;
  v_t_service uuid;
  v_t_branch uuid;
  v_t_location uuid;
begin
  if tg_op = 'UPDATE' then
    if new.service_id is distinct from old.service_id then
      raise exception 'Servis ruční odměny nejde změnit.' using errcode = '42501';
    end if;
    if not v_admin and (
         new.stav is distinct from old.stav
      or new.castka is distinct from old.castka
      or new.zaklad is distinct from old.zaklad
      or new.pravidlo_id is distinct from old.pravidlo_id
      or new.user_id is distinct from old.user_id
      or new.obdobi is distinct from old.obdobi
      or new.automaticky is distinct from old.automaticky
      or new.schvalil is distinct from old.schvalil
      or new.schvaleno_at is distinct from old.schvaleno_at
    ) then
      raise exception 'Ruční odměnu může měnit jen majitel nebo správce.' using errcode = '42501';
    end if;
    new.vytvoril := old.vytvoril;
    new.created_at := old.created_at;
  end if;

  -- Příjemce musí být člen servisu.
  if not exists (select 1 from public.service_memberships m where m.service_id = new.service_id and m.user_id = new.user_id) then
    raise exception 'Příjemce odměny není členem servisu.' using errcode = '42501';
  end if;

  -- Zakázka jen ze stejného servisu a jen taková, kterou volající vidí (§5).
  if new.ticket_id is not null and (tg_op = 'INSERT' or new.ticket_id is distinct from old.ticket_id) then
    select t.service_id, t.branch_id, t.location_branch_id into v_t_service, v_t_branch, v_t_location
      from public.tickets t where t.id = new.ticket_id;
    if v_t_service is null or v_t_service <> new.service_id then
      raise exception 'Zakázka nepatří tomuto servisu.' using errcode = '42501';
    end if;
    if v_uid is not null and not public.zakazka_viditelna_podle_mista(v_t_service, v_t_branch, v_t_location) then
      raise exception 'Zakázka patří jiné pobočce.' using errcode = '42501';
    end if;
  end if;

  -- Částka: vždy z pravidla v configu, nikdy od klienta. Při změně jen
  -- poznámky / stavu zůstává snímek (pravidlo se mohlo mezitím změnit).
  if tg_op = 'INSERT' or new.pravidlo_id is distinct from old.pravidlo_id or new.zaklad is distinct from old.zaklad then
    select v.nazev, v.typ, v.castka into v_nazev, v_typ, v_castka
      from public.odmeny_rucni_vypocet(new.service_id, new.pravidlo_id, new.zaklad) v;
    if v_typ is null then
      raise exception 'Pravidlo odměny neexistuje nebo není aktivní.' using errcode = '22023';
    end if;
    if v_typ = 'procento' then
      if new.zaklad is null or new.zaklad <= 0 then
        raise exception 'U procentního pravidla zadejte cenu, ze které se odměna počítá.' using errcode = '22023';
      end if;
    else
      new.zaklad := null;
    end if;
    new.pravidlo_nazev := coalesce(v_nazev, '');
    new.castka := v_castka;
  else
    new.castka := old.castka;
    new.pravidlo_nazev := old.pravidlo_nazev;
  end if;

  new.poznamka := btrim(new.poznamka);
  new.duvod_zamitnuti := nullif(btrim(coalesce(new.duvod_zamitnuti, '')), '');

  if tg_op = 'INSERT' then
    new.created_at := now();
    if v_uid is not null then
      new.vytvoril := v_uid;
    end if;
    if v_admin then
      if new.stav = 'schvaleno' then
        new.automaticky := false;
        new.schvalil := v_uid;
        new.schvaleno_at := now();
      end if;
    else
      -- Zaměstnanec: jen sám sobě a čekající – nebo rovnou schválená, má-li
      -- zapnuté automatické schvalování.
      if new.user_id <> v_uid then
        raise exception 'Odměnu si můžete přidat jen sami sobě.' using errcode = '42501';
      end if;
      if new.stav = 'schvaleno' and new.automaticky
         and exists (select 1 from public.odmeny_auto_schvaleni a where a.service_id = new.service_id and a.user_id = v_uid) then
        new.schvalil := null;
        new.schvaleno_at := now();
      elsif new.stav = 'ceka' then
        new.automaticky := false;
        new.schvalil := null;
        new.schvaleno_at := null;
      else
        raise exception 'Odměnu schvaluje majitel nebo správce.' using errcode = '42501';
      end if;
      new.duvod_zamitnuti := null;
    end if;
    if new.stav = 'ceka' then
      new.automaticky := false;
      new.schvalil := null;
      new.schvaleno_at := null;
    end if;
  elsif new.stav is distinct from old.stav then
    -- Rozhodnutí správce: kdo a kdy (u zamítnutí stejné sloupce).
    new.automaticky := false;
    if new.stav = 'ceka' then
      new.schvalil := null;
      new.schvaleno_at := null;
      new.duvod_zamitnuti := null;
    else
      new.schvalil := v_uid;
      new.schvaleno_at := now();
      if new.stav = 'schvaleno' then
        new.duvod_zamitnuti := null;
      end if;
    end if;
  else
    new.automaticky := old.automaticky;
    new.schvalil := old.schvalil;
    new.schvaleno_at := old.schvaleno_at;
  end if;

  return new;
end;
$$;
revoke all on function public.odmeny_rucni_kontrola() from public, anon, authenticated;

drop trigger if exists odmeny_rucni_kontrola on public.odmeny_rucni;
create trigger odmeny_rucni_kontrola
  before insert or update on public.odmeny_rucni
  for each row execute function public.odmeny_rucni_kontrola();

-- ---------------------------------------------------------------------------
-- 4) RLS a granty
-- ---------------------------------------------------------------------------
alter table public.odmeny_rucni enable row level security;

drop policy if exists odmeny_rucni_cteni on public.odmeny_rucni;
create policy odmeny_rucni_cteni on public.odmeny_rucni
  for select to authenticated
  using (
    public.odmeny_je_spravce(service_id)
    or (
      exists (select 1 from public.service_memberships m where m.service_id = odmeny_rucni.service_id and m.user_id = auth.uid())
      and (
        user_id = auth.uid()
        or vytvoril = auth.uid()
        or (stav = 'schvaleno' and public.odmeny_verejny_zebricek(service_id))
      )
    )
  );

-- Insert jde jen přes odmeny_rucni_pridat (grant insert nikdo nemá). Politika
-- je pojistka pro případ, že by se grant někdy vrátil.
drop policy if exists odmeny_rucni_vlozeni on public.odmeny_rucni;
create policy odmeny_rucni_vlozeni on public.odmeny_rucni
  for insert to authenticated
  with check (
    public.odmeny_je_spravce(service_id)
    or (
      user_id = auth.uid() and stav = 'ceka'
      and exists (select 1 from public.service_memberships m where m.service_id = odmeny_rucni.service_id and m.user_id = auth.uid())
    )
  );

drop policy if exists odmeny_rucni_zmena on public.odmeny_rucni;
create policy odmeny_rucni_zmena on public.odmeny_rucni
  for update to authenticated
  using (public.odmeny_je_spravce(service_id))
  with check (public.odmeny_je_spravce(service_id));

drop policy if exists odmeny_rucni_mazani on public.odmeny_rucni;
create policy odmeny_rucni_mazani on public.odmeny_rucni
  for delete to authenticated
  using (public.odmeny_je_spravce(service_id) or (vytvoril = auth.uid() and stav = 'ceka'));

-- Zakázka jen viditelná (MIGRATIONS_SAFETY §5) – u čtení i zápisu.
drop policy if exists odmeny_rucni_jen_viditelne_zakazky on public.odmeny_rucni;
create policy odmeny_rucni_jen_viditelne_zakazky on public.odmeny_rucni
  as restrictive for select to authenticated
  using (ticket_id is null or exists (select 1 from public.tickets t where t.id = odmeny_rucni.ticket_id and t.service_id = odmeny_rucni.service_id));
drop policy if exists odmeny_rucni_jen_viditelne_vlozeni on public.odmeny_rucni;
create policy odmeny_rucni_jen_viditelne_vlozeni on public.odmeny_rucni
  as restrictive for insert to authenticated
  with check (ticket_id is null or exists (select 1 from public.tickets t where t.id = odmeny_rucni.ticket_id and t.service_id = odmeny_rucni.service_id));
drop policy if exists odmeny_rucni_jen_viditelne_zmena on public.odmeny_rucni;
create policy odmeny_rucni_jen_viditelne_zmena on public.odmeny_rucni
  as restrictive for update to authenticated
  using (ticket_id is null or exists (select 1 from public.tickets t where t.id = odmeny_rucni.ticket_id and t.service_id = odmeny_rucni.service_id))
  with check (ticket_id is null or exists (select 1 from public.tickets t where t.id = odmeny_rucni.ticket_id and t.service_id = odmeny_rucni.service_id));

revoke all on table public.odmeny_rucni from anon, authenticated;
grant select, update, delete on table public.odmeny_rucni to authenticated;
grant all on table public.odmeny_rucni to service_role;

alter table public.odmeny_auto_schvaleni enable row level security;

drop policy if exists odmeny_auto_schvaleni_cteni on public.odmeny_auto_schvaleni;
create policy odmeny_auto_schvaleni_cteni on public.odmeny_auto_schvaleni
  for select to authenticated
  using (user_id = auth.uid() or public.odmeny_je_spravce(service_id));
drop policy if exists odmeny_auto_schvaleni_zapis on public.odmeny_auto_schvaleni;
create policy odmeny_auto_schvaleni_zapis on public.odmeny_auto_schvaleni
  for all to authenticated
  using (public.odmeny_je_spravce(service_id))
  with check (public.odmeny_je_spravce(service_id));
-- Jen člen téhož servisu (jako u výplat).
drop policy if exists odmeny_auto_schvaleni_jen_clen_servisu on public.odmeny_auto_schvaleni;
create policy odmeny_auto_schvaleni_jen_clen_servisu on public.odmeny_auto_schvaleni
  as restrictive for insert to authenticated
  with check (exists (select 1 from public.service_memberships m where m.service_id = odmeny_auto_schvaleni.service_id and m.user_id = odmeny_auto_schvaleni.user_id));

revoke all on table public.odmeny_auto_schvaleni from anon, authenticated;
grant select, insert, delete on table public.odmeny_auto_schvaleni to authenticated;
grant all on table public.odmeny_auto_schvaleni to service_role;

-- Hradba (vzor 20260927100000 / 20260912130000).
do $$
declare
  t text;
  tabulky text[] := array['odmeny_rucni', 'odmeny_auto_schvaleni'];
begin
  foreach t in array tabulky loop
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

-- ---------------------------------------------------------------------------
-- 5) Přidání ruční odměny
-- ---------------------------------------------------------------------------
create or replace function public.odmeny_rucni_pridat(
  p_service_id uuid,
  p_pravidlo_id text,
  p_poznamka text,
  p_obdobi text,
  p_ticket_id uuid default null,
  p_zaklad numeric default null,
  p_user_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_admin boolean;
  v_user uuid;
  v_auto boolean := false;
  v_stav text;
  v_radek public.odmeny_rucni;
begin
  if v_uid is null or not exists (
    select 1 from public.service_memberships m where m.service_id = p_service_id and m.user_id = v_uid
  ) then
    raise exception 'Nemáte přístup k tomuto servisu.' using errcode = '42501';
  end if;
  -- Definer obchází hradbu: vypnutý servis / propadlý přístup se hlídá tady.
  if not (p_service_id = any (public.servisy_kde_smim_pracovat())) then
    raise exception 'Servis je vypnutý nebo nemá platné předplatné.' using errcode = '42501';
  end if;
  v_admin := public.odmeny_je_spravce(p_service_id);
  v_user := coalesce(p_user_id, v_uid);
  if not v_admin and v_user <> v_uid then
    raise exception 'Odměnu si můžete přidat jen sami sobě.' using errcode = '42501';
  end if;
  if nullif(btrim(coalesce(p_poznamka, '')), '') is null then
    raise exception 'Poznámka je povinná.' using errcode = '22023';
  end if;
  if p_obdobi is null or p_obdobi !~ '^[0-9]{4}-(0[1-9]|1[0-2])$' then
    raise exception 'Neplatný měsíc (čeká se RRRR-MM).' using errcode = '22023';
  end if;
  if p_zaklad is not null and (p_zaklad < 0 or p_zaklad > 100000000) then
    raise exception 'Neplatná cena.' using errcode = '22023';
  end if;

  if v_admin then
    v_stav := 'schvaleno';
  elsif exists (select 1 from public.odmeny_auto_schvaleni a where a.service_id = p_service_id and a.user_id = v_uid) then
    v_stav := 'schvaleno';
    v_auto := true;
  else
    v_stav := 'ceka';
  end if;

  -- Částku, název pravidla, kontrolu zakázky a příjemce dělá trigger.
  insert into public.odmeny_rucni (service_id, user_id, pravidlo_id, poznamka, ticket_id, obdobi, zaklad, stav, automaticky, vytvoril)
  values (p_service_id, v_user, p_pravidlo_id, p_poznamka, p_ticket_id, p_obdobi, p_zaklad, v_stav, v_auto, v_uid)
  returning * into v_radek;

  return jsonb_build_object(
    'id', v_radek.id, 'stav', v_radek.stav, 'castka', v_radek.castka,
    'pravidlo', v_radek.pravidlo_nazev, 'automaticky', v_radek.automaticky
  );
end;
$$;
comment on function public.odmeny_rucni_pridat(uuid, text, text, text, uuid, numeric, uuid) is
  'Odměny týmu: přidá ruční odměnu podle pravidla (částku spočítá server). Zaměstnanec jen sobě, čeká na schválení (nebo automaticky schváleno); správce komukoli, rovnou schváleno.';
revoke all on function public.odmeny_rucni_pridat(uuid, text, text, text, uuid, numeric, uuid) from public, anon;
grant execute on function public.odmeny_rucni_pridat(uuid, text, text, text, uuid, numeric, uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 6) Přehled: + schválené ruční odměny, pole rucni / cekajici / pravidla
-- ---------------------------------------------------------------------------
-- Celé tělo z 20260927100000 (audit 4); změny jsou označené „ruční“.
create or replace function public.odmeny_prehled(
  p_service_id uuid,
  p_od timestamptz default null,
  p_do timestamptz default null,
  p_tz text default 'Europe/Prague'
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_admin boolean;
  v_cfg jsonb;
  v_pravidla jsonb;
  v_verejny boolean;
  v_tz text;
  v_od timestamptz;
  v_do timestamptz;
  v_od12 timestamptz;
  v_vysledek jsonb;
  c_uuid constant text := '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';
begin
  if v_uid is null or not exists (
    select 1 from public.service_memberships m where m.service_id = p_service_id and m.user_id = v_uid
  ) then
    raise exception 'Nemáte přístup k tomuto servisu.' using errcode = '42501';
  end if;
  v_admin := public.odmeny_je_spravce(p_service_id);

  select coalesce(s.config -> 'odmeny', '{}'::jsonb) into v_cfg
  from public.service_settings s where s.service_id = p_service_id;
  v_cfg := coalesce(v_cfg, '{}'::jsonb);
  v_pravidla := case when jsonb_typeof(v_cfg -> 'pravidla') = 'array' then v_cfg -> 'pravidla' else '[]'::jsonb end;
  v_verejny := coalesce((v_cfg ->> 'verejny_zebricek')::boolean, true);

  v_tz := case
    when p_tz is not null and exists (select 1 from pg_timezone_names n where n.name = p_tz) then p_tz
    else 'Europe/Prague'
  end;
  -- Bez období = tento měsíc.
  v_od := coalesce(p_od, date_trunc('month', now() at time zone v_tz) at time zone v_tz);
  v_do := coalesce(p_do, now());
  -- Měsíční řada: posledních 12 měsíců do konce vybraného období (nebo do teď).
  v_od12 := date_trunc('month', (greatest(v_do, now()) at time zone v_tz) - interval '11 months') at time zone v_tz;

  with pravidla as (
    select
      coalesce(nullif(r ->> 'id', ''), ord::text) as id,
      coalesce(nullif(btrim(r ->> 'nazev'), ''), r ->> 'hledat') as nazev,
      lower(btrim(r ->> 'hledat')) as hledat,
      case when r ->> 'typ' = 'procento' then 'procento' else 'castka' end as typ,
      coalesce(replace(r ->> 'hodnota', ',', '.')::numeric, 0) as hodnota,
      case when r ->> 'komu' = 'technik' then 'technik' else 'pridal' end as komu,
      ord
    from jsonb_array_elements(v_pravidla) with ordinality x(r, ord)
    where coalesce((r ->> 'aktivni')::boolean, true)
      and nullif(btrim(r ->> 'hledat'), '') is not null
      and (r ->> 'hodnota') ~ '^-?[0-9]+([.,][0-9]+)?$'
  ),
  -- Vydané zakázky (koncový stav, ne storno) – datum vydání jako ve Statistikách.
  zakazky as (
    select
      t.id,
      t.code,
      t.customer_name,
      coalesce(nullif(btrim(t.title), ''), t.device_label) as zarizeni,
      t.assigned_to,
      t.branch_id,          -- audit 4
      t.location_branch_id, -- audit 4
      coalesce(t.completed_at, t.updated_at) as vydano_at,
      case when jsonb_typeof(t.performed_repairs) = 'array' then t.performed_repairs else '[]'::jsonb end as opravy
    from public.tickets t
    join public.service_statuses st
      on st.service_id = t.service_id and st.key = coalesce(nullif(t.status, ''), 'received')
    where t.service_id = p_service_id
      and t.deleted_at is null
      and st.is_final
      and not public.stav_je_storno(coalesce(nullif(t.status, ''), 'received'), st.label)
      and coalesce(t.completed_at, t.updated_at) >= least(v_od, v_od12)
      and coalesce(t.completed_at, t.updated_at) <= greatest(v_do, now())
  ),
  polozky as (
    select
      z.id as ticket_id,
      z.code,
      z.customer_name,
      z.zarizeni,
      z.assigned_to,
      z.branch_id,          -- audit 4
      z.location_branch_id, -- audit 4
      z.vydano_at,
      coalesce(e.polozka ->> 'id', e.ord::text) as polozka_id,
      coalesce(e.polozka ->> 'name', '') as oprava,
      case when jsonb_typeof(e.polozka -> 'price') = 'number' then (e.polozka ->> 'price')::numeric else 0 end as cena,
      case when (e.polozka ->> 'pridalUserId') ~* c_uuid then (e.polozka ->> 'pridalUserId')::uuid end as pridal_uid,
      -- Nabídnuto zákazníkovi navíc (příznak z aplikace); bez příznaku = ne.
      case when jsonb_typeof(e.polozka -> 'nabidnuto') = 'boolean' then (e.polozka ->> 'nabidnuto')::boolean else false end as nabidnuto_priznak
    from zakazky z
    cross join lateral jsonb_array_elements(z.opravy) with ordinality e(polozka, ord)
  ),
  -- Na položku nejvýš jedno pravidlo: první v pořadí, které sedí.
  shody as (
    select distinct on (p.ticket_id, p.polozka_id)
      p.*,
      r.id as pravidlo_id,
      r.nazev as pravidlo,
      r.komu,
      case when r.typ = 'procento' then round(p.cena * r.hodnota / 100, 2) else round(r.hodnota, 2) end as castka
    from polozky p
    join pravidla r on lower(p.oprava) like '%' || r.hledat || '%'
    order by p.ticket_id, p.polozka_id, r.ord
  ),
  prirazene as (
    select
      s.*,
      coalesce(u.vyrazeno, false) as vyrazeno,
      u.user_id is not null as prepsano,
      -- Majitel může příznak „nabídnuto navíc“ přepsat (odmeny_upravy.nabidnuto).
      coalesce(u.nabidnuto, s.nabidnuto_priznak) as nabidnuto,
      u.nabidnuto is not null as nabidnuto_prepsano,
      u.poznamka,
      case
        when u.user_id is not null then u.user_id
        when s.komu = 'technik' then s.assigned_to
        else coalesce(
          s.pridal_uid,
          -- Historie: první změna, kde se položka objevila (v „new“ je, v „old“ není).
          (select h.changed_by from public.ticket_history h
            where h.ticket_id = s.ticket_id and h.action = 'updated'
              and (h.details #> '{changes,performed_repairs,new}') @> jsonb_build_array(jsonb_build_object('id', s.polozka_id))
              and not coalesce((h.details #> '{changes,performed_repairs,old}') @> jsonb_build_array(jsonb_build_object('id', s.polozka_id)), false)
            order by h.created_at
            limit 1),
          -- Položka je na zakázce od příjmu: kdo zakázku založil.
          (select h.changed_by from public.ticket_history h
            where h.ticket_id = s.ticket_id and h.action = 'created'
            order by h.created_at
            limit 1)
        )
      end as komu_uid
    from shody s
    -- audit 4: páruje se i podle servisu (úprava s cizím servisem se nepočítá).
    left join public.odmeny_upravy u on u.service_id = p_service_id and u.ticket_id = s.ticket_id and u.polozka_id = s.polozka_id
  ),
  -- Co smí volající vidět: správce vše, člen svoje, cizí jen s veřejným žebříčkem.
  viditelne as (
    select * from prirazene p
    where v_admin or p.komu_uid = v_uid or v_verejny
  ),
  v_obdobi as (
    select * from viditelne where vydano_at >= v_od and vydano_at <= v_do
  ),
  -- ruční: všechny ruční odměny servisu, které volající smí vidět (stejně
  -- jako RLS odmeny_rucni_cteni: správce vše, člen svoje – příjemce nebo
  -- autor – a při veřejném žebříčku schválené ostatních).
  rucni_vse as (
    select
      r.*,
      (r.user_id = v_uid or r.vytvoril = v_uid) as moje,
      t.code as kod,
      t.customer_name,
      coalesce(nullif(btrim(t.title), ''), t.device_label) as zarizeni,
      -- Zakázku (číslo, id) jen když ji volající vidí (audit 4).
      (t.id is not null and (v_admin or public.zakazka_viditelna_podle_mista(t.service_id, t.branch_id, t.location_branch_id))) as zakazka_videt
    from public.odmeny_rucni r
    left join public.tickets t on t.id = r.ticket_id and t.service_id = r.service_id
    where r.service_id = p_service_id
      and (v_admin or r.user_id = v_uid or r.vytvoril = v_uid or (v_verejny and r.stav = 'schvaleno'))
  ),
  -- ruční: schválené v měsíční řadě a ve vybraném období (podle obdobi).
  rucni_schvalene as (
    select * from rucni_vse
    where stav = 'schvaleno' and obdobi >= to_char(v_od12 at time zone v_tz, 'YYYY-MM')
  ),
  rucni_obdobi as (
    select * from rucni_vse
    where obdobi >= to_char(v_od at time zone v_tz, 'YYYY-MM')
      and obdobi <= to_char(v_do at time zone v_tz, 'YYYY-MM')
  ),
  -- ruční: součty = opravy + schválené ruční odměny.
  soucty_obdobi as (
    select komu_uid, castka, 0 as rucni from v_obdobi where not vyrazeno and nabidnuto
    union all
    select user_id, castka, 1 from rucni_obdobi where stav = 'schvaleno'
  ),
  soucty_mesice as (
    select to_char(vydano_at at time zone v_tz, 'YYYY-MM') as mesic, komu_uid, castka
    from viditelne
    where not vyrazeno and nabidnuto and vydano_at >= v_od12
    union all
    select obdobi, user_id, castka from rucni_schvalene
  ),
  jmena as (
    select m.user_id, coalesce(nullif(btrim(pr.nickname), ''), 'Kolega') as jmeno, pr.avatar_url
    from public.service_memberships m
    left join public.profiles pr on pr.id = m.user_id
    where m.service_id = p_service_id
  )
  select jsonb_build_object(
    'zapnuto', exists (select 1 from pravidla),
    'verejny', v_verejny,
    'admin', v_admin,
    'ja', v_uid,
    'od', v_od,
    'do', v_do,
    'radky', coalesce((
      select jsonb_agg(jsonb_build_object(
        'ticketId', o.ticket_id, 'kod', o.code, 'zakaznik', o.customer_name, 'zarizeni', o.zarizeni,
        'polozkaId', o.polozka_id, 'oprava', o.oprava, 'cena', o.cena,
        'pravidloId', o.pravidlo_id, 'pravidlo', o.pravidlo, 'komu', o.komu,
        'userId', o.komu_uid, 'jmeno', j.jmeno,
        'castka', o.castka, 'vydanoAt', o.vydano_at,
        'vyrazeno', o.vyrazeno, 'prepsano', o.prepsano, 'poznamka', o.poznamka,
        'nabidnuto', o.nabidnuto, 'nabidnutoPrepsano', o.nabidnuto_prepsano
      ) order by o.vydano_at desc, o.code desc, o.polozka_id)
      from v_obdobi o
      left join jmena j on j.user_id = o.komu_uid
      -- Vyřazené a nenabídnuté řádky vidí jen správce (aby je mohl vrátit / označit).
      where (v_admin or not o.vyrazeno) and (v_admin or o.nabidnuto)
        -- audit 4: zákazníka a číslo zakázky jen u zakázek, které volající vidí
        -- (člen omezený na pobočku). Součty v „lide“ a „mesice“ zůstávají celé.
        and (v_admin or public.zakazka_viditelna_podle_mista(p_service_id, o.branch_id, o.location_branch_id))
    ), '[]'::jsonb),
    'lide', coalesce((
      select jsonb_agg(jsonb_build_object(
        'userId', x.komu_uid, 'jmeno', coalesce(j.jmeno, 'Nepřiřazeno'), 'avatarUrl', j.avatar_url,
        'pocet', x.pocet, 'castka', x.castka, 'pocetRucnich', x.pocet_rucnich
      ) order by x.castka desc, x.pocet desc, j.jmeno)
      from (
        select komu_uid, count(*) as pocet, sum(castka) as castka, sum(rucni) as pocet_rucnich
        from soucty_obdobi
        group by komu_uid
      ) x
      left join jmena j on j.user_id = x.komu_uid
    ), '[]'::jsonb),
    'mesice', coalesce((
      select jsonb_agg(jsonb_build_object(
        'mesic', x.mesic, 'userId', x.komu_uid, 'jmeno', coalesce(j.jmeno, 'Nepřiřazeno'), 'pocet', x.pocet, 'castka', x.castka
      ) order by x.mesic, x.castka desc)
      from (
        select mesic, komu_uid, count(*) as pocet, sum(castka) as castka
        from soucty_mesice
        group by 1, 2
      ) x
      left join jmena j on j.user_id = x.komu_uid
    ), '[]'::jsonb),
    'vyplaty', coalesce((
      select jsonb_agg(jsonb_build_object('userId', v.user_id, 'obdobi', v.obdobi, 'castka', v.castka, 'vyplacenoAt', v.vyplaceno_at))
      from public.odmeny_vyplaty v
      where v.service_id = p_service_id
        and (v_admin or v.user_id = v_uid)
        and v.obdobi >= to_char(v_od12 at time zone v_tz, 'YYYY-MM')
    ), '[]'::jsonb),
    -- ruční: odměny vybraného období. Čekající a zamítnuté jen správce
    -- a „moje“ (příjemce / autor). Zákazník a zařízení jen správci a u
    -- vlastních, číslo zakázky jen u viditelné zakázky.
    'rucni', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', r.id, 'userId', r.user_id, 'jmeno', coalesce(j.jmeno, 'Bývalý člen'),
        'pravidloId', r.pravidlo_id, 'pravidlo', r.pravidlo_nazev, 'castka', r.castka, 'zaklad', r.zaklad,
        'poznamka', r.poznamka, 'obdobi', r.obdobi, 'stav', r.stav, 'duvodZamitnuti', r.duvod_zamitnuti,
        'automaticky', r.automaticky,
        'vytvoril', r.vytvoril, 'vytvorilJmeno', jv.jmeno,
        'schvalil', r.schvalil, 'schvalilJmeno', js.jmeno, 'schvalenoAt', r.schvaleno_at,
        'createdAt', r.created_at,
        'ticketId', case when r.zakazka_videt then r.ticket_id end,
        'kod', case when r.zakazka_videt then r.kod end,
        'zakaznik', case when r.zakazka_videt and (v_admin or r.moje) then r.customer_name end,
        'zarizeni', case when r.zakazka_videt and (v_admin or r.moje) then r.zarizeni end
      ) order by r.created_at desc)
      from rucni_obdobi r
      left join jmena j on j.user_id = r.user_id
      left join jmena jv on jv.user_id = r.vytvoril
      left join jmena js on js.user_id = r.schvalil
      where r.stav = 'schvaleno' or v_admin or r.moje
    ), '[]'::jsonb),
    -- ruční: vše, co čeká na schválení (bez ohledu na období) – správce celý
    -- servis, ostatní jen svoje.
    'cekajici', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', r.id, 'userId', r.user_id, 'jmeno', coalesce(j.jmeno, 'Bývalý člen'),
        'pravidloId', r.pravidlo_id, 'pravidlo', r.pravidlo_nazev, 'castka', r.castka, 'zaklad', r.zaklad,
        'poznamka', r.poznamka, 'obdobi', r.obdobi, 'stav', r.stav, 'duvodZamitnuti', r.duvod_zamitnuti,
        'automaticky', r.automaticky,
        'vytvoril', r.vytvoril, 'vytvorilJmeno', jv.jmeno,
        'schvalil', r.schvalil, 'schvalilJmeno', null, 'schvalenoAt', r.schvaleno_at,
        'createdAt', r.created_at,
        'ticketId', case when r.zakazka_videt then r.ticket_id end,
        'kod', case when r.zakazka_videt then r.kod end,
        'zakaznik', case when r.zakazka_videt then r.customer_name end,
        'zarizeni', case when r.zakazka_videt then r.zarizeni end
      ) order by r.created_at)
      from (select * from rucni_vse where stav = 'ceka' and (v_admin or moje) order by created_at limit 200) r
      left join jmena j on j.user_id = r.user_id
      left join jmena jv on jv.user_id = r.vytvoril
    ), '[]'::jsonb),
    -- ruční: aktivní pravidla pro dialog Přidat odměnu (stejný výběr jako výpočet).
    'pravidla', coalesce((
      select jsonb_agg(jsonb_build_object('id', p.id, 'nazev', p.nazev, 'typ', p.typ, 'hodnota', p.hodnota) order by p.ord)
      from pravidla p
    ), '[]'::jsonb),
    -- ruční: komu se schvaluje automaticky – správce všechny, člen jen sebe.
    'autoSchvaleni', coalesce((
      select jsonb_agg(a.user_id)
      from public.odmeny_auto_schvaleni a
      where a.service_id = p_service_id and (v_admin or a.user_id = v_uid)
    ), '[]'::jsonb)
  )
  into v_vysledek;

  return v_vysledek;
end;
$$;

comment on function public.odmeny_prehled(uuid, timestamptz, timestamptz, text) is
  'Odměny týmu: řádky za období (podle data vydání zakázky), součty na člověka (včetně schválených ručních odměn podle obdobi), měsíční řada 12 měsíců zpět, vyplaceno, ruční odměny (rucni, cekajici), aktivní pravidla a automatické schvalování.';
revoke all on function public.odmeny_prehled(uuid, timestamptz, timestamptz, text) from public, anon;
grant execute on function public.odmeny_prehled(uuid, timestamptz, timestamptz, text) to authenticated;
