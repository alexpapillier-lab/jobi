#!/bin/bash
# Script: Verify migration consistency between local files and remote DB
# Usage: ./verify_migration_consistency.sh

set -e

MIGRATIONS_DIR="supabase/migrations"

echo "🔍 Checking migration consistency..."
echo ""

# Get all local migration files
echo "📁 Local migrations:"
local_versions=$(ls -1 "${MIGRATIONS_DIR}"/*.sql 2>/dev/null | xargs -n1 basename | sed 's/_.*//' | sort -n)
echo "$local_versions" | while read version; do
  if [ -n "$version" ]; then
    echo "  ✅ $version"
  fi
done

echo ""
echo "⚠️  Missing migrations (check in remote DB):"
echo "  - 20250102000000"
echo "  - 20250103000000"
echo "  - 20250103000001"
echo "  - 20250103000002"
echo ""

echo "📋 Next steps:"
echo "1. Run check_migration_status.sql in Supabase SQL Editor"
echo "2. Check git history: git log --all -- 'supabase/migrations/2025010*.sql'"
echo "3. If migrations are reverted/empty, run: ./create_placeholder_migrations.sh"
echo "4. If migrations contain important changes, restore from git history"
echo ""

# Check if problematic versions exist in git history
echo "🔍 Checking git history..."
if git log --all --oneline -- "supabase/migrations/20250102*.sql" "supabase/migrations/20250103*.sql" 2>/dev/null | head -1; then
  echo "✅ Found in git history! You can restore them with:"
  echo "   git log --all --oneline -- 'supabase/migrations/2025010*.sql'"
else
  echo "❌ Not found in git history"
  echo "   These migrations were likely created directly in remote DB or were deleted"
fi

