# Odpovědi na Otázky z Master Backlogu

## A) Export / tisk / náhled

### Kde je implementovaný "preview/print" flow dnes (soubor/y)?

**Soubory:**
- `src/pages/Preview.tsx` - Preview okno komponenta
- `src/pages/Orders.tsx:757` - Funkce `previewDocument()`
- `src/pages/Orders.tsx:834` - Funkce `exportDocumentToPDF()` (Tauri API)
- `src/pages/Orders.tsx:895` - Funkce `printDocument()`
- `src/pages/Orders.tsx:1120+` - Funkce `generateTicketHTML()`, `generateDiagnosticProtocolHTML()`, `generateWarrantyHTML()`

### Jsou podporované typy: zakázkový list / diagnostika / záruka?

**✅ ANO** - Všechny tři typy jsou podporované:
- `"ticket"` - Zakázkový list (`generateTicketHTML`)
- `"diagnostic"` - Diagnostický protokol (`generateDiagnosticProtocolHTML`)
- `"warranty"` - Záruční list (`generateWarrantyHTML`)

### Pro Mac: otevírá se systémové print dialog okno spolehlivě?

**Implementace:**
- Tauri: Otevírá se nové okno (`WebviewWindow`) s iframe, obsah má tlačítko "Tisknout" a volá `iframe.contentWindow.print()`
- Pro Mac: Spoléhá se na standardní `window.print()` API, což by mělo fungovat
- **Možné problémy:** Pokud Tauri okno nepodporuje správně `window.print()`, může být problém
- **Fallback:** Je browser fallback (`window.open()` + `print()`)

### Co přesně je "missing": UI tlačítka, template, PDF export, nebo stabilita?

**Co JE implementováno:**
- ✅ UI tlačítka v Preview okně (Tisknout, Zavřít)
- ✅ HTML templates pro všechny 3 typy dokumentů
- ✅ PDF export (pouze Tauri: `@tauri-apps/api/fs` - save dialog)

**Co CHYBÍ:**
- ❌ **PDF export v browseru** (jen Tauri)
- ❌ **Stabilita print dialogu na Mac** (neověřeno, možná problém)
- ❌ **Export bez print dialogu** (pouze přes Tauri API)

---

## B) Velikost UI nefunguje

### Co znamená "velikost UI": zoom slider, font size, layout scale, window scale?

**Implementováno:** `uiScale` v UIConfig
- Rozsah: 0.85 - 1.35 (85% - 135%)
- Aplikuje se přes: `document.documentElement.style.fontSize = ${16 * s}px`
- **Co to znamená:** Globální font-size scale, což ovlivní rem jednotky (ale ne všechny CSS hodnoty!)

### Kde to je v kódu (nastavení)? Ukládá se to?

**Location:**
- `src/App.tsx:182-185` - Aplikace scale na `document.documentElement.style.fontSize`
- `src/pages/Settings.tsx:1507-1544` - UI slider a rychlé tlačítka (85%, 100%, 115%, 135%)
- `src/App.tsx:65` - Ukládá se do localStorage: `STORAGE_KEYS.UI_SETTINGS` (`"jobsheet_ui_settings_v1"`)

### Je to Tauri issue (dpi/scale) nebo CSS?

**Problém:** Aplikuje se jen `fontSize` na root, ale:
- ❌ Neovlivňuje padding/margin v px
- ❌ Neovlivňuje border-width v px
- ❌ Neovlivňuje fixed-size komponenty

**Řešení by mělo být:**
- CSS custom properties nebo transform: scale() na root
- Nebo použít CSS `zoom` (ale deprecated)
- Nebo všechny hodnoty v rem jednotkách (refaktoring)

---

## C) User foto + nick + audit trail

### Existuje profiles tabulka (user_id, nick, avatar_url)? Pokud ne, navrhni schema.

**❌ NE** - Neexistuje profiles tabulka

**Navrhované schema:**
```sql
CREATE TABLE public.profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  nick TEXT,
  avatar_url TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_profiles_id ON public.profiles(id);
```

### Existuje už audit log tabulka pro ticket events? Pokud ne, navrhni.

**❌ NE** - Neexistuje audit log tabulka

**Navrhované schema:**
```sql
CREATE TABLE public.ticket_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_id UUID NOT NULL REFERENCES public.tickets(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE SET NULL,
  action TEXT NOT NULL, -- 'created', 'updated', 'status_changed', 'diagnostic_added', 'repair_added', 'comment_added', 'deleted', 'restored'
  payload JSONB, -- flexibilní data podle action
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_ticket_events_ticket_id ON public.ticket_events(ticket_id);
CREATE INDEX idx_ticket_events_user_id ON public.ticket_events(user_id);
CREATE INDEX idx_ticket_events_created_at ON public.ticket_events(created_at);
```

### Kde se dnes ukládají komentáře a kdo je autor? (DB vs localStorage)

**Ukládání:**
- `src/pages/Orders.tsx:196` - `COMMENTS_STORAGE_KEY = "jobsheet_ticket_comments_v1"`
- `src/pages/Orders.tsx:337-349` - `safeLoadComments()` / `safeSaveComments()`
- **❌ LOCALSTORAGE** - Ne DB!
- **❌ Není autor** - Komentáře nemají `user_id` ani `author`

**Typ komentáře:**
```typescript
type Comment = {
  id: string;
  ticketId: string;
  text: string;
  createdAt: string;
  // CHYBÍ: userId, authorName
};
```

### Jak budeme mapovat membership user → display name v UI?

**Současný stav:**
- `Sidebar.tsx:304` - Používá `userEmail?.charAt(0).toUpperCase()` pro avatar
- **❌ Žádný display name** - Pouze email

**Plán:**
1. Vytvořit `profiles` tabulku
2. V Settings/Team management: umožnit editaci `nick`
3. V UI: `profile.nick || user.email` jako display name
4. V audit logu: zobrazit `nick` nebo fallback na `email`

---

## D) Sidebar service switch + remember last service

### Je UI pro přepínání service už někde?

**❌ NE** - Není UI pro přepínání service v Sidebaru
- Sidebar zobrazuje jen navigaci (Orders, Customers, Settings, atd.)
- Service switching by mělo být v Settings nebo v Sidebar dropdown

### Kde se drží activeServiceId a jak se persistuje?

**Location:**
- `src/App.tsx:87-94` - State `activeServiceId` inicializován z localStorage
- `src/App.tsx:136` - Načítá se z `STORAGE_KEYS.ACTIVE_SERVICE_ID` (`"jobsheet_active_service_id_v1"`)
- `src/App.tsx:174` - Ukládá se: `localStorage.setItem(STORAGE_KEYS.ACTIVE_SERVICE_ID, activeServiceId)`

### Po sign-in: jak se volí default service (první membership / poslední uložený)?

**Logic v `src/App.tsx:133-154`:**
1. Pokud je `activeServiceId` null → zkusí načíst z localStorage
2. Pokud uložený service existuje v memberships → použije ho
3. Pokud ne → použije první service z listu (`servicesList[0].service_id`)

**❌ Problém:** Nebere v úvahu "last active" - jen první z listu nebo uložený

### Je persistence už hotová, nebo jen invalidace localStorage?

**✅ Persistence hotová:**
- Ukládá se při změně: `src/App.tsx:174`
- Načítá se při startu: `src/App.tsx:89, 136`
- Invalidace při service change: `src/lib/storageInvalidation.ts:26` - maže `ACTIVE_SERVICE_ID`

---

## E) Customers → zakázky v profilu + předvyplnění

### Je tickets.customer_id už napojené na customers?

**✅ ANO**
- Migration: `20250106000000_add_customers_phone_norm_and_tickets_customer_id.sql`
- `tickets.customer_id UUID REFERENCES public.customers(id) ON DELETE SET NULL`
- Index: `idx_tickets_customer_id`

### Má Customers detail view query na tickets? Pokud ne, kde to ideálně napojit?

**✅ ANO** - Už implementováno:
- `src/pages/Customers.tsx:205-236` - Načítá `ticketIds` pro každého customer
- Query: `SELECT id, customer_id FROM tickets WHERE service_id = ? AND customer_id IN (?) AND deleted_at IS NULL`
- Ukládá do: `customer.ticketIds: string[]`

### "Create ticket from customer" – kde se tvoří ticket a jak předat customer data do draftu?

**✅ Částečně implementováno:**
- `src/App.tsx:107` - `newOrderPrefill: { customerId?: string }`
- `src/pages/Orders.tsx:3682` - Props `newOrderPrefill` se předává do Orders
- **❌ Problém:** Orders přijímá `newOrderPrefill`, ale nevidím, kde se používá pro předvyplnění

**Co chybí:**
- V Customers detail view: tlačítko "Vytvořit zakázku"
- Předání customer data do `newOrderPrefill` (ne jen `customerId`)
- V Orders: použít `newOrderPrefill` pro předvyplnění formuláře

---

## F) Mazání zakázek + kdo smazal

### Má tickets deleted_at? Má deleted_by (user_id)? Pokud ne, navrhni.

**✅ Má `deleted_at`:**
- Migration: `20250110000000_add_soft_delete_and_restore_ticket_rpc.sql`
- RPC: `soft_delete_ticket()` a `restore_ticket()`

**❌ NEMÁ `deleted_by`:**
- `deleted_at` existuje, ale neukládá se `user_id`

**Navrhované rozšíření:**
```sql
ALTER TABLE public.tickets
  ADD COLUMN deleted_by UUID REFERENCES auth.users(id) ON DELETE SET NULL;

-- Update RPC function:
-- V soft_delete_ticket(): SET deleted_at = now(), deleted_by = auth.uid()
```

### UI: kde je delete button (detail / list)? Je confirm dialog?

**❌ NENÍ implementováno:**
- Nevidím delete button v Orders detail view
- Nevidím delete button v Orders list view
- Neexistuje confirm dialog pro delete

**Co je potřeba:**
- Delete button v detail view (např. v toolbar)
- ConfirmDialog komponenta už existuje (`src/components/ConfirmDialog.tsx`)
- Volat RPC: `supabase.rpc('soft_delete_ticket', { p_ticket_id: ticketId })`

### Realtime: máme subscription i na DELETE/UPDATE s deleted_at?

**✅ Částečně:**
- `src/pages/Orders.tsx:3892-3914` - Realtime handler pro UPDATE s `deleted_at`
- Pokud `deleted_at` změněn z null na not null → odstraní z listu
- **❌ DELETE event:** Nevidím handler pro DELETE event (hard delete by neměl nastat, ale pro jistotu)

---

## G) Modely/znacky + sklad do DB

### Jak je to dnes: lokální data / hardcode / mock?

**✅ LOCALSTORAGE:**
- `src/pages/Devices.tsx:4` - `STORAGE_KEY = "jobsheet_devices_v1"`
- `src/pages/Inventory.tsx:6` - `STORAGE_KEY = "jobsheet_inventory_v1"`
- Data: brands, categories, models, repairs (v Devices)
- Data: products, categories (v Inventory)

**Struktura:**
```typescript
// Devices
type DevicesData = {
  brands: Brand[];
  categories: Category[];
  models: DeviceModel[];
  repairs: Repair[];
};

// Inventory
type InventoryData = {
  products: Product[];
  categories: ProductCategory[];
};
```

### Jaké entity potřebujeme: brands, models, parts_inventory, stock_moves?

**Navrhované schema:**
```sql
-- Brands (značky)
CREATE TABLE public.brands (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  service_id UUID NOT NULL REFERENCES public.services(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(service_id, name)
);

-- Models (modely zařízení)
CREATE TABLE public.device_models (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  service_id UUID NOT NULL REFERENCES public.services(id) ON DELETE CASCADE,
  brand_id UUID REFERENCES public.brands(id) ON DELETE SET NULL,
  name TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(service_id, name)
);

-- Products (produkty/součástky)
CREATE TABLE public.products (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  service_id UUID NOT NULL REFERENCES public.services(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  sku TEXT,
  price DECIMAL(10,2),
  stock INTEGER DEFAULT 0,
  category_id UUID REFERENCES public.product_categories(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Stock moves (skladové pohyby)
CREATE TABLE public.stock_moves (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  service_id UUID NOT NULL REFERENCES public.services(id) ON DELETE CASCADE,
  product_id UUID NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  quantity INTEGER NOT NULL, -- positive = in, negative = out
  type TEXT NOT NULL, -- 'purchase', 'sale', 'adjustment', 'repair_used'
  ticket_id UUID REFERENCES public.tickets(id) ON DELETE SET NULL, -- pokud souvisí s ticketem
  user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  note TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);
```

### Kde to bude používat Orders (autocomplete)?

**Současné použití:**
- `src/pages/Orders.tsx:4163-4174` - `availableRepairs` se načítá z `devicesData.repairs` (localStorage)
- `DeviceAutocomplete` komponenta používá `devicesData.models`

**Po migraci:**
- Načítat z DB: `SELECT * FROM device_models WHERE service_id = ?`
- Načítat z DB: `SELECT * FROM repairs WHERE service_id = ?` (třeba `ticket_repairs` tabulka?)

### Jaké minimální MVP: jen seznam modelů+brand, nebo i skladové pohyby?

**Doporučené MVP:**
1. **Fáze 1:** Brands + Models (pro autocomplete v Orders)
2. **Fáze 2:** Products + základní stock (bez stock_moves, jen `stock` sloupec)
3. **Fáze 3:** Stock moves (pro audit a historie)

---

## H) Supabase výkon, "issues need attention"

### Co přesně ukazuje Supabase Overview (jaké issues)? (poslat screenshot nebo popis)

**❓ Nelze odpovědět bez screenshotu / přístupu k Supabase dashboardu**

**Možné issues:**
- Chybějící indexy
- Pomalé query
- Vysoká spotřeba storage
- RLS policies performance
- Realtime connections

### Máme indexy na klíčových polích (service_id, customer_id, deleted_at, updated_at)?

**Z migrations:**
- ✅ `idx_customers_phone_norm` (phone_norm)
- ✅ `idx_customers_service_phone_norm_unique` (service_id, phone_norm)
- ✅ `idx_tickets_customer_id` (customer_id)
- ✅ `idx_tickets_service_id` (pravděpodobně, ale nevidím v migrations)

**❓ Chybí explicitní indexy na:**
- `tickets.service_id` (pokud neexistuje)
- `tickets.deleted_at` (pro soft delete queries)
- `tickets.updated_at` (pro ordering)
- `tickets.created_at` (pro ordering)

**Doporučené indexy:**
```sql
CREATE INDEX IF NOT EXISTS idx_tickets_service_deleted 
  ON public.tickets(service_id, deleted_at) 
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_tickets_updated_at 
  ON public.tickets(updated_at DESC);
```

### Velikost storage (fotky): bucket, transformace, cache, limity?

**Současný stav:**
- `supabase/config.toml:109-113` - Storage buckets jsou zakomentované
- **❌ Není storage bucket** pro fotky
- **❌ Fotky se ukládají jako base64** v `tickets.diagnostic_photos` (JSONB array stringů)

**Problém:**
- Base64 fotky = velká velikost databáze
- Žádná transformace/optimalizace
- Žádný CDN/cache

**Doporučení:**
1. Vytvořit storage bucket: `diagnostic-photos`
2. Uploadovat fotky do storage (ne base64 do DB)
3. Ukládat jen URL v `tickets.diagnostic_photos`
4. Použít Supabase Image Transformation API pro resize/optimization

---

## I) Statistiky

### Je Statistics.tsx jen placeholder? Co má být MVP metrik?

**✅ NENÍ placeholder - fungující implementace:**
- `src/pages/Statistics.tsx:212+` - Plně funkční komponenta
- Metriky:
  - Celkem zakázek
  - Celkový příjem / náklady / zisk
  - Průměrná cena zakázky
  - Počty podle statusu
  - Nejčastější opravy
  - Nejčastější zařízení
  - Měsíční přehled

**❌ Problém:** Používá `safeLoadTickets()` z localStorage (mock data fallback)
- `src/pages/Statistics.tsx:3` - `import { MOCK_TICKETS }`
- `src/pages/Statistics.tsx:18-26` - `safeLoadTickets()` načítá z localStorage nebo MOCK_TICKETS

### Jsou data zdroje v DB (RPC/Views), nebo se to má počítat v klientu?

**❌ NENÍ v DB:**
- Vše se počítá v klientu z `tickets` array
- Žádné RPC funkce pro statistiky
- Žádné materialized views

**Doporučení:**
- Pro malé datové sady: OK počítat v klientu
- Pro větší: RPC funkce nebo Views s agregacemi
- Pro real-time: Materialized views s refresh

### Pokud je tam mock fallback, je to plánované odstranit až po dodělání?

**✅ Mock fallback:**
- `src/pages/Statistics.tsx:21-22` - Pokud není localStorage, použije `MOCK_TICKETS`
- **Plán:** Po migraci na cloud-first, odstranit mock fallback

---

## J) Offline / ztráta připojení

### Existuje detekce offline stavu a UX banner?

**✅ ČÁSTEČNĚ:**
- `src/components/OnlineGate.tsx` - Komponenta kontroluje Supabase připojení
- Pokud není online → zobrazí error místo aplikace
- **❌ Problém:** Blokuje celou aplikaci, ne jen banner

**Detekce:**
- `src/components/OnlineGate.tsx:26-54` - Ping Supabase každých 30 sekund
- Pokud chyba (network/fetch) → `setIsOnline(false)`

### Co se má stát při save bez připojení: blokovat, queue, nebo local draft?

**Současné chování:**
- `OnlineGate` blokuje celou aplikaci pokud není online
- **❌ Není queue** pro offline změny
- **❌ Není local draft** mechanismus

**Doporučení pro MVP:**
- Banner s warning: "Offline - změny se uloží po obnovení připojení"
- Queue změn do localStorage
- Po reconnect: sync queue

### Jaký je minimální "safe" MVP: jen warning + disable save?

**Minimální MVP:**
1. ✅ Warning banner (není blocking)
2. ✅ Disable save buttons (pokud offline)
3. ⚠️ Queue (volitelné pro MVP)
4. ⚠️ Auto-sync (volitelné pro MVP)

---

## K) Role management (owner nemůže měnit role)

### Je to UI problém nebo RLS/policy?

**✅ Edge Function logic:**
- `supabase/functions/team-update-role/index.ts:102-117` - Ochrana proti downgrade posledního ownera
- Pokud `targetMembership.role === "owner"` a `roleNorm !== "owner"` → zkontroluje, jestli je víc než 1 owner
- Pokud je jen 1 owner → error: "Cannot downgrade the last owner"

**❓ Možný problém:**
- Pokud owner chce změnit role jiného ownera → možná UI neumožňuje vybrat owner role?
- Nebo Edge Function vrací chybu i když to není poslední owner?

### Která Edge Function/RPC to dělá? Jaký je error?

**Edge Function:**
- `supabase/functions/team-update-role/index.ts`
- RPC: Ne, je to Edge Function (ne RPC)

**Error:**
- `"Cannot downgrade the last owner"` (řádek 113)
- Nebo `"Caller must be owner or admin to update roles"` (řádek 82)

### Jaké role existují (owner/admin/member) a jaká jsou pravidla změn?

**Role:**
- `owner` - Vlastník servisu
- `admin` - Administrátor
- `member` - Člen

**Pravidla (z Edge Function):**
- ✅ Owner nebo Admin může měnit role
- ✅ Owner nemůže být downgrade, pokud je poslední owner
- ❌ Owner může změnit jiného ownera na admin/member (pokud není poslední)

---

## L) Orders stránkování / virtualizace

### Kolik zakázek typicky v seznamu?

**❓ Nelze odpovědět bez znalosti produkčních dat**

**Odhad:** 50-500 zakázek na service (záleží na velikosti servisu)

### Používáme query limit/offset, nebo taháme vše?

**❌ Taháme VŠE:**
- `src/pages/Orders.tsx:3513+` - Query bez `limit()` nebo `offset()`
- Načítá všechny tickets pro service: `.eq("service_id", activeServiceId).is("deleted_at", null)`
- Ukládá do state: `setCloudTickets(data)`

**Problém:** Pro velké množství tickets = pomalé načítání + vysoká paměť

### Má být stránkování nebo virtuální list (react-window)? Co je rychlejší MVP?

**Doporučení:**
1. **Stránkování (limit/offset):**
   - Rychlejší implementace
   - Jednodušší pro uživatele (klasický pattern)
   - Problém: nevidí všechny tickets najednou

2. **Virtualizace (react-window):**
   - Rychlejší pro velké listy
   - Uživatel vidí všechny tickets (scroll)
   - Složitější implementace
   - Problém: potřebuje načíst všechna data

**MVP doporučení:** Stránkování (limit/offset) - 50 tickets na stránku

---

## M) LocalStorage audit

### Seznam klíčů v localStorage, které app používá

**Z `src/constants/storageKeys.ts`:**
1. `UI_SETTINGS` = `"jobsheet_ui_settings_v1"` - UI konfigurace (scale, fab, display mode)
2. `ACTIVE_SERVICE_ID` = `"jobsheet_active_service_id_v1"` - Aktivní service ID
3. `COMPANY` = `"jobsheet_company_v1"` - Data společnosti (název, adresa, IČO, atd.)
4. `DOCUMENTS_CONFIG` = `"jobsheet_documents_config_v1"` - Konfigurace dokumentů (co zahrnout do print)
5. `INVENTORY` = `"jobsheet_inventory_v1"` - Sklad (produkty, kategorie)
6. `DEVICES` = `"jobsheet_devices_v1"` - Značky, modely, opravy

**Z `src/pages/Orders.tsx`:**
7. `"jobsheet_ticket_comments_v1"` - Komentáře k tickets (COMMENTS_STORAGE_KEY)
8. `"jobsheet_new_order_draft_v1"` - Draft nové zakázky (NEW_ORDER_DRAFT_KEY)
9. `"jobsheet_documents_config_v1"` - (duplicitní s #4)

**Z `src/pages/Inventory.tsx`:**
10. `"jobsheet_inventory_display_mode"` - Display mode pro inventory

**Z `src/pages/Statistics.tsx`:**
11. `"jobsheet_tickets_v1"` - Tickets (TICKETS_STORAGE_KEY) - fallback/mock

### U každého: proč existuje, je to nutné, a jaký je plán migrace do cloudu?

1. **UI_SETTINGS** - ✅ Nutné (user preference, ne cloud data) - ZŮSTANE
2. **ACTIVE_SERVICE_ID** - ✅ Nutné (session state) - ZŮSTANE (nebo přesunout do session storage)
3. **COMPANY** - ❌ Mělo by být v DB (`service_settings` tabulka) - MIGROVAT
4. **DOCUMENTS_CONFIG** - ❌ Mělo by být v DB (`service_document_settings`) - MIGROVAT (už existuje tabulka!)
5. **INVENTORY** - ❌ Mělo být v DB (viz G) - MIGROVAT
6. **DEVICES** - ❌ Mělo být v DB (viz G) - MIGROVAT
7. **COMMENTS** - ❌ Mělo být v DB (`ticket_comments` tabulka) - MIGROVAT
8. **NEW_ORDER_DRAFT** - ⚠️ OK pro draft (dočasné data) - ZŮSTANE nebo přesunout do session storage
9. **INVENTORY_DISPLAY_MODE** - ✅ User preference - ZŮSTANE
10. **TICKETS** - ❌ Fallback/mock - ODSTRAŇIT po cloud-first migraci

---

## N) Historie zakázky + kdo smazal

### Existuje audit log nebo aspoň created_by, updated_by, deleted_by?

**❌ NE:**
- `tickets` tabulka nemá `created_by`, `updated_by`, `deleted_by`
- Neexistuje `ticket_events` tabulka pro audit log

**Co existuje:**
- `tickets.created_at` - Kdy byl vytvořen
- `tickets.updated_at` - Kdy byl naposledy upraven
- `tickets.deleted_at` - Kdy byl smazán (ale ne kdo)

### Kde vytvořit "History modal" a odkud brát data?

**Kde vytvořit:**
- V `src/pages/Orders.tsx` - Detail view komponenta
- Tlačítko "Historie" v toolbar detail view
- Modal/Dialog komponenta (podobně jako ConfirmDialog)

**Odkud brát data (po implementaci audit logu):**
1. Vytvořit `ticket_events` tabulku (viz C)
2. Trigger na `tickets` tabulku pro INSERT/UPDATE/DELETE
3. Query: `SELECT * FROM ticket_events WHERE ticket_id = ? ORDER BY created_at DESC`
4. Zobrazit v modal: action, user (nick/email), timestamp, payload

### Minimální verze: jen status changes + performed repairs + diagnostic text changes.

**Minimální implementace:**
1. **Trigger na `tickets.status` změny:**
   ```sql
   CREATE TRIGGER log_ticket_status_change
   AFTER UPDATE OF status ON tickets
   FOR EACH ROW
   WHEN (OLD.status IS DISTINCT FROM NEW.status)
   EXECUTE FUNCTION log_ticket_event('status_changed');
   ```

2. **Manuální logování v aplikaci:**
   - Při změně `performed_repairs` → `INSERT INTO ticket_events(...)`
   - Při změně `diagnostic_text` → `INSERT INTO ticket_events(...)`

3. **History modal:**
   - Načíst `ticket_events` pro ticket
   - Zobrazit: datum, uživatel, akce, změny (diff)

