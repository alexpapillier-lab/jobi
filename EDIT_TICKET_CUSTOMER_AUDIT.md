# Audit: Edit Ticket → Change Customer (End-to-End)

## A) Ověření ukládání do DB

### Funkce: `saveTicketChanges()`
**Soubor:** `src/pages/Orders.tsx:4686-4820`

**Payload před `.update()`:**
- **Řádek 4760-4786:** Payload obsahuje všechny customer snapshot sloupce:
  - `customer_id` (ř. 4764)
  - `customer_name` (ř. 4765)
  - `customer_phone` (ř. 4766)
  - `customer_email` (ř. 4767)
  - `customer_address_street` (ř. 4768)
  - `customer_address_city` (ř. 4769)
  - `customer_address_zip` (ř. 4770)
  - `customer_company` (ř. 4771)
  - `customer_ico` (ř. 4772)
  - `customer_info` (ř. 4773)

**Mapování `editedTicket` → `updated` → `payload`:**
- ✅ `editedTicket.customerId` → `updated.customerId` → `payload.customer_id` (ř. 4703, 4764)
- ✅ `editedTicket.customerName` → `updated.customerName` → `payload.customer_name` (ř. 4704, 4765)
- ✅ `editedTicket.customerPhone` → `updated.customerPhone` → `payload.customer_phone` (ř. 4705, 4766)
- ✅ `editedTicket.customerEmail` → `updated.customerEmail` → `payload.customer_email` (ř. 4706, 4767)
- ✅ `editedTicket.customerAddressStreet` → `updated.customerAddressStreet` → `payload.customer_address_street` (ř. 4707, 4768)
- ✅ `editedTicket.customerAddressCity` → `updated.customerAddressCity` → `payload.customer_address_city` (ř. 4708, 4769)
- ✅ `editedTicket.customerAddressZip` → `updated.customerAddressZip` → `payload.customer_address_zip` (ř. 4709, 4770)
- ✅ `editedTicket.customerCompany` → `updated.customerCompany` → `payload.customer_company` (ř. 4710, 4771)
- ✅ `editedTicket.customerIco` → `updated.customerIco` → `payload.customer_ico` (ř. 4711, 4772)
- ✅ `editedTicket.customerInfo` → `updated.customerInfo` → `payload.customer_info` (ř. 4712, 4773)

**✅ OPRAVENO:**
- **Řádek 4740-4760:** `resolvedCustomerId` logika:
  - ✅ Pokud `editedTicket.customerId` je nastavené, použije se to (priorita explicitní změny)
  - ✅ Pokud ne, použije se `updated.customerId` (který může být z `detailedTicket`)
  - ✅ Pokud ani to ne, volá se `ensureCustomerIdForTicketSnapshot()`
  - **Opraveno:** `editedTicket.customerId` má nyní prioritu před `detailedTicket.customerId`

**Přidané logování:**
- ✅ Řádek 4701-4712: Log `editedTicket` state před merge
- ✅ Řádek 4788-4798: Log customer snapshot fields v payloadu

---

## B) Ověření načítání zakázek v Customers detailu

### Načítání zakázek zákazníka
**Soubor:** `src/pages/Customers.tsx:344-378`

**Filtr:**
- ✅ **Řádek 355:** `.eq("customer_id", openId)` - správně filtruje podle `customer_id`
- ✅ **Řádek 354:** `.eq("service_id", activeServiceId)` - správně filtruje podle služby
- ✅ **Řádek 356:** `.is("deleted_at", null)` - správně vylučuje smazané

**Realtime subscription:**
- **Řádek 255-308:** Realtime subscription pro `customers` tabulku
- **Řádek 3834-3929 (Orders.tsx):** Realtime subscription pro `tickets` tabulku
- ⚠️ **Potenciální problém:** Pokud se změní `tickets.customer_id`, realtime subscription v Orders.tsx aktualizuje `cloudTickets`, ale **Customers.tsx nemá realtime subscription pro tickets** - načítá je pouze při mount/change `openId`

**Cache/State:**
- **Řádek 318:** `customerTickets` state - lokální cache pro zakázky otevřeného zákazníka
- **Řádek 377:** `loadCustomerTickets()` se volá při změně `openId` (ř. 378)
- ⚠️ **Problém:** Pokud se změní `customer_id` v ticketu, `customerTickets` v Customers.tsx se **NEaktualizuje automaticky** - musí se refresh nebo změnit `openId`

**Grouping tickets by customer_id:**
- **Řádek 222-236:** Při načítání customers se groupují tickets podle `customer_id`
- ✅ Správně používá `ticket.customer_id` pro grouping

**Závěr:**
- ✅ Načítání zakázek je správně podle `customer_id`
- ⚠️ **Problém:** Po změně `customer_id` v ticketu se `customerTickets` v Customers.tsx **NEaktualizuje automaticky**
- **Řešení:** Přidat realtime subscription pro tickets v Customers.tsx, nebo refresh při návratu na Customers stránku

---

## C) Ověření handleru "Změnit zákazníka"

### Handler tlačítka "Změnit zákazníka"
**Soubor:** `src/pages/Orders.tsx:6320-6348`

**Načtení dat z DB:**
- **Řádek 6324-6329:** Select obsahuje všechny potřebné sloupce:
  - `id, name, phone, email, company, ico, address_street, address_city, address_zip, note`

**Nastavení do `editedTicket`:**
- **Řádek 6333-6345:** Nastavuje všechna customer snapshot pole:
  - ✅ `customerId: data.id`
  - ✅ `customerName: data.name || ""`
  - ✅ `customerPhone: data.phone || ""`
  - ✅ `customerEmail: data.email || ""`
  - ✅ `customerAddressStreet: data.address_street || ""`
  - ✅ `customerAddressCity: data.address_city || ""`
  - ✅ `customerAddressZip: data.address_zip || ""`
  - ✅ `customerCompany: data.company || ""`
  - ✅ `customerIco: data.ico || ""`
  - ✅ `customerInfo: data.note || ""`

**Bindy v Edit formuláři:**
- **Řádek 6244:** `value={editedTicket.customerName || ""}` ✅
- **Řádek 6261:** `value={editedTicket.customerPhone || ""}` ✅
- **Řádek 6209:** `value={editedTicket.customerEmail || ""}` ✅
- **Řádek 6220:** `value={editedTicket.customerAddressStreet || ""}` ✅
- **Řádek 6230:** `value={editedTicket.customerAddressCity || ""}` ✅
- **Řádek 6241:** `value={editedTicket.customerAddressZip || ""}` ✅
- **Řádek 6251:** `value={editedTicket.customerCompany || ""}` ✅
- **Řádek 6261:** `value={editedTicket.customerIco || ""}` ✅
- **Řádek 6271:** `value={editedTicket.customerInfo || ""}` ✅

**Přidané logování:**
- ✅ Řádek 6331-6334: Log customer data loaded from DB
- ✅ Řádek 6346-6348: Log what we're setting to editedTicket

**Závěr:**
- ✅ Handler nastavuje všechna customer snapshot pole správně
- ✅ Bindy v Edit formuláři odpovídají `editedTicket` klíčům
- ✅ Mapování DB → `editedTicket` je správné

---

## Shrnutí problémů

### ✅ OPRAVENO: `resolvedCustomerId` logika

**Původní problém:**
V `saveTicketChanges()` se `resolvedCustomerId` určovalo takto:
```typescript
if (detailedTicket.customerId) {
  resolvedCustomerId = detailedTicket.customerId; // ← Ignorovalo editedTicket.customerId!
}
```

**Oprava:**
- **Řádek 4740-4760:** Upraveno tak, aby `editedTicket.customerId` mělo prioritu:
```typescript
if (editedTicket.customerId !== undefined) {
  resolvedCustomerId = editedTicket.customerId; // ✅ Priorita explicitní změny
} else if (updated.customerId) {
  resolvedCustomerId = updated.customerId;
} else {
  resolvedCustomerId = await ensureCustomerIdForTicketSnapshot(...);
}
```

**Výsledek:**
- ✅ Po kliknutí "Změnit zákazníka" se použije nový `customerId` z `editedTicket`

### ⚠️ PROBLÉM #2: Customers detail se neaktualizuje po změně customer_id

**Problém:**
Po změně `customer_id` v ticketu se `customerTickets` v Customers.tsx **NEaktualizuje automaticky**.

**Důsledek:**
- V DB je `customer_id` správně
- V Customers detailu se zakázka **NEobjeví** u nového zákazníka, dokud se neobnoví stránka nebo se nezmění `openId`

**Řešení:**
1. Přidat realtime subscription pro tickets v Customers.tsx
2. Nebo refresh `customerTickets` při návratu na Customers stránku
3. Nebo invalidovat cache při změně `customer_id`

---

## Závěr

✅ **Co funguje:**
- Handler "Změnit zákazníka" nastavuje všechna pole správně
- Mapování `editedTicket` → `payload` je správné
- Customers detail načítá zakázky správně podle `customer_id`

❌ **Co nefunguje:**
- `resolvedCustomerId` logika ignoruje `editedTicket.customerId` pokud `detailedTicket.customerId` existuje
- Customers detail se neaktualizuje automaticky po změně `customer_id`

🔧 **Potřebné opravy:**
1. ✅ **OPRAVENO:** `resolvedCustomerId` logika - `editedTicket.customerId` má nyní prioritu
2. ⚠️ **ZŮSTÁVÁ:** Přidat aktualizaci `customerTickets` po změně `customer_id` (realtime nebo refresh)

