-- =====================================================================
-- bootstrap-test.sql — Supabase prostředí pro test migrací na čisté DB
-- =====================================================================
--
-- K ČEMU TO JE
-- ------------
-- Migrace v supabase/migrations/ nejsou celá databáze. Supabase kolem nich
-- provozuje kus prostředí, který v repozitáři nikde není: role (anon,
-- authenticated, service_role), schéma `auth` s tabulkou uživatelů,
-- funkce `auth.uid()`, schéma `storage`, extenze a publikaci
-- `supabase_realtime`. Na ostrém projektu to všechno vzniklo samo při
-- založení projektu — na prázdném Postgresu to nevznikne nic.
--
-- Tenhle skript ten chybějící kus dorovná, aby se dalo ověřit, že migrace
-- projdou od nuly. Používá se ve dvou situacích:
--   1) pravidelný test „postaví se databáze Jobi od nuly?“ (npm run test:migrace),
--   2) obnova ze zálohy do nového/prázdného projektu, kde je potřeba
--      vědět, co všechno musí existovat *před* migracemi.
--
-- CO TO NENÍ
-- ----------
-- Není to náhrada Supabase. Tabulka `auth.users` má jen sloupce, na které
-- migrace opravdu sahají (id, email), žádnou autentizační logiku.
-- `auth.uid()` čte stejné GUC jako v Supabase (`request.jwt.claims`),
-- takže se dá v testu nastavit `set local request.jwt.claims = '{"sub":"…"}'`
-- a politiky RLS se chovají stejně jako na ostrém.
--
-- Extenze pg_cron, pg_net a schéma `vault` tu ZÁMĚRNĚ nejsou — migrace,
-- které je používají, jsou podmíněné (`pg_available_extensions`) a na
-- prostém Postgresu se korektně přeskočí. Test tím zároveň ověřuje, že
-- ta podmíněnost skutečně funguje.
--
-- POUŽITÍ
-- -------
--   psql -v ON_ERROR_STOP=1 -f supabase/bootstrap-test.sql
--   pak migrace v pořadí podle názvu souboru.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1) Role
-- ---------------------------------------------------------------------
-- Supabase je zakládá při vzniku projektu. Migrace na ně jen grantují,
-- takže stačí, aby existovaly. NOLOGIN — do testovací DB se nikdo
-- nepřihlašuje, přepínáme se přes SET ROLE.
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then
    create role anon nologin noinherit;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then
    create role authenticated nologin noinherit;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then
    create role service_role nologin noinherit bypassrls;
  end if;
  -- supabase_admin vlastní na ostrém schémata auth/storage.
  if not exists (select 1 from pg_roles where rolname = 'supabase_admin') then
    create role supabase_admin nologin noinherit superuser;
  end if;
  -- authenticator se do těch tří rolí přepíná; migrace na něj nesahají,
  -- ale bez něj by nešlo napodobit chování PostgREST v ručním testu.
  if not exists (select 1 from pg_roles where rolname = 'authenticator') then
    create role authenticator nologin noinherit;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'supabase_auth_admin') then
    create role supabase_auth_admin nologin noinherit;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'supabase_storage_admin') then
    create role supabase_storage_admin nologin noinherit;
  end if;
end $$;

grant anon, authenticated, service_role to authenticator;
-- Na ostrém je vlastníkem objektů role `postgres`; lokálně běžíme jako
-- superuser, takže jen zajistíme, že tyhle role smějí do public.
grant usage on schema public to anon, authenticated, service_role;

-- ---------------------------------------------------------------------
-- 2) Schéma extensions + extenze
-- ---------------------------------------------------------------------
-- Supabase má extenze v samostatném schématu `extensions` a to schéma
-- v search_path. Migrace 20260217120000 do něj stěhuje citext, takže
-- schéma musí existovat dřív (migrace ho sice zakládá taky, ale funkce
-- s `set search_path = public, extensions` by jinak padaly dřív).
create schema if not exists extensions;
grant usage on schema extensions to anon, authenticated, service_role;

-- pgcrypto kvůli gen_random_uuid() (v PG13+ je vestavěné, ale Supabase
-- ho má a některé funkce spoléhají na digest()/gen_salt()).
create extension if not exists pgcrypto with schema extensions;
create extension if not exists "uuid-ossp" with schema extensions;
create extension if not exists pg_trgm with schema extensions;
create extension if not exists btree_gist with schema extensions;

-- POZOR: citext tady NEZAKLÁDÁME. Migrace 20241231000010 ho vytváří
-- v public a 20260217120000 ho pak přesouvá do extensions — kdybychom
-- ho předpřipravili, ten přesun by se neotestoval.

-- ---------------------------------------------------------------------
-- 3) Schéma auth
-- ---------------------------------------------------------------------
create schema if not exists auth authorization supabase_admin;
grant usage on schema auth to anon, authenticated, service_role;

-- Jen sloupce, na které migrace Jobi opravdu odkazují: `id` (cíl všech
-- FK) a `email` (get_auth_user_id_by_email, invited_email_has_any_membership).
-- Zbytek Supabase auth (hesla, tokeny, MFA) do testu schématu nepatří.
create table if not exists auth.users (
  id uuid primary key default gen_random_uuid(),
  email text,
  raw_user_meta_data jsonb default '{}'::jsonb,
  raw_app_meta_data jsonb default '{}'::jsonb,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  deleted_at timestamptz
);

create table if not exists auth.identities (
  id text not null,
  user_id uuid not null references auth.users(id) on delete cascade,
  provider text not null,
  identity_data jsonb not null default '{}'::jsonb,
  email text,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  primary key (provider, id)
);

-- auth.uid() / auth.jwt() / auth.role() — čtou stejný GUC jako Supabase.
-- V testu se dá uživatel nasimulovat:
--   set local role authenticated;
--   set local request.jwt.claims = '{"sub":"<uuid>","role":"authenticated"}';
create or replace function auth.jwt()
returns jsonb
language sql
stable
as $$
  select coalesce(
    nullif(current_setting('request.jwt.claim', true), '')::jsonb,
    nullif(current_setting('request.jwt.claims', true), '')::jsonb,
    '{}'::jsonb
  );
$$;

create or replace function auth.uid()
returns uuid
language sql
stable
as $$
  select nullif(
    coalesce(
      nullif(current_setting('request.jwt.claim.sub', true), ''),
      (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')
    ),
    ''
  )::uuid;
$$;

create or replace function auth.role()
returns text
language sql
stable
as $$
  select coalesce(
    nullif(current_setting('request.jwt.claim.role', true), ''),
    (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role')
  );
$$;

create or replace function auth.email()
returns text
language sql
stable
as $$
  select coalesce(
    nullif(current_setting('request.jwt.claim.email', true), ''),
    (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'email')
  );
$$;

grant execute on function auth.uid(), auth.jwt(), auth.role(), auth.email()
  to anon, authenticated, service_role;

-- ---------------------------------------------------------------------
-- 4) Schéma storage
-- ---------------------------------------------------------------------
-- Migrace zakládají buckety (diagnostic-photos, product-images) a politiky
-- nad storage.objects, včetně storage.foldername() pro rozpad cesty.
create schema if not exists storage authorization supabase_admin;
grant usage on schema storage to anon, authenticated, service_role;

create table if not exists storage.buckets (
  id text primary key,
  name text not null,
  owner uuid,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  public boolean default false,
  avif_autodetection boolean default false,
  file_size_limit bigint,
  allowed_mime_types text[]
);

create table if not exists storage.objects (
  id uuid primary key default gen_random_uuid(),
  bucket_id text references storage.buckets(id),
  name text,
  owner uuid,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  last_accessed_at timestamptz default now(),
  metadata jsonb,
  path_tokens text[] generated always as (string_to_array(name, '/')) stored,
  version text
);

alter table storage.objects enable row level security;
alter table storage.buckets enable row level security;

-- Stejná implementace jako v Supabase: rozpad cesty na složky bez názvu
-- souboru, používá se v politikách typu (storage.foldername(name))[1].
create or replace function storage.foldername(name text)
returns text[]
language plpgsql
immutable
as $$
declare
  _parts text[];
begin
  select string_to_array(name, '/') into _parts;
  return _parts[1 : array_length(_parts, 1) - 1];
end
$$;

create or replace function storage.filename(name text)
returns text
language plpgsql
immutable
as $$
declare
  _parts text[];
begin
  select string_to_array(name, '/') into _parts;
  return _parts[array_length(_parts, 1)];
end
$$;

create or replace function storage.extension(name text)
returns text
language plpgsql
immutable
as $$
declare
  _parts text[];
  _filename text;
begin
  select string_to_array(name, '/') into _parts;
  select _parts[array_length(_parts, 1)] into _filename;
  return reverse(split_part(reverse(_filename), '.', 1));
end
$$;

grant all on storage.objects, storage.buckets to anon, authenticated, service_role;
grant execute on function storage.foldername(text), storage.filename(text), storage.extension(text)
  to anon, authenticated, service_role;

-- ---------------------------------------------------------------------
-- 5) Publikace supabase_realtime
-- ---------------------------------------------------------------------
-- Realtime v Supabase posílá změny z této publikace. Migrace do ní
-- přidávají tabulky (`alter publication supabase_realtime add table …`),
-- takže musí existovat, jinak padnou.
do $$
begin
  if not exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    create publication supabase_realtime;
  end if;
end $$;

-- ---------------------------------------------------------------------
-- 6) Výchozí práva pro nově vzniklé objekty
-- ---------------------------------------------------------------------
-- Supabase má nastavené default privileges, díky nimž nové tabulky
-- v public rovnou vidí anon/authenticated/service_role. Bez toho by
-- lokální test hlásil chybějící práva tam, kde na ostrém žádná nechybí.
alter default privileges in schema public
  grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public
  grant all on sequences to anon, authenticated, service_role;
alter default privileges in schema public
  grant execute on functions to anon, authenticated, service_role;
