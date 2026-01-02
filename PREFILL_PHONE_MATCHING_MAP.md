# Mapování: Prefill + Phone Matching

## A) Prefill z Customers → Create ticket

### 1. Tlačítko "Vytvořit zakázku" v Customers detailu

**Soubor:** `src/pages/Customers.tsx`  
**Řádek:** 680-695

```typescript
<button
  onClick={() =>
    window.dispatchEvent(
      new CustomEvent("jobsheet:request-new-order", { detail: { customerId: opened.id } })
    )
  }
>
  + Vytvořit zakázku
</button>
```

**Jak se naviguje:**
- Používá **CustomEvent** `jobsheet:request-new-order` s `detail: { customerId }`
- **NEPOUŽÍVÁ** `navigate()` ani query params ani store
- Event se poslouchá v `App.tsx` (ř. 214-223) a `Orders.tsx` (ř. 4080-4085)

### 2. Objekt newOrderPrefill

**Typ:** `{ customerId?: string } | null`  
**Definice:** `src/pages/Orders.tsx:185`  
**State v App.tsx:** `src/App.tsx:107`

**Fieldy:**
- `customerId?: string` - pouze ID zákazníka, **žádné další údaje

### 3. Inicializace hodnot v Orders "Create ticket" formuláři

**Soubor:** `src/pages/Orders.tsx`

**Struktura draftu:**
```typescript
type NewOrderDraft = {
  customerId?: string;
  customerName: string;
  customerPhone: string;
  customerEmail: string;
  addressStreet: string;
  addressCity: string;
  addressZip: string;
  company: string;
  ico: string;
  customerInfo: string;
  // ... další fieldy pro zařízení
};
```

**Kde se inicializují hodnoty:**
- **Řádek 3953:** `const [newDraft, setNewDraft] = useState<NewOrderDraft>(() => safeLoadDraft() ?? defaultDraft());`
- **Řádek 500-520:** `defaultDraft()` vrací prázdný draft (všechny stringy jsou `""`)
- **Řádek 4073-4078:** useEffect zpracovává `newOrderPrefill`, ale **POUZE otevírá modal** (`setShouldOpenNew(true)`), **NENAČÍTÁ customer detail**

**Problém:** 
❌ **Při prefill se NENAČÍTÁ customer detail z DB**
❌ **Formulář zůstává prázdný** (kromě případně uloženého draftu z localStorage)
❌ **customerId se ukládá do draftu, ale nepoužívá se k načtení dat**

**Co se děje:**
1. Tlačítko v Customers → dispatch event s `customerId`
2. App.tsx nastaví `newOrderPrefill = { customerId }`
3. Orders.tsx otevře modal (`setIsNewOpen(true)`)
4. **Formulář je prázdný** - žádné načtení customer dat

### 4. Nejmenší změna pro načtení customer detailu

**Potřebujeme přidat useEffect v Orders.tsx:**

```typescript
useEffect(() => {
  if (!newOrderPrefill?.customerId || !supabase || !activeServiceId) return;
  
  // Načíst customer detail z DB
  (async () => {
    const { data, error } = await supabase
      .from("customers")
      .select("*")
      .eq("id", newOrderPrefill.customerId)
      .eq("service_id", activeServiceId)
      .single();
    
    if (error || !data) return;
    
    // Prefill formuláře
    setNewDraft((prev) => ({
      ...prev,
      customerId: data.id,
      customerName: data.name || "",
      customerPhone: data.phone || "",
      customerEmail: data.email || "",
      addressStreet: data.address_street || "",
      addressCity: data.address_city || "",
      addressZip: data.address_zip || "",
      company: data.company || "",
      ico: data.ico || "",
      customerInfo: data.note || "",
    }));
  })();
}, [newOrderPrefill?.customerId, supabase, activeServiceId]);
```

---

## B) Matching existujícího zákazníka při zadání telefonu

### 1. Normalizace telefonu na E.164

**Soubor:** `src/lib/phone.ts`  
**Funkce:** `normalizePhone(phone: string | null | undefined): string | null`  
**Řádek:** 13-46

**Co dělá:**
- Odstraní mezery, pomlčky, závorky
- `00...` → `+...`
- Bez prefixu → default `+420`
- Krátká/nevalidní čísla → `null`

**Kdy se volá:**
- **Při ukládání ticketu:** `src/pages/Orders.tsx:655` v `ensureCustomerIdForTicketSnapshot()`
- **NEPOUŽÍVÁ se při onChange/onBlur** v UI formuláři
- **UI používá raw phone** bez normalizace (ř. 5502-5506)

### 2. Find-or-create customer při ukládání ticketu

**Soubor:** `src/pages/Orders.tsx`  
**Funkce:** `ensureCustomerIdForTicketSnapshot()`  
**Řádek:** 636-708

**Implementace:**
```typescript
// 1) Normalizovat telefon
const phoneNorm = normalizePhone(snapshot.customer_phone);

// 2) Najít existujícího zákazníka podle (service_id, phone_norm)
const found = await supabase
  .from("customers")
  .select("id")
  .eq("service_id", activeServiceId)
  .eq("phone_norm", phoneNorm)
  .maybeSingle();

if (found.data?.id) {
  return found.data.id; // Vrátit existující ID
}

// 3) Pokud neexistuje, vytvořit nového
const created = await supabase
  .from("customers")
  .insert([payload])
  .select("id")
  .single();

return created.data?.id;
```

**Kdy se volá:**
- **Při ukládání nové zakázky:** `src/pages/Orders.tsx:4811`
- **Při aktualizaci zakázky:** `src/pages/Orders.tsx:4586`

**Potvrzení:** ✅ **Platí implementace find-or-create podle (service_id, phone_norm)**

### 3. Proč se neukazuje automatické přiřazení v UI

**Problémy:**

1. **Lookup se dělá až při save** (ř. 4811)
   - Během vyplňování formuláře se **nic neděje**
   - Uživatel nevidí, že zákazník existuje

2. **UI používá raw phone bez normalizace** (ř. 5502-5506)
   ```typescript
   value={formatPhoneNumber(newDraft.customerPhone)}
   onChange={(e) => {
     const cleaned = e.target.value.replace(/[^\d+]/g, "");
     setNewDraft((p) => ({ ...p, customerPhone: cleaned }));
   }}
   ```
   - `formatPhoneNumber()` pouze formátuje pro zobrazení
   - **Neprovádí normalizaci** pro lookup

3. **customer_id zůstává prázdné v draftu**
   - `newDraft.customerId` se **nastavuje pouze při prefill z Customers**
   - Při ručním zadání telefonu se **nikdy nenastaví**

### 4. Jak vypadá UX teď

**Scénář:** Uživatel zadá telefon existujícího zákazníka a uloží

**Co se stane:**
1. ✅ `ensureCustomerIdForTicketSnapshot()` najde existujícího zákazníka
2. ✅ Vytvoří se ticket s `customer_id` = existující ID
3. ❌ **UI to neukazuje** - uživatel neví, že se zákazník přiřadil
4. ❌ **Formulář zůstává prázdný** - neprefilluje se z existujícího profilu

**Výsledek:** 
- ✅ **V DB je správně** - ticket má `customer_id`
- ❌ **UX je špatné** - uživatel nevidí, že zákazník existuje

### 5. Potřebná pravidla

**(a) Stejný phone_norm + jiné jméno → UI varování**
- Zobrazit panel: "Našli jsme zákazníka s tímto telefonem: [Jméno]. Chcete přiřadit?"
- Tlačítko "Přiřadit" → prefill formuláře z existujícího profilu

**(b) Stejný phone_norm + stejné jméno → automatické přiřazení**
- Automaticky přiřadit `customer_id`
- Prefill formuláře z existujícího profilu (adresa, firma, IČO, poznámka)
- Zobrazit indikátor: "Přiřazeno k existujícímu zákazníkovi"

---

## Shrnutí

### ✅ Co funguje:
1. Prefill z Customers → navigace do Orders (event-based)
2. Find-or-create customer při ukládání (podle phone_norm)
3. Normalizace telefonu na E.164

### ❌ Co nefunguje:
1. **Prefill z Customers → formulář zůstává prázdný** (není načten customer detail)
2. **Matching během vyplňování → neexistuje** (lookup jen při save)
3. **UI neukazuje existující zákazníky** (žádný match panel)

### 🔧 Potřebné změny:
1. **Načíst customer detail při prefill** (useEffect v Orders.tsx)
2. **Lookup při onChange/onBlur telefonu** (debounced search)
3. **Match panel UI** (zobrazit existující zákazníky)
4. **Automatické prefill** (při match + stejné jméno)

