#!/usr/bin/env bash
# Ruční záloha databáze Supabase – stejná sada souborů, jakou dělá denní
# workflow .github/workflows/backup-db.yml. Hodí se před migrací nebo když
# chceš mít kopii u sebe, ne jen v artefaktu GitHubu.
#
# Použití:
#   1. Nastav SUPABASE_DB_URL (connection string s heslem), např.:
#      export SUPABASE_DB_URL="postgresql://postgres.[REF]:[PASSWORD]@aws-0-REGION.pooler.supabase.com:5432/postgres"
#   2. Spusť: bash scripts/backup-db.sh
#   3. Vyzkoušej obnovu: bash scripts/zkouska-obnovy.sh backup/<datum>
#      (bez tohohle kroku nevíš, jestli je záloha k něčemu)
# Zálohy se uloží do backup/ (ta složka je v .gitignore).

set -e
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$PROJECT_ROOT"

if [ -z "${SUPABASE_DB_URL:-}" ]; then
  echo "Chybí SUPABASE_DB_URL. Nastav connection string, např.:"
  echo '  export SUPABASE_DB_URL="postgresql://postgres.[REF]:[PASSWORD]@...pooler.supabase.com:5432/postgres"'
  echo "Viz docs/ZALOHY_DATABAZE.md"
  exit 1
fi

DATE=$(date +%Y%m%d-%H%M)
BACKUP_DIR="$PROJECT_ROOT/backup/$DATE"
mkdir -p "$BACKUP_DIR"

echo "Role..."
supabase db dump --db-url "$SUPABASE_DB_URL" -f "$BACKUP_DIR/roles.sql" --role-only
echo "Schéma..."
supabase db dump --db-url "$SUPABASE_DB_URL" -f "$BACKUP_DIR/schema.sql"
echo "Data..."
supabase db dump --db-url "$SUPABASE_DB_URL" -f "$BACKUP_DIR/data.sql" --use-copy --data-only

# Co dump nebere a bez čeho servis po obnově nefunguje. Podrobnosti proč
# jsou v docs/OBNOVA_ZE_ZALOHY.md.
echo "Seznam souborů ve Storage (samotné soubory v záloze nejsou)..."
psql "$SUPABASE_DB_URL" -At -F ',' -c \
  "select bucket_id, name, coalesce((metadata->>'size')::bigint, 0), created_at from storage.objects order by bucket_id, name" \
  > "$BACKUP_DIR/storage-soubory.csv"
echo "Naplánované úlohy (pg_cron)..."
psql "$SUPABASE_DB_URL" -At -c \
  "select format('select cron.schedule(%L, %L, %L);', jobname, schedule, command) from cron.job where active order by jobid" \
  > "$BACKUP_DIR/cron-ulohy.sql"
echo "Historie migrací..."
psql "$SUPABASE_DB_URL" -At -F ',' -c \
  "select version, name from supabase_migrations.schema_migrations order by version" \
  > "$BACKUP_DIR/migrace.csv"
echo "Názvy tajemství ve Vaultu (hodnoty se nezálohují)..."
psql "$SUPABASE_DB_URL" -At -c "select name from vault.secrets order by name" \
  > "$BACKUP_DIR/vault-nazvy.txt"

echo ""
echo "Hotovo: $BACKUP_DIR"
ls -lh "$BACKUP_DIR"
echo ""
echo "Ověř, že se to dá obnovit:"
echo "  bash scripts/zkouska-obnovy.sh $BACKUP_DIR"
