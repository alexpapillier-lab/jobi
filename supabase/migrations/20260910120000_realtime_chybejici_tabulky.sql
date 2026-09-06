-- Dvě tabulky, na které se aplikace živě přihlašuje, ale publikace je nezná
-- ============================================================================
--
-- PROČ: Aplikace si přes `postgres_changes` říká o změny v `customers`
-- (src/pages/Customers.tsx) a `service_document_settings` (src/pages/Orders.tsx).
-- Ani jedna z nich ale není v publikaci `supabase_realtime`, takže odběr se
-- **tiše naváže a nikdy nic nepřijde**: kolega založí zákazníka nebo změní
-- nastavení dokladů a druhému se obrazovka neaktualizuje, dokud stránku
-- nenačte znovu. Nic se neztratí, ale vypadá to, že se změna neuložila –
-- a přesně tenhle pocit má aplikace nedělat.
--
-- Našlo se to při stavbě databáze od nuly (docs/MIGRACE_NA_CISTO.md), kde se
-- porovnával seznam publikovaných tabulek proti tomu, co odebírá klient.
-- Stejným porovnáním se ukázalo, že Orders.tsx odebíral tabulku
-- `device_repairs`, která v databázi vůbec neexistuje (správně `repairs`) –
-- opraveno v aplikaci, Supabase na neznámou tabulku nijak neupozorní.
--
-- BEZPEČNOST: publikace nemění práva. Realtime posílá změny jen tomu, kdo si
-- řádek smí přečíst podle RLS – u obou tabulek platí stejné politiky jako pro
-- běžné čtení, takže cizí servis se nedozví nic.
--
-- Přidání je podmíněné, aby migrace prošla i tam, kde už tabulky v publikaci
-- jsou (a aby `db push` nespadl při opakování).
do $$
begin
  if not exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    raise notice 'Publikace supabase_realtime neexistuje, přeskakuji.';
    return;
  end if;

  if not exists (
    select 1 from pg_publication_tables
     where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'customers'
  ) then
    alter publication supabase_realtime add table public.customers;
  end if;

  if not exists (
    select 1 from pg_publication_tables
     where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'service_document_settings'
  ) then
    alter publication supabase_realtime add table public.service_document_settings;
  end if;
end $$;
