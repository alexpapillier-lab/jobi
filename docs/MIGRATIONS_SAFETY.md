# Bezpečnost migrací – ochrana dat testovacích uživatelů

Aby budoucí změny schématu **nepoškodily zakázky** (a další data), které mezitím vytvoří testovací uživatelé, dodržuj u Supabase migrací tato pravidla.

## Pravidla

### 1. Nové sloupce

- Přidávej sloupce jako **nullable** (`column type NULL`) nebo s **DEFAULT**.
- Vyhni se: `ALTER TABLE ... ADD COLUMN x text NOT NULL` bez DEFAULT (selže, pokud už v tabulce jsou řádky a DB to nedovolí).

```sql
-- OK
ALTER TABLE public.tickets ADD COLUMN IF NOT EXISTS new_field text;
ALTER TABLE public.tickets ADD COLUMN IF NOT EXISTS flag boolean DEFAULT false;

-- Rizikové (závisí na verzi a stavu tabulky)
-- ALTER TABLE public.tickets ADD COLUMN x text NOT NULL;
```

### 2. Mazání sloupců / tabulek

- Nejdřív v **kódu** přestaň sloupec/tabulku používat a nasaď tuto verzi.
- Až potom přidej migraci, která sloupec/tabulku **dropne**.
- Před dropem ověř, že žádný běžící kód na něj neodkazuje.

### 3. Změny typů sloupců

- Raději: přidej **nový sloupec** (správný typ), přenášej data (backfill), přepni aplikaci na nový sloupec, pak starý sloupec odstraň v další migraci.
- Přímé `ALTER COLUMN ... TYPE` na velkých tabulkách může být zamykající a riskantní.

### 4. Indexy a constrainty

- **Přidávání** indexů a FK je obvykle bezpečné (CREATE INDEX CONCURRENTLY na větších tabulkách, pokud Postgres podporuje).
- **Mazání** constraintů jen po ověření, že je kód nepoužívá.

### 5. RLS a policy

- Používej `DROP POLICY IF EXISTS` před `CREATE POLICY`, aby opakované spuštění migrace nepadalo (viz např. `20260208110000_create_profiles.sql`).

### 6. Před nasazením

- Migraci nejdřív **otestuj** (lokálně nebo na kopii DB): `supabase db push` nebo aplikace migrací na testovací projekt.
- Zkontroluj, že stávající data zůstávají v pořádku a aplikace po migraci běží.

---

Shrnutí: **přidávej, neměň a nemazej bez přípravy** – tak budoucí změny nepoškodí zakázky vytvořené testovacími uživateli.
