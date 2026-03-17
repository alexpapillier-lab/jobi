# Migration Diagnostic Scripts

Tyto skripty pomáhají diagnostikovat a řešit problémy s migracemi v Supabase.

## 📋 Skripty

### 1. `check_migration_status.sql`

SQL skript pro diagnostiku stavu migrací v remote databázi.

**Použití:**
1. Otevři Supabase Dashboard → SQL Editor
2. Zkopíruj obsah `check_migration_status.sql`
3. Spusť dotaz

**Co zkontroluje:**
- ✅ Existenci `schema_migrations` tabulky
- ✅ Status problematických migrací (20250102, 20250103)
- ✅ Duplicity verzí
- ✅ Mezery v sekvenci migrací
- ✅ SQL statements z problematických migrací (pokud jsou dostupné)

### 2. `create_placeholder_migrations.sh`

Bash skript pro vytvoření placeholder migrací pro revertnuté verze.

**Použití:**
```bash
cd supabase/scripts
./create_placeholder_migrations.sh
```

**Co dělá:**
- Vytvoří prázdné placeholder migrace pro verze:
  - `20250102000000_placeholder.sql`
  - `20250103000000_placeholder.sql`
  - `20250103000001_placeholder.sql`
  - `20250103000002_placeholder.sql`

**Kdy použít:**
- ✅ Když jsou migrace v remote DB označené jako "reverted"
- ✅ Když migrace byly prázdné/duplicitní
- ✅ Když chceš srovnat historii bez duplikace změn

### 3. `verify_migration_consistency.sh`

Bash skript pro ověření konzistence mezi lokálními soubory a remote DB.

**Použití:**
```bash
cd supabase/scripts
./verify_migration_consistency.sh
```

**Co dělá:**
- Zobrazí všechny lokální migrace
- Upozorní na chybějící migrace
- Zkontroluje git historii
- Navrhne další kroky

## 🔄 Workflow řešení problému

### Krok 1: Diagnostika
```bash
# Spusť SQL skript v Supabase Dashboard
# Nebo lokálně:
psql $DATABASE_URL -f supabase/scripts/check_migration_status.sql
```

### Krok 2: Ověření git historie
```bash
# Zkontroluj, zda migrace existují v git historii
git log --all --oneline -- "supabase/migrations/2025010*.sql"
```

### Krok 3: Rozhodnutí

**Scénář A: Migrace jsou v git historii**
```bash
# Obnov je z historie
git log --all --oneline -- "supabase/migrations/20250102*.sql"
git checkout <commit-hash> -- supabase/migrations/20250102000000_*.sql
# atd.
```

**Scénář B: Migrace nejsou v git historii (revertnuté/prázdné)**
```bash
# Vytvoř placeholdery
./supabase/scripts/create_placeholder_migrations.sh
```

### Krok 4: Synchronizace
```bash
# Commit změny
git add supabase/migrations/
git commit -m "fix: add placeholder migrations for reverted versions"

# Push do remote DB
supabase db push
```

## 📚 Další zdroje

- [Hlavní dokumentace](./../../MIGRACE_ANALYZA_20250102_20250103.md)
- [Supabase CLI docs](https://supabase.com/docs/reference/cli)
- [Migration best practices](https://supabase.com/docs/guides/database/migrations)

