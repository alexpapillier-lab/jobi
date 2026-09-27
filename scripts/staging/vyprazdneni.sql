-- =====================================================================
-- vyprazdneni.sql — vyprázdní staging před obnovou ze zálohy
-- =====================================================================
-- Spouští jen scripts/staging/obnov-do-stagingu.sh, a to až po kontrole,
-- že cíl je staging (ref, značka jobi_staging). Běží v jedné transakci.
--
-- Proč se nedropuje celé schéma public: na Supabase public nepatří roli
-- postgres (vlastník je pg_database_owner) a visí na něm výchozí práva pro
-- anon/authenticated/service_role. Drop + create by je rozbil a vracet je
-- ručně je přesně ten typ kroku, na který se zapomene. Proto se mažou
-- všechny NAŠE objekty uvnitř public a schéma zůstává, jak ho dělá platforma.
--
-- Na schémata auth, storage, realtime, vault, cron, extensions se tu nesahá
-- (uživatele vymění až nahrání dat, v jedné transakci s anonymizací).
-- Objekty, které patří rozšířením (pg_depend deptype 'e'), zůstávají.
--
-- Pozor na CASCADE: politiky nad storage.objects odkazují na tabulky
-- v public a dropnou se s nimi. Skript si je proto PŘED vyprázdněním
-- opíše (krizove.sql) a po obnově schématu je vrátí.
-- =====================================================================

-- Prázdná cesta hledání: názvy objektů se pak vypisují i se schématem
-- (public.tickets), takže drop nemůže trefit stejnojmenný objekt jinde.
set search_path = pg_catalog;
-- Každý drop … cascade vypisuje desítky řádků „drop cascades to …“.
set client_min_messages = warning;

do $$
declare
  r record;
  n_tabulek int := 0;
  n_funkci int := 0;
  n_typu int := 0;
begin
  -- pohledy a materializované pohledy
  for r in
    select c.oid::regclass::text as o, c.relkind
      from pg_class c join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public' and c.relkind in ('v', 'm')
       and not exists (select 1 from pg_depend d where d.classid = 'pg_class'::regclass and d.objid = c.oid and d.deptype = 'e')
  loop
    execute format('drop %s if exists %s cascade',
                   case r.relkind when 'v' then 'view' else 'materialized view' end, r.o);
  end loop;

  -- tabulky (obyčejné, dělené, cizí)
  for r in
    select c.oid::regclass::text as o, c.relkind
      from pg_class c join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public' and c.relkind in ('r', 'p', 'f') and not c.relispartition
       and not exists (select 1 from pg_depend d where d.classid = 'pg_class'::regclass and d.objid = c.oid and d.deptype = 'e')
  loop
    execute format('drop %s if exists %s cascade',
                   case r.relkind when 'f' then 'foreign table' else 'table' end, r.o);
    n_tabulek := n_tabulek + 1;
  end loop;

  -- samostatné sekvence (ty patřící sloupcům zmizely s tabulkami)
  for r in
    select c.oid::regclass::text as o
      from pg_class c join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public' and c.relkind = 'S'
       and not exists (select 1 from pg_depend d where d.classid = 'pg_class'::regclass and d.objid = c.oid and d.deptype in ('e', 'a', 'i'))
  loop
    execute format('drop sequence if exists %s cascade', r.o);
  end loop;

  -- funkce, procedury, agregace
  for r in
    select p.oid::regprocedure::text as o, p.prokind
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and not exists (select 1 from pg_depend d where d.classid = 'pg_proc'::regclass and d.objid = p.oid and d.deptype = 'e')
     order by (p.prokind = 'a') desc  -- agregace před funkcemi, na kterých stojí
  loop
    execute format('drop %s if exists %s cascade',
                   case r.prokind when 'a' then 'aggregate' when 'p' then 'procedure' else 'function' end, r.o);
    n_funkci := n_funkci + 1;
  end loop;

  -- typy: výčty, samostatné složené typy, domény, rozsahy
  for r in
    select t.oid::regtype::text as o, t.typtype
      from pg_type t join pg_namespace n on n.oid = t.typnamespace
     where n.nspname = 'public'
       and t.typtype in ('e', 'c', 'd', 'r', 'm')
       and t.typelem = 0 and t.typcategory <> 'A'
       and (t.typrelid = 0 or (select c.relkind from pg_class c where c.oid = t.typrelid) = 'c')
       and not exists (select 1 from pg_depend d where d.classid = 'pg_type'::regclass and d.objid = t.oid and d.deptype = 'e')
  loop
    execute format('drop %s if exists %s cascade',
                   case r.typtype when 'd' then 'domain' else 'type' end, r.o);
    n_typu := n_typu + 1;
  end loop;

  perform set_config('client_min_messages', 'notice', true);
  raise notice 'vyprázdněno: % tabulek, % funkcí, % typů', n_tabulek, n_funkci, n_typu;
end $$;

-- Kontrola: v public nesmí zůstat nic našeho, jinak by se schéma ze zálohy
-- nahrálo jen napůl (create table … already exists) a nikdo by si nevšiml.
do $$
declare zbyva text;
begin
  select string_agg(c.relname, ', ') into zbyva
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relkind in ('r', 'p', 'v', 'm', 'f')
     and not exists (select 1 from pg_depend d where d.classid = 'pg_class'::regclass and d.objid = c.oid and d.deptype = 'e');
  if zbyva is not null then
    raise exception 'Po vyprázdnění zůstaly v public objekty: %', zbyva;
  end if;
end $$;
