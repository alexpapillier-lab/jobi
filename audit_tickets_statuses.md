# Audit: Tickets & Service Statuses

## 1. Datový model tickets.status

### Ověření typu v DB:
```sql
-- Zkontroluj typ sloupce status v tabulce tickets
\d public.tickets

-- Nebo přímo:
SELECT 
  column_name, 
  data_type, 
  character_maximum_length,
  is_nullable
FROM information_schema.columns 
WHERE table_schema = 'public' 
  AND table_name = 'tickets' 
  AND column_name = 'status';
```

### Očekávaný výsledek:
- `data_type` by měl být `text` nebo `character varying`
- **NE** `uuid` nebo `integer` (to by byla FK)

### Ověření v kódu:
- **Orders.tsx řádek 3428**: `status: (supabaseTicket.status || "received") as any`
- **Orders.tsx řádek 4253**: `status: statusKey` (kde `statusKey` je string z `normalizeStatus("received")`)
- **StatusesStore.tsx řádek 126**: `key: String(s.key)` - statusy mají `key` jako string

### Závěr:
✅ `tickets.status` je **text** a obsahuje `service_statuses.key` (např. "received", "in_progress")

---

## 2. Service_statuses jsou scoped per service

### Ověření v DB:
```sql
-- Zkontroluj strukturu service_statuses
\d public.service_statuses

-- Ověř, že service_id je součástí primary key nebo unique constraint
SELECT 
  constraint_name,
  constraint_type,
  table_name
FROM information_schema.table_constraints 
WHERE table_schema = 'public' 
  AND table_name = 'service_statuses';

-- Zkontroluj, že existuje unique constraint na (service_id, key)
SELECT 
  constraint_name,
  constraint_type
FROM information_schema.table_constraints 
WHERE table_schema = 'public' 
  AND table_name = 'service_statuses'
  AND constraint_type IN ('UNIQUE', 'PRIMARY KEY');
```

### Ověření seedování default statusů:
```sql
-- Zkontroluj, jestli existuje trigger/funkce pro seedování statusů při vytvoření service
SELECT 
  trigger_name,
  event_manipulation,
  event_object_table,
  action_statement
FROM information_schema.triggers 
WHERE event_object_schema = 'public'
  AND event_object_table IN ('services', 'service_statuses');

-- Nebo zkontroluj, jestli existuje funkce pro seedování
SELECT 
  routine_name,
  routine_type
FROM information_schema.routines 
WHERE routine_schema = 'public'
  AND routine_name LIKE '%seed%status%' OR routine_name LIKE '%default%status%';
```

### Ověření v kódu:
- **StatusesStore.tsx řádek 109**: `.eq("service_id", activeServiceId)` - statusy se načítají per service
- **StatusesStore.tsx řádek 189**: `service_id: activeServiceId` - při upsert se ukládá service_id

### Závěr:
✅ Statusy jsou scoped per `service_id`
⚠️ **Potřeba ověřit**: Existuje seedování default statusů při vytvoření service?

---

## 3. UI výběr aktivního service

### Ověření v kódu:

**App.tsx řádek 193-197**: Načítá memberships
```typescript
const { data: memberships, error } = await supabase
  .from("service_memberships")
  .select("service_id, role, created_at")
  .eq("user_id", user.id)
  .order("created_at", { ascending: false });
```

**App.tsx řádek 220**: Fallback na localStorage
```typescript
const lastServiceId = localStorage.getItem(LAST_SERVICE_KEY);
```

**App.tsx řádek 232-253**: Deterministický výběr
- Preferuje `owner` role
- Pak nejnovější podle `created_at`
- Pak podle `service_id` (stabilita)

### Fallback když activeServiceId chybí:
- **Orders.tsx řádek 3513**: Pokud `!activeServiceId`, vrací prázdný seznam tickets
- **StatusesStore.tsx řádek 91**: Pokud `!activeServiceId`, používá cache nebo defaults

### Závěr:
✅ `activeServiceId` se bere z `service_memberships` + localStorage
✅ Fallback: prázdný seznam tickets, default statusy

---

## 4. Načítání a render v Orders

### SQL dotazy které UI provádí:

**Tickets:**
```sql
SELECT id, title, status, notes, created_at, updated_at, service_id
FROM tickets
WHERE service_id = :activeServiceId
ORDER BY created_at DESC;
```

**Statuses:**
```sql
SELECT key, label, bg, fg, is_final, order_index
FROM service_statuses
WHERE service_id = :activeServiceId
ORDER BY order_index ASC;
```

### Mapování statusu na sloupečky:

**Orders.tsx řádek 4502**: 
```typescript
const raw = statusById[t.id] ?? (t.status as any);
const currentStatus = normalizeStatus(raw);
const meta = getByKey(currentStatus);
```

**Orders.tsx řádek 3725-3730**: Normalizace
```typescript
const normalizeStatus = useCallback(
  (key: string) => {
    return statusKeysSet.has(key) ? key : fallbackKey;
  },
  [statusKeysSet, fallbackKey]
);
```

**Orders.tsx řádek 3164**: Zobrazení podle `key`
```typescript
const current = getByKey(value);  // getByKey hledá podle key, ne label
```

### Co se stane když ticket má neexistující status:

**Orders.tsx řádek 3727**: 
- Pokud `statusKeysSet.has(key)` je `false` → použije se `fallbackKey` ("received")
- **Nerozbije to stránku** - jen se zobrazí jako "received"

### Závěr:
✅ Mapuje podle `key`, ne `label`
✅ Neexistující status → fallback na "received"
✅ UI se nerozbije

---

## 5. RLS/Policies sanity check

### Ověření policies pro tickets:
```sql
-- Zkontroluj všechny policies pro tickets
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
  AND tablename = 'tickets';
```

### Očekávané policies:
- **SELECT**: Pouze pro členy daného service (`service_id IN (SELECT service_id FROM service_memberships WHERE user_id = auth.uid())`)
- **INSERT**: `WITH CHECK service_id IN (SELECT service_id FROM service_memberships WHERE user_id = auth.uid() AND role IN ('owner', 'admin', 'member'))`
- **UPDATE**: Stejné jako INSERT
- **DELETE**: Pouze pro owner/admin

### Ověření policies pro service_statuses:
```sql
-- Zkontroluj všechny policies pro service_statuses
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
  AND tablename = 'service_statuses';
```

### Očekávané policies:
- **SELECT**: Pouze pro členy daného service
- **INSERT/UPDATE**: Pouze pro owner/admin daného service
- **DELETE**: Pouze pro owner/admin daného service

### ⚠️ Kritické kontroly:
1. **Žádná policy nesmí být `public`** (bez `WITH CHECK`)
2. **Všechny INSERT/UPDATE musí mít `WITH CHECK`** s kontrolou `service_id`
3. **SELECT musí mít `qual`** s filtrem podle membershipu

---

## 6. Ukázka dat z DB

### 3 ukázkové tickety:
```sql
SELECT 
  id,
  service_id,
  status,
  title,
  created_at
FROM tickets
ORDER BY created_at DESC
LIMIT 3;
```

### Očekávaný formát:
```
id: uuid
service_id: uuid
status: text (např. "received", "in_progress", "completed")
title: text
created_at: timestamp
```

---

## 7. Relevantní kód z Orders

### Načítání tickets (řádek 3524-3528):
```typescript
const { data, error } = await supabase
  .from("tickets")
  .select("id, title, status, notes, created_at, updated_at, service_id")
  .eq("service_id", activeServiceId)
  .order("created_at", { ascending: false });
```

### Načítání statuses (StatusesStore.tsx řádek 106-110):
```typescript
const { data, error } = await supabase
  .from("service_statuses")
  .select("key, label, bg, fg, is_final, order_index")
  .eq("service_id", activeServiceId)
  .order("order_index", { ascending: true });
```

### Mapování do sloupců (řádek 4500-4504):
```typescript
const raw = statusById[t.id] ?? (t.status as any);
const currentStatus = normalizeStatus(raw);  // Normalizuje proti statusKeysSet
const meta = getByKey(currentStatus);  // Najde StatusMeta podle key
// meta.label se pak použije pro zobrazení
```

---

## Shrnutí zjištění z kódu:

✅ **tickets.status je TEXT** - obsahuje `service_statuses.key`
✅ **Statusy jsou scoped per service_id**
✅ **activeServiceId se bere z membershipu + localStorage**
✅ **Tickets se filtrují podle service_id**
✅ **Status se mapuje podle `key`, ne `label`**
✅ **Neexistující status → fallback na "received"**

⚠️ **Potřeba ověřit v DB:**
1. Typ sloupce `tickets.status` (mělo by být `text`)
2. Existence seedování default statusů při vytvoření service
3. RLS policies pro tickets a service_statuses (WITH CHECK)
4. Ukázka 3 ticketů z DB






