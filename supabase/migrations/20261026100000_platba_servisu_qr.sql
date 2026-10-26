-- Platby servisů: QR platba pro servis, který má platit.
--
-- Dřív o splatné platbě věděl jen majitel aplikace (Owner → Platby servisů,
-- upozornění po přihlášení a e-mail). Teď ji uvidí i vlastník a admini
-- servisu, který platí: po přihlášení okno s částkou, účtem, VS a QR platbou
-- (SPAYD) – od dne platby, dokud majitel platbu nezapíše.
--
--   platby_prijem              – kam se platí (číslo účtu), jeden řádek, jen root owner
--   platby_nastaveni.poradi    – pořadí servisu → variabilní symbol RRRRMM + pořadí
--   platba_meho_servisu()      – co má servis zaplatit (vlastník/admin servisu)
--   platby_prehled()           – navíc pořadí a variabilní symbol pro Owner

-- ── 1. Účet pro příjem plateb ───────────────────────────────────────────────
create table if not exists public.platby_prijem (
  id boolean primary key default true check (id),
  ucet text not null,
  updated_at timestamptz not null default now()
);
comment on table public.platby_prijem is
  'Číslo účtu (předčíslí-číslo/banka nebo IBAN), kam servisy platí majiteli aplikace. Jeden řádek; čte ho servis jen přes platba_meho_servisu.';
alter table public.platby_prijem enable row level security;
revoke all on public.platby_prijem from anon;
drop policy if exists "platby_prijem_root" on public.platby_prijem;
create policy "platby_prijem_root" on public.platby_prijem
  for all to authenticated using (public.je_root_owner()) with check (public.je_root_owner());

insert into public.platby_prijem (id, ucet) values (true, '1029498249/5500')
on conflict (id) do nothing;

-- ── 2. Pořadí servisu (variabilní symbol) ───────────────────────────────────
alter table public.platby_nastaveni add column if not exists poradi integer;
comment on column public.platby_nastaveni.poradi is
  'Pořadí servisu v platbách – variabilní symbol je RRRRMM + pořadí (202610 + 03 → 20261003). Přiděluje se samo, nemění se.';

with cislovani as (
  select n.service_id, row_number() over (order by s.created_at, s.id) as rn
    from public.platby_nastaveni n join public.services s on s.id = n.service_id
)
update public.platby_nastaveni n
   set poradi = c.rn + coalesce((select max(poradi) from public.platby_nastaveni where poradi is not null), 0)
  from cislovani c
 where c.service_id = n.service_id and n.poradi is null;

create unique index if not exists platby_nastaveni_poradi_unique on public.platby_nastaveni (poradi) where poradi is not null;

create or replace function public.platby_nastaveni_poradi()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.poradi is null then
    perform pg_advisory_xact_lock(hashtext('platby_nastaveni_poradi'));
    select coalesce(max(poradi), 0) + 1 into new.poradi from public.platby_nastaveni;
  end if;
  return new;
end;
$$;
revoke all on function public.platby_nastaveni_poradi() from public, anon, authenticated;
drop trigger if exists trg_platby_nastaveni_poradi on public.platby_nastaveni;
create trigger trg_platby_nastaveni_poradi
  before insert on public.platby_nastaveni
  for each row execute function public.platby_nastaveni_poradi();

/** Variabilní symbol: RRRRMM + pořadí (aspoň dvě číslice). */
create or replace function public.platby_vs(p_obdobi text, p_poradi integer)
returns text
language sql
immutable
as $$
  select case when p_poradi is null then null
              else replace(p_obdobi, '-', '') || lpad(p_poradi::text, 2, '0') end;
$$;

-- ── 3. Co má zaplatit můj servis ────────────────────────────────────────────
-- Vrací null, když nic: servis neplatí, za měsíc je zaplaceno, den platby
-- ještě nenastal, nebo volající není vlastník/admin. Stejné pravidlo
-- splatnosti jako src/lib/platbyServisu.ts (den platby max. 28.).
create or replace function public.platba_meho_servisu(p_service_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_dnes date := (now() at time zone 'Europe/Prague')::date;
  v_obdobi text := to_char(v_dnes, 'YYYY-MM');
  n public.platby_nastaveni%rowtype;
  v_splatnost date;
  v_ucet text;
  v_nazev text;
begin
  if auth.uid() is null or not exists (
    select 1 from public.service_memberships m
     where m.service_id = p_service_id and m.user_id = auth.uid() and m.role in ('owner', 'admin')
  ) then
    return null;
  end if;
  select * into n from public.platby_nastaveni where service_id = p_service_id;
  if n.service_id is null or not n.aktivni or n.cena_mesicne <= 0 then
    return null;
  end if;
  select name into v_nazev from public.services where id = p_service_id and coalesce(active, true);
  if v_nazev is null then
    return null;
  end if;
  if exists (select 1 from public.platby p where p.service_id = p_service_id and p.obdobi = v_obdobi) then
    return null;
  end if;
  v_splatnost := make_date(extract(year from v_dnes)::int, extract(month from v_dnes)::int, least(greatest(n.den_platby, 1), 28));
  if v_dnes < v_splatnost then
    return null;
  end if;
  select ucet into v_ucet from public.platby_prijem where id;
  return jsonb_build_object(
    'nazev', v_nazev,
    'castka', n.cena_mesicne,
    'obdobi', v_obdobi,
    'splatnost', v_splatnost,
    'dniPoSplatnosti', v_dnes - v_splatnost,
    'ucet', v_ucet,
    'vs', public.platby_vs(v_obdobi, n.poradi)
  );
end;
$$;
revoke all on function public.platba_meho_servisu(uuid) from public, anon;
grant execute on function public.platba_meho_servisu(uuid) to authenticated;

-- ── 4. Přehled pro Owner: navíc pořadí a VS ─────────────────────────────────
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
      'posledniObdobi', (select max(x.obdobi) from public.platby x where x.service_id = s.id),
      'poradi', n.poradi,
      'vs', public.platby_vs(v_obdobi, n.poradi)
    ) order by coalesce(n.aktivni, false) desc, s.name)
    from public.services s
    left join public.platby_nastaveni n on n.service_id = s.id
    left join public.platby p on p.service_id = s.id and p.obdobi = v_obdobi
  ), '[]'::jsonb);
end;
$$;
revoke all on function public.platby_prehled(text) from public, anon;
grant execute on function public.platby_prehled(text) to authenticated, service_role;
