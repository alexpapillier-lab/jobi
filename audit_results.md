# Výsledky auditu: Tickets & Service Statuses

## 1. Datový model tickets.status

### ✅ ZJIŠTĚNÍ Z KÓDU:

**Typ:** `tickets.status` je **TEXT** (ne FK)

**Důkazy:**
- `Orders.tsx:3428`: `status: (supabaseTicket.status || "received") as any` - castuje na string
- `Orders.tsx:4253`: `status: statusKey` - kde `statusKey` je string z `normalizeStatus("received")`
- `StatusesStore.tsx:126`: `key: String(s.key)` - statusy mají `key` jako string

**Vztah:** `tickets.status == service_statuses.key` (text match)

**⚠️ POTŘEBA OVĚŘIT V DB:**
```sql
SELECT data_type FROM information_schema.columns 
WHERE table_name = 'tickets' AND column_name = 'status';
-- Mělo by být: text nebo character varying
```

---

## 2. Service_statuses jsou scoped per service

### ✅ ZJIŠTĚNÍ Z KÓDU:

**Scoping:** Statusy jsou per `service_id`

**Důkazy:**
- `StatusesStore.tsx:109`: `.eq("service_id", activeServiceId)` - načítá jen pro aktivní service
- `StatusesStore.tsx:189`: `service_id: activeServiceId` - při upsert se ukládá service_id

**Ukládání uživatelských statusů:**
- `StatusesStore.tsx:187`: `upsert` s `onConflict: "service_id,key"` - zajišťuje, že stejný key může existovat v různých servisech

**⚠️ POTŘEBA OVĚŘIT V DB:**
1. Existuje UNIQUE constraint na `(service_id, key)`?
2. Existuje seedování default statusů při vytvoření service?

```sql
-- Ověř UNIQUE constraint
SELECT constraint_name FROM information_schema.table_constraints 
WHERE table_name = 'service_statuses' AND constraint_type = 'UNIQUE';

-- Ověř seedování
SELECT routine_name FROM information_schema.routines 
WHERE routine_name ILIKE '%seed%status%';
```

---

## 3. UI výběr aktivního service

### ✅ ZJIŠTĚNÍ Z KÓDU:

**Odkud bere activeServiceId:**

1. **Z membershipu** (`App.tsx:193-197`):
   ```typescript
   const { data: memberships } = await supabase
     .from("service_memberships")
     .select("service_id, role, created_at")
     .eq("user_id", user.id)
   ```

2. **Z localStorage** (`App.tsx:220`):
   ```typescript
   const lastServiceId = localStorage.getItem(LAST_SERVICE_KEY);
   ```

3. **Deterministický výběr** (`App.tsx:232-253`):
   - Preferuje `owner` role
   - Pak nejnovější podle `created_at`
   - Pak podle `service_id` (stabilita)

**Fallback když activeServiceId chybí:**
- `Orders.tsx:3513`: Pokud `!activeServiceId`, vrací prázdný seznam tickets
- `StatusesStore.tsx:91`: Pokud `!activeServiceId`, používá cache nebo defaults

**✅ VÝSLEDEK:** Správně - bere z membershipu, fallback na localStorage, deterministický výběr

---

## 4. Načítání a render v Orders

### ✅ SQL DOTAZY KTERÉ UI PROVÁDÍ:

**Tickets** (`Orders.tsx:3524-3528`):
```typescript
supabase
  .from("tickets")
  .select("id, title, status, notes, created_at, updated_at, service_id")
  .eq("service_id", activeServiceId)  // ← Filtruje podle service_id
  .order("created_at", { ascending: false });
```

**Statuses** (`StatusesStore.tsx:106-110`):
```typescript
supabase
  .from("service_statuses")
  .select("key, label, bg, fg, is_final, order_index")
  .eq("service_id", activeServiceId)  // ← Filtruje podle service_id
  .order("order_index", { ascending: true });
```

### ✅ MAPOVÁNÍ STATUSU NA SLOUPEČKY:

**Podle `key`, ne `label`:**

1. **Normalizace** (`Orders.tsx:3725-3730`):
   ```typescript
   const normalizeStatus = (key: string) => {
     return statusKeysSet.has(key) ? key : fallbackKey;
   };
   ```

2. **Zobrazení** (`Orders.tsx:4502-4503`):
   ```typescript
   const raw = statusById[t.id] ?? (t.status as any);
   const currentStatus = normalizeStatus(raw);
   const meta = getByKey(currentStatus);  // ← Hledá podle key
   ```

3. **StatusPicker** (`Orders.tsx:3164`):
   ```typescript
   const current = getByKey(value);  // ← Hledá podle key
   ```

**✅ VÝSLEDEK:** Mapuje podle `key`, ne `label` - SPRÁVNĚ

### ✅ CO SE STANE KDYŽ TICKET MÁ NEEXISTUJÍCÍ STATUS:

**Fallback mechanismus** (`Orders.tsx:3727`):
- Pokud `statusKeysSet.has(key)` je `false` → použije se `fallbackKey` ("received")
- **Nerozbije to stránku** - jen se zobrazí jako "received"

**⚠️ POTŘEBA OVĚŘIT V DB:**
```sql
-- Najdi tickety s neexistujícím statusem
SELECT t.id, t.service_id, t.status
FROM tickets t
LEFT JOIN service_statuses ss 
  ON t.service_id = ss.service_id AND t.status = ss.key
WHERE ss.key IS NULL;
```

---

## 5. Relevantní kód z Orders

### Načítání tickets:
```typescript
// Orders.tsx:3524-3528
const { data, error } = await supabase
  .from("tickets")
  .select("id, title, status, notes, created_at, updated_at, service_id")
  .eq("service_id", activeServiceId)
  .order("created_at", { ascending: false });
```

### Načítání statuses:
```typescript
// StatusesStore.tsx:106-110
const { data, error } = await supabase
  .from("service_statuses")
  .select("key, label, bg, fg, is_final, order_index")
  .eq("service_id", activeServiceId)
  .order("order_index", { ascending: true });
```

### Mapování do sloupců:
```typescript
// Orders.tsx:4500-4504
const raw = statusById[t.id] ?? (t.status as any);
const currentStatus = normalizeStatus(raw);  // Normalizuje proti statusKeysSet
const meta = getByKey(currentStatus);  // Najde StatusMeta podle key
// meta.label se pak použije pro zobrazení v UI
```

---

## 6. RLS/Policies sanity check

### ⚠️ POTŘEBA OVĚŘIT V DB:

**Pro tickets:**
```sql
SELECT policyname, cmd, qual, with_check
FROM pg_policies 
WHERE tablename = 'tickets';
```

**Kontrola:**
- ✅ SELECT policy má `qual` s filtrem podle membershipu
- ✅ INSERT/UPDATE policy má `with_check` s kontrolou `service_id`
- ✅ DELETE policy má `qual` s kontrolou role (owner/admin)
- ❌ ŽÁDNÁ policy nesmí být bez `qual` nebo `with_check` (to by bylo public)

**Pro service_statuses:**
```sql
SELECT policyname, cmd, qual, with_check
FROM pg_policies 
WHERE tablename = 'service_statuses';
```

**Kontrola:**
- ✅ SELECT policy má `qual` s filtrem podle membershipu
- ✅ INSERT/UPDATE/DELETE policy má `with_check` s kontrolou role (owner/admin)
- ❌ ŽÁDNÁ policy nesmí být bez `qual` nebo `with_check`

---

## Shrnutí zjištění z kódu:

### ✅ SPRÁVNĚ:
1. `tickets.status` je TEXT a obsahuje `service_statuses.key`
2. Statusy jsou scoped per `service_id`
3. `activeServiceId` se bere z membershipu + localStorage
4. Tickets se filtrují podle `service_id`
5. Status se mapuje podle `key`, ne `label`
6. Neexistující status → fallback na "received"
7. UI se nerozbije při neexistujícím statusu

### ⚠️ POTŘEBA OVĚŘIT V DB:
1. Typ sloupce `tickets.status` (mělo by být `text`)
2. Existence UNIQUE constraint na `(service_id, key)` v `service_statuses`
3. Existence seedování default statusů při vytvoření service
4. RLS policies pro tickets a service_statuses (WITH CHECK)
5. Ukázka 3 ticketů z DB (id, service_id, status, title)
6. Konzistence: všechny `tickets.status` existují v `service_statuses` pro daný `service_id`

---

## SQL dotazy pro audit:

Všechny SQL dotazy jsou v souboru `audit_queries.sql` - spusť je v Supabase SQL Editoru.






