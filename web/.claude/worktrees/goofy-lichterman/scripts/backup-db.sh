#!/usr/bin/env bash
# Ruční záloha databáze Supabase (schema + data).
# Použití:
#   1. Nastav SUPABASE_DB_URL (connection string s heslem), např.:
#      export SUPABASE_DB_URL="postgresql://postgres.[REF]:[PASSWORD]@aws-0-REGION.pooler.supabase.com:5432/postgres"
#   2. Spusť: bash scripts/backup-db.sh
# Zálohy se uloží do backup/ (ta složka je v .gitignore).

set -e
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$PROJECT_ROOT"

if [ -z "$SUPABASE_DB_URL" ]; then
  echo "Chybí SUPABASE_DB_URL. Nastav connection string, např.:"
  echo '  export SUPABASE_DB_URL="postgresql://postgres.[REF]:[PASSWORD]@...pooler.supabase.com:5432/postgres"'
  echo "Viz docs/ZALOHY_DATABAZE.md"
  exit 1
fi

BACKUP_DIR="$PROJECT_ROOT/backup"
mkdir -p "$BACKUP_DIR"
DATE=$(date +%Y%m%d-%H%M)

echo "Záloha schématu..."
supabase db dump --db-url "$SUPABASE_DB_URL" -f "$BACKUP_DIR/schema-$DATE.sql"
echo "Záloha dat..."
supabase db dump --db-url "$SUPABASE_DB_URL" -f "$BACKUP_DIR/data-$DATE.sql" --use-copy --data-only

echo "Hotovo: $BACKUP_DIR/schema-$DATE.sql, $BACKUP_DIR/data-$DATE.sql"
