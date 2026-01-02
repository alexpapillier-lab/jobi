# 📋 ORDERS & CUSTOMERS - KOMPLETNÍ AUDIT

**Datum auditu:** 2025-01-XX  
**Soubory analyzované:** `src/pages/Orders.tsx` (7252 řádků), `src/pages/Customers.tsx` (1224 řádků)  
**Režim:** Audit / Review / Kritika (žádné implementace)

---

## 🎯 HIGH-LEVEL SUMMARY

### ✅ Co je navrženo velmi dobře (KEEP)

1. **Snapshot pattern pro customer data v tickets** - Zachování historických dat i při změně zákazníka
2. **phone_norm normalizace** - Konzistentní deduplikace zákazníků podle telefonu
3. **Realtime subscriptions s cleanup** - Správné odpojování kanálů při unmount/service switch
4. **LocalStorage draft persistence** - Uživatel neztratí rozpracovanou zakázku při refreshi
5. **Explicitní customer match decision** - UX panel s "undecided/accepted/rejected" stavem
6. **Error handling pro unique constraints** - Uživatelsky přívětivé zprávy při duplicitním telefonu

### ⚠️ Co je funkční, ale křehké (WATCH)

1. **Duplicitní logika customer lookup** - `lookupCustomer` vs `lookupCustomerEdit` vs `ensureCustomerIdForTicketSnapshot`
2. **Event-based refresh místo realtime** - `jobsheet:customer-tickets-refresh` event pro aktualizaci ticket listu
3. **State synchronizace mezi Orders a Customers** - Závislost na globálních eventech
4. **Implicitní merge logika v Customers.saveEdit()** - Automatické slučování zákazníků při změně ID
5. **Draft state management** - Množství podmíněných pravidel pro prefill (prázdná pole vs. existující hodnoty)

### 🔧 Co je technický dluh (FIX LATER)

1. **7252 řádků v jednom souboru** - Orders.tsx je monolitický, těžko udržovatelný
2. **Duplicitní customer matching logika** - 3 různé implementace lookupu
3. **Nekonzistentní error handling** - Někde try/catch, jinde jen console.error
4. **Chybějící TypeScript typy** - `as any` casty v Supabase queries
5. **Implicitní business logika** - Pravidla pro anonymní zákazníky, prefill, merge jsou rozptýlená v kódu

### 🔴 Co bys dnes navrhl jinak (REDESIGN IDEAS)

1. **Centralizovaný customer service** - Jedna funkce pro všechny customer lookupy/create/update
2. **Realtime pro customer tickets** - Místo event-based refresh použít postgres_changes na tickets
3. **Explicitní state machine** - Customer match decision jako state machine místo string flags
4. **Separace concerns** - Rozdělit Orders.tsx na: NewOrderForm, EditOrderForm, OrderList, OrderDetail
5. **Type-safe Supabase client** - Generované typy místo `as any`

---

## 📊 DETAILNÍ ANALÝZA

### 1) DATOVÝ MODEL

#### ✅ Silné stránky

**Snapshot vs Reference:**
- Tickets obsahují jak `customer_id` (FK reference) tak `customer_*` snapshot fields
- **Výhoda:** Historická data zůstávají i při změně/odstranění zákazníka
- **Implementace:** Správně v `saveTicketChanges()` a `createTicket()`

**phone_norm normalizace:**
- Konzistentní E.164 formát (+420XXXXXXXXX)
- Unique constraint na `(service_id, phone_norm)` pro deduplikaci
- **Výhoda:** Robustní deduplikace i při různých formátech vstupu

#### ⚠️ Slabá místa

**Zdroj pravdy není vždy jasný:**
- **Problém:** `customer_id` může být null, ale `customer_name` může být vyplněné
- **Riziko:** Desynchronizace mezi snapshot a reference
- **Příklad:** Ticket má `customer_name="Jan Novák"` ale `customer_id=null` → není jasné, jestli je to anonymní nebo existující zákazník

**phone vs phone_norm:**
- `customers.phone` může být v libovolném formátu
- `customers.phone_norm` je vždy E.164
- **Riziko:** Pokud se `phone` změní bez aktualizace `phone_norm`, deduplikace selže
- **Aktuální řešení:** `saveEdit()` aktualizuje `phone_norm` při změně telefonu ✅

**Desynchronizace rizika:**
- **Vysoké riziko:** `CustomerRecord.ticketIds` je derived state, ne DB sloupec
- Pokud se ticket `customer_id` změní mimo Customers.tsx, `ticketIds` se neaktualizuje automaticky
- **Aktuální řešení:** Event-based refresh (`jobsheet:customer-tickets-refresh`) ⚠️

#### 🔴 Co bys navrhl jinak

**1. Explicitní customer state enum:**
```typescript
type CustomerState = 
  | { type: "linked", customerId: string }
  | { type: "anonymous", snapshot: CustomerSnapshot }
  | { type: "pending", snapshot: CustomerSnapshot, matchedCustomerId?: string }
```

**2. DB trigger pro phone_norm:**
- Automatická aktualizace `phone_norm` při změně `phone` na DB úrovni
- Eliminuje riziko desynchronizace

**3. Materialized view pro customer.ticketIds:**
- `SELECT array_agg(id) FROM tickets WHERE customer_id = ...`
- Nebo computed column v DB

---

### 2) ORDERS – CREATE / EDIT FLOW

#### ✅ Silné stránky

**New Order flow:**
- LocalStorage persistence draftu
- Prefill z Customers detailu
- Customer match panel s explicitním rozhodnutím
- Okamžitý lookup při validním telefonu (bez blur)

**Edit Order flow:**
- `editedTicket` partial state pro změny
- Merge s `detailedTicket` před uložením
- Dirty flags pro detekci změn

#### ⚠️ Slabá místa

**ensureCustomerIdForTicketSnapshot() - komplexní logika:**
- **Soubor:** `src/pages/Orders.tsx:636-714`
- **Problém:** 78 řádků logiky s 3 různými scénáři (find, create, retry on conflict)
- **Riziko:** Těžko testovatelné, implicitní business pravidla
- **Příklad:** Anonymní jméno blokuje vytvoření zákazníka, ale ne lookup → není jasné proč

**Duplicitní customer lookup:**
- `lookupCustomer()` - pro New Order match panel
- `lookupCustomerEdit()` - pro Edit Order match panel  
- `ensureCustomerIdForTicketSnapshot()` - pro save flow
- **Riziko:** Změna v jedné logice se neprojeví v ostatních

**Implicitní prefill pravidla:**
- **Soubor:** `src/pages/Orders.tsx:4104-4144`
- **Problém:** Pravidlo "prefill jen prázdná pole" je implementováno jako `!prev.customerName.trim() ? data.name : prev.customerName`
- **Riziko:** Pokud uživatel smaže pole a pak otevře prefill, pole se neprefillne (protože není prázdné, ale obsahuje prázdný string)

**saveTicketChanges() - složitý merge:**
- **Soubor:** `src/pages/Orders.tsx:4698-4898`
- **Problém:** 200 řádků merge logiky s mnoha podmínkami
- **Riziko:** Snadno se přidá nové pole, ale zapomene se na merge

#### 🔴 Co bys navrhl jinak

**1. Centralizovaný CustomerService:**
```typescript
class CustomerService {
  async findOrCreate(snapshot: CustomerSnapshot, serviceId: string): Promise<string | null>
  async findByPhone(phone: string, serviceId: string): Promise<Customer | null>
  async updatePhone(customerId: string, phone: string, serviceId: string): Promise<void>
}
```

**2. Explicitní prefill rules:**
```typescript
type PrefillRule = "overwrite" | "fillEmpty" | "never";
const prefillRules: Record<keyof NewOrderDraft, PrefillRule> = {
  customerName: "fillEmpty",
  customerPhone: "fillEmpty",
  // ...
};
```

**3. State machine pro customer match:**
```typescript
type MatchState = 
  | { type: "idle" }
  | { type: "searching", phone: string }
  | { type: "found", customer: Customer, decision: "undecided" | "accepted" | "rejected" }
  | { type: "resolved", customerId: string | null };
```

---

### 3) CUSTOMERS – DETAIL / EDIT / TICKETS

#### ✅ Silné stránky

**Customer edit:**
- Persistence do Supabase s error handling
- Aktualizace `phone_norm` při změně telefonu
- Unique constraint error handling (23505)

**Customer tickets list:**
- Lazy loading při otevření detailu
- Event-based refresh při změně `customer_id` v ticketu

#### ⚠️ Slabá místa

**Event-based refresh místo realtime:**
- **Soubor:** `src/pages/Customers.tsx:381-422`
- **Problém:** `jobsheet:customer-tickets-refresh` event je globální, závislý na správném dispatch
- **Riziko:** Pokud se `customer_id` změní mimo Orders.tsx, event se nepošle → desynchronizace
- **Aktuální řešení:** Funguje, ale křehké

**Implicitní merge logika v saveEdit():**
- **Soubor:** `src/pages/Customers.tsx:550-600`
- **Problém:** Pokud `computeCustomerIdFromDraft()` vrátí jiné ID než `opened.id`, dojde k merge
- **Riziko:** Uživatel nemusí vědět, že se zákazníci sloučili
- **Příklad:** Změna telefonu na existující → merge bez varování

**ticketIds je derived state:**
- **Soubor:** `src/pages/Customers.tsx:280-295` (v realtime handleru)
- **Problém:** `ticketIds` se načítá dodatečným query při každé změně customer
- **Riziko:** Race condition - pokud se ticket změní během načítání, `ticketIds` může být zastaralé

**Chybějící realtime pro customer tickets:**
- **Soubor:** `src/pages/Customers.tsx:344-378`
- **Problém:** `loadCustomerTickets()` se volá jen při mount/refresh eventu
- **Riziko:** Pokud se ticket `customer_id` změní v jiném okně, UI se neaktualizuje automaticky

#### 🔴 Co bys navrhl jinak

**1. Realtime subscription pro customer tickets:**
```typescript
useEffect(() => {
  if (!openId || !supabase) return;
  
  const channel = supabase
    .channel(`customer-tickets-${openId}`)
    .on("postgres_changes", {
      event: "*",
      schema: "public",
      table: "tickets",
      filter: `customer_id=eq.${openId}`,
    }, (payload) => {
      // Update customerTickets state
    })
    .subscribe();
    
  return () => supabase.removeChannel(channel);
}, [openId, supabase]);
```

**2. Explicitní merge dialog:**
- Při změně telefonu na existující → zobrazit dialog "Sloučit s existujícím zákazníkem?"
- Uživatel musí explicitně potvrdit merge

**3. DB computed column pro ticketIds:**
- Nebo materialized view
- Eliminuje race conditions

---

### 4) STATE MANAGEMENT

#### ✅ Silné stránky

**New Order draft:**
- LocalStorage persistence
- Dirty detection (`isDraftDirty()`)
- Auto-save při změnách

**Customer match decision:**
- Explicitní state: `"undecided" | "accepted" | "rejected"`
- Reset při změně telefonu/jména
- Respektování "rejected" v save flow

#### ⚠️ Slabá místa

**Duplicita state:**
- `newDraft.customerId` vs `matchedCustomer.id` vs `customerMatchDecision`
- **Riziko:** Možná desynchronizace mezi těmito stavy
- **Příklad:** `matchedCustomer` je nastaven, ale `newDraft.customerId` je prázdné → při save se zákazník nepřiřadí

**Globální eventy:**
- `jobsheet:customer-tickets-refresh`
- `jobsheet:request-new-order`
- **Riziko:** Těžko debugovatelné, závislost na správném dispatch/listen
- **Příklad:** Pokud se event pošle před mount listeneru, refresh se neprovede

**Refs pro mutable state:**
- `lastLookupPhoneNormRef`, `phoneLookupDebounceTimerRef`
- **Riziko:** Snadno se zapomene resetovat při unmount
- **Aktuální řešení:** Reset v cleanup funkcích ✅

**editedTicket partial state:**
- **Soubor:** `src/pages/Orders.tsx:4713-4748`
- **Problém:** Merge logika s `detailedTicket` je komplexní (35 řádků)
- **Riziko:** Snadno se přidá nové pole, ale zapomene se na merge

#### 🔴 Co bys navrhl jinak

**1. Zustand store pro Orders state:**
```typescript
type OrdersStore = {
  newDraft: NewOrderDraft;
  editedTicket: Partial<TicketEx>;
  matchedCustomer: Customer | null;
  matchDecision: "undecided" | "accepted" | "rejected";
  setNewDraft: (draft: NewOrderDraft) => void;
  // ...
};
```

**2. React Query pro server state:**
- `useCustomerTickets(customerId)`
- Automatický refetch při změnách
- Cache management

**3. Explicitní state machine:**
- XState nebo vlastní implementace
- Vizuální reprezentace stavů a přechodů

---

### 5) UX AUDIT

#### ✅ Výborné UX

1. **Okamžitý customer match panel** - Zobrazí se při zadání validního telefonu, bez blur
2. **Explicitní rozhodnutí** - "Přiřadit zákazníka" vs "Ne, pokračovat" - jasné, bez překvapení
3. **LocalStorage draft** - Uživatel neztratí rozpracovanou zakázku
4. **Prefill z Customers** - Jedním klikem se naplní formulář zákazníkovými daty
5. **Error handling** - Uživatelsky přívětivé zprávy při duplicitním telefonu

#### ⚠️ Překvapivé UX

1. **Anonymní zákazník bez telefonu** - Pokud zadám jen jméno bez telefonu, `customer_id` zůstane null
   - **Problém:** Není jasné, jestli se vytvoří nový zákazník nebo ne
   - **Riziko:** Uživatel může očekávat, že se zákazník vytvoří

2. **Implicitní merge při edit customer** - Změna telefonu na existující → automatický merge
   - **Problém:** Uživatel nemusí vědět, že došlo ke sloučení
   - **Riziko:** Ztráta dat (pokud měl starý zákazník jiné údaje)

3. **Customer match panel mizí při změně telefonu** - I když uživatel klikl "Přiřadit zákazníka"
   - **Problém:** Pokud uživatel pak změní telefon, panel se znovu zobrazí
   - **Riziko:** Zmatení - proč se panel znovu zobrazuje, když už jsem přiřadil?

#### 🔴 Edge cases

1. **Race condition při rychlém psaní telefonu:**
   - Uživatel rychle napíše telefon → lookup se spustí několikrát
   - **Aktuální řešení:** `lastLookupPhoneNormRef` + debounce ✅
   - **Riziko:** Střední - může dojít k duplicitním lookupům při velmi rychlém psaní

2. **Customer match při změně telefonu v Edit:**
   - Uživatel změní telefon v Edit Order → match panel se zobrazí
   - Pokud klikne "Změnit zákazníka", všechny snapshot fields se přepíšou
   - **Riziko:** Ztráta původních snapshot dat

3. **Prefill při změně customerId:**
   - Pokud uživatel má rozpracovaný draft s `customerId`, pak otevře prefill z jiného zákazníka
   - **Aktuální řešení:** Prefill jen pokud `prev.customerId` je prázdné
   - **Riziko:** Nízké - logika je správná

4. **Event-based refresh timing:**
   - Pokud se `customer_id` změní v Orders.tsx, event se pošle
   - Pokud Customers.tsx ještě není mountnutý, event se ztratí
   - **Aktuální řešení:** Event listener je v useEffect, takže by měl být připraven ✅
   - **Riziko:** Nízké, ale existuje

#### 💡 Zjednodušení UX

1. **Explicitní merge dialog:**
   - Při změně telefonu na existující → dialog "Sloučit s existujícím zákazníkem?"
   - Uživatel musí explicitně potvrdit

2. **Customer match panel - persistent state:**
   - Pokud uživatel klikl "Přiřadit zákazníka", panel by neměl zmizet při změně telefonu
   - Místo toho by měl zobrazit: "Zákazník již přiřazen. Změnit?"

3. **Anonymní zákazník - explicitní vytvoření:**
   - Pokud zadám jen jméno bez telefonu, zobrazit: "Vytvořit anonymního zákazníka?"
   - Nebo automaticky vytvořit s placeholder telefonem

---

## 🎯 TOP 5 DOPORUČENÍ (prioritní pořadí)

### 1. 🔴 VYSOKÁ PRIORITA: Centralizovat customer lookup logiku

**Problém:**
- 3 různé implementace: `lookupCustomer()`, `lookupCustomerEdit()`, `ensureCustomerIdForTicketSnapshot()`
- Duplicitní kód, těžko udržovatelné

**Řešení:**
```typescript
// src/services/customerService.ts
export class CustomerService {
  static async findByPhone(phone: string, serviceId: string): Promise<Customer | null>
  static async findOrCreate(snapshot: CustomerSnapshot, serviceId: string): Promise<string | null>
  static async updatePhone(customerId: string, phone: string, serviceId: string): Promise<void>
}
```

**Riziko:** Střední - refaktor může způsobit regrese, ale výrazně zjednoduší údržbu

**Soubory:** `src/pages/Orders.tsx:4161-4215`, `4206-4250`, `636-714`

---

### 2. 🔴 VYSOKÁ PRIORITA: Realtime subscription pro customer tickets

**Problém:**
- Event-based refresh (`jobsheet:customer-tickets-refresh`) je křehké
- Pokud se `customer_id` změní mimo Orders.tsx, event se nepošle → desynchronizace

**Řešení:**
```typescript
// V Customers.tsx
useEffect(() => {
  if (!openId || !supabase) return;
  
  const channel = supabase
    .channel(`customer-tickets-${openId}`)
    .on("postgres_changes", {
      event: "*",
      schema: "public",
      table: "tickets",
      filter: `customer_id=eq.${openId}`,
    }, handleTicketChange)
    .subscribe();
    
  return () => supabase.removeChannel(channel);
}, [openId, supabase]);
```

**Riziko:** Nízké - realtime je robustnější než event-based

**Soubory:** `src/pages/Customers.tsx:381-422`

---

### 3. 🟡 STŘEDNÍ PRIORITA: Explicitní merge dialog při edit customer

**Problém:**
- Změna telefonu na existující → automatický merge bez varování
- Uživatel nemusí vědět, že došlo ke sloučení

**Řešení:**
```typescript
// V Customers.saveEdit()
if (phoneChanged && existingCustomerWithPhone) {
  const confirmed = await showConfirmDialog(
    "Sloučit zákazníky?",
    `Telefonní číslo patří zákazníkovi "${existingCustomerWithPhone.name}". Chcete sloučit zákazníky?`
  );
  if (!confirmed) return;
  // Merge logic
}
```

**Riziko:** Nízké - zlepší UX, eliminuje překvapení

**Soubory:** `src/pages/Customers.tsx:493-600`

---

### 4. 🟡 STŘEDNÍ PRIORITA: Rozdělit Orders.tsx na menší komponenty

**Problém:**
- 7252 řádků v jednom souboru
- Těžko udržovatelné, těžko testovatelné

**Řešení:**
```
src/pages/orders/
  ├── Orders.tsx (main component, orchestration)
  ├── NewOrderForm.tsx
  ├── EditOrderForm.tsx
  ├── OrderList.tsx
  ├── OrderDetail.tsx
  └── hooks/
      ├── useCustomerMatch.ts
      ├── useOrderDraft.ts
      └── useOrderRealtime.ts
```

**Riziko:** Střední - velký refaktor, ale výrazně zlepší udržovatelnost

**Soubory:** `src/pages/Orders.tsx` (celý soubor)

---

### 5. 🟢 NÍZKÁ PRIORITA: Type-safe Supabase client

**Problém:**
- `as any` casty v Supabase queries
- Chybějící type safety

**Řešení:**
```typescript
// Generované typy z Supabase CLI
import { Database } from './supabase.types';

const { data } = await supabase
  .from('customers')
  .select('id, name, phone')
  .eq('service_id', serviceId)
  .single();
// data je automaticky typované jako Database['public']['Tables']['customers']['Row']
```

**Riziko:** Nízké - zlepší developer experience, eliminuje runtime chyby

**Soubory:** Všechny soubory s Supabase queries

---

## 📝 ZÁVĚR

### Silné stránky architektury:
- ✅ Snapshot pattern pro historická data
- ✅ phone_norm normalizace pro deduplikaci
- ✅ Realtime subscriptions s cleanup
- ✅ LocalStorage persistence draftů
- ✅ Explicitní customer match decision

### Hlavní rizika:
- ⚠️ Duplicitní customer lookup logika (3 implementace)
- ⚠️ Event-based refresh místo realtime (křehké)
- ⚠️ Implicitní merge logika (překvapivé UX)
- ⚠️ Monolitický Orders.tsx (7252 řádků)
- ⚠️ Chybějící type safety (`as any`)

### Doporučený postup:
1. **Krátkodobě (1-2 týdny):** Centralizovat customer lookup, přidat realtime pro customer tickets
2. **Střednědobě (1 měsíc):** Explicitní merge dialog, rozdělit Orders.tsx
3. **Dlouhodobě (2-3 měsíce):** Type-safe Supabase client, state management refaktor

### Celkové hodnocení:
**7/10** - Funkční, ale s technickým dluhem. Architektura je solidní, ale potřebuje refaktor pro lepší udržovatelnost a UX.

---

**Konec auditu**

