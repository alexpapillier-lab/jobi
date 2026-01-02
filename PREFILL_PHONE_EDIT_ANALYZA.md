# Analýza: Prefill + Customers Edit + Phone Matching

## 1) Prefill z Customers do New Order: proč jen jméno + telefon

### DB sloupce customers (select query)

**Soubor:** `src/pages/Orders.tsx:4088`  
**Select:**
```typescript
.select("id,name,phone,email,company,ico,address_street,address_city,address_zip,note")
```

✅ **Všechny potřebné sloupce jsou v selectu:**
- `id`, `name`, `phone`, `email`, `company`, `ico`, `address_street`, `address_city`, `address_zip`, `note`

**Mapování DB → Draft:**
- `name` → `customerName` ✅
- `phone` → `customerPhone` ✅
- `email` → `customerEmail` ✅
- `address_street` → `addressStreet` ✅
- `address_city` → `addressCity` ✅
- `address_zip` → `addressZip` ✅
- `company` → `company` ✅
- `ico` → `ico` ✅
- `note` → `customerInfo` ✅

### Draft klíče v Orders

**Soubor:** `src/pages/Orders.tsx:235-256`  
**Typ NewOrderDraft:**
```typescript
type NewOrderDraft = {
  customerId?: string;
  customerName: string;        // ✅
  customerPhone: string;       // ✅
  customerEmail: string;        // ✅
  addressStreet: string;       // ✅
  addressCity: string;          // ✅
  addressZip: string;           // ✅
  company: string;              // ✅
  ico: string;                  // ✅
  customerInfo: string;         // ✅
  // ... další fieldy
};
```

✅ **Všechny klíče existují a odpovídají mapování**

### UI bindy v New Order formuláři

**Soubor:** `src/pages/Orders.tsx` - sekce "Zákazník" (ř. 5522-5639)

**Inputy a jejich bindy:**
- **Jméno:** `value={newDraft.customerName}` (ř. 5528) ✅
- **Telefon:** `value={formatPhoneNumber(newDraft.customerPhone)}` (ř. 5545) ✅
- **E-mail:** `value={newDraft.customerEmail}` (ř. 5559) ✅
- **Adresa – ulice:** `value={newDraft.addressStreet}` (ř. 5572) ✅
- **Město:** `value={newDraft.addressCity}` (ř. 5582) ✅
- **PSČ:** `value={formatZipCode(newDraft.addressZip)}` (ř. 5592) ✅
- **Firma:** `value={newDraft.company}` (ř. 5609) ✅
- **IČO:** `value={formatIco(newDraft.ico)}` (ř. 5619) ✅
- **Informace:** `value={newDraft.customerInfo}` (ř. 5634) ✅

✅ **Všechny UI bindy odpovídají draft klíčům**

### Závěr pro prefill

**Kód vypadá správně:**
- ✅ Select query obsahuje všechny sloupce
- ✅ Mapování DB → Draft je správné
- ✅ UI bindy odpovídají draft klíčům

**Možné problémy:**
1. **RLS policy** - může blokovat některé sloupce (ale obvykle ne)
2. **Data v DB jsou NULL** - pokud customer nemá vyplněné údaje, prefill je prázdný
3. **Timing issue** - prefill se může spustit dřív, než se modal otevře

**Doporučení:**
- Přidat console.log do useEffect, aby bylo vidět, co přichází z DB:
```typescript
console.log("[Orders] Customer data for prefill:", data);
```

---

## 2) Customers edit: proč se změny po zavření neuloží

### Edit customer UI

**Soubor:** `src/pages/Customers.tsx`  
**Komponenta:** `Customers`  
**Edit modal:** Řádek 428-504

**Jak se otevírá:**
- Řádek 428: `openEdit()` - nastaví `setEditOpen(true)` a naplní `editDraft` z `opened` customer

### Save proces

**Funkce:** `saveEdit()` (ř. 447-504)

**Co dělá:**
1. Validuje `editDraft` (ř. 449-450)
2. Aktualizuje **pouze lokální state** `cloudCustomers` (ř. 455-499)
3. **NEPOSÍLÁ update do Supabase** ❌

**Kritický problém na řádku 495:**
```typescript
// TODO: Implement cloud update for customer edit
// For now, just update local state - realtime subscription will sync from cloud
```

**Co se stane:**
- ✅ Lokální state se aktualizuje
- ✅ UI se aktualizuje
- ❌ **Změny se NEULOŽÍ do DB**
- ❌ Po refresh se data vrátí k původním hodnotám

### Tlačítko "Zavřít" v edit módu

**Řádek 501:** `setEditOpen(false)` - pouze zavře modal, **bez save**

**Dirty flags:**
- ❌ **Není žádný dirty tracking**
- ❌ **Není auto-save při zavření**
- ✅ Je validace (`canSave` na řádku 445)

### Závěr pro Customers edit

**Problém:** 
❌ **Chybí Supabase update v `saveEdit()`**

**Řešení:**
Přidat do `saveEdit()` před aktualizací lokálního state:
```typescript
// Update customer in Supabase
const { error: updateError } = await (supabase
  .from("customers") as any)
  .update({
    name: editDraft.name.trim(),
    phone: editDraft.phone.trim() || null,
    email: editDraft.email.trim() || null,
    address_street: editDraft.addressStreet.trim() || null,
    address_city: editDraft.addressCity.trim() || null,
    address_zip: editDraft.addressZip.trim() || null,
    company: editDraft.company.trim() || null,
    ico: editDraft.ico.trim() || null,
    note: editDraft.info.trim() || null,
  })
  .eq("id", opened.id)
  .eq("service_id", activeServiceId);

if (updateError) {
  console.error("[Customers] Error updating customer:", updateError);
  showToast("Chyba při ukládání zákazníka", "error");
  return;
}
```

---

## 3) Phone matching v New Order: kde je nejmenší MVP hook

### Phone input v New Order

**Soubor:** `src/pages/Orders.tsx`  
**Řádek:** 5544-5553

**Aktuální implementace:**
```typescript
<input
  value={formatPhoneNumber(newDraft.customerPhone)}
  onChange={(e) => {
    const cleaned = e.target.value.replace(/[^\d+]/g, "");
    setNewDraft((p) => ({ ...p, customerPhone: cleaned }));
  }}
  style={{ ...baseFieldInput, border: showError("customerPhone") ? borderError : border }}
  placeholder="+420 123 456 789"
/>
```

**Handler:**
- ✅ Má `onChange` - aktualizuje draft
- ❌ **NEMÁ `onBlur`** - není trigger pro lookup

### Normalizace telefonu

**Soubor:** `src/lib/phone.ts`  
**Funkce:** `normalizePhone(phone: string | null | undefined): string | null`  
**Default prefix:** `+420` (řádek 38)

**Kdy se používá:**
- ✅ Při save ticketu: `src/pages/Orders.tsx:655` v `ensureCustomerIdForTicketSnapshot()`
- ❌ **NEPOUŽÍVÁ se při onChange/onBlur** v UI

### Find-or-create při save

**Funkce:** `ensureCustomerIdForTicketSnapshot()` (ř. 636-708)

**Co dělá:**
1. Normalizuje telefon na E.164
2. Hledá existujícího zákazníka podle `(service_id, phone_norm)`
3. Pokud neexistuje, vytvoří nového
4. Vrací `customer_id`

**Kdy se volá:**
- ✅ Při save nové zakázky (ř. 4811)
- ✅ Při update zakázky (ř. 4586)

**Anonymní zákazník:**
- Pokud je `customer_name` anonymní nebo `customer_phone` je prázdné, funkce vrací `null` (ř. 652-653)
- Ticket se uloží s `customer_id = null`, ale telefon se uloží do `customer_phone`

### Nejmenší MVP pro phone matching

**Kde přidat:**
- **onBlur handler** na phone input (ř. 5544-5553)

**Implementace:**
```typescript
onBlur={async (e) => {
  const phone = e.target.value.trim();
  if (!phone || !supabase || !activeServiceId) return;
  
  // Normalizovat telefon
  const phoneNorm = normalizePhone(phone);
  if (!phoneNorm) return;
  
  // Najít existujícího zákazníka
  const { data, error } = await (supabase
    .from("customers") as any)
    .select("id,name,phone,email,company,ico,address_street,address_city,address_zip,note")
    .eq("service_id", activeServiceId)
    .eq("phone_norm", phoneNorm)
    .maybeSingle();
  
  if (error || !data) return;
  
  // Zobrazit match panel nebo automaticky prefill
  // TODO: Implement match panel UI
}}
```

**Kde zobrazit match panel:**
- **Pod telefonem** v sekci "Zákazník" (ř. 5553)
- Přidat `<div>` s match informacemi a tlačítkem "Přiřadit"

**Příklad UI:**
```typescript
{matchedCustomer && (
  <div style={{ marginTop: 8, padding: 12, background: "var(--accent-light)", borderRadius: 8 }}>
    <div style={{ fontSize: 12, fontWeight: 600 }}>
      Našli jsme zákazníka: {matchedCustomer.name}
    </div>
    <button onClick={() => {
      // Prefill formuláře z matchedCustomer
      setNewDraft(prev => ({
        ...prev,
        customerId: matchedCustomer.id,
        customerName: matchedCustomer.name || prev.customerName,
        customerPhone: matchedCustomer.phone || prev.customerPhone,
        customerEmail: matchedCustomer.email || prev.customerEmail,
        // ... další pole
      }));
      setMatchedCustomer(null);
    }}>
      Přiřadit a doplnit údaje
    </button>
  </div>
)}
```

### Shrnutí pro phone matching

**Co už existuje:**
- ✅ `normalizePhone()` funkce
- ✅ `ensureCustomerIdForTicketSnapshot()` pro find-or-create
- ✅ Phone input v New Order formuláři

**Co chybí:**
- ❌ `onBlur` handler na phone input
- ❌ Lookup při zadání telefonu (ne jen při save)
- ❌ Match panel UI
- ❌ State pro `matchedCustomer`

**Nejmenší MVP:**
1. Přidat `onBlur` na phone input
2. V `onBlur` normalizovat telefon a hledat v DB
3. Pokud najde, zobrazit match panel pod telefonem
4. Při kliknutí "Přiřadit" prefill formuláře

