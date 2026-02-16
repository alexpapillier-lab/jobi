# Kompletní diagnostika Supabase projektu

Spusť příkazy níže v **Supabase Dashboard → SQL Editor** (nebo přes `supabase` CLI). Výstupy vlep pod příslušné sekce – pak z toho zjistíme úplně vše, jak projekt vypadá.

---

## 1. Edge Functions

**Dashboard → Edge Functions** – zapiš všechny názvy nasazených funkcí (jak je vidíš v seznamu).

Nebo v terminálu (z kořene projektu):

```bash
supabase functions list
```

**Výstup (vlep sem):**
  
   ID                                   | NAME                   | SLUG                   | STATUS | VERSION | UPDATED_AT (UTC)    
  --------------------------------------|------------------------|------------------------|--------|---------|---------------------
   78880600-1845-4322-a273-fd7d9e5fe66f | team-list              | team-list              | ACTIVE | 20      | 2025-12-31 22:49:09 
   29b6afd4-e569-4aa1-80c2-74b933e31389 | invite-create          | invite-create          | ACTIVE | 3       | 2025-12-28 21:09:23 
   1c026089-2bb4-4eac-b9fd-1cc885be15d1 | invite-accept          | invite-accept          | ACTIVE | 11      | 2025-12-29 10:43:17 
   f5035dd3-aa00-4811-b88e-3d879e773f24 | team-update-role       | team-update-role       | ACTIVE | 1       | 2025-12-28 19:08:40 
   fe3d4ace-44b0-4b2f-b270-969785745f23 | team-remove-member     | team-remove-member     | ACTIVE | 19      | 2025-12-31 22:49:11 
   febebddb-cdfc-4272-9eab-80411980c658 | services-list          | services-list          | ACTIVE | 1       | 2025-12-28 21:44:53 
   feade9e7-3ddb-41ee-a4f0-ee916d49b9ce | invite-delete          | invite-delete          | ACTIVE | 3       | 2025-12-29 09:39:44 
   c42c18fd-9395-4b2e-ae12-9b462f1182e0 | statuses-init-defaults | statuses-init-defaults | ACTIVE | 1       | 2025-12-29 10:55:09 
   69f04ca4-9ffa-406f-9e16-8d2ee3dc4c7a | team-invite-list       | team-invite-list       | ACTIVE | 1       | 2026-02-15 20:18:45 

A new version of Supabase CLI is available: v2.75.0 (currently installed v2.67.1)
We recommend updating regularly for new features and bug fixes: https://supabase.com/docs/guides/cli/getting-started#updating-the-supabase-cli
```
(přidej seznam funkcí nebo výstup příkazu)
```

---

## 2. Všechny tabulky v `public` + počet řádků

V **SQL Editor** spusť:

```sql
SELECT relname AS tabulka, n_live_tup AS pocet_radku
FROM pg_stat_user_tables
WHERE schemaname = 'public'
ORDER BY relname;
```

**Výstup (vlep sem):**
| tabulka                    | pocet_radku |
| -------------------------- | ----------- |
| customer_history           | 0           |
| customers                  | 1           |
| document_profiles          | 0           |
| profiles                   | 1           |
| service_document_settings  | 0           |
| service_document_templates | 0           |
| service_invites            | 0           |
| service_memberships        | 0           |
| service_settings           | 0           |
| service_statuses           | 0           |
| services                   | 0           |
| ticket_documents           | 0           |
| tickets                    | 1           |
```
(tabulka | pocet_radku)
```

---

## 3. Struktura všech tabulek (sloupce)

V **SQL Editor** spusť:

```sql
SELECT table_name, column_name, data_type, is_nullable, column_default
FROM information_schema.columns
WHERE table_schema = 'public'
ORDER BY table_name, ordinal_position;
```

**Výstup (vlep sem):**
| table_name                 | column_name      | data_type                | is_nullable | column_default                |
| -------------------------- | ---------------- | ------------------------ | ----------- | ----------------------------- |
| customer_history           | id               | uuid                     | NO          | gen_random_uuid()             |
| customer_history           | customer_id      | uuid                     | NO          | null                          |
| customer_history           | service_id       | uuid                     | NO          | null                          |
| customer_history           | changed_at       | timestamp with time zone | NO          | now()                         |
| customer_history           | changed_by       | uuid                     | YES         | null                          |
| customer_history           | change_type      | text                     | NO          | null                          |
| customer_history           | diff             | jsonb                    | NO          | null                          |
| customers                  | id               | uuid                     | NO          | gen_random_uuid()             |
| customers                  | service_id       | uuid                     | NO          | null                          |
| customers                  | name             | text                     | NO          | null                          |
| customers                  | phone            | text                     | YES         | null                          |
| customers                  | email            | text                     | YES         | null                          |
| customers                  | company          | text                     | YES         | null                          |
| customers                  | ico              | text                     | YES         | null                          |
| customers                  | dic              | text                     | YES         | null                          |
| customers                  | address_street   | text                     | YES         | null                          |
| customers                  | address_city     | text                     | YES         | null                          |
| customers                  | address_zip      | text                     | YES         | null                          |
| customers                  | address_country  | text                     | YES         | null                          |
| customers                  | note             | text                     | YES         | null                          |
| customers                  | created_at       | timestamp with time zone | NO          | now()                         |
| customers                  | updated_at       | timestamp with time zone | NO          | now()                         |
| customers                  | info             | text                     | YES         | null                          |
| customers                  | phone_norm       | text                     | YES         | null                          |
| customers                  | version          | integer                  | NO          | 1                             |
| document_profiles          | id               | uuid                     | NO          | gen_random_uuid()             |
| document_profiles          | service_id       | uuid                     | NO          | null                          |
| document_profiles          | doc_type         | text                     | NO          | null                          |
| document_profiles          | profile_json     | jsonb                    | NO          | '{}'::jsonb                   |
| document_profiles          | version          | integer                  | NO          | 1                             |
| document_profiles          | updated_at       | timestamp with time zone | NO          | now()                         |
| document_profiles          | updated_by       | uuid                     | YES         | null                          |
| profiles                   | id               | uuid                     | NO          | null                          |
| profiles                   | nickname         | text                     | YES         | null                          |
| profiles                   | avatar_url       | text                     | YES         | null                          |
| profiles                   | updated_at       | timestamp with time zone | YES         | now()                         |
| service_document_settings  | id               | uuid                     | NO          | gen_random_uuid()             |
| service_document_settings  | service_id       | uuid                     | NO          | null                          |
| service_document_settings  | config           | jsonb                    | NO          | '{}'::jsonb                   |
| service_document_settings  | created_at       | timestamp with time zone | NO          | now()                         |
| service_document_settings  | updated_at       | timestamp with time zone | NO          | now()                         |
| service_document_settings  | version          | integer                  | NO          | 1                             |
| service_document_templates | id               | uuid                     | NO          | gen_random_uuid()             |
| service_document_templates | service_id       | uuid                     | NO          | null                          |
| service_document_templates | doc_type         | text                     | NO          | null                          |
| service_document_templates | template_html    | text                     | NO          | null                          |
| service_document_templates | header_html      | text                     | YES         | null                          |
| service_document_templates | footer_html      | text                     | YES         | null                          |
| service_document_templates | logo_path        | text                     | YES         | null                          |
| service_document_templates | template_version | integer                  | NO          | 1                             |
| service_document_templates | updated_at       | timestamp with time zone | NO          | now()                         |
| service_document_templates | updated_by       | uuid                     | YES         | null                          |
| service_invites            | id               | uuid                     | NO          | gen_random_uuid()             |
| service_invites            | service_id       | uuid                     | NO          | null                          |
| service_invites            | email            | USER-DEFINED             | NO          | null                          |
| service_invites            | role             | text                     | NO          | null                          |
| service_invites            | invited_by       | uuid                     | NO          | null                          |
| service_invites            | token            | text                     | NO          | null                          |
| service_invites            | created_at       | timestamp with time zone | NO          | now()                         |
| service_invites            | expires_at       | timestamp with time zone | NO          | (now() + '14 days'::interval) |
| service_invites            | accepted_at      | timestamp with time zone | YES         | null                          |
| service_invites            | accepted_by      | uuid                     | YES         | null                          |
| service_memberships        | service_id       | uuid                     | NO          | null                          |
| service_memberships        | user_id          | uuid                     | NO          | null                          |
| service_memberships        | role             | text                     | NO          | null                          |
| service_memberships        | created_at       | timestamp with time zone | YES         | now()                         |
| service_memberships        | capabilities     | jsonb                    | NO          | '{}'::jsonb                   |
| service_settings           | service_id       | uuid                     | NO          | null                          |
| service_settings           | config           | jsonb                    | NO          | '{}'::jsonb                   |
| service_settings           | created_at       | timestamp with time zone | NO          | now()                         |
| service_settings           | updated_at       | timestamp with time zone | NO          | now()                         |
| service_statuses           | id               | uuid                     | NO          | gen_random_uuid()             |
| service_statuses           | service_id       | uuid                     | NO          | null                          |
| service_statuses           | key              | text                     | NO          | null                          |
| service_statuses           | label            | text                     | NO          | null                          |
| service_statuses           | bg               | text                     | YES         | null                          |
| service_statuses           | fg               | text                     | YES         | null                          |
| service_statuses           | is_final         | boolean                  | NO          | false                         |
| service_statuses           | order_index      | integer                  | NO          | 0                             |
| service_statuses           | created_at       | timestamp with time zone | YES         | now()                         |
| service_statuses           | updated_at       | timestamp with time zone | YES         | now()                         |
| services                   | id               | uuid                     | NO          | gen_random_uuid()             |
| services                   | name             | text                     | NO          | null                          |
| services                   | created_at       | timestamp with time zone | YES         | now()                         |
| ticket_documents           | id               | uuid                     | NO          | gen_random_uuid()             |
| ticket_documents           | service_id       | uuid                     | NO          | null                          |
| ticket_documents           | ticket_id        | uuid                     | NO          | null                          |
| ticket_documents           | doc_type         | text                     | NO          | null                          |
| ticket_documents           | storage_path     | text                     | NO          | null                          |
| ticket_documents           | content_hash     | text                     | NO          | null                          |
| ticket_documents           | file_size_bytes  | integer                  | YES         | null                          |
| ticket_documents           | page_count       | integer                  | YES         | null                          |
| ticket_documents           | updated_at       | timestamp with time zone | NO          | now()                         |
| ticket_documents           | updated_by       | uuid                     | YES         | null                          |
| tickets                    | id               | uuid                     | NO          | gen_random_uuid()             |
| tickets                    | service_id       | uuid                     | NO          | null                          |
| tickets                    | title            | text                     | NO          | ''::text                      |
| tickets                    | status           | text                     | NO          | 'received'::text              |
| tickets                    | notes            | text                     | NO          | ''::text                      |
| tickets                    | created_at       | timestamp with time zone | NO          | now()                         |
```
(table_name | column_name | data_type | is_nullable | column_default)
```

---

## 4. Všechny RLS politiky

V **SQL Editor** spusť:

```sql
SELECT schemaname, tablename, policyname, permissive, roles, cmd,
       left(qual::text, 120) AS qual_preview,
       left(with_check::text, 80) AS with_check_preview
FROM pg_policies
WHERE schemaname = 'public'
ORDER BY tablename, policyname;
```

**Výstup (vlep sem):**
| schemaname | tablename                  | policyname                                    | permissive | roles           | cmd    | qual_preview                                                                                                             | with_check_preview                                                               |
| ---------- | -------------------------- | --------------------------------------------- | ---------- | --------------- | ------ | ------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------- |
| public     | customers                  | customers_delete                              | PERMISSIVE | {authenticated} | DELETE | (EXISTS ( SELECT 1
   FROM service_memberships sm
  WHERE ((sm.service_id = customers.service_id) AND (sm.user_id = auth | null                                                                             |
| public     | customers                  | customers_insert                              | PERMISSIVE | {authenticated} | INSERT | null                                                                                                                     | (EXISTS ( SELECT 1
   FROM service_memberships sm
  WHERE ((sm.service_id = cust |
| public     | customers                  | customers_select                              | PERMISSIVE | {authenticated} | SELECT | (EXISTS ( SELECT 1
   FROM service_memberships sm
  WHERE ((sm.service_id = customers.service_id) AND (sm.user_id = auth | null                                                                             |
| public     | customers                  | customers_update                              | PERMISSIVE | {authenticated} | UPDATE | (EXISTS ( SELECT 1
   FROM service_memberships sm
  WHERE ((sm.service_id = customers.service_id) AND (sm.user_id = auth | (EXISTS ( SELECT 1
   FROM service_memberships sm
  WHERE ((sm.service_id = cust |
| public     | document_profiles          | Owner/admin can delete document profiles      | PERMISSIVE | {public}        | DELETE | (EXISTS ( SELECT 1
   FROM service_memberships
  WHERE ((service_memberships.service_id = document_profiles.service_id)  | null                                                                             |
| public     | document_profiles          | Owner/admin can insert document profiles      | PERMISSIVE | {public}        | INSERT | null                                                                                                                     | (EXISTS ( SELECT 1
   FROM service_memberships
  WHERE ((service_memberships.ser |
| public     | document_profiles          | Owner/admin can update document profiles      | PERMISSIVE | {public}        | UPDATE | (EXISTS ( SELECT 1
   FROM service_memberships
  WHERE ((service_memberships.service_id = document_profiles.service_id)  | (EXISTS ( SELECT 1
   FROM service_memberships
  WHERE ((service_memberships.ser |
| public     | document_profiles          | Service members can read document profiles    | PERMISSIVE | {public}        | SELECT | (EXISTS ( SELECT 1
   FROM service_memberships
  WHERE ((service_memberships.service_id = document_profiles.service_id)  | null                                                                             |
| public     | profiles                   | profiles_insert_own                           | PERMISSIVE | {authenticated} | INSERT | null                                                                                                                     | (id = auth.uid())                                                                |
| public     | profiles                   | profiles_select_authenticated                 | PERMISSIVE | {authenticated} | SELECT | true                                                                                                                     | null                                                                             |
| public     | profiles                   | profiles_update_own                           | PERMISSIVE | {authenticated} | UPDATE | (id = auth.uid())                                                                                                        | (id = auth.uid())                                                                |
| public     | service_document_settings  | Only owner/admin can insert document settings | PERMISSIVE | {authenticated} | INSERT | null                                                                                                                     | (EXISTS ( SELECT 1
   FROM service_memberships sm
  WHERE ((sm.service_id = serv |
| public     | service_document_settings  | Only owner/admin can update document settings | PERMISSIVE | {authenticated} | UPDATE | (EXISTS ( SELECT 1
   FROM service_memberships sm
  WHERE ((sm.service_id = service_document_settings.service_id) AND (s | (EXISTS ( SELECT 1
   FROM service_memberships sm
  WHERE ((sm.service_id = serv |
| public     | service_document_settings  | Service members can read document settings    | PERMISSIVE | {authenticated} | SELECT | (EXISTS ( SELECT 1
   FROM service_memberships sm
  WHERE ((sm.service_id = service_document_settings.service_id) AND (s | null                                                                             |
| public     | service_document_templates | service_document_templates_insert_own_service | PERMISSIVE | {authenticated} | INSERT | null                                                                                                                     | (EXISTS ( SELECT 1
   FROM service_memberships sm
  WHERE ((sm.service_id = serv |
| public     | service_document_templates | service_document_templates_select_own_service | PERMISSIVE | {authenticated} | SELECT | (EXISTS ( SELECT 1
   FROM service_memberships sm
  WHERE ((sm.service_id = service_document_templates.service_id) AND ( | null                                                                             |
| public     | service_document_templates | service_document_templates_update_own_service | PERMISSIVE | {authenticated} | UPDATE | (EXISTS ( SELECT 1
   FROM service_memberships sm
  WHERE ((sm.service_id = service_document_templates.service_id) AND ( | (EXISTS ( SELECT 1
   FROM service_memberships sm
  WHERE ((sm.service_id = serv |
| public     | service_invites            | invites_delete_admin                          | PERMISSIVE | {authenticated} | DELETE | (EXISTS ( SELECT 1
   FROM service_memberships sm
  WHERE ((sm.service_id = service_invites.service_id) AND (sm.user_id  | null                                                                             |
| public     | service_invites            | invites_insert_admin                          | PERMISSIVE | {authenticated} | INSERT | null                                                                                                                     | ((invited_by = auth.uid()) AND (EXISTS ( SELECT 1
   FROM service_memberships sm |
| public     | service_invites            | invites_select_admin                          | PERMISSIVE | {authenticated} | SELECT | (EXISTS ( SELECT 1
   FROM service_memberships sm
  WHERE ((sm.service_id = service_invites.service_id) AND (sm.user_id  | null                                                                             |
| public     | service_invites            | invites_update_admin                          | PERMISSIVE | {authenticated} | UPDATE | (EXISTS ( SELECT 1
   FROM service_memberships sm
  WHERE ((sm.service_id = service_invites.service_id) AND (sm.user_id  | (EXISTS ( SELECT 1
   FROM service_memberships sm
  WHERE ((sm.service_id = serv |
| public     | service_memberships        | service role can delete memberships           | PERMISSIVE | {service_role}  | DELETE | true                                                                                                                     | null                                                                             |
| public     | service_memberships        | service_memberships_select                    | PERMISSIVE | {authenticated} | SELECT | (is_owner_or_admin(service_id) OR (user_id = auth.uid()))                                                                | null                                                                             |
| public     | service_settings           | Service members can insert service settings   | PERMISSIVE | {public}        | INSERT | null                                                                                                                     | (EXISTS ( SELECT 1
   FROM service_memberships
  WHERE ((service_memberships.ser |
| public     | service_settings           | Service members can read service settings     | PERMISSIVE | {public}        | SELECT | (EXISTS ( SELECT 1
   FROM service_memberships
  WHERE ((service_memberships.service_id = service_settings.service_id) A | null                                                                             |
| public     | service_settings           | Service settings can only be updated via RPC  | PERMISSIVE | {public}        | UPDATE | false                                                                                                                    | false                                                                            |
| public     | service_statuses           | service_statuses_delete_by_owner_admin        | PERMISSIVE | {authenticated} | DELETE | (EXISTS ( SELECT 1
   FROM service_memberships m
  WHERE ((m.service_id = service_statuses.service_id) AND (m.user_id =  | null                                                                             |
| public     | service_statuses           | service_statuses_insert_by_owner_admin        | PERMISSIVE | {authenticated} | INSERT | null                                                                                                                     | (EXISTS ( SELECT 1
   FROM service_memberships m
  WHERE ((m.service_id = servic |
| public     | service_statuses           | service_statuses_select_by_membership         | PERMISSIVE | {authenticated} | SELECT | (EXISTS ( SELECT 1
   FROM service_memberships m
  WHERE ((m.service_id = service_statuses.service_id) AND (m.user_id =  | null                                                                             |
| public     | service_statuses           | service_statuses_update_by_owner_admin        | PERMISSIVE | {authenticated} | UPDATE | (EXISTS ( SELECT 1
   FROM service_memberships m
  WHERE ((m.service_id = service_statuses.service_id) AND (m.user_id =  | (EXISTS ( SELECT 1
   FROM service_memberships m
  WHERE ((m.service_id = servic |
| public     | services                   | services_insert_any_authenticated             | PERMISSIVE | {authenticated} | INSERT | null                                                                                                                     | true                                                                             |
| public     | services                   | services_select_by_membership                 | PERMISSIVE | {authenticated} | SELECT | (EXISTS ( SELECT 1
   FROM service_memberships m
  WHERE ((m.service_id = services.id) AND (m.user_id = auth.uid()))))   | null                                                                             |
| public     | services                   | services_update_by_admin                      | PERMISSIVE | {authenticated} | UPDATE | (EXISTS ( SELECT 1
   FROM service_memberships m
  WHERE ((m.service_id = services.id) AND (m.user_id = auth.uid()) AND  | (EXISTS ( SELECT 1
   FROM service_memberships m
  WHERE ((m.service_id = servic |
| public     | ticket_documents           | ticket_documents_insert_own_service           | PERMISSIVE | {authenticated} | INSERT | null                                                                                                                     | (EXISTS ( SELECT 1
   FROM service_memberships sm
  WHERE ((sm.service_id = tick |
| public     | ticket_documents           | ticket_documents_select_own_service           | PERMISSIVE | {authenticated} | SELECT | (EXISTS ( SELECT 1
   FROM service_memberships sm
  WHERE ((sm.service_id = ticket_documents.service_id) AND (sm.user_id | null                                                                             |
| public     | ticket_documents           | ticket_documents_update_own_service           | PERMISSIVE | {authenticated} | UPDATE | (EXISTS ( SELECT 1
   FROM service_memberships sm
  WHERE ((sm.service_id = ticket_documents.service_id) AND (sm.user_id | (EXISTS ( SELECT 1
   FROM service_memberships sm
  WHERE ((sm.service_id = tick |
| public     | tickets                    | Service members can update tickets            | PERMISSIVE | {public}        | UPDATE | (EXISTS ( SELECT 1
   FROM service_memberships sm
  WHERE ((sm.service_id = tickets.service_id) AND (sm.user_id = auth.u | (EXISTS ( SELECT 1
   FROM service_memberships sm
  WHERE ((sm.service_id = tick |
| public     | tickets                    | tickets_insert_by_membership                  | PERMISSIVE | {authenticated} | INSERT | null                                                                                                                     | (EXISTS ( SELECT 1
   FROM service_memberships m
  WHERE ((m.service_id = ticket |
| public     | tickets                    | tickets_select_by_membership                  | PERMISSIVE | {authenticated} | SELECT | (EXISTS ( SELECT 1
   FROM service_memberships m
  WHERE ((m.service_id = tickets.service_id) AND (m.user_id = auth.uid( | null                                                                             |
| public     | tickets                    | tickets_update_by_membership                  | PERMISSIVE | {authenticated} | UPDATE | ((EXISTS ( SELECT 1
   FROM service_memberships m
  WHERE ((m.service_id = tickets.service_id) AND (m.user_id = auth.uid | ((EXISTS ( SELECT 1
   FROM service_memberships m
  WHERE ((m.service_id = ticke |
```
(schemaname | tablename | policyname | permissive | roles | cmd | qual_preview | with_check_preview)
```

---

## 5. Rozšíření (extensions)

V **SQL Editor** spusť:

```sql
SELECT extname, extversion FROM pg_extension WHERE extname NOT IN ('plpgsql');
```

**Výstup (vlep sem):**
| extname            | extversion |
| ------------------ | ---------- |
| pg_stat_statements | 1.11       |
| uuid-ossp          | 1.1        |
| pgcrypto           | 1.3        |
| supabase_vault     | 0.3.1      |
| pg_graphql         | 1.5.11     |
| citext             | 1.6        |
```
(extname | extversion)
```

---

## 6. Auth – počet uživatelů (volitelné)

V **SQL Editor** spusť:

```sql
SELECT count(*) AS auth_users_count FROM auth.users;
```

**Výstup (vlep sem):**
| auth_users_count |
| ---------------- |
| 17               |
```
(auth_users_count)
```

---

## 7. Storage – kbelíky (buckets)

**Dashboard → Storage** – zapiš názvy všech bucketů a jestli jsou public/private.

Nebo v **SQL Editor**:

```sql
SELECT id, name, public, file_size_limit, allowed_mime_types
FROM storage.buckets
ORDER BY name;
```

**Výstup (vlep sem):**
Success. No rows returned
```
(id | name | public | file_size_limit | allowed_mime_types)
```

---

## 8. Migrace / verze schématu (pokud používáš migrace)

V terminálu (z kořene projektu):

```bash
supabase migration list
```

Nebo v **SQL Editor** (pokud máš tabulku s historií migrací):

```sql
SELECT * FROM supabase_migrations.schema_migrations ORDER BY version;
```

**Výstup (vlep sem):**
   Local          | Remote         | Time (UTC)          
  ----------------|----------------|---------------------
   20241231000000 | 20241231000000 | 2024-12-31 00:00:00 
   20241231000001 | 20241231000001 | 2024-12-31 00:00:01 
   20241231000002 | 20241231000002 | 2024-12-31 00:00:02 
   20241231000003 | 20241231000003 | 2024-12-31 00:00:03 
   20241231000010 | 20241231000010 | 2024-12-31 00:00:10 
   20250101000000 | 20250101000000 | 2025-01-01 00:00:00 
   20250102000000 | 20250102000000 | 2025-01-02 00:00:00 
   20250103000000 | 20250103000000 | 2025-01-03 00:00:00 
   20250103000001 | 20250103000001 | 2025-01-03 00:00:01 
   20250103000002 | 20250103000002 | 2025-01-03 00:00:02 
   20250104000000 | 20250104000000 | 2025-01-04 00:00:00 
   20250105000000 | 20250105000000 | 2025-01-05 00:00:00 
   20250105000001 | 20250105000001 | 2025-01-05 00:00:01 
   20250105000002 | 20250105000002 | 2025-01-05 00:00:02 
   20250105000003 | 20250105000003 | 2025-01-05 00:00:03 
   20250105000004 | 20250105000004 | 2025-01-05 00:00:04 
   20250106000000 | 20250106000000 | 2025-01-06 00:00:00 
   20250106000001 | 20250106000001 | 2025-01-06 00:00:01 
   20250107000000 | 20250107000000 | 2025-01-07 00:00:00 
   20250108000000 | 20250108000000 | 2025-01-08 00:00:00 
   20250109000000 | 20250109000000 | 2025-01-09 00:00:00 
   20250109000001 | 20250109000001 | 2025-01-09 00:00:01 
   20250110000000 | 20250110000000 | 2025-01-10 00:00:00 
   20250111000000 | 20250111000000 | 2025-01-11 00:00:00 
   20250115000000 | 20250115000000 | 2025-01-15 00:00:00 
   20250116000000 | 20250116000000 | 2025-01-16 00:00:00 
   20250117000000 | 20250117000000 | 2025-01-17 00:00:00 
   20260102182558 | 20260102182558 | 2026-01-02 18:25:58 
   20260208100000 | 20260208100000 | 2026-02-08 10:00:00 
   20260208110000 | 20260208110000 | 2026-02-08 11:00:00 
```
(výstup příkazu nebo řádky z schema_migrations)
```

---

## 9. Přehled FK a důležitých vazeb (volitelné)

V **SQL Editor** spusť:

```sql
SELECT
  tc.table_name,
  kcu.column_name,
  ccu.table_name AS foreign_table,
  ccu.column_name AS foreign_column
FROM information_schema.table_constraints tc
JOIN information_schema.key_column_usage kcu ON tc.constraint_name = kcu.constraint_name AND tc.table_schema = kcu.table_schema
JOIN information_schema.constraint_column_usage ccu ON ccu.constraint_name = tc.constraint_name AND ccu.table_schema = tc.table_schema
WHERE tc.constraint_type = 'FOREIGN KEY' AND tc.table_schema = 'public'
ORDER BY tc.table_name, kcu.column_name;
```

**Výstup (vlep sem):**
| table_name                 | column_name | foreign_table | foreign_column |
| -------------------------- | ----------- | ------------- | -------------- |
| customer_history           | customer_id | customers     | id             |
| customers                  | service_id  | services      | id             |
| document_profiles          | service_id  | services      | id             |
| service_document_settings  | service_id  | services      | id             |
| service_document_templates | service_id  | services      | id             |
| service_invites            | service_id  | services      | id             |
| service_memberships        | service_id  | services      | id             |
| service_settings           | service_id  | services      | id             |
| service_statuses           | service_id  | services      | id             |
| ticket_documents           | service_id  | services      | id             |
| ticket_documents           | ticket_id   | tickets       | id             |
| tickets                    | customer_id | customers     | id             |
| tickets                    | service_id  | services      | id             |
```
(table_name | column_name | foreign_table | foreign_column)
```

---

## 10. Projekt (ručně z Dashboardu)

Z **Dashboard → Project Settings → General** můžeš zapsat (nemusíš, jen pro kontext):

- **Project URL:** https://ijtvcgolsdsrquqbvjrz.supabase.co
- **Region:** euwest
- **Database version:** t4nano asi?

---

## Shrnutí

Až sem vlepíš všechny výstupy, napiš „hotovo“ (nebo pošleš soubor). Podle toho pak:
- zkontroluju celý stav DB, RLS a funkcí,
- srovnám s tím, co čeká Jobi (názvy Edge Functions, tabulky, sloupce),
- dopíšu do tohoto souboru závěry a případné úpravy.

---

## Závěry (vyplněno po odeslání výstupů)

### Edge Functions – srovnání s frontendem

| Frontend volal        | Supabase má nasazené | Úprava |
|-----------------------|----------------------|--------|
| team-list             | team-list            | ✓ shoda |
| team-invite-list      | team-invite-list     | **Nepoužíváno:** data se berou z odpovědi team-list (viz sekce „Tým a přístupy – finální řešení“) |
| team-invite           | invite-create        | **Upraveno:** frontend teď volá `invite-create` s `body: { mode: "current", serviceId, email, role }` |
| team-invite-delete    | invite-delete        | **Upraveno:** frontend teď volá `invite-delete` |
| change-role           | team-update-role     | **Upraveno:** frontend teď volá `team-update-role` a posílá `role` (ne `newRole`) |
| team-remove-member    | team-remove-member   | ✓ shoda |
| services-list         | services-list        | ✓ shoda |
| invite-accept         | invite-accept        | ✓ shoda |
| statuses-init-defaults| statuses-init-defaults | ✓ shoda |

V souboru `src/pages/Settings/TeamSettings.tsx` jsou úpravy: volání `invite-create`, `invite-delete`, `team-update-role` se správnými názvy a parametry.

### Tým a přístupy – finální řešení (únor 2026)

**Problém:** Při načítání Týmu a přístupů první volání `team-list` prošlo, druhé volání `team-invite-list` vracelo **401 Invalid JWT** (v Tauri/WebView při druhém requestu byl token odmítnut; příčina nebyla dořešena).

**Řešení:** Jeden endpoint vrací obojí – členy i pozvánky.

| Co se změnilo | Kde |
|----------------|-----|
| **team-list** vrací kromě `members` i **invites** (pending pozvánky z `service_invites`) | `supabase/functions/team-list/index.ts` |
| Frontend volá jen **team-list** při načtení stránky i po odeslání/smazání pozvánky | `src/pages/Settings/TeamSettings.tsx` |
| **team-invite-list** už Jobi frontend nevolá; funkce může zůstat nasazená pro jiné klienty | – |

**Deploy:** Po úpravě `team-list` je potřeba znovu nasadit z kořene projektu:  
`cd /Volumes/backup/jobi && supabase functions deploy team-list`

### Stav DB

- **Tabulky:** Všechny očekávané tabulky existují (services, service_memberships, service_invites, customers, tickets, document_profiles, …).
- **RLS:** Politiky jsou nastavené (membership, invites, services, tickets, …).
- **Data:** services=0, service_memberships=0, service_invites=0 – zatím žádný servis; po přihlášení a vytvoření/prvním výběru servisu se data naplní. customers=1, tickets=1, profiles=1 – běžné pro začátek.
- **Storage:** Žádné buckety – v pořádku, pokud Jobi zatím neukládá soubory do Storage.
- **Migrace:** Lokální i remote v souladu (vše nasazené).

### Co dál

1. **Tým a přístupy** v Jobi načítá členy i pozvánky jedním voláním **team-list** (bez volání team-invite-list).
2. Vyzkoušej **pozvat člena** (volá invite-create), **smazat pozvánku** (invite-delete), **změnit roli** (team-update-role).
3. Pokud ještě nemáš žádný servis, můžeš ho vytvořit přes invite-create ve „stock“ režimu (vytvoření nového servisu) nebo jinak dle tvého flow.
