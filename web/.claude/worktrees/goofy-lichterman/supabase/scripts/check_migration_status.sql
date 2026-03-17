-- Script: Check migration status for versions 20250102 and 20250103
-- Run this in Supabase SQL Editor to diagnose the issue

-- 1. Check if schema_migrations table exists
SELECT 
  table_schema, 
  table_name,
  'Table exists' as status
FROM information_schema.tables 
WHERE table_name LIKE '%migration%' 
  OR table_name LIKE '%schema%'
ORDER BY table_schema, table_name;

-- 2. Check specific migration versions
SELECT 
  version,
  name,
  inserted_at,
  CASE 
    WHEN statements IS NULL THEN 'No statements stored'
    ELSE 'Statements available'
  END as statements_status,
  array_length(statements, 1) as statement_count
FROM supabase_migrations.schema_migrations 
WHERE version IN (20250102000000, 20250103000000, 20250103000001, 20250103000002)
ORDER BY version;

-- 3. Check all migrations around that time period
SELECT 
  version,
  name,
  inserted_at,
  CASE 
    WHEN version IN (20250102000000, 20250103000000, 20250103000001, 20250103000002) 
    THEN '⚠️ PROBLEMATIC'
    ELSE 'OK'
  END as status
FROM supabase_migrations.schema_migrations 
WHERE version >= 20250101000000 AND version < 20250104000000
ORDER BY version;

-- 4. Check for duplicates
SELECT 
  version, 
  COUNT(*) as count,
  array_agg(name) as names,
  'DUPLICATE' as status
FROM supabase_migrations.schema_migrations
WHERE version IN (20250102000000, 20250103000000, 20250103000001, 20250103000002)
GROUP BY version
HAVING COUNT(*) > 1;

-- 5. Check migration sequence for gaps
WITH ordered AS (
  SELECT 
    version, 
    name,
    LAG(version) OVER (ORDER BY version) as prev_version,
    version - LAG(version) OVER (ORDER BY version) as gap
  FROM supabase_migrations.schema_migrations
  WHERE version >= 20250101000000 AND version < 20250104000000
)
SELECT 
  version,
  name,
  prev_version,
  gap,
  CASE 
    WHEN gap > 1 THEN '⚠️ GAP DETECTED'
    ELSE 'OK'
  END as status
FROM ordered
WHERE prev_version IS NOT NULL
ORDER BY version;

-- 6. Show statements for problematic migrations (if available)
SELECT 
  version,
  name,
  unnest(statements) as statement
FROM supabase_migrations.schema_migrations 
WHERE version IN (20250102000000, 20250103000000, 20250103000001, 20250103000002)
  AND statements IS NOT NULL
ORDER BY version;

