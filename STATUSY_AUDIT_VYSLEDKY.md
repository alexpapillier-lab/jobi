# 📋 AUDIT: Statusy zakázek – persistence + reload

## 🔍 VÝSLEDKY ANALÝZY

---

## 1️⃣ Ukládání statusu

### Kde se vytváří nový status:
- **Soubor:** `src/pages/Settings.tsx`
- **Funkce:** onClick handler na tlačítku "Přidat" / "Aktualizovat"
- **Řádky:** 1442-1450

### Jaký payload se posílá:
```typescript
upsertStatus({
  key: keyTrim,
  label: labelTrim,
  bg: draft.bg?.trim() || undefined,
  fg: draft.fg?.trim() || undefined,
  isFinal: !!draft.isFinal,
});
```

### ❌ KRITICKÝ PROBLÉM: Volá se insert do tabulky service_statuses?
**NE!** 

**Implementace `upsertStatus` v `src/state/StatusesStore.tsx` (řádky 159-175):**
```typescript
const upsertStatus = (s: StatusMeta) => {
  const key = s.key.trim();
  const label = s.label.trim();
  if (!key || !label) return;

  setStatuses((prev) => {
    const next = prev.filter((x) => x.key !== key);
    next.push({
      key,
      label,
      bg: s.bg?.trim() || undefined,
      fg: s.fg?.trim() || undefined,
      isFinal: !!s.isFinal,
    });
    return next;
  });
};
```

**ZÁVĚR:** 
- ✅ Aktualizuje se **POUZE lokální state** (`setStatuses`)
- ❌ **ŽÁDNÝ Supabase INSERT/UPSERT se nevolá**
- ❌ **ŽÁDNÝ `.eq("service_id", activeServiceId)` se nepoužívá**
- ❌ Status se **NIKDY neuloží do databáze**

### Co vrací Supabase:
**Nic** – Supabase se vůbec nevolá.

---

## 2️⃣ DB & RLS

### RLS policies pro service_statuses:
**Nalezeno v dokumentaci (`cursor_perzistence.md`), ale migrace nebyly nalezeny v repo.**

**Očekávané policies (podle patternu z jiných tabulek):**
- **SELECT:** Membership-based (členové service mohou číst)
- **INSERT:** Owner/admin only (s `WITH CHECK`)
- **UPDATE:** Owner/admin only (s `WITH CHECK`)
- **DELETE:** Owner/admin only (s `qual`)

### ⚠️ POTŘEBA OVĚŘIT V DB:
```sql
SELECT 
  schemaname,
  tablename,
  policyname,
  cmd,
  qual,
  with_check
FROM pg_policies 
WHERE schemaname = 'public' 
  AND tablename = 'service_statuses'
ORDER BY cmd, policyname;
```

### Zda jsou membership-based:
**Pravděpodobně ANO** (podle patternu z `service_settings`, `customers`, atd.), ale **musí se ověřit v DB**.

### Není tam podmínka, která INSERT projde, ale SELECT ne?
**NELZE OVĚŘIT** bez přístupu k DB, ale typicky by to mělo být konzistentní.

---

## 3️⃣ Načítání statusů po startu

### Kde se statusy načítají:
- **Soubor:** `src/state/StatusesStore.tsx`
- **Hook:** `useEffect` v `StatusesProvider`
- **Řádky:** 35-153

### Používá se:
1. **Supabase SELECT** (řádky 67-71):
   ```typescript
   const { data: dbStatuses, error: dbError } = await supabase
     .from("service_statuses")
     .select("*")
     .eq("service_id", activeServiceId)
     .order("order_index");
   ```

2. **Fallback:** Pokud nejsou statusy v DB, volá se Edge Function `statuses-init-defaults` (řádky 97-99)

3. **ŽÁDNÁ lokální cache** – localStorage se nepoužívá (cloud-first approach)

### Je tam filtr podle service_id?
✅ **ANO** – `.eq("service_id", activeServiceId)` na řádku 70

### ✅ Načítání z DB funguje správně
- Načítá se z `service_statuses`
- Filtruje se podle `activeServiceId`
- Pokud nejsou statusy, inicializují se defaulty

---

## 4️⃣ Přepis stavu v UI

### Existuje místo, kde se statusy resetují/přepisují?
**ANO:**

1. **`resetToDefaults()`** (řádek 183-186):
   ```typescript
   const resetToDefaults = () => {
     setStatuses([]); // Vymaže state, musí se reloadnout z DB
   };
   ```

2. **`useEffect` při změně `activeServiceId`** (řádek 35):
   - Při změně service se statusy **vymažou** (řádek 38: `setStatuses([])`)
   - Pak se načtou z DB pro nový service

### Neexistuje useEffect, který po loadu přepíše state?
**NE** – po načtení z DB se state nastaví správně (řádky 82-93).

### ❌ TYPICKÝ BUG NALEZEN:
**`upsertStatus` NEPERSISTUJE do DB** – pouze aktualizuje lokální state, který se po refreshi přepíše načtenými daty z DB.

---

## 5️⃣ Rychlá kontrola v DB (manuálně)

### Pokud vytvořím status a pak reloadnu appku:
**Status NEBUDE v tabulce `service_statuses`**, protože:
- `upsertStatus` se nikdy nevolá na Supabase
- Status existuje pouze v React state
- Po refreshi se state načte z DB, kde status není

---

## 📋 FORMÁT ODPOVĚDI

### ✅ Ukládání – **NOK**
- **Problém:** `upsertStatus` v `StatusesStore.tsx` (řádky 159-175) **NEPERSISTUJE do DB**
- **Chování:** Pouze aktualizuje lokální React state
- **Důsledek:** Po refreshi se state načte z DB, kde nový status není

### ⚠️ RLS – **POTŘEBA OVĚŘIT V DB**
- Policies nebyly nalezeny v migracích
- Očekává se membership-based pattern (jako u `customers`, `service_settings`)
- **Musí se ověřit:** `SELECT policyname, cmd, qual, with_check FROM pg_policies WHERE tablename = 'service_statuses';`

### ✅ Načítání po refreshi – **OK**
- **Odkud:** Supabase SELECT z `service_statuses` (řádek 67-71 v `StatusesStore.tsx`)
- **Filtr:** `.eq("service_id", activeServiceId)` ✅
- **Fallback:** Edge Function pro inicializaci defaultů, pokud nejsou statusy
- **Žádná chyba** v načítání

### ❌ Kde se to přepisuje:
**Při refreshi:**
1. `useEffect` v `StatusesProvider` (řádek 35) se spustí
2. Načte statusy z DB (řádky 67-71)
3. Nastaví state na načtené statusy (řádky 82-93)
4. **Nový status tam není**, protože se nikdy neuložil do DB

---

## 🎯 JEDNOZNAČNÝ ZÁVĚR: Proč po refreshi mizí

### Hlavní příčina:
**`upsertStatus` funkce v `StatusesStore.tsx` NEPERSISTUJE statusy do Supabase databáze.**

### Detailní flow problému:

1. **Uživatel vytvoří status:**
   - Klikne "Přidat" v Settings.tsx (řádek 1444)
   - Zavolá se `upsertStatus({ key, label, bg, fg, isFinal })`
   - Status se přidá **POUZE do lokálního React state** (řádek 164-174)

2. **Status se zobrazí v UI:**
   - ✅ Funguje, protože je v React state
   - ❌ **NENÍ v databázi**

3. **Uživatel refreshne aplikaci:**
   - `StatusesProvider` se znovu inicializuje
   - `useEffect` (řádek 35) se spustí
   - Načte statusy z DB (řádky 67-71)
   - Nový status tam není → state se nastaví na statusy z DB (bez nového statusu)
   - ❌ **Status zmizí z UI**

### Řešení:
**Přidat Supabase UPSERT do `upsertStatus` funkce:**
```typescript
const upsertStatus = async (s: StatusMeta) => {
  // ... validace ...
  
  // Update local state
  setStatuses((prev) => { /* ... */ });
  
  // ✅ PŘIDAT: Persist to DB
  if (activeServiceId && supabase) {
    await supabase
      .from("service_statuses")
      .upsert({
        service_id: activeServiceId,
        key: s.key,
        label: s.label,
        bg: s.bg || null,
        fg: s.fg || null,
        is_final: s.isFinal,
        order_index: /* calculate */,
      }, {
        onConflict: "service_id,key"
      });
  }
};
```

---

## 📝 DOPORUČENÍ

1. **OKAMŽITĚ:** Přidat Supabase UPSERT do `upsertStatus` funkce
2. **OVĚŘIT:** RLS policies pro `service_statuses` v DB
3. **OVĚŘIT:** Manuálně v DB, zda se statusy skutečně ukládají po opravě
4. **PŘIDAT:** Error handling pro případ, že UPSERT selže
5. **ZVAŽIT:** Realtime subscription pro `service_statuses`, aby se změny propagovaly mezi uživateli

