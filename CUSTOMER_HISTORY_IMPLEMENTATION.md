# 📋 Customer History - Implementace

## ✅ Implementováno

### 1. Backend – DB tabulka

**Soubor:** `supabase/migrations/20250111000000_create_customer_history.sql`

**Struktura tabulky:**
```sql
CREATE TABLE public.customer_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id UUID NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  service_id UUID NOT NULL REFERENCES services(id) ON DELETE CASCADE,
  changed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  changed_by UUID,  -- auth.uid(), nullable
  change_type TEXT NOT NULL DEFAULT 'update',
  diff JSONB NOT NULL DEFAULT '{}'::jsonb
);
```

**Indexy:**
- `idx_customer_history_customer_id` - pro rychlé načítání historie zákazníka
- `idx_customer_history_service_id` - pro RLS
- `idx_customer_history_changed_at` - pro řazení (DESC)

**RLS Policies:**
- SELECT: Členové služby mohou vidět historii zákazníků ve svých službách
- INSERT: Členové služby mohou vytvářet záznamy historie

**Diff formát:**
```json
{
  "email": { "old": "a@a.cz", "new": "b@b.cz" },
  "address_city": { "old": "Praha", "new": "Brno" }
}
```

---

### 2. Zápis historie při editaci

**Soubor:** `src/pages/Customers.tsx`  
**Funkce:** `saveEdit()` (řádky 493-747)

**Logika:**
1. Načte původní záznam zákazníka z DB
2. Porovná každé pole s novými hodnotami
3. Vytvoří diff pouze pro změněná pole
4. Pokud existuje alespoň 1 změna:
   - Získá `auth.uid()` pro `changed_by`
   - INSERT do `customer_history` s diff
5. Poté provede UPDATE zákazníka

**Příklad diff:**
```typescript
{
  "phone": { "old": "+420123456789", "new": "+420987654321" },
  "email": { "old": "old@email.cz", "new": "new@email.cz" }
}
```

**Error handling:**
- Pokud selže načtení původního záznamu → pokračuje s update (použije `opened` state)
- Pokud selže INSERT historie → loguje error, ale pokračuje s update
- Historie je "nice to have", ne kritická pro funkčnost

---

### 3. UI – Historie změn

**Soubor:** `src/pages/Customers.tsx`  
**Umístění:** Mezi sekcí "Informace" a "Zakázky" v Customers detailu

**State:**
```typescript
const [customerHistory, setCustomerHistory] = useState<CustomerHistoryEntry[]>([]);
const [customerHistoryLoading, setCustomerHistoryLoading] = useState(false);
```

**Načítání:**
- useEffect se spustí při otevření detailu zákazníka (`openId` změna)
- Načítá historii z `customer_history` tabulky
- Řadí podle `changed_at DESC` (nejnovější nahoře)
- Refresh po úspěšném uložení změn

**UI komponenta:**
- **Timeline styl:** Nejnovější změny nahoře
- **Každý záznam obsahuje:**
  - Nadpis: "Změna údajů zákazníka"
  - Datum + čas změny (formátované pomocí `formatCZ()`)
  - Seznam změn:
    - Název pole (česky: "Jméno", "Telefon", "E-mail", atd.)
    - Stará hodnota → nová hodnota
    - Prázdné hodnoty zobrazovány jako "(prázdné)"
    - Stará hodnota přeškrtnutá, pokud je prázdná
    - Nová hodnota zvýrazněna (accent barva, tučně)

**Stavy:**
- Loading: "Načítání historie..."
- Prázdné: "Zatím žádné změny."
- S daty: Timeline se změnami

**Design:**
- Konzistentní s design systémem aplikace
- Stejné styly jako ostatní karty (border, borderRadius, padding, shadow)
- Responzivní layout

---

## 📊 Výkonový dopad

**Zanedbatelný:**
- INSERT do `customer_history` je rychlý (append-only, indexy)
- SELECT historie se načítá pouze při otevření detailu (lazy loading)
- Indexy na `customer_id` a `changed_at` zajišťují rychlé dotazy
- Historie se neaktualizuje v realtime (není potřeba)
- Refresh pouze po úspěšném uložení změn

**Odhadované dopady:**
- INSERT: < 10ms
- SELECT (pro zákazníka): < 50ms (i s 100+ záznamy)
- UI render: < 5ms (pro 10-20 záznamů)

---

## 🎯 Shrnutí

### ✅ Co je hotové:
1. ✅ DB tabulka `customer_history` s RLS
2. ✅ Zápis historie při editaci zákazníka
3. ✅ Načítání historie při otevření detailu
4. ✅ UI komponenta pro zobrazení historie (timeline)
5. ✅ Refresh historie po úspěšném uložení

### 📝 Poznámky:
- Historie je **append-only** (žádné UPDATE/DELETE)
- Diff obsahuje **pouze změněná pole**
- `changed_by` může být `null` (pokud není dostupný auth.uid())
- Historie se **neaktualizuje v realtime** (není potřeba)
- Error handling je **graceful** (pokud selže historie, update zákazníka pokračuje)

### 🔄 Další možné vylepšení (není v scope):
- Zobrazení jména uživatele místo UUID v `changed_by`
- Filtrování historie podle typu změny
- Export historie do PDF/CSV
- Realtime subscription pro historii (pokud by bylo potřeba)

---

**Konec implementace**

