# Zálohy databáze (Supabase)

Jak zálohovat a obnovit databázi projektu Jobi.

---

## Co Supabase nabízí podle plánu

| Plán | Automatické zálohy | Poznámka |
|------|--------------------|----------|
| **Free** | ❌ žádné | Záloha jen ručně (CLI nebo pg_dump). |
| **Pro** | ✅ denní (logical) | Posledních 7 dní v Dashboardu → Database → Backups. Lze obnovit na konkrétní den. |
| **Team** | ✅ denní | 14 dní. |
| **Enterprise** | ✅ denní | 30 dní. |
| **PITR** (add-on, Pro+) | ✅ průběžné | Point-in-Time Recovery – obnova na libovolný okamžik (až sekundy). Placený add-on. |

**Důležité:** Zálohy databáze **neobsahují** soubory ve Storage (jen metadata). Smazané soubory z Storage se obnovením zálohy nevrátí.

---

## 1. Ruční záloha (funguje na všech plánech)

Použij **Supabase CLI** a connection string k databázi. Vhodné před migrací nebo jako pravidelné „vlastní“ zálohy (např. do úložiště).

### Kde vzít connection string a heslo

1. **Dashboard** → tvůj projekt → **Connect** (nebo **Project Settings → Database**).
2. **Database password:** Pokud ho neznáš, v **Database Settings** ho resetuj a zapiš si ho.
3. **Connection string:**  
   - **Session pooler:** `postgresql://postgres.[PROJECT-REF]:[YOUR-PASSWORD]@aws-0-REGION.pooler.supabase.com:5432/postgres`  
   - **Direct:** `postgresql://postgres:[YOUR-PASSWORD]@db.[PROJECT-REF].supabase.co:5432/postgres`  
   (PROJECT-REF najdeš v URL projektu v Dashboardu.)

### Příkazy pro zálohu (CLI)

V terminálu (nahraď `[CONNECTION_STRING]` celým connection stringem včetně hesla):

```bash
cd /Volumes/backup/jobi

# Role (práva, uživatelé)
supabase db dump --db-url "[CONNECTION_STRING]" -f backup/roles.sql --role-only

# Schéma (tabulky, funkce, RLS, triggery…)
supabase db dump --db-url "[CONNECTION_STRING]" -f backup/schema.sql

# Data (obsah tabulek)
supabase db dump --db-url "[CONNECTION_STRING]" -f backup/data.sql --use-copy --data-only
```

Doporučení: vytvoř složku `backup/` (a přidej ji do `.gitignore`, aby se zálohy s heslem necommitovaly). Případně ukládej zálohy mimo repo (externí disk, cloud).

### Jednoduchá „vše v jednom“ záloha (jen data + schéma)

Pokud ti stačí obnova do čistého projektu s migracemi a nepotřebuješ zachovat role z dumpu:

```bash
supabase db dump --db-url "[CONNECTION_STRING]" -f backup/full-schema.sql
supabase db dump --db-url "[CONNECTION_STRING]" -f backup/full-data.sql --use-copy --data-only
```

Obnova pak: nejdřív migrace (nebo `schema.sql`), pak `data.sql` s `session_replication_role = replica`.

---

## 2. Automatické denní zálohy (Pro plán a výše)

- V **Dashboardu** → **Database** → **Backups** (nebo **Scheduled backups**).
- Zde vidíš seznam denních záloh a můžeš **stáhnout** zálohu (pokud je typ „logical“) nebo **obnovit** projekt na vybraný den.
- Obnova probíhá přes Dashboard; projekt je po dobu obnovy nedostupný.

Pro Free plán automatické zálohy **nejsou** – musíš používat ruční dump (viz výše).

---

## 3. Pravidelná ruční záloha (skript / cron)

Můžeš si naplánovat vlastní zálohy (např. týdně) a ukládat je mimo repo:

1. Ulož connection string do env (ne do gitu), např. v `.env.backup` (a přidej do `.gitignore`):
   ```bash
   # .env.backup (necommituj)
   SUPABASE_DB_URL="postgresql://postgres.[REF]:[PASSWORD]@..."
   ```
2. Skript (příklad), který můžeš spouštět ručně nebo z cronu:
   ```bash
   # scripts/backup-db.sh
   set -e
   source .env.backup  # nebo export SUPABASE_DB_URL=...
   BACKUP_DIR="$HOME/backups/jobi"
   mkdir -p "$BACKUP_DIR"
   DATE=$(date +%Y%m%d-%H%M)
   supabase db dump --db-url "$SUPABASE_DB_URL" -f "$BACKUP_DIR/schema-$DATE.sql"
   supabase db dump --db-url "$SUPABASE_DB_URL" -f "$BACKUP_DIR/data-$DATE.sql" --use-copy --data-only
   ```
3. Zálohy z `BACKUP_DIR` můžeš kopírovat na externí disk nebo do cloudu.

---

## 4. Obnova z ruční zálohy

- **Do nového Supabase projektu:** Vytvoř nový projekt, vezmi jeho connection string a heslo, pak (po přípravě prázdného DB – migrace nebo restore schema) načti data:
  ```bash
  psql "[NEW_CONNECTION_STRING]" --single-transaction -v ON_ERROR_STOP=1 -f backup/schema.sql
  psql "[NEW_CONNECTION_STRING]" -c "SET session_replication_role = replica" -f backup/data.sql
  ```
- Detailní postup včetně rolí a migrací: [Supabase – Backup and Restore using the CLI](https://supabase.com/docs/guides/platform/migrating-within-supabase/backup-restore).

---

## 5. Doporučení pro Jobi

- **Free plán:** Před většími změnami (migrace, hromadné mazání) spusť ruční dump (schema + data) a ulož ho mimo repo. Skript: `scripts/backup-db.sh` (potřebuje `SUPABASE_DB_URL`).
- **Pro plán:** Automatické denní zálohy v Dashboardu (Database → Backups). K tomu můžeš před rizikovou operací udělat navíc ruční dump (viz výše).
- **Storage:** Zálohy DB neobsahují soubory ve Storage – ty je potřeba zálohovat zvlášť, pokud na nich záleží.

Plán: na Free používat ruční zálohy podle potřeby; po přechodu na Pro ($25/měsíc) spoléhat na vestavěné denní zálohy.
