-- Majitel aplikace je skrytým členem každého servisu
-- ============================================================================
--
-- PROČ: Majitel aplikace vidí v přepínači všechny servisy, ale data pouští
-- databáze jen členům – po přepnutí do cizího servisu se načetlo prázdno
-- a vypadalo to, že servis o data přišel. Rozhodnutí majitele: má tam být
-- automaticky, ne přes výjimku v pravidlech.
--
-- Výjimka v RLS by znamenala doplnit „nebo je to root owner" do všech politik
-- napříč databází – desítky míst, kde stačí jedno zapomenout a díra je
-- v pravidlech, ne v datech. Členství naproti tomu žádné pravidlo nemění:
-- root owner je prostě člen jako každý jiný, jen se nikde nezobrazuje.
--
-- SKRYTÉ ZNAMENÁ SKRYTÉ I PŘES API: řádek s `skryty = true` vidí přes REST
-- jen ten, komu patří. Kdyby se schovával jen v aplikaci, zákazník by ho
-- našel prvním dotazem na `service_memberships` a působilo by to hůř, než
-- kdyby tam byl vidět.

-- ── 1. Kdo je majitel aplikace ──────────────────────────────────────────────
-- Id se dosud znaly jen edge funkce z proměnné ROOT_OWNER_ID. Databáze ho
-- potřebuje taky (trigger při zakládání servisu), takže je i tady – v tabulce,
-- na kterou nemá klient žádná práva.
create table if not exists public.app_nastaveni (
  klic text primary key,
  hodnota text not null,
  poznamka text,
  updated_at timestamptz not null default now()
);
comment on table public.app_nastaveni is
  'Provozní nastavení aplikace (ne servisu). Čtou jen SECURITY DEFINER funkce a server.';

alter table public.app_nastaveni enable row level security;
revoke all on table public.app_nastaveni from anon, authenticated;

insert into public.app_nastaveni (klic, hodnota, poznamka)
values (
  'root_owner_id',
  'f3b27eb3-7059-48e0-839f-de1eb988fe70',
  'Účet majitele aplikace. Musí sedět s proměnnou ROOT_OWNER_ID u edge funkcí a VITE_ROOT_OWNER_ID v aplikaci.'
)
on conflict (klic) do nothing;

create or replace function public.root_owner_id()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select nullif(hodnota, '')::uuid from public.app_nastaveni where klic = 'root_owner_id';
$$;

revoke all on function public.root_owner_id() from public, anon, authenticated;
grant execute on function public.root_owner_id() to service_role;

-- ── 2. Skryté členství ──────────────────────────────────────────────────────
alter table public.service_memberships
  add column if not exists skryty boolean not null default false;
comment on column public.service_memberships.skryty is
  'Členství, které se v týmu servisu nezobrazuje – zakládá ho aplikace pro majitele aplikace (podpora).';

-- Restriktivní politika platí navrch ke stávající: skrytý řádek uvidí jen
-- ten, komu patří. Politika je restriktivní schválně – kdyby byla permisivní,
-- sečetla by se se stávající a nic by neschovala.
drop policy if exists "service_memberships_skryte_jen_svoje" on public.service_memberships;
create policy "service_memberships_skryte_jen_svoje" on public.service_memberships
  as restrictive for select to authenticated
  using (skryty = false or user_id = auth.uid());

-- ── 3. Nový servis dostane majitele aplikace rovnou ─────────────────────────
create or replace function public.pridej_root_ownera()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_root uuid := public.root_owner_id();
begin
  if v_root is null then
    return new;
  end if;
  -- `on conflict do nothing`: když servis zakládá sám majitel aplikace, má
  -- v něm už řádek s rolí owner a ten se nesmí přepsat na admin.
  insert into public.service_memberships (service_id, user_id, role, skryty)
  values (new.id, v_root, 'admin', true)
  on conflict (service_id, user_id) do nothing;
  return new;
end;
$$;

drop trigger if exists pridej_root_ownera_po_zalozeni on public.services;
create trigger pridej_root_ownera_po_zalozeni
  after insert on public.services
  for each row execute function public.pridej_root_ownera();

-- ── 4. Doplnit do servisů, které už existují ────────────────────────────────
-- Servisy, kde majitel aplikace svůj řádek má (jeho vlastní dílny), zůstávají
-- beze změny – `on conflict do nothing` je nepřepíše a `skryty` u nich zůstane
-- false, aby v týmu své vlastní firmy nezmizel.
insert into public.service_memberships (service_id, user_id, role, skryty)
select s.id, public.root_owner_id(), 'admin', true
from public.services s
where public.root_owner_id() is not null
on conflict (service_id, user_id) do nothing;
