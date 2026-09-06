-- Indexy pro seznamy nad servisem s hodně daty (6. 9. 2026)
--
-- Vzniklo z měření na zátěžovém servisu s 4 800 zakázkami, 2 000 zákazníky
-- a 500 fakturami (viz docs/ZATEZ.md, sekce z 6. 9. 2026). Žádný z těchhle
-- dotazů nebyl pomalý sám o sobě, ale všechny končily plánem
-- „Index Scan podle service_id → Sort přes celý servis“. Ten sort se dělá
-- **při každé stránce zvlášť**, takže se s počtem řádků násobí.
--
-- Migrace jenom přidává indexy. Nic nemaže, nic nepřepisuje, nemění se ani
-- řádek dat – opakované spuštění je bez následků (IF NOT EXISTS).
--
-- CONCURRENTLY schválně není: `supabase db push` pouští migraci v transakci
-- a CREATE INDEX CONCURRENTLY v transakci běžet nesmí. Tabulky jsou malé
-- (jednotky až desítky MB), stavba indexu je otázka milisekund.

-- 1) Seznam zakázek: `service_id` + `deleted_at is null`, řazení
--    `created_at desc, id desc`. Existující tickets_service_created_idx
--    nemá `id`, takže nad ním plán dělal Incremental Sort; u hlubších
--    stránek (offset 4 200) se řadilo všech 4 800 řádků znovu.
create index if not exists idx_tickets_service_created_id
  on public.tickets (service_id, created_at desc, id desc)
  where deleted_at is null;

-- 2) Zákazníci potřebují ke každému zákazníkovi seznam jeho zakázek. Tahají
--    se dvě úzké kolony za celý servis – a plán na to sahal přes
--    `tickets_pkey`, tedy přes zakázky *všech* servisů (v měření zahodil
--    filtr 1 178 cizích řádků na každou tisícovku vlastních). S `include`
--    se dotaz obejde bez sahání do tabulky.
create index if not exists idx_tickets_service_customer_scan
  on public.tickets (service_id, id)
  include (customer_id)
  where deleted_at is null and customer_id is not null;

-- 3) Adresář zákazníků: řazení `created_at desc, id desc` se dělalo tříděním
--    všech zákazníků servisu, a to pro každou stránku.
create index if not exists idx_customers_service_created_id
  on public.customers (service_id, created_at desc, id desc);

-- 4) Seznam faktur: `service_id` + `deleted_at is null`, řazení `created_at desc`.
create index if not exists idx_invoices_service_created
  on public.invoices (service_id, created_at desc)
  where deleted_at is null;

-- 5) Komentáře k zakázce. Od 6. 9. 2026 se nenačítají komentáře celého
--    servisu, ale jen otevřené zakázky (`service_id` + `ticket_id in (…)`
--    + řazení podle času). Index na samotný `ticket_id` na to stačil jen
--    proto, že komentářů je zatím málo.
create index if not exists idx_ticket_comments_ticket_created
  on public.ticket_comments (service_id, ticket_id, created_at);
