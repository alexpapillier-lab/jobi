# Jobsheet Online - Kontext a Architektura

## Co je aplikace

**Jobsheet Online** je desktopová aplikace pro správu servisních zakázek (tickets/orders) s cloud synchronizací.

**Tech stack:**
- **Frontend:** React 19 + TypeScript + Vite
- **Desktop:** Tauri v2 (Rust backend)
- **Backend:** Supabase (PostgreSQL + Auth + Realtime + Storage)
- **Styling:** Custom CSS s CSS variables (theme system)

**Architektura:**
- **Cloud-first:** Primární datový zdroj je Supabase, localStorage je fallback pro offline
- **Multi-tenant:** Všechna data jsou scoped podle `service_id`
- **Real-time:** Používá Supabase Postgres Changes pro live updates
- **Bezpečnost:** RLS (Row Level Security) vynucená v DB, žádná důvěra v klienta

---

## Klíčové architektonické zásady

### 1. `editedTicket` = jediný source of truth v edit módu

**Pravidlo:** Když je ticket v edit módu (`isEditing === true`), všechny změny se ukládají do `editedTicket` state, ne do `detailedTicket` nebo přímo do `cloudTickets`/`localTickets`.

**Implementace:**
- `startEditing()` kopíruje `detailedTicket` → `editedTicket`
- Všechny edit handlers (`addPerformedRepair`, `removePerformedRepair`, `updatePerformedRepair*`, `handleDiagnosticTextChange`, `handleDiscountChange`) kontrolují `isEditing`:
  - Pokud `true`: zapisují do `setEditedTicket()`
  - Pokud `false`: zapisují přímo do DB/localStorage
- `saveTicketChanges()` vždy používá hodnoty z `editedTicket` (ne z `detailedTicket`)
- UI v edit módu zobrazuje data z `editedTicket`, ne z `detailedTicket`

**Důvod:** Zajišťuje konzistenci - všechny změny v edit módu jsou "pending" až do `saveTicketChanges()`, žádné "partial saves". Toto bylo hlavní zdroj historických bugů.

### 2. Žádné ukládání z view objektů

**Pravidlo:** Nikdy neukládat data přímo z view objektů (např. z DOM, z render props). Všechny změny musí projít přes state management (`editedTicket`, `setEditedTicket`).

**Důvod:** Zajišťuje, že data jsou vždy v konzistentním stavu a procházejí validací.

### 3. Cloud-first s localStorage fallback

**Pravidlo:** 
- Pokud `supabase && activeServiceId`: zobrazovat a ukládat pouze cloud data
- Pokud `!supabase || !activeServiceId`: použít localStorage jako fallback

**Implementace:**
- `Orders.tsx`: `tickets` useMemo vrací `cloudTickets` v cloud módu, jinak kombinuje `localTickets` + `cloudTickets`
- Všechny create/update operace kontrolují `activeServiceId && supabase` před voláním Supabase API
- **Cloud režim:** Zobrazují se POUZE cloud tickets (z DB), local tickets se nesmí míchat

### 4. Multi-tenant scoping

**Pravidlo:** Všechna data jsou vždy filtrována podle `activeServiceId`.

**Implementace:**
- Tickets: `.eq("service_id", activeServiceId)`
- Statuses: `.eq("service_id", activeServiceId)` (v `StatusesStore`)
- Document settings: `.eq("service_id", activeServiceId)`
- Všechny dotazy obsahují `service_id` filter
- RLS policies vynucují, že uživatel vidí pouze data svého servisu

---

## Struktura aplikace

### Hlavní stránky (`src/pages/`)

1. **Orders.tsx** - Správa zakázek (tickets)
   - Zobrazuje seznam zakázek s filtry
   - Detail view s edit módem
   - Generování dokumentů (zakázkový list, diagnostický protokol, záruční list)
   - Preview/print/export funkcionalita
   - Realtime updates

2. **Customers.tsx** - Správa zákazníků
   - Seznam zákazníků
   - Detail zákazníka s historií zakázek
   - (Zatím localStorage only)

3. **Devices.tsx** - Katalog zařízení
   - Hierarchie: Brands → Categories → Models → Repairs
   - (Zatím localStorage only)

4. **Inventory.tsx** - Sklad
   - Produkty s cenami a skladovými zásobami
   - (Zatím localStorage only)

5. **Statistics.tsx** - Statistiky
   - (Rozpracované - stránka existuje, funkcionalita není implementována)

6. **Settings.tsx** - Nastavení
   - Nastavení společnosti (company data)
   - Správa statusů (service_statuses) - CRUD pro owner/admin
   - Konfigurace dokumentů (service_document_settings) - cloud + realtime
   - Team management (invites, memberships) - plně funkční

### State management

**StatusesStore.tsx:**
- Context provider pro statusy
- Načítá statusy z `service_statuses` pro `activeServiceId`
- Cache v localStorage jako fallback
- Default statusy v paměti, pokud DB nevrátí žádné

**LocalStorage keys:**
- `jobsheet_last_active_service_id` - poslední aktivní service
- `jobsheet_ui_settings_v1` - UI konfigurace
- `jobsheet_devices_v1` - katalog zařízení
- `jobsheet_inventory_v1` - sklad
- `jobsheet_company_v1` - data společnosti
- `jobsheet_customers_v1` - zákazníci (lokální)
- `jobsheet_tickets_v1` - tickets (lokální fallback)
- `jobsheet_documents_config_v1` - konfigurace dokumentů (fallback)
- `jobsheet_pending_invite_token` - pending invite token

### Auth a Service Management

**AuthProvider.tsx:**
- Supabase Auth wrapper
- `signIn`, `signUp`, `signOut` funkce
- Session management (uložena v localStorage webview v Tauri)

**App.tsx:**
- Načítá `service_memberships` pro přihlášeného uživatele
- Určuje `activeServiceId`:
  1. Z localStorage (pokud má user stále membership)
  2. Z owner services (preferuje owner role)
  3. Z prvního membership (deterministicky)
- Auto-accept invite tokens po registraci
- Pokud user nemá membership → error screen

---

## Datový model

### Tickets (zakázky)

**Hlavní tabulka:** `tickets`

**Klíčová pole:**
- `id` (UUID) - primární identifikátor
- `service_id` (UUID, FK → services)
- `status` (TEXT, matchuje `service_statuses.key`)
- `title` (text) - název zařízení
- `notes` (text) - popis problému
- `customer_name`, `customer_phone`, `customer_email`, `customer_company`, `customer_ico`, `customer_dic`, `customer_info`, `customer_address_*`
- `device_label`, `device_brand`, `device_model`, `device_serial`, `device_imei`, `device_condition`, `device_note`, `device_passcode`
- `estimated_price` (numeric)
- `external_id`
- `handoff_method`
- `performed_repairs` (JSONB) - array of `PerformedRepair` ✅ **V payloadu**
- `diagnostic_text` (TEXT) ✅ **V payloadu**
- `diagnostic_photos` (TEXT[]) - array of URLs
- `discount_type` (TEXT: "percentage" | "amount" | null) ✅ **V payloadu**
- `discount_value` (NUMERIC) ✅ **V payloadu**
- `created_at`, `updated_at`

**Mapping:** `mapSupabaseTicketToTicketEx()` převádí snake_case → camelCase

**Identifikace:**
- V UI se zobrazuje `id.slice(0, 8).toUpperCase()`
- `code` je **legacy** (local tickets), v cloudu se nepoužívá

### Service Statuses

**Tabulka:** `service_statuses`

**Klíčová pole:**
- `service_id` (UUID, FK → services)
- `key` (TEXT) - unikátní klíč statusu (UNIQUE per service)
- `label` (TEXT) - zobrazovaný název
- `bg`, `fg` (TEXT) - barvy
- `is_final` (BOOLEAN) - zda je status finální
- `order_index` (INTEGER) - pořadí v UI

**Scoping:** Statusy jsou per `service_id`, stejný `key` může existovat v různých servisech.

**CRUD:** Pouze pro `owner/admin` role.

### Service Document Settings

**Tabulka:** `service_document_settings`

**Účel:** Konfigurace, které sekce se zobrazí v generovaných dokumentech (zakázkový list, diagnostický protokol, záruční list).

**Realtime:** Aplikace se přihlašuje k realtime subscription pro změny v této tabulce.

### Service Invites

**Tabulka:** `service_invites`

**Účel:** Pozvánky nových členů do servisu.

**Flow:**
1. Admin/owner vytvoří pozvánku přes Edge Function `invite-create`
2. Token se uloží v DB a dočasně v `localStorage` jako `jobsheet_pending_invite_token`
3. Uživatel otevře `jobsheet://invite?token=...`
4. Pokud není přihlášen → Login / Registrace
5. Po loginu se automaticky zavolá `invite-accept` a nastaví se `activeServiceId`

**Token:** Nemá expiraci (zatím).

### Service Memberships

**Tabulka:** `service_memberships`

**Role:**
- `owner` - root owner nelze změnit/odebrat, poslední owner nelze odebrat
- `admin` - může spravovat tým
- `member` - základní přístup

**Bezpečnost:** DB triggery vynucují integritu:
- `prevent_root_owner_change` - root owner nelze změnit roli
- `prevent_last_owner_removal` - posledního ownera nelze odstranit

---

## UI/UX specifika

### Edit mode v Orders

**Pravidla:**
- V edit módu se zobrazuje pouze tlačítko "Zavřít" (uloží změny a vrátí se do detail view)
- Žádné tlačítko "Zrušit" (uživatel může změny prostě neuložit zavřením)
- Document action pickers (Náhled, Tisk, Stáhnout) jsou skryté v edit módu
- Všechny změny se ukládají do `editedTicket`, ne do `detailedTicket`

### Dokumenty

**Typy dokumentů:**
1. **Zakázkový list** - základní informace o zakázce
2. **Diagnostický protokol** - diagnostika a fotografie (zobrazí se pouze pokud má ticket diagnostiku)
3. **Záruční list** - záruční certifikát

**Generování:**
- Funkce `generateTicketHTML()`, `generateDiagnosticProtocolHTML()`, `generateWarrantyHTML()`
- Používají konfiguraci z `service_document_settings` (nebo localStorage fallback)
- Vrací HTML string, který se pak zobrazí/tiskne/stáhne

---

## Specifika Tauri v2

### Pluginy

**Používané pluginy:**
- `@tauri-apps/plugin-dialog` - dialogy (save, message)
- `@tauri-apps/plugin-fs` - file system operace
- `@tauri-apps/plugin-opener` - otevírání souborů/URL (používá se pouze pro print, ne pro preview)

**Registrace:** V `src-tauri/src/lib.rs`:
```rust
.plugin(tauri_plugin_opener::init())
.plugin(tauri_plugin_fs::init())
.plugin(tauri_plugin_dialog::init())
```

### Preview a Print

**Preview:**
- Používá `WebviewWindow` s blob: URL (NE data: URL, NE window.open, NE opener)
- Blob URL se vytvoří z HTML contentu
- Okno se zobrazí interně v Tauri aplikaci

**Print:**
- Stejně jako preview: `WebviewWindow` s blob: URL
- Do HTML se přidá auto-print script, který spustí `window.print()` po načtení
- Uživatel může tisknout z otevřeného okna

**Implementace:**
```typescript
const blob = new Blob([htmlContent], { type: "text/html;charset=utf-8" });
const blobUrl = URL.createObjectURL(blob);
const win = new WebviewWindow("preview", {
  url: blobUrl,
  title: "Náhled dokumentu",
  width: 900,
  height: 700,
  center: true,
});
```

### Capabilities a Permissions

**Soubor:** `src-tauri/capabilities/default.json`

**Klíčové permissions:**
- `core:default`
- `core:webview:allow-create-webview-window` - pro vytváření preview/print oken
- `core:webview:allow-create-webview`
- `dialog:default`, `dialog:allow-save`, `dialog:allow-message` - pro dialogy
- `fs:default`, `fs:allow-write-text-file`, `fs:scope-temp` - pro file operace
- `opener:default`, `opener:allow-open-path` - pro print (používá se opener pro temp soubory)

**Scope:**
- `opener`: `$TEMP/*` - povolené cesty pro opener
- `fs`: `$TEMP/*` - povolené cesty pro file system

**Window mapping:**
- Capability "default" je přiřazena k oknu "main" přes `windows: ["main"]`

---

## Realtime

**Aktivní realtime:**
- `tickets` (INSERT / UPDATE / DELETE) - live updates při změnách
- `service_document_settings` - live updates konfigurace dokumentů

**Implementace:**
- Supabase channel: `tickets:${activeServiceId}`
- `supabase.channel().on("postgres_changes", ...).subscribe()`
- Cleanup při unmount: `supabase.removeChannel(channel)`
- UI se aktualizuje okamžitě bez reloadu

**Plán:**
- Realtime pro komentáře
- Realtime pro statusy (service_statuses)

---

## Bezpečnost (RLS)

**RLS je:**
- ✅ Zapnuté
- ✅ Vynucené (`force row level security`)
- ✅ Nepoužívá `public`, ale `authenticated`

**Chráněné tabulky:**
- `tickets`
- `service_statuses`
- `service_memberships`
- `services`
- `service_invites`
- `service_document_settings`

**Zásady:**
- SELECT / INSERT / UPDATE / DELETE vždy kontrolují:
  - membership
  - role (owner/admin tam, kde je potřeba)
- `WITH CHECK` brání zápisu cizího `service_id`
- DB triggery vynucují integritu dat (root owner, poslední owner)

**Edge Functions:**
- Vše řešeno přes Edge Functions (deploy s `--no-verify-jwt`)
- Autorizace probíhá **uvnitř funkcí**
- DB operace citlivé na RLS běží přes **service role client**

**Edge Functions:**
- `team-list` - seznam členů týmu
- `invite-create` - vytvoření pozvánky
- `invite-accept` - přijetí pozvánky
- `team-update-role` - změna role člena
- `team-remove-member` - odebrání člena
- `services-list` - seznam servisů
- `invite-delete` - smazání pozvánky

---

## Známé problémy a miny

### 1. Permissions hell v Tauri v2

**Problém:** Tauri v2 má striktní permission systém. Pokud chybí permission, aplikace selže s "not allowed" chybou.

**Řešení:**
- Vždy kontrolovat error logy pro přesné permission IDs
- Používat `capabilities/default.json` s explicitními permissions
- Pro webview okna: `core:webview:allow-create-webview-window`
- Pro dialogy: `dialog:allow-save`, `dialog:allow-message`
- Pro FS: `fs:allow-write-text-file`, `fs:scope-temp`

### 2. Data URL nejsou povolené

**Problém:** `data:text/html;...` URL často nefungují v Tauri webview.

**Řešení:** Používat blob: URL místo data: URL:
```typescript
const blob = new Blob([htmlContent], { type: "text/html;charset=utf-8" });
const blobUrl = URL.createObjectURL(blob);
```

### 3. Opener scope nefunguje spolehlivě

**Problém:** `opener.openPath()` často selže s "not allowed" i když je scope nastaven.

**Řešení:** Pro preview/print používat interní `WebviewWindow` místo `opener.openPath()`.

### 4. Window label kolize

**Problém:** Pokud se vytvoří více oken se stejným label, může dojít ke kolizi.

**Řešení:** Používat fixní labely ("preview", "print") a ne dynamické s `Date.now()`.

### 5. DELETE v Supabase JS

**Problém:** DELETE bez `.select()` vrací `0 rows`, i když se DELETE provede.

**Řešení:** Pokud potřebujete potvrzení, použijte `.select()`.

### 6. PGRST204 chyby

**Problém:** `PGRST204: Could not find the 'XYZ' column of 'tickets'`

**Příčina:** UI posílá sloupec, který není v DB.

**Řešení:** 
- `ALTER TABLE ... ADD COLUMN`
- `pg_notify('pgrst','reload schema')` pro reload PostgREST schématu

---

## Stav projektu

### Co funguje ✅

**Autentizace:**
- Supabase Auth (sign in, sign up, sign out)
- Invite token systém (auto-accept po registraci)
- Service membership management
- Auto-accept invite tokens po registraci

**Orders (Zakázky):**
- Zobrazení seznamu zakázek s filtry
- Detail view s edit módem
- Vytváření nových zakázek
- Změna statusu
- Ukládání změn (performed_repairs, diagnostic_text, discount) ✅
- Realtime updates
- Cloud režim stabilní
- Schema DB odpovídá payloadu UI

**Customers (Zákazníci):**
- Seznam zákazníků
- Detail zákazníka
- Propojení s zakázkami
- (Zatím localStorage only)

**Devices (Zařízení):**
- Hierarchie Brands → Categories → Models → Repairs
- (Zatím localStorage only)

**Inventory (Sklad):**
- Produkty s cenami a zásobami
- (Zatím localStorage only)

**Settings (Nastavení):**
- Nastavení společnosti
- Správa statusů (CRUD) ✅
- Konfigurace dokumentů (cloud + realtime) ✅
- Team management (invites, members) ✅
  - Vytváření pozvánek
  - Zobrazení pending invites
  - Mazání pozvánek
  - Změna rolí členů
  - Odebírání členů

**Dokumenty:**
- Generování HTML pro zakázkový list, diagnostický protokol, záruční list
- Preview v interním webview okně ✅
- Print s auto-print scriptem ✅
- Export do HTML souboru

**Bezpečnost:**
- RLS zapnuté a vynucené ✅
- DB triggery pro integritu dat ✅
- Edge Functions pro citlivé operace ✅

### Co je rozpracované 🚧

**Statistics:**
- Stránka existuje, ale funkcionalita není implementována

**PDF generování:**
- Aktuálně se generuje pouze HTML
- PDF generování je plánováno přes Supabase Edge Function + headless Chromium

**Offline mode:**
- Základní localStorage fallback existuje
- Plná offline funkcionalita není implementována

**Migrace do cloudu:**
- Customers, Devices, Inventory, Comments, Photos jsou zatím localStorage only
- Směr: postupná migrace do cloudu s jednotným per-service modelem

**Granular permissions:**
- Tabulka `service_memberships` je připravena na `permissions` (jsonb)
- Oprávnění budou uložená v DB a vynucená přes RLS
- UI pouze zobrazuje/skrývá akce – není autorita

---

## Důležité poznámky

### Data mapping

**Supabase → UI:**
- `snake_case` (DB) → `camelCase` (UI)
- Funkce `mapSupabaseTicketToTicketEx()` provádí konverzi
- `performed_repairs` (JSONB) → `performedRepairs` (array)
- `diagnostic_text` (TEXT) → `diagnosticText` (string)
- `discount_value` (NUMERIC) → `discountValue` (number, může být undefined)

**UI → Supabase:**
- Při create/update se data konvertují zpět na snake_case
- `performedRepairs` → `performed_repairs`
- `diagnosticText` → `diagnostic_text`
- `discountType` → `discount_type`
- `discountValue` → `discount_value`

### Error handling

**Pravidlo:** Všechny Supabase operace mají try-catch s error logging.

**Logování:**
- `console.error()` pro Supabase chyby
- `console.log()` pouze pro důležité operace (např. "Cloud mode active")
- `showToast()` pro user feedback

### Type safety

**Používá se TypeScript:**
- Všechny komponenty mají typy
- `TicketEx`, `PerformedRepair`, `StatusMeta` atd. jsou definované typy
- `any` se používá pouze tam, kde je to nutné (např. Supabase responses)

### Stavové objekty v Orders

- `cloudTickets`: data načtená ze Supabase
- `detailedTicket`: aktuální ticket (useMemo z cloudTickets) - **read-only**
- `editedTicket`: kopie ticketu pro editaci (source of truth v edit módu)
- `newDraft`: pouze pro create nového ticketu

### SAVE / UPDATE PIPELINE (KRITICKÉ)

**saveTicketChanges():**
1. Musí brát data z `editedTicket`
2. Posílat je do Supabase
3. Vrátit celý řádek (`.select("*").single()`)
4. Aktualizovat `cloudTickets`

**Správný pattern:**
```typescript
await supabase
  .from("tickets")
  .update(payload)
  .eq("id", ticketId)
  .select("*")
  .single();
```

---

## Build a deployment

**Build:**
```bash
npm run tauri build
```

**Dev:**
```bash
npm run tauri dev
```

**Output:**
- `src-tauri/target/release/bundle/dmg/` - macOS DMG
- `src-tauri/target/release/bundle/` - další platformy

**Updater:**
- Tauri updater je nakonfigurován v `tauri.conf.json`
- Aplikace se automaticky aktualizuje při nových verzích

---

## Jak pracujeme

**Cursor:**
- Upravuje kód
- Implementuje features
- Fixuje bugs

**Ty (AI):**
- SQL dotazy a analýzy
- Architektonická rozhodnutí
- Návrhy řešení

**Workflow:**
- Max 1–2 kroky na iteraci
- Postupné testování a opravy
- Dokumentace důležitých rozhodnutí

**Pravidla pro další vývoj:**
- Postupovat **krok po kroku**
- Bez domýšlení struktury
- Pokud si chat není jistý: 👉 **nejdřív se zeptat Cursora, jak aplikace reálně vypadá**
- Backend (RLS) má vždy přednost před UI

---

## Debug tipy

- Pokud „nejde uložit“ → zkontroluj konzoli (`PGRST204`, runtime error)
- Pokud chybí data → zkontroluj payload vs DB schema
- Pokud se chovají divně zakázky → ověř `activeServiceId`
- Pokud chybí permissions v Tauri → zkontroluj `capabilities/default.json`
- Vždy se ptej **Cursora** – má otevřený celý kód
