# Debug Checklist: Tickets & Statuses Loading

## Přidané logy

### A) App.tsx
- `[App] Loading memberships for user.id: <id>`
- `[App] Memberships service_ids: [<ids>]`
- `[App] localStorage lastServiceId: <id>`
- `[App] Using serviceId from localStorage: <id>` nebo `[App] localStorage serviceId not in memberships, ignoring`
- `[App] Using first owner service: <id>` nebo `[App] Using first membership service: <id>`
- `[App] Final activeServiceId: <id> source: <localStorage|owner_first|first_membership>`

### B) Orders.tsx
- `[Orders] activeServiceId changed: <id>`
- `[Orders] No activeServiceId or supabase, clearing tickets`
- `[Orders] fetch tickets start, activeServiceId: <id>`
- `[Orders] tickets <count> error <error>`
- `[Orders] firstTicket <ticket>`

### C) StatusesStore.tsx
- `[Statuses] activeServiceId: <id>`
- `[Statuses] statuses <count> error <error>`
- `[Statuses] keys [<keys>]`
- `[Statuses] Using cached statuses: <count>` (pokud fallback)
- `[Statuses] Using default statuses` (pokud fallback)

## Co zkontrolovat v konzoli

### 1. Timing activeServiceId
```
[App] Loading memberships for user.id: <id>
[App] Memberships service_ids: [<id1>, <id2>, ...]
[App] Final activeServiceId: <id> source: <source>
```

**Očekávané:**
- `activeServiceId` se nastaví PO načtení memberships
- `source` by měl být jeden z: `localStorage`, `owner_first`, `first_membership`

### 2. Timing Orders fetch
```
[Orders] activeServiceId changed: <id>
[Orders] fetch tickets start, activeServiceId: <id>
[Orders] tickets <count> error <null>
[Orders] firstTicket <ticket>
```

**Očekávané:**
- Fetch se spustí PO nastavení `activeServiceId`
- `activeServiceId` v fetchu odpovídá finálnímu `activeServiceId` z App
- `error` by měl být `null`

### 3. Timing Statuses fetch
```
[Statuses] activeServiceId: <id>
[Statuses] statuses <count> error <null>
[Statuses] keys [<key1>, <key2>, ...]
```

**Očekávané:**
- Statuses se načtou PO nastavení `activeServiceId`
- `activeServiceId` v fetchu odpovídá finálnímu `activeServiceId` z App
- `keys` obsahuje alespoň `["received"]`

### 4. Guard pro prázdný statusKeysSet
- Pokud `statusesReady === false`, UI zobrazí "Načítání statusů..."
- List/Grid se nerenderuje, dokud `statusesReady === true`

## Možné problémy a řešení

### Problém 1: activeServiceId je null
**Příznaky:**
- `[App] Final activeServiceId: null`
- `[Orders] No activeServiceId or supabase, clearing tickets`

**Možné příčiny:**
- Uživatel nemá žádné memberships
- Chyba při načítání memberships

**Řešení:**
- Ověř, že uživatel má membership v `service_memberships`
- Zkontroluj error v `[App] Error loading memberships`

### Problém 2: activeServiceId se nastaví, ale Orders nefetchuje
**Příznaky:**
- `[App] Final activeServiceId: <id>`
- `[Orders] activeServiceId changed: <id>` se NEZOBRAZÍ

**Možné příčiny:**
- `useEffect` dependency chybí `activeServiceId
- Orders se nemonitoruje změny `activeServiceId`

**Řešení:**
- Ověř, že `useEffect` má `[activeServiceId]` v dependencies

### Problém 3: Statuses se nenačtou
**Příznaky:**
- `[Statuses] statuses 0 error null`
- `[Statuses] keys []`
- UI zobrazuje "Načítání statusů..." donekonečna

**Možné příčiny:**
- V DB nejsou statusy pro daný `service_id`
- Chyba při fetchu (ale error je null)

**Řešení:**
- Ověř v DB: `SELECT * FROM service_statuses WHERE service_id = '<activeServiceId>'`
- Pokud prázdné, seeduj default statusy

### Problém 4: Tickets se nenačtou
**Příznaky:**
- `[Orders] tickets 0 error null`
- UI zobrazuje prázdný seznam

**Možné příčiny:**
- V DB nejsou tickety pro daný `service_id`
- RLS blokuje SELECT

**Řešení:**
- Ověř v DB: `SELECT * FROM tickets WHERE service_id = '<activeServiceId>'`
- Zkontroluj RLS policies

### Problém 5: Statusy se načtou, ale UI je stále "Načítání statusů..."
**Příznaky:**
- `[Statuses] statuses <count> error null`
- `[Statuses] keys [<keys>]`
- UI stále zobrazuje "Načítání statusů..."

**Možné příčiny:**
- `statusesReady` se neaktualizuje
- `statusKeysSet` je prázdný i když `statuses` má hodnoty

**Řešení:**
- Ověř, že `statusKeysSet` se aktualizuje při změně `statuses`
- Přidej log: `console.log("[Orders] statusesReady", statusesReady, "statusKeysSet.size", statusKeysSet.size)`

## Reprodukční checklist

Po spuštění aplikace zkontroluj v konzoli:

### Krok 1: Přihlášení
- [ ] `[App] Loading memberships for user.id: <id>` se zobrazí
- [ ] `[App] Memberships service_ids: [<ids>]` obsahuje alespoň jeden ID
- [ ] `[App] Final activeServiceId: <id>` se zobrazí s validním UUID

### Krok 2: Načítání statusů
- [ ] `[Statuses] activeServiceId: <id>` odpovídá finálnímu `activeServiceId` z App
- [ ] `[Statuses] statuses <count> error null` kde `count > 0`
- [ ] `[Statuses] keys [<keys>]` obsahuje alespoň `["received"]`

### Krok 3: Načítání tickets
- [ ] `[Orders] activeServiceId changed: <id>` se zobrazí
- [ ] `[Orders] fetch tickets start, activeServiceId: <id>` odpovídá finálnímu `activeServiceId`
- [ ] `[Orders] tickets <count> error null` (count může být 0, pokud nejsou tickety)
- [ ] `[Orders] firstTicket <ticket>` se zobrazí (pokud count > 0)

### Krok 4: Render UI
- [ ] UI NEOBRAZUJE "Načítání statusů..." (pokud statusesReady === true)
- [ ] List/Grid se renderuje (pokud statusesReady === true)
- [ ] Tickets se zobrazují s correct statusy

## Co mi máš poslat

1. **Log výstupy z konzole:**
   - Zkopíruj všechny logy začínající `[App]`, `[Orders]`, `[Statuses]`
   - Od přihlášení až po načtení tickets

2. **Hodnoty:**
   - `activeServiceId` (finální hodnota z `[App] Final activeServiceId`)
   - `tickets count` (z `[Orders] tickets <count>`)
   - `tickets error` (z `[Orders] tickets ... error <error>`)
   - `statuses count` (z `[Statuses] statuses <count>`)
   - `statuses error` (z `[Statuses] statuses ... error <error>`)
   - `statuses keys` (z `[Statuses] keys [<keys>]`)

3. **Stručný popis:**
   - "Co přesně nefungovalo" (např. "Tickets se nenačetly", "Statusy se nenačetly", "UI zobrazuje loading donekonečna")
   - "Po fixu co se změnilo" (pokud už jsi něco opravil)






