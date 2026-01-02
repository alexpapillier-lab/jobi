# Redundant Code Audit

## A) Dvojité filtry / redundantní guardy (Realtime, DB, UI)

### 1. Filtrování service_id

**Kde filtrujeme service_id víckrát:**

#### a) Realtime subscription + handler (ODSTRANĚNO)
- **Location:** `src/pages/Orders.tsx:3846` (subscription filter) + ~~3852-3856~~ (handler guard - **ODSTRANĚNO**)
- **Pattern:** Subscription má `filter: service_id=eq.${activeServiceId}`, handler měl guard kontrolující stejné
- **Status:** ✅ **OPRAVENO** - guard byl odstraněn v předchozím commitu

#### b) DB query + UI filtering
- **Location:** `src/pages/Orders.tsx:3795` (DB query `.eq("service_id", activeServiceId)`)
- **Pattern:** Query filtruje na DB level, ale UI by mělo být už filtrované
- **Why redundant:** DB query už vrací jen tickets pro daný service_id
- **Risk:** Nízký - DB filter je správný, UI by nemělo potřebovat další filtr
- **Recommended action:** **KEEP** - DB filter je správný a nutný pro bezpečnost

### 2. Filtrování deleted_at

**Kde filtrujeme deleted_at víckrát:**

#### a) DB query + Realtime handler
- **Location:** 
  - `src/pages/Orders.tsx:3796` - DB query `.is("deleted_at", null)`
  - `src/pages/Orders.tsx:3860-3913` - Realtime handler kontroluje `wasDeleted` a `isDeleted`
- **Pattern:** DB query vyloučí deleted tickets, ale Realtime handler je musí zpracovat (pro restore)
- **Why redundant:** DB query filtruje deleted, ale Realtime handler musí zpracovat všechny eventy (včetně soft-delete pro restore)
- **Risk:** Nízký - Realtime handler musí vidět i deleted tickets pro správné zpracování restore
- **Recommended action:** **KEEP** - Realtime handler potřebuje vidět deleted_at změny pro restore logiku

#### b) DB query v Customers.tsx
- **Location:** `src/pages/Customers.tsx:218, 282, 351` - `.is("deleted_at", null)`
- **Pattern:** Všechny queries filtrují deleted_at
- **Why redundant:** Není redundantní - každý query musí filtrovat
- **Risk:** Žádný
- **Recommended action:** **KEEP** - správné filtrování

### 3. Defense-in-depth guardy

**Kde máme "defense-in-depth", který už reálně nic nechrání:**

#### a) ~~Realtime service_id guard~~ (ODSTRANĚNO)
- **Location:** ~~`src/pages/Orders.tsx:3852-3856`~~ - **ODSTRANĚNO**
- **Status:** ✅ **OPRAVENO**

---

## B) Shadow state (duplicitní zdroj pravdy)

### 1. statusById vs ticket.status

**Location:** `src/pages/Orders.tsx:3942, 4482-4509`

**Pattern:**
- `statusById` - Record<string, string> - optimistic update state
- `ticket.status` - skutečný status z DB/Realtime

**Source of truth:**
- **Primary:** `ticket.status` (z DB/Realtime) - ✅ **OPRAVENO** - nyní má prioritu
- **Secondary:** `statusById` (optimistic update cache)

**Synchronizace:**
- ✅ **OPRAVENO** - Priorita změněna na `(t.status as any) ?? statusById[t.id]` (řádky 4138, 4151, 4993, 6129, 6158)
- `statusById` se aktualizuje při optimistic update (řádek 4483)
- `statusById` se rollbackuje při chybě (řádek 4500-4508)

**Problém:**
- `statusById` se inicializuje jen jednou (řádek 3982-3987) - guard `if (Object.keys(prev).length) return prev` zabraňuje aktualizaci
- Při Realtime UPDATE se `ticket.status` aktualizuje, ale `statusById` zůstává starý
- **ŘEŠENÍ:** Priorita změněna - `ticket.status` má přednost

**Recommended action:** **KEEP** - `statusById` je užitečný pro optimistic updates, ale nyní má správnou prioritu

**Test:** Otevřít 2 okna, změnit status v jednom, ověřit že se zobrazí v druhém

### 2. detailedTicket vs cloudTickets

**Location:** `src/pages/Orders.tsx:4168-4174`

**Pattern:**
- `detailedTicket` - odvozený z `cloudTickets.find(t => t.id === detailId)`
- `originalTicketRef` - snapshot pro rollback

**Source of truth:**
- **Primary:** `cloudTickets` (z DB/Realtime)
- **Derived:** `detailedTicket` je computed z `cloudTickets`

**Synchronizace:**
- `detailedTicket` se přepočítá při změně `detailId` nebo `cloudTickets` (řádek 4165-4174)
- `originalTicketRef` se nastaví při otevření detailu (řádek 4168)

**Risk:** Nízký - `detailedTicket` je odvozený, ne shadow state

**Recommended action:** **KEEP** - správně implementováno jako derived state

---

## C) Jednorázové inicializace, které časem zastarají

### 1. statusById inicializace

**Location:** `src/pages/Orders.tsx:3981-3989`

**Pattern:**
```typescript
useEffect(() => {
  setStatusById((prev) => {
    if (Object.keys(prev).length) return prev; // ← Guard zabraňuje aktualizaci
    const init: Record<string, string> = {};
    for (const t of tickets) init[t.id] = t.status as any;
    return init;
  });
}, [tickets]);
```

**Problém:**
- Guard `if (Object.keys(prev).length) return prev` zajišťuje, že se inicializuje jen jednou
- Pokud se `tickets` změní (nový ticket, update), `statusById` se neaktualizuje
- **ALE:** Nyní máme prioritu `ticket.status` před `statusById`, takže to není kritické

**Why redundant/risk:**
- Guard zabraňuje synchronizaci při změnách tickets
- Při Realtime UPDATE se `ticket.status` aktualizuje, ale `statusById` zůstává starý
- **ŘEŠENÍ:** Priorita změněna - `ticket.status` má přednost, takže guard není kritický

**Recommended action:** **CONSIDER REFACTOR** - Můžeme odstranit guard a aktualizovat `statusById` při změnách tickets, nebo úplně odstranit `statusById` a používat jen `ticket.status` (ale pak ztratíme optimistic updates)

**Test:** Otevřít 2 okna, změnit status v jednom, ověřit že se zobrazí v druhém (již testováno - funguje díky prioritě)

### 2. StatusesStore localStorage sync

**Location:** `src/state/StatusesStore.tsx:156-158`

**Pattern:**
```typescript
useEffect(() => {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(statuses));
}, [statuses]);
```

**Problém:**
- Ukládá statuses do localStorage při každé změně
- Ale statuses se načítají z DB, ne z localStorage (řádek 68-95)
- localStorage je jen cache, ne source of truth

**Why redundant/risk:**
- Nízký risk - localStorage je jen cache
- Ale může způsobit konflikt, pokud localStorage má staré data

**Recommended action:** **CONSIDER REMOVE** - localStorage sync není potřeba, protože statuses se načítají z DB. Můžeme odstranit, nebo použít jen jako fallback při offline.

**Test:** Vymazat localStorage, ověřit že statuses se načtou z DB

---

## D) Fallbacky, mocky, dočasné hacky

### 1. Mock tickets

**Location:** `src/mock/tickets.ts`

**Pattern:**
- `MOCK_TICKETS` - mock data pro development/testing
- `type Ticket` - type definition

**Usage:**
- `src/pages/Statistics.tsx:3` - importuje `MOCK_TICKETS` a používá jako fallback v `safeLoadTickets()`
- `src/pages/Orders.tsx:3` - importuje `type Ticket` pro type definitions

**Status:** **KEEP (defer)**

**Reason:**
- Používá se v `src/pages/Statistics.tsx` jako fallback data
- Modul obsahuje i `type Ticket`, který importuje `Orders.tsx`

**Recommended action:** **KEEP (defer to final stage)**

**Note:** Refactor/remove až po dokončení Statistics (poslední úkol buildu).

### 2. "as any" workaroundy

**Location:** Různé místa v kódu

**Pattern:**
- `(t.status as any)` - type assertion
- `(supabase as any).rpc(...)` - type assertion
- `(payload.new as any)` - type assertion

**Why redundant/risk:**
- Type assertions obcházejí TypeScript type checking
- Může skrývat skutečné type errors
- Ale někdy je to nutné kvůli neúplným type definitions

**Recommended action:** **REVIEW EACH CASE** - Projít každé `as any` a zjistit, jestli je to nutné, nebo můžeme opravit typy.

**Test:** Zkusit odstranit `as any` a opravit typy

### 3. Fallback status "received"

**Location:** `src/state/StatusesStore.tsx:25`

**Pattern:**
```typescript
const FALLBACK_KEY = "received";
```

**Usage:**
- Používá se v `normalizeStatus` (řádek 3725-3730 v Orders.tsx)
- Pokud status neexistuje v `statusKeysSet`, použije se fallback

**Why redundant:**
- Není redundantní - je to správný fallback pro neplatné statusy
- Chrání před chybami, pokud DB má neplatný status

**Recommended action:** **KEEP** - Správný fallback mechanismus

### 4. Default statuses initialization

**Location:** `src/state/StatusesStore.tsx:98-100`

**Pattern:**
- Edge Function `statuses-init-defaults` se volá, pokud DB nemá statusy
- Inicializuje defaultní statusy pro service

**Why redundant:**
- Není redundantní - je to správná inicializace
- Zajišťuje, že každý service má alespoň základní statusy

**Recommended action:** **KEEP** - Správná inicializace

---

## E) Přehled výsledků (tabulka)

| Location (file:line) | Pattern | Why redundant / risk | Recommended action | Test to run after change |
|----------------------|---------|----------------------|-------------------|-------------------------|
| `src/pages/Orders.tsx:3846` | Subscription filter `service_id=eq.${activeServiceId}` | Není redundantní - nutný pro bezpečnost | **KEEP** | Otevřít 2 okna s různými service_id, ověřit že se nezobrazí cizí tickets |
| `src/pages/Orders.tsx:3796` | DB query `.is("deleted_at", null)` | Není redundantní - nutný pro vyloučení deleted | **KEEP** | Otevřít deleted ticket, ověřit že se nezobrazí |
| `src/pages/Orders.tsx:3860-3913` | Realtime handler `wasDeleted`/`isDeleted` check | Není redundantní - potřebné pro restore logiku | **KEEP** | Soft-delete ticket, pak restore, ověřit že se zobrazí |
| `src/pages/Orders.tsx:3981-3989` | `statusById` init guard `if (Object.keys(prev).length) return prev` | Guard zabraňuje aktualizaci při změnách tickets | **CONSIDER REFACTOR** - Odstranit guard nebo úplně odstranit `statusById` | Otevřít 2 okna, změnit status, ověřit sync (již funguje díky prioritě) |
| `src/pages/Orders.tsx:3942, 4482-4509` | `statusById` vs `ticket.status` shadow state | ✅ **OPRAVENO** - priorita změněna na `ticket.status` | **KEEP** - správně implementováno | Otevřít 2 okna, změnit status, ověřit sync |
| `src/state/StatusesStore.tsx:156-158` | localStorage sync pro statuses | Není potřeba - statuses se načítají z DB | **CONSIDER REMOVE** - localStorage není source of truth | Vymazat localStorage, ověřit že statuses se načtou z DB |
| `src/mock/tickets.ts` | Mock tickets data + type Ticket | Používá Statistics.tsx (fallback) + Orders.tsx (type) | Používá se jako fallback a type source | **KEEP (defer to final stage)** - Refactor až po dokončení Statistics |
| Různé místa | `as any` type assertions | Obcházejí TypeScript type checking | **REVIEW EACH CASE** | Zkusit odstranit a opravit typy |
| `src/state/StatusesStore.tsx:25` | Fallback status "received" | Správný fallback mechanismus | **KEEP** | Vytvořit ticket s neplatným statusem, ověřit fallback |
| `src/state/StatusesStore.tsx:98-100` | Default statuses initialization | Správná inicializace | **KEEP** | Vytvořit nový service, ověřit že má defaultní statusy |

---

## Shrnutí

### ✅ Opraveno
1. Realtime service_id guard - **ODSTRANĚNO**
2. statusById priorita - **ZMĚNĚNA** na `ticket.status` má přednost

### ⚠️ Kandidáti na refactoring
1. `statusById` inicializace guard - může způsobit stale state (ale nyní není kritický díky prioritě)
2. StatusesStore localStorage sync - není potřeba, protože statuses se načítají z DB

### ✅ Správně implementováno
1. DB query filtry (service_id, deleted_at) - nutné pro bezpečnost
2. Realtime handler deleted_at check - potřebné pro restore logiku
3. Fallback status "received" - správný fallback mechanismus
4. Default statuses initialization - správná inicializace

### 🗑️ Kandidáti na odstranění
*(žádní - mock tickets se odkládá na final stage)*

### 📝 Kandidáti na review
1. `as any` type assertions - projít každý případ a zjistit, jestli je nutný

