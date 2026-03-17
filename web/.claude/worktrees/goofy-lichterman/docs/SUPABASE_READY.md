# Supabase – stav „ready“ a doporučení pro další vývoj

Kontrolní seznam, že je projekt připraven na provoz a další vývoj, a co hlídat, aby se nic nerozbilo.

---

## 1. Stav po posledních úpravách

- **Linter:** Žádný error, jen 2 záměrné warnings (RLS policy `services_insert_any_authenticated`, Leaked password protection – viz **SUPABASE_OVERVIEW.md**).
- **RLS:** Všechny tabulky v `public` vystavené přes API mají zapnuté RLS a vhodné politiky. Opraveno: `customer_history`, `service_settings` (doplněna SELECT politika pro členy servisu – migrace `20260217130000_service_settings_select_policy.sql`).
- **Funkce:** U oznámených funkcí je nastaven `search_path` (migrace `20260217110000_function_search_path.sql`).
- **Rozšíření:** `citext` je ve schématu `extensions`, ne v `public` (migrace `20260217120000_citext_extension_schema.sql`).
- **Seed:** Soubor `supabase/seed.sql` existuje (může zůstat prázdný); při `supabase db reset` se nenačte chybějící soubor.

---

## 2. Co hlídat, aby se nic nerozbilo

### Root owner UUID v databázi

- V triggeru **`prevent_root_owner_change`** (tabulka `service_memberships`) je v kódu funkce natvrdo UUID root ownera (v migraci `20260102182558_remote_schema.sql`).
- Musí odpovídat **ROOT_OWNER_ID** (Edge Functions) a **VITE_ROOT_OWNER_ID** (frontend). Pokud změníš root ownera nebo nasadíš jiný projekt, musíš toto UUID upravit v DB (nová migrace, která přepíše tělo funkce s novým UUID), jinak bude trigger blokovat/porovnávat špatného uživatele.
- Viz **docs/ROOT_OWNER_SETUP.md**.

### Migrace a schéma

- **Před změnou schématu:** vždy nejdřív uprav kód (přestaň používat sloupec/tabulku), nasaď, pak přidej migraci, která maže nebo mění strukturu. Viz **docs/MIGRATIONS_SAFETY.md**.
- **Nové sloupce:** přidávej jako nullable nebo s DEFAULT, aby migrace nepadala na existujících datech.
- **Test:** před nasazením na produkci zkus `supabase db push` na kopii nebo lokálně a ověř, že aplikace po migraci běží.

### service_settings – pouze přes RPC

- **UPDATE** na `service_settings` je záměrně povolen jen přes RPC **`update_service_settings`** (RLS blokuje přímý UPDATE). Aplikace zapisuje jen touto RPC. SELECT je povolen členům servisu (politika „Service members can read service_settings“).

### Edge Functions a secrets

- **ROOT_OWNER_ID** – nutné pro services-list, service-manage, team-*, invite (root owner režim). Nastaveno v Supabase Secrets.
- **RESEND_API_KEY** (a volitelně doména) – pro odesílání pozvánek. Viz **docs/INVITE_EMAIL_RESEND.md**.
- Funkce volané z frontendu: `invite_create`, `invite-accept`, `team-list`, `team-update-role`, `team-remove-member`, `services-list`, `invite-delete`, `statuses-init-defaults`, `team-invite-list`, `service-manage`, `team-set-capabilities` (a další dle aplikace).

---

## 3. Backup a obnova

- V Supabase Dashboard: **Project Settings → Database** – zálohy (podle plánu Supabase), možnost Point-in-Time Recovery podle tarifu.
- Pro vlastní export: `pg_dump` přes connection string z Dashboardu, nebo Supabase CLI. Pravidelný export doporučen před většími migracemi.

---

## 4. Připravenost na další vývoj

- **Nové tabulky v `public`:** vždy zapni RLS a definuj politiky (SELECT/INSERT/UPDATE/DELETE podle potřeby); vyhni se „WITH CHECK (true)“ pro INSERT/UPDATE/DELETE, pokud to není záměr.
- **Nové funkce (SQL):** nastav `SET search_path = public` (nebo konkrétní schéma), aby linter nehlásil „function search_path mutable“.
- **Nové rozšíření:** instaluj do schématu `extensions`, ne do `public`.
- **Kontrola po změnách:** po nasazení migrací zkontroluj **Database → Linter** a **Authentication / Edge Functions** podle **docs/SUPABASE_OVERVIEW.md**.

---

## 5. Rychlý checklist před releasem / po větší změně

- [ ] Linter bez nových errors (warnings viz dokumentace).
- [ ] ROOT_OWNER_ID a VITE_ROOT_OWNER_ID (a UUID v triggeru) odpovídají cílovému root ownerovi.
- [ ] Edge Functions nasazené a potřebné secrets nastavené.
- [ ] Leaked password protection zapnutá v Auth (doporučeno).
- [ ] Záloha DB před migrací (nebo alespoň před destruktivní změnou).
- [ ] Po migraci: ověřit přihlášení, načtení servisů, načtení nastavení servisu (service_settings), tým a pozvánky.
