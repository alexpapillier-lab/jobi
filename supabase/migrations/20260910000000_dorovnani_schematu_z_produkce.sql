-- Dorovnání schématu, které je jen na produkci a v migracích chybí
-- ================================================================
--
-- PROČ:
-- Ostrá databáze Jobi vznikala postupně a část zásahů se dělala přímo
-- v Supabase Studiu, ne migrací. Test „postav databázi od nuly“
-- (npm run test:migrace, viz docs/MIGRACE_NA_CISTO.md) ukázal, že
-- z migrací vznikne databáze, které proti produkci chybí celý jeden
-- blok objektů kolem tabulek tickets / customers / service_statuses.
--
-- Nejde o kosmetiku. Bez sloupce `version` je aplikace ROZBITÁ:
--   * src/pages/Orders.tsx čte `version` v explicitním .select(...),
--     takže dotaz na zakázky by skončil chybou „column does not exist“,
--   * src/pages/Orders/hooks/useOrderActions.ts a
--     src/pages/Customers/hooks/useCustomerActions.ts na něm staví
--     optimistické zamykání (ochranu proti přepsání cizí změny).
-- Kdyby se dneska obnovila databáze ze zálohy jen z migrací, přišli
-- bychom o tuhle ochranu i o výpis zakázek.
--
-- BEZPEČNOST NA PRODUKCI (docs/MIGRATIONS_SAFETY.md):
-- Všechno je psané tak, aby to na produkci nic nezměnilo – objekty už tam
-- existují a každý krok je podmíněný (`if not exists`, kontrola
-- v pg_constraint / pg_trigger / pg_publication_tables). Migrace nemění
-- data, nemaže ani nepřepisuje nic stávajícího. Definice jsou převzaté
-- doslova z produkce (pg_get_functiondef / pg_get_triggerdef / indexdef /
-- pg_get_constraintdef), aby po jejím spuštění na čisté DB vzniklo
-- totéž, co je dnes v ostré databázi. Ověřeno čtecími dotazy 6. 9. 2026,
-- postup i výsledek jsou v docs/MIGRACE_NA_CISTO.md.
--
-- Jediné dvě věci, které push na produkci reálně udělá:
--   * `create or replace function public.bump_version()` funkci přepíše
--     znak po znaku stejnou definicí (jen zneplatní uložené plány),
--   * `comment on function` doplní popis, který v katalogu zatím chybí.
-- Nic z toho se nedotkne dat ani chování.
--
-- DATUM V NÁZVU: záměrně 20260910, tedy až za poslední existující
-- migrací (20260909210000). Migrace musí běžet POSLEDNÍ – přidává
-- sloupec, na který se odkazuje trigger, a musí projít i na produkci,
-- kde jsou všechny starší migrace už zapsané v ledgeru.

-- 1) Optimistické zamykání: sloupec version ------------------------------------
-- integer NOT NULL DEFAULT 1 – u existujících řádků se dopočítá z DEFAULT,
-- takže přidání nezamyká tabulku na přepis (PG11+ ukládá default do katalogu).
alter table public.tickets
  add column if not exists version integer not null default 1;

alter table public.customers
  add column if not exists version integer not null default 1;

-- Postgres nemá `ADD CONSTRAINT IF NOT EXISTS`, proto podmínka ručně.
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'tickets_version_gte_1'
  ) then
    alter table public.tickets
      add constraint tickets_version_gte_1 check (version >= 1);
  end if;

  if not exists (
    select 1 from pg_constraint where conname = 'customers_version_gte_1'
  ) then
    alter table public.customers
      add constraint customers_version_gte_1 check (version >= 1);
  end if;

  -- Telefon v normalizované podobě buď chybí úplně, nebo něco obsahuje.
  -- Prázdný řetězec by rozbil párování zákazníka podle čísla.
  if not exists (
    select 1 from pg_constraint where conname = 'customers_phone_norm_not_empty'
  ) then
    alter table public.customers
      add constraint customers_phone_norm_not_empty
      check (phone_norm is null or length(trim(both from phone_norm)) > 0);
  end if;

  if not exists (
    select 1 from pg_constraint where conname = 'service_statuses_order_index_gte_0'
  ) then
    alter table public.service_statuses
      add constraint service_statuses_order_index_gte_0 check (order_index >= 0);
  end if;
end $$;

-- Trigger, který verzi zvedá. Aplikace pak updatuje s `.eq('version', n)`
-- a když se nic nevrátí, ví, že řádek mezitím změnil někdo jiný.
create or replace function public.bump_version()
returns trigger
language plpgsql
set search_path to 'public'
as $function$
begin
  new.version = old.version + 1;
  return new;
end;
$function$;

comment on function public.bump_version() is
  'Zvedne sloupec version při každém UPDATE. Podklad pro optimistické zamykání v Zakázkách a Zákaznících.';

-- Triggery zakládáme jen když chybí – na produkci existují a nemá smysl
-- je rušit a vytvářet znovu (zbytečný zámek nad velkou tabulkou).
do $$
begin
  if not exists (
    select 1 from pg_trigger where tgname = 'bump_tickets_version' and not tgisinternal
  ) then
    create trigger bump_tickets_version
      before update on public.tickets
      for each row execute function public.bump_version();
  end if;

  if not exists (
    select 1 from pg_trigger where tgname = 'bump_customers_version' and not tgisinternal
  ) then
    create trigger bump_customers_version
      before update on public.customers
      for each row execute function public.bump_version();
  end if;

  -- service_statuses jako jediná ze tří tabulek nemá z migrací žádný
  -- trigger na updated_at, takže by se sloupec nikdy neaktualizoval.
  if not exists (
    select 1 from pg_trigger where tgname = 'set_service_statuses_updated_at' and not tgisinternal
  ) then
    create trigger set_service_statuses_updated_at
      before update on public.service_statuses
      for each row execute function public.set_updated_at();
  end if;
end $$;

-- POZNÁMKA: produkce má navíc ještě triggery `set_tickets_updated_at`
-- a `set_customers_updated_at`. Ty tu ZÁMĚRNĚ nezakládáme – z migrací
-- už vznikají `tickets_set_updated_at` a `trg_customers_updated_at`
-- se stejným chováním. Na produkci tak dnes běží dvojmo; přidávat tu
-- duplicitu i do čisté databáze by nedávalo smysl.

-- 2) Indexy, které jsou jen na produkci ----------------------------------------
-- Čistě výkonové (plus dvě unikátnosti). Bez nich databáze funguje,
-- ale výpisy zakázek a zákazníků se na větším servisu znatelně zpomalí.
create index if not exists idx_tickets_service_id_not_deleted
  on public.tickets using btree (service_id) where (deleted_at is null);

create index if not exists idx_tickets_customer_id_not_deleted
  on public.tickets using btree (customer_id) where (deleted_at is null);

create index if not exists idx_tickets_status_not_deleted
  on public.tickets using btree (status) where (deleted_at is null);

create index if not exists idx_tickets_service_updated_at
  on public.tickets using btree (service_id, updated_at desc);

create index if not exists idx_customers_service_phone_norm
  on public.customers using btree (service_id, phone_norm);

create index if not exists idx_customers_service_updated_at
  on public.customers using btree (service_id, updated_at desc);

-- Přísnější varianta unikátnosti telefonu: na rozdíl od
-- customers_service_phone_norm_uq (jen IS NOT NULL) hlídá i prázdný řetězec.
create unique index if not exists ux_customers_service_phone_norm
  on public.customers using btree (service_id, phone_norm)
  where ((phone_norm is not null) and (length(phone_norm) > 0));

create unique index if not exists ux_service_statuses_service_key
  on public.service_statuses using btree (service_id, key);

create unique index if not exists ux_service_statuses_service_order_index
  on public.service_statuses using btree (service_id, order_index);

create index if not exists idx_service_statuses_service_order_index
  on public.service_statuses using btree (service_id, order_index);

-- 3) FORCE ROW LEVEL SECURITY ---------------------------------------------------
-- Bez FORCE se RLS nevztahuje na vlastníka tabulky. Produkce ho na těchto
-- čtyřech tabulkách má, z migrací by nevznikl – obnovená databáze by tedy
-- byla méně chráněná než ostrá. Opakované spuštění je no-op.
alter table public.services            force row level security;
alter table public.service_memberships force row level security;
alter table public.service_invites     force row level security;
alter table public.customers           force row level security;

-- 4) Realtime: tabulky, které jsou v publikaci jen na produkci ------------------
-- `tickets` odebírají Zakázky i Kalendář (src/pages/Orders.tsx,
-- src/pages/Calendar.tsx) přes postgres_changes. Žádná migrace tabulku do
-- publikace nepřidává – na produkci ji tam někdo doplnil ručně ve Studiu.
-- Obnovená databáze by tedy tiše přestala posílat živé změny zakázek:
-- aplikace by se nepřihlásila k ničemu a seznam by se aktualizoval až
-- po ručním obnovení. `sms_conversations` je v publikaci na produkci taky.
-- Na produkci jsou obě už členy publikace, takže je podmínka přeskočí.
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
     where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'tickets'
  ) then
    alter publication supabase_realtime add table public.tickets;
  end if;

  if not exists (
    select 1 from pg_publication_tables
     where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'sms_conversations'
  ) then
    alter publication supabase_realtime add table public.sms_conversations;
  end if;
end $$;
