# RESTORE CHECKLIST - Kompletní seznam funkcí/změn z tohoto chatu

## 1. UI KOMPONENTY A UTILITY

### 1.1 ConfirmDialog komponenta
**Implementace:** `src/components/ConfirmDialog.tsx` (řádky 1-136)
**Status:** ✅ existuje a sedí
**Ověření:** 
- Komponenta má pending state, error handling, double-click prevention
- Používá `normalizeError` pro error messages
- Podporuje variant="danger" a variant="default"

**Quick test:** Otevřít Settings → Team Management → Odstranit člena → měl by se zobrazit ConfirmDialog

---

### 1.2 normalizeError utility
**Implementace:** `src/utils/errorNormalizer.ts` (řádky 1-24)
**Status:** ✅ existuje a sedí
**Ověření:**
- Funkce normalizuje permission, network, Supabase-specific a generic errors
- Vrací user-friendly české zprávy

**Quick test:** Zkusit akci bez oprávnění → měla by se zobrazit normalizovaná chybová zpráva

---

### 1.3 AuthProvider a useAuth hook
**Implementace:** `src/auth/AuthProvider.tsx` (řádky 1-61)
**Status:** ✅ existuje a sedí
**Ověření:**
- AuthProvider poskytuje session, signIn, signUp
- useAuth hook je správně exportován
- Automatické sledování auth state změn

**Quick test:** Aplikace by se měla spustit bez chyby "useAuth must be used within AuthProvider"

---

## 2. TICKET MANAGEMENT (Orders.tsx)

### 2.1 Soft delete ticket s ConfirmDialog
**Implementace:** `src/pages/Orders.tsx` (řádky 3449-3450, 3937-3972, 5046-5066, 5865-5877)
**Status:** ✅ existuje a sedí
**Očekávaná implementace:**
- State: `deleteDialogOpen: boolean`, `deleteTicketId: string | null`
- Tlačítko "Smazat zakázku" → otevře ConfirmDialog místo `window.confirm`
- ConfirmDialog s `title="Smazat zakázku"`, `message="Opravdu chceš tuto zakázku přesunout do smazaných?"`, `variant="danger"`
- `onConfirm` → volá RPC `soft_delete_ticket`
- Error handling přes `normalizeError`

**Quick test:** V Orders → detail zakázky → kliknout "Smazat zakázku" → měl by se zobrazit ConfirmDialog

---

### 2.2 Restore ticket s ConfirmDialog (Settings.tsx)
**Implementace:** `src/pages/Settings.tsx` → sekce "Smazané zakázky" (řádky 2330-2537)
**Status:** ✅ existuje a sedí
**Očekávaná implementace:**
- State: `restoreDialogOpen: boolean`, `restoreTicketId: string | null`
- Tlačítko "Obnovit" → otevře ConfirmDialog místo `window.confirm`
- ConfirmDialog s `title="Obnovit zakázku"`, `message="Opravdu chceš tuto zakázku obnovit?"`, `variant="default"`
- `onConfirm` → volá RPC `restore_ticket` + lokální update seznamu
- Error handling přes `normalizeError`

**Quick test:** Settings → Smazané zakázky → kliknout "Obnovit" → měl by se zobrazit ConfirmDialog

---

### 2.3 setTicketStatus → RPC change_ticket_status
**Implementace:** `src/pages/Orders.tsx` (řádky 3931-3973)
**Status:** ✅ existuje a sedí
**Ověření:**
- Funkce `setTicketStatus` je async a volá RPC `change_ticket_status`
- Optimistic update před voláním RPC
- Error handling: toast "Nemáš oprávnění měnit status zakázky" pro permission errors
- Rollback optimistic update při chybě

**Quick test:** V Orders → změnit status zakázky → měl by se zavolat RPC a při chybě zobrazit toast

---

## 3. TEAM MANAGEMENT (Settings.tsx)

### 3.1 Team Management sekce
**Implementace:** `src/pages/Settings.tsx` (řádek 1857-1858, komponenta TeamManagement řádky 1865-2321)
**Status:** ✅ existuje a sedí
**Ověření:**
- Sekce "team" je v navigaci
- TeamManagement komponenta existuje
- Načítá services a members přes Edge Functions
- Zobrazuje seznam členů

**Quick test:** Settings → 👥 Tým / Přístupy → měla by se zobrazit sekce s členy

---

### 3.2 Role dropdown pro změnu rolí
**Implementace:** `src/pages/Settings.tsx` → TeamManagement (řádky 2050-2105, 2150-2225, 2375-2393)
**Status:** ✅ existuje a sedí
**Očekávaná implementace:**
- Pro každého člena dropdown s rolemi (member | admin)
- Disabled pokud: přihlášený není owner/admin, nebo cílový je owner
- Po kliknutí → ConfirmDialog "Změnit roli?"
- `onConfirm` → volá RPC `set_member_role`
- Po úspěchu → refresh members list

**Quick test:** Settings → Team → u člena kliknout na role dropdown → měl by se zobrazit ConfirmDialog

---

### 3.3 Capabilities UI (checkboxy pro oprávnění)
**Implementace:** `src/pages/Settings.tsx` → TeamManagement (řádky 1896-1900, 2064-2104, 2280-2390, 2445-2462)
**Status:** ✅ existuje a sedí
**Očekávaná implementace:**
- Pro každého membera tlačítko "Oprávnění"
- Collapsible sekce s 9 checkboxy:
  - `can_manage_tickets_basic`
  - `can_change_ticket_status`
  - `can_manage_ticket_archive`
  - `can_manage_customers`
  - `can_manage_statuses`
  - `can_manage_documents`
  - `can_edit_devices`
  - `can_edit_inventory`
  - `can_edit_service_settings`
- Checkboxy disabled pro adminy (informativně)
- Pro ownery nic (needitovat)
- Tlačítko "Uložit oprávnění" → ConfirmDialog → RPC `set_member_capabilities`
- Error handling přes `normalizeError`

**Quick test:** Settings → Team → u membera kliknout "Oprávnění" → měly by se zobrazit checkboxy

---

### 3.4 Odstranění člena s ConfirmDialog
**Implementace:** `src/pages/Settings.tsx` → TeamManagement (řádky 2046-2091)
**Status:** ✅ existuje a sedí
**Ověření:**
- State: `removeDialogOpen`, `removeUserId`, `removeServiceId`
- ConfirmDialog pro potvrzení odstranění
- Volání Edge Function `team-remove-member`
- Refresh members list po úspěchu

**Quick test:** Settings → Team → kliknout "Odstranit" u člena → měl by se zobrazit ConfirmDialog

---

## 4. DATABASE MIGRACE

### 4.1 RPC set_member_role
**Implementace:** `supabase/migrations/20250104000000_create_set_member_role_rpc.sql`
**Status:** ✅ existuje a sedí
**Očekávaná implementace:**
- Funkce `set_member_role(p_service_id uuid, p_user_id uuid, p_role text)`
- SECURITY DEFINER
- Autorizace: pouze owner může měnit role
- Blokace změny role ownera
- REVOKE EXECUTE FROM public, anon
- GRANT EXECUTE TO authenticated

**Quick test:** V Supabase SQL Editor → `SELECT * FROM pg_proc WHERE proname = 'set_member_role'` → měla by existovat funkce

---

### 4.2 Capabilities sloupec v service_memberships
**Implementace:** `supabase/migrations/20250105000000_add_capabilities_to_memberships.sql`
**Status:** ✅ existuje a sedí
**Očekávaná implementace:**
- `ALTER TABLE service_memberships ADD COLUMN capabilities JSONB NOT NULL DEFAULT '{}'::jsonb`
- Index na capabilities (GIN)
- Helper funkce `has_capability(p_service_id, p_user_id, p_capability)`
- Helper funkce `has_any_capability(p_service_id, p_user_id, p_capabilities[])`
- Obě funkce: SECURITY DEFINER, STABLE
- Komentář dokumentující v1 capability keys

**Quick test:** V Supabase SQL Editor → `SELECT capabilities FROM service_memberships LIMIT 1` → měl by existovat sloupec

---

### 4.3 RPC update_service_settings
**Implementace:** `supabase/migrations/20250105000001_add_update_service_settings_rpc.sql`
**Status:** ✅ existuje a sedí
**Očekávaná implementace:**
- Funkce `update_service_settings(p_service_id uuid, p_patch jsonb)`
- SECURITY DEFINER
- Autorizace: owner/admin vždy, member jen s `can_edit_service_settings`
- Whitelist polí (blokace system fields)
- REVOKE EXECUTE FROM public, anon
- GRANT EXECUTE TO authenticated
- RLS UPDATE policy na `service_settings` → zakázat přímý UPDATE (pouze přes RPC)

**Quick test:** V Supabase SQL Editor → `SELECT * FROM pg_proc WHERE proname = 'update_service_settings'` → měla by existovat funkce

---

### 4.4 RPC change_ticket_status
**Implementace:** `supabase/migrations/20250105000002_add_change_ticket_status_rpc.sql`
**Status:** ✅ existuje a sedí
**Očekávaná implementace:**
- Funkce `change_ticket_status(p_ticket_id uuid, p_next text)`
- SECURITY DEFINER
- Autorizace: owner/admin vždy, member jen s `can_change_ticket_status`
- REVOKE ALL ON FUNCTION ... FROM PUBLIC
- GRANT EXECUTE TO authenticated
- SET search_path = public

**Quick test:** V Supabase SQL Editor → `SELECT * FROM pg_proc WHERE proname = 'change_ticket_status'` → měla by existovat funkce

---

### 4.5 Trigger enforce_ticket_status_change_permissions
**Implementace:** `supabase/migrations/20250105000003_fix_ticket_status_rls_with_trigger.sql`
**Status:** ✅ existuje a sedí
**Očekávaná implementace:**
- Trigger funkce `enforce_ticket_status_change_permissions()`
- BEFORE UPDATE OF status ON tickets
- Kontrola: pokud NEW.status != OLD.status → ověřit capability
- SECURITY DEFINER, SET search_path = public
- RLS UPDATE policy na tickets → jednoduchá membership check (bez capability check)

**Quick test:** V Supabase SQL Editor → `SELECT * FROM pg_trigger WHERE tgname = 'trg_enforce_ticket_status_change_permissions'` → měl by existovat trigger

---

### 4.6 RPC set_member_capabilities
**Implementace:** `supabase/migrations/20250105000004_add_set_member_capabilities_rpc.sql`
**Status:** ✅ existuje a sedí
**Očekávaná implementace:**
- Funkce `set_member_capabilities(p_service_id uuid, p_user_id uuid, p_capabilities jsonb)`
- SECURITY DEFINER
- Autorizace: owner vždy OK, admin jen pro members
- Blokace změny capabilities pro admins/owners
- Whitelist capability keys
- Replace capabilities (ne merge)
- REVOKE EXECUTE FROM public, anon
- GRANT EXECUTE TO authenticated

**Quick test:** V Supabase SQL Editor → `SELECT * FROM pg_proc WHERE proname = 'set_member_capabilities'` → měla by existovat funkce

---

## 5. SERVICE SETTINGS UPDATE

### 5.1 saveServiceSettingsToDB → RPC update_service_settings
**Implementace:** `src/pages/Settings.tsx` → funkce `saveServiceSettingsToDB`
**Status:** ⚠️ Není v kódu - RPC migrace je hotová
**Poznámka:** V současném kódu není funkce `saveServiceSettingsToDB`, která by ukládala do `service_settings`. Sekce "Servis" v Settings ukládá pouze do localStorage (companyData). RPC funkce `update_service_settings` je implementována a připravena k použití. Pokud by se tato funkce v budoucnu implementovala, měla by použít RPC `update_service_settings`.

---

## 6. EDGE FUNCTIONS

### 6.1 team-list Edge Function
**Implementace:** `supabase/functions/team-list/index.ts`
**Status:** ✅ existuje a sedí
**Ověření:**
- CORS headers s `apikey` v `Access-Control-Allow-Headers`
- Autentizace přes `getUser()` bez parametru (používá global headers)
- Autorizace: pouze owner/admin může zobrazit seznam
- Vrací members s capabilities

**Quick test:** Settings → Team → měl by se načíst seznam členů

---

### 6.2 team-remove-member Edge Function
**Implementace:** `supabase/functions/team-remove-member/index.ts`
**Status:** ✅ existuje a sedí
**Ověření:**
- CORS headers s `apikey`
- Autentizace přes `getUser()`
- Autorizace: pouze owner/admin může odstranit člena
- Kontrola: nelze odstranit posledního ownera

**Quick test:** Settings → Team → odstranit člena → měl by fungovat

---

### 6.3 config.toml verify_jwt
**Implementace:** `supabase/config.toml`
**Status:** ✅ existuje a sedí
**Ověření:**
- `[functions.team-list] verify_jwt = true`
- `[functions.team-remove-member] verify_jwt = true`

**Quick test:** V `supabase/config.toml` → měly by být tyto sekce

---

## 7. INVITE FLOW

### 7.1 invite-accept v App.tsx
**Implementace:** `src/App.tsx`
**Status:** ✅ existuje a sedí
**Ověření:**
- `useEffect` pro zpracování invite tokenu po přihlášení
- Volání Edge Function `invite-accept` bez custom headers
- Error handling

**Quick test:** Přijmout pozvánku → po přihlášení by se měla automaticky zpracovat

---

### 7.2 invite-create v Settings.tsx
**Implementace:** `src/pages/Settings.tsx` → TeamManagement (řádky 1996-2044)
**Status:** ✅ existuje a sedí
**Ověření:**
- Funkce `handleCreateInvite` volá Edge Function `invite-create`
- Podporuje režimy "current" a "stock"
- Volání bez custom headers

**Quick test:** Settings → Team → vytvořit pozvánku → měl by fungovat

---

## 8. STATUSES DEFAULTS

### 8.1 statuses-init-defaults v StatusesStore.tsx
**Implementace:** `src/state/StatusesStore.tsx`
**Status:** ✅ existuje a sedí
**Ověření:**
- `useEffect` volá Edge Function `statuses-init-defaults` pokud nejsou statusy v localStorage
- Volání bez custom headers

**Quick test:** Smazat statusy z localStorage → restartovat app → měly by se načíst defaultní statusy

---

## 9. SUPABASE CLIENT

### 9.1 supabaseClient.ts bez custom headers
**Implementace:** `src/lib/supabaseClient.ts`
**Status:** ✅ existuje a sedí
**Ověření:**
- `createClient(supabaseUrl, supabaseAnonKey)` bez třetího parametru
- Žádné `global.headers`

**Quick test:** V `src/lib/supabaseClient.ts` → měl by být čistý createClient

---

## 10. LOGIN.TSX EXPORTY

### 10.1 isAuthenticated a setAuthenticated exporty
**Implementace:** `src/components/Login.tsx`
**Status:** ✅ existuje a sedí
**Ověření:**
- Exportované funkce `isAuthenticated()` a `setAuthenticated()` pro kompatibilitu s App.tsx
- `isAuthenticated()` kontroluje session token v localStorage
- `setAuthenticated()` je no-op (autentizace se řeší přes AuthProvider)

**Quick test:** Aplikace by se měla spustit bez chyby "Importing binding name 'setAuthenticated' is not found"

---

## 11. MAIN.TSX

### 11.1 AuthProvider wrapper
**Implementace:** `src/main.tsx`
**Status:** ✅ existuje a sedí
**Ověření:**
- `App` komponenta je obalená v `<AuthProvider>`
- Import `AuthProvider` existuje

**Quick test:** Aplikace by se měla spustit bez chyby "useAuth must be used within AuthProvider"

---

## SHRNUTÍ STATUSŮ

### ✅ Existuje a sedí (25 položek):
1. ConfirmDialog komponenta
2. normalizeError utility
3. AuthProvider a useAuth hook
4. Soft delete ticket s ConfirmDialog
5. Restore ticket s ConfirmDialog
6. setTicketStatus → RPC change_ticket_status
7. Team Management sekce
8. Odstranění člena s ConfirmDialog
9. team-list Edge Function
10. team-remove-member Edge Function
11. config.toml verify_jwt
12. invite-accept v App.tsx
13. invite-create v Settings.tsx
14. statuses-init-defaults v StatusesStore.tsx
15. supabaseClient.ts bez custom headers
16. Login.tsx exporty (isAuthenticated, setAuthenticated)
17. AuthProvider wrapper v main.tsx
18. Capabilities sloupec v service_memberships (migrace)
19. RPC set_member_role (migrace)
20. RPC update_service_settings (migrace)
21. RPC change_ticket_status (migrace)
22. Trigger enforce_ticket_status_change_permissions (migrace)
23. RPC set_member_capabilities (migrace)
24. Role dropdown pro změnu rolí
25. Capabilities UI (checkboxy)
26. services-list Edge Function
27. team-update-role Edge Function
28. Pending invite token helper

### ⚠️ Existuje částečně (5 položek):
1. saveServiceSettingsToDB → RPC update_service_settings (RPC migrace je hotová, frontend funkce v kódu není implementována - není co měnit)
2. Documents – cloud-first konfigurace (migrace existuje, frontend možná chybí)
3. Odstranění syntetických zákazníků (stále existují `computeCustomerId` funkce)
4. Opraveno zobrazování kódu zakázky (možná používá localStorage)
5. Otevírání náhledu / tisku (existuje `previewDocument`, ale používá temp soubory)

### ❌ Chybí (47 položek):
1-10. Customers & Tickets Integration (12.1-12.10)
11-15. Ticket Code & Generation (13.1-13.5, kromě 13.2-13.3 částečně)
16-17. Service Settings & Documents (14.1-14.2)
18-25. Preview & Documents (15.1-15.8, kromě 15.4 částečně)
26-27. Navigation & Real-Time (16.1-16.2)
28-29. Auth & Login rozšíření (17.1, 17.3)
30-31. Database Triggers & Migrace (19.1-19.2)

---

## DALŠÍ KROKY

1. ✅ **Hotovo:** Soft delete ticket s ConfirmDialog
2. **Další:** Restore ticket s ConfirmDialog
3. **Pak:** setTicketStatus → RPC change_ticket_status
4. **Pak:** Migrace (v pořadí podle závislostí):
   - 4.1 Capabilities sloupec + helper funkce (základ)
   - 4.2 RPC set_member_role
   - 4.3 RPC change_ticket_status
   - 4.4 Trigger enforce_ticket_status_change_permissions
   - 4.5 RPC update_service_settings
   - 4.6 RPC set_member_capabilities
5. **Pak:** Role dropdown
6. **Pak:** Capabilities UI
7. **Nakonec:** saveServiceSettingsToDB → RPC update_service_settings

---

## 12. CUSTOMERS & TICKETS INTEGRATION

### 12.1 customer_id FK do tickets
**Implementace:** DB migrace + `src/pages/Orders.tsx`
**Status:** ❌ chybí
**Očekávaná implementace:**
- DB migrace: přidat `customer_id UUID REFERENCES customers(id)` do tickets tabulky
- Create payload musí obsahovat `customer_id`
- Update payload musí obsahovat `customer_id`
- Mapping DB → UI: `customer_id` → `TicketEx.customerId`

**Quick test:** Vytvořit zakázku → měla by mít `customer_id` v DB

---

### 12.2 Normalizace telefonu (phone_norm)
**Implementace:** `src/utils/phoneNormalizer.ts` (nebo podobně) + DB migrace
**Status:** ❌ chybí
**Očekávaná implementace:**
- Funkce `normalizePhone(phone: string): string | null`
- Odstranění mezer, pomlček, závorek
- `00...` → `+...`
- Bez prefixu → default `+420`
- Krátká/nevalidní čísla → `null`
- DB migrace: přidat `phone_norm TEXT` do customers tabulky
- Při ukládání zákazníků: `phone_norm` v payloadu

**Quick test:** Uložit zákazníka s telefonem → měl by být normalizovaný v DB

---

### 12.3 Deduplikace zákazníků přes (service_id, phone_norm)
**Implementace:** DB migrace
**Status:** ❌ chybí
**Očekávaná implementace:**
- UNIQUE constraint na `(service_id, phone_norm)` v customers tabulce
- Ošetření 23505 (duplicate key) error v frontendu
- Find-or-create logika při ukládání zakázky

**Quick test:** Vytvořit dva zákazníky se stejným normalizovaným telefonem → měla by se vrátit 23505 nebo merge

---

### 12.4 Find-or-create customer logika
**Implementace:** `src/pages/Orders.tsx` → create/update ticket flow
**Status:** ❌ chybí
**Očekávaná implementace:**
- Při uložení zakázky: normalizace telefonu
- Hledání zákazníka podle `(service_id, phone_norm)`
- Pokud neexistuje → vytvoření
- Nastavení `tickets.customer_id`

**Quick test:** Vytvořit zakázku se zákazníkem → měl by se vytvořit/najít customer a nastavit customer_id

---

### 12.5 Opraven update flow zakázky (customer_id)
**Implementace:** `src/pages/Orders.tsx` → `saveTicketChanges`
**Status:** ❌ chybí
**Očekávaná implementace:**
- `customer_id` se nepřepisuje při update (zachování)
- Pokud chybí, dopočítá se při editaci
- `saveTicketChanges()` zachovává/přenáší `customerId`

**Quick test:** Upravit zakázku → customer_id by se neměl změnit

---

### 12.6 Detekce anonymního zákazníka
**Implementace:** `src/utils/customerUtils.ts` (nebo podobně)
**Status:** ❌ chybí
**Očekávaná implementace:**
- Funkce `isAnonymousCustomerName(name: string): boolean`
- `customer_id` zůstává `null` pro anonymní zákazníky
- Nikdy se nevytváří záznam v customers pro anonymní

**Quick test:** Vytvořit zakázku s anonymním jménem → customer_id by měl být null

---

### 12.7 Odstranění syntetických zákazníků
**Implementace:** `src/pages/Orders.tsx`, `src/pages/Customers.tsx`
**Status:** ⚠️ existuje částečně (stále existují `computeCustomerId` funkce)
**Očekávaná implementace:**
- Odstranit `computeCustomerId()` a `computeCustomerIdFromTicket()`
- Odstranit vytváření `tel:`, `mail:`, `name:...` ID
- Zobrazování pouze UUID záznamů z DB

**Quick test:** Customers list → měl by zobrazovat pouze UUID z DB, ne syntetické ID

---

### 12.8 Customers list - UUID-only záznamy z DB
**Implementace:** `src/pages/Customers.tsx`
**Status:** ❌ chybí (používá localStorage)
**Očekávaná implementace:**
- Fetch z cloudu (Supabase), ne localStorage
- Zobrazuje pouze UUID záznamy z DB
- Odstranění syntetických zákazníků z UI

**Quick test:** Customers list → měl by načítat z DB, ne z localStorage

---

### 12.9 Opraveno mazání zákazníků
**Implementace:** `src/pages/Customers.tsx`
**Status:** ❌ chybí
**Očekávaná implementace:**
- UUID-only delete
- Správný delete + state update
- Cascade delete nebo NULL customer_id v tickets

**Quick test:** Smazat zákazníka → měl by se smazat z DB a tickets by měly mít NULL customer_id

---

### 12.10 Seznam zakázek v detailu zákazníka
**Implementace:** `src/pages/Customers.tsx`
**Status:** ❌ chybí
**Očekávaná implementace:**
- Cloud fetch přes `customer_id + service_id`
- Loading / empty stavy
- Zobrazení seznamu zakázek v Customers detailu

**Quick test:** Otevřít detail zákazníka → měl by zobrazit seznam jeho zakázek

---

## 13. TICKET CODE & GENERATION

### 13.1 Přidání sloupce tickets.code
**Implementace:** DB migrace
**Status:** ❌ chybí
**Očekávaná implementace:**
- DB migrace pro `tickets.code TEXT`
- Používání v celé aplikaci

**Quick test:** V DB by měl existovat sloupec `code` v tickets tabulce

---

### 13.2 Opraveno zobrazování kódu zakázky
**Implementace:** `src/pages/Orders.tsx`
**Status:** ⚠️ existuje částečně (možná používá localStorage)
**Očekávaná implementace:**
- Používá se `tickets.code` z DB
- Renderování pouze `ticket.code` (nebo `—`)
- Odstranění `CLOUD-XXXX`, `TKT-XXXX`, `id.slice(...)`

**Quick test:** Zobrazit zakázku → měl by se zobrazit code z DB

---

### 13.3 Refaktor generování kódu zakázky (makeCode)
**Implementace:** `src/pages/Orders.tsx` → `makeCode()`
**Status:** ⚠️ existuje částečně (`makeCode()` existuje, ale možná používá localStorage)
**Očekávaná implementace:**
- Žádný localStorage
- Žádné MOCK_TICKETS
- Data jen z cloudu
- Prefix ze servisního nastavení
- Rok + sekvence
- Bere v potaz i smazané zakázky

**Quick test:** Vytvořit zakázku → měl by se vygenerovat code podle pravidel

---

### 13.4 Odstraněn autosave tickets do localStorage
**Implementace:** `src/pages/Orders.tsx`
**Status:** ❌ chybí
**Očekávaná implementace:**
- Odstranit `safeSaveTickets()` volání
- Online-only režim

**Quick test:** Po změně zakázky by se neměla ukládat do localStorage

---

### 13.5 Dokončen online-only režim
**Implementace:** `src/pages/Orders.tsx`
**Status:** ❌ chybí
**Očekávaná implementace:**
- Early-return při chybějícím cloudu
- Odstranění localStorage fallbacků

**Quick test:** Bez cloudu by aplikace měla zobrazit chybu, ne fallback

---

## 14. SERVICE SETTINGS & DOCUMENTS

### 14.1 Nová DB tabulka service_settings
**Implementace:** DB migrace
**Status:** ❌ chybí
**Očekávaná implementace:**
- Migrace pro `service_settings` tabulku
- RLS
- CRUD z Settings.tsx
- Nahrazení localStorage konfigurace

**Quick test:** V DB by měla existovat `service_settings` tabulka

---

### 14.2 Rozšíření Settings – sekce "Servis / Zakázky"
**Implementace:** `src/pages/Settings.tsx`
**Status:** ❌ chybí
**Očekávaná implementace:**
- Práce s daty servisu z DB
- UI napojené na `service_settings`
- Editace a ukládání

**Quick test:** Settings → Servis → měl by načítat/ukládat z DB

---

### 14.3 Documents – cloud-first konfigurace
**Implementace:** DB migrace (20250101000000_create_service_document_settings.sql) + `src/pages/Settings.tsx`
**Status:** ⚠️ existuje částečně (migrace existuje, frontend možná chybí)
**Očekávaná implementace:**
- DB migrace `service_document_settings` ✅ (existuje)
- Config jako JSONB
- RLS + updated_at trigger
- Cloud-first load z DB
- Auto-seed default configu
- Synchronizace do localStorage (offline fallback)

**Quick test:** Settings → Dokumenty → měl by načítat z DB

---

## 15. PREVIEW & DOCUMENTS

### 15.1 Preview komponenta (Preview.tsx)
**Implementace:** `src/pages/Preview.tsx`
**Status:** ⚠️ existuje částečně (soubor existuje, ale možná není implementován)
**Očekávaná implementace:**
- Načítá ticketId, docType, autoPrint z URL
- Generuje HTML dokumentu (ticket / diagnostic / warranty)
- Otevření nového Tauri webview okna na `/preview?...`
- Tisk přes `autoPrint` parametr
- Zavírání přes Tauri API

**Quick test:** Otevřít náhled dokumentu → měl by se otevřít Preview.tsx

---

### 15.2 Úprava App.tsx pro Preview route
**Implementace:** `src/App.tsx`
**Status:** ❌ chybí
**Očekávaná implementace:**
- Detekce `/preview` route
- Preview se renderuje bez hlavního layoutu

**Quick test:** Přejít na `/preview?...` → měl by se renderovat Preview, ne hlavní layout

---

### 15.3 Exporty z Orders.tsx pro preview
**Implementace:** `src/pages/Orders.tsx`
**Status:** ❌ chybí
**Očekávaná implementace:**
- `generateTicketHTML`
- `generateDiagnosticProtocolHTML`
- `generateWarrantyHTML`
- `mapSupabaseTicketToTicketEx`
- `safeLoadCompanyData`
- `safeLoadDocumentsConfig`
- `TicketEx` type

**Quick test:** Preview.tsx by měl být schopen importovat tyto funkce z Orders.tsx

---

### 15.4 Otevírání náhledu / tisku
**Implementace:** `src/pages/Orders.tsx` → `previewDocument()`
**Status:** ⚠️ existuje částečně (existuje, ale používá temp soubory)
**Očekávaná implementace:**
- `previewDocument()` otevírá nové Tauri webview okno na `/preview?...`
- Nepoužívá `opener.openPath`, temp soubory ani blob URL
- Všechny akce sjednoceny (preview/print)
- Tisk řešen přes `autoPrint` parametr

**Quick test:** Kliknout na náhled dokumentu → měl by otevřít Preview.tsx, ne temp soubor

---

### 15.5 Tisk z iframe
**Implementace:** `src/pages/Preview.tsx`
**Status:** ❌ chybí
**Očekávaná implementace:**
- Tisk probíhá z iframe (`iframe.contentWindow.print()`)
- Přidán `focus()` před tiskem
- Fallback + detailní logování

**Quick test:** Tisknout z Preview → měl by tisknout z iframe

---

### 15.6 Zavírání preview okna
**Implementace:** `src/pages/Preview.tsx`
**Status:** ❌ chybí
**Očekávaná implementace:**
- React toolbar v Preview.tsx (Tisknout / Zavřít)
- Zavírání přes Tauri API v Reactu
- Odstranění `window.close()` z HTML dokumentu
- Skryta/deaktivována původní HTML tlačítka

**Quick test:** Kliknout Zavřít v Preview → měl by zavřít okno přes Tauri API

---

### 15.7 Tauri permissions
**Implementace:** `src-tauri/tauri.conf.json` nebo capabilities
**Status:** ❌ chybí
**Očekávaná implementace:**
- `core:webview:allow-create-webview-window`
- `core:webview:allow-print`
- `core:window:allow-show`
- `core:window:allow-set-focus`
- `core:window:allow-center`

**Quick test:** Preview okno by se mělo otevřít bez chyb

---

### 15.8 Guardy pro preview okno
**Implementace:** `src/pages/Orders.tsx` → `previewDocument()`
**Status:** ❌ chybí
**Očekávaná implementace:**
- Prevence "a webview with label 'preview' already exists"
- Buď znovu použije, nebo korektně zavře před otevřením nového

**Quick test:** Otevřít preview dvakrát rychle → neměla by se zobrazit chyba

---

## 16. NAVIGATION & REAL-TIME

### 16.1 Orders ↔ Customers navigační logika
**Implementace:** `src/pages/Orders.tsx`, `src/pages/Customers.tsx`, `src/App.tsx`
**Status:** ❌ chybí
**Očekávaná implementace:**
- Otevření detailu zakázky z Customers
- Návrat zpět na stejného zákazníka
- `returnToPage` logika

**Quick test:** Z Customers otevřít zakázku → měl by se otevřít Orders s návratem

---

### 16.2 Realtime handling zakázek
**Implementace:** `src/pages/Orders.tsx`
**Status:** ❌ chybí
**Očekávaná implementace:**
- Reakce na soft delete (`deleted_at: null → not null`)
- Reakce na restore (`not null → null`)
- Filtrování podle `service_id`
- Deterministická logika add / remove / upsert
- Stabilní řazení podle `created_at`
- Odstranění závislosti na `payload.old`

**Quick test:** V jiném okně smazat zakázku → měla by zmizet v real-time

---

## 17. AUTH & LOGIN (rozšíření)

### 17.1 OnlineGate
**Implementace:** `src/components/OnlineGate.tsx` (řádky 1-89)
**Status:** ✅ existuje a sedí
**Ověření:**
- Komponenta kontroluje Supabase připojení přes `supabase.auth.getSession()` a `supabase.from('services').select('id').limit(1)`
- Zobrazuje loading state při kontrole
- Zobrazuje error message s retry tlačítkem pokud není cloud dostupný
- Integrováno v `src/App.tsx` - obaluje hlavní layout

**Quick test:** Bez cloudu by se měla zobrazit chyba s retry tlačítkem, ne aplikace

---

### 17.2 Pending invite token helper
**Implementace:** `src/lib/pendingInvite.ts`
**Status:** ✅ existuje a sedí
**Očekávaná implementace:**
- `localStorage` helper pro invite token
- Auto-accept invite po loginu

**Quick test:** Přijmout pozvánku → měl by se uložit token a po loginu automaticky použít

---

### 17.3 Úprava Login UI pro invite token
**Implementace:** `src/components/Login.tsx` (řádky 15-22, 211-220)
**Status:** ✅ existuje a sedí
**Ověření:**
- `useEffect` kontroluje `getPendingInviteToken()` a auto-prefilluje token
- Auto-switch na `isSignUp: true` pokud token existuje
- Input pole pro invite token se zobrazuje když `isSignUp === true`
- Tlačítko "Přihlásit se" je skryté když `inviteToken` je přítomen
- Tlačítko "Registrovat se" je enabled pouze když `inviteToken` je přítomen
- `setPendingInviteToken` se volá při změně tokenu

**Quick test:** S invite tokenem by mělo být vidět pole a registrační tlačítko, login tlačítko skryté

---

## 18. EDGE FUNCTIONS (rozšíření)

### 18.1 services-list Edge Function
**Implementace:** `supabase/functions/services-list/index.ts`
**Status:** ✅ existuje a sedí
**Očekávaná implementace:**
- Edge Function pro seznam servisů
- Používá 2 Supabase klienty (userClient + adminClient)

**Quick test:** Měla by existovat Edge Function `services-list`

---

### 18.2 team-update-role Edge Function
**Implementace:** `supabase/functions/team-update-role/index.ts`
**Status:** ✅ existuje a sedí (soubor existuje)
**Očekávaná implementace:**
- Edge Function pro změnu role
- Používá 2 Supabase klienty
- Deploy s `--no-verify-jwt` (nebo správným patternem)

**Quick test:** Měla by existovat Edge Function `team-update-role`

---

## 19. DATABASE TRIGGERS & MIGRACE

### 19.1 DB triggery (prevent_root_owner_change, prevent_last_owner_removal)
**Implementace:** `supabase/migrations/20250109000000_add_owner_protection_triggers.sql`
**Status:** ✅ existuje a sedí
**Ověření:**
- `prevent_root_owner_change()` funkce - blokuje změnu role ownera na non-owner
- `prevent_last_owner_removal()` funkce - blokuje smazání/změnu posledního ownera
- Trigger `trg_prevent_root_owner_change` na `service_memberships` BEFORE UPDATE
- Trigger `trg_prevent_last_owner_removal` na `service_memberships` BEFORE DELETE/UPDATE
- DELETE je blokován triggery (ne RLS)

**Quick test:** Pokus o změnu role ownera → měl by být blokován triggerem

---

### 19.2 Migrace tickets.created_at
**Implementace:** `supabase/migrations/20250109000001_fix_tickets_created_at.sql`
**Status:** ✅ existuje a sedí
**Ověření:**
- Aktualizuje všechny NULL hodnoty na `now()`
- Nastaví `DEFAULT now()` pro sloupec
- Přidá `NOT NULL` constraint

**Quick test:** V DB by měl být sloupec `created_at` NOT NULL s DEFAULT now()

---

## 20. VEDLEJŠÍ ČÁSTI (implementováno v této session)

### 20.1 Nahrazení window.confirm za ConfirmDialog v Orders.tsx (low stock warning)
**Implementace:** `src/pages/Orders.tsx` (řádky 3949-3951, 4213-4218, 6565-6583)
**Status:** ✅ existuje a sedí
**Ověření:**
- State: `lowStockDialogOpen`, `lowStockProducts`, `lowStockCallback`
- `window.confirm` nahrazen za `ConfirmDialog` s callback pattern
- ConfirmDialog zobrazuje seznam produktů s nízkým skladem

**Quick test:** Přidat opravu s produktem, který by měl sklad < 1 → měl by se zobrazit ConfirmDialog

---

### 20.2 Nahrazení alert() za showToast v Orders.tsx
**Implementace:** `src/pages/Orders.tsx` (řádky 861, 867, 912, 919, 973, 980, 6317, 6319)
**Status:** ✅ existuje a sedí
**Ověření:**
- Všechna `alert()` volání nahrazena za `showToast()` s appropriate variant ("error" nebo "success")
- Preview errors, export errors, print errors, repair add errors

**Quick test:** Zkusit otevřít preview bez oprávnění → měl by se zobrazit toast místo alert

---

### 20.3 Nahrazení window.confirm za ConfirmDialog v Inventory.tsx
**Implementace:** `src/pages/Inventory.tsx` (řádky 401-403, 598-601, 633-636, 2583-2600)
**Status:** ✅ existuje a sedí
**Ověření:**
- State: `lowStockDialogOpen`, `lowStockCallback`
- `window.confirm` nahrazen za `ConfirmDialog` v `addProduct` a `updateProduct`
- ConfirmDialog zobrazuje varování o nízkém skladu

**Quick test:** Přidat/upravit produkt se skladem < 1 → měl by se zobrazit ConfirmDialog

---

### 20.4 Nahrazení alert() za showToast v Inventory.tsx
**Implementace:** `src/pages/Inventory.tsx` (řádek 666)
**Status:** ✅ existuje a sedí
**Ověření:**
- `alert()` pro image upload error nahrazen za `showToast("Prosím vyberte obrázek", "error")`

**Quick test:** Zkusit upload neobrázku → měl by se zobrazit toast místo alert

---

### 20.5 diagnostic_photos v createTicket payloadu
**Implementace:** `src/pages/Orders.tsx` (řádek 4758)
**Status:** ✅ existuje a sedí
**Ověření:**
- `diagnostic_photos` přidán do payload v `createTicket` funkci
- Hodnota: `(newDraft as any).diagnosticPhotos ?? []`

**Quick test:** Vytvořit ticket s diagnostic photos → měly by se uložit do DB

---

### 20.6 saveCapabilities funkce v Settings.tsx
**Implementace:** `src/pages/Settings.tsx` (řádky 2460-2475)
**Status:** ✅ existuje a sedí
**Ověření:**
- Funkce `saveCapabilities` implementována
- Volá `updateCapabilities` s capabilities z `localCapabilitiesByMember`
- Používá se v ConfirmDialog pro uložení capabilities

**Quick test:** V Settings → Team → rozbalit capabilities → změnit → Uložit → měl by se zobrazit ConfirmDialog a po potvrzení uložit

---

## POZNÁMKY K IMPLEMENTACI

### ✅ Všechny migrace jsou implementovány
V `supabase/migrations/` existují všechny potřebné migrace:
- `20250101000000_create_service_document_settings.sql`
- `20250104000000_create_set_member_role_rpc.sql`
- `20250105000000_add_capabilities_to_memberships.sql`
- `20250105000001_add_update_service_settings_rpc.sql`
- `20250105000002_add_change_ticket_status_rpc.sql`
- `20250105000003_fix_ticket_status_rls_with_trigger.sql`
- `20250105000004_add_set_member_capabilities_rpc.sql`
- `20250106000000_add_customers_phone_norm_and_tickets_customer_id.sql`
- `20250106000001_add_tickets_diagnostic_and_discount_fields.sql`
- `20250107000000_add_tickets_code_column.sql`
- `20250108000000_create_service_settings.sql`
- `20250109000000_add_owner_protection_triggers.sql`
- `20250109000001_fix_tickets_created_at.sql`
- `20250110000000_add_soft_delete_and_restore_ticket_rpc.sql`

### ✅ useActiveRole hook existuje
Hook `useActiveRole` je implementován v `src/hooks/useActiveRole.ts` a používá se v Orders.tsx a Settings.tsx.

### ✅ Smazané zakázky sekce v Settings existuje
Sekce "Smazané zakázky" v Settings.tsx je implementována jako `DeletedTicketsManagement` komponenta (řádky 3076-3284). Zobrazuje seznam smazaných zakázek a umožňuje jejich obnovení přes ConfirmDialog.

### Service Settings vs Company Data
Poznámka: V Settings.tsx existuje sekce "🏢 Servis" (company), která ukládá do `localStorage` jako `companyData`. Toto je **jiné** než `service_settings` tabulka v DB, která obsahuje konfiguraci servisu (např. `config` JSONB sloupec s `abbreviation`). Funkce `update_service_settings` RPC ukládá do `service_settings` tabulky.

