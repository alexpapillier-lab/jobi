#!/bin/bash
# Script: Create placeholder migrations for reverted versions
# Usage: ./create_placeholder_migrations.sh

set -e

MIGRATIONS_DIR="supabase/migrations"

# Versions that need placeholders
VERSIONS=(
  "20250102000000"
  "20250103000000"
  "20250103000001"
  "20250103000002"
)

echo "Creating placeholder migrations for reverted versions..."

for version in "${VERSIONS[@]}"; do
  filename="${MIGRATIONS_DIR}/${version}_placeholder.sql"
  
  if [ -f "$filename" ]; then
    echo "⚠️  File already exists: $filename"
    read -p "Overwrite? (y/N): " -n 1 -r
    echo
    if [[ ! $REPLY =~ ^[Yy]$ ]]; then
      echo "Skipping $filename"
      continue
    fi
  fi
  
  cat > "$filename" << EOF
-- Migration placeholder: ${version}
-- This migration was marked as reverted in remote database
-- 
-- Status: REVERTED
-- Created: $(date -u +"%Y-%m-%d %H:%M:%S UTC")
-- 
-- This placeholder exists to maintain migration history consistency
-- between local repository and remote database.
-- 
-- No SQL changes are needed as:
-- 1. The migration was already applied and then reverted (metadata only)
-- 2. The changes from this migration are duplicates of other migrations
-- 3. The migration was empty/invalid
--
-- If you need to restore the original migration content, check:
-- - Git history: git log --all -- "supabase/migrations/${version}_*.sql"
-- - Remote DB: SELECT statements FROM supabase_migrations.schema_migrations WHERE version = ${version};

-- Empty migration (placeholder only)
SELECT 1;
EOF
  
  echo "✅ Created: $filename"
done

echo ""
echo "Done! Next steps:"
echo "1. Review the placeholder files"
echo "2. If you have the original migration content, replace the placeholder"
echo "3. Commit the changes: git add ${MIGRATIONS_DIR}/ && git commit -m 'fix: add placeholder migrations for reverted versions'"
echo "4. Push to remote: supabase db push"

