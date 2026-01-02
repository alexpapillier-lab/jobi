# Analýza Realtime UPDATE event pro tickets

## 1. Kde se UPDATE event přijímá

**Soubor:** `src/pages/Orders.tsx`  
**Funkce:** Handler callback v `useEffect` na řádcích **3835-3918**  
**Konkrétně:** Callback handler na řádcích **3848-3909**

```typescript
useEffect(() => {
  if (!activeServiceId || !supabase) return;

  const channel = supabase
    .channel(`tickets:${activeServiceId}`)
    .on(
      "postgres_changes",
      {
        event: "*",
        schema: "public",
        table: "tickets",
        filter: `service_id=eq.${activeServiceId}`,  // ← Filtruje už na gateway level
      },
      async (payload) => {
        // Handler zde (řádky 3848-3909)
      }
    )
    .subscribe();
}, [activeServiceId, supabase]);
```

---

## 2. Kde se UPDATE zpracovává

**Řádek 3858:** `if (payload.eventType === "INSERT" || payload.eventType === "UPDATE")`

UPDATE a INSERT se zpracovávají společně:
- Řádek 3859: `const newTicket = mapSupabaseTicketToTicketEx(payload.new as any);`
- Řádek 3883-3897: Upsert logika (pro `!isDeleted`)

**Správná logika pro UPDATE (řádky 3883-3897):**
```typescript
setCloudTickets((prev) => {
  const existing = prev.find((t) => t.id === newTicket.id);
  if (existing) {
    // Update existing ← SPRÁVNĚ nahrazuje podle id
    return prev.map((t) => (t.id === newTicket.id ? newTicket : t));
  } else {
    // Add new - insert in correct position
  }
});
```

✅ **Správně:** Pokud ticket existuje, nahradí se podle `id`.

---

## 3. Kde se UPDATE může zahodit / nepropsat do state

### ⚠️ PROBLÉM #1: Guard na service_id (řádky 3852-3856)

```typescript
// Only process tickets for current service
const newServiceId = (payload.new as any)?.service_id;
const oldServiceId = (payload.old as any)?.service_id;
if (newServiceId !== activeServiceId && oldServiceId !== activeServiceId) {
  return; // ← TADY SE UPDATE ZAHODÍ
}
```

**Analýza:**
- Guard kontroluje, zda `newServiceId` nebo `oldServiceId` odpovídá `activeServiceId`
- Pokud ANI jeden neodpovídá, event se zahodí
- **ALE:** Subscription už filtruje podle `service_id=eq.${activeServiceId}` na řádku 3846!
- Takže tento guard je **REDUNDANTNÍ** - měl by být vždy OK

**Potenciální problémy:**
1. **Stale activeServiceId v closure:** Handler používá `activeServiceId` z closure. Pokud se `activeServiceId` změní, useEffect se znovu spustí a vytvoří nový channel, takže by to mělo být OK. ALE: Pokud by bylo `activeServiceId` stale v momentě, kdy event dorazí, guard by mohl zahodit validní UPDATE.

2. **Race condition:** Pokud se `activeServiceId` změní rychle, může dojít k situaci:
   - Channel se vytvoří pro service A
   - activeServiceId se změní na service B
   - Event pro service A dorazí
   - Guard porovná s novým activeServiceId (service B) → zahodí event
   - **ŘEŠENÍ:** useEffect dependency array na řádku 3918 zajistí unsubscribe/subscribe při změně activeServiceId

**Závěr:** Guard je redundatní, ale neměl by způsobovat problémy, protože subscription už filtruje. Pokud by byl problém, bylo by to kvůli stale activeServiceId v closure.

---

### ✅ PROBLÉM #2: Není - Update logika je správná

Update logika na řádcích 3883-3897 správně:
- Najde existing ticket podle `id`
- Pokud existuje, nahradí ho novým ticketem
- Pokud neexistuje, přidá ho (to by nemělo nastat pro UPDATE, ale je to OK)

**Není problém s:**
- `if (!ticketInState) return` - takový guard není
- Ignorování podle id - ticket se správně nahrazuje

---

## 4. Shrnutí

### ✅ Co je správně:
1. UPDATE event se přijímá správně (řádek 3858)
2. Ticket se správně nahrazuje podle `id` (řádek 3887)
3. Není guard typu `if (!ticketInState) return`

### ⚠️ Potenciální problémy:
1. **Redundantní guard na service_id (řádky 3852-3856)** - může teoreticky zahodit UPDATE, pokud:
   - `activeServiceId` je stale v closure (málo pravděpodobné kvůli useEffect cleanup)
   - Nebo je race condition při změně activeServiceId

**Doporučení:**
- Guard na řádcích 3852-3856 je redundatní (subscription už filtruje)
- Můžeme ho odstranit, protože `filter: service_id=eq.${activeServiceId}` už zajišťuje správné filtrování
- Nebo ho můžeme nechat jako defense-in-depth, ale pak by měl logovat, když zahodí event (pro debugging)

---

## 5. Místo pro debugging

**Kde se UPDATE přijme, ale může se zahodit:**
- **Soubor:** `src/pages/Orders.tsx`
- **Řádky:** 3852-3856 (guard na service_id)
- **Handler:** řádek 3848

**Kde se UPDATE propsá do state:**
- **Soubor:** `src/pages/Orders.tsx`  
- **Řádky:** 3883-3897 (upsert logika)
- **Správně:** Nahrazuje ticket podle `id`

