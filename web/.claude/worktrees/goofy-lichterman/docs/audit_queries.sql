-- ============================================
-- AUDIT: Tickets & Service Statuses
-- ============================================
-- Spusť tyto dotazy v Supabase SQL Editoru
-- ============================================

-- 1. OVĚŘENÍ TYPU tickets.status
-- ============================================
SELECT 
  column_name, 
  data_type, 
  character_maximum_length,
  is_nullable,
  column_default
FROM information_schema.columns 
WHERE table_schema = 'public' 
  AND table_name = 'tickets' 
  AND column_name = 'status';

-- Očekávaný výsledek: data_type = 'text' nebo 'character varying'
-- ⚠️ Pokud je 'uuid' nebo 'integer', je to CHYBA - mělo by být text


-- 2. UKÁZKA 3 TICKETŮ
-- ============================================
SELECT 
  id,
  service_id,
  status,
  title,
  created_at,
  updated_at
FROM tickets
ORDER BY created_at DESC
LIMIT 3;

-- Ověř:
-- - status je text (např. "received", "in_progress")
-- - service_id je UUID
-- - status odpovídá nějakému key v service_statuses pro daný service_id


-- 3. OVĚŘENÍ STRUKTURY service_statuses
-- ============================================
SELECT 
  column_name, 
  data_type, 
  is_nullable
FROM information_schema.columns 
WHERE table_schema = 'public' 
  AND table_name = 'service_statuses'
ORDER BY ordinal_position;

-- Ověř, že existuje:
-- - service_id (uuid, NOT NULL)
-- - key (text, NOT NULL)
-- - label (text, NOT NULL)
-- - is_final (boolean)
-- - order_index (integer)


-- 4. OVĚŘENÍ UNIQUE CONSTRAINT na (service_id, key)
-- ============================================
SELECT 
  tc.constraint_name,
  tc.constraint_type,
  kcu.column_name,
  kcu.ordinal_position
FROM information_schema.table_constraints tc
JOIN information_schema.key_column_usage kcu
  ON tc.constraint_name = kcu.constraint_name
  AND tc.table_schema = kcu.table_schema
WHERE tc.table_schema = 'public'
  AND tc.table_name = 'service_statuses'
  AND tc.constraint_type IN ('UNIQUE', 'PRIMARY KEY')
ORDER BY tc.constraint_name, kcu.ordinal_position;

-- Očekávaný výsledek: 
-- - PRIMARY KEY nebo UNIQUE constraint na (service_id, key)
-- - To zajišťuje, že stejný key může existovat v různých servisech


-- 5. OVĚŘENÍ SEEDOVÁNÍ DEFAULT STATUSŮ
-- ============================================
-- Zkontroluj, jestli existuje trigger/funkce pro seedování
SELECT 
  trigger_name,
  event_manipulation,
  event_object_table,
  action_timing,
  action_statement
FROM information_schema.triggers 
WHERE event_object_schema = 'public'
  AND (event_object_table = 'services' OR event_object_table = 'service_statuses')
ORDER BY event_object_table, trigger_name;

-- Zkontroluj funkce pro seedování
SELECT 
  routine_name,
  routine_type,
  routine_definition
FROM information_schema.routines 
WHERE routine_schema = 'public'
  AND (
    routine_name ILIKE '%seed%status%' 
    OR routine_name ILIKE '%default%status%'
    OR routine_name ILIKE '%init%status%'
  );

-- ⚠️ Pokud nic neexistuje, default statusy se možná seedují v Edge Function invite-create


-- 6. OVĚŘENÍ STATUSŮ PER SERVICE
-- ============================================
-- Zkontroluj, jestli různé servisy mají různé statusy
SELECT 
  service_id,
  COUNT(*) as status_count,
  STRING_AGG(key, ', ' ORDER BY order_index) as status_keys
FROM service_statuses
GROUP BY service_id
ORDER BY service_id;

-- Ověř:
-- - Každý service má vlastní statusy
-- - Stejný key může existovat v různých servisech (např. "received" v service A i B)


-- 7. OVĚŘENÍ KOLIZÍ STATUSŮ MEZI SERVISY
-- ============================================
-- Zkontroluj, jestli uživatelské statusy (např. u_marka) jsou správně scoped
SELECT 
  key,
  COUNT(DISTINCT service_id) as service_count,
  STRING_AGG(service_id::text, ', ') as service_ids
FROM service_statuses
WHERE key LIKE 'u_%' OR key NOT IN ('received', 'in_progress', 'completed', 'cancelled')
GROUP BY key
HAVING COUNT(DISTINCT service_id) > 1;

-- Očekávaný výsledek: 
-- - Mělo by být prázdné (žádné kolize)
-- - Pokud jsou výsledky, znamená to, že stejný uživatelský status existuje ve více servisech (což je OK)


-- 8. RLS POLICIES PRO TICKETS
-- ============================================
SELECT 
  schemaname,
  tablename,
  policyname,
  permissive,
  roles,
  cmd,
  qual,
  -- SELECT condition
  with_check  -- INSERT/UPDATE condition
FROM pg_policies 
WHERE schemaname = 'public' 
  AND tablename = 'tickets'
ORDER BY cmd, policyname;

-- ⚠️ KONTROLA:
-- - SELECT policy musí mít `qual` s filtrem podle membershipu
-- - INSERT/UPDATE policy musí mít `with_check` s kontrolou service_id
-- - DELETE policy musí mít `qual` s kontrolou role (owner/admin)
-- - ŽÁDNÁ policy nesmí být bez `qual` nebo `with_check` (to by bylo public)


-- 9. RLS POLICIES PRO service_statuses
-- ============================================
SELECT 
  schemaname,
  tablename,
  policyname,
  permissive,
  roles,
  cmd,
  qual,
  with_check
FROM pg_policies 
WHERE schemaname = 'public' 
  AND tablename = 'service_statuses'
ORDER BY cmd, policyname;

-- ⚠️ KONTROLA:
-- - SELECT policy musí mít `qual` s filtrem podle membershipu
-- - INSERT/UPDATE/DELETE policy musí mít `with_check` s kontrolou role (owner/admin)
-- - ŽÁDNÁ policy nesmí být bez `qual` nebo `with_check`


-- 10. OVĚŘENÍ KONZISTENCE: tickets.status vs service_statuses.key
-- ============================================
-- Najdi tickety, které mají status, který neexistuje v service_statuses pro daný service
SELECT 
  t.id,
  t.service_id,
  t.status,
  t.title,
  CASE 
    WHEN ss.key IS NULL THEN 'CHYBA: Status neexistuje v service_statuses'
    ELSE 'OK'
  END as validation
FROM tickets t
LEFT JOIN service_statuses ss 
  ON t.service_id = ss.service_id 
  AND t.status = ss.key
WHERE ss.key IS NULL
LIMIT 10;

-- Očekávaný výsledek:
-- - Mělo by být prázdné (všechny statusy existují)
-- - Pokud jsou výsledky, znamená to nekonzistenci dat


-- 11. STATISTIKA STATUSŮ V TICKETS
-- ============================================
SELECT 
  t.service_id,
  t.status,
  COUNT(*) as ticket_count
FROM tickets t
GROUP BY t.service_id, t.status
ORDER BY t.service_id, ticket_count DESC;

-- Ověř:
-- - Všechny statusy v tickets odpovídají nějakému key v service_statuses
-- - Žádný ticket nemá status, který neexistuje


-- 12. OVĚŘENÍ DEFAULT STATUSŮ V NOVÝCH SERVISECH
-- ============================================
-- Zkontroluj, jestli všechny servisy mají alespoň základní statusy
SELECT 
  s.id as service_id,
  COUNT(ss.key) as status_count,
  CASE 
    WHEN COUNT(ss.key) = 0 THEN 'CHYBA: Žádné statusy'
    WHEN COUNT(ss.key) < 4 THEN 'VAROVÁNÍ: Málo statusů'
    ELSE 'OK'
  END as validation
FROM services s
LEFT JOIN service_statuses ss ON s.id = ss.service_id
GROUP BY s.id
ORDER BY status_count, s.id;

-- Očekávaný výsledek:
-- - Všechny servisy by měly mít alespoň 4 základní statusy (received, in_progress, completed, cancelled)
-- - Pokud jsou servisy bez statusů, seedování nefunguje






